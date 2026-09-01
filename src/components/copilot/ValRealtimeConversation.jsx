import React,{useState} from 'react'
import {Keyboard,LoaderCircle,Mic,MicOff,Pause,Play,Power,RotateCcw,Volume2} from 'lucide-react'
import useRealtimeConversation from '../../hooks/useRealtimeConversation.js'
import useNaturalRealtimeVoice from '../../hooks/useNaturalRealtimeVoice.js'
import {REALTIME_CONVERSATION_POLICY,REALTIME_CONVERSATION_STATES} from '../../lib/realtime-conversation.js'
import '../../val-realtime-conversation.css'

export default function ValRealtimeConversation({
 disabled=false,
 responseText='',
 responseKey='',
 processing=false,
 onTranscript,
 onError,
 onStateChange,
 onMetrics,
 onStart,
 onExit,
 onFallbackPushToTalk,
 onFallbackText,
 realtimeContext,
 onRealtimeUserTranscript,
 onRealtimeAssistantTranscript,
 onRealtimeToolCall,
 onRealtimeMemoryReview,
 className=''
}){
 const [transport,setTransport]=useState('natural')
 const legacy=useRealtimeConversation({disabled,responseText,responseKey,processing,onTranscript,onError,onStateChange,onMetrics})
 const natural=useNaturalRealtimeVoice({disabled,clientId:realtimeContext?.clientId||'',conversationId:realtimeContext?.conversationId||'',contextEpoch:realtimeContext?.contextEpoch??0,activeContext:realtimeContext?.activeContext||null,onUserTranscript:onRealtimeUserTranscript,onAssistantTranscript:onRealtimeAssistantTranscript,onToolCall:onRealtimeToolCall,onMemoryReview:onRealtimeMemoryReview,onError,onStateChange,onMetrics})
 const conversation=transport==='legacy'?legacy:natural
 const {state}=conversation
 const inactive=state.status===REALTIME_CONVERSATION_STATES.IDLE
 const unavailable=[REALTIME_CONVERSATION_STATES.ERROR,REALTIME_CONVERSATION_STATES.FALLBACK].includes(state.status)
 const paused=state.status===REALTIME_CONVERSATION_STATES.PAUSED
 const rootClass=['val-realtime-conversation',`is-${state.status.toLowerCase()}`,className].filter(Boolean).join(' ')
 const leave=()=>{conversation.exit();onExit?.()}
 const start=async()=>{
  onStart?.();setTransport('natural')
  const result=await natural.start()
  if(!result?.ok&&result?.reason==='realtime_voice_disabled'){setTransport('legacy');legacy.start()}
 }
 const retry=async()=>{setTransport('natural');await natural.start()}

 if(inactive)return <button type="button" className="val-conversation-opt-in" onClick={start} disabled={disabled} aria-label="Iniciar modo conversa por voz"><Mic/><span><b>Modo conversa</b><small>Fale e ouça a VAL sem enviar a cada turno</small></span></button>

 return <section className={rootClass} aria-label="Modo conversa por voz" data-version={state.version||REALTIME_CONVERSATION_POLICY.version} data-transport={state.transport||'WEB_SPEECH'} data-microphone-active={state.microphoneActive?'true':'false'}>
  <div className="val-conversation-orb" aria-hidden="true"><span className="val-orb-ring r3"></span><span className="val-orb-ring r2"></span><span className="val-orb-ring"></span><span className="val-orb-core"></span></div>
  <div className="val-conversation-status" role="status" aria-live="polite">
   <span className="val-conversation-mic" aria-hidden="true">{state.microphoneActive?<Mic/>:<MicOff/>}</span>
   <span><b>{state.label}</b><small>{state.microphoneActive?state.isSpeaking?'Microfone ativo para permitir interrupção':'Microfone ativo e indicado':state.status===REALTIME_CONVERSATION_STATES.PROCESSING||state.status==='THINKING'?'A VAL está preparando a resposta':state.status===REALTIME_CONVERSATION_STATES.SPEAKING?'Você pode interromper':'Microfone desligado'}</small></span>
   {(state.status===REALTIME_CONVERSATION_STATES.PROCESSING||state.status==='THINKING'||state.status==='CONNECTING')&&<LoaderCircle className="val-conversation-spinner" aria-hidden="true"/>}
   {state.status===REALTIME_CONVERSATION_STATES.SPEAKING&&<Volume2 className="val-conversation-speaking" aria-hidden="true"/>}
  </div>

  {state.interimTranscript&&state.isListening&&<p className="val-conversation-interim" aria-label="Transcrição em andamento">{state.interimTranscript}</p>}

  {unavailable&&<div className="val-conversation-fallback">
   <p>{state.fallbackReason==='MICROPHONE_PERMISSION_DENIED'||state.fallbackReason==='NotAllowedError'?'Permita o microfone nos ajustes do Safari/site e tente novamente.':'O modo contínuo não está disponível agora. Você ainda pode falar tocando no microfone.'}</p>
   <div>
    {transport==='natural'&&<button type="button" onClick={retry}><RotateCcw/><span>Tentar modo conversa novamente</span></button>}
    {onFallbackPushToTalk&&<button type="button" onClick={onFallbackPushToTalk}><Mic/><span>Apertar para falar</span></button>}
    {onFallbackText&&<button type="button" onClick={onFallbackText}><Keyboard/><span>Digitar</span></button>}
   </div>
  </div>}

  <div className="val-conversation-controls" role="group" aria-label="Controles do modo conversa">
   {!unavailable&&state.canBargeIn&&<button type="button" className="is-primary" onClick={conversation.bargeIn} aria-label="Interromper a VAL e falar"><RotateCcw/><span>Interromper e falar</span></button>}
   {!unavailable&&!paused&&state.status!==REALTIME_CONVERSATION_STATES.PROCESSING&&state.status!=='THINKING'&&state.status!=='CONNECTING'&&<button type="button" onClick={conversation.pause} aria-label="Pausar modo conversa"><Pause/><span>Pausar</span></button>}
   {!unavailable&&paused&&<button type="button" className="is-primary" onClick={conversation.resume} aria-label="Retomar modo conversa"><Play/><span>Retomar</span></button>}
   <button type="button" onClick={leave} aria-label="Sair do modo conversa"><Power/><span>Sair</span></button>
  </div>

  <p className="val-conversation-privacy">O microfone só fica ativo quando o indicador informa isso. No WebRTC ele permanece ativo para detectar turnos e interrupções; pausar ou sair encerra a captura.</p>
 </section>
}
