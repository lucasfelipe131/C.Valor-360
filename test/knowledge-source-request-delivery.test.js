import test from 'node:test'
import assert from 'node:assert/strict'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildGeneralNoClientResponse,regulatedClaimStub,sourceRequestRegisteredNote} from '../server/decision-copilot/capability-executor.js'

const tenant='00000000-0000-4000-8000-000000000001'
const owner='00000000-0000-4000-8000-000000000101'
const regulatedQuestion='qual a dose de glifosato por hectare'
const uncoveredQuestion='como funciona a propulsão iônica de uma sonda espacial'
const citation={title:'Ficha do registro',publisher:'MAPA/AGROFIT',url:'https://agrofit.agricultura.gov.br/agrofit_cons/produto',authority:'A',year:2026,accessed_at:'2026-09-22T12:00:00.000Z'}
const approvedAnswer={request_key:'a'.repeat(32),reason:'REGULATED_SOURCE_REQUIRED',citation,excerpt:'A dose registrada para a cultura consultada é de 2,0 a 3,0 litros por hectare.',approved_by:'agronomo@val.test',approved_at:'2026-09-22T13:00:00.000Z'}
const explodingModel={responses:{create:async()=>{throw Object.assign(new Error('provider fora do ar'),{status:500})}}}
const forbiddenModel={responses:{create:async()=>{throw new Error('o modelo não pode ser chamado quando existe fonte aprovada')}}}

function spyStore({approved=null,failRegister=false}={}){
 const registered=[]
 return {registered,register:async input=>{if(failRegister)throw new Error('banco indisponível');registered.push(input);return input},findApprovedAnswer:async()=>approved}
}
const ask=async(message,{sourceRequests=null,aiClient=null,aiUnavailableReason=''}={})=>{
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const response=await buildGeneralNoClientResponse({message,route,organizationId:tenant,ownerId:owner,conversationId:`general:${message}`,sourceRequests,aiClient,aiModel:aiClient?'gpt-test':'',aiUnavailableReason})
 return {response,reasoning:response.advice.ai_reasoning,answer:response.advice.answer}
}

test('assunto regulado deixa de ser beco sem saída: vira pedido de fonte e a tela diz isso',async()=>{
 const store=spyStore()
 const {answer,reasoning}=await ask(regulatedQuestion,{sourceRequests:store})
 assert.equal(store.registered.length,1)
 assert.equal(store.registered[0].reason,'REGULATED_SOURCE_REQUIRED')
 assert.equal(store.registered[0].tenantId,tenant)
 assert.equal(store.registered[0].ownerId,owner)
 assert.equal(store.registered[0].question,regulatedQuestion)
 assert.equal(answer,`${regulatedClaimStub}${sourceRequestRegisteredNote}`)
 assert.equal(reasoning.grounding?.blocked===true,false)
 assert.equal(reasoning.grounding?.question_relevance,'SAFE_NO_COVERAGE')
})

test('falta de cobertura no acervo também entra na fila, com a causa certa',async()=>{
 const store=spyStore()
 const {answer}=await ask(uncoveredQuestion,{sourceRequests:store})
 assert.equal(store.registered.length,1)
 assert.equal(store.registered[0].reason,'LIBRARY_NO_COVERAGE')
 assert.match(answer,/Registrei esta dúvida/)
})

// Provedor fora do ar e teto de orçamento voltam a responder sozinhos. Encher a fila de revisão com
// dúvidas que já têm resposta gastaria o tempo do revisor com trabalho que não existe.
test('indisponibilidade temporária não vira pedido de fonte nem promete revisão',async()=>{
 const providerDown=spyStore()
 const failed=await ask(uncoveredQuestion,{sourceRequests:providerDown,aiClient:explodingModel})
 assert.equal(providerDown.registered.length,0)
 assert.doesNotMatch(failed.answer,/Registrei esta dúvida/)
 assert.match(failed.answer,/indisponível neste momento/)
 const budgetGone=spyStore()
 const exhausted=await ask(uncoveredQuestion,{sourceRequests:budgetGone,aiUnavailableReason:'BUDGET_EXHAUSTED'})
 assert.equal(budgetGone.registered.length,0)
 assert.doesNotMatch(exhausted.answer,/Registrei esta dúvida/)
 assert.match(exhausted.answer,/limite de uso/i)
})

test('sem fila, ou com a gravação falhando, o consultor lê exatamente o que lia antes',async()=>{
 const withoutStore=await ask(regulatedQuestion)
 assert.equal(withoutStore.answer,regulatedClaimStub)
 const broken=await ask(regulatedQuestion,{sourceRequests:spyStore({failRegister:true})})
 assert.equal(broken.answer,regulatedClaimStub)
 assert.equal(broken.reasoning.grounding?.blocked===true,false)
})

// O que o consultor lê é o trecho da fonte, não uma paráfrase do modelo sobre ela.
test('fonte oficial aprovada responde assunto regulado, citando a origem e sem chamar o modelo',async()=>{
 const {answer,reasoning}=await ask(regulatedQuestion,{sourceRequests:spyStore({approved:approvedAnswer}),aiClient:forbiddenModel})
 assert.match(answer,/2,0 a 3,0 litros por hectare/)
 assert.match(answer,/Fonte: Ficha do registro — MAPA\/AGROFIT \(2026\)\./)
 assert.match(answer,/agrofit\.agricultura\.gov\.br/)
 assert.notEqual(answer,regulatedClaimStub)
 assert.equal(reasoning.grounding?.blocked===true,false)
 assert.equal(reasoning.grounding?.question_relevance,'APPROVED_OFFICIAL_SOURCE')
 assert.equal(reasoning.evidence_status,'APPROVED_EXTERNAL_SOURCE')
 assert.equal(reasoning.confidence.level,'FONTE_OFICIAL_APROVADA')
 assert.match(reasoning.confidence.rationale,/agronomo@val\.test/)
 assert.deepEqual(reasoning.knowledge_refs,[citation])
 assert.equal(reasoning.run.tool_result.capability,'APPROVED_SOURCE')
 assert.equal(reasoning.run.tool_result.context.source_request_key,approvedAnswer.request_key)
})

// Nenhuma aprovação autoriza falar de um produtor específico por este caminho: ele não lê dado de
// produtor nenhum, e uma fonte que afirma algo sobre um indivíduo nomeado continua barrada.
test('fonte aprovada não vira porta para afirmação sobre um produtor nomeado',async()=>{
 const poisoned={...approvedAnswer,excerpt:'O produtor Genor Brum Filho aplicou 3,0 litros por hectare na safra passada.'}
 const {answer,reasoning}=await ask(regulatedQuestion,{sourceRequests:spyStore({approved:poisoned})})
 assert.equal(reasoning.grounding?.blocked,true)
 assert.doesNotMatch(answer,/Genor Brum Filho/)
})

test('fonte aprovada sem trecho citado não responde: o link sozinho não sustenta nada',async()=>{
 const store=spyStore({approved:{...approvedAnswer,excerpt:null}})
 const {answer,reasoning}=await ask(regulatedQuestion,{sourceRequests:store})
 // Volta a ser o beco sem saída de sempre: recusa regulada e a dúvida de novo na fila.
 assert.equal(answer,`${regulatedClaimStub}${sourceRequestRegisteredNote}`)
 assert.doesNotMatch(answer,/agrofit/)
 assert.equal(store.registered.length,1)
 assert.notEqual(reasoning.evidence_status,'APPROVED_EXTERNAL_SOURCE')
})
