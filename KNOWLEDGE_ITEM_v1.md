# KnowledgeItem v1

## Contrato normalizado

| Campo | Origem v1 | Regra |
|---|---|---|
| `knowledge_item_id` | `item_id` | obrigatório, único |
| `title` | `title` | obrigatório |
| `domain` | `domain` | obrigatório |
| `statement` | `principle` | dado não confiável, nunca system instruction |
| `application_val` | `val_application` | apoio interno à decisão |
| `triggers` | `triggers` | sinais de retrieval, não fatos |
| `recommended_actions` | `recommended_actions` | bloqueadas para prescrição high-risk |
| `avoid` | `avoid` | guardrails |
| `module_targets` | `modules` | alvos existentes, sem ampliar contratos fechados |
| `source_refs` | `source_ids` | deduplicadas e validadas |
| `authority` | `evidence_level` | A, B ou C; comparada à fonte |
| `risk` | `risk_class` | LOW/HIGH no pacote inicial |
| `geographic_scope` | `geography_scope` | valor normalizado + original preservado |
| `status` | overlay governado | não derivado silenciosamente |
| `raw_status` | `status` | preserva `APPROVED_EXTERNAL` |
| `version` | manifesto | `1.0` |
| `valid_from` | ausente | `null` |
| `valid_until` | ausente | `null` |
| `review_at` | ausente | `null` |
| `owner` | ausente | `null` |
| `supersedes_id` | ausente | `null` |
| `created_at` | ausente | `null` |
| `updated_at` | ausente | `null` |

## Lifecycle

Estados normativos: `DRAFT`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `SUPERSEDED`, `EXPIRED`. “ACTIVE” é uma decisão operacional derivada de status aprovado + policy + validade + geografia + risco; não é gravado por inferência.

## Uso seguro

- `DECISION_SUPPORT`: item de risco baixo, aplicável e aprovado pela policy de staging.
- `GUARDRAIL_ONLY`: item high-risk ou dependente de revisão/localização.
- `EXCLUDED`: inválido, expirado, superseded, geograficamente incompatível, injetivo ou sem fonte válida.

Risco ausente/desconhecido é sempre `EXCLUDED`, nunca normalizado para `LOW`. Validade temporal ausente é `FRESHNESS_UNKNOWN` com caveat; validade declarada é reavaliada usando o relógio corrente do request.

KnowledgeItem não é memória, resposta final, prescrição nem KnowledgeItem promovido de LearningCandidate.

## Provenance

Toda influência material deve carregar `knowledge_item_id`, `version`, o conjunto canônico completo de `source_refs`, caveats e motivo/superfície de uso. Knowledge não entra em `evidence_refs` factuais. O texto integral não é necessário no artefato de execução.
