# Plano da Fase 5 — MEX + VIS

## 1. Marco e restrições

- Branch local: `phase5/execution-insight`.
- Base exata: `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` (`origin/phase4/behavior-decision-value`).
- Baseline antes de alterações: `419` testes, `419` aprovados, `0` falhas.
- Execução exclusivamente local.
- Sem commit, push, PR, merge, Railway, deploy, produção ou Passo 06.
- Autenticação, `ValEngine`, prompts, APIs legadas, front-end existente e migrations históricas serão preservados.

## 2. Auditoria do patrimônio atual

### 2.1 Visit — lifecycle efetivo

| Etapa | Implementação atual | Limite atual | Decisão da Fase 5 |
|---|---|---|---|
| Agendar | `POST /api/visits` → `ValRepository.saveVisit` → tabela `visits` | exige produtor, data/hora e objetivo | preservar integralmente |
| Listar | `GET /api/intelligence` retorna visitas da carteira do ator | não há endpoint próprio de leitura | preservar resposta legada; usar leitura interna tenant-safe |
| Preparar | botão de `Visits.jsx` abre a VAL genérica para o produtor | não vincula roteiro à visita nem a um snapshot | acrescentar preparação versionada por visita |
| Executar/registrar | campos `summary`, `process_agreement`, `next_commitment` existem no schema | não há API ou UI de conclusão | não implementar áudio/registro pós-visita nesta fase |
| Comprometer | `next_commitment` textual e `interactions.commitments` em JSONB | não existe entidade, owner, prazo, estado ou evidência governados | introduzir `Commitment v1` aditivo |
| Acompanhar | `next_action_at` em visita/oportunidade | não há state machine do compromisso | introduzir lifecycle mínimo do compromisso |

### 2.2 Opportunity

- `POST /api/opportunities` e `ValRepository.saveOpportunity` fazem upsert tenant/cliente/consultor-safe.
- A tabela já possui estágio, próxima ação, prazo, valor, margem, probabilidade e evidências.
- O pipeline atual continua sendo a fonte canônica de oportunidades.
- Oportunidades secundárias serão apenas candidatas no preparo; não haverá criação automática nem troca do foco principal.

### 2.3 Commitment Ladder

- `server/commitment-ladder.js` já modela o menor “sim” verificável.
- Ele distingue etapa administrativa de consentimento e exige evidência explícita.
- Será reutilizado como fonte de orientação. Não será convertido em segunda state machine nem substituído.
- `Commitment v1` formalizará a execução aceita; a Ladder continuará orientando o próximo compromisso possível.

### 2.4 Radar, dashboards e workspaces

| Ativo | Reuso |
|---|---|
| `server/portfolio-radar.js` | gatilhos, evidências, prazo, visita e ranking determinístico existentes |
| `ConversionRadar.jsx` | componente visual, estados de carregamento/erro/vazio e ação de abrir produtor |
| `Dashboard.jsx` | Home e encaixe atual do radar |
| `ValWorkspace` / `ValDecisionWorkspace` | permanecem como experiência geral da VAL |
| `Visits.jsx` | agenda e cards atuais; receberá preparação inline e compromisso em poucos cliques |
| `Client360.jsx` | permanece sem redesign; contexto segue acessível à composição |
| `Opportunities.jsx` | pipeline permanece canônico; sem mudança estrutural |

### 2.5 Contratos já aprovados consumidos

- `RequestEnvelope v1` e `ResponseEnvelope v1` continuam no Core.
- `ContextSnapshot v1` fornece contexto autorizado, lacunas, conflitos, freshness e evidências.
- `BehavioralProfile v1`, `DecisionThesis v1` e `ValuePlan v1` serão consumidos, não recriados.
- A composição da Fase 5 será determinística e aditiva após MIC/MDI/MVV.

### 2.6 Compromissos hoje sem entidade formal

- `visits.next_commitment` — texto livre.
- `interactions.commitments` — JSONB sem contrato de lifecycle.
- `opportunities.next_action` + `next_action_at` — ação e prazo, mas sem aceite/owner/evidência de conclusão.
- `Commitment Ladder` — orientação calculada, não persistência de compromisso assumido.
- recomendações — `next_best_action`/`commitment_target` dentro do JSON da recomendação.

Nenhuma dessas estruturas será apagada ou reinterpretada. `Commitment v1` será uma expansão paralela apenas no nível de persistência, ligada aos registros atuais por IDs explícitos quando eles existirem.

## 3. Gaps a fechar

1. `ActionPlan` não é contrato versionado nem objeto rastreável.
2. não há `Commitment` formal com owner, prazo, critério, estado e evidência.
3. compromisso vencido não aparece explicitamente no próximo `ContextSnapshot`.
4. o radar atual não publica `InsightCard v1`, categorias, expiração e política por papel.
5. a Home não formula a pergunta “O que merece minha atenção agora?”.
6. o preparo não está vinculado à visita nem consome explicitamente os artefatos das Fases 3–4.
7. não há APIs v1 de preparação, planos, compromissos e insights.
8. a observabilidade não conhece IDs/versões de MEX e VIS.

## 4. Desenho de implementação

### 4.1 MEX

Criar `server/execution/` com:

- validadores e enums estáveis de `ActionPlan v1`, `Commitment v1`, `InsightCard v1` e `PrepareVisit v1`;
- seleção determinística de até três ações usando impacto, urgência registrada, confiança, dependência, risco, estágio e compromisso existente;
- referências estáveis e rastreáveis para `DecisionThesis` e `ValuePlan`, sem alterar os contratos aprovados da Fase 4;
- classificação explícita: ação sem owner, prazo ou critério permanece `PROPOSED` e não é persistida como compromisso válido;
- transições de compromisso com conclusão condicionada à evidência;
- composição aditiva após MIC/MDI/MVV, sem mudar prompt ou `ValEngine`.

### 4.2 VIS

- Evoluir o Portfolio Radar por adapter para `InsightCard v1`; não criar um segundo radar concorrente.
- Combinar radar, compromissos, visitas, follow-ups e aprendizado autorizado.
- Filtrar por tenant, ator, carteira e papel antes de retornar cards.
- Limitar o feed principal a cinco cards.
- Ignorar cards expirados e resolvidos.
- Marcar baixa confiança como hipótese.
- Usar política experimental versionada de score; o índice não será apresentado como KPI oficial.
- Preservar `radar` no payload legado e acrescentar `insights` de forma compatível.

### 4.3 Preparar Visita

- `POST /api/v1/visits/:id/preparation` resolve visita, tenant, ator e produtor no servidor.
- A composição usa o `ContextSnapshot` autorizado e os builders aprovados de MIC/MDI/MVV.
- MEX cria o `ActionPlan`; VIS produz a apresentação simples.
- A resposta mostra objetivo, oportunidade principal, por que agora, abordagem, até três perguntas, tese, provas, objeção, orientação, compromisso-alvo, até três ações, lacunas e oportunidades secundárias.
- Visitas técnicas/relacionais/pós-venda não receberão fechamento comercial forçado.
- A preparação será persistida junto ao `ActionPlan` para auditoria e recuperação por `GET`.

### 4.4 Persistência

Decisão:

- `ActionPlan`: persistido, porque vincula snapshot, tese/plano, visita e futuras transições.
- `Commitment`: persistido como entidade formal e append/audit-aware.
- `InsightCard`: derivado sob demanda de fontes persistidas, com ID determinístico e expiração. Não será criada tabela nesta fase; isso evita estado duplicado e garante que card expirado/resolvido não permaneça ativo. Histórico/feedback de cards fica explicitamente fora do gate local desta fase.

## 5. Migration prevista — exclusivamente EXPAND

Arquivo novo: `database/migrations/20260822_003_execution_insight_expand.sql`.

Objetos aditivos previstos:

- índices únicos compostos `(tenant_id,id)` em `clients`, `visits` e `opportunities`, necessários para FKs tenant-safe;
- tabela `val_action_plans`;
- tabela `val_commitments`;
- índices de leitura por visita, cliente, owner, status e prazo;
- constraints de enum/JSON e FKs compostas tenant-safe;
- nenhuma remoção, rename, backfill, reclassificação ou alteração de IDs/dados existentes.

O DDL novo permanecerá na migration versionada. `database/schema.sql` é aplicado antes das migrations e não contém a tabela do Passo 03; repetir ali FKs para `val_context_snapshots` quebraria instalações limpas. As migrations `20260820_001` e `20260820_002` não serão alteradas.

Rollback operacional:

1. desabilitar as rotas/componentes aditivos e voltar ao commit-base;
2. manter as tabelas novas sem leitura pelo binário anterior (rollback preferencial, sem perda);
3. somente em banco descartável e após backup, o rollback estrutural documentado poderá remover `val_commitments` e `val_action_plans` e os índices exclusivamente novos;
4. nenhuma estrutura legada precisa ser restaurada porque não será modificada.

## 6. APIs aditivas

| Método/rota | Uso |
|---|---|
| `POST /api/v1/visits/:id/preparation` | gerar e persistir preparação/ActionPlan |
| `GET /api/v1/visits/:id/preparation` | recuperar a preparação mais recente autorizada |
| `POST /api/v1/action-plans` | persistir ActionPlan v1 já validado e vinculado |
| `POST /api/v1/commitments` | criar somente compromisso estruturalmente válido |
| `GET /api/v1/commitments` | listar compromissos da carteira/cliente autorizados |
| `PATCH /api/v1/commitments/:id` | transicionar estado, evidência, bloqueio ou conclusão |
| `GET /api/v1/insights` | retornar feed `InsightCard v1` autorizado e não expirado |

`POST /api/visits`, `POST /api/opportunities`, `/api/intelligence`, `/api/val/*` e `/api/v1/val/recommendations` permanecerão compatíveis.

## 7. Arquivos previstos

### Novos

- `server/execution/contracts.js`
- `server/execution/action-plan.js`
- `server/execution/commitment.js`
- `server/execution/insight-card.js`
- `server/execution/prepare-visit.js`
- `server/execution/composition.js`
- `contracts/v1/action-plan.schema.json`
- `contracts/v1/commitment.schema.json`
- `contracts/v1/insight-card.schema.json`
- `contracts/v1/prepare-visit.schema.json`
- `database/migrations/20260822_003_execution_insight_expand.sql`
- `test/phase5-contracts.test.js`
- `test/phase5-mex.test.js`
- `test/phase5-vis.test.js`
- `test/phase5-prepare-visit.test.js`
- `test/phase5-repository.test.js`
- `docs/phase-5/ADR-005-execution-insight.md`
- `docs/phase-5/ACTION_PLAN_v1.md`
- `docs/phase-5/COMMITMENT_v1.md`
- `docs/phase-5/INSIGHT_CARD_v1.md`
- `docs/phase-5/PREPARE_VISIT_v1.md`
- `GATE_FASE_5_RESULTADO.md`

### Alterações estritamente necessárias

- `server/conversion-bootstrap.js` — adapter aditivo MEX/VIS após MIC/MDI/MVV.
- `server/repository.js` — persistência tenant-safe e inclusão de compromissos no contexto.
- `server/memory/context-snapshot.js` — compromissos vencidos em `relationship_context`.
- `server/portfolio-radar.js` — somente integração/reuso pelo VIS, se necessária.
- `server/observability.js` — allowlist dos novos IDs/versões.
- `server/core/contracts.js` e `server/core/val-core.js` — auditoria aditiva dos módulos, preservando envelopes v1.
- `server/core/router.js` — incluir MEX/VIS na rota lógica de preparo, sem trocar o adapter legado.
- `server.js` — rotas v1 protegidas e compatíveis.
- `database/schema.sql` — auditado e deliberadamente não alterado por causa da ordem `schema-base → migrations versionadas`.
- `openapi/val-core-v1.yaml` e `contracts/v1/README.md` — documentação dos contratos.
- `src/pages/Visits.jsx` — preparo inline e aceite de compromisso.
- `src/components/ConversionRadar.jsx` e `src/pages/Dashboard.jsx` — renderizar `InsightCard v1` e a pergunta da Home.
- `src/styles.css`/`src/conversion-radar.css` — apenas estilos responsivos dos novos blocos.

### Deliberadamente não alterados

- autenticação/sessão e políticas de senha;
- `server/val-engine.js`;
- `server/sales-playbook.js` e prompts;
- `server/innovation-bootstrap.js`;
- contratos MMI/MCTX/MIC/MDI/MVV aprovados;
- migrations históricas;
- `manual/**`;
- telas e estilos sem relação com Home/Visitas;
- fluxo completo de áudio/interação pós-visita.

## 8. Testes

- 28 casos obrigatórios MEX/VIS/Preparar Visita, numerados conforme a autorização.
- contratos válidos, incompletos, cross-tenant e versão anterior.
- persistência, transição, conclusão com evidência e listagem owner/tenant-safe.
- migration expand-only, idempotência textual, FKs compostas e ausência de DDL destrutivo.
- smokes das rotas legadas e v1.
- `ContextSnapshot` com compromisso vencido.
- regressão integral: 419 testes-base, MIC/MDI/MVV, MMI/MCTX, Core e safety.
- `node --test`, build principal/PWA e build do Manual.

## 9. Riscos e proteções

| Risco | Proteção |
|---|---|
| transformar sugestão em compromisso | validação owner + prazo + critério antes de persistir |
| urgência artificial | somente datas/sinais registrados; score experimental documentado |
| duplicar radar | adapter sobre `PortfolioRadar`, mantendo payload legado |
| vazamento de tenant | resolução server-side, FKs compostas, guards e testes negativos |
| quebrar envelopes v1 | campos de auditoria opcionais/aditivos e contract tests |
| esconder lacuna técnica | `missing_information` visível; safety continua soberana |
| visita técnica virar venda | classificador de objetivo e testes específicos |
| crescimento de escopo para Passo 06 | nenhuma captura/transcrição/Interaction nova |
| UI congestionada | máximo cinco cards, três perguntas e três ações, mobile-first |

## 10. Gate objetivo

O gate só poderá ser classificado como aprovado quando houver evidência local de que:

1. MEX reduz ações para no máximo três;
2. compromisso válido possui owner, prazo, critério e status;
3. VIS filtra e prioriza por papel dentro do escopo autorizado;
4. todo card ativo explica `why_now` e uma ação;
5. preparação consome `ContextSnapshot`, `BehavioralProfile`, `DecisionThesis` e `ValuePlan`;
6. perguntas e ações respeitam o limite de três;
7. perfil altera abordagem, nunca fatos;
8. lacunas permanecem explícitas;
9. visita não comercial não força venda;
10. tentativas cross-tenant são bloqueadas;
11. APIs legadas permanecem compatíveis;
12. toda a suíte passa;
13. builds principal/PWA e Manual passam;
14. safety agronômica não regride.

O Passo 06 não será iniciado automaticamente.
