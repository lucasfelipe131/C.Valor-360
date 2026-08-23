import {createHash,randomUUID} from 'node:crypto'
import {buildCommitmentCandidate} from '../execution/commitment.js'
import {assertVisitLoopContract,learningCandidateVersion,outcomeTypes,outcomeVersion,validateLearningCandidate,validateOutcome,validateVisitReport,visitReportArrayFields,visitReportVersion} from './contracts.js'

const text=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalized=value=>text(value,20_000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const list=value=>Array.isArray(value)?value:[]
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const nowIso=value=>(value instanceof Date?value:new Date(value||Date.now())).toISOString()
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const uuidFrom=value=>{const hash=digest(value);return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0))

function candidate(kind,statement,input={},index=0){
 const item={
  item_id:text(input.item_id,180)||uuidFrom({kind,statement,index,source:input.source_ref}),
  epistemic_status:kind,
  statement:text(statement,1200),
  source_ref:text(input.source_ref,240),
  confidence:Number(clamp(input.confidence??.7).toFixed(2)),
  requires_confirmation:true
 }
 return {...item,...input,item_id:item.item_id,epistemic_status:kind,statement:item.statement,source_ref:item.source_ref,confidence:item.confidence,requires_confirmation:true}
}

function sentenceList(value){return String(value||'').split(/(?<=[.!?])\s+|\n+/).map(item=>text(item,1200)).filter(Boolean)}

function localDateParts(date,offsetHours=-3){
 const adjusted=new Date(date.getTime()+offsetHours*3_600_000)
 return {year:adjusted.getUTCFullYear(),month:adjusted.getUTCMonth(),day:adjusted.getUTCDate(),weekday:adjusted.getUTCDay()}
}

function endOfLocalDay(year,month,day,offsetHours=-3){
 const sign=offsetHours<=0?'-':'+'
 const hh=String(Math.abs(offsetHours)).padStart(2,'0')
 return new Date(`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59.999${sign}${hh}:00`).toISOString()
}

export function resolveVisitDueDate(expression,{anchor=Date.now()}={}){
 const raw=text(expression,500)
 const value=normalized(raw)
 const anchorDate=anchor instanceof Date?anchor:new Date(anchor)
 if(Number.isNaN(anchorDate.getTime()))return {due_at:null,ambiguous:true,reason_code:'INVALID_ANCHOR'}
 const isoMatch=raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
 if(isoMatch){const date=new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T23:59:59.999-03:00`);return Number.isNaN(date.getTime())?{due_at:null,ambiguous:true,reason_code:'INVALID_DATE'}:{due_at:date.toISOString(),ambiguous:false,reason_code:'EXPLICIT_DATE'}}
 const brMatch=raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/)
 if(brMatch){
  const parts=localDateParts(anchorDate);let year=Number(brMatch[3]||parts.year);const month=Number(brMatch[2])-1;const day=Number(brMatch[1])
  let date=new Date(`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59.999-03:00`)
  if(!brMatch[3]&&date<anchorDate){year+=1;date=new Date(`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59.999-03:00`)}
  return Number.isNaN(date.getTime())?{due_at:null,ambiguous:true,reason_code:'INVALID_DATE'}:{due_at:date.toISOString(),ambiguous:false,reason_code:'EXPLICIT_DATE'}
 }
 const weekdays={domingo:0,segunda:1,terca:2,quarta:3,quinta:4,sexta:5,sabado:6}
 const named=Object.entries(weekdays).find(([name])=>new RegExp(`\\b${name}(?:-feira)?\\b`).test(value))
 if(named){
  const parts=localDateParts(anchorDate);let delta=(named[1]-parts.weekday+7)%7
  if(delta===0)return {due_at:null,ambiguous:true,reason_code:'SAME_DAY_WEEKDAY_AMBIGUOUS'}
  const target=new Date(Date.UTC(parts.year,parts.month,parts.day+delta))
  return {due_at:endOfLocalDay(target.getUTCFullYear(),target.getUTCMonth(),target.getUTCDate()),ambiguous:false,reason_code:'NEXT_NAMED_WEEKDAY_END_OF_DAY'}
 }
 if(/amanha/.test(value)){
  const parts=localDateParts(anchorDate);const target=new Date(Date.UTC(parts.year,parts.month,parts.day+1))
  return {due_at:endOfLocalDay(target.getUTCFullYear(),target.getUTCMonth(),target.getUTCDate()),ambiguous:false,reason_code:'NEXT_DAY_END_OF_DAY'}
 }
 if(/semana que vem|proxima semana|depois|mais tarde|em breve/.test(value))return {due_at:null,ambiguous:true,reason_code:'RELATIVE_DATE_AMBIGUOUS'}
 return {due_at:null,ambiguous:true,reason_code:'DATE_NOT_FOUND'}
}

function extraction(textValue,{sourceRef,actorId,anchor}){
 const corpus=normalized(textValue)
 const sentences=sentenceList(textValue)
 const find=pattern=>sentences.find(sentence=>pattern.test(normalized(sentence)))
 const discussedTopics=[]
 for(const [pattern,label] of [[/fertiliz|adubo/,'Fertilizante'],[/\bbuva\b/,'Buva'],[/preco|investimento|valor/,'Investimento e valor'],[/comparativ/,'Comparativo']])if(pattern.test(corpus))discussedTopics.push(label)
 const objections=[]
 const priceSentence=find(/caro|investimento (?:alto|elevado)|preco (?:alto|elevado)/)
 if(priceSentence)objections.push(candidate('FACT_CANDIDATE','O produtor manifestou objeção ao investimento ou preço.',{source_ref:sourceRef,confidence:.9,category:'PRICE',reported_text:priceSentence},objections.length))
 const expectations=[]
 const comparisonSentence=find(/comparativ|simulacao|proposta/)
 if(comparisonSentence)expectations.push(candidate('FACT_CANDIDATE','Foi solicitado ou apresentado material comparativo.',{source_ref:sourceRef,confidence:.82,category:'PROOF_REQUEST',reported_text:comparisonSentence},expectations.length))
 const producerSignals=[]
 if(/fal(?:ar|ou) com (?:o |a )?(socio|socia|familia|gerente)/.test(corpus))producerSignals.push(candidate('FACT_CANDIDATE','A decisão envolve outro participante explicitamente mencionado.',{source_ref:sourceRef,confidence:.88,signal_code:'MULTI_DECISION_PARTICIPANT'},producerSignals.length))
 const opportunities=[]
 const buvaSentence=find(/\bbuva\b/)
 if(buvaSentence)opportunities.push(candidate('HYPOTHESIS','Pode existir uma oportunidade secundária relacionada ao manejo de buva, ainda dependente de diagnóstico e revisão técnica.',{source_ref:sourceRef,confidence:.45,title:'Avaliar contexto de buva',category:'AGRONOMIC_NEED',technical_claims_status:'REQUIRES_MIA',reported_text:buvaSentence},opportunities.length))
 const technical=[]
 if(buvaSentence)technical.push(candidate('FACT_CANDIDATE','O produtor relatou ocorrência ou preocupação com buva em uma área não identificada.',{source_ref:sourceRef,confidence:.82,observation_type:'PRODUCER_REPORTED_WEED',requires_technical_review:true,reported_text:buvaSentence},technical.length))
 const behavioral=[]
 if(/comparativ|numero|roi|custo/.test(corpus))behavioral.push(candidate('INFERENCE','A solicitação observável favorece prova comparativa ou quantitativa; não constitui diagnóstico de personalidade.',{source_ref:sourceRef,confidence:.62,signal_code:'REQUESTED_COMPARATIVE_PROOF',dimension:'analytical'},behavioral.length))
 const returnSentence=find(/retorn|voltar|nova visita|acompanhar/)
 const due=returnSentence?resolveVisitDueDate(returnSentence,{anchor}):{due_at:null,ambiguous:true,reason_code:'DATE_NOT_FOUND'}
 const commitments=[]
 const nextSteps=[]
 if(returnSentence){
  const description=/comparativ|simulacao/.test(normalized(returnSentence))?'Retornar com o comparativo solicitado.':'Realizar o retorno combinado.'
  commitments.push(candidate('FACT_CANDIDATE','Foi proposto um compromisso de retorno.',{source_ref:sourceRef,confidence:.86,description,owner_type:'USER',owner_id:actorId,due_at:due.due_at,date_expression:returnSentence,date_confirmation_required:due.ambiguous,date_resolution_reason_code:due.reason_code,status:'PROPOSED',success_criteria:'Retorno realizado e resposta do produtor registrada.',agreed_with_client:true},0))
  nextSteps.push(candidate('FACT_CANDIDATE','Retorno ao produtor.',{source_ref:sourceRef,confidence:.86,type:'FOLLOW_UP',description,due_at:due.due_at,date_confirmation_required:due.ambiguous,explicit:true},0))
 }else nextSteps.push(candidate('HYPOTHESIS','Confirmar explicitamente se existe próximo passo ou se nenhuma ação é necessária.',{source_ref:sourceRef,confidence:.25,type:'NEEDS_CONFIRMATION',description:'Definir próximo passo.',due_at:null,date_confirmation_required:false,explicit:false},0))
 const closed=[]
 const negativeClose=/nao (?:fechou|fecha|houve fechamento)|sem fechamento/.test(corpus)
 const closeSentence=!negativeClose&&find(/fechou|pedido confirmado|negocio ganho|compra confirmada/)
 if(closeSentence)closed.push(candidate('FACT_CANDIDATE','Foi relatado fechamento de negócio, pendente de evidência material.',{source_ref:sourceRef,confidence:.75,reported_text:closeSentence},0))
 const pending=[]
 if(negativeClose||/pediu retorno|depois de falar/.test(corpus))pending.push(candidate('FACT_CANDIDATE','A decisão permaneceu pendente após a visita.',{source_ref:sourceRef,confidence:.88},0))
 const missing=[]
 if(priceSentence&&!/roi|impacto|custo por|custo\/ha|perda/.test(corpus))missing.push(candidate('FACT_CANDIDATE','Falta dimensionar o impacto econômico associado à objeção de preço.',{source_ref:sourceRef,confidence:.9,code:'PRICE_IMPACT_NOT_QUANTIFIED',critical:false},missing.length))
 if(buvaSentence&&!/talhao|area de \d|hectar|\d+(?:[,.]\d+)?\s*ha\b/.test(corpus))missing.push(candidate('FACT_CANDIDATE','Falta identificar área/talhão, data e evidência da observação de buva.',{source_ref:sourceRef,confidence:.95,code:'TECHNICAL_OBSERVATION_LOCATION_MISSING',critical:true},missing.length))
 if(commitments.some(item=>item.date_confirmation_required))missing.push(candidate('FACT_CANDIDATE','A data do compromisso de retorno precisa ser confirmada.',{source_ref:sourceRef,confidence:1,code:'COMMITMENT_DATE_AMBIGUOUS',critical:true},missing.length))
 const summary=text(sentences.slice(0,4).join(' '),1200)||'Relato sem conteúdo material extraível.'
 const detected=[...objections,...expectations,...producerSignals,...opportunities,...technical,...behavioral,...commitments,...closed,...pending]
 return {summary,discussedTopics,expectations,objections,producerSignals,opportunities,commitments,closed,pending,nextSteps,technical,behavioral,missing,confidence:Number(Math.min(.92,.35+detected.length*.06).toFixed(2))}
}

export function buildVisitReport(input={}){
 const sourceType=text(input.sourceType,30).toUpperCase()
 const sourceText=text(input.sourceText??input.transcriptText,20_000)
 if(!sourceText)throw Object.assign(new Error('Escreva o relato da visita ou forneça uma transcrição válida.'),{code:'visit_report_source_required',statusCode:422})
 if(!['TEXT','AUDIO'].includes(sourceType))throw Object.assign(new Error('A origem do relato deve ser TEXT ou AUDIO.'),{code:'visit_report_source_invalid',statusCode:422})
 const createdAt=nowIso(input.now)
 const sourceRef=text(input.sourceRef,240)||(sourceType==='AUDIO'?`transcript:${text(input.transcriptId,180)}`:`visit-text:${digest(sourceText).slice(0,32)}`)
 const idempotencyKey=text(input.idempotencyKey,180)||digest({visitId:input.visitId,sourceType,sourceRef,sourceText}).slice(0,64)
 const extracted=extraction(sourceText,{sourceRef,actorId:text(input.createdBy,180),anchor:input.occurredAt??input.now})
 const report={
  contract_version:visitReportVersion,version:visitReportVersion,
  visit_report_id:text(input.visitReportId,180)||uuidFrom({organizationId:input.organizationId,visitId:input.visitId,idempotencyKey}),
  visit_id:text(input.visitId,180),organization_id:text(input.organizationId,180),client_id:text(input.clientId,180),created_by:text(input.createdBy,180),confirmed_by:null,
  source_type:sourceType,source_ref:sourceRef,transcript_ref:input.transcriptId?`visit-transcript:${text(input.transcriptId,180)}`:null,transcript_id:input.transcriptId?text(input.transcriptId,180):null,
  visit_objective:text(input.visitObjective,1600)||'Objetivo não informado.',summary:extracted.summary,
  discussed_topics:extracted.discussedTopics,expectations_created:extracted.expectations,objections:extracted.objections,producer_signals:extracted.producerSignals,
  opportunities_detected:extracted.opportunities,commitments_proposed:extracted.commitments,commitments_confirmed:[],closed_business:extracted.closed,pending_business:extracted.pending,
  next_steps:extracted.nextSteps,technical_observations:extracted.technical,behavioral_signals:extracted.behavioral,missing_information:extracted.missing,
  consultant_notes:text(input.consultantNotes,4000)||'',confidence:extracted.confidence,confirmation_status:'PENDING_REVIEW',revision_no:1,idempotency_key:idempotencyKey,created_at:createdAt,confirmed_at:null
 }
 return assertVisitLoopContract(report,validateVisitReport,'VisitReport v1')
}

export function reviseVisitReport(report,input={}){
 if(report.confirmation_status!=='PENDING_REVIEW')throw Object.assign(new Error('Somente um report pendente pode ser revisado.'),{code:'visit_report_not_editable',statusCode:409})
 const removeIds=new Set(list(input.remove_item_ids??input.removeItemIds).map(item=>text(item,180)))
 const replacement=object(input.fields)?input.fields:{}
 const additions=object(input.additions)?input.additions:{}
 const next={...structuredClone(report)}
 for(const field of visitReportArrayFields){
  const base=Array.isArray(replacement[field])?replacement[field]:list(next[field]).filter(item=>!object(item)||!removeIds.has(text(item.item_id,180)))
  next[field]=[...base,...list(additions[field])]
 }
 for(const field of ['summary','consultant_notes'])if(Object.prototype.hasOwnProperty.call(replacement,field))next[field]=text(replacement[field],field==='summary'?1200:4000)
 next.revision_no=Number(report.revision_no||1)+1
 return assertVisitLoopContract(next,validateVisitReport,'VisitReport v1')
}

export function confirmVisitReport(report,{actorId,now}={}){
 if(report.confirmation_status==='CONFIRMED')return report
 if(report.confirmation_status!=='PENDING_REVIEW')throw Object.assign(new Error('Este report não pode ser confirmado.'),{code:'visit_report_confirmation_denied',statusCode:409})
 const unresolved=list(report.commitments_confirmed).filter(item=>!item.due_at||item.date_confirmation_required)
 if(unresolved.length)throw Object.assign(new Error('Confirme a data de cada compromisso antes de concluir a visita.'),{code:'ambiguous_commitment_date',statusCode:422,itemIds:unresolved.map(item=>item.item_id)})
 const nextSteps=list(report.next_steps).filter(item=>item.type!=='NEEDS_CONFIRMATION'&&item.explicit!==false)
 if(!nextSteps.length)throw Object.assign(new Error('Registre um próximo passo ou marque explicitamente que nenhuma ação é necessária.'),{code:'explicit_next_step_required',statusCode:422})
 const confirmed={...structuredClone(report),next_steps:nextSteps,confirmation_status:'CONFIRMED',confirmed_by:text(actorId,180),confirmed_at:nowIso(now),revision_no:Number(report.revision_no||1)+1}
 return assertVisitLoopContract(confirmed,validateVisitReport,'VisitReport v1')
}

export function buildOutcome(input={}){
 const type=text(input.outcomeType??input.outcome_type,40).toUpperCase()
 if(!outcomeTypes.includes(type))throw Object.assign(new Error('Selecione um outcome válido para a visita.'),{code:'visit_outcome_required',statusCode:422})
 const createdAt=nowIso(input.now)
 return assertVisitLoopContract({
  contract_version:outcomeVersion,version:outcomeVersion,
  outcome_id:text(input.outcomeId,180)||randomUUID(),organization_id:text(input.organizationId,180),visit_id:text(input.visitId,180),client_id:text(input.clientId,180),
  visit_report_id:input.visitReportId?text(input.visitReportId,180):null,recommendation_id:input.recommendationId?text(input.recommendationId,180):null,
  action_plan_id:input.actionPlanId?text(input.actionPlanId,180):null,commitment_id:input.commitmentId?text(input.commitmentId,180):null,
  outcome_type:type,result:object(input.result)?input.result:{summary:text(input.result,1600)||type},evidence_refs:list(input.evidenceRefs??input.evidence_refs),
  measured_at:nowIso(input.measuredAt??input.now),recorded_by:text(input.recordedBy,180),confidence:Number(clamp(input.confidence??.8).toFixed(2)),notes:text(input.notes,4000)||'',created_at:createdAt
 },validateOutcome,'Outcome v1')
}

export function buildLearningCandidate({report,outcome,createdBy,now}={}){
 if(!report||report.confirmation_status!=='CONFIRMED')throw Object.assign(new Error('LearningCandidate exige VisitReport confirmado.'),{code:'confirmed_visit_report_required',statusCode:422})
 const priceObjection=list(report.objections).some(item=>item.category==='PRICE')
 const comparative=list(report.expectations_created).some(item=>item.category==='PROOF_REQUEST')
 const hypothesis=priceObjection&&comparative
  ?'Quando há objeção de preço e solicitação de comparativo, uma prova econômica explícita pode melhorar o próximo avanço; validar em outras visitas antes de generalizar.'
  :`O padrão observado nesta visita pode orientar uma próxima preparação, mas exige repetição e revisão antes de qualquer promoção.`
 const supporting=[{id:`visit-report:${report.visit_report_id}`,type:'confirmed_visit_report'},...(outcome?[{id:`outcome:${outcome.outcome_id}`,type:'outcome'}]:[])]
 return assertVisitLoopContract({
  contract_version:learningCandidateVersion,version:learningCandidateVersion,candidate_id:randomUUID(),organization_id:report.organization_id,
  source_visit_id:report.visit_id,source_visit_report_id:report.visit_report_id,source_outcome_id:outcome?.outcome_id||null,
  hypothesis,scope:{type:'CLIENT_VISIT',client_id:report.client_id,automatic_promotion:false},supporting_evidence:supporting,contrary_evidence:[],
  confidence:Number(Math.min(.75,Math.max(.2,(Number(report.confidence)||0)*.7)).toFixed(2)),status:'CANDIDATE',created_by:text(createdBy,180),created_at:nowIso(now)
 },validateLearningCandidate,'LearningCandidate v1')
}

export function confirmedCommitments(report,{actorId,requestId,now}={}){
 return list(report.commitments_confirmed).map(item=>{
  const candidateResult=buildCommitmentCandidate({
   organization_id:report.organization_id,client_id:report.client_id,visit_id:report.visit_id,description:item.description||item.statement,
   owner_type:item.owner_type||'USER',owner_id:item.owner_id||actorId,due_at:item.due_at,status:'ACCEPTED',success_criteria:item.success_criteria||'Resultado do próximo passo registrado.',
   agreed_with_client:item.agreed_with_client!==false,evidence_refs:[{id:`visit-report:${report.visit_report_id}`,type:'confirmed_visit_report'}],source_ref:`visit-report:${report.visit_report_id}`,
   request_id:requestId||`visit-report:${report.visit_report_id}`,created_by:actorId,now
  })
  if(!candidateResult.is_commitment)throw Object.assign(new Error(`Compromisso incompleto: ${candidateResult.missing_fields.join(', ')}.`),{code:'commitment_incomplete',statusCode:422})
  return candidateResult.commitment
 })
}

export function confirmedMemoryWrites(report,{actorId,now}={}){
 const timestamp=nowIso(now)
 const sourceRef=`visit-report:${report.visit_report_id}`
 const writes=[]
 const add=(item,{key,domain,state='FACT',type='fact',status='verified',value={}})=>writes.push({
  id:randomUUID(),organization_id:report.organization_id,client_id:report.client_id,subject_type:'visit',subject_id:report.visit_id,memory_type:type,memory_state:state,memory_domain:domain,key,
  value:{statement:item.statement,...value},evidence:[{id:item.item_id,source_ref:sourceRef,confirmation_status:'CONFIRMED'}],confidence:Math.round(clamp(item.confidence??report.confidence)*100),status,source:'confirmed_visit_report',source_ref:sourceRef,source_type:'confirmed_visit_report',
  observed_at:report.confirmed_at,source_updated_at:report.confirmed_at,freshness_policy_version:'val.context.freshness.v1',freshness_metadata:{domain,source_type:'confirmed_visit_report'},valid_from:timestamp,valid_until:null,created_by:actorId,acl:{scope:'own_portfolio'}
 })
 for(const item of list(report.objections))add(item,{key:'visit_report.objection',domain:'COMMERCIAL',value:{category:item.category||null}})
 for(const item of list(report.producer_signals))add(item,{key:'visit_report.producer_signal',domain:'RELATIONSHIP',value:{signal_code:item.signal_code||null}})
 for(const item of list(report.expectations_created))add(item,{key:'visit_report.expectation',domain:'COMMERCIAL',value:{category:item.category||null}})
 for(const item of list(report.technical_observations))add(item,{key:'visit_report.technical_observation',domain:'AGRONOMIC',value:{observation_type:item.observation_type||null,claim_status:'REPORTED_OBSERVATION',requires_technical_review:true}})
 for(const item of list(report.behavioral_signals))add(item,{key:'visit_report.behavioral_signal',domain:'BEHAVIORAL',state:'INFERENCE',type:'inference',status:'proposed',value:{signal_code:item.signal_code||null,dimension:item.dimension||null,profile_certainty:false}})
 for(const item of list(report.missing_information))add(item,{key:'visit_report.missing_information',domain:item.code?.startsWith('TECHNICAL')?'AGRONOMIC':'COMMERCIAL',state:'HYPOTHESIS',type:'inference',status:'proposed',value:{code:item.code||'VISIT_MISSING_INFORMATION',critical:Boolean(item.critical)}})
 if(report.next_steps.length)for(const item of report.next_steps)add(item,{key:'visit_report.next_step',domain:'RELATIONSHIP',value:{type:item.type,due_at:item.due_at||null,explicit:true}})
 return writes
}

export function confirmedOpportunityWrites(report){
 return list(report.opportunities_detected).map(item=>({
  title:text(item.title||item.statement,220),category:text(item.category,120)||'VisitReport',hypothesis:text(item.statement,2000),estimated_value:null,stage:'Diagnóstico',next_action:'Confirmar necessidade, contexto e segurança antes de propor.',next_action_at:null,
  candidate_key:`visit-report:${report.visit_report_id}:${item.item_id}`,evidence:[{type:'confirmed_visit_report',id:report.visit_report_id},{type:'candidate',id:item.item_id},{type:'technical_claims_status',value:item.technical_claims_status||null}]
 }))
}

export function visitReflection(report,outcome){
 return {
  what_happened:report.summary,
  what_advanced:[...report.expectations_created,...report.closed_business].map(item=>item.statement),
  what_blocked:[...report.objections,...report.pending_business].map(item=>item.statement),
  objections:report.objections.map(item=>item.statement),
  prior_hypotheses_reviewed:[],
  new_opportunities:report.opportunities_detected.map(item=>item.statement),
  commitments:report.commitments_confirmed.map(item=>item.description||item.statement),
  unanswered:report.missing_information.map(item=>item.statement),
  next_visit_should_know:[...report.objections,...report.expectations_created,...report.next_steps].map(item=>item.statement||item.description),
  outcome_type:outcome?.outcome_type||null
 }
}
