import {createHash} from 'node:crypto'
import {assertExecutionContract,insightCardVersion,insightPriorityPolicyVersion,validateInsightCard} from './contracts.js'
import {commitmentIsOverdue} from './commitment.js'

const DAY=86_400_000
const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1400)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0))
const iso=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.toISOString()}
const timestamp=value=>{const parsed=iso(value);return parsed?new Date(parsed).getTime():null}
const reference=value=>typeof value==='string'?{id:text(value,240)}:value&&typeof value==='object'&&text(value.id)?{id:text(value.id,240),...(text(value.type)?{type:text(value.type,80)}:{})}:null
const refs=values=>[...new Map(list(values).map(reference).filter(Boolean).map(item=>[`${item.type||''}:${item.id}`,item])).values()]
const uuidFrom=value=>{const hash=createHash('sha256').update(JSON.stringify(value)).digest('hex');return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}
const terminal=status=>['DONE','CANCELLED'].includes(text(status).toUpperCase())

export const insightPriorityPolicy=Object.freeze({
 version:insightPriorityPolicyVersion,
 experimental:true,
 weights:Object.freeze({urgency:.24,impact:.22,confidence:.17,commitment_due:.16,risk:.13,relationship_signal:.08}),
 note:'Índice operacional experimental; não é KPI, probabilidade de venda ou ranking de pessoas.'
})

const roleCategories=Object.freeze({
 admin:new Set(['ACT_NOW','PREPARE','FOLLOW_UP','LEARN']),
 manager:new Set(['ACT_NOW','PREPARE','FOLLOW_UP','LEARN']),
 consultant:new Set(['ACT_NOW','PREPARE','FOLLOW_UP']),
 technical_reviewer:new Set(['ACT_NOW','PREPARE'])
})

function categoryAllowed(role,category,allowedRoles){
 const normalized=text(role).toLowerCase()||'consultant'
 if(list(allowedRoles).length&&!list(allowedRoles).map(item=>text(item).toLowerCase()).includes(normalized))return false
 return (roleCategories[normalized]||roleCategories.consultant).has(category)
}

function dueSignal(value,now){
 const time=timestamp(value)
 if(time==null)return 0
 const days=(time-now.getTime())/DAY
 if(days<0)return 1
 if(days<=1)return .9
 if(days<=7)return .7
 if(days<=14)return .45
 return .15
}

function priority(candidate,now){
 const components={
  urgency:Math.max(clamp(candidate.urgency),dueSignal(candidate.due_at??candidate.dueAt,now)),
  impact:clamp(candidate.impact),
  confidence:clamp(candidate.confidence),
  commitment_due:clamp(candidate.commitment_due??candidate.commitmentDue),
  risk:clamp(candidate.risk),
  relationship_signal:clamp(candidate.relationship_signal??candidate.relationshipSignal)
 }
 const score=Object.entries(insightPriorityPolicy.weights).reduce((sum,[key,weight])=>sum+components[key]*weight,0)
 return Math.round(score*100)
}

function expiry(candidate,category,now){
 const explicit=iso(candidate.expires_at??candidate.expiresAt)
 if(explicit)return explicit
 const due=timestamp(candidate.due_at??candidate.dueAt)
 const defaultDays={ACT_NOW:1,PREPARE:7,FOLLOW_UP:7,LEARN:14}[category]||7
 return new Date(Math.max(now.getTime()+60_000,due==null?now.getTime()+defaultDays*DAY:due+DAY)).toISOString()
}

function normalizeCandidate(candidate,input,index){
 const category=text(candidate.category).toUpperCase()
 const organizationId=text(input.organizationId,180)
 const actorId=text(input.actor?.id,180)
 const subjectId=text(candidate.subject_id??candidate.subjectId,180)
 const createdAt=iso(candidate.created_at??candidate.createdAt)||input.now.toISOString()
 const confidence=clamp(candidate.confidence)
 const evidence=refs(candidate.evidence_refs??candidate.evidenceRefs)
 const title=text(candidate.title||'Atenção necessária',180)
 const summary=text(candidate.summary||candidate.what||title,700)
 const whyNow=text(candidate.why_now??candidate.whyNow,700)
 const action=text(candidate.recommended_action??candidate.recommendedAction,700)
 return assertExecutionContract({
  contract_version:insightCardVersion,
  version:insightCardVersion,
  insight_id:text(candidate.insight_id??candidate.insightId,180)||uuidFrom({organizationId,actorId,subjectId,category,title,whyNow,action,createdAt:index}),
  organization_id:organizationId,
  actor_id:actorId,
  subject_id:subjectId,
  category,
  priority:priority(candidate,input.now),
  title,
  summary,
  why_now:whyNow,
  recommended_action:action,
  confidence:Number(confidence.toFixed(2)),
  epistemic_status:confidence<.5?'HYPOTHESIS':'SUPPORTED',
  evidence_refs:evidence,
  expires_at:expiry(candidate,category,input.now),
  created_at:createdAt,
  priority_policy_version:insightPriorityPolicyVersion
 },validateInsightCard,'InsightCard v1')
}

function clientId(context){return text(context?.client?.id||context?.contextSnapshot?.subject?.id,180)}
function clientName(context){return text(context?.client?.name||'Produtor',180)}

function commitmentCandidates(context,now){
 const subjectId=clientId(context)
 const name=clientName(context)
 const candidates=[]
 for(const commitment of list(context.commitments)){
  if(terminal(commitment.status))continue
  const id=text(commitment.commitment_id??commitment.id,180)
  const due=commitment.due_at??commitment.dueAt
  const evidence=[{id:`commitment:${id}`,type:'commitment'},...refs(commitment.evidence_refs)]
  if(commitmentIsOverdue(commitment,now))candidates.push({
   subject_id:subjectId,category:'ACT_NOW',title:`Compromisso vencido com ${name}`,
   summary:text(commitment.description),why_now:`O prazo registrado venceu em ${new Date(due).toLocaleDateString('pt-BR',{timeZone:'UTC'})}.`,
   recommended_action:'Confirmar o status, registrar evidência, replanejar com motivo ou encerrar explicitamente.',
   due_at:due,urgency:1,impact:.85,confidence:.95,commitment_due:1,risk:.8,relationship_signal:.8,evidence_refs:evidence,
   expires_at:new Date(now.getTime()+DAY).toISOString()
  })
  else candidates.push({
   subject_id:subjectId,category:'FOLLOW_UP',title:`Acompanhar compromisso com ${name}`,
   summary:text(commitment.description),why_now:`Há um compromisso ativo com prazo em ${new Date(due).toLocaleDateString('pt-BR',{timeZone:'UTC'})}.`,
   recommended_action:'Acompanhar o responsável no prazo combinado e registrar o resultado observável.',
   due_at:due,urgency:dueSignal(due,now),impact:.65,confidence:.9,commitment_due:.8,risk:.45,relationship_signal:.7,evidence_refs:evidence,
   expires_at:new Date(timestamp(due)+DAY).toISOString()
  })
 }
 return candidates
}

function visitCandidates(context,now){
 const subjectId=clientId(context)
 const name=clientName(context)
 return list(context.visits).flatMap(visit=>{
  const scheduled=timestamp(visit.scheduled_at??visit.scheduledAt)
  if(scheduled==null||scheduled<now.getTime()||/realizada|cancelada/i.test(text(visit.status)))return []
  const days=(scheduled-now.getTime())/DAY
  if(days>14)return []
  const id=text(visit.id,180)
  return [{
   subject_id:subjectId,category:'PREPARE',title:`Preparar visita com ${name}`,
   summary:text(visit.objective||'Visita futura registrada.'),
   why_now:`A visita está agendada para ${new Date(scheduled).toLocaleDateString('pt-BR',{timeZone:'UTC'})}.`,
   recommended_action:'Revisar contexto, lacunas, perguntas e compromisso-alvo antes da visita.',
   due_at:new Date(scheduled).toISOString(),urgency:days<=1?.9:.6,impact:.75,confidence:.9,risk:.35,relationship_signal:.6,
   evidence_refs:[{id:`visit:${id}`,type:'visit'}],expires_at:new Date(scheduled+DAY).toISOString()
  }]
 })
}

function learningCandidates(context,now){
 const learning=context.learning||{}
 const outcomes=Number(learning.wins||0)+Number(learning.losses||0)
 if(outcomes<=0)return []
 return [{
  subject_id:clientId(context),category:'LEARN',title:`Revisar aprendizado de ${clientName(context)}`,
  summary:`Há ${outcomes} resultado(s) comercial(is) registrado(s) que podem orientar a próxima decisão.`,
  why_now:'Resultados observados estão disponíveis para revisão, sem promoção automática a regra.',
  recommended_action:'Comparar decisão, execução e resultado; manter qualquer padrão como candidato até validação.',
  urgency:.2,impact:.55,confidence:.6,risk:.2,relationship_signal:.3,
  evidence_refs:[{id:`learning:${clientId(context)}`,type:'outcome_summary'}],expires_at:new Date(now.getTime()+14*DAY).toISOString(),
  allowed_roles:['manager','admin']
 }]
}

function radarCandidates(radar,contexts){
 const map=new Map(list(contexts).map(context=>[clientId(context),context]))
 return list(radar?.items).map(item=>({
  subject_id:text(item.clientId,180),category:item.priority==='agora'?'ACT_NOW':'FOLLOW_UP',title:text(item.headline||`Próxima decisão de ${item.clientName}`),
  summary:text(item.reason),why_now:text(item.deadline||item.reason),recommended_action:text(item.nextAction),
  urgency:item.priority==='agora'?1:item.priority==='esta_semana'?.7:.35,impact:clamp(Number(item.score)/100),confidence:clamp(Number(item.dataQuality)/100),risk:item.priority==='agora'?.7:.35,relationship_signal:.45,
  due_at:null,evidence_refs:list(item.evidenceIds).map(id=>({id:text(id,240),type:'recorded_signal'})),
  allowed_roles:['consultant','manager','admin'],context:map.get(text(item.clientId,180))
 }))
}

export function buildInsightFeed(input={}){
 const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
 const organizationId=text(input.organizationId,180)
 const actor={id:text(input.actor?.id,180),role:text(input.actor?.role).toLowerCase()||'consultant'}
 const contexts=list(input.contexts)
 for(const context of contexts){
  const snapshot=context?.contextSnapshot
  if(snapshot&&text(snapshot.organization_id,180)!==organizationId)throw Object.assign(new Error('Contexto de outro tenant não pode gerar InsightCard.'),{code:'cross_tenant_insight_denied'})
 }
 const raw=[...list(input.candidates),...contexts.flatMap(context=>commitmentCandidates(context,now)),...contexts.flatMap(context=>visitCandidates(context,now)),...contexts.flatMap(context=>learningCandidates(context,now)),...radarCandidates(input.radar,contexts)]
 const normalized=[]
 for(const [index,candidate] of raw.entries()){
  const category=text(candidate.category).toUpperCase()
  if(!categoryAllowed(actor.role,category,candidate.allowed_roles??candidate.allowedRoles))continue
  const expires=timestamp(candidate.expires_at??candidate.expiresAt)
  if(expires!==null&&expires<=now.getTime())continue
  const card=normalizeCandidate(candidate,{organizationId,actor,now},index)
  if(timestamp(card.expires_at)<=now.getTime())continue
  normalized.push(card)
 }
 const deduped=[]
 const seen=new Set()
 for(const card of normalized.sort((a,b)=>b.priority-a.priority||b.confidence-a.confidence||a.title.localeCompare(b.title,'pt-BR'))){
  const key=`${card.subject_id}:${card.category}:${card.title.toLowerCase()}`
  if(seen.has(key))continue
  seen.add(key);deduped.push(card)
 }
 const maxItems=Math.max(1,Math.min(5,Number(input.maxItems)||5))
 return {
  contract_version:'val.insight_feed.v1',version:'val.insight_feed.v1',generated_at:now.toISOString(),
  actor_role:actor.role,items:deduped.slice(0,maxItems),considered:raw.length,max_items:maxItems,
  priority_policy:insightPriorityPolicy,
  policy:{tenant_filtered:true,actor_filtered:true,role_filtered:true,automatic_contact:false,automatic_crm_write:false},
  empty_reason:deduped.length?'':'Nenhum sinal autorizado e acionável merece prioridade agora.'
 }
}
