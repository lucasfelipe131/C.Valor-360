import {createHash,randomUUID} from 'node:crypto'
import {buildRealtimeValContext,buildRealtimeValInstructions,realtimeValTools} from './context.js'
import {estimateRealtimeTranscriptionCost,estimateRealtimeVoiceCost,REALTIME_VOICE_MODEL} from './cost-control.js'

const voiceError=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const clean=(value,max=180)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
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
  status:()=>({enabled,model,budgetUsd,maxSessionSeconds,transport:'WEBRTC',fallback:'PUSH_TO_TALK',testersConfigured:Boolean(runtimeConfig?.realtimeVoiceTesters?.length)}),
  async createSession({identity,input={},requestId}={}){
   assertAccess(identity)
   const sessionId=randomUUID();const tenantId=String(identity.tenantId);const ownerId=String(identity.id);const clientId=clean(input.clientId);const conversationId=clean(input.conversationId)||randomUUID();const activeContext=input.activeContext&&typeof input.activeContext==='object'?input.activeContext:null
   let context={client:null};let conversationState={conversation_id:conversationId}
   if(clientId){context=await repository.getClientContext({tenantId,ownerId,clientId,client:{id:clientId},contextRequest:{requestId,objective:'realtime_voice_session',actorRole:identity.role||'consultant',conversationId}});conversationState=conversationSessions.ensure({tenantId,ownerId,conversationId,clientId,client:{id:clientId,name:context.client?.name},activeContext})}
   else conversationState=conversationSessions.ensure({tenantId,ownerId,conversationId,clientId:'',client:null,activeContext:null})
   const budget=await costStore.reserve({sessionId,userId:ownerId,reservationUsd,budgetUsd,model})
   if(!budget.reserved)throw voiceError('O teto de US$ 25 do UAT realtime foi atingido. Novas sessões estão bloqueadas.','realtime_voice_budget_exhausted',402)
   const realtimeContext=buildRealtimeValContext({context,conversationState,activeContext})
   const safetyIdentifier=createHash('sha256').update(`${tenantId}:${ownerId}`).digest('hex')
   let secret
   try{
    secret=await client.realtime.clientSecrets.create({expires_after:{anchor:'created_at',seconds:30},session:{type:'realtime',model,output_modalities:['audio'],instructions:buildRealtimeValInstructions({context:realtimeContext,model}),max_output_tokens:512,tool_choice:'auto',tools:realtimeValTools,tracing:null,audio:{input:{noise_reduction:{type:'near_field'},transcription:{model:runtimeConfig.voiceTranscriptionModel||'gpt-transcribe',language:'pt'},turn_detection:{type:'semantic_vad',eagerness:'auto',create_response:true,interrupt_response:true}},output:{voice:'marin',speed:1.05}}}},{headers:{'OpenAI-Safety-Identifier':safetyIdentifier}})
   }catch(error){await costStore.record({sessionId,userId:ownerId,responseId:`failed:${sessionId}`,costUsd:0,final:true,budgetUsd,model,usage:{}}).catch(()=>null);throw voiceError('Não foi possível abrir a sessão realtime. Use apertar para falar.','realtime_voice_session_failed',502)}
   sessions.set(sessionId,{tenantId,ownerId,clientId,conversationId,client:context.client||null,activeContext,expiresAt:Date.now()+maxSessionSeconds*1000+60_000})
   logger({event:'val.realtime_voice.session_created',sessionId,tenantId,ownerId,model,requestId,clientScoped:Boolean(clientId)})
   return {contractVersion:'val.realtime_voice.session.v1',sessionId,clientSecret:secret.value,expiresAt:secret.expires_at,providerSessionId:secret.session?.id||null,model,transport:'WEBRTC',callUrl:'https://api.openai.com/v1/realtime/calls',maxSessionSeconds,budget:{limitUsd:budgetUsd,remainingUsd:budget.remainingUsd,reservationUsd},context:{conversationId,clientId:clientId||null,persistenceMode:'NONE'},capabilities:{vad:'SEMANTIC_VAD',bargeIn:true,streamingAudio:true,tools:'GOVERNED',memory:'CONFIRM_REQUIRED'}}
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
   assertAccess(identity);const session=activeSession(identity,sessionId);if(session.finalized)throw voiceError('A sessão realtime já foi encerrada.','realtime_voice_session_finalized',409);const userTranscript=clean(input.userTranscript,3000);const assistantTranscript=clean(input.assistantTranscript,3000)
   if(!userTranscript||!assistantTranscript)throw voiceError('O turno realtime precisa de entrada e resposta concluídas.','realtime_voice_turn_incomplete',400)
   const response={advice:{answer:assistantTranscript,ai_reasoning:{intent:'REALTIME_CONVERSATION',recommended_strategy:{reading:assistantTranscript}}}}
   const state=conversationSessions.advance({tenantId:session.tenantId,ownerId:session.ownerId,conversationId:session.conversationId,clientId:session.clientId,client:session.client,activeContext:session.activeContext},{message:userTranscript,response,inputModality:'voice',responseMode:'audio',conversationMode:true,intent:'REALTIME_CONVERSATION',client:session.client,activeContext:session.activeContext})
   logger({event:'val.realtime_voice.turn_recorded',sessionId,tenantId:identity.tenantId,ownerId:identity.id,model})
   return {contractVersion:'val.realtime_voice.turn.v1',accepted:true,persistenceMode:'NONE',persistentMemoryUnchanged:true,conversationId:state.conversation_id,turnCount:state.conversation_turns.length,contentFreeAudit:true}
  },
  async budget({identity}={}){assertAccess(identity);return {contractVersion:'val.realtime_voice.cost.v1',model,budgetUsd,...await costStore.snapshot({budgetUsd}),contentFree:true}}
 })
}
