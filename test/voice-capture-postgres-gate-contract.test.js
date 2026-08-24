import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const seed=read('../scripts/voice-capture-ci-seed.sql')
const verifier=read('../scripts/voice-capture-postgres-verify.mjs')
const workflow=read('../.github/workflows/validate.yml')
const job=workflow.slice(workflow.indexOf('  voice-capture-gate-postgres:'))

test('Voice PostgreSQL gate — seed é sintético, tenant-separated e sem dados externos',()=>{
 assert.match(seed,/Fixtures totalmente sintéticos/)
 assert.match(seed,/voice-a@example\.test/)
 assert.match(seed,/voice-b@example\.test/)
 assert.match(seed,/Tenant adversarial Voice Capture/)
 assert.match(seed,/producer-voice-a/)
 assert.match(seed,/producer-voice-a2/)
 assert.match(seed,/producer-voice-b/)
 assert.doesNotMatch(seed,/railway|production|produ[cç][aã]o|OPENAI_API_KEY|DATABASE_URL/i)
})

test('Voice PostgreSQL gate — verificador usa módulos reais e cobre os quatro contextos',()=>{
 for(const module of [
  'ValRepository','prepareVisitExecution','createVisitLoopService','createVoiceCaptureService',
  'createRepositoryAttachmentVoiceStorage','createMockTranscriptionProvider','createVoiceCandidateExtractor'
 ])assert.match(verifier,new RegExp(module))
 for(const type of ['PRE_VISIT','FIELD_NOTE','CLIENT_NOTE','POST_VISIT'])assert.match(verifier,new RegExp(type))
 assert.match(verifier,/Promise\.all\(\[/)
 assert.match(verifier,/voice_review_incomplete/)
 assert.match(verifier,/cross_tenant_scope_denied/)
 assert.match(verifier,/audio_not_found/)
 for(const relation of ['actor_matches_interaction','client_matches_interaction','visit_matches_interaction','audio_same_tenant'])assert.match(verifier,new RegExp(relation))
 assert.match(verifier,/anexo pertencente a outro ator\/produtor/)
 assert.match(verifier,/VALIDATED_KNOWLEDGE/)
 assert.match(verifier,/secondEvidence\.score>firstEvidence\.score/)
 assert.match(verifier,/additional_decider/)
})

test('Voice PostgreSQL gate — source e restore comparam catálogo, dados e referências',()=>{
 assert.match(verifier,/VOICE_CAPTURE_VERIFY_MODE/)
 assert.match(verifier,/runSource\(\)/)
 assert.match(verifier,/runRestore\(\)/)
 assert.match(verifier,/catalog\.fingerprint,expected\.catalog\.fingerprint/)
 assert.match(verifier,/fingerprint,expected\.data_fingerprint/)
 assert.match(verifier,/migration 005 restaurada diverge da origem/i)
 assert.match(verifier,/assertPersisted\(expected\.ids\)/)
 assert.match(verifier,/assertIsolation\(expected\.ids\)/)
})

test('Voice PostgreSQL gate — workflow é independente, PostgreSQL 16 e produz evidência recuperável',()=>{
 assert.ok(job.length>0)
 assert.match(job,/image: postgres:16/)
 assert.match(job,/20260823_005_voice_capture_expand\.sql/)
 assert.match(job,/migration-005-repeat\.log/)
 assert.match(job,/npm run db:drift -- --strict/)
 assert.match(job,/VOICE_CAPTURE_VERIFY_MODE: source/)
 assert.match(job,/VOICE_CAPTURE_VERIFY_MODE: restore/)
 assert.match(job,/pg_dump[\s\S]*--format=custom/)
 assert.match(job,/pg_restore --exit-on-error/)
 assert.match(job,/voice-capture-gate-evidence-/)
 assert.doesNotMatch(job,/OPENAI_API_KEY|DATABASE_PUBLIC_URL|production\.up\.railway/i)
})
