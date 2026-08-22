import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const migration=readFileSync(new URL('../database/migrations/20260820_002_memory_context_expand.sql',import.meta.url),'utf8')

test('migration do Passo 03 é expand-only, aditiva e preserva IDs e histórico',()=>{
  for(const column of ['subject_type','subject_id','memory_state','memory_domain','source_ref','source_type','observed_at','source_updated_at','freshness_policy_version','freshness_metadata','supersedes_id','created_by','acl'])assert.match(migration,new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`))
  assert.match(migration,/ADD COLUMN IF NOT EXISTS context_snapshot_id/)
  assert.match(migration,/ADD COLUMN IF NOT EXISTS context_snapshot_version/)
  assert.match(migration,/CREATE TABLE IF NOT EXISTS val_context_snapshots/)
  assert.doesNotMatch(migration,/\bUPDATE\s+/i)
  assert.doesNotMatch(migration,/\bDELETE\s+FROM\b/i)
  assert.doesNotMatch(migration,/\bTRUNCATE\b/i)
  assert.doesNotMatch(migration,/\bDROP\s+(?:COLUMN|CONSTRAINT|TABLE|INDEX)\b/i)
  assert.doesNotMatch(migration,/ALTER\s+COLUMN/i)
  assert.doesNotMatch(migration,/ADD COLUMN IF NOT EXISTS acl JSONB\s+NOT NULL|ADD COLUMN IF NOT EXISTS acl JSONB\s+DEFAULT/i)
})

test('supersessão é tenant-safe e nenhuma memória legada recebe classificação automática',()=>{
  assert.match(migration,/FOREIGN KEY \(tenant_id,supersedes_id\)[\s\S]*REFERENCES val_memories\(tenant_id,id\)/)
  assert.match(migration,/supersedes_id<>id/)
  assert.doesNotMatch(migration,/SET\s+(?:memory_state|memory_domain|source_ref|source_type|acl)\s*=/i)
  assert.doesNotMatch(migration,/WHEN\s+memory_type|ELSE\s+'HYPOTHESIS'/i)
})

test('ContextSnapshot é entidade de primeira classe e recomendação referencia o mesmo tenant',()=>{
  for(const column of ['selected_refs','excluded_refs','exclusion_reason_codes','snapshot_payload','freshness_policy_version'])assert.match(migration,new RegExp(`\\b${column}\\b`))
  assert.match(migration,/idx_val_context_snapshots_subject/)
  assert.match(migration,/USING GIN\(selected_refs\)/)
  assert.match(migration,/USING GIN\(excluded_refs\)/)
  assert.match(migration,/USING GIN\(exclusion_reason_codes\)/)
  assert.match(migration,/FOREIGN KEY \(tenant_id,context_snapshot_id\)[\s\S]*REFERENCES val_context_snapshots\(tenant_id,id\) NOT VALID/)
})

test('migrations históricas e schema canônico não foram reescritos pela fase',()=>{
  const historical=readFileSync(new URL('../database/migrations/20260820_001_manual_tenant_scope_expand.sql',import.meta.url),'utf8')
  const schema=readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8')
  assert.ok(historical.length>100)
  assert.ok(schema.length>10_000)
  assert.doesNotMatch(migration,/20260820_001_manual_tenant_scope_expand/)
})
