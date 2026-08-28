export const REALTIME_CONVERSATION_VERSION='val.realtime_conversation.v1'

export const REALTIME_CONVERSATION_STATES=Object.freeze({
 IDLE:'IDLE',
 LISTENING:'LISTENING',
 TURN_DETECTED:'TURN_DETECTED',
 PROCESSING:'PROCESSING',
 SPEAKING:'SPEAKING',
 PAUSED:'PAUSED',
 ERROR:'ERROR',
 FALLBACK:'FALLBACK'
})

export const REALTIME_CONVERSATION_POLICY=Object.freeze({
 version:REALTIME_CONVERSATION_VERSION,
 opt_in:true,
 language:'pt-BR',
 recognition_continuous:false,
 persistence:'NONE',
 permanent_microphone:false,
 rearm:'AFTER_ASSISTANT_SPEECH',
 fallback:'PUSH_TO_TALK_OR_TEXT'
})

export const REALTIME_CONVERSATION_EVENTS=Object.freeze({
 OPT_IN:'OPT_IN',
 INPUT_STARTED:'INPUT_STARTED',
 INPUT_ENDED:'INPUT_ENDED',
 TURN_DETECTED:'TURN_DETECTED',
 PROCESS:'PROCESS',
 SPEECH_STARTED:'SPEECH_STARTED',
 SPEECH_PAUSED:'SPEECH_PAUSED',
 SPEECH_RESUMED:'SPEECH_RESUMED',
 SPEECH_ENDED:'SPEECH_ENDED',
 PAUSE:'PAUSE',
 RESUME:'RESUME',
 BARGE_IN:'BARGE_IN',
 ERROR:'ERROR',
 FALLBACK:'FALLBACK',
 EXIT:'EXIT'
})

const stateValues=new Set(Object.values(REALTIME_CONVERSATION_STATES))

export function createRealtimeConversationState(){
 return {
  version:REALTIME_CONVERSATION_VERSION,
  status:REALTIME_CONVERSATION_STATES.IDLE,
  optedIn:false,
  microphoneActive:false,
  pauseReason:'',
  turnReason:'',
  error:''
 }
}

const normalizedState=value=>stateValues.has(value?.status)?value:createRealtimeConversationState()

export function transitionRealtimeConversation(current,event={}){
 const state=normalizedState(current)
 const type=String(event.type||'')
 const states=REALTIME_CONVERSATION_STATES
 const base={...state,error:''}

 switch(type){
  case REALTIME_CONVERSATION_EVENTS.OPT_IN:
   if(event.inputSupported===false||event.outputSupported===false)return {...base,status:states.FALLBACK,optedIn:false,microphoneActive:false,pauseReason:'',error:String(event.reason||'VOICE_UNAVAILABLE')}
   return {...base,status:states.LISTENING,optedIn:true,microphoneActive:false,pauseReason:'',turnReason:''}
  case REALTIME_CONVERSATION_EVENTS.INPUT_STARTED:
   if(!state.optedIn)return state
   return {...base,status:states.LISTENING,microphoneActive:true,pauseReason:'',turnReason:''}
  case REALTIME_CONVERSATION_EVENTS.INPUT_ENDED:
   if(state.status!==states.LISTENING)return state
   return {...base,status:states.PAUSED,microphoneActive:false,pauseReason:String(event.reason||'NO_TURN')}
  case REALTIME_CONVERSATION_EVENTS.TURN_DETECTED:
   if(!state.optedIn||state.status!==states.LISTENING)return state
   return {...base,status:states.TURN_DETECTED,microphoneActive:false,pauseReason:'',turnReason:String(event.reason||'FINAL_RESULT')}
  case REALTIME_CONVERSATION_EVENTS.PROCESS:
   if(!state.optedIn||![states.TURN_DETECTED,states.PROCESSING].includes(state.status))return state
   return {...base,status:states.PROCESSING,microphoneActive:false,pauseReason:''}
  case REALTIME_CONVERSATION_EVENTS.SPEECH_STARTED:
  case REALTIME_CONVERSATION_EVENTS.SPEECH_RESUMED:
   if(!state.optedIn)return state
   return {...base,status:states.SPEAKING,microphoneActive:false,pauseReason:''}
  case REALTIME_CONVERSATION_EVENTS.SPEECH_PAUSED:
   if(!state.optedIn||state.status!==states.SPEAKING)return state
   return {...base,status:states.PAUSED,microphoneActive:false,pauseReason:'SPEECH'}
  case REALTIME_CONVERSATION_EVENTS.SPEECH_ENDED:
   if(!state.optedIn)return {...base,status:states.IDLE,microphoneActive:false,pauseReason:'',turnReason:''}
   return {...base,status:states.LISTENING,microphoneActive:false,pauseReason:'',turnReason:''}
  case REALTIME_CONVERSATION_EVENTS.PAUSE:
   if(!state.optedIn)return state
   return {...base,status:states.PAUSED,microphoneActive:false,pauseReason:String(event.reason||'USER')}
  case REALTIME_CONVERSATION_EVENTS.RESUME:
  case REALTIME_CONVERSATION_EVENTS.BARGE_IN:
   if(!state.optedIn)return state
   return {...base,status:states.LISTENING,microphoneActive:false,pauseReason:'',turnReason:''}
  case REALTIME_CONVERSATION_EVENTS.ERROR:
   return {...base,status:states.ERROR,optedIn:false,microphoneActive:false,pauseReason:'',error:String(event.error||'VOICE_ERROR')}
  case REALTIME_CONVERSATION_EVENTS.FALLBACK:
   return {...base,status:states.FALLBACK,optedIn:false,microphoneActive:false,pauseReason:'',error:String(event.reason||'VOICE_UNAVAILABLE')}
  case REALTIME_CONVERSATION_EVENTS.EXIT:
   return createRealtimeConversationState()
  default:
   return state
 }
}

export const realtimeConversationStatusLabel=status=>({
 IDLE:'Modo conversa desligado',
 LISTENING:'Ouvindo',
 TURN_DETECTED:'Fim do turno detectado',
 PROCESSING:'Processando',
 SPEAKING:'Falando',
 PAUSED:'Modo conversa pausado',
 ERROR:'Erro no modo conversa',
 FALLBACK:'Voz contínua indisponível'
}[String(status||'')]||'Modo conversa desligado')

export const webSpeechRecognitionAvailable=SpeechRecognition=>typeof SpeechRecognition==='function'

export function mapSpeechRecognitionError(code){
 const normalized=String(code||'').toLowerCase()
 if(normalized==='not-allowed'||normalized==='service-not-allowed')return {code:'MICROPHONE_PERMISSION_DENIED',message:'Permita o uso do microfone para conversar com a VAL.'}
 if(normalized==='audio-capture')return {code:'MICROPHONE_UNAVAILABLE',message:'O microfone não está disponível neste dispositivo.'}
 if(normalized==='network')return {code:'SPEECH_SERVICE_UNAVAILABLE',message:'O serviço de voz do navegador está indisponível. Use apertar para falar ou texto.'}
 if(normalized==='language-not-supported')return {code:'LANGUAGE_UNAVAILABLE',message:'O reconhecimento em português não está disponível neste navegador.'}
 return {code:'SPEECH_NOT_UNDERSTOOD',message:'Não consegui ouvir com clareza. Tente novamente ou use texto.'}
}

export const normalizeRealtimeTranscript=value=>String(value??'')
 .replace(/[\u0000-\u001F\u007F]/g,' ')
 .replace(/\s+/g,' ')
 .trim()
 .slice(0,4_000)

const defaultSchedule=(callback,delay)=>globalThis.setTimeout(callback,delay)
const defaultCancel=timer=>globalThis.clearTimeout(timer)

export function createWebSpeechInputProvider({
 SpeechRecognition,
 language='pt-BR',
 silenceMs=1_250,
 maximumTurnMs=30_000,
 clock=()=>globalThis.performance?.now?.()??Date.now(),
 schedule=defaultSchedule,
 cancel=defaultCancel,
 onListeningChange=()=>{},
 onInterim=()=>{},
 onTurn=()=>{},
 onError=()=>{},
 onNoTurn=()=>{}
}={}){
 const supported=webSpeechRecognitionAvailable(SpeechRecognition)
 let recognition=null
 let silenceTimer=null
 let maximumTimer=null
 let active=false
 let disposed=false
 let emitted=false
 let transcript=''
 let stopReason=''
 let lastResultAt=null

 const clearTimers=()=>{
  if(silenceTimer!==null)cancel(silenceTimer)
  if(maximumTimer!==null)cancel(maximumTimer)
  silenceTimer=null
  maximumTimer=null
 }
 const detach=value=>{
  if(!value)return
  value.onstart=null
  value.onresult=null
  value.onerror=null
  value.onend=null
 }
 const emitTurn=reason=>{
  if(emitted)return false
  const normalized=normalizeRealtimeTranscript(transcript)
  if(!normalized)return false
  emitted=true
  clearTimers()
  const transcriptAt=Number(clock())
  const speechEndAt=Number.isFinite(lastResultAt)?lastResultAt:transcriptAt
  onTurn(normalized,{reason,language,speechEndAt,transcriptAt,endpointSource:reason==='FINAL_RESULT'?'WEB_SPEECH_FINAL_RESULT':'LAST_RECOGNITION_RESULT'})
  return true
 }
 const requestStop=reason=>{
  stopReason=reason
  clearTimers()
  if(!recognition)return
  try{recognition.stop()}catch{}
 }
 const scheduleSilence=()=>{
  if(silenceTimer!==null)cancel(silenceTimer)
  silenceTimer=schedule(()=>{
   silenceTimer=null
   if(disposed||!active)return
   requestStop(normalizeRealtimeTranscript(transcript)?'SILENCE':'NO_SPEECH')
  },Math.max(400,Number(silenceMs)||1_250))
 }

 const start=()=>{
  if(disposed||!supported||active)return false
  let next
  try{next=new SpeechRecognition()}catch(error){onError({code:'RECOGNITION_START_FAILED',message:'Não foi possível iniciar o reconhecimento de voz.',cause:error});return false}
  recognition=next
  active=true
  emitted=false
  transcript=''
  stopReason=''
  lastResultAt=null
  next.lang=language
  next.continuous=false
  next.interimResults=true
  next.maxAlternatives=1
  next.onstart=()=>{
   if(disposed||recognition!==next)return
   onListeningChange(true,{reason:'STARTED'})
  }
  next.onresult=event=>{
   if(disposed||recognition!==next||emitted)return
   lastResultAt=Number(clock())
   const finalParts=[]
   const interimParts=[]
   let hasFinal=false
   const results=event?.results||[]
   for(let index=0;index<results.length;index+=1){
    const value=normalizeRealtimeTranscript(results[index]?.[0]?.transcript)
    if(!value)continue
    if(results[index]?.isFinal){finalParts.push(value);hasFinal=true}
    else interimParts.push(value)
   }
   transcript=normalizeRealtimeTranscript([...finalParts,...interimParts].join(' '))
   if(transcript)onInterim(transcript,{final:hasFinal})
   if(hasFinal)requestStop('FINAL_RESULT')
   else if(transcript)scheduleSilence()
  }
  next.onerror=event=>{
   if(disposed||recognition!==next)return
   const mapped=mapSpeechRecognitionError(event?.error)
   stopReason=mapped.code
   clearTimers()
   active=false
   onListeningChange(false,{reason:mapped.code})
   if(mapped.code==='SPEECH_NOT_UNDERSTOOD')onNoTurn({reason:mapped.code})
   else onError(mapped)
  }
  next.onend=()=>{
   if(disposed||recognition!==next)return
   clearTimers()
   active=false
   recognition=null
   onListeningChange(false,{reason:stopReason||'BROWSER_END'})
   if(!emitted){
    if(!emitTurn(stopReason||'BROWSER_END'))onNoTurn({reason:stopReason||'NO_TURN'})
   }
   detach(next)
  }
  maximumTimer=schedule(()=>{
   maximumTimer=null
   if(disposed||!active)return
   requestStop(normalizeRealtimeTranscript(transcript)?'MAXIMUM_TURN':'NO_SPEECH')
  },Math.max(5_000,Number(maximumTurnMs)||30_000))
  try{next.start();return true}catch(error){
   clearTimers()
   active=false
   recognition=null
   detach(next)
   onError({code:'RECOGNITION_START_FAILED',message:'O microfone já está sendo usado por outra captura.',cause:error})
   return false
  }
 }

 const stop=({emitPartial=false,reason='USER_PAUSE'}={})=>{
  if(disposed||!recognition)return false
  if(!emitPartial){emitted=true;transcript='';onInterim('',{final:false,discarded:true})}
  requestStop(reason)
  return true
 }
 const abort=({reason='EXIT'}={})=>{
  clearTimers()
  const previous=recognition
  recognition=null
  active=false
  emitted=true
  stopReason=reason
  if(previous){
   detach(previous)
   try{previous.abort()}catch{try{previous.stop()}catch{}}
  }
  onListeningChange(false,{reason})
  return Boolean(previous)
 }
 const dispose=()=>{
  if(disposed)return
  abort({reason:'DISPOSED'})
  disposed=true
 }

 return {
  supported,
  start,
  stop,
  abort,
  dispose,
  getSnapshot:()=>({supported,active,disposed,hasRecognition:Boolean(recognition),transcript:normalizeRealtimeTranscript(transcript)})
 }
}

export const responseTextFromConversationTurn=value=>{
 if(typeof value==='string')return String(value).trim()
 for(const candidate of [value?.responseText,value?.speakableText,value?.text,value?.answer]){
  const normalized=String(candidate||'').trim()
  if(normalized)return normalized
 }
 return ''
}
