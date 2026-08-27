# VAL FitoScan Integration v1

## Nomenclatura obrigatória

O nome canônico encontrado no código é **FitoScan**.

- UI, cards, telemetria e registros: `FitoScan`.
- API/metodologia: modo `disease`.
- `FitScan`: somente alias de entrada para erros de digitação ou comandos legados; deve ser normalizado para `FitoScan` antes da execução.
- Não existe um segundo produto chamado FitScan.

Fontes: `manual/README.md`, `manual/app/PhotoDiagnosis.tsx` e `manual/app/api/diagnosis/route.ts`.

## Objetivo

Integrar o FitoScan existente à VAL e ao Copilot, sem duplicar o motor fitopatológico e sem transformar triagem visual em diagnóstico, prescrição ou recomendação autônoma.

## Implementação atual confirmada

### Entrada

- uma a três imagens JPEG, PNG ou WebP;
- câmera ou upload;
- limite da interface de 15 MB por arquivo;
- resize para lado máximo de 1.600 px, JPEG 0,84;
- limite da API de 5 MB por imagem base64 e 20 MB por request;
- cultura, estádio, órgão afetado, posição na planta, distribuição e observações.

### Metodologia implementada

O modo `disease`:

1. descreve forma, tamanho, cor, borda, halo, centro, textura, sinais e possível esporulação;
2. confronta compatibilidade hospedeiro–doença e estádio;
3. avalia dossel, distribuição e condições predisponentes informadas;
4. compara doença com fitotoxicidade, deficiência, praga e estresse abiótico;
5. retorna exatamente três doenças ou danos plausíveis.

O nome científico do agente só deve ser preenchido quando tecnicamente defensável.

### Saída

- resumo e qualidade da imagem;
- sinais visíveis;
- exatamente três hipóteses ranqueadas;
- confiança e severidade visual;
- evidências favoráveis e contrárias;
- passos de confirmação e urgência;
- confundidores, evidências ausentes e próximos passos;
- nota de safety.

## Safety atual

- O resultado é triagem por imagem, não confirmação.
- Compatibilidade não é apresentada como causalidade.
- A API não recomenda marca, produto, ingrediente ativo ou dose.
- Imagem inadequada precisa gerar limitação e instrução de nova coleta.
- Confirmação pode exigir vistoria, chave diagnóstica ou laboratório.
- A chamada é autenticada, rate-limited, usa JSON schema estrito, `store: false` e timeout de 90 segundos.

Essas regras permanecem superiores à instrução do usuário e ao reasoning do modelo.

## Integração atual com a VAL

### Implementado na branch

- A Inteligência Agronômica abre a área `diagnostico` do Manual.
- O router reconhece `IMAGE_DIAGNOSIS` e `FITOSCAN`; o executor produz descritor governado para a ferramenta.
- Composer e galeria VAL aceitam imagens.
- `val_attachments` mantém imagem, hash, tenant, consultor, produtor, status e `analysis`.
- A VAL recusa transformar observação visual não confirmada em diagnóstico.
- O protocolo `valor360:navigate` v1 normaliza `FitoScan`, `FitScan`, doença/doenças para `tool=diagnosis`, `diagnosisMode=disease` e `page=diagnostico`.
- O receiver exige same-origin e `event.source === window.parent`, resolve cliente/talhão/análise no workspace e retorna ack.
- `PhotoDiagnosis` oferece salvamento explícito do resultado no tipo `photo_diagnosis`.

### Persistência metadata-only implementada

Depois do resultado, somente o clique em `Salvar resultado revisado no histórico` cria o registro. A execução da triagem por si só não persiste.

O registro inclui:

- `schemaVersion = manual-photo-diagnosis-v1`;
- nome canônico `FitoScan` e `methodology=disease`;
- contexto resolvido de cliente, propriedade, talhão e análise;
- contexto agronômico;
- nome, MIME, tamanho e SHA-256 de cada evidência, sem o binário;
- resultado estruturado;
- provenance, datas, `navigationRequestId` e confirmação `USER_EXPLICIT`;
- safety `ASSISTED_TRIAGE_NOT_PRESCRIPTION`, review humano requerido e storage `METADATA_ONLY`.

`manual/app/lib/photo-diagnosis-record.ts` sanitiza todas as rotas locais/import/export. `manual/app/api/records/route.ts` rejeita imagem inline/binário com erro 400 e sanitiza novamente antes de `app_records`. O sanitizer Manual → VAL continua removendo imagem/foto/base64/data URL.

### Gaps factuais mantidos

- A foto/base64 do FitoScan não é persistida no registro.
- Salvar `photo_diagnosis` não insere a imagem em `val_attachments`.
- Não há attachment ref nem vínculo imagem → propriedade/talhão.
- `val_attachments` é vinculado ao produtor, não diretamente a propriedade/talhão.
- Histórico metadata-only do Manual e banco de imagens VAL continuam separados.

## Contrato de integração

Alias, roteamento/deep-link e persistência metadata-only estão implementados e validados em código. A integração ao banco de imagens não está concluída.

### Normalização de intenção

| Entrada | Metodologia normalizada |
|---|---|
| `FitoScan` | `disease` |
| `FitScan` | `disease`, alias normalizado para `FitoScan` |
| “analisar doença nessa foto” | `disease` |
| “analisar deficiência ou doença” | Ambígua; perguntar antes de executar |

O alias não cria nova rota, schema ou tipo de registro.

### Tool path

1. Router reconhece `FITOSCAN`/`IMAGE_DIAGNOSIS` e metodologia `disease`.
2. Orchestrator envia contexto e `requestId`; o Manual revalida contra o workspace.
3. O parent só considera o deep-link aplicado depois do ack `valor360:navigation-result`.
4. Adapter chama o motor existente com o contexto permitido.
5. O resultado volta como dado de ferramenta.
6. Reasoning organiza leitura e lacunas sem alterar o diagnóstico bruto.
7. Persistência depende do clique humano explícito.

### Contexto

Podem ser herdados, quando confirmados e autorizados:

- produtor, propriedade e talhão;
- cultura, safra e estádio;
- órgão e distribuição informados;
- clima relevante, com data/fonte;
- observações e diagnósticos anteriores revisados.

Contexto herdado deve ser visível e corrigível. Cliente, talhão ou análise inexistente no workspace gera issue e ack `PARTIAL`/`CONTEXT_REJECTED`; dado de outra conta ou tenant não é aplicado.

### Persistência segura

- Sem produtor: o usuário pode salvar explicitamente um registro metadata-only sem vínculo; não há promoção de memória.
- Com produtor: contexto resolvido acompanha o registro, mas a imagem não entra automaticamente em `val_attachments`.
- Property/field: somente contexto validado no workspace é guardado.
- Resultado: output, metodologia, versão, contexto, safety, hashes e review requerido são persistidos.
- Base64/binário: proibidos no registro; a API rejeita em vez de aceitar silenciosamente.
- O evento de integração carrega metadados permitidos e conserva o sanitizer.
- Hipótese não confirmada não entra em `CONFIRMED_MEMORY` como fato.

## Card FitoScan na conversa

O card deve usar o nome canônico e apresentar:

- `MINHA LEITURA`;
- `O QUE MAIS ME CHAMOU ATENÇÃO`;
- três hipóteses com evidências a favor/contra;
- `POR QUE ISSO IMPORTA`;
- `O QUE AINDA FALTA`;
- `PRÓXIMO PASSO`;
- aviso “triagem por imagem — requer validação técnica”;
- ações para evidências, drill-down, vínculo e review.

O card não deve exibir prescrição, dose ou produto.

## Provenance do registro

- nome `FitoScan` e `methodology=disease`;
- `schemaVersion = manual-photo-diagnosis-v1`;
- datas de análise e salvamento;
- `navigationRequestId` e confirmação `USER_EXPLICIT`;
- nome, MIME, tamanho e SHA-256 das imagens, sem binário;
- cultura, estádio, órgão, posição e distribuição usados;
- safety, review humano requerido e retenção metadata-only;
- tenant/workspace do registro e contexto efetivamente resolvido.

Attachment refs não existem nesse fluxo enquanto as imagens não forem integradas ao banco VAL.

## Testes obrigatórios

- `FitoScan` chama `mode=disease`.
- `FitScan` normaliza para `FitoScan` e chama o mesmo modo.
- Alias não cria registro/metodologia duplicada.
- Ambiguidade NutriScan/FitoScan gera pergunta curta.
- Uma a três imagens válidas funcionam; formato/tamanho inváido falha.
- Contexto autorizado é herdado e exibido.
- Sem clique explícito, nenhum registro é criado.
- Clique explícito persiste resultado/metadados/hash/contexto/provenance/safety.
- Sem produtor, salvamento explícito cria registro sem vínculo e sem memória confirmada.
- Payload binário/data URL recebe erro 400; cache/import/export permanecem sanitizados.
- Resultado contém exatamente três hipóteses.
- Nome científico vazio é aceito quando não defensável.
- Nenhum resultado prescreve produto, ingrediente ativo ou dose.
- Cross-client/cross-tenant falham fechados.
- Mensagem same-origin que não vem de `window.parent` é ignorada.
- Ack preserva `requestId` e informa aplicação parcial/rejeição sem falso sucesso.
- Timeout, rate limit e serviço indisponível não retornam falso sucesso.
- Mobile/câmera e desktop/upload funcionam.
- Histórico mostra apenas registros revisados do escopo correto.

## Validação executada

- `test/manual-photo-diagnosis.test.js` comprova que `FitoScan` é canônico, `FitScan` normaliza para `disease`, o clique é explícito e somente metadados/hash/contexto/provenance/safety são guardados.
- `test/manual-current-capabilities.test.js` valida o alias no protocolo v1, resolução do workspace, same-origin/parent e ack.
- Novos testes: 8/8 aprovados.
- Suíte relevante do Manual: 43/43 aprovada.
- `npm run build` do Manual: aprovado.

UAT físico de câmera/upload em dispositivo e ambiente publicado permanece pendente.

## Rollback

Desabilitar o deep-link contextual e manter o acesso ao FitoScan dentro do Manual embutido. Registros `photo_diagnosis` permanecem metadata-only e não criam attachments. Não excluir dados confirmados. Nenhuma migration destrutiva é autorizada.

## Gate

FitoScan, seu safety, o alias, a navegação contextual e o histórico metadata-only estão implementados/validados em código. `FitScan` permanece apenas alias de entrada. A integração das imagens com `val_attachments` continua gap declarado, e o UAT físico permanece pendente.
