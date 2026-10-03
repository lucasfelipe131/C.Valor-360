# LearningCandidate v1

Versão: `val.learning_candidate.v1`.

Um candidato liga uma hipótese à visita, ao report confirmado e ao outcome. Contém escopo, evidências favoráveis/contrárias, confidence, criador e timestamps.

Estados do contrato: `CANDIDATE`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `EXPIRED`.

A Fase 6 cria exclusivamente `CANDIDATE`. Não existe promoção automática para `KnowledgeItem`, regra, prompt ou perfil. Revisão, repetição, evidência contrária e promoção governada pertencem ao Passo 11.

O candidato pode orientar a preparação seguinte apenas como histórico rastreável da conta, sem generalização organizacional.

## Evolução compatível no Passo 11

Campos opcionais `learning_metadata` e `candidate_fingerprint` preservam os campos legados. Metadados ligam decisões, recomendações, feedback, impactos, versão do motor/policy, tenant, classificação e suficiência da amostra. Ocorrência única é ACCOUNT_OBSERVATION; recorrência local continua LOCAL_PATTERN. Não existe generalização geográfica automática.

Revisões seguem CANDIDATE → UNDER_REVIEW → APPROVED/REJECTED/EXPIRED. Evidência contrária canônica reabre UNDER_REVIEW e reduz a proporção descritiva de suporte. Todas as evidências devem ser explicitamente revisadas. APPROVED não significa conhecimento publicado.
