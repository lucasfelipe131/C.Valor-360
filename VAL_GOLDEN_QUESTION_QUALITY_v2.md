# VAL Golden Question Quality v2

Máximo de três perguntas. A UI mostra somente `question`.

Metadados internos obrigatórios:

- `reason`: por que perguntar;
- `unknown`: qual lacuna será preenchida;
- `decision_impact`: qual parte da decisão muda;
- `context_refs`: quais fatos sustentam a pergunta.

A pergunta deve terminar em interrogação, preencher uma lacuna material, mudar tese/estratégia/compromisso e apontar ao menos uma referência. Pergunta genérica que serviria a qualquer produtor não passa no conjunto com `NAME_SWAP_TEST` e `CONTEXT_REMOVAL_TEST`.

Cada pergunta recebe as dimensões internas `specificity`, `openness`, `novelty`, `decision_impact` e `context_grounding`, com média mínima de `0.75`. Similaridade lexical igual ou superior a `0.68` reprova `novelty`; perguntas semanticamente repetidas são removidas antes da resposta.
