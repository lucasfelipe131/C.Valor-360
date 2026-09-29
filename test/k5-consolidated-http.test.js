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

test('HTTP preserves cost dimensions and authorized contact provenance without provider',async()=>{
 const reservation=createServer();const port=await listen(reservation);await close(reservation)
 const directory=await mkdtemp(join(tmpdir(),'val-general-continuity-'))
 const tenantId='00000000-0000-4000-8000-000000000001'
 const ownerId='demo@valor360.local'
 const clients=[{id:'producer-a',name:'Produtor Alfa',servicePreference:'Telefone',source:'synthetic-registration'},{id:'producer-b',name:'Produtor Beta',servicePreference:'Presencial',source:'synthetic-registration'}].map(client=>({...client,tenantId,ownerId,isDemo:true}))
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
  const cost=await turn('O serviço custa R$ 35 por hectare em 40 hectares. Qual o custo total?','','cost')
  assert.match(cost.advice.answer,/1\.400,00/)
  for(const [clientId,channel,other] of [['producer-a','Telefone','Presencial'],['producer-b','Presencial','Telefone']]){
   const r=await turn('Qual canal de contato foi registrado e qual a origem do dado?',clientId,`contact-${clientId}`)
   assert.match(r.advice.answer,new RegExp(channel));assert.match(r.advice.answer,/synthetic-registration/);assert.doesNotMatch(r.advice.answer,new RegExp(other))
  }
  const denied=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Qual o histórico?',clientId:'foreign-producer',conversationId:'denied'})})
  assert.ok([403,404,422].includes(denied.status));assert.doesNotMatch(await denied.text(),/Telefone|Presencial/)
  assert.doesNotMatch(log,/"stage":"knowledge.general.provider_call"/)

 }finally{
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve()
  child.kill('SIGTERM');await exited
  await rm(directory,{recursive:true,force:true})
 }
})
