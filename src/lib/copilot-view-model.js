const list=value=>Array.isArray(value)?value:[]
const text=value=>String(value??'').replace(/\s+/g,' ').trim()
const timeOf=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?null:parsed.getTime()}
const terminalOpportunity=stage=>/^(?:fechado|ganho|conclu[ií]do|perdido|cancelado|closed|won|lost|closed_won|closed_lost)$/i.test(text(stage))
const confirmedCommitment=status=>['ACCEPTED','IN_PROGRESS','BLOCKED'].includes(text(status).toUpperCase())

const dateLabel=value=>{
 const parsed=new Date(value||'')
 return Number.isNaN(parsed.getTime())?'data a confirmar':parsed.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','')
}

function evidenceVisitDate(visit){
 const explicit=timeOf(visit?.completedAt??visit?.completed_at??visit?.occurredAt??visit?.occurred_at)
 if(explicit!==null)return explicit
 const lifecycle=text(visit?.lifecycleStatus??visit?.lifecycle_status).toUpperCase()
 const legacy=text(visit?.status).toLocaleLowerCase('pt-BR')
 const evidenced=['IN_PROGRESS','COMPLETED_PENDING_REVIEW','COMPLETED'].includes(lifecycle)||/em andamento|iniciad|realizad|conclu[ií]d|revis[aã]o/.test(legacy)
 return evidenced?timeOf(visit?.scheduledAt??visit?.scheduled_at??visit?.date):null
}

export function selectLatestEvidenceVisit(visits=[],clientId,now=Date.now()){
 return list(visits)
  .filter(visit=>String(visit?.clientId??visit?.client_id)===String(clientId))
  .map(visit=>({visit,time:evidenceVisitDate(visit)}))
  .filter(item=>item.time!==null&&item.time<=now)
  .sort((a,b)=>b.time-a.time)[0]?.visit||null
}

export function resolveCommitmentResource(resource={}){
 const status=text(resource.status).toLowerCase()||'loading'
 if(status==='loading')return {state:'loading',commitment:null}
 if(status==='error')return {state:'error',commitment:null,error:text(resource.error)}
 const active=list(resource.items).filter(item=>confirmedCommitment(item?.status))
 active.sort((a,b)=>{
  const aTime=timeOf(a?.due_at??a?.dueAt)
  const bTime=timeOf(b?.due_at??b?.dueAt)
  return (aTime??Number.POSITIVE_INFINITY)-(bTime??Number.POSITIVE_INFINITY)
 })
 return active[0]?{state:'ready',commitment:active[0]}:{state:'empty',commitment:null}
}

export function canonicalVoiceChange(payload={}){
 const voice=payload?.voice_interaction||{}
 const confirmed=text(voice.state||voice.status||voice.confirmation_status).toUpperCase()==='CONFIRMED'||text(voice.confirmation_status).toUpperCase()==='CONFIRMED'
 if(!confirmed)return null
 const persistedSummary=text(payload?.result?.interaction?.summary)
 const reviewed=list(voice.reviewed_candidates).filter(item=>text(item?.review_status).toUpperCase()==='CONFIRMED').map(item=>text(item?.statement)).filter(Boolean)
 const summary=(persistedSummary||reviewed.slice(0,2).join(' • ')).slice(0,500)
 if(!summary)return null
 return {
  interactionId:text(voice.voice_interaction_id||voice.id),
  confirmedAt:text(voice.confirmed_at||voice.updated_at),
 summary
 }
}

export function buildHomeCopilotAnswer(payload={}){
 const advice=payload?.advice&&typeof payload.advice==='object'?payload.advice:{}
 const brief=advice?.executive_brief&&typeof advice.executive_brief==='object'?advice.executive_brief:{}
 const headline=text(brief.headline||advice.answer).slice(0,180)
 const reason=text(brief.reason||advice.objective).slice(0,300)
 const action=text(brief.action||advice.next_best_action).slice(0,320)
 const question=text(brief.question||advice?.next_question?.question).slice(0,320)
 if(!headline&&!action&&!question)return null
 return {
  recommendationId:text(payload?.recommendationId||payload?.recommendation_id),
  headline:headline||'Próxima orientação da VAL',
  reason,
  action,
  question
 }
}

export function buildLocalHomePriorities({upcomingVisits=[],opportunities=[],clients=[]}={}){
 const clientNames=new Map(list(clients).map(client=>[String(client?.id),text(client?.name)||'produtor']))
 const visitCards=list(upcomingVisits).map(visit=>({
  insight_id:`visit-${visit.id}`,
  subject_id:visit.clientId??visit.client_id,
  category:'PREPARE',
  title:`Preparar visita com ${clientNames.get(String(visit.clientId??visit.client_id))||'produtor'}`,
  summary:text(visit.objective)||'Visita futura registrada.',
  why_now:`Visita agendada para ${dateLabel(visit.scheduledAt??visit.scheduled_at??visit.date)}.`,
  recommended_action:'Revisar a preparação e definir o compromisso-alvo.',
  sort_at:timeOf(visit.scheduledAt??visit.scheduled_at??visit.date)??Number.POSITIVE_INFINITY
 }))
 const opportunityCards=list(opportunities).flatMap((item,index)=>{
  const nextAction=text(item?.nextAction??item?.next_action)
  const subjectId=item?.clientId??item?.client_id
  if(!nextAction||!subjectId||terminalOpportunity(item?.stage))return []
  const due=item?.nextActionAt??item?.next_action_at
  const dueTime=timeOf(due)
  const hypothesis=text(item?.hypothesis)
  return [{
   insight_id:`opportunity-${item.id||item.candidateKey||index}`,
   subject_id:subjectId,
   category:'FOLLOW_UP',
   title:text(item.title)||'Oportunidade registrada',
   summary:hypothesis?`Hipótese registrada: ${hypothesis}`:'Oportunidade registrada na carteira.',
   why_now:dueTime===null?'Há um próximo passo registrado.':`Próximo passo registrado para ${dateLabel(due)}.`,
   recommended_action:nextAction,
   sort_at:dueTime??Number.POSITIVE_INFINITY
  }]
 })
 return [...visitCards,...opportunityCards]
  .sort((a,b)=>a.sort_at-b.sort_at||a.title.localeCompare(b.title,'pt-BR'))
  .slice(0,3)
  .map(({sort_at:ignored,...item})=>item)
}
