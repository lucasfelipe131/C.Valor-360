import {assertVisitLoopContract,validateVisitLifecycle,visitLifecycleStatuses,visitLifecycleVersion} from './contracts.js'

const transitions=Object.freeze({
 PLANNED:new Set(['PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','CANCELLED']),
 PREPARED:new Set(['PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','CANCELLED']),
 IN_PROGRESS:new Set(['COMPLETED_PENDING_REVIEW','CANCELLED']),
 COMPLETED_PENDING_REVIEW:new Set(['COMPLETED','CANCELLED']),
 COMPLETED:new Set(),
 CANCELLED:new Set()
})

const text=value=>String(value??'').trim()
const iso=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.toISOString()}

export function legacyVisitLifecycle(visit={}){
 const explicit=text(visit.lifecycleStatus??visit.lifecycle_status).toUpperCase()
 if(visitLifecycleStatuses.includes(explicit))return explicit
 const legacy=text(visit.status).toLowerCase()
 if(/cancelad/.test(legacy))return 'CANCELLED'
 if(/realizad|conclu[ií]d/.test(legacy))return 'COMPLETED'
 return 'PLANNED'
}

export function canTransitionVisit(fromStatus,toStatus){
 const from=text(fromStatus).toUpperCase()
 const to=text(toStatus).toUpperCase()
 return visitLifecycleStatuses.includes(from)&&visitLifecycleStatuses.includes(to)&&(from===to||transitions[from]?.has(to)===true)
}

export function transitionVisitLifecycle(visit={},toStatus,input={}){
 const fromStatus=legacyVisitLifecycle(visit)
 const next=text(toStatus).toUpperCase()
 if(!canTransitionVisit(fromStatus,next))throw Object.assign(new Error(`Transição de visita inválida: ${fromStatus} → ${next}.`),{code:'visit_lifecycle_transition_denied',statusCode:409,fromStatus,toStatus:next})
 const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
 const updatedAt=now.toISOString()
 const revision=Math.max(0,Number(visit.lifecycleRevision??visit.lifecycle_revision)||0)+(fromStatus===next?1:1)
 const lifecycle=assertVisitLoopContract({
  contract_version:visitLifecycleVersion,
  version:visitLifecycleVersion,
  visit_id:text(visit.id),
  organization_id:text(input.organizationId??visit.tenantId??visit.tenant_id),
  status:next,
  revision,
  occurred_at:next==='IN_PROGRESS'||next.startsWith('COMPLETED')?(iso(visit.occurredAt??visit.occurred_at)||updatedAt):null,
  completed_at:next==='COMPLETED'?updatedAt:null,
  cancelled_at:next==='CANCELLED'?updatedAt:null,
  updated_at:updatedAt,
  updated_by:text(input.actorId),
  transition:{from_status:fromStatus,to_status:next,reason_code:text(input.reasonCode)||'UNSPECIFIED',request_id:text(input.requestId)||null}
 },validateVisitLifecycle,'VisitLifecycle v1')
 return lifecycle
}

export const visitLifecycleTransitions=transitions
