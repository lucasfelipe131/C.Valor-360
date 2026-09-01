import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {NATURAL_REALTIME_STATES as STATES,NATURAL_REALTIME_VERSION,parseRealtimeEvent,realtimeLatencySample,realtimeStatusLabel,realtimeWebRTCCapabilities,toolOutputEvent} from '../lib/realtime-webrtc.js'

const now=()=>globalThis.performance?.now?.()??Date.now()
const safeText=(value,max=3000)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0?value:null
const requiredEpoch=value=>{
 const epoch=exactEpoch(value)
 if(epoch===null)throw Object.assign(new Error('contextEpoch deve ser um inteiro seguro não negativo.'),{code:'realtime_voice_context_epoch_invalid'})
 return epoch
}
const emptyResources=()=>({pc:null,dc:null,stream:null,audio:null,timer:null,sessionId:'',scopeKey:'',contextEpoch:0,attemptId:null,finalized:false})

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

export default function useNaturalRealtimeVoice({clientId='',conversationId='',contextEpoch=0,activeContext=null,disabled=false,onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange}={}){
 const [machine,setMachine]=useState({status:STATES.IDLE,microphoneActive:false,microphonePermission:'UNKNOWN',error:'',fallbackReason:'',sessionId:'',model:'',budgetRemainingUsd:null})
 const [reconnectSequence,setReconnectSequence]=useState(0)
 const machineRef=useRef(machine)
 const resources=useRef(emptyResources())
 const currentEpoch=requiredEpoch(contextEpoch)
 const scopeKey=realtimeVoiceScopeKey({clientId,conversationId,contextEpoch:currentEpoch,activeContext})
 const activeScopeRef=useRef(null)
 activeScopeRef.current={scopeKey,clientId:String(clientId),producerId:String(clientId),conversationId:String(conversationId),contextEpoch:currentEpoch}
 const scopeKeyRef=useRef(scopeKey),scopeReconnectPending=useRef(null)
 const callbacks=useRef({onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange})
 const marks=useRef(null),pendingUser=useRef(''),assistantBuffers=useRef(new Map())
 callbacks.current={onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange}
 const capabilities=useMemo(()=>realtimeWebRTCCapabilities(),[])
 const update=useCallback(next=>setMachine(current=>({...current,...(typeof next==='function'?next(current):next)})),[])
 const eventIsCurrent=useCallback(eventScope=>realtimeVoiceEventMatchesScope(eventScope,activeScopeRef.current,resources.current),[])
 const send=useCallback((event,eventScope=null)=>{if(eventScope&&!eventIsCurrent(eventScope))return false;const dc=resources.current.dc;if(dc?.readyState!=='open')return false;try{dc.send(JSON.stringify(event));return true}catch{return false}},[eventIsCurrent])
 const postSession=useCallback(async(path,payload,{keepalive=false,sessionId:explicitSessionId=''}={})=>{
  const sessionId=explicitSessionId||resources.current.sessionId;if(!sessionId)return null
  const response=await fetch(`/api/v1/realtime-voice/sessions/${encodeURIComponent(sessionId)}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive})
  const result=await response.json().catch(()=>null)
  if(!response.ok&&response.status!==402)throw Object.assign(new Error(result?.error||'Falha no controle da sessão realtime.'),{code:result?.code||'realtime_voice_control_failed'})
  return result
 },[])
 const cleanup=useCallback(async({final=true,reason='EXIT',nextStatus=STATES.IDLE}={})=>{
  const current=resources.current
  if(current.timer)globalThis.clearTimeout(current.timer)
  current.timer=null
  try{current.dc?.close()}catch{}
  try{current.pc?.close()}catch{}
  for(const track of current.stream?.getTracks?.()||[])try{track.stop()}catch{}
  if(current.audio){try{current.audio.pause()}catch{};try{current.audio.srcObject=null;current.audio.remove()}catch{}}
  if(final&&!current.finalized&&current.sessionId){current.finalized=true;postSession('usage',{final:true,disconnectReason:reason},{keepalive:true,sessionId:current.sessionId}).catch(()=>null)}
  resources.current=emptyResources()
  marks.current=null;pendingUser.current='';assistantBuffers.current.clear();update({status:nextStatus,microphoneActive:false,sessionId:'',error:'',fallbackReason:nextStatus===STATES.FALLBACK?reason:''})
 },[postSession,update])
 const requestReconnect=useCallback(async(targetScopeKey=activeScopeRef.current.scopeKey)=>{
  const request={scopeKey:String(targetScopeKey||'')}
  scopeReconnectPending.current=request
  await cleanup({final:true,reason:'CONTEXT_SCOPE_CHANGED',nextStatus:STATES.CONNECTING})
  if(scopeReconnectPending.current!==request)return false
  setReconnectSequence(current=>current+1)
  return true
 },[cleanup])
 const fail=useCallback(async(error,{fallback=true,eventScope=null}={})=>{
  const code=String(error?.code||error?.name||'realtime_voice_failed')
  const message=error?.message||'O modo contínuo não está disponível agora. Use apertar para falar.'
  if(eventScope&&!eventIsCurrent(eventScope))return {ok:false,reason:'REALTIME_STALE_EVENT',error:message}
  await cleanup({final:true,reason:code,nextStatus:fallback?STATES.FALLBACK:STATES.ERROR})
  update({error:message,fallbackReason:code})
  callbacks.current.onError?.(message,{code})
  return {ok:false,reason:code,error:message}
 },[cleanup,eventIsCurrent,update])
 const reportUsage=useCallback(async(event,eventScope)=>{
  if(!eventIsCurrent(eventScope))return false
  const responseId=safeText(event?.response?.id||event?.response_id,180)
  const result=await postSession('usage',{responseId,usage:event?.response?.usage||{},final:false},{sessionId:eventScope.sessionId})
  if(!eventIsCurrent(eventScope))return false
  if(result?.remainingUsd!=null)update({budgetRemainingUsd:result.remainingUsd})
  if(result?.exhausted){await fail(Object.assign(new Error('O teto autorizado do UAT realtime foi atingido.'),{code:'realtime_voice_budget_exhausted'}),{eventScope});return false}
  return true
 },[eventIsCurrent,fail,postSession,update])
 const reportTurn=useCallback(async(userTranscript,assistantTranscript,eventScope)=>{
  if(!eventIsCurrent(eventScope))return null
  const result=await postSession('turns',{userTranscript,assistantTranscript},{sessionId:eventScope.sessionId}).catch(()=>null)
  if(!eventIsCurrent(eventScope))return null
  if(result?.reconnectRequired)await requestReconnect(eventScope.scopeKey)
  return result
 },[eventIsCurrent,postSession,requestReconnect])
 const handleTool=useCallback(async(event,eventScope)=>{
  if(!eventIsCurrent(eventScope))return
  let args={};try{args=JSON.parse(event.arguments||'{}')}catch{}
  let result
  try{
   if(event.name==='val_request_memory_review')result=await callbacks.current.onMemoryReview?.({candidate:safeText(args.candidate,1200)})||{status:'REVIEW_REQUIRED',message:'A revisão humana é obrigatória.'}
   else if(event.name==='val_governed_tool')result=await callbacks.current.onToolCall?.({request:safeText(args.request,1200),reason:safeText(args.reason,80)})||{status:'UNAVAILABLE',message:'A ferramenta governada não está conectada.'}
   else result={status:'DENIED',message:'Ferramenta não autorizada.'}
  }catch(error){result={status:'ERROR',message:safeText(error?.message||'A ferramenta falhou.',500)}}
  if(!eventIsCurrent(eventScope))return
  send(toolOutputEvent(event.call_id,result),eventScope);send({type:'response.create'},eventScope)
 },[eventIsCurrent,send])
 const handleEvent=useCallback(async(raw,eventScope)=>{
  if(!eventIsCurrent(eventScope))return
  const event=parseRealtimeEvent(raw);if(!event)return
  const type=event.type
  if(type==='session.created'||type==='session.updated'){update({status:STATES.LISTENING,microphoneActive:true,error:''});return}
  if(type==='input_audio_buffer.speech_started'){
   const timestamp=now();const interrupted=machineRef.current.status===STATES.SPEAKING
   marks.current={speechStarted:timestamp,bargeIn:interrupted};update({status:STATES.LISTENING,microphoneActive:true});return
  }
  if(type==='input_audio_buffer.speech_stopped'){
   const timestamp=now();marks.current={...(marks.current||{}),speechEnd:timestamp,turnDetected:timestamp};update({status:STATES.THINKING,microphoneActive:true});return
  }
  if(type==='conversation.item.input_audio_transcription.completed'){
   const transcript=safeText(event.transcript);if(marks.current)marks.current.transcriptAvailable=now();pendingUser.current=transcript;if(transcript)callbacks.current.onUserTranscript?.(transcript,eventScope);postSession('usage',{responseId:`transcript:${safeText(event.item_id,140)}`,kind:'TRANSCRIPTION',usage:event.usage||{},final:false},{sessionId:eventScope.sessionId}).then(result=>{if(!eventIsCurrent(eventScope))return;if(result?.remainingUsd!=null)update({budgetRemainingUsd:result.remainingUsd});if(result?.exhausted)fail(Object.assign(new Error('O teto autorizado do UAT realtime foi atingido.'),{code:'realtime_voice_budget_exhausted'}),{eventScope})}).catch(()=>null);return
  }
  if(type==='response.created'){if(marks.current)marks.current.reasoningStarted=now();update({status:STATES.THINKING,microphoneActive:true});return}
  if(type==='response.output_audio_transcript.delta'){
   const key=event.response_id||event.item_id||'active';const next=(assistantBuffers.current.get(key)||'')+String(event.delta||'');assistantBuffers.current.set(key,next);if(marks.current&&!Number.isFinite(marks.current.firstResponseToken))marks.current.firstResponseToken=now();return
  }
  if(type==='response.output_audio_transcript.done'){
   const key=event.response_id||event.item_id||'active';const transcript=safeText(event.transcript||assistantBuffers.current.get(key));assistantBuffers.current.delete(key);if(transcript&&eventIsCurrent(eventScope)){callbacks.current.onAssistantTranscript?.(transcript,eventScope);if(pendingUser.current)reportTurn(pendingUser.current,transcript,eventScope);pendingUser.current=''}return
  }
  if(type==='output_audio_buffer.started'){if(marks.current&&!Number.isFinite(marks.current.firstAudio))marks.current.firstAudio=now();update({status:STATES.SPEAKING,microphoneActive:true});return}
  if(type==='output_audio_buffer.stopped'){update({status:STATES.LISTENING,microphoneActive:true});return}
  if(type==='response.function_call_arguments.done'){await handleTool(event,eventScope);return}
  if(type==='response.done'){
   if(marks.current){marks.current.responseEnd=now();callbacks.current.onMetrics?.(realtimeLatencySample(marks.current,event.response?.status==='completed'?'SUCCESS':event.response?.status==='cancelled'?'CANCELLED':'ERROR'));marks.current=null}
   await reportUsage(event,eventScope).catch(()=>null);return
  }
  if(type==='error')await fail(Object.assign(new Error(event.error?.message||'O provider realtime encerrou a sessão.'),{code:event.error?.code||'realtime_provider_error'}),{eventScope})
 },[eventIsCurrent,fail,handleTool,postSession,reportTurn,reportUsage,update])
 const start=useCallback(async()=>{
  if(disabled)return {ok:false,reason:'DISABLED'}
  if(!capabilities.supported)return fail(Object.assign(new Error(!capabilities.secureContext?'Abra a VAL em uma conexão HTTPS segura.':'Este navegador não oferece WebRTC e microfone compatíveis.'),{code:!capabilities.secureContext?'INSECURE_CONTEXT':'WEBRTC_UNAVAILABLE'}))
  if(resources.current.scopeKey)return {ok:false,reason:'ALREADY_ACTIVE'}
  const startedScope={...activeScopeRef.current}
  const attemptId=Symbol('realtime-voice-start')
  const attempt={...emptyResources(),scopeKey:startedScope.scopeKey,contextEpoch:startedScope.contextEpoch,attemptId}
  resources.current=attempt
  const isCurrent=()=>activeScopeRef.current.scopeKey===startedScope.scopeKey&&resources.current.attemptId===attemptId
  const abandon=async(sessionId='')=>{
   if(attempt.timer)globalThis.clearTimeout(attempt.timer)
   try{attempt.dc?.close()}catch{};try{attempt.pc?.close()}catch{}
   for(const track of attempt.stream?.getTracks?.()||[])try{track.stop()}catch{}
   if(attempt.audio){try{attempt.audio.pause()}catch{};try{attempt.audio.srcObject=null;attempt.audio.remove()}catch{}}
   if(sessionId&&!attempt.finalized){attempt.finalized=true;postSession('usage',{final:true,disconnectReason:'CONTEXT_SCOPE_CHANGED'},{keepalive:true,sessionId}).catch(()=>null)}
   if(resources.current.attemptId===attemptId)resources.current=emptyResources()
   return {ok:false,reason:'REALTIME_SCOPE_CHANGED'}
  }
  let permissionState='PROMPT';try{const permission=await navigator.permissions?.query?.({name:'microphone'});if(['granted','denied','prompt'].includes(permission?.state))permissionState=permission.state.toUpperCase()}catch{}
  update({status:STATES.CONNECTING,microphoneActive:false,microphonePermission:permissionState,error:'',fallbackReason:''})
  const audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.setAttribute('aria-hidden','true');audio.style.display='none';document.body.appendChild(audio);attempt.audio=audio;audio.play().catch(()=>null)
  try{
   // Permission comes first: do not reserve budget or create a paid provider
   // session when the device cannot supply a microphone stream.
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});attempt.stream=stream;if(!isCurrent())return abandon();update({microphonePermission:'GRANTED'})
   const sessionResponse=await fetch('/api/v1/realtime-voice/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:startedScope.clientId,conversationId:startedScope.conversationId,contextEpoch:startedScope.contextEpoch,activeContext})})
   const session=await sessionResponse.json().catch(()=>null)
   if(!isCurrent())return abandon(session?.sessionId)
   if(!sessionResponse.ok)throw Object.assign(new Error(session?.error||'O modo realtime não está disponível neste ambiente.'),{code:session?.code||'realtime_voice_session_unavailable'})
   attempt.sessionId=String(session?.sessionId||'')
   const responseScope=session?.context||{}
   const responseHasEpoch=Object.prototype.hasOwnProperty.call(responseScope,'contextEpoch')
   const responseClientId=String(responseScope.clientId||'')
   if(!attempt.sessionId||String(responseScope.conversationId||'')!==startedScope.conversationId||responseClientId!==startedScope.clientId||!responseHasEpoch||exactEpoch(responseScope.contextEpoch)===null||responseScope.contextEpoch!==startedScope.contextEpoch)throw Object.assign(new Error('A sessão realtime retornou outro produtor, conversa ou epoch.'),{code:'realtime_voice_session_scope_mismatch'})
   const eventScope={...startedScope,sessionId:attempt.sessionId}
   update({sessionId:attempt.sessionId,model:session.model,budgetRemainingUsd:session.budget?.remainingUsd??null})
   const pc=new RTCPeerConnection();attempt.pc=pc
   pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState)&&eventIsCurrent(eventScope))fail(Object.assign(new Error('A conexão realtime foi interrompida. Use apertar para falar.'),{code:`WEBRTC_${pc.connectionState.toUpperCase()}`}),{eventScope})}
   pc.ontrack=event=>{if(!eventIsCurrent(eventScope))return;audio.srcObject=event.streams?.[0]||new MediaStream([event.track]);audio.play().catch(()=>null)}
   for(const track of stream.getAudioTracks())pc.addTrack(track,stream)
   const dc=pc.createDataChannel('oai-events');attempt.dc=dc;dc.onmessage=event=>handleEvent(event.data,eventScope);dc.onerror=()=>{if(eventIsCurrent(eventScope))fail(Object.assign(new Error('O canal de eventos realtime falhou.'),{code:'WEBRTC_DATA_CHANNEL_ERROR'}),{eventScope})};dc.onopen=()=>{if(eventIsCurrent(eventScope))update({status:STATES.LISTENING,microphoneActive:true})}
   const offer=await pc.createOffer();if(!isCurrent())return abandon(attempt.sessionId);await pc.setLocalDescription(offer);if(!isCurrent())return abandon(attempt.sessionId)
   const answerResponse=await fetch(session.callUrl,{method:'POST',body:offer.sdp,headers:{Authorization:`Bearer ${session.clientSecret}`,'Content-Type':'application/sdp'}})
   if(!isCurrent())return abandon(attempt.sessionId)
   if(!answerResponse.ok)throw Object.assign(new Error('O provider recusou a conexão WebRTC.'),{code:'WEBRTC_PROVIDER_REJECTED'})
   const answer=await answerResponse.text();if(!isCurrent())return abandon(attempt.sessionId);await pc.setRemoteDescription({type:'answer',sdp:answer});if(!isCurrent())return abandon(attempt.sessionId)
   attempt.timer=globalThis.setTimeout(()=>{if(eventIsCurrent(eventScope))fail(Object.assign(new Error('A sessão atingiu o limite de duração do UAT.'),{code:'REALTIME_SESSION_TIME_LIMIT'}),{eventScope})},Math.max(60,Number(session.maxSessionSeconds)||600)*1000)
   return {ok:true,transport:'WEBRTC',sessionId:attempt.sessionId,scope:eventScope}
  }catch(error){if(!isCurrent())return abandon(attempt.sessionId);if(error?.code==='realtime_voice_disabled'){await cleanup({final:false,reason:error.code,nextStatus:STATES.IDLE});return {ok:false,reason:error.code,error:error.message}}if(error?.name==='NotAllowedError')update({microphonePermission:permissionState==='DENIED'?'DENIED':'BLOCKED'});else if(error?.name==='NotFoundError')update({microphonePermission:'UNAVAILABLE'});return fail(error)}
 },[activeContext,capabilities,disabled,eventIsCurrent,fail,handleEvent,postSession,scopeKey,update])
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
  if(disabled||!scopeReconnectPending.current||resources.current.scopeKey)return
  if(!realtimeVoiceReconnectReady(scopeReconnectPending.current,activeScopeRef.current,resources.current)){scopeReconnectPending.current=null;return}
  scopeReconnectPending.current=null
  start().catch(()=>null)
 },[disabled,reconnectSequence,start,scopeKey])
 const pause=useCallback(()=>{for(const track of resources.current.stream?.getAudioTracks?.()||[])track.enabled=false;try{resources.current.audio?.pause()}catch{};update({status:STATES.PAUSED,microphoneActive:false});return true},[update])
 const resume=useCallback(()=>{for(const track of resources.current.stream?.getAudioTracks?.()||[])track.enabled=true;resources.current.audio?.play?.().catch(()=>null);update({status:STATES.LISTENING,microphoneActive:true});return true},[update])
 const bargeIn=useCallback(()=>{send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});update({status:STATES.LISTENING,microphoneActive:true});return true},[send,update])
 const exit=useCallback(()=>{scopeReconnectPending.current=null;return cleanup({final:true,reason:'USER_EXIT',nextStatus:STATES.IDLE})},[cleanup])
 useEffect(()=>{machineRef.current=machine;callbacks.current.onStateChange?.(machine)},[machine])
 useEffect(()=>()=>{
  scopeReconnectPending.current=null
  const current=resources.current
  if(current.timer)globalThis.clearTimeout(current.timer)
  if(current.sessionId&&!current.finalized){
   current.finalized=true
   fetch(`/api/v1/realtime-voice/sessions/${encodeURIComponent(current.sessionId)}/usage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({final:true,disconnectReason:'COMPONENT_UNMOUNT'}),keepalive:true}).catch(()=>null)
  }
  try{current.dc?.close();current.pc?.close();current.audio?.remove()}catch{}
  for(const track of current.stream?.getTracks?.()||[])try{track.stop()}catch{}
 },[])
 return {state:{...machine,label:realtimeStatusLabel(machine.status),inputSupported:capabilities.supported,outputSupported:capabilities.supported,isListening:machine.status===STATES.LISTENING,isProcessing:machine.status===STATES.THINKING,isSpeaking:machine.status===STATES.SPEAKING,canBargeIn:machine.status===STATES.SPEAKING,transport:'WEBRTC',version:NATURAL_REALTIME_VERSION},start,pause,resume,bargeIn,exit,capabilities}
}
