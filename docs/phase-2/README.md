# Fase 2 — Core e contratos

## Escopo implementado

Esta fase introduz uma camada explícita ao redor do patrimônio existente. Autenticação, PostgreSQL, `ValEngine`, prompts, front-end, Manual e contratos legados permanecem em uso.

| Entrega | Artefatos |
|---|---|
| Request/Response envelopes v1 | `server/core/contracts.js`, `contracts/v1/*.json` |
| Policy middleware | `server/core/policy.js` |
| Router determinístico | `server/core/router.js` |
| Executor síncrono e degradação segura | `server/core/executor.js` |
| Adaptador do Core | `server/core/val-core.js` |
| Composição explícita | `server/core/composition.js`, `server/start.js` |
| API canônica aditiva | `POST /api/v1/val/recommendations` |
| Compatibilidade | `/api/val/chat` e `/api/val/recommendations` continuam legadas |
| OpenAPI | `openapi/val-core-v1.yaml` |
| Tracing | eventos `core.*` com o `request_id` do Passo 01 |
| Gate repetível | `npm run test:phase2:smoke`, executado dentro do check obrigatório `npm test` |

## Fluxo

1. A API autentica a sessão existente.
2. O servidor deriva tenant, ator, subject e policy context.
3. O Core valida `RequestEnvelope v1`.
4. A policy nega tenant, carteira ou vínculo interno incompatível antes da engine.
5. O router escolhe uma rota reproduzível.
6. O executor chama o adaptador obrigatório do `ValEngine` atual.
7. O Core valida `ResponseEnvelope v1` e registra auditoria.
8. A rota v1 devolve o envelope; as rotas históricas devolvem apenas a recomendação legada.

## Rotas lógicas iniciais

| Objetivo | Plano lógico | Revisão |
|---|---|---|
| `prepare_visit` | MCTX → MMI → MIC → MDI → MVV | conforme policies existentes |
| `agronomic_critical` | MCTX → MMI → MIA → MGO | obrigatória |
| `agronomic_question` | MCTX → MMI → MIA | conforme policies existentes |
| `next_best_action` | MCTX → MMI → MDI → MVV → MEX | conforme policies existentes |
| `general_assistance` | MCTX → MMI → MDI → MVV | conforme policies existentes |

Esses nomes tornam o plano-alvo explícito. Nesta fase, todos continuam cobertos pelo único adaptador `LEGACY_VAL_ENGINE`; não se afirma que os módulos futuros já foram extraídos.

## Arquivos deliberadamente não alterados

- `server/val-engine.js`
- `server/sales-playbook.js` e demais prompts
- `server/repository.js` e schema/migrations
- `src/**` e todo o front-end
- `manual/**`
- autenticação e emissão de sessão

## Banco e migrations

Nenhuma migration está prevista ou foi criada no Passo 02. Os contratos são de aplicação e não persistem estruturas novas.

## Riscos remanescentes

- Os seis wrappers de prototype continuam ativos internamente, embora sem efeito colateral de importação.
- A rota v1 ainda não possui consumidor real; adoção deve ocorrer por canário posterior.
- O executor registra o plano lógico, mas ainda não chama módulos independentes.
- A política mantém o escopo efetivo atual de carteira própria; visão gerencial de equipe não foi inventada.

## Critérios do gate

- suíte anterior sem regressão;
- builds principal e Manual aprovados;
- resposta legada provada por igualdade estrutural;
- contratos válidos, inválidos, incompletos e versão antiga cobertos;
- tentativa cross-tenant e binding divergente negados antes da engine;
- roteamento reproduzível e agronomia crítica ligada ao MGO;
- módulo opcional degrada e módulo obrigatório falha fechado;
- composição explícita idempotente e sem side effects de importação;
- `request_id` comum a policy, router, executor e resposta;
- nenhuma migration, produção, merge ou Passo 03.
