import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const workflow=readFileSync(new URL('../.github/workflows/validate.yml',import.meta.url),'utf8')
const verifier=readFileSync(new URL('../scripts/phase3-staging-verify.mjs',import.meta.url),'utf8')

test('CI prepara PostgreSQL efêmero e repete MMI/MCTX depois do restore',()=>{
  assert.match(workflow,/services:\s+postgres:/)
  assert.match(workflow,/node scripts\/phase3-staging-verify\.mjs/g)
  assert.match(workflow,/phase3-memory-context-source\.json/)
  assert.match(workflow,/phase3-memory-context-restored\.json/)
  assert.match(workflow,/GATE_VERIFY_ONLY: "true"/)
})

test('verificador de staging falha fechado e prova todos os invariantes materiais',()=>{
  assert.match(verifier,/assertControlledDatabase/)
  assert.match(verifier,/if\(!verifyOnly\)/)
  assert.match(verifier,/status==='expired'/)
  assert.match(verifier,/currentSupersedesPrevious/)
  assert.match(verifier,/staleProven:true/)
  assert.match(verifier,/conflictProven:true/)
  assert.match(verifier,/gapProven:true/)
  assert.match(verifier,/scopeOverrideDenied/)
  assert.match(verifier,/foreignMemoryVisibleInTenantA:false/)
  assert.match(verifier,/context_snapshot_version='val\.context_snapshot\.v1'/)
  assert.match(verifier,/FROM val_context_snapshots/)
  assert.match(verifier,/firstClassSnapshotPersisted:true/)
  assert.match(verifier,/selectionAuditProven:true/)
  assert.match(verifier,/\(\$3::uuid\)::text/)
  assert.doesNotMatch(verifier,/\$3::text/)
})
