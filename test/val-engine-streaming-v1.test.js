import assert from 'node:assert/strict'
import test from 'node:test'
import {ValEngine} from '../server/val-engine.js'
import {buildFallbackAdvice} from '../server/sales-playbook.js'

test('provider usa stream, observa primeiro delta e passa timeout conversacional',async()=>{
 const progress=[];const streamEvents=[]
 let createCalls=0,streamCalls=0,finalResponseCalls=0,providerOptions=null,recordedModelRun=null
 const context={client:{id:'client-stream',name:'Produtor Streaming'},signals:[],learning:{},opportunities:[]}
 const advice=buildFallbackAdvice({...context,message:'Prepare a visita'})
 const repository={
  getClientContext:async()=>structuredClone(context),
  recordRecommendation:async input=>{recordedModelRun=input.modelRun;return '00000000-0000-4000-8000-000000000099'},
 }
 const runtimeConfig={
  openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:4_321,openaiMaxRetries:0,
  modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,
  maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false,
 }
 const engine=new ValEngine({runtimeConfig,repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z')})
 engine.client={responses:{
  create:async()=>{createCalls+=1;throw new Error('responses.create não deveria ser chamado quando stream está disponível.')},
  stream:(_request,options)=>{
   streamCalls+=1;providerOptions=options
   return {
    async *[Symbol.asyncIterator](){
     streamEvents.push('response.created');yield {type:'response.created'}
     streamEvents.push('response.output_text.delta');yield {type:'response.output_text.delta',delta:'{"answer"'}
     streamEvents.push('response.completed');yield {type:'response.completed'}
    },
    async finalResponse(){
     finalResponseCalls+=1
     return {id:'resp-stream',_request_id:'req-stream',status:'completed',usage:{input_tokens:21,output_tokens:34},output_text:JSON.stringify(advice)}
    },
   }
  },
 }}
 const controller=new AbortController()
 const result=await engine.answer({
  tenantId:'tenant-stream',ownerId:'owner-stream',clientId:'client-stream',client:context.client,
  message:'Prepare a visita',signal:controller.signal,onProgress:stage=>progress.push(stage),
 })

 assert.equal(streamCalls,1)
 assert.equal(createCalls,0)
 assert.equal(finalResponseCalls,1)
 assert.ok(streamEvents.includes('response.output_text.delta'))
 assert.deepEqual(progress,['first_token'])
 assert.equal(providerOptions.timeout,4_321)
 assert.equal(providerOptions.maxRetries,0)
 assert.notEqual(providerOptions.signal,controller.signal)
 assert.ok(providerOptions.signal instanceof AbortSignal)
 assert.equal(providerOptions.signal.aborted,false)
 assert.equal(result.engineMode,'openai')
 assert.equal(result.responseMetadata.streaming,true)
 assert.ok(Number.isFinite(result.responseMetadata.firstTokenMs))
 assert.ok(result.responseMetadata.firstTokenMs>=0)
 assert.equal(recordedModelRun.streaming,true)
 assert.equal(recordedModelRun.firstTokenMs,result.responseMetadata.firstTokenMs)
})

test('deadline total rejeita stream pendente mesmo quando o iterador ignora abort e usa fallback apenas no timeout próprio',{timeout:2_500},async()=>{
 let abortCalls=0,recordCalls=0,providerSignal=null,recordedModelRun=null
 const context={client:{id:'client-timeout',name:'Produtor Timeout'},signals:[],learning:{},opportunities:[]}
 const repository={
  getClientContext:async()=>structuredClone(context),
  recordRecommendation:async input=>{recordCalls+=1;recordedModelRun=input.modelRun;return '00000000-0000-4000-8000-000000000100'},
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:1_000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 engine.client={responses:{stream:(_request,options)=>{
  providerSignal=options.signal
  return {
   async *[Symbol.asyncIterator](){
    yield {type:'response.created'}
    await new Promise(()=>{})
   },
   abort(){abortCalls+=1},
   async finalResponse(){throw new Error('finalResponse não deve ser alcançado após timeout.')},
  }
 }}}
 const parent=new AbortController()

 const result=await engine.answer({tenantId:'tenant-timeout',ownerId:'owner-timeout',clientId:'client-timeout',client:context.client,message:'Prepare a visita',signal:parent.signal})

 assert.equal(parent.signal.aborted,false)
 assert.equal(providerSignal.aborted,true)
 assert.equal(providerSignal.reason?.code,'val_model_timeout')
 assert.equal(abortCalls,1)
 assert.equal(recordCalls,1)
 assert.equal(result.engineMode,'fallback')
 assert.equal(result.responseMetadata.errorCode,'val_model_timeout')
 assert.equal(result.responseMetadata.timeoutSource,'model')
 assert.equal(result.responseMetadata.timeoutMs,1_000)
 assert.equal(recordedModelRun.errorCode,'val_model_timeout')
})

test('deadline total rejeita finalResponse pendente mesmo quando o provider ignora abort',{timeout:2_500},async()=>{
 let abortCalls=0,recordCalls=0,finalResponseCalls=0
 const context={client:{id:'client-final-timeout',name:'Produtor Final Timeout'},signals:[],learning:{},opportunities:[]}
 const repository={
  getClientContext:async()=>structuredClone(context),
  recordRecommendation:async()=>{recordCalls+=1;return '00000000-0000-4000-8000-000000000101'},
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:1_000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 engine.client={responses:{stream:()=>({
  async *[Symbol.asyncIterator](){yield {type:'response.completed'}},
  abort(){abortCalls+=1},
  async finalResponse(){finalResponseCalls+=1;return await new Promise(()=>{})},
 })}}

 const startedAt=Date.now()
 const result=await engine.answer({tenantId:'tenant-final-timeout',ownerId:'owner-final-timeout',clientId:'client-final-timeout',client:context.client,message:'Prepare a visita'})

 assert.ok(Date.now()-startedAt<2_000)
 assert.equal(finalResponseCalls,1)
 assert.equal(abortCalls,1)
 assert.equal(recordCalls,1)
 assert.equal(result.engineMode,'fallback')
 assert.equal(result.responseMetadata.errorCode,'val_model_timeout')
})

test('cancelamento pai aborta stream pendente, preserva erro do core e não executa efeitos posteriores',async()=>{
 let streamStartedResolve
 const streamStarted=new Promise(resolve=>{streamStartedResolve=resolve})
 let abortCalls=0,updateCalls=0,finalizerCalls=0,recordCalls=0,providerSignal=null
 const context={client:{id:'client-core-cancel',name:'Produtor Cancelamento'},signals:[],learning:{},opportunities:[]}
 const repository={
  getClientContext:async()=>structuredClone(context),
  updateAttachment:async()=>{updateCalls+=1},
  recordRecommendation:async()=>{recordCalls+=1;return 'should-not-persist'},
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:4_321,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 engine.client={responses:{stream:(_request,options)=>{
  providerSignal=options.signal
  return {
   async *[Symbol.asyncIterator](){
    yield {type:'response.created'}
    streamStartedResolve()
    await new Promise((resolve,reject)=>{
     if(options.signal.aborted)return reject(options.signal.reason)
     options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})
    })
   },
   abort(){abortCalls+=1},
   async finalResponse(){throw new Error('finalResponse não deve ser alcançado após cancelamento.')},
  }
 }}}
 const parent=new AbortController()
 const coreTimeout=Object.assign(new Error('Deadline total do core excedida.'),{name:'CoreExecutionError',statusCode:504,code:'core_module_timeout'})
 const pending=engine.answer({
  tenantId:'tenant-core-cancel',ownerId:'owner-core-cancel',clientId:'client-core-cancel',client:context.client,message:'Prepare a visita',signal:parent.signal,
  finalizeRecommendation:async draft=>{finalizerCalls+=1;return draft},
 })
 await streamStarted
 parent.abort(coreTimeout)

 await assert.rejects(pending,error=>error===coreTimeout)
 assert.equal(providerSignal.aborted,true)
 assert.equal(providerSignal.reason,coreTimeout)
 assert.equal(abortCalls,1)
 assert.equal(updateCalls,0)
 assert.equal(finalizerCalls,0)
 assert.equal(recordCalls,0)
})

test('cancelamento observado ao concluir provider bloqueia interpretação, finalização e persistência',async()=>{
 let abortCalls=0,updateCalls=0,finalizerCalls=0,recordCalls=0
 const context={client:{id:'client-post-provider',name:'Produtor Pós Provider'},signals:[],learning:{},opportunities:[]}
 const attachment={id:'attachment-post-provider',clientId:'client-post-provider',originalName:'campo.png',mimeType:'image/png',sizeBytes:4,status:'stored',analysis:{},createdAt:'2026-08-29T12:00:00.000Z',dataBase64:'dGVzdA=='}
 const advice=buildFallbackAdvice({...context,message:'Analise a foto'})
 const repository={
  getClientContext:async()=>structuredClone(context),
  getAttachments:async()=>[structuredClone(attachment)],
  listAttachments:async()=>[],
  updateAttachment:async()=>{updateCalls+=1;return attachment},
  recordRecommendation:async()=>{recordCalls+=1;return 'should-not-persist'},
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:4_321,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 const parent=new AbortController()
 const coreTimeout=Object.assign(new Error('Deadline do core após provider.'),{name:'CoreExecutionError',statusCode:504,code:'core_module_timeout'})
 engine.client={responses:{stream:()=>({
  async *[Symbol.asyncIterator](){yield {type:'response.completed'}},
  abort(){abortCalls+=1},
  async finalResponse(){parent.abort(coreTimeout);return {id:'resp-post-provider',status:'completed',usage:{},output_text:JSON.stringify(advice)}},
 })}}

 await assert.rejects(engine.answer({
  tenantId:'tenant-post-provider',ownerId:'owner-post-provider',clientId:'client-post-provider',client:context.client,message:'Analise a foto',attachmentIds:[attachment.id],signal:parent.signal,
  finalizeRecommendation:async draft=>{finalizerCalls+=1;return draft},
 }),error=>error===coreTimeout)
 assert.equal(abortCalls,1)
 assert.equal(updateCalls,0)
 assert.equal(finalizerCalls,0)
 assert.equal(recordCalls,0)
})

test('cancelamento durante finalização impede início da persistência',async()=>{
 let finalizerStartedResolve,releaseFinalizer
 const finalizerStarted=new Promise(resolve=>{finalizerStartedResolve=resolve})
 const finalizerGate=new Promise(resolve=>{releaseFinalizer=resolve})
 let recordCalls=0
 const context={client:{id:'client-finalizer-cancel',name:'Produtor Finalizer'},signals:[],learning:{},opportunities:[]}
 const repository={
  getClientContext:async()=>structuredClone(context),
  recordRecommendation:async()=>{recordCalls+=1;return 'should-not-persist'},
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:4_321,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 const parent=new AbortController()
 const pending=engine.answer({
  tenantId:'tenant-finalizer-cancel',ownerId:'owner-finalizer-cancel',clientId:'client-finalizer-cancel',client:context.client,message:'Prepare a visita',signal:parent.signal,
  finalizeRecommendation:async draft=>{finalizerStartedResolve();await finalizerGate;return draft},
 })
 await finalizerStarted
 parent.abort()
 releaseFinalizer()

 await assert.rejects(pending,error=>error?.statusCode===499&&error?.code==='val_request_cancelled')
 assert.equal(recordCalls,0)
})

test('cancelamento durante updateAttachment é propagado à escrita e impede recomendação posterior',async()=>{
 let updateStartedResolve
 const updateStarted=new Promise(resolve=>{updateStartedResolve=resolve})
 let updateSignal=null,recordCalls=0
 const context={client:{id:'client-update-cancel',name:'Produtor Update'},signals:[],learning:{},opportunities:[]}
 const attachment={id:'attachment-update-cancel',clientId:'client-update-cancel',originalName:'campo.png',mimeType:'image/png',sizeBytes:4,status:'stored',analysis:{},createdAt:'2026-08-29T12:00:00.000Z',dataBase64:'dGVzdA=='}
 const advice=buildFallbackAdvice({...context,message:'Analise a foto'})
 const repository={
  getClientContext:async()=>structuredClone(context),
  getAttachments:async()=>[structuredClone(attachment)],
  listAttachments:async()=>[],
  updateAttachment:async input=>{
   updateSignal=input.signal
   updateStartedResolve()
   return await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}))
  },
  recordRecommendation:async()=>{recordCalls+=1;return 'should-not-persist'},
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:4_321,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 engine.client={responses:{stream:()=>({
  async *[Symbol.asyncIterator](){yield {type:'response.completed'}},
  async finalResponse(){return {id:'resp-update-cancel',status:'completed',usage:{},output_text:JSON.stringify(advice)}},
 })}}
 const parent=new AbortController()
 const cancelled=Object.assign(new Error('Cliente encerrou durante atualização.'),{name:'AbortError',statusCode:499,code:'val_request_cancelled'})
 const pending=engine.answer({tenantId:'tenant-update-cancel',ownerId:'owner-update-cancel',clientId:'client-update-cancel',client:context.client,message:'Analise a foto',attachmentIds:[attachment.id],signal:parent.signal})
 await updateStarted
 parent.abort(cancelled)

 await assert.rejects(pending,error=>error===cancelled)
 assert.equal(updateSignal,parent.signal)
 assert.equal(updateSignal.aborted,true)
 assert.equal(recordCalls,0)
})

test('cancelamento durante recordRecommendation é propagado e rejeita sem commit cooperativo',async()=>{
 let recordStartedResolve
 const recordStarted=new Promise(resolve=>{recordStartedResolve=resolve})
 let recordSignal=null,commits=0
 const context={client:{id:'client-record-cancel',name:'Produtor Record'},signals:[],learning:{},opportunities:[]}
 const repository={
  getClientContext:async()=>structuredClone(context),
  recordRecommendation:async input=>{
   recordSignal=input.signal
   recordStartedResolve()
   await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}))
   commits+=1
   return 'should-not-commit'
  },
 }
 const engine=new ValEngine({
  runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:20_000,conversationalModelTimeoutMs:4_321,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},
  repository,logger:{info:()=>{}},clock:()=>new Date('2026-08-29T12:00:00.000Z'),
 })
 const parent=new AbortController()
 const cancelled=Object.assign(new Error('Cliente encerrou durante persistência.'),{name:'AbortError',statusCode:499,code:'val_request_cancelled'})
 const pending=engine.answer({tenantId:'tenant-record-cancel',ownerId:'owner-record-cancel',clientId:'client-record-cancel',client:context.client,message:'Prepare a visita',signal:parent.signal})
 await recordStarted
 parent.abort(cancelled)

 await assert.rejects(pending,error=>error===cancelled)
 assert.equal(recordSignal,parent.signal)
 assert.equal(recordSignal.aborted,true)
 assert.equal(commits,0)
})
