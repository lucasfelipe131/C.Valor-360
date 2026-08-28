import React from 'react'
import {Keyboard,LoaderCircle,Mic,MicOff,Pause,Play,Power,RotateCcw,Volume2} from 'lucide-react'
import useRealtimeConversation from '../../hooks/useRealtimeConversation.js'
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
 className=''
}){
 const conversation=useRealtimeConversation({disabled,responseText,responseKey,processing,onTranscript,onError,onStateChange,onMetrics})
 const {state}=conversation
 const inactive=state.status===REALTIME_CONVERSATION_STATES.IDLE
 const unavailable=[REALTIME_CONVERSATION_STATES.ERROR,REALTIME_CONVERSATION_STATES.FALLBACK].includes(state.status)
 const paused=state.status===REALTIME_CONVERSATION_STATES.PAUSED
 const rootClass=['val-realtime-conversation',`is-${state.status.toLowerCase()}`,className].filter(Boolean).join(' ')
 const leave=()=>{conversation.exit();onExit?.()}

 if(inactive)return <button type="button" className="val-conversation-opt-in" onClick={()=>{onStart?.();conversation.start()}} disabled={disabled} aria-label="Iniciar modo conversa por voz"><Mic/><span><b>Modo conversa</b><small>Fale e ouça a VAL em turnos contínuos</small></span></button>

 return <section className={rootClass} aria-label="Modo conversa por voz" data-version={REALTIME_CONVERSATION_POLICY.version} data-microphone-active={state.microphoneActive?'true':'false'}>
  <div className="val-conversation-status" role="status" aria-live="polite">
   <span className="val-conversation-mic" aria-hidden="true">{state.microphoneActive?<Mic/>:<MicOff/>}</span>
   <span><b>{state.label}</b><small>{state.microphoneActive?'Microfone ativo neste turno':state.status===REALTIME_CONVERSATION_STATES.PROCESSING?'Microfone desligado enquanto a VAL raciocina':state.status===REALTIME_CONVERSATION_STATES.SPEAKING?'Microfone desligado; você pode interromper':'Microfone desligado'}</small></span>
   {state.status===REALTIME_CONVERSATION_STATES.PROCESSING&&<LoaderCircle className="val-conversation-spinner" aria-hidden="true"/>}
   {state.status===REALTIME_CONVERSATION_STATES.SPEAKING&&<Volume2 className="val-conversation-speaking" aria-hidden="true"/>}
  </div>

  {state.interimTranscript&&state.isListening&&<p className="val-conversation-interim" aria-label="Transcrição em andamento">{state.interimTranscript}</p>}

  {unavailable&&<div className="val-conversation-fallback">
   <p>O modo contínuo não está disponível agora. A conversa pode continuar por voz sob demanda ou texto.</p>
   <div>
    {onFallbackPushToTalk&&<button type="button" onClick={onFallbackPushToTalk}><Mic/><span>Apertar para falar</span></button>}
    {onFallbackText&&<button type="button" onClick={onFallbackText}><Keyboard/><span>Digitar</span></button>}
   </div>
  </div>}

  <div className="val-conversation-controls" role="group" aria-label="Controles do modo conversa">
   {!unavailable&&state.canBargeIn&&<button type="button" className="is-primary" onClick={conversation.bargeIn} aria-label="Interromper a VAL e falar"><RotateCcw/><span>Interromper e falar</span></button>}
   {!unavailable&&!paused&&state.status!==REALTIME_CONVERSATION_STATES.PROCESSING&&<button type="button" onClick={conversation.pause} aria-label="Pausar modo conversa"><Pause/><span>Pausar</span></button>}
   {!unavailable&&paused&&<button type="button" className="is-primary" onClick={conversation.resume} aria-label="Retomar modo conversa"><Play/><span>Retomar</span></button>}
   <button type="button" onClick={leave} aria-label="Sair do modo conversa"><Power/><span>Sair</span></button>
  </div>

  <p className="val-conversation-privacy">O microfone só fica ativo quando o indicador mostra “Ouvindo”. Cada captura termina no fim do turno; sair cancela voz e áudio.</p>
 </section>
}
