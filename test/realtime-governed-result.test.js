import test from 'node:test'
import assert from 'node:assert/strict'
import {realtimeGovernedError,realtimeGovernedResult} from '../src/lib/realtime-governed-result.js'

test('spoken producer clarification includes only server candidates and is never completed',()=>{
 const result=realtimeGovernedResult({responseText:'Qual Antônio?',clarification:{reference:'Antônio',question:'Qual Antônio?',options:[{id:'a',name:'Antônio Carlos',municipality:'São Luiz Gonzaga',privateField:'exclude'}]}})
 assert.equal(result.status,'CLARIFICATION_REQUIRED')
 assert.deepEqual(result.clarification.options,[{id:'a',name:'Antônio Carlos',municipality:'São Luiz Gonzaga'}])
 assert.equal(result.contextScope,undefined)
})

test('voice preserves general model provenance and only forwards explicitly verified scope',()=>{
 const payload={advice:{ai_reasoning:{reasoning_id:'response-b',premises:{context_scope:{producer_id:'wrong'}},evidence_to_use:[{source_ref:'model:general',source_type:'model_general_knowledge',epistemic_type:'INFERENCE'}]}}}
 const scope={tenantId:'tenant',ownerId:'owner',conversationId:'thread',producerId:'b',contextEpoch:2,domain:'AGRONOMY'}
 const output=realtimeGovernedResult({payload,verifiedScope:scope,responseText:'Explicação geral; não confirma a indicação vigente.'})
 assert.equal(output.contextScope.producerId,'b')
 assert.equal(output.sources[0].source_type,'model_general_knowledge')
 assert.equal(output.sources[0].epistemic_type,'INFERENCE')
 assert.match(output.result,/não confirma/)
 assert.equal(realtimeGovernedResult({payload,responseText:'resposta'}).contextScope,undefined)
})

test('cancelled or empty voice tool responses cannot masquerade as completed answers',()=>{
 assert.equal(realtimeGovernedResult({cancelled:true,responseText:'old answer'}).status,'CANCELLED')
 assert.equal(realtimeGovernedResult(null).status,'UNAVAILABLE')
 assert.equal(realtimeGovernedResult({blocked:true,responseText:'Falta uma informação.'}).status,'INPUT_REQUIRED')
})

test('voice explains actionable server constraints without exposing internal failures',()=>{
 const missing=realtimeGovernedError({status:422,payload:{code:'val_client_reference_not_found',error:'Não encontrei Antônio na carteira autorizada.'}})
 assert.equal(missing.status,'NOT_FOUND')
 assert.match(missing.result,/Antônio/)
 const source=realtimeGovernedError({status:422,payload:{code:'val_current_source_required',error:'Informe a cultura e o alvo para consultar a bula.'}})
 assert.equal(source.status,'INPUT_REQUIRED')
 assert.match(source.result,/cultura e o alvo/)
 assert.doesNotMatch(realtimeGovernedError({status:503,message:'PRIVATE_PROVIDER_DETAIL',payload:{error:'PRIVATE_PROVIDER_DETAIL'}}).result,/PRIVATE_PROVIDER_DETAIL/)
})
