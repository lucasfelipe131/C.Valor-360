import React,{useEffect,useRef,useState} from 'react'
import {Mic,Square} from 'lucide-react'

export default function EphemeralSpeechButton({disabled=false,onTranscript,onError}){
 const [listening,setListening]=useState(false)
 const recognitionRef=useRef(null)
 useEffect(()=>()=>{try{recognitionRef.current?.abort()}catch{}},[])
 const toggle=()=>{
  if(listening){try{recognitionRef.current?.stop()}catch{};setListening(false);return}
  const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition
  if(!Recognition){onError?.('Este navegador não oferece ditado direto. Digite a pergunta ou selecione um produtor para usar a captura de voz da VAL.');return}
  const recognition=new Recognition();recognition.lang='pt-BR';recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1
  recognition.onstart=()=>setListening(true)
  recognition.onend=()=>setListening(false)
  recognition.onerror=event=>{setListening(false);onError?.(event?.error==='not-allowed'?'Permita o uso do microfone para falar com a VAL.':'Não consegui ouvir com clareza. Tente novamente.')}
  recognition.onresult=event=>{const transcript=String(event?.results?.[0]?.[0]?.transcript||'').trim();if(transcript)onTranscript?.(transcript)}
  recognitionRef.current=recognition
  try{recognition.start()}catch{setListening(false);onError?.('O microfone já está sendo usado por outra captura.')}
 }
 return <button type="button" className={`val-ephemeral-speech ${listening?'is-listening':''}`} onClick={toggle} disabled={disabled} aria-label={listening?'Parar ditado':'Perguntar por voz'} aria-pressed={listening}>{listening?<Square/>:<Mic/>}</button>
}
