import assert from 'node:assert/strict'
import test from 'node:test'
import {ValCore} from '../server/core/val-core.js'

const tenant='00000000-0000-4000-8000-000000000001'
const actor='00000000-0000-4000-8000-000000000111'

test('VAL Core liga RequestEnvelope v1 ao ContextSnapshot sem alterar o envelope aprovado',async()=>{
  let engineInput
  const engine={answer:async input=>{
    engineInput=input
    return {recommendationId:'recommendation-1',contextSnapshotId:'00000000-0000-5000-a000-000000000321',contextSnapshotVersion:'val.context_snapshot.v1',engineMode:'rules',advice:{next_best_action:'Confirmar dados.',evidence_used:[],confidence:{level:'PROVÁVEL',missing_data:[]}}}
  }}
  const core=new ValCore({engine,tenantId:tenant,observeFn:()=>{}})
  const request=core.createRequest({request_id:'00000000-0000-4000-8000-000000000320',organization_id:tenant,actor:{id:actor,role:'consultant'},subject:{type:'client',id:'client-1'},objective:'prepare_visit',context_refs:[{type:'client',id:'client-1'}],policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:actor}})
  const response=await core.execute(request,{engineInput:{tenantId:tenant,ownerId:actor,clientId:'client-1',message:'Prepare a visita'}})
  assert.deepEqual(engineInput.contextRequest,{requestId:request.request_id,objective:'prepare_visit',actorRole:'consultant',scope:'own_portfolio',contextRefs:[{type:'client',id:'client-1'}]})
  assert.equal(response.contract_version,'val.response.v1')
  assert.deepEqual(response.evidence_refs,[{id:'00000000-0000-5000-a000-000000000321',type:'val.context_snapshot.v1'}])
  assert.equal(response.recommendation.contextSnapshotVersion,'val.context_snapshot.v1')
})
