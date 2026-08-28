import {createHash,randomUUID} from 'node:crypto'
import {assertAIReasoningResult,aiReasoningResultVersion} from './contracts.js'
import {routeValIntent} from './intent-router.js'
import {ComposedAdviceReasoningProvider} from './provider.js'
import {evaluateValResponseQuality,questionSimilarity} from './quality.js'
import {buildDecisionInterview,buildReasoningConfidence,decisionInterviewVersion,reasoningConfidenceVersion} from './decision-interview.js'
import {routeSystemCapability} from '../decision-copilot/capability-router.js'
import {evaluateConversationalNaturalness} from './conversational-naturalness.js'

export {aiReasoningResultVersion,goldenQuestionQualityVersion,valResponseQualityVersion} from './contracts.js'
export {routeValIntent,valIntents,valIntentRouterVersion} from './intent-router.js'
export {evaluateGoldenQuestions,evaluateValResponseQuality,questionSimilarity,runContextRemovalTest,runNameSwapTest} from './quality.js'
export {ComposedAdviceReasoningProvider,ReasoningProvider,reasoningProviderVersion} from './provider.js'
export {buildDecisionInterview,buildReasoningConfidence,decisionInterviewVersion,reasoningConfidenceVersion} from './decision-interview.js'
export {conversationalNaturalnessDimensions,conversationalNaturalnessLabels,conversationalNaturalnessVersion,evaluateConversationalNaturalness} from './conversational-naturalness.js'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const unique=values=>[...new Set(values.map(value=>clean(value,400)).filter(Boolean))]
const first=value=>list(value)[0]||null
const idOf=item=>clean(item?.id??item?.source_id??item?.memory_ref,240)
const statementOf=item=>clean(item?.claim_supported??item?.statement??item?.summary??item?.description??item?.value?.statement??item?.value?.description??item?.value,900)
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

function factsUsed(advice={},context={}){
 const evidence=list(advice.evidence_used)
 const snapshotFacts=[...list(context.contextSnapshot?.facts),...list(context.contextSnapshot?.validated_knowledge)]
 const seen=new Set()
 return [...evidence,...snapshotFacts].flatMap(item=>{
  const id=idOf(item);const statement=statementOf(item)
  if(!id||!statement||seen.has(id))return []
  seen.add(id)
  return [{id,source_type:clean(item.source_type??item.evidence_ref?.type??item.memory_state??'context',120),statement,observed_at:item.observed_at||null,confidence:item.confidence??null}]
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

function nextCommitment(advice={}){
 const commitment=advice.commitment
 if(commitment&&typeof commitment==='object')return clean(commitment.action||commitment.description||advice.next_best_action,900)
 return clean(commitment||advice.decision_thesis?.next_action||advice.next_best_action||advice.executive_brief?.action,900)
}

function buildResult({advice={},context={},message='',run={},conversationId='',intentHint='',provider={}}={}){
 const snapshot=context.contextSnapshot||{}
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
  premises:{recomputed_for_request:true,source:'confirmed_context_snapshot_plus_session',profile_specific:true,conversation_is_not_confirmed_memory:true,confirmed_memory_refs:selectedConfirmedMemories,session_context:{conversation_id:clean(conversationId||context.conversationSession?.id||'stateless',180),persistence_mode:'NONE',turns:list(context.priorRecommendations).slice(0,8).map(item=>({text:clean(item?.user_question||item?.userQuestion||item?.question,1000),created_at:item?.created_at||item?.createdAt||null})).filter(item=>item.text)},current_data:{required:capabilityRoute.current_data_required,status:capabilityRoute.current_data_required?'SOURCE_REQUIRED':'NOT_REQUIRED'}},
  voice_output:{version:'val.voice_output.v1',speakable_text:clean(advice.answer||strategic.non_obvious_connection||advice.executive_brief?.action,3800),persistence:'NONE',automatic_memory_effect:false}
 }
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
 result.confidence={...result.confidence,level:'INSUFICIENTE',score:Math.min(.25,Number(result.confidence.score)||.2)}
 return assertAIReasoningResult(result)
}

export function composeAIReasoning({advice={},context={},message='',run={},conversationId='',intentHint=''}={}){
 const provider=new ComposedAdviceReasoningProvider({builder:buildResult,model:run.model})
 let result=provider.synthesize({advice,context,message,run,conversationId,intentHint})
 let quality=evaluateValResponseQuality(result,context)
 let regenerationCount=0
 const safetyPreserved=advice.human_review?.required===true||list(advice.blocked_actions).length>0
 if(!quality.passed){
  regenerationCount=1
  result=repairResult(structuredClone(result),advice,context)
  quality=evaluateValResponseQuality(result,context)
 }
 if(!quality.passed&&!safetyPreserved)result=insufficientResult(result)
 quality={...quality,regeneration_count:regenerationCount,status:quality.passed?'PASSED':safetyPreserved?'SAFETY_PRESERVED':'REASONING_DEGRADED'}
 result.quality=quality
 result.reasoning_confidence=buildReasoningConfidence({context,result})
 result.decision_interview=buildDecisionInterview({intent:result.intent,message,context,result})
 const spokenQuestions=list(result.decision_interview?.questions).map((item,index)=>`Pergunta ${index+1}: ${clean(item?.question,500)}`).filter(Boolean)
 const conversationalVoice=context.conversationState?.conversation_mode===true||['audio','both'].includes(context.conversationState?.response_mode)
 const spokenParts=conversationalVoice
  ?[result.recommended_strategy?.reading,result.recommended_strategy?.action,spokenQuestions[0]]
  :[result.recommended_strategy?.reading,result.recommended_strategy?.action,spokenQuestions.length?'Para melhorar esta leitura: '+spokenQuestions.join(' '):'']
 result.voice_output={version:'val.voice_output.v1',speakable_text:clean(spokenParts.filter(Boolean).join(' '),conversationalVoice?700:3800),persistence:'NONE',automatic_memory_effect:false,delivery:conversationalVoice?'CONVERSATIONAL_BRIEF':'FULL'}
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

export function attachAIReasoning(advice={},input={}){
 const composition=composeAIReasoning({...input,advice})
 return {...advice,ai_reasoning:composition.result,val_response_quality:composition.quality,ai_intent:composition.intent}
}
