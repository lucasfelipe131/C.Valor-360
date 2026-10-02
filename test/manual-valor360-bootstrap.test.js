import assert from 'node:assert/strict'
import test from 'node:test'
import {reconcileValor360Bootstrap} from '../manual/app/lib/valor360-bootstrap.ts'
import {technicalBootstrapFromValClients} from '../server/agronomic-geometry-bridge.js'

const local={id:'manual-uuid',crmCode:'crm-key',name:'SYNTHETIC producer',document:'',phone:'',email:'',city:'Synthetic city',properties:'',area:0,cultures:[],notes:'Local observation',fields:[{id:'field-local'}],registrations:[{id:'registration-local'}]}
const bootstrap=()=>technicalBootstrapFromValClients([{id:'crm-key',name:local.name,municipality:local.city,area:0,cultures:[],commercial:{manual_identity:{producer_id:local.id}}}]).producers[0]

test('Manual round trip preserves the bound source ID, canonical key and local agronomy',()=>{
 const incoming=bootstrap()
 assert.equal(incoming.id,local.id);assert.equal(incoming.crmCode,'crm-key');assert.equal(incoming.valor360ExternalKey,'crm-key')
 const result=reconcileValor360Bootstrap([local],[incoming])
 assert.equal(result.length,1);assert.equal(result[0].id,local.id)
 assert.deepEqual(result[0].fields,local.fields);assert.deepEqual(result[0].registrations,local.registrations)
 assert.equal(result[0].notes,local.notes)
 assert.deepEqual(reconcileValor360Bootstrap(result,[incoming]),result)
})
test('Manual reconciles only the reconstructable legacy bootstrap shadow',()=>{
 const incoming=bootstrap(),shadow={...incoming,id:'crm-key'}
 const result=reconcileValor360Bootstrap([shadow,local],[incoming])
 assert.equal(result.length,1);assert.equal(result[0].id,local.id)
 for(const enriched of [{...shadow,notes:'Independent local edit'},{...shadow,fields:[{id:'other-field'}]},{...shadow,phone:'Synthetic new contact'}]){
  assert.equal(reconcileValor360Bootstrap([enriched,local],[incoming]).length,2,'local work must remain for review')
 }
 assert.equal(reconcileValor360Bootstrap([shadow,local],[incoming],['crm-key']).length,2,'existing soil references must not be broken')
})
test('Manual never reconciles names or shared CRM codes without the bound source ID',()=>{
 const incoming=bootstrap(),other={...local,id:'independent-source-id'}
 const result=reconcileValor360Bootstrap([other,local],[incoming])
 assert.equal(result.length,2);assert.equal(result[1].id,other.id)
 const canonicalOnly=technicalBootstrapFromValClients([{id:'legacy-key',name:'Legacy',commercial:{}}]).producers[0]
 assert.equal(canonicalOnly.id,'legacy-key')
})
