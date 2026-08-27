# VisitReport v1

Versão: `val.visit_report.v1`.

O report organiza o relato de texto ou o transcript em:

- resumo e assuntos;
- expectativas, objeções e sinais do produtor;
- oportunidades candidatas;
- compromissos propostos/confirmados;
- negócios fechados ou pendentes;
- próximos passos;
- observações técnicas e comportamentais;
- lacunas e confiança.

Cada item material mantém `item_id`, `source_ref`, confidence e um estado: `FACT_CANDIDATE`, `INFERENCE` ou `HYPOTHESIS`. Todos exigem confirmação.

Estados de confirmação: `PENDING_REVIEW`, `CONFIRMED`, `REJECTED`. Enquanto pendente, o consultor pode editar, remover ou adicionar itens; nenhuma memória consolidada é escrita. O payload inicial permanece em `initial_extraction` para auditoria.

Relato técnico é observação reportada. Uma menção a buva, por exemplo, mantém `requires_technical_review` e `REQUIRES_MIA`; nunca gera dose, produto ou prescrição automaticamente.
