# ADR — Preparar Visita com simplicidade progressiva

Status: aceito para staging  
Base: `feature/voice-capture@85c6209c095702d4f02f0d31ff2c9ab224855ebf`  
Escopo: camada de apresentação da preparação de visita

## Contexto

O contrato `PrepareVisit v1` já entrega objetivo, oportunidade, abordagem comportamental, até três Perguntas de Ouro, objeção, provas, compromisso-alvo, lacunas e ações. `ContextSnapshot`, `DecisionThesis`, `ValuePlan` e `ActionPlan` permanecem disponíveis. O problema era visual: esses artefatos competiam no mesmo nível dentro de um card da agenda.

## Decisão

Criar `PrepareVisitSimple`, uma tela focada que consome a resposta existente de `POST /api/v1/visits/:id/preparation` sem criar motor, endpoint ou persistência cognitiva paralelos.

- Camada 1: objetivo, até dois alertas, até três perguntas, estratégia e compromisso-alvo.
- Camada 2: oportunidade, objeção, provas, lacunas, oportunidades secundárias e até três prioridades.
- Camada 3: números, tese, evidências, riscos, caso econômico e agronomia disponível.
- `SIMPLE`, `BALANCED` e `ANALYTICAL` mudam somente a abertura inicial das camadas.
- Voice Capture `PRE_VISIT` continua exigindo confirmação e recalcula a mesma preparação versionada.
- “Estou saindo agora” e “Resumo em 60 segundos” são projeções do mesmo artefato, não novas decisões.
- Os atalhos “Preparar visita” do Centro de Decisão, Dashboard e Cliente 360 abrem a mesma jornada focada. Havendo visita planejada, ela é preparada imediatamente; sem visita, abre-se o agendamento com o produtor já selecionado.

## Consequências e guardrails

Não há migration nem alteração em MMI, MCTX, MIC, MDI, MVV, MEX, VIS, Commitment, Outcome ou LearningCandidate. IDs e provenance continuam no payload e deixam de aparecer apenas na primeira camada. A preferência é local, escopada pela sessão do consultor, nunca entra em prompt, facts, tese ou recomendação. Tenancy e safety permanecem nos serviços existentes.
