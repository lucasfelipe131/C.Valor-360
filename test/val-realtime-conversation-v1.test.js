import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {
 REALTIME_CONVERSATION_EVENTS as EVENTS,
 REALTIME_CONVERSATION_POLICY,
 REALTIME_CONVERSATION_STATES as STATES,
 createRealtimeConversationState,
 createWebSpeechInputProvider,
 transitionRealtimeConversation
} from '../src/lib/realtime-conversation.js'

const transition=(state,type,extra={})=>transitionRealtimeConversation(state,{type,...extra})

test('realtime conversation FSM — cobre opt-in, turno, processamento, fala, rearm e saída',()=>{
 let state=createRealtimeConversationState()
 assert.equal(state.status,STATES.IDLE)
 state=transition(state,EVENTS.OPT_IN,{inputSupported:true,outputSupported:true})
 assert.deepEqual([state.status,state.optedIn,state.microphoneActive],[STATES.LISTENING,true,false])
 state=transition(state,EVENTS.INPUT_STARTED)
 assert.equal(state.microphoneActive,true)
 state=transition(state,EVENTS.TURN_DETECTED,{reason:'FINAL_RESULT'})
 assert.deepEqual([state.status,state.microphoneActive,state.turnReason],[STATES.TURN_DETECTED,false,'FINAL_RESULT'])
 state=transition(state,EVENTS.PROCESS)
 assert.equal(state.status,STATES.PROCESSING)
 state=transition(state,EVENTS.SPEECH_STARTED)
 assert.equal(state.status,STATES.SPEAKING)
 state=transition(state,EVENTS.SPEECH_ENDED)
 assert.deepEqual([state.status,state.optedIn,state.microphoneActive],[STATES.LISTENING,true,false])
 state=transition(state,EVENTS.EXIT)
 assert.deepEqual(state,createRealtimeConversationState())
})

test('realtime conversation FSM — barge-in volta a ouvir e fallback não deixa microfone ativo',()=>{
 let state=transition(createRealtimeConversationState(),EVENTS.OPT_IN,{inputSupported:true,outputSupported:true})
 state=transition(state,EVENTS.SPEECH_STARTED)
 state=transition(state,EVENTS.BARGE_IN)
 assert.deepEqual([state.status,state.microphoneActive,state.optedIn],[STATES.LISTENING,false,true])
 state=transition(state,EVENTS.FALLBACK,{reason:'VOICE_UNAVAILABLE'})
 assert.deepEqual([state.status,state.microphoneActive,state.optedIn],[STATES.FALLBACK,false,false])
 assert.equal(REALTIME_CONVERSATION_POLICY.recognition_continuous,false)
 assert.equal(REALTIME_CONVERSATION_POLICY.permanent_microphone,false)
})

class MockRecognition{
 static instances=[]
 constructor(){MockRecognition.instances.push(this);this.started=false;this.stopped=false;this.aborted=false}
 start(){this.started=true;this.onstart?.()}
 stop(){this.stopped=true;this.onend?.()}
 abort(){this.aborted=true}
 emit(results){this.onresult?.({results})}
}

class AsyncStopRecognition extends MockRecognition{
 stop(){this.stopped=true}
 finish(){this.onend?.()}
}

const result=(transcript,isFinal=false)=>Object.assign([{transcript}],{isFinal})

test('Web Speech provider — usa pt-BR, continuous=false e fecha no resultado final',()=>{
 MockRecognition.instances=[]
 const turns=[]
 const listening=[]
 const provider=createWebSpeechInputProvider({SpeechRecognition:MockRecognition,onTurn:(text,meta)=>turns.push({text,...meta}),onListeningChange:value=>listening.push(value)})
 assert.equal(provider.start(),true)
 const recognition=MockRecognition.instances[0]
 assert.equal(recognition.lang,'pt-BR')
 assert.equal(recognition.continuous,false)
 assert.equal(recognition.interimResults,true)
 recognition.emit([result('Vou visitar o João amanhã.',true)])
 assert.equal(turns.length,1)
 assert.deepEqual({text:turns[0].text,reason:turns[0].reason,language:turns[0].language,endpointSource:turns[0].endpointSource},{text:'Vou visitar o João amanhã.',reason:'FINAL_RESULT',language:'pt-BR',endpointSource:'WEB_SPEECH_FINAL_RESULT'})
 assert.equal(Number.isFinite(turns[0].speechEndAt),true)
 assert.equal(Number.isFinite(turns[0].transcriptAt),true)
 assert.equal(recognition.stopped,true)
 assert.deepEqual(listening,[true,false])
 assert.equal(provider.getSnapshot().active,false)
 provider.dispose()
})

test('Web Speech provider — silêncio conclui parcial e dispose cancela captura sem emitir turno',()=>{
 MockRecognition.instances=[]
 const timers=[]
 const turns=[]
 const schedule=callback=>{timers.push(callback);return timers.length-1}
 const provider=createWebSpeechInputProvider({SpeechRecognition:MockRecognition,schedule,cancel:()=>{},onTurn:(text,meta)=>turns.push({text,...meta})})
 provider.start()
 const recognition=MockRecognition.instances[0]
 recognition.emit([result('essa área',false)])
 timers.at(-1)()
 assert.equal(turns.length,1)
 assert.deepEqual({text:turns[0].text,reason:turns[0].reason,language:turns[0].language,endpointSource:turns[0].endpointSource},{text:'essa área',reason:'SILENCE',language:'pt-BR',endpointSource:'LAST_RECOGNITION_RESULT'})
 assert.equal(recognition.stopped,true)

 provider.start()
 const second=MockRecognition.instances[1]
 provider.dispose()
 assert.equal(second.aborted,true)
 assert.equal(turns.length,1)
 assert.deepEqual(provider.getSnapshot(),{supported:true,active:false,disposed:true,hasRecognition:false,transcript:''})
})

test('Web Speech provider — pausa descarta transcrição parcial e não dispara turno',()=>{
 MockRecognition.instances=[]
 const turns=[]
 const provider=createWebSpeechInputProvider({SpeechRecognition:MockRecognition,onTurn:text=>turns.push(text)})
 provider.start()
 MockRecognition.instances[0].emit([result('trecho incompleto',false)])
 assert.equal(provider.stop({emitPartial:false,reason:'USER_PAUSE'}),true)
 assert.deepEqual(turns,[])
 assert.equal(provider.getSnapshot().transcript,'')
 provider.dispose()
})

test('Web Speech provider — mantém indicador ativo até o navegador confirmar o fim',()=>{
 const listening=[]
 const turns=[]
 const provider=createWebSpeechInputProvider({SpeechRecognition:AsyncStopRecognition,onListeningChange:value=>listening.push(value),onTurn:text=>turns.push(text)})
 provider.start()
 const recognition=AsyncStopRecognition.instances.at(-1)
 recognition.emit([result('fim confirmado depois',true)])
 assert.equal(recognition.stopped,true)
 assert.equal(provider.getSnapshot().active,true)
 assert.deepEqual(listening,[true])
 assert.deepEqual(turns,[])
 recognition.finish()
 assert.equal(provider.getSnapshot().active,false)
 assert.deepEqual(listening,[true,false])
 assert.deepEqual(turns,['fim confirmado depois'])
 provider.dispose()
})

test('Web Speech provider — instancia reconhecimento a cada rearm, sem microfone contínuo',()=>{
 MockRecognition.instances=[]
 const provider=createWebSpeechInputProvider({SpeechRecognition:MockRecognition,onNoTurn:()=>{}})
 provider.start()
 MockRecognition.instances[0].stop()
 provider.start()
 assert.equal(MockRecognition.instances.length,2)
 assert.equal(MockRecognition.instances.every(item=>item.continuous===false),true)
 provider.abort()
})

test('ValRealtimeConversation — SSR mantém entrada opt-in e não ativa microfone no carregamento',async()=>{
 const vite=await createServer({root:new URL('..',import.meta.url).pathname,logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 try{
  const {default:ValRealtimeConversation}=await vite.ssrLoadModule('/src/components/copilot/ValRealtimeConversation.jsx')
  const markup=renderToStaticMarkup(React.createElement(ValRealtimeConversation,{onTranscript:()=>{}}))
  assert.match(markup,/aria-label="Iniciar modo conversa por voz"/)
  assert.match(markup,/Modo conversa/)
  assert.doesNotMatch(markup,/data-microphone-active="true"/)
 }finally{await vite.close()}
})

test('ValRealtimeConversation — opt-in expõe callback para preparar saída de áudio antes de iniciar',()=>{
 const component=readFileSync(new URL('../src/components/copilot/ValRealtimeConversation.jsx',import.meta.url),'utf8')
 assert.match(component,/onClick=\{\(\)=>\{onStart\?\.\(\);conversation\.start\(\)\}\}/)
})
