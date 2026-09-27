# VAL K5 — pausa técnica, correção sem inferência paga

Base: `345ed8ec1a054dfa6f9ac31a3771693d4bbc415c`. Esta fase usa somente
código, logs e capturas existentes, mocks e fixtures locais. **0 chamadas pagas**.
Não executa AG-030, as 270 perguntas restantes ou as 12 chamadas remanescentes.
Perguntas, rubrica, resultados históricos e secrets permanecem intactos.

## Diagnóstico histórico

A matriz completa está em `VAL_K5_ZERO_COST_DIAGNOSIS_20260927.json`, com os 19
campos solicitados por caso, request IDs e hashes dos dois arquivos-fonte. O lote
capturou DOM e logs parciais, não o envelope JSON completo nem o texto descartado
do provedor. `NOT_RECORDED` significa ausência de evidência, não ausência de falha.
Não se substitui um dado histórico ausente por resultado de mock.

15 GENERIC_FALLBACK: AG-001/003/006/007/011/013/014/016/018/019/022/024/027/028/029.
Todos: HTTP 200, rota CONTEXT, ASK_GENERAL, engine rules, duas tentativas do provedor
com dois registros de usage/status completed, seguidas do mesmo fallback genérico.
O log `outcome=ok` mede entrega HTTP, não utilidade nem aprovação de grounding.

| Grupo comprovado | Casos | Conclusão |
|---|---|---|
| Retrieval NO_APPLICABLE_KNOWLEDGE + geração não entregue | 001,003,007,011,013,014,016,018,024,028,029 | 11; ausência de item não explica por si só a rejeição da geração |
| Retrieval SELECTED + geração não entregue | 006,019,022,027 | 4; seleção não comprova cobertura integral ou grounding aprovado |
| Razão interna de rejeição/saída inutilizável não registrada | Todos os 15 | Causa raiz histórica exata permanece desconhecida |

Investigação explícita A–J:

| Hipótese | Evidência e conclusão |
|---|---|
| A ROUTING_NO_COVERAGE | Não houve perda de rota: todos chegam a ASK_GENERAL/CONTEXT e ao provedor. Cobertura curada insuficiente é possível; não prova causa final. |
| B CONTEXT_REQUIRED / MISSING_CONTEXT | Nenhuma solicitação específica de contexto capturada. São perguntas gerais completas; não há evidência para reclassificar como clarification. |
| C RETRIEVAL_NO_DATA | Comprovado em 11. Nos outros 4 há SELECTED, não prova de uso. Não é suficiente para explicar fallback após geração. |
| D GROUNDING_BLOCKED | Não registrado historicamente. Reproduzido localmente em AG-029 com resposta sintética: “Isso é uma hipótese” era tratado como nome próprio. |
| E LANGUAGE_ENHANCER_REJECTED | Rota geral direta usa general-answer-provider, não language-enhancer. Nenhum evento de rejeição deste último nas capturas. Rejeição do general-answer validator é hipótese distinta. |
| F PROVIDER_ERROR | Nenhum erro de provedor demonstrado nos 15; ambos usos completed. Erro AG-025 pertence a outro caso e não é transferido para este grupo. |
| G AI_BUDGET_EXHAUSTED | Não demonstrado: houve duas tentativas em todos; contador do lote terminou em 48/60. Sem prova de esgotamento para estes casos. |
| H CAPABILITY_SOURCE_UNAVAILABLE | Nenhum evento comprova fonte indisponível; NO_APPLICABLE_KNOWLEDGE não equivale a outage da fonte. |
| I GENERIC DETERMINISTIC FALLBACK | Comprovado pelo texto renderizado e fluxo no SHA base; mecanismo final comum, não explicação da rejeição anterior. |
| J OUTRA CAUSA | Lacuna de telemetria comprovada: motivos existentes em responseMetadata não chegaram aos logs capturados. Texto rejeitado ausente impede replay histórico fiel. |

AG-030 = **APPLICATION_RATE_LIMIT**. Endpoint `/api/val/chat`, 429 rápido, sem
upstream. Quota padrão 30/600000 ms por identidade. Uma verificação anterior de
isolamento consumiu uma requisição da mesma janela: o executor antigo não a
contabilizou e submeteu AG-030 cerca de dois segundos antes da renovação. Falha de
orquestração assumida, não do provedor. O staging não possui variável de override
na configuração consultada; a aplicação agora anuncia a política efetiva.

## Correções limitadas e prova

- Grounding: demonstrativos isolados “Isso/Isto/Aquilo” não são nome próprio.
  “Isso Silva”, João e afirmação privada com pronome continuam bloqueados. Todas
  as demais verificações de escopo, proveniência, risco e grounding permanecem.
- Entrega: o provedor já aceita até 2200 caracteres, mas a montagem de resposta e
  evidência cortava em 1200. Agora ambas preservam o limite validado de 2200 apenas
  para AI_GENERAL_KNOWLEDGE. Não aumenta tokens, retries ou orçamento.
- Ausência de cobertura não cria `required_inputs=['topic']` artificialmente.
  Só a detecção específica de tópico ausente pode pedir esse input. O texto
  genérico continua GENERIC_FALLBACK, sem transformar resultado K5 em PASS.
- Novos diagnósticos por resposta e logs: classe, reason_code, rota, intenção,
  tool/run/grounding, coverage, capacidades, enhancement, indisponibilidade e
  razões de rejeição. Logs contêm enums/contagens, não conteúdo descartado ou IDs
  privados. Erro do provedor tem evento próprio; HTTP 429 da aplicação tem
  reason_code APPLICATION_RATE_LIMIT e Retry-After. Classes REQUEST_FAILURE e
  UNCLASSIFIED evitam registrar como sucesso contratos desconhecidos.
- Pacing: `scripts/k5/executor.mjs` exige política efetiva e identidade canônica
  A/B; rejeita admin. Fila serial, janela inicial completa, espaçamento uniforme,
  reserva antes do envio e pausa por 429. Sem retry automático. Autorização
  padrão zero. Contrato de integração/captura em `scripts/k5/README.md`.

As 15 respostas em `test/fixtures/k5-offline-general.json` foram redigidas para
mocks; **não são respostas históricas do provedor** nem novo K5. 15/15 atravessam
localmente o caminho completo. Isso não permite declarar 15 casos históricos
corrigidos. AG-029 tem defeito reproduzido e corrigido em fixture; o motivo do
histórico de AG-029 permanece desconhecido. O corte de texto reproduzido é uma
correção do lote, mas não é atribuído como causa dos 15 fallbacks.

Validação local final: **2239/2239 PASS**, zero falhas/skips/cancelamentos/todos.
Build VAL/PWA PASS. Testes de pacing cobrem 65 requisições concorrentes com quotas
30 e 7 por janela, sem 429 próprio; 429 injetado permanece FAIL; A/B/admin e bloqueio
por autorização zero. Teste HTTP real local reduz quota a 2, zera chave de modelo,
confirma política, headers e 429 estruturado sem provider_call. Nenhuma quota de
staging foi modificada. CI/staging/healthchecks devem ser registrados externamente
para o SHA final, sem reutilizar CI #249.

CASES_FIXED: defeitos locais de grounding/truncamento, diagnóstico e pacing;
**0/15 correções históricas comprovadas**. CASES_STILL_UNEXPLAINED: **15**.
K5_EXECUTOR_PACING: **PASS offline**; transporte autenticado ao vivo não foi
retestado nesta fase. Não há afirmação de aprovação K5 ou liberação de promoção.

Parar após CI/staging/healthchecks. Reteste pago depende de nova autorização.
