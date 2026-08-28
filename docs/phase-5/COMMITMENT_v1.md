# Commitment v1

Versão estável: `val.commitment.v1`.

Um compromisso material exige:

- responsável explícito;
- prazo válido;
- critério observável de sucesso;
- origem auditável;
- organização e produtor autorizados.

Sem esses elementos, o registro permanece sugestão. Conclusão (`DONE`) exige ao menos uma `evidence_ref`; cancelamento registra data e motivo auditável. Estados terminais não são reabertos silenciosamente.

O vínculo a visita, oportunidade, ActionPlan e ação é opcional, mas, quando informado, deve existir no mesmo tenant e produtor. Campos legados como `visits.next_commitment`, `interactions.commitments` e `opportunities.next_action` continuam preservados.
