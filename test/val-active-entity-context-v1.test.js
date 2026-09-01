import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'

const tenantId='tenant-a'
const ownerId='owner-a'
const producerId='producer-a'
const now=new Date('2026-08-30T12:00:00.000Z')
const scoped=item=>({...item,tenant_id:tenantId,producer_id:producerId,context_owner_id:ownerId})
const fieldMemory=(id,fieldId,statement)=>({
 id,tenant_id:tenantId,client_id:producerId,subject_type:'field',subject_id:fieldId,memory_type:'fact',memory_domain:'AGRONOMIC',memory_state:'FACT',key:'soil.diagnosis',value:{statement},status:'verified',source:'field_report',source_ref:`field_report:${id}`,source_type:'field_report',confidence:90,valid_from:'2026-08-29T10:00:00.000Z',created_at:'2026-08-29T10:00:00.000Z',updated_at:'2026-08-29T10:00:00.000Z',created_by:ownerId,acl:{scope:'own_portfolio'}
})

const baseContext=()=>({
 client:{id:producerId,name:'Produtor A'},
 profile:{evidence:[]},
 memoryHistory:[fieldMemory('memory-field-a','field-a','Solo do talhão A.'),fieldMemory('memory-field-b','field-b','Solo do talhão B.')],
 businessHistory:[],
 opportunities:[],
 interactions:[],
 visits:[],
 commitments:[],
 properties:[
  scoped({id:'property-a',name:'Fazenda A',fields:[{id:'field-a',name:'Talhão A'},{id:'field-b',name:'Talhão B'}]})
 ],
 fieldReports:[
  scoped({id:'report-a',property_id:'property-a',field_id:'field-a',summary:'Diagnóstico agronômico A',observed_at:'2026-08-29T10:00:00.000Z'}),
  scoped({id:'report-b',property_id:'property-a',field_id:'field-b',summary:'Diagnóstico agronômico B',observed_at:'2026-08-29T11:00:00.000Z'})
 ],
 soilAnalyses:[
  scoped({id:'soil-a',property_id:'property-a',field_id:'field-a',sampled_at:'2026-08-20T10:00:00.000Z',measurements:[{analyte:'pH',normalized_value:5.1}]}),
  scoped({id:'soil-b',property_id:'property-a',field_id:'field-b',sampled_at:'2026-08-21T10:00:00.000Z',measurements:[{analyte:'pH',normalized_value:6.2}]})
 ],
 ndviObservations:[
  scoped({id:'ndvi-a',property_id:'property-a',field_id:'field-a',observed_at:'2026-08-27T10:00:00.000Z',value:0.41}),
  scoped({id:'ndvi-b',property_id:'property-a',field_id:'field-b',observed_at:'2026-08-28T10:00:00.000Z',value:0.78})
 ]
})

const snapshot=(context,activeEntity)=>buildContextSnapshot(context,{
 organizationId:tenantId,
 subjectType:'client',
 subjectId:producerId,
 actorId:ownerId,
 role:'consultant',
 scope:'own_portfolio',
 objective:'agronomic_assistance',
 message:'Analise o solo deste talhão.',
 contextDomain:'AGRONOMY',
 conversationId:'thread-a',
 contextEpoch:2,
 activeEntity,
 now
})

test('activeEntity de talhão reduz o snapshot ao menor contexto agronômico compatível',()=>{
 const fieldA=snapshot(baseContext(),{type:'field',id:'field-a'})
 const fieldB=snapshot(baseContext(),{type:'field',id:'field-b'})

 assert.deepEqual(fieldA.agronomic_context.properties.map(item=>item.data.fields.map(field=>field.id)),[['field-a']])
 assert.deepEqual(fieldA.agronomic_context.field_reports.map(item=>item.data.id),['report-a'])
 assert.deepEqual(fieldA.agronomic_context.soil_analyses.map(item=>item.data.id),['soil-a'])
 assert.deepEqual(fieldA.agronomic_context.ndvi_observations.map(item=>item.data.id),['ndvi-a'])
 assert.deepEqual(fieldA.selection.selected_refs,['memory-field-a'])
 assert.deepEqual(fieldA.context_scope.active_entity,{type:'field',id:'field-a'})
 assert.doesNotMatch(JSON.stringify(fieldA.agronomic_context),/field-b|report-b|soil-b|ndvi-b/)

 assert.deepEqual(fieldB.agronomic_context.properties.map(item=>item.data.fields.map(field=>field.id)),[['field-b']])
 assert.deepEqual(fieldB.agronomic_context.field_reports.map(item=>item.data.id),['report-b'])
 assert.deepEqual(fieldB.agronomic_context.soil_analyses.map(item=>item.data.id),['soil-b'])
 assert.deepEqual(fieldB.agronomic_context.ndvi_observations.map(item=>item.data.id),['ndvi-b'])
 assert.deepEqual(fieldB.selection.selected_refs,['memory-field-b'])
 assert.deepEqual(fieldB.context_scope.active_entity,{type:'field',id:'field-b'})
 assert.doesNotMatch(JSON.stringify(fieldB.agronomic_context),/field-a|report-a|soil-a|ndvi-a/)

 assert.notEqual(fieldA.context_snapshot_id,fieldB.context_snapshot_id)
 assert.ok(fieldA.selection.context_trace.rejected.some(item=>item.reasonSelected==='ACTIVE_ENTITY_MISMATCH'))
 assert.ok(fieldB.selection.context_trace.rejected.some(item=>item.reasonSelected==='ACTIVE_ENTITY_MISMATCH'))
})

test('activeEntity inexistente ou fora do escopo falha fechado antes da seleção',()=>{
 assert.throws(
  ()=>snapshot(baseContext(),{type:'field',id:'field-inexistente'}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='ACTIVE_ENTITY_NOT_FOUND'
 )

 const wrongOwner=baseContext()
 wrongOwner.properties[0]={...wrongOwner.properties[0],context_owner_id:'owner-b'}
 assert.throws(
  ()=>snapshot(wrongOwner,{type:'field',id:'field-a'}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='ACTIVE_ENTITY_SCOPE_MISMATCH'
 )

 const poisonedChild=baseContext()
 poisonedChild.properties[0].fields[0]={...poisonedChild.properties[0].fields[0],producer_id:'producer-b'}
 assert.throws(
  ()=>snapshot(poisonedChild,{type:'field',id:'field-a'}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='ACTIVE_ENTITY_SCOPE_MISMATCH'
 )
})

test('activeEntity não suportada ou sem proveniência nunca entra no prompt por aproximação',()=>{
 assert.throws(
  ()=>snapshot(baseContext(),{type:'credit_account',id:'credit-a'}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='ACTIVE_ENTITY_TYPE_UNSUPPORTED'
 )

 const unverified=baseContext()
 delete unverified.properties[0].producer_id
 assert.throws(
  ()=>snapshot(unverified,{type:'field',id:'field-a'}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='ACTIVE_ENTITY_SCOPE_UNVERIFIED'
 )
})

test('repository propaga activeEntity para o snapshot selecionado',()=>{
 const repository=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 assert.match(repository,/activeEntity:contextRequest\.activeEntity\?\?contextRequest\.active_entity/)
})
