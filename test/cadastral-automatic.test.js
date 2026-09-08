import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createCadastralLoader,cadastralViewportKey,officialReferenceLayers,stateAtPoint} from '../src/lib/cadastral-viewport.js'
import {parseCarGeoJson,parseSigefGml,queryCarAtPoint,querySigefAtPoint,validGeoBounds} from '../manual/app/lib/official-geodata.ts'
const view={lat:-28,lng:-54,uf:'RS',zoom:12,bbox:[-54.1,-28.1,-53.9,-27.9]}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5))
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const payload=id=>({id,car:{features:[],status:'no_match'},sigef:{features:[],status:'no_match'}})
test('automatic loader debounces map movement, rejects late responses and caches only completed areas',async()=>{
 const requests=[],data=[],status=[]
 const loader=createCadastralLoader({delay:0,onData:value=>data.push(value),onStatus:value=>status.push(value),fetcher:(url,options)=>{const request=deferred();requests.push({...request,url,options});return request.promise}})
 try{
  loader.update(view);loader.update({...view,lng:-53.99,bbox:[-54.08,-28.1,-53.88,-27.9]});await tick()
  assert.equal(requests.length,1)
  loader.update(view);await tick();assert.equal(requests.length,2);assert.equal(requests[0].options.signal.aborted,true)
  requests[1].resolve({ok:true,json:async()=>payload('current')});await tick()
  requests[0].resolve({ok:true,json:async()=>payload('obsolete')});await tick()
  assert.equal(data.at(-1).id,'current');assert.equal(data.some(p=>p?.id==='obsolete'),false)
  loader.update(view);await tick();assert.equal(requests.length,2);assert.equal(data.at(-1).id,'current')
  loader.update({...view,zoom:5});await tick();assert.equal(data.at(-1),null);assert.equal(status.at(-1),'idle');assert.equal(requests.length,2)
 }finally{loader.cancel()}
})
test('unmount prevents delayed fetches and source failure never becomes a cached empty result',async()=>{
 let calls=0;const statuses=[]
 const loader=createCadastralLoader({delay:0,onData:()=>{},onStatus:s=>statuses.push(s),fetcher:async()=>{calls++;return {ok:true,json:async()=>({car:{status:'unavailable'},sigef:{status:'unavailable'}})}}})
 loader.update(view);loader.cancel();await tick();assert.equal(calls,0)
 loader.update(view);await tick();loader.update(view);await tick();assert.equal(calls,2);loader.cancel()
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
