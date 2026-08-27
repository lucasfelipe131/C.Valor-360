import assert from 'node:assert/strict'
import test from 'node:test'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {ValRepository} from '../server/repository.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const actor='00000000-0000-4000-8000-000000000111'
const repositoryWith=db=>new ValRepository({db,tenantId:tenantA,readStore:()=>({surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}),saveStore:()=>{}})

test('getClientContext preserva coleções legadas e acrescenta histórico/snapshot tenant-safe',async()=>{
  let sql
  const own={id:'memory-own',tenant_id:tenantA,client_id:'client-db',subject_type:'client',subject_id:'client-db',memory_type:'fact',memory_state:'FACT',memory_domain:'PRODUCER',key:'planted_area_ha',value:620,status:'verified',source:'consultant_input',source_ref:'consultant_input:memory-own',source_type:'consultant_input',confidence:80,valid_from:'2026-08-01T12:00:00.000Z',acl:{scope:'own_portfolio'}}
  const foreign={...own,id:'memory-foreign',tenant_id:tenantB,source_ref:'foreign:secret'}
  const db={configured:true,query:async statement=>{
    sql=statement
    return {rowCount:1,rows:[{external_key:'client-ext',id:'client-db',name:'Produtor',commercial_profile:{},relationship_profile:{},profile_snapshot:{},answers:{},profile_evidence:[],signals:[],learning:{},feedback_learning:{},memories:[own],memory_history:[own,foreign],business_history:[{id:'business-1'}],visits:[],interactions:[],opportunities:[],properties:[],field_reports:[],soil_analyses:[],ndvi_observations:[],manual_records:[],prior_recommendations:[]}]}
  }}
  const context=await repositoryWith(db).getClientContext({tenantId:tenantA,clientId:'client-ext',ownerId:actor,contextRequest:{requestId:'00000000-0000-4000-8000-000000000311',objective:'next_best_action',actorRole:'consultant'}})
  assert.equal(context.businessHistory[0].id,'business-1')
  assert.equal(context.memories.length,1)
  assert.equal(context.memoryHistory.length,2)
  assert.equal(context.contextSnapshot.facts[0].value,620)
  assert.equal(context.contextSnapshot.subject.id,'client-db')
  assert.deepEqual(context.contextSnapshot.selection.considered_refs,['memory-own'])
  assert.equal(JSON.stringify(context.contextSnapshot).includes('foreign:secret'),false)
  assert.match(sql,/WHERE tenant_id=\$1 AND client_id=c\.id/)
  assert.match(sql,/memory_history/)
  assert.match(sql,/subject_type='organization' AND subject_id=\$1::text/)
  assert.match(sql,/val_recommendation\.context_snapshot_id/)
  assert.match(sql,/c\.tenant_id=\$1 AND c\.consultant_id=\$3/)
})

test('recomendação persiste ContextSnapshot de primeira classe e mantém input_context compatível',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.startsWith('SELECT id,external_key FROM clients'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000211',external_key:'client-ext'}]}
    return {rowCount:1,rows:[]}
  }
  const context={client:{id:'client-ext',name:'Produtor'},profile:{evidence:[]},memoryHistory:[{id:'memory-1',tenant_id:tenantA,client_id:'client-ext',subject_type:'client',subject_id:'client-ext',memory_type:'fact',memory_state:'FACT',memory_domain:'PRODUCER',key:'area',value:620,status:'verified',source_ref:'source:1',source_type:'consultant_input',valid_from:'2026-08-01T12:00:00.000Z',acl:{scope:'own_portfolio'}}],businessHistory:[],visits:[],interactions:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[]}
  context.contextSnapshot=buildContextSnapshot(context,{organizationId:tenantA,subjectType:'client',subjectId:'client-ext',actorId:actor,role:'consultant',scope:'own_portfolio',objective:'general_assistance',requestId:'00000000-0000-4000-8000-000000000312',now:new Date('2026-08-20T12:00:00.000Z')})
  const id='00000000-0000-4000-8000-000000000313'
  const repository=repositoryWith({configured:true,transaction:work=>work({query})})
  assert.equal(await repository.recordRecommendation({id,tenantId:tenantA,ownerId:actor,clientId:'client-ext',question:'Próxima ação?',mode:'daily',model:'rules',context,advice:{evidence_used:[],confidence:{level:'PROVÁVEL'},human_review:{required:false}}}),id)
  const snapshotInsertion=calls.find(call=>call.sql.includes('INSERT INTO val_context_snapshots'))
  const insertion=calls.find(call=>call.sql.includes('INSERT INTO val_recommendations'))
  assert.ok(snapshotInsertion)
  assert.equal(snapshotInsertion.params[0],context.contextSnapshot.context_snapshot_id)
  assert.equal(snapshotInsertion.params[1],tenantA)
  assert.deepEqual(snapshotInsertion.params[10],context.contextSnapshot.selection.selected_refs)
  assert.deepEqual(snapshotInsertion.params[11],context.contextSnapshot.selection.excluded_refs)
  assert.equal(JSON.parse(snapshotInsertion.params[14]).context_snapshot_id,context.contextSnapshot.context_snapshot_id)
  assert.match(insertion.sql,/context_snapshot_id,context_snapshot_version/)
  assert.equal(insertion.params[14],context.contextSnapshot.context_snapshot_id)
  assert.equal(insertion.params[15],'val.context_snapshot.v1')
  assert.ok(JSON.parse(insertion.params[10]).includes('val_memories:memory-1'))
  assert.equal(JSON.parse(insertion.params[9]).contextSnapshot.context_snapshot_id,context.contextSnapshot.context_snapshot_id)
})

test('persistência e leitura de snapshot bloqueiam tenant ou ator diferente',async()=>{
  const repository=repositoryWith({configured:true,query:async(sql,params)=>({rowCount:params[0]===tenantA&&params[1]===actor?1:0,rows:params[0]===tenantA&&params[1]===actor?[{snapshot_payload:{context_snapshot_id:'snapshot-own'}}]:[]})})
  assert.deepEqual(await repository.getContextSnapshot({tenantId:tenantA,ownerId:actor,id:'snapshot-own'}),{context_snapshot_id:'snapshot-own'})
  assert.equal(await repository.getContextSnapshot({tenantId:tenantA,ownerId:'00000000-0000-4000-8000-000000000999',id:'snapshot-own'}),null)
  await assert.rejects(()=>repository.getContextSnapshot({tenantId:tenantB,ownerId:actor,id:'snapshot-own'}),error=>error.statusCode===403)
})

test('recomendação rejeita ContextSnapshot de outro tenant antes da escrita',async()=>{
  const context={contextSnapshot:{context_snapshot_id:'00000000-0000-5000-a000-000000000399',organization_id:tenantB}}
  const repository=repositoryWith({configured:true,transaction:async()=>{throw new Error('não deve escrever')}})
  await assert.rejects(()=>repository.recordRecommendation({tenantId:tenantA,ownerId:actor,context}),error=>error.statusCode===403)
})
