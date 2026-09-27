import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {selectKnowledge,curatedAnswerCoverageDecision} from '../server/knowledge/selection.js'
import {attachValResponseOutcome} from '../server/val-response-outcome.js'
import {runWithRequestContext,observe} from '../server/observability.js'
import {enhanceDecisionLanguage} from '../server/language-enhancer.js'
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/k5-offline-general.json',import.meta.url)))
const historical=JSON.parse(readFileSync(new URL('./fixtures/k5-historical-observations.json',import.meta.url)))
const selected={
 'AG-006':{count:1,id:'KI-137',reason:'SUBJECT_NOT_FULLY_COVERED',rejected:[]},
 'AG-019':{count:4,id:'KI-123',reason:'UNIVERSAL_QUALIFIER_NOT_COVERED',rejected:['KI-102','KI-160','KI-146']},
 'AG-022':{count:2,id:'KI-188',reason:'SUBJECT_NOT_FULLY_COVERED',rejected:['KI-137']},
 'AG-027':{count:6,id:'KI-127',reason:'UNREQUESTED_CROP_IN_STATEMENT',rejected:['KI-147','KI-173','KI-166','KI-135','KI-198']}
}
const noEligible=new Set(['AG-018','AG-024'])
async function response(f,answer,create=null){
 const observation=historical.find(o=>o.id===f.id)
 return buildGeneralNoClientResponse({message:f.question,route:routeSystemCapability({message:f.question,intentHint:observation?.intent||'ASK_GENERAL',hasClient:false}),aiModel:'offline-fixture',aiClient:{responses:{create:create|| (async()=>({status:'completed',output_text:answer,usage:{input_tokens:1,output_tokens:1}}))}}})
}
for(const f of fixtures)test(`${f.id}: historical retrieval/IDs reproduced; two distinct mocked causes must not become a historical attribution`,async()=>{
 const h=historical.find(o=>o.id===f.id)
 const selection=selectKnowledge({query:f.question,modules:['MCTX','MDI','MVV','MIA','MIC'],limit:1,now:new Date(h.started_at)})
 assert.equal(selection.status,h.retrieval_status)
 assert.deepEqual(selection.items.map(i=>i.knowledge_item_id),h.selected_ids)
 const expected=selected[f.id]
 if(expected){
  assert.equal(selection.audit.decision.candidate_count,expected.count)
  assert.deepEqual(selection.audit.decision.rejected_ids,expected.rejected)
  assert.deepEqual(curatedAnswerCoverageDecision(f.question,selection.items[0]),{accepted:false,reason:expected.reason})
 }else{
  assert.equal(selection.audit.decision.candidate_count,0)
  assert.equal(selection.audit.decision.retrieval_reason,noEligible.has(f.id)?'NO_ELIGIBLE_CANDIDATES':'QUESTION_OUTSIDE_CORPUS')
 }
 // Both scenarios retain the same observable old shape: 2 provider completed
 // events followed by identical generic text. They are authored counterexamples,
 // not recovered provider responses or reconstructions of historical token counts.
 const unsafe=await response(f,`${f.answer} Aplique 2 L/ha.`)
 const privateClaim=await response(f,`${f.answer} João possui 500 hectares.`)
 assert.equal(unsafe.advice.answer,privateClaim.advice.answer)
 assert.equal(unsafe.responseMetadata.aiGeneralKnowledgeModelCalls,2)
 assert.equal(privateClaim.responseMetadata.aiGeneralKnowledgeModelCalls,2)
 assert.deepEqual(unsafe.responseMetadata.aiGeneralKnowledgeRejectionReasons,['UNSAFE_GENERAL_ANSWER'])
 assert.deepEqual(privateClaim.responseMetadata.aiGeneralKnowledgeRejectionReasons,['GROUNDING_BLOCKED'])
 for(const r of [unsafe,privateClaim]){
  const trace=r.responseMetadata.decisionTrace
  assert.equal(trace.FALLBACK_ORIGIN,'GENERAL_ANSWER_VALIDATOR')
  assert.equal(trace.LANGUAGE_REJECTION_REASON,'NOT_IN_GENERAL_ANSWER_PATH')
  assert.equal(trace.language_validation_decision,'NOT_IN_GENERAL_ANSWER_PATH')
  assert.equal(trace.provider_attempts.length,2)
  assert.ok(trace.provider_attempts.every(a=>a.reason==='COMPLETED_TEXT'))
  assert.deepEqual(trace.selected_ids,h.selected_ids)
  assert.equal(trace.selected_count,h.selected_ids.length)
  assert.equal(trace.selection_grounding_decision,'NOT_REACHED_COVERAGE_REJECTED')
  assert.equal(r.responseMetadata.generalKnowledge.topicClarification,false)
  assert.equal(r.responseMetadata.generalKnowledge.contextRequired,false)
  if(expected)assert.deepEqual(trace.rejected_ids,[...expected.rejected,expected.id])
 }
 assert.equal(h.historical_root_cause,null,'A mock must not fill an absent historical cause')
})
test('eight reasons and each candidate decision reach correlated logs without content',async()=>{
 const events=[],f=fixtures.find(f=>f.id==='AG-019')
 await runWithRequestContext({method:'POST',path:'/api/val/chat',tenantId:'SECRET_TENANT'},async()=>{
  const r=await response(f,`${f.answer} João possui 500 hectares.`)
  const payload=attachValResponseOutcome(r,200,observe)
  assert.equal(Object.keys(payload.responseMetadata.outcome.decision_reasons).length,8)
 },{logger:line=>events.push(JSON.parse(line))})
 const trace=events.find(e=>e.stage==='val.decision.trace')
 assert.equal(trace.candidateCount,4);assert.equal(trace.selectedCount,1)
 for(const key of ['routeReason','retrievalReason','selectionReason','selectionRejectionReason','groundingReason','languageRejectionReason','providerReason','fallbackOrigin'])assert.ok(trace[key],key)
 assert.equal(events.find(e=>e.stage==='val.selection.item'&&e.mode==='rejected'&&e.source==='KI-123').selectionRejectionReason,'UNIVERSAL_QUALIFIER_NOT_COVERED')
 assert.doesNotMatch(JSON.stringify(events),/João|500 hectares|chuva leve|SECRET_TENANT/)
})
test('a deterministic definition does not acquire artificial retrieval or provider calls',async()=>{
 const r=await response({question:'O que é pH?'},'',async()=>{assert.fail('Provider must not be used')})
 assert.equal(r.responseMetadata.decisionTrace.RETRIEVAL_REASON,'NOT_REQUIRED_BUILTIN_OR_CATALOG')
 assert.equal(r.responseMetadata.decisionTrace.PROVIDER_REASON,'NOT_CALLED')
})
test('provider failure, output length and successful delivery have distinct diagnostic origins',async()=>{
 const f=fixtures[0]
 const failure=await response(f,'',async()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_TEXT'),{status:429})})
 assert.equal(failure.responseMetadata.decisionTrace.PROVIDER_REASON,'PROVIDER_ERROR')
 assert.equal(failure.responseMetadata.decisionTrace.FALLBACK_ORIGIN,'GENERAL_PROVIDER_FAILURE')
 const lengthy=await response(f,'x'.repeat(2201))
 assert.equal(lengthy.responseMetadata.decisionTrace.PROVIDER_REASON,'OUTPUT_LENGTH_LIMIT')
 assert.equal(lengthy.responseMetadata.decisionTrace.FALLBACK_ORIGIN,'GENERAL_PROVIDER_OUTPUT_UNAVAILABLE')
 assert.equal(lengthy.responseMetadata.decisionTrace.provider_attempts.length,2)
 const success=await response(f,f.answer)
 assert.equal(success.responseMetadata.decisionTrace.FALLBACK_ORIGIN,'NONE')
 assert.equal(success.responseMetadata.decisionTrace.general_validation_decision,'ACCEPTED')
})
test('language enhancer exposes the specific safe validator code, not private product or number',async()=>{
 const events=[]
 await runWithRequestContext({method:'POST',path:'/api/val/chat'},async()=>{
  const r=await enhanceDecisionLanguage({message:'Explique',advice:{answer:'Orientação existente'},orchestration:{continuity:{productNames:['PRODUTO_PRIVADO']}},client:{responses:{create:async()=>({status:'completed',output_text:JSON.stringify({answer:'Esta explicação suficientemente longa mantém a orientação existente e prepara uma próxima decisão com informações materiais já conhecidas.',opening:'Uma abertura com contexto suficiente.',headline:'Próxima decisão'})})}}})
  assert.equal(r.advice.language_enhancement.languageRejectionReason,'REQUIRED_PRODUCT_OMITTED')
  assert.equal(r.advice.language_enhancement.failureCode,'invalid_language_output')
 },{logger:line=>events.push(JSON.parse(line))})
 assert.equal(events.find(e=>e.stage==='val.language.decision').languageRejectionReason,'REQUIRED_PRODUCT_OMITTED')
 assert.doesNotMatch(JSON.stringify(events),/PRODUTO_PRIVADO/)
})
