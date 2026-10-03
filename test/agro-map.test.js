import test from 'node:test'
import assert from 'node:assert/strict'
import {territorialLayers,resolveTerritorialFocus} from '../src/lib/agro-territory-map.js'
import {STEP09_GEOMETRIES as g} from '../server/step09-staging-fixture.js'
const properties=[{id:'p',name:'Synthetic',geometry:g.property,fields:[{id:'f',name:'Synthetic field',geometry:g.field,geometry_version:'v1',season:'2026/27'}]}]
test('property and field render separate polygon layers with correct bounds, selection and holes',()=>{
 let selected;const layers=territorialLayers(properties,{fieldId:'f',onField:(id,p)=>selected=[id,p]})
 assert.equal(layers.length,2);assert.equal(layers[0].kind,'property');assert.equal(layers[1].kind,'field');assert.notEqual(layers[0].color,layers[1].color);assert.ok(layers[0].dashArray);assert.equal(layers[1].selected,true)
 layers[1].onClick();assert.deepEqual(selected,['f','p'])
 assert.deepEqual(resolveTerritorialFocus(properties,{property_id:'p',field_id:'f',geometry_version:'v1'}).points,[...layers[0].points,...layers[1].points])
})
test('focus refuses other property, field and geometry versions; invalid and missing polygons never render',()=>{
 for(const focus of [{property_id:'foreign',field_id:'f'},{property_id:'p',field_id:'other'},{property_id:'p',field_id:'f',geometry_version:'v2'}])assert.equal(resolveTerritorialFocus(properties,focus),null)
 for(const geometry of [null,{}, {type:'Polygon',coordinates:[[[0,0],[1,1],[2,2],[0,0]]]}])assert.equal(territorialLayers([{...properties[0],geometry,fields:[{...properties[0].fields[0],geometry}]}]).length,0)
 assert.equal(territorialLayers(properties,{showProperties:false,showFields:false}).length,0)
})

test('territorial projection refuses cross-owner and cross-tenant geometries and describes invalid geometry',async()=>{
 const {buildAgronomicTerritory}=await import('../server/agronomic-geometry-bridge.js')
 const field={id:'f',tenant_id:'t',owner_user_id:'u',property_id:'p',geometry:g.field,geometry_version:'v1',seasons:[]}
 const property={id:'p',tenant_id:'t',owner_user_id:'u',client_id:'c',metadata:{geometry:g.property},fields:[field]}
 const project=p=>buildAgronomicTerritory({client:{id:'c'},canonicalClientId:'c',properties:[p]},{tenantId:'t',ownerId:'u'})
 for(const patch of [{tenant_id:'other'},{owner_user_id:'other'}]){
  assert.equal(project({...property,...patch}).properties.length,0)
  assert.equal(project({...property,fields:[{...field,...patch}]}).properties[0].fields.length,0)
 }
 const invalid=project({...property,fields:[{...field,geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[2,2],[0,0]]]}}]})
 assert.equal(invalid.properties[0].fields[0].geometry,null)
 assert.ok(invalid.properties[0].fields[0].missing_information.some(m=>m.includes('Geometria')))
 assert.ok(invalid.conflicts.length)
})
