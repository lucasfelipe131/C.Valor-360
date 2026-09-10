import React,{useEffect,useRef} from 'react'
import {Keyboard,LoaderCircle,Mic,MicOff,Play,Power,RotateCcw,Volume2} from 'lucide-react'
import useNaturalRealtimeVoice from '../../hooks/useNaturalRealtimeVoice.js'
import {REALTIME_CONVERSATION_POLICY,REALTIME_CONVERSATION_STATES} from '../../lib/realtime-conversation.js'
import '../../val-realtime-conversation.css'

const countdownLabel=seconds=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`
const readableVoiceError=(message,fallback)=>{
 const text=String(message||'').trim()
 return !text||/max_output_tokens|response\.[a-z_]+|rate_limit_exceeded|invalid_request_error|\b(?:HTTP|status)\s*[45]\d\d\b/i.test(text)?fallback:text
}

/** The voice stage presents the session state without opening a microphone. */
export function ValRealtimeConversationStage({
 state,disabled=false,processing=false,errorMessage='',retryAfterSeconds=0,canRetry=true,liveTranscript='',
 onRetry,onRetryTurn,onPause,onResume,onResumeAudio,onInterrupt,onExit,onFallbackPushToTalk,onFallbackText,className=''
}){
 const contentRef=useRef(null)
 const followTranscriptRef=useRef(true)
 const unavailable=[REALTIME_CONVERSATION_STATES.ERROR,REALTIME_CONVERSATION_STATES.FALLBACK].includes(state.status)
 const paused=state.status===REALTIME_CONVERSATION_STATES.PAUSED
 const connecting=state.status==='CONNECTING'
 // `processing` e o trabalho do proprio copiloto (ferramenta governada em voo): o palco precisa
 // dizer que esta preparando a resposta em vez de convidar o consultor a falar.
 const thinking=processing||[REALTIME_CONVERSATION_STATES.PROCESSING,REALTIME_CONVERSATION_STATES.TURN_DETECTED,'THINKING'].includes(state.status)
 const speaking=state.status===REALTIME_CONVERSATION_STATES.SPEAKING
 const recovering=!unavailable&&!paused&&Boolean(state.recoveringTurn)
 const turnRetryAvailable=!unavailable&&Boolean(state.canRetryTurn)
 const turnRetryDisabled=disabled||paused||connecting||thinking||speaking||recovering
 const remaining=Math.max(0,Math.ceil(Number(state.retryAfterSeconds||retryAfterSeconds)||0))
 const retryDisabled=disabled||!canRetry||state.canRetry===false||remaining>0
 const userTranscript=String(state.interimTranscript||liveTranscript||'').trim()
 const assistantTranscript=String(state.assistantTranscript||'').trim()
 const displayStatus=unavailable?state.status.toLowerCase():paused?'paused':connecting?'connecting':recovering?'recovering':turnRetryAvailable?'turn-interrupted':speaking?'speaking':thinking?'thinking':state.status.toLowerCase()
 const rootClass=['val-realtime-conversation','has-fixed-controls',`is-${displayStatus}`,className].filter(Boolean).join(' ')
 const label=unavailable?'A conversa foi interrompida':paused?'Conversa pausada':connecting?'Conectando sua conversa':recovering?'Recuperando a resposta':turnRetryAvailable?'Resposta interrompida':speaking?'VAL está falando':thinking?'Pensando na sua pergunta':state.microphoneActive?'Estou ouvindo':state.label||'Preparando o microfone'
 const detail=unavailable?'Seu microfone está desligado. Você pode continuar por texto.':paused?'Retome quando quiser. Seu microfone está desligado.':connecting?'Um instante. Estamos preparando o áudio.':recovering?'Sua pergunta foi preservada. Estou tentando concluir a resposta.':turnRetryAvailable?'Sua pergunta foi preservada. A nova tentativa começa a resposta desde o início.':speaking?state.canBargeIn?'Pode me interromper para perguntar ou complementar.':'Estou concluindo a resposta em áudio.':thinking?'Estou preparando a resposta.':state.microphoneActive?'Fale naturalmente. Eu respondo quando você terminar.':'Aguarde o indicador de microfone ativo para falar.'
 const permissionDenied=['MICROPHONE_PERMISSION_DENIED','NotAllowedError'].includes(state.fallbackReason)
 const failureText=permissionDenied?'Permita o microfone nas configurações deste site no navegador e tente novamente.':readableVoiceError(errorMessage||state.error,'Não foi possível manter a conexão de voz. Você pode tentar novamente ou continuar por texto.')
 const turnFailureText=readableVoiceError(state.error,turnRetryAvailable?'Não consegui concluir esta resposta. Sua pergunta foi preservada.':'Não consegui concluir esta resposta. Você pode continuar por texto.')
 const trackTranscriptScroll=()=>{const content=contentRef.current;if(content)followTranscriptRef.current=content.scrollHeight-content.scrollTop-content.clientHeight<56}
 useEffect(()=>{const content=contentRef.current;if(content&&followTranscriptRef.current)content.scrollTop=content.scrollHeight},[userTranscript,assistantTranscript,state.error,recovering])

 return <section className={rootClass} aria-label="Modo conversa por voz" data-version={state.version||REALTIME_CONVERSATION_POLICY.version} data-transport={state.transport||'WEBRTC'} data-microphone-active={state.microphoneActive?'true':'false'}>
  <div className="val-conversation-topline">
   <span className="val-conversation-eyebrow">Conversa por voz</span>
   <span className={`val-conversation-connection ${state.microphoneActive?'is-live':''}`}><span aria-hidden="true"/>{connecting?'Conectando':state.microphoneActive?'Microfone ativo':'Microfone desligado'}</span>
  </div>
  <div className="val-conversation-stage">
   <div className="val-conversation-orb" aria-hidden="true"><span className="val-orb-ring r3"/><span className="val-orb-ring r2"/><span className="val-orb-ring"/><span className="val-orb-core"/><span className="val-orb-shimmer"/></div>
   <div className="val-conversation-status" role="status" aria-live="polite" aria-atomic="true">
    <div className="val-conversation-status-title">
     <span className="val-conversation-mic" aria-hidden="true">{unavailable||paused?<MicOff/>:connecting||recovering?<LoaderCircle className="val-conversation-spinner"/>:turnRetryAvailable?<RotateCcw/>:speaking?<Volume2 className="val-conversation-speaking"/>:thinking?<LoaderCircle className="val-conversation-spinner"/>:state.microphoneActive?<Mic/>:<MicOff/>}</span>
     <h2>{label}</h2>
    </div>
    <p>{detail}</p>
   </div>
  </div>
  <div ref={contentRef} className="val-conversation-content" role="region" aria-label="Transcrição da conversa" tabIndex={0} onScroll={trackTranscriptScroll}>
  {(userTranscript||assistantTranscript)&&<div className="val-conversation-transcript">
   {userTranscript&&<div className="val-conversation-transcript-turn is-user"><span>Você</span><p className="val-conversation-interim" aria-label="Sua transcrição">{userTranscript}</p></div>}
   {assistantTranscript&&<div className="val-conversation-transcript-turn is-assistant"><span>VAL{turnRetryAvailable?' · Resposta incompleta':''}</span><p>{assistantTranscript}</p></div>}
  </div>}
  {unavailable&&<div className="val-conversation-fallback">
   <p role="alert">{failureText}</p>
   {remaining>0&&<p className="val-conversation-retry-note">Nova tentativa disponível em <strong role="timer" aria-live="off">{countdownLabel(remaining)}</strong>. Não é preciso clicar novamente enquanto aguarda.</p>}
   <div>
    <button type="button" className="is-primary" onClick={onRetry} disabled={retryDisabled} aria-label="Tentar modo conversa novamente"><RotateCcw/><span>{remaining>0?`Aguarde ${countdownLabel(remaining)}`:'Tentar novamente'}</span></button>
    {onFallbackPushToTalk&&<button type="button" onClick={onFallbackPushToTalk}><Mic/><span>Apertar para falar</span></button>}
   </div>
  </div>}
  {!unavailable&&!recovering&&!turnRetryAvailable&&state.error&&<p className="val-conversation-notice" role="alert">{turnFailureText}</p>}
  </div>
  <div className="val-conversation-footer">
  <div className="val-conversation-controls" role="group" aria-label="Controles do modo conversa">
   {turnRetryAvailable&&onRetryTurn&&<button type="button" className="val-conversation-control is-primary is-turn-retry" onClick={onRetryTurn} disabled={turnRetryDisabled} aria-label="Tentar responder novamente sem repetir a pergunta"><RotateCcw/><span>Tentar novamente</span></button>}
   {!unavailable&&state.audioBlocked&&onResumeAudio&&<button type="button" className="val-conversation-control is-primary" onClick={onResumeAudio} aria-label="Retomar áudio da VAL"><Volume2/><span>Retomar áudio</span></button>}
   {!unavailable&&!paused&&!connecting&&<button type="button" className="val-conversation-control" onClick={onPause} aria-label="Pausar modo conversa e desligar o microfone"><MicOff/><span>Pausar</span></button>}
   {!unavailable&&paused&&<button type="button" className="val-conversation-control is-primary" onClick={onResume} aria-label="Retomar modo conversa"><Play/><span>Retomar</span></button>}
   {!unavailable&&state.canBargeIn&&<button type="button" className="val-conversation-control is-primary" onClick={onInterrupt} aria-label="Interromper a VAL e falar"><RotateCcw/><span>Interromper</span></button>}
   {onFallbackText&&<button type="button" className="val-conversation-control" onClick={onFallbackText} aria-label="Continuar a conversa por texto"><Keyboard/><span>Digitar</span></button>}
   <button type="button" className="val-conversation-control is-stop" onClick={onExit} aria-label="Sair do modo conversa"><Power/><span>Encerrar</span></button>
  </div>
  <p className="val-conversation-privacy">Você controla o microfone. Pausar ou encerrar desliga a captura de áudio.</p>
  </div>
 </section>
}

export default function ValRealtimeConversation({
 disabled=false,responseText='',responseKey='',processing=false,onTranscript,onError,onStateChange,onMetrics,onStart,onExit,
 onFallbackPushToTalk,onFallbackText,realtimeContext,onRealtimeUserTranscript,onRealtimeAssistantTranscript,onRealtimeToolCall,
 onRealtimeMemoryReview,onRealtimeContextSync,retryAfterSeconds=0,errorMessage='',canRetry=true,liveTranscript='',className='',autoStartKey=''
}){
 const conversation=useNaturalRealtimeVoice({disabled,clientId:realtimeContext?.clientId||'',conversationId:realtimeContext?.conversationId||'',contextEpoch:realtimeContext?.contextEpoch??0,activeContext:realtimeContext?.activeContext||null,onUserTranscript:onRealtimeUserTranscript,onAssistantTranscript:onRealtimeAssistantTranscript,onToolCall:onRealtimeToolCall,onMemoryReview:onRealtimeMemoryReview,onContextSync:onRealtimeContextSync,onError,onStateChange,onMetrics})
 const {state}=conversation
 const start=async()=>{
  onStart?.()
  return conversation.start()
 }
 const leave=async()=>{await conversation.exit();onExit?.()}
 const switchTo=callback=>async()=>{await conversation.exit();onExit?.();callback?.()}
 const inactive=state.status===REALTIME_CONVERSATION_STATES.IDLE
 // Quem tocou em "Falar com a VAL" já disse o que quer: a conversa começa
 // sem um segundo toque. Dispara só quando a chave muda, nunca em re-render.
 useEffect(()=>{if(autoStartKey&&inactive&&!disabled)start()},[autoStartKey])

 if(state.status===REALTIME_CONVERSATION_STATES.IDLE)return <button type="button" className="val-conversation-opt-in" onClick={start} disabled={disabled} aria-label="Iniciar modo conversa por voz"><Mic/><span><b>Modo conversa</b><small>Fale e ouça a VAL sem enviar a cada turno</small></span></button>

 return <ValRealtimeConversationStage state={state} disabled={disabled} processing={processing} className={className} errorMessage={errorMessage} retryAfterSeconds={retryAfterSeconds} canRetry={canRetry} liveTranscript={liveTranscript} onRetry={start} onRetryTurn={conversation.retryTurn} onPause={conversation.pause} onResume={conversation.resume} onResumeAudio={conversation.resumeAudio} onInterrupt={conversation.bargeIn} onExit={leave} onFallbackPushToTalk={onFallbackPushToTalk?switchTo(onFallbackPushToTalk):undefined} onFallbackText={onFallbackText?switchTo(onFallbackText):undefined}/>
}
