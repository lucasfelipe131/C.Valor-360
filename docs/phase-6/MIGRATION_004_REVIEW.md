# Revisão pré-aplicação — migration 004 da Fase 6

Arquivo integral: `database/migrations/20260823_004_visit_learning_loop_expand.sql`.

## Classificação

`EXPAND-ONLY`.

O arquivo contém exclusivamente:

- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`;
- criação idempotente de índices;
- constraints aditivas, com `NOT VALID` nas novas regras aplicadas à tabela legada `visits`;
- criação de novas tabelas;
- comentários de documentação.

Não contém `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `RENAME`, mudança de tipo, `SET NOT NULL` em coluna legada, backfill ou classificação automática.

## Tabela existente afetada

`visits` recebe oito colunas nullable:

- `lifecycle_status`;
- `lifecycle_version`;
- `lifecycle_revision`;
- `occurred_at`;
- `completed_at`;
- `cancelled_at`;
- `lifecycle_updated_at`;
- `lifecycle_updated_by`.

O campo legado `visits.status` não é removido, renomeado, atualizado ou reinterpretado.

## Novas tabelas

1. `val_visit_lifecycle_events`;
2. `val_visit_preparations`;
3. `val_visit_transcripts`;
4. `val_visit_reports`;
5. `val_outcomes`;
6. `val_learning_candidates`.

## Índices adicionados

- chaves compostas auxiliares em `interactions`, `val_attachments` e `val_recommendations`;
- recuperação de visitas por lifecycle;
- histórico de lifecycle por visita/request;
- preparação mais recente por visita e snapshot;
- transcript por visita/attachment;
- report por visita/status e cliente confirmado;
- outcome por visita e cliente/tipo;
- learning candidate por visita/status e outcome.

## Constraints e isolamento

- enums versionados por `CHECK`;
- payloads JSON com forma de objeto/array;
- confidence entre 0 e 1;
- confirmação exige `confirmed_by` e `confirmed_at`;
- transcript concluído exige texto e timestamp; falha exige código;
- todas as relações materiais usam FKs compostas `(tenant_id, id)`;
- atores usam `(tenant_id, user_id)` de `memberships`.

## Compatibilidade retroativa

- consumidores antigos continuam lendo `visits.status` e ignoram as colunas nullable;
- nenhuma linha histórica recebe lifecycle por inferência;
- APIs e tabelas legadas permanecem com a mesma forma;
- IDs existentes não são alterados;
- `interactions`, `val_attachments`, `val_recommendations`, `val_action_plans`, `val_commitments`, `val_context_snapshots`, `clients` e `visits` são reutilizadas por referência, sem cópia ou reclassificação;
- a migration pode ser aplicada antes do código da Fase 6, pois nenhum campo novo é obrigatório para escritas legadas.

## Rollback

O rollback operacional recomendado é desabilitar as rotas/feature da Fase 6 e deixar as estruturas aditivas inertes. Isso restaura imediatamente o comportamento anterior sem destruir dados.

Somente em PostgreSQL efêmero, vazio de dados reais e após exportação das evidências, o rollback estrutural seria:

```sql
DROP TABLE IF EXISTS val_learning_candidates;
DROP TABLE IF EXISTS val_outcomes;
DROP TABLE IF EXISTS val_visit_reports;
DROP TABLE IF EXISTS val_visit_transcripts;
DROP TABLE IF EXISTS val_visit_preparations;
DROP TABLE IF EXISTS val_visit_lifecycle_events;

DROP INDEX IF EXISTS idx_visits_lifecycle;
DROP INDEX IF EXISTS idx_interactions_tenant_id_id;
DROP INDEX IF EXISTS idx_val_attachments_tenant_id_id;
DROP INDEX IF EXISTS idx_val_recommendations_tenant_id_id;

ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_lifecycle_updated_by_fkey;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_lifecycle_revision_check;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_lifecycle_status_check;
ALTER TABLE visits DROP COLUMN IF EXISTS lifecycle_updated_by;
ALTER TABLE visits DROP COLUMN IF EXISTS lifecycle_updated_at;
ALTER TABLE visits DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE visits DROP COLUMN IF EXISTS completed_at;
ALTER TABLE visits DROP COLUMN IF EXISTS occurred_at;
ALTER TABLE visits DROP COLUMN IF EXISTS lifecycle_revision;
ALTER TABLE visits DROP COLUMN IF EXISTS lifecycle_version;
ALTER TABLE visits DROP COLUMN IF EXISTS lifecycle_status;
```

Esse rollback físico é destrutivo e não será executado automaticamente nem em produção.
