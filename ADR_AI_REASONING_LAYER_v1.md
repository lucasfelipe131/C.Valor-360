# ADR — AI Reasoning Layer v1

Status: aceito para staging em 2026-08-25.

## Decisão

A camada de raciocínio é uma composição dentro do VAL Core existente. Ela não é um chatbot, não mantém um segundo cadastro e não decide autorização ou persistência. O fluxo é:

`auth/tenant → RequestEnvelope → ContextSnapshot/MMI → knowledge retrieval → contexto agronômico → ValEngine/orquestração → composição AIReasoningResult → validação determinística → safety/policy → resposta`.

`ReasoningProvider` é uma interface independente de fornecedor. A implementação inicial, `ComposedAdviceReasoningProvider`, normaliza o resultado do pipeline existente; a geração estruturada continua sendo executada pelo provider já escolhido pela `ValEngine`.

## Autoridades

- Policy, tenancy e safety são determinísticos e soberanos.
- MCTX/MMI selecionam somente contexto autorizado e confirmado.
- MIC/MDI/MVV/MIA/MCA/MEX/VIS, Library, Manual e Voice Capture continuam sendo módulos do mesmo núcleo.
- IA sintetiza, formula hipóteses e perguntas; não autoriza execução, não confirma memória e não cria urgência.
- Falha do provider produz `REASONING_DEGRADED`; bloqueio técnico produz `SAFETY_PRESERVED`.

## Consequências

O contrato é aditivo, sem migração destrutiva. Recomendações continuam auditáveis no registro já existente, agora com modelo, versão de prompt, hash de contexto, latência, status e fallback dentro de `ai_reasoning.run`.
