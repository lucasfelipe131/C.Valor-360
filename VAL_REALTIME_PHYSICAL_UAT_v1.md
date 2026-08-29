# VAL Natural Realtime Voice — Physical UAT v1

Data: 2026-08-29

## Evidência anterior

No baseline, um iPhone/Safari físico exibiu “Modo contínuo indisponível” e caiu para “Apertar para falar”. Essa evidência confirma a falha do fluxo antigo, não valida a implementação WebRTC nova.

## Matriz da implementação nova

| Área | Desktop | iPhone físico Safari | iPhone PWA | Android físico Chrome | Android PWA |
|---|---|---|---|---|---|
| login/sessão | PENDING | PENDING | PENDING | PENDING | PENDING |
| permissão/microfone | PENDING | PENDING | PENDING | PENDING | PENDING |
| WebRTC conectado | PENDING | PENDING | PENDING | PENDING | PENDING |
| VAD/turno automático | PENDING | PENDING | PENDING | PENDING | PENDING |
| áudio incremental/TTS | PENDING | PENDING | PENDING | PENDING | PENDING |
| barge-in | PENDING | PENDING | PENDING | PENDING | PENDING |
| contexto/Decision Interview | PENDING | PENDING | PENDING | PENDING | PENDING |
| tools/memória governada | PENDING | PENDING | PENDING | PENDING | PENDING |
| fallback/retry | PENDING | PENDING | PENDING | PENDING | PENDING |
| naturalidade 5 minutos | PENDING | PENDING | PENDING | PENDING | PENDING |

Modelo, versões de sistema/browser, latências e resposta A/B/C do avaliador ainda não existem. Nenhuma coluna pode ser marcada PASS por teste automatizado ou simulação.

Status: `PHYSICAL_UAT_NOT_EXECUTED`.
