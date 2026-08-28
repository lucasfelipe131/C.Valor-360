import assert from 'node:assert/strict'
import test from 'node:test'
import {createRequestEnvelope} from '../server/core/contracts.js'
import {authorizeCoreRequest,CorePolicyError,coreRoleCapabilities} from '../server/core/policy.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const actorId='00000000-0000-4000-8000-000000000111'

const requestFor=(role='consultant',organizationId=tenantA,scopeRef=actorId)=>createRequestEnvelope({
  request_id:'00000000-0000-4000-8000-000000000202',organization_id:organizationId,
  actor:{id:actorId,role},subject:{type:'client',id:'cliente-confidencial'},objective:'general_assistance',context_refs:[],
  policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:scopeRef}
})

test('matriz efetiva permite a recomendação somente na própria carteira',()=>{
  for(const role of Object.keys(coreRoleCapabilities)){
    const decision=authorizeCoreRequest(requestFor(role),{configuredTenantId:tenantA})
    assert.equal(decision.allowed,true)
    assert.equal(decision.scope,'own_portfolio')
  }
})

test('tentativa cross-tenant é negada antes de qualquer contexto ser consultado',()=>{
  assert.throws(()=>authorizeCoreRequest(requestFor('consultant',tenantB),{configuredTenantId:tenantA}),error=>{
    assert.ok(error instanceof CorePolicyError)
    assert.equal(error.code,'cross_tenant_scope_denied')
    assert.doesNotMatch(error.message,/cliente-confidencial|00000000-0000-4000-8000-000000000002/)
    return true
  })
})

test('scope_ref diferente do ator autenticado falha fechado',()=>{
  assert.throws(()=>authorizeCoreRequest(requestFor('consultant',tenantA,'outro-usuario'),{configuredTenantId:tenantA}),error=>error.code==='portfolio_scope_denied'&&error.statusCode===403)
})
