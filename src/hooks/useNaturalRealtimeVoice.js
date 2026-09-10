import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {realtimeRetrySeconds,realtimeRetryDelay,realtimeFailureMessage,realtimeEventSuppressedWhilePaused} from '../lib/realtime-recovery.js'
import {realtimeCompletedTranscript,realtimePartialMessageIds,realtimeTurnFailureMessage,realtimeTurnResponseOptions} from '../lib/realtime-turn-recovery.js'
import {NATURAL_REALTIME_STATES as STATES,NATURAL_REALTIME_VERSION,parseRealtimeEvent,realtimeLatencySample,realtimeStatusLabel,realtimeWebRTCCapabilities,toolOutputEvent} from '../lib/realtime-webrtc.js'

const now=()=>globalThis.performance?.now?.()??Date.now()
const safeText=(value,max=3000)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0?value:null
const requiredEpoch=value=>{
 const epoch=exactEpoch(value)
 if(epoch===null)throw Object.assign(new Error('contextEpoch deve ser um inteiro seguro não negativo.'),{code:'realtime_voice_context_epoch_invalid'})
 return epoch
}
const emptyResources=()=>({pc:null,dc:null,stream:null,audio:null,timer:null,connectionTimer:null,disconnectTimer:null,controller:null,sessionId:'',scopeKey:'',contextEpoch:0,attemptId:null,finalized:false})

export function realtimeVoiceScopeKey({clientId='',conversationId='',contextEpoch=0,activeContext=null}={}){
 return `${String(clientId)}\u001f${String(conversationId)}\u001f${requiredEpoch(contextEpoch)}\u001f${String(activeContext?.type||'')}\u001f${String(activeContext?.id||'')}`
}

/** A provider event is accepted only by the exact session and epoch that opened it. */
export function realtimeVoiceEventMatchesScope(eventScope={},activeScope={},resourceScope={}){
 const eventSession=String(eventScope.sessionId||'')
 const eventKey=String(eventScope.scopeKey||'')
 return Boolean(eventSession&&eventKey&&eventKey===String(activeScope.scopeKey||'')&&eventKey===String(resourceScope.scopeKey||'')&&eventSession===String(resourceScope.sessionId||''))
}

/** A reconnect may start only after cleanup and for the exact currently active scope. */
export function realtimeVoiceReconnectReady(requestScope={},activeScope={},resourceScope={}){
 const requestedKey=String(requestScope.scopeKey||'')
 return Boolean(requestedKey&&!String(resourceScope.scopeKey||'')&&requestedKey===String(activeScope.scopeKey||''))
}

export default function useNaturalRealtimeVoice({clientId='',conversationId='',contextEpoch=0,activeContext=null,disabled=false,onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange,onContextSync}={}){
 const [machine,setMachine]=useState({status:STATES.IDLE,microphoneActive:false,microphonePermission:'UNKNOWN',error:'',fallbackReason:'',sessionId:'',model:'',budgetRemainingUsd:null,retryAfterSeconds:0,interimTranscript:'',assistantTranscript:'',canRetryTurn:false,recoveringTurn:false})
 const [reconnectSequence,setReconnectSequence]=useState(0)
 const machineRef=useRef(machine)
 const retryAt=useRef(0)
 const lifecycle=useRef(0)
 const userPaused=useRef(false)
 const pendingToolResponse=useRef(null)
 const turnSequence=useRef(0),activeTurn=useRef(null),responseTurns=useRef(new Map()),inputTurns=useRef(new Map()),toolCalls=useRef(new Map()),recoverTurnRef=useRef(null),pendingVerifiedResume=useRef(null)
 const resources=useRef(emptyResources())
 const [reconciledScope,setReconciledScope]=useState(null)
 const requestedScopeKey=realtimeVoiceScopeKey({clientId,conversationId,contextEpoch,activeContext})
 const currentEpoch=reconciledScope?.requestedScopeKey===requestedScopeKey?reconciledScope.contextEpoch:requiredEpoch(contextEpoch)
 const scopeKey=realtimeVoiceScopeKey({clientId,conversationId,contextEpoch:currentEpoch,activeContext})
 const activeScopeRef=useRef(null)
 activeScopeRef.current={scopeKey,clientId:String(clientId),producerId:String(clientId),conversationId:String(conversationId),contextEpoch:currentEpoch}
 const scopeKeyRef=useRef(scopeKey),scopeReconnectPending=useRef(null)
 const callbacks=useRef({onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange,onContextSync})
 const marks=useRef(null),pendingUser=useRef(''),assistantBuffers=useRef(new Map()),thinkingWatchdog=useRef(null),pendingReconnect=useRef(null)
 callbacks.current={onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange,onContextSync}
 const capabilities=useMemo(()=>realtimeWebRTCCapabilities(),[])
 const update=useCallback(next=>{const value={...machineRef.current,...(typeof next==='function'?next(machineRef.current):next)};machineRef.current=value;setMachine(value)},[])
 const eventIsCurrent=useCallback(eventScope=>realtimeVoiceEventMatchesScope(eventScope,activeScopeRef.current,resources.current),[])
 const send=useCallback((event,eventScope=null)=>{if(eventScope&&!eventIsCurrent(eventScope))return false;const dc=resources.current.dc;if(dc?.readyState!=='open')return false;try{dc.send(JSON.stringify(event));return true}catch{return false}},[eventIsCurrent])
 const postSession=useCallback(async(path,payload,{keepalive=false,sessionId:explicitSessionId=''}={})=>{
  const sessionId=explicitSessionId||resources.current.sessionId;if(!sessionId)return null
  const response=await fetch(`/api/v1/realtime-voice/sessions/${encodeURIComponent(sessionId)}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive})
  const result=await response.json().catch(()=>null)
  if(!response.ok&&response.status!==402)throw Object.assign(new Error(result?.error||'Falha no controle da sessão realtime.'),{code:result?.code||'realtime_voice_control_failed'})
  return result
 },[])
 const clearThinkingWatchdog=useCallback(()=>{if(thinkingWatchdog.current){globalThis.clearTimeout(thinkingWatchdog.current);thinkingWatchdog.current=null}},[])
 const beginTurn=useCallback((inputItemId='')=>{
  pendingVerifiedResume.current=null
  if(activeTurn.current){activeTurn.current.interrupted=true;activeTurn.current.interruptionReason='NEW_USER_TURN'}
  const turn={id:++turnSequence.current,inputItemId,transcript:'',interrupted:false,completed:false,userPublished:false,reported:false,autoRetries:0,manualRetries:0,pendingTools:0,hasToolResult:false,toolExecutions:new Map(),lastResponse:null,awaitingResponse:false,retryPending:false}
  activeTurn.current=turn;pendingUser.current='';pendingToolResponse.current=null
  if(inputItemId)inputTurns.current.set(inputItemId,turn)
  return turn
 },[])
 const turnIsCurrent=useCallback((turn,eventScope)=>Boolean(turn&&turn===activeTurn.current&&!turn.interrupted&&eventIsCurrent(eventScope)),[eventIsCurrent])
 const responseFor=useCallback((event,{created=false}={})=>{
  const id=String(event.response?.id||event.response_id||'')
  const known=id&&responseTurns.current.get(id)
  if(known)return known.turn===activeTurn.current&&!known.turn.interrupted&&!known.obsolete?known:null
  const turn=activeTurn.current||beginTurn()
  if(turn.interrupted)return null
  const taggedTurn=event.response?.metadata?.val_turn_id
  if(taggedTurn!=null&&String(taggedTurn)!==String(turn.id))return null
  let response=turn.lastResponse
  if(!created&&id&&response?.id&&response.id!==id&&!turn.awaitingResponse)return null
  if(!response||created||turn.awaitingResponse){
   response={id,turn,done:false,status:'',transcript:'',audioStarted:false,audioPlaying:false,hasTool:false,continuationSent:false,committed:false,partialItemIds:new Set()}
   turn.lastResponse=response;turn.awaitingResponse=false
  }else if(id&&!response.id)response.id=id
  if(id)responseTurns.current.set(id,response)
  return response
 },[beginTurn])
 const cleanup=useCallback(async({final=true,reason='EXIT',nextStatus=STATES.IDLE}={})=>{
  lifecycle.current+=1
  clearThinkingWatchdog()
  const current=resources.current
  resources.current=emptyResources()
  current.controller?.abort()
  if(current.connectionTimer)globalThis.clearTimeout(current.connectionTimer)
  if(current.disconnectTimer)globalThis.clearTimeout(current.disconnectTimer)
  if(current.timer)globalThis.clearTimeout(current.timer)
  current.timer=null
  try{current.dc?.close()}catch{}
  try{current.pc?.close()}catch{}
  for(const track of current.stream?.getTracks?.()||[])try{track.stop()}catch{}
  if(current.audio){try{current.audio.pause()}catch{};try{current.audio.srcObject=null;current.audio.remove()}catch{}}
  if(final&&!current.finalized&&current.sessionId){current.finalized=true;postSession('usage',{final:true,disconnectReason:reason},{keepalive:true,sessionId:current.sessionId}).catch(()=>null)}
  pendingReconnect.current=null
  pendingToolResponse.current=null
  if(reason!=='CONTEXT_SCOPE_CHANGED')pendingVerifiedResume.current=null
  if(activeTurn.current){activeTurn.current.interrupted=true;activeTurn.current.interruptionReason=reason}
  activeTurn.current=null;responseTurns.current.clear();inputTurns.current.clear();toolCalls.current.clear()
  marks.current=null;pendingUser.current='';assistantBuffers.current.clear();update({status:nextStatus,microphoneActive:false,sessionId:'',error:'',audioBlocked:false,interimTranscript:'',assistantTranscript:'',canRetryTurn:false,recoveringTurn:false,fallbackReason:nextStatus===STATES.FALLBACK?reason:''})
 },[clearThinkingWatchdog,postSession,update])
 const requestReconnect=useCallback(async(targetScopeKey=activeScopeRef.current.scopeKey)=>{
  const request={scopeKey:String(targetScopeKey||'')}
  scopeReconnectPending.current=request
  await cleanup({final:true,reason:'CONTEXT_SCOPE_CHANGED',nextStatus:userPaused.current?STATES.PAUSED:STATES.CONNECTING})
  if(scopeReconnectPending.current!==request)return false
  setReconnectSequence(current=>current+1)
  return true
 },[cleanup])
 const fail=useCallback(async(error,{fallback=true,eventScope=null}={})=>{
  const code=String(typeof error?.code==='string'&&error.code||error?.name||'realtime_voice_failed')
  const message=realtimeFailureMessage(error)
  if(eventScope&&!eventIsCurrent(eventScope))return {ok:false,reason:'REALTIME_STALE_EVENT',error:message}
  const finishing=cleanup({final:true,reason:code,nextStatus:fallback?STATES.FALLBACK:STATES.ERROR})
  const failureGeneration=lifecycle.current
  await finishing
  if(lifecycle.current!==failureGeneration)return {ok:false,reason:'REALTIME_STALE_EVENT'}
  const delay=Math.max(0,Number(error?.retryAfterSeconds)||0)
  if(delay)retryAt.current=Math.max(retryAt.current,Date.now()+delay*1000)
  update({error:message,fallbackReason:code,retryable:error.canRetry!==false,retryAfterSeconds:realtimeRetrySeconds(retryAt.current)})
  callbacks.current.onError?.(message,{code,retryAfterSeconds:realtimeRetrySeconds(retryAt.current)})
  return {ok:false,reason:code,error:message}
 },[cleanup,eventIsCurrent,update])
 // Sem isto, uma sessão realtime que nunca emite response.done/error após
 // response.created (falha silenciosa do provider) deixa a VAL presa em
 // "pensando" para sempre, sem qualquer forma de recuperação para o usuário.
 const armThinkingWatchdog=useCallback(eventScope=>{
  clearThinkingWatchdog()
  const turn=activeTurn.current
  thinkingWatchdog.current=globalThis.setTimeout(()=>{
   thinkingWatchdog.current=null
   if(!turnIsCurrent(turn,eventScope)||userPaused.current)return
   // A tool may already have performed a write. Never replay it on a timeout.
   if(turn.pendingTools){update({status:STATES.THINKING,error:'A consulta está demorando. Sua pergunta continua preservada.'});return}
   send({type:'response.cancel'},eventScope)
   turn.awaitingResponse=false
   recoverTurnRef.current?.(turn,eventScope)
  },20_000)
 },[clearThinkingWatchdog,send,turnIsCurrent,update])
 const reportUsage=useCallback(async(event,eventScope)=>{
  if(!eventIsCurrent(eventScope))return false
  const responseId=safeText(event?.response?.id||event?.response_id,180)
  const result=await postSession('usage',{responseId,usage:event?.response?.usage||{},final:false},{sessionId:eventScope.sessionId})
  if(!eventIsCurrent(eventScope))return false
  if(result?.remainingUsd!=null)update({budgetRemainingUsd:result.remainingUsd})
  if(result?.exhausted){await fail(Object.assign(new Error('O teto autorizado do UAT realtime foi atingido.'),{code:'realtime_voice_budget_exhausted'}),{eventScope});return false}
  return true
 },[eventIsCurrent,fail,postSession,update])
 const reportTurn=useCallback(async(userTranscript,assistantTranscript,eventScope,turn)=>{
  if(!eventIsCurrent(eventScope))return null
  const result=await postSession('turns',{userTranscript,assistantTranscript},{sessionId:eventScope.sessionId}).catch(()=>null)
  if(!turnIsCurrent(turn,eventScope))return null
  // response.done confirms generation, but audio may still be playing. A
  // context reconnect must wait until that playback ends or the user interrupts.
  // Em pausa a reconexao tambem espera: religar o microfone e abrir sessao nova sem acao do consultor
  // contraria a pausa; resume() consome a reconexao pendente.
  if(result?.reconnectRequired){if(turn.lastResponse?.audioPlaying||[STATES.SPEAKING,STATES.PAUSED].includes(machineRef.current.status))pendingReconnect.current=eventScope.scopeKey;else await requestReconnect(eventScope.scopeKey)}
  return result
 },[eventIsCurrent,postSession,requestReconnect,turnIsCurrent])
 const commitResponse=useCallback((response,eventScope)=>{
  const turn=response?.turn
  if(!turnIsCurrent(turn,eventScope)||!response.done||response.status!=='completed'||response.hasTool)return
  const transcript=safeText(response.transcript)
  if(!transcript)return
  if(!response.committed){response.committed=true;turn.completed=true;if(!turn.serverResponseResume)callbacks.current.onAssistantTranscript?.(transcript,eventScope);update({recoveringTurn:false,canRetryTurn:false,error:''})}
  if(!turn.serverResponseResume&&!turn.serverTurnRecorded&&turn.transcript&&!turn.reported){turn.reported=true;reportTurn(turn.transcript,transcript,eventScope,turn);pendingUser.current=''}
 },[reportTurn,turnIsCurrent,update])
 const recoverTurn=useCallback((turn,eventScope,{manual=false}={})=>{
  if(!turnIsCurrent(turn,eventScope)||turn.completed||turn.pendingTools||turn.awaitingResponse)return false
  const response=turn.lastResponse
  const heardAudio=Boolean(response?.audioStarted)
  const canAttempt=manual?turn.manualRetries<1:turn.autoRetries<1&&!heardAudio
  if(!canAttempt){
   if(response?.audioPlaying){send({type:'output_audio_buffer.clear'},eventScope);response.audioPlaying=false}
   turn.retryPending=false
   const canRetry=turn.manualRetries<1
   const message=canRetry?realtimeTurnFailureMessage({heardAudio}):'Ainda não consegui concluir esta resposta. A pergunta está preservada; você pode continuar digitando.'
   update({status:userPaused.current?STATES.PAUSED:STATES.LISTENING,microphoneActive:!userPaused.current,recoveringTurn:false,canRetryTurn:canRetry,error:message})
   callbacks.current.onError?.(message,{code:'REALTIME_TURN_INCOMPLETE',turnId:turn.id})
   return false
  }
  if(userPaused.current){turn.retryPending=true;return false}
  // Only assistant message items are removed. Function calls and their results
  // remain in history and are never re-executed by a speech retry.
  if(heardAudio)send({type:'output_audio_buffer.clear'},eventScope)
  for(const itemId of response?.partialItemIds||[])send({type:'conversation.item.delete',item_id:itemId},eventScope)
  if(response)response.obsolete=true
  const sent=send({type:'response.create',response:realtimeTurnResponseOptions(turn)},eventScope)
  if(!sent){if(response)response.obsolete=false;update({recoveringTurn:false,canRetryTurn:true,error:'Não consegui retomar a resposta. Sua pergunta foi preservada.'});return false}
  if(manual)turn.manualRetries+=1;else turn.autoRetries+=1
  turn.awaitingResponse=true;turn.retryPending=false
  marks.current={...(marks.current||{}),firstResponseToken:undefined,firstAudio:undefined,reasoningStarted:now()}
  update({status:STATES.THINKING,microphoneActive:true,recoveringTurn:true,canRetryTurn:false,error:'',assistantTranscript:''})
  armThinkingWatchdog(eventScope)
  return true
 },[armThinkingWatchdog,send,turnIsCurrent,update])
 recoverTurnRef.current=recoverTurn
 const continueToolResponse=useCallback((response,eventScope)=>{
  const turn=response?.turn
  if(!turnIsCurrent(turn,eventScope)||!response.done||turn.pendingTools||response.continuationSent)return false
  if(userPaused.current){pendingToolResponse.current={response,eventScope};return false}
  response.continuationSent=true;pendingToolResponse.current=null
  if(!send({type:'response.create',response:realtimeTurnResponseOptions(turn)},eventScope))return false
  turn.awaitingResponse=true
  update({status:STATES.THINKING,microphoneActive:true,error:''})
  armThinkingWatchdog(eventScope)
  return true
 },[armThinkingWatchdog,send,turnIsCurrent,update])
 const resumeVerifiedServerResponse=useCallback(()=>{
  const candidate=pendingVerifiedResume.current,current=resources.current,offered=current.resumeResponse,active=activeScopeRef.current
  if(!candidate||!offered||userPaused.current||current.dc?.readyState!=='open'||candidate.expiresAt<Date.now())return false
  const matches=context=>context&&String(context.clientId||'')===active.clientId&&String(context.conversationId||'')===active.conversationId&&exactEpoch(context.contextEpoch)!==null&&context.contextEpoch===active.contextEpoch
  if(current.scopeKey!==active.scopeKey||current.sessionId===candidate.sourceSessionId||current.resumedServerResponseId===candidate.responseId||!matches(candidate.context)||!matches(offered.context)||String(offered.responseId||'')!==candidate.responseId)return false
  // The new session has independently reloaded the same verified server answer.
  // Resume that answer once; never move tool text across producer boundaries.
  const turn=beginTurn();turn.serverResponseResume=true;turn.hasToolResult=true;turn.awaitingResponse=true
  const eventScope={...active,sessionId:current.sessionId}
  if(!send({type:'response.create',response:realtimeTurnResponseOptions(turn)},eventScope))return false
  current.resumedServerResponseId=candidate.responseId
  update({status:STATES.THINKING,microphoneActive:true,error:'',canRetryTurn:false,recoveringTurn:false})
  armThinkingWatchdog(eventScope)
  return true
 },[armThinkingWatchdog,beginTurn,send,update])
 const handleTool=useCallback(async(event,eventScope)=>{
  const response=responseFor(event),turn=response?.turn
  if(!turnIsCurrent(turn,eventScope)||response.obsolete||response.continuationSent)return
  const callId=safeText(event.call_id,180)
  if(!callId||toolCalls.current.has(callId))return
  toolCalls.current.set(callId,{turn,response})
  let args={};try{args=JSON.parse(event.arguments||'{}')}catch{}
  response.hasTool=true;turn.pendingTools+=1
  if(!userPaused.current)update({status:STATES.THINKING,microphoneActive:true})
  const executionKey=JSON.stringify([event.name,event.name==='val_request_memory_review'?safeText(args.candidate,1200):safeText(args.request,1200)])
  let execution=turn.toolExecutions.get(executionKey)
  if(!execution){
   execution=(async()=>{try{
    if(event.name==='val_request_memory_review')return await callbacks.current.onMemoryReview?.({candidate:safeText(args.candidate,1200)})||{status:'REVIEW_REQUIRED',message:'A revisão humana é obrigatória.'}
    if(event.name==='val_governed_tool')return await callbacks.current.onToolCall?.({request:safeText(args.request,1200),reason:safeText(args.reason,80)})||{status:'UNAVAILABLE',message:'A ferramenta governada não está conectada.'}
    return {status:'DENIED',message:'Ferramenta não autorizada.'}
   }catch{return {status:'ERROR',message:'Não foi possível concluir a consulta. Nenhuma nova tentativa da operação foi executada.'}}})()
   turn.toolExecutions.set(executionKey,execution)
  }
  const result=await execution
  turn.pendingTools=Math.max(0,turn.pendingTools-1)
  const resultScope=result?.contextScope
  const resultContext=resultScope?{clientId:String(resultScope.producerId||''),conversationId:String(resultScope.conversationId||''),contextEpoch:resultScope.contextEpoch}:null
  const changedScope=resultContext&&(resultContext.clientId!==String(eventScope.clientId||'')||resultContext.conversationId!==eventScope.conversationId||resultContext.contextEpoch!==eventScope.contextEpoch)
  if(result?.status==='COMPLETED'&&result?.responseId&&resultContext&&!changedScope&&exactEpoch(resultContext.contextEpoch)!==null)turn.serverTurnRecorded=true
  if(changedScope&&result?.responseId&&exactEpoch(resultContext.contextEpoch)!==null&&resultContext.conversationId&&(!turn.interrupted||turn.interruptionReason==='CONTEXT_SCOPE_CHANGED')&&(resources.current.scopeKey||scopeReconnectPending.current)){
   const newerInput=activeTurn.current&&activeTurn.current!==turn&&!activeTurn.current.serverResponseResume
   if(!newerInput){pendingVerifiedResume.current={responseId:String(result.responseId),context:resultContext,sourceSessionId:eventScope.sessionId,expiresAt:Date.now()+30_000};resumeVerifiedServerResponse()}
  }
  if(changedScope||!turnIsCurrent(turn,eventScope))return
  if(!send(toolOutputEvent(callId,result),eventScope))return
  turn.hasToolResult=true
  // response.done and the HTTP tool result may arrive in either order. Only
  // continue once both have finished, so the provider never gets two responses.
  continueToolResponse(response,eventScope)
 },[continueToolResponse,responseFor,resumeVerifiedServerResponse,send,turnIsCurrent,update])
 const handleEvent=useCallback(async(raw,eventScope)=>{
  if(!eventIsCurrent(eventScope))return
  const event=parseRealtimeEvent(raw);if(!event)return
  const type=event.type,paused=userPaused.current
  if(paused&&realtimeEventSuppressedWhilePaused(type))return
  if(type==='session.created'||type==='session.updated'){if(!paused&&![STATES.THINKING,STATES.SPEAKING].includes(machineRef.current.status))update({status:STATES.LISTENING,microphoneActive:true,error:''});return}
  if(type==='input_audio_buffer.speech_started'){
   const timestamp=now(),interrupted=[STATES.SPEAKING,STATES.THINKING].includes(machineRef.current.status)
   beginTurn(String(event.item_id||''))
   if(interrupted){send({type:'response.cancel'},eventScope);send({type:'output_audio_buffer.clear'},eventScope)}
   marks.current={speechStarted:timestamp,bargeIn:interrupted};clearThinkingWatchdog();update({status:STATES.LISTENING,microphoneActive:true,error:'',interimTranscript:'',assistantTranscript:'',canRetryTurn:false,recoveringTurn:false});return
  }
  if(type==='input_audio_buffer.speech_stopped'){
   if(event.item_id&&inputTurns.current.has(event.item_id)&&inputTurns.current.get(event.item_id)!==activeTurn.current)return
   if(!activeTurn.current)beginTurn(String(event.item_id||''))
   if(activeTurn.current.interrupted)return
   const timestamp=now();marks.current={...(marks.current||{}),speechEnd:timestamp,turnDetected:timestamp};armThinkingWatchdog(eventScope);update({status:STATES.THINKING,microphoneActive:true});return
  }
  if(type==='conversation.item.input_audio_transcription.delta'||type==='conversation.item.input_audio_transcription.completed'){
   const itemId=String(event.item_id||'')
   let turn=itemId&&inputTurns.current.get(itemId)
   if(!turn){turn=activeTurn.current||beginTurn(itemId);if(turn.inputItemId&&itemId&&turn.inputItemId!==itemId)return;if(itemId){turn.inputItemId=itemId;inputTurns.current.set(itemId,turn)}}
   if(!turnIsCurrent(turn,eventScope))return
   if(type.endsWith('.delta')){if(!paused)update(current=>({interimTranscript:(current.interimTranscript+String(event.delta||'')).slice(-3000)}));return}
   const transcript=safeText(event.transcript)
   if(turn.userPublished)return
   turn.transcript=transcript;pendingUser.current=transcript
   if(marks.current)marks.current.transcriptAvailable=now()
   if(!paused)update({interimTranscript:transcript})
   if(transcript){turn.userPublished=true;callbacks.current.onUserTranscript?.(transcript,eventScope)}
   postSession('usage',{responseId:`transcript:${safeText(event.item_id,140)}`,kind:'TRANSCRIPTION',usage:event.usage||{},final:false},{sessionId:eventScope.sessionId}).then(result=>{if(!eventIsCurrent(eventScope))return;if(result?.remainingUsd!=null)update({budgetRemainingUsd:result.remainingUsd});if(result?.exhausted)fail(Object.assign(new Error('O teto autorizado do UAT realtime foi atingido.'),{code:'realtime_voice_budget_exhausted'}),{eventScope})}).catch(()=>null)
   if(turn.lastResponse)commitResponse(turn.lastResponse,eventScope)
   return
  }
  if(type==='response.created'){
   const response=responseFor(event,{created:true});if(!response||response.done)return
   if(marks.current)marks.current.reasoningStarted=now()
   armThinkingWatchdog(eventScope);update({status:STATES.THINKING,microphoneActive:true});return
  }
  if(type==='response.output_audio_transcript.delta'||type==='response.output_audio_transcript.done'){
   const response=responseFor(event);if(!response||response.done||response!==response.turn.lastResponse)return
   if(event.item_id)response.partialItemIds.add(String(event.item_id))
   response.transcript=type.endsWith('.done')?safeText(event.transcript||response.transcript):response.transcript+String(event.delta||'')
   if(!paused)update({assistantTranscript:safeText(response.transcript)})
   if(marks.current&&!Number.isFinite(marks.current.firstResponseToken))marks.current.firstResponseToken=now()
   // Transcript.done is a streaming boundary, not successful completion. A
   // subsequent response.done may still report incomplete/max_output_tokens.
   return
  }
  if(type==='output_audio_buffer.started'){
   const response=responseFor(event);if(!response||response!==response.turn.lastResponse)return
   response.audioStarted=true;response.audioPlaying=true
   if(marks.current&&!Number.isFinite(marks.current.firstAudio))marks.current.firstAudio=now()
   clearThinkingWatchdog();update({status:STATES.SPEAKING,microphoneActive:true});return
  }
  if(type==='output_audio_buffer.stopped'||type==='output_audio_buffer.cleared'){
   const response=responseFor(event);if(!response||response!==response.turn.lastResponse)return
   response.audioPlaying=false
   if(!paused){
    const stillWorking=response.turn.pendingTools>0||response.turn.awaitingResponse||(!response.done&&type==='output_audio_buffer.stopped')
    update({status:stillWorking?STATES.THINKING:STATES.LISTENING,microphoneActive:true})
    if(stillWorking)armThinkingWatchdog(eventScope)
   }
   if(pendingReconnect.current&&!paused){const scopeKeyToReconnect=pendingReconnect.current;pendingReconnect.current=null;await requestReconnect(scopeKeyToReconnect)}
   return
  }
  if(type==='response.function_call_arguments.done'){await handleTool(event,eventScope);return}
  if(type==='response.done'){
   // Usage remains billable even for superseded responses, but must not delay
   // turn completion or allow an old HTTP result to overwrite a new turn.
   reportUsage(event,eventScope).catch(()=>null)
   const response=responseFor(event);if(!response||response.done)return
   const turn=response.turn
   response.done=true;response.status=String(event.response?.status||'')
   response.transcript=safeText(realtimeCompletedTranscript(event.response,response.transcript))
   for(const itemId of realtimePartialMessageIds(event.response))response.partialItemIds.add(itemId)
   response.hasTool=response.hasTool||Boolean(event.response?.output?.some(item=>item.type==='function_call'))
   clearThinkingWatchdog()
   if(marks.current){marks.current.responseEnd=now();callbacks.current.onMetrics?.(realtimeLatencySample(marks.current,response.status==='completed'?'SUCCESS':response.status==='cancelled'?'CANCELLED':'ERROR'));marks.current=null}
   if(response.status==='completed'){
    if(response.hasTool||turn.pendingTools){
     if(!paused)update({status:STATES.THINKING,microphoneActive:true})
     if(turn.pendingTools)armThinkingWatchdog(eventScope)
     else if(turn.hasToolResult)continueToolResponse(response,eventScope)
     return
    }
    if(!response.transcript&&(turn.transcript||turn.inputItemId)){recoverTurn(turn,eventScope);return}
    commitResponse(response,eventScope)
    if(!response.audioPlaying&&!userPaused.current)update({status:STATES.LISTENING,microphoneActive:true,recoveringTurn:false})
   }else if(response.status==='cancelled'){
    if(paused)turn.retryPending=!turn.completed
    else if(!response.audioPlaying)update({status:STATES.LISTENING,microphoneActive:true,recoveringTurn:false})
   }else if(response.status){
    if(turn.pendingTools){if(!paused)update({status:STATES.THINKING,microphoneActive:true});armThinkingWatchdog(eventScope)}
    else recoverTurn(turn,eventScope)
   }
   if(pendingReconnect.current&&!response.audioPlaying&&!userPaused.current){const scopeKeyToReconnect=pendingReconnect.current;pendingReconnect.current=null;await requestReconnect(scopeKeyToReconnect)}
   return
  }
  if(type==='error'&&event.error?.code==='response_cancel_not_active')return
  if(type==='error'){clearThinkingWatchdog();await fail(Object.assign(new Error('A conexão de voz foi interrompida. Tente reconectar ou continue digitando.'),{code:event.error?.code||'realtime_provider_error'}),{eventScope})}
 },[armThinkingWatchdog,beginTurn,clearThinkingWatchdog,commitResponse,continueToolResponse,eventIsCurrent,fail,handleTool,postSession,recoverTurn,reportUsage,requestReconnect,responseFor,send,turnIsCurrent,update])
 const start=useCallback(async()=>{
  if(disabled)return {ok:false,reason:'DISABLED'}
  const retrySeconds=realtimeRetrySeconds(retryAt.current)
  if(retrySeconds){update({retryAfterSeconds:retrySeconds});return {ok:false,reason:'realtime_voice_cooldown',retryAfterSeconds:retrySeconds}}
  if(!capabilities.supported)return fail(Object.assign(new Error(!capabilities.secureContext?'Abra a VAL em uma conexão HTTPS segura.':'Este navegador não oferece WebRTC e microfone compatíveis.'),{code:!capabilities.secureContext?'INSECURE_CONTEXT':'WEBRTC_UNAVAILABLE'}))
  if(resources.current.scopeKey)return {ok:false,reason:'ALREADY_ACTIVE'}
  lifecycle.current+=1
  const startedScope={...activeScopeRef.current}
  const attemptId=Symbol('realtime-voice-start')
  const attempt={...emptyResources(),controller:new AbortController(),scopeKey:startedScope.scopeKey,contextEpoch:startedScope.contextEpoch,attemptId}
  resources.current=attempt
  const isCurrent=()=>activeScopeRef.current.scopeKey===startedScope.scopeKey&&resources.current.attemptId===attemptId
  const abandon=async(sessionId='')=>{
   if(resources.current.attemptId===attemptId)resources.current=emptyResources()
   attempt.controller?.abort()
   if(attempt.connectionTimer)globalThis.clearTimeout(attempt.connectionTimer)
   if(attempt.disconnectTimer)globalThis.clearTimeout(attempt.disconnectTimer)
   if(attempt.timer)globalThis.clearTimeout(attempt.timer)
   try{attempt.dc?.close()}catch{};try{attempt.pc?.close()}catch{}
   for(const track of attempt.stream?.getTracks?.()||[])try{track.stop()}catch{}
   if(attempt.audio){try{attempt.audio.pause()}catch{};try{attempt.audio.srcObject=null;attempt.audio.remove()}catch{}}
   if(sessionId&&!attempt.finalized){attempt.finalized=true;postSession('usage',{final:true,disconnectReason:'CONTEXT_SCOPE_CHANGED'},{keepalive:true,sessionId}).catch(()=>null)}
   if(resources.current.attemptId===attemptId)resources.current=emptyResources()
   return {ok:false,reason:'REALTIME_SCOPE_CHANGED'}
  }
  let permissionState='PROMPT';try{const permission=await navigator.permissions?.query?.({name:'microphone'});if(['granted','denied','prompt'].includes(permission?.state))permissionState=permission.state.toUpperCase()}catch{}
  if(!isCurrent())return abandon()
  update({status:STATES.CONNECTING,microphoneActive:false,microphonePermission:permissionState,error:'',fallbackReason:'',audioBlocked:false,retryable:true,retryAfterSeconds:0,interimTranscript:'',assistantTranscript:''})
  const audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.setAttribute('aria-hidden','true');audio.style.display='none';document.body.appendChild(audio);attempt.audio=audio;audio.play().catch(()=>null)
  try{
   // Configuration must be ready before requesting access to the microphone.
   attempt.connectionTimer=globalThis.setTimeout(()=>attempt.controller.abort(),8000)
   const statusResponse=await fetch('/api/v1/realtime-voice/status',{signal:attempt.controller.signal})
   const availability=await statusResponse.json().catch(()=>null)
   if(!isCurrent())return abandon()
   globalThis.clearTimeout(attempt.connectionTimer);attempt.connectionTimer=null
   if(!statusResponse.ok||!availability?.available)throw Object.assign(new Error(availability?.unavailableMessage||availability?.error||'A conversa por voz está indisponível neste ambiente.'),{code:availability?.unavailableCode||availability?.code||'realtime_voice_unavailable',canRetry:availability?.canRetry,retryAfterSeconds:realtimeRetryDelay(availability,statusResponse.headers)})
   // Permission comes first: do not reserve budget or create a paid provider
   // session when the device cannot supply a microphone stream.
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});attempt.stream=stream;for(const track of stream.getAudioTracks())track.enabled=!userPaused.current;if(!isCurrent())return abandon();update({microphonePermission:'GRANTED'})
   attempt.connectionTimer=globalThis.setTimeout(()=>{if(isCurrent())fail(Object.assign(new Error('A conexão de voz demorou demais. Tente novamente.'),{code:'REALTIME_CONNECT_TIMEOUT',retryAfterSeconds:5}))},20000)
   let sessionResponse,session
   for(let syncAttempt=0;syncAttempt<2;syncAttempt++){
    sessionResponse=await fetch('/api/v1/realtime-voice/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:startedScope.clientId,conversationId:startedScope.conversationId,contextEpoch:startedScope.contextEpoch,activeContext}),signal:attempt.controller.signal})
    session=await sessionResponse.json().catch(()=>null)
    if(!isCurrent())return abandon(session?.sessionId)
    const currentContext=session?.currentContext
    const canSync=syncAttempt===0&&sessionResponse.status===409&&session?.code==='realtime_voice_context_epoch_mismatch'&&currentContext&&String(currentContext.conversationId||'')===startedScope.conversationId&&String(currentContext.clientId||'')===startedScope.clientId&&exactEpoch(currentContext.contextEpoch)!==null&&currentContext.contextEpoch!==startedScope.contextEpoch
    if(!canSync)break
    const previousScope={...startedScope}
    startedScope.contextEpoch=currentContext.contextEpoch
    startedScope.scopeKey=realtimeVoiceScopeKey({...startedScope,activeContext})
    attempt.scopeKey=startedScope.scopeKey;attempt.contextEpoch=startedScope.contextEpoch
    activeScopeRef.current={...startedScope};scopeKeyRef.current=startedScope.scopeKey
    setReconciledScope({requestedScopeKey,contextEpoch:startedScope.contextEpoch})
    callbacks.current.onContextSync?.(currentContext,previousScope)
   }
   if(!isCurrent())return abandon(session?.sessionId)
   if(!sessionResponse.ok)throw Object.assign(new Error(session?.error||'O modo realtime não está disponível neste ambiente.'),{code:session?.code||'realtime_voice_session_unavailable',canRetry:session?.safe_to_retry,retryAfterSeconds:realtimeRetryDelay(session,sessionResponse.headers)})
   attempt.sessionId=String(session?.sessionId||'')
   attempt.resumeResponse=session?.resumeResponse||null
   const responseScope=session?.context||{}
   const responseHasEpoch=Object.prototype.hasOwnProperty.call(responseScope,'contextEpoch')
   const responseClientId=String(responseScope.clientId||'')
   if(!attempt.sessionId||String(responseScope.conversationId||'')!==startedScope.conversationId||responseClientId!==startedScope.clientId||!responseHasEpoch||exactEpoch(responseScope.contextEpoch)===null||responseScope.contextEpoch!==startedScope.contextEpoch)throw Object.assign(new Error('A sessão realtime retornou outro produtor, conversa ou epoch.'),{code:'realtime_voice_session_scope_mismatch'})
   const eventScope={...startedScope,sessionId:attempt.sessionId}
   update({sessionId:attempt.sessionId,model:session.model,budgetRemainingUsd:session.budget?.remainingUsd??null})
   const pc=new RTCPeerConnection();attempt.pc=pc
   pc.onconnectionstatechange=()=>{
    if(!eventIsCurrent(eventScope))return
    if(pc.connectionState==='connected'){if(attempt.disconnectTimer)globalThis.clearTimeout(attempt.disconnectTimer);attempt.disconnectTimer=null;return}
    if(pc.connectionState==='disconnected'){if(!attempt.disconnectTimer)attempt.disconnectTimer=globalThis.setTimeout(()=>{if(eventIsCurrent(eventScope)&&pc.connectionState==='disconnected')fail(Object.assign(new Error('A conexão de voz foi interrompida. Tente reconectar.'),{code:'WEBRTC_DISCONNECTED',retryAfterSeconds:3}),{eventScope})},4000);return}
    if(['failed','closed'].includes(pc.connectionState))fail(Object.assign(new Error('A conexão de voz foi encerrada. Tente reconectar.'),{code:`WEBRTC_${pc.connectionState.toUpperCase()}`,retryAfterSeconds:3}),{eventScope})
   }
   pc.ontrack=event=>{if(!eventIsCurrent(eventScope))return;audio.srcObject=event.streams?.[0]||new MediaStream([event.track]);if(!userPaused.current)audio.play().catch(()=>{if(eventIsCurrent(eventScope)&&!userPaused.current)update({error:'Toque em Retomar áudio para ouvir a resposta.',audioBlocked:true})})}
   for(const track of stream.getAudioTracks())pc.addTrack(track,stream)
   const dc=pc.createDataChannel('oai-events');attempt.dc=dc;dc.onmessage=event=>handleEvent(event.data,eventScope);dc.onerror=()=>{if(eventIsCurrent(eventScope))fail(Object.assign(new Error('O canal de eventos realtime falhou.'),{code:'WEBRTC_DATA_CHANNEL_ERROR'}),{eventScope})};dc.onopen=()=>{if(!eventIsCurrent(eventScope))return;if(attempt.connectionTimer)globalThis.clearTimeout(attempt.connectionTimer);attempt.connectionTimer=null;for(const track of stream.getAudioTracks())track.enabled=!userPaused.current;update({status:userPaused.current?STATES.PAUSED:STATES.LISTENING,microphoneActive:!userPaused.current});resumeVerifiedServerResponse()}
   const offer=await pc.createOffer();if(!isCurrent())return abandon(attempt.sessionId);await pc.setLocalDescription(offer);if(!isCurrent())return abandon(attempt.sessionId)
   const answerResponse=await fetch(session.callUrl,{method:'POST',body:offer.sdp,headers:{Authorization:`Bearer ${session.clientSecret}`,'Content-Type':'application/sdp'},signal:attempt.controller.signal})
   if(!isCurrent())return abandon(attempt.sessionId)
   if(!answerResponse.ok)throw Object.assign(new Error('O provider recusou a conexão WebRTC.'),{code:'WEBRTC_PROVIDER_REJECTED'})
   const answer=await answerResponse.text();if(!isCurrent())return abandon(attempt.sessionId);await pc.setRemoteDescription({type:'answer',sdp:answer});if(!isCurrent())return abandon(attempt.sessionId)
   attempt.timer=globalThis.setTimeout(()=>{if(eventIsCurrent(eventScope))fail(Object.assign(new Error('A sessão atingiu o limite de duração do UAT.'),{code:'REALTIME_SESSION_TIME_LIMIT'}),{eventScope})},Math.max(60,Number(session.maxSessionSeconds)||600)*1000)
   return {ok:true,transport:'WEBRTC',sessionId:attempt.sessionId,scope:eventScope}
  }catch(error){if(!isCurrent())return abandon(attempt.sessionId);if(error?.name==='NotAllowedError')update({microphonePermission:permissionState==='DENIED'?'DENIED':'BLOCKED'});else if(error?.name==='NotFoundError')update({microphonePermission:'UNAVAILABLE'});return fail(error)}
 },[activeContext,capabilities,disabled,eventIsCurrent,fail,handleEvent,postSession,requestedScopeKey,resumeVerifiedServerResponse,scopeKey,update])
 useEffect(()=>{
  if(scopeKeyRef.current===scopeKey)return
  scopeKeyRef.current=scopeKey
  if(!resources.current.scopeKey){
   if(scopeReconnectPending.current){scopeReconnectPending.current={scopeKey};setReconnectSequence(current=>current+1)}
   return
  }
  requestReconnect(scopeKey).catch(()=>null)
 },[requestReconnect,scopeKey])
 useEffect(()=>{
  if(disabled||userPaused.current||!scopeReconnectPending.current||resources.current.scopeKey)return
  if(!realtimeVoiceReconnectReady(scopeReconnectPending.current,activeScopeRef.current,resources.current)){scopeReconnectPending.current=null;return}
  scopeReconnectPending.current=null
  start().catch(()=>null)
 },[disabled,reconnectSequence,start,scopeKey])
 const pause=useCallback(()=>{userPaused.current=true;clearThinkingWatchdog();const turn=activeTurn.current;if(turn&&!turn.completed&&!turn.interrupted&&!turn.pendingTools)turn.retryPending=true;send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});for(const track of resources.current.stream?.getAudioTracks?.()||[])track.enabled=false;try{resources.current.audio?.pause()}catch{};update({status:STATES.PAUSED,microphoneActive:false});return true},[clearThinkingWatchdog,send,update])
 const resumeAudio=useCallback(async()=>{
  const current=resources.current
  if(userPaused.current||!current.audio)return false
  try{await current.audio.play();if(resources.current===current)update({audioBlocked:false});return true}
  catch{if(resources.current===current)update({audioBlocked:true,error:'O navegador bloqueou o áudio. Toque em Retomar áudio.'});return false}
 },[update])
 const resume=useCallback(()=>{
  userPaused.current=false
  if(scopeReconnectPending.current){update({status:STATES.CONNECTING,microphoneActive:false});setReconnectSequence(current=>current+1);return true}
  if(pendingReconnect.current){const target=pendingReconnect.current;pendingReconnect.current=null;requestReconnect(target).catch(()=>null);return true}
  if(!resources.current.sessionId)return false
  send({type:'input_audio_buffer.clear'})
  for(const track of resources.current.stream?.getAudioTracks?.()||[])track.enabled=true
  resumeAudio()
  update({status:STATES.LISTENING,microphoneActive:true})
  if(resumeVerifiedServerResponse())return true
  if(pendingToolResponse.current){const {response,eventScope}=pendingToolResponse.current;pendingToolResponse.current=null;continueToolResponse(response,eventScope)}
  else if(activeTurn.current?.retryPending){const turn=activeTurn.current;turn.awaitingResponse=false;recoverTurn(turn,{...activeScopeRef.current,sessionId:resources.current.sessionId})}
  else if(activeTurn.current?.pendingTools){update({status:STATES.THINKING,microphoneActive:true});armThinkingWatchdog({...activeScopeRef.current,sessionId:resources.current.sessionId})}
  return true
 },[armThinkingWatchdog,continueToolResponse,recoverTurn,requestReconnect,resumeAudio,resumeVerifiedServerResponse,send,update])
 // Interromper a fala tambem encerra a reproducao: a reconexao adiada durante a resposta acontece
 // agora, senao a proxima pergunta seria respondida com o contexto antigo.
 const bargeIn=useCallback(()=>{clearThinkingWatchdog();if(activeTurn.current){activeTurn.current.interrupted=true;activeTurn.current.interruptionReason='USER_INTERRUPTION'}pendingVerifiedResume.current=null;pendingToolResponse.current=null;send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});update({status:userPaused.current?STATES.PAUSED:STATES.LISTENING,microphoneActive:!userPaused.current,recoveringTurn:false,canRetryTurn:false,error:''});if(pendingReconnect.current&&!userPaused.current){const scopeKeyToReconnect=pendingReconnect.current;pendingReconnect.current=null;requestReconnect(scopeKeyToReconnect).catch(()=>null)}return true},[clearThinkingWatchdog,requestReconnect,send,update])
 const retryTurn=useCallback(()=>{
  if(userPaused.current||!machineRef.current.canRetryTurn)return false
  return recoverTurn(activeTurn.current,{...activeScopeRef.current,sessionId:resources.current.sessionId},{manual:true})
 },[recoverTurn])
 const exit=useCallback(()=>{userPaused.current=false;scopeReconnectPending.current=null;return cleanup({final:true,reason:'USER_EXIT',nextStatus:STATES.IDLE})},[cleanup])
 useEffect(()=>{callbacks.current.onStateChange?.(machine)},[machine])
 useEffect(()=>{
  if(!machine.retryAfterSeconds)return
  const timer=globalThis.setInterval(()=>update({retryAfterSeconds:realtimeRetrySeconds(retryAt.current)}),1000)
  return ()=>globalThis.clearInterval(timer)
 },[Boolean(machine.retryAfterSeconds),update])
 useEffect(()=>()=>{
  scopeReconnectPending.current=null
  clearThinkingWatchdog()
  const current=resources.current
  resources.current=emptyResources()
  current.controller?.abort()
  if(current.connectionTimer)globalThis.clearTimeout(current.connectionTimer)
  if(current.disconnectTimer)globalThis.clearTimeout(current.disconnectTimer)
  if(current.timer)globalThis.clearTimeout(current.timer)
  if(current.sessionId&&!current.finalized){
   current.finalized=true
   fetch(`/api/v1/realtime-voice/sessions/${encodeURIComponent(current.sessionId)}/usage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({final:true,disconnectReason:'COMPONENT_UNMOUNT'}),keepalive:true}).catch(()=>null)
  }
  try{current.dc?.close();current.pc?.close();current.audio?.remove()}catch{}
  for(const track of current.stream?.getTracks?.()||[])try{track.stop()}catch{}
 },[])
 return {state:{...machine,canRetryTurn:machine.canRetryTurn&&!userPaused.current&&!machine.recoveringTurn,canRetry:machine.retryable!==false&&machine.retryAfterSeconds===0,label:realtimeStatusLabel(machine.status),inputSupported:capabilities.supported,outputSupported:capabilities.supported,isListening:machine.status===STATES.LISTENING,isProcessing:machine.status===STATES.THINKING,isSpeaking:machine.status===STATES.SPEAKING,canBargeIn:machine.status===STATES.SPEAKING,transport:'WEBRTC',version:NATURAL_REALTIME_VERSION},start,pause,resume,resumeAudio,bargeIn,retryTurn,exit,capabilities}
}
