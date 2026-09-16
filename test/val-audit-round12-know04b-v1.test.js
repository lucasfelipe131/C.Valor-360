import assert from 'node:assert/strict'
import test from 'node:test'
import {generateGeneralModelAnswer,isGeneralRegulatedConcept,requiresVerifiedGeneralSource} from '../server/knowledge/general-answer-provider.js'
import {buildGeneralNoClientResponse,regulatedClaimStub} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// KNOW-04 (lente de intencao). O portao regulatorio de ENTRADA isentava apenas "dose" e tratava toda
// a demais terminologia regulada como pedido operacional. Medido por HTTP real: 7 de 12 perguntas
// puramente conceituais - "o que e carencia de um defensivo?", "o que e o intervalo de reentrada?" -
// recebiam o texto de pergunta incompleta, com required_inputs ["topic"], culpando o consultor por
// uma pergunta que ele ja tinha formulado por completo. Definir um termo nao e prescrever com ele.
const conceitos=[
 'o que e carencia de um defensivo?',
 'o que significa periodo de carencia?',
 'o que e o intervalo de reentrada?',
 'o que e um produto registrado?',
 'o que e dosagem em agronomia?',
 'o que e uma mistura de tanque?',
 'o que e diagnostico de deficiencia nutricional?',
 'qual a diferenca entre dose e dosagem?',
 'o que e bula de um defensivo?',
 'defina reentrada'
]
const operacionais=[
 'qual a carencia do Fox Xpro na soja?',
 'posso misturar Priori Xtra com Lannate no tanque?',
 'qual a dose de 2,4-D para buva?',
 'o produto Roundup esta registrado para milho?',
 'quantos dias de reentrada depois de aplicar Lannate?',
 'qual a carencia para colher a soja depois da aplicacao?',
 'me recomende um fungicida para ferrugem',
 'qual produto usar para controlar a cigarrinha?',
 'aplique 2 L/ha de glifosato na area?',
 'qual a dosagem de Fox Xpro por hectare?'
]

test('KNOW-04b — definir terminologia regulada deixa de ser tratado como pedido operacional',()=>{
 for(const pergunta of conceitos){
  assert.equal(isGeneralRegulatedConcept(pergunta),true,pergunta)
  assert.equal(requiresVerifiedGeneralSource(pergunta),false,pergunta)
 }
})

test('KNOW-04b — pedido operacional continua barrado na entrada',()=>{
 for(const pergunta of operacionais){
  assert.equal(requiresVerifiedGeneralSource(pergunta),true,`passou e não podia: ${pergunta}`)
  assert.equal(isGeneralRegulatedConcept(pergunta),false,pergunta)
 }
})

test('KNOW-04b — a recusa de entrada viaja com motivo e sem chamar o modelo',async()=>{
 const recusa=await generateGeneralModelAnswer({message:'qual a carencia do Fox Xpro na soja?',aiClient:{responses:{create:async()=>{throw new Error('o modelo não pode ser chamado nesta recusa')}}},model:'gpt-5-mini'})
 assert.equal(recusa.text,'')
 assert.equal(recusa.regulatedClaim,true,'sem motivo a recusa é indistinguível de falta de cobertura')
 assert.equal(recusa.modelCalls,0,'recusa de entrada não pode custar chamada de modelo')
})

test('KNOW-04b — o consultor le o motivo da recusa, nao um pedido para reformular',async()=>{
 const message='qual a carencia do Fox Xpro na soja?'
 const route=routeSystemCapability({message,hasClient:false})
 const payload=await buildGeneralNoClientResponse({message,route,organizationId:'00000000-0000-4000-8000-000000000001',ownerId:'owner-know04b',conversationId:'k4b',contextEpoch:0,now:new Date('2026-08-30T12:00:00.000Z'),aiClient:{responses:{create:async()=>{throw new Error('o modelo não pode ser chamado nesta recusa')}}},aiModel:'gpt-5-mini'})
 const reasoning=payload.advice.ai_reasoning
 assert.equal(reasoning.run.tool_result.summary,regulatedClaimStub)
 assert.doesNotMatch(reasoning.run.tool_result.summary,/Informe a cultura, o conceito ou a decisão geral/)
 // A frase precisa estar na lista byte a byte de noCoverageGuidance; fora dela o grounding a trata
 // como afirmação factual e a troca pela mensagem de bloqueio de integridade.
 assert.equal(reasoning.run.status,'completed',JSON.stringify(reasoning.grounding))
 assert.deepEqual(reasoning.run.tool_result.required_inputs,[],'não há entrada faltando: a pergunta está completa')
})
