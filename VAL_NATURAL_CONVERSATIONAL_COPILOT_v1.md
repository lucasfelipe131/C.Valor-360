# VAL Natural Conversational Copilot v1

## 1. Escopo deste contrato

O Natural Conversational Copilot v1 é uma camada incremental sobre o Copilot full-screen e sobre o pipeline de decisão já existente. Ele não cria uma segunda engine, não substitui o modo direto e não altera, por si só, memória confirmada.

Este documento descreve o comportamento observável no código e nos testes da branch. Ele não é um resultado de gate e não declara UAT físico, conversa de voz real ou naturalidade humana como aprovados.

## 2. Invariantes

- O modo direto continua disponível por ações rápidas, cards e abertura dos módulos originais.
- Perguntas digitadas, transcrições de voz e attachments vinculados entram pelo mesmo `ask()` e `POST /api/val/chat`. Comandos locais, o fluxo REGISTER e o handoff UNLINKED são exceções deliberadas: reutilizam a UI/capability existente sem fingir uma chamada ao chat.
- O `Intent Router`, o `System Capability Router`, o `ValCore`, o AI Reasoning e os executores de capability existentes continuam sendo o caminho canônico.
- Estado de conversa é temporário e sempre declara `persistence_mode: NONE` e `persistent_memory_unchanged: true`.
- Qualquer intenção persistente enviada ao endpoint de pergunta falha fechada com `val_confirmation_required`.
- Tenant, owner, produtor e conversa são revalidados no backend. Attachments enviados ao chat são reconciliados por tenant + owner + produtor + ID; GET/PATCH do browser também exige `clientId` ou `association=UNLINKED` explícito. Referências fornecidas pelo browser não ampliam autorização.

## 3. Arquitetura incremental

| Responsabilidade | Implementação v1 | Papel no fluxo |
|---|---|---|
| Superfície | `src/components/GlobalValCopilot.jsx` | Mantém a conversa full-screen, o composer, as ações diretas, os cards e o modo REGISTER já existente. |
| Identidade da thread | `src/lib/full-screen-conversation.js` | Escopa por geral/produtor e permite conversas distintas por ID; objeto ativo e modalidade não fragmentam a conversa corrente. |
| Comandos naturais | `src/lib/val-natural-commands.js` | Resolve um conjunto fechado de follow-ups locais e traduz aprofundamentos para a engine existente. |
| Estado temporário | `server/decision-copilot/conversation-state.js` | Normaliza referências, turnos, fatos, hipóteses e resultados recentes sem promover memória. |
| Sessão no backend | `server/decision-copilot/conversation-session-store.js` | Guarda o estado em memória, escopado por tenant + owner + `conversation_id`, com TTL. |
| Resolução de produtor | `server/decision-copilot/client-reference-resolver.js` e `server/repository.js` | Resolve nomes somente contra a carteira autorizada e exige desambiguação quando há mais de uma opção. |
| Continuação | `server/conversation-thread-context.js` | Acrescenta contexto temporário a mensagens referenciais e o rotula explicitamente como não confirmado. |
| Orquestração | `server.js` e `server/core/val-core.js` | Encaminha `ConversationState` ao fluxo canônico, executa capabilities, finaliza resposta e avança a sessão. |
| Voz conversacional | `ValRealtimeConversation`, `useRealtimeConversation` e `realtime-conversation.js` | Converte cada turno de fala em uma chamada ao mesmo `ask()` e reproduz a resposta curta por TTS. |
| Qualidade | `server/ai-reasoning/conversational-naturalness.js` | Produz avaliação heurística secundária sem substituir grounding, confidence, safety ou testes de especificidade. |

Não há executor conversacional paralelo. O estado novo entra em `contextRequest.conversationState` e o `ValCore` continua chamando a engine configurada.

## 4. Fluxo canônico de um turno

1. A UI conserva o `conversation_id` da thread ativa.
2. Texto reconhecido, texto digitado ou pedido acompanhado de attachment vinculado é normalizado em `ask()`; comandos locais, REGISTER e UNLINKED seguem seus contratos próprios.
3. A UI envia produtor atual, objeto ativo, intenção opcional, IDs de attachments e preferências de modalidade ao `POST /api/val/chat`.
4. O backend recupera a sessão pelo escopo autenticado e tenta resolver uma referência natural de produtor quando aplicável.
5. O Intent Router classifica o pedido. Uma intenção persistente não prossegue pelo fluxo ASK.
6. O contexto confirmado é obtido com cache escopado por tenant + owner + produtor + conversa.
7. `ConversationState` é acrescentado ao contexto da engine existente; referências curtas podem receber uma descrição temporária do produtor, propriedade, talhão, cultura, safra, assunto e objetivo ativos.
8. A resposta passa pelos validadores, é anexada à mesma thread e alimenta somente o estado temporário da sessão.
9. Resultado estruturado, pergunta material ou ação de módulo é renderizado sem transformar o turno em memória permanente.

## 5. Thread e estado de sessão

### 5.1 Identidade

No browser, `conversationScopeKey()` produz a base de escopo:

- `__global__`, quando não há produtor; ou
- `client:<id>`, quando há produtor.

Visita, oportunidade, talhão, propriedade, foto, PDF e ferramenta podem mudar o objeto ativo, mas não fragmentam a conversa corrente. A thread inicial pode usar a base; `createConversationThreadKey()` acrescenta `:conversation:<id>` quando o usuário abre outra conversa no mesmo escopo. Quando um produtor é localizado naturalmente a partir de uma conversa geral, `threadOverride` conserva a thread e o `conversation_id` originais.

`+ Nova conversa` cria imediatamente uma chave exclusiva e um novo `conversation_id`; não apaga nem reutiliza a conversa canônica anterior. Selecionar “Sem produtor” também cria uma conversa geral exclusiva, impedindo que o backend restaure o produtor de uma sessão geral anterior. O histórico visual é limitado a 12 threads e 20 turnos por thread no `sessionStorage` escopado pelo login. Logout e expiração da sessão removem as chaves do Copilot.

### 5.2 Estado no backend

O contrato `val.conversation_state.v1` contempla:

- `current_client`, `current_property`, `current_field`, `current_crop` e `current_season`;
- `current_opportunity`, `current_visit`, `current_objective`, `current_topic` e `current_decision_thesis`;
- `recent_entities`, `recent_tool_results` e `recent_questions`;
- `session_facts`, `session_hypotheses` e `conversation_turns`;
- `input_modality`, `response_mode`, `conversation_mode` e `active_object`.

O store é process-local, limitado a 500 entradas por padrão e expira após duas horas de inatividade. Reinício da aplicação elimina esse estado. O cache de contexto confirmado tem TTL padrão de 30 segundos e também inclui `conversationId` na chave; ele não é memória de negócio.

Os limites do estado são 20 turnos, 16 entidades, 12 resultados de ferramenta, 12 perguntas, 16 fatos de sessão e 12 hipóteses de sessão. O estado retornado ao cliente mantém os marcadores de não persistência.

## 6. Referências naturais, desambiguação e troca de produtor

Há duas camadas distintas:

1. Referências ao produtor, como nomes em expressões de visita ou troca e pronomes do produtor atual, passam por resolução determinística contra a carteira autorizada.
2. Referências como “ele”, “essa área”, “esse talhão”, “essa análise”, “o filho dele” e continuações curtas recebem o resumo do `ConversationState` como contexto temporário para o raciocínio existente.

Para produtor, os resultados possíveis são:

| Resultado | Comportamento |
|---|---|
| Nenhuma referência | Mantém o produtor já escopado, se houver. |
| Uma correspondência autorizada | Usa a referência e devolve `conversationResolution`. |
| Mais de uma correspondência | Responde `409 val_client_reference_ambiguous` com opções somente da carteira autorizada. |
| Nenhuma correspondência em padrão explícito | Responde `422 val_client_reference_not_found`. |
| Nenhuma correspondência no candidato “Como está X?” | Trata como ausência de referência e segue ao roteamento normal. |
| Troca silenciosa pelo browser | Responde `409 val_conversation_client_mismatch`. |

Uma troca explicitamente resolvida limpa integralmente o `ConversationState` subordinado do produtor anterior, inclusive `conversation_turns`, propriedade, talhão, cultura, safra, oportunidade, visita, objetivo, tese, perguntas, fatos, hipóteses, resultados de ferramenta e objeto ativo. A UI também remove o objeto ativo. Mensagens já renderizadas podem continuar visíveis no histórico local da thread para auditabilidade da interação, mas não são reaproveitadas como estado ativo do novo produtor.

O padrão curto “Como está X?” é tratado como candidato de nome, não como prova de que X é produtor: somente uma correspondência na carteira autorizada resolve ou desambigua; “Como está o mercado/a soja/essa análise?” sem evidência de nome segue para o roteamento normal. Padrões inequívocos com “cliente/produtor” continuam retornando `NOT_FOUND` quando o nome não existe. O resolver v1 não promete reconhecer um nome em qualquer construção linguística.

Uma ambiguidade com opções no modo de voz mantém o turno em processamento seguro, exibe somente os produtores autorizados e reutiliza `input_modality`, `response_mode` e `conversation_mode` no retry escolhido. Ela não transforma o FSM em erro/fallback. A escolha ainda requer toque na opção; seleção inteiramente falada não foi validada como capacidade desta versão.

## 7. Follow-ups e linguagem natural

Os seguintes comandos têm implementação explícita:

| Intenção conversacional | Execução |
|---|---|
| `Resume` / `Resuma` | Resume localmente a última leitura e o próximo passo, sem nova chamada à engine. |
| `Repete` / `Repita` | Reutiliza o último payload na mesma thread. |
| `Só as Perguntas de Ouro` / `Só me manda as Perguntas de Ouro` | Renderiza localmente até três perguntas e suprime fala automática. |
| `Agora por escrito` | Altera a preferência de saída para texto. |
| `Agora fala comigo` / `Agora fala elas pra mim` | Altera a saída para áudio; quando disponível, reutiliza o bloco anterior de Perguntas de Ouro. |
| `Texto e áudio` | Altera a saída para ambos. |
| `Só o essencial` | Aplica densidade simples. |
| `Aprofunda`, `Explica melhor`, `Me mostra os números`, `Por que` | Envia um follow-up contextual explícito à engine existente. |
| `Não registra` | Mantém a informação somente na sessão. |
| `Registra que …` / `Anota que …` | Abre revisão de registro com o conteúdo candidato; não confirma sozinho. |

Somente os comandos marcados como locais evitam a engine. Em especial, `Por que` e aprofundamentos ainda fazem uma nova solicitação; este contrato não afirma que todo follow-up é FAST.

O AI Reasoning reduz `voice_output.speakable_text` a no máximo 700 caracteres quando `conversation_mode` está ativo ou quando a saída é áudio/ambos, marcando a entrega como `CONVERSATIONAL_BRIEF`. Texto e voz continuam derivados dos mesmos fatos e políticas.

A avaliação `CONVERSATIONAL_NATURALNESS` pontua de 0 a 4: continuidade, retenção de contexto, clareza, tom, brevidade, qualidade do follow-up, linguagem não robótica, tratamento de interrupção e qualidade das perguntas. Falhas de safety, cross-tenant, ambiguidade silenciosa, contexto obsoleto ou persistência sem confirmação são falhas duras. Essa avaliação é heurística; ela não substitui o UAT humano “parece uma pessoa?”.

## 8. Perguntas materiais

O Copilot reutiliza `DecisionInterview` e o modelo de lacunas já existente. Quando o raciocínio classifica uma lacuna como material, a UI apresenta a pergunta e o próximo turno é enviado com objetivo, intenção e respostas recentes da sessão. A resposta recalcula a leitura, mas permanece session-only até uma revisão explícita.

O v1 não introduz uma segunda máquina `SHOULD_ASK`/`SHOULD_ANSWER`; o critério continua no Decision Interview e no AI Reasoning existentes. Portanto, a qualidade e a necessidade das perguntas devem ser verificadas nos cenários golden e no UAT humano, não inferidas somente da presença do componente.

## 9. Registro com confirmação

Conversar e registrar são operações separadas:

1. `Registra que …` produz um candidato local com `CONFIRM_REQUIRED`.
2. A UI suspende o modo contínuo, abre REGISTER e lança o modal de revisão com o texto pré-preenchido; o rascunho fica vinculado ao produtor e à thread de origem.
3. O `VoiceCapture` existente separa e apresenta alterações para revisão.
4. Somente `onConfirmed`, após a confirmação explícita no modal, conclui o registro e solicita a atualização da carteira. Um “sim” capturado pelo chat contínuo não é aceito como confirmação implícita.
5. Uma pergunta normal, uma transcrição, um attachment ou uma resposta à Decision Interview nunca promovem memória por si sós.

O endpoint ASK também bloqueia intenções `REGISTER_INFORMATION` e `POST_VISIT` em vez de tentar persistir. Correções de fatos já persistidos continuam pertencendo ao fluxo auditável de registro existente; não há neste v1 um novo contrato autônomo de correção conversacional.

## 10. Safety, tenancy e privacidade

- Store de sessão: tenant + owner + `conversation_id`.
- Cache de contexto: tenant + owner + produtor + `conversation_id`.
- Resolução de nomes: somente clientes ativos da carteira autorizada.
- Attachment no chat: tenant + owner + produtor + ID. Conteúdo/PATCH do browser: tenant + owner + `clientId` reconciliado, ou `association=UNLINKED`; cards antigos de outro produtor são bloqueados na UI e revalidados no servidor.
- Troca de produtor: exige resolução autorizada e elimina o contexto subordinado anterior.
- Browser: histórico temporário é escopado pelo login e removido no logout/expiração.
- Voz: `persistence: NONE`; o modo contínuo exige opt-in, nunca usa reconhecimento `continuous=true` e mostra o estado do microfone.
- Persistência de recomendações: o overlay e as mensagens enriquecidas de `conversionIntelligence`, `conversationOrchestration` e `conversationThread` são removidos ou reduzidos a metadados sem conteúdo antes da escrita.
- Conteúdo falado não recebe exceção de grounding, confidence, technical safety ou confirmação de memória.

## 11. Limites explícitos do v1

- Não há streaming de texto nem TTS progressivo; o TTS começa após uma resposta útil completa chegar à UI.
- O modo contínuo usa Web Speech do navegador e Speech Synthesis. Compatibilidade e qualidade variam por dispositivo/browser; não foi criado provider pago.
- A abstração atual permite injetar o input provider no hook, mas não constitui uma matriz completa de providers independentes para transcrição, turn detection, reasoning e speech output.
- Nem todas as frases exemplificadas no briefing possuem comando local dedicado. Formas como “me dá um exemplo”, “mais devagar” e “esquece isso por enquanto” dependem do fluxo geral e não são critérios de comando determinístico deste contrato.
- Estado process-local não sobrevive a restart e não deve ser tratado como histórico de negócio.
- Testes automatizados cobrem contratos, FSM e integração estrutural; eles não provam microfone, TTS, interrupção ou naturalidade percebida em aparelho físico.

## 12. Critérios de verificação

| Critério | Evidência automatizável | Evidência ainda humana/ambiental |
|---|---|---|
| Mesma thread entre texto, voz e objeto ativo | `test/val-full-screen-copilot.test.js` e `test/val-natural-conversation-integration-v1.test.js` | Continuidade percebida em conversa real. |
| Estado temporário e troca segura de produtor | `test/val-conversation-state-v1.test.js` | Coerência semântica em sequência longa. |
| Resolução e desambiguação autorizadas | `test/val-conversational-client-resolution-v1.test.js` | Variações reais de fala e nomes da carteira. |
| Comandos naturais e registro com confirmação | `test/val-natural-conversation.test.js` | Revisão/confirmação ponta a ponta no staging. |
| FSM de voz, opt-in, barge-in e fallback | `test/val-realtime-conversation-v1.test.js` | Microfone, TTS e interrupção em iPhone/Android reais. |
| Isolamento do histórico temporário | `test/copilot-session-storage.test.js` e `test/val-session-cache-v1.test.js` | Expiração e novo login no staging. |
| Naturalidade heurística e falhas duras | `test/val-conversational-naturalness-v1.test.js` | UAT humano com classificação `NATURAL` ou superior. |
| Reuso da engine canônica | `test/val-natural-conversation-integration-v1.test.js` | Golden conversacional ponta a ponta. |

O gate final deve usar os resultados executados desses testes, os golden sets, o benchmark e o UAT físico; este contrato, isoladamente, não autoriza uma classificação PASS.
