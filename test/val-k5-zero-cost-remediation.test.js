import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {classifyValResponse,attachValResponseOutcome} from '../server/val-response-outcome.js'
import {runWithRequestContext,observe} from '../server/observability.js'
import {createK5Executor} from '../scripts/k5/executor.mjs'
import {K5_ACCOUNTS} from '../server/k5-staging-fixtures.js'
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/k5-offline-general.json',import.meta.url)))
const respond=(question,answer)=>buildGeneralNoClientResponse({message:question,route:routeSystemCapability({message:question,hasClient:false}),organizationId:'synthetic',ownerId:'synthetic',aiModel:'offline-mock',aiClient:{responses:{create:async()=>({status:'completed',output_text:answer})}}})
for(const fixture of fixtures)test(`${fixture.id}: authored offline fixture, not original provider output`,async()=>{
 const result=await respond(fixture.question,fixture.answer)
 assert.equal(result.advice.answer,fixture.answer)
 assert.equal(result.responseMetadata.aiGeneralKnowledgeModelCalls,1)
 assert.equal(classifyValResponse(result).response_class,'SUCCESS')
 assert.equal(result.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 assert.equal(result.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
})
test('demonstratives are not names; named/private claims remain blocked',async()=>{
 const f=fixtures.at(-1)
 for(const word of ['Isso','Isto','Aquilo'])assert.equal((await respond(f.question,f.answer.replace('Isso',word))).advice.answer,f.answer.replace('Isso',word))
 for(const extra of ['João possui 500 hectares.','Isso Silva possui 500 hectares.','Ele tem dívida no banco.','Isso é uma hipótese. João possui 500 hectares.']){
  const result=await respond(f.question,`${f.answer} ${extra}`)
  assert.notEqual(classifyValResponse(result).response_class,'SUCCESS')
  assert.doesNotMatch(result.advice.answer,/500|dívida/)
 }
})
test('validated general text and evidence are not truncated at 1200 characters',async()=>{
 const f=fixtures[0],answer=Array(6).fill(f.answer).join(' ')
 assert.ok(answer.length>1200&&answer.length<=2200)
 const result=await respond(f.question,answer)
 assert.equal(result.advice.answer,answer)
 assert.equal(result.advice.ai_reasoning.evidence_to_use[0].statement,answer)
})
test('rejected output stays fallback; no fake missing topic and no private telemetry',async()=>{
 const events=[]
 await runWithRequestContext({method:'POST',path:'/api/val/chat'},async()=>{
  const result=await respond(fixtures[0].question,'DADO_PRIVADO não relacionado com esta pergunta.')
  assert.deepEqual(result.advice.ai_reasoning.run.tool_result.required_inputs,[])
  const classified=attachValResponseOutcome(result,200,observe)
  assert.equal(classified.responseMetadata.outcome.response_class,'GENERIC_FALLBACK')
  assert.equal(classified.responseMetadata.outcome.reason_code,'GENERATED_ANSWER_REJECTED')
 },{logger:line=>events.push(JSON.parse(line))})
 assert.ok(events.some(e=>e.stage==='knowledge.general.validation'&&e.reasonCodes==='TOPIC_MISMATCH'))
 assert.ok(events.some(e=>e.stage==='val.answer.diagnostic'))
 assert.doesNotMatch(JSON.stringify(events),/DADO_PRIVADO|infiltra|synthetic/)
})
test('structured outcomes distinguish failure families',()=>{
 const tool=status=>({advice:{answer:'synthetic',ai_reasoning:{run:{tool_result:{status,required_inputs:['client_id']}}}}})
 assert.equal(classifyValResponse({reason_code:'APPLICATION_RATE_LIMIT'},429).reason_code,'APPLICATION_RATE_LIMIT')
 assert.equal(classifyValResponse({responseMetadata:{aiGeneralKnowledgeUnavailableReason:'PROVIDER_ERROR'}},200).response_class,'PROVIDER_FAILURE')
 assert.equal(classifyValResponse(tool('CONTEXT_REQUIRED')).response_class,'SPECIFIC_CLARIFICATION')
 assert.equal(classifyValResponse(tool('SOURCE_UNAVAILABLE')).response_class,'SOURCE_UNAVAILABLE')
 assert.equal(classifyValResponse({advice:{ai_reasoning:{grounding:{blocked:true}}}}).response_class,'GROUNDING_BLOCKED')
 assert.equal(classifyValResponse({responseMetadata:{generalKnowledge:{aiUnavailableReason:'BUDGET_EXHAUSTED'}}}).reason_code,'AI_BUDGET_EXHAUSTED')
})
function harness({limit=30,windowMs=600_000,authorization=100,unexpected=false,role='consultant'}={}){
 let time=0;const sent=[],records=[],buckets=new Map()
 const executor=createK5Executor({authorizedSubmissions:authorization,now:()=>time,sleep:async ms=>{assert.ok(ms<=60000);time+=ms},
  readSession:async id=>({id,email:K5_ACCOUNTS[id==='A'?0:1],role}),readPolicy:async()=>({limit,windowMs,scope:'identity',policy:'fixed-window'}),checkpoint:async record=>records.push(record),
  submit:async input=>{sent.push({...input,time});let b=buckets.get(input.identity);if(!b||b.reset<=time){b={count:0,reset:time+windowMs};buckets.set(input.identity,b)}b.count++;return {http_status:unexpected||b.count>limit?429:200,reason_code:'APPLICATION_RATE_LIMIT'}}})
 return {executor,sent,records}
}
test('pacing knows effective quota, waits unknown prior window, serializes bursts without own 429',async()=>{
 for(const limit of [30,7]){
  const h=harness({limit})
  const results=await Promise.all(Array.from({length:65},(_,i)=>h.executor.runCase({case_id:`synthetic-${i}`,identity:'A'})))
  assert.ok(results.every(r=>r.http_status===200));assert.ok(h.sent[0].time>=601000)
  for(let i=0;i<h.sent.length;i++)assert.ok(h.sent.filter(x=>x.time>h.sent[i].time-600000&&x.time<=h.sent[i].time).length<=limit)
  assert.equal(h.records[0].status,'RESERVED');assert.equal(h.records[0].policy.limit,limit)
 }
})
test('canonical B stays B; admin and unassigned identity cannot send; no authorization means zero',async()=>{
 const h=harness();await h.executor.runCase({case_id:'synthetic-B',identity:'B'});assert.equal(h.sent[0].identity,'B')
 await assert.rejects(h.executor.runCase({case_id:'missing'}),/IDENTITY_REQUIRED/)
 const admin=harness({role:'admin'});await assert.rejects(admin.executor.runCase({case_id:'admin',identity:'A'}),/CANONICAL_IDENTITY/);assert.equal(admin.sent.length,0)
 const blocked=harness({authorization:0});await assert.rejects(blocked.executor.runCase({case_id:'blocked',identity:'A'}),/AUTHORIZATION/);assert.equal(blocked.sent.length,0)
})
test('unexpected 429 remains FAIL and never automatically retries',async()=>{
 const h=harness({unexpected:true});const result=await h.executor.runCase({case_id:'synthetic-429',identity:'A'})
 assert.equal(result.status,'FAIL');assert.equal(result.reason_code,'APPLICATION_RATE_LIMIT');assert.equal(h.sent.length,1)
})
