export const actionPlanVersion='val.action_plan.v1'
export const commitmentVersion='val.commitment.v1'
export const insightCardVersion='val.insight_card.v1'
export const prepareVisitVersion='val.prepare_visit.v1'
export const executionCompositionVersion='val.execution_composition.v1'
export const insightPriorityPolicyVersion='val.insight_priority.experimental.v1'

export const executionStatuses=Object.freeze(['PROPOSED','ACCEPTED','IN_PROGRESS','DONE','BLOCKED','CANCELLED'])
export const insightCategories=Object.freeze(['ACT_NOW','PREPARE','FOLLOW_UP','LEARN'])
export const ownerTypes=Object.freeze(['USER','CLIENT','EXTERNAL'])

const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=value=>String(value??'').trim()
const list=value=>Array.isArray(value)?value:[]
const finite=value=>Number.isFinite(Number(value))
const date=value=>value==null||value===''||!Number.isNaN(new Date(value).getTime())
const unique=values=>[...new Set(values)]

function referenceViolations(references,path){
 const violations=[]
 if(!Array.isArray(references))return [path]
 references.forEach((reference,index)=>{
  if(!object(reference)||!text(reference.id))violations.push(`${path}[${index}]`)
 })
 return violations
}

function priorityViolations(priority,index){
 const path=`priorities[${index}]`
 const violations=[]
 if(!object(priority))return [path]
 for(const key of ['action_id','title','description','reason','status','created_at','updated_at'])if(!text(priority[key]))violations.push(`${path}.${key}`)
 if(!executionStatuses.includes(priority.status))violations.push(`${path}.status`)
 if(priority.owner!==null&&(!object(priority.owner)||!ownerTypes.includes(priority.owner.type)||!text(priority.owner.id)))violations.push(`${path}.owner`)
 if(!date(priority.due_at))violations.push(`${path}.due_at`)
 if(typeof priority.success_criteria!=='string')violations.push(`${path}.success_criteria`)
 if(!Array.isArray(priority.evidence_required))violations.push(`${path}.evidence_required`)
 if(!finite(priority.confidence)||Number(priority.confidence)<0||Number(priority.confidence)>1)violations.push(`${path}.confidence`)
 violations.push(...referenceViolations(priority.source_refs,`${path}.source_refs`))
 return violations
}

export function validateActionPlan(value){
 const violations=[]
 if(!object(value))return ['action_plan']
 if(value.contract_version!==actionPlanVersion||value.version!==actionPlanVersion)violations.push('contract_version')
 for(const key of ['action_plan_id','organization_id','subject_id','decision_thesis_id','value_plan_id','context_snapshot_id','created_at','updated_at'])if(!text(value[key]))violations.push(key)
 if(!Array.isArray(value.priorities)||value.priorities.length>3)violations.push('priorities')
 list(value.priorities).forEach((priority,index)=>violations.push(...priorityViolations(priority,index)))
 return unique(violations)
}

export function validateCommitment(value){
 const violations=[]
 if(!object(value))return ['commitment']
 if(value.contract_version!==commitmentVersion||value.version!==commitmentVersion)violations.push('contract_version')
 for(const key of ['commitment_id','organization_id','client_id','description','owner_type','owner_id','due_at','status','success_criteria','source_ref','created_at'])if(!text(value[key]))violations.push(key)
 if(value.action_plan_id!==null&&value.action_plan_id!==undefined&&!text(value.action_plan_id))violations.push('action_plan_id')
 if(!ownerTypes.includes(value.owner_type))violations.push('owner_type')
 if(!executionStatuses.includes(value.status))violations.push('status')
 if(!date(value.due_at)||!date(value.completed_at)||!date(value.cancelled_at))violations.push('timestamps')
 if(typeof value.agreed_with_client!=='boolean')violations.push('agreed_with_client')
 violations.push(...referenceViolations(value.evidence_refs,'evidence_refs'))
 if(!object(value.audit)||!text(value.audit.created_by)||!text(value.audit.request_id))violations.push('audit')
 if(value.status==='DONE'&&!value.evidence_refs.length)violations.push('evidence_refs.done')
 if(value.status==='DONE'&&!text(value.completed_at))violations.push('completed_at')
 if(value.status==='CANCELLED'&&!text(value.cancelled_at))violations.push('cancelled_at')
 return unique(violations)
}

export function validateInsightCard(value){
 const violations=[]
 if(!object(value))return ['insight_card']
 if(value.contract_version!==insightCardVersion||value.version!==insightCardVersion)violations.push('contract_version')
 for(const key of ['insight_id','organization_id','actor_id','subject_id','category','title','summary','why_now','recommended_action','expires_at','created_at','priority_policy_version'])if(!text(value[key]))violations.push(key)
 if(!insightCategories.includes(value.category))violations.push('category')
 if(!finite(value.priority)||Number(value.priority)<0||Number(value.priority)>100)violations.push('priority')
 if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
 if(!['SUPPORTED','HYPOTHESIS'].includes(value.epistemic_status))violations.push('epistemic_status')
 if(!date(value.expires_at)||!date(value.created_at))violations.push('timestamps')
 violations.push(...referenceViolations(value.evidence_refs,'evidence_refs'))
 return unique(violations)
}

export function validatePrepareVisit(value){
 const violations=[]
 if(!object(value))return ['prepare_visit']
 if(value.contract_version!==prepareVisitVersion||value.version!==prepareVisitVersion)violations.push('contract_version')
 for(const key of ['preparation_id','organization_id','visit_id','subject_id','context_snapshot_id','behavioral_profile_version','decision_thesis_id','decision_thesis_version','value_plan_id','value_plan_version','action_plan_id','objective','why_now','val_thesis','visit_type','created_at'])if(!text(value[key]))violations.push(key)
 if(!['COMMERCIAL','TECHNICAL','RELATIONSHIP','PENDING_ITEM'].includes(value.visit_type))violations.push('visit_type')
 for(const key of ['golden_questions','proofs_to_take','priority_actions','missing_information','secondary_opportunities'])if(!Array.isArray(value[key]))violations.push(key)
 if(list(value.golden_questions).length>3)violations.push('golden_questions')
 if(list(value.priority_actions).length>3)violations.push('priority_actions')
 if(!object(value.profile_approach))violations.push('profile_approach')
 if(!object(value.main_opportunity))violations.push('main_opportunity')
 return unique(violations)
}

export class ExecutionContractError extends Error{
 constructor(contract,violations){super(`${contract} inválido.`);this.name='ExecutionContractError';this.code='execution_contract_invalid';this.contract=contract;this.violations=violations}
}

export function assertExecutionContract(value,validator,name){
 const violations=validator(value)
 if(violations.length)throw new ExecutionContractError(name,violations)
 return value
}

export const executionContracts=Object.freeze({
 actionPlan:actionPlanVersion,
 commitment:commitmentVersion,
 insightCard:insightCardVersion,
 prepareVisit:prepareVisitVersion,
 composition:executionCompositionVersion,
 priorityPolicy:insightPriorityPolicyVersion
})
