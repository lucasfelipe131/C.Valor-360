# DecisionThesis v1

Versão: `val.decision_thesis.v1`
Owner: MDI

## Contrato

`decision`, `objective`, `recommended_action`, `rationale[]`, `evidence_refs[]`, `risks[]`, `alternatives[]`, `tradeoffs[]`, `confidence`, `assumptions[]`, `missing_information[]`, `what_would_change_my_mind[]` e `next_action`, sempre ligados a `organization_id`, `subject_id` e `context_snapshot_id`.

## Estados

- `RECOMMEND`: há base material autorizada; a VAL toma posição e explica.
- `DISCOVER_BEFORE_RECOMMENDING`: falta dado crítico, há conflito material, ausência de contexto decisório ou barreira técnica.

Confidence deriva do nível do ContextSnapshot, evidência, conflitos e lacunas. Ela não é probabilidade de compra. O MDI explicita simultaneamente valor ao produtor, margem sustentável e relação de longo prazo. Conversão isolada nunca domina safety, evidência ou interesse legítimo do produtor.
