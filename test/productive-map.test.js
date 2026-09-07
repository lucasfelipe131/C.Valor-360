import test from 'node:test'
import assert from 'node:assert/strict'
import {validProductiveRing,fieldProduction} from '../src/lib/productive-map.js'
import {normalizeCadastralGeoJSON,filterCadastral} from '../src/lib/cadastral-map.js'
import {normalizePropertyProfileInput} from '../server/property-profile.js'
const points=[{lat:-28,lng:-54},{lat:-28,lng:-53.99},{lat:-28.01,lng:-53.99},{lat:-28.01,lng:-54}]
test('productive rings reject crossed or repeated points and retain a valid ring after point deletion',()=>{
 assert.equal(validProductiveRing(points),true)
 assert.equal(validProductiveRing(points.filter((_,i)=>i!==1)),true)
 assert.equal(validProductiveRing([points[0],points[2],points[1],points[3]]),false)
 assert.equal(validProductiveRing([...points,points[0]]),false)
 assert.throws(()=>normalizePropertyProfileInput({fields:[{name:'cruzado',points:[points[0],points[2],points[1],points[3]]}]}),/cruzamentos/)
 assert.equal(fieldProduction({areaHa:100,productivityTarget:60}),6000)
 assert.equal(fieldProduction({areaHa:100,productivityTarget:''}),null)
 assert.equal(fieldProduction({areaHa:0,productivityTarget:60}),0)
 assert.throws(()=>normalizePropertyProfileInput({fields:[{crop:'Soja',season:'2627V',productivityTarget:true}]}),/inválida/)
})
test('reference import accepts real polygons and searchable attributes but rejects projected coordinates and oversized/invalid rings',()=>{
 const ring=[...points,points[0]].map(p=>[p.lng,p.lat])
 const feature={type:'Feature',properties:{matricula:'12345',name:'São José'},geometry:{type:'Polygon',coordinates:[ring]}}
 const geo=normalizeCadastralGeoJSON(feature)
 assert.equal(filterCadastral(geo,'sao jose').features.length,1)
 assert.equal(filterCadastral(geo,'12345').features.length,1)
 assert.equal(filterCadastral(geo,'other').features.length,0)
 assert.throws(()=>normalizeCadastralGeoJSON({...feature,crs:{name:'EPSG:31982'}}),/WGS84/)
 assert.throws(()=>normalizeCadastralGeoJSON({...feature,geometry:{type:'Point',coordinates:[-54,-28]}}),/polígonos/)
 assert.throws(()=>normalizeCadastralGeoJSON({...feature,geometry:{type:'Polygon',coordinates:[ring.slice(0,-1)]}}),/fechado/)
 assert.throws(()=>normalizeCadastralGeoJSON({type:'FeatureCollection',features:Array(301).fill(feature)}),/300/)
})
