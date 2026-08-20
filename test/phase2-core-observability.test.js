import assert from 'node:assert/strict'
import test from 'node:test'
import {runWithRequestContext} from '../server/observability.js'
import {ValCore} from '../server/core/val-core.js'

test('request_id liga policy, router, executor, ValEngine adaptada e resposta',async()=>{
  const requestId='00000000-0000-4000-8000-000000000205'
  const tenantId='00000000-0000-4000-8000-000000000001'
  const actorId='00000000-0000-4000-8000-000000000111'
  const logs=[]
  await runWithRequestContext({requestId,method:'POST',path:'/api/v1/val/recommendations',tenantId,actorId},async()=>{
    const core=new ValCore({engine:{answer:async()=>({engineMode:'rules',advice:{next_best_action:'Confirmar o próximo passo.',evidence_used:[]}})},tenantId})
    const envelope=core.createRequest({request_id:requestId,organization_id:tenantId,actor:{id:actorId,role:'consultant'},subject:{type:'client',id:'cliente-1'},objective:'next_best_action',context_refs:[],policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:actorId}})
    await core.execute(envelope,{engineInput:{tenantId,ownerId:actorId,clientId:'cliente-1'}})
  },{logger:value=>logs.push(JSON.parse(value))})
  const stages=logs.map(event=>event.stage)
  for(const required of ['core.request.received','core.policy.allowed','core.route.selected','core.module.started','core.module.completed','core.response.completed'])assert.ok(stages.includes(required),`evento ausente: ${required}`)
  assert.ok(logs.every(event=>event.request_id===requestId))
  assert.doesNotMatch(JSON.stringify(logs),new RegExp(actorId))
})
