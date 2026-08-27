import assert from 'node:assert/strict'
import test from 'node:test'
import {technicalBootstrapFromValClients} from '../server/agronomic-geometry-bridge.js'
import {encodeCanonicalGeometryRef,manualToCanonicalValGeometry} from '../src/lib/agronomic-geometry-adapter.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const points=[{lat:-28,lng:-54},{lat:-28,lng:-53.999},{lat:-28.001,lng:-53.999},{lat:-28.001,lng:-54}]

function clientWithGeometry(organizationId=tenantA){
 const canonical=manualToCanonicalValGeometry({
  organizationId,clientId:'client-internal',clientExternalKey:'client-a',propertyId:'property-internal',propertyExternalKey:'property-a',propertyName:'Fazenda A',fieldId:'field-internal',fieldExternalKey:'field-a',sourceFieldId:'manual-field-a',fieldName:'Talhão A',points,areaHa:1.1,provenance:{source:'manual-do-agronomo',sourceRef:'integration-event:event-a'}
 })
 return {
  id:'client-a',name:'João',municipality:'Ijuí',area:100,cultures:'Soja',commercial:{},properties:[{
   id:'property-internal',name:'Fazenda A',fields:[{id:'field-internal',external_key:'field-a',name:'Talhão A',area_ha:1.1,geometry_ref:encodeCanonicalGeometryRef(canonical),geometry_version:canonical.geometryVersion,latest_season:{crop:'Soja',season:'2026/27'}}]
  }]
 }
}

test('bootstrap VAL → Manual restaura propriedade, talhão, geometria, área, versão e provenance',()=>{
 const result=technicalBootstrapFromValClients([clientWithGeometry()],{organizationId:tenantA})
 assert.equal(result.geometryIssues.length,0)
 assert.equal(result.producers.length,1)
 const producer=result.producers[0]
 const field=producer.fields[0]
 assert.equal(producer.properties,'Fazenda A')
 assert.equal(producer.mappingStatus,'mapped')
 assert.equal(field.id,'manual-field-a')
 assert.equal(field.propertyId,'property-internal')
 assert.deepEqual(field.points,points)
 assert.equal(field.geometryStatus,'CANONICAL')
 assert.equal(field.geometryAction,'UNCHANGED')
 assert.equal(field.geometryProvenance.sourceRef,'integration-event:event-a')
 assert.ok(field.area>1&&field.area<1.2)
})

test('bootstrap rejeita referência cross-tenant sem expor coordenadas',()=>{
 const result=technicalBootstrapFromValClients([clientWithGeometry(tenantA)],{organizationId:tenantB})
 const field=result.producers[0].fields[0]
 assert.equal(field.geometryStatus,'REJECTED')
 assert.deepEqual(field.points,[])
 assert.deepEqual(field.polygons,[])
 assert.deepEqual(result.geometryIssues,[{propertyId:'property-internal',fieldId:'field-internal',code:'cross_tenant_geometry_denied'}])
})
