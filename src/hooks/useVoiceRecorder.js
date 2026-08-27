import {useCallback,useEffect,useMemo,useRef,useState} from 'react'

export const MAX_VOICE_BYTES=6_000_000
export const MAX_VOICE_DURATION_SECONDS=900

const MIME_CANDIDATES=[
 'audio/webm;codecs=opus',
 'audio/mp4',
 'audio/webm',
 'audio/ogg;codecs=opus'
]
const FILE_MIME_TYPES=new Set(['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg'])
const MIME_BY_EXTENSION={mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',webm:'audio/webm',ogg:'audio/ogg'}

const extensionForMime=value=>{
 const mime=String(value||'').toLowerCase()
 if(mime.includes('mp4')||mime.includes('m4a'))return 'm4a'
 if(mime.includes('ogg'))return 'ogg'
 if(mime.includes('wav'))return 'wav'
 if(mime.includes('mpeg')||mime.includes('mp3'))return 'mp3'
 return 'webm'
}

const voiceError=error=>{
 const name=String(error?.name||'')
 if(name==='NotAllowedError'||name==='SecurityError')return 'O acesso ao microfone foi bloqueado. Autorize o microfone ou use um arquivo/texto.'
 if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'Nenhum microfone foi encontrado. Use um arquivo de áudio ou digite o relato.'
 if(name==='NotReadableError'||name==='TrackStartError')return 'O microfone está sendo usado por outro aplicativo. Feche-o e tente novamente.'
 if(name==='OverconstrainedError')return 'O microfone disponível não atende à configuração necessária.'
 return error?.message||'Não foi possível iniciar a gravação.'
}

const supportedMimeType=()=>{
 if(typeof window==='undefined'||typeof window.MediaRecorder==='undefined')return ''
 if(typeof window.MediaRecorder.isTypeSupported!=='function')return ''
 return MIME_CANDIDATES.find(type=>window.MediaRecorder.isTypeSupported(type))||''
}

const audioDuration=file=>new Promise(resolve=>{
 if(typeof window==='undefined'){resolve(0);return}
 const url=URL.createObjectURL(file)
 const audio=document.createElement('audio')
 let settled=false
 const finish=value=>{if(settled)return;settled=true;window.clearTimeout(timer);URL.revokeObjectURL(url);audio.removeAttribute('src');audio.load();resolve(Number.isFinite(value)?Math.max(0,value):0)}
 const timer=window.setTimeout(()=>finish(0),5000)
 audio.preload='metadata'
 const readDuration=()=>{const duration=Number(audio.duration);if(Number.isFinite(duration)&&duration>0)finish(duration)}
 audio.onloadedmetadata=()=>{readDuration();if(!settled){try{audio.currentTime=Number.MAX_SAFE_INTEGER}catch{}}}
 audio.ondurationchange=readDuration
 audio.ontimeupdate=readDuration
 audio.onerror=()=>finish(0)
 audio.src=url
})

export default function useVoiceRecorder({maxBytes=MAX_VOICE_BYTES,maxDurationSeconds=MAX_VOICE_DURATION_SECONDS}={}){
 const [status,setStatus]=useState('idle')
 const [elapsedSeconds,setElapsedSeconds]=useState(0)
 const [audio,setAudio]=useState(null)
 const [error,setError]=useState('')
 const recorderRef=useRef(null)
 const streamRef=useRef(null)
 const chunksRef=useRef([])
 const recordedBytesRef=useRef(0)
 const sizeStopRef=useRef(false)
 const timerRef=useRef(null)
 const startedAtRef=useRef(0)
 const generationRef=useRef(0)
 const mountedRef=useRef(true)
 const objectUrlRef=useRef('')

 const canRecord=useMemo(()=>typeof window!=='undefined'&&Boolean(window.MediaRecorder&&navigator.mediaDevices?.getUserMedia),[])

 const clearTimer=useCallback(()=>{if(timerRef.current){window.clearInterval(timerRef.current);timerRef.current=null}},[])
 const closeStream=useCallback(()=>{streamRef.current?.getTracks?.().forEach(track=>track.stop());streamRef.current=null},[])
 const clearObjectUrl=useCallback(()=>{if(objectUrlRef.current){URL.revokeObjectURL(objectUrlRef.current);objectUrlRef.current=''}},[])

 const clearAudio=useCallback(()=>{clearObjectUrl();if(mountedRef.current)setAudio(null)},[clearObjectUrl])

 const reset=useCallback(()=>{
  generationRef.current+=1
  const recorder=recorderRef.current
  if(recorder&&recorder.state!=='inactive'){try{recorder.stop()}catch{}}
  recorderRef.current=null
  chunksRef.current=[];recordedBytesRef.current=0;sizeStopRef.current=false
  clearTimer();closeStream();clearAudio()
  if(mountedRef.current){setElapsedSeconds(0);setError('');setStatus('idle')}
 },[clearAudio,clearTimer,closeStream])

 const stop=useCallback(()=>{
  const recorder=recorderRef.current
  if(!recorder||recorder.state==='inactive')return
  try{recorder.requestData?.()}catch{}
  try{recorder.stop()}catch(stopError){generationRef.current+=1;setError(voiceError(stopError));setStatus('error');clearTimer();closeStream()}
 },[clearTimer,closeStream])

 const start=useCallback(async()=>{
  if(status==='requesting'||status==='recording')return
  const generation=generationRef.current+1;generationRef.current=generation
  clearAudio();clearTimer();closeStream();chunksRef.current=[];recordedBytesRef.current=0;sizeStopRef.current=false
  setElapsedSeconds(0);setError('');setStatus('requesting')
  let requestedStream=null
  try{
   if(!canRecord)throw Object.assign(new Error('Este navegador não oferece gravação direta. Use um arquivo de áudio ou digite o relato.'),{name:'UnsupportedError'})
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});requestedStream=stream
   if(!mountedRef.current||generationRef.current!==generation){stream.getTracks().forEach(track=>track.stop());return}
   streamRef.current=stream
   const mimeType=supportedMimeType()
   // 48 kbps keeps a 15-minute voice note below the temporary 6 MB storage
   // ceiling in browsers that honour audioBitsPerSecond.
   const options={audioBitsPerSecond:48_000,...(mimeType?{mimeType}:{})}
   let recorder
   try{recorder=new window.MediaRecorder(stream,options)}catch{recorder=new window.MediaRecorder(stream,mimeType?{mimeType}:{})}
   recorderRef.current=recorder
   recorder.ondataavailable=event=>{if(generationRef.current!==generation||!event.data?.size)return;chunksRef.current.push(event.data);recordedBytesRef.current+=event.data.size;if(recordedBytesRef.current>=Math.max(1,maxBytes-128_000)&&recorder.state!=='inactive'){sizeStopRef.current=true;try{recorder.stop()}catch{}}}
   recorder.onerror=event=>{if(generationRef.current!==generation)return;generationRef.current+=1;clearTimer();closeStream();if(mountedRef.current){setError(voiceError(event.error));setStatus('error')}}
   recorder.onstop=()=>{
    if(generationRef.current!==generation)return
    clearTimer();closeStream();recorderRef.current=null
    const duration=Math.min(maxDurationSeconds,Math.max(1,(performance.now()-startedAtRef.current)/1000))
    const type=recorder.mimeType||mimeType||chunksRef.current[0]?.type||'audio/webm'
    const blob=new Blob(chunksRef.current,{type});chunksRef.current=[];recordedBytesRef.current=0
    if(!blob.size){if(mountedRef.current){setError('A gravação ficou vazia. Tente novamente.');setStatus('error')}return}
    if(blob.size>maxBytes){if(mountedRef.current){setError('O áudio excedeu o limite seguro de 6 MB. Grave um relato mais curto.');setStatus('error')}return}
    clearObjectUrl();const objectUrl=URL.createObjectURL(blob);objectUrlRef.current=objectUrl
    const captured={blob,objectUrl,mimeType:type,originalName:`audio-val-${new Date().toISOString().replace(/[:.]/g,'-')}.${extensionForMime(type)}`,durationSeconds:Math.round(duration),sizeBytes:blob.size}
    if(mountedRef.current){setAudio(captured);setElapsedSeconds(Math.round(duration));setError(sizeStopRef.current?'A gravação foi parada antes de atingir o limite seguro de 6 MB.':'');setStatus('ready')}
    sizeStopRef.current=false
   }
   startedAtRef.current=performance.now()
   recorder.start(1000)
   setStatus('recording')
   timerRef.current=window.setInterval(()=>{
    if(generationRef.current!==generation)return
    const elapsed=Math.max(0,(performance.now()-startedAtRef.current)/1000)
    if(mountedRef.current)setElapsedSeconds(Math.floor(elapsed))
    if(elapsed>=maxDurationSeconds)stop()
   },250)
  }catch(startError){requestedStream?.getTracks?.().forEach(track=>track.stop());if(streamRef.current===requestedStream)streamRef.current=null;if(generationRef.current!==generation)return;clearTimer();if(mountedRef.current){setError(voiceError(startError));setStatus('error')}}
 },[canRecord,clearAudio,clearObjectUrl,clearTimer,closeStream,maxBytes,maxDurationSeconds,status,stop])

 const selectFile=useCallback(async file=>{
  if(!file)return false
  const generation=generationRef.current+1;generationRef.current=generation
  const recorder=recorderRef.current
  if(recorder&&recorder.state!=='inactive'){try{recorder.stop()}catch{}}
  recorderRef.current=null;chunksRef.current=[];recordedBytesRef.current=0;sizeStopRef.current=false;clearTimer();closeStream();clearAudio();setError('')
  const extension=String(file.name||'').split('.').pop()?.toLowerCase()||''
  const mimeType=String(file.type||MIME_BY_EXTENSION[extension]||'').split(';',1)[0].toLowerCase()
  if(!FILE_MIME_TYPES.has(mimeType)){setError('Formato não suportado. Use MP3, M4A, MP4, WAV, WebM ou OGG.');setStatus('error');return false}
  if(file.size>maxBytes){setError('O áudio excede o limite seguro de 6 MB. Escolha um arquivo menor.');setStatus('error');return false}
  setStatus('validating')
  const duration=await audioDuration(file)
  if(!mountedRef.current||generationRef.current!==generation)return false
  if(!duration){setError('Não foi possível identificar a duração deste áudio. Escolha outro arquivo ou grave pela VAL.');setStatus('error');return false}
  if(duration>maxDurationSeconds){setError(`O áudio excede o limite de ${Math.round(maxDurationSeconds/60)} minutos.`);setStatus('error');return false}
  const blob=file.type?file:new Blob([file],{type:mimeType})
  const objectUrl=URL.createObjectURL(blob);objectUrlRef.current=objectUrl
  if(mountedRef.current){setAudio({blob,objectUrl,mimeType,originalName:file.name||`audio-val.${extensionForMime(mimeType)}`,durationSeconds:Math.round(duration),sizeBytes:blob.size});setElapsedSeconds(Math.round(duration));setStatus('ready')}
  return true
 },[clearAudio,clearTimer,closeStream,maxBytes,maxDurationSeconds])

 const cancelRecording=useCallback(()=>{reset()},[reset])

 useEffect(()=>{
  mountedRef.current=true
  return()=>{
   mountedRef.current=false;generationRef.current+=1
   const recorder=recorderRef.current
   if(recorder&&recorder.state!=='inactive'){try{recorder.stop()}catch{}}
   clearTimer();closeStream();clearObjectUrl()
  }
 },[clearObjectUrl,clearTimer,closeStream])

 return {status,elapsedSeconds,audio,error,canRecord,maxBytes,maxDurationSeconds,start,stop,reset,cancelRecording,selectFile}
}
