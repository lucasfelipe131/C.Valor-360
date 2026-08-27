# ActionPlan v1

Versão estável: `val.action_plan.v1`.

O MEX reduz a tese e o plano de valor a no máximo três prioridades. Cada prioridade registra ação, motivo, owner opcional, prazo opcional, estado, critério de sucesso, evidência exigida, confiança e referências de origem.

Owner, prazo ou critério ausente significa que a ação ainda é `PROPOSED`; ela não é persistida como `Commitment v1`. O plano referencia, sem copiar autoridade, `ContextSnapshot`, `DecisionThesis` e `ValuePlan`.

Estados: `PROPOSED`, `ACCEPTED`, `IN_PROGRESS`, `DONE`, `BLOCKED`, `CANCELLED`.

Seleção é determinística e considera apenas sinais registrados: impacto, urgência, confiança, dependência, risco, momento comercial e compromisso existente. O limite de três é contratual.
