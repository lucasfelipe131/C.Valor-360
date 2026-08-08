import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

test('migração legacy é versionada, bloqueada e preserva contexto técnico',async()=>{
  const sql=await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')
  assert.match(sql,/pg_advisory_xact_lock/)
  assert.match(sql,/schema_migrations/)
  assert.match(sql,/legacy-v03-copy-v1/)
  assert.match(sql,/legacy-v03-technical-context-v2/)
  assert.match(sql,/legacy-v03-technical-context-canonical-v3/)
  assert.match(sql,/technical_context_legacy_v03/)
  assert.match(sql,/clients já canônico, mas technical_context ainda com o nome legado/)
  assert.match(sql,/'consultant_technical_context'/)
  assert.match(sql,/LEFT\(preferred_channel,60\)/)
  assert.match(sql,/RAISE WARNING 'VALOR 360 ignorou % perfil\(is\) legacy sem client_id canônico/)
  assert.match(sql,/WHERE legacy\.client_id IS NULL OR client\.id IS NULL/)
  assert.match(sql,/jsonb_build_object\('property',(?:legacy\.)?property_name,'crops','','area','','weeds'/)
  assert.match(sql,/'soil',(?:legacy\.)?soil_summary,'goal',(?:legacy\.)?producer_goal/)
  assert.match(sql,/SET valid_from=COALESCE\(legacy\.updated_at,memory\.valid_from\)/)
  assert.match(sql,/row_number\(\) OVER/)
  assert.match(sql,/INSERT INTO val_memories/)
  assert.match(sql,/profile_snapshot JSONB NOT NULL DEFAULT '\{\}'::jsonb/)
  assert.match(sql,/SET profile_snapshot=survey\.result/)
  assert.match(sql,/COMMIT;/)
})
