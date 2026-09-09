import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {basename,dirname,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {createRealtimeVoiceService} from '../server/realtime-voice/service.js'
import {createConversationSessionStore} from '../server/decision-copilot/conversation-session-store.js'
import {createInMemoryRealtimeCostStore} from '../server/realtime-voice/cost-control.js'
import {createValWorkspaceContext,scopeWorkspaceToConversation} from '../src/lib/val-workspace-context.js'

// Real App, Copilot, voice stage and WebRTC hook. Stub unrelated routed views
// and browser/provider boundaries; never open a microphone or paid session.
const dir=await mkdtemp(new URL('../.persistent-test-',import.meta.url).pathname)
after(()=>rm(dir,{recursive:true,force:true}))
const keep=new Set(['GlobalValCopilot','ValRealtimeConversation','Visits'])
const namedCards=['AgronomicInsightCard','CalculationCard','CommitmentCard','DecisionCard','DiagnosisCard','EvidenceCard','GenericToolCard','KnowledgeCard','MarketCard','OpportunityCard','PrepareVisitCard']
await build({entryPoints:['src/App.jsx'],outfile:dir+'/App.js',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'unrelated-ui-boundaries',setup(builder){
 builder.onResolve({filter:/^react$/,namespace:'ui-boundary'},()=>({path:'react',external:true}))
 builder.onResolve({filter:/^\./},args=>{
  const candidate=resolve(dirname(args.importer),args.path)
  const name=basename(candidate).replace(/\.jsx$/,'')
  if(!/\/src\/(components|pages)\//.test(candidate)||keep.has(name)||(!existsSync(candidate+'.jsx')&&!candidate.endsWith('.jsx')))return
  return {path:name,namespace:'ui-boundary'}
 })
 builder.onLoad({filter:/.*/,namespace:'ui-boundary'},args=>({loader:'js',contents:`import React from 'react';const Stub=props=>React.createElement('test-${args.path}',props);export default Stub;${args.path==='DecisionCards'?namedCards.map(name=>`export const ${name}=Stub;`).join(''):''}`}))
}}]})
const App=(await import(pathToFileURL(dir+'/App.js'))).default
const clients=[{id:'demo-a',name:'Produtor DEMO A',isDemo:true},{id:'demo-b',name:'Produtor DEMO B',isDemo:true}]
const user={id:'test-owner',name:'Consultor DEMO',tenantId:'test-tenant',ownerId:'test-owner',storageScope:'test-tenant:test-owner',role:'consultant'}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
const flush=()=>new Promise(resolve=>setImmediate(resolve))
class Storage{getItem(key){return this[key]??null}setItem(key,value){this[key]=String(value)}removeItem(key){delete this[key]}}
async function mountApp({mobile=false,apiResponse=null,portfolioVisits=[]}={}){
 const saved=new Map(),requests=[],streams=[],peers=[],audios=[],listeners=new Map(),timeouts=new Set()
 const replace=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})}
 class Peer{
  constructor(){this.connectionState='new';peers.push(this)}
  addTrack(track){this.track=track}
  createDataChannel(){this.dc={readyState:'connecting',sent:[],send(value){this.sent.push(JSON.parse(value))},close(){this.readyState='closed'},emit(event){return this.onmessage?.({data:JSON.stringify(event)})}};return this.dc}
  async createOffer(){return {type:'offer',sdp:'v=0\n'}}
  async setLocalDescription(){}
  async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.dc.readyState='open';this.dc.onopen?.()}
  close(){this.connectionState='closed';this.onconnectionstatechange?.()}
 }
 replace('isSecureContext',true);replace('RTCPeerConnection',Peer)
 replace('localStorage',new Storage());replace('sessionStorage',new Storage())
 replace('navigator',{permissions:{query:async()=>({state:'granted'})},mediaDevices:{getUserMedia:async()=>{const track={enabled:true,stopped:false,stop(){this.stopped=true}},stream={track,getTracks:()=>[track],getAudioTracks:()=>[track]};streams.push(stream);return stream}}})
 replace('requestAnimationFrame',callback=>{callback();return 1})
 replace('window',{location:{search:''},matchMedia:()=>({matches:!mobile}),scrollTo(){},requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame(){},setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timeouts.add(id);return id},clearTimeout,setInterval,clearInterval,addEventListener:(event,fn)=>{const callbacks=listeners.get(event)||new Set();callbacks.add(fn);listeners.set(event,callbacks)},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn),dispatchEvent:event=>listeners.get(event.type)?.forEach(fn=>fn(event))})
 replace('document',{body:{classList:{add(){},remove(){}},appendChild(){}},querySelector:()=>null,addEventListener(){},removeEventListener(){},createElement(){const audio={style:{},setAttribute(){},play:async()=>{},pause(){},remove(){this.removed=true}};audios.push(audio);return audio}})
 replace('fetch',async(path,options={})=>{
  const payload=options.body&&String(path).startsWith('/api/')?JSON.parse(options.body):null;requests.push({path:String(path),payload,signal:options.signal})
  if(apiResponse){const custom=await apiResponse(String(path),payload);if(custom)return custom}
  if(path==='/api/auth/session')return json({authenticated:true,user})
  if(path==='/api/intelligence')return json({clients,visits:portfolioVisits,opportunities:[]})
  if(path==='/api/auth/logout'||path==='/api/usage/events'||path==='/api/val/latency-metrics')return json({ok:true})
  if(path==='/api/demo/status')return json({enabled:false})
  if(path==='/api/v1/realtime-voice/status')return json({available:true,canRetry:true})
  if(path==='/api/v1/realtime-voice/sessions')return json({sessionId:'voice-'+requests.filter(r=>r.path===path).length,clientSecret:'mock-only',model:'mock',callUrl:'https://voice.mock/calls',maxSessionSeconds:600,context:{clientId:payload.clientId||null,conversationId:payload.conversationId,contextEpoch:payload.contextEpoch}},201)
  if(path==='https://voice.mock/calls'||path==='https://api.openai.com/v1/realtime/calls')return new Response('v=0\n',{status:200})
  if(path.endsWith('/usage'))return json({accepted:true,remainingUsd:24,exhausted:false})
  if(path.endsWith('/turns'))return json({accepted:true,reconnectRequired:false})
  if(path==='/api/val/chat')return json({error:'Fonte de teste indisponível.'},503)
  if(path.startsWith('/api/val/progress'))return json({done:true})
  throw new Error('Unexpected test request '+path)
 })
 let renderer
 await act(async()=>{renderer=TestRenderer.create(React.createElement(App),{createNodeMock:()=>({focus(){},blur(){},scrollTop:0,scrollHeight:100})});await flush()})
 const stub=name=>renderer.root.findByType('test-'+name)
 const button=label=>renderer.root.findAll(node=>node.type==='button'&&node.props['aria-label']===label)[0]
 const click=async label=>{const node=button(label);assert.ok(node,'button '+label);await act(async()=>{await node.props.onClick();await flush()})}
 const navigate=async page=>{await act(async()=>{const nav=renderer.root.findAllByType('test-ProducerNavigation')[0]||renderer.root.findAllByType('test-Topbar')[0]||renderer.root.findAllByType('test-Opportunities')[0];if(nav)nav.props.onNavigate(page);else stub('Sidebar').props.onSelect(typeof page==='string'?{page}:page);await flush()})}
 const panel=()=>renderer.root.findAll(node=>node.type==='section'&&String(node.props.className).includes('val-persistent-copilot'))[0]
 const voice=()=>renderer.root.findAllByProps({'aria-label':'Modo conversa por voz'})[0]
 return {renderer,requests,streams,peers,audios,stub,button,click,navigate,panel,voice,
  async ask(message){await act(async()=>renderer.root.findByType('textarea').props.onChange({target:{value:message}}));await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await flush()})},
  async chooseClient(id){await act(async()=>{renderer.root.findAll(node=>node.type==='select'&&node.props.value!==undefined)[0].props.onChange({target:{value:id}});await flush()})},
  async open(client=clients[0]){await act(async()=>{const from=renderer.root.findAllByType('test-Dashboard')[0]||renderer.root.findAllByType('test-Clients')[0]||stub('Topbar');(from.props.onClient||from.props.onOpenClient)(client);await flush()});},
  async dispose(){try{await act(async()=>{renderer.unmount();await flush()})}finally{for(const id of timeouts)clearTimeout(id);for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
 }
}

test('active voice, draft and connection survive navigation across producer, visits, opportunities, reports and tools',async()=>{
 const app=await mountApp()
 try{
  await app.open()
  const draft=app.renderer.root.findByType('textarea');await act(async()=>draft.props.onChange({target:{value:'Dúvida ainda não enviada'}}))
  await app.click('Iniciar modo conversa por voz');assert.equal(app.voice().props['data-microphone-active'],'true')
  const peer=app.peers[0],stream=app.streams[0],session=app.requests.find(r=>r.path==='/api/v1/realtime-voice/sessions').payload
  for(const target of ['visits','opportunities','reports',{page:'agro',clientId:'demo-a',tool:'produtores'},'clients']){
   await app.navigate(target)
   assert.ok(app.panel());assert.match(app.panel().props.className,/is-compact/)
   assert.equal(app.peers.length,1);assert.equal(app.streams.length,1);assert.equal(stream.track.stopped,false)
   assert.equal(app.voice().props['data-microphone-active'],'true')
   assert.equal(peer.connectionState,'connected')
  }
  await act(async()=>app.stub('Topbar').props.onOpenVal());assert.doesNotMatch(app.panel().props.className,/is-compact/)
  assert.equal(app.peers.length,1,'reopening the rail must not reseed the voice session')
  await act(async()=>peer.dc.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'t1',transcript:'Pergunta do produtor A'}))
  assert.ok(JSON.stringify(sessionStorage).includes('Pergunta do produtor A'))
  await app.click('Sair do modo conversa')
  assert.equal(app.renderer.root.findByType('textarea').props.value,'Dúvida ainda não enviada')
  assert.equal(app.requests.filter(r=>r.path==='/api/v1/realtime-voice/sessions').length,1)
  assert.equal(app.requests.some(r=>r.payload?.disconnectReason==='COMPONENT_UNMOUNT'),false)
  assert.equal(session.clientId,'demo-a')
 }finally{await app.dispose()}
})

test('explicit producer switch reconnects with the correct producer and discards late transcripts',async()=>{
 const app=await mountApp()
 try{
  await app.open();await app.click('Iniciar modo conversa por voz')
  const first=app.peers[0]
  await app.navigate('clients');await app.open(clients[1])
  const sessions=app.requests.filter(r=>r.path==='/api/v1/realtime-voice/sessions')
  assert.equal(sessions.length,2);assert.equal(sessions[1].payload.clientId,'demo-b')
  assert.notEqual(sessions[0].payload.conversationId,sessions[1].payload.conversationId)
  assert.equal(app.streams[0].track.stopped,true);assert.equal(app.streams[1].track.enabled,true)
  await act(async()=>first.dc.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'stale',transcript:'OLD PRODUCER MUST NOT APPEAR'}))
  assert.equal(JSON.stringify(sessionStorage).includes('OLD PRODUCER MUST NOT APPEAR'),false)
  assert.ok(app.requests.some(r=>r.payload?.disconnectReason==='CONTEXT_SCOPE_CHANGED'))
 }finally{await app.dispose()}
})

test('pause survives navigation; explicit close and logout release microphone and audio',async()=>{
 const app=await mountApp()
 try{
  await app.open();await app.click('Iniciar modo conversa por voz');await app.click('Pausar modo conversa e desligar o microfone')
  await app.navigate('reports');assert.equal(app.streams[0].track.enabled,false);assert.equal(app.voice().props['data-microphone-active'],'false')
  await app.click('Restaurar painel da VAL');await app.click('Retomar modo conversa');assert.equal(app.streams[0].track.enabled,true)
  await app.click('Fechar Copiloto');assert.equal(app.streams[0].track.stopped,true);assert.ok(app.stub('Reports'))
  await act(async()=>app.stub('Topbar').props.onOpenVal());await app.click('Iniciar modo conversa por voz')
  await app.navigate('settings');await act(async()=>{await app.stub('Settings').props.onLogout();await flush()})
  assert.equal(app.panel(),undefined);assert.equal(app.streams.every(s=>s.track.stopped),true);assert.equal(app.audios.every(a=>a.removed),true)
  assert.ok(app.stub('Login'))
 }finally{await app.dispose()}
})

test('workspace hints retain the active conversation and reject foreign page entities',()=>{
 const workspace=createValWorkspaceContext({module:'agro',client:clients[1],property:{id:'b-farm'},field:{id:'b-field'},analysis:{id:'b-soil'},opportunity:{id:'b-opp'}})
 const actual=scopeWorkspaceToConversation(workspace,{client:clients[0],conversationId:'chat-a'})
 assert.equal(actual.current_module,'agro');assert.equal(actual.current_client.id,'demo-a');assert.equal(actual.current_conversation.id,'chat-a')
 for(const key of ['property','field','analysis','opportunity'])assert.equal(actual['current_'+key],null)
 const same=scopeWorkspaceToConversation(workspace,{client:clients[1],conversationId:'chat-b'})
 assert.equal(same.current_field.id,'b-field');assert.equal(same.current_analysis.id,'b-soil');assert.equal(same.persistence_mode,'NONE')
 const general=scopeWorkspaceToConversation(workspace,{conversationId:'general'})
 assert.equal(general.current_client,null);assert.equal(general.current_analysis,null)
})

test('mobile navigation and returning to the producer keep an explicitly started voice session open',async()=>{
 const app=await mountApp({mobile:true})
 try{
  await act(async()=>{app.stub('Dashboard').props.onOpenCopilot({client:clients[0],conversation:true});await flush()})
  assert.equal(app.voice().props['data-microphone-active'],'true');assert.equal(app.peers.length,1)
  await app.navigate('clients');assert.match(app.panel().props.className,/is-compact/)
  await app.open(clients[0]);assert.ok(app.panel());assert.equal(app.voice().props['data-microphone-active'],'true')
  assert.equal(app.peers.length,1);assert.equal(app.streams[0].track.stopped,false)
 }finally{await app.dispose()}
})


test('opening the side chat never selects the first portfolio producer, and general mode stays general after refresh',async()=>{
 const app=await mountApp()
 try{
  assert.equal(app.stub('Topbar').props.client,null)
  await act(async()=>{app.stub('Topbar').props.onOpenVal();await flush()})
  assert.ok(app.stub('Dashboard'));assert.ok(app.panel());assert.doesNotMatch(app.panel().props.className,/is-compact/)
  assert.equal(app.renderer.root.findByType('select').props.value,'')
  await app.open();await app.chooseClient('')
  assert.equal(app.renderer.root.findByType('select').props.value,'')
  await act(async()=>{await app.stub('Client360').props.onRefreshPortfolio();await flush()})
  assert.equal(app.renderer.root.findByType('select').props.value,'')
  await app.click('Reduzir VAL para ícones')
  await act(async()=>{app.stub('Topbar').props.onOpenVal();await flush()})
  assert.doesNotMatch(app.panel().props.className,/is-compact/)
  assert.equal(app.renderer.root.findByType('select').props.value,'')
  await app.click('Fechar Copiloto')
  await act(async()=>{app.stub('Topbar').props.onOpenVal();await flush()})
  assert.equal(app.renderer.root.findByType('select').props.value,'')
 }finally{await app.dispose()}
})

function replyFor(request,{client=clients[1],resolve=false}={}){
 const conversationId=request.conversationId,producerId=client?.id||null,contextEpoch=1,domain='GENERAL'
 const answer=resolve?'Abrindo o produtor escolhido.':'A área ainda não foi informada.'
 return {advice:{answer,ai_reasoning:{organization:{id:user.tenantId},client:{id:producerId},conversation_id:conversationId,intent:'ASK_CLIENT',recommended_strategy:{reading:answer},premises:{context_scope:{tenant_id:user.tenantId,owner_id:user.ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:contextEpoch,domain}}}},responseScope:{contractVersion:'val.response_scope.v1',tenantId:user.tenantId,ownerId:user.ownerId,producerId,conversationId,contextEpoch,domain},...(resolve?{conversationResolution:{status:'RESOLVED',client},workspaceAction:{contract_version:'val.workspace_action.v1',type:'OPEN_CLIENT',page:'client360',client_id:producerId}}:{})}
}

test('a producer resolved by the chat opens its profile without replacing the conversation; basic follow-ups keep the same scope',async()=>{
 let count=0
 const app=await mountApp({apiResponse:(path,request)=>path==='/api/val/chat'?json(replyFor(request,{resolve:++count===1})):null})
 try{
  await act(async()=>{app.stub('Topbar').props.onOpenVal();await flush()})
  await app.ask('Abra o produtor DEMO B')
  assert.equal(app.stub('Client360').props.client.id,'demo-b')
  assert.equal(app.renderer.root.findByType('select').props.value,'demo-b')
  assert.doesNotMatch(app.panel().props.className,/is-compact/)
  await app.ask('E a área dele?')
  const requests=app.requests.filter(r=>r.path==='/api/val/chat')
  assert.equal(requests.length,2)
  assert.equal(requests[0].payload.clientId,'');assert.equal(requests[1].payload.clientId,'demo-b')
  assert.equal(requests[1].payload.conversationId,requests[0].payload.conversationId)
  await app.ask('Repete')
  assert.equal(app.requests.filter(r=>r.path==='/api/val/chat').length,2,'repeat reuses the last completed answer')
  assert.ok(JSON.stringify(app.renderer.toJSON()).includes('A área ainda não foi informada.'))
  await app.navigate('reports')
  await act(async()=>app.stub('Topbar').props.onOpenVal())
  await app.ask('E o histórico dele?')
  const last=app.requests.filter(r=>r.path==='/api/val/chat').at(-1).payload
  assert.equal(last.clientId,'demo-b');assert.equal(last.conversationId,requests[0].payload.conversationId)
 }finally{await app.dispose()}
})

test('real App + voice hook + service reconnect after a domain epoch change and server restart without losing the chosen general scope',async()=>{
 const conversationSessions=createConversationSessionStore(),providerRequests=[]
 const service=createRealtimeVoiceService({runtimeConfig:{realtimeVoiceEnabled:true,realtimeVoiceTesters:[user.id]},repository:{},conversationSessions,costStore:createInMemoryRealtimeCostStore(),client:{realtime:{clientSecrets:{create:async body=>{providerRequests.push(body);return {value:'mock-secret',expires_at:60}}}}}})
 const app=await mountApp({apiResponse:async(path,input)=>{
  try{
   if(path==='/api/v1/realtime-voice/sessions')return json(await service.createSession({identity:user,input}),201)
   const match=path.match(/sessions\/([^/]+)\/(turns|usage)$/)
   if(match)return json(await service[match[2]==='turns'?'recordTurn':'recordUsage']({identity:user,sessionId:match[1],input}),202)
  }catch(error){return json({error:error.message,code:error.code,currentContext:error.currentContext},error.statusCode||500)}
 }})
 try{
  await act(async()=>{app.stub('Topbar').props.onOpenVal();await flush()})
  await app.click('Iniciar modo conversa por voz')
  const first=app.peers[0]
  await act(async()=>{first.dc.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'one',transcript:'Quero entender manejo de plantas daninhas na soja'});await flush()})
  await act(async()=>{first.dc.emit({type:'response.output_audio_transcript.done',response_id:'one',transcript:'Vamos falar do manejo.'});await flush();await flush()})
  assert.equal(app.voice().props['data-microphone-active'],'true')
  assert.equal(app.peers.length,2);assert.equal(app.streams.length,2)
  assert.match(providerRequests[1].session.instructions,/Quero entender manejo de plantas daninhas na soja/)
  const second=app.peers[1]
  await act(async()=>{second.dc.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'two',transcript:'E o crédito rural para custeio?'});await flush()})
  await act(async()=>{second.dc.emit({type:'response.output_audio_transcript.done',response_id:'two',transcript:'Vamos verificar essa dúvida.'});await flush();await flush()})
  assert.equal(app.voice().props['data-microphone-active'],'true')
  const requests=app.requests.filter(r=>r.path==='/api/v1/realtime-voice/sessions')
  assert.equal(requests.length,4,'one rejected stale epoch is retried once before a paid session')
  assert.equal(requests[0].payload.contextEpoch,0);assert.equal(requests[3].payload.contextEpoch,1)
  assert.equal(providerRequests.length,3);assert.equal(requests[3].payload.clientId,'')
  await app.navigate('reports');assert.equal(app.peers.length,3)
  await app.click('Restaurar painel da VAL');await app.click('Sair do modo conversa')
  conversationSessions.clear()
  await app.click('Iniciar modo conversa por voz')
  assert.equal(app.voice().props['data-microphone-active'],'true')
  assert.equal(app.requests.filter(r=>r.path==='/api/v1/realtime-voice/sessions').at(-1).payload.contextEpoch,0)
  assert.equal(providerRequests.length,4)
  await act(async()=>first.dc.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'stale',transcript:'IGNORAR_EVENTO_ANTIGO'}))
  assert.doesNotMatch(JSON.stringify(sessionStorage),/IGNORAR_EVENTO_ANTIGO/)
 }finally{await app.dispose()}
})


test('opening the real Visits page and a new visit does not replace the chat with the first scheduled producer',async()=>{
 const app=await mountApp({portfolioVisits:[{id:'visit-a',clientId:clients[0].id,status:'Agendada',scheduledAt:new Date(Date.now()+86400000).toISOString()}]})
 try{
  await app.open(clients[1]);await app.navigate('visits')
  const chatSelect=()=>app.renderer.root.findAll(node=>node.type==='select'&&!node.props.required)[0]
  assert.equal(chatSelect().props.value,clients[1].id)
  const button=app.renderer.root.findAll(node=>node.type==='button'&&node.children.includes('Nova visita'))[0]
  await act(async()=>{button.props.onClick();await flush()})
  assert.equal(app.renderer.root.findAll(node=>node.type==='select'&&node.props.required)[0].props.value,'')
  assert.equal(chatSelect().props.value,clients[1].id)
  await app.navigate('val');assert.equal(chatSelect().props.value,clients[1].id)
 }finally{await app.dispose()}
})

test('explicitly reopening the displayed producer restores its chat after selecting general mode',async()=>{
 const app=await mountApp()
 try{
  await app.open();await app.chooseClient('');assert.equal(app.renderer.root.findByType('select').props.value,'')
  await app.open();assert.equal(app.renderer.root.findByType('select').props.value,clients[0].id)
 }finally{await app.dispose()}
})
