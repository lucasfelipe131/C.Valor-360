import {createHash,randomUUID} from 'node:crypto'
import {assertAIReasoningResult,aiReasoningResultVersion} from './contracts.js'
import {routeValIntent} from './intent-router.js'
import {ComposedAdviceReasoningProvider} from './provider.js'
import {evaluateValResponseQuality,questionSimilarity} from './quality.js'
import {buildDecisionInterview,buildReasoningConfidence,decisionInterviewVersion,reasoningConfidenceVersion} from './decision-interview.js'
import {routeSystemCapability} from '../decision-copilot/capability-router.js'
import {evaluateConversationalNaturalness} from './conversational-naturalness.js'
import {evaluateReasoningGrounding,evaluateResponseGrounding} from '../decision-copilot/response-grounding.js'
import {observe} from '../observability.js'

export {aiReasoningResultVersion,goldenQuestionQualityVersion,valResponseQualityVersion} from './contracts.js'
export {routeValIntent,valIntents,valIntentRouterVersion} from './intent-router.js'
export {evaluateGoldenQuestions,evaluateValResponseQuality,questionSimilarity,runContextRemovalTest,runNameSwapTest} from './quality.js'
export {ComposedAdviceReasoningProvider,ReasoningProvider,reasoningProviderVersion} from './provider.js'
export {buildDecisionInterview,buildReasoningConfidence,decisionInterviewVersion,reasoningConfidenceVersion} from './decision-interview.js'
export {conversationalNaturalnessDimensions,conversationalNaturalnessLabels,conversationalNaturalnessVersion,evaluateConversationalNaturalness} from './conversational-naturalness.js'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=2000)=>String(value??'').replace(/\p{Cf}/gu,'').replace(/\p{Cc}/gu,' ').replace(/\s+/g,' ').trim().slice(0,max)
const own=(value,key)=>Boolean(value&&typeof value==='object')&&Object.prototype.hasOwnProperty.call(value,key)
const exactContextEpoch=(snapshot={},state={})=>{
 const epochs=[]
 for(const [object,key] of [[snapshot?.context_scope,'context_epoch'],[state,'context_epoch'],[state,'contextEpoch']])if(own(object,key)){
  const value=object[key]
  if(!Number.isSafeInteger(value)||value<0)throw Object.assign(new Error('contextEpoch inválido no contexto de raciocínio.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'INVALID_CONTEXT_EPOCH'})
  epochs.push(value)
 }
 if(!epochs.length)return 0
 if(epochs.some(value=>value!==epochs[0]))throw Object.assign(new Error('contextEpoch contraditório no contexto de raciocínio.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'CONTEXT_EPOCH_MISMATCH'})
 return epochs[0]
}
const unique=values=>[...new Set(values.map(value=>clean(value,400)).filter(Boolean))]
const first=value=>list(value)[0]||null
const idOf=item=>clean(item?.id??item?.source_id??item?.memory_ref??item?.source_ref??item?.evidence_ref?.id,240)
const statementOf=item=>clean([item?.claim_supported,item?.statement,item?.summary,item?.description].find(value=>clean(value)),900)
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

function factsUsed(advice={},context={}){
 const snapshot=context.contextSnapshot||{}
 const producerId=clean(snapshot.context_scope?.producer_id||snapshot.subject?.id||context.client?.id,180)
 const tenantId=clean(snapshot.context_scope?.tenant_id||snapshot.organization_id||context.organizationId,180)
 const snapshotEvidence=[...list(snapshot.facts),...list(snapshot.inferences),...list(snapshot.hypotheses),...list(snapshot.validated_knowledge),...list(snapshot.behavioral_signals)]
 const wrappers=[...list(snapshot.commercial_context?.business_history),...list(snapshot.commercial_context?.opportunities),...list(snapshot.agronomic_context?.properties),...list(snapshot.agronomic_context?.field_reports),...list(snapshot.agronomic_context?.soil_analyses),...list(snapshot.agronomic_context?.ndvi_observations),...list(snapshot.relationship_context?.interactions),...list(snapshot.relationship_context?.visits),...list(snapshot.relationship_context?.commitments)]
 const wrapperBySource=new Map()
 for(const wrapper of wrappers){
  const data=wrapper?.data||{}
  for(const candidate of [data.id,data.external_id,data.externalId,data.commitment_id,data.commitmentId,wrapper?.evidence_ref?.id]){
   const key=clean(candidate,240);if(key&&!wrapperBySource.has(key))wrapperBySource.set(key,wrapper)
  }
 }
 const deterministicEvidence=list(context.decisionIntelligence?.evidence).flatMap(item=>{
  const wrapper=wrapperBySource.get(clean(item?.source_id??item?.source_ref,240))
  if(!wrapper)return []
  const sourceType=clean(item?.source_type,120)
  const epistemicType=['interaction','field_report','soil_analysis','ndvi','manual_record','consultant_attachment'].includes(sourceType)?'OBSERVATION':'FACT'
  return [{...item,source_ref:wrapper.evidence_ref?.id,epistemic_type:epistemicType,producer_id:wrapper.producerId,tenant_id:wrapper.tenantId,owner_id:wrapper.ownerId,observed_at:item?.observed_at??item?.observedAt??wrapper?.observed_at??wrapper?.observedAt??null,valid_until:item?.valid_until??item?.validUntil??wrapper?.valid_until??wrapper?.validUntil??null}]
 })
 const authorized=[...snapshotEvidence,...deterministicEvidence].filter(item=>clean(item?.producer_id??item?.producerId,180)===producerId&&clean(item?.tenant_id??item?.tenantId,180)===tenantId&&clean(item?.source_ref??item?.evidence_ref?.id,240)&&clean(item?.evidence_type??item?.epistemic_type??item?.memory_state??item?.epistemic_state,40))
 const authorizedById=new Map(authorized.map(item=>[idOf(item),item]).filter(([id])=>id))
 const requestedIds=list(advice.evidence_used).map(idOf).filter(id=>authorizedById.has(id))
 const ordered=[...requestedIds.map(id=>authorizedById.get(id)),...authorized]
 if(advice.human_review?.required===true)ordered.unshift({id:'system_safety_policy:human_review',source_type:'system_safety_policy',source_ref:'val.safety.human_review',evidence_type:'FACT',producer_id:producerId,tenant_id:tenantId,owner_id:snapshot.context_scope?.owner_id||null,statement:'A VAL reteve qualquer orientação técnica acionável até revisão do responsável habilitado.'})
 const seen=new Set()
 return ordered.flatMap(item=>{
  const id=idOf(item);const statement=statementOf(item)
  if(!id||!statement||seen.has(id))return []
  seen.add(id)
  const itemProducer=clean(item.producer_id??item.producerId,180);const itemTenant=clean(item.tenant_id??item.tenantId,180)
  if(itemProducer!==producerId||itemTenant!==tenantId)return []
  return [{id,source_type:clean(item.source_type??item.evidence_ref?.type??item.memory_state??'context',120),source_ref:clean(item.source_ref??item.source_id??item.evidence_ref?.id,240)||null,epistemic_type:clean(item.evidence_type??item.epistemic_type??item.memory_state??item.epistemic_state,40).toUpperCase(),statement,observed_at:item.observed_at||null,valid_until:item.valid_until||null,confidence:item.confidence??null,producer_id:itemProducer,tenant_id:itemTenant,owner_id:clean(item.owner_id??item.ownerId,180)||null}]
 }).slice(0,12)
}

function goldenQuestions(advice={},context={}){
 const strategic=advice.strategic_synthesis||{}
 const decision=advice.decision_thesis||{}
 const missing=unique([...list(decision.missing_information),...list(advice.executive_brief?.missing_data),...list(advice.confidence?.missing_data)])
 const refs=unique([...list(advice.executive_brief?.evidence_ids),...list(strategic.highest_value_unknown?.evidence_ids)])
 const candidates=[
  {question:strategic.highest_value_unknown?.question||advice.next_question?.question,reason:strategic.highest_value_unknown?.why_it_matters||'Separa as hipóteses e muda o próximo passo.',unknown:missing[0]||'A variável que mais muda a decisão.',decision_impact:strategic.decision_at_stake||advice.executive_brief?.action,context_refs:refs},
  ...list(advice.questions).map(item=>({question:item?.question,reason:item?.purpose||'Preenche uma lacuna material.',unknown:item?.evidence_needed||missing[0]||'Dado ainda não confirmado.',decision_impact:advice.next_best_action,context_refs:item?.grounding_ids||refs}))
 ]
 const selected=[]
 for(const item of candidates){
  const raw=clean(item.question,700);const question=raw.endsWith('?')?raw:`${raw}?`
  if(!raw||selected.some(existing=>questionSimilarity(existing.question,question)>=.68))continue
  selected.push({question,reason:clean(item.reason,600),unknown:clean(item.unknown,500),decision_impact:clean(item.decision_impact,700),context_refs:unique(item.context_refs||[]).slice(0,8)})
  if(selected.length===3)break
 }
 return selected
}

function knowledgeRefs(advice={}){
 return list(advice.knowledge_retrieval?.items).map(item=>({id:clean(item.knowledge_item_id||item.id,180),title:clean(item.title,240),source_refs:unique(item.source_refs||[]),status:item.status||null,requires_human_review:item.requires_human_review===true})).filter(item=>item.id).slice(0,8)
}

function memoryRefs(context={}){
 return [...list(context.contextSnapshot?.facts),...list(context.contextSnapshot?.inferences),...list(context.contextSnapshot?.hypotheses),...list(context.contextSnapshot?.validated_knowledge)].map(item=>({id:idOf(item),key:clean(item.key,180),state:clean(item.memory_state||item.epistemic_state,80),source_ref:clean(item.source_ref,240)})).filter(item=>item.id).slice(0,16)
}

function confirmedMemoryRefs(context={}){
 return [...list(context.contextSnapshot?.facts),...list(context.contextSnapshot?.validated_knowledge)]
  .filter(item=>!/^(?:HYPOTHESIS|INFERENCE|PROPOSED)$/i.test(String(item?.memory_state||item?.epistemic_state||item?.status||'')))
  .map(item=>({id:idOf(item),key:clean(item.key,180),state:clean(item.memory_state||item.epistemic_state||'CONFIRMED',80),source_ref:clean(item.source_ref,240)}))
  .filter(item=>item.id)
  .slice(0,16)
}

const successfulCapabilityStatus=value=>/^(?:EXECUTED|SUCCESS|COMPLETED|USED)$/.test(String(value||'').toUpperCase())

function capabilityExecutionAudit({route={},run={},context={},advice={},facts=[],knowledge=[],confirmed=[]}={}){
 const explicitResults=list(run.capabilityResults||run.capability_results).map(item=>({
  ...item,capability:clean(item?.capability||item?.name||item?.id,120),status:clean(item?.status,80).toUpperCase()||'NO_DATA',source_ref:clean(item?.source_ref||item?.sourceRef,240)||null
 })).filter(item=>item.capability)
 const explicitUsed=unique(run.capabilitiesUsed||run.capabilities_used||[])
 if(explicitResults.length||explicitUsed.length){
  const results=[...explicitResults]
  for(const capability of explicitUsed)if(!results.some(item=>item.capability===capability))results.push({capability,status:'EXECUTED',source_ref:null})
  const used=unique(results.filter(item=>successfulCapabilityStatus(item.status)).map(item=>item.capability))
  return {used,results}
 }

 const client=context.client||{}
 const factBy=pattern=>facts.find(item=>pattern.test(String(item?.source_type||'')))
 const firstId=items=>idOf(first(items))
 const sources={
  CLIENT_CONTEXT:clean(client.id,180)||null,
  CONFIRMED_MEMORY:idOf(first(confirmed))||null,
  COMMERCIAL_HISTORY:idOf(factBy(/business|commercial|interaction|visit|opportunity/i))||firstId([...list(context.businessHistory),...list(context.interactions)])||null,
  VISIT_HISTORY:idOf(factBy(/visit/i))||firstId(context.visits)||null,
  OPPORTUNITY_PIPELINE:idOf(factBy(/opportunity/i))||firstId(context.opportunities)||null,
  KNOWLEDGE_LIBRARY:clean(first(knowledge)?.id,180)||null,
  AGRONOMIC_WORKSPACE:firstId([...list(context.fieldReports),...list(context.soilAnalyses),...list(context.ndviObservations),...list(context.manualRecords)])||idOf(factBy(/field|soil|ndvi|agronom|manual/i))||null,
  SOIL_ANALYSIS:firstId(context.soilAnalyses)||idOf(factBy(/soil/i))||null,
  AGRONOMIST_MANUAL:firstId(context.manualRecords)||idOf(factBy(/manual/i))||null,
  IMAGE_DIAGNOSIS:firstId(list(context.currentAttachments).filter(item=>String(item?.mimeType||item?.mime_type||'').startsWith('image/')&&['interpreted','confirmed'].includes(String(item?.status||'').toLowerCase())))||null
 }
 const results=unique(route.capabilities||[]).map(capability=>({capability,status:sources[capability]?'EXECUTED':'NO_DATA',source_ref:sources[capability]||null}))
 return {used:results.filter(item=>item.status==='EXECUTED').map(item=>item.capability),results}
}

function latencyBreakdown(run={}){
 const source=run.latency&&typeof run.latency==='object'?run.latency:{}
 const measured=key=>Object.hasOwn(source,key)&&Number.isFinite(Number(source[key]))?Number(source[key]):null
 return Object.fromEntries(['AUTH','CONTEXT_RETRIEVAL','MEMORY','DATABASE','MCA','MIA','EXTERNAL_DATA','MODEL_INPUT','MODEL_INFERENCE','VALIDATION','RESPONSE'].map(key=>[key,measured(key)]))
}

function confidence(advice={},context={}){
 const thesis=advice.decision_thesis||{}
 const numeric=Number(thesis.confidence)
 const level=clean(context.contextSnapshot?.confidence?.level||advice.confidence?.level||'INSUFICIENTE',80).toUpperCase()
 const fallback={VERIFICADO:.9,'PROVÁVEL':.72,PROVAVEL:.72,'HIPÓTESE':.48,HIPOTESE:.48,INSUFICIENTE:.2}[level]??.35
 return {level,score:Number((Number.isFinite(numeric)?Math.max(0,Math.min(1,numeric)):fallback).toFixed(2)),rationale:clean(advice.confidence?.rationale||'Confiança derivada do ContextSnapshot e das evidências selecionadas.',900)}
}

function publicContextTrace(snapshot={}){
 const trace=snapshot.selection?.context_trace
 if(!trace||typeof trace!=='object')return null
 const expose=item=>({sourceType:clean(item?.sourceType,80).toLowerCase()||'unknown',reasonSelected:clean(item?.reasonSelected,180).toUpperCase()||'UNSPECIFIED'})
 return {safe:true,domain:clean(snapshot.context_scope?.domain||snapshot.selection?.domain||'GENERAL',40).toUpperCase(),selected:list(trace.selected).map(expose).slice(0,20),rejected:list(trace.rejected).map(expose).slice(0,20)}
}

function nextCommitment(advice={}){
 const commitment=advice.commitment
 if(commitment&&typeof commitment==='object')return clean(commitment.action||commitment.description||advice.next_best_action,900)
 return clean(commitment||advice.decision_thesis?.next_action||advice.next_best_action||advice.executive_brief?.action,900)
}

function buildResult({advice={},context={},message='',run={},conversationId='',intentHint='',provider={}}={}){
 const snapshot=context.contextSnapshot||{}
 const contextEpoch=exactContextEpoch(snapshot,context.conversationState)
 const strategic=advice.strategic_synthesis||{}
 const thesis=advice.decision_thesis||{}
 const client=context.client||{}
 const facts=factsUsed(advice,context)
 const intent=routeValIntent({message,intentHint,hasClient:Boolean(client.id),attachmentTypes:list(context.currentAttachments).map(item=>item.mimeType||item.mime_type)})
 const capabilityRoute=routeSystemCapability({message,intentHint:intent.intent,hasClient:Boolean(client.id),attachmentTypes:list(context.currentAttachments).map(item=>item.mimeType||item.mime_type)})
 const missing=unique([...list(thesis.missing_information),...list(advice.executive_brief?.missing_data),...list(advice.confidence?.missing_data),...list(snapshot.missing_information).map(item=>item?.description||item?.code)]).slice(0,12)
 const selectedKnowledge=knowledgeRefs(advice)
 const selectedConfirmedMemories=confirmedMemoryRefs(context)
 const capabilityAudit=capabilityExecutionAudit({route:capabilityRoute,run,context,advice,facts,knowledge:selectedKnowledge,confirmed:selectedConfirmedMemories})
 const result={
  contract_version:aiReasoningResultVersion,
  reasoning_id:randomUUID(),
  organization:{id:clean(snapshot.organization_id||context.organizationId||'unknown',180)},
  client:{id:clean(client.id||snapshot.subject?.id||'unknown',180),name:clean(client.name||'Produtor',240)},
  context_snapshot:{id:clean(snapshot.context_snapshot_id||'unavailable',180),version:clean(snapshot.contract_version||'val.context_snapshot.v1',100),confidence:snapshot.confidence||null,hash:digest({id:snapshot.context_snapshot_id,selected:snapshot.selection?.selected_refs,client:client.id})},
  conversation_id:clean(conversationId||context.conversationSession?.id||'stateless',180),
  intent:intent.intent,
  persistence_mode:intent.persistence_mode,
  objective:clean(advice.objective||thesis.objective||snapshot.objective||message||'Apoiar a próxima decisão.',1200),
  situation_summary:clean(strategic.moment||advice.executive_brief?.reason||advice.answer||'Contexto ainda insuficiente para uma leitura precisa.',1800),
  key_signals:list(context.decisionIntelligence?.signals).slice(0,6).map(item=>({id:clean(item.id,180),title:clean(item.title||item.claim,500),kind:clean(item.kind,100),evidence_refs:unique(item.evidence_ids||[])})),
  facts_used:facts,
  hypotheses:list(strategic.competing_hypotheses).slice(0,3).map(item=>({label:clean(item.label,300),explanation:clean(item.explanation,1000),supporting_refs:unique(item.supporting_evidence_ids||[]),falsifier:clean(item.falsifier,700),validation_move:clean(item.validation_move,700)})),
  missing_information:missing,
  decision_thesis:{
   CURRENT_SITUATION:clean(strategic.moment||advice.executive_brief?.reason||'Situação atual ainda não confirmada.',1000),
   WHAT_MATTERS:clean(strategic.non_obvious_connection||advice.executive_brief?.headline||'Identificar o fato que realmente muda a decisão.',1200),
   KEY_UNCERTAINTY:clean(strategic.highest_value_unknown?.question||missing[0]||'Qual fato ainda não foi confirmado?',900),
   THESIS:clean(thesis.recommended_action||advice.executive_brief?.action||advice.next_best_action||'Descobrir antes de recomendar.',1200),
   WHY:clean(list(thesis.rationale).join(' ')||advice.executive_brief?.reason||'A tese está limitada às evidências autorizadas.',1600),
   WHAT_TO_VALIDATE:clean(strategic.highest_value_unknown?.how_to_get||thesis.next_action||missing[0]||'Confirmar o dado crítico com o produtor.',1000),
   WHAT_WOULD_CHANGE_MY_VIEW:clean(list(thesis.what_would_change_my_mind).join(' ')||first(missing)||'Uma nova evidência confirmada que contradiga a leitura atual.',1200)
  },
  golden_questions:goldenQuestions(advice,context),
  recommended_strategy:{reading:clean(advice.answer||strategic.non_obvious_connection,2400),action:clean(advice.executive_brief?.action||advice.next_best_action,1200),do_not_do:clean(strategic.do_not_do||first(advice.conversation_plan?.do_not_say),900)},
  evidence_to_use:facts.slice(0,8).map(item=>({id:item.id,source_type:item.source_type,statement:item.statement})),
  agronomic_context:{status:list(context.currentAttachments).length||list(context.fieldReports).length||list(context.soilAnalyses).length||list(context.ndviObservations).length||list(context.manualRecords).length?'available':'not_applicable',human_review_required:advice.human_review?.required===true,sources:{field_reports:list(context.fieldReports).length,soil_analyses:list(context.soilAnalyses).length,ndvi:list(context.ndviObservations).length,manual_records:list(context.manualRecords).length,attachments:list(context.currentAttachments).length},safety_note:clean(advice.human_review?.reason||'Nenhuma orientação técnica acionável foi autorizada automaticamente.',800)},
  commercial_context:{...(advice.commercial_context||{}),profile_strategy:clean(advice.value_plan?.profile_strategy||advice.behavioral_profile?.approach_guidance?.adaptation||advice.decision_profile?.adaptation||advice.approach_plan?.prioritize,1000),behavioral_profile_version:advice.behavioral_profile?.version||null},
  next_commitment:nextCommitment(advice)||'Confirmar o próximo passo com responsável, prazo e evidência.',
  risks:unique([...list(thesis.risks),...list(advice.blocked_actions),...list(advice.guardrails)]).slice(0,12),
  confidence:confidence(advice,context),
  knowledge_refs:selectedKnowledge,
  memory_refs:memoryRefs(context),
  created_at:new Date().toISOString(),
  model:clean(run.model||provider.model||'rules-v7-specific',180),
  prompt_version:clean(run.promptVersion||run.prompt_version||'val-ai-copilot-v2',180),
  run:{provider:clean(provider.name||'val-composed-advice',120),model:clean(run.model||provider.model||'rules-v7-specific',180),prompt_version:clean(run.promptVersion||run.prompt_version||'val-ai-copilot-v2',180),context_hash:digest({snapshot:snapshot.context_snapshot_id,message,client:client.id,conversation:conversationId}),latency_ms:Number(run.latencyMs??run.latency_ms??0)||0,status:clean(run.status||'completed',80),fallback:Boolean(run.generativeUsed===false||/fallback|rules|demonstration/i.test(String(run.status||run.model||''))),path:clean(run.reasoningPath||run.reasoning_path||capabilityRoute.path,20),capabilities_planned:capabilityRoute.capabilities,capabilities_used:capabilityAudit.used,capability_results:capabilityAudit.results,latency_breakdown:latencyBreakdown(run)},
  premises:{recomputed_for_request:true,source:'confirmed_context_snapshot_plus_session',profile_specific:true,conversation_is_not_confirmed_memory:true,context_scope:snapshot.context_scope||null,confirmed_memory_refs:selectedConfirmedMemories,session_context:{conversation_id:clean(conversationId||context.conversationSession?.id||'stateless',180),context_epoch:contextEpoch,persistence_mode:'NONE',turns:list(context.priorRecommendations).slice(0,8).map(item=>({text:clean(item?.user_question||item?.userQuestion||item?.question,1000),created_at:item?.created_at||item?.createdAt||null})).filter(item=>item.text)},current_data:{required:capabilityRoute.current_data_required,status:capabilityRoute.current_data_required?'SOURCE_REQUIRED':'NOT_REQUIRED'}},
 voice_output:{version:'val.voice_output.v1',speakable_text:clean(advice.answer||strategic.non_obvious_connection||advice.executive_brief?.action,3800),persistence:'NONE',automatic_memory_effect:false}
 }
 const safeTrace=publicContextTrace(snapshot)
 if(safeTrace)result.context_trace=safeTrace
 result.reasoning_confidence=buildReasoningConfidence({context,result})
 result.decision_interview=buildDecisionInterview({intent:intent.intent,message,context,result})
 return assertAIReasoningResult(result)
}

function repairResult(result,advice,context){
 const clientName=clean(context.client?.name||result.client.name,240)
 const opportunity=first(context.opportunities)||{}
 const profile=advice.behavioral_profile?.approach_guidance||{}
 const facts=list(result.facts_used)
 const factSentence=facts.slice(0,3).map(item=>item.statement).join(' ')
 const focus=clean(opportunity.title||opportunity.category||context.client?.cultures||'a decisão atual',300)
 const adapted=clean(profile.adaptation||profile.prioritize||result.commercial_context?.profile_strategy||'confirmar como este produtor prefere avaliar a prova',500)
 result.situation_summary=`${clientName}: ${clean(factSentence||result.situation_summary,1200)}`
 result.decision_thesis.CURRENT_SITUATION=result.situation_summary
 result.decision_thesis.WHAT_MATTERS=`Para “${focus}”, o que importa agora é ${clean(result.decision_thesis.WHAT_MATTERS,900)} A abordagem deve ${adapted}.`
 result.recommended_strategy.reading=`${clientName}: ${clean(result.recommended_strategy.reading||result.decision_thesis.WHAT_MATTERS,2000)}`
 result.recommended_strategy.action=clean(result.recommended_strategy.action||`Cruze os fatos registrados de ${clientName}, confirme a decisão ligada a “${focus}” e só então atualize o próximo compromisso.`,1200)
 if(!result.golden_questions.length)result.golden_questions=[{question:`Qual decisão sobre “${focus}” mudou a partir do que foi registrado?`,reason:'Identifica a decisão real antes da recomendação.',unknown:'Decisão atual do produtor.',decision_impact:'Define se existe ação, acompanhamento ou encerramento.',context_refs:facts.slice(0,3).map(item=>item.id)}]
 return assertAIReasoningResult(result)
}

function insufficientResult(result){
 result.situation_summary='Tenho pouca informação para te orientar com precisão.'
 result.decision_thesis.CURRENT_SITUATION=result.situation_summary
 result.decision_thesis.THESIS='Não recomendar ainda; coletar somente a informação que muda materialmente a decisão.'
 result.recommended_strategy.reading=result.situation_summary
 result.recommended_strategy.action='Confirme as perguntas abaixo antes de transformar a leitura em recomendação.'
 result.run.status='REASONING_DEGRADED'
 result.run.fallback=true
 result.confidence={...result.confidence,level:'INSUFICIENTE',score:Math.min(.25,Number(result.confidence.score)||.2),rationale:'Evidência insuficiente no contexto selecionado para sustentar uma afirmação específica.'}
 return assertAIReasoningResult(result)
}

const excludedGroundingLeaf=key=>/^(?:id|ids|status|kind|type|code|path|data_path|version|source|source_type|source_ref|context_refs|supporting_refs|evidence_refs|behavioral_profile_version|profile_valid_until|valid_until|created_at|observed_at|persistence|automatic_memory_effect|delivery|level)$/i.test(key)||/(?:^|_)id$/i.test(key)||/(?:^|_)(?:ids|refs|version)$/i.test(key)

function addTextLeaves(blocks,prefix,value,{exclude=excludedGroundingLeaf}={}){
 if(typeof value==='string'){
  const text=clean(value,4000)
  if(text)blocks[prefix]=text
  return
 }
 if(Array.isArray(value)){
  value.forEach((item,index)=>addTextLeaves(blocks,`${prefix}.${index}`,item,{exclude}))
  return
 }
 if(!value||typeof value!=='object')return
 for(const [key,item] of Object.entries(value)){
  if(exclude(key))continue
  addTextLeaves(blocks,`${prefix}.${key}`,item,{exclude})
 }
}

export function reasoningGroundingBlocks(result={}){
 const thesis=result.decision_thesis||{}
 const blocks={
  objective:result.objective,
  'recommended_strategy.reading':result.recommended_strategy?.reading,
  'recommended_strategy.action':result.recommended_strategy?.action,
  'recommended_strategy.do_not_do':result.recommended_strategy?.do_not_do,
  situation_summary:result.situation_summary,
  'decision_thesis.CURRENT_SITUATION':thesis.CURRENT_SITUATION,
  'decision_thesis.WHAT_MATTERS':thesis.WHAT_MATTERS,
  'decision_thesis.KEY_UNCERTAINTY':thesis.KEY_UNCERTAINTY,
  'decision_thesis.THESIS':thesis.THESIS,
  'decision_thesis.WHY':thesis.WHY,
  'decision_thesis.WHAT_TO_VALIDATE':thesis.WHAT_TO_VALIDATE,
  'decision_thesis.WHAT_WOULD_CHANGE_MY_VIEW':thesis.WHAT_WOULD_CHANGE_MY_VIEW,
  next_commitment:result.next_commitment,
  'agronomic_context.safety_note':result.agronomic_context?.safety_note,
  'confidence.rationale':result.confidence?.rationale,
  'voice_output.speakable_text':result.voice_output?.speakable_text
 }
 list(result.key_signals).forEach((item,index)=>addTextLeaves(blocks,`key_signals.${index}`,{title:item?.title}))
 list(result.facts_used).forEach((item,index)=>addTextLeaves(blocks,`facts_used.${index}`,{statement:item?.statement}))
 list(result.hypotheses).forEach((item,index)=>addTextLeaves(blocks,`hypotheses.${index}`,item))
 addTextLeaves(blocks,'missing_information',result.missing_information)
 list(result.golden_questions).forEach((item,index)=>addTextLeaves(blocks,`golden_questions.${index}`,item))
 list(result.evidence_to_use).forEach((item,index)=>addTextLeaves(blocks,`evidence_to_use.${index}`,{statement:item?.statement}))
 addTextLeaves(blocks,'commercial_context',result.commercial_context)
 addTextLeaves(blocks,'risks',result.risks)
 const interview=result.decision_interview||{}
 list(interview.questions).forEach((item,index)=>addTextLeaves(blocks,`decision_interview.questions.${index}`,{question:item?.question,why:item?.why}))
 addTextLeaves(blocks,'decision_interview.material_missing_information',interview.material_missing_information)
 addTextLeaves(blocks,'decision_interview.non_material_missing_information',interview.non_material_missing_information)
 addTextLeaves(blocks,'decision_interview.explanation',interview.explanation)
 return Object.fromEntries(Object.entries(blocks).filter(([,value])=>clean(value)))
}

function applyGroundingFallback(result,context,domain){
 const profile=domain==='PROFILE'
 const reading=profile
  ?'Não há evidência comportamental atual e auditável suficiente para determinar o perfil comportamental.'
  :'Não há evidência selecionada suficiente para afirmar uma resposta específica com segurança.'
 result.objective='Confirme a fonte antes de continuar.'
 result.situation_summary=reading
 result.decision_thesis={
 CURRENT_SITUATION:reading,
  WHAT_MATTERS:'Confirme a fonte antes de continuar.',
  KEY_UNCERTAINTY:'O que ainda não sabemos: qual fonte atual sustenta a resposta.',
  THESIS:'Confirme a fonte antes de continuar.',
  WHY:'Evidência insuficiente.',
  WHAT_TO_VALIDATE:'Confirme a fonte.',
  WHAT_WOULD_CHANGE_MY_VIEW:'Confirme a fonte.'
 }
 result.recommended_strategy={reading,action:'Confirme a fonte antes de continuar.',do_not_do:'Evite reutilizar resposta.'}
 result.key_signals=[]
 result.facts_used=[]
 result.evidence_to_use=[]
 result.memory_refs=[]
 result.knowledge_refs=[]
 result.premises={...result.premises,confirmed_memory_refs:[]}
 result.hypotheses=[]
 result.missing_information=['Informação ausente: evidência atual, identificável e compatível com a pergunta.']
 result.golden_questions=[]
 result.commercial_context={status:'no_data'}
 result.risks=[]
 result.next_commitment=result.recommended_strategy.action
 result.run.status='REASONING_DEGRADED'
 result.run.fallback=true
 result.agronomic_context={...result.agronomic_context,human_review_required:false,safety_note:'Nenhuma orientação técnica acionável foi autorizada automaticamente.'}
 result.confidence={...result.confidence,level:'INSUFICIENTE',score:Math.min(.25,Number(result.confidence.score)||.2),rationale:'Evidência insuficiente.'}
 return result
}

function applySafetyGroundingFallback(result){
 const reading='A VAL reteve qualquer orientação técnica acionável até revisão do responsável habilitado.'
 result.objective='Encaminhe a solicitação ao responsável habilitado para revisão.'
 result.situation_summary=reading
 result.decision_thesis={
  CURRENT_SITUATION:reading,
  WHAT_MATTERS:reading,
  KEY_UNCERTAINTY:'O que ainda não sabemos é se a revisão técnica autorizará alguma orientação específica.',
  THESIS:'Evite liberar orientação técnica acionável antes da revisão habilitada.',
  WHY:reading,
  WHAT_TO_VALIDATE:'Encaminhe o contexto e as fontes ao responsável habilitado.',
  WHAT_WOULD_CHANGE_MY_VIEW:'Uma revisão técnica registrada e vinculada às fontes mudaria este bloqueio.'
 }
 result.recommended_strategy={reading,action:'Encaminhe a solicitação ao responsável habilitado para revisão.',do_not_do:'Evite liberar orientação técnica acionável antes da revisão habilitada.'}
 result.key_signals=[]
 result.facts_used=[]
 result.evidence_to_use=[]
 result.memory_refs=[]
 result.knowledge_refs=[]
 result.premises={...result.premises,confirmed_memory_refs:[]}
 result.hypotheses=[]
 result.missing_information=['Informação ausente: revisão técnica habilitada e vinculada às fontes.']
 result.golden_questions=[]
 result.commercial_context={status:'no_data'}
 result.risks=[]
 result.next_commitment=result.recommended_strategy.action
 result.run.status='SAFETY_PRESERVED'
 result.run.fallback=true
 result.agronomic_context={...result.agronomic_context,safety_note:reading}
 result.confidence={...result.confidence,rationale:'Evidência insuficiente.'}
 return result
}

export function composeAIReasoning({advice={},context={},message='',run={},conversationId='',intentHint=''}={}){
 const provider=new ComposedAdviceReasoningProvider({builder:buildResult,model:run.model})
 let result=provider.synthesize({advice,context,message,run,conversationId,intentHint})
 let quality=evaluateValResponseQuality(result,context)
 let regenerationCount=0
 // Commercial guardrails and ordinary "do not do" items are not technical
 // safety holds. Only the typed human-review contract may switch grounding to
 // the deterministic agronomic safety fallback.
 const safetyPreserved=advice.human_review?.required===true
 if(!quality.passed){
  regenerationCount=1
  result=repairResult(structuredClone(result),advice,context)
  quality=evaluateValResponseQuality(result,context)
 }
 if(!quality.passed&&!safetyPreserved)result=insufficientResult(result)
 const selectedDomain=context.contextSnapshot?.context_scope?.domain||''
 const groundingScope={question:message,domain:selectedDomain,evidence:result.facts_used,activeProducerId:result.client?.id,tenantId:result.organization?.id,ownerId:context.contextSnapshot?.context_scope?.owner_id||''}
 const initialGrounding=evaluateReasoningGrounding({...groundingScope,blocks:reasoningGroundingBlocks(result)})
 const groundingFallbackApplied=!initialGrounding.passed
 if(groundingFallbackApplied)result=safetyPreserved?applySafetyGroundingFallback(result):applyGroundingFallback(result,context,selectedDomain)
 result.reasoning_confidence=buildReasoningConfidence({context,result})
 result.decision_interview=buildDecisionInterview({intent:result.intent,message,context,result})
 if(groundingFallbackApplied)result.decision_interview={version:'val.decision_interview.v1',status:'NOT_NEEDED',questions:[],material_missing_information:[],non_material_missing_information:['Informação ausente: evidência atual e identificável.'],session_context:{conversation_id:clean(conversationId||context.conversationSession?.id||'stateless',180),persistence_mode:'NONE'},explanation:'Confirme a fonte antes de continuar.'}
 const spokenQuestions=list(result.decision_interview?.questions).map((item,index)=>`Pergunta ${index+1}: ${clean(item?.question,500)}`).filter(Boolean)
 const conversationalVoice=context.conversationState?.conversation_mode===true||['audio','both'].includes(context.conversationState?.response_mode)
 const spokenParts=conversationalVoice
  ?[result.recommended_strategy?.reading,result.recommended_strategy?.action,spokenQuestions[0]]
 :[result.recommended_strategy?.reading,result.recommended_strategy?.action,spokenQuestions.length?'Para melhorar esta leitura: '+spokenQuestions.join(' '):'']
 result.voice_output={version:'val.voice_output.v1',speakable_text:clean(spokenParts.filter(Boolean).join(' '),conversationalVoice?700:3800),persistence:'NONE',automatic_memory_effect:false,delivery:conversationalVoice?'CONVERSATIONAL_BRIEF':'FULL'}
 const grounding=evaluateReasoningGrounding({...groundingScope,evidence:result.facts_used,blocks:reasoningGroundingBlocks(result)})
 if(!grounding.passed){
  observe('val.grounding.blocked',{
   domain:grounding.domain,
   unsupportedFields:grounding.claim_ledger.filter(item=>!item.supported).map(item=>item.field).join(','),
   reasonCodes:grounding.unsupported_terms.join(','),
   scopeViolationCount:grounding.scope_violations.length,
   incompatibleEvidenceCount:grounding.incompatible_evidence.length,
   provenanceViolationCount:grounding.provenance_violations.length,
   temporalViolationCount:grounding.temporal_violations.length,
   questionRelevance:grounding.question_relevance,
   outcome:'blocked'
  })
  throw Object.assign(new Error('A resposta foi bloqueada porque contém afirmação sem suporte no contexto selecionado.'),{code:'RESPONSE_GROUNDING_VIOLATION',grounding})
 }
 quality={...quality,regeneration_count:regenerationCount+(initialGrounding.passed?0:1),status:safetyPreserved?'SAFETY_PRESERVED':initialGrounding.passed&&quality.passed?'PASSED':'REASONING_DEGRADED'}
 quality={...quality,automatic_tests:{...(quality.automatic_tests||{}),source_grounding:{passed:true,evaluated:true,unsupported_terms:initialGrounding.unsupported_terms},question_relevance:{passed:grounding.question_relevance==='PASS',evaluated:true}}}
 result.grounding={
  ...grounding,
  blocked_or_regenerated:!initialGrounding.passed,
  initial_unsupported_claims:initialGrounding.unsupported_claims,
  initial_unsupported_claim_details:initialGrounding.claim_ledger.filter(item=>!item.supported)
 }
 result.quality=quality
 const naturalnessText=clean([result.recommended_strategy?.reading,result.recommended_strategy?.action,spokenQuestions[0]].filter(Boolean).join(' '),4000)
 result.conversational_naturalness=evaluateConversationalNaturalness({
  user_message:message,
  assistant_response:naturalnessText,
  prior_turns:list(context.conversationState?.conversation_turns).map(item=>({role:item?.role,content:item?.text})),
  active_context:context.conversationState||{},
  context:{references:[context.client?.name,context.conversationState?.current_property?.label,context.conversationState?.current_field?.label].filter(Boolean),references_resolved:true,expected_tenant_id:context.contextSnapshot?.organization_id,used_tenant_id:result.organization?.id,follow_up_needed:result.decision_interview?.status==='NEEDS_INPUT'},
  interaction:{response_mode:context.conversationState?.response_mode||'text',follow_up_needed:result.decision_interview?.status==='NEEDS_INPUT'},
  persistence:{performed:Boolean(result.persistence_mode&&result.persistence_mode!=='NONE'),confirmed:false},
  safety:{}
 })
 return {result,quality,intent:routeValIntent({message,intentHint,hasClient:Boolean(context.client?.id),attachmentTypes:list(context.currentAttachments).map(item=>item.mimeType||item.mime_type)})}
}

function groundedPublicAdvice(result={}){
 const strategy=result.recommended_strategy||{}
 const thesis=result.decision_thesis||{}
 const reading=clean(strategy.reading,2400)
 const action=clean(strategy.action,1200)
 const doNotDo=clean(strategy.do_not_do,900)
 const situation=clean(result.situation_summary||reading,1800)
 const objective=clean(result.objective||action,1200)
 const facts=list(result.facts_used).map(item=>({...item}))
 const missing=list(result.missing_information).map(item=>clean(item,900)).filter(Boolean)
 const questions=list(result.golden_questions).map(item=>({...item}))
 const primaryQuestion=first(questions)
 const humanReviewRequired=result.agronomic_context?.human_review_required===true
 const safetyNote=clean(result.agronomic_context?.safety_note,800)
 return {
  answer:reading,
  objective,
  evidence_used:facts,
  executive_brief:{headline:reading,reason:situation,action,question:clean(primaryQuestion?.question,700),evidence_ids:facts.map(item=>item.id).filter(Boolean),missing_data:missing},
  strategic_synthesis:{moment:situation,non_obvious_connection:reading,decision_at_stake:objective,do_not_do:doNotDo,competing_hypotheses:list(result.hypotheses).map(item=>({...item})),highest_value_unknown:primaryQuestion?{question:clean(primaryQuestion.question,700),why_it_matters:clean(primaryQuestion.reason,600),how_to_get:action,evidence_ids:list(primaryQuestion.context_refs)}:null},
  decision_thesis:{objective,recommended_action:action,rationale:[clean(thesis.WHY,1600)].filter(Boolean),missing_information:missing,what_would_change_my_mind:[clean(thesis.WHAT_WOULD_CHANGE_MY_VIEW,1200)].filter(Boolean),next_action:action},
  next_best_action:action,
  next_question:primaryQuestion?{question:clean(primaryQuestion.question,700),purpose:clean(primaryQuestion.reason,600),evidence_needed:clean(primaryQuestion.unknown,500),grounding_ids:list(primaryQuestion.context_refs)}:null,
  questions,
  commercial_context:{...(result.commercial_context||{})},
  human_review:{required:humanReviewRequired,reason:safetyNote,required_role:humanReviewRequired?'technical_reviewer':null},
  blocked_actions:doNotDo?[doNotDo]:[],
  guardrails:doNotDo?[doNotDo]:[],
  confidence:{...(result.confidence||{})}
 }
}

function groundedPublicQuality(quality={}){
 const automatic=quality.automatic_tests||{}
 const golden=automatic.golden_questions||{}
 return {
  version:quality.version,
  status:quality.status,
  passed:quality.passed===true,
  threshold:quality.threshold,
  overall:quality.overall,
  dimensions:{...(quality.dimensions||{})},
  automatic_tests:{
   name_swap:{name:automatic.name_swap?.name,passed:automatic.name_swap?.passed===true,fingerprint:automatic.name_swap?.fingerprint},
   context_removal:{name:automatic.context_removal?.name,passed:automatic.context_removal?.passed===true,dependency_score:automatic.context_removal?.dependency_score,distinct_source_types:automatic.context_removal?.distinct_source_types,reference_count:automatic.context_removal?.reference_count},
   golden_questions:{version:golden.version,passed:golden.passed===true,items:list(golden.items).map(item=>({quality_score:item?.quality_score,dimensions:{...(item?.dimensions||{})},highest_similarity:item?.highest_similarity,passed:item?.passed===true}))},
   source_grounding:{passed:automatic.source_grounding?.passed===true,evaluated:automatic.source_grounding?.evaluated===true,unsupported_terms:list(automatic.source_grounding?.unsupported_terms).map(item=>clean(item,120))},
   question_relevance:{passed:automatic.question_relevance?.passed===true,evaluated:automatic.question_relevance?.evaluated===true}
  },
  regeneration_count:Number(quality.regeneration_count)||0
 }
}

export function attachAIReasoning(advice={},input={}){
 const composition=composeAIReasoning({...input,advice})
 const rewritten=composition.result.grounding?.blocked_or_regenerated===true||Number(composition.quality?.regeneration_count)>0
 const publicAdvice=rewritten?groundedPublicAdvice(composition.result):{...advice}
 const publicQuality=rewritten?groundedPublicQuality(composition.quality):composition.quality
 const publicReasoning=rewritten?{...composition.result,quality:publicQuality}:composition.result
 return {...publicAdvice,ai_reasoning:publicReasoning,val_response_quality:publicQuality,ai_intent:composition.intent}
}
