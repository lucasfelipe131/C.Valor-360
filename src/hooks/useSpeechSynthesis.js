import {useCallback,useEffect,useRef,useState} from 'react'

export const VAL_VOICE_OUTPUT_POLICY=Object.freeze({
 version:'val.voice_output_policy.v1',
 engine:'BROWSER_WEB_SPEECH',
 persistence:'NONE',
 records_audio:false,
 stores_text_in_val:false,
 sends_backend_request:false,
 browser_service_may_use_network:true
})

export const MAX_SPEECH_TEXT_LENGTH=12_000

const clamp=(value,minimum,maximum,fallback)=>{
 const numeric=Number(value)
 return Number.isFinite(numeric)?Math.min(maximum,Math.max(minimum,numeric)):fallback
}

export const normalizeSpeechText=value=>String(value??'')
 .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
 .replace(/\s+/g,' ')
 .trim()
 .slice(0,MAX_SPEECH_TEXT_LENGTH)

const normalizedLanguage=value=>String(value||'').trim().replace('_','-').toLowerCase()

export function selectPreferredPortugueseVoice(voices=[]){
 const candidates=Array.isArray(voices)?voices:[]
 return candidates
  .map((voice,index)=>{
   const language=normalizedLanguage(voice?.lang)
   if(language!=='pt-br'&&!language.startsWith('pt-'))return null
   const exactBrazil=language==='pt-br'
   const brazilianName=/\b(?:brasil|brazil|pt[- ]?br)\b/i.test(String(voice?.name||''))
   const score=(exactBrazil?100:50)+(brazilianName?10:0)+(voice?.localService?3:0)+(voice?.default?1:0)-index/10_000
   return {voice,score}
  })
  .filter(Boolean)
  .sort((left,right)=>right.score-left.score)[0]?.voice||null
}

export const browserSpeechAvailable=({speechSynthesis,SpeechSynthesisUtterance}={})=>Boolean(
 speechSynthesis&&typeof speechSynthesis.speak==='function'&&typeof SpeechSynthesisUtterance==='function'
)

export function createBrowserSpeechPlayback({
 speechSynthesis,
 SpeechSynthesisUtterance,
 onStatus=()=>{},
 onVoice=()=>{}
}={}){
 const supported=browserSpeechAvailable({speechSynthesis,SpeechSynthesisUtterance})
 let activeUtterance=null
 let lastText=''
 let lastOptions={}
 let status=supported?'idle':'unsupported'
 let disposed=false

 const emit=next=>{
  status=next
  onStatus(next)
 }
 const voices=()=>{
  try{return speechSynthesis.getVoices?.()||[]}catch{return []}
 }
 const detach=utterance=>{
  if(!utterance)return
  utterance.onstart=null
  utterance.onpause=null
  utterance.onresume=null
  utterance.onend=null
  utterance.onerror=null
 }
 const cancelActive=({nextStatus='idle'}={})=>{
  const previous=activeUtterance
  activeUtterance=null
  detach(previous)
  if(supported){try{speechSynthesis.cancel()}catch{}}
  if(!disposed)emit(nextStatus)
 }

 const speak=(value,options={})=>{
  if(disposed||!supported){if(!disposed)emit('unsupported');return false}
 const text=normalizeSpeechText(value)
 if(!text){cancelActive();return false}
 cancelActive()
  let utterance
  try{utterance=new SpeechSynthesisUtterance(text)}catch{emit('error');return false}
  const preferredVoice=selectPreferredPortugueseVoice(voices())
  utterance.lang=preferredVoice?.lang||'pt-BR'
  if(preferredVoice)utterance.voice=preferredVoice
  utterance.rate=clamp(options.rate,.5,2,1)
  utterance.pitch=clamp(options.pitch,0,2,1)
  utterance.volume=clamp(options.volume,0,1,1)
  activeUtterance=utterance
  lastText=text
  lastOptions={rate:utterance.rate,pitch:utterance.pitch,volume:utterance.volume}
  onVoice(preferredVoice?{name:String(preferredVoice.name||''),lang:String(preferredVoice.lang||'pt-BR')}:{name:'',lang:'pt-BR'})
  utterance.onstart=()=>{if(!disposed&&activeUtterance===utterance)emit('speaking')}
  utterance.onpause=()=>{if(!disposed&&activeUtterance===utterance)emit('paused')}
  utterance.onresume=()=>{if(!disposed&&activeUtterance===utterance)emit('speaking')}
  utterance.onend=()=>{
   if(disposed||activeUtterance!==utterance)return
   activeUtterance=null
   detach(utterance)
   emit('ended')
  }
  utterance.onerror=event=>{
   if(disposed||activeUtterance!==utterance)return
   activeUtterance=null
   detach(utterance)
   emit(event?.error==='canceled'||event?.error==='interrupted'?'idle':'error')
  }
  try{
   speechSynthesis.speak(utterance)
   emit('speaking')
   return true
  }catch{
   activeUtterance=null
   detach(utterance)
   emit('error')
   return false
  }
 }

 const pause=()=>{
  if(disposed||!supported||status!=='speaking')return false
  try{speechSynthesis.pause();emit('paused');return true}catch{emit('error');return false}
 }
 const resume=()=>{
  if(disposed||!supported||status!=='paused')return false
  try{speechSynthesis.resume();emit('speaking');return true}catch{emit('error');return false}
 }
 const stop=()=>{
  if(disposed||!supported)return false
  cancelActive()
  return true
 }
 const repeat=()=>lastText?speak(lastText,lastOptions):false
 const dispose=()=>{
  if(disposed)return
  const previous=activeUtterance
  activeUtterance=null
  detach(previous)
  try{if(supported)speechSynthesis.cancel()}catch{}
  lastText=''
  lastOptions={}
  disposed=true
  status='idle'
 }

 return {
  supported,
  speak,
  pause,
  resume,
  stop,
  repeat,
  dispose,
  getSnapshot:()=>({status,lastText,active:Boolean(activeUtterance),disposed})
 }
}

export default function useSpeechSynthesis({text='',rate=1,pitch=1,volume=1}={}){
 const [supported,setSupported]=useState(null)
 const [status,setStatus]=useState('idle')
 const [voice,setVoice]=useState({name:'',lang:'pt-BR'})
 const playbackRef=useRef(null)
 const textRef=useRef(text)
 const optionsRef=useRef({rate,pitch,volume})

 textRef.current=text
 optionsRef.current={rate,pitch,volume}

 useEffect(()=>{
  const browser=typeof window==='undefined'?null:window
  const playback=createBrowserSpeechPlayback({
   speechSynthesis:browser?.speechSynthesis,
   SpeechSynthesisUtterance:browser?.SpeechSynthesisUtterance,
   onStatus:setStatus,
   onVoice:setVoice
  })
  playbackRef.current=playback
  setSupported(playback.supported)
  setStatus(playback.supported?'idle':'unsupported')
  return()=>{
   playback.dispose()
   if(playbackRef.current===playback)playbackRef.current=null
  }
 },[])

 useEffect(()=>{
  if(playbackRef.current?.getSnapshot().active)playbackRef.current.stop()
 },[text])

 const speak=useCallback(()=>playbackRef.current?.speak(textRef.current,optionsRef.current)??false,[])
 const pause=useCallback(()=>playbackRef.current?.pause()??false,[])
 const resume=useCallback(()=>playbackRef.current?.resume()??false,[])
 const togglePause=useCallback(()=>status==='paused'?resume():pause(),[pause,resume,status])
 const stop=useCallback(()=>playbackRef.current?.stop()??false,[])
 const repeat=useCallback(()=>playbackRef.current?.speak(textRef.current,optionsRef.current)??false,[])

 return {
  supported,
  status,
  voice,
  isSpeaking:status==='speaking',
  isPaused:status==='paused',
  speak,
  pause,
  resume,
  togglePause,
  stop,
  repeat,
  policy:VAL_VOICE_OUTPUT_POLICY
 }
}
