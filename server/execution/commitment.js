import {createHash} from 'node:crypto'
import {assertExecutionContract,commitmentVersion,executionStatuses,validateCommitment} from './contracts.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1400)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const iso=value=>{if(value==null||value==='')return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString()}
const reference=value=>typeof value==='string'?{id:text(value,240)}:value&&typeof value==='object'&&text(value.id)?{id:text(value.id,240),...(text(value.type)?{type:text(value.type,80)}:{})}:null
const references=values=>[...new Map(list(values).map(reference).filter(Boolean).map(item=>[`${item.type||''}:${item.id}`,item])).values()]
const uuidFrom=value=>{const hash=createHash('sha256').update(JSON.stringify(value)).digest('hex');return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}

export function commitmentReadiness(input={}){
 const missing=[]
 if(!text(input.owner_id??input.ownerId??input.owner?.id))missing.push('owner_id')
 if(!iso(input.due_at??input.dueAt))missing.push('due_at')
 if(!text(input.success_criteria??input.successCriteria))missing.push('success_criteria')
 return {ready:missing.length===0,missing_fields:missing}
}

export function buildCommitmentCandidate(input={}){
 const readiness=commitmentReadiness(input)
 if(!readiness.ready)return {is_commitment:false,classification:'PROPOSAL',missing_fields:readiness.missing_fields,proposal:{description:text(input.description),status:'PROPOSED'}}
 return {is_commitment:true,classification:'COMMITMENT',missing_fields:[],commitment:buildCommitment(input)}
}

export function buildCommitment(input={}){
 const organizationId=text(input.organization_id??input.organizationId,180)
 const clientId=text(input.client_id??input.clientId,180)
 const ownerType=text(input.owner_type??input.ownerType??input.owner?.type??'USER',30).toUpperCase()
 const ownerId=text(input.owner_id??input.ownerId??input.owner?.id,180)
 const dueAt=iso(input.due_at??input.dueAt)
 const status=executionStatuses.includes(text(input.status).toUpperCase())?text(input.status).toUpperCase():'PROPOSED'
 const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
 const evidence=references(input.evidence_refs??input.evidenceRefs)
 const createdAt=iso(input.created_at??input.createdAt)||now.toISOString()
 const completedAt=status==='DONE'?(iso(input.completed_at??input.completedAt)||now.toISOString()):iso(input.completed_at??input.completedAt)
 const cancelledAt=status==='CANCELLED'?(iso(input.cancelled_at??input.cancelledAt)||now.toISOString()):iso(input.cancelled_at??input.cancelledAt)
 const requestId=text(input.request_id??input.requestId,180)
 return assertExecutionContract({
  contract_version:commitmentVersion,
  version:commitmentVersion,
  commitment_id:text(input.commitment_id??input.commitmentId,180)||uuidFrom({organizationId,clientId,actionId:input.action_id??input.actionId,description:input.description,ownerType,ownerId,dueAt,createdAt}),
  organization_id:organizationId,
  client_id:clientId,
  visit_id:text(input.visit_id??input.visitId,180)||null,
  opportunity_id:text(input.opportunity_id??input.opportunityId,180)||null,
  action_plan_id:text(input.action_plan_id??input.actionPlanId,180)||null,
  action_id:text(input.action_id??input.actionId,180)||null,
  description:text(input.description,1600),
  owner_type:ownerType,
  owner_id:ownerId,
  due_at:dueAt,
  status,
  success_criteria:text(input.success_criteria??input.successCriteria,1000),
  agreed_with_client:input.agreed_with_client===true||input.agreedWithClient===true,
  evidence_refs:evidence,
  created_at:createdAt,
  completed_at:completedAt,
  cancelled_at:cancelledAt,
  source_ref:text(input.source_ref??input.sourceRef,240),
  audit:{
   created_by:text(input.created_by??input.createdBy??ownerId,180),
   request_id:requestId,
   updated_by:text(input.updated_by??input.updatedBy??input.created_by??input.createdBy??ownerId,180),
   transition_reason:text(input.transition_reason??input.transitionReason,500)||null
  }
 },validateCommitment,'Commitment v1')
}

export function transitionCommitment(current={},input={}){
 const nextStatus=text(input.status||current.status).toUpperCase()
 if(!executionStatuses.includes(nextStatus))throw Object.assign(new Error('Estado de compromisso inválido.'),{code:'commitment_status_invalid',statusCode:400})
 if(['DONE','CANCELLED'].includes(current.status)&&nextStatus!==current.status)throw Object.assign(new Error('Compromisso encerrado não pode ser reaberto silenciosamente.'),{code:'commitment_terminal',statusCode:409})
 const evidence=references([...(current.evidence_refs||[]),...(input.evidence_refs??input.evidenceRefs??[])])
 if(nextStatus==='DONE'&&!evidence.length)throw Object.assign(new Error('A conclusão exige ao menos uma evidência.'),{code:'commitment_completion_evidence_required',statusCode:422})
 return buildCommitment({...current,...input,status:nextStatus,evidence_refs:evidence,completed_at:nextStatus==='DONE'?(input.completed_at||input.completedAt||new Date(input.now||Date.now()).toISOString()):current.completed_at,cancelled_at:nextStatus==='CANCELLED'?(input.cancelled_at||input.cancelledAt||new Date(input.now||Date.now()).toISOString()):current.cancelled_at,updated_by:input.updated_by??input.updatedBy,request_id:input.request_id??input.requestId??current.audit?.request_id})
}

export function commitmentIsOverdue(commitment,now=Date.now()){
 const due=iso(commitment?.due_at??commitment?.dueAt)
 return Boolean(due&&new Date(due).getTime()<new Date(now).getTime()&&!['DONE','CANCELLED'].includes(text(commitment?.status).toUpperCase()))
}
