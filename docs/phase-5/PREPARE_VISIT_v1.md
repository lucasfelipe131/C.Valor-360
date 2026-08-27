# PrepareVisit v1

Versão estável: `val.prepare_visit.v1`.

O contrato liga uma visita a:

- `ContextSnapshot v1` autorizado;
- `BehavioralProfile v1` explicável;
- `DecisionThesis v1`;
- `ValuePlan v1`;
- `ActionPlan v1`.

A apresentação inclui objetivo, oportunidade principal quando aplicável, motivo temporal, abordagem, no máximo três perguntas de ouro, tese, provas, objeção, compromisso-alvo, no máximo três ações, lacunas e oportunidades secundárias.

Tipos: `COMMERCIAL`, `TECHNICAL`, `RELATIONSHIP`, `PENDING_ITEM`. Visitas técnicas, relacionais e de pendência não forçam proposta ou fechamento. Objeção de preço nunca dispara desconto automático. Perfil muda linguagem e prova, não fatos.

`POST /api/v1/visits/:id/preparation` gera e persiste; `GET` recupera a preparação mais recente dentro da carteira autorizada.
