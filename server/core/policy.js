import {assertTenantScope} from '../tenant-scope.js'
import {assertRequestEnvelope} from './contracts.js'

export const corePolicyVersion='val.core.policy.v1'

const roleCapabilities=Object.freeze({
  admin:Object.freeze(['val_recommendation:execute:own_portfolio']),
  manager:Object.freeze(['val_recommendation:execute:own_portfolio']),
  consultant:Object.freeze(['val_recommendation:execute:own_portfolio']),
  technical_reviewer:Object.freeze(['val_recommendation:execute:own_portfolio'])
})

export const coreRoleCapabilities=roleCapabilities

export class CorePolicyError extends Error{
  constructor(code='core_policy_denied'){
    super('A política do VAL Core negou esta operação.')
    this.name='CorePolicyError'
    this.statusCode=403
    this.code=code
  }
}

export function authorizeCoreRequest(envelope,{configuredTenantId}={}){
  assertRequestEnvelope(envelope)
  try{assertTenantScope(configuredTenantId,envelope.organization_id)}catch{throw new CorePolicyError('cross_tenant_scope_denied')}
  const capability=`${envelope.policy_context.resource}:${envelope.policy_context.operation}:${envelope.policy_context.scope}`
  if(!roleCapabilities[envelope.actor.role]?.includes(capability))throw new CorePolicyError()
  if(envelope.policy_context.scope_ref!==envelope.actor.id)throw new CorePolicyError('portfolio_scope_denied')
  return Object.freeze({
    allowed:true,
    policy_version:corePolicyVersion,
    capability,
    organization_id:envelope.organization_id,
    scope:envelope.policy_context.scope
  })
}
