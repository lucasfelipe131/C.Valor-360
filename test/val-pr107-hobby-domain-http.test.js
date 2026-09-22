import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {createConversationState,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {registeredFactPresentation,registeredFactQuery} from '../server/registered-fact-query.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const hobbyQuestion='Qual é o hobby dele?'
const scope={tenantId,ownerId,conversationId:'hobby-b',clientId:'producer-b',client:{id:'producer-b',name:'Produtor Beta'}}
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)))
const close=server=>new Promise(resolve=>server.close(resolve))

test('hobby factual muda o domínio antes do lookup e preserva a identidade autorizada',()=>{
 const agronomy=prepareConversationTurnState(createConversationState(scope),{message:'O que fazer diante da resistência de plantas daninhas?',intent:'ASK_AGRONOMIC',scope})
 assert.equal(agronomy.current_domain,'AGRONOMY')
 const next=prepareConversationTurnState(agronomy,{message:hobbyQuestion,intent:'ASK_CLIENT',scope})
 assert.equal(next.current_domain,'GENERAL')
 assert.equal(next.context_epoch,agronomy.context_epoch+1)
 assert.equal(next.current_client.id,'producer-b')
 assert.deepEqual(next.conversation_turns,[])
 // Uma referência ao conteúdo anterior continua no domínio agronômico.
 const continuation=prepareConversationTurnState(agronomy,{message:'Resume.',scope})
 assert.equal(continuation.current_domain,'AGRONOMY')
 assert.equal(continuation.context_epoch,agronomy.context_epoch)
})

test('hobby usa o campo canônico do questionário e mantém o validador de domínio',()=>{
 const client={id:'producer-b',client_id:'producer-b',name:'Produtor Beta',tenant_id:tenantId,owner_id:ownerId,relationship:{hobbies:'Xadrez'},updatedAt:new Date().toISOString()}
 const presentation=registeredFactPresentation({query:registeredFactQuery(hobbyQuestion),client})
 assert.match(presentation.answer,/Hobby registrado de Produtor Beta: Xadrez/)
 const request={facts:{client},presentationOverride:presentation,message:hobbyQuestion,organizationId:tenantId,ownerId,conversationId:scope.conversationId}
 const response=buildFastClientResponse({...request,contextDomain:'GENERAL'})
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 assert.throws(()=>buildFastClientResponse({...request,contextDomain:'AGRONOMY'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='DOMAIN_MISMATCH')
})

test('HTTP B agronomia → A visita → B hobby retorna q36 sem conteúdo de A',async()=>{
 const reservation=createServer();const port=await listen(reservation);await close(reservation)
 const directory=await mkdtemp(join(tmpdir(),'val-hobby-domain-'))
 const scoped=value=>({tenantId,ownerId,...value})
 const clients=[
  scoped({id:'producer-a',name:'Produtor Alfa',updatedAt:new Date().toISOString()}),
  scoped({id:'producer-b',name:'Produtor Beta',relationship:{hobbies:'Xadrez'},updatedAt:new Date().toISOString()}),
 ]
 const store={surveys:[],imports:[scoped({id:'synthetic-import',clients})],visits:[scoped({id:'visit-a',clientId:'producer-a',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:new Date().toISOString(),summary:'ALFA_VISITA_EXCLUSIVA'})],val:{conversations:[],recommendations:[],feedback:[]}}
 await writeFile(join(directory,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:directory,VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'60',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let log='';child.stdout.on('data',chunk=>{log+=chunk});child.stderr.on('data',chunk=>{log+=chunk})
 const turn=async(message,clientId,conversationId)=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:clients.find(item=>item.id===clientId),conversationId,mode:'daily'})})
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
  const agronomy=await turn('O que fazer diante da resistência de plantas daninhas?','producer-b','hobby-b')
  assert.equal(agronomy.responseScope.domain,'AGRONOMY')
  const visit=await turn('Qual foi a última visita dele?','producer-a','hobby-a')
  assert.equal(visit.responseScope.domain,'VISIT')
  const hobby=await turn(hobbyQuestion,'producer-b','hobby-b')
  assert.match(hobby.advice.answer,/Hobby registrado de Produtor Beta: Xadrez/)
  assert.doesNotMatch(hobby.advice.answer,/Alfa|ALFA_VISITA_EXCLUSIVA|daninhas/)
  assert.equal(hobby.advice.ai_reasoning.grounding.passed,true)
  assert.equal(hobby.advice.ai_reasoning.run.model_call_count,0)
  assert.equal(hobby.responseScope.domain,'GENERAL')
  assert.equal(hobby.responseScope.producerId,'producer-b')
  assert.equal(hobby.conversationState.current_client.id,'producer-b')
  assert.equal(hobby.conversationState.context_epoch,agronomy.conversationState.context_epoch+1)
  const absent=await turn(hobbyQuestion,'producer-a','hobby-a')
  assert.match(absent.advice.answer,/Informação ausente: hobby/)
  assert.doesNotMatch(absent.advice.answer,/Xadrez|Beta/)
  assert.equal(absent.responseScope.producerId,'producer-a')
 }finally{
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve()
  child.kill('SIGTERM');await exited
  await rm(directory,{recursive:true,force:true})
 }
})
