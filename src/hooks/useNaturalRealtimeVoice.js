import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {NATURAL_REALTIME_STATES as STATES,NATURAL_REALTIME_VERSION,parseRealtimeEvent,realtimeLatencySample,realtimeStatusLabel,realtimeWebRTCCapabilities,toolOutputEvent} from '../lib/realtime-webrtc.js'

const now=()=>globalThis.performance?.now?.()??Date.now()
const safeText=(value,max=3000)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)

export default function useNaturalRealtimeVoice({clientId='',conversationId='',activeContext=null,disabled=false,onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange}={}){
 const [machine,setMachine]=useState({status:STATES.IDLE,microphoneActive:false,microphonePermission:'UNKNOWN',error:'',fallbackReason:'',sessionId:'',model:'',budgetRemainingUsd:null})
 const machineRef=useRef(machine)
 const resources=useRef({pc:null,dc:null,stream:null,audio:null,timer:null,sessionId:'',finalized:false})
 const scopeKey=`${String(clientId)}\u001f${String(conversationId)}\u001f${String(activeContext?.type||'')}\u001f${String(activeContext?.id||'')}`
 const scopeKeyRef=useRef(scopeKey),scopeReconnectPending=useRef(false)
 const callbacks=useRef({onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange})
 const marks=useRef(null),pendingUser=useRef(''),assistantBuffers=useRef(new Map())
 callbacks.current={onUserTranscript,onAssistantTranscript,onToolCall,onMemoryReview,onMetrics,onError,onStateChange}
 const capabilities=useMemo(()=>realtimeWebRTCCapabilities(),[])
 const update=useCallback(next=>setMachine(current=>({...current,...(typeof next==='function'?next(current):next)})),[])
 const send=useCallback(event=>{const dc=resources.current.dc;if(dc?.readyState!=='open')return false;try{dc.send(JSON.stringify(event));return true}catch{return false}},[])
 const postSession=useCallback(async(path,payload,{keepalive=false}={})=>{
  const sessionId=resources.current.sessionId;if(!sessionId)return null
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
  if(final&&!current.finalized&&current.sessionId){current.finalized=true;postSession('usage',{final:true,disconnectReason:reason},{keepalive:true}).catch(()=>null)}
  resources.current={pc:null,dc:null,stream:null,audio:null,timer:null,sessionId:'',finalized:false}
  marks.current=null;pendingUser.current='';assistantBuffers.current.clear();update({status:nextStatus,microphoneActive:false,sessionId:'',error:'',fallbackReason:nextStatus===STATES.FALLBACK?reason:''})
 },[postSession,update])
 const fail=useCallback(async(error,{fallback=true}={})=>{
  const code=String(error?.code||error?.name||'realtime_voice_failed')
  const message=error?.message||'O modo contínuo não está disponível agora. Use apertar para falar.'
  await cleanup({final:true,reason:code,nextStatus:fallback?STATES.FALLBACK:STATES.ERROR})
  update({error:message,fallbackReason:code})
  callbacks.current.onError?.(message,{code})
  return {ok:false,reason:code,error:message}
 },[cleanup,update])
 const reportUsage=useCallback(async event=>{
  const responseId=safeText(event?.response?.id||event?.response_id,180)
  const result=await postSession('usage',{responseId,usage:event?.response?.usage||{},final:false})
  if(result?.remainingUsd!=null)update({budgetRemainingUsd:result.remainingUsd})
  if(result?.exhausted){await fail(Object.assign(new Error('O teto autorizado do UAT realtime foi atingido.'),{code:'realtime_voice_budget_exhausted'}));return false}
  return true
 },[fail,postSession,update])
 const reportTurn=useCallback((userTranscript,assistantTranscript)=>postSession('turns',{userTranscript,assistantTranscript}).catch(()=>null),[postSession])
 const handleTool=useCallback(async event=>{
  let args={};try{args=JSON.parse(event.arguments||'{}')}catch{}
  let result
  try{
   if(event.name==='val_request_memory_review')result=await callbacks.current.onMemoryReview?.({candidate:safeText(args.candidate,1200)})||{status:'REVIEW_REQUIRED',message:'A revisão humana é obrigatória.'}
   else if(event.name==='val_governed_tool')result=await callbacks.current.onToolCall?.({request:safeText(args.request,1200),reason:safeText(args.reason,80)})||{status:'UNAVAILABLE',message:'A ferramenta governada não está conectada.'}
   else result={status:'DENIED',message:'Ferramenta não autorizada.'}
  }catch(error){result={status:'ERROR',message:safeText(error?.message||'A ferramenta falhou.',500)}}
  send(toolOutputEvent(event.call_id,result));send({type:'response.create'})
 },[send])
 const handleEvent=useCallback(async raw=>{
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
   const transcript=safeText(event.transcript);if(marks.current)marks.current.transcriptAvailable=now();pendingUser.current=transcript;if(transcript)callbacks.current.onUserTranscript?.(transcript);postSession('usage',{responseId:`transcript:${safeText(event.item_id,140)}`,kind:'TRANSCRIPTION',usage:event.usage||{},final:false}).then(result=>{if(result?.remainingUsd!=null)update({budgetRemainingUsd:result.remainingUsd});if(result?.exhausted)fail(Object.assign(new Error('O teto autorizado do UAT realtime foi atingido.'),{code:'realtime_voice_budget_exhausted'}))}).catch(()=>null);return
  }
  if(type==='response.created'){if(marks.current)marks.current.reasoningStarted=now();update({status:STATES.THINKING,microphoneActive:true});return}
  if(type==='response.output_audio_transcript.delta'){
   const key=event.response_id||event.item_id||'active';const next=(assistantBuffers.current.get(key)||'')+String(event.delta||'');assistantBuffers.current.set(key,next);if(marks.current&&!Number.isFinite(marks.current.firstResponseToken))marks.current.firstResponseToken=now();return
  }
  if(type==='response.output_audio_transcript.done'){
   const key=event.response_id||event.item_id||'active';const transcript=safeText(event.transcript||assistantBuffers.current.get(key));assistantBuffers.current.delete(key);if(transcript){callbacks.current.onAssistantTranscript?.(transcript);if(pendingUser.current)reportTurn(pendingUser.current,transcript);pendingUser.current=''}return
  }
  if(type==='output_audio_buffer.started'){if(marks.current&&!Number.isFinite(marks.current.firstAudio))marks.current.firstAudio=now();update({status:STATES.SPEAKING,microphoneActive:true});return}
  if(type==='output_audio_buffer.stopped'){update({status:STATES.LISTENING,microphoneActive:true});return}
  if(type==='response.function_call_arguments.done'){await handleTool(event);return}
  if(type==='response.done'){
   if(marks.current){marks.current.responseEnd=now();callbacks.current.onMetrics?.(realtimeLatencySample(marks.current,event.response?.status==='completed'?'SUCCESS':event.response?.status==='cancelled'?'CANCELLED':'ERROR'));marks.current=null}
   await reportUsage(event).catch(()=>null);return
  }
  if(type==='error')await fail(Object.assign(new Error(event.error?.message||'O provider realtime encerrou a sessão.'),{code:event.error?.code||'realtime_provider_error'}))
 },[fail,handleTool,reportTurn,reportUsage,update])
 const start=useCallback(async()=>{
  if(disabled)return {ok:false,reason:'DISABLED'}
  if(!capabilities.supported)return fail(Object.assign(new Error(!capabilities.secureContext?'Abra a VAL em uma conexão HTTPS segura.':'Este navegador não oferece WebRTC e microfone compatíveis.'),{code:!capabilities.secureContext?'INSECURE_CONTEXT':'WEBRTC_UNAVAILABLE'}))
  let permissionState='PROMPT';try{const permission=await navigator.permissions?.query?.({name:'microphone'});if(['granted','denied','prompt'].includes(permission?.state))permissionState=permission.state.toUpperCase()}catch{}
  update({status:STATES.CONNECTING,microphoneActive:false,microphonePermission:permissionState,error:'',fallbackReason:''})
  const audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.setAttribute('aria-hidden','true');audio.style.display='none';document.body.appendChild(audio);resources.current.audio=audio;audio.play().catch(()=>null)
  try{
   // Permission comes first: do not reserve budget or create a paid provider
   // session when the device cannot supply a microphone stream.
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});resources.current.stream=stream;update({microphonePermission:'GRANTED'})
   const sessionResponse=await fetch('/api/v1/realtime-voice/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,conversationId,activeContext})})
   const session=await sessionResponse.json().catch(()=>null)
   if(!sessionResponse.ok)throw Object.assign(new Error(session?.error||'O modo realtime não está disponível neste ambiente.'),{code:session?.code||'realtime_voice_session_unavailable'})
   resources.current.sessionId=session.sessionId;update({sessionId:session.sessionId,model:session.model,budgetRemainingUsd:session.budget?.remainingUsd??null})
   const pc=new RTCPeerConnection();resources.current.pc=pc
   pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState)&&resources.current.pc===pc)fail(Object.assign(new Error('A conexão realtime foi interrompida. Use apertar para falar.'),{code:`WEBRTC_${pc.connectionState.toUpperCase()}`}))}
   pc.ontrack=event=>{audio.srcObject=event.streams?.[0]||new MediaStream([event.track]);audio.play().catch(()=>null)}
   for(const track of stream.getAudioTracks())pc.addTrack(track,stream)
   const dc=pc.createDataChannel('oai-events');resources.current.dc=dc;dc.onmessage=event=>handleEvent(event.data);dc.onerror=()=>fail(Object.assign(new Error('O canal de eventos realtime falhou.'),{code:'WEBRTC_DATA_CHANNEL_ERROR'}));dc.onopen=()=>update({status:STATES.LISTENING,microphoneActive:true})
   const offer=await pc.createOffer();await pc.setLocalDescription(offer)
   const answerResponse=await fetch(session.callUrl,{method:'POST',body:offer.sdp,headers:{Authorization:`Bearer ${session.clientSecret}`,'Content-Type':'application/sdp'}})
   if(!answerResponse.ok)throw Object.assign(new Error('O provider recusou a conexão WebRTC.'),{code:'WEBRTC_PROVIDER_REJECTED'})
   await pc.setRemoteDescription({type:'answer',sdp:await answerResponse.text()})
   resources.current.timer=globalThis.setTimeout(()=>fail(Object.assign(new Error('A sessão atingiu o limite de duração do UAT.'),{code:'REALTIME_SESSION_TIME_LIMIT'})),Math.max(60,Number(session.maxSessionSeconds)||600)*1000)
   return {ok:true,transport:'WEBRTC',sessionId:session.sessionId}
  }catch(error){if(error?.code==='realtime_voice_disabled'){await cleanup({final:false,reason:error.code,nextStatus:STATES.IDLE});return {ok:false,reason:error.code,error:error.message}}if(error?.name==='NotAllowedError')update({microphonePermission:permissionState==='DENIED'?'DENIED':'BLOCKED'});else if(error?.name==='NotFoundError')update({microphonePermission:'UNAVAILABLE'});return fail(error)}
 },[activeContext,capabilities,clientId,conversationId,disabled,fail,handleEvent,update])
 useEffect(()=>{
  if(scopeKeyRef.current===scopeKey)return
  scopeKeyRef.current=scopeKey
  if(!resources.current.sessionId)return
  scopeReconnectPending.current=true
  cleanup({final:true,reason:'CONTEXT_SCOPE_CHANGED',nextStatus:STATES.CONNECTING}).catch(()=>null)
 },[cleanup,scopeKey])
 useEffect(()=>{
  if(disabled||!scopeReconnectPending.current||resources.current.sessionId)return
  scopeReconnectPending.current=false
  start().catch(()=>null)
 },[disabled,start,scopeKey])
 const pause=useCallback(()=>{for(const track of resources.current.stream?.getAudioTracks?.()||[])track.enabled=false;try{resources.current.audio?.pause()}catch{};update({status:STATES.PAUSED,microphoneActive:false});return true},[update])
 const resume=useCallback(()=>{for(const track of resources.current.stream?.getAudioTracks?.()||[])track.enabled=true;resources.current.audio?.play?.().catch(()=>null);update({status:STATES.LISTENING,microphoneActive:true});return true},[update])
 const bargeIn=useCallback(()=>{send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});update({status:STATES.LISTENING,microphoneActive:true});return true},[send,update])
 const exit=useCallback(()=>cleanup({final:true,reason:'USER_EXIT',nextStatus:STATES.IDLE}),[cleanup])
 useEffect(()=>{machineRef.current=machine;callbacks.current.onStateChange?.(machine)},[machine])
 useEffect(()=>()=>{
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
