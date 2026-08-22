# ADR-004 — MIC, MDI e MVV por adapters sobre o patrimônio comercial

- Status: aceito localmente para o Gate da Fase 4
- Data: 2026-08-22
- Base: `ec0c10686855f410f4e131754a34127f062fbf9f`

## Contexto

A VAL já possui Nexo, Conversion Engine, Value Bridge, Conversation Orchestrator, Commitment Ladder, Objection Library, Value Scenarios, Multi-Decision Map, Message Calibration e Post-Conversion Expansion. Reescrevê-los criaria regressão e duas fontes de regra.

## Decisão

Formalizar três artefatos aditivos e versionados:

- MIC produz `BehavioralProfile v1` a partir de evidências autorizadas e do questionário legado;
- MDI compõe ContextSnapshot, perfil e motores legados em `DecisionThesis v1`;
- MVV transforma a tese em `ValuePlan v1` usando a metodologia existente.

`conversion-bootstrap.js` continua instalado pela composição explícita do Core e chama o novo adapter somente depois que o comportamento legado foi calculado. `ValEngine`, `sales-playbook`, `val-methodology`, cálculos e safety não são alterados.

## Fronteiras

- Perfil muda linguagem, ordem, prova, detalhe, ritmo e perguntas; nunca fatos.
- MDI toma posição apenas com base suficiente. Lacuna crítica, conflito ou safety resultam em `DISCOVER_BEFORE_RECOMMENDING`.
- MVV limita perguntas a três, não aplica desconto automático e sempre produz próximo passo proporcional.
- OPC é a terminologia oficial. APC permanece documentado como alias legado observado.
- SPIN é raciocínio interno; EPA significa educar com evidência, personalizar a forma e assumir controle do processo sem pressionar a pessoa.

## Consequências

- Compatibilidade: campos novos são opcionais e aditivos na recomendação e auditoria v1.
- Reversibilidade: remover uma chamada de adapter restaura exatamente o fluxo anterior; não há migration.
- Limitação deliberada: persistência própria de perfil/tese/plano e lifecycle de Commitment não entram nesta fase.
