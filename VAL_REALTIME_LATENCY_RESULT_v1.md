# VAL Realtime — Latency Result v1

## Instrumentação implementada

O browser usa relógio monotônico e envia métricas sem conteúdo para o registro existente `BROWSER_VOICE_TURN`:

| Métrica | Estado local |
|---|---|
| speech end → turn detected | instrumentada |
| speech end → transcript | instrumentada |
| transcript → reasoning | instrumentada |
| reasoning → first useful text | instrumentada |
| reasoning → first audio | instrumentada |
| speech end → first useful text | instrumentada |
| speech end → first audio | instrumentada — métrica principal |
| speech end → response complete | instrumentada |

P50 exige 1 amostra, P90 exige 10 e P95 exige 20.

## Resultado

Não há números honestos de latência WebRTC nesta etapa local: o provider foi mockado nos testes e nenhuma sessão paga foi aberta. Os targets de 1–2 s para follow-up simples e 2–4 s para turno contextual permanecem metas de UAT, não resultados.

O baseline físico anterior registrou `/api/val/chat` encerrado com 499 após 38.548 ms; essa evidência motivou retirar esse pipeline serial do caminho principal de conversa. Tool calls governadas ainda podem ter latência própria e serão classificadas separadamente.

Status: `INSTRUMENTATION_PASS / STAGING_MEASUREMENT_PENDING`.
