import assert from 'node:assert/strict'
import test from 'node:test'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {installConversionComposition} from '../server/conversion-bootstrap.js'
import {ValEngine} from '../server/val-engine.js'

const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))
const tenantId='tenant-a'
const ownerId='owner-a'
const clientId='client-a'
const runtimeConfig={openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1_000,openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false}

function context(){
 const value={client:{id:clientId,name:'Produtor A'},profile:{answers:{},evidence:[]},signals:[],learning:{},memories:[],memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments:[],priorRecommendations:[]}
 value.contextSnapshot=buildContextSnapshot(value,{organizationId:tenantId,subjectType:'client',subjectId:clientId,actorId:ownerId,role:'consultant',scope:'own_portfolio',objective:'next_best_action',requestId:'00000000-0000-4000-8000-000000000991',message:'Qual é a próxima ação?',now:new Date('2026-08-29T12:00:00.000Z')})
 return value
}

installConversionComposition()

test('deadline durante leitura de contexto impede persistência tardia no wrapper determinístico',async()=>{
 const controller=new AbortController()
 const timeoutError=Object.assign(new Error('O módulo excedeu o deadline.'),{name:'CoreExecutionError',statusCode:504,code:'core_module_timeout'})
 let contextReads=0
 let writes=0
 const repository={
  getClientContext:async()=>{contextReads+=1;await delay(35);return context()},
  recordRecommendation:async()=>{writes+=1;return 'recommendation-late'}
 }
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{}})
 const pending=engine.answer({tenantId,ownerId,clientId,client:{id:clientId,name:'Produtor A'},message:'Qual é a próxima ação?',signal:controller.signal})
 setTimeout(()=>controller.abort(timeoutError),5)

 await assert.rejects(pending,error=>error===timeoutError)
 await delay(45)
 assert.equal(contextReads,1)
 assert.equal(writes,0)
})

test('signal já cancelado falha antes de ler contexto ou iniciar side effect',async()=>{
 const controller=new AbortController()
 const cancelled=Object.assign(new Error('Cliente encerrou a requisição.'),{name:'AbortError',statusCode:499,code:'val_request_cancelled'})
 controller.abort(cancelled)
 let contextReads=0
 let writes=0
 const repository={
  getClientContext:async()=>{contextReads+=1;return context()},
  recordRecommendation:async()=>{writes+=1;return 'recommendation-impossible'}
 }
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{}})

 await assert.rejects(
  ()=>engine.answer({tenantId,ownerId,clientId,client:{id:clientId,name:'Produtor A'},message:'Qual é a próxima ação?',signal:controller.signal}),
  error=>error===cancelled
 )
 assert.equal(contextReads,0)
 assert.equal(writes,0)
})

test('cancelamento durante persistência determinística é propagado e impede commit cooperativo',async()=>{
 const controller=new AbortController()
 const cancelled=Object.assign(new Error('Cliente encerrou durante a persistência.'),{name:'AbortError',statusCode:499,code:'val_request_cancelled'})
 let writeStartedResolve
 const writeStarted=new Promise(resolve=>{writeStartedResolve=resolve})
 let persistedSignal=null
 let commits=0
 const repository={
  getClientContext:async()=>context(),
  recordRecommendation:async input=>{
   persistedSignal=input.signal
   writeStartedResolve()
   await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}))
   commits+=1
   return 'recommendation-impossible'
  }
 }
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{}})
 const pending=engine.answer({tenantId,ownerId,clientId,client:{id:clientId,name:'Produtor A'},message:'Qual é a próxima ação?',signal:controller.signal})
 await writeStarted
 controller.abort(cancelled)

 await assert.rejects(pending,error=>error===cancelled)
 assert.equal(persistedSignal,controller.signal)
 assert.equal(persistedSignal.aborted,true)
 assert.equal(commits,0)
})
