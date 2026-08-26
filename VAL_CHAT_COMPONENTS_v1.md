# VAL Chat Components v1

## Biblioteca reutilizável

`src/components/copilot/DecisionCards.jsx` fornece:

- `DecisionCard`: leitura curta, caminho FAST/DEEP e ação recomendada;
- `PrepareVisitCard`: objetivo, por que agora, até três Perguntas de Ouro e resultado esperado;
- `AgronomicInsightCard`: fontes técnicas, safety e drill-down;
- `CommitmentCard`: próximo passo sugerido, sem persistência automática;
- `OpportunityCard`: leitura comercial e abordagem específica;
- `EvidenceCard`: fatos efetivamente usados;
- `KnowledgeCard`: itens da Biblioteca/Manual efetivamente usados;
- `MarketCard`: estado current data, fonte, data, praça e unidade;
- `ConfirmationCard`: revisão antes de mutação;
- `CalculationCard`: leitura econômica com hipóteses explícitas;
- `DiagnosisCard`: leitura multimodal com revisão técnica.

## Ordem padrão

1. `MINHA LEITURA`.
2. `EU FARIA AGORA`.
3. Card especializado, quando aplicável.
4. Decision Interview, quando há MIA material.
5. Perguntas que mudam a decisão.
6. `Por que a VAL disse isso?`.
7. Evidências e premissas em densidade analítica.

## Ações

Cards não executam mutações ocultas. Ações abrem módulos tradicionais ou iniciam fluxos que já possuem política própria. Um compromisso sugerido não vira Commitment até haver ação explícita e contrato válido.

## Qualidade

Cards exibem o mesmo `AIReasoningResult`; não recompõem a resposta no frontend. NAME_SWAP_TEST, CONTEXT_REMOVAL_TEST, confidence, facts e capability audit permanecem vindos do backend.

