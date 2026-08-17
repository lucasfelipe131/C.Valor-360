import {buildDecisionIntelligence} from './decision-intelligence.js'
import {rankOpportunityPortfolio} from './sales-playbook.js'
import {buildConversionFoundation} from './conversion-engine.js'

const DAY=86_400_000
const array=value=>Array.isArray(value)?value:[]
const text=(value,max=320)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const timestamp=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.getTime()}
const closed=value=>/^(?:fechado|ganho|conclu[ií]do|perdido|cancelado|closed|won|lost)$/i.test(text(value))
const dateLabel=value=>timestamp(value)===null?'sem data registrada':new Date(value).toLocaleDateString('pt-BR',{timeZone:'UTC'})
const unique=items=>[...new Set(items.map(item=>text(item,160)).filter(Boolean))]

function urgency(value,now){
 const time=timestamp(value)
 if(time===null)return {active:false,overdue:false,days:null,label:'Sem prazo registrado'}
 const days=(time-now)/DAY
 if(days<0)return {active:true,overdue:true,days,label:`Prazo vencido em ${dateLabel(value)}`}
 if(days<=7)return {active:true,overdue:false,days,label:`Ação registrada para ${dateLabel(value)}`}
 if(days<=14)return {active:true,overdue:false,days,label:`Janela registrada até ${dateLabel(value)}`}
 return {active:false,overdue:false,days,label:`Próximo prazo em ${dateLabel(value)}`}
}

function nextVisit(context,now){
 return array(context.visits).map(item=>({item,time:timestamp(item.scheduled_at||item.scheduledAt)})).filter(entry=>entry.time!==null&&entry.time>=now&&!/realizada|cancelada/i.test(text(entry.item.status))).sort((a,b)=>a.time-b.time)[0]||null
}

function evidenceIds(signal,opportunity,foundation){
 return unique([
  ...array(signal?.evidence_ids),
  ...array(opportunity?.evidence).map(item=>typeof item==='string'?item:item?.id||item?.source_id),
  ...array(foundation?.evidence).map(item=>item?.id)
 ]).slice(0,8)
}

export function buildPortfolioRadar(contexts=[],{now=Date.now(),maxItems=5}={}){
 const items=array(contexts).map(context=>{
  const client=context.client||{}
  const opportunities=array(context.opportunities).filter(item=>item&&!closed(item.stage))
  const opportunity=rankOpportunityPortfolio(opportunities,now)[0]||null
  const nexo=buildDecisionIntelligence(context,now)
  const signal=array(nexo.signals)[0]||null
  const foundation=buildConversionFoundation(context,{now:new Date(now)})
  const conversion=foundation.selectedOpportunity||{}
  const due=urgency(opportunity?.next_action_at||opportunity?.nextActionAt||conversion.nextActionAt,now)
  const visit=nextVisit(context,now)
  const visitNear=Boolean(visit&&(visit.time-now)/DAY<=14)
  const ids=evidenceIds(signal,opportunity,foundation)
  const actualTrigger=due.active||(signal&&Number(signal.score)>=55&&array(signal.evidence_ids).length)||visitNear||text(opportunity?.next_action||opportunity?.nextAction)
  if(!actualTrigger||!ids.length)return null
  const reason=due.overdue
   ?`${due.label}. Confirme se a decisão continua ativa, reprograme ou encerre com o motivo registrado.`
   :due.active
    ?`${due.label}. ${text(opportunity?.next_action||opportunity?.nextAction||signal?.action||'Existe uma ação registrada que precisa de confirmação.')}`
    :signal&&Number(signal.score)>=55
     ?`${text(signal.title,'Sinal confirmado')}: ${text(signal.insight||signal.decision)}`
     :visitNear
      ?`Visita agendada para ${dateLabel(visit.item.scheduled_at||visit.item.scheduledAt)}. ${text(visit.item.objective||'Prepare a conversa com base no dossiê atual.')}`
      :`A oportunidade “${text(opportunity?.title,'sem título')}” precisa de uma próxima decisão verificável.`
  const score=Math.max(0,Math.min(100,Math.round((Number(conversion.score)||0)*.62+(Number(signal?.score)||0)*.38+(due.overdue?10:due.active?7:visitNear?4:0))))
  return {
   id:`radar:${text(client.id||client.name,120)}`,
   clientId:String(client.id||''),clientName:text(client.name||client.id||'Produtor',160),
   municipality:text(client.municipality||client.city||'',120),property:text(client.commercial?.property||client.property||'',160),
   score,priority:due.overdue||due.days!==null&&due.days<=1||score>=82?'agora':due.active||visitNear||score>=68?'esta_semana':'acompanhar',
   headline:text(signal?.title||opportunity?.title||conversion.title||'Próxima decisão',180),reason,
   nextAction:text(opportunity?.next_action||opportunity?.nextAction||signal?.action||conversion.nextAction||'Confirmar decisão, responsável, prazo e evidência.',420),
   question:text(signal?.question||'Qual é o próximo passo útil, quem assume e até quando?',320),
   deadline:due.label,stage:text(opportunity?.stage||conversion.stage||'Qualificação',80),
   opportunityId:String(opportunity?.id||conversion.id||''),opportunityTitle:text(opportunity?.title||conversion.title||'',180),
   amount:Number.isFinite(Number(opportunity?.estimated_value??opportunity?.value??conversion.amount))?Number(opportunity?.estimated_value??opportunity?.value??conversion.amount):null,
   evidenceIds:ids,evidenceCount:ids.length,dataQuality:Number(foundation.dataQuality?.score)||0,generatedAt:new Date(now).toISOString()
  }
 }).filter(Boolean).sort((a,b)=>b.score-a.score||b.evidenceCount-a.evidenceCount||a.clientName.localeCompare(b.clientName,'pt-BR')).slice(0,Math.max(1,Math.min(5,Number(maxItems)||5)))
 return {version:'val-portfolio-radar-v1',generatedAt:new Date(now).toISOString(),items,maxItems:Math.max(1,Math.min(5,Number(maxItems)||5)),policy:{automaticContact:false,automaticCrmWrite:false,usesRecordedSignalsOnly:true},emptyReason:items.length?'':'Nenhuma conta reuniu sinal, prazo, visita ou ação registrada suficiente para entrar no radar de hoje.'}
}
