# VAL Quick Question v1

Quick Question consulta o contexto atual sem exigir uma Visit.

Entrada: produtor, pergunta, até três anexos, intenção opcional e `conversation_id` de sessão. Saída: recomendação existente acrescida de `AIReasoningResult v1`.

Persistência: a recomendação e sua auditoria podem ser registradas; nenhum trecho da pergunta ou resposta é promovido a `val_memories`, perfil, oportunidade ou compromisso. Voz transitória é cancelada após transcrição.

Se o contexto não sustentar especificidade após uma recomposição, a VAL declara: “Tenho pouca informação para te orientar com precisão.” e apresenta de uma a três perguntas materiais.
