import test from 'node:test'
import assert from 'node:assert/strict'
import {runWithRequestContext} from '../server/observability.js'
import {generateGeneralModelAnswer} from '../server/knowledge/general-answer-provider.js'

test('K5 accounting records each provider attempt, usage and failures without private text',async()=>{
 const events=[],message='Explique a fotossíntese.',reply='Plantas utilizam luz para produzir compostos orgânicos.'
 let calls=0
 const aiClient={responses:{create:async(_payload,options)=>{
  calls++;assert.equal(options.maxRetries,0)
  if(calls===2)throw Object.assign(new Error('private provider diagnostic'),{status:500})
  return {status:'completed',output_text:reply,usage:{input_tokens:100,output_tokens:20}}
 }}}
 await runWithRequestContext({method:'POST',path:'/api/val/chat',tenantId:'private-tenant',actorId:'private-user'},async()=>{
  await generateGeneralModelAnswer({message,aiClient,model:'configured-test-model'})
  await generateGeneralModelAnswer({message,aiClient,model:'configured-test-model',reformulate:true})
 },{logger:line=>events.push(JSON.parse(line))})
 assert.equal(events.filter(e=>e.stage==='knowledge.general.provider_call').length,2)
 const usage=events.find(e=>e.stage==='knowledge.general.provider_usage')
 assert.equal(usage.inputTokens,100);assert.equal(usage.outputTokens,20);assert.ok(usage.costUsd>0)
 for(const privateValue of [message,reply,'private-tenant','private-user','private provider diagnostic'])assert.ok(!JSON.stringify(events).includes(privateValue))
})
