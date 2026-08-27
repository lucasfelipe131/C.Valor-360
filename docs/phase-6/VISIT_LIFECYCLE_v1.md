# VisitLifecycle v1

Versão: `val.visit_lifecycle.v1`.

Estados: `PLANNED`, `PREPARED`, `IN_PROGRESS`, `COMPLETED_PENDING_REVIEW`, `COMPLETED`, `CANCELLED`.

`IN_PROGRESS` é opcional. As transições válidas são explícitas; `COMPLETED` exige confirmação do report. A passagem da data agendada não altera o estado.

Cada transição registra visita, tenant, ator, estado anterior/novo, motivo, revisão, `request_id` e timestamp em `val_visit_lifecycle_events`. O campo histórico `visits.status` continua disponível e não é reinterpretado.

Fluxos normais:

- `PLANNED → PREPARED → COMPLETED_PENDING_REVIEW → COMPLETED`;
- `PLANNED/PREPARED → IN_PROGRESS → COMPLETED_PENDING_REVIEW → COMPLETED`;
- estados não finais podem ir a `CANCELLED`.

`COMPLETED` e `CANCELLED` são terminais nesta versão.
