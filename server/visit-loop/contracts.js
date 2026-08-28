export const visitLifecycleVersion='val.visit_lifecycle.v1'
export const visitReportVersion='val.visit_report.v1'
export const visitTranscriptVersion='val.visit_transcript.v1'
export const outcomeVersion='val.outcome.v1'
export const learningCandidateVersion='val.learning_candidate.v1'

export const visitLifecycleStatuses=Object.freeze([
  'PLANNED',
  'PREPARED',
  'IN_PROGRESS',
  'COMPLETED_PENDING_REVIEW',
  'COMPLETED',
  'CANCELLED'
])

export const visitReportSourceTypes=Object.freeze(['TEXT','AUDIO'])
export const visitReportConfirmationStatuses=Object.freeze(['PENDING_REVIEW','CONFIRMED','REJECTED'])
export const epistemicCandidateStates=Object.freeze(['FACT_CANDIDATE','INFERENCE','HYPOTHESIS'])
export const outcomeTypes=Object.freeze(['WON','LOST','PARTIAL','NO_DECISION','FOLLOW_UP','TECHNICAL_RESULT','RELATIONSHIP_PROGRESS','NO_CHANGE'])
export const learningCandidateStatuses=Object.freeze(['CANDIDATE','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED'])

const reportArrays=Object.freeze([
  'discussed_topics',
  'expectations_created',
  'objections',
  'producer_signals',
  'opportunities_detected',
  'commitments_proposed',
  'commitments_confirmed',
  'closed_business',
  'pending_business',
  'next_steps',
  'technical_observations',
  'behavioral_signals',
  'missing_information'
])

const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=value=>String(value??'').trim()
const list=value=>Array.isArray(value)?value:[]
const date=value=>value==null||value===''||!Number.isNaN(new Date(value).getTime())
const finite=value=>Number.isFinite(Number(value))
const unique=values=>[...new Set(values)]

export function validateVisitLifecycle(value){
 const violations=[]
 if(!object(value))return ['visit_lifecycle']
 if(value.contract_version!==visitLifecycleVersion||value.version!==visitLifecycleVersion)violations.push('contract_version')
 for(const key of ['visit_id','organization_id','status','updated_at','updated_by'])if(!text(value[key]))violations.push(key)
 if(!visitLifecycleStatuses.includes(value.status))violations.push('status')
 if(!Number.isInteger(Number(value.revision))||Number(value.revision)<0)violations.push('revision')
 if(!date(value.occurred_at)||!date(value.completed_at)||!date(value.cancelled_at))violations.push('timestamps')
 return unique(violations)
}

function itemViolations(item,path){
 const violations=[]
 if(!object(item))return [path]
 if(!text(item.item_id))violations.push(`${path}.item_id`)
 if(item.epistemic_status!==undefined&&!epistemicCandidateStates.includes(item.epistemic_status))violations.push(`${path}.epistemic_status`)
 if(item.confidence!==undefined&&(!finite(item.confidence)||Number(item.confidence)<0||Number(item.confidence)>1))violations.push(`${path}.confidence`)
 return violations
}

export function validateVisitReport(value){
 const violations=[]
 if(!object(value))return ['visit_report']
 if(value.contract_version!==visitReportVersion||value.version!==visitReportVersion)violations.push('contract_version')
 for(const key of ['visit_report_id','visit_id','organization_id','client_id','created_by','source_type','source_ref','visit_objective','summary','confirmation_status','created_at'])if(!text(value[key]))violations.push(key)
 if(!visitReportSourceTypes.includes(value.source_type))violations.push('source_type')
 if(!visitReportConfirmationStatuses.includes(value.confirmation_status))violations.push('confirmation_status')
 if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
 if(!Number.isInteger(Number(value.revision_no))||Number(value.revision_no)<1)violations.push('revision_no')
 if(!date(value.created_at)||!date(value.confirmed_at))violations.push('timestamps')
 if(value.confirmation_status==='CONFIRMED'&&(!text(value.confirmed_at)||!text(value.confirmed_by)))violations.push('confirmation')
 for(const key of reportArrays){
  if(!Array.isArray(value[key])){violations.push(key);continue}
  if(!['discussed_topics'].includes(key))list(value[key]).forEach((item,index)=>violations.push(...itemViolations(item,`${key}[${index}]`)))
 }
 return unique(violations)
}

export function validateOutcome(value){
 const violations=[]
 if(!object(value))return ['outcome']
 if(value.contract_version!==outcomeVersion||value.version!==outcomeVersion)violations.push('contract_version')
 for(const key of ['outcome_id','organization_id','visit_id','client_id','outcome_type','measured_at','recorded_by','created_at'])if(!text(value[key]))violations.push(key)
 if(!outcomeTypes.includes(value.outcome_type))violations.push('outcome_type')
 if(!object(value.result))violations.push('result')
 if(!Array.isArray(value.evidence_refs))violations.push('evidence_refs')
 if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
 if(!date(value.measured_at)||!date(value.created_at))violations.push('timestamps')
 return unique(violations)
}

export function validateLearningCandidate(value){
 const violations=[]
 if(!object(value))return ['learning_candidate']
 if(value.contract_version!==learningCandidateVersion||value.version!==learningCandidateVersion)violations.push('contract_version')
 for(const key of ['candidate_id','organization_id','source_visit_id','hypothesis','created_at'])if(!text(value[key]))violations.push(key)
 if(!object(value.scope))violations.push('scope')
 if(!Array.isArray(value.supporting_evidence))violations.push('supporting_evidence')
 if(!Array.isArray(value.contrary_evidence))violations.push('contrary_evidence')
 if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
 if(!learningCandidateStatuses.includes(value.status))violations.push('status')
 if(!date(value.created_at))violations.push('created_at')
 return unique(violations)
}

export function validateVisitTranscript(value){
 const violations=[]
 if(!object(value))return ['visit_transcript']
 if(value.contract_version!==visitTranscriptVersion||value.version!==visitTranscriptVersion)violations.push('contract_version')
 for(const key of ['transcript_id','organization_id','visit_id','client_id','created_by','provider','status','created_at'])if(!text(value[key]))violations.push(key)
 if(!['PENDING','COMPLETED','FAILED'].includes(value.status))violations.push('status')
 if(value.status==='COMPLETED'&&(!text(value.transcript_text)||!text(value.completed_at)))violations.push('completed')
 if(value.status==='FAILED'&&!text(value.error_code))violations.push('error_code')
 return unique(violations)
}

export class VisitLoopContractError extends Error{
 constructor(contract,violations){super(`${contract} inválido.`);this.name='VisitLoopContractError';this.code='visit_loop_contract_invalid';this.contract=contract;this.violations=violations;this.statusCode=422}
}

export function assertVisitLoopContract(value,validator,name){
 const violations=validator(value)
 if(violations.length)throw new VisitLoopContractError(name,violations)
 return value
}

export const visitLoopContracts=Object.freeze({
 lifecycle:visitLifecycleVersion,
 report:visitReportVersion,
 transcript:visitTranscriptVersion,
 outcome:outcomeVersion,
 learningCandidate:learningCandidateVersion
})

export {reportArrays as visitReportArrayFields}
