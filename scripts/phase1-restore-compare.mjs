import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import pg from 'pg'
import {assertControlledDatabase,databaseSsl} from './lib/controlled-database.mjs'

const sourceUrl=String(process.env.SOURCE_DATABASE_URL||process.env.STAGING_DATABASE_URL||'').trim()
const restoreUrl=String(process.env.RESTORE_DATABASE_URL||'').trim()
if(!sourceUrl||!restoreUrl)throw new Error('SOURCE_DATABASE_URL e RESTORE_DATABASE_URL são obrigatórias.')
if(sourceUrl===restoreUrl)throw new Error('Origem e restore devem ser bancos diferentes.')
assertControlledDatabase(sourceUrl,{confirmation:process.env.CONFIRM_CONTROLLED_STAGING,requiredConfirmation:'STAGING_ONLY'})
assertControlledDatabase(restoreUrl,{confirmation:process.env.CONFIRM_CONTROLLED_RESTORE,requiredConfirmation:'RESTORE_ONLY'})

const poolFor=connectionString=>new pg.Pool({connectionString,max:1,ssl:databaseSsl(connectionString)})
const source=poolFor(sourceUrl)
const restored=poolFor(restoreUrl)
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function snapshot(pool){
  const database=String((await pool.query('SELECT current_database() name')).rows[0].name)
  const tables=(await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map(row=>row.table_name)
  const counts={}
  for(const table of tables){
    if(!/^[a-z0-9_]+$/.test(table))throw new Error(`Nome de tabela inesperado: ${table}`)
    counts[table]=Number((await pool.query(`SELECT COUNT(*)::bigint count FROM ${table}`)).rows[0].count)
  }
  const columns=(await pool.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows
  const indexes=(await pool.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`)).rows
  const migrations=(await pool.query(`SELECT version,TRIM(COALESCE(checksum,'')) checksum FROM schema_migrations ORDER BY version`)).rows
  const synthetic=(await pool.query(`
    SELECT 'clients' entity,tenant_id::text tenant,external_key key,name value FROM clients WHERE source='phase1_gate'
    UNION ALL
    SELECT 'app_records',tenant_id::text,id::text,producer_name FROM app_records WHERE id IN ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302')
    ORDER BY entity,tenant,key`)).rows
  return {database,tables,counts,migrations,synthetic,schemaSha256:digest({columns,indexes}),dataSha256:digest({counts,migrations,synthetic})}
}

try{
  const sourceSnapshot=await snapshot(source)
  const restoredSnapshot=await snapshot(restored)
  assert.deepEqual(restoredSnapshot.tables,sourceSnapshot.tables)
  assert.deepEqual(restoredSnapshot.counts,sourceSnapshot.counts)
  assert.deepEqual(restoredSnapshot.migrations,sourceSnapshot.migrations)
  assert.deepEqual(restoredSnapshot.synthetic,sourceSnapshot.synthetic)
  assert.equal(restoredSnapshot.schemaSha256,sourceSnapshot.schemaSha256)
  assert.equal(restoredSnapshot.dataSha256,sourceSnapshot.dataSha256)
  const evidence={
    verifiedAt:new Date().toISOString(),
    sourceDatabase:sourceSnapshot.database,
    restoredDatabase:restoredSnapshot.database,
    tableCount:sourceSnapshot.tables.length,
    schemaSha256:sourceSnapshot.schemaSha256,
    dataSha256:sourceSnapshot.dataSha256,
    countsIdentical:true,
    migrationsIdentical:true,
    syntheticRowsIdentical:true,
    rollbackProven:true
  }
  if(process.env.COMPARE_EVIDENCE_FILE){
    await mkdir(dirname(process.env.COMPARE_EVIDENCE_FILE),{recursive:true})
    await writeFile(process.env.COMPARE_EVIDENCE_FILE,JSON.stringify(evidence,null,2))
  }
  console.log(JSON.stringify(evidence,null,2))
}finally{await Promise.all([source.end(),restored.end()])}
