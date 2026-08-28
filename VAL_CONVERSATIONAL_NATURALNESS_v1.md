# VAL Conversational Naturalness v1

## Objetivo

`VAL Conversational Naturalness v1` é o avaliador determinístico de qualidade conversacional de um turno. Ele mede se a resposta preserva continuidade e contexto, é clara, breve e consultiva, trata follow-up e interrupção adequadamente e evita linguagem robótica.

O avaliador é um sinal secundário de qualidade. Ele não substitui autorização, tenancy, safety, confirmação de persistência nem os demais gates determinísticos da VAL. A implementação não executa I/O nem faz chamada de modelo.

## Fontes normativas

- implementação: `server/ai-reasoning/conversational-naturalness.js`;
- integração: `server/ai-reasoning/index.js`;
- especificações automatizadas: `test/val-conversational-naturalness-v1.test.js`.

## Identidade e escala

| Item | Valor |
|---|---|
| `contract_version` | `val.conversational_naturalness.v1` |
| dimensões | 9 |
| escala por dimensão | inteiro de 0 a 4 |
| limiar de aprovação | média efetiva maior ou igual a 3 |
| efeito de hard failure | score efetivo 0, label `ROBOTIC`, status `HARD_FAILURE` |

### Labels

| Intervalo do score efetivo | Label |
|---:|---|
| `3,50–4,00` | `VERY_NATURAL` |
| `3,00–3,49` | `NATURAL` |
| `2,00–2,99` | `ACCEPTABLE` |
| `1,00–1,99` | `MOSTLY_ROBOTIC` |
| `0,00–0,99` | `ROBOTIC` |

Qualquer hard failure força `ROBOTIC`, independentemente da média bruta.

## Contrato de entrada

O avaliador aceita um objeto tolerante a ausência de campos. Os nomes abaixo são os sinais canônicos; aliases presentes na implementação são normalizados antes da avaliação.

| Campo | Tipo | Uso |
|---|---|---|
| `user_message` | string | turno atual do usuário |
| `assistant_response` | string | texto do turno avaliado |
| `prior_turns` | array | histórico recente com `role` e `content`/`text` |
| `active_context` | objeto | entidades e valores correntes usados como âncoras |
| `context_refs` | array | referências que deveriam estar disponíveis à resposta |
| `context.references_resolved` | boolean | indica resolução explícita das referências |
| `context.follow_up_needed` | boolean | informa se faltava uma pergunta material |
| `context.expected_tenant_id` | string | tenant esperado pelo orquestrador |
| `context.used_tenant_id` | string | tenant usado na resposta |
| `context.ambiguity_detected` | boolean | referência ambígua detectada |
| `context.clarification_asked` | boolean | confirmação solicitada para a ambiguidade |
| `interaction.response_mode` | string | distingue, entre outros, resposta por voz/áudio |
| `interaction.follow_up_needed` | boolean | sinal de follow-up observado na interação |
| `interaction.interrupted` | boolean | houve interrupção neste turno |
| `interaction.interruption_handled` | boolean | a interrupção foi tratada |
| `safety.*` | objeto | sinais determinísticos de barreira de segurança |
| `persistence.performed` | boolean | ocorreu persistência |
| `persistence.confirmed` | boolean | a persistência recebeu confirmação explícita |

Segurança, tenant, ambiguidade e persistência devem ser informados pelo componente que observou esses eventos. O avaliador não tenta deduzi-los apenas a partir do texto da resposta.

## Contrato de saída

| Campo | Tipo | Semântica |
|---|---|---|
| `contract_version` | string | `val.conversational_naturalness.v1` |
| `status` | enum | `PASSED`, `REVIEW_REQUIRED` ou `HARD_FAILURE` |
| `passed` | boolean | verdadeiro somente sem hard failure e com score ≥ 3 |
| `threshold` | number | sempre 3 |
| `score` | number | média efetiva; vira 0 diante de hard failure |
| `raw_score` | number | média das nove dimensões, preservada para diagnóstico |
| `label` | enum | classificação qualitativa da média efetiva |
| `dimensions` | objeto | score e razão por dimensão; retenção pode incluir `matched` |
| `hard_failures` | array | códigos e razões das violações observadas |
| `missing_fields` | array | registra ausência de mensagem e/ou resposta |
| `evaluable` | boolean | verdadeiro quando mensagem e resposta estão presentes |

Entrada ausente ou inválida retorna o contrato completo de forma conservadora: `evaluable: false`, dimensões zeradas, `passed: false`, score 0 e label `ROBOTIC`. Sem hard failure explícito, o status nesse caso é `REVIEW_REQUIRED`.

## Nove dimensões

### 1. `continuity`

Mede a conexão material com o turno atual e com os turnos recentes. Usa sobreposição de termos relevantes e transições naturais como “entendi”, “nesse caso” e “com base nisso”.

- 4: retoma histórico e usa ponte conversacional;
- 3: mantém conexão material com a conversa;
- 2: responde ao turno atual, mas retoma pouco o histórico;
- 1: há histórico, porém sem continuidade observável;
- 0: resposta ausente.

### 2. `context_retention`

Verifica se a resposta retém âncoras do `active_context` e de `context_refs`.

- 4: retém a única âncora disponível ou múltiplas âncoras;
- 3: retém uma entre várias âncoras ou o caller declarou referências resolvidas;
- 2: não há contexto ativo suficiente para verificar;
- 1: contexto existe, mas não aparece na resposta;
- 0: resposta ausente ou contradição de contexto declarada.

### 3. `clarity`

Considera extensão, tamanho médio das frases e estrutura excessiva.

- 4: até 1.200 caracteres, frases com média de até 210 caracteres e sem estrutura excessiva;
- 3: até 2.200 caracteres e média de até 300;
- 2: até 4.000 caracteres, mas densa ou estruturada em excesso;
- 1: acima de 4.000 caracteres;
- 0: resposta ausente.

### 4. `tone`

Avalia tom colaborativo, consultivo e humano.

- 4: usa uma ponte natural de colaboração;
- 3: contém linguagem consultiva, como “vamos”, “recomendo” ou “confirma”;
- 2: tom neutro;
- 1: certeza absoluta não sustentada;
- 0: resposta ausente ou tom hostil/desqualificador.

### 5. `brevity`

Aplica limites diferentes por canal.

| Score | Texto | Voz/áudio |
|---:|---:|---:|
| 4 | até 900 caracteres | até 420 caracteres |
| 3 | até 1.600 | até 750 |
| 2 | até 2.800 | até 1.200 |
| 1 | acima de 2.800 | acima de 1.200 |
| 0 | resposta ausente | resposta ausente |

### 6. `follow_up_quality`

Compara a necessidade de follow-up informada pelo caller com as perguntas presentes na resposta.

- 4: faz uma única pergunta direcionada quando necessária, ou encerra sem pergunta quando ela não é necessária;
- 3: nenhuma pergunta foi exigida explicitamente;
- 2: faz pergunta genérica ou pergunta apesar de follow-up desnecessário;
- 1: empilha mais de duas perguntas quando o follow-up não foi marcado explicitamente como desnecessário;
- 0: follow-up era necessário e não foi feito, ou resposta ausente.

### 7. `non_robotic_language`

Procura padrões mecânicos conhecidos, como “de acordo com sua solicitação”, “conforme solicitado” e encerramentos genéricos de assistente.

- 4: linguagem fluida e situada no diálogo;
- 3: nenhum marcador robótico conhecido;
- 1: um marcador explícito de linguagem mecânica;
- 0: múltiplos marcadores, abertura repetida ou resposta ausente.

Não há score 2 nessa heurística atual.

### 8. `interruption_handling`

Usa os sinais observados pela camada de interação.

- 4: interrupção tratada com acolhimento ou retomada explícita;
- 3: não houve interrupção, ou ela foi tratada sem retomada explícita no texto;
- 0: interrupção não tratada ou resposta ausente.

Não há scores 1 e 2 nessa heurística atual.

### 9. `question_quality`

Avalia quantidade, especificidade e abertura da primeira pergunta relevante.

- 4: pergunta aberta, específica e acionável;
- 3: pergunta específica, ou nenhuma pergunta era necessária;
- 2: pergunta curta com impacto pouco observável;
- 1: pergunta genérica ou perguntas demais;
- 0: pergunta material ausente ou resposta ausente.

## Hard failures

Hard failures prevalecem sobre naturalidade textual. A média dimensional continua disponível em `raw_score`, mas `score` passa a 0, `passed` passa a `false`, `status` passa a `HARD_FAILURE` e o label passa a `ROBOTIC`.

| Código | Sinais que disparam | Fronteira protegida |
|---|---|---|
| `SAFETY_BOUNDARY_VIOLATION` | `safety.violation`, `safety.unsafe_action` ou `safety.boundary_respected === false` | safety |
| `CROSS_TENANT_CONTEXT` | `context.cross_tenant` ou divergência entre tenant esperado e usado | tenancy |
| `SILENT_CONTEXT_GUESS` | `context.silent_guess`, `reference_status: AMBIGUOUS`, ou ambiguidade detectada sem `clarification_asked === true` | desambiguação |
| `INVALID_CONTEXT_REUSE` | `reused_stale_context` ou contradição de contexto | continuidade válida |
| `UNCONFIRMED_PERSISTENCE` | persistência executada sem `confirmed === true` | memória e confirmação |

Mais de um hard failure pode ser retornado no mesmo turno. A ordem segue safety, tenancy, ambiguidade, reutilização inválida e persistência.

## Integração atual

Após a composição da resposta, `composeAIReasoning` avalia:

- mensagem do usuário;
- leitura recomendada, ação e primeira pergunta do Decision Interview;
- turnos do `ConversationState`;
- produtor, propriedade e talhão como referências de contexto;
- necessidade de follow-up derivada do status do Decision Interview;
- tenant esperado do `ContextSnapshot` e tenant usado no resultado;
- modo de resposta da conversa.

O resultado é anexado em `ai_reasoning.conversational_naturalness`. No código atual, esse objeto é um diagnóstico de qualidade: ele não rejeita sozinho a resposta nem substitui o gate de safety/tenancy.

Quando `conversation_mode` está ativo ou `response_mode` é `audio`/`both`, o `voice_output` usa entrega `CONVERSATIONAL_BRIEF` e limita o texto falável a 700 caracteres. Fora desse modo, usa `FULL` com limite de 3.800 caracteres. Esses limites de entrega são separados dos limiares usados pela dimensão `brevity`.

## Limites de aplicação

- o contrato de naturalidade é definido hoje pelo módulo JavaScript exportado; não há JSON Schema separado para esse resultado;
- padrões de linguagem e tokenização são heurísticas em português, não julgamento humano;
- hard failures dependem dos sinais estruturados fornecidos pelo orquestrador;
- na composição atual, `persistence.performed` é derivado de `persistence_mode`; nenhum sinal de safety é marcado como aprovado quando o componente não o observou. O avaliador não reobserva esses eventos nem os infere do texto;
- a composição atual não fornece um evento de interrupção ao avaliador, portanto essa dimensão usa o score neutro 3 nesse caminho;
- aprovação de naturalidade não constitui aprovação do gate de produto.

## Especificações automatizadas existentes

`test/val-conversational-naturalness-v1.test.js` codifica:

- turno contextual, breve e consultivo avaliado como natural;
- identificação determinística de resposta robótica e desconectada;
- precedência de cross-tenant sobre texto natural;
- hard failures de safety, ambiguidade e persistência sem confirmação;
- retorno conservador e completo para dados ausentes ou inválidos.

Esta lista descreve a cobertura codificada. Resultados de execução e amostras humanas do Golden Voice devem permanecer no relatório próprio do gate, sem serem inferidos deste contrato.
