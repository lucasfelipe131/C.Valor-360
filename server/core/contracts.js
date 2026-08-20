const requestIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const organizationIdPattern=/^[a-z0-9][a-z0-9._:@-]{0,179}$/i
const roles=new Set(['admin','manager','consultant','technical_reviewer'])
const objectives=new Set(['prepare_visit','agronomic_question','agronomic_critical','next_best_action','general_assistance'])
const confidenceLevels=new Set(['VERIFICADO','PROVÁVEL','HIPÓTESE','INSUFICIENTE'])
const responseStatuses=new Set(['completed','degraded','denied','failed'])

export const requestEnvelopeVersion='val.request.v1'
export const responseEnvelopeVersion='val.response.v1'
export const coreObjectives=Object.freeze([...objectives])
export const coreConfidenceLevels=Object.freeze([...confidenceLevels])

export class ContractValidationError extends Error{
  constructor(contract,violations){
    super(`Contrato ${contract} inválido.`)
    this.name='ContractValidationError'
    this.statusCode=400
    this.code='contract_invalid'
    this.contract=contract
    this.violations=Object.freeze([...violations])
  }
}

const plainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max
const push=(violations,condition,path)=>{if(!condition)violations.push(path)}
const exactKeys=(value,allowed,violations,path)=>{
  if(!plainObject(value))return
  for(const key of Object.keys(value))if(!allowed.has(key))violations.push(`${path}.${key}`)
}

function validateActor(actor,violations){
  push(violations,plainObject(actor),'actor')
  if(!plainObject(actor))return
  exactKeys(actor,new Set(['id','role']),violations,'actor')
  push(violations,text(actor.id,180),'actor.id')
  push(violations,roles.has(actor.role),'actor.role')
}

function validateSubject(subject,violations){
  push(violations,plainObject(subject),'subject')
  if(!plainObject(subject))return
  exactKeys(subject,new Set(['type','id']),violations,'subject')
  push(violations,subject.type==='client','subject.type')
  push(violations,text(subject.id,180),'subject.id')
}

function validateContextRefs(contextRefs,violations){
  push(violations,Array.isArray(contextRefs),'context_refs')
  if(!Array.isArray(contextRefs))return
  push(violations,contextRefs.length<=50,'context_refs.length')
  contextRefs.forEach((reference,index)=>{
    push(violations,plainObject(reference),`context_refs[${index}]`)
    if(!plainObject(reference))return
    exactKeys(reference,new Set(['type','id','version']),violations,`context_refs[${index}]`)
    push(violations,text(reference.type,80),`context_refs[${index}].type`)
    push(violations,text(reference.id,180),`context_refs[${index}].id`)
    if(reference.version!==undefined)push(violations,text(reference.version,80),`context_refs[${index}].version`)
  })
}

function validatePolicyContext(policyContext,violations){
  push(violations,plainObject(policyContext),'policy_context')
  if(!plainObject(policyContext))return
  exactKeys(policyContext,new Set(['resource','operation','scope','scope_ref']),violations,'policy_context')
  push(violations,policyContext.resource==='val_recommendation','policy_context.resource')
  push(violations,policyContext.operation==='execute','policy_context.operation')
  push(violations,policyContext.scope==='own_portfolio','policy_context.scope')
  push(violations,text(policyContext.scope_ref,180),'policy_context.scope_ref')
}

export function validateRequestEnvelope(envelope){
  const violations=[]
  push(violations,plainObject(envelope),'request')
  if(!plainObject(envelope))return violations
  exactKeys(envelope,new Set(['contract_version','request_id','organization_id','actor','subject','objective','context_refs','policy_context']),violations,'request')
  push(violations,envelope.contract_version===requestEnvelopeVersion,'contract_version')
  push(violations,requestIdPattern.test(String(envelope.request_id||'')),'request_id')
  push(violations,text(envelope.organization_id,180)&&organizationIdPattern.test(envelope.organization_id),'organization_id')
  validateActor(envelope.actor,violations)
  validateSubject(envelope.subject,violations)
  push(violations,objectives.has(envelope.objective),'objective')
  validateContextRefs(envelope.context_refs,violations)
  validatePolicyContext(envelope.policy_context,violations)
  return violations
}

export function assertRequestEnvelope(envelope){
  const violations=validateRequestEnvelope(envelope)
  if(violations.length)throw new ContractValidationError(requestEnvelopeVersion,violations)
  return envelope
}

export function createRequestEnvelope(input){
  return assertRequestEnvelope({
    contract_version:requestEnvelopeVersion,
    request_id:String(input?.request_id||''),
    organization_id:String(input?.organization_id||''),
    actor:{id:String(input?.actor?.id||''),role:String(input?.actor?.role||'')},
    subject:{type:String(input?.subject?.type||''),id:String(input?.subject?.id||'')},
    objective:String(input?.objective||''),
    context_refs:Array.isArray(input?.context_refs)?input.context_refs.map(reference=>({...reference})):input?.context_refs,
    policy_context:plainObject(input?.policy_context)?{...input.policy_context}:input?.policy_context
  })
}

function validateEvidenceRefs(evidenceRefs,violations){
  push(violations,Array.isArray(evidenceRefs),'evidence_refs')
  if(!Array.isArray(evidenceRefs))return
  push(violations,evidenceRefs.length<=50,'evidence_refs.length')
  evidenceRefs.forEach((reference,index)=>{
    push(violations,plainObject(reference),`evidence_refs[${index}]`)
    if(!plainObject(reference))return
    exactKeys(reference,new Set(['id','type']),violations,`evidence_refs[${index}]`)
    push(violations,text(reference.id,180),`evidence_refs[${index}].id`)
    if(reference.type!==undefined)push(violations,text(reference.type,80),`evidence_refs[${index}].type`)
  })
}

function validateNextActions(nextActions,violations){
  push(violations,Array.isArray(nextActions),'next_actions')
  if(!Array.isArray(nextActions))return
  push(violations,nextActions.length<=5,'next_actions.length')
  nextActions.forEach((action,index)=>{
    push(violations,plainObject(action),`next_actions[${index}]`)
    if(!plainObject(action))return
    exactKeys(action,new Set(['description']),violations,`next_actions[${index}]`)
    push(violations,text(action.description,2000),`next_actions[${index}].description`)
  })
}

function validateAudit(audit,violations){
  push(violations,plainObject(audit),'audit')
  if(!plainObject(audit))return
  exactKeys(audit,new Set(['contract_version','request_id','organization_id','actor_ref','route_id','objective','planned_modules','module_runs','policy_decision','started_at','completed_at']),violations,'audit')
  push(violations,audit.contract_version==='val.core.audit.v1','audit.contract_version')
  push(violations,requestIdPattern.test(String(audit.request_id||'')),'audit.request_id')
  push(violations,text(audit.organization_id,180),'audit.organization_id')
  push(violations,/^[0-9a-f]{16}$/.test(String(audit.actor_ref||'')),'audit.actor_ref')
  push(violations,text(audit.route_id,120),'audit.route_id')
  push(violations,text(audit.objective,120),'audit.objective')
  push(violations,Array.isArray(audit.planned_modules)&&audit.planned_modules.every(item=>text(item,80)),'audit.planned_modules')
  push(violations,Array.isArray(audit.module_runs),'audit.module_runs')
  if(Array.isArray(audit.module_runs))audit.module_runs.forEach((run,index)=>{
    push(violations,plainObject(run),`audit.module_runs[${index}]`)
    if(!plainObject(run))return
    exactKeys(run,new Set(['module_id','status','required','duration_ms','error_code']),violations,`audit.module_runs[${index}]`)
    push(violations,text(run.module_id,120),`audit.module_runs[${index}].module_id`)
    push(violations,['completed','unavailable','failed'].includes(run.status),`audit.module_runs[${index}].status`)
    push(violations,typeof run.required==='boolean',`audit.module_runs[${index}].required`)
    push(violations,Number.isInteger(run.duration_ms)&&run.duration_ms>=0,`audit.module_runs[${index}].duration_ms`)
    if(run.error_code!==undefined)push(violations,text(run.error_code,80),`audit.module_runs[${index}].error_code`)
  })
  push(violations,text(audit.started_at,80),'audit.started_at')
  push(violations,text(audit.completed_at,80),'audit.completed_at')
  push(violations,plainObject(audit.policy_decision),'audit.policy_decision')
  if(plainObject(audit.policy_decision)){
    exactKeys(audit.policy_decision,new Set(['allowed','policy_version','scope']),violations,'audit.policy_decision')
    push(violations,audit.policy_decision.allowed===true,'audit.policy_decision.allowed')
    push(violations,audit.policy_decision.policy_version==='val.core.policy.v1','audit.policy_decision.policy_version')
    push(violations,audit.policy_decision.scope==='own_portfolio','audit.policy_decision.scope')
  }
}

export function validateResponseEnvelope(envelope){
  const violations=[]
  push(violations,plainObject(envelope),'response')
  if(!plainObject(envelope))return violations
  exactKeys(envelope,new Set(['contract_version','request_id','organization_id','status','recommendation','evidence_refs','assumptions','confidence','next_actions','audit']),violations,'response')
  push(violations,envelope.contract_version===responseEnvelopeVersion,'contract_version')
  push(violations,requestIdPattern.test(String(envelope.request_id||'')),'request_id')
  push(violations,text(envelope.organization_id,180)&&organizationIdPattern.test(envelope.organization_id),'organization_id')
  push(violations,responseStatuses.has(envelope.status),'status')
  push(violations,envelope.recommendation===null||plainObject(envelope.recommendation),'recommendation')
  validateEvidenceRefs(envelope.evidence_refs,violations)
  push(violations,Array.isArray(envelope.assumptions)&&envelope.assumptions.length<=20&&envelope.assumptions.every(item=>text(item,2000)),'assumptions')
  push(violations,confidenceLevels.has(envelope.confidence),'confidence')
  validateNextActions(envelope.next_actions,violations)
  validateAudit(envelope.audit,violations)
  return violations
}

export function assertResponseEnvelope(envelope){
  const violations=validateResponseEnvelope(envelope)
  if(violations.length)throw new ContractValidationError(responseEnvelopeVersion,violations)
  return envelope
}

export function createResponseEnvelope(input){
  return assertResponseEnvelope({
    contract_version:responseEnvelopeVersion,
    request_id:String(input?.request_id||''),
    organization_id:String(input?.organization_id||''),
    status:String(input?.status||''),
    recommendation:input?.recommendation??null,
    evidence_refs:Array.isArray(input?.evidence_refs)?input.evidence_refs.map(reference=>({...reference})):input?.evidence_refs,
    assumptions:Array.isArray(input?.assumptions)?[...input.assumptions]:input?.assumptions,
    confidence:String(input?.confidence||''),
    next_actions:Array.isArray(input?.next_actions)?input.next_actions.map(action=>({...action})):input?.next_actions,
    audit:plainObject(input?.audit)?{...input.audit}:input?.audit
  })
}
