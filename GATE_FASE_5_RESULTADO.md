# GATE FASE 5 — FECHAMENTO OPERACIONAL

## Resultado final

**GATE FASE 5 APROVADO — MIGRATION VALIDADA**

Os 14 critérios funcionais do Passo 05 e o gate operacional da migration foram comprovados. A migration expand-only foi aplicada em PostgreSQL 16 isolado, reexecutada com idempotência, submetida a regressão completa, copiada por `pg_dump`, restaurada em um segundo PostgreSQL 16 limpo e revalidada sem drift ou perda de dados.

Este resultado autoriza apenas considerar concluído o gate local. Não houve commit, push, Pull Request, merge, deploy, acesso à Railway, alteração de produção ou início do Passo 06.

## Marco auditado

| Item | Evidência |
|---|---|
| Branch local | `phase5/execution-insight` |
| Base obrigatória | `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` |
| HEAD local ao final | `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` — nenhum commit criado |
| `main` local | `f405617405fb66811207fdf006c2fbdaebfb8c9d` |
| `origin/main` conhecido localmente | `f405617405fb66811207fdf006c2fbdaebfb8c9d` |
| Baseline anterior | 419/419 testes |
| Suíte final | 458/458 testes |
| Testes novos da Fase 5 | 39: 28 obrigatórios + 11 de contrato/repositório |
| PostgreSQL controlado | 16.15, dois clusters locais distintos e descartáveis |
| Migration validada | `20260822_003_execution_insight_expand` |
| Checksum SHA-256 | `e0b7e9abef783872a6c1e6a5cb284ee9eda9cd37df17c48ed7f4334a36ac4529` |
| Backup | 185.798 bytes; SHA-256 `057dfffad05191084104bf43df486285b24a3f0fb3c143e542d26b05d487c12f` |
| Publicação | não realizada |

## Implementação comprovada

### MEX — Motor de Execução

- `ActionPlan v1` liga `ContextSnapshot`, `DecisionThesis` e `ValuePlan` e limita o resultado a três prioridades.
- Priorização inicial é determinística e considera impacto, urgência registrada, confiança, dependência, risco, momento comercial e compromisso existente.
- `Commitment v1` exige responsável, prazo e critério de conclusão; ação incompleta permanece sugestão.
- Lifecycle mínimo: `PROPOSED`, `ACCEPTED`, `IN_PROGRESS`, `DONE`, `BLOCKED` e `CANCELLED`.
- Conclusão `DONE` exige evidência; estados terminais não são reabertos silenciosamente.
- Replanejamento pode atualizar prazo e critério, preservando auditoria.
- Compromissos vencidos retornam ao `ContextSnapshot v1` em `relationship_context.overdue_commitments`.

### VIS — VAL Insight / Radar VAL

- `InsightCard v1` implementa `ACT_NOW`, `PREPARE`, `FOLLOW_UP` e `LEARN`.
- Feed limitado a cinco cards, filtrado por tenant, ator/papel e carteira antes da resposta.
- Cards expirados ou resolvidos não permanecem ativos.
- Baixa confiança é apresentada como hipótese.
- A política de prioridade é determinística, versionada e explicitamente experimental; não é exibida como KPI.
- O Portfolio Radar e o payload legado foram preservados; `insights` foi acrescentado de forma aditiva.
- A Home pergunta: “O que merece minha atenção agora?”.

### Preparar Visita

- A preparação usa `ContextSnapshot v1`, `BehavioralProfile v1`, `DecisionThesis v1` e `ValuePlan v1`.
- A saída traz objetivo, foco principal, por que agora, abordagem, até três Perguntas de Ouro, tese, provas, objeção, compromisso-alvo, até três ações, lacunas e oportunidades secundárias.
- O consultor não recebe JSON, nomes de motores, versão interna nem score experimental na interface.
- Visitas técnicas, relacionais e de pendência não forçam proposta ou fechamento.
- Menção comercial a “área teste” não é classificada automaticamente como visita técnica.
- Oportunidade secundária fica como candidata e não desvia o objetivo principal.

## Contratos e APIs aditivos

Contratos criados:

- `val.action_plan.v1`;
- `val.commitment.v1`;
- `val.insight_card.v1`;
- `val.prepare_visit.v1`;
- `val.execution_composition.v1`;
- política experimental `val.insight_priority.experimental.v1`.

Rotas acrescentadas e protegidas:

| Método | Rota | Resultado |
|---|---|---|
| `POST` | `/api/v1/visits/:id/preparation` | gera e persiste preparação/ActionPlan autorizados |
| `GET` | `/api/v1/visits/:id/preparation` | recupera a preparação autorizada mais recente |
| `POST` | `/api/v1/action-plans` | persiste plano ligado ao snapshot autorizado |
| `POST` | `/api/v1/commitments` | cria apenas compromisso estruturalmente válido |
| `GET` | `/api/v1/commitments` | lista apenas a carteira autorizada |
| `PATCH` | `/api/v1/commitments/:id` | transiciona, bloqueia, replaneja ou conclui |
| `GET` | `/api/v1/insights` | entrega o feed VIS filtrado e não expirado |

O VAL Core continua executando o adapter `LEGACY_VAL_ENGINE`. A rota lógica `prepare_visit.v1` agora declara MEX/VIS, e a auditoria do `ResponseEnvelope v1` recebeu apenas campos opcionais e retrocompatíveis: `execution_modules`, `action_plan_id` e `action_plan_version`.

## Migration

Arquivo: `database/migrations/20260822_003_execution_insight_expand.sql`.

Objetos aditivos:

- índices únicos `(tenant_id,id)` para `clients`, `visits` e `opportunities`;
- tabela `val_action_plans`;
- tabela `val_commitments`;
- índices de visita, produtor, owner, status, prazo e snapshot;
- FKs compostas tenant-safe;
- constraints de estado, JSON e evidência obrigatória para `DONE`.

Propriedades comprovadas estaticamente:

- não contém `DROP`, `TRUNCATE`, `DELETE`, `ALTER` ou `UPDATE` executável;
- não remove, renomeia, reclassifica ou preenche dados legados;
- não altera IDs existentes;
- não modifica `database/schema.sql` nem migrations históricas;
- entra na ordenação e no controle de checksum do runner existente;
- usa `CREATE ... IF NOT EXISTS` para os objetos aditivos.

### Prova dinâmica em PostgreSQL 16

O gate usou PostgreSQL 16.15 extraído localmente, sem infraestrutura externa, custo ou credencial nova. O banco de origem `val_phase5_source_gate` e o banco de restore `val_phase5_restore_gate` utilizaram diretórios e portas separados. Ambos continham apenas fixtures sintéticos e foram encerrados ao fim da prova.

| Verificação | Antes | Depois | Resultado |
|---|---:|---:|---|
| Tabelas públicas | 44 | 46 | somente `val_action_plans` e `val_commitments` adicionadas |
| Constraints catalogadas | 534 | 586 | acréscimos das novas tabelas/colunas; nenhuma removida |
| Índices públicos | 107 | 121 | 12 índices declarados + 2 PKs das novas tabelas |
| Drift esperado da Fase 5 | 2 tabelas e 12 índices ausentes | nenhum | zero drift após apply |
| Clientes | 3 | 3 | contagem e IDs preservados |
| Memórias | 6 | 6 | contagem, IDs e payloads preservados imediatamente após apply |

Hashes congelados antes e imediatamente depois da migration:

- IDs de clientes: `48d6bf6cd305976a31f460284ce0576a` em ambos;
- IDs de memórias: `9775947e4d6ba95b82314de8138d114b` em ambos;
- payload integral de memórias: `279c8796db84d4be106626af5161ff3e` em ambos.

O runner oficial registrou `applied` na primeira execução e `already-applied` na segunda. O checksum persistido em `schema_migrations` coincide com o arquivo. Não houve reclassificação, atualização ou remoção de registro legado.

### Persistência MEX/VIS validada

Com dados sintéticos, foram persistidos e recuperados:

- 1 visita;
- 2 `ContextSnapshot v1`;
- 1 recomendação;
- 1 `ActionPlan v1` com duas prioridades, owner e vínculo ao snapshot;
- 1 `Commitment v1`, com owner, prazo, status `DONE`, `completed_at` e evidência.

O banco recusou `DONE` sem evidência pela constraint `val_commitments_done_evidence_check`. `InsightCard v1` não possui persistência própria nesta fase: é um read model derivado, validado pelos testes VIS e pelo smoke `/api/v1/insights`.

### Provas de tenant safety

| Tentativa negativa | Resultado |
|---|---|
| Tenant B referenciar cliente do tenant A em Commitment | SQLSTATE `23503`, `val_commitments_client_same_tenant_fkey` |
| Owner do tenant B em ActionPlan do tenant A | SQLSTATE `23503`, `val_action_plans_owner_same_tenant_fkey` |
| Snapshot do tenant A em ActionPlan do tenant B | SQLSTATE `23503`, `val_action_plans_snapshot_same_tenant_fkey` |
| Sobrescrever tenant na API de repositório | 403, falha fechada |
| Listar Commitment do tenant A como tenant B | zero registros |

O verificador da Fase 1 confirmou ainda owner incorreto com zero clientes, cliente cross-tenant negado, zero registros do Manual vazados e sessão assinada de outro tenant rejeitada.

## Backup e restore comprovados

O backup custom foi criado pelo utilitário oficial `scripts/db-backup.mjs`:

- arquivo: `valor360-staging-2026-08-22T21-05-00-544Z.dump`;
- formato: `pg_dump --format=custom`;
- tamanho: 185.798 bytes;
- SHA-256: `057dfffad05191084104bf43df486285b24a3f0fb3c143e542d26b05d487c12f`.

O utilitário `scripts/db-restore-verify.mjs` restaurou esse arquivo no segundo PostgreSQL 16 em 143 ms na execução observada. Esse tempo é evidência do ensaio, não compromisso de RTO produtivo.

Após o restore:

- o detector oficial `db-drift.mjs --strict` retornou zero drift;
- o catálogo semântico de colunas, constraints explícitas e índices foi byte a byte idêntico, SHA-256 `3d3d43393e7c3d90169665b6dac68def0e766ce7c5def2146602a4f2135178e8`;
- contagens, IDs e hashes de linhas coincidiram para clientes, visitas, memórias, snapshots, recomendações, ActionPlans e Commitments;
- 23 constraints explícitas da Fase 5 estavam validadas;
- 11 índices das duas novas tabelas estavam presentes, incluindo PKs;
- os verificadores das Fases 1 e 3 passaram em modo restore;
- ActionPlan, Commitment, snapshot, owner, prazo, status e evidência foram recuperados;
- o bloqueio cross-tenant foi repetido no banco restaurado.

Contagens restauradas: 2 organizações, 2 usuários, 2 memberships, 3 clientes, 1 visita, 8 memórias após os fixtures de contexto, 2 snapshots, 1 recomendação, 1 ActionPlan e 1 Commitment.

## Testes executados

| Execução | Resultado |
|---|---|
| Baseline antes das alterações — `node --test` | 419/419 |
| Suíte final — comando equivalente ao script `npm test` | **458/458**, 0 falhas, 0 skips |
| Casos obrigatórios MEX/VIS/Preparar Visita | **28/28** |
| Testes novos totais da Fase 5 | **39/39** |
| Recorte operacional negativo de isolamento/Core/MMI/MCTX/MIC/MDI/MVV/MEX/VIS | **65/65** |
| Verificador Fase 1 no restore | aprovado |
| Verificador MMI/MCTX no restore | aprovado |
| Drift pós-migration e pós-restore | zero em ambos |
| OpenAPI | YAML válido, 9 paths |
| `git diff --check` | aprovado |

O wrapper `npm test` foi interrompido pelo mecanismo de aprovação da sessão antes de iniciar o processo (“Network request disconnected before approval could complete”). O script correspondente no `package.json` é exatamente `node --test`; esse comando foi executado diretamente sobre o estado final e passou em 458/458 testes. Portanto, não houve falha de teste do projeto.

### Casos obrigatórios 1–28

| Faixa | Evidência | Status |
|---|---|---|
| 1–7 MEX | máximo três ações; sugestão incompleta; prazo; conclusão com evidência; vencimento no contexto; cross-tenant; vínculo com tese | 7/7 |
| 8–15 VIS | limite; ACT_NOW; PREPARE; FOLLOW_UP; LEARN; expiração; hipótese; permissão | 8/8 |
| 16–20 Perfis | analítico, relacional, inovador, conservador e desconhecido | 5/5 |
| 21–28 Preparação | lacuna de solo; preço sem desconto; limites; compromisso-alvo; visita técnica; foco; cross-tenant | 8/8 |

Testes complementares provaram alinhamento runtime/JSON Schema, OpenAPI, expand-only, simplicidade da UI, auditoria MEX/VIS no VAL Core, persistência PostgreSQL, rejeição de ActionPlan fora da carteira, lifecycle, evidência e bloqueios por ator/tenant.

## Smokes HTTP

### Legado e Core v1

- `/live`: 200;
- `/api/val/status`: 200;
- recomendação legada: 200, sem envelope novo imposto;
- `/api/v1/val/recommendations`: 200, `val.response.v1`, rota `prepare_visit.v1`;
- execução continua por `LEGACY_VAL_ENGINE`;
- composição aprovada continua `conversion → innovation`.

### Fase 5

- criação legada de visita: 201;
- preparação v1: 201, `val.prepare_visit.v1`, duas prioridades no fixture;
- recuperação da preparação: 200;
- criação de compromisso: 201;
- conclusão com evidência: 200;
- feed de insights: 200, `val.insight_feed.v1`.

## Builds

| Build | Resultado | Observação não bloqueante |
|---|---|---|
| Principal Vite | aprovado; 1.701 módulos | warning existente de chunks acima de 500 kB |
| PWA stamp/verify | aprovado; cache `valor360-vb4eaeebecdc2e1f9` | será recarimbado quando houver commit autorizado |
| Manual Next.js | aprovado; TypeScript e páginas concluídos | warning existente de múltiplos lockfiles/root do Turbopack |

## Isolamento, segurança e observabilidade

- Tenant enviado pelo cliente não substitui o tenant da sessão.
- Contextos, planos, visitas e compromissos são resolvidos pelo servidor e filtrados por tenant/carteira.
- FKs novas usam pares `(tenant_id,id)` quando existe vínculo persistido.
- Tentativas cross-tenant são barradas antes de leitura ou persistência.
- Um ator de outra carteira não lista nem altera compromisso.
- ActionPlan inexistente ou fora da carteira é rejeitado.
- Telemetria registra somente IDs/referências, versões, módulos, confiança, latência e resultado; não registra conteúdo comercial sensível.
- `request_id`, snapshot, perfil, tese, plano de valor, ActionPlan, insights e compromissos permanecem correlacionáveis.
- Os testes de segurança agronômica e `ValEngine` continuaram passando; nenhuma barreira foi relaxada.

## Compatibilidade e escopo preservado

Confirmado sem diff funcional:

- `server/val-engine.js`;
- `server/sales-playbook.js` e prompts;
- `server/val-methodology.js`;
- `server/innovation-bootstrap.js`;
- `database/schema.sql`;
- migrations históricas;
- `manual/**`.

Também foram preservados autenticação, sessão, Cliente 360, Opportunities, Portfolio Radar, payload `radar`, APIs legadas, Structured Outputs, fallback determinístico e safety agronômica.

## Arquivos da Fase 5

Novos:

- `server/execution/{contracts,action-plan,commitment,insight-card,prepare-visit,composition,service}.js`;
- `contracts/v1/{action-plan,commitment,insight-card,prepare-visit}.schema.json`;
- `database/migrations/20260822_003_execution_insight_expand.sql`;
- `scripts/phase5-smoke.mjs`;
- `test/phase5-{contracts,mex,vis,prepare-visit,repository}.test.js`;
- `docs/phase-5/ADR-005-execution-insight.md`;
- `docs/phase-5/{ACTION_PLAN_v1,COMMITMENT_v1,INSIGHT_CARD_v1,PREPARE_VISIT_v1,PLANO_FASE_5}.md`;
- `GATE_FASE_5_RESULTADO.md`.

Alterados estritamente para integração:

- contratos/OpenAPI: `contracts/v1/README.md`, `contracts/v1/response-envelope.schema.json`, `openapi/val-core-v1.yaml`;
- runtime: `server.js`, `server/conversion-bootstrap.js`, `server/repository.js`, `server/memory/context-snapshot.js`, `server/observability.js`;
- Core: `server/core/contracts.js`, `server/core/router.js`, `server/core/val-core.js`;
- UI: `src/components/ConversionRadar.jsx`, `src/pages/Visits.jsx`, `src/styles.css`;
- testes/scripts: `test/phase2-core-router.test.js`, `package.json`.

Artefatos não rastreados das fases anteriores presentes no worktree foram preservados e não fazem parte do Passo 05.

## Riscos remanescentes

| Risco | Situação e proteção |
|---|---|
| Prioridade VIS | pesos são experimentais, versionados e não exibidos como KPI; calibrar somente com governança futura |
| Escopo gerencial de equipe | continua limitado pela autorização/carteira existente; não ampliar tenancy ou papel de gestor nesta fase |
| Crescimento de ActionPlans | cada preparação é auditável; definir retenção/arquivamento em fase de governança, sem exclusão destrutiva agora |
| Bundle principal | warning de tamanho preexistente; não fazer code splitting fora do escopo do Passo 05 |
| Registro pós-visita | áudio, transcrição e `Interaction` completo continuam deliberadamente fora desta fase e pertencem ao Passo 06 |
| Restore em escala real | o ensaio usou fixtures sintéticos; RPO/RTO produtivos ainda dependem de volume, rede e runbook do ambiente |

## Rollback disponível

Rollback de aplicação:

1. voltar ao commit-base `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` por procedimento Git revisado;
2. remover/desabilitar somente as rotas e componentes aditivos da Fase 5;
3. manter `val_action_plans` e `val_commitments` sem leitura pelo binário anterior, preservando dados.

Rollback estrutural, apenas em ambiente descartável e após backup:

1. remover primeiro `val_commitments`;
2. remover depois `val_action_plans`;
3. remover apenas os índices novos que forem comprovadamente exclusivos desta migration.

O rollback preferencial é de aplicação, não destrutivo. Nenhuma estrutura ou dado legado precisa ser restaurado porque não foi modificado.

## Matriz final do gate

| # | Critério | Status | Evidência principal |
|---:|---|---|---|
| 1 | MEX transforma tese em no máximo três ações | APROVADO | casos 1 e 24 |
| 2 | Commitment possui owner, prazo e status | APROVADO | casos 2–4 e testes de repositório |
| 3 | VIS mostra prioridades por papel | APROVADO | casos 8, 12 e 15 |
| 4 | Cards explicam `why_now` | APROVADO | contrato, UI e caso 8 |
| 5 | Preparação consome Passos 03–04 | APROVADO | serviço e persistência rastreável |
| 6 | Perguntas de Ouro corretas e limitadas | APROVADO | casos 21 e 23 |
| 7 | Perfil altera abordagem, não fatos | APROVADO | casos 16–20 e safety |
| 8 | Ausência de dados permanece lacuna | APROVADO | casos 20–21 |
| 9 | Visita técnica não força venda | APROVADO | caso 26 |
| 10 | Cross-tenant continua bloqueado | APROVADO | casos 6, 15, 28 e recorte operacional 65/65 |
| 11 | APIs legadas continuam compatíveis | APROVADO | smoke legado/Core v1 |
| 12 | Suíte completa passa | APROVADO | 458/458 |
| 13 | Builds principal/PWA e Manual passam | APROVADO | três builds concluídos |
| 14 | Barreiras agronômicas não regrediram | APROVADO | safety e `ValEngine` dentro da suíte final |
| 15 | Migration expand-only executa e é idempotente | APROVADO | `applied` → `already-applied`, checksum preservado |
| 16 | Backup e restore preservam schema e dados | APROVADO | catálogo idêntico, hashes idênticos e drift zero |
| 17 | Isolamento persiste após restore | APROVADO | verificadores Fases 1/3 e FKs negativas no segundo PG16 |

## Evidências geradas

Os artefatos de prova permanecem em `.gate/phase5-operational/`, incluindo:

- `pre-migration-summary.json` e `pre-migration-drift.json`;
- `post-migration-summary-before-phase5-data.json` e `post-migration-drift.json`;
- `source-phase5-persistence-evidence.json` e `source-final-data-summary.json`;
- `backups/valor360-staging-2026-08-22T21-05-00-544Z.dump` e seus metadados;
- `restore-tool-evidence.json` e `restore-data-comparison.json`;
- `restore-drift.json`;
- `restore-phase1-isolation-evidence.json`;
- `restore-phase3-context-evidence.json`;
- `restore-phase5-evidence.json`;
- catálogos semânticos de origem e restore com hashes idênticos.

## Conclusão

**GATE FASE 5 APROVADO — MIGRATION VALIDADA.**

Migration, backup, restore e regressão foram comprovados em ambiente controlado. MEX converte a inteligência aprovada em execução pequena e verificável; VIS mostra atenção acionável sem transformar a Home em BI; Preparar Visita fecha o vínculo entre contexto, perfil, tese, valor e próximo compromisso. A evolução permanece aditiva, tenant-safe e reversível.

O Passo 06 não foi iniciado. Aguardando autorização explícita para qualquer publicação ou continuidade.
