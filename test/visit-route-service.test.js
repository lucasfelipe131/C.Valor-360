import assert from 'node:assert/strict'
import test from 'node:test'
import {createVisitRouteService} from '../server/visit-route-service.js'

const ownerId='owner-route-test'
const clients=[
 {id:'client-a',location:{lat:-23.55,lng:-46.63}},
 {id:'client-b',location:{lat:-23.56,lng:-46.65}},
 {id:'client-c',location:{lat:-23.57,lng:-46.67}},
]

function providerPayload(){
 return {
  code:'Ok',
  routes:[{
   distance:1200,
   duration:240,
   geometry:{type:'LineString',coordinates:[[-46.63,-23.55],[-46.64,-23.555],[-46.65,-23.56]]},
   legs:[{distance:1200,duration:240,summary:'Test road',steps:[]}],
  }],
 }
}

function fixture({fetchImpl,portfolioClients=clients,dbConfigured=false}={}){
 const fetchCalls=[]
 const ownerReads=[]
 const repository={
  tenantId:'tenant-route-test',
  db:{
   configured:dbConfigured,
   async query(){throw new Error('Unexpected database query')},
   async transaction(){throw new Error('Unexpected database transaction')},
  },
  async getIntelligence(requestedOwnerId){
   ownerReads.push(requestedOwnerId)
   return {clients:portfolioClients,visits:[{id:'visit-a',clientId:'client-a',scheduledAt:'2026-09-06T12:00:00.000Z'}]}
  },
 }
 const service=createVisitRouteService({
  repository,
  routingUrl:'https://routing.example.test',
  clock:()=>Date.parse('2026-09-06T12:00:00.000Z'),
  minProviderIntervalMs:0,
  fetchImpl:async (...args)=>{
   fetchCalls.push(args)
   return fetchImpl ? fetchImpl(...args) : new Response(JSON.stringify(providerPayload()),{status:200})
  },
 })
 return {service,fetchCalls,ownerReads}
}

function assertUnavailable(result){
 assert.equal(result.available,false)
 assert.deepEqual(result.geometry,[])
 assert.equal(result.distanceMeters,null)
 assert.equal(result.durationSeconds,null)
 assert.deepEqual(result.legs,[])
 assert.equal(typeof result.reason,'string')
 assert.ok(result.reason.length>0)
}

test('driving returns provider road geometry in latitude/longitude order and estimated metrics',async()=>{
 const {service,fetchCalls,ownerReads}=fixture()
 const result=await service.driving({ownerId,input:{clientIds:['client-a','client-b']}})
 assert.equal(result.available,true)
 assert.deepEqual(result.geometry,[[-23.55,-46.63],[-23.555,-46.64],[-23.56,-46.65]])
 assert.equal(result.distanceMeters,1200)
 assert.equal(result.durationSeconds,240)
 assert.equal(result.source,'osrm')
 assert.equal(result.estimated,true)
 assert.equal(result.legs.length,1)
 assert.equal(fetchCalls.length,1)
 assert.deepEqual(ownerReads,[ownerId])
 const url=new URL(String(fetchCalls[0][0]))
 assert.ok(url.pathname.endsWith('/-46.63,-23.55;-46.65,-23.56'))
 assert.equal(url.searchParams.get('geometries'),'geojson')
})

test('driving preserves a return visit to the same client in the A, B, A sequence',async()=>{
 const payload=providerPayload()
 payload.routes[0]={
  distance:2500,
  duration:500,
  geometry:{type:'LineString',coordinates:[[-46.63,-23.55],[-46.65,-23.56],[-46.63,-23.55]]},
  legs:[
   {distance:1200,duration:240,summary:'Outbound road',steps:[]},
   {distance:1300,duration:260,summary:'Return road',steps:[]},
  ],
 }
 const {service,fetchCalls}=fixture({fetchImpl:async()=>new Response(JSON.stringify(payload),{status:200})})
 const result=await service.driving({ownerId,input:{clientIds:['client-a','client-b','client-a']}})
 assert.equal(result.available,true)
 assert.equal(result.distanceMeters,2500)
 assert.equal(result.durationSeconds,500)
 assert.deepEqual(result.geometry,[[-23.55,-46.63],[-23.56,-46.65],[-23.55,-46.63]])
 assert.deepEqual(result.legs,[{distanceMeters:1200,durationSeconds:240},{distanceMeters:1300,durationSeconds:260}])
 assert.equal(fetchCalls.length,1)
 assert.ok(new URL(String(fetchCalls[0][0])).pathname.endsWith('/-46.63,-23.55;-46.65,-23.56;-46.63,-23.55'))
})

test('driving resolves portfolio locations on the server and ignores coordinates supplied for clients',async()=>{
 const {service,fetchCalls}=fixture()
 await service.driving({ownerId,input:{
  clientIds:['client-a','client-b'],
  coordinates:[[1,2],[3,4]],
  clients:[{id:'client-a',location:{lat:1,lng:2}},{id:'client-b',location:{lat:3,lng:4}}],
 }})
 assert.equal(fetchCalls.length,1)
 const url=new URL(String(fetchCalls[0][0]))
 assert.ok(url.pathname.endsWith('/-46.63,-23.55;-46.65,-23.56'))
})

test('driving rejects missing owner before calling the routing provider',async()=>{
 const {service,fetchCalls}=fixture()
 await assert.rejects(service.driving({input:{clientIds:['client-a','client-b']}}),{statusCode:403})
 assert.equal(fetchCalls.length,0)
})

test('driving rejects clients and insertion candidates outside the owner portfolio without provider access',async t=>{
 for(const input of [
  {clientIds:['client-a','another-owners-client']},
  {clientIds:['client-a','client-b'],candidateClientId:'another-owners-client',insertionIndex:1},
 ]){
  await t.test(JSON.stringify(input),async()=>{
   const {service,fetchCalls}=fixture()
   await assert.rejects(service.driving({ownerId,input}),{statusCode:404})
   assert.equal(fetchCalls.length,0)
  })
 }
})

test('driving rejects malformed inputs before provider access',async t=>{
 const invalidInputs=[
  undefined,
  {clientIds:'client-a'},
  {clientIds:[]},
  {clientIds:['client-a','client-b'],origin:{lat:91,lng:0}},
  {clientIds:['client-a','client-b'],origin:{lat:0,lng:181}},
  {clientIds:['client-a','client-b'],origin:{lat:null,lng:0}},
  {clientIds:['client-a','client-b'],candidateClientId:'client-c',insertionIndex:-1},
  {clientIds:['client-a','client-b'],candidateClientId:'client-c',insertionIndex:1.5},
 ]
 for(const [index,input] of invalidInputs.entries()){
  await t.test(`invalid input ${index+1}`,async()=>{
   const {service,fetchCalls}=fixture()
   await assert.rejects(service.driving({ownerId,input}),{statusCode:400})
   assert.equal(fetchCalls.length,0)
  })
 }
})

test('driving counts origin and insertion candidate toward the 15-point maximum',async t=>{
 const portfolioClients=Array.from({length:16},(_,index)=>({id:`client-${index}`,location:{lat:-23.5-index/100,lng:-46.6-index/100}}))
 const ids=portfolioClients.map(client=>client.id)
 for(const input of [
  {clientIds:ids},
  {clientIds:ids.slice(0,15),origin:{lat:-23.4,lng:-46.5}},
  {clientIds:ids.slice(0,15),candidateClientId:ids[15],insertionIndex:2},
  {clientIds:ids.slice(0,14),origin:{lat:-23.4,lng:-46.5},candidateClientId:ids[14],insertionIndex:2},
 ]){
  await t.test(JSON.stringify(input),async()=>{
   const {service,fetchCalls}=fixture({portfolioClients})
   await assert.rejects(service.driving({ownerId,input}),{statusCode:400})
   assert.equal(fetchCalls.length,0)
  })
 }
})

test('invalid routing responses cannot become plausible road routes',async t=>{
 const invalidResponses=[
  ['provider reports no route',payload=>{payload.code='NoRoute';payload.routes=[]}],
  ['provider omits routes',payload=>{delete payload.routes}],
  ['negative route distance',payload=>{payload.routes[0].distance=-1}],
  ['missing route duration',payload=>{delete payload.routes[0].duration}],
  ['non-numeric route distance',payload=>{payload.routes[0].distance='1200'}],
  ['wrong geometry type',payload=>{payload.routes[0].geometry.type='Point'}],
  ['missing road geometry',payload=>{payload.routes[0].geometry.coordinates=[]}],
  ['out-of-range coordinate',payload=>{payload.routes[0].geometry.coordinates[0]=[181,91]}],
  ['null coordinate',payload=>{payload.routes[0].geometry.coordinates[0]=[null,-23.55]}],
  ['negative leg duration',payload=>{payload.routes[0].legs[0].duration=-1}],
 ]
 for(const [label,mutate] of invalidResponses){
  await t.test(label,async()=>{
   const payload=providerPayload()
   mutate(payload)
   const {service}=fixture({fetchImpl:async()=>new Response(JSON.stringify(payload),{status:200})})
   assertUnavailable(await service.driving({ownerId,input:{clientIds:['client-a','client-b']}}))
  })
 }
})

test('routing provider failures return explicit unavailable results',async t=>{
 const failures=[
  ['network exception',async()=>{throw new Error('Connection refused')}],
  ['HTTP failure',async()=>new Response(JSON.stringify({message:'Service unavailable'}),{status:503})],
  ['unreadable JSON',async()=>new Response('upstream proxy error',{status:200})],
 ]
 for(const [label,fetchImpl] of failures){
  await t.test(label,async()=>{
   const {service}=fixture({fetchImpl})
   assertUnavailable(await service.driving({ownerId,input:{clientIds:['client-a','client-b']}}))
  })
 }
})

test('identical concurrent routing requests coalesce and completed routes are cached',async()=>{
 let releaseProvider
 const providerReady=new Promise(resolve=>{releaseProvider=resolve})
 const {service,fetchCalls}=fixture({fetchImpl:async()=>{
  await providerReady
  return new Response(JSON.stringify(providerPayload()),{status:200})
 }})
 const request={ownerId,input:{clientIds:['client-a','client-b']}}
 const first=service.driving(request)
 const concurrent=service.driving(request)
 await new Promise(resolve=>setImmediate(resolve))
 const concurrentCallCount=fetchCalls.length
 releaseProvider()
 const [firstResult,concurrentResult]=await Promise.all([first,concurrent])
 assert.equal(concurrentCallCount,1)
 assert.equal(firstResult.available,true)
 assert.deepEqual(concurrentResult,firstResult)
 const cachedResult=await service.driving(request)
 assert.deepEqual(cachedResult,firstResult)
 assert.equal(fetchCalls.length,1)
})

test('day route saving reports unavailable persistence when PostgreSQL is not configured',async()=>{
 const {service,fetchCalls}=fixture()
 await assert.rejects(service.saveDay({
  ownerId,
  date:'2026-09-06',
  input:{orderedVisitIds:['visit-a'],timeZone:'UTC'},
 }),{statusCode:503})
 assert.equal(fetchCalls.length,0)
})

function persistenceFixture(){
 const rows=new Map();const audit=[];const queries=[]
 let timestamp=Date.parse('2026-09-06T12:00:00Z')
 const query=async(sql,params)=>{
  queries.push({sql,params})
  const key=JSON.stringify(params.slice(0,3))
  if(sql.startsWith('INSERT INTO val_visit_routes')){
   if(!rows.has(key))rows.set(key,{ordered_visit_ids:[],trace:[],tracking:false,time_zone:params[3],tracking_started_at:null,updated_at:new Date(timestamp).toISOString()})
   return {rows:[],rowCount:0}
  }
  if(sql.startsWith('SELECT '))return {rows:rows.has(key)?[structuredClone(rows.get(key))]:[]}
  if(sql.startsWith('UPDATE val_visit_routes')){
   const record={ordered_visit_ids:JSON.parse(params[3]),trace:JSON.parse(params[4]),tracking:params[5],time_zone:params[6],tracking_started_at:params[7],updated_at:new Date(timestamp).toISOString()}
   rows.set(key,record);return {rows:[structuredClone(record)]}
  }
  if(sql.startsWith('INSERT INTO audit_events')){audit.push({tenantId:params[0],ownerId:params[1],date:params[2],data:JSON.parse(params[3])});return {rows:[]}}
  throw new Error(`Unexpected query ${sql}`)
 }
 const db={configured:true,query,async transaction(work){
  const before=structuredClone(rows);const auditLength=audit.length
  try{return await work({query})}catch(error){rows.clear();for(const [key,value] of before)rows.set(key,value);audit.splice(auditLength);throw error}
 }}
 const repository={tenantId:'tenant-route-test',db,visits:[
   {id:'visit-a',clientId:'client-a',scheduledAt:'2026-09-06T12:00:00Z'},
   {id:'visit-b',clientId:'client-b',scheduledAt:'2026-09-06T14:00:00Z'},
   {id:'visit-yesterday',clientId:'client-a',scheduledAt:'2026-09-05T12:00:00Z'},
   {id:'visit-overdue-progress',clientId:'client-a',scheduledAt:'2026-09-05T12:00:00Z',lifecycleStatus:'IN_PROGRESS'},
   {id:'visit-overdue-review',clientId:'client-b',scheduledAt:'2026-09-04T12:00:00Z',lifecycleStatus:'COMPLETED_PENDING_REVIEW'},
   {id:'visit-old-planned',clientId:'client-a',scheduledAt:'2026-09-05T12:00:00Z',lifecycleStatus:'PLANNED'},
   {id:'visit-old-completed',clientId:'client-a',scheduledAt:'2026-09-05T12:00:00Z',lifecycleStatus:'COMPLETED'},
   {id:'visit-old-cancelled',clientId:'client-a',scheduledAt:'2026-09-05T12:00:00Z',lifecycleStatus:'CANCELLED'},
   {id:'visit-future-progress',clientId:'client-a',scheduledAt:'2026-09-07T12:00:00Z',lifecycleStatus:'IN_PROGRESS'},
   {id:'visit-future-review',clientId:'client-b',scheduledAt:'2026-09-07T12:00:00Z',lifecycleStatus:'COMPLETED_PENDING_REVIEW'},
   {id:'visit-foreign-client',clientId:'another-owners-client',scheduledAt:'2026-09-06T12:00:00Z',lifecycleStatus:'IN_PROGRESS'},
  ],async getIntelligence(requestedOwner){
  return requestedOwner===ownerId?{clients,visits:this.visits}:{clients:[{id:'another-owners-client'}],visits:[
   {id:'another-owners-visit',clientId:'another-owners-client',scheduledAt:'2026-09-05T12:00:00Z',lifecycleStatus:'IN_PROGRESS'},
  ]}
 }}
 const service=createVisitRouteService({repository,clock:()=>timestamp})
 return {service,repository,rows,audit,queries,setNow:value=>{timestamp=Date.parse(value)}}
}

test('daily order is tenant/owner scoped, validates calendar day, and audits counts without GPS',async()=>{
 const {service,audit,queries}=persistenceFixture()
 const saved=await service.saveDay({ownerId,date:'2026-09-06',input:{orderedVisitIds:['visit-b','visit-a'],timeZone:'UTC'}})
 assert.deepEqual(saved.orderedVisitIds,['visit-b','visit-a'])
 assert.equal(saved.tracking,false)
 assert.deepEqual(saved.trace,[])
 assert.deepEqual((await service.getDay({ownerId,date:'2026-09-06'})).orderedVisitIds,['visit-b','visit-a'])
 assert.deepEqual((await service.getDay({ownerId:'other-owner',date:'2026-09-06'})).orderedVisitIds,[])
 assert.deepEqual((await service.getDay({ownerId,date:'2026-09-05'})).orderedVisitIds,[])
 assert.equal(audit.length,1)
 assert.equal(audit[0].data.orderedVisitCount,2)
 assert.ok(!JSON.stringify(audit).includes('lat'))
 assert.ok(queries.filter(({sql})=>sql.startsWith('SELECT ')).every(({sql})=>sql.includes('tenant_id=$1 AND owner_id=$2 AND route_date=$3')))
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{orderedVisitIds:['visit-yesterday'],timeZone:'UTC'}}),{statusCode:400})
 await assert.rejects(service.saveDay({ownerId:'other-owner',date:'2026-09-06',input:{orderedVisitIds:['visit-a'],timeZone:'UTC'}}),{statusCode:404})
 assert.equal(audit.length,1)
})

test('daily order retains overdue active and pending-review visits and prunes them after completion',async()=>{
 const {service,repository}=persistenceFixture()
 const orderedVisitIds=['visit-b','visit-overdue-progress','visit-overdue-review','visit-a']
 const saved=await service.saveDay({ownerId,date:'2026-09-06',input:{orderedVisitIds,timeZone:'UTC'}})
 assert.deepEqual(saved.orderedVisitIds,orderedVisitIds)
 assert.deepEqual((await service.getDay({ownerId,date:'2026-09-06'})).orderedVisitIds,orderedVisitIds)
 repository.visits.find(visit=>visit.id==='visit-overdue-progress').lifecycleStatus='COMPLETED'
 assert.deepEqual((await service.getDay({ownerId,date:'2026-09-06'})).orderedVisitIds,['visit-b','visit-overdue-review','visit-a'])
 repository.visits.find(visit=>visit.id==='visit-overdue-review').lifecycleStatus='COMPLETED'
 assert.deepEqual((await service.getDay({ownerId,date:'2026-09-06'})).orderedVisitIds,['visit-b','visit-a'])
})

test('daily order rejects future active and old inactive visits without changing the saved order',async t=>{
 const {service,audit}=persistenceFixture()
 await service.saveDay({ownerId,date:'2026-09-06',input:{orderedVisitIds:['visit-a'],timeZone:'UTC'}})
 for(const visitId of ['visit-future-progress','visit-future-review','visit-old-planned','visit-old-completed','visit-old-cancelled']){
  await t.test(visitId,async()=>{
   await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{orderedVisitIds:['visit-a',visitId],timeZone:'UTC'}}),{statusCode:400})
   assert.deepEqual((await service.getDay({ownerId,date:'2026-09-06'})).orderedVisitIds,['visit-a'])
   assert.equal(audit.length,1)
  })
 }
})

test('daily order rejects another owners visits and visits outside the owners client portfolio',async t=>{
 for(const visitId of ['another-owners-visit','visit-foreign-client']){
  await t.test(visitId,async()=>{
   const {service,audit,rows}=persistenceFixture()
   await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{orderedVisitIds:[visitId],timeZone:'UTC'}}),{statusCode:404})
   assert.equal(audit.length,0)
   assert.equal(rows.size,0)
  })
 }
})

test('GPS requires explicit start, deduplicates timestamps, preserves order, and accepts final stop flush',async()=>{
 const {service,audit,setNow}=persistenceFixture()
 const firstPoint={lat:-23.55,lng:-46.63,timestamp:'2026-09-06T12:00:00.000Z',accuracy:5}
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{tracePoints:[firstPoint],timeZone:'UTC'}}),{statusCode:409})
 assert.equal(audit.length,0)
 const started=await service.saveDay({ownerId,date:'2026-09-06',input:{tracking:true,orderedVisitIds:['visit-a'],tracePoints:[firstPoint],timeZone:'UTC'}})
 assert.equal(started.tracking,true)
 assert.deepEqual(started.trace,[firstPoint])
 setNow('2026-09-06T12:01:00Z')
 const secondPoint={lat:-23.56,lng:-46.64,timestamp:'2026-09-06T12:01:00.000Z'}
 const replayed=await service.saveDay({ownerId,date:'2026-09-06',input:{tracePoints:[secondPoint,firstPoint]}})
 assert.deepEqual(replayed.trace,[firstPoint,secondPoint])
 assert.deepEqual(replayed.orderedVisitIds,['visit-a'])
 const stopped=await service.saveDay({ownerId,date:'2026-09-06',input:{tracking:false,tracePoints:[firstPoint,secondPoint]}})
 assert.equal(stopped.tracking,false)
 assert.equal(stopped.trace.length,2)
 assert.equal(audit.at(-1).data.addedTracePointCount,0)
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{tracePoints:[secondPoint]}}),{statusCode:409})
})

test('GPS rejects other days, timestamps before recording, future samples and conflicting replay',async()=>{
 const {service}=persistenceFixture()
 const point={lat:-23.55,lng:-46.63,timestamp:'2026-09-06T12:00:00.000Z'}
 await service.saveDay({ownerId,date:'2026-09-06',input:{tracking:true,tracePoints:[point],timeZone:'UTC'}})
 for(const timestamp of ['2026-09-05T12:00:00.000Z','2026-09-06T11:00:00.000Z','2026-09-06T12:10:00.000Z']){
  await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{tracePoints:[{...point,timestamp}]}}),{statusCode:400})
 }
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{tracePoints:[{...point,lat:1}]}}),{statusCode:409})
 assert.deepEqual((await service.getDay({ownerId,date:'2026-09-06'})).trace,[point])
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-05',input:{tracking:true,timeZone:'UTC'}}),{statusCode:400})
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{timeZone:'America/Sao_Paulo'}}),{statusCode:409})
})

test('GPS trace rejects oversized batches and total day overflow without losing saved points',async()=>{
 const {service,rows}=persistenceFixture()
 const point={lat:-23.55,lng:-46.63,timestamp:'2026-09-06T12:00:00.000Z'}
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{tracking:true,tracePoints:Array(251).fill(point)}}),{statusCode:400})
 await service.saveDay({ownerId,date:'2026-09-06',input:{tracking:true,timeZone:'UTC'}})
 const key=JSON.stringify(['tenant-route-test',ownerId,'2026-09-06'])
 const existing=Array.from({length:2000},(_,index)=>({...point,timestamp:new Date(Date.parse(point.timestamp)-index-1).toISOString()}))
 rows.get(key).trace=existing
 await assert.rejects(service.saveDay({ownerId,date:'2026-09-06',input:{tracePoints:[point]}}),{statusCode:409,code:'visit_route_trace_limit'})
 assert.equal(rows.get(key).trace.length,2000)
})

test('a stalled routing provider hits the deadline and never invents distance or geometry',async()=>{
 const service=createVisitRouteService({repository:{tenantId:'tenant-route-test',getIntelligence:async()=>({clients})},fetchImpl:()=>new Promise(()=>{}),routingUrl:'https://timeout-routing.example.test',timeoutMs:15,minProviderIntervalMs:0})
 const result=await service.driving({ownerId,input:{clientIds:['client-a','client-b']}})
 assertUnavailable(result)
 assert.equal(result.reason,'provider_timeout')
})
