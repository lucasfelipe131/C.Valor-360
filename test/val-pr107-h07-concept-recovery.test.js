import assert from 'node:assert/strict'
import test from 'node:test'
import {buildGeneralNoClientResponse,regulatedClaimStub} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {generateGeneralModelAnswer,namedProductMentions,requiresVerifiedGeneralSource,safeGeneralModelAnswer} from '../server/knowledge/general-answer-provider.js'

const question='O que é um inseticida sistêmico?'
const concept='Um inseticida sistêmico é absorvido pela planta e transportado em seus tecidos. Ele atua sobre insetos que se alimentam dos tecidos tratados.'
const respond=async(answer,{hasClient=true}={})=>{
 const calls=[]
 const route=routeSystemCapability({message:question,hasClient})
 const payload=await buildGeneralNoClientResponse({message:question,route,organizationId:'uat-tenant',ownerId:'uat-owner',conversationId:'uat-h07',contextEpoch:2,aiClient:{responses:{create:async request=>{calls.push(request);return {status:'completed',output_text:answer}}}},aiModel:'gpt-test'})
 return {payload,calls,route}
}

test('H07: conceito canônico com pronome agronômico atravessa o caminho geral completo',async()=>{
 // The earlier canonical test called grounding directly. This also exercises
 // the model-output guard that misclassified "Ele" as a registered brand.
 assert.equal(requiresVerifiedGeneralSource(question),false)
 assert.deepEqual(namedProductMentions(concept),[])
 for(const hasClient of [false,true]){
  const {payload,calls,route}=await respond(concept,{hasClient})
  assert.equal(route.intent,'ASK_GENERAL')
  assert.equal(route.client_context_required,false)
  assert.equal(calls.length,1)
  assert.equal(calls[0].input[0].content,question)
  assert.equal(payload.advice.answer,concept)
  assert.notEqual(payload.advice.answer,regulatedClaimStub)
  assert.equal(payload.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
  assert.equal(payload.advice.ai_reasoning.grounding.blocked===true,false)
  assert.equal(payload.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
  assert.equal(payload.advice.ai_reasoning.run.tool_result.context.client_id,null)
 }
})

test('H07: marca e recomendação de dose continuam barradas na saída',async()=>{
 for(const answer of [
  'O Lannate controla a lagarta-do-cartucho no milho.',
  'Um inseticida sistêmico é absorvido pela planta. O Engeo Pleno controla a cigarrinha no milho.',
  'Um inseticida sistêmico é absorvido pela planta. Aplique 2 L/ha para controlar a praga.'
 ]){
  assert.equal(safeGeneralModelAnswer(answer),false,answer)
  const {payload}=await respond(answer)
  assert.notEqual(payload.advice.answer,answer)
 }
})

test('H07: pronome após marca ou afirmação privada não autoriza a saída',async()=>{
 for(const answer of [
  'O Fox Xpro é um fungicida sistêmico. Ele controla a ferrugem asiática da soja.',
  'Um inseticida sistêmico é absorvido pela planta. Ele tem 500 hectares.',
  'Um inseticida sistêmico é absorvido pela planta. Ele é analítico.'
 ]){
  const {payload}=await respond(answer)
  assert.notEqual(payload.advice.answer,answer,answer)
 }
})

test('H07: marca apresentada antes do pronome mantém a alegação de eficácia bloqueada',async()=>{
 for(const answer of [
  'Um inseticida sistêmico é absorvido pela planta. O Engeo Pleno é um exemplo. Ele controla a cigarrinha no milho.',
  'Um inseticida sistêmico é absorvido pela planta. A marca Lannate é desse tipo. Ela controla a lagarta no milho.',
  'Um inseticida sistêmico é absorvido pela planta. Lannate é um inseticida. Ele controla a lagarta no milho.',
  'Um inseticida sistêmico é absorvido pela planta. O Engeo Pleno é um exemplo. Ele é absorvido pela planta. Ele controla a cigarrinha no milho.'
 ]){
  assert.ok(namedProductMentions(answer).length>0,answer)
  assert.equal(safeGeneralModelAnswer(answer),false,answer)
  const {payload}=await respond(answer)
  assert.notEqual(payload.advice.answer,answer,answer)
  assert.equal(payload.advice.answer,regulatedClaimStub)
 }
})

test('H07: antecedente científico ou nova definição genérica não se tornam marca por pronome',()=>{
 for(const answer of [
  'Bacillus thuringiensis é uma bactéria. Ela atua sobre insetos suscetíveis.',
  'Um inseticida sistêmico é absorvido pela planta. Ele atua nos tecidos tratados.',
  'O Lannate é um inseticida. Um inseticida sistêmico se move pelos tecidos da planta. Ele atua sobre insetos que se alimentam desses tecidos.'
 ]){
  assert.deepEqual(namedProductMentions(answer),[],answer)
  assert.equal(safeGeneralModelAnswer(answer),true,answer)
 }
})

test('H07: pedidos de bula, aplicação e dose continuam exigindo fonte sem chamada de modelo',async()=>{
 for(const message of [
  'Qual a carência do Fox Xpro na soja?',
  'Qual dose de inseticida sistêmico devo aplicar?',
  'Posso usar inseticida sistêmico para controlar cigarrinha no milho?',
  'O que é um inseticida sistêmico e qual dose devo aplicar?'
 ]){
  assert.equal(requiresVerifiedGeneralSource(message),true,message)
  const result=await generateGeneralModelAnswer({message,model:'gpt-test',aiClient:{responses:{create:async()=>{throw new Error('A guarda de entrada não pode chamar o modelo')}}}})
  assert.equal(result.regulatedClaim,true,message)
  assert.equal(result.modelCalls,0,message)
 }
})
