import {createHash} from 'node:crypto'
import {actionPlanVersion,assertExecutionContract,executionStatuses,validateActionPlan} from './contracts.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0))
const iso=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.toISOString()}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const uuidFrom=value=>{const hash=digest(value);return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}
const reference=(value,type='source')=>typeof value==='string'?{id:text(value,240),type}:value&&typeof value==='object'&&text(value.id)?{id:text(value.id,240),type:text(value.type||type,80)}:null
const uniqueRefs=values=>[...new Map(values.map(value=>reference(value)).filter(Boolean).map(item=>[`${item.type}:${item.id}`,item])).values()]

export function artifactReference(prefix,artifact){
 return `${prefix}:${digest(artifact||{}).slice(0,24)}`
}

function ensureTenant(input){
 const organizationId=text(input.organizationId||input.contextSnapshot?.organization_id,180)
 for(const [artifact,code] of [[input.contextSnapshot,'cross_tenant_action_plan_denied'],[input.decisionThesis,'cross_tenant_decision_thesis_denied'],[input.valuePlan,'cross_tenant_value_plan_denied']]){
  if(artifact&&text(artifact.organization_id,180)!==organizationId)throw Object.assign(new Error('Artefato de execução pertence a outro tenant.'),{code})
 }
 return organizationId
}

function recordedUrgency(candidate,now){
 const due=iso(candidate.due_at??candidate.dueAt)
 if(!due)return 0
 const days=(new Date(due).getTime()-now.getTime())/86_400_000
 if(days<0)return 1
 if(days<=1)return .9
 if(days<=7)return .7
 if(days<=14)return .45
 return .15
}

function score(candidate,{now}){
 const confidence=clamp(candidate.confidence)
 const components={
  impact:clamp(candidate.impact),
  urgency:recordedUrgency(candidate,now),
  confidence,
  dependency:clamp(candidate.dependency),
  risk:clamp(candidate.risk),
  commercial_moment:clamp(candidate.commercial_moment??candidate.commercialMoment),
  existing_commitment:clamp(candidate.existing_commitment??candidate.existingCommitment)
 }
 return Object.values(components).reduce((sum,value)=>sum+value,0)
}

function normalizedCandidate(candidate,index,{actor,defaultDueAt,now}){
 const title=text(candidate?.title||candidate?.description||`Ação ${index+1}`,180)
 const description=text(candidate?.description||candidate?.action||title,1600)
 const owner=candidate?.owner&&text(candidate.owner.id)?{type:text(candidate.owner.type||'USER',20).toUpperCase(),id:text(candidate.owner.id,180)}:actor?.id?{type:text(actor.type||'USER',20).toUpperCase(),id:text(actor.id,180)}:null
 const dueAt=iso(candidate?.due_at??candidate?.dueAt??defaultDueAt)
 const successCriteria=text(candidate?.success_criteria??candidate?.successCriteria,1000)
 const createdAt=iso(candidate?.created_at??candidate?.createdAt)||now.toISOString()
 return {
  raw:candidate,
  action_id:text(candidate?.action_id||candidate?.actionId,180)||uuidFrom({title,description,owner,dueAt,successCriteria}),
  title,
  description,
  reason:text(candidate?.reason||'A ação foi priorizada pela tese, evidência e momento registrados.',900),
  owner,
  due_at:dueAt,
  status:executionStatuses.includes(String(candidate?.status||'').toUpperCase())?String(candidate.status).toUpperCase():'PROPOSED',
  success_criteria:successCriteria,
  evidence_required:list(candidate?.evidence_required??candidate?.evidenceRequired).map(item=>text(item,300)).filter(Boolean),
  confidence:Number(clamp(candidate?.confidence).toFixed(2)),
  source_refs:uniqueRefs(list(candidate?.source_refs??candidate?.sourceRefs)),
  created_at:createdAt,
  updated_at:iso(candidate?.updated_at??candidate?.updatedAt)||createdAt
 }
}

function derivedCandidates(input){
 const thesis=input.decisionThesis||{}
 const valuePlan=input.valuePlan||{}
 const snapshot=input.contextSnapshot||{}
 const refs=[{id:text(snapshot.context_snapshot_id,240),type:'context_snapshot'},...list(thesis.evidence_refs)]
 const candidates=[]
 const push=candidate=>{if(candidate.description&&!candidates.some(item=>text(item.description).toLowerCase()===text(candidate.description).toLowerCase()))candidates.push(candidate)}
 const criticalMissing=list(snapshot.missing_information).find(item=>item?.critical)||(thesis.decision==='DISCOVER_BEFORE_RECOMMENDING'?list(thesis.missing_information)[0]:null)
 if(criticalMissing)push({
  title:'Confirmar informação crítica',
  description:text(criticalMissing.question||criticalMissing.description||criticalMissing),
  reason:'Sem esse dado a recomendação pode não ser segura ou materialmente correta.',
  success_criteria:'Informação confirmada com origem e data registradas.',
  evidence_required:['Fonte e data da confirmação'],confidence:thesis.confidence,impact:1,risk:1,dependency:1,source_refs:refs
 })
 if(text(valuePlan.commitment_target))push({
  title:'Combinar o próximo compromisso',description:text(valuePlan.commitment_target),
  reason:'A conversa precisa terminar com um próximo passo proporcional à evidência disponível.',
  success_criteria:'Responsável, prazo e critério de conclusão aceitos e registrados.',
  evidence_required:['Aceite explícito e próximo passo registrado'],confidence:thesis.confidence,impact:.9,commercial_moment:.9,source_refs:refs
 })
 if(text(thesis.next_action))push({
  title:'Executar a próxima ação da tese',description:text(thesis.next_action),
  reason:text(list(thesis.rationale)[0]||'É a menor ação capaz de avançar ou esclarecer a decisão.'),
  success_criteria:'Resultado da ação registrado com a evidência exigida.',
  evidence_required:['Resultado observável da ação'],confidence:thesis.confidence,impact:.8,dependency:.6,source_refs:refs
 })
 if(text(valuePlan.follow_up))push({
  title:'Programar acompanhamento',description:text(valuePlan.follow_up),
  reason:'O follow-up mantém o compromisso verificável sem criar contato automático.',
  success_criteria:'Acompanhamento realizado ou replanejado com motivo registrado.',
  evidence_required:['Status do acompanhamento'],confidence:thesis.confidence,impact:.6,source_refs:refs
 })
 return candidates
}

export function isCommitmentReady(priority){
 const missing=[]
 if(!priority?.owner?.id)missing.push('owner')
 if(!iso(priority?.due_at))missing.push('due_at')
 if(!text(priority?.success_criteria))missing.push('success_criteria')
 return {ready:missing.length===0,missing_fields:missing}
}

export function buildActionPlan(input={}){
 const organizationId=ensureTenant(input)
 const snapshot=input.contextSnapshot||{}
 const thesis=input.decisionThesis||{}
 const valuePlan=input.valuePlan||{}
 const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
 const candidates=list(input.candidateActions).length?list(input.candidateActions):derivedCandidates(input)
 const unique=[]
 const seen=new Set()
 for(const [index,candidate] of candidates.entries()){
  const normalized=normalizedCandidate(candidate,index,{actor:input.actor,defaultDueAt:input.defaultDueAt,now})
  const key=`${normalized.title.toLowerCase()}:${normalized.description.toLowerCase()}`
  if(seen.has(key))continue
  seen.add(key)
  unique.push({...normalized,_score:score(candidate,{now}),_index:index})
 }
 const priorities=unique.sort((a,b)=>b._score-a._score||a._index-b._index).slice(0,3).map(({_score,_index,raw,...priority})=>priority)
 const decisionThesisId=text(input.decisionThesisId,180)||artifactReference('decision-thesis',thesis)
 const valuePlanId=text(input.valuePlanId,180)||artifactReference('value-plan',valuePlan)
 const contextSnapshotId=text(snapshot.context_snapshot_id,180)
 const createdAt=now.toISOString()
 return assertExecutionContract({
  contract_version:actionPlanVersion,
  version:actionPlanVersion,
  action_plan_id:text(input.actionPlanId,180)||uuidFrom({organizationId,subjectId:input.subjectId||snapshot.subject?.id,contextSnapshotId,decisionThesisId,valuePlanId,priorities}),
  organization_id:organizationId,
  subject_id:text(input.subjectId||snapshot.subject?.id,180),
  decision_thesis_id:decisionThesisId,
  value_plan_id:valuePlanId,
  context_snapshot_id:contextSnapshotId,
  priorities,
  created_at:createdAt,
  updated_at:createdAt
 },validateActionPlan,'ActionPlan v1')
}
