import assert from 'node:assert/strict'
import test from 'node:test'
import {legacyRecommendationResponse,ValCore} from '../server/core/val-core.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const actorId='00000000-0000-4000-8000-000000000111'

const requestInput={
  request_id:'00000000-0000-4000-8000-000000000204',organization_id:tenantId,
  actor:{id:actorId,role:'consultant'},subject:{type:'client',id:'cliente-1'},objective:'next_best_action',context_refs:[{type:'client',id:'cliente-1'}],
  policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:actorId}
}

test('VAL Core envolve a engine existente sem alterar a recomendação legada',async()=>{
  const calls=[];const events=[]
  const legacyResult={recommendationId:'r-1',engineMode:'rules',route:'daily',advice:{next_best_action:'Confirmar a visita.',evidence_used:[{id:'ev-1',source_type:'visit'}],confidence:{missing_data:['Confirmar horário.']}}}
  const times=[new Date('2026-08-20T12:00:00.000Z'),new Date('2026-08-20T12:00:00.010Z')]
  const core=new ValCore({engine:{answer:async input=>{calls.push(input);return legacyResult}},tenantId,clock:()=>times.shift(),observeFn:(stage,details)=>events.push({stage,details})})
  const request=core.createRequest(requestInput)
  const response=await core.execute(request,{engineInput:{tenantId,clientId:'cliente-1',message:'Próxima ação'}})
  assert.equal(calls.length,1)
  assert.deepEqual(response.recommendation,legacyResult)
  assert.equal(response.contract_version,'val.response.v1')
  assert.equal(response.request_id,requestInput.request_id)
  assert.equal(response.audit.route_id,'next_best_action.v1')
  assert.equal(response.audit.actor_ref.length,16)
  assert.doesNotMatch(JSON.stringify(response.audit),new RegExp(actorId))
  assert.deepEqual(response.evidence_refs,[{id:'ev-1',type:'visit'}])
  assert.deepEqual(response.assumptions,['Confirmar horário.'])
  assert.equal(response.confidence,'INSUFICIENTE')
  assert.deepEqual(response.next_actions,[{description:'Confirmar a visita.'}])
  assert.deepEqual(legacyRecommendationResponse(response,'00000000-0000-4000-8000-000000000999'),{...legacyResult,requestId:'00000000-0000-4000-8000-000000000999'})
  assert.ok(events.some(event=>event.stage==='core.route.selected'))
  assert.ok(events.some(event=>event.stage==='core.response.completed'))
})

test('VAL Core entrega à engine o signal efetivo e encadeado do módulo',async()=>{
  const parent=new AbortController()
  let receivedSignal=null
  const core=new ValCore({engine:{answer:async input=>{receivedSignal=input.signal;return {advice:{next_best_action:'Confirmar.'}}}},tenantId,observeFn:()=>{}})
  const request=core.createRequest(requestInput)
  await core.execute(request,{engineInput:{tenantId,ownerId:actorId,clientId:'cliente-1',signal:parent.signal}})
  assert.ok(receivedSignal instanceof AbortSignal)
  assert.notEqual(receivedSignal,parent.signal)
  assert.equal(receivedSignal.aborted,false)
})

test('policy é executada antes da ValEngine em tentativa cross-tenant',async()=>{
  let calls=0
  const core=new ValCore({engine:{answer:async()=>{calls++;return {}}},tenantId,observeFn:()=>{}})
  const request=core.createRequest({...requestInput,organization_id:'00000000-0000-4000-8000-000000000002'})
  await assert.rejects(()=>core.execute(request,{engineInput:{}}),error=>error.code==='cross_tenant_scope_denied')
  assert.equal(calls,0)
})

test('binding interno não permite trocar tenant, ator ou cliente depois da autorização',async()=>{
  let calls=0
  const core=new ValCore({engine:{answer:async()=>{calls++;return {}}},tenantId,observeFn:()=>{}})
  const request=core.createRequest(requestInput)
  const attempts=[
    {tenantId:'00000000-0000-4000-8000-000000000002',ownerId:actorId,clientId:'cliente-1'},
    {tenantId,ownerId:'outro-ator',clientId:'cliente-1'},
    {tenantId,ownerId:actorId,clientId:'outro-cliente'},
    {tenantId,ownerId:actorId,clientId:'cliente-1',client:{id:'outro-cliente'}}
  ]
  for(const engineInput of attempts)await assert.rejects(()=>core.execute(request,{engineInput}),error=>error.code==='execution_binding_denied')
  assert.equal(calls,0)
})
