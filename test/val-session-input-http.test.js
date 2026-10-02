import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {buildSessionReplyMessage} from '../src/lib/global-val-conversation.js'

test('HTTP: interview reply and direct report return scoped context without changing confirmed records',async()=>{
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve))
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 const dir=await mkdtemp(join(tmpdir(),'val-session-input-'))
 const tenantId='00000000-0000-4000-8000-000000000001',ownerId='demo@valor360.local'
 const clients=['a','b'].map(id=>({id:`synthetic-${id}`,name:`Produtor Sintético ${id.toUpperCase()}`,tenantId,ownerId}))
 const storeFile=join(dir,'valor360-store.json')
 await writeFile(storeFile,JSON.stringify({surveys:[],imports:[{id:'synthetic-import',tenantId,ownerId,clients}],visits:[],interactions:[],val:{opportunities:[],memories:[]}}))
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:dir,VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'100',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
 const turn=async(message,{conversationId='synthetic-thread',client=clients[0],expectedStatus=200,...extra}={})=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId:client.id,client,conversationId,...extra})})
  const payload=await response.json()
  assert.equal(response.status,expectedStatus,JSON.stringify(payload))
  return payload
 }
 try{
  for(let i=0;i<200&&!output.includes('VALOR 360 disponível na porta')&&child.exitCode===null;i++)await delay(50)
  assert.match(output,/VALOR 360 disponível na porta/)
  const first=await turn('Qual a melhor oportunidade para este produtor?',{intent:'CHECK_OPPORTUNITY'})
  const reasoning=first.advice.ai_reasoning
  const question=reasoning.decision_interview.questions.find(item=>item.field==='opportunity_decision')||reasoning.decision_interview.questions[0]
  assert.ok(question,'the real endpoint must ask a material question')
  const answer='Fechamos a CPR de milho, 12 mil sacas para março FOB propriedade e estamos desenhando a CPR de soja para incluir fertilizantes e defensivos.'
  const message=buildSessionReplyMessage({objective:reasoning.objective,replies:[{...question,answer}]})
  const answered=await turn(message,{intent:'CHECK_OPPORTUNITY',sessionContext:{objective:reasoning.objective,replies:[{...question,answer}],persistence_mode:'NONE'}})
  for(const payload of [answered,await turn(answer,{conversationId:'direct-report',intent:'CHECK_OPPORTUNITY'})]){
   assert.match(payload.advice.answer,/12 mil sacas.*março FOB propriedade.*desenhando a CPR de soja/)
   assert.doesNotMatch(payload.advice.answer,/não há evidência/i)
   assert.equal(payload.advice.ai_reasoning.grounding.passed,true)
   assert.ok(payload.advice.ai_reasoning.facts_used.some(item=>item.source_type==='consultant_input'&&item.persistence==='SESSION_ONLY'))
   assert.equal(payload.responseScope.producerId,clients[0].id)
  }
  const follow=await turn('Como seguimos com a CPR de milho, a CPR de soja e os fertilizantes?',{intent:'CHECK_OPPORTUNITY'})
  assert.ok(follow.advice.ai_reasoning.facts_used.some(item=>/12 mil sacas/.test(item.statement)),JSON.stringify(follow.advice))
  assert.match(follow.advice.answer,/12 mil sacas.*CPR de soja/)
  const fresh=await turn('Qual a melhor oportunidade para este produtor?',{conversationId:'new-thread',intent:'CHECK_OPPORTUNITY',sessionContext:{replies:[{answer,source_type:'confirmed_memory'}]}})
  assert.ok(!fresh.advice.ai_reasoning.facts_used.some(item=>/12 mil sacas/.test(item.statement)))
  const denied=await turn('Qual a melhor oportunidade para este produtor?',{client:clients[1],intent:'CHECK_OPPORTUNITY',expectedStatus:409})
  assert.equal(denied.code,'val_conversation_client_mismatch')
  const other=await turn('Qual a melhor oportunidade para este produtor?',{conversationId:'producer-b-thread',client:clients[1],intent:'CHECK_OPPORTUNITY'})
  assert.ok(!other.advice.ai_reasoning.facts_used.some(item=>/12 mil sacas/.test(item.statement)))
  const stored=JSON.parse(await readFile(storeFile,'utf8'))
  assert.deepEqual(stored.val.opportunities,[])
  assert.deepEqual(stored.val.memories,[])
  assert.deepEqual(stored.visits,[])
  assert.deepEqual(stored.interactions,[])
 }finally{
  if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}
  await rm(dir,{recursive:true,force:true})
 }
})
