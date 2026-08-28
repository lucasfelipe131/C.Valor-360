# VAL Multimodal Conversation v1

## 1. Objetivo e alcance

O contrato multimodal v1 permite alternar texto, voz, foto, PDF/outro arquivo, resultado de ferramenta e cards dentro da mesma conversa do Copilot. Modalidade é atributo do turno, não fronteira de thread nem autorização para persistir memória.

Este documento registra o que o código atual implementa. Não afirma que FitoScan/NutriScan será acionado para toda foto, que um PDF sempre será interpretável, nem que a experiência foi aprovada em dispositivo físico.

## 2. Regra de identidade

`conversationScopeKey()` produz a base com o produtor selecionado, ou `__global__` sem produtor. Visita, oportunidade, propriedade, talhão, attachment e ferramenta não alteram esse escopo. A conversa inicial pode usar a base; `createConversationThreadKey()` acrescenta `:conversation:<id>` para cada “Nova conversa”. Cada envio mantém o mesmo `conversationId` até essa ação explícita.

Quando a conversa começa sem produtor e o backend resolve um nome autorizado, a UI mantém `threadOverride` e o mesmo `conversationId`. Quando há troca explícita de produtor, o backend limpa os turnos e todo o contexto subordinado do `ConversationState` anterior. Mensagens já renderizadas podem continuar visíveis no histórico local da UI, mas não entram no estado ativo nem no prompt do novo produtor.

## 3. Matriz de modalidades

| Modalidade | Entrada | Transporte canônico | Saída na mesma thread | Persistência automática |
|---|---|---|---|---|
| Texto | `textarea` do composer | `ask()` → `POST /api/val/chat` com `input_modality: text` | Texto, TTS opcional, perguntas e cards | Não |
| Voz contínua | Web Speech em pt-BR, após opt-in | Transcrição → mesmo `ask()` com `input_modality: voice`, `conversation_mode: true` e `response_mode` conforme a preferência `text`, `audio` ou `both` | Texto e/ou TTS conforme preferência; reabre outro turno após resposta ou fala | Não |
| Voz push-to-talk | `VoiceCapture transient` com produtor; captura efêmera sem produtor | Transcrição → mesmo `ask()` | Texto/TTS/cards conforme preferência | Não |
| Foto vinculada | Câmera ou seletor; JPEG, PNG ou WebP no input da UI | Upload autenticado → attachment → ID no mesmo `POST /api/val/chat`; `input_modality: photo` | Leitura e card aplicável; attachment de origem permanece associado ao turno | Não |
| PDF/arquivo vinculado | Seletor de arquivo | Upload autenticado → attachment → ID no mesmo `POST /api/val/chat`; `input_modality: file` | Leitura e card aplicável | Não |
| Resultado de ferramenta | Intent Router + capability existente | Resposta estruturada do mesmo request ou abertura controlada do módulo | `GenericToolCard` ou card específico junto da conversa | Não |
| Card | Payload de AI Reasoning/capability | Renderização local de `ReasoningResponse` | Mantém composer, histórico e follow-ups ativos | Não |

As preferências de saída são `text`, `audio` e `both`, escopadas pelo login. Ao optar pelo modo conversa sem preferência previamente gravada, a UI estabelece `audio` para cumprir “Fale e ouça”; uma preferência explícita anterior por texto ou ambos é preservada. Alterá-las não cria thread.

## 4. Fluxo de texto e voz

### 4.1 Texto → voz

Um turno digitado é anexado à thread e recebe uma resposta do mesmo pipeline. O usuário pode selecionar saída Áudio/Texto + áudio ou dizer uma das formas reconhecidas de `OUTPUT_AUDIO`. `ValAudioResponse` e o modo conversacional usam o `voice_output.speakable_text` produzido pelo AI Reasoning; não há um conteúdo factual separado para voz.

### 4.2 Voz → texto

No modo contínuo, a transcrição é enviada à mesma conversa. `Agora por escrito` muda a preferência para texto. `Só as Perguntas de Ouro` renderiza até três perguntas localmente e marca `suppressSpeech`, evitando repetir o bloco por TTS.

### 4.3 Texto/voz → voz das perguntas

Depois de renderizar as Perguntas de Ouro, `Agora fala elas pra mim` reutiliza o bloco textual anterior quando disponível. A operação não refaz o cálculo nem abre outra thread.

### 4.4 Push-to-talk e fallback

O push-to-talk permanece disponível. Com produtor, a captura usa `VoiceCapture` em modo transitório com `persistence_mode: NONE` e é cancelada depois da transcrição; sem produtor, usa captura efêmera do navegador. Se o modo contínuo não tiver input ou output compatível, a UI oferece push-to-talk e texto sem bloquear o Copilot.

Ambiguidade de produtor com opções preserva as opções de modalidade no retry e não derruba o modo para fallback. Já `Registra que …` suspende o modo contínuo e abre o `VoiceCapture` de revisão; a confirmação permanece uma ação humana explícita no modal, não um “sim” interpretado silenciosamente pelo chat.

## 5. Fluxo de foto vinculada

1. O consultor escolhe ou captura uma imagem no composer.
2. A UI valida tipo e limite de tamanho.
3. Com produtor ativo, a imagem é criada em `POST /api/val/attachments` sob tenant + owner + produtor.
4. O ID é mantido no composer e enviado no próximo `POST /api/val/chat` com o mesmo `conversationId`.
5. O backend carrega o attachment novamente pelo escopo autenticado. ID ausente, attachment de outro produtor/owner ou conteúdo indisponível falha fechado.
6. O tipo do attachment participa do Intent Router e do System Capability Router; a engine/capability existente processa a evidência.
7. Se a resposta não comprovar que todos os attachments foram interpretados ou confirmados, o backend devolve `422 val_attachment_analysis_unavailable` em vez de simular consumo multimodal.
8. A resposta e os `sourceAttachments` são anexados à mesma thread. Um card pode abrir diagnóstico ou outro módulo usando o attachment autorizado como handoff. Se a thread trocar de produtor e mantiver cards anteriores visíveis, a UI bloqueia o card antigo antes do download e o servidor volta a validar o produtor declarado na leitura do conteúdo.

A seleção da capability depende da intenção, do contexto e da disponibilidade do executor. O v1 não declara que toda foto é automaticamente NutriScan ou FitoScan.

## 6. Fluxo de PDF e outros arquivos vinculados

O fluxo é o mesmo da foto, com `input_modality: file`. O composer aceita PDF, Word, Excel, CSV e TXT, além das imagens; o backend também mantém sua própria allowlist. Cada arquivo pode ter até 6 MB e no máximo três attachments acompanham uma pergunta.

O nome e o MIME podem sugerir análise de solo, diagnóstico por imagem ou pergunta agronômica quando o material chega por um lançamento contextual. No envio comum, o router e o conteúdo disponível determinam o caminho; não há promessa de inferência perfeita pelo nome do arquivo.

O PDF permanece evidência, não memória confirmada. Uma associação ao produtor existe porque o upload foi explicitamente feito nesse escopo, mas fatos extraídos não são promovidos para memória pelo ASK.

## 7. Attachment sem produtor

O chat não aceita attachment sem produtor: se houver IDs de attachment sem `clientId`, o backend devolve `val_attachment_client_required`.

Na UI, arquivos escolhidos sem produtor ficam pendentes e o usuário recebe duas opções explícitas:

- escolher um produtor e `Vincular e continuar`; ou
- `Deixar sem vínculo`, quando o lote é compatível com uma a três fotos de diagnóstico ou com um único PDF/imagem de análise de solo.

`Deixar sem vínculo` cria attachment com `association: UNLINKED` e abre o workspace agronômico existente por handoff. Word, Excel, CSV e TXT sem produtor exigem seleção de produtor. Esse handoff não é apresentado como continuação de uma memória de produtor e não autoriza o Copilot a inventar vínculo.

Como o fluxo UNLINKED navega para o módulo agronômico, ele não é evidência de que toda análise sem produtor permanece visualmente na thread do Copilot. Essa continuidade deve ser tratada como limite atual, não como PASS presumido.

## 8. Resultado de ferramenta e cards

O `ReasoningResponse` usa o payload canônico para renderizar:

- `GenericToolCard` quando há `run.tool_result`;
- `PrepareVisitCard`, `AgronomicInsightCard`, `DiagnosisCard`, `OpportunityCard`, `MarketCard`, `CalculationCard` ou `CommitmentCard`, conforme a intenção;
- `DecisionInterviewCard` quando faltam informações materiais;
- Perguntas de Ouro e camadas de evidência/qualidade conforme a densidade selecionada.

Abrir um módulo não duplica a fórmula ou o diagnóstico no frontend. Para um handoff agronômico, a UI busca o binário pelo endpoint autenticado do attachment, reconstrói o arquivo localmente e entrega `sourceAttachment` ao módulo existente. O GET do binário exige `clientId` para `LINKED_CLIENT` ou `association=UNLINKED` sem cliente. Uma falha de escopo ou indisponibilidade interrompe o handoff.

O estado conversacional conserva somente um resumo limitado de `recent_tool_results` (`capability`, `status`, `source_ref`, `summary`). Resultado completo continua pertencendo ao payload/attachment e ao módulo canônico.

## 9. Provenance e proteção de attachment

Na transição da resposta para um módulo, a referência de origem inclui, quando disponível:

- `id` do attachment;
- `organizationId` e `clientId`;
- `association`;
- `propertyId` ou `fieldId` derivados do objeto ativo;
- nome, MIME, data de criação e SHA-256.

O backend nunca confia somente nesses campos do browser: ele recarrega o attachment pelo tenant, owner, produtor e ID autenticados. GET de conteúdo e PATCH público exigem o mesmo escopo explícito na query. O PATCH aceita somente `id`, uma transição humana opcional em `status` e/ou o bloco sanitizado `fieldPhoto`; uma edição apenas de metadados conserva o estado `interpreted`, enquanto `analysis` e `latestScanResult` permanecem gerenciados pelo servidor e preservados no merge.

Os contratos específicos de provenance de NutriScan/FitoScan continuam sendo os contratos dos módulos agronômicos. Este documento apenas define como o Copilot preserva e entrega a referência do attachment de origem.

## 10. Memória, contexto e troca de modalidade

- `input_modality` é `text`, `voice`, `photo` ou `file`.
- `response_mode` é `text`, `audio` ou `both`.
- `conversation_mode` indica o modo de voz em turnos.
- `conversation_turns` registra a modalidade do turno no estado temporário.
- `recent_tool_results` permite que uma referência curta use o resultado recente como parte do contexto de sessão, sem promovê-lo a memória.
- O objeto ativo pode evoluir para visita, oportunidade, propriedade ou talhão sem alterar a thread.
- Uma troca de produtor limpa resultados e referências subordinadas do estado anterior. Attachments já persistidos permanecem no escopo original e não podem ser consumidos no novo produtor.

O histórico de UI e o estado process-local servem à continuidade, mas não equivalem à memória confirmada do produtor.

## 11. Falhas fechadas e fallback

| Situação | Resultado esperado |
|---|---|
| GET/PATCH sem `clientId` ou `association=UNLINKED` | `400 attachment_browser_scope_required`; nenhum conteúdo ou mutação. |
| Attachment de outro produtor/owner ou ID inexistente | `404 attachment_scope_not_found` no conteúdo/PATCH, ou `val_attachment_scope_invalid` no chat; nenhuma análise. |
| Attachment sem conteúdo persistido | `422 val_attachment_content_unavailable`. |
| Leitura multimodal não concluída | `422 val_attachment_analysis_unavailable`. |
| Attachment enviado ao chat sem produtor | `422 val_attachment_client_required`. |
| Tipo/tamanho/quantidade inválidos | Rejeição antes da análise; nenhum consumo simulado. |
| Web Speech ou TTS indisponível | Estado FALLBACK com push-to-talk/texto. |
| Erro no turno de voz | Microfone desligado e fallback; a thread continua utilizável. |
| Intenção de persistência em ASK | `409 val_confirmation_required`. |

## 12. Limites explícitos

- Não há streaming de texto nem TTS segmentado/progressivo.
- O modo contínuo usa APIs de voz do navegador; compatibilidade real deve ser verificada em Safari/PWA e Chrome/PWA físicos.
- A resposta só inicia TTS depois que o turno assíncrono retorna texto utilizável.
- Foto/PDF sem produtor não entra diretamente no chat; exige vínculo ou handoff UNLINKED.
- A escolha automática entre diagnóstico visual, NutriScan, FitoScan e outro executor não é garantida para toda frase/arquivo.
- Abrir um módulo especializado é navegação/handoff, não execução invisível completa dentro da bolha de chat.
- Os testes automatizados não comprovam qualidade visual da câmera, permissão de arquivo, microfone, TTS, interrupção ou performance percebida em dispositivo real.

## 13. Critérios e evidências

| Critério | Evidência no repositório | Condição para PASS de gate |
|---|---|---|
| Modalidade não fragmenta thread | `src/lib/full-screen-conversation.js`; `test/val-full-screen-copilot.test.js` | Sequência golden mantém o mesmo produtor, objeto e `conversationId`. |
| Voz usa o mesmo `ask()` | `src/components/GlobalValCopilot.jsx`; `test/val-natural-conversation-integration-v1.test.js` | Voz real alterna com texto sem reset. |
| Foto/PDF são escopados | `server.js`; `src/lib/attachment-browser-scope.js`; `test/attachment-browser-scope.test.js`; `test/val-engine.test.js` | Upload e leitura reais no staging, incluindo falhas fechadas. |
| UNLINKED é explícito | `test/attachment-browser-scope.test.js`; `test/unlinked-media-handoff.test.js` | Usuário escolhe a opção e nenhum produtor é inferido. |
| Resultado retorna à conversa em card | `src/components/GlobalValCopilot.jsx` | Cenário golden comprova card + follow-up coerente. |
| Attachment de origem acompanha handoff | `sourceAttachments` no Copilot; testes de handoff e provenance agronômica | Resultado real conserva referência ponta a ponta. |
| Voz/texto compartilham políticas | `ConversationState` e AI Reasoning comuns | Safety, tenancy e claims técnicos passam na regressão. |
| Fallback não bloqueia Copilot | `test/val-realtime-conversation-v1.test.js` | Browser/dispositivo incompatível continua por PTT/texto. |

O gate deve distinguir contrato automatizado de execução real. Sem golden multimodal ponta a ponta, regressão completa e UAT físico, este documento não sustenta uma classificação PASS.
