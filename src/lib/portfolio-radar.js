import {commercialMetrics} from './commercial-metrics.js'

export const VAL_PORTFOLIO_RADAR_VERSION='val-portfolio-radar-v1'
export const VAL_PORTFOLIO_RADAR_LIMIT=5

const DAY_MS=86_400_000
const CLOSED_STAGE=/^(?:fechado|ganho|conclu[ií]do|closed|won)$/i
const LOST_STAGE=/^(?:perdido|descartado|cancelado|lost)$/i
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const clean=(value,max=360)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const number=value=>Number.isFinite(Number(value))?Number(value):null
const timestamp=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.getTime()}
const iso=value=>timestamp(value)===null?null:new Date(value).toISOString()
const ageInDays=(value,now)=>timestamp(value)===null?null:Math.max(0,(now.getTime()-timestamp(value))/DAY_MS)
const daysUntil=(value,now)=>timestamp(value)===null?null:(timestamp(value)-now.getTime())/DAY_MS
const brl=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const dateLabel=value=>iso(value)?new Date(value).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',timeZone:'UTC'}).replace('.',''):'sem data registrada'
const unique=items=>[...new Set(items.filter(Boolean))]
const sourceId=(prefix,value,fallback)=>`${prefix}:${clean(value||fallback,180).replace(/[^\p{L}\p{N}_.:-]+/gu,'-')||'unknown'}`

const opportunityStageScore=stage=>{
 const normalized=normalize(stage)
 if(/negociacao|decisao|aprovacao|fechamento/.test(normalized))return 28
 if(/proposta|solucao|orcamento/.test(normalized))return 22
 if(/diagnostico|qualificacao|descoberta|necessidade/.test(normalized))return 15
 if(/prospeccao|mapeamento|novo|lead/.test(normalized))return 9
 return 12
}

const urgencyFor=(deadline,now)=>{
 const days=daysUntil(deadline,now)
 if(days===null)return {score:0,label:'',overdue:false,window:'unknown'}
 if(days<0)return {score:30,label:`próxima ação vencida em ${dateLabel(deadline)}`,overdue:true,window:'overdue'}
 if(days<=3)return {score:28,label:`decisão registrada para até 3 dias (${dateLabel(deadline)})`,overdue:false,window:'three_days'}
 if(days<=7)return {score:24,label:`decisão registrada para esta semana (${dateLabel(deadline)})`,overdue:false,window:'week'}
 if(days<=14)return {score:18,label:`decisão registrada para até 14 dias (${dateLabel(deadline)})`,overdue:false,window:'fortnight'}
 if(days<=30)return {score:10,label:`decisão registrada para este mês (${dateLabel(deadline)})`,overdue:false,window:'month'}
 return {score:3,label:`próxima ação registrada para ${dateLabel(deadline)}`,overdue:false,window:'future'}
}

const freshnessScore=(value,now)=>{
 const age=ageInDays(value,now)
 if(age===null)return 0
 if(age<=7)return 10
 if(age<=30)return 7
 if(age<=90)return 3
 return 0
}

const evidenceItem=(id,claim,sourceType,sourceIdValue,observedAt,quality='moderate',uncertainty='O registro confirma o sinal, mas não garante conversão.')=>({
 id,
 claim:clean(claim,520),
 sourceType,
 sourceId:clean(sourceIdValue,180)||'unknown',
 observedAt:iso(observedAt)||'unknown',
 quality,
 uncertainty:clean(uncertainty,320)
})

const opportunityValue=opportunity=>{
 for(const value of [opportunity?.estimated_value,opportunity?.estimatedValue,opportunity?.value,opportunity?.amount]){
  const parsed=number(value)
  if(parsed!==null&&parsed>=0)return parsed
 }
 return null
}

const opportunityUpdatedAt=opportunity=>opportunity?.updated_at||opportunity?.updatedAt||opportunity?.created_at||opportunity?.createdAt||null
const opportunityDeadline=opportunity=>opportunity?.next_action_at||opportunity?.nextActionAt||opportunity?.deadline||null
const opportunityNextAction=opportunity=>clean(opportunity?.next_action||opportunity?.nextAction,500)

const openOpportunities=(clientId,opportunities)=>opportunities
 .filter(item=>String(item?.clientId??item?.client_id??'')===String(clientId))
 .filter(item=>!CLOSED_STAGE.test(clean(item?.stage))&&!LOST_STAGE.test(clean(item?.stage)))

const upcomingVisits=(clientId,visits,now)=>visits
 .filter(item=>String(item?.clientId??item?.client_id??'')===String(clientId))
 .filter(item=>!/^(?:realizada|cancelada)$/i.test(clean(item?.status)))
 .map(item=>({...item,_scheduledAt:item?.scheduledAt||item?.scheduled_at||item?.date||null}))
 .filter(item=>timestamp(item._scheduledAt)!==null&&timestamp(item._scheduledAt)>=now.getTime())
 .sort((left,right)=>timestamp(left._scheduledAt)-timestamp(right._scheduledAt))

const declaredNeed=client=>{
 const value=clean(client?.additionalNeed||client?.commercial?.opportunity,420)
 if(!value)return ''
 if(/^(?:n[aã]o|nenhuma|nada|sem necessidade|n[aã]o possui)$/i.test(value))return ''
 return value
}

function buildClientRadarItem(client,visits,opportunities,now){
 const clientId=String(client?.id||'')
 if(!clientId||!clean(client?.name))return null
 const metrics=commercialMetrics(client)
 const candidates=openOpportunities(clientId,opportunities).map(opportunity=>{
  const stage=clean(opportunity?.stage||'Etapa não informada',80)
  const urgency=urgencyFor(opportunityDeadline(opportunity),now)
  const value=opportunityValue(opportunity)
  const updatedAt=opportunityUpdatedAt(opportunity)
  let score=opportunityStageScore(stage)+urgency.score+freshnessScore(updatedAt,now)
  if(value!==null&&value>0)score+=Math.min(15,5+Math.round(Math.log10(value+1)*2))
  if(opportunityNextAction(opportunity))score+=7
  if(Array.isArray(opportunity?.evidence)&&opportunity.evidence.length)score+=5
  if(opportunity?.stageEvidence)score+=5
  return {opportunity,stage,urgency,value,updatedAt,score}
 }).sort((left,right)=>right.score-left.score||((right.value||0)-(left.value||0))||clean(left.opportunity?.title).localeCompare(clean(right.opportunity?.title),'pt-BR'))

 const selected=candidates[0]||null
 const visitsAhead=upcomingVisits(clientId,visits,now)
 const nextVisit=visitsAhead[0]||null
 const need=declaredNeed(client)
 let score=selected?.score||0
 const reasons=[]
 const evidence=[]
 const missing=[]
 let action=''
 let deadline=null
 let signalType=''

 if(selected){
  const title=clean(selected.opportunity?.title||selected.opportunity?.category||'Oportunidade registrada',180)
  const id=sourceId('opportunity',selected.opportunity?.databaseId||selected.opportunity?.id||selected.opportunity?.candidateKey,title)
  reasons.push(`“${title}” está em ${selected.stage}.`)
  evidence.push(evidenceItem(id,`A oportunidade “${title}” está em ${selected.stage}${selected.value===null?' sem valor estimado registrado':` com valor registrado de ${brl(selected.value)}`}.`,'opportunity',String(selected.opportunity?.databaseId||selected.opportunity?.id||selected.opportunity?.candidateKey||'unknown'),selected.updatedAt,'high','Etapa, valor e prazo descrevem o registro atual; não representam probabilidade de compra.'))
  if(selected.urgency.label){
   reasons.push(selected.urgency.label)
   deadline=iso(opportunityDeadline(selected.opportunity))
  }
  action=selected.urgency.overdue
   ?`Retomar “${title}”, confirmar se a decisão continua ativa e registrar um novo compromisso com responsável e data.`
   :opportunityNextAction(selected.opportunity)||`Confirmar com o produtor qual é o próximo passo verificável para “${title}” e registrar responsável e data.`
  signalType=selected.urgency.overdue?'overdue_opportunity':'open_opportunity'
  if(!opportunityNextAction(selected.opportunity))missing.push('próxima ação da oportunidade')
  if(!opportunityDeadline(selected.opportunity))missing.push('prazo da próxima ação')
  if(selected.value===null)missing.push('valor estimado da oportunidade')
 }

 if(nextVisit){
  const objective=clean(nextVisit.objective||nextVisit.summary||'Visita agendada',280)
  const visitDate=nextVisit._scheduledAt
  score+=daysUntil(visitDate,now)<=7?9:5
  reasons.push(`visita agendada para ${dateLabel(visitDate)}${objective?` com objetivo “${objective}”`:''}`)
  evidence.push(evidenceItem(sourceId('visit',nextVisit.id,visitDate),`Há uma visita agendada para ${dateLabel(visitDate)}${objective?` com objetivo “${objective}”`:''}.`,'visit',String(nextVisit.id||'unknown'),visitDate,'high','A agenda confirma o compromisso; não confirma que a oportunidade avançará.'))
  if(!action){action=`Preparar a visita de ${dateLabel(visitDate)} usando somente os registros atuais e definir o compromisso mínimo esperado.`;deadline=iso(visitDate);signalType='scheduled_visit'}
 }

 if(need){
  score+=8
  reasons.push(`necessidade declarada: “${need}”`)
  evidence.push(evidenceItem(sourceId('producer-need',clientId,need),`Necessidade registrada para a conta: “${need}”.`,'producer_questionnaire',clientId,client.profileUpdatedAt||client.updatedAt,'moderate','A necessidade foi registrada, mas ainda precisa ser confirmada no contexto comercial atual.'))
  if(!action){action=`Confirmar se a necessidade “${need}” continua atual, dimensionar impacto e registrar a próxima decisão.`;signalType='declared_need'}
 }

 if(metrics.openPotentialKnown&&metrics.openPotential>0){
  const contribution=Math.min(12,4+Math.round(Math.log10(metrics.openPotential+1)))
  score+=contribution
  reasons.push(`potencial em aberto cadastrado de ${brl(metrics.openPotential)}`)
  evidence.push(evidenceItem(sourceId('client-commercial',clientId,'open-potential'),`O cadastro comercial informa potencial em aberto de ${brl(metrics.openPotential)}.`,'client_record',clientId,client.profileUpdatedAt||client.commercial?.lastBusinessAt,'moderate','Potencial cadastrado não é oportunidade qualificada nem previsão de receita.'))
  if(!action){action='Qualificar qual categoria, janela e critério de decisão explicam o potencial em aberto antes de criar uma proposta.';signalType='open_potential'}
 }

 if(!evidence.length||score<10)return null
 const cappedScore=Math.max(0,Math.min(100,Math.round(score)))
 const priority=cappedScore>=80?'imediata':cappedScore>=58?'esta_semana':'acompanhar'
 const primaryReason=unique(reasons).slice(0,3).join(' ')
 return {
  clientId,
  clientName:clean(client.name,180),
  municipality:clean(client.municipality,140),
  score:cappedScore,
  priority,
  signalType,
  reason:primaryReason,
  action,
  deadline,
  opportunity:selected?{
   id:String(selected.opportunity?.databaseId||selected.opportunity?.id||selected.opportunity?.candidateKey||''),
   title:clean(selected.opportunity?.title||selected.opportunity?.category||'Oportunidade registrada',180),
   stage:selected.stage,
   value:selected.value
  }:null,
  missing:unique(missing).slice(0,4),
  evidence:evidence.slice(0,5)
 }
}

export function buildPortfolioRadar({clients=[],visits=[],opportunities=[]}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const limit=Math.max(1,Math.min(VAL_PORTFOLIO_RADAR_LIMIT,Number(options.limit)||VAL_PORTFOLIO_RADAR_LIMIT))
 const items=clients.map(client=>buildClientRadarItem(client,visits,opportunities,now)).filter(Boolean).sort((left,right)=>right.score-left.score||left.clientName.localeCompare(right.clientName,'pt-BR')).slice(0,limit)
 const endOfDay=new Date(now);endOfDay.setHours(23,59,59,999)
 return {
  version:VAL_PORTFOLIO_RADAR_VERSION,
  generatedAt:now.toISOString(),
  expiresAt:endOfDay.toISOString(),
  dateKey:now.toISOString().slice(0,10),
  status:items.length?'ready':'empty',
  limit,
  evaluatedAccounts:clients.length,
  items,
  policy:{
   decisionSource:'deterministic_portfolio_data',
   generativeAiUsed:false,
   automaticContact:false,
   automaticCrmWrite:false,
   sensitiveRelationshipFieldsUsed:false,
   message:'O radar ordena sinais registrados. O consultor confirma o contexto e decide a ação.'
  }
 }
}
