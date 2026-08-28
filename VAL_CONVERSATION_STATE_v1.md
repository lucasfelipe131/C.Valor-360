# VAL Conversation State v1

## Objetivo

`VAL Conversation State v1` define o estado efêmero que permite à VAL continuar uma conversa natural sem transformar o diálogo em memória confirmada. O contrato mantém o produtor e os objetos correntes, a janela recente da conversa, fatos e hipóteses da sessão, preferências de modalidade e resultados recentes de ferramentas.

Este estado não cria um segundo motor de conversa. Ele é encaminhado ao `ValCore` e à engine já existente como contexto temporário da mesma solicitação.

## Fontes normativas

- contrato JSON: `contracts/v1/conversation-state.schema.json`;
- normalização e transições: `server/decision-copilot/conversation-state.js`;
- armazenamento efêmero: `server/decision-copilot/conversation-session-store.js`;
- resolução de produtor: `server/decision-copilot/client-reference-resolver.js`;
- integração HTTP: `server.js`;
- preparação do contexto: `server/conversation-thread-context.js` e `server/conversion-bootstrap.js`.

## Identidade do contrato

| Item | Valor |
|---|---|
| `contract_version` | `val.conversation_state.v1` |
| `persistence_mode` | sempre `NONE` |
| `persistent_memory_unchanged` | sempre `true` |
| store | `val.conversation_session_store.v1` |
| chave do store | `tenantId + ownerId + conversationId` |
| TTL padrão | 2 horas, renovado em leitura ou escrita |
| capacidade padrão | 500 conversas em memória por processo |

No tráfego HTTP, `conversationId` ausente é substituído por UUID. Um `conversationId` fornecido precisa ter entre 1 e 180 caracteres e obedecer ao conjunto seguro de caracteres aceito pelo servidor.

## Campos do estado

O normalizador produz a estrutura abaixo. O JSON Schema mantém como obrigatórios os campos que determinam identidade, política de persistência, coleções e modalidades; referências correntes e timestamps são propriedades adicionais previstas pelo contrato.

| Campo | Tipo | Semântica |
|---|---|---|
| `contract_version` | string constante | versão `val.conversation_state.v1` |
| `conversation_id` | string | identidade estável da conversa |
| `persistence_mode` | string constante | `NONE`; a conversa não autoriza escrita de memória |
| `persistent_memory_unchanged` | boolean constante | `true`; o estado não altera memória confirmada |
| `current_client` | `EntityRef \| null` | produtor autorizado corrente |
| `current_property` | `EntityRef \| null` | propriedade corrente |
| `current_field` | `EntityRef \| null` | talhão corrente |
| `current_crop` | string ou null | cultura mencionada na sessão |
| `current_season` | string ou null | safra no formato reconhecido, por exemplo `2026/27` |
| `current_opportunity` | `EntityRef \| null` | oportunidade corrente |
| `current_visit` | `EntityRef \| null` | visita corrente; `visit_draft` é normalizado como `visit` |
| `current_objective` | string ou null | objetivo temporário da conversa |
| `current_topic` | string ou null | assunto reconhecido na sessão |
| `current_decision_thesis` | objeto ou null | tese, incerteza e próxima ação da leitura corrente |
| `recent_entities` | `EntityRef[]` | entidades recentes, deduplicadas |
| `recent_tool_results` | `ToolResultRef[]` | referências e resumos de resultados recentes |
| `recent_questions` | string[] | perguntas recentes, deduplicadas sem sensibilidade a acento/caixa |
| `session_facts` | `SessionKnowledge[]` | cópias de fatos usados no turno, retidas somente nesta sessão; o estado não as promove a memória |
| `session_hypotheses` | `SessionKnowledge[]` | hipóteses desta sessão |
| `conversation_turns` | `ConversationTurn[]` | janela dos turnos recentes |
| `input_modality` | enum | `text`, `voice`, `photo` ou `file` |
| `response_mode` | enum | `text`, `audio` ou `both` |
| `conversation_mode` | boolean | indica modo de conversa contínua solicitado |
| `active_object` | `EntityRef \| null` | objeto ativo usado internamente para derivar propriedade, talhão, oportunidade ou visita |
| `created_at` | date-time | criação do estado normalizado |
| `updated_at` | date-time | última transição normalizada |

### Referências auxiliares

`EntityRef` contém:

| Campo | Tipo | Regra |
|---|---|---|
| `type` | string | tipo normalizado da entidade |
| `id` | string ou null | identificador sanitizado |
| `label` | string ou null | rótulo de exibição sanitizado |

`SessionKnowledge` contém:

| Campo | Fato | Hipótese |
|---|---|---|
| `epistemic_status` | `SESSION_FACT` | `SESSION_HYPOTHESIS` |
| `persistence` | `SESSION_ONLY` | `SESSION_ONLY` |
| `statement` | texto sanitizado | texto sanitizado |
| `source_ref` | referência ou null | referência ou null |

`ConversationTurn` contém `role`, `text`, `modality`, `intent` e `created_at`. Papéis aceitos são `user`, `assistant` e `system`; modalidades de turno aceitas são `text`, `voice`, `photo`, `file` e `tool`.

`ToolResultRef` contém `capability`, `status`, `source_ref` e `summary`. A coleção guarda apenas a referência resumida necessária à continuidade; ela não substitui a validação ou a autorização da ferramenta original.

## Limites da janela

| Coleção | Limite |
|---|---:|
| `conversation_turns` | 20 |
| `recent_entities` | 16 |
| `recent_tool_results` | 12 |
| `recent_questions` | 12 |
| `session_facts` | 16 |
| `session_hypotheses` | 12 |

Turnos preservam os itens mais recentes. As demais coleções são deduplicadas e priorizam os itens recém-observados.

## Ciclo de vida

### 1. Criação e normalização

`createConversationState` cria o estado a partir do escopo já autenticado. `normalizeConversationState` sanitiza strings, limita coleções, normaliza datas e impede que um `current_client.id` contradiga o `clientId` solicitado.

O estado não é aceito como fonte de autorização. Tenant, owner, produtor e objetos continuam sendo reconciliados pelo backend e pelos repositórios.

### 2. Avanço de turno

`advanceConversationState` pode atualizar:

- produtor e objeto ativos já reconciliados;
- cultura, safra e tópico reconhecidos no texto;
- objetivo e tese de decisão da resposta;
- entidades, ferramentas e perguntas recentes;
- fatos e hipóteses com marcação `SESSION_ONLY`;
- turno do usuário e leitura do assistente;
- modalidades e modo conversacional.

A projeção `conversationStateContext` é anexada à resposta e encaminhada ao motor existente. Referências curtas, como “isso”, “ele” ou “e agora”, podem receber uma síntese do estado corrente. Essa síntese é rotulada explicitamente como “contexto temporário desta conversa (não é memória confirmada)”.

### 3. Troca explícita de produtor

Uma troca só ocorre após resolução contra a carteira autorizada. Quando o produtor muda, o estado:

- limpa integralmente `conversation_turns`; nenhum texto do produtor anterior acompanha o novo;
- redefine as referências recentes para conter somente o novo produtor;
- limpa propriedade, talhão, cultura, safra, oportunidade, visita e objeto ativo;
- limpa objetivo, tópico e tese de decisão;
- limpa resultados de ferramentas e perguntas recentes;
- limpa fatos e hipóteses da sessão.

O servidor também descarta o `activeContext` recebido para que um objeto do produtor anterior não acompanhe a nova seleção.

### 4. Expiração e encerramento

O store é local ao processo e não grava o estado em PostgreSQL. Além disso, `recommendationPersistencePayload` é a barreira de persistência das recomendações antes de qualquer escrita PostgreSQL ou fallback. Ela:

- remove `conversationState`, `conversation_turns`, `session_facts` e `session_hypotheses`;
- reduz `session_context` a ID da conversa e flags de não persistência;
- reduz `conversationThread` a `continued` e, quando existe, `anchor.id`;
- remove a mensagem enriquecida de `conversionIntelligence.request`, preservando apenas `intent` e `technicalIntent`;
- reduz `conversationOrchestration` a versão, horário, produtor, rota, autoridade e continuidade sem conteúdo (`carryForward`, `turnCount` e fingerprint).

Assim, `message`, `originalMessage`, `anchor.context`, o plano técnico derivado e os textos da continuidade não atravessam a fronteira como cópias do overlay efêmero. A pergunta canônica do turno continua submetida ao contrato preexistente da recomendação; isso não promove seu conteúdo a memória confirmada.

O TTL padrão é de 2 horas e é deslizante: uma leitura válida ou uma escrita renova a expiração. O construtor limita configurações de TTL ao intervalo de 1 minuto a 24 horas.

Entradas expiradas são removidas quando o store é acessado ou suas estatísticas são lidas. Reinício do processo perde todas as sessões. Logout invalida as conversas do mesmo tenant e owner. A capacidade padrão é 500 entradas; o construtor aceita de 10 a 5.000 e remove entradas antigas quando o limite é excedido.

## Isolamento

| Fronteira | Controle implementado |
|---|---|
| sessão | chave composta por `tenantId`, `ownerId` e `conversationId` |
| produtor corrente | ID armazenado comparado ao `clientId` solicitado; divergência falha fechada |
| carteira | nomes e IDs são resolvidos somente entre clientes autorizados para tenant e owner |
| PostgreSQL | consulta leve filtra `tenant_id`, `consultant_id` e `status='active'` |
| fallback local | importações são filtradas por tenant e owner; registros sem escopo não entram |
| contexto recuperado | cache usa tenant, owner, cliente e conversa |
| histórico de recomendações | somente itens com o mesmo `conversation_id`; sem ID, a visão é stateless e recebe zero turnos |
| observabilidade do store | `stats()` é `content_free` e não inclui texto ou nomes |

A chave do store não inclui o cliente de propósito: uma mesma conversa pode trocar de produtor somente pelo fluxo explícito. O ID do cliente permanece dentro da entrada e é verificado em toda leitura/escrita escopada.

## Memória `NONE`

Conversa não equivale a memória confirmada.

- `persistence_mode` permanece `NONE` em todo estado normalizado;
- `persistent_memory_unchanged` permanece `true`;
- fatos e hipóteses derivados no turno usam `persistence: SESSION_ONLY`;
- o estado efêmero não escreve em `val_memories` nem promove inferência a fato confirmado;
- a barreira de recomendação impede que o overlay ou cópias de seus turnos/fatos sejam gravados em `input_context` ou `generated_content`;
- uma intenção cujo router demande persistência é recusada no endpoint de ASK com `val_confirmation_required`;
- registro de informação continua no fluxo existente de revisão e confirmação.

Recomendações e eventos de uso continuam seguindo seus contratos existentes, mas recebem somente a visão sanitizada; o conteúdo do overlay efêmero não integra esses registros.

## Resolução e desambiguação de produtor

O contrato `val.client_reference_resolution.v1` reconhece referências explícitas em frases naturais e referências ao produtor corrente.

### Normalização e busca

- remove diferenças de acento, caixa e pontuação para comparação;
- tenta, nessa ordem, ID autorizado, nome exato, prefixo de nome e token único de nome;
- preserva homônimos por ID, sem deduplicar pessoas apenas pelo nome;
- trata pronome como referência ao cliente corrente somente se esse ID ainda existir na carteira autorizada.

### Cardinalidade

| Correspondências autorizadas | Estado | Comportamento HTTP |
|---:|---|---|
| 0 em padrão explícito | `NOT_FOUND` | `422 val_client_reference_not_found`; solicita confirmação do nome |
| 0 em “Como está X?” candidato | `NONE` | segue ao roteamento normal; evita tratar mercado, clima, soja ou análise como produtor |
| 1 | `RESOLVED` | usa o ID autorizado; informa se houve troca do cliente corrente |
| N | `AMBIGUOUS` | `409 val_client_reference_ambiguous`; retorna pergunta e opções autorizadas |

Na resposta ambígua, cada opção expõe somente `id`, `name` e `municipality` já reconciliados. Uma seleção subsequente só resolve a ambiguidade se o `clientId` escolhido estiver entre as opções autorizadas retornadas pelo próprio resolver. Um `clientId` diferente do produtor já vinculado, sem resolução explícita, recebe `409 val_conversation_client_mismatch`.

## Falhas fechadas relevantes

| Código | Condição |
|---|---|
| `conversation_scope_required` | tenant, owner ou conversa ausente ao construir a chave |
| `conversation_state_client_mismatch` | estado declara cliente diferente do escopo de normalização |
| `conversation_client_scope_mismatch` | leitura/escrita tenta reutilizar conversa com outro cliente |
| `conversation_client_required` | troca solicitada sem referência autorizada com ID |
| `val_client_reference_ambiguous` | mais de um produtor autorizado corresponde à referência |
| `val_client_reference_not_found` | nenhum produtor autorizado corresponde à referência |
| `val_conversation_client_mismatch` | tentativa de troca silenciosa por payload |

## Especificações automatizadas existentes

Os seguintes arquivos codificam as expectativas deste documento:

- `test/val-conversation-state-v1.test.js`: estado `NONE`, referências naturais, TTL, isolamento e troca explícita;
- `test/val-conversational-client-resolution-v1.test.js`: normalização, cardinalidades 0/1/N, homônimos, pronomes, tenant/owner e consulta PostgreSQL;
- `test/val-natural-conversation-integration-v1.test.js`: injeção de contexto efêmero e encaminhamento pelo `ValCore` sem executor paralelo;
- `test/val-session-cache-v1.test.js`: separação do cache por conversa e invalidação específica.

Esta lista descreve a cobertura codificada. O resultado de uma execução de regressão deve ser registrado separadamente no relatório do gate.
