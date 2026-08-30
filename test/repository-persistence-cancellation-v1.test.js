import assert from 'node:assert/strict'
import test from 'node:test'
import {createDatabase} from '../server/db.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {ValRepository} from '../server/repository.js'
import {ValEngine} from '../server/val-engine.js'

const tenantId='tenant-persistence-a'
const ownerId='owner-persistence-a'
const clientId='client-persistence-a'

test('recordRecommendation abortado dentro da transação faz rollback e não chega ao commit',async()=>{
 const controller=new AbortController()
 const cancelled=Object.assign(new Error('turno substituído'),{name:'AbortError',statusCode:409,code:'val_request_superseded'})
 const statements=[]
 const client={
  async query(...args){
   const text=typeof args[0]==='string'?args[0]:args[0]?.text
   statements.push(text)
   if(text.startsWith('SELECT id,external_key FROM clients'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000301',external_key:clientId}]}
   if(text.startsWith('INSERT INTO val_recommendations'))controller.abort(cancelled)
   return {rowCount:1,rows:[]}
  },
  release(){}
 }
 class FakePool{async connect(){return client}async end(){}}
 const db=createDatabase({databaseUrl:'postgres://controlado',databaseSsl:false,databaseQueryTimeoutMs:3_000},{PoolClass:FakePool})
 const repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{}})

 await assert.rejects(repository.recordRecommendation({
  tenantId,ownerId,clientId,question:'Pergunta',mode:'FAST',model:'rules',context:{},advice:{confidence:{score:.8}},signal:controller.signal
 }),error=>error===cancelled)

 assert.equal(statements.includes('COMMIT'),false)
 assert.equal(statements.at(-1),'ROLLBACK')
})

test('fallback pré-cancelado não altera store nem chama saveStore',async()=>{
 const cancelled=Object.assign(new Error('cliente cancelou'),{name:'AbortError',statusCode:499,code:'val_request_cancelled'})
 const controller=new AbortController();controller.abort(cancelled)
 const store={val:{contextSnapshots:[],recommendations:[],modelRuns:[]}}
 let saves=0
 const repository=new ValRepository({db:{configured:false},tenantId,readStore:()=>store,saveStore:()=>{saves+=1}})
 await assert.rejects(repository.recordRecommendation({tenantId,ownerId,clientId,question:'Pergunta',mode:'FAST',model:'rules',context:{},advice:{},signal:controller.signal}),error=>error===cancelled)
 assert.equal(store.val.recommendations.length,0)
 assert.equal(saves,0)
})

test('abort observado no ponto de COMMIT não transforma escrita durável em resposta de falha',async()=>{
 const controller=new AbortController()
 const committedAtDeadline=Object.assign(new Error('deadline no commit'),{name:'TimeoutError',statusCode:504,code:'val_chat_timeout'})
 const context={client:{id:clientId,name:'Produtor'},profile:{answers:{},evidence:[]},signals:[],learning:{},memories:[],memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments:[],priorRecommendations:[]}
 context.contextSnapshot=buildContextSnapshot(context,{organizationId:tenantId,subjectType:'client',subjectId:clientId,actorId:ownerId,role:'consultant',scope:'own_portfolio',objective:'next_best_action',requestId:'00000000-0000-4000-8000-000000000390',now:new Date('2026-08-29T12:00:00.000Z')})
 const repository={
  getClientContext:async()=>context,
  getAttachments:async()=>[],
  listAttachments:async()=>[],
  recordRecommendation:async()=>{controller.abort(committedAtDeadline);return 'recommendation-committed'}
 }
 const runtimeConfig={openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1_000,openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false,databaseQueryTimeoutMs:3_000}
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{},clock:()=>new Date('2026-08-29T12:00:00.000Z')})

 const result=await engine.answer({tenantId,ownerId,clientId,client:context.client,message:'Qual é a próxima ação?',signal:controller.signal})
 assert.equal(result.recommendationId,'recommendation-committed')
 assert.equal(result.responseMetadata.persistenceCommitted,true)
})
