import test from 'node:test'
import assert from 'node:assert/strict'
import {retrieveLatentKnowledge} from '../server/knowledge/latent-retrieval.js'
import {selectKnowledge} from '../server/knowledge/selection.js'
import {runWithRequestContext} from '../server/observability.js'

test('latent semantic projection retrieves basis without the literal term',()=>{
 const query='diferença entre preço local e cotação futura'
 assert.equal(query.includes('basis'),false)
 const semantic=retrieveLatentKnowledge(query)
 assert.equal(semantic.method,'TFIDF_TRUNCATED_SVD_COSINE_V1')
 assert.equal(semantic.results[0].id,'KI-101')
 const selected=selectKnowledge({query})
 assert.equal(selected.items[0].knowledge_item_id,'KI-101')
 const trace=selected.audit.retrieval
 assert.ok(trace.lexical_result.length)
 assert.ok(trace.semantic_result.length)
 assert.ok(trace.selected_evidence[0].source_refs.length)
 assert.equal(trace.selected_evidence[0].combined_score,trace.selected_evidence[0].lexical_score+5*trace.selected_evidence[0].semantic_score)
})
test('exact query, absent terms and repeatability retain source trace',()=>{
 const options={query:'O que é basis?',now:new Date('2026-09-22T00:00:00Z')}
 assert.deepEqual(selectKnowledge(options),selectKnowledge(options))
 assert.ok(selectKnowledge(options).items.some(i=>i.knowledge_item_id==='KI-101'))
 assert.deepEqual(retrieveLatentKnowledge('zqxv').results,[])
 assert.equal(selectKnowledge({query:'zqxv inexistente'}).status,'NO_APPLICABLE_KNOWLEDGE')
})
test('semantic public index never absorbs producer data across calls',()=>{
 const before=retrieveLatentKnowledge('diferença entre preço local e cotação futura')
 const result=selectKnowledge({query:'O que é basis?',contextSnapshot:{producer:'PRIVATE_UNIQUE_PRODUCER',spouse:'PRIVATE_UNIQUE_SPOUSE'}})
 assert.equal(JSON.stringify(result).includes('PRIVATE_UNIQUE'),false)
 assert.deepEqual(retrieveLatentKnowledge('PRIVATE_UNIQUE_SPOUSE').results,[])
 assert.deepEqual(retrieveLatentKnowledge('diferença entre preço local e cotação futura'),before)
 assert.equal(result.audit.retrieval.private_context_indexed,false)
})
test('runtime retrieval trace uses request scope without query/private text',()=>{
 const logs=[]
 runWithRequestContext({requestId:'12345678-1234-4123-8123-123456789012'},()=>selectKnowledge({query:'O que é basis?',contextSnapshot:{secret:'PRIVATE_DATA'}}),{logger:x=>logs.push(x)})
 const text=logs.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')
 assert.match(text,/knowledge.hybrid.selected/)
 assert.match(text,/TFIDF_TRUNCATED_SVD_COSINE_V1/)
 assert.doesNotMatch(text,/PRIVATE_DATA|O que é basis/)
})

import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
test('explicit library search abstains without paid generation when no evidence exists',async()=>{
 let calls=0
 const result=await buildGeneralNoClientResponse({message:'Buscar na biblioteca: zqxv inexistente',route:{path:'CONTEXT',capabilities:['KNOWLEDGE_LIBRARY']},aiClient:{responses:{create:async()=>{calls++;throw new Error('unexpected paid call')}}},aiModel:'unused'})
 assert.equal(calls,0)
 assert.match(result.advice.answer,/Nenhum trecho aplicável/)
})

import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
test('nominal public comparisons retain knowledge routing with an active producer',async()=>{
 for(const hasClient of [false,true]){
  const message='diferença entre preço local e cotação futura'
  const route=routeSystemCapability({message,hasClient})
  assert.equal(route.intent,'ASK_GENERAL')
  assert.deepEqual(route.capabilities,['KNOWLEDGE_LIBRARY'])
  let calls=0
  const result=await buildGeneralNoClientResponse({message,route,aiClient:{responses:{create:async()=>{calls++;throw Error('unexpected')}}},aiModel:'unused'})
  assert.equal(calls,0)
  assert.match(result.advice.answer,/Basis/)
  assert.equal(result.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
 }
 assert.equal(routeValIntent({message:'Buscar na biblioteca: zqxv inexistente',hasClient:true}).intent,'ASK_GENERAL')
 for(const message of ['diferença entre o saldo dele e a entrega dele','comparação entre a propriedade dele e a fazenda dela'])assert.notEqual(routeValIntent({message,hasClient:true}).intent,'ASK_GENERAL')
 assert.notEqual(routeValIntent({message:'diferença entre Antonio e Maria',hasClient:true,resolvedClientReference:true}).intent,'ASK_GENERAL')
})
