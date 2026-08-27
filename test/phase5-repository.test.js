import test from 'node:test'
import assert from 'node:assert/strict'
import {ValRepository} from '../server/repository.js'
import {prepareVisitExecution} from '../server/execution/service.js'
import {tenantA,tenantB,actorA} from '../support/phase4-test-context.js'

const actorB='00000000-0000-4000-8000-000000000499'
const visitId='00000000-0000-4000-8000-000000000501'
const initial=()=>({surveys:[],imports:[],visits:[{id:visitId,tenantId:tenantA,ownerId:actorA,clientId:'producer-a',scheduledAt:'2026-08-25T12:00:00.000Z',objective:'Negociar com evidência.',status:'Agendada',createdAt:'2026-08-20T00:00:00.000Z',updatedAt:'2026-08-20T00:00:00.000Z'}],opportunities:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},contextSnapshots:[],actionPlans:[],commitments:[]}})

function repository(){
 let store=initial()
 const instance=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:value=>{store=structuredClone(value)},tenantId:tenantA})
 return {instance,store:()=>store}
}

test('preparação local persiste ActionPlan e ContextSnapshot rastreáveis',async()=>{
 const {instance,store}=repository()
 const result=await prepareVisitExecution({repository:instance,tenantId:tenantA,actor:{id:actorA,role:'consultant'},visitId,requestId:'00000000-0000-4000-8000-000000000502',now:new Date('2026-08-22T12:00:00.000Z')})
 assert.equal(result.preparation.visit_id,visitId)
 assert.equal(store().val.actionPlans.length,1)
 assert.equal(store().val.contextSnapshots.length,1)
 assert.equal(store().val.actionPlans[0].context_snapshot_id,result.context_snapshot_ref.id)
})

test('repositório rejeita sugestão incompleta como Commitment',async()=>{
 const {instance}=repository()
 await assert.rejects(()=>instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{organization_id:tenantA,client_id:'producer-a',description:'Retornar.',owner_id:actorA,due_at:null,success_criteria:'Resposta.',source_ref:'manual:test',request_id:'request'}}),error=>error.code==='commitment_incomplete'&&error.statusCode===422)
})

test('repositório rejeita referência a ActionPlan fora da carteira autorizada',async()=>{
 const {instance}=repository()
 await assert.rejects(()=>instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{organization_id:tenantA,client_id:'producer-a',visit_id:visitId,action_plan_id:'00000000-0000-4000-8000-000000000599',description:'Retornar.',owner_id:actorA,due_at:'2026-08-29T12:00:00.000Z',success_criteria:'Resposta.',source_ref:'manual:test',request_id:'request'}}),error=>error.statusCode===404)
})

test('Commitment persiste, lista e só conclui com evidência',async()=>{
 const {instance}=repository()
 const created=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{organization_id:tenantA,client_id:'producer-a',visit_id:visitId,description:'Retornar com comparativo.',owner_type:'USER',owner_id:actorA,due_at:'2026-08-29T12:00:00.000Z',status:'ACCEPTED',success_criteria:'Resposta registrada.',agreed_with_client:true,evidence_refs:[],source_ref:'manual:test',request_id:'request-create',created_by:actorA}})
 await assert.rejects(()=>instance.updateCommitment({tenantId:tenantA,ownerId:actorA,id:created.commitment_id,input:{status:'DONE'}}),error=>error.code==='commitment_completion_evidence_required')
 const done=await instance.updateCommitment({tenantId:tenantA,ownerId:actorA,id:created.commitment_id,input:{status:'DONE',evidence_refs:[{id:'result:one'}],request_id:'request-done'}})
 assert.equal(done.status,'DONE')
 assert.equal((await instance.listCommitments({tenantId:tenantA,ownerId:actorA})).length,1)
})

test('carteira de outro ator não lê nem altera Commitment',async()=>{
 const {instance}=repository()
 const created=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{organization_id:tenantA,client_id:'producer-a',visit_id:visitId,description:'Retornar.',owner_id:actorA,due_at:'2026-08-29T12:00:00.000Z',success_criteria:'Resposta.',source_ref:'manual:test',request_id:'request',created_by:actorA}})
 assert.deepEqual(await instance.listCommitments({tenantId:tenantA,ownerId:actorB}),[])
 await assert.rejects(()=>instance.updateCommitment({tenantId:tenantA,ownerId:actorB,id:created.commitment_id,input:{status:'BLOCKED'}}),error=>error.statusCode===404)
})

test('repositório bloqueia tenant diferente antes de consultar dados',async()=>{
 const {instance}=repository()
 await assert.rejects(()=>instance.getVisit({tenantId:tenantB,ownerId:actorA,id:visitId}),error=>error.code==='cross_tenant_denied'||error.statusCode===403)
})
