import assert from 'node:assert/strict'
import test from 'node:test'
import {ValRepository} from '../server/repository.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='00000000-0000-4000-8000-000000000601'
const internalClientId='00000000-0000-4000-8000-000000000610'
const producerId='producer-a'
const visitId='00000000-0000-4000-8000-000000000611'
const observedAt='2026-08-23T15:10:00.000Z'
const memory=(overrides={})=>({
 id:'00000000-0000-4000-8000-000000000701',tenant_id:tenantId,client_id:internalClientId,
 subject_type:'visit',subject_id:visitId,memory_type:'fact',memory_state:'FACT',memory_domain:'COMMERCIAL',
 key:'visit_report.objection',value:{statement:'O produtor achou o preço caro.',category:'PRICE'},
 evidence:[{source_ref:'visit-report:confirmed-fixture',confirmation_status:'CONFIRMED'}],
 confidence:90,status:'verified',source:'confirmed_visit_report',source_ref:'visit-report:confirmed-fixture',source_type:'confirmed_visit_report',
 observed_at:observedAt,source_updated_at:observedAt,valid_from:observedAt,valid_until:null,
 created_by:ownerId,acl:{scope:'own_portfolio'},created_at:observedAt,updated_at:observedAt,
 ...overrides,
})

async function materialize(memories){
 const row={
  id:internalClientId,tenant_id:tenantId,consultant_id:ownerId,external_key:producerId,name:'Produtor sintético',
  commercial_profile:{},relationship_profile:{},memories,memory_history:memories,
  visits:[{id:visitId,objective:'Negociar fertilizante.',status:'Realizada',lifecycle_status:'COMPLETED',scheduled_at:'2026-08-23T14:00:00.000Z',occurred_at:observedAt,completed_at:observedAt,created_at:observedAt,updated_at:observedAt}],
  properties:[{id:'property-a',fields:[{id:'field-a'}]}],
 }
 const repository=new ValRepository({tenantId,db:{configured:true,query:async(sql,params)=>{
  assert.match(sql,/FROM clients c/)
  assert.match(sql,/c\.tenant_id=\$1 AND c\.consultant_id=\$3/)
  assert.deepEqual(params,[tenantId,producerId,ownerId])
  return {rowCount:1,rows:[structuredClone(row)]}
 }},readStore:()=>({}),saveStore:()=>{}})
 return repository.getClientContext({tenantId,ownerId,clientId:producerId,contextRequest:{objective:'prepare_visit',contextDomain:'VISIT',message:'Retornar com comparativo e próximo passo.',now:new Date('2026-08-24T10:00:00.000Z')}})
}

test('PostgreSQL maps the owned client UUID on visit/property/field memories while preserving the original subject and confirmed visit evidence',async()=>{
 const records=[memory(),memory({id:'00000000-0000-4000-8000-000000000702',subject_type:'property',subject_id:'property-a'}),memory({id:'00000000-0000-4000-8000-000000000703',subject_type:'field',subject_id:'field-a'}),memory({id:'00000000-0000-4000-8000-000000000704',subject_type:'client',subject_id:internalClientId})]
 const context=await materialize(records)
 for(const collection of [context.memories,context.memoryHistory])assert.deepEqual(collection.map(item=>[item.client_id,item.subject_type,item.subject_id]),[[producerId,'visit',visitId],[producerId,'property','property-a'],[producerId,'field','field-a'],[producerId,'client',producerId]])
 const objection=context.contextSnapshot.facts.find(item=>item.memory_ref===records[0].id)
 assert.ok(objection,'The confirmed visit price objection must reach the next preparation context.')
 assert.equal(objection.producer_id,producerId)
 assert.equal(objection.owner_id,ownerId)
 assert.equal(objection.source_ref,'visit-report:confirmed-fixture')
 assert.equal(objection.value.category,'PRICE')
 assert.equal(records[0].client_id,internalClientId,'The materializer must not mutate the database row.')
})

test('PostgreSQL memory materialization never turns foreign producer, tenant, author, or subject evidence into owned evidence',async()=>{
 const invalid=[
  {client_id:'00000000-0000-4000-8000-000000000999'},
  {tenant_id:'00000000-0000-4000-8000-000000000002'},
  {created_by:'00000000-0000-4000-8000-000000000602'},
  {subject_id:'foreign-visit'},
 ]
 for(const overrides of invalid){
  const record=memory(overrides)
  const context=await materialize([record])
  assert.ok(!context.contextSnapshot.facts.some(item=>item.memory_ref===record.id),`Foreign memory must remain excluded: ${JSON.stringify(overrides)}`)
 }
 await assert.rejects(materialize([memory({subject_type:'client',subject_id:'foreign-producer'})]),{statusCode:503},'Conflicting producer and client-subject aliases must fail closed.')
})

test('organization memories retain their organization subject and null client association',async()=>{
 const record=memory({subject_type:'organization',subject_id:tenantId,client_id:null})
 const context=await materialize([record])
 assert.equal(context.memories[0].subject_type,'organization')
 assert.equal(context.memories[0].subject_id,tenantId)
 assert.equal(context.memories[0].client_id,null)
})
