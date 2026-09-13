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

// PLAN-02: reabrir a preparação gera um plano novo com o MESMO action_id e o id do compromisso é um
// hash que inclui created_at — o segundo clique em "Assumir compromisso" inseria outra linha e a
// mesma pendência aparecia duplicada na ficha do produtor, como se fossem dois acordos.
test('uma ação vira um compromisso só, mesmo com a preparação reaberta',async()=>{
 const {instance}=repository()
 const base={organization_id:tenantA,client_id:'producer-a',visit_id:visitId,description:'Levar o comparativo de custo por hectare.',owner_type:'USER',owner_id:actorA,due_at:'2026-09-30T12:00:00Z',success_criteria:'Comparativo entregue.',agreed_with_client:true,status:'ACCEPTED',evidence_refs:[],source_ref:'manual:test',created_by:actorA,action_id:'acao-1'}
 const primeiro=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{...base,request_id:'req-1'}})
 const segundo=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{...base,request_id:'req-2'}})
 assert.equal(segundo.commitment_id,primeiro.commitment_id)
 const lista=await instance.listCommitments({tenantId:tenantA,ownerId:actorA})
 assert.equal(lista.filter(item=>item.action_id==='acao-1').length,1)
 // Outra ação continua virando outro compromisso.
 const outro=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{...base,action_id:'acao-2',description:'Trazer o laudo de solo.',request_id:'req-3'}})
 assert.notEqual(outro.commitment_id,primeiro.commitment_id)
 assert.equal((await instance.listCommitments({tenantId:tenantA,ownerId:actorA})).length,2)
})

test('compromisso cancelado libera a ação para ser assumida de novo',async()=>{
 const {instance}=repository()
 const base={organization_id:tenantA,client_id:'producer-a',visit_id:visitId,description:'Retornar com a proposta.',owner_type:'USER',owner_id:actorA,due_at:'2026-09-30T12:00:00Z',success_criteria:'Proposta entregue.',agreed_with_client:true,status:'ACCEPTED',evidence_refs:[],source_ref:'manual:test',created_by:actorA,action_id:'acao-3'}
 const primeiro=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{...base,request_id:'req-4'}})
 await instance.updateCommitment({tenantId:tenantA,ownerId:actorA,id:primeiro.commitment_id,input:{status:'CANCELLED',request_id:'req-cancel'}})
 const segundo=await instance.saveCommitment({tenantId:tenantA,ownerId:actorA,input:{...base,request_id:'req-5'}})
 // O id do compromisso é determinístico (hash dos campos), então reassumir a mesma ação com os
 // mesmos dados devolve o mesmo id. O que importa aqui é que o cancelado não é reaproveitado: o
 // registro que volta está aberto de novo, e não CANCELLED.
 assert.notEqual(segundo.status,'CANCELLED')
 assert.equal((await instance.listCommitments({tenantId:tenantA,ownerId:actorA})).filter(item=>item.action_id==='acao-3'&&item.status!=='CANCELLED').length,1)
})
