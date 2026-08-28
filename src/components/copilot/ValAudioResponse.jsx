import React,{useEffect,useRef} from 'react'
import {Pause,Play,RotateCcw,ShieldCheck,Square,Volume2} from 'lucide-react'
import useSpeechSynthesis from '../../hooks/useSpeechSynthesis.js'
import '../../val-audio-response.css'

const statusCopy={
 idle:'Pronto para ouvir',
 speaking:'Reproduzindo resposta',
 paused:'Resposta pausada',
 ended:'Reprodução concluída',
 error:'Não foi possível reproduzir esta resposta',
 unsupported:'Áudio de resposta indisponível neste navegador'
}

export const shouldShowSpeechFallback=({supported,status}={})=>supported!==true||status==='error'||!Object.hasOwn(statusCopy,String(status||''))

export default function ValAudioResponse({text='',autoPlay=false,rate=1,className=''}){
 const {
  supported,
  status,
  isSpeaking,
  isPaused,
  speak,
  togglePause,
  stop,
  repeat,
  policy
 }=useSpeechSynthesis({text,rate})
 const autoPlayedTextRef=useRef('')
 const normalizedText=String(text||'').trim()
 const hasText=Boolean(normalizedText)
 const active=isSpeaking||isPaused
 const unavailable=supported!==true
 const showFallback=shouldShowSpeechFallback({supported,status})
 const rootClass=['val-audio-response',className].filter(Boolean).join(' ')

 useEffect(()=>{
  if(!autoPlay||supported!==true||!hasText||autoPlayedTextRef.current===normalizedText)return
  autoPlayedTextRef.current=normalizedText
  speak()
 },[autoPlay,hasText,normalizedText,speak,supported])

 return <section className={rootClass} aria-label="Resposta por áudio" data-persistence={policy.persistence}>
  <div className="val-audio-controls" role="group" aria-label="Controles da resposta por áudio">
   <button type="button" onClick={speak} disabled={!hasText||unavailable||active} aria-label="Ouvir resposta"><Volume2/><span>Ouvir</span></button>
   <button type="button" onClick={togglePause} disabled={!active||unavailable} aria-label={isPaused?'Continuar resposta':'Pausar resposta'}>{isPaused?<Play/>:<Pause/>}<span>{isPaused?'Continuar':'Pausar'}</span></button>
   <button type="button" onClick={stop} disabled={!active||unavailable} aria-label="Parar resposta"><Square/><span>Parar</span></button>
   <button type="button" onClick={repeat} disabled={!hasText||unavailable} aria-label="Repetir resposta"><RotateCcw/><span>Repetir</span></button>
  </div>
  <div className={`val-audio-status is-${status}`} role="status" aria-live="polite">
   <span>{statusCopy[status]||statusCopy.idle}</span>
   {unavailable&&<small>Você ainda pode ler a resposta normalmente.</small>}
  </div>
  {showFallback&&hasText&&<p className="val-audio-fallback">{normalizedText}</p>}
  <p className="val-audio-privacy"><ShieldCheck/><span><b>Sem persistência pela VAL:</b> a VAL não grava nem envia este áudio ao próprio backend. O navegador ou sistema operacional pode usar seu serviço de voz conforme as configurações do dispositivo.</span></p>
 </section>
}
