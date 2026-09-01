import {createHash,randomUUID} from 'node:crypto'
import {validateActiveContext} from '../decision-copilot/capability-executor.js'
import {valContextDomains,valContextSelectorVersion} from '../decision-copilot/context-selector.js'
import {buildRealtimeValContext,buildRealtimeValInstructions,realtimeValTools} from './context.js'
import {estimateRealtimeTranscriptionCost,estimateRealtimeVoiceCost,REALTIME_VOICE_MODEL} from './cost-control.js'

const voiceError=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const clean=(value,max=180)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0
const domainOf=value=>{const domain=clean(value,40).toUpperCase();return valContextDomains.includes(domain)?domain:'GENERAL'}
const producerIdOf=value=>clean(value?.producer_id??value?.producerId??value?.subject_client_id??value?.subjectClientId??value?.client_id??value?.clientId??value?.current_client?.id,180)
const producerCollections=['recent_clients','session_facts','session_hypotheses','recent_tool_results','recent_questions','conversation_turns']
const hasProducerContext=state=>Boolean(
 producerIdOf(state)||
 producerCollections.some(key=>Array.isArray(state?.[key])&&state[key].some(item=>producerIdOf(item)||(key==='recent_clients'&&clean(item?.id))||Array.isArray(item?.subject_client_ids)&&item.subject_client_ids.some(Boolean)))||
 producerIdOf(state?.current_decision_thesis)||
 ['current_property','current_field','current_opportunity','current_visit'].some(key=>state?.[key]?.id)||
 state?.active_object&&state.active_object.type!=='agronomic_tool'
)

const minimumContextQuery=domain=>({
 PROFILE:'perfil comportamental com evidência observável',COMMERCIAL:'contexto comercial pertinente',AGRONOMY:'contexto agronômico pertinente',GRAINS:'contexto de grãos pertinente',CREDIT:'contexto de crédito pertinente',GEO:'mapa e contexto geográfico pertinente',VISIT:'contexto de visita pertinente',OPPORTUNITY:'contexto de oportunidade pertinente',MULTI_DOMAIN:'perfil comportamental e contexto comercial pertinentes',GENERAL:'identidade cadastral do produtor ativo'
}[domain]||'identidade cadastral do produtor ativo')

function assertConversationScope(state,{tenantId,ownerId,conversationId,clientId=''}){
 if(clean(state?.tenant_id)!==tenantId||clean(state?.owner_id)!==ownerId||clean(state?.conversation_id)!==conversationId||!exactEpoch(state?.context_epoch))throw voiceError('A conversa realtime não possui escopo verificável.','realtime_voice_conversation_scope_invalid',409)
 const storedClientId=clean(state?.current_client?.id)
 if(clientId&&storedClientId!==clientId)throw voiceError('A conversa realtime não pertence ao produtor solicitado.','realtime_voice_conversation_client_mismatch',409)
 return state
}

function assertSelectedContext(context,{tenantId,ownerId,clientId,conversationId,contextEpoch,contextDomain}){
 const resolvedClientId=clean(context?.client?.id)
 const snapshot=context?.contextSnapshot||context?.context_snapshot
 const scope=snapshot?.context_scope
 if(!resolvedClientId||resolvedClientId!==clientId)throw voiceError('O contexto realtime não confirmou o produtor solicitado.','realtime_voice_context_producer_mismatch',409)
 if(!snapshot||!scope||clean(snapshot.contract_version)!=='val.context_snapshot.v1'||!clean(snapshot.context_snapshot_id)||clean(snapshot.objective)!=='realtime_voice_minimum_context'||!/^[0-9a-f]{64}$/i.test(clean(scope.query_fingerprint))||scope.minimum_sufficient_context!==true||clean(scope.selector_version)!==valContextSelectorVersion)throw voiceError('O seletor de contexto mínimo não confirmou esta sessão realtime.','realtime_voice_context_selector_required',409)
 const explicitDomain=clean(scope.domain,40).toUpperCase()
 const valid=clean(snapshot.organization_id)===tenantId&&clean(snapshot.subject?.type).toLowerCase()==='client'&&clean(snapshot.subject?.id)===clientId&&clean(scope.tenant_id)===tenantId&&clean(scope.owner_id)===ownerId&&clean(scope.producer_id)===clientId&&clean(scope.conversation_id)===conversationId&&exactEpoch(scope.context_epoch)&&scope.context_epoch===contextEpoch&&valContextDomains.includes(explicitDomain)&&explicitDomain===contextDomain
 if(!valid)throw voiceError('O contexto selecionado não pertence ao tenant, owner, produtor, conversa, epoch e domínio atuais.','realtime_voice_context_scope_invalid',409)
 return snapshot
}
const allowedIdentity=(identity,testers)=>{
 const values=new Set((Array.isArray(testers)?testers:[]).map(value=>clean(value).toLocaleLowerCase('pt-BR')).filter(Boolean))
 if(!values.size)return identity?.role==='admin'
 return values.has(clean(identity?.id).toLocaleLowerCase('pt-BR'))||values.has(clean(identity?.email).toLocaleLowerCase('pt-BR'))
}

export function createRealtimeVoiceService({runtimeConfig,client,repository,conversationSessions,costStore,logger=()=>{}}={}){
 const model=REALTIME_VOICE_MODEL
 const budgetUsd=Math.min(25,Math.max(1,Number(runtimeConfig?.realtimeVoiceBudgetUsd)||25))
 const reservationUsd=Math.min(2,Math.max(.25,Number(runtimeConfig?.realtimeVoiceReservationUsd)||1))
 const maxSessionSeconds=Math.min(600,Math.max(60,Number(runtimeConfig?.realtimeVoiceMaxSessionSeconds)||600))
 const vadEagerness=['low','medium','high','auto'].includes(String(runtimeConfig?.realtimeVoiceVadEagerness))?String(runtimeConfig.realtimeVoiceVadEagerness):'low'
 const enabled=Boolean(runtimeConfig?.realtimeVoiceEnabled&&client&&costStore)
 const sessions=new Map()
 const activeSession=(identity,sessionId)=>{const session=sessions.get(String(sessionId));if(!session||session.expiresAt<=Date.now()){sessions.delete(String(sessionId));throw voiceError('A sessão realtime expirou.','realtime_voice_session_expired',410)}if(session.tenantId!==String(identity?.tenantId)||session.ownerId!==String(identity?.id))throw voiceError('A sessão realtime não pertence ao usuário autenticado.','realtime_voice_session_scope_denied',404);return session}
 const assertAccess=identity=>{
  if(!runtimeConfig?.realtimeVoiceEnabled)throw voiceError('O modo conversa realtime não está habilitado neste ambiente.','realtime_voice_disabled',503)
  if(!client)throw voiceError('O provider realtime não está configurado.','realtime_voice_provider_unavailable',503)
  if(!costStore)throw voiceError('O controle persistente de custo não está disponível.','realtime_voice_cost_control_unavailable',503)
  if(!identity?.id||!identity?.tenantId)throw voiceError('Sessão autenticada obrigatória.','realtime_voice_auth_required',401)
  if(!allowedIdentity(identity,runtimeConfig?.realtimeVoiceTesters))throw voiceError('Este usuário não está autorizado para o UAT realtime.','realtime_voice_tester_not_allowed',403)
 }
 return Object.freeze({
  status:()=>({enabled,model,budgetUsd,maxSessionSeconds,transport:'WEBRTC',fallback:'PUSH_TO_TALK',vad:{type:'SEMANTIC_VAD',eagerness:vadEagerness},testersConfigured:Boolean(runtimeConfig?.realtimeVoiceTesters?.length)}),
  async createSession({identity,input={},requestId}={}){
   assertAccess(identity)
   const sessionId=randomUUID();const tenantId=String(identity.tenantId);const ownerId=String(identity.id);const clientId=clean(input.clientId);const conversationId=clean(input.conversationId)||randomUUID()
   const requestedActiveContext=input.activeContext&&typeof input.activeContext==='object'&&!Array.isArray(input.activeContext)?input.activeContext:null
   let context={client:null};let activeContext=null
   const baseScope={tenantId,ownerId,conversationId,clientId,client:clientId?{id:clientId}:null,activeContext:null}
   const conversationState=assertConversationScope(conversationSessions.ensure(baseScope),{tenantId,ownerId,conversationId,clientId})
   if(!clientId&&hasProducerContext(conversationState))throw voiceError('Selecione explicitamente o produtor desta conversa antes de abrir o modo realtime.','realtime_voice_client_selection_required',409)
   const contextEpoch=conversationState.context_epoch
   if(Object.prototype.hasOwnProperty.call(input,'contextEpoch')&&(!exactEpoch(input.contextEpoch)||input.contextEpoch!==contextEpoch))throw voiceError('O epoch solicitado não pertence à conversa realtime atual.','realtime_voice_context_epoch_mismatch',409)
   const contextDomain=domainOf(conversationState.current_domain)
   const activeContextCandidate=requestedActiveContext??conversationState.active_object??null
   if(clientId){
    context=await repository.getClientContext({tenantId,ownerId,clientId,client:{id:clientId},contextRequest:{requestId,objective:'realtime_voice_minimum_context',message:minimumContextQuery(contextDomain),intent:'REALTIME_CONVERSATION',actorRole:identity.role||'consultant',conversationId,contextEpoch,contextDomain}})
    assertSelectedContext(context,{tenantId,ownerId,clientId,conversationId,contextEpoch,contextDomain})
    activeContext=activeContextCandidate?validateActiveContext({activeContext:activeContextCandidate,context,clientId}):null
   }else activeContext=activeContextCandidate?validateActiveContext({activeContext:activeContextCandidate,context:{},clientId:''}):null
   const budget=await costStore.reserve({sessionId,userId:ownerId,reservationUsd,budgetUsd,model})
   if(!budget.reserved)throw voiceError('O teto de US$ 25 do UAT realtime foi atingido. Novas sessões estão bloqueadas.','realtime_voice_budget_exhausted',402)
   const realtimeContext=buildRealtimeValContext({context,conversationState,activeContext})
   const safetyIdentifier=createHash('sha256').update(`${tenantId}:${ownerId}`).digest('hex')
   let secret
   try{
    secret=await client.realtime.clientSecrets.create({expires_after:{anchor:'created_at',seconds:30},session:{type:'realtime',model,output_modalities:['audio'],instructions:buildRealtimeValInstructions({context:realtimeContext,model}),max_output_tokens:512,tool_choice:'auto',tools:realtimeValTools,tracing:null,audio:{input:{noise_reduction:{type:'far_field'},transcription:{model:runtimeConfig.voiceTranscriptionModel||'gpt-transcribe',language:'pt'},turn_detection:{type:'semantic_vad',eagerness:vadEagerness,create_response:true,interrupt_response:true}},output:{voice:'marin',speed:1.05}}}},{headers:{'OpenAI-Safety-Identifier':safetyIdentifier}})
   }catch(error){await costStore.record({sessionId,userId:ownerId,responseId:`failed:${sessionId}`,costUsd:0,final:true,budgetUsd,model,usage:{}}).catch(()=>null);throw voiceError('Não foi possível abrir a sessão realtime. Use apertar para falar.','realtime_voice_session_failed',502)}
   sessions.set(sessionId,{tenantId,ownerId,clientId,conversationId,contextEpoch,contextDomain,client:context.client||null,activeContext,scopeChanged:false,expiresAt:Date.now()+maxSessionSeconds*1000+60_000})
   logger({event:'val.realtime_voice.session_created',sessionId,tenantId,ownerId,model,requestId,clientScoped:Boolean(clientId)})
   return {contractVersion:'val.realtime_voice.session.v1',sessionId,clientSecret:secret.value,expiresAt:secret.expires_at,providerSessionId:secret.session?.id||null,model,transport:'WEBRTC',callUrl:'https://api.openai.com/v1/realtime/calls',maxSessionSeconds,budget:{limitUsd:budgetUsd,remainingUsd:budget.remainingUsd,reservationUsd},context:{conversationId,clientId:clientId||null,contextEpoch,contextDomain,persistenceMode:'NONE'},capabilities:{vad:'SEMANTIC_VAD',vadEagerness,bargeIn:true,streamingAudio:true,tools:'GOVERNED',memory:'CONFIRM_REQUIRED'}}
  },
  async recordUsage({identity,sessionId,input={}}={}){
   assertAccess(identity);if(!/^[0-9a-f-]{36}$/i.test(String(sessionId||'')))throw voiceError('Sessão realtime inválida.','realtime_voice_session_invalid',400);activeSession(identity,sessionId)
   const estimated=input.kind==='TRANSCRIPTION'?estimateRealtimeTranscriptionCost(input.usage||{}):estimateRealtimeVoiceCost(input.usage||{})
   const result=await costStore.record({sessionId,userId:identity.id,responseId:clean(input.responseId,180)||null,costUsd:estimated.estimatedCostUsd,final:input.final===true,budgetUsd,model,usage:estimated.tokens})
   logger({event:'val.realtime_voice.usage_recorded',sessionId,tenantId:identity.tenantId,ownerId:identity.id,model,costUsd:estimated.estimatedCostUsd,final:input.final===true})
   if(input.final===true){const session=sessions.get(String(sessionId));if(session)sessions.set(String(sessionId),{...session,finalized:true,expiresAt:Date.now()+5*60_000})}
   return {contractVersion:'val.realtime_voice.cost.v1',accepted:result.recorded||result.duplicate===true,duplicate:Boolean(result.duplicate),model,sessionId,estimatedCostUsd:estimated.estimatedCostUsd,totalEstimatedUsd:result.totalUsd,remainingUsd:result.remainingUsd,budgetUsd,exhausted:result.exhausted,contentFree:true}
  },
  async recordTurn({identity,sessionId,input={}}={}){
   assertAccess(identity);const session=activeSession(identity,sessionId);if(session.finalized)throw voiceError('A sessão realtime já foi encerrada.','realtime_voice_session_finalized',409);if(session.scopeChanged)throw voiceError('O epoch ou domínio da conversa mudou. Reabra a sessão realtime para obter um contexto mínimo novo.','realtime_voice_context_scope_changed',409);const userTranscript=clean(input.userTranscript,3000);const assistantTranscript=clean(input.assistantTranscript,3000)
   if(!userTranscript||!assistantTranscript)throw voiceError('O turno realtime precisa de entrada e resposta concluídas.','realtime_voice_turn_incomplete',400)
   const turnScope={tenantId:session.tenantId,ownerId:session.ownerId,conversationId:session.conversationId,clientId:session.clientId,client:session.client,activeContext:null,contextEpoch:session.contextEpoch}
   if(!session.clientId&&hasProducerContext(assertConversationScope(conversationSessions.ensure(turnScope),{tenantId:session.tenantId,ownerId:session.ownerId,conversationId:session.conversationId})))throw voiceError('Selecione explicitamente o produtor antes de continuar esta conversa realtime.','realtime_voice_client_selection_required',409)
   // O transcript do assistente chega pelo browser e não comprova grounding no
   // servidor. Ele é aceito apenas para fechar o turno audiovisual; somente a
   // fala do usuário entra no estado. Assim não vira assistant completed nem
   // fonte de um follow-up determinístico.
   // `null` herdaria o active_object anterior; `false` é o sentinela explícito
   // que o normalizador converte em ausência de objeto ao registrar este turno.
   const state=assertConversationScope(conversationSessions.advance(turnScope,{message:userTranscript,inputModality:'voice',responseMode:'audio',conversationMode:true,intent:'REALTIME_CONVERSATION',client:session.client,activeContext:false}),{tenantId:session.tenantId,ownerId:session.ownerId,conversationId:session.conversationId,clientId:session.clientId})
   const scopeChanged=state.context_epoch!==session.contextEpoch||domainOf(state.current_domain)!==session.contextDomain
   if(scopeChanged)sessions.set(String(sessionId),{...session,scopeChanged:true})
   logger({event:'val.realtime_voice.turn_recorded',sessionId,tenantId:identity.tenantId,ownerId:identity.id,model})
   return {contractVersion:'val.realtime_voice.turn.v1',accepted:true,persistenceMode:'NONE',persistentMemoryUnchanged:true,conversationId:state.conversation_id,turnCount:state.conversation_turns.length,assistantGrounding:'UNVERIFIED_BROWSER_TRANSCRIPT',followUpEligible:false,reconnectRequired:scopeChanged,contentFreeAudit:true}
  },
  async budget({identity}={}){assertAccess(identity);return {contractVersion:'val.realtime_voice.cost.v1',model,budgetUsd,...await costStore.snapshot({budgetUsd}),contentFree:true}}
 })
}
