# VAL Response Quality v2

Contrato: `val.response_quality.v2`.

Dimensões: `specificity`, `context_usage`, `history_usage`, `question_quality`, `decision_relevance`, `agronomic_relevance`, `commercial_relevance`, `knowledge_usage`, `actionability`, `clarity`, `non_generic_language` e `confidence_calibration`.

Gates automáticos:

- `NAME_SWAP_TEST`: exige identidade e pelo menos dois âncoras materiais não reduzíveis ao nome.
- `CONTEXT_REMOVAL_TEST`: exige dependência mensurável de referências e fontes; remover o dossiê precisa reduzir materialmente a resposta.
- `GOLDEN_QUESTION_QUALITY`: cada pergunta precisa de lacuna, impacto e referência interna.

Threshold global: 0,72. Falha gera uma única recomposição com fatos, histórico, momento, cultura, compromisso, perfil, agronomia e evidência. Nova falha gera `REASONING_DEGRADED`. Safety nunca é reescrita para passar no score.

Matriz coberta: pergunta geral, pergunta de conta, visita, nota, pós-visita, agronomia, imagem, solo, valor, objeção, oportunidade, follow-up, cinco perfis, cinco preferências de consultor, nome trocado, contexto removido, contexto insuficiente, provider degradado, tenant, anexos, voz transitória, confirmação, troca de produtor, Library, Manual, mobile e desktop.
