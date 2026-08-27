import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const root=new URL('../',import.meta.url)
const read=path=>readFile(new URL(path,root),'utf8')

test('gate vNext executa geometria e provenance em PostgreSQL 16 com repeat e restore',async()=>{
  const workflow=await read('.github/workflows/validate.yml')
  assert.match(workflow,/vnext-data-gate-postgres:/)
  assert.match(workflow,/image: postgres:16/)
  assert.match(workflow,/VNEXT_VERIFY_MODE: source/)
  assert.match(workflow,/VNEXT_VERIFY_MODE: repeat/)
  assert.match(workflow,/VNEXT_VERIFY_MODE: restore/)
  assert.match(workflow,/20260827_007_attachment_scan_provenance_expand\.sql/)
  assert.match(workflow,/val-vnext-postgres-verify\.mjs/)
  assert.match(workflow,/db:drift -- --strict/)
  assert.match(workflow,/pg_dump[\s\S]*pg_restore/)
})

test('verificador usa somente fixtures sintéticas e falha fechado sem PostgreSQL controlado',async()=>{
  const source=await read('scripts/val-vnext-postgres-verify.mjs')
  assert.match(source,/assertControlledDatabase/)
  assert.match(source,/Fallback JSON não é permitido/)
  assert.match(source,/syntheticDataOnly:true/)
  assert.match(source,/AgronomicGeometryAdapter\.v1/)
  assert.match(source,/AgronomicScanProvenance\.v1/)
  assert.match(source,/cross_tenant_geometry_denied/)
  assert.match(source,/scan_attachment_scope_invalid/)
  assert.match(source,/invalidCoordinatesRollback:'PASS'/)
  assert.doesNotMatch(source,/production\.up\.railway\.app/i)
})

test('migration 007 é expansiva, repetível e não apaga registros',async()=>{
  const migration=await read('database/migrations/20260827_007_attachment_scan_provenance_expand.sql')
  assert.match(migration,/ALTER COLUMN client_id DROP NOT NULL/i)
  assert.match(migration,/CREATE INDEX IF NOT EXISTS idx_val_attachments_unlinked_date/i)
  assert.doesNotMatch(migration,/\b(?:DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i)
})
