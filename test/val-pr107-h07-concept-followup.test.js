import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {advanceConversationState,createConversationState,prepareConversationTurnState,switchConversationClient} from '../server/decision-copilot/conversation-state.js'
import {resolveGeneralConversationQuestion} from '../server/decision-copilot/general-question-context.js'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const question='O que é um inseticida sistêmico?'
const followup='E como ele se movimenta na planta?'
const conceptAnswer='Um inseticida sistêmico é absorvido pela planta. Ele é transportado nos tecidos da cultura.'
const movementAnswer='O inseticida sistêmico é absorvido pela planta e pode ser transportado pelos tecidos vasculares. O movimento depende das propriedades da substância; o xilema acompanha o fluxo de água das raízes para as partes aéreas.'
const boundary={tenantId:'uat-tenant',ownerId:'uat-owner',conversationId:'uat-h07-followup',clientId:'producer-b',client:{id:'producer-b',name:'Produtor B'}}
const definedState=()=>{
 const prepared=prepareConversationTurnState(createConversationState(boundary),{scope:boundary,message:question,intent:'ASK_GENERAL'})
 return advanceConversationState(prepared,{scope:boundary,message:question,intent:'ASK_GENERAL',turnPrepared:true,response:{advice:{answer:conceptAnswer,ai_reasoning:{intent:'ASK_GENERAL',recommended_strategy:{reading:conceptAnswer}}}}})
}

test('H07 follow-up resolves the explicit concept in the accepted scoped conversation',async()=>{
 const state=definedState()
 const result=resolveGeneralConversationQuestion({message:followup,conversationState:state,...boundary})
 assert.equal(result.continued,true)
 assert.equal(result.conceptContinuation,true)
 assert.equal(result.message,'E como o inseticida sistêmico se movimenta na planta?')
 assert.equal(state.current_client.id,'producer-b')
 const calls=[]
 const response=await buildGeneralNoClientResponse({message:result.message,route:routeSystemCapability({message:result.message,hasClient:true}),organizationId:boundary.tenantId,ownerId:boundary.ownerId,conversationId:boundary.conversationId,contextDomain:state.current_domain,contextEpoch:state.context_epoch,aiModel:'gpt-test',aiClient:{responses:{create:async request=>{calls.push(request);return {status:'completed',output_text:movementAnswer}}}}})
 assert.equal(response.advice.answer,movementAnswer)
 assert.equal(response.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 assert.equal(response.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
 assert.equal(calls.length,1)
 assert.equal(calls[0].input[0].content,result.message)
})

test('H07 concept antecedent cannot cross scope or replace a private or ambiguous reference',()=>{
 const state=definedState()
 for(const change of [{tenantId:'other'},{ownerId:'other'},{conversationId:'other'},{clientId:'producer-a'}])assert.equal(resolveGeneralConversationQuestion({message:followup,conversationState:state,...boundary,...change}).continued,false)
 const stale={...state,context_epoch:state.context_epoch+1}
 assert.equal(resolveGeneralConversationQuestion({message:followup,conversationState:stale,...boundary}).continued,false)
 const untrusted={...state,conversation_turns:state.conversation_turns.map(turn=>({...turn,scope_verified:false}))}
 assert.equal(resolveGeneralConversationQuestion({message:followup,conversationState:untrusted,...boundary}).continued,false)
 const switched=switchConversationClient(state,{id:'producer-a'},{...boundary,clientId:'producer-a'})
 assert.equal(resolveGeneralConversationQuestion({message:followup,conversationState:switched,...boundary,clientId:'producer-a'}).continued,false)
 for(const message of ['Qual é o hobby dele?','E qual a dose dele na planta?','E como ele se movimenta no talhão do produtor?','E como ela se movimenta na planta?','E como ele decide?'])assert.equal(resolveGeneralConversationQuestion({message,conversationState:state,...boundary}).continued,false,message)
 const privateState=advanceConversationState(state,{scope:boundary,message:'Qual é o perfil do produtor B?'})
 assert.equal(resolveGeneralConversationQuestion({message:followup,conversationState:privateState,...boundary}).continued,false)
 const brandState=advanceConversationState(state,{scope:boundary,message:'O que é o inseticida Engeo Pleno?'})
 assert.equal(resolveGeneralConversationQuestion({message:followup,conversationState:brandState,...boundary}).continued,false)
})

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)))
const close=server=>new Promise(resolve=>server.close(resolve))

test('H07 HTTP: definition then canonical pronoun follow-up stays general with producer B selected',async()=>{
 const reservation=createServer();const port=await listen(reservation);await close(reservation)
 const directory=await mkdtemp(join(tmpdir(),'val-h07-concept-followup-'))
 const tenantId='00000000-0000-4000-8000-000000000001'
 const ownerId='demo@valor360.local'
 const clients=['a','b'].map(id=>({id:`producer-${id}`,name:`Produtor ${id.toUpperCase()}`,tenantId,ownerId,isDemo:true}))
 await writeFile(join(directory,'valor360-store.json'),JSON.stringify({surveys:[],imports:[{id:'synthetic-import',tenantId,ownerId,clients}],val:{conversations:[],recommendations:[],feedback:[]}}))
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:directory,VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'60',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let log='';child.stdout.on('data',chunk=>{log+=chunk});child.stderr.on('data',chunk=>{log+=chunk})
 const turn=async message=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId:'producer-b',client:clients[1],conversationId:'h07-http',intent:'ASK_CLIENT'})})
  const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload
 }
 try{
  let ready=false
  for(let attempt=0;attempt<100;attempt++){
   ready=log.includes('VALOR 360 disponível na porta');if(ready)break
   if(child.exitCode!==null)assert.fail(log)
   await delay(50)
  }
  assert.ok(ready,log)
  const first=await turn(question)
  assert.equal(first.advice.ai_reasoning.client.name,'Conversa geral')
  const second=await turn(followup)
  assert.equal(second.responseMetadata.questionContinued,true)
  assert.equal(second.advice.ai_reasoning.objective,'E como o inseticida sistêmico se movimenta na planta?')
  assert.equal(second.advice.ai_reasoning.client.name,'Conversa geral')
  // The HTTP fixture has no provider; it verifies the real routing/state path.
  // The preceding test verifies model delivery through the official builder.
  assert.equal(second.advice.ai_reasoning.run.tool_result.status,'NO_DATA')
  assert.equal(second.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
  assert.equal(second.responseScope.producerId,'producer-b')
  assert.equal(second.responseScope.domain,'AGRONOMY')
  assert.equal(second.conversationState.current_client.id,'producer-b')
  assert.equal(second.conversationState.context_epoch,first.conversationState.context_epoch)
  assert.equal(second.conversationState.conversation_turns.filter(turn=>turn.role==='user').at(-1).text,followup)
 }finally{
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve()
  child.kill('SIGTERM');await exited
  await rm(directory,{recursive:true,force:true})
 }
})
