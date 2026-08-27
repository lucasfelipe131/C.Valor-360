# GATE DA FASE 2 — RESULTADO

- Fase: Passo 02 — Core e contratos
- Base: `phase1/foundation` em `8d7dcc1468d829fc71bd32da8583cc7c16be3a86`
- Branch local: `phase2/core-contracts`
- Data da validação: 2026-08-20
- Ambiente: workspace local e servidor demonstrativo descartável
- Produção: não acessada e não alterada

## Conclusão

**GATE TÉCNICO LOCAL APROVADO.**

As APIs históricas permanecem compatíveis e a inicialização não depende mais de efeitos colaterais nem da ordem oculta de `--import`. O `ValEngine` existente continua sendo a implementação operacional, agora atrás de contratos, policy, router, executor e adaptador explícitos.

O Passo 03 não foi iniciado.

## Status dos requisitos

| Requisito | Status | Evidência |
|---|---|---|
| RequestEnvelope versionado | APROVADO | `val.request.v1`, runtime e JSON Schema |
| ResponseEnvelope versionado | APROVADO | `val.response.v1`, runtime e JSON Schema |
| Router determinístico | APROVADO | cinco objetivos, rotas reproduzíveis e ordem lógica declarada |
| Policy middleware | APROVADO | tenant, papel, carteira e binding interno validados antes da engine |
| Executor síncrono | APROVADO | ordem, módulos obrigatórios/opcionais e degradação segura testados |
| Tracing | APROVADO | eventos `core.*` carregam o mesmo `request_id` |
| OpenAPI | APROVADO | `openapi/val-core-v1.yaml` documenta rotas legadas e v1 |
| Compatibilidade das APIs atuais | APROVADO | adaptador devolve estruturalmente a mesma recomendação e preserva erro de domínio |
| Composição explícita | APROVADO | `server/start.js` chama `conversion → innovation` antes de carregar `server.js` |
| Ausência de side effect de importação | APROVADO | importar bootstraps não altera protótipos; instalação é explícita e idempotente |
| Safe degradation | APROVADO | módulo opcional indisponível degrada; obrigatório ausente falha fechado |
| Cross-tenant | APROVADO | tenant divergente é negado antes de qualquer chamada ao `ValEngine` |
| Banco/migrations | NÃO APLICÁVEL | nenhuma migration, ID ou dado alterado |

## Testes executados

### Baseline antes da implementação

- `node --test`: 331 testes, 331 aprovados, 0 falhas.
- build principal Vite/PWA: aprovado.
- build do Manual Next.js: aprovado.

### Resultado final

- `npm test`: aprovado.
- `node --test`: 350 testes, 350 aprovados, 0 falhas.
- Testes adicionados na Fase 2: 19.
- `npm run build`: aprovado; PWA carimbada e verificada.
- `npm run build` em `manual/`: aprovado, incluindo TypeScript.
- `npm run test:phase2:smoke`: aprovado.
- `git diff --check`: aprovado.

Cobertura nova:

- contratos válidos, inválidos, incompletos, campos extras e versão antiga;
- matriz de papéis no escopo efetivo atual;
- tentativa cross-tenant;
- divergência entre envelope e tenant, ator, subject ou cliente embutido;
- roteamento de visita, agronomia, agronomia crítica e próxima ação;
- MGO obrigatório no plano agronômico crítico;
- execução ordenada, módulo ausente e erro de domínio preservado;
- correlação entre policy, router, executor e resposta;
- ausência de mutation por simples import dos bootstraps;
- igualdade estrutural do payload legado.

## Smoke HTTP descartável

O script criou um diretório temporário, iniciou `server/start.js` em modo demonstrativo, executou as chamadas e removeu o diretório ao final.

| Chamada | Resultado |
|---|---|
| `GET /live` | HTTP 200 |
| `GET /api/val/status` | HTTP 200; Core v1 e ordem `conversion → innovation` |
| `POST /api/val/recommendations` | HTTP 200; payload legado, sem `contract_version`, `engineMode=rules` |
| `POST /api/v1/val/recommendations` | HTTP 200; `val.response.v1`, audit e `prepare_visit.v1` |

Na rota canônica, `request_id` da resposta e da auditoria foi `00000000-0000-4000-8000-000000000207`, e o módulo executado foi `LEGACY_VAL_ENGINE`.

## Compatibilidade comprovada

As rotas `/api/val/chat` e `/api/val/recommendations`:

- continuam aceitando o corpo histórico;
- continuam usando o `ValEngine` atual;
- continuam retornando o resultado atual mais o `requestId` já existente;
- não expõem o envelope novo;
- preservam erros e códigos de domínio lançados pela engine.

A rota `/api/v1/val/recommendations` é aditiva e não possui consumidor no front-end nesta fase.

## Arquivos deliberadamente não alterados

- `server/val-engine.js`;
- `server/sales-playbook.js` e prompts;
- `server/repository.js`;
- `server/auth.js` e emissão/validação de sessão;
- `database/**`, schema e migrations;
- `src/**` e o front-end;
- `manual/**`.

## Migrations

Nenhuma migration foi criada, alterada ou executada para o Passo 02. Não há rollback de dados.

## Rollback disponível

O rollback é integralmente de código e não destrutivo:

1. reverter os arquivos desta branch para `8d7dcc1`;
2. restaurar o comando de inicialização anterior e a chamada direta ao `ValEngine`;
3. remover a rota v1 e os artefatos `server/core`, schemas e OpenAPI;
4. executar os 331 characterization tests do baseline e os dois builds.

Como não há migration, o rollback não toca em dados, IDs, backups ou restore.

## Riscos remanescentes

| Risco | Situação |
|---|---|
| Seis wrappers de prototype ainda existem | mitigado pela instalação explícita; retirada física será incremental |
| Rota v1 sem tráfego real | exige canário posterior antes de migrar consumidores |
| Módulos lógicos ainda usam um adaptador único | declarado na auditoria; não há falsa alegação de extração completa |
| Visão gerencial de equipe | não inventada; policy mantém carteira própria |
| Chunk principal acima de 500 kB | warning preexistente e não bloqueante; front-end não foi alterado |
| Aviso de múltiplos lockfiles no Manual | preexistente e não bloqueante |

## Estado Git e publicação

- alterações permanecem apenas na branch local `phase2/core-contracts`;
- nenhum commit da Fase 2 foi criado;
- branch não publicada;
- nenhum PR da Fase 2 aberto;
- nenhum merge executado;
- nenhum deploy ou acesso a produção;
- workflow preparado para executar o smoke dentro do check obrigatório `npm test` quando publicado.

## Decisão final

O critério do Passo 02 está comprovado localmente:

> APIs atuais permanecem compatíveis e a execução deixa de depender de ordem oculta de importação.

Recomendação: publicar a branch e abrir um PR draft empilhado para validação do CI somente após autorização específica. Não iniciar o Passo 03 sem autorização.
