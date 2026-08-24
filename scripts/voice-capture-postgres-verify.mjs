import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {createDatabase} from '../server/db.js'
import {prepareVisitExecution} from '../server/execution/service.js'
import {ValRepository} from '../server/repository.js'
import {createVisitLoopService} from '../server/visit-loop/service.js'
import {createVoiceCandidateExtractor} from '../server/voice-capture/extraction.js'
import {createVoiceCaptureService} from '../server/voice-capture/service.js'
import {createRepositoryAttachmentVoiceStorage} from '../server/voice-capture/storage.js'
import {createMockTranscriptionProvider} from '../server/voice-capture/transcription-provider.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000702'
const actorA='00000000-0000-4000-8000-000000000701'
const actorA2='00000000-0000-4000-8000-000000000703'
const actorB='00000000-0000-4000-8000-000000000711'
const clientA='producer-voice-a'
const visitA='00000000-0000-4000-8000-000000000741'
const visitB='00000000-0000-4000-8000-000000000742'
const legacyMemory='00000000-0000-4000-8000-000000000751'
const crossTenantProbe='00000000-0000-4000-8000-000000000799'
const actorMismatchProbe='00000000-0000-4000-8000-000000000798'
const clientMismatchProbe='00000000-0000-4000-8000-000000000797'
const visitMismatchProbe='00000000-0000-4000-8000-000000000796'
const audioMismatchProbe='00000000-0000-4000-8000-000000000795'
const baseNow=new Date('2026-08-23T10:00:00.000Z')
const mode=String(process.env.VOICE_CAPTURE_VERIFY_MODE||'source').toLowerCase()
const evidenceFile=process.env.VOICE_CAPTURE_EVIDENCE_FILE
const restoreEvidenceFile=process.env.VOICE_CAPTURE_RESTORE_EVIDENCE_FILE

assert.ok(process.env.DATABASE_URL,'DATABASE_URL é obrigatória para o gate PostgreSQL do Voice Capture.')
assert.ok(['source','restore'].includes(mode),'VOICE_CAPTURE_VERIFY_MODE deve ser source ou restore.')

const transcripts=Object.freeze({
 PRE_VISIT:'Estou indo visitar o produtor para falar de fertilizante. Ele está sensível a preço. Quero entender se pretende aumentar a área.',
 FIELD_NOTE:'Passei no talhão 4 e vi bastante buva escapada. É um problema relatado, ainda sem recomendação técnica.',
 CLIENT_NOTE:'O produtor comentou hoje por telefone que pretende aumentar 150 hectares no próximo ano.',
 POST_VISIT:'Ele achou a proposta cara. Pediu comparativo de custo por hectare. Ficou de falar com o sócio. Combinei de retornar em 2026-08-29. Também comentou problema de buva no talhão 4.'
})
const relevantTables=[
 'visits','val_attachments','val_voice_interactions','val_voice_transcripts','val_memories',
 'val_context_snapshots','val_action_plans','val_commitments','val_visit_lifecycle_events',
 'val_visit_preparations','val_visit_reports','val_outcomes','val_learning_candidates',
 'interactions','opportunities','audit_events'
]
const materialTables=[
 'val_memories','val_context_snapshots','val_action_plans','val_commitments','val_visit_preparations',
 'val_visit_reports','val_outcomes','val_learning_candidates','interactions','opportunities'
]
const expectedConstraints=[
 'val_voice_interactions_type_check','val_voice_interactions_status_check',
 'val_voice_interactions_confirmation_check','val_voice_interactions_transcript_status_check',
 'val_voice_interactions_duration_check','val_voice_interactions_retry_check',
 'val_voice_interactions_revision_check','val_voice_interactions_source_context_object_check',
 'val_voice_interactions_candidate_arrays_check','val_voice_interactions_metadata_objects_check',
 'val_voice_interactions_actor_same_tenant_fkey','val_voice_interactions_client_same_tenant_fkey',
 'val_voice_interactions_visit_same_tenant_fkey','val_voice_interactions_audio_same_tenant_fkey',
 'val_voice_interactions_latest_transcript_same_tenant_fkey','val_voice_transcripts_status_check',
 'val_voice_transcripts_text_check','val_voice_transcripts_duration_check',
 'val_voice_transcripts_confidence_check','val_voice_transcripts_attempt_check',
 'val_voice_transcripts_metadata_object_check','val_voice_transcripts_interaction_same_tenant_fkey',
 'val_voice_transcripts_actor_matches_interaction_fkey',
 'val_voice_transcripts_client_matches_interaction_fkey',
 'val_voice_transcripts_visit_matches_interaction_fkey',
 'val_voice_transcripts_client_same_tenant_fkey','val_voice_transcripts_visit_same_tenant_fkey',
 'val_voice_transcripts_creator_same_tenant_fkey'
]
const expectedIndexes=[
 'idx_val_attachments_tenant_id_id','idx_val_attachments_voice_scope',
 'idx_val_voice_interactions_tenant_id_id','idx_val_voice_interactions_actor_scope',
 'idx_val_voice_interactions_client_scope','idx_val_voice_interactions_visit_scope',
 'idx_val_voice_interactions_actor_client','idx_val_voice_interactions_visit',
 'idx_val_voice_interactions_pending','idx_val_voice_transcripts_tenant_id_id',
 'idx_val_voice_transcripts_interaction_identity','idx_val_voice_transcripts_interaction'
]

const db=createDatabase({databaseUrl:process.env.DATABASE_URL,databaseSsl:false})
const repositoryA=new ValRepository({db,tenantId:tenantA,readStore:()=>({}),saveStore:()=>{}})
const repositoryB=new ValRepository({db,tenantId:tenantB,readStore:()=>({}),saveStore:()=>{}})
const transcriptProvider=createMockTranscriptionProvider({
 name:'voice-postgres-gate',
 model:'voice-postgres-fixture-v1',
 text:input=>{
  const file=String(input.originalName||input.fileName||'').toUpperCase()
  const type=Object.keys(transcripts).find(value=>file.includes(value))
  assert.ok(type,`Fixture de transcrição não resolvida para ${file}.`)
  return transcripts[type]
 },
 language:'pt-BR',
 confidence:0.98
})
const storageA=createRepositoryAttachmentVoiceStorage({repository:repositoryA,durationProbe:async()=>30})
const visitLoopA=createVisitLoopService({repository:repositoryA,transcriptionProvider:transcriptProvider})
const voiceA=createVoiceCaptureService({
 repository:repositoryA,
 storageProvider:storageA,
 transcriptionProvider:transcriptProvider,
 extractor:createVoiceCandidateExtractor(),
 visitLoop:visitLoopA,
 prepareVisit:prepareVisitExecution
})

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const ordered=value=>JSON.stringify(stable(value))
const hash=value=>createHash('sha256').update(typeof value==='string'?value:ordered(value)).digest('hex')
const normalizedConstraint=value=>String(value).replaceAll('::character varying::text','::character varying').replaceAll(']::text[]',']')

function wavFixture(){
 const bytes=Buffer.alloc(44)
 bytes.write('RIFF',0,'ascii');bytes.writeUInt32LE(36,4);bytes.write('WAVE',8,'ascii')
 bytes.write('fmt ',12,'ascii');bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22)
 bytes.writeUInt32LE(8_000,24);bytes.writeUInt32LE(16_000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34)
 bytes.write('data',36,'ascii');bytes.writeUInt32LE(0,40)
 return bytes
}

function audioInput(type){
 return {
  original_name:`VOICE_${type}.wav`,
  mime_type:'audio/wav',
  data_url:`data:audio/wav;base64,${wavFixture().toString('base64')}`,
  duration_seconds:30
 }
}

function confirmationInput(interaction,extra={}){
 return {
  items:interaction.candidates.map(candidate=>({
   candidate_id:candidate.candidate_id,
   decision:'CONFIRMED',
   ...(candidate.category==='COMMITMENT_CANDIDATE'?{due_at:'2026-08-29T18:00:00.000Z'}:{})
  })),
  ...extra
 }
}

async function counts(tables=relevantTables){
 const result={}
 for(const table of tables)result[table]=Number((await db.query(`SELECT count(*)::int count FROM ${table}`)).rows[0].count)
 return result
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
 const tables=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
 const columns=await db.query("SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")
 const constraints=await db.query("SELECT conname,contype,convalidated,pg_get_constraintdef(oid,true) definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname")
 const indexes=await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")
 const constraintNames=new Set(constraints.rows.map(row=>row.conname))
 const indexNames=new Set(indexes.rows.map(row=>row.indexname))
 for(const name of expectedConstraints)assert.ok(constraintNames.has(name),`Constraint Voice Capture ausente: ${name}`)
 for(const name of expectedIndexes)assert.ok(indexNames.has(name),`Índice Voice Capture ausente: ${name}`)
 for(const table of ['val_voice_interactions','val_voice_transcripts'])assert.ok(tables.rows.some(row=>row.tablename===table),`Tabela Voice Capture ausente: ${table}`)
 const latest=constraints.rows.find(row=>row.conname==='val_voice_interactions_latest_transcript_same_tenant_fkey')
 assert.equal(latest.convalidated,false,'O FK circular expand-only deve permanecer NOT VALID nesta migration.')
 const semanticConstraints=constraints.rows.map(row=>({...row,definition:normalizedConstraint(row.definition)}))
 return {
  tables:tables.rows.map(row=>row.tablename),
  columns:columns.rows,
  constraints:semanticConstraints,
  indexes:indexes.rows,
  fingerprint:hash({tables:tables.rows,columns:columns.rows,constraints:semanticConstraints,indexes:indexes.rows})
 }
}

async function processAudio(type,{visitId=null,now=baseNow}={}){
 const before=await counts(materialTables)
 const created=await voiceA.create({
  tenantId:tenantA,ownerId:actorA,actorId:actorA,
  input:{client_id:clientA,visit_id:visitId,interaction_type:type,source_context:{gate:'POSTGRES_16',surface:type}},
  requestId:`voice-gate-create-${type}`,now
 })
 const id=created.voice_interaction.voice_interaction_id
 const uploaded=await voiceA.uploadAudio({tenantId:tenantA,ownerId:actorA,actorId:actorA,id,input:audioInput(type),now:new Date(now.getTime()+60_000)})
 assert.equal(uploaded.voice_interaction.state,'AUDIO_STORED')
 assert.equal(uploaded.voice_interaction.duration_seconds,30)
 assert.equal(uploaded.voice_interaction.source_context.duration_source,'SERVER_PROBE')
 const processed=await voiceA.process({tenantId:tenantA,ownerId:actorA,actorId:actorA,id,requestId:`voice-gate-process-${type}`,now:new Date(now.getTime()+120_000)})
 assert.equal(processed.voice_interaction.state,'PENDING_REVIEW')
 assert.ok(processed.voice_interaction.candidates.length>0,`${type} precisa produzir candidatos.`)
 assert.deepEqual(await counts(materialTables),before,`${type} alterou domínio antes da confirmação humana.`)
 return processed.voice_interaction
}

async function confirmNonPost(interaction,{now,extra={}}={}){
 const result=await voiceA.confirm({
  tenantId:tenantA,ownerId:actorA,actorId:actorA,id:interaction.voice_interaction_id,
  input:confirmationInput(interaction,extra),requestId:`voice-gate-confirm-${interaction.interaction_type}`,now
 })
 assert.equal(result.voice_interaction.state,'CONFIRMED')
 assert.equal(result.voice_interaction.confirmation_status,'CONFIRMED')
 return result
}

function preparationEvidence(preparation){
 const details={
  price_objection:/preço|investimento/i.test(String(preparation.probable_objection||'')),
  requested_comparison:(preparation.proofs_to_take||[]).some(item=>/comparativo solicitado|comparativo.*custo/i.test(String(item))),
  observable_profile:Boolean(preparation.profile_approach?.known),
  buva_opportunity:/buva/i.test(String(preparation.main_opportunity?.title||'')),
  prior_outcome:/sem decisão|compromisso/i.test(String(preparation.why_now||'')),
  additional_decider:(preparation.golden_questions||[]).some(item=>/além de você|participa.*decisão|sócio|decisor/i.test(String(item)))
 }
 return {score:Object.values(details).filter(Boolean).length,details}
}

async function assertNoAutomaticKnowledge(){
 const result=await db.query("SELECT count(*)::int count FROM val_memories WHERE memory_state='VALIDATED_KNOWLEDGE'")
 assert.equal(Number(result.rows[0].count),0,'Voice Capture não pode promover KnowledgeItem automaticamente.')
 const learning=await db.query('SELECT status,scope FROM val_learning_candidates ORDER BY created_at')
 assert.equal(learning.rows.every(row=>row.status==='CANDIDATE'&&row.scope?.automatic_promotion===false),true)
}

async function assertIsolation(ids){
 for(const interactionId of Object.values(ids.voice_interactions)){
  const own=await repositoryA.getVoiceInteraction({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:interactionId})
  assert.ok(own)
  assert.equal(await repositoryA.getVoiceInteraction({tenantId:tenantA,ownerId:actorA2,actorId:actorA2,id:interactionId}),null)
  assert.equal(await repositoryB.getVoiceInteraction({tenantId:tenantB,ownerId:actorB,actorId:actorB,id:interactionId}),null)
  assert.equal(await repositoryA.getVoiceTranscript({tenantId:tenantA,ownerId:actorA2,actorId:actorA2,id:own.transcript.transcript_id}),null)
  assert.equal(await repositoryB.getVoiceTranscript({tenantId:tenantB,ownerId:actorB,actorId:actorB,id:own.transcript.transcript_id}),null)
  await assert.rejects(
   ()=>storageA.load({organizationId:tenantA,actorId:actorA2,clientId:clientA,audioRef:own.audio_ref}),
   error=>error?.code==='audio_not_found'&&error?.statusCode===404
  )
 }
 await assert.rejects(
  ()=>repositoryA.getVoiceInteraction({tenantId:tenantB,ownerId:actorA,actorId:actorA,id:ids.voice_interactions.POST_VISIT}),
  error=>error?.code==='cross_tenant_scope_denied'&&error?.statusCode===403
 )
 await assert.rejects(
  ()=>repositoryA.createVoiceInteraction({tenantId:tenantA,ownerId:actorA2,actorId:actorA2,clientId:clientA,interactionType:'CLIENT_NOTE'}),
  error=>error?.statusCode===404
 )
 const expectForeignKey=async(label,operation)=>{
  let constraintCode=null
  try{await operation()}catch(error){constraintCode=error?.code}
  assert.equal(constraintCode,'23503',`A FK composta deveria bloquear ${label}.`)
 }
 await expectForeignKey('client de outro tenant',()=>db.query(`INSERT INTO val_voice_interactions (id,tenant_id,actor_id,client_id,contract_version,interaction_type,status,confirmation_status,transcript_status) VALUES ($1,$2,$3,$4,'val.voice_interaction.v1','CLIENT_NOTE','CREATED','PENDING','PENDING')`,[crossTenantProbe,tenantB,actorB,'00000000-0000-4000-8000-000000000721']))
 const postInteraction=ids.voice_interactions.POST_VISIT
 const transcriptInsert=(id,{clientId='00000000-0000-4000-8000-000000000721',visitId=visitA,createdBy=actorA,attempt=90}={})=>db.query(`INSERT INTO val_voice_transcripts (id,tenant_id,voice_interaction_id,client_id,visit_id,created_by,provider,model,status,attempt_no,metadata) VALUES ($1,$2,$3,$4,$5,$6,'gate-invalid','gate-invalid','PENDING',$7,'{}'::jsonb)`,[id,tenantA,postInteraction,clientId,visitId,createdBy,attempt])
 await expectForeignKey('ator de transcript diferente da interação',()=>transcriptInsert(actorMismatchProbe,{createdBy:actorA2,attempt:91}))
 await expectForeignKey('client de transcript diferente da interação',()=>transcriptInsert(clientMismatchProbe,{clientId:'00000000-0000-4000-8000-000000000722',attempt:92}))
 await expectForeignKey('visita de transcript diferente da interação',()=>transcriptInsert(visitMismatchProbe,{visitId:visitB,attempt:93}))
 await expectForeignKey('anexo pertencente a outro ator/produtor',()=>db.query(`INSERT INTO val_voice_interactions (id,tenant_id,actor_id,client_id,audio_attachment_id,contract_version,interaction_type,status,confirmation_status,transcript_status,audio_ref,duration_seconds) VALUES ($1,$2,$3,$4,$5,'val.voice_interaction.v1','CLIENT_NOTE','AUDIO_STORED','PENDING','PENDING',$6,30)`,[audioMismatchProbe,tenantA,actorA2,'00000000-0000-4000-8000-000000000722',ids.attachments.PRE_VISIT,`attachment:${ids.attachments.PRE_VISIT}`]))
}

async function assertPersisted(ids){
 const voices=await db.query("SELECT interaction_type,status,confirmation_status,audio_attachment_id,latest_transcript_id,related_artifacts FROM val_voice_interactions WHERE tenant_id=$1 AND actor_id=$2 ORDER BY interaction_type",[tenantA,actorA])
 assert.equal(voices.rowCount,4)
 assert.deepEqual(new Set(voices.rows.map(row=>row.interaction_type)),new Set(['PRE_VISIT','FIELD_NOTE','CLIENT_NOTE','POST_VISIT']))
 assert.equal(voices.rows.every(row=>row.status==='CONFIRMED'&&row.confirmation_status==='CONFIRMED'&&row.audio_attachment_id&&row.latest_transcript_id),true)
 const transcriptsResult=await db.query("SELECT status,transcript_text,attempt_no FROM val_voice_transcripts WHERE tenant_id=$1 AND created_by=$2 ORDER BY created_at",[tenantA,actorA])
 assert.equal(transcriptsResult.rowCount,4)
 assert.equal(transcriptsResult.rows.every(row=>row.status==='COMPLETED'&&row.transcript_text&&Number(row.attempt_no)===1),true)
 const attachments=await db.query("SELECT status,analysis FROM val_attachments WHERE tenant_id=$1 AND consultant_id=$2 ORDER BY created_at",[tenantA,actorA])
 assert.equal(attachments.rowCount,4)
 assert.equal(attachments.rows.every(row=>row.status==='confirmed'&&row.analysis?.kind==='voice_capture'),true)
 const post=await repositoryA.getVoiceInteraction({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:ids.voice_interactions.POST_VISIT})
 for(const [key,table] of Object.entries({visit_report_id:'val_visit_reports',outcome_id:'val_outcomes',learning_candidate_id:'val_learning_candidates'})){
  assert.ok(post.related_artifacts[key],`Artefato POST ausente: ${key}`)
  assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE id=$1`,[post.related_artifacts[key]])).rowCount,1)
 }
 const report=await db.query("SELECT confirmation_status,source_type,transcript_ref,producer_signals FROM val_visit_reports WHERE id=$1",[post.related_artifacts.visit_report_id])
 assert.equal(report.rows[0].confirmation_status,'CONFIRMED')
 assert.equal(report.rows[0].source_type,'AUDIO')
 assert.match(report.rows[0].transcript_ref,/^voice-transcript:/)
 assert.ok(report.rows[0].producer_signals.some(item=>item.signal_code==='MULTI_DECISION_PARTICIPANT'))
 const audit=await db.query("SELECT count(*)::int count FROM audit_events WHERE tenant_id=$1 AND action='visit_report_confirmed' AND entity_id=$2",[tenantA,visitA])
 assert.equal(Number(audit.rows[0].count),1,'Confirmação concorrente não pode duplicar o commit atômico.')
 await assertNoAutomaticKnowledge()
}

async function runSource(){
 const version=(await db.query('SHOW server_version_num')).rows[0].server_version_num
 assert.match(String(version),/^16/,'O gate exige PostgreSQL 16.')
 const migration=await db.query("SELECT checksum FROM schema_migrations WHERE version='20260823_005_voice_capture_expand'")
 assert.equal(migration.rowCount,1)
 assert.match(String(migration.rows[0].checksum),/^[0-9a-f]{64}$/)
 const fixture=await db.query('SELECT id,key FROM val_memories WHERE id=$1',[legacyMemory])
 assert.deepEqual(fixture.rows,[{id:legacyMemory,key:'legacy.voice.fixture'}])

 const pre=await processAudio('PRE_VISIT',{visitId:visitA,now:baseNow})
 const preConfirmed=await confirmNonPost(pre,{now:new Date('2026-08-23T10:05:00.000Z')})
 const firstPreparation=preConfirmed.result?.preparation_result?.preparation||preConfirmed.result?.preparation
 assert.ok(firstPreparation,'PRE_VISIT precisa gerar PrepareVisit persistido.')
 const firstEvidence=preparationEvidence(firstPreparation)

 const started=await repositoryA.startVisit({tenantId:tenantA,ownerId:actorA,actorId:actorA,visitId:visitA,requestId:'voice-gate-visit-started',now:new Date('2026-08-23T10:10:00.000Z')})
 const startedAgain=await repositoryA.startVisit({tenantId:tenantA,ownerId:actorA,actorId:actorA,visitId:visitA,requestId:'voice-gate-visit-started-retry',now:new Date('2026-08-23T10:11:00.000Z')})
 assert.equal(started.visit.lifecycleStatus,'IN_PROGRESS')
 assert.equal(started.idempotent,false)
 assert.equal(startedAgain.idempotent,true)
 assert.equal(Number((await db.query("SELECT count(*)::int count FROM val_visit_lifecycle_events WHERE tenant_id=$1 AND visit_id=$2 AND reason_code='VISIT_STARTED'",[tenantA,visitA])).rows[0].count),1)

 const field=await processAudio('FIELD_NOTE',{visitId:visitA,now:new Date('2026-08-23T11:00:00.000Z')})
 await confirmNonPost(field,{now:new Date('2026-08-23T11:05:00.000Z')})
 const client=await processAudio('CLIENT_NOTE',{now:new Date('2026-08-23T12:00:00.000Z')})
 await confirmNonPost(client,{now:new Date('2026-08-23T12:05:00.000Z')})
 assert.equal(Number((await db.query('SELECT count(*)::int count FROM val_outcomes')).rows[0].count),0)
 assert.equal(Number((await db.query('SELECT count(*)::int count FROM val_learning_candidates')).rows[0].count),0)

 const post=await processAudio('POST_VISIT',{visitId:visitA,now:new Date('2026-08-23T15:00:00.000Z')})
 const beforeAtomic=await counts(materialTables)
 await assert.rejects(
  ()=>voiceA.confirm({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:post.voice_interaction_id,input:{items:confirmationInput(post).items.slice(0,-1)},requestId:'voice-gate-incomplete-review',now:new Date('2026-08-23T15:04:00.000Z')}),
  error=>error?.code==='voice_review_incomplete'&&error?.statusCode===422
 )
 assert.deepEqual(await counts(materialTables),beforeAtomic,'Revisão incompleta deixou escrita parcial.')
 const postInput=confirmationInput(post,{outcome_type:'NO_DECISION',next_step:'Retornar com comparativo de custo por hectare.',next_step_at:'2026-08-29T18:00:00.000Z'})
 const confirmations=await Promise.all([
  voiceA.confirm({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:post.voice_interaction_id,input:postInput,requestId:'voice-gate-post-confirm-a',now:new Date('2026-08-23T15:10:00.000Z')}),
  voiceA.confirm({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:post.voice_interaction_id,input:postInput,requestId:'voice-gate-post-confirm-b',now:new Date('2026-08-23T15:10:00.000Z')})
 ])
 assert.equal(confirmations.every(item=>item.voice_interaction.state==='CONFIRMED'),true)
 const afterAtomic=await counts(materialTables)
 for(const table of ['val_visit_reports','val_outcomes','val_learning_candidates','interactions'])assert.equal(afterAtomic[table],beforeAtomic[table]+1,`${table} deveria ter exatamente uma escrita atômica.`)
 assert.ok(afterAtomic.val_memories>beforeAtomic.val_memories)
 assert.ok(afterAtomic.val_commitments>beforeAtomic.val_commitments)

 const second=await prepareVisitExecution({repository:repositoryA,tenantId:tenantA,actor:{id:actorA,role:'consultant'},visitId:visitB,requestId:'voice-gate-second-preparation',now:new Date('2026-08-24T10:00:00.000Z')})
 const secondEvidence=preparationEvidence(second.preparation)
 assert.ok(secondEvidence.score>firstEvidence.score,`A segunda preparação não melhorou: ${firstEvidence.score} -> ${secondEvidence.score}.`)
 assert.ok(secondEvidence.score>=6,`A segunda preparação não incorporou todos os sinais obrigatórios: ${ordered(secondEvidence.details)}`)
 assert.equal(secondEvidence.details.additional_decider,true,'A segunda preparação deve perguntar pelo sócio/decisor adicional.')

 const records={PRE_VISIT:pre,FIELD_NOTE:field,CLIENT_NOTE:client,POST_VISIT:post}
 const ids={
  voice_interactions:Object.fromEntries(Object.entries(records).map(([type,item])=>[type,item.voice_interaction_id])),
  transcripts:Object.fromEntries(Object.entries(records).map(([type,item])=>[type,item.transcript.transcript_id])),
  attachments:Object.fromEntries(Object.entries(records).map(([type,item])=>[type,item.audio_ref.split(':').at(-1)])),
  first_preparation_id:firstPreparation.preparation_id,
  second_preparation_id:second.preparation.preparation_id
 }
 await assertPersisted(ids)
 await assertIsolation(ids)
 const catalog=await catalogEvidence()
 const result={
  mode,
  postgres_version:(await db.query('SHOW server_version')).rows[0].server_version,
  migration_005:{version:'20260823_005_voice_capture_expand',checksum:String(migration.rows[0].checksum)},
  counts:await counts(),catalog,data_fingerprint:await dataFingerprint(),ids,
  preparation:{first:firstEvidence,second:secondEvidence},
  assertions:{migration_005:true,postgres_16:true,visit_started:true,pre_field_client_post:true,human_confirmation:true,atomic_confirmation:true,tenant_isolation:true,actor_isolation:true,second_preparation_better:true,no_knowledge_promotion:true}
 }
 if(evidenceFile)await writeFile(evidenceFile,`${JSON.stringify(result,null,2)}\n`)
 return result
}

async function runRestore(){
 assert.ok(evidenceFile,'VOICE_CAPTURE_EVIDENCE_FILE deve apontar para a evidência source no restore.')
 const expected=JSON.parse(await readFile(evidenceFile,'utf8'))
 const version=(await db.query('SHOW server_version_num')).rows[0].server_version_num
 assert.match(String(version),/^16/)
 const migration=await db.query("SELECT checksum FROM schema_migrations WHERE version='20260823_005_voice_capture_expand'")
 assert.equal(migration.rowCount,1)
 assert.deepEqual({version:'20260823_005_voice_capture_expand',checksum:String(migration.rows[0].checksum)},expected.migration_005,'A migration 005 restaurada diverge da origem.')
 await assertPersisted(expected.ids)
 await assertIsolation(expected.ids)
 const restoredCounts=await counts()
 assert.deepEqual(restoredCounts,expected.counts,'Contagens do restore divergem da origem Voice Capture.')
 const catalog=await catalogEvidence()
 assert.equal(catalog.fingerprint,expected.catalog.fingerprint,'Catálogo restaurado diverge da origem Voice Capture.')
 const fingerprint=await dataFingerprint()
 assert.equal(fingerprint,expected.data_fingerprint,'Dados restaurados divergem da origem Voice Capture.')
 const preparations=await db.query('SELECT preparation_id,preparation_payload FROM val_visit_preparations WHERE tenant_id=$1 AND preparation_id=ANY($2::varchar[]) ORDER BY prepared_at',[tenantA,[expected.ids.first_preparation_id,expected.ids.second_preparation_id]])
 assert.equal(preparations.rowCount,2)
 const restoredFirst=preparationEvidence(preparations.rows.find(row=>row.preparation_id===expected.ids.first_preparation_id).preparation_payload)
 const restoredSecond=preparationEvidence(preparations.rows.find(row=>row.preparation_id===expected.ids.second_preparation_id).preparation_payload)
 assert.deepEqual({first:restoredFirst,second:restoredSecond},expected.preparation)
 const result={mode,postgres_version:(await db.query('SHOW server_version')).rows[0].server_version,migration_005:expected.migration_005,counts:restoredCounts,catalog_fingerprint:catalog.fingerprint,data_fingerprint:fingerprint,preparation:{first:restoredFirst,second:restoredSecond},assertions:{schema:true,data:true,references:true,migration_005:true,tenant_isolation:true,actor_isolation:true,atomic_confirmation:true,second_preparation_better:true,no_knowledge_promotion:true}}
 if(restoreEvidenceFile)await writeFile(restoreEvidenceFile,`${JSON.stringify(result,null,2)}\n`)
 return result
}

try{
 const result=mode==='source'?await runSource():await runRestore()
 console.log(`VOICE_CAPTURE_POSTGRES_VERIFY_OK ${JSON.stringify({mode:result.mode,postgres_version:result.postgres_version,counts:result.counts,catalog_fingerprint:result.catalog?.fingerprint??result.catalog_fingerprint,data_fingerprint:result.data_fingerprint,preparation:result.preparation,assertions:result.assertions})}`)
}finally{
 await db.close()
}
