# K5 — remediação do validador geral

Base: f37ee4abd5dfdcb489313f53fb8937ed1bd8beb7. Escopo: PR #107 e staging isolado. Nenhuma inferência faturável executada.

## Mudança

A resposta AI_GENERAL_KNOWLEDGE só supera o segundo teste lexical quando a execução é confiável, não há produtor, a fonte única é model_general_knowledge com escopo GENERAL_KNOWLEDGE, tópico e segurança são aprovados e todas as listas de violações permanecem vazias. O grounding agora distingue LEXICAL_OVERLAP de conflitos de domínio, faceta e demais falhas. Somente LEXICAL_OVERLAP pode receber GENERAL_TOPIC_VALIDATED. Dados atuais, marcas, escopo, provenance, temporalidade e suporte factual continuam bloqueados.

A decisão de tópico retorna accepted, requestedAnchors, matchedAnchors, missingAnchors e conceptConflict. O wrapper booleano mantém a política de TODOS os anchors e as proteções adversariais existentes.

A segunda tentativa pode mencionar apenas os anchors ausentes derivados da pergunta quando a primeira falha exclusivamente no tópico, sem falhas estruturais, unsafe ou alegação regulada. Nenhuma resposta esperada ou CASE_ID entra no código de produção. Retry permanece limitado a uma segunda chamada, sujeita ao mesmo validador. Rejeição de cache não pode fornecer anchors para uma primeira resposta incompleta.

## Observabilidade

TOPIC_REQUESTED_ANCHORS, TOPIC_MATCHED_ANCHORS e TOPIC_MISSING_ANCHORS usam identificadores SHA-256 truncados, não fragmentos de texto privado. A função generalTopicDiagnostic permite correlacionar os mesmos termos deterministicamente quando a pergunta já é conhecida. TOPIC_CONCEPT_CONFLICT, GROUNDING_OVERRIDE e GROUNDING_BLOCK_REASON aparecem no decisionTrace e nos eventos estruturados. Checks sucessivos retêm os próprios diagnósticos.

## Evidência offline

26 regressões novas: paráfrase aprovada por tópico e rejeitada exclusivamente no segundo overlap lexical; escopo privado; informação atual sem fonte; marca regulada; provenance; assunto incorreto; cinco listas de violações; domínio/faceta; souvenir, Valter, Premier e outros nomes; sequência do AG-011; retry dos três grupos de tópico; falha repetida; ausência de texto privado em logs; rejeição de cache versus limite de saída.

O teste do AG-011 usa respostas escritas para regressão, não reconstruções do conteúdo histórico do provedor. Os registros históricos continuam UNRECOVERABLE_EVIDENCE_GAP. Aprovação offline não significa que os 11 casos reais já estejam corrigidos.

As mudanças de preflight anteriores foram preservadas no worktree original e não fazem parte deste commit. Nenhum secret, limite, pergunta K5, rubrica, main ou ambiente de produção foi modificado.
