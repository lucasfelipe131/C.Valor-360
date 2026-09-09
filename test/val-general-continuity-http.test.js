import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)))
const close=server=>new Promise(resolve=>server.close(resolve))

test('HTTP keeps the agronomic topic after a crop reply and switches producer context independently',async()=>{
 const reservation=createServer();const port=await listen(reservation);await close(reservation)
 const directory=await mkdtemp(join(tmpdir(),'val-general-continuity-'))
 const tenantId='00000000-0000-4000-8000-000000000001'
 const ownerId='demo@valor360.local'
 const clients=[{id:'producer-a',name:'Produtor Alfa'},{id:'producer-b',name:'Produtor Beta'}].map(client=>({...client,tenantId,ownerId,isDemo:true}))
 await writeFile(join(directory,'valor360-store.json'),JSON.stringify({surveys:[],imports:[{id:'synthetic-import',tenantId,ownerId,clients}],val:{conversations:[],recommendations:[],feedback:[]}}))
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:directory,VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'60',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let log='';child.stdout.on('data',chunk=>{log+=chunk});child.stderr.on('data',chunk=>{log+=chunk})
 const turn=async(message,clientId='',conversationId='general')=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:clients.find(item=>item.id===clientId),conversationId,intent:'ASK_CLIENT'})})
  const payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload));return payload
 }
 try{
  let ready=false
  for(let attempt=0;attempt<100;attempt++){
   ready=log.includes('VALOR 360 disponível na porta')
   if(ready)break
   if(child.exitCode!==null)assert.fail(log)
   await delay(50)
  }
  assert.ok(ready,log)
  const initial=await turn('milho')
  assert.match(initial.advice.answer,/qual é a dúvida/)
  for(const clientId of ['', 'producer-a','producer-b']){
   const conversationId=`agronomy-${clientId||'general'}`
   const urea=await turn('ureia enterrada ou a lanço?',clientId,conversationId)
   assert.equal(urea.advice.ai_reasoning.run.tool_result.context.knowledge_item_id,'KI-123')
   await turn('e aplicação de inseticida para cigarrinha',clientId,conversationId)
   const response=await turn('milho',clientId,conversationId)
   assert.match(response.advice.ai_reasoning.objective,/cigarrinha.*milho/)
   assert.doesNotMatch(response.advice.answer,/canola|Antonio|Antônio/)
   assert.equal(response.responseMetadata.questionContinued,true)
   assert.equal(response.responseScope.producerId,clientId||null)
   assert.equal(response.responseScope.domain,'AGRONOMY')
   assert.equal(response.conversationState.current_client?.id||'',clientId)
   assert.equal(response.conversationState.context_epoch,0)
   // Without an AI provider, preserve the question and admit missing coverage.
   // The provider and shared DB paths are exercised in the cache integration suite.
   assert.equal(response.advice.ai_reasoning.run.tool_result.status,'NO_DATA')
  }
 }finally{
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve()
  child.kill('SIGTERM');await exited
  await rm(directory,{recursive:true,force:true})
 }
})
