import assert from 'node:assert/strict'
import test from 'node:test'
import {ValEngine} from '../server/val-engine.js'
import {ValRepository} from '../server/repository.js'

test('toda recomendação da ValEngine aponta ao snapshot autorizado persistido',async()=>{
  let store={surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},technicalContextHistory:[],attachments:[]}}
  const repository=new ValRepository({db:{configured:false},tenantId:'tenant-a',readStore:()=>store,saveStore:value=>{store=value}})
  await repository.saveTechnicalContext('client-a',{area:'620 ha',soil:'Argiloso'},'actor-a')
  const [scopedTechnicalContext]=Object.values(store.val.technicalContexts)
  scopedTechnicalContext.validUntil='2099-01-01T00:00:00.000Z'
  const engine=new ValEngine({runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false},repository,logger:()=>{},clock:()=>new Date('2026-08-20T12:00:00.000Z')})
  const answer=await engine.answer({tenantId:'tenant-a',ownerId:'actor-a',clientId:'client-a',client:{id:'client-a',name:'Produtor'},message:'Qual é o contexto agronômico e de solo deste produtor?',contextRequest:{requestId:'00000000-0000-4000-8000-000000000330',objective:'agronomic_question',contextDomain:'AGRONOMY',actorRole:'consultant',scope:'own_portfolio'}})
  assert.ok(answer.contextSnapshotId)
  assert.equal(answer.contextSnapshotVersion,'val.context_snapshot.v1')
  assert.equal(store.val.recommendations.length,1)
  assert.equal(store.val.contextSnapshots.length,1)
  assert.equal(store.val.contextSnapshots[0].id,answer.contextSnapshotId)
  assert.equal(store.val.recommendations[0].contextSnapshotId,answer.contextSnapshotId)
  assert.equal(store.val.recommendations[0].context.contextSnapshot.context_snapshot_id,answer.contextSnapshotId)
  assert.equal(store.val.recommendations[0].context.contextSnapshot.organization_id,'tenant-a')
  assert.equal(scopedTechnicalContext.ownerId,'actor-a')
  assert.deepEqual(store.val.recommendations[0].context.contextSnapshot.selection.selected_refs,[scopedTechnicalContext.id])
})
