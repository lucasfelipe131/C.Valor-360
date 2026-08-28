# AIReasoningResult v1

Contrato: `val.ai_reasoning_result.v1`.

Campos obrigatórios: `reasoning_id`, `organization`, `client`, `context_snapshot`, `objective`, `situation_summary`, `key_signals`, `facts_used`, `hypotheses`, `missing_information`, `decision_thesis`, `golden_questions`, `recommended_strategy`, `evidence_to_use`, `agronomic_context`, `commercial_context`, `next_commitment`, `risks`, `confidence`, `knowledge_refs`, `memory_refs`, `created_at`, `model` e `prompt_version`.

`decision_thesis` contém:

- `CURRENT_SITUATION`
- `WHAT_MATTERS`
- `KEY_UNCERTAINTY`
- `THESIS`
- `WHY`
- `WHAT_TO_VALIDATE`
- `WHAT_WOULD_CHANGE_MY_VIEW`

Extensões auditáveis: `conversation_id`, `intent`, `persistence_mode`, `run`, `premises` e `quality`.

`premises.recomputed_for_request=true` significa que cada pergunta usa um novo ContextSnapshot do produtor. Isso não significa que a conversa foi gravada como fato: `conversation_is_not_confirmed_memory=true` permanece obrigatório.
