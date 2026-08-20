import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {applyVersionedMigrations,listVersionedMigrations} from '../server/migration-runner.js'

test('migrations novas são ordenadas, idempotentes e protegidas por checksum',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'val-migrations-'))
  try{
    await writeFile(join(directory,'20260820_002_second.sql'),'SELECT 2;')
    await writeFile(join(directory,'20260820_001_first.sql'),'SELECT 1;')
    assert.deepEqual((await listVersionedMigrations(directory)).map(item=>item.version),['20260820_001_first','20260820_002_second'])
    const versions=new Map();const executed=[]
    const connection={query:async(sql,params=[])=>{
      if(/^SELECT checksum FROM schema_migrations/.test(sql)){const checksum=versions.get(params[0]);return {rowCount:checksum?1:0,rows:checksum?[{checksum}]:[]}}
      if(/^INSERT INTO schema_migrations/.test(sql)){versions.set(params[0],params[1]);return {rowCount:1,rows:[]}}
      if(/^UPDATE schema_migrations SET checksum/.test(sql)){versions.set(params[0],params[1]);return {rowCount:1,rows:[]}}
      if(/^SELECT [12];$/.test(sql.trim()))executed.push(sql.trim())
      return {rowCount:0,rows:[]}
    }}
    const database={transaction:work=>work(connection)}
    assert.deepEqual((await applyVersionedMigrations(database,{directory,logger:()=>{}})).map(item=>item.status),['applied','applied'])
    assert.deepEqual(executed,['SELECT 1;','SELECT 2;'])
    assert.deepEqual((await applyVersionedMigrations(database,{directory,logger:()=>{}})).map(item=>item.status),['already-applied','already-applied'])
    await writeFile(join(directory,'20260820_001_first.sql'),'SELECT 99;')
    await assert.rejects(()=>applyVersionedMigrations(database,{directory,logger:()=>{}}),/Migration histórica alterada/)
  }finally{await rm(directory,{recursive:true,force:true})}
})

test('migration expand do Passo 01 é aditiva e deixa contract para outra fase',async()=>{
  const migration=(await listVersionedMigrations()).find(item=>item.version==='20260820_001_manual_tenant_scope_expand')
  assert.ok(migration)
  assert.match(migration.sql,/ADD COLUMN IF NOT EXISTS tenant_id/)
  assert.match(migration.sql,/NOT VALID/)
  assert.doesNotMatch(migration.sql,/\bDROP\s+(?:TABLE|COLUMN)\b/i)
  assert.doesNotMatch(migration.sql,/ALTER\s+COLUMN\s+tenant_id\s+SET\s+NOT\s+NULL/i)
})
