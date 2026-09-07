import test from 'node:test'
import assert from 'node:assert/strict'
import {buildDemoProducerFixture,DEMO_PRODUCER_KEY,DEMO_PRODUCER_NAME,seedDemoProducer} from '../server/demo-producer.js'
import {canonicalGeometryAreaHa,decodeCanonicalGeometryRef} from '../src/lib/agronomic-geometry-adapter.js'
import {validateVisitReport} from '../server/visit-loop/contracts.js'
import {runDemoProducerSeed} from '../scripts/seed-demo-producer.mjs'
import {advancePipelineItem,reconcilePipeline} from '../src/lib/opportunity-pipeline.js'
import {ValRepository} from '../server/repository.js'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {validateCommitment} from '../server/execution/contracts.js'
import {transitionCommitment} from '../server/execution/commitment.js'

const tenantId='00000000-0000-4000-8000-000000000101'
const ownerId='00000000-0000-4000-8000-000000000102'
const now='2026-09-06T12:00:00.000Z'
const scope={tenantId,ownerId,environment:'test',now}
const fixture=()=>buildDemoProducerFixture(scope)
const rowsFor=(built,table)=>built.rows.filter(item=>item.table===table).map(item=>item.row)

// Transaction double stores actual parameters and rolls back failures, so the
// repeat/collision tests exercise durable-state behavior, not SQL string snapshots.
function memoryDatabase({authorized=true,failTable=null}={}){
 let stored=[]
 const calls=[]
 const database={configured:true,transaction:async work=>{
  const before=structuredClone(stored)
  try{return await work({query:async(sql,params=[])=>{
   calls.push({sql,params})
   if(sql.startsWith('SELECT membership.user_id'))return {rowCount:authorized?1:0,rows:authorized?[{user_id:ownerId}]:[]}
   if(sql.startsWith('SELECT pg_advisory_xact_lock'))return {rowCount:1,rows:[]}
   if(sql.startsWith('SELECT id,external_key,name,status FROM clients')){
    const rows=stored.filter(item=>item.table==='clients'&&item.row.tenant_id===params[0]&&item.row.consultant_id===params[1]&&(item.row.id===params[2]||item.row.external_key===params[3])).map(item=>item.row)
    return {rowCount:rows.length,rows}
   }
   const match=sql.match(/^INSERT INTO ([a-z_]+) \(([^)]+)\)/)
   assert.ok(match,`Unexpected SQL: ${sql}`)
   const [,table,columns]=match
   if(table===failTable)throw new Error('injected transaction failure')
   const row=Object.fromEntries(columns.split(',').map((column,index)=>[column,params[index]]))
   if(stored.some(item=>item.table===table&&item.row.id===row.id))return {rowCount:0,rows:[]}
   stored.push({table,row})
   return {rowCount:1,rows:[{id:row.id}]}
  }})}catch(error){stored=before;throw error}
 }}
 return {database,calls,get stored(){return stored},add:entry=>stored.push(entry)}
}

test('demo has scoped canonical geometry, consistent hectare totals, three seasons, real questionnaire and usable visits',()=>{
 const built=fixture()
 assert.equal(built.name,DEMO_PRODUCER_NAME)
 assert.equal(built.counts.properties,2)
 assert.equal(built.counts.fields,4)
 assert.equal(built.counts.crop_seasons,12)
 assert.equal(new Set(rowsFor(built,'crop_seasons').map(row=>row.season)).size,3)
 assert.equal(built.counts.soil_analyses,4)
 assert.equal(built.counts.ndvi_observations,12)
 const fields=rowsFor(built,'fields')
 for(const field of fields){
  const geometry=decodeCanonicalGeometryRef(field.geometry_ref,{expectedOrganizationId:tenantId})
  assert.equal(geometry.link.fieldId,field.id)
  assert.equal(geometry.link.propertyId,field.property_id)
  assert.equal(geometry.link.clientId,built.clientId)
  assert.ok(Math.abs(field.area_ha-canonicalGeometryAreaHa(geometry.geometry))<.01)
  assert.equal(geometry.provenance.details.synthetic,true)
 }
 for(const property of rowsFor(built,'properties')){
  assert.ok(Math.abs(property.area_ha-fields.filter(field=>field.property_id===property.id).reduce((sum,field)=>sum+field.area_ha,0))<.01)
  assert.equal(JSON.parse(property.metadata).synthetic,true)
 }
 assert.equal(fields.filter(field=>field.property_id===rowsFor(built,'properties')[0].id).length,3)
 assert.ok(Math.abs(built.totalAreaHa-fields.reduce((sum,field)=>sum+field.area_ha,0))<.01)
 const profile=rowsFor(built,'client_profiles')[0]
 assert.equal(profile.primary_profile,'Analítico')
 assert.equal(profile.secondary_profile,'Relacional')
 assert.equal(JSON.parse(profile.answers)[29],'')
 assert.equal(JSON.parse(profile.answers)[30],'')
 assert.equal(JSON.parse(profile.profile_snapshot).demo.synthetic,true)
 const visits=rowsFor(built,'visits')
 assert.ok(visits.some(row=>row.lifecycle_status==='COMPLETED'&&row.completed_at<now))
 assert.ok(visits.some(row=>row.lifecycle_status==='IN_PROGRESS'&&row.occurred_at<now))
 assert.ok(visits.some(row=>row.lifecycle_status==='PLANNED'&&row.scheduled_at>now))
 const report=JSON.parse(rowsFor(built,'val_visit_reports')[0].initial_extraction)
 assert.equal(report.confirmation_status,'PENDING_REVIEW')
 assert.equal(report.confirmed_by,null)
 assert.deepEqual(validateVisitReport(report),[])
 assert.equal(rowsFor(built,'sog_negotiation_intents')[0].status,'draft')
 assert.equal(rowsFor(built,'sog_negotiation_intents')[0].target_price,null)
})

test('synthetic agronomic records cannot masquerade as approved reports, real satellites or prescriptions',()=>{
 const built=fixture()
 for(const analysis of rowsFor(built,'soil_analyses')){
  assert.match(analysis.laboratory,/SIMULADO/)
  assert.equal(analysis.validated_at,undefined)
  assert.deepEqual(JSON.parse(analysis.validated_flags),[])
  assert.equal(JSON.parse(analysis.validation_evidence).technicalApproval,false)
 }
 for(const observation of rowsFor(built,'ndvi_observations')){
  assert.match(observation.sensor,/SIMULADO/)
  assert.equal(observation.validated_at,undefined)
  assert.equal(observation.raster_uri,undefined)
  assert.equal(JSON.parse(observation.statistics).synthetic,true)
 }
 for(const report of rowsFor(built,'field_reports'))assert.deepEqual(JSON.parse(report.validated_actions),[])
 assert.equal(rowsFor(built,'val_memories')[0].memory_state,'HYPOTHESIS')
 assert.equal(rowsFor(built,'val_memories')[0].status,'proposed')
 assert.equal(rowsFor(built,'sog_market_snapshots').length,0)
 assert.equal(rowsFor(built,'survey_invitations').length,0)
 assert.equal(new Set(built.rows.map(item=>item.row.id)).size,built.rows.length)
 assert.ok(built.rows.every(item=>item.row.tenant_id===tenantId))
})

test('current repository grounds the demo profile in scoped questionnaire evidence with valid question references',async()=>{
 const built=fixture()
 const client=rowsFor(built,'clients')[0]
 const profile=rowsFor(built,'client_profiles')[0]
 const row={client_external_key:client.external_key,client_internal_id:client.id,client_tenant_id:tenantId,client_consultant_id:ownerId,name:client.name,profile_id:profile.id,profile_tenant_id:tenantId,profile_client_id:client.id,primary_profile:profile.primary_profile,secondary_profile:profile.secondary_profile,profile_answers:JSON.parse(profile.answers),profile_evidence:JSON.parse(profile.evidence),profile_snapshot:JSON.parse(profile.profile_snapshot),profile_assessed_at:profile.assessed_at,profile_valid_until:profile.valid_until}
 const repository=new ValRepository({db:{configured:true,query:async()=>({rowCount:1,rows:[row]})},tenantId,readStore:()=>({}),saveStore:()=>{}})
 const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId:built.externalKey,dataPath:'BEHAVIORAL_PROFILE',now:new Date(now)})
 assert.deepEqual(new Set(facts.profileEvidence.map(item=>item.source_field)),new Set(['primaryProfile','secondaryProfile','decisionDriver','technicalPresentation','planningStyle','innovationBehavior','servicePreference','trustDriver','buyingBehavior']))
 assert.deepEqual(facts.profileRejectedEvidence,[])
 for(const evidence of facts.profileEvidence){
  assert.equal(evidence.tenant_id,tenantId)
  assert.equal(evidence.context_owner_id,ownerId)
  assert.equal(evidence.producer_id,built.externalKey)
  assert.ok(evidence.source_locator)
  if(evidence.question_id){assert.equal(evidence.source_type,'producer_questionnaire');assert.match(evidence.source_id,/val-demo-synthetic-v1:/);assert.equal(evidence.epistemic_type,'QUOTE')}
 }
 const response=buildFastClientResponse({facts,message:'Qual o perfil do Rafael?',organizationId:tenantId,ownerId,conversationId:'demo-profile-test',contextEpoch:1,now:new Date(now)})
 assert.match(response.advice.answer,/Perfil principal: Analítico/i)
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
})

test('seeded commitments satisfy the actual reader contract and can be accepted with an audit trail',async()=>{
 const built=fixture()
 const rows=rowsFor(built,'val_commitments').map(row=>({...row,client_external_key:built.externalKey,evidence_refs:JSON.parse(row.evidence_refs),audit:JSON.parse(row.audit)}))
 const repository=new ValRepository({db:{configured:true,query:async()=>({rowCount:rows.length,rows})},tenantId,readStore:()=>({}),saveStore:()=>{}})
 const commitments=await repository.listCommitments({tenantId,ownerId,clientId:built.externalKey})
 assert.equal(commitments.length,2)
 for(const commitment of commitments){
  assert.deepEqual(validateCommitment(commitment),[])
  const accepted=transitionCommitment(commitment,{status:'ACCEPTED',updated_by:ownerId,now})
  assert.equal(accepted.status,'ACCEPTED')
  assert.match(accepted.audit.request_id,/val-demo-synthetic-v1:/)
 }
})

test('seeding twice preserves edits, archived status, removed related rows and original dates',async()=>{
 const db=memoryDatabase()
 const first=await seedDemoProducer({...scope,database:db.database})
 assert.equal(first.created,true)
 const client=db.stored.find(item=>item.table==='clients').row
 client.name='Nome editado pelo usuário'
 client.status='archived'
 client.external_key='demo-chave-editada'
 db.stored.find(item=>item.table==='fields').row.name='Contorno corrigido pelo usuário'
 db.stored.splice(db.stored.findIndex(item=>item.table==='crop_seasons'),1)
 const before=structuredClone(db.stored)
 const second=await seedDemoProducer({...scope,now:'2026-12-25T12:00:00Z',database:db.database})
 assert.equal(second.created,false)
 assert.equal(second.preserved,true)
 assert.equal(second.name,client.name)
 assert.equal(second.externalKey,client.external_key)
 assert.deepEqual(db.stored,before)
 assert.ok(db.calls.every(call=>!/\b(?:UPDATE|DELETE|TRUNCATE|ALTER)\b/.test(call.sql.replace(/FOR UPDATE/g,''))))
})

test('seed denies production, fallback databases and unauthorized tenant memberships before inserting',async()=>{
 const db=memoryDatabase({authorized:false})
 await assert.rejects(seedDemoProducer({...scope,environment:'production',database:db.database}),error=>error.code==='demo_environment_denied')
 assert.equal(db.calls.length,0)
 await assert.rejects(seedDemoProducer({...scope,database:{configured:false}}),error=>error.code==='demo_database_required')
 await assert.rejects(seedDemoProducer({...scope,database:db.database}),error=>error.code==='demo_owner_scope_denied')
 assert.equal(db.stored.length,0)
 assert.equal(db.calls.some(call=>call.sql.startsWith('INSERT')),false)
 assert.throws(()=>buildDemoProducerFixture({...scope,ownerId:''}),error=>error.code==='demo_scope_required')
})

test('errors roll back the complete graph and reserved-key collisions never claim unrelated clients',async()=>{
 const broken=memoryDatabase({failTable:'soil_measurements'})
 await assert.rejects(seedDemoProducer({...scope,database:broken.database}),/injected transaction failure/)
 assert.equal(broken.stored.length,0)
 const collision=memoryDatabase()
 collision.add({table:'clients',row:{id:'00000000-0000-4000-8000-000000000555',tenant_id:tenantId,consultant_id:ownerId,external_key:DEMO_PRODUCER_KEY,name:'Existing unrelated client'}})
 await assert.rejects(seedDemoProducer({...scope,database:collision.database}),error=>error.code==='demo_identity_conflict')
 assert.equal(collision.stored.length,1)
})

test('two owners receive disjoint IDs and independent producer graphs',async()=>{
 const db=memoryDatabase()
 const first=await seedDemoProducer({...scope,database:db.database})
 const otherOwner='00000000-0000-4000-8000-000000000103'
 const second=await seedDemoProducer({...scope,ownerId:otherOwner,database:db.database})
 assert.notEqual(first.clientId,second.clientId)
 assert.equal(db.stored.filter(item=>item.table==='clients').length,2)
 assert.equal(new Set(db.stored.map(item=>item.row.id)).size,db.stored.length)
 const fixtureOther=buildDemoProducerFixture({...scope,tenantId:'00000000-0000-4000-8000-000000000104'})
 assert.notEqual(fixtureOther.clientId,first.clientId)
 const upperScope={...scope,tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ownerId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
 assert.equal(buildDemoProducerFixture(upperScope).clientId,buildDemoProducerFixture({...upperScope,tenantId:upperScope.tenantId.toUpperCase(),ownerId:upperScope.ownerId.toUpperCase()}).clientId)
})

test('demo pipeline retains two priced canonical opportunities with independent stable IDs and repeat-safe edits',()=>{
 const built=fixture()
 const profile=JSON.parse(rowsFor(built,'client_profiles')[0].profile_snapshot)
 const persisted=rowsFor(built,'opportunities').map(row=>({id:`o-${built.externalKey}`,clientId:built.externalKey,title:row.title,value:row.estimated_value,stage:row.stage,candidateKey:JSON.parse(row.evidence)[0].candidateKey}))
 const pipeline=reconcilePipeline([profile],persisted)
 assert.equal(pipeline.length,2)
 assert.equal(new Set(pipeline.map(item=>item.id)).size,2)
 assert.deepEqual(pipeline.map(item=>item.value),[110000,72000])
 const advanced=advancePipelineItem(pipeline,pipeline[0].id,now)
 assert.deepEqual(advanced.map(item=>item.stage),['Proposta','Diagnóstico'])
 const reconciled=reconcilePipeline([profile],[...pipeline,...advanced])
 assert.equal(reconciled.length,2)
 assert.deepEqual(reconciled.map(item=>item.stage),['Proposta','Diagnóstico'])
 assert.ok(pipeline.every(item=>item.source==='val-demo-synthetic-v1'))
 // A coincidentally matching cache key on a real client cannot opt in.
 assert.equal(reconcilePipeline([{...profile,commercial:{...profile.commercial,synthetic:false}}],persisted).length,1)
})

test('CLI defaults to a reviewable dry run and never falls back to general DATABASE_URL',async()=>{
 const env={VAL_DEMO_ENVIRONMENT:'test',VAL_DEMO_TENANT_ID:tenantId,VAL_DEMO_OWNER_ID:ownerId,DATABASE_URL:'postgresql://unused@example.invalid/production'}
 const result=await runDemoProducerSeed({env,args:[]})
 assert.equal(result.dryRun,true)
 assert.equal(result.counts.fields,4)
 await assert.rejects(runDemoProducerSeed({env,args:['--apply']}),/VAL_DEMO_DATABASE_URL/)
 await assert.rejects(runDemoProducerSeed({env:{...env,VAL_DEMO_DATABASE_URL:env.DATABASE_URL},args:['--apply']}),/Banco recusado/)
})
