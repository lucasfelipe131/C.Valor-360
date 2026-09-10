import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import useNaturalRealtimeVoice from '../src/hooks/useNaturalRealtimeVoice.js'

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})

async function mountVoice({permissionQuery=async()=>({state:'granted'}),statusResponse=null,getMedia=null,usageResponse=null,onToolCall=null,sessionResponse=null,onAssistantTranscript=null,onUserTranscript=null,onError=null}={}){
 const saved=new Map()
 const replace=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})}
 const requests=[],streams=[],audios=[],peers=[]
 let microphoneCalls=0,sessionCount=0,current,renderer
 const makeStream=()=>{const track={enabled:true,stopped:false,stop(){this.stopped=true}};const stream={track,getAudioTracks:()=>[track],getTracks:()=>[track]};streams.push(stream);return stream}
 class Peer{
  constructor(){this.connectionState='new';peers.push(this)}
  addTrack(track){this.track=track}
  createDataChannel(){this.dc={readyState:'connecting',sent:[],send(value){this.sent.push(JSON.parse(value))},close(){this.readyState='closed'},emit(event){return this.onmessage?.({data:JSON.stringify(event)})}};return this.dc}
  async createOffer(){return {type:'offer',sdp:'v=0\n'}}
  async setLocalDescription(){}
  async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.dc.readyState='open';this.dc.onopen?.()}
  close(){this.connectionState='closed';this.onconnectionstatechange?.()}
 }
 replace('isSecureContext',true)
 replace('RTCPeerConnection',Peer)
 replace('navigator',{permissions:{query:permissionQuery},mediaDevices:{getUserMedia:async()=>{microphoneCalls++;return getMedia?getMedia(makeStream):makeStream()}}})
 replace('document',{body:{appendChild(){}},createElement(){const audio={style:{},paused:true,playCalls:0,removed:false,setAttribute(){},play(){this.playCalls++;this.paused=false;return Promise.resolve()},pause(){this.paused=true},remove(){this.removed=true}};audios.push(audio);return audio}})
 replace('fetch',async(path,options={})=>{
  const payload=options.body&&String(path).startsWith('/api/')?JSON.parse(options.body):null
  requests.push({path:String(path),payload,signal:options.signal})
  if(path==='/api/v1/realtime-voice/status')return statusResponse?statusResponse():json({available:true,canRetry:true})
  if(path==='/api/v1/realtime-voice/sessions'){sessionCount++;if(sessionResponse)return sessionResponse(payload);return json({sessionId:`voice-session-${sessionCount}`,clientSecret:'ek_mock',model:'test-model',callUrl:'https://voice.mock/realtime/calls',maxSessionSeconds:600,budget:{remainingUsd:24},context:{clientId:payload.clientId||null,conversationId:payload.conversationId,contextEpoch:payload.contextEpoch}},201)}
  if(path==='https://voice.mock/realtime/calls')return new Response('v=0\n',{status:200})
  if(String(path).endsWith('/usage'))return usageResponse?usageResponse(payload):json({accepted:true,remainingUsd:24,exhausted:false})
  if(String(path).endsWith('/turns'))return json({accepted:true,reconnectRequired:false})
  throw new Error(`Unexpected mock request ${path}`)
 })
 const initialProps={conversationId:'voice-thread',contextEpoch:0,onToolCall,onAssistantTranscript,onUserTranscript,onError}
 function Probe(props){current=useNaturalRealtimeVoice(props);return null}
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe,initialProps))})
 return {
  get voice(){return current},requests,streams,audios,peers,get microphoneCalls(){return microphoneCalls},get sessionCount(){return sessionCount},makeStream,
  async start(){let result;await act(async()=>{result=await current.start()});return result},
  async update(props){await act(async()=>{renderer.update(React.createElement(Probe,{...initialProps,...props}))})},
  async dispose(){try{await act(async()=>{renderer.unmount()})}finally{for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
 }
}

test('real voice hook preserves pause when response usage finishes after the pause',async()=>{
 const usage=deferred(),started=deferred()
 const app=await mountVoice({usageResponse:payload=>{if(payload.responseId==='pending-usage'){started.resolve();return usage.promise}return json({accepted:true,remainingUsd:24})}})
 try{
  assert.equal((await app.start()).ok,true)
  assert.equal(app.voice.state.status,'LISTENING')
  let eventWork
  await act(async()=>{eventWork=app.peers[0].dc.emit({type:'response.done',response:{id:'pending-usage',status:'completed',usage:{}}});await started.promise})
  await act(async()=>{app.voice.pause()})
  assert.equal(app.streams[0].track.enabled,false)
  await act(async()=>{usage.resolve(json({accepted:true,remainingUsd:23,exhausted:false}));await eventWork})
  assert.equal(app.voice.state.status,'PAUSED')
  assert.equal(app.voice.state.microphoneActive,false)
  assert.equal(app.streams[0].track.enabled,false)
 }finally{await app.dispose()}
})

test('real voice hook exits cleanly while the browser permission query is pending',async()=>{
 const permission=deferred(),queried=deferred()
 const app=await mountVoice({permissionQuery:()=>{queried.resolve();return permission.promise}})
 try{
  let startup
  await act(async()=>{startup=app.voice.start();await queried.promise})
  await act(async()=>{await app.voice.exit()})
  await act(async()=>{permission.resolve({state:'granted'});await startup})
  assert.equal(app.voice.state.status,'IDLE')
  assert.equal(app.voice.state.microphoneActive,false)
  assert.equal(app.microphoneCalls,0)
  assert.equal(app.requests.length,0)
  assert.equal(app.audios.length,0)
 }finally{await app.dispose()}
})

test('real voice hook waits for explicit resume before reconnecting a changed scope while paused',async()=>{
 const app=await mountVoice()
 try{
  await app.start()
  await act(async()=>{app.voice.pause()})
  await app.update({clientId:'producer-b',contextEpoch:1})
  assert.equal(app.voice.state.status,'PAUSED')
  assert.equal(app.voice.state.microphoneActive,false)
  assert.equal(app.sessionCount,1)
  assert.equal(app.microphoneCalls,1)
  assert.equal(app.streams[0].track.stopped,true)
  await act(async()=>{app.voice.resume()})
  assert.equal(app.sessionCount,2)
  assert.equal(app.voice.state.status,'LISTENING')
  assert.equal(app.voice.state.microphoneActive,true)
  const sessions=app.requests.filter(request=>request.path==='/api/v1/realtime-voice/sessions')
  assert.equal(sessions[1].payload.clientId,'producer-b')
  assert.equal(sessions[1].payload.contextEpoch,1)
 }finally{await app.dispose()}
})

test('real voice hook reports configuration 503 before asking for a microphone or reserving a session',async()=>{
 const app=await mountVoice({statusResponse:()=>json({available:false,unavailableCode:'realtime_voice_disabled',unavailableMessage:'A voz não está habilitada neste ambiente.',canRetry:false},503)})
 try{
  const result=await app.start()
  assert.equal(result.ok,false)
  assert.equal(result.reason,'realtime_voice_disabled')
  assert.equal(app.voice.state.status,'FALLBACK')
  assert.equal(app.voice.state.canRetry,false)
  assert.equal(app.microphoneCalls,0)
  assert.equal(app.sessionCount,0)
  assert.equal(app.peers.length,0)
  assert.equal(app.audios.every(audio=>audio.removed),true)
 }finally{await app.dispose()}
})

test('real voice hook keeps tracks and late audio paused when permission resolves after pause',async()=>{
 const media=deferred(),requested=deferred()
 const app=await mountVoice({getMedia:makeStream=>{const stream=makeStream();requested.resolve(stream);return media.promise}})
 try{
  let startup,stream
  await act(async()=>{startup=app.voice.start();stream=await requested.promise})
  await act(async()=>{app.voice.pause()})
  await act(async()=>{media.resolve(stream);await startup})
  assert.equal(stream.track.enabled,false)
  assert.equal(app.voice.state.status,'PAUSED')
  const audio=app.audios[0],plays=audio.playCalls
  await act(async()=>{app.peers[0].ontrack({streams:[stream]})})
  assert.equal(audio.playCalls,plays)
  assert.equal(audio.paused,true)
  assert.equal(app.voice.state.microphoneActive,false)
 }finally{await app.dispose()}
})

test('real voice hook defers speaking a completed tool result until resume',async()=>{
 const tool=deferred(),requested=deferred()
 const app=await mountVoice({onToolCall:()=>{requested.resolve();return tool.promise}})
 try{
  await app.start()
  const channel=app.peers[0].dc
  let eventWork
  await act(async()=>{eventWork=channel.emit({type:'response.function_call_arguments.done',name:'val_governed_tool',call_id:'tool-1',arguments:JSON.stringify({request:'Consultar soja'})});await requested.promise})
  await act(async()=>{await channel.emit({type:'response.done',response:{id:'tool-response',status:'completed',output:[{type:'function_call',call_id:'tool-1'}]}})})
  await act(async()=>{app.voice.pause()})
  await act(async()=>{tool.resolve({status:'OK',message:'Resultado governado'});await eventWork})
  assert.equal(channel.sent.filter(event=>event.type==='conversation.item.create').length,1)
  assert.equal(channel.sent.filter(event=>event.type==='response.create').length,0)
  assert.equal(app.voice.state.status,'PAUSED')
  await act(async()=>{app.voice.resume()})
  assert.equal(channel.sent.filter(event=>event.type==='response.create').length,1)
  assert.equal(app.voice.state.status,'THINKING')
 }finally{await app.dispose()}
})

test('real voice hook translates a native missing-device DOMException before fallback',async()=>{
 const app=await mountVoice({getMedia:()=>{throw new DOMException('Requested device not found','NotFoundError')}})
 try{
  const result=await app.start()
  assert.equal(result.reason,'NotFoundError')
  assert.equal(app.voice.state.microphonePermission,'UNAVAILABLE')
  assert.match(app.voice.state.error,/Conecte um microfone/)
  assert.equal(app.sessionCount,0)
 }finally{await app.dispose()}
})

// O palco derivava LISTENING de response.done sem audio mesmo com a ferramenta governada ainda em
// voo: o consultor era convidado a falar durante o processamento e a fala nova derrubava a sessao.
test('real voice hook keeps working state while a governed tool is still running',async()=>{
 const tool=deferred(),requested=deferred()
 const app=await mountVoice({onToolCall:()=>{requested.resolve();return tool.promise}})
 try{
  await app.start()
  const channel=app.peers[0].dc
  let eventWork
  await act(async()=>{channel.emit({type:'response.created'})})
  assert.equal(app.voice.state.status,'THINKING')
  await act(async()=>{eventWork=channel.emit({type:'response.function_call_arguments.done',name:'val_governed_tool',call_id:'tool-1',arguments:JSON.stringify({request:'Consultar soja'})});await requested.promise})
  await act(async()=>{channel.emit({type:'response.done',response:{id:'r1',status:'completed',usage:{}}})})
  assert.equal(app.voice.state.status,'THINKING','com a ferramenta em voo o palco nao pode dizer que esta ouvindo')
  await act(async()=>{tool.resolve({status:'OK',message:'Resultado governado'});await eventWork})
  assert.equal(channel.sent.filter(event=>event.type==='response.create').length,1)
  await act(async()=>{channel.emit({type:'response.done',response:{id:'r2',status:'completed',usage:{}}})})
  assert.equal(app.voice.state.status,'LISTENING','terminada a ferramenta, a VAL volta a ouvir')
 }finally{await app.dispose()}
})


test('voice recovery rejects a different producer, different conversation or malformed authoritative epoch without retrying',async()=>{
 for(const patch of [{clientId:'another-producer'},{conversationId:'another-thread'},{contextEpoch:1.5}]){
  const app=await mountVoice({sessionResponse:request=>json({code:'realtime_voice_context_epoch_mismatch',currentContext:{clientId:null,conversationId:request.conversationId,contextEpoch:2,...patch}},409)})
  try{
   const result=await app.start()
   assert.equal(result.ok,false);assert.equal(app.sessionCount,1)
   assert.equal(app.peers.length,0);assert.equal(app.streams.every(stream=>stream.track.stopped),true)
   assert.equal(app.voice.state.microphoneActive,false)
  }finally{await app.dispose()}
 }
})

test('voice recovery attempts at most one epoch synchronization and stops if the server changes again',async()=>{
 const app=await mountVoice({sessionResponse:request=>json({code:'realtime_voice_context_epoch_mismatch',currentContext:{clientId:null,conversationId:request.conversationId,contextEpoch:request.contextEpoch+1}},409)})
 try{
  const result=await app.start()
  assert.equal(result.ok,false);assert.equal(app.sessionCount,2);assert.equal(app.microphoneCalls,1)
  assert.equal(app.peers.length,0);assert.equal(app.streams.every(stream=>stream.track.stopped),true)
 }finally{await app.dispose()}
})

const receive=async(app,event,peer=0)=>{await act(async()=>{await app.peers[peer].dc.emit(event)})}
const askVoice=async(app,text,itemId='user-1')=>{
 await receive(app,{type:'input_audio_buffer.speech_started',item_id:itemId})
 await receive(app,{type:'input_audio_buffer.speech_stopped',item_id:itemId})
 await receive(app,{type:'conversation.item.input_audio_transcription.completed',item_id:itemId,transcript:text})
}
const beginResponse=(app,id)=>receive(app,{type:'response.created',response:{id}})
const finishResponse=(app,id,status='completed',output=[],extra={})=>receive(app,{type:'response.done',response:{id,status,output,...extra}})
const assistantOutput=(id,text)=>[{id,type:'message',role:'assistant',content:[{type:'audio',transcript:text}]}]

// This reproduces the screenshot: transcript.done is followed by an incomplete
// response. The partial transcript must never become a completed chat turn.
test('incomplete without audio retries the same question once and commits only the completed replacement',async()=>{
 const assistant=[],users=[]
 const app=await mountVoice({onAssistantTranscript:text=>assistant.push(text),onUserTranscript:text=>users.push(text)})
 try{
  await app.start();await askVoice(app,'Fale sobre o manejo de soja')
  await beginResponse(app,'partial')
  await receive(app,{type:'response.output_audio_transcript.done',response_id:'partial',item_id:'partial-message',transcript:'Uma resposta cortada'})
  assert.deepEqual(assistant,[])
  assert.equal(app.requests.some(request=>request.path.endsWith('/turns')),false)
  await finishResponse(app,'partial','incomplete',assistantOutput('partial-message','Uma resposta cortada'),{status_details:{reason:'max_output_tokens'}})
  const channel=app.peers[0].dc,creates=channel.sent.filter(event=>event.type==='response.create')
  assert.equal(creates.length,1)
  assert.deepEqual(creates[0].response.tool_choice,{type:'function',name:'val_governed_tool'})
  assert.equal(creates[0].response.instructions,undefined,'retry cannot override session scope instructions')
  assert.equal(app.voice.state.recoveringTurn,true)
  assert.equal(app.voice.state.interimTranscript,'Fale sobre o manejo de soja')
  assert.equal(app.voice.state.error,'')
  assert.deepEqual(channel.sent.filter(event=>event.type==='conversation.item.delete').map(event=>event.item_id),['partial-message'])
  await receive(app,{type:'output_audio_buffer.started',response_id:'partial'})
  await receive(app,{type:'response.output_audio_transcript.done',response_id:'partial',transcript:'Evento velho'})
  assert.equal(app.voice.state.status,'THINKING')
  await beginResponse(app,'replacement')
  await finishResponse(app,'replacement','completed',assistantOutput('answer','Manejo depende da cultura, estádio e alvo.'))
  await finishResponse(app,'replacement','completed',assistantOutput('answer','Manejo depende da cultura, estádio e alvo.'))
  assert.deepEqual(assistant,['Manejo depende da cultura, estádio e alvo.'])
  assert.deepEqual(users,['Fale sobre o manejo de soja'])
  assert.equal(app.requests.filter(request=>request.path.endsWith('/turns')).length,1)
  assert.equal(app.voice.state.recoveringTurn,false)
  assert.equal(app.voice.state.canRetryTurn,false)
 }finally{await app.dispose()}
})

test('exhausted automatic recovery offers one manual retry without repeating or losing the question',async()=>{
 const errors=[]
 const app=await mountVoice({onError:message=>errors.push(message)})
 try{
  await app.start();await askVoice(app,'Quais produtos são cadastrados?')
  await beginResponse(app,'first');await finishResponse(app,'first','incomplete',[],{status_details:{reason:'max_output_tokens'}})
  await beginResponse(app,'retry');await finishResponse(app,'retry','failed',[],{status_details:{error:{message:'internal_secret_exception'}}})
  assert.equal(app.voice.state.canRetryTurn,true)
  assert.equal(app.voice.state.recoveringTurn,false)
  assert.match(app.voice.state.error,/Sua pergunta foi preservada/)
  assert.doesNotMatch(app.voice.state.error,/max_output|internal_secret|repita|repetir a pergunta/i)
  assert.equal(app.voice.state.interimTranscript,'Quais produtos são cadastrados?')
  let result;await act(async()=>{result=app.voice.retryTurn()})
  assert.equal(result,true)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,2)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='conversation.item.create').length,0)
  await beginResponse(app,'manual');await finishResponse(app,'manual','incomplete')
  assert.equal(app.voice.state.canRetryTurn,false)
  assert.match(app.voice.state.error,/continuar digitando/)
  await act(async()=>{result=app.voice.retryTurn()})
  assert.equal(result,false)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,2)
  assert.ok(errors.every(message=>!message.includes('max_output')))
 }finally{await app.dispose()}
})

test('a partial audible answer is never automatically replayed and manual retry reuses the tool result',async()=>{
 let calls=0
 const assistant=[]
 const app=await mountVoice({onToolCall:async()=>{calls++;return {status:'OK',result:'Produto consultado no catálogo.'}},onAssistantTranscript:text=>assistant.push(text)})
 try{
  await app.start();await askVoice(app,'Consulte o produto no catálogo')
  await beginResponse(app,'lookup')
  await receive(app,{type:'response.function_call_arguments.done',response_id:'lookup',call_id:'lookup-call',name:'val_governed_tool',arguments:'{"request":"Consulte o produto no catálogo"}'})
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,0,'wait for function response.done')
  await finishResponse(app,'lookup','completed',[{id:'function-item',type:'function_call',call_id:'lookup-call'}])
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').at(-1).response.tool_choice,'none')
  await beginResponse(app,'spoken')
  await receive(app,{type:'output_audio_buffer.started',response_id:'spoken'})
  await receive(app,{type:'response.output_audio_transcript.done',response_id:'spoken',item_id:'spoken-item',transcript:'Sobre esse produto...'})
  await finishResponse(app,'spoken','incomplete',assistantOutput('spoken-item','Sobre esse produto...'),{status_details:{reason:'max_output_tokens'}})
  assert.equal(app.voice.state.canRetryTurn,true)
  assert.equal(app.voice.state.recoveringTurn,false)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,1,'partial audible output never triggers an automatic replay')
  assert.deepEqual(assistant,[])
  assert.match(app.voice.state.error,/desde o início/)
  await act(async()=>{app.voice.retryTurn()})
  const sent=app.peers[0].dc.sent
  assert.equal(sent.filter(event=>event.type==='response.create').at(-1).response.tool_choice,'none')
  assert.deepEqual(sent.filter(event=>event.type==='conversation.item.delete').map(event=>event.item_id),['spoken-item'])
  assert.equal(calls,1)
 }finally{await app.dispose()}
})

test('tool calls are deduplicated and completed no-audio tool responses wait for the governed result',async()=>{
 const work=deferred(),started=deferred();let calls=0
 const app=await mountVoice({onToolCall:()=>{calls++;started.resolve();return work.promise}})
 try{
  await app.start();await askVoice(app,'Registre uma observação')
  await beginResponse(app,'tool-response')
  const event={type:'response.function_call_arguments.done',response_id:'tool-response',name:'val_governed_tool',call_id:'once-only',arguments:'{"request":"Registre uma observação"}'}
  let pending;await act(async()=>{pending=app.peers[0].dc.emit(event);await started.promise})
  await receive(app,event)
  await finishResponse(app,'tool-response','completed',[{type:'function_call',call_id:'once-only'}])
  assert.equal(app.voice.state.status,'THINKING')
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,0)
  await act(async()=>{work.resolve({status:'OK',result:'Observação registrada.'});await pending})
  await receive(app,event)
  await finishResponse(app,'tool-response','completed',[{type:'function_call',call_id:'once-only'}])
  assert.equal(calls,1)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='conversation.item.create').length,1)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,1)
  assert.equal(app.voice.state.status,'THINKING')
 }finally{await app.dispose()}
})

test('new speech discards a superseded response and old input transcription in the same session',async()=>{
 const assistant=[],users=[]
 const app=await mountVoice({onAssistantTranscript:text=>assistant.push(text),onUserTranscript:text=>users.push(text)})
 try{
  await app.start();await askVoice(app,'Fale sobre soja','first-input');await beginResponse(app,'first-response')
  await receive(app,{type:'output_audio_buffer.started',response_id:'first-response'})
  await askVoice(app,'Agora fale sobre milho','second-input');await beginResponse(app,'second-response')
  await receive(app,{type:'conversation.item.input_audio_transcription.completed',item_id:'first-input',transcript:'Transcrição antiga de soja'})
  await receive(app,{type:'response.output_audio_transcript.done',response_id:'first-response',transcript:'Resposta velha de soja'})
  await receive(app,{type:'output_audio_buffer.stopped',response_id:'first-response'})
  await finishResponse(app,'first-response','completed',assistantOutput('old','Resposta velha de soja'))
  assert.equal(app.voice.state.status,'THINKING')
  assert.equal(app.voice.state.interimTranscript,'Agora fale sobre milho')
  assert.deepEqual(assistant,[])
  await finishResponse(app,'second-response','completed',assistantOutput('new','Resposta sobre milho'))
  assert.deepEqual(assistant,['Resposta sobre milho'])
  assert.deepEqual(users,['Fale sobre soja','Agora fale sobre milho'])
  const turn=app.requests.find(request=>request.path.endsWith('/turns'))
  assert.equal(turn.payload.userTranscript,'Agora fale sobre milho')
 }finally{await app.dispose()}
})

test('interrupting a pending tool discards its late output and never speaks it in the next turn',async()=>{
 const work=deferred(),started=deferred()
 const app=await mountVoice({onToolCall:()=>{started.resolve();return work.promise}})
 try{
  await app.start();await askVoice(app,'Consulte a propriedade anterior');await beginResponse(app,'old-tool')
  let pending;await act(async()=>{pending=app.peers[0].dc.emit({type:'response.function_call_arguments.done',response_id:'old-tool',name:'val_governed_tool',call_id:'old-call',arguments:'{}'});await started.promise})
  await act(async()=>{app.voice.bargeIn()})
  await askVoice(app,'Fale de manejo em geral','new-input');await beginResponse(app,'new-response')
  await act(async()=>{work.resolve({status:'OK',result:'Informações da propriedade anterior'});await pending})
  await finishResponse(app,'old-tool','completed',[{type:'function_call',call_id:'old-call'}])
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='conversation.item.create').length,0)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,0)
  assert.equal(app.voice.state.status,'THINKING')
  assert.equal(app.voice.state.interimTranscript,'Fale de manejo em geral')
 }finally{await app.dispose()}
})

test('pause defers incomplete-turn recovery and resume retries without reopening the microphone early',async()=>{
 const app=await mountVoice()
 try{
  await app.start();await askVoice(app,'Quais cuidados devo observar?');await beginResponse(app,'paused-response')
  await act(async()=>{app.voice.pause()})
  await finishResponse(app,'paused-response','incomplete',[],{status_details:{reason:'max_output_tokens'}})
  assert.equal(app.voice.state.status,'PAUSED')
  assert.equal(app.voice.state.canRetryTurn,false)
  assert.equal(app.streams[0].track.enabled,false)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,0)
  await act(async()=>{app.voice.resume()})
  assert.equal(app.voice.state.status,'THINKING')
  assert.equal(app.voice.state.recoveringTurn,true)
  assert.equal(app.streams[0].track.enabled,true)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,1)
  assert.equal(app.voice.state.interimTranscript,'Quais cuidados devo observar?')
 }finally{await app.dispose()}
})

test('changing producer invalidates pending retry and all completion events from the previous session',async()=>{
 const assistant=[]
 const app=await mountVoice({onAssistantTranscript:text=>assistant.push(text)})
 try{
  await app.start();await askVoice(app,'Fale sobre o produtor atual');await beginResponse(app,'old-response')
  await finishResponse(app,'old-response','incomplete')
  const oldChannel=app.peers[0].dc
  await app.update({clientId:'producer-b',contextEpoch:1})
  assert.equal(app.sessionCount,2)
  assert.equal(app.voice.state.recoveringTurn,false)
  assert.equal(app.voice.state.canRetryTurn,false)
  await act(async()=>{await oldChannel.emit({type:'response.done',response:{id:'old-response',status:'completed',output:assistantOutput('old','Dados do produtor anterior')}})})
  assert.deepEqual(assistant,[])
  assert.equal(app.peers[1].dc.sent.filter(event=>event.type==='response.create').length,0)
  assert.equal(app.voice.state.interimTranscript,'')
 }finally{await app.dispose()}
})

test('final text is reported when input transcription arrives after the completed response, exactly once',async()=>{
 const assistant=[]
 const app=await mountVoice({onAssistantTranscript:text=>assistant.push(text)})
 try{
  await app.start()
  await receive(app,{type:'input_audio_buffer.speech_started',item_id:'late-input'})
  await receive(app,{type:'input_audio_buffer.speech_stopped',item_id:'late-input'})
  await beginResponse(app,'answer-before-stt')
  await finishResponse(app,'answer-before-stt','completed',assistantOutput('late-stt-message','Resposta válida.'))
  assert.deepEqual(assistant,['Resposta válida.'])
  assert.equal(app.requests.filter(request=>request.path.endsWith('/turns')).length,0)
  await receive(app,{type:'conversation.item.input_audio_transcription.completed',item_id:'late-input',transcript:'Minha pergunta'})
  await receive(app,{type:'conversation.item.input_audio_transcription.completed',item_id:'late-input',transcript:'Minha pergunta'})
  assert.equal(app.requests.filter(request=>request.path.endsWith('/turns')).length,1)
  assert.deepEqual(assistant,['Resposta válida.'])
 }finally{await app.dispose()}
})

test('a producer switch resumes only the independently verified answer offered by the new session, once',async()=>{
 const work=deferred(),started=deferred(),assistant=[];let session=0
 const responseId='verified-b-answer'
 const app=await mountVoice({
  onToolCall:()=>{started.resolve();return work.promise},onAssistantTranscript:text=>assistant.push(text),
  sessionResponse:request=>json({sessionId:`voice-session-${++session}`,clientSecret:'ek_mock',model:'test-model',callUrl:'https://voice.mock/realtime/calls',maxSessionSeconds:600,budget:{remainingUsd:24},context:{clientId:request.clientId||null,conversationId:request.conversationId,contextEpoch:request.contextEpoch},...(request.clientId==='producer-b'?{resumeResponse:{responseId,context:{clientId:'producer-b',conversationId:request.conversationId,contextEpoch:request.contextEpoch}}}:{})},201)
 })
 try{
  await app.start();await askVoice(app,'Fale sobre o produtor B');await beginResponse(app,'resolve-b')
  let pending;await act(async()=>{pending=app.peers[0].dc.emit({type:'response.function_call_arguments.done',response_id:'resolve-b',name:'val_governed_tool',call_id:'resolve-call',arguments:'{"request":"Fale sobre o produtor B"}'});await started.promise})
  await app.update({clientId:'producer-b',contextEpoch:1})
  assert.equal(app.sessionCount,2)
  assert.equal(app.peers[1].dc.sent.filter(event=>event.type==='response.create').length,0,'server offer alone must not replay a previous answer')
  await act(async()=>{work.resolve({status:'OK',result:'Dados B do backend',responseId,contextScope:{producerId:'producer-b',conversationId:'voice-thread',contextEpoch:1}});await pending})
  const creates=app.peers[1].dc.sent.filter(event=>event.type==='response.create')
  assert.equal(creates.length,1)
  assert.equal(creates[0].response.tool_choice,'none')
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='conversation.item.create').length,0,'no tool text crosses sessions')
  await receive(app,{type:'response.created',response:{id:'b-resumed'}},1)
  await receive(app,{type:'response.done',response:{id:'b-resumed',status:'completed',output:assistantOutput('b-answer','Dados B do backend')}},1)
  assert.deepEqual(assistant,[],'the verified chat answer already exists; speech must not duplicate it')
  assert.equal(app.requests.filter(request=>request.path.endsWith('/turns')).length,0)
  await act(async()=>{app.peers[1].dc.onopen()})
  assert.equal(app.peers[1].dc.sent.filter(event=>event.type==='response.create').length,1)
 }finally{await app.dispose()}
})

test('a producer switch rejects missing or different response IDs, epochs and any newer user question',async()=>{
 for(const variant of ['different-response','wrong-producer','wrong-epoch','no-offer','new-question']){
  const work=deferred(),started=deferred();let session=0
  const app=await mountVoice({onToolCall:()=>{started.resolve();return work.promise},sessionResponse:request=>json({sessionId:`voice-session-${++session}`,clientSecret:'ek_mock',model:'test-model',callUrl:'https://voice.mock/realtime/calls',maxSessionSeconds:600,budget:{remainingUsd:24},context:{clientId:request.clientId||null,conversationId:request.conversationId,contextEpoch:request.contextEpoch},...(request.clientId==='producer-b'&&variant!=='no-offer'?{resumeResponse:{responseId:variant==='different-response'?'another-answer':'verified-b-answer',context:{clientId:variant==='wrong-producer'?'producer-a':'producer-b',conversationId:request.conversationId,contextEpoch:variant==='wrong-epoch'?0:request.contextEpoch}}}:{})},201)})
  try{
   await app.start();await askVoice(app,'Fale sobre B');await beginResponse(app,'resolve-b')
   let pending;await act(async()=>{pending=app.peers[0].dc.emit({type:'response.function_call_arguments.done',response_id:'resolve-b',name:'val_governed_tool',call_id:'resolve-call',arguments:'{}'});await started.promise})
   await app.update({clientId:'producer-b',contextEpoch:1})
   if(variant==='new-question')await receive(app,{type:'input_audio_buffer.speech_started',item_id:'new-b-input'},1)
   await act(async()=>{work.resolve({status:'OK',result:'Dados B',responseId:'verified-b-answer',contextScope:{producerId:'producer-b',conversationId:'voice-thread',contextEpoch:1}});await pending})
   assert.equal(app.peers[1].dc.sent.filter(event=>event.type==='response.create').length,0,variant)
  }finally{await app.dispose()}
 }
})

test('provider session updates and late audio completion do not override pause',async()=>{
 const app=await mountVoice()
 try{
  await app.start();await askVoice(app,'Explique o manejo');await beginResponse(app,'paused-audio')
  await receive(app,{type:'output_audio_buffer.started',response_id:'paused-audio'})
  await act(async()=>{app.voice.pause()})
  await receive(app,{type:'session.updated'})
  await receive(app,{type:'output_audio_buffer.stopped',response_id:'paused-audio'})
  await receive(app,{type:'output_audio_buffer.started',response_id:'paused-audio'})
  assert.equal(app.voice.state.status,'PAUSED')
  assert.equal(app.voice.state.microphoneActive,false)
  assert.equal(app.streams[0].track.enabled,false)
 }finally{await app.dispose()}
})

test('a completed governed turn already recorded by the server is not posted to the browser turn endpoint again',async()=>{
 const assistant=[]
 const app=await mountVoice({onAssistantTranscript:text=>assistant.push(text),onToolCall:async()=>({status:'COMPLETED',responseId:'server-answer-1',contextScope:{producerId:null,conversationId:'voice-thread',contextEpoch:0},result:'Resposta já registrada pelo servidor.'})})
 try{
  await app.start();await askVoice(app,'Explique o manejo integrado');await beginResponse(app,'governed')
  await receive(app,{type:'response.function_call_arguments.done',response_id:'governed',call_id:'governed-call',name:'val_governed_tool',arguments:'{"request":"Explique o manejo integrado"}'})
  await finishResponse(app,'governed','completed',[{type:'function_call',call_id:'governed-call'}])
  await beginResponse(app,'spoken-governed')
  await finishResponse(app,'spoken-governed','completed',assistantOutput('spoken','Resposta já registrada pelo servidor.'))
  assert.deepEqual(assistant,['Resposta já registrada pelo servidor.'])
  assert.equal(app.requests.filter(request=>request.path.endsWith('/turns')).length,0)
 }finally{await app.dispose()}
})

test('identical governed calls with different provider call IDs share one execution within the turn',async()=>{
 const work=deferred(),started=deferred();let calls=0
 const app=await mountVoice({onToolCall:()=>{calls++;started.resolve();return work.promise}})
 try{
  await app.start();await askVoice(app,'Registre a visita');await beginResponse(app,'duplicate-response')
  const makeCall=callId=>({type:'response.function_call_arguments.done',response_id:'duplicate-response',call_id:callId,name:'val_governed_tool',arguments:'{"request":"Registre a visita"}'})
  let first,second;await act(async()=>{first=app.peers[0].dc.emit(makeCall('one'));await started.promise;second=app.peers[0].dc.emit(makeCall('two'))})
  await finishResponse(app,'duplicate-response','completed',[{type:'function_call',call_id:'one'},{type:'function_call',call_id:'two'}])
  await act(async()=>{work.resolve({status:'OK',result:'Registro concluído.'});await Promise.all([first,second])})
  assert.equal(calls,1)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='conversation.item.create').length,2)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,1)
 }finally{await app.dispose()}
})

test('missing response.created and response.done cannot leave recovery thinking forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const app=await mountVoice()
 try{
  await app.start();await askVoice(app,'Pergunta preservada em falha silenciosa')
  await act(async()=>{t.mock.timers.tick(20_000)})
  assert.equal(app.voice.state.recoveringTurn,true)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,1)
  await act(async()=>{t.mock.timers.tick(20_000)})
  assert.equal(app.voice.state.status,'LISTENING')
  assert.equal(app.voice.state.recoveringTurn,false)
  assert.equal(app.voice.state.canRetryTurn,true)
  assert.equal(app.voice.state.interimTranscript,'Pergunta preservada em falha silenciosa')
  assert.equal(app.sessionCount,1)
  assert.equal(app.peers[0].dc.sent.filter(event=>event.type==='response.create').length,1)
 }finally{await app.dispose();t.mock.timers.reset()}
})
