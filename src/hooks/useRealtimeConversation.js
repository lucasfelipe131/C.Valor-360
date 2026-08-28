import {useCallback,useEffect,useMemo,useReducer,useRef,useState} from 'react'
import useSpeechSynthesis from './useSpeechSynthesis.js'
import {
 REALTIME_CONVERSATION_EVENTS,
 REALTIME_CONVERSATION_STATES,
 createRealtimeConversationState,
 createWebSpeechInputProvider,
 realtimeConversationStatusLabel,
 responseTextFromConversationTurn,
 transitionRealtimeConversation,
 webSpeechRecognitionAvailable
} from '../lib/realtime-conversation.js'

const responseToken=(key,text)=>String(key||String(text||'').trim())

export default function useRealtimeConversation({
 responseText='',
 responseKey='',
 processing=false,
 disabled=false,
 language='pt-BR',
 silenceMs=1_250,
 maximumTurnMs=30_000,
 rate=1,
 onTranscript,
 onError,
 onStateChange,
 onMetrics,
 inputProviderFactory=createWebSpeechInputProvider
}={}){
 const [machine,dispatch]=useReducer(transitionRealtimeConversation,undefined,createRealtimeConversationState)
 const [interimTranscript,setInterimTranscript]=useState('')
 const [turnReply,setTurnReply]=useState({turn:0,text:''})
 const providerRef=useRef(null)
 const callbacksRef=useRef({onTranscript,onError,onMetrics})
 const responseRef=useRef({key:responseKey,text:responseText})
 const awaitingRef=useRef(null)
 const turnRef=useRef(0)
 const rearmTimerRef=useRef(null)
 const latencyRef=useRef(null)
 const externalToken=responseToken(responseKey,responseText)
 const speechText=turnReply.text
 const speech=useSpeechSynthesis({text:speechText,rate})

 callbacksRef.current={onTranscript,onError,onMetrics}
 responseRef.current={key:responseKey,text:responseText}

 const Recognition=typeof globalThis==='undefined'?null:(globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition)
 const inputSupported=webSpeechRecognitionAvailable(Recognition)
 const outputSupported=speech.supported===true
 const observedNow=()=>globalThis.performance?.now?.()??Date.now()
 const emitMetrics=useCallback((outcome='SUCCESS')=>{
  const marks=latencyRef.current;if(!marks)return
  const elapsed=(from,to)=>Number.isFinite(marks[from])&&Number.isFinite(marks[to])?Math.max(0,Number((marks[to]-marks[from]).toFixed(3))):null
  const completed={source:'BROWSER_VOICE_TURN',contractVersion:'val.conversation_latency.browser_voice_turn.v1',serviceClass:'VOICE',outcome,metrics:{speech_end_to_transcript:elapsed('speechEnd','transcript'),transcript_to_first_reasoning:elapsed('transcript','reasoning'),reasoning_to_first_text:elapsed('reasoning','firstText'),reasoning_to_first_audio:elapsed('reasoning','firstAudio'),browser_voice_turn_total_latency:elapsed('speechEnd','turnEnd')}}
  latencyRef.current=null
  callbacksRef.current.onMetrics?.(completed)
 },[])

 const reportError=useCallback(error=>{
  const normalized=typeof error==='string'?{code:'VOICE_ERROR',message:error}:error||{code:'VOICE_ERROR',message:'Falha no modo conversa.'}
  if(latencyRef.current){latencyRef.current.turnEnd=observedNow();emitMetrics('ERROR')}
  dispatch({type:REALTIME_CONVERSATION_EVENTS.ERROR,error:normalized.code})
  callbacksRef.current.onError?.(normalized.message,normalized)
 },[emitMetrics])

 const handleTurn=useCallback(async(transcript,metadata={})=>{
  turnRef.current+=1
  const turn=turnRef.current
  awaitingRef.current={turn,baseline:responseToken(responseRef.current.key,responseRef.current.text)}
  const transcriptAt=Number(metadata.transcriptAt)
  const speechEndAt=Number(metadata.speechEndAt)
  latencyRef.current={
   ...(Number.isFinite(speechEndAt)?{speechEnd:speechEndAt}:{}),
   transcript:Number.isFinite(transcriptAt)?transcriptAt:observedNow()
  }
  setInterimTranscript('')
  dispatch({type:REALTIME_CONVERSATION_EVENTS.TURN_DETECTED,reason:metadata.reason})
  dispatch({type:REALTIME_CONVERSATION_EVENTS.PROCESS})
  try{
   if(typeof callbacksRef.current.onTranscript!=='function')throw new Error('MISSING_TRANSCRIPT_HANDLER')
   latencyRef.current.reasoning=observedNow()
   const result=await callbacksRef.current.onTranscript(transcript,{...metadata,inputModality:'VOICE',conversationMode:'REALTIME_V1'})
   if(result?.suppressSpeech===true){latencyRef.current.firstText=observedNow();latencyRef.current.turnEnd=observedNow();emitMetrics('SUCCESS');awaitingRef.current=null;dispatch({type:REALTIME_CONVERSATION_EVENTS.SPEECH_ENDED});return}
   const text=responseTextFromConversationTurn(result)
   if(text){if(latencyRef.current)latencyRef.current.firstText=observedNow();setTurnReply({turn,text})}
  }catch(error){
   reportError({code:error?.message==='MISSING_TRANSCRIPT_HANDLER'?'MISSING_TRANSCRIPT_HANDLER':'TURN_PROCESSING_FAILED',message:error?.message==='MISSING_TRANSCRIPT_HANDLER'?'A conversa por voz ainda não está conectada ao envio de mensagens.':'Não consegui concluir este turno. Use apertar para falar ou texto.'})
  }
 },[emitMetrics,reportError])

 useEffect(()=>{
  const provider=inputProviderFactory({
   SpeechRecognition:Recognition,
   language,
   silenceMs,
   maximumTurnMs,
   onListeningChange:(active,metadata)=>{
    if(active)dispatch({type:REALTIME_CONVERSATION_EVENTS.INPUT_STARTED})
    else if(metadata?.reason==='USER_PAUSE')dispatch({type:REALTIME_CONVERSATION_EVENTS.PAUSE,reason:'USER'})
    else if(providerRef.current?.getSnapshot().active===false&&metadata?.reason==='NO_TURN')dispatch({type:REALTIME_CONVERSATION_EVENTS.INPUT_ENDED,reason:'NO_TURN'})
   },
   onInterim:setInterimTranscript,
   onTurn:handleTurn,
   onError:reportError,
   onNoTurn:metadata=>dispatch({type:REALTIME_CONVERSATION_EVENTS.INPUT_ENDED,reason:metadata?.reason||'NO_TURN'})
  })
  providerRef.current=provider
  return()=>{
   provider.dispose()
   if(providerRef.current===provider)providerRef.current=null
  }
 },[Recognition,handleTurn,inputProviderFactory,language,maximumTurnMs,reportError,silenceMs])

 useEffect(()=>{
  if(!awaitingRef.current||processing||!String(responseText||'').trim())return
  const pending=awaitingRef.current
  if(externalToken===pending.baseline)return
  if(latencyRef.current&&!Number.isFinite(latencyRef.current.firstText))latencyRef.current.firstText=observedNow()
  setTurnReply({turn:pending.turn,text:String(responseText).trim()})
 },[externalToken,processing,responseText])

 useEffect(()=>{
  if(machine.status!==REALTIME_CONVERSATION_STATES.PROCESSING||!turnReply.text||turnReply.turn!==awaitingRef.current?.turn)return
  awaitingRef.current=null
  if(!speech.speak())dispatch({type:REALTIME_CONVERSATION_EVENTS.FALLBACK,reason:'SPEECH_OUTPUT_UNAVAILABLE'})
 },[machine.status,speech.speak,turnReply])

 useEffect(()=>{
  if(speech.status==='speaking'&&machine.optedIn&&machine.status!==REALTIME_CONVERSATION_STATES.SPEAKING){if(latencyRef.current&&!Number.isFinite(latencyRef.current.firstAudio))latencyRef.current.firstAudio=observedNow();dispatch({type:REALTIME_CONVERSATION_EVENTS.SPEECH_STARTED})}
  else if(speech.status==='paused'&&machine.status===REALTIME_CONVERSATION_STATES.SPEAKING)dispatch({type:REALTIME_CONVERSATION_EVENTS.SPEECH_PAUSED})
  else if(speech.status==='ended'&&machine.status===REALTIME_CONVERSATION_STATES.SPEAKING){
   if(latencyRef.current){latencyRef.current.turnEnd=observedNow();emitMetrics('SUCCESS')}
   setTurnReply({turn:0,text:''})
   dispatch({type:REALTIME_CONVERSATION_EVENTS.SPEECH_ENDED})
  }else if((speech.status==='error'||speech.status==='unsupported')&&[REALTIME_CONVERSATION_STATES.PROCESSING,REALTIME_CONVERSATION_STATES.SPEAKING].includes(machine.status))dispatch({type:REALTIME_CONVERSATION_EVENTS.FALLBACK,reason:'SPEECH_OUTPUT_UNAVAILABLE'})
 },[emitMetrics,machine.optedIn,machine.status,speech.status])

 useEffect(()=>{
  if(machine.status!==REALTIME_CONVERSATION_STATES.LISTENING||!machine.optedIn||machine.microphoneActive||disabled)return
  rearmTimerRef.current=globalThis.setTimeout(()=>{
   rearmTimerRef.current=null
   const started=providerRef.current?.start()??false
   if(!started)reportError({code:'RECOGNITION_START_FAILED',message:'Não foi possível reabrir o microfone. Use apertar para falar ou texto.'})
  },200)
  return()=>{
   if(rearmTimerRef.current!==null)globalThis.clearTimeout(rearmTimerRef.current)
   rearmTimerRef.current=null
  }
 },[disabled,machine.microphoneActive,machine.optedIn,machine.status,reportError])

 useEffect(()=>{onStateChange?.(machine)},[machine,onStateChange])

 const start=useCallback(()=>{
  if(disabled)return false
  if(!inputSupported||speech.supported!==true){
   dispatch({type:REALTIME_CONVERSATION_EVENTS.FALLBACK,inputSupported,outputSupported:speech.supported===true,reason:'VOICE_UNAVAILABLE'})
   return false
  }
  dispatch({type:REALTIME_CONVERSATION_EVENTS.OPT_IN,inputSupported:true,outputSupported:true})
  return true
 },[disabled,inputSupported,speech.supported])

 const pause=useCallback(()=>{
  if(machine.status===REALTIME_CONVERSATION_STATES.SPEAKING){speech.pause();return true}
  const stopping=providerRef.current?.stop({emitPartial:false,reason:'USER_PAUSE'})
  if(!stopping)dispatch({type:REALTIME_CONVERSATION_EVENTS.PAUSE,reason:'USER'})
  return true
 },[machine.status,speech.pause])

 const resume=useCallback(()=>{
  if(machine.pauseReason==='SPEECH'){speech.resume();dispatch({type:REALTIME_CONVERSATION_EVENTS.SPEECH_RESUMED});return true}
  dispatch({type:REALTIME_CONVERSATION_EVENTS.RESUME})
  return true
 },[machine.pauseReason,speech.resume])

 const bargeIn=useCallback(()=>{
  if(latencyRef.current){latencyRef.current.turnEnd=observedNow();emitMetrics('CANCELLED')}
  speech.stop()
  providerRef.current?.abort({reason:'BARGE_IN'})
  setTurnReply({turn:0,text:''})
  awaitingRef.current=null
  dispatch({type:REALTIME_CONVERSATION_EVENTS.BARGE_IN})
  return true
 },[emitMetrics,speech.stop])

 const exit=useCallback(()=>{
  if(latencyRef.current){latencyRef.current.turnEnd=observedNow();emitMetrics('CANCELLED')}
  if(rearmTimerRef.current!==null)globalThis.clearTimeout(rearmTimerRef.current)
  rearmTimerRef.current=null
  providerRef.current?.abort({reason:'EXIT'})
  speech.stop()
  awaitingRef.current=null
  setInterimTranscript('')
  setTurnReply({turn:0,text:''})
  dispatch({type:REALTIME_CONVERSATION_EVENTS.EXIT})
 },[emitMetrics,speech.stop])

 const model=useMemo(()=>({
  ...machine,
  label:realtimeConversationStatusLabel(machine.status),
  interimTranscript,
  inputSupported,
  outputSupported,
  isListening:machine.status===REALTIME_CONVERSATION_STATES.LISTENING,
  isProcessing:machine.status===REALTIME_CONVERSATION_STATES.PROCESSING,
  isSpeaking:machine.status===REALTIME_CONVERSATION_STATES.SPEAKING,
  canBargeIn:machine.status===REALTIME_CONVERSATION_STATES.SPEAKING||machine.pauseReason==='SPEECH'
 }),[inputSupported,interimTranscript,machine,outputSupported])

 return {state:model,start,pause,resume,bargeIn,exit,policy:speech.policy}
}
