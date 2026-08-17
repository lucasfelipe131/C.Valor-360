import {createHash} from 'node:crypto'
import {VAL_METHOD_SEQUENCE,normalizeValMethodStage} from './val-methodology.js'

const DAY=86_400_000
const array=value=>Array.isArray(value)?value:[]
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const text=(value,max=420)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const timestamp=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.getTime()}
const iso=value=>timestamp(value)===null?null:new Date(value).toISOString()
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,18)
const unique=items=>[...new Set(items.map(item=>text(item,280)).filter(Boolean))]
const recommendationId=(item,index=0)=>`recommendation:${text(item?.id||index,160)}`
const feedbackOutcome=item=>lower(item?.feedback?.outcome||item?.feedback?.status)
const stageIndex=value=>VAL_METHOD_SEQUENCE.indexOf(normalizeValMethodStage(value))

function methodState(item){return item?.methodology_state||item?.methodologyState||item?.advice?.methodology_state||item?.advice?.methodologyState||{}}
function stageOf(item){const state=methodState(item);return normalizeValMethodStage(state.current_stage||state.currentStage||state.working_stage||state.workingStage)||null}
function suggestedLines(item){
 const conversation=object(item?.conversation_plan||item?.conversationPlan||item?.advice?.conversation_plan)
 return unique([
  item?.next_question?.question,item?.nextQuestion?.question,item?.advice?.next_question?.question,
  ...array(conversation.steps).map(step=>step?.suggested_line||step?.suggestedLine),
  ...array(conversation.closing_options||conversation.closingOptions).map(option=>option?.suggested_line||option?.suggestedLine)
 ]).slice(0,5)
}
function approach(item){
 const plan=object(item?.approach_plan||item?.approachPlan||item?.advice?.approach_plan)
 return unique([
  plan.prioritize&&`Priorizar: ${text(plan.prioritize,180)}`,
  plan.proof&&`Prova: ${text(plan.proof,180)}`,
  plan.tone&&`Tom: ${text(plan.tone,100)}`,
  plan.pace&&`Ritmo: ${text(plan.pace,100)}`,
  plan.channel&&`Canal: ${text(plan.channel,100)}`,
  plan.avoid&&`Evitar: ${text(plan.avoid,160)}`,
  plan.objective,plan.strategy,
  item?.executive_brief?.action||item?.next_best_action||item?.advice?.next_best_action
 ]).join(' • ').slice(0,520)
}
function flags(item){
 const outcome=feedbackOutcome(item)
 return {
  accepted:/accepted|aceit/.test(outcome),edited:/edited|adapted|adaptado|editad/.test(outcome),rejected:/rejected|discarded|rejeit|descart/.test(outcome),scheduled:/scheduled|agend/.test(outcome),executed:/executed|used|utiliz|execut|won|lost|ganh|perdid/.test(outcome),won:/won|ganh|fechad/.test(outcome),lost:/lost|perdid/.test(outcome)
 }
}

function recommendationObservation(recommendation,next,index){
 const stage=stageOf(recommendation),nextStage=stageOf(next)
 const currentIndex=stageIndex(stage),nextIndex=stageIndex(nextStage)
 const lines=suggestedLines(recommendation),plan=approach(recommendation)
 if(!lines.length&&!plan)return null
 const nextObserved=Boolean(next&&currentIndex>=0&&nextIndex>=0),advanced=nextObserved&&nextIndex>currentIndex,feedback=flags(recommendation)
 const evidenceIds=unique([recommendationId(recommendation,index),next?recommendationId(next,index+1):null,recommendation?.feedback?`feedback:${text(recommendation.feedback.id||recommendation.id||index,160)}`:null])
 return {id:`message-observation:${hash(`${recommendationId(recommendation,index)}:${lines.join('|')}:${plan}`)}`,recommendationId:recommendationId(recommendation,index),createdAt:iso(recommendation?.created_at||recommendation?.createdAt),stage:stage||'unknown',nextStage:nextStage||null,lines,approach:plan,nextObserved,advanced,...feedback,evidenceIds}
}

function aggregate(observations){
 const groups=new Map()
 for(const observation of observations)for(const line of observation.lines.length?observation.lines:['Sem linha separada; abordagem estruturada']){
  const key=hash(`${observation.stage}|${lower(line)}|${lower(observation.approach)}`)
  if(!groups.has(key))groups.set(key,{id:`message:${key}`,stage:observation.stage,line,approach:observation.approach,uses:0,nextObserved:0,advanced:0,accepted:0,edited:0,rejected:0,scheduled:0,executed:0,won:0,lost:0,evidenceIds:[],lastSeen:null})
  const group=groups.get(key);group.uses+=1
  for(const field of ['nextObserved','advanced','accepted','edited','rejected','scheduled','executed','won','lost'])if(observation[field])group[field]+=1
  group.evidenceIds.push(...observation.evidenceIds)
  if(!group.lastSeen||timestamp(observation.createdAt)>timestamp(group.lastSeen))group.lastSeen=observation.createdAt
 }
 return [...groups.values()].map(group=>({...group,evidenceIds:unique(group.evidenceIds).slice(0,20),advanceRate:group.nextObserved?group.advanced/group.nextObserved:null,acceptanceRate:group.uses?(group.accepted+group.edited)/group.uses:null,confidence:group.uses>=30?'benchmark_ready':group.uses>=10?'forming':group.uses>=3?'small':'isolated'})).sort((a,b)=>b.uses-a.uses||b.advanced-a.advanced||timestamp(b.lastSeen)-timestamp(a.lastSeen))
}

export function buildMessageCalibration(context={},options={}){
 const now=options.now??Date.now(),lookbackDays=options.lookbackDays??365,minSample=options.minSample??30,start=now-lookbackDays*DAY
 const history=array(context.calibrationRecommendations||context.priorRecommendations).filter(item=>timestamp(item?.created_at||item?.createdAt)!==null&&timestamp(item?.created_at||item?.createdAt)>=start&&timestamp(item?.created_at||item?.createdAt)<=now).sort((a,b)=>timestamp(a?.created_at||a?.createdAt)-timestamp(b?.created_at||b?.createdAt))
 const observations=history.map((item,index)=>recommendationObservation(item,history[index+1]||null,index)).filter(Boolean),messages=aggregate(observations)
 const summary={recommendations:history.length,observations:observations.length,linesEvaluated:observations.reduce((sum,item)=>sum+Math.max(1,item.lines.length),0),nextInteractionsObserved:observations.filter(item=>item.nextObserved).length,advanced:observations.filter(item=>item.advanced).length,accepted:observations.filter(item=>item.accepted).length,edited:observations.filter(item=>item.edited).length,rejected:observations.filter(item=>item.rejected).length,scheduled:observations.filter(item=>item.scheduled).length,executed:observations.filter(item=>item.executed).length,won:observations.filter(item=>item.won).length,lost:observations.filter(item=>item.lost).length}
 const segments=VAL_METHOD_SEQUENCE.map(stage=>{const items=observations.filter(item=>item.stage===stage),nextObserved=items.filter(item=>item.nextObserved).length,advanced=items.filter(item=>item.advanced).length;return {stage,sample:items.length,nextObserved,advanced,advanceRate:nextObserved?advanced/nextObserved:null,status:items.length>=minSample?'benchmark_ready':'building',remaining:Math.max(0,minSample-items.length)}})
 const readySegments=segments.filter(item=>item.status==='benchmark_ready').length
 return {version:'val-message-calibration-v2',generatedAt:new Date(now).toISOString(),mode:'shadow',lookbackDays,minSample,sampleStatus:readySegments?'partially_ready':'building',readySegments,summary,segments,messages:messages.slice(0,16),recentObservations:observations.slice(-8).reverse(),policy:{freeNotesExcluded:true,automaticPromptChange:false,productionRanking:false,causalClaims:false,personalDataFeatures:false,minimumSampleForComparison:minSample},interpretation:summary.nextInteractionsObserved?'Avanço significa que a etapa metodológica registrada na conversa seguinte ficou à frente da etapa anterior. A sequência temporal não prova que a frase causou o avanço.':'Ainda não existem interações seguintes suficientes para medir coincidência com avanço metodológico.',guardrail:'O placar é descritivo e permanece em shadow mode. Ele não altera prompts, score, rota, próxima ação ou linguagem da VAL sem avaliação offline, amostra mínima e aprovação humana.',emptyReason:messages.length?'':'Ainda não há mensagens estruturadas suficientes para formar o placar.'}
}
