# Plano pré-alteração — Passo 03 MMI + MCTX

Data do plano: 2026-08-20
Base obrigatória: commit `498ebf3f31fde404dd11fb7eca894e6c85b7169a`
Branch local: `phase3/memory-context`
Regra: evoluir, não reconstruir.

Este plano foi apresentado antes da primeira alteração local. A execução não autoriza produção, deploy, merge, commit, push, PR ou Passo 04.

## 1. Auditoria anterior à alteração

### Leituras atuais de memória e contexto

- `ValRepository.getClientContext`, em `server/repository.js`, é a única implementação-base de contexto do produtor. Ela lê cliente, perfil, sinais, aprendizado, `val_memories`, negócios, visitas, interações, oportunidades, propriedades, relatórios, solo, NDVI, eventos do Manual e recomendações anteriores, sempre por `tenant_id` e carteira do consultor.
- `ValRepository.getTechnicalContext` lê a memória vigente de chave `consultant_technical_context`.
- `ValEngine.answer` chama `getClientContext`, acrescenta anexos autorizados, Decision Intelligence e Value Bridge e envia uma versão compactada ao modelo.
- `decision-intelligence.js`, `conversion-engine.js`, o orquestrador de conversa, a especificidade e o playbook consomem o contexto retornado. O array `memories` é um contrato legado interno e precisa continuar disponível.
- `val_recommendations.input_context` preserva o contexto usado, mas antes do Passo 03 não possuía identificador ou versão de snapshot.
- `val_conversations` e `val_messages` existem no schema, mas não formam hoje um pipeline operacional de promoção de conversa para memória.

### Escritas atuais

- `saveTechnicalContext` é o único writer operacional material de `val_memories`. Ele preservava versões anteriores, porém expressava a relação apenas em `evidence` e usava `expired` tanto para vencimento quanto para correção.
- `database/schema.sql` contém importações históricas append-only de contexto técnico legado.
- `recordRecommendation` grava contexto, fontes, conteúdo gerado e execução do modelo.
- Não existe writer que transforme automaticamente conversa, simulado ou texto do modelo em fato. Essa ausência será preservada.

### Sobreposições dos bootstraps

Ordem explícita herdada do Passo 02:

1. `conversion-bootstrap.js` envolve `ValRepository.getClientContext` e acrescenta `conversionFoundation`.
2. `innovation-bootstrap.js` envolve o método já alterado e acrescenta `conversionInnovations`.

O bootstrap de conversão também envolve `recordRecommendation`, `ValEngine.answer`, `getIntelligence` e `ValEngine.status`. Nenhum desses patches será removido no Passo 03; novos testes devem provar que a ordem e os seis métodos permanecem os mesmos.

### Estruturas existentes reutilizadas

- `val_memories`: ID, tenant, cliente, tipo legado, chave, valor, evidência, confiança, status, origem, validade e timestamps.
- `val_recommendations`: recomendação e `input_context` auditável.
- `val_conversations` e `val_messages`: preservadas para evolução futura, sem promoção automática nesta fase.
- Cliente 360 e coleções técnicas/comerciais: continuam como fontes relacionais autorizadas do MCTX.
- compactação por relevância/recência: preservada como fallback para contextos sem snapshot.
- RequestEnvelope e ResponseEnvelope v1: permanecem imutáveis e compatíveis.

### Lacunas localizadas

`val_memories` não distinguia domínio da memória de estado epistemológico e não possuía campos canônicos para sujeito, `source_ref`, `source_type`, ACL, criador ou supersessão. `getClientContext` lia somente registros vigentes, impossibilitando ao MCTX explicar correções, expirações e conflitos. Recomendações não apontavam para um snapshot versionado. A compactação limitava volume, mas não separava fatos, inferências, hipóteses, lacunas, conflitos e informação vencida.

## 2. Mudanças previstas

### Novos arquivos

- `database/migrations/20260820_002_memory_context_expand.sql`
- `server/memory/contracts.js`
- `server/memory/context-snapshot.js`
- `server/memory/freshness-policy.js`
- `contracts/v1/memory-record.schema.json`
- `contracts/v1/context-snapshot.schema.json`
- documentação em `docs/phase-3/`
- testes `test/phase3-*.test.js`
- `scripts/phase3-staging-verify.mjs` e dois passos aditivos no workflow existente para prova em PostgreSQL efêmero antes e depois do restore
- `GATE_FASE_3_RESULTADO.md`

### Arquivos modificados

- `server/repository.js`: leitura histórica autorizada, snapshot e supersessão física.
- `server/val-engine.js`: entrega do snapshot mínimo ao modelo e referência na resposta.
- `server/conversion-bootstrap.js`: propagação do contexto versionado no wrapper atual.
- `server/core/val-core.js`: ligação entre RequestEnvelope v1 e ContextSnapshot v1.
- `server/observability.js`: metadados seguros do snapshot.
- `contracts/v1/README.md` e `openapi/val-core-v1.yaml`: referências aditivas.
- testes de caracterização existentes somente para provar a correção append-only sem ampliar os valores aceitos pelo status legado.

### Arquivos que não serão alterados

- `database/schema.sql` e migration histórica `20260820_001_manual_tenant_scope_expand.sql`.
- contratos RequestEnvelope v1 e ResponseEnvelope v1.
- prompts e `server/sales-playbook.js`.
- autenticação, front-end, Manual do Agrônomo e SOG.
- IDs e dados existentes.
- composição física dos bootstraps.

## 3. SQL expand proposto e impacto

A migration é exclusivamente aditiva. Em `val_memories`, adiciona campos nullable:

`subject_type`, `subject_id`, `memory_state`, `memory_domain`, `source_ref`, `source_type`, `observed_at`, `source_updated_at`, `freshness_policy_version`, `freshness_metadata`, `supersedes_id`, `created_by` e `acl`.

Cria `val_context_snapshots` como entidade imutável de primeira classe, com tenant, request, ator, sujeito, objetivo, versões das políticas, `selected_refs`, `excluded_refs`, `exclusion_reason_codes`, confiança, payload e timestamps.

Em `val_recommendations`, adiciona:

`context_snapshot_id` e `context_snapshot_version`.

Não existe backfill. A migration não contém `UPDATE` e não classifica memória legada. Campos novos permanecem `NULL` até escrita/curadoria explícita. Nenhum status, tipo, origem, ID ou dado existente é reinterpretado.

Uma FK composta garante que `supersedes_id` só referencie memória do mesmo tenant. Outra FK composta garante que uma recomendação só referencie snapshot do próprio tenant. Índices atendem sujeito vigente, supersessão, busca por sujeito/request/ator e auditoria GIN de refs selecionadas/excluídas e motivos.

Impacto esperado: locks de catálogo durante `ALTER TABLE` e construção de índices/tabela nova, sem reescrita de linhas legadas. Antes de uso real, a migration deve ser executada em PostgreSQL isolado/staging, com medição de tempo e locks.

## 4. Estratégia de compatibilidade

- `context.memories` continua com os registros vigentes usados pelos motores atuais.
- `context.memoryHistory` é aditivo e inclui versões anteriores para o MCTX.
- `context.contextSnapshot` é aditivo.
- `val_context_snapshots` é a identidade canônica; a cópia em `input_context` permanece para leitores legados.
- APIs legadas continuam recebendo o mesmo objeto de recomendação, acrescido apenas de `contextSnapshotId` e `contextSnapshotVersion`.
- ResponseEnvelope v1 não muda de shape; o snapshot aparece dentro da recomendação e como `evidence_ref`.
- Contextos sem snapshot continuam usando o compactador legado.

## 5. Testes planejados

1. histórico legado continua recuperável;
2. versão nova prevalece sobre `superseded`;
3. validade vencida não entra como fato atual;
4. fontes materiais divergentes geram conflito;
5. ausência permanece `missing_information`;
6. tenant, sujeito, ator, papel e ACL bloqueiam acesso indevido;
7. ausência de histórico não cria conteúdo;
8. dez anos de histórico são selecionados e compactados;
9. análise de solo antiga recebe `STALE`;
10. perfil comportamental permanece hipótese com evidência;
11. recomendação aponta por FK tenant-safe e persiste ContextSnapshot v1 como entidade separada;
12. `selected_refs`, `excluded_refs` e `exclusion_reason_codes` ficam auditáveis e a telemetria registra somente contagens/códigos agregados;
13. RequestEnvelope/ResponseEnvelope v1 e APIs legadas permanecem compatíveis;
14. migration é expand-only, sem `UPDATE` e sem reescrita histórica;
15. observabilidade não registra conteúdo sensível ou refs individuais;
16. suíte completa, build principal, build do Manual e smokes do Passo 02.

## 6. Riscos e mitigação

- **Drift/migration não aplicada:** código novo consulta colunas novas. Mitigação: migrate antes da aplicação e gate em PostgreSQL controlado.
- **Classificação excessiva do legado:** mitigação: nenhum backfill; ausência de campo canônico entra no fallback runtime mais restritivo e nunca é persistida automaticamente.
- **Conflitos falsos:** só registros atuais de fontes com autoridade mínima entram; conflito apenas sinaliza confirmação, não escolhe vencedor.
- **Volume de histórico:** SQL limita 250 registros e seleção material limita 24; o modelo recebe versão ainda menor.
- **Vazamento cross-tenant:** filtro SQL, autorização no contrato e exclusão anterior à criação de qualquer ref.
- **Mudança dos bootstraps:** wrappers permanecem; testes de composição continuam obrigatórios.
- **Freshness agronômica indevida:** registry por domínio/fonte, sem TTL universal; 730 dias vale somente para a regra operacional de análise de solo e não declara validade agronômica.

## 7. Rollback

- Antes da migration: descartar somente as mudanças locais da branch.
- Depois da migration expand: reverter a aplicação para `498ebf3` e manter colunas/índices aditivos. Não executar `DROP COLUMN` como rollback normal.
- A versão anterior usa o status legado `expired`; a relação `supersedes_id` permite que o MCTX a projete como `SUPERSEDED` sem ampliar ou reinterpretar o check histórico.
- Recomendações e memórias criadas mantêm IDs e conteúdo.
- Qualquer contract/drop futuro pertence a fase posterior, com backup e aprovação separados.

## 8. Gate objetivo

O Passo 03 só será aprovado se toda recomendação apontar para contexto autorizado, rastreável e corrigível, com:

- baseline e novos testes verdes;
- supersessão, stale, conflito e lacuna comprovados;
- ContextSnapshot v1 validado;
- tentativa cross-tenant sem memória, conteúdo ou ref recuperável;
- compatibilidade das APIs e contratos do Passo 02;
- builds e smokes verdes;
- migration validada em banco controlado ou impedimento registrado como reprovação do gate.
