# LearningCandidate v1

Versão: `val.learning_candidate.v1`.

Um candidato liga uma hipótese à visita, ao report confirmado e ao outcome. Contém escopo, evidências favoráveis/contrárias, confidence, criador e timestamps.

Estados do contrato: `CANDIDATE`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `EXPIRED`.

A Fase 6 cria exclusivamente `CANDIDATE`. Não existe promoção automática para `KnowledgeItem`, regra, prompt ou perfil. Revisão, repetição, evidência contrária e promoção governada pertencem ao Passo 11.

O candidato pode orientar a preparação seguinte apenas como histórico rastreável da conta, sem generalização organizacional.
