import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCadastralFile,prepareReferenceDraft} from '../src/lib/cadastral-import.js'
import {cadastralDetails,referenceParts,filterCadastral} from '../src/lib/cadastral-map.js'
import {producerMapRegistrations} from '../manual/app/lib/producer-map-registrations.ts'
import {loadAdministrativeReferences} from '../src/lib/map-localities.js'
const ring=[[-54,-28],[-53.99,-28],[-53.99,-27.99],[-54,-27.99],[-54,-28]]
const hole=[[-53.998,-27.998],[-53.995,-27.998],[-53.995,-27.995],[-53.998,-27.995],[-53.998,-27.998]]
const boundary=(points,tag='outerBoundaryIs')=>`<k:${tag}><k:LinearRing><k:coordinates>${points.map(p=>p.join(',')+',0').join(' ')}</k:coordinates></k:LinearRing></k:${tag}>`
const polygon=(outer=ring,inner=null)=>`<k:Polygon>${boundary(outer)}${inner?boundary(inner,'innerBoundaryIs'):''}</k:Polygon>`
const kml=contents=>`<?xml version="1.0" encoding="UTF-8"?><k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document>${contents}</k:Document></k:kml>`
test('namespaced CAR KML preserves multiple polygons and holes; holder comes only from explicit metadata',()=>{
 const source=kml(`<k:Placemark><k:name>Imóvel &amp; Área</k:name><k:ExtendedData><k:Data name="matricula"><k:value>00123-A</k:value></k:Data><k:SchemaData><k:SimpleData name="nome_proprietario"><![CDATA[Maria de Teste]]></k:SimpleData></k:SchemaData></k:ExtendedData><k:MultiGeometry>${polygon(ring,hole)}${polygon(ring.map(([x,y])=>[x+.1,y]))}</k:MultiGeometry></k:Placemark>`)
 const data=parseCadastralFile(source,'car.kml'),layer={id:'test',type:'CAR',geojson:data}
 assert.equal(data.features.length,1);assert.equal(data.features[0].geometry.type,'MultiPolygon')
 assert.deepEqual(data.features[0].geometry.coordinates[0],[ring,hole])
 const parts=referenceParts(layer);assert.equal(parts.length,2)
 assert.match(parts[1].label,/parte 2\/2/);assert.throws(()=>prepareReferenceDraft(parts[0].feature),/recortes internos/)
 assert.equal(prepareReferenceDraft(parts[1].feature).points.length,4)
 assert.deepEqual(cadastralDetails(data.features[0]),{registry:'00123-A',holder:'Maria de Teste',name:'Imóvel & Área',code:''})
 assert.equal(filterCadastral(data,'MARIA').features.length,1)
 assert.equal(cadastralDetails({properties:{nome:'Produtor aberto na tela',produtorVinculado:'Antônio',cpf:'000'}}).holder,'')
})
test('KML rejects invalid XML, projected/invalid coordinates, open rings and external entities; lines are never areas',()=>{
 for(const source of [kml(`<k:Placemark>${polygon(ring.slice(0,-1))}</k:Placemark>`),kml(`<k:Placemark>${polygon([[1000,1000],[1001,1000],[1000,1001],[1000,1000]])}</k:Placemark>`),'<kml><Placemark></kml>','<!DOCTYPE kml [<!ENTITY x SYSTEM "https://example.test/private">]><kml/>',kml('<k:Placemark><k:LineString><k:coordinates>-54,-28 -53.9,-28 -53.9,-27.9 -54,-28</k:coordinates></k:LineString></k:Placemark>'),kml('<k:NetworkLink><k:Link><k:href>https://example.test/map.kml</k:href></k:Link></k:NetworkLink>')])assert.throws(()=>parseCadastralFile(source,'car.kml'))
 const data=parseCadastralFile(kml(`<k:NetworkLink><k:Link><k:href>https://example.test/map.kml</k:href></k:Link></k:NetworkLink><k:Placemark>${polygon()}</k:Placemark>`),'car.kml')
 assert.equal(data.features.length,1)
 assert.throws(()=>parseCadastralFile('x'.repeat(5*1024*1024+1),'large.kml'),/5 MB/)
})
test('detailed contours are simplified with a bounded area difference, never truncated',()=>{
 const circle=Array.from({length:2000},(_,i)=>[-54+.005*Math.cos(i*Math.PI/1000),-28+.005*Math.sin(i*Math.PI/1000)])
 const prepared=prepareReferenceDraft({geometry:{type:'Polygon',coordinates:[[...circle,circle[0]]]}})
 assert.ok(prepared.points.length<=500&&prepared.points.length>3)
 assert.equal(prepared.simplified,true);assert.ok(prepared.differencePercent<.5)
 assert.ok(Math.min(...prepared.points.map(p=>p.lng))< -54.0049)
 assert.ok(Math.max(...prepared.points.map(p=>p.lng))> -53.9951)
 const bow=[ring[0],ring[2],ring[1],ring[3],ring[0]]
 assert.throws(()=>prepareReferenceDraft({geometry:{type:'Polygon',coordinates:[bow]}}),/revisão/)
 const zigzag=Array.from({length:10000},(_,i)=>[-54+i*.000001,-28+(i%2)*.01])
 assert.throws(()=>prepareReferenceDraft({geometry:{type:'Polygon',coordinates:[[...zigzag,zigzag[0]]]}}),/complexo|revisão/)
})
test('registered holders are producer scoped, demo isolated and never inferred from producer names',()=>{
 const points=ring.slice(0,-1).map(([lng,lat])=>({lng,lat}))
 const record={number:'00012',points,ownerName:'Titular informado',propertyName:'Imóvel de teste'}
 const rows=[{id:'a',crmCode:'EXT-A',name:'Produtor A',registrations:[record,{...record,number:'00013',ownerName:''}]},{id:'b',name:'Outro produtor',registrations:[{...record,ownerName:'Não pode aparecer'}]},{id:'demo',crmCode:'EXT-A',isDemo:true,registrations:[{...record,ownerName:'Demo'}]}]
 const result=producerMapRegistrations(rows,{id:'canonical-a',external_key:'EXT-A',isDemo:false})
 assert.equal(result.length,2);assert.equal(result[0].ownerName,'Titular informado');assert.equal(result[1].ownerName,'')
 assert.ok(!JSON.stringify(result).includes('Não pode aparecer'));assert.ok(!JSON.stringify(result).includes('"ownerName":"Demo"'))
 assert.deepEqual(producerMapRegistrations(rows,{id:'unknown',external_key:null,isDemo:false}),[])
 assert.deepEqual(producerMapRegistrations([{id:'canonical-a',crmCode:'other-client',registrations:[record]}],{id:'canonical-a',external_key:'EXT-A',isDemo:false}),[])
 assert.deepEqual(producerMapRegistrations([{id:'a',registrations:[{...record,points:[{lat:Infinity,lng:0}]}]}],{id:'a',external_key:null,isDemo:false}),[])
})
test('public administrative references load once for concurrent and reopened maps',async()=>{
 let calls=0
 const fetcher=async url=>{calls++;return {ok:true,json:async()=>url.endsWith('.geojson')?{features:Array(27).fill({})}:[]}}
 const [a,b]=await Promise.all([loadAdministrativeReferences(fetcher),loadAdministrativeReferences(fetcher)])
 assert.equal(a,b);assert.equal(calls,2);assert.equal(await loadAdministrativeReferences(fetcher),a);assert.equal(calls,2)
})
