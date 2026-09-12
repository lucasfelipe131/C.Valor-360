import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {build} from 'esbuild'

const day=offset=>{const value=new Date();value.setDate(value.getDate()+offset);return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`}
const client=(id,lat=0,lng=0,extra={})=>({id,name:`Produtor ${id}`,location:{lat,lng},...extra})
const visit=(id,clientId,time='12:00',lifecycleStatus='PLANNED',extra={})=>({id,clientId,date:day(0),time,lifecycleStatus,...extra})
const response=value=>new Response(JSON.stringify(value))
const road={available:true,distanceMeters:20000,durationSeconds:1200,geometry:[[0,0],[0,0.1]]}
const textOf=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(textOf).join('')
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

// Exercise the real JSX, hooks and HTTP client. Only the Leaflet surface and
// separately tested GPS hook are passive boundaries in this UI harness.
let componentPromise
function loadRouteMap(){
 componentPromise||=(async()=>{
  const require=createRequire(import.meta.url)
  const bundle=await build({entryPoints:['src/components/map/RouteMap.jsx'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
   name:'route-ui-boundaries',setup(builder){
    builder.onResolve({filter:/\/SatelliteMap$/},()=>({path:'map',namespace:'route-ui'}))
    builder.onResolve({filter:/\/useRouteTracking$/},()=>({path:'tracking',namespace:'route-ui'}))
    builder.onResolve({filter:/\.css$/},()=>({path:'style',namespace:'route-ui'}))
    builder.onLoad({filter:/.*/,namespace:'route-ui'},args=>({contents:args.path==='map'
     ?"import React from 'react';export default function SatelliteMap(props){return React.createElement('route-map-stub',props)}"
     :args.path==='tracking'
      ?'export default function useRouteTracking(options){globalThis.__routeUITest.trackingOptions=options;return globalThis.__routeUITest.tracking}'
      :'export default {}',loader:'js'}))
    builder.onResolve({filter:/^(react|lucide-react)$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}))
   }
  }]})
  return (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)).default
 })()
 return componentPromise
}

async function withRoute(props,run,{fetchRequest}={}){
 const RouteMap=await loadRouteMap()
 const keys=['fetch','document','navigator','__routeUITest']
 const globals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
 const state={requests:[],starts:0,stops:0,locations:0,scrolls:[],tracking:{tracking:false,busy:false}}
 state.tracking.start=()=>{state.starts++}
 state.tracking.stop=()=>{state.stops++}
 Object.defineProperty(globalThis,'__routeUITest',{value:state,configurable:true,writable:true})
 Object.defineProperty(globalThis,'document',{value:{getElementById:id=>({scrollIntoView:()=>state.scrolls.push(id)})},configurable:true,writable:true})
 Object.defineProperty(globalThis,'navigator',{value:{geolocation:{getCurrentPosition:()=>{state.locations++}}},configurable:true,writable:true})
 globalThis.fetch=async(url,options={})=>{
  const request={url:String(url),options,body:options.body?JSON.parse(options.body):null}
  state.requests.push(request)
  const custom=fetchRequest?.(request,state)
  if(custom!==undefined)return await custom
  if(request.url.endsWith('/properties'))return response({properties:[]})
  if(request.url.includes('/day?'))return response({orderedVisitIds:request.body?.orderedVisitIds||[],trace:[]})
  if(request.url.endsWith('/driving'))return response(road)
  throw new Error(`Unexpected HTTP action: ${request.url}`)
 }
 let renderer
 try{
  await act(async()=>{renderer=TestRenderer.create(React.createElement(RouteMap,props))})
  const ui={state,renderer,root:()=>renderer.root,map:()=>renderer.root.findByType('route-map-stub'),stops:()=>renderer.root.findAll(node=>node.type==='li'&&String(node.props.id||'').startsWith('route-stop-')),button:label=>renderer.root.findAllByType('button').find(node=>node.props['aria-label']===label||textOf(node).trim()===label),date:()=>renderer.root.findByProps({'aria-label':'Data do roteiro',type:'date'})}
  await run(ui)
 }finally{
  if(renderer)await act(async()=>renderer.unmount())
  for(const [key,descriptor] of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
 }
}

test('properties remain on an empty-day roadmap, with one pin per property and real producer names',async()=>{
 const producer=client('owner')
 const properties=[{id:'one',clientId:'owner',producerName:'Produtor teste',name:'Propriedade A',location:{lat:-28,lng:-54}},{id:'two',clientId:'owner',producerName:'Produtor teste',name:'Propriedade B',location:{lat:-28.1,lng:-54.1}},{id:'missing',clientId:'owner',producerName:'Produtor teste',name:'Sem sede',location:null}]
 const opened=[]
 await withRoute({clients:[producer],visits:[],onOpenClient:value=>opened.push(value.id)},async ui=>{
  assert.deepEqual(ui.map().props.pins.map(pin=>pin.id),['property:one','property:two'])
  assert.equal(ui.map().props.pins[1].caption,'Produtor teste · Propriedade B')
  await act(async()=>ui.map().props.onPinClick(ui.map().props.pins[1]))
  await act(async()=>ui.button('Ver produtor').props.onClick())
  assert.deepEqual(opened,['owner'])
  assert.match(textOf(ui.renderer.toJSON()),/Sem localização/)
  await act(async()=>ui.button('Nomes nos pins').props.onClick())
  assert.ok(ui.map().props.pins.every(pin=>!pin.caption))
  const query=ui.root().findByProps({'aria-label':'Buscar produtor no roteiro'})
  await act(async()=>query.props.onChange({target:{value:'Propriedade B'}}))
  assert.deepEqual(ui.map().props.pins.map(pin=>pin.id),['property:two'])
  await act(async()=>ui.date().props.onChange({target:{value:day(1)}}))
  assert.equal(ui.state.requests.filter(item=>item.url.endsWith('/properties')).length,1)
  assert.equal(ui.map().props.pins[0].id,'property:two')
 },{fetchRequest:request=>request.url.endsWith('/properties')?response({properties}):undefined})
})

test('changing portfolio aborts the property query and discards a late response',async()=>{
 const first=deferred(),second=deferred();let count=0
 const RouteMap=await loadRouteMap()
 await withRoute({storageScope:'first'},async ui=>{
  const oldRequest=ui.state.requests.find(item=>item.url.endsWith('/properties'))
  await act(async()=>ui.renderer.update(React.createElement(RouteMap,{storageScope:'second'})))
  assert.equal(oldRequest.options.signal.aborted,true)
  await act(async()=>first.resolve(response({properties:[{id:'foreign',name:'Foreign',producerName:'Foreign',location:{lat:1,lng:1}}]})))
  assert.equal(ui.map().props.pins.length,0)
  await act(async()=>second.resolve(response({properties:[{id:'own',name:'Own',producerName:'Own',location:{lat:2,lng:2}}]})))
  assert.deepEqual(ui.map().props.pins.map(pin=>pin.id),['property:own'])
 },{fetchRequest:request=>request.url.endsWith('/properties')?(++count===1?first.promise:second.promise):undefined})
})

test('day list and numbered pins preserve history/current visits and missing coordinates; pin selection opens the exact visit',async()=>{
 const clients=[client('done'),client('active',0,0.01),client('missing',0,0,{location:null}),client('later',0,0.03),client('near',0,0.04)]
 const visits=[visit('later','later','16:00'),visit('done','done','09:00','COMPLETED'),visit('active','active','10:00','IN_PROGRESS',{date:day(-1)}),visit('missing','missing','14:00'),visit('cancelled','done','11:00','CANCELLED'),visit('tomorrow','later','09:00','PLANNED',{date:day(1)})]
 const opened=[],openedClients=[]
 await withRoute({visits,clients,onOpenVisit:value=>opened.push(value),onOpenClient:value=>openedClients.push(value)},async ui=>{
  assert.deepEqual(ui.stops().map(node=>node.props.id),['route-stop-done','route-stop-active','route-stop-missing','route-stop-later'])
  assert.deepEqual(ui.stops().map(node=>node.props.className),['vr-stop is-visited','vr-stop is-current','vr-stop is-planned','vr-stop is-planned'])
  assert.deepEqual(ui.map().props.pins.filter(pin=>!pin.id.startsWith('suggestion:')).map(pin=>[pin.id,pin.label,pin.tone]),[['done','1','visited'],['active','2','current'],['later','4','planned']])
  assert.match(textOf(ui.stops()[2]),/sem localização cadastrada/)
  assert.equal(ui.state.requests.filter(item=>item.url.endsWith('/driving')).length,0)
  assert.match(textOf(ui.root().findByProps({className:'vr-trip-bar'})),/1 parada\(s\) sem localização/)
  assert.ok(ui.root().findAllByProps({className:'vr-text-button'}).every(node=>node.props.disabled))
  await act(async()=>ui.map().props.onPinClick({id:'active'}))
  assert.equal(ui.map().props.selectedId,'active')
  assert.match(ui.stops()[1].props.className,/is-selected/)
  assert.deepEqual(ui.state.scrolls,['route-stop-active'])
  await act(async()=>ui.button('Ver visita').props.onClick())
  await act(async()=>ui.button('Ver produtor').props.onClick())
  assert.equal(opened[0],visits[2])
  assert.equal(openedClients[0],clients[1])
  await act(async()=>ui.root().findByProps({'aria-label':'Buscar produtor no roteiro'}).props.onChange({target:{value:'later'}}))
  assert.deepEqual(ui.stops().map(node=>node.props.id),['route-stop-later'])
  assert.equal(ui.map().props.pins.find(pin=>pin.id==='later').label,'4')
 })
})

test('manual down/up saves visit IDs and timezone while preserving completed/current prefix and appointment times',async()=>{
 const clients=['done','active','a','b'].map(id=>client(id))
 const visits=[visit('done','done','08:00','COMPLETED'),visit('active','active','09:00','IN_PROGRESS'),visit('a','a','10:00'),visit('b','b','15:00')]
 const before=structuredClone(visits)
 await withRoute({visits,clients},async ui=>{
  assert.equal(ui.button('Subir visita de Produtor a').props.disabled,true)
  await act(async()=>ui.button('Descer visita de Produtor a').props.onClick())
  assert.deepEqual(ui.stops().map(node=>node.props.id),['route-stop-done','route-stop-active','route-stop-b','route-stop-a'])
  const save=ui.state.requests.find(item=>item.options.method==='PUT')
  assert.deepEqual(save.body,{orderedVisitIds:['done','active','b','a'],timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})
  assert.match(save.url,new RegExp(`date=${day(0)}`))
  assert.match(textOf(ui.root().findByProps({role:'status'})),/horários.*mantidos/)
  await act(async()=>ui.button('Subir visita de Produtor a').props.onClick())
  assert.deepEqual(ui.stops().map(node=>node.props.id),['route-stop-done','route-stop-active','route-stop-a','route-stop-b'])
  assert.deepEqual(ui.state.requests.filter(item=>item.options.method==='PUT').at(-1).body.orderedVisitIds,['done','active','a','b'])
  assert.deepEqual(visits,before)
 })
})

test('changing day ignores a late aborted read, retaining the selected day order and GPS history',async()=>{
 const late=deferred()
 const selectedDay=day(1)
 const trace=[{lat:1,lng:1,timestamp:`${selectedDay}T10:00:00Z`},{lat:1,lng:1.01,timestamp:`${selectedDay}T10:00:30Z`}]
 const visits=[visit('a','a','10:00','PLANNED',{date:selectedDay}),visit('b','b','11:00','PLANNED',{date:selectedDay})]
 await withRoute({visits,clients:[client('a'),client('b',0,0.1)]},async ui=>{
  const oldRequest=ui.state.requests[0]
  await act(async()=>ui.date().props.onChange({target:{value:selectedDay}}))
  assert.equal(oldRequest.options.signal.aborted,true)
  assert.deepEqual(ui.stops().map(node=>node.props.id),['route-stop-b','route-stop-a'])
  await act(async()=>late.resolve(response({orderedVisitIds:['a','b'],trace:[{lat:50,lng:50,timestamp:`${day(0)}T10:00:00Z`},{lat:51,lng:51,timestamp:`${day(0)}T10:00:30Z`}]})))
  assert.equal(ui.date().props.value,selectedDay)
  assert.deepEqual(ui.stops().map(node=>node.props.id),['route-stop-b','route-stop-a'])
  assert.deepEqual(ui.map().props.routes.find(route=>route.kind==='recorded').points,[[1,1],[1,1.01]])
  assert.equal(ui.button('Minha posição').props.disabled,true)
  assert.equal(ui.button('Iniciar percurso').props.disabled,true)
 },{fetchRequest:request=>request.url.includes('/day?')?(request.url.includes(`date=${day(0)}`)?late.promise:response({orderedVisitIds:['b','a'],trace})):undefined})
})

test('nearby suggestions pass client, selected date and recorded reason only after the user adds one; they never start GPS or create a visit',async()=>{
 const reason='Registro comercial: Revisar análise de solo'
 const added=[]
 const clients=[client('scheduled'),client('candidate',0,0.02,{commercial:{opportunity:'Revisar análise de solo'}})]
 await withRoute({visits:[visit('scheduled','scheduled')],clients,onAddClient:(...args)=>added.push(args)},async ui=>{
  assert.equal(added.length,0)
  await act(async()=>ui.button('Sugerir roteiro').props.onClick())
  assert.equal(added.length,0)
  assert.match(textOf(ui.root().findByProps({role:'status'})),/1 produtor/)
  const card=ui.root().findByProps({className:'vr-suggestion-card'})
  await act(async()=>card.findAllByType('button').find(node=>textOf(node)==='Adicionar ao roteiro').props.onClick())
  assert.deepEqual(added,[['candidate',day(0),reason]])
  await act(async()=>ui.map().props.onPinClick({id:'suggestion:candidate'}))
  const mapCard=ui.root().findByProps({className:'vr-map-card'})
  assert.match(textOf(mapCard),/Revisar análise de solo/)
  await act(async()=>mapCard.findAllByType('button').find(node=>textOf(node)==='Adicionar ao roteiro').props.onClick())
  assert.deepEqual(added,[['candidate',day(0),reason],['candidate',day(0),reason]])
  assert.equal(ui.state.starts,0)
  assert.equal(ui.state.locations,0)
  assert.ok(ui.state.requests.every(item=>item.options.method==='GET'&&(item.url.includes('/api/visit-routes/day?')||item.url.endsWith('/properties'))))
 })
})

test('road detour inserts before the correct repeated-client visit, preserving every visit in the driving request',async()=>{
 const clients=[client('a'),client('b',0,0.1),client('c',0.1,0),client('d',0,-0.1),client('candidate',0.05,0)]
 const visits=[visit('a-first','a','09:00'),visit('b','b','10:00'),visit('c','c','11:00'),visit('a-again','a','12:00'),visit('d','d','13:00')]
 await withRoute({visits,clients},async ui=>{
  assert.deepEqual(ui.state.requests.find(item=>item.url.endsWith('/driving')).body.clientIds,['a','b','c','a','d'])
  const button=ui.root().findByProps({className:'vr-text-button'})
  assert.equal(button.props.disabled,false)
  await act(async()=>button.props.onClick())
  const detour=ui.state.requests.find(item=>item.body?.candidateClientId==='candidate')
  assert.deepEqual(detour.body,{clientIds:['a','b','c','a','d'],candidateClientId:'candidate',insertionIndex:3})
  assert.match(textOf(ui.root().findByProps({className:'vr-suggestion-card'})),/Desvio estimado por estrada/)
  assert.equal(ui.state.starts,0)
 })
})

test('a late aborted driving response cannot replace the route for the newly selected day',async()=>{
 const late=deferred()
 const visits=[visit('a','a','10:00'),visit('b','b','11:00'),visit('c','c','10:00','PLANNED',{date:day(1)}),visit('d','d','11:00','PLANNED',{date:day(1)})]
 const newRoad={...road,geometry:[[1,1],[1,1.1]]}
 await withRoute({visits,clients:['a','b','c','d'].map(id=>client(id))},async ui=>{
  const oldRequest=ui.state.requests.find(item=>item.url.endsWith('/driving'))
  await act(async()=>ui.date().props.onChange({target:{value:day(1)}}))
  assert.equal(oldRequest.options.signal.aborted,true)
  assert.deepEqual(ui.map().props.routes.find(route=>route.kind==='planned').points,newRoad.geometry)
  await act(async()=>late.resolve(response(road)))
  assert.deepEqual(ui.map().props.routes.find(route=>route.kind==='planned').points,newRoad.geometry)
 },{fetchRequest:request=>request.url.endsWith('/driving')?(request.body.clientIds[0]==='a'?late.promise:response(newRoad)):undefined})
})
