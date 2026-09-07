import test from 'node:test'
import assert from 'node:assert/strict'
import {createMunicipalityBoundaries} from '../server/municipality-boundaries.js'
const fixture=code=>({type:'FeatureCollection',features:[{type:'Feature',properties:{codarea:code},geometry:{type:'Polygon',coordinates:[[[-55,-29],[-54,-29],[-54,-28],[-55,-29]]]}}]})
test('IBGE municipality references validate IDs, coalesce/cache reads and reject a mismatched boundary',async()=>{
 let calls=0;const urls=[]
 const read=createMunicipalityBoundaries({fetchImpl:async url=>{calls++;urls.push(url);return Response.json(fixture('4318903'))}})
 await assert.rejects(read('../../secret'),e=>e.statusCode===400);assert.equal(calls,0)
 const [a,b]=await Promise.all([read('4318903'),read('4318903')]);assert.equal(calls,1);assert.deepEqual(a,b)
 assert.equal(a.referenceOnly,true);assert.equal(a.geojson.features[0].properties.codarea,'4318903');assert.match(urls[0],/^https:\/\/servicodados\.ibge\.gov\.br\/api\/v3\/malhas\/municipios\/4318903\?/)
 await read('4318903');assert.equal(calls,1)
 await assert.rejects(read('4319000'),e=>e.statusCode===503)
})
test('unavailable and oversized municipal boundaries return an explicit error, never a fabricated polygon',async()=>{
 for(const fetchImpl of [async()=>new Response('',{status:503}),async()=>Response.json({}),async()=>new Response('x'.repeat(2*1024*1024+1)),async()=>{throw new Error('network unavailable')}]){
  const read=createMunicipalityBoundaries({fetchImpl});await assert.rejects(read('4318903'),e=>e.statusCode===503&&e.exposeMessage)
 }
})
