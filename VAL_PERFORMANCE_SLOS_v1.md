# VAL Performance SLOs v1

Data: 27/08/2026
Escopo aprovado: orçamento do componente canônico no staging branch, medido pelo Golden Performance local sintético.
Escopo ainda não aprovado: SLO E2E Railway/browser/dispositivo físico.

Contrato executável: `evals/val-performance-slos-v1.json`; validação: `npm run performance:slo:check -- --result <resultado.json>`.

## Regra de qualidade

Latência nunca substitui qualidade. Uma resposta só é elegível para o SLO quando:

- executa o target correto e o path contratado;
- `quality_score >= 0,90`;
- `specificity_score >= 0,80`;
- `grounding_score >= 0,80`;
- respeita tenancy, provenance e safety;
- não omite fonte/data quando o dado é atual.

`FAST + GENÉRICO = FAIL`, mesmo que a latência esteja abaixo do orçamento. O benchmark registra `fast_generic_failures`; a rodada atual teve zero.

## SLO de componente canônico

TTFUR e Total são iguais neste contrato não-progressivo. Os limites foram arredondados acima do p95 medido, com margem para variação do executor. P95 exige pelo menos 20 observações por classe.

| Classe | Evidência atual | p95 medido | SLO TTFUR p95 | SLO Total p95 | Error Rate | Piso de qualidade |
|---|---:|---:|---:|---:|---:|---:|
| FAST | N=60 | 8,829 ms | <=25 ms | <=25 ms | <=1% | 0,90 |
| CONTEXT | N=20 | 76,524 ms | <=200 ms | <=200 ms | <=1% | 0,90 |
| DEEP | N=40 | 74,237 ms | <=200 ms | <=200 ms | <=1% | 0,90 |
| TOOL | N=140 | 5,918 ms | <=50 ms | <=50 ms | <=1% | 0,90 |
| LIVE_DATA | N=20 | 4,315 ms | <=20 ms | <=20 ms | <=2% | 0,90 |
| VOICE | N=40 | 6,113 ms | <=25 ms | <=25 ms | <=2% | 0,90 |

Esses budgets cobrem somente processamento local do contrato. Em `LIVE_DATA`, não incluem latência do provider. Em `VOICE`, não incluem captura, upload, transcrição externa, playback/TTS ou interrupção.

## Error Rate

`Error Rate = FAILED / (SUCCESS + FAILED)`; `SKIPPED` não entra no denominador. Falha segura esperada (`NO_DATA`, `SOURCE_UNAVAILABLE`, `INPUT_REQUIRED` ou `422` governado) não é erro de integridade quando o contrato do caso exige fail-closed, mas continua registrada no resultado funcional. Timeout, 5xx, path divergente, target não executado, resposta genérica FAST, cross-tenant leakage ou safety violation contam como erro.

## SLO E2E ainda bloqueado

Não há amostra suficiente pós-correção para declarar SLO E2E de Railway. A rodada anterior trouxe apenas três FAST no browser (p95 ação→card de 908 ms) e duas amostras CONTEXT, uma delas com aproximadamente 19,03 s no engine legado. Isso orienta a coleta, mas não satisfaz `N >= 20` por classe.

Para liberar o SLO E2E, o staging implantado precisa medir separadamente:

- autenticação e transporte;
- PostgreSQL/context retrieval e cache hit/miss;
- provider/model quando executado;
- primeiro conteúdo realmente útil, sem confundir com first byte;
- renderização do card;
- captura/transcrição/TTS em dispositivo físico para VOICE;
- erros e timeouts no denominador.

Até essa coleta, o SLO de componente está definido e verde, enquanto o SLO E2E permanece `NOT_APPROVED_INSUFFICIENT_STAGING_EVIDENCE`.
