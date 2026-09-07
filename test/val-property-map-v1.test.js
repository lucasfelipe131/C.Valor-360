import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {ValRepository} from '../server/repository.js'
import {normalizePropertyProfileInput,locationFromMetadata,fieldPointsFromGeometryRef} from '../server/property-profile.js'
import {encodeCanonicalGeometryRef,manualToCanonicalValGeometry} from '../src/lib/agronomic-geometry-adapter.js'
import {buildRouteStops,polygonAreaHa,validLocation,SATELLITE_TILES} from '../src/lib/property-map.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const ownerA='00000000-0000-4000-8000-000000000010'
const ownerB='00000000-0000-4000-8000-000000000011'

// Quadrado de ~100 m de lado perto de Sorriso/MT: 1 hectare.
const square=[{lat:-12.5450,lng:-55.7210},{lat:-12.5450,lng:-55.72008},{lat:-12.54590,lng:-55.72008},{lat:-12.54590,lng:-55.7210}]

test('a área do contorno sai da geometria, não de um chute',()=>{
 const area=polygonAreaHa(square)
 assert.ok(area>0.95&&area<1.05,`esperava ~1 ha, veio ${area}`)
 assert.equal(polygonAreaHa([square[0],square[1]]),0)
 assert.equal(validLocation({lat:'x',lng:1}),null)
 assert.equal(validLocation({lat:91,lng:1}),null)
 assert.deepEqual(validLocation({latitude:-12.5,longitude:-55.7}),{lat:-12.5,lng:-55.7})
})

test('a rota só coloca no mapa quem tem sede; quem não tem vira aviso, não pino',()=>{
 const now=new Date('2026-09-06T08:00:00').getTime()
 const clients=[
  {id:'c1',name:'Com sede',location:{lat:-12.54,lng:-55.72},commercial:{property:'Fazenda Norte'}},
  {id:'c2',name:'Sem sede',municipality:'Sinop/MT'},
  {id:'c3',name:'Outra sede',location:{lat:-12.60,lng:-55.80}}
 ]
 const visits=[
  {id:'v3',clientId:'c3',date:'2026-09-07',time:'09:00',status:'Agendada'},
  {id:'v1',clientId:'c1',date:'2026-09-06',time:'14:00',status:'Agendada'},
  {id:'v2',clientId:'c2',date:'2026-09-06',time:'16:00',status:'Agendada'},
  {id:'v0',clientId:'c1',date:'2026-09-01',time:'09:00',status:'Realizada'},
  {id:'v4',clientId:'c1',date:'2026-09-08',lifecycleStatus:'CANCELLED'}
 ]
 const route=buildRouteStops({visits,clients,now})
 assert.deepEqual(route.stops.map(stop=>[stop.visitId,stop.order]),[['v1',1],['v3',2]])
 assert.deepEqual(route.missing.map(stop=>stop.visitId),['v2'])
 assert.deepEqual(route.route,[[-12.54,-55.72],[-12.6,-55.8]])
 assert.equal(route.stops[0].place,'Fazenda Norte')
 assert.match(SATELLITE_TILES.attribution,/Esri/)
})

test('o contrato de entrada rejeita contorno aberto e cultura sem safra',()=>{
 assert.throws(()=>normalizePropertyProfileInput({fields:[{name:'Norte',points:[{lat:-12,lng:-55},{lat:-12.1,lng:-55}]}]}),/três pontos/)
 assert.throws(()=>normalizePropertyProfileInput({fields:[{name:'Norte',crop:'soja'}]}),/safra/)
 assert.throws(()=>normalizePropertyProfileInput({location:{lat:95,lng:0}}),/intervalo/)
 const normalized=normalizePropertyProfileInput({propertyName:'  Fazenda Norte ',location:{lat:-12.5450001234,lng:-55.72},fields:[{id:'f1',name:'Talhão 1',areaHa:'42.5',crop:'Soja',season:'2025/26',productivityTarget:60,points:square},{}],removedFieldIds:['x','x','']})
 assert.equal(normalized.propertyName,'Fazenda Norte')
 assert.deepEqual(normalized.location,{lat:-12.545,lng:-55.72})
 assert.equal(normalized.fields[0].areaHa,42.5)
 assert.equal(normalized.fields[0].points.length,4)
 assert.equal(normalized.fields[1].name,'Talhão 2')
 assert.deepEqual(normalized.removedFieldIds,['x'])
 // Localização ausente é "manter"; null é "remover".
 assert.equal(normalizePropertyProfileInput({}).location,undefined)
 assert.equal(normalizePropertyProfileInput({location:null}).location,null)
})

test('o contorno gravado no envelope canônico volta como pontos para o mapa',()=>{
 const canonical=manualToCanonicalValGeometry({organizationId:tenantId,propertyId:'p1',fieldId:'f1',fieldName:'Norte',points:square,provenance:{source:'valor360-produtor-360'}})
 const decoded=fieldPointsFromGeometryRef(encodeCanonicalGeometryRef(canonical),{organizationId:tenantId})
 assert.equal(decoded.geometryStatus,'CANONICAL')
 assert.equal(decoded.points.length,4)
 assert.ok(Math.abs(decoded.calculatedAreaHa-1)<0.06)
 // Outra organização não lê a geometria; referência quebrada não derruba a leitura.
 assert.equal(fieldPointsFromGeometryRef(encodeCanonicalGeometryRef(canonical),{organizationId:'outra'}).geometryStatus,'REJECTED')
 assert.equal(fieldPointsFromGeometryRef('lixo').geometryStatus,'REJECTED')
 assert.equal(fieldPointsFromGeometryRef('').geometryStatus,'NOT_MAPPED')
 assert.equal(locationFromMetadata({location:{lat:'-12.5',lng:'-55.7',source:'gps'}}).source,'gps')
 assert.equal(locationFromMetadata({location:{lat:'x'}}),null)
})

test('sem PostgreSQL a sede e os talhões vivem no arquivo local, por dono, e a carteira ganha location',async()=>{
 let store={imports:[{tenantId,ownerId:ownerA,clients:[{id:'c1',name:'Produtor Um',municipality:'Sorriso/MT',commercial:{property:'Fazenda Norte'}}]}],visits:[],opportunities:[],val:{}}
 const repository=new ValRepository({db:{configured:false},tenantId,readStore:()=>store,saveStore:next=>{store=structuredClone(next)}})

 assert.deepEqual(await repository.getPropertyProfile('c1',ownerA),{clientId:'c1',property:null,properties:[],fields:[],source:'arquivo-local'})
 assert.equal((await repository.getIntelligence(ownerA)).clients[0].location,null)

 const saved=await repository.savePropertyProfile('c1',{location:{lat:-12.545,lng:-55.72},fields:[{name:'Norte',crop:'Soja',season:'2025/26',productivityTarget:60,points:square},{name:'Sem contorno',areaHa:12}]},ownerA)
 assert.equal(saved.property.name,'Fazenda Norte')
 assert.deepEqual([saved.property.location.lat,saved.property.location.lng],[-12.545,-55.72])
 assert.equal(saved.fields.length,2)
 assert.equal(saved.fields[0].geometryStatus,'CANONICAL')
 assert.equal(saved.fields[0].productivityTarget,60)
 assert.equal(saved.fields[1].geometryStatus,'NOT_MAPPED')
 assert.equal((await repository.getIntelligence(ownerA)).clients[0].location.lat,-12.545)

 // Editar mantém o id do talhão; remover tira; localização null limpa a sede.
 const [first,second]=saved.fields
 const edited=await repository.savePropertyProfile('c1',{location:null,fields:[{id:first.id,name:'Norte renomeado',crop:'Milho',season:'2026'}],removedFieldIds:[second.id]},ownerA)
 assert.equal(edited.property.location,null)
 assert.deepEqual(edited.fields.map(field=>[field.id,field.name,field.crop,field.points.length]),[[first.id,'Norte renomeado','Milho',4]])

 // Outro dono não enxerga nada; produtor fora da carteira é 404.
 assert.deepEqual((await repository.getPropertyProfile('c1',ownerB)).fields,[])
 await assert.rejects(repository.savePropertyProfile('c1',{},ownerB),/não encontrado/)
 await assert.rejects(repository.getPropertyProfile('c1',''),/obrigatório/)
})

test('as telas ligam o mapa onde a decisão acontece, sem pino inventado',()=>{
 const client360=readFileSync('src/pages/Client360.jsx','utf8')+readFileSync('src/pages/Client360Details.jsx','utf8')
 assert.match(client360,/<Drilldown eyebrow="PROPRIEDADE E TALHÕES"/)
 assert.match(client360,/<PropertyFields client=\{client\} onSaved=\{onSaved\} onRefreshPortfolio=\{onRefreshPortfolio\}\/>/)
 assert.match(client360,/Nenhuma localização cadastrada/)

 const visits=readFileSync('src/pages/Visits.jsx','utf8')
 assert.match(visits,/<RouteMap visits=\{visits\} clients=\{clients\}[^>]*onOpenVisit=\{openVisitDetails\}/)
 assert.ok(!visits.includes('route-visual'),'a ilustração decorativa da rota voltou')
 assert.ok(!visits.includes('começar pelo maior potencial'),'a frase decorativa sobre a rota voltou')

 const prepare=readFileSync('src/components/visit/PrepareVisitSimple.jsx','utf8')
 assert.match(prepare,/<article className="prepare-map"><span><MapPin size=\{17\}\/>ONDE<\/span><PropertyPreview client=\{client\}\/><\/article>/)

 const map=readFileSync('src/components/map/SatelliteMap.jsx','utf8')
 assert.match(map,/import\('leaflet'\)/)
 assert.match(map,/L\.divIcon\(/)
 assert.ok(!/marker-icon\.png/.test(map))
 assert.match(map,/BRAZIL_VIEW\.center/)

 const routeMap=readFileSync('src/components/map/RouteMap.jsx','utf8')
 assert.match(routeMap,/sem localização cadastrada/)

 const server=readFileSync('server.js','utf8')
 assert.match(server,/\/api\\\/clients\\\/\(\[\^\/\]\+\)\\\/property\$/)
 assert.match(server,/repository\.savePropertyProfile\(clientId,await body\(request\),identity\?\.id\|\|identity\?\.email\)/)
 const repository=readFileSync('server/repository.js','utf8')
 assert.match(repository,/'propertyProfiles'\]\)store\.val\[key\]\|\|=\[\]/)
 assert.match(repository,/property\.metadata->'location'/)
})
