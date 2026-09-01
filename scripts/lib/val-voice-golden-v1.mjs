import {evaluateConversationalNaturalness} from '../../server/ai-reasoning/conversational-naturalness.js'
import {prepareConversationThread} from '../../server/conversation-thread-context.js'
import {executeCapabilityPlan} from '../../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../../server/decision-copilot/capability-router.js'
import {
 advanceConversationState,
 conversationStateContext,
 createConversationState,
 messageNeedsSessionReference
} from '../../server/decision-copilot/conversation-state.js'
import {
 localNaturalCommandTurn,
 resolveValNaturalCommand
} from '../../src/lib/val-natural-commands.js'
import {
 REALTIME_CONVERSATION_EVENTS as VOICE_EVENTS,
 REALTIME_CONVERSATION_STATES as VOICE_STATES,
 createRealtimeConversationState,
 responseTextFromConversationTurn,
 transitionRealtimeConversation
} from '../../src/lib/realtime-conversation.js'

export const voiceConversationGoldenVersion='val.voice_conversation_golden.v1'

const client=Object.freeze({id:'client-antonio',name:'Antônio Ferreira'})
const visit=Object.freeze({type:'visit',id:'visit-antonio-2026-08-29',label:'Visita de 29/08/2026'})
const field=Object.freeze({type:'field',id:'field-north',label:'Talhão Norte'})
const scope=Object.freeze({
 conversationId:'voice-golden-thread',
 tenantId:'tenant-golden',
 ownerId:'owner-golden',
 clientId:client.id,
 client,
})

const scopedVoiceEvidence=(item,index,epistemicType)=>({
 ...item,
 source_ref:item?.source_ref||`voice-golden-turn-${String(index+1).padStart(3,'0')}`,
 source_type:item?.source_type||'consultant_input',
 epistemic_type:item?.epistemic_type||epistemicType,
 producer_id:item?.producer_id||client.id,
 tenant_id:item?.tenant_id||scope.tenantId,
 owner_id:item?.owner_id||scope.ownerId,
 observed_at:item?.observed_at||'2026-08-28T12:00:00.000Z'
})

const assistantResponse=({reading,action='',facts=[],hypotheses=[],questions=[],goldenQuestions=[],thesis='',uncertainty='',execution=null}={})=>({
 advice:{
  answer:reading,
  ai_reasoning:{
   recommended_strategy:{reading,action},
   facts_used:facts.map((item,index)=>scopedVoiceEvidence(item,index,'OBSERVATION')),
   hypotheses:hypotheses.map((item,index)=>scopedVoiceEvidence(item,index,'HYPOTHESIS')),
   decision_thesis:thesis?{THESIS:thesis,KEY_UNCERTAINTY:uncertainty}:null,
   decision_interview:{questions:questions.map(question=>({question}))},
   golden_questions:goldenQuestions.map(question=>({question})),
   run:execution||{capability_results:[],tool_result:null}
  }
 }
})

const observed=value=>{
 if(value===undefined)return null
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null)return value
 return JSON.parse(JSON.stringify(value))
}

const check=(id,condition,expected,actual)=>Object.freeze({
 id,
 status:condition?'PASS':'FAIL',
 expected,
 observed:observed(actual)
})

const scenarioResult=(id,checks,trace,extra={})=>Object.freeze({
 id,
 status:checks.every(item=>item.status==='PASS')?'PASS_AUTOMATED_CONTRACT':'FAIL_AUTOMATED_CONTRACT',
 evidence_class:'DETERMINISTIC_AUTOMATED_CONTRACT',
 physical_uat:'NOT_EXECUTED',
 checks:Object.freeze(checks),
 trace:Object.freeze(trace),
 ...extra
})

const stateTurn=(state,{message,response,now,activeContext,inputModality='voice',responseMode='audio',objective})=>advanceConversationState(state,{
 message,
 response,
 now,
 client,
 activeContext,
 inputModality,
 responseMode,
 conversationMode:true,
 objective,
 scope:{...scope,activeContext,now}
})

const completedAssistantTurn=(payload,state,responseId)=>{
 const domain=state.current_domain||'GENERAL'
 const contextScope={tenant_id:scope.tenantId,owner_id:scope.ownerId,producer_id:client.id,conversation_id:scope.conversationId,context_epoch:state.context_epoch,domain}
 const sessionContext={tenant_id:scope.tenantId,owner_id:scope.ownerId,conversation_id:scope.conversationId,context_epoch:state.context_epoch,current_domain:domain,current_client:{id:client.id}}
 const reasoning=payload?.advice?.ai_reasoning||{}
 return {
  role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',responseId,
  tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId,producerId:client.id,contextEpoch:state.context_epoch,domain,
  payload:{
   ...payload,
   responseScope:{contractVersion:'val.response_scope.v1',tenantId:scope.tenantId,ownerId:scope.ownerId,producerId:client.id,conversationId:scope.conversationId,contextEpoch:state.context_epoch,domain},
   advice:{...payload?.advice,ai_reasoning:{...reasoning,organization:{id:scope.tenantId},client:{id:client.id,name:client.name},conversation_id:scope.conversationId,premises:{...(reasoning.premises||{}),context_scope:contextScope,session_context:sessionContext},decision_interview:{...(reasoning.decision_interview||{}),session_context:{conversation_id:scope.conversationId,context_epoch:state.context_epoch}}}}
  }
 }
}

function runGolden001(){
 const trace=[]
 const clientIds=[]
 let state=createConversationState({...scope,activeContext:visit,now:'2026-08-28T12:00:00.000Z'})
 const advance=(input,response,now)=>{
  state=stateTurn(state,{message:input,response,now,activeContext:visit})
  clientIds.push(state.current_client?.id)
  trace.push(Object.freeze({input,topic:state.current_topic,client_id:state.current_client?.id,turns:state.conversation_turns.length}))
 }

 advance('VAL, amanhã vou no Antônio para falar de nutrição e preço.',assistantResponse({
  reading:'Certo. A visita com Antônio está ativa nesta conversa. Qual decisão você quer preparar?',
  action:'Confirmar o objetivo material da visita.',
  questions:['Qual decisão você quer preparar?']
 }),'2026-08-28T12:00:01.000Z')

 advance('Não é mais inseticida. Agora é nutrição, e a decisão de preço continua.',assistantResponse({
  reading:'Entendi. Com Antônio, o foco da visita passa a ser nutrição, não inseticida.',
  action:'Tratar nutrição como o objetivo atual.',
  facts:[{statement:'O foco informado para a visita mudou de inseticida para nutrição.',source_ref:'voice-golden-turn-002'}]
 }),'2026-08-28T12:00:02.000Z')

 advance('Ele comentou preço de novo na conversa de nutrição.',assistantResponse({
  reading:'Certo. Antônio voltou a falar de preço; isso entra como sinal comercial, sem apagar o foco em nutrição.',
  action:'Quantificar a sensibilidade a preço.',
  facts:[{statement:'Antônio comentou preço novamente na conversa sobre nutrição.',source_ref:'voice-golden-turn-003'}]
 }),'2026-08-28T12:00:03.000Z')

 const missingQuestion='Qual faixa de investimento Antônio considera viável para começar?'
 advance('Que informação de nutrição e preço tá faltando?',assistantResponse({
  reading:`Só preciso confirmar uma coisa: ${missingQuestion}`,
  action:'Confirmar a faixa de investimento.',
  questions:[missingQuestion]
 }),'2026-08-28T12:00:04.000Z')

 const goldenQuestions=[
  'Qual resultado na nutrição faria esse investimento valer a pena para você?',
  'Em qual área você prefere começar para reduzir o risco?',
  'Quem precisa participar da decisão antes de avançarmos?'
 ]
 const thesis='Antônio tende a avançar em nutrição se o início couber na faixa de investimento e reduzir o risco.'
 const thesisResponse=assistantResponse({
  reading:'Entendi. Com Antônio focado em nutrição e sensível a preço, a tese é começar pela área prioritária dentro do orçamento.',
  action:'Usar as três perguntas para validar valor, área inicial e decisores.',
  facts:[{statement:'A faixa inicial informada é de até R$ 20 mil.',source_ref:'voice-golden-turn-005'}],
  goldenQuestions,
  thesis,
  uncertainty:'A área inicial e os participantes da decisão ainda precisam ser confirmados.'
 })
 advance('Para nutrição, ele aceita começar com preço e investimento de até vinte mil reais.',thesisResponse,'2026-08-28T12:00:05.000Z')

 const goldenCommand=resolveValNaturalCommand('Agora me manda só as três perguntas de ouro.')
 const completedThesis=completedAssistantTurn(thesisResponse,state,'voice-golden-thesis-001')
 const goldenTurn=localNaturalCommandTurn(goldenCommand,completedThesis,{tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId,producerId:client.id,contextEpoch:state.context_epoch,domain:state.current_domain||'GENERAL'})
 const questionLines=String(goldenTurn?.text||'').split('\n').filter(Boolean)
 trace.push(Object.freeze({input:'Agora me manda só as três perguntas de ouro.',command:goldenCommand?.action,output:'text',question_count:questionLines.length}))

 const audioCommand=resolveValNaturalCommand('Agora fala elas pra mim.')
 const spokenQuestions=responseTextFromConversationTurn({speakableText:goldenTurn?.text})
 let voice=createRealtimeConversationState()
 const voiceTrace=[]
 const applyVoice=(type,extra={})=>{
  voice=transitionRealtimeConversation(voice,{type,...extra})
  voiceTrace.push(voice.status)
 }
 applyVoice(VOICE_EVENTS.OPT_IN,{inputSupported:true,outputSupported:true})
 applyVoice(VOICE_EVENTS.INPUT_STARTED)
 applyVoice(VOICE_EVENTS.TURN_DETECTED,{reason:'FINAL_RESULT'})
 applyVoice(VOICE_EVENTS.PROCESS)
 applyVoice(VOICE_EVENTS.SPEECH_STARTED)
 applyVoice(VOICE_EVENTS.SPEECH_ENDED)
 trace.push(Object.freeze({input:'Agora fala elas pra mim.',command:audioCommand?.action,output:'audio',voice_states:voiceTrace}))

 const registerCommand=resolveValNaturalCommand('Registra que o filho vai participar.')
 const registerTurn=localNaturalCommandTurn(registerCommand,state)
 trace.push(Object.freeze({input:'Registra que o filho vai participar.',command:registerCommand?.action,persistence:registerCommand?.persistence,assistant:registerTurn?.text}))

 const naturalness=evaluateConversationalNaturalness({
  user_message:'Para nutrição, ele aceita começar com preço e investimento de até vinte mil reais.',
  assistant_response:thesisResponse.advice.ai_reasoning.recommended_strategy.reading,
  prior_turns:state.conversation_turns.slice(-6,-2).map(turn=>({role:turn.role,content:turn.text})),
  active_context:{client:'Antônio',topic:'nutrição'},
  context_refs:['Antônio','nutrição','preço'],
  context:{references_resolved:true,tenant_id:'tenant-golden',response_tenant_id:'tenant-golden'},
  interaction:{response_mode:'voice',follow_up_needed:false},
  persistence:{performed:false,confirmed:false},
  safety:{boundary_respected:true}
 })

 const checks=[
  check('G001.CONTEXT.CLIENT',clientIds.length===5&&clientIds.every(id=>id===client.id),client.id,[...clientIds]),
  check('G001.CONTEXT.TOPIC_UPDATE',state.current_topic==='nutrição','nutrição',state.current_topic),
  check('G001.CONTEXT.PRICE_SIGNAL',state.session_facts.some(item=>/preço novamente/i.test(item.statement)),'price signal retained',state.session_facts.map(item=>item.statement)),
  check('G001.INTERVIEW.MINIMUM_ONLY',state.recent_questions.filter(question=>(question?.question??question)===missingQuestion).length===1,'one material follow-up',state.recent_questions),
  check('G001.THESIS.UPDATED',state.current_decision_thesis?.thesis===thesis,thesis,state.current_decision_thesis),
  check('G001.GOLDEN.EXACT_COMMAND',goldenCommand?.action==='GOLDEN_QUESTIONS_ONLY'&&goldenCommand?.local===true,'GOLDEN_QUESTIONS_ONLY local',goldenCommand),
  check('G001.GOLDEN.THREE_TEXT',questionLines.length===3&&goldenCommand?.outputMode===undefined,'three text questions',questionLines),
  check('G001.GOLDEN.SAME_AUDIO',audioCommand?.outputMode==='audio'&&spokenQuestions===goldenTurn?.text&&spokenQuestions.length>0,'same three questions selected for audio',spokenQuestions),
  check('G001.VOICE.STATE_MACHINE',voiceTrace.includes(VOICE_STATES.PROCESSING)&&voiceTrace.includes(VOICE_STATES.SPEAKING)&&voice.status===VOICE_STATES.LISTENING,'PROCESSING -> SPEAKING -> LISTENING',voiceTrace),
  check('G001.REGISTER.CONFIRMATION',registerCommand?.persistence==='CONFIRM_REQUIRED'&&/Nada será registrado sem sua confirmação/i.test(registerTurn?.text||''),'confirmation required before persistence',{command:registerCommand,turn:registerTurn}),
  check('G001.MEMORY.NONE',state.persistence_mode==='NONE'&&state.persistent_memory_unchanged===true,'session-only state',{persistence_mode:state.persistence_mode,persistent_memory_unchanged:state.persistent_memory_unchanged}),
  check('G001.NATURALNESS.AUTOMATED',naturalness.passed&&['NATURAL','VERY_NATURAL'].includes(naturalness.label),'NATURAL or VERY_NATURAL',naturalness)
 ]
 return scenarioResult('VOICE_CONVERSATION_GOLDEN_001',checks,trace,{naturalness,final_state:conversationStateContext(state)})
}

async function runGolden002(){
 const trace=[]
 let state=createConversationState({...scope,activeContext:field,now:'2026-08-28T13:00:00.000Z'})
 state=stateTurn(state,{
  message:'No Talhão Norte, o Antônio quer reduzir risco sem estourar o preço.',
  response:assistantResponse({
   reading:'Entendi. No Talhão Norte, a conversa com Antônio precisa ligar risco agronômico e impacto no preço.',
   facts:[{statement:'Antônio quer reduzir o risco no Talhão Norte sem elevar demais o preço.',source_ref:'voice-golden-turn-101'}]
  }),
  now:'2026-08-28T13:00:01.000Z',
  activeContext:field
 })
 trace.push(Object.freeze({input:'conversa sobre talhão',client_id:state.current_client?.id,field_id:state.current_field?.id}))

 const photoMessage='VAL, analisa esta foto do Talhão Norte e o impacto dela na conversa de preço.'
 const route=routeSystemCapability({message:photoMessage,hasClient:true,attachmentTypes:['image/jpeg'],activeContext:field})
 const capabilityContext={
  client,
  properties:[{id:'property-good-view',producer_id:client.id,tenant_id:scope.tenantId,context_owner_id:scope.ownerId,name:'Fazenda Boa Vista',fields:[{id:field.id,name:field.label}]}]
 }
 const attachment={
  id:'photo-field-north',
  producer_id:client.id,
  tenant_id:scope.tenantId,
  context_owner_id:scope.ownerId,
  mimeType:'image/jpeg',
  analysis:{summary:'A foto mostra lesões foliares localizadas; a causa permanece uma hipótese para validação em campo.',diagnosticStatus:'assisted_triage_not_prescription'}
 }
 const execution=await executeCapabilityPlan({route,message:photoMessage,clientId:client.id,tenantId:scope.tenantId,ownerId:scope.ownerId,context:capabilityContext,attachments:[attachment],activeContext:field})
 const photoResponse=assistantResponse({
  reading:execution.tool_result?.summary,
  action:'Validar a hipótese em campo antes de decidir.',
  execution
 })
 state=stateTurn(state,{message:photoMessage,response:photoResponse,now:'2026-08-28T13:00:02.000Z',activeContext:field,inputModality:'photo'})
 trace.push(Object.freeze({input:'foto',path:route.path,capabilities:route.capabilities,status:execution.tool_result?.status,source_ref:execution.capability_results.find(item=>item.capability==='IMAGE_DIAGNOSIS')?.source_ref||null}))

 const followUp='E isso muda a conversa com o produtor?'
 const beforeCross=conversationStateContext(state)
 const prepared=prepareConversationThread({conversationState:state,priorRecommendations:[]},followUp)
 const followRoute=routeSystemCapability({message:followUp,hasClient:true,activeContext:field})
 const crossReading='Certo. Isso muda a conversa: a foto do Talhão Norte traz uma triagem técnica de lesões foliares, enquanto Antônio mostrou sensibilidade a preço. Apresente a observação como hipótese a validar no campo e conecte o próximo passo ao impacto econômico, sem tratar a imagem como diagnóstico.'
 const crossThesis='Cruzar a triagem técnica do Talhão Norte com a sensibilidade comercial de Antônio, sem converter a foto em diagnóstico.'
 const crossResponse=assistantResponse({
  reading:crossReading,
  action:'Validar a observação no campo e quantificar o impacto antes de propor uma solução.',
  facts:[{statement:'A conversa deve cruzar a triagem técnica com o contexto comercial confirmado nesta sessão.',source_ref:'voice-golden-turn-103'}],
  thesis:crossThesis,
  uncertainty:'A causa das lesões e o impacto econômico ainda não foram confirmados.'
 })
 state=stateTurn(state,{message:followUp,response:crossResponse,now:'2026-08-28T13:00:03.000Z',activeContext:field})
 trace.push(Object.freeze({input:followUp,continued:prepared.continued,path:followRoute.path,capabilities:followRoute.capabilities}))

 const naturalness=evaluateConversationalNaturalness({
  user_message:followUp,
  assistant_response:crossReading,
  prior_turns:state.conversation_turns.slice(-6,-2).map(turn=>({role:turn.role,content:turn.text})),
  active_context:{client:'Antônio',field:'Talhão Norte'},
  context_refs:['Antônio','Talhão Norte','preço','lesões foliares'],
  context:{references_resolved:true,tenant_id:'tenant-golden',response_tenant_id:'tenant-golden'},
  interaction:{response_mode:'voice',follow_up_needed:false},
  persistence:{performed:false,confirmed:false},
  safety:{boundary_respected:true}
 })

 const checks=[
  check('G002.PHOTO.ROUTE',route.path==='TOOL'&&route.capabilities.includes('IMAGE_DIAGNOSIS'),'TOOL + IMAGE_DIAGNOSIS',{path:route.path,capabilities:route.capabilities}),
  check('G002.PHOTO.EXECUTION',execution.tool_result?.status==='EXECUTED'&&execution.reasoning_required===true,'EXECUTED with governed reasoning',{status:execution.tool_result?.status,reasoning_required:execution.reasoning_required}),
  check('G002.PHOTO.SAFETY',execution.tool_result?.human_review_required===true&&/hipótese|não constitui diagnóstico/i.test(execution.tool_result?.summary||''),'human review and non-diagnostic framing',execution.tool_result),
  check('G002.STATE.TECHNICAL_RESULT',beforeCross.recent_tool_results.some(item=>item.capability==='IMAGE_DIAGNOSIS'&&item.status==='EXECUTED'),'technical tool result retained',beforeCross.recent_tool_results),
  check('G002.STATE.COMMERCIAL_CONTEXT',beforeCross.session_facts.some(item=>/preço/i.test(item.statement)),'commercial price context retained',beforeCross.session_facts),
  check('G002.REFERENCE.CONTINUITY',messageNeedsSessionReference(followUp)&&prepared.continued&&/Antônio|Talhão Norte/.test(prepared.message),'follow-up resolved in same client and field',prepared),
  check('G002.FOLLOW_UP.ROUTE',followRoute.materiality?.engine_required===true&&followRoute.capabilities.includes('COMMERCIAL_HISTORY'),'contextual reasoning with commercial history',{path:followRoute.path,capabilities:followRoute.capabilities,materiality:followRoute.materiality}),
  check('G002.CROSS.RESULT',/lesões foliares/i.test(crossReading)&&/preço/i.test(crossReading)&&state.current_decision_thesis?.thesis===crossThesis,'technical + commercial synthesis',{reading:crossReading,thesis:state.current_decision_thesis?.thesis}),
  check('G002.CONTEXT.SCOPE',state.current_client?.id===client.id&&state.current_field?.id===field.id,'same authorized client and field',{client:state.current_client,field:state.current_field}),
  check('G002.MEMORY.NONE',state.persistence_mode==='NONE'&&state.persistent_memory_unchanged===true,'session-only state',{persistence_mode:state.persistence_mode,persistent_memory_unchanged:state.persistent_memory_unchanged}),
  check('G002.NATURALNESS.AUTOMATED',naturalness.passed&&['NATURAL','VERY_NATURAL'].includes(naturalness.label),'NATURAL or VERY_NATURAL',naturalness)
 ]
 return scenarioResult('VOICE_CONVERSATION_GOLDEN_002',checks,trace,{naturalness,final_state:conversationStateContext(state)})
}

export async function runVoiceConversationGoldenSet(){
 const scenarios=Object.freeze([runGolden001(),await runGolden002()])
 return Object.freeze({
  contract_version:voiceConversationGoldenVersion,
  evidence_class:'DETERMINISTIC_AUTOMATED_CONTRACT',
  physical_uat:'NOT_EXECUTED',
  generated_at:'2026-08-28T00:00:00.000Z',
  status:scenarios.every(item=>item.status==='PASS_AUTOMATED_CONTRACT')?'PASS_AUTOMATED_CONTRACT':'FAIL_AUTOMATED_CONTRACT',
  scenarios
 })
}
