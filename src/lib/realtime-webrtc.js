export const NATURAL_REALTIME_VERSION='val.natural_realtime_voice.v1'
export const NATURAL_REALTIME_STATES=Object.freeze({IDLE:'IDLE',CONNECTING:'CONNECTING',LISTENING:'LISTENING',THINKING:'THINKING',SPEAKING:'SPEAKING',PAUSED:'PAUSED',FALLBACK:'FALLBACK',ERROR:'ERROR'})

export function realtimeWebRTCCapabilities(scope=globalThis){
 const navigatorValue=scope?.navigator
 return Object.freeze({
  secureContext:scope?.isSecureContext===true,
  peerConnection:typeof scope?.RTCPeerConnection==='function',
  mediaDevices:Boolean(navigatorValue?.mediaDevices&&typeof navigatorValue.mediaDevices.getUserMedia==='function'),
  audioElement:Boolean(scope?.document&&typeof scope.document.createElement==='function'),
  supported:scope?.isSecureContext===true&&typeof scope?.RTCPeerConnection==='function'&&Boolean(navigatorValue?.mediaDevices&&typeof navigatorValue.mediaDevices.getUserMedia==='function')
 })
}

export function parseRealtimeEvent(value){
 try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&typeof parsed.type==='string'?parsed:null}catch{return null}
}

export const realtimeStatusLabel=status=>({
 IDLE:'Modo conversa desligado',CONNECTING:'Conectando',LISTENING:'Ouvindo',THINKING:'Pensando',SPEAKING:'Falando',PAUSED:'Pausado',FALLBACK:'Modo conversa indisponível',ERROR:'Falha no modo conversa'
}[String(status||'')]||'Modo conversa desligado')

const duration=(from,to)=>Number.isFinite(from)&&Number.isFinite(to)?Math.max(0,Number((to-from).toFixed(3))):null
export function realtimeLatencySample(marks={},outcome='SUCCESS'){
 return Object.freeze({source:'BROWSER_VOICE_TURN',contractVersion:'val.conversation_latency.browser_voice_turn.v1',serviceClass:'VOICE',outcome,metrics:{
  speech_end_to_turn_detected:duration(marks.speechEnd,marks.turnDetected),
  speech_end_to_transcript:duration(marks.speechEnd,marks.transcriptAvailable),
  speech_end_to_first_useful_text:duration(marks.speechEnd,marks.firstResponseToken),
  speech_end_to_first_audio:duration(marks.speechEnd,marks.firstAudio),
  transcript_to_first_reasoning:duration(marks.transcriptAvailable,marks.reasoningStarted),
  reasoning_to_first_text:duration(marks.reasoningStarted,marks.firstResponseToken),
  reasoning_to_first_audio:duration(marks.reasoningStarted,marks.firstAudio),
  browser_voice_turn_total_latency:duration(marks.speechEnd,marks.responseEnd)
 },contentFree:true})
}

export function toolOutputEvent(callId,output){return {type:'conversation.item.create',item:{type:'function_call_output',call_id:String(callId||''),output:JSON.stringify(output??{})}}}
