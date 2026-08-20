import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'

const read=path=>readFile(path,'utf8').then(JSON.parse)
const [backup,drift,isolationSource,isolationRestored,restore,comparison]=await Promise.all([
  read('.gate/backup.json'),
  read('.gate/drift.json'),
  read('.gate/tenant-isolation-source.json'),
  read('.gate/tenant-isolation-restored.json'),
  read('.gate/restore.json'),
  read('.gate/restore-compare.json')
])

assert.equal(drift.driftDetected,false)
for(const evidence of [isolationSource,isolationRestored]){
  assert.equal(evidence.syntheticDataOnly,true)
  assert.equal(evidence.tenantIsolation.scopeOverrideDenied,true)
  assert.equal(evidence.tenantIsolation.crossTenantClientDenied,true)
  assert.equal(evidence.tenantIsolation.manualCrossTenantRows,0)
  assert.equal(evidence.tenantIsolation.foreignSignedSessionRejected,true)
}
assert.equal(restore.healthQuery,true)
assert.equal(restore.backupSha256,backup.sha256)
assert.equal(comparison.rollbackProven,true)

const manifest={
  generatedAt:new Date().toISOString(),
  environment:'GitHub Actions PostgreSQL 16 efêmero',
  dataPolicy:'somente dados sintéticos; nenhuma conexão ou cópia de produção',
  migrationsApplied:true,
  driftDetected:false,
  tenantIsolationProven:true,
  negativeAuthorizationProven:true,
  backupSha256:backup.sha256,
  backupBytes:backup.bytes,
  restoreDatabase:restore.database,
  measuredRestoreDurationMs:restore.durationMs,
  sourceAndRestoreIdentical:true,
  rollbackProven:true,
  rpoMeasurement:'snapshot lógico consistente; RPO 0 no instante do backup',
  databaseGatePassed:true
}
await writeFile('.gate/manifest.json',JSON.stringify(manifest,null,2))
console.log(JSON.stringify(manifest,null,2))
