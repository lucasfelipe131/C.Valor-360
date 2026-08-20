import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {assertControlledDatabase,databaseSsl,databaseTarget,postgresCliEnv} from '../scripts/lib/controlled-database.mjs'

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8')

test('URLs de staging e restore são aceitas sem habilitar SSL local',()=>{
  const staging='postgresql://gate:gate-only@127.0.0.1:5432/val_staging'
  const restore='postgresql://gate:gate-only@localhost:5432/val_restore'
  assert.equal(assertControlledDatabase(staging).name,'val_staging')
  assert.equal(databaseTarget(restore).name,'val_restore')
  assert.equal(databaseSsl(staging),undefined)
  assert.equal(databaseSsl(restore),undefined)
  assert.deepEqual(postgresCliEnv(staging,{}),{
    PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'gate',PGPASSWORD:'gate-only',PGDATABASE:'val_staging',PGSSLMODE:'disable'
  })
})

test('scripts de recuperação falham fechados para um database sem marca controlada',()=>{
  const productionLike='postgresql://example:secret@database.example.com:5432/railway'
  assert.throws(()=>assertControlledDatabase(productionLike),/não parece controlado/)
  assert.equal(assertControlledDatabase(productionLike,{confirmation:'STAGING_ONLY',requiredConfirmation:'STAGING_ONLY'}).name,'railway')
  assert.deepEqual(databaseSsl(productionLike),{rejectUnauthorized:false})
})

test('CI cria PostgreSQL efêmero e prova migração, isolamento, backup e restore',()=>{
  const workflow=read('.github/workflows/validate.yml')
  assert.match(workflow,/name: phase1 gate staging/)
  assert.match(workflow,/image: postgres:16/)
  assert.match(workflow,/POSTGRES_DB: val_staging/)
  assert.match(workflow,/node scripts\/phase1-staging-verify\.mjs/)
  assert.match(workflow,/npm run db:backup/)
  assert.match(workflow,/npm run db:restore:verify/)
  assert.match(workflow,/node scripts\/phase1-restore-compare\.mjs/)
  assert.match(workflow,/retention-days: 7/)
  assert.match(workflow,/include-hidden-files: true/)
  assert.doesNotMatch(workflow,/railway\.internal|production\.up\.railway\.app/)
})

test('manifesto automático só aprova o banco após todas as evidências',()=>{
  const manifest=read('scripts/phase1-gate-manifest.mjs')
  for(const proof of ['driftDetected','scopeOverrideDenied','crossTenantClientDenied','manualCrossTenantRows','foreignSignedSessionRejected','backupSha256','rollbackProven'])assert.match(manifest,new RegExp(proof))
  assert.match(manifest,/databaseGatePassed:true/)
})

test('restore direciona explicitamente o pg_restore ao database descartável',()=>{
  const restore=read('scripts/db-restore-verify.mjs')
  assert.match(restore,/\['--dbname',restoreTarget\.name/)
})
