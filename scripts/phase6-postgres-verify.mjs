import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {createDatabase} from '../server/db.js'
import {prepareVisitExecution} from '../server/execution/service.js'
import {ValRepository} from '../server/repository.js'
import {createMockTranscriptionProvider} from '../server/visit-loop/audio.js'
import {createVisitLoopService} from '../server/visit-loop/service.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const actorA='00000000-0000-4000-8000-000000000601'
const actorB='00000000-0000-4000-8000-000000000602'
const visitA='00000000-0000-4000-8000-000000000611'
const visitB='00000000-0000-4000-8000-000000000612'
const visitLegacy='00000000-0000-4000-8000-000000000613'
const audioA='00000000-0000-4000-8000-000000000621'
const legacyMemory='00000000-0000-4000-8000-000000000631'
const reportText='O produtor achou o preço caro e pediu comparativo. Não fechou. Pediu retorno em 2026-08-29 depois de falar com o sócio. Também comentou problema de buva numa área.'
const relevantTables=[
 'visits','val_memories','val_context_snapshots','val_action_plans','val_commitments','val_attachments',
 'val_visit_lifecycle_events','val_visit_preparations','val_visit_transcripts','val_visit_reports',
 'val_outcomes','val_learning_candidates','interactions','opportunities','audit_events'
]
const expectedConstraints=[
 'val_visit_lifecycle_events_visit_same_tenant_fkey',
 'val_visit_lifecycle_events_actor_same_tenant_fkey',
 'val_visit_preparations_visit_same_tenant_fkey',
 'val_visit_preparations_client_same_tenant_fkey',
 'val_visit_preparations_actor_same_tenant_fkey',
 'val_visit_preparations_snapshot_same_tenant_fkey',
 'val_visit_preparations_action_plan_same_tenant_fkey',
 'val_visit_transcripts_visit_same_tenant_fkey',
 'val_visit_transcripts_client_same_tenant_fkey',
 'val_visit_transcripts_actor_same_tenant_fkey',
 'val_visit_transcripts_interaction_same_tenant_fkey',
 'val_visit_transcripts_attachment_same_tenant_fkey',
 'val_visit_reports_visit_same_tenant_fkey',
 'val_visit_reports_client_same_tenant_fkey',
 'val_visit_reports_creator_same_tenant_fkey',
 'val_visit_reports_confirmer_same_tenant_fkey',
 'val_visit_reports_transcript_same_tenant_fkey',
 'val_outcomes_visit_same_tenant_fkey',
 'val_outcomes_client_same_tenant_fkey',
 'val_outcomes_report_same_tenant_fkey',
 'val_outcomes_recorder_same_tenant_fkey',
 'val_learning_candidates_visit_same_tenant_fkey',
 'val_learning_candidates_report_same_tenant_fkey',
 'val_learning_candidates_outcome_same_tenant_fkey',
 'val_learning_candidates_creator_same_tenant_fkey'
]
const expectedIndexes=[
 'idx_visits_lifecycle','idx_val_visit_lifecycle_events_visit','idx_val_visit_lifecycle_events_request',
 'idx_val_visit_preparations_visit_latest','idx_val_visit_preparations_snapshot',
 'idx_val_visit_transcripts_visit','idx_val_visit_transcripts_attachment',
 'idx_val_visit_reports_visit_status','idx_val_visit_reports_client_confirmed',
 'idx_val_outcomes_visit','idx_val_outcomes_client_type',
 'idx_val_learning_candidates_visit_status','idx_val_learning_candidates_outcome'
]

const mode=String(process.env.PHASE6_VERIFY_MODE||'source').toLowerCase()
const evidenceFile=process.env.PHASE6_EVIDENCE_FILE
const restoreEvidenceFile=process.env.PHASE6_RESTORE_EVIDENCE_FILE
assert.ok(process.env.DATABASE_URL,'DATABASE_URL é obrigatório para o verificador PostgreSQL da Fase 6.')
assert.ok(['source','restore'].includes(mode),'PHASE6_VERIFY_MODE deve ser source ou restore.')

const db=createDatabase({databaseUrl:process.env.DATABASE_URL,databaseSsl:false})
const repositoryA=new ValRepository({db,tenantId:tenantA,readStore:()=>({}),saveStore:()=>{}})
const repositoryB=new ValRepository({db,tenantId:tenantB,readStore:()=>({}),saveStore:()=>{}})
const serviceA=createVisitLoopService({repository:repositoryA,transcriptionProvider:createMockTranscriptionProvider({text:reportText,name:'postgres-gate-fixture'})})
const serviceB=createVisitLoopService({repository:repositoryB})

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const ordered=value=>JSON.stringify(stable(value))
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
const semanticConstraintDefinition=value=>String(value).replaceAll('::character varying::text','::character varying').replaceAll(']::text[]',']')

async function tableCounts(){
 const counts={}
 for(const table of relevantTables){
  const result=await db.query(`SELECT count(*)::int count FROM ${table}`)
  counts[table]=Number(result.rows[0].count)
 }
 return counts
}

async function dataFingerprint(){
 const rows=[]
 for(const table of relevantTables){
  const result=await db.query(`SELECT to_jsonb(record) payload FROM (SELECT * FROM ${table} ORDER BY id::text) record`)
  for(const row of result.rows)rows.push(`${table}:${ordered(row.payload)}`)
 }
 return hash(rows.join('\n'))
}

async function catalogEvidence(){
 const tables=await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)
 const columns=await db.query(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)
 const constraints=await db.query(`SELECT conname,contype,convalidated,pg_get_constraintdef(oid,true) definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname`)
 const indexes=await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`)
 const constraintNames=constraints.rows.map(row=>row.conname)
 const indexNames=indexes.rows.map(row=>row.indexname)
 for(const name of expectedConstraints)assert.ok(constraintNames.includes(name),`Constraint ausente: ${name}`)
 for(const name of expectedIndexes)assert.ok(indexNames.includes(name),`Índice ausente: ${name}`)
 const semanticConstraints=constraints.rows.map(row=>({...row,definition:semanticConstraintDefinition(row.definition)}))
 return {
  tables:tables.rows.map(row=>row.tablename),
  columns:columns.rows,
  constraints:constraints.rows,
  semantic_constraints:semanticConstraints,
  indexes:indexes.rows,
  fingerprint:hash({tables:tables.rows,columns:columns.rows,constraints:semanticConstraints,indexes:indexes.rows})
 }
}

async function assertLegacyUntouched(){
 const visit=await db.query(`SELECT id,status,lifecycle_status,lifecycle_version,lifecycle_revision,occurred_at,completed_at,cancelled_at,lifecycle_updated_at,lifecycle_updated_by FROM visits WHERE id=$1`,[visitLegacy])
 assert.equal(visit.rowCount,1)
 assert.equal(visit.rows[0].status,'Agendada')
 for(const key of ['lifecycle_status','lifecycle_version','lifecycle_revision','occurred_at','completed_at','cancelled_at','lifecycle_updated_at','lifecycle_updated_by'])assert.equal(visit.rows[0][key],null,`Visita legada reclassificada em ${key}`)
 const memory=await db.query(`SELECT id,key,memory_state,memory_domain,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,supersedes_id,created_by,acl FROM val_memories WHERE id=$1`,[legacyMemory])
 assert.equal(memory.rowCount,1)
 assert.equal(memory.rows[0].key,'legacy.phase6.fixture')
 for(const key of ['memory_state','memory_domain','source_ref','source_type','observed_at','source_updated_at','freshness_policy_version','freshness_metadata','supersedes_id','created_by','acl'])assert.equal(memory.rows[0][key],null,`Memória legada reclassificada em ${key}`)
}

async function assertIsolation(){
 assert.equal(await repositoryB.getVisit({tenantId:tenantB,ownerId:actorB,id:visitA}),null)
 assert.equal(await repositoryA.getVisit({tenantId:tenantA,ownerId:actorB,id:visitA}),null)
 await assert.rejects(
  ()=>serviceA.createReport({tenantId:tenantB,ownerId:actorA,visitId:visitA,input:{source_type:'TEXT',text:'Relato adversarial.'}}),
  error=>error?.code==='cross_tenant_denied'||error?.statusCode===403
 )
 await assert.rejects(
  ()=>serviceB.learningContext({tenantId:tenantB,ownerId:actorB,visitId:visitA}),
  error=>error?.statusCode===404
 )
 let constraintCode=null
 try{
  await db.query(`INSERT INTO val_visit_lifecycle_events (tenant_id,visit_id,actor_id,contract_version,from_status,to_status,reason_code,revision,metadata) VALUES ($1,$2,$3,'val.visit_lifecycle.v1',NULL,'PLANNED','CROSS_TENANT_NEGATIVE',0,'{}'::jsonb)`,[tenantB,visitA,actorB])
 }catch(error){constraintCode=error?.code}
 assert.equal(constraintCode,'23503','A FK tenant-safe deveria rejeitar visita de outro tenant.')
}

async function validatePersistedLoop(){
 const learning=await serviceA.learningContext({tenantId:tenantA,ownerId:actorA,visitId:visitA})
 assert.equal(learning.visit.lifecycleStatus,'COMPLETED')
 assert.equal(learning.preparations.length,1)
 assert.equal(learning.reports.length,1)
 assert.equal(learning.reports[0].confirmation_status,'CONFIRMED')
 assert.equal(learning.transcripts.length,1)
 assert.equal(learning.transcripts[0].status,'COMPLETED')
 assert.equal(learning.transcripts[0].transcript_text,null)
 assert.equal(learning.interactions.length,1)
 assert.equal(learning.commitments.length,1)
 assert.equal(learning.commitments[0].status,'ACCEPTED')
 assert.equal(learning.outcomes.length,1)
 assert.equal(learning.outcomes[0].outcome_type,'NO_DECISION')
 assert.equal(learning.learning_candidates.length,1)
 assert.equal(learning.learning_candidates[0].status,'CANDIDATE')
 const transcript=await db.query(`SELECT transcript_text,interaction_id,source_attachment_id FROM val_visit_transcripts WHERE tenant_id=$1 AND visit_id=$2`,[tenantA,visitA])
 assert.match(transcript.rows[0].transcript_text,/preço caro/i)
 assert.ok(transcript.rows[0].interaction_id)
 assert.equal(String(transcript.rows[0].source_attachment_id),audioA)
 const knowledge=await db.query(`SELECT count(*)::int count FROM val_memories WHERE tenant_id=$1 AND memory_state='VALIDATED_KNOWLEDGE'`,[tenantA])
 assert.equal(Number(knowledge.rows[0].count),0)
 const candidate=await db.query(`SELECT status FROM val_learning_candidates WHERE tenant_id=$1 AND source_visit_id=$2`,[tenantA,visitA])
 assert.deepEqual(candidate.rows.map(row=>row.status),['CANDIDATE'])
 return learning
}

async function runSource(){
 await assertLegacyUntouched()
 const legacyIdsBefore=await db.query(`SELECT id::text id FROM visits WHERE id=ANY($1::uuid[]) ORDER BY id`,[[visitA,visitB,visitLegacy]])
 const memoryCountBefore=Number((await db.query(`SELECT count(*)::int count FROM val_memories WHERE tenant_id=$1`,[tenantA])).rows[0].count)
 const first=await prepareVisitExecution({repository:repositoryA,tenantId:tenantA,actor:{id:actorA,role:'consultant'},visitId:visitA,requestId:'00000000-0000-4000-8000-000000000681',now:new Date('2026-08-23T10:00:00.000Z')})
 assert.equal(first.preparation.version,'val.prepare_visit.v1')
 const created=await serviceA.createReport({tenantId:tenantA,ownerId:actorA,actorId:actorA,visitId:visitA,input:{source_type:'AUDIO',attachment_id:audioA,idempotency_key:'phase6-postgres-gate-report'},requestId:'00000000-0000-4000-8000-000000000682',now:new Date('2026-08-23T15:00:00.000Z')})
 assert.equal(created.visit_report.confirmation_status,'PENDING_REVIEW')
 assert.equal(created.transcript_ref.status,'COMPLETED')
 assert.equal(Number((await db.query(`SELECT count(*)::int count FROM val_memories WHERE tenant_id=$1`,[tenantA])).rows[0].count),memoryCountBefore,'Report pendente não pode consolidar memória.')
 const commitmentIds=created.visit_report.commitments_proposed.filter(item=>item.due_at&&!item.date_confirmation_required).map(item=>item.item_id)
 assert.equal(commitmentIds.length,1)
 const confirmed=await serviceA.confirmReport({tenantId:tenantA,ownerId:actorA,actorId:actorA,visitId:visitA,input:{visit_report_id:created.visit_report.visit_report_id,confirm_commitment_ids:commitmentIds,outcome_type:'NO_DECISION',result:{decision:'pending'}},requestId:'00000000-0000-4000-8000-000000000683',now:new Date('2026-08-23T15:10:00.000Z')})
 assert.equal(confirmed.visit_report.confirmation_status,'CONFIRMED')
 assert.equal(confirmed.commitments.length,1)
 assert.equal(confirmed.outcome.outcome_type,'NO_DECISION')
 assert.equal(confirmed.learning_candidate.status,'CANDIDATE')
 const second=await prepareVisitExecution({repository:repositoryA,tenantId:tenantA,actor:{id:actorA,role:'consultant'},visitId:visitB,requestId:'00000000-0000-4000-8000-000000000684',now:new Date('2026-08-24T10:00:00.000Z')})
 assert.match(second.preparation.probable_objection,/preço|investimento/i)
 assert.ok(second.preparation.proofs_to_take.some(item=>/comparativo solicitado/i.test(item)))
 assert.equal(second.preparation.profile_approach.known,true)
 assert.match(second.preparation.main_opportunity.title,/buva/i)
 assert.match(second.preparation.why_now,/sem decisão.*compromisso/i)
 assert.ok(second.preparation.missing_information.some(item=>/buva|impacto econômico/i.test(item)))
 const legacyIdsAfter=await db.query(`SELECT id::text id FROM visits WHERE id=ANY($1::uuid[]) ORDER BY id`,[[visitA,visitB,visitLegacy]])
 assert.deepEqual(legacyIdsAfter.rows,legacyIdsBefore.rows,'IDs existentes foram alterados.')
 const snapshots=await db.query(`SELECT selected_refs,excluded_refs,exclusion_reason_codes,freshness_policy_version FROM val_context_snapshots WHERE tenant_id=$1 ORDER BY generated_at`,[tenantA])
 assert.equal(snapshots.rowCount,2)
 assert.equal(snapshots.rows.every(row=>Array.isArray(row.selected_refs)&&Array.isArray(row.excluded_refs)&&Array.isArray(row.exclusion_reason_codes)),true)
 assert.equal(snapshots.rows.every(row=>row.freshness_policy_version==='val.context.freshness.v1'),true)
 await validatePersistedLoop()
 await assertIsolation()
 const counts=await tableCounts()
 const catalog=await catalogEvidence()
 const result={
  mode,
  postgres_version:(await db.query('SHOW server_version')).rows[0].server_version,
  counts,
  catalog,
  data_fingerprint:await dataFingerprint(),
  ids:{visit_report_id:confirmed.visit_report.visit_report_id,transcript_id:created.transcript_ref.id,commitment_id:confirmed.commitments[0].commitment_id,outcome_id:confirmed.outcome.outcome_id,learning_candidate_id:confirmed.learning_candidate.candidate_id,first_context_snapshot_id:first.context_snapshot_ref.id,second_context_snapshot_id:second.context_snapshot_ref.id},
  assertions:{migration_runtime:true,human_confirmation:true,second_visit_learning:true,audio_persisted:true,tenant_isolation:true,legacy_untouched:true,learning_candidate_only:true}
 }
 if(evidenceFile)await writeFile(evidenceFile,`${JSON.stringify(result,null,2)}\n`)
 return result
}

async function runRestore(){
 assert.ok(evidenceFile,'PHASE6_EVIDENCE_FILE deve apontar para a evidência do banco de origem no modo restore.')
 const expected=JSON.parse(await readFile(evidenceFile,'utf8'))
 await assertLegacyUntouched()
 await validatePersistedLoop()
 await assertIsolation()
 const counts=await tableCounts()
 assert.deepEqual(counts,expected.counts,'Contagens restauradas divergem da origem migrada.')
 const catalog=await catalogEvidence()
 if(restoreEvidenceFile)await writeFile(restoreEvidenceFile,`${JSON.stringify({counts,catalog},null,2)}\n`)
 assert.equal(catalog.fingerprint,expected.catalog.fingerprint,'Catálogo restaurado diverge da origem migrada.')
 const fingerprint=await dataFingerprint()
 assert.equal(fingerprint,expected.data_fingerprint,'Dados restaurados divergem da origem migrada.')
 for(const [key,id] of Object.entries(expected.ids)){
  const table={visit_report_id:'val_visit_reports',transcript_id:'val_visit_transcripts',commitment_id:'val_commitments',outcome_id:'val_outcomes',learning_candidate_id:'val_learning_candidates',first_context_snapshot_id:'val_context_snapshots',second_context_snapshot_id:'val_context_snapshots'}[key]
  const found=await db.query(`SELECT 1 FROM ${table} WHERE id=$1`,[id])
  assert.equal(found.rowCount,1,`Referência restaurada ausente: ${key}`)
 }
 return {mode,postgres_version:(await db.query('SHOW server_version')).rows[0].server_version,counts,catalog_fingerprint:catalog.fingerprint,data_fingerprint:fingerprint,assertions:{schema:true,data:true,references:true,constraints:true,tenant_isolation:true,essential_loop:true}}
}

try{
 const result=mode==='source'?await runSource():await runRestore()
 console.log(`PHASE6_POSTGRES_VERIFY_OK ${JSON.stringify({mode:result.mode,postgres_version:result.postgres_version,counts:result.counts,catalog_fingerprint:result.catalog?.fingerprint??result.catalog_fingerprint,data_fingerprint:result.data_fingerprint,assertions:result.assertions})}`)
}finally{
 await db.close()
}
