import assert from 'node:assert/strict'
import test from 'node:test'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {ValEngine} from '../server/val-engine.js'

const tenantId='tenant-a'
const ownerId='owner-a'
const clientId='client-a'
const runtimeConfig={openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1_000,openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false}

function contextFor({tenant=tenantId,client=clientId}={}){
  const context={client:{id:client,name:'Produtor A'},profile:{answers:{},evidence:[]},signals:[],learning:{},memories:[],memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments:[],priorRecommendations:[]}
  context.contextSnapshot=buildContextSnapshot(context,{organizationId:tenant,subjectType:'client',subjectId:client,actorId:ownerId,role:'consultant',scope:'own_portfolio',objective:'next_best_action',requestId:'00000000-0000-4000-8000-000000000901',message:'Qual é a próxima ação?',now:new Date('2026-08-29T12:00:00.000Z')})
  return context
}

function repositoryFor({onContext=()=>{throw new Error('getClientContext não deveria ser chamado')}}={}){
  const persisted=[]
  return {
    repository:{
      getClientContext:async input=>onContext(input),
      recordRecommendation:async input=>{persisted.push(input);return 'recommendation-a'}
    },
    persisted
  }
}

test('ValEngine reutiliza contexto pré-carregado de escopo exato sem nova leitura e sem mutar o cache',async()=>{
  let contextReads=0
  const {repository,persisted}=repositoryFor({onContext:()=>{contextReads++;throw new Error('leitura duplicada')}})
  const cached=contextFor()
  const engine=new ValEngine({runtimeConfig,repository,logger:()=>{},clock:()=>new Date('2026-08-29T12:00:00.000Z')})
  const answer=await engine.answer({tenantId,ownerId,clientId,client:cached.client,message:'Qual é a próxima ação?',preloadedContext:{scope:{tenantId,ownerId,clientId},context:cached}})

  assert.equal(contextReads,0)
  assert.equal(answer.recommendationId,'recommendation-a')
  assert.equal(answer.contextSnapshotId,cached.contextSnapshot.context_snapshot_id)
  assert.equal(persisted.length,1)
  assert.notEqual(persisted[0].context,cached)
  assert.equal(persisted[0].context.contextSnapshot.context_snapshot_id,cached.contextSnapshot.context_snapshot_id)
  assert.equal(Object.hasOwn(cached,'decisionIntelligence'),false)
  assert.equal(Object.hasOwn(cached,'productIntelligence'),false)
  assert.deepEqual(cached.attachments,[])
})

test('ValEngine falha fechado quando tenant, owner ou client do envelope divergem',async()=>{
  for(const scope of [
    {tenantId:'tenant-b',ownerId,clientId},
    {tenantId,ownerId:'owner-b',clientId},
    {tenantId,ownerId,clientId:'client-b'}
  ]){
    let contextReads=0
    const {repository,persisted}=repositoryFor({onContext:()=>{contextReads++}})
    const engine=new ValEngine({runtimeConfig,repository,logger:()=>{}})
    await assert.rejects(
      ()=>engine.answer({tenantId,ownerId,clientId,client:{id:clientId},message:'Teste',preloadedContext:{scope,context:contextFor()}}),
      error=>error.statusCode===403&&error.code==='val_preloaded_context_scope_mismatch'
    )
    assert.equal(contextReads,0)
    assert.equal(persisted.length,0)
  }
})

test('ValEngine rejeita conteúdo pré-carregado incompatível mesmo com envelope forjado como correto',async()=>{
  const wrongSnapshotSubject=contextFor()
  wrongSnapshotSubject.contextSnapshot={...wrongSnapshotSubject.contextSnapshot,subject:{...wrongSnapshotSubject.contextSnapshot.subject,id:'client-b'}}
  const wrongConversationState=contextFor()
  wrongConversationState.conversationState={current_client:{id:'client-b',label:'Produtor B'}}
  const cases=[
    contextFor({tenant:'tenant-b'}),
    contextFor({client:'client-b'}),
    wrongSnapshotSubject,
    wrongConversationState,
    {...contextFor(),contextSnapshot:null}
  ]
  for(const context of cases){
    let contextReads=0
    const {repository,persisted}=repositoryFor({onContext:()=>{contextReads++}})
    const engine=new ValEngine({runtimeConfig,repository,logger:()=>{}})
    await assert.rejects(
      ()=>engine.answer({tenantId,ownerId,clientId,client:{id:clientId},message:'Teste',preloadedContext:{scope:{tenantId,ownerId,clientId},context}}),
      error=>error.statusCode===403&&error.code==='val_preloaded_context_scope_mismatch'
    )
    assert.equal(contextReads,0)
    assert.equal(persisted.length,0)
  }
})

test('ValEngine rejeita envelope incompleto em vez de recarregar contexto silenciosamente',async()=>{
  let contextReads=0
  const {repository,persisted}=repositoryFor({onContext:()=>{contextReads++}})
  const engine=new ValEngine({runtimeConfig,repository,logger:()=>{}})
  await assert.rejects(
    ()=>engine.answer({tenantId,ownerId,clientId,client:{id:clientId},message:'Teste',preloadedContext:{scope:{tenantId,clientId},context:contextFor()}}),
    error=>error.statusCode===403&&error.code==='val_preloaded_context_scope_required'
  )
  assert.equal(contextReads,0)
  assert.equal(persisted.length,0)
})
