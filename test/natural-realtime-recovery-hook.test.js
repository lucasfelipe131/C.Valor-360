import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import useNaturalRealtimeVoice from '../src/hooks/useNaturalRealtimeVoice.js'

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})

async function mountVoice({permissionQuery=async()=>({state:'granted'}),statusResponse=null,getMedia=null,usageResponse=null,onToolCall=null}={}){
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
  if(path==='/api/v1/realtime-voice/sessions'){sessionCount++;return json({sessionId:`voice-session-${sessionCount}`,clientSecret:'ek_mock',model:'test-model',callUrl:'https://voice.mock/realtime/calls',maxSessionSeconds:600,budget:{remainingUsd:24},context:{clientId:payload.clientId||null,conversationId:payload.conversationId,contextEpoch:payload.contextEpoch}},201)}
  if(path==='https://voice.mock/realtime/calls')return new Response('v=0\n',{status:200})
  if(String(path).endsWith('/usage'))return usageResponse?usageResponse(payload):json({accepted:true,remainingUsd:24,exhausted:false})
  if(String(path).endsWith('/turns'))return json({accepted:true,reconnectRequired:false})
  throw new Error(`Unexpected mock request ${path}`)
 })
 const initialProps={conversationId:'voice-thread',contextEpoch:0,onToolCall}
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
  await act(async()=>{app.voice.pause()})
  await act(async()=>{tool.resolve({status:'OK',message:'Resultado governado'});await eventWork})
  assert.equal(channel.sent.filter(event=>event.type==='conversation.item.create').length,1)
  assert.equal(channel.sent.filter(event=>event.type==='response.create').length,0)
  assert.equal(app.voice.state.status,'PAUSED')
  await act(async()=>{app.voice.resume()})
  assert.equal(channel.sent.filter(event=>event.type==='response.create').length,1)
  assert.equal(app.voice.state.status,'LISTENING')
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
