# Plano da Fase 6 — primeiro ciclo vertical de visita

## 1. Base e limite da fase

- Branch local: `phase6/visit-learning-loop`.
- Base confirmada no remoto: `phase5/execution-insight` em `ea82fdaa9a401505e661be5409e21ae2d6a3112a`.
- Estratégia: evoluir o monólito modular e os contratos já aprovados; não criar um segundo sistema de visitas.
- Fora de escopo: produção, Railway, deploy, publicação Git, Passo 07, aprendizado automático, promoção de conhecimento, troca de prompts, refatoração ampla do `ValEngine` e redesign de interface.

## 2. Auditoria do estado atual

| Área | Estado atual | Decisão da Fase 6 |
|---|---|---|
| Lifecycle de visita | `visits.status` é texto livre; a API legada cria `Agendada`; data passada não conclui a visita | Preservar `status` legado e adicionar lifecycle v1 separado, nullable para registros históricos |
| API de visitas | `POST /api/visits`; `GET/POST /api/v1/visits/:id/preparation` | Preservar e acrescentar report, confirmação, outcome e learning-context em `/api/v1` |
| PrepareVisit | Compõe `ContextSnapshot`, `BehavioralProfile`, `DecisionThesis`, `ValuePlan` e `ActionPlan` | Reutilizar integralmente; persistir versões de preparação sem apagar a anterior |
| Preparação persistida | Fica em `val_action_plans.preparation_payload`; leitura retorna o plano mais recente | Preservar; criar referência/versionamento de primeira classe ligado ao plano atual |
| Interações | Tabela `interactions` existe e é recuperada pelo contexto; não há gravação pós-visita na API atual | Reutilizar como registro canônico da interação confirmada e acrescentar transcript/report rastreável |
| Oportunidades | `opportunities` e `POST /api/opportunities` existem | Reutilizar; criar somente oportunidade confirmada, com origem no report |
| Compromissos | `Commitment v1`, transições e vínculos tenant-safe já existem | Reutilizar; propostas permanecem candidatas até confirmação humana |
| Outcomes | `business_events` cobre negócio; `val_feedback` cobre reação/execução de recomendação | Preservar ambos; criar `Outcome v1` geral para visita, inclusive técnico e relacional |
| IA e auditoria | Recomendações, `model_runs`, snapshots e observabilidade já existem | Não alterar prompts/`ValEngine`; usar extração determinística e serviço de transcrição abstrato nesta sessão |
| Attachments | Upload até 6 MB em `val_attachments`, com status e confirmação | Preservar; áudio referencia attachment existente, sem redesenhar storage |
| Áudio/transcrição | Não existe serviço operacional | Criar contrato e porta abstrata testável; mock em testes e falha segura sem provedor |
| Aprendizado | Documento offline e sinais agregados; não há `LearningCandidate` de primeira classe | Criar candidato auditável sempre em `CANDIDATE`; nunca promover a `KnowledgeItem` |

## 3. Responsabilidades e composição

### Reutilizar sem reconstruir

- `ValRepository`, tenancy e autorização da carteira.
- `prepareVisitExecution`, `PrepareVisit v1` e `val_action_plans`.
- `ActionPlan v1`, `Commitment v1`, `InsightCard v1`.
- `getClientContext` e `ContextSnapshot v1`.
- `val_memories`, com origem, estado epistemológico, ACL e freshness da Fase 3.
- `interactions`, `opportunities`, `val_attachments`, `audit_events` e observabilidade.
- API legada, front-end React atual e barreiras agronômicas.

### Expandir

- `VisitLifecycle v1` com transições explícitas e histórico auditável.
- preparação versionada, preservando cada regeneração.
- transcript rastreável e `VisitReport v1` candidato.
- confirmação/edit/remove/add antes de qualquer consolidação.
- `Outcome v1` e `LearningCandidate v1`.
- leitura do contexto de aprendizado para alimentar a preparação seguinte.
- UI mínima: um botão “Registrar visita”, texto ou áudio referenciado, revisão e confirmação.

### Permanecer legado

- `visits.status`, inclusive o valor `Agendada`.
- resumos livres já presentes em `visits` e `interactions`.
- `business_events` e `val_feedback` como contratos próprios.
- IDs e dados existentes; nenhum backfill inferencial ou reclassificação.

## 4. Fluxo proposto

1. A visita legada é agendada e recebe lifecycle `PLANNED` somente em novas escritas da Fase 6.
2. Preparar visita cria nova versão de preparação e registra `PREPARED`; versões anteriores permanecem.
3. Texto livre ou transcript vindo da porta de áudio gera `VisitReport v1` em `PENDING_REVIEW`.
4. O relatório separa `FACT_CANDIDATE`, `INFERENCE` e `HYPOTHESIS`; nada é consolidado.
5. O consultor confirma, edita, remove ou adiciona itens.
6. Em uma transação tenant-safe, a confirmação:
   - grava interação confirmada;
   - promove apenas fatos explicitamente confirmados para `val_memories`;
   - cria compromissos completos por `Commitment v1`;
   - cria oportunidades confirmadas;
   - registra próximo passo explícito, inclusive `NO_ACTION_REQUIRED`;
   - conclui o lifecycle da visita;
   - cria `Outcome v1` quando informado;
   - cria somente `LearningCandidate v1/CANDIDATE`.
7. A próxima chamada de `getClientContext` recupera interação, memória, compromisso, outcome e candidato; uma nova preparação usa esse histórico.

## 5. Fronteira determinística e abstração de áudio

- Determinístico: contratos, lifecycle, validações, tenant, confirmação, estados, datas explícitas, persistência, idempotência e safety.
- Extração local desta fase: padrões conservadores para fixtures; conteúdo não reconhecido permanece nota/lacuna.
- Áudio: `TranscriptionProvider` abstrato. Sem provedor configurado, retorna erro degradável e mantém o attachment intacto; testes usam mock. Nenhum conteúdo de áudio/transcript entra em telemetria.
- Datas relativas só são resolvidas quando há âncora e resultado inequívoco. Ambiguidade mantém `due_at` ausente e exige confirmação.

## 6. Migration proposta

Será criada uma única migration exclusivamente expand-only. Ela deverá:

- adicionar colunas nullable de lifecycle a `visits`, sem tocar em `status`;
- criar tabelas tenant-safe para histórico de lifecycle, versões de preparação, transcripts, reports, outcomes e learning candidates;
- criar índices de recuperação por tenant/visita/status/data;
- usar FKs compostas `(tenant_id, id)` onde a entidade-alvo já oferece chave única composta;
- não atualizar linhas existentes, não alterar IDs, não validar/reclassificar legado e não remover estruturas.

O SQL completo, objetos afetados, compatibilidade e rollback serão apresentados antes de qualquer aplicação.

## 7. Arquivos previstos

### Novos

- `server/visit-loop/contracts.js`
- `server/visit-loop/lifecycle.js`
- `server/visit-loop/report.js`
- `server/visit-loop/audio.js`
- `server/visit-loop/service.js`
- `contracts/v1/visit-lifecycle.schema.json`
- `contracts/v1/visit-report.schema.json`
- `contracts/v1/outcome.schema.json`
- `contracts/v1/learning-candidate.schema.json`
- `database/migrations/20260823_004_visit_learning_loop_expand.sql`
- documentação da Fase 6 exigida pelo gate
- testes unitários, de contrato, repositório, API, UI, tenancy, áudio e ciclo vertical

### Alterações aditivas

- `server/repository.js`: métodos tenant-safe; nenhuma remoção de método.
- `server.js`: novas rotas `/api/v1`; nenhuma mudança de resposta legada.
- `server/observability.js`: apenas novos campos permitidos, todos identificadores/metadados.
- `server/execution/service.js` e preparação: persistência de versão e consumo do aprendizado confirmado.
- `src/pages/Visits.jsx` e CSS existente: UI mínima de registro/revisão.
- `openapi/val-core-v1.yaml`, `contracts/v1/README.md`, `package.json` se necessário para smoke explícito.
- `database/schema.sql` permanece como baseline histórico; a evolução é aplicada exclusivamente pela nova migration ordenada, como nas Fases 3 e 5.

### Não alterar

- `server/val-engine.js`.
- `server/sales-playbook.js` e prompts.
- bootstraps de conversão/inovação.
- autenticação e contratos públicos legados.
- migrations históricas das Fases 1–5.
- aplicação do Manual.
- configuração de produção/Railway.

## 8. Riscos e proteções

| Risco | Proteção |
|---|---|
| duplicar confirmação/compromisso em retry | idempotency key e confirmação transacional |
| interpretar texto como fato | estado candidato obrigatório e confirmação humana |
| data relativa incorreta | bloquear compromisso sem data inequívoca/confirmada |
| vazamento cross-tenant | todas as queries filtradas por tenant + owner + vínculos compostos + testes negativos |
| reclassificar visita histórica | colunas novas nullable, sem backfill |
| prescrição agronômica por relato | observação técnica candidata, `requires_review`, sem dose/produto automático |
| sobrescrever preparação | tabela de versões append-only |
| tornar resultado comercial o único aprendizado | Outcome v1 inclui técnico, relacional, follow-up e no-change |
| logar conteúdo sensível | allowlist de IDs/status/latência; sem texto/transcript/audio |
| criar conhecimento automaticamente | constraint e serviço criam somente status `CANDIDATE` |

## 9. Testes e gate

- Os 32 casos obrigatórios terão rastreabilidade explícita `requisito → teste`.
- Haverá characterization para API legada, PrepareVisit, ActionPlan e Commitment.
- Haverá contract tests dos quatro novos contratos e OpenAPI.
- Haverá testes negativos para visit, report/transcript, commitment, outcome e learning candidate.
- O cenário central produzirá duas preparações e provará que a segunda inclui objeção, solicitação, compromisso, sinal comportamental, oportunidade, outcome e lacuna originados da primeira visita.
- Regressão: suíte completa, 28 casos MEX/VIS, smokes legado/Core/Fase 5/Fase 6, build principal/PWA e build do Manual.

O gate só será aprovado se o marco “a próxima visita é melhor porque a visita anterior aconteceu” for demonstrado sem regressão, sem promoção automática de conhecimento e sem acesso cross-tenant.

## 10. Rollback

- Código: remover apenas rotas/módulo aditivos ou retornar à base `ea82fdaa…`; APIs legadas continuam independentes.
- Banco: rollback operacional preferencial é parar novas escritas e manter tabelas/colunas aditivas inertes. Um script de remoção estrutural será documentado apenas para banco efêmero vazio/validado, nunca aplicado automaticamente nem em produção.
- Dados: nenhum rollback destrutivo é necessário para restaurar compatibilidade porque consumidores antigos ignoram as novas estruturas.
