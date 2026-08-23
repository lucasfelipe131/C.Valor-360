# Outcome v1

Versão: `val.outcome.v1`.

Tipos iniciais: `WON`, `LOST`, `PARTIAL`, `NO_DECISION`, `FOLLOW_UP`, `TECHNICAL_RESULT`, `RELATIONSHIP_PROGRESS`, `NO_CHANGE`.

O outcome liga tenant, visita, produtor e, quando aplicável, report, recomendação, ActionPlan e Commitment. `result` é estruturado; `evidence_refs` pode apontar para pedido, nota, imagem, relato confirmado, comparação, medição ou integração futura.

`measured_at`, `recorded_by` e confidence são obrigatórios. `NO_DECISION` não é tratado como `LOST`, e resultado técnico/relacional não depende de fechamento comercial.

A API aditiva é `POST /api/v1/outcomes`; tenant e ator vêm da sessão, nunca do corpo do navegador.
