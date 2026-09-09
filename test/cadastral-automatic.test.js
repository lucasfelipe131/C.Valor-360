import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createCadastralLoader,cadastralViewportKey,officialReferenceLayers,stateAtPoint} from '../src/lib/cadastral-viewport.js'
import {parseCarGeoJson,parseSigefGml,queryCarAtPoint,querySigefAtPoint,validGeoBounds} from '../manual/app/lib/official-geodata.ts'
const view={lat:-28,lng:-54,uf:'RS',zoom:12,bbox:[-54.1,-28.1,-53.9,-27.9]}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5))
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const onlyCar={sources:['car']}
const payload=(id,sourceKey='car',result={})=>({sourceKey,uf:'RS',queriedAt:'2026-09-09T12:00:00.000Z',result:{id,features:[],status:'no_match',...result}})
test('automatic loader debounces map movement, rejects late responses and caches only completed areas',async()=>{
 const requests=[],data=[],status=[]
 const loader=createCadastralLoader({delay:0,onData:value=>data.push(value),onStatus:value=>status.push(value),fetcher:(url,options)=>{const request=deferred();requests.push({...request,url,options});return request.promise}})
 try{
  loader.update(view,onlyCar);loader.update({...view,lng:-53.99,bbox:[-54.08,-28.1,-53.88,-27.9]},onlyCar);await tick()
  assert.equal(requests.length,1)
  const distant={...view,lng:-55,bbox:[-55.1,-28.1,-54.9,-27.9]}
  loader.update(distant,onlyCar);await tick();assert.equal(requests.length,2);assert.equal(requests[0].options.signal.aborted,true)
  requests[1].resolve({ok:true,json:async()=>payload('current')});await tick()
  requests[0].resolve({ok:true,json:async()=>payload('obsolete')});await tick()
  assert.equal(data.at(-1).car.id,'current');assert.equal(data.some(p=>p?.car?.id==='obsolete'),false)
  loader.update(distant,onlyCar);await tick();assert.equal(requests.length,2);assert.equal(data.at(-1).car.id,'current')
  loader.update({...view,zoom:5},onlyCar);await tick();assert.equal(data.at(-1),null);assert.equal(status.at(-1),'idle');assert.equal(requests.length,2)
 }finally{loader.cancel()}
})
test('unmount prevents delayed fetches and source failure never becomes a cached empty result',async()=>{
 let calls=0;const statuses=[]
 const loader=createCadastralLoader({delay:0,onData:()=>{},onStatus:s=>statuses.push(s),fetcher:async()=>{calls++;return {ok:true,json:async()=>payload('failed','car',{status:'unavailable'})}}})
 loader.update(view,onlyCar);loader.cancel();await tick();assert.equal(calls,0)
 loader.update(view,onlyCar);await tick();loader.update(view,onlyCar);await tick();assert.equal(calls,2);assert.equal(statuses.at(-1),'error');loader.cancel()
})
test('small pans reuse buffered results; refresh and failed requests keep old geometry visible',async()=>{
 const requests=[],data=[],statuses=[]
 const loader=createCadastralLoader({delay:0,onData:d=>data.push(d),onStatus:s=>statuses.push(s),fetcher:(url,options)=>{const d=deferred();requests.push({...d,url,options});return d.promise}})
 try{
  loader.update(view,onlyCar);await tick()
  const bounds=new URL(requests[0].url,'https://val.test').searchParams.get('bbox').split(',').map(Number)
  assert.ok(bounds[0]<view.bbox[0]&&bounds[2]>view.bbox[2])
  requests[0].resolve({ok:true,json:async()=>payload('buffered')});await tick()
  loader.update({...view,lng:-53.99,bbox:[-54.09,-28.1,-53.89,-27.9]},onlyCar);await tick()
  assert.equal(requests.length,1);assert.equal(data.at(-1).car.id,'buffered')
  loader.update(view,{...onlyCar,refresh:true});await tick();assert.equal(data.at(-1).car.id,'buffered')
  requests[1].resolve({ok:false,json:async()=>({error:'offline'})});await tick()
  assert.equal(statuses.at(-1),'error');assert.equal(data.at(-1).car.id,'buffered')
  assert.equal(data.at(-1).car.status,'unavailable');assert.equal(data.at(-1).car.queriedAt,'2026-09-09T12:00:00.000Z')
  loader.update({...view,uf:'SC'},onlyCar);assert.equal(data.at(-1).car,undefined)
 }finally{loader.cancel()}
})
test('limited and partly failed responses cannot hide new parcels behind a broad cached extent',async()=>{
 for(const problem of [{limited:true},{failedSources:1}]){
  let calls=0
  const loader=createCadastralLoader({delay:0,onData:()=>{},onStatus:()=>{},fetcher:async()=>({ok:true,json:async()=>{calls++;return payload('partial','car',problem)}})})
  loader.update(view,onlyCar);await tick();loader.update(view,onlyCar);await tick();assert.equal(calls,1)
  loader.update({...view,lng:-53.99,bbox:[-54.09,-28.1,-53.89,-27.9]},onlyCar);await tick();loader.cancel();assert.equal(calls,2)
 }
})
test('ready sources render immediately while small pans retain all useful in-flight requests',async()=>{
 const requests=[],data=[],status=[]
 const loader=createCadastralLoader({delay:0,onData:d=>data.push(d),onStatus:s=>status.push(s),fetcher:(url,options)=>{const d=deferred();requests.push({...d,url,options,source:new URL(url,'https://val.test').searchParams.get('source')});return d.promise}})
 try{
  loader.update(view);await tick();assert.equal(requests.length,3)
  loader.update({...view,lng:-53.99,bbox:[-54.09,-28.1,-53.89,-27.9]});await tick()
  assert.equal(requests.length,3);assert.ok(requests.every(r=>!r.options.signal.aborted))
  const finish=async(source,result)=>{requests.find(r=>r.source===source).resolve({ok:true,json:async()=>payload(source,source,result)});await tick()}
  await finish('car',{status:'available',features:[{id:'c',points:[{lat:-28,lng:-54},{lat:-28,lng:-53.9},{lat:-27.9,lng:-54}]}]})
  assert.equal(data.at(-1).car.features.length,1);assert.equal(status.at(-1),'loading')
  const carLayer=officialReferenceLayers(data.at(-1))[0]
  await finish('sigef-particular',{status:'available',features:[{id:'s',registry:'123',points:[{lat:-28,lng:-54},{lat:-28,lng:-53.9},{lat:-27.9,lng:-54}]}]})
  assert.equal(data.at(-1).sigef.features.length,1);assert.equal(data.at(-1).sigef.limited,true)
  assert.equal(officialReferenceLayers(data.at(-1))[0],carLayer);assert.equal(status.at(-1),'loading')
  await finish('sigef-publico',{status:'unavailable',failedSources:1})
  assert.equal(status.at(-1),'ready');assert.equal(data.at(-1).sigef.features.length,1);assert.equal(data.at(-1).sigef.failedSources,1)
  assert.deepEqual(data.at(-1).loadingSources,[])
 }finally{loader.cancel()}
})
test('disabled sources are not fetched, cancel their work, and reject mismatched response envelopes',async()=>{
 const requests=[],data=[],status=[]
 const loader=createCadastralLoader({delay:0,onData:d=>data.push(d),onStatus:s=>status.push(s),fetcher:(url,options)=>{const d=deferred();requests.push({...d,url,options});return d.promise}})
 try{
  loader.update(view,onlyCar);await tick();assert.equal(requests.length,1)
  requests[0].resolve({ok:true,json:async()=>payload('wrong','sigef-publico')});await tick()
  assert.equal(status.at(-1),'error');assert.equal(data.at(-1).car,undefined)
  loader.update(view,onlyCar);await tick();loader.update(view,{sources:[]})
  assert.equal(requests[1].options.signal.aborted,true);assert.equal(data.at(-1),null)
  requests[1].resolve({ok:true,json:async()=>payload('late')});await tick();assert.equal(data.at(-1),null)
 }finally{loader.cancel()}
})
test('viewport uses actual state geometry and rejects country-wide or malformed queries',()=>{
 const states=JSON.parse(readFileSync('public/geo/states.geojson','utf8'))
 assert.equal(stateAtPoint({lat:-28.4,lng:-54.9},states),'RS')
 assert.equal(stateAtPoint({lat:-23.55,lng:-46.63},states),'SP')
 assert.equal(stateAtPoint({lat:45,lng:0},states),'')
 assert.ok(cadastralViewportKey(view));assert.equal(cadastralViewportKey({...view,bbox:[-74,-34,-34,5]}),'')
 assert.equal(validGeoBounds([-54.1,-28.1,-53.9,-27.9]),true)
 for(const invalid of [[],[0,0,0,0],[0,0,3,3],['0',0,1,1],[0,0,NaN,1]])assert.equal(validGeoBounds(invalid),false)
})
test('registry filter requires a real SIGEF registry attribute and never infers ownership from CAR',()=>{
 const points=[{lng:-54,lat:-28},{lng:-53.9,lat:-28},{lng:-53.9,lat:-27.9}]
 const groups=officialReferenceLayers({queriedAt:'2026-09-07',car:{source:'CAR',features:[{id:'car',points}]},sigef:{source:'SIGEF',features:[{id:'s1',registry:'123-A',points},{id:'s2',registry:'',points}]}})
 assert.deepEqual(groups.map(g=>g.geojson.features.length),[1,2,1])
 assert.equal(groups[2].geojson.features[0].properties.matricula,'123-A')
 assert.equal(JSON.stringify(groups).includes('owner'),false)
})
const ring=[[-54.04,-28.04],[-54.02,-28.04],[-54.02,-28.02],[-54.04,-28.02],[-54.04,-28.04]]
const hole=[[-54.035,-28.035],[-54.025,-28.035],[-54.025,-28.025],[-54.035,-28.025],[-54.035,-28.035]]
const car={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'MultiPolygon',coordinates:[[ring,hole],[ring.map(([x,y])=>[x+.05,y])]]},properties:{cod_imovel:'RS-FIXTURE',nome_proprietario:'MUST NOT PASS'}}]}
const xml=`<wfs:FeatureCollection><gml:featureMember><ms:parcel><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>${ring.map(p=>p.join(',')).join(' ')}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs><gml:innerBoundaryIs><gml:LinearRing><gml:coordinates>${hole.map(p=>p.join(',')).join(' ')}</gml:coordinates></gml:LinearRing></gml:innerBoundaryIs></gml:Polygon><ms:registro_matricula>123-A</ms:registro_matricula><ms:proprietario>MUST NOT PASS</ms:proprietario></ms:parcel></gml:featureMember></wfs:FeatureCollection>`
test('viewport returns nearby parcels outside center, preserves holes and multipart geometry, retains exact-point semantics',()=>{
 assert.equal(parseCarGeoJson(car,view).length,0)
 const [c]=parseCarGeoJson(car,view,view.bbox)
 assert.equal(c.confidence,'self_declared_in_viewport');assert.equal(c.geometry.coordinates.length,2);assert.equal(c.geometry.coordinates[0].length,2)
 assert.equal(JSON.stringify(c).includes('MUST NOT PASS'),false)
 assert.equal(parseSigefGml(xml,view,'particular').length,0)
 const [s]=parseSigefGml(xml,view,'particular',view.bbox)
 assert.equal(s.registry,'123-A');assert.equal(s.geometry.coordinates[0].length,2);assert.equal(s.confidence,'certified_in_viewport')
 assert.equal(JSON.stringify(s).includes('MUST NOT PASS'),false)
})
test('viewport adapters send bounded WFS extent, retain fixed official hosts, and reject invalid area before fetch',async()=>{
 const calls=[]
 const fetcher=async url=>{calls.push(new URL(url));return {ok:true,text:async()=>url.hostname.includes('incra')?xml:JSON.stringify(car)}}
 const c=await queryCarAtPoint(view,'RS',fetcher,view.bbox)
 const s=await querySigefAtPoint(view,'RS',fetcher,view.bbox)
 assert.equal(c.status,'available');assert.equal(s.status,'available');assert.equal(calls.length,3)
 assert.match(calls[0].searchParams.get('bbox'),/^-54\.1000000,-28\.1000000,-53\.9000000,-27\.9000000,/)
 assert.equal(calls[0].searchParams.get('count'),'80');assert.equal(calls[1].searchParams.get('MAXFEATURES'),'80')
 await assert.rejects(queryCarAtPoint(view,'RS',fetcher,[0,0,40,40]));await assert.rejects(querySigefAtPoint(view,'RS',fetcher,[0,0,40,40]));assert.equal(calls.length,3)
})
