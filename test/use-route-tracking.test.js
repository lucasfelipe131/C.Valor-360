import assert from 'node:assert/strict'
import test,{before,after} from 'node:test'
import {fileURLToPath} from 'node:url'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {createServer} from 'vite'

let vite,useRouteTracking
before(async()=>{
 vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 ;({default:useRouteTracking}=await vite.ssrLoadModule('/src/components/map/useRouteTracking.js'))
})
after(async()=>{await vite?.close()})
const response=payload=>({ok:true,status:200,json:async()=>payload})
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

function fixture(fetchImpl){
 const previousFetch=globalThis.fetch;const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator')
 const requests=[];const watches=[];const cleared=[];const traces=[];const positions=[];const errors=[]
 globalThis.fetch=(url,options)=>{const call={url,options,body:JSON.parse(options.body)};requests.push(call);return fetchImpl?fetchImpl(call):Promise.resolve(response({trace:[]}))}
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{watchPosition:(success,error)=>{watches.push({success,error});return watches.length},clearWatch:id=>cleared.push(id)}}})
 let latest,renderer
 function Probe(props){latest=useRouteTracking({...props,onTrace:value=>traces.push(value),onPosition:value=>positions.push(value),onError:value=>errors.push(value)});return null}
 const props={date:'2026-09-06',storageScope:'owner-a'}
 act(()=>{renderer=TestRenderer.create(React.createElement(Probe,props))})
 return {requests,watches,cleared,traces,positions,errors,get hook(){return latest},update:next=>act(()=>renderer.update(React.createElement(Probe,{...props,...next}))),unmount:()=>act(()=>renderer.unmount()),async cleanup(){act(()=>renderer.unmount());await tick();globalThis.fetch=previousFetch;if(previousNavigator)Object.defineProperty(globalThis,'navigator',previousNavigator);else delete globalThis.navigator}}
}

test('abrir roteiro não inicia GPS; resposta tardia de iniciar após sair não cria observador',async()=>{
 const pending=deferred()
 const f=fixture(call=>call.body.tracking===true?pending.promise:Promise.resolve(response({trace:[]})))
 try{
  assert.equal(f.requests.length,0);assert.equal(f.watches.length,0)
  let start;act(()=>{start=f.hook.start()});await tick()
  f.unmount()
  await act(async()=>{pending.resolve(response({trace:[]}));await start;await tick()})
  assert.equal(f.watches.length,0)
  assert.equal(f.traces.length,0)
  assert.deepEqual(f.requests.map(call=>call.body.tracking),[true,false])
 }finally{await f.cleanup()}
})

test('pausa para GPS imediatamente e bloqueia reinício até a confirmação serializada',async()=>{
 const stopping=deferred();let holdStop=true
 const f=fixture(call=>call.body.tracking===false&&holdStop?stopping.promise:Promise.resolve(response({trace:[]})))
 try{
  await act(async()=>{await f.hook.start()})
  assert.equal(f.watches.length,1)
  let stop;act(()=>{stop=f.hook.stop()});await tick()
  assert.equal(f.hook.tracking,false);assert.equal(f.hook.busy,true)
  assert.deepEqual(f.cleared,[1])
  await act(async()=>{await f.hook.start()})
  assert.equal(f.watches.length,1)
  assert.deepEqual(f.requests.map(call=>call.body.tracking),[true,false])
  await act(async()=>{holdStop=false;stopping.resolve(response({trace:[]}));await stop;await f.hook.start()})
  assert.equal(f.watches.length,2);assert.equal(f.hook.tracking,true)
  assert.deepEqual(f.requests.map(call=>call.body.tracking),[true,false,true])
  await act(async()=>{f.watches[0].success({coords:{latitude:1,longitude:2,accuracy:5},timestamp:Date.now()});await tick()})
  assert.equal(f.positions.length,0,'callback atrasado do GPS anterior não entra na nova captura')
 }finally{holdStop=false;stopping.resolve(response({trace:[]}));await f.cleanup()}
})

test('troca de dia durante início pendente encerra o dia anterior sem GPS nem callbacks antigos',async()=>{
 const pending=deferred()
 const f=fixture(call=>call.body.tracking===true?pending.promise:Promise.resolve(response({trace:[{lat:9,lng:9}]})))
 try{
  let start;act(()=>{start=f.hook.start()});await tick()
  f.update({date:'2026-09-07'})
  await act(async()=>{pending.resolve(response({trace:[]}));await start;await tick()})
  assert.equal(f.watches.length,0);assert.equal(f.traces.length,0)
  assert.equal(f.hook.tracking,false);assert.equal(f.hook.busy,false)
  assert.equal(f.requests.length,2)
  assert.ok(f.requests.every(call=>call.url.includes('date=2026-09-06')))
  assert.equal(f.requests[1].body.tracking,false)
 }finally{pending.resolve(response({trace:[]}));await f.cleanup()}
})

test('requisição que não responde expira em 12 segundos sem iniciar GPS',async context=>{
 const f=fixture(()=>new Promise(()=>{}))
 context.mock.timers.enable({apis:['setTimeout']})
 try{
  let start;act(()=>{start=f.hook.start()});await tick()
  await act(async()=>{context.mock.timers.tick(12000);await start})
  assert.equal(f.requests[0].options.signal.aborted,true)
  assert.equal(f.watches.length,0);assert.equal(f.hook.busy,false)
  assert.ok(f.errors.some(error=>error.includes('12 segundos')))
 }finally{context.mock.timers.reset();await f.cleanup()}
})

test('troca de identidade cancela início pendente e descarta callbacks e fila anteriores',async()=>{
 const pending=deferred()
 const f=fixture(call=>call.body.tracking===true&&f.requests.length===1?pending.promise:Promise.resolve(response({trace:[]})))
 try{
  let start;act(()=>{start=f.hook.start()});await tick()
  f.update({storageScope:'owner-b'})
  assert.equal(f.requests[0].options.signal.aborted,true)
  await act(async()=>{pending.resolve(response({trace:[{lat:1,lng:1}]}));await start})
  assert.equal(f.watches.length,0);assert.equal(f.traces.length,0)
  assert.equal(f.requests.length,1,'não envia uma pausa da identidade anterior sob a nova sessão')
  await act(async()=>{await f.hook.start()})
  const oldWatch=f.watches[0]
  f.update({storageScope:'owner-c'})
  await act(async()=>{oldWatch.success({coords:{latitude:1,longitude:2,accuracy:5},timestamp:Date.now()});await tick()})
  assert.deepEqual(f.cleared,[1]);assert.equal(f.positions.length,0);assert.equal(f.requests.length,2)
 }finally{pending.resolve(response({trace:[]}));await f.cleanup()}
})

test('ponto não salvo é preservado e reenviado uma vez com a próxima amostra',async()=>{
 let failed=false
 const f=fixture(call=>{
  if(call.body.tracePoints?.length&&!failed){failed=true;return Promise.reject(new Error('conexão interrompida'))}
  return Promise.resolve(response({trace:call.body.tracePoints||[]}))
 })
 try{
  await act(async()=>{await f.hook.start()})
  const timestamp=Date.now()
  await act(async()=>{f.watches[0].success({coords:{latitude:1,longitude:2,accuracy:5},timestamp});await tick()})
  assert.equal(f.requests.length,2)
  await tick();assert.equal(f.requests.length,2,'falha não cria repetição automática')
  await act(async()=>{f.watches[0].success({coords:{latitude:1.01,longitude:2.01,accuracy:5},timestamp:timestamp+15000});await tick()})
  assert.equal(f.requests[2].body.tracePoints.length,2)
  assert.equal(f.requests[2].body.tracePoints[0].timestamp,new Date(timestamp).toISOString())
  assert.equal(f.traces.at(-1).length,2)
  await act(async()=>{f.watches[0].error({code:1});await tick()})
  assert.equal(f.hook.tracking,false);assert.deepEqual(f.cleared,[1])
  assert.ok(f.errors.some(error=>error.includes('Permita a localização')))
 }finally{await f.cleanup()}
})
