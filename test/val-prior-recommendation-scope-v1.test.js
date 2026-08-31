import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {installConversionComposition} from '../server/conversion-bootstrap.js'
import {prepareConversationThread,selectScopedPriorRecommendations} from '../server/conversation-thread-context.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {ValRepository} from '../server/repository.js'
import {ValEngine} from '../server/val-engine.js'

const tenantId='tenant-a'
const ownerId='owner-a'
const producerId='producer-a'
const conversationId='conversation-a'
const contextEpoch=7
const domain='COMMERCIAL'
const referenceMessage='Continue a resposta anterior e explique a margem, o preço e a objeção comercial com alternativas, hipóteses e evidências.'

const recommendation=(overrides={})=>({
 id:'recommendation-a',tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,
 conversation_id:conversationId,context_epoch:contextEpoch,domain,
 user_question:'POISON_PRIOR_ACTIVE: objeção comercial registrada na resposta anterior.',
 created_at:'2026-08-29T12:00:00.000Z',...overrides
})

const scopedContext=(overrides={})=>({
 client:{id:producerId,name:'Produtor A'},
 contextSnapshot:{
  contract_version:'val.context_snapshot.v1',organization_id:tenantId,subject:{type:'client',id:producerId},
  context_scope:{tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:contextEpoch,domain}
 },
 priorRecommendations:[recommendation()],
 ...overrides
})

test('priorRecommendations exige referência de turno e seis dimensões exatas',()=>{
 const context=scopedContext()
 assert.equal(selectScopedPriorRecommendations(context,referenceMessage).length,1)
 assert.deepEqual(selectScopedPriorRecommendations(context,'Qual é a margem atual?'),[])

 const poisons=[
  ['tenant_id','tenant-b'],['owner_id','owner-b'],['producer_id','producer-b'],
  ['conversation_id','conversation-b'],['context_epoch',contextEpoch-1],['domain','CREDIT']
 ]
 for(const [field,value] of poisons){
  const item=recommendation({[field]:value,user_question:`POISON_${field}`})
  const poisoned=scopedContext({priorRecommendations:[item]})
  assert.deepEqual(selectScopedPriorRecommendations(poisoned,referenceMessage),[],field)
  assert.doesNotMatch(prepareConversationThread(poisoned,referenceMessage).message,new RegExp(`POISON_${field}`),field)
 }

 for(const field of ['tenant_id','owner_id','producer_id','conversation_id','context_epoch','domain']){
  const item=recommendation({user_question:`POISON_MISSING_${field}`})
  delete item[field]
  assert.deepEqual(selectScopedPriorRecommendations(scopedContext({priorRecommendations:[item]}),referenceMessage),[],`missing ${field}`)
 }
})

test('PROFILE nunca recebe priorRecommendations, mesmo com escopo completo e referência explícita',()=>{
 const profileContext=scopedContext({
  contextSnapshot:{...scopedContext().contextSnapshot,context_scope:{...scopedContext().contextSnapshot.context_scope,domain:'PROFILE'}},
  priorRecommendations:[recommendation({domain:'PROFILE',user_question:'POISON_PROFILE_PRIOR'})]
 })
 const prepared=prepareConversationThread(profileContext,'Por que você chegou a esse perfil?')
 assert.deepEqual(prepared.context.priorRecommendations,[])
 assert.equal(prepared.carriedPriorTurn,false)
 assert.doesNotMatch(prepared.message,/POISON_PROFILE_PRIOR/)
})

test('repository e bootstrap aplicam o escopo antes de preparar a conversa',()=>{
 const repository=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
 for(const field of ["tenant_id","owner_id","producer_id","conversation_id","context_epoch","domain"])assert.match(repository,new RegExp(`\\b${field}\\b`),field)
 assert.match(repository,/priorRecommendations=selectScopedPriorRecommendations\(context,contextRequest\.message/)
 assert.ok(bootstrap.indexOf('priorRecommendations:selectScopedPriorRecommendations(rawContext,originalMessage')<bootstrap.indexOf('prepareConversationThread(threadInputContext,originalMessage)'))
})

test('repository só publica recomendação persistida de escopo completo e atual',async()=>{
 const repositoryTenant='00000000-0000-4000-8000-000000000001'
 const repositoryOwner='00000000-0000-4000-8000-000000000010'
 const rowFor=item=>({
  external_key:producerId,name:'Produtor A',commercial_profile:{},profile_snapshot:{},answers:{},profile_evidence:[],
  signals:[],learning:{},feedback_learning:{},memories:[],memory_history:[],business_history:[],visits:[],interactions:[],
  commitments:[],opportunities:[],properties:[],field_reports:[],soil_analyses:[],ndvi_observations:[],manual_records:[],attachments:[],
  prior_recommendations:[item]
 })
 const load=async item=>{
  const repository=new ValRepository({
   db:{configured:true,query:async()=>({rowCount:1,rows:[rowFor(item)]})},tenantId:repositoryTenant,
   readStore:()=>({surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}),saveStore:()=>{}
  })
  return repository.getClientContext({
   tenantId:repositoryTenant,ownerId:repositoryOwner,clientId:producerId,
   contextRequest:{message:referenceMessage,conversationId,contextEpoch,contextDomain:domain,objective:'copilot_deep'}
  })
 }
 const exact=recommendation({tenant_id:repositoryTenant,owner_id:repositoryOwner})
 assert.equal((await load(exact)).priorRecommendations.length,1)
 assert.deepEqual((await load({...exact,context_epoch:contextEpoch-1,user_question:'POISON_REPOSITORY_STALE'})).priorRecommendations,[])
 const legacy={id:'legacy',user_question:'POISON_REPOSITORY_LEGACY'}
 assert.deepEqual((await load(legacy)).priorRecommendations,[])
})

test('provider prompt não recebe priorRecommendation de epoch antigo',async()=>{
 const context={
  client:{id:producerId,name:'Produtor A',commercial:{}},profile:{answers:{},evidence:[]},signals:[],learning:{},
  memories:[],memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],
  fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments:[],currentAttachments:[],
  priorRecommendations:[recommendation({context_epoch:contextEpoch-1,user_question:'POISON_STALE_EPOCH: travamento de contrato que não pertence a este epoch.'})]
 }
 context.contextSnapshot=buildContextSnapshot(context,{
  organizationId:tenantId,subjectType:'client',subjectId:producerId,actorId:ownerId,role:'consultant',scope:'own_portfolio',
  objective:'copilot_deep',message:referenceMessage,requestId:'prior-provider-probe',conversationId,contextEpoch,
  now:new Date('2026-08-30T12:00:00.000Z')
 })
 assert.equal(context.contextSnapshot.context_scope.domain,domain)
 assert.match(JSON.stringify(context),/POISON_STALE_EPOCH/)

 installConversionComposition()
 let capturedRequest=null
 const repository={getClientContext:async()=>structuredClone(context),listAttachments:async()=>[],recordRecommendation:async()=> 'recommendation-probe'}
 const runtimeConfig={
  openaiApiKey:'test-key',openaiProject:'',openaiTimeoutMs:1_000,conversationalModelTimeoutMs:1_000,openaiMaxRetries:0,
  modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:30_000,
  maxOutputTokens:1_000,strategicMaxOutputTokens:1_000,openaiStoreResponses:false
 }
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{},clock:()=>new Date('2026-08-30T12:00:00.000Z')})
 engine.client={responses:{create:async request=>{
  capturedRequest=request
  throw Object.assign(new Error('Fim intencional do probe após capturar o prompt.'),{code:'prompt_probe_complete'})
 }}}
 try{
  await engine.answer({
   tenantId,ownerId,clientId:producerId,client:context.client,message:referenceMessage,
   contextRequest:{conversationId,contextEpoch,contextDomain:domain}
  })
 }catch{}

 assert.ok(capturedRequest,'o probe não alcançou o provider estruturado')
 assert.doesNotMatch(JSON.stringify(capturedRequest),/POISON_STALE_EPOCH|travamento de contrato que não pertence/)
})
