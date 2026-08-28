import assert from 'node:assert/strict'
import test from 'node:test'
import {
 AGRONOMIC_GEOMETRY_ADAPTER_VERSION,
 canonicalValToManualGeometry,
 decodeCanonicalGeometryRef,
 encodeCanonicalGeometryRef,
 manualToCanonicalValGeometry,
 rebindCanonicalValGeometry
} from '../src/lib/agronomic-geometry-adapter.js'
import {normalizeIntegrationEvent} from '../server/ingestion.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const square=[
 {lat:-28,lng:-54},{lat:-28,lng:-53.999},{lat:-28.001,lng:-53.999},{lat:-28.001,lng:-54}
]
const input=(overrides={})=>({
 organizationId:tenantA,clientId:'client-a',propertyId:'property-a',propertyName:'Fazenda A',fieldId:'field-a',fieldName:'Talhão Norte',
 points:square,areaHa:1.1,provenance:{source:'manual-do-agronomo',sourceRef:'integration-event:event-a',observedAt:'2026-08-27T10:00:00.000Z'},...overrides
})

test('AgronomicGeometryAdapter v1 canonicaliza Polygon, unidade, área e provenance',()=>{
 const canonical=manualToCanonicalValGeometry(input())
 assert.equal(canonical.adapterVersion,AGRONOMIC_GEOMETRY_ADAPTER_VERSION)
 assert.equal(canonical.geometry.type,'Polygon')
 assert.deepEqual(canonical.geometry.coordinates[0][0],canonical.geometry.coordinates[0].at(-1))
 assert.ok(canonical.measurements.calculatedAreaHa>1&&canonical.measurements.calculatedAreaHa<1.2)
 assert.equal(canonical.measurements.suppliedAreaHa,1.1)
 assert.equal(canonical.unit.area,'ha')
 assert.equal(canonical.crs,'EPSG:4326')
 assert.equal(canonical.provenance.sourceRef,'integration-event:event-a')
})

test('Polygon faz round-trip Manual → VAL → Manual sem perder coordenadas',()=>{
 const canonical=manualToCanonicalValGeometry(input())
 const restored=canonicalValToManualGeometry(decodeCanonicalGeometryRef(encodeCanonicalGeometryRef(canonical),{expectedOrganizationId:tenantA}),{expectedOrganizationId:tenantA})
 assert.deepEqual(restored.points,square)
 assert.equal(restored.geometryVersion,canonical.geometryVersion)
 assert.equal(restored.link.fieldId,'field-a')
 assert.equal(restored.area,canonical.measurements.calculatedAreaHa)
})

test('MultiPolygon preserva todos os polígonos e não reduz silenciosamente para points',()=>{
 const second=square.map(point=>({lat:Number((point.lat-.01).toFixed(7)),lng:Number((point.lng-.01).toFixed(7))}))
 const canonical=manualToCanonicalValGeometry(input({points:undefined,polygons:[square,second]}))
 const restored=canonicalValToManualGeometry(canonical,{expectedOrganizationId:tenantA})
 assert.equal(canonical.geometry.type,'MultiPolygon')
 assert.equal(restored.polygons.length,2)
 assert.deepEqual(restored.polygons[0][0],square)
 assert.deepEqual(restored.polygons[1][0],second)
 assert.deepEqual(restored.points,[])
})

test('coordenada inválida falha explicitamente e não é descartada',()=>{
 assert.throws(()=>manualToCanonicalValGeometry(input({points:[...square,{lat:95,lng:-54}]})),error=>error.code==='geometry_coordinate_out_of_range')
 assert.throws(()=>manualToCanonicalValGeometry(input({points:[square[0],square[1],{lat:Number.NaN,lng:-54}]})),error=>error.code==='geometry_coordinate_invalid')
})

test('edição muda geometryVersion enquanto alteração de área declarada não muda o polígono',()=>{
 const original=manualToCanonicalValGeometry(input())
 const areaOnly=manualToCanonicalValGeometry(input({areaHa:999}))
 const edited=manualToCanonicalValGeometry(input({points:square.map((point,index)=>index===1?{...point,lng:point.lng+.0002}:point)}))
 assert.equal(areaOnly.geometryVersion,original.geometryVersion)
 assert.notEqual(edited.geometryVersion,original.geometryVersion)
 assert.equal(areaOnly.measurements.suppliedAreaHa,999)
 assert.equal(areaOnly.measurements.calculatedAreaHa,original.measurements.calculatedAreaHa)
})

test('desvínculo e novo vínculo preservam geometria, versão e histórico',()=>{
 const canonical=manualToCanonicalValGeometry(input())
 const detached=rebindCanonicalValGeometry(canonical,{organizationId:tenantA,state:'UNLINKED',reason:'USER_EXPLICIT',at:'2026-08-27T11:00:00.000Z'})
 const rebound=rebindCanonicalValGeometry(detached,{organizationId:tenantA,state:'LINKED_FIELD',clientId:'client-b',propertyId:'property-b',fieldId:'field-b',reason:'USER_EXPLICIT',at:'2026-08-27T12:00:00.000Z'})
 assert.equal(detached.link.state,'UNLINKED')
 assert.equal(rebound.link.fieldId,'field-b')
 assert.equal(rebound.geometryVersion,canonical.geometryVersion)
 assert.deepEqual(rebound.geometry,canonical.geometry)
 assert.equal(rebound.link.history.length,2)
})

test('geometria de tenant A nunca é lida nem religada como tenant B',()=>{
 const canonical=manualToCanonicalValGeometry(input())
 const ref=encodeCanonicalGeometryRef(canonical)
 assert.throws(()=>decodeCanonicalGeometryRef(ref,{expectedOrganizationId:tenantB}),error=>error.code==='cross_tenant_geometry_denied')
 assert.throws(()=>rebindCanonicalValGeometry(canonical,{organizationId:tenantB,state:'UNLINKED'}),error=>error.code==='cross_tenant_geometry_denied')
})

test('ingestão preserva MultiPolygon e mais de 100 vértices sem truncamento silencioso',()=>{
 const ring=Array.from({length:101},(_,index)=>[-55+index/100_000,-12-index/100_000])
 const geometry={type:'MultiPolygon',coordinates:[[[[-55,-12],[-54.999,-12],[-54.999,-12.001],[-55,-12.001]]],[[...ring]]]}
 const event=normalizeIntegrationEvent({
  type:'manual.producer.updated',externalId:'geometry-multipolygon-ingestion',source:'manual-do-agronomo',clientExternalKey:'producer-1',
  payload:{producer:{name:'Produtor 1',fields:[{id:'field-1',geometry}]}}
 })
 assert.equal(event.payload.producer.fields[0].geometry.type,'MultiPolygon')
 assert.equal(event.payload.producer.fields[0].geometry.coordinates[1][0].length,101)
 assert.deepEqual(event.payload.producer.fields[0].geometry.coordinates[0][0][0],[-55,-12])
})

test('ingestão rejeita geometria acima do teto em vez de cortar posições',()=>{
 const points=Array.from({length:5_001},(_,index)=>({lat:-12-index/100_000,lng:-55+index/100_000}))
 assert.throws(()=>normalizeIntegrationEvent({
  type:'manual.producer.updated',externalId:'geometry-too-large-ingestion',source:'manual-do-agronomo',clientExternalKey:'producer-1',
  payload:{producer:{name:'Produtor 1',fields:[{id:'field-1',points}]}}
 }),/não pode ser truncada silenciosamente/i)
})
