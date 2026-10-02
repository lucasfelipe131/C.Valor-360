import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {classifyStructuredClientFact,routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const question='Qual foi a última visita concluída deste produtor?'

test('H04: visita concluída com referência demonstrativa usa o histórico direto',()=>{
 for(const message of [question,'Qual foi a última visita realizada deste produtor?','Quando foi a visita concluída mais recente dessa produtora?','Mostre a última visita concluída dele.','A última visita realizada do Rafael.','Qual foi a última visita deste produtor?']){
  assert.equal(classifyStructuredClientFact(message),'LATEST_VISIT',message)
  const route=routeSystemCapability({message,hasClient:true})
  assert.equal(route.path,'FAST',message)
  assert.equal(route.direct,true,message)
  assert.equal(route.data_path,'LATEST_VISIT',message)
  assert.deepEqual(route.capabilities,['VISIT_HISTORY'],message)
  assert.equal(route.materiality.engine_required,false,message)
 }
})

test('H04: perguntas mistas, agendamento e anexos não viram fato de visita concluída',()=>{
 for(const message of ['Qual foi a última visita agendada deste produtor?','Qual foi a última visita concluída deste produtor e como devo abordar a próxima?','Qual foi a última visita concluída deste produtor e qual a compra mais recente?','Como devo conduzir a última visita deste produtor?']){
  assert.equal(classifyStructuredClientFact(message),null,message)
  assert.notEqual(routeSystemCapability({message,hasClient:true}).data_path,'LATEST_VISIT',message)
 }
 assert.notEqual(routeSystemCapability({message:question,hasClient:false}).data_path,'LATEST_VISIT')
 assert.notEqual(routeSystemCapability({message:question,hasClient:true,attachmentTypes:['image/png']}).data_path,'LATEST_VISIT')
})

test('H04 HTTP: retorna Realizada, exclui Agendada e termina sem contexto ou modelo',async()=>{
 const portServer=createServer()
 await new Promise((resolve,reject)=>{portServer.once('error',reject);portServer.listen(0,'127.0.0.1',resolve)})
 const port=portServer.address().port
 await new Promise(resolve=>portServer.close(resolve))
 const dataRoot=await mkdtemp(join(tmpdir(),'val-pr107-h04-'))
 const tenantId='00000000-0000-4000-8000-000000000001'
 const ownerId='demo@valor360.local'
 const scoped=value=>({tenantId,ownerId,...value})
 const daysOffset=days=>{const date=new Date(Date.now()+days*86_400_000);date.setUTCHours(12,0,0,0);return date.toISOString()}
 const completedAt=daysOffset(-14),scheduledAt=daysOffset(6)
 const client=scoped({id:'h04-rafael-fictional',name:'Rafael (FICTÍCIO)'})
 const store={surveys:[],imports:[scoped({id:'h04-fixture',clients:[client]})],visits:[
  scoped({id:'h04-realizada',clientId:client.id,status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:completedAt,summary:'Visita concluída da fixture sintética.'}),
  scoped({id:'h04-agendada',clientId:client.id,status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt,summary:'VISITA_FUTURA_NAO_CONCLUIDA'}),
 ],businessEvents:[],val:{commitments:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe'],
 })
 try{
  await new Promise((resolve,reject)=>{
   let stderr=''
   const timer=setTimeout(()=>reject(new Error(`Local server startup timed out: ${stderr}`)),15_000)
   child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta')){clearTimeout(timer);resolve()}})
   child.stderr.on('data',chunk=>{stderr+=chunk})
   child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local server exited (${code}): ${stderr}`))})
  })
  const started=performance.now()
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({message:question,clientId:client.id,client,conversationId:'h04-fixture-conversation',mode:'daily'}),
  })
  const payload=await response.json()
  const elapsedMs=performance.now()-started
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.equal(payload.responseMetadata.performance.path,'FAST')
  assert.equal(payload.responseMetadata.dataPath,'LATEST_VISIT')
  assert.equal(payload.responseMetadata.performance.latency.MODEL,null)
  assert.equal(payload.responseMetadata.performance.latency.CONTEXT,null)
  assert.equal(payload.responseMetadata.executionBudget.modelCalls,0)
  assert.equal(payload.advice.ai_reasoning.run.model_call_count,0)
  assert.match(payload.advice.answer,/Rafael \(FICTÍCIO\).*Realizada/)
  assert.ok(payload.advice.answer.includes(new Date(completedAt).toLocaleDateString('pt-BR',{timeZone:'UTC'})))
  assert.doesNotMatch(payload.advice.answer,/Agendada|VISITA_FUTURA_NAO_CONCLUIDA|evidência selecionada insuficiente/)
  assert.ok(payload.advice.ai_reasoning.facts_used.some(fact=>fact.id==='h04-realizada'))
  assert.ok(payload.advice.ai_reasoning.facts_used.every(fact=>fact.id!=='h04-agendada'))
  assert.ok(elapsedMs<1_500,`A consulta factual local levou ${elapsedMs.toFixed(1)} ms`)
 }finally{
  if(child.exitCode===null){
   child.kill('SIGTERM')
   await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  }
  await rm(dataRoot,{recursive:true,force:true})
 }
})
