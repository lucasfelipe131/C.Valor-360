import test from 'node:test'
import assert from 'node:assert/strict'
import {generalSourceRequirement,generateGeneralModelAnswer,requiresVerifiedGeneralSource} from '../server/knowledge/general-answer-provider.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildGeneralNoClientResponse,buildCapabilityExecutionResponse,executeCapabilityPlan,regulatedClaimStub,currentDataSourceStub,financialSourceStub} from '../server/decision-copilot/capability-executor.js'
import {suppliedDimensionalArithmetic} from '../server/dimensional-arithmetic.js'
import {settleCancelledConversationTurn,isBehavioralProfileResponse} from '../src/lib/full-screen-conversation.js'

const noProvider={responses:{create:async()=>{throw Error('Source-gated requests must not call the provider')}}}
test('source requirements preserve the kind of missing evidence through the answer',async()=>{
 for(const [message,kind,stub] of [
  ['Qual é a taxa do euro hoje?','CURRENT_DATA',currentDataSourceStub],
  ['O empréstimo foi aprovado?','FINANCIAL',financialSourceStub],
  ['Qual dose de fungicida posso usar?','REGULATORY',regulatedClaimStub]
 ]){
  assert.equal(generalSourceRequirement(message),kind)
  const result=await generateGeneralModelAnswer({message,aiClient:noProvider,model:'test'})
  assert.equal(result.modelCalls,0)
  assert.equal(result.regulatedClaim,kind==='REGULATORY')
  const payload=await buildGeneralNoClientResponse({message,route:{intent:'ASK_GENERAL',path:'GENERAL',capabilities:['KNOWLEDGE_LIBRARY']},organizationId:'test',ownerId:'owner',aiClient:noProvider,aiModel:'test'})
  if(kind==='REGULATORY')assert.match(payload.advice.answer,/fonte oficial|bula/i)
  else assert.equal(payload.advice.answer,stub)
 }
})

test('economic explanations and method questions do not execute a live-data or diagnostic tool',()=>{
 for(const message of ['Explique como o câmbio influencia a cotação regional, sem fornecer números.','Como relacionar frete e armazenagem ao preço de venda?','Quais cuidados tomar ao interpretar uma análise de solo?','O que posso calcular sem transformar hipótese em recomendação?','Não tenho preço atual. O que posso calcular com entradas incompletas?','Há incerteza no laudo; como apresentar os limites da análise de solo?' ]){
  const route=routeSystemCapability({message,hasClient:true})
  assert.equal(route.intent,'ASK_GENERAL',message)
  assert.equal(route.client_context_required,false,message)
  assert.equal(requiresVerifiedGeneralSource(message),false,message)
 }
 for(const message of ['Traga o preço do trigo agora.','Explique câmbio e informe a cotação do milho hoje.','Explique a diferença entre câmbio e frete e traga o preço do trigo atual.'])assert.equal(routeSystemCapability({message}).intent,'ASK_COMMODITY',message)
 assert.equal(requiresVerifiedGeneralSource('Traga a previsão do tempo atual. Como interpretar uma foto?'),true)
 assert.equal(requiresVerifiedGeneralSource('Pode explicar câmbio e indicar a dose de herbicida?'),true)
 assert.equal(routeSystemCapability({message:'Qual a cotação do euro hoje?'}).intent,'ASK_GENERAL')
 assert.equal(routeSystemCapability({message:'Interprete este laudo de solo.',hasClient:true}).intent,'ANALYZE_SOIL')
})

const arithmetic=[
 ['Qual a receita estimada de 130 sacas a R$ 93 por saca?','revenue_brl',12090],
 ['Receita de R$ 75.000 e custo de R$ 51.000 deixam qual resultado e margem?','result_brl',24000],
 ['Investimento de R$ 2.500 gera benefício incremental de R$ 3.100. Qual o retorno líquido?','roi_percent',24],
 ['O preço passou de R$ 80 para R$ 76, qual a variação percentual?','change_percent',-5],
 ['Converta R$ 1.800 por tonelada em preço por saca de 50 kg.','price_brl_bag',90],
 ['Calcule a área retangular de 80 metros por 125 metros em hectares.','area_ha',1],
 ['450 kg em 15 hectares dão qual quantidade por hectare, sem prescrever uma dose?','quantity_kg_ha',30],
 ['Com custo de R$ 4.500 por hectare e preço de R$ 90 por saca, qual a produtividade de equilíbrio?','yield_sc_ha',50],
 ['Um serviço custa R$ 18/ha e o ganho hipotético é 0,4 sc/ha a R$ 95/sc. Qual o resultado incremental por hectare?','result_brl_ha',20],
 ['O custo aumenta 20% a partir de R$ 3.000/ha e a produtividade cai de 50 para 45 sc/ha. Qual o novo equilíbrio?','break_even_brl_sc',80],
 ['Receita de R$ 90.000, custo variável de R$ 50.000 e custo fixo de R$ 15.000 deixam qual margem de contribuição?','result_brl',25000]
]
test('supplied arithmetic is routed, computed and delivered through unchanged grounding',async()=>{
 for(const [message,key,expected] of arithmetic){
  const result=suppliedDimensionalArithmetic(message)
  assert.ok(result,message)
  assert.ok(Math.abs(result.output[key]-expected)<1e-8,message)
  const route=routeSystemCapability({message,hasClient:false})
  assert.equal(route.intent,'CALCULATE',message)
  const execution=await executeCapabilityPlan({route,message,context:{},tenantId:'test',ownerId:'owner'})
  const payload=buildCapabilityExecutionResponse({execution,route,message,organizationId:'test',ownerId:'owner'})
  assert.equal(payload.advice.answer,result.summary,message+JSON.stringify(payload.advice.ai_reasoning.grounding))
  assert.equal(payload.advice.ai_reasoning.grounding.passed,true,message)
 }
})

test('missing inputs, multiple operands and prescription remain distinct from computed answers',async()=>{
 const missing=suppliedDimensionalArithmetic('Qual o preço de equilíbrio com custo de R$ 2.900/ha?')
 assert.equal(missing.status,'INPUT_REQUIRED')
 assert.deepEqual(missing.required_inputs,['yield_sc_ha'])
 const message='Qual o preço de equilíbrio com custo de R$ 2.900/ha?',route=routeSystemCapability({message})
 const execution=await executeCapabilityPlan({route,message,context:{},tenantId:'test',ownerId:'owner'})
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'test',ownerId:'owner'})
 assert.equal(response.advice.answer,missing.summary)
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 for(const message of ['Qual a receita de -30 sacas a R$ 20 por saca?','Qual dose aplicar em 15 hectares com 450 kg?','Prescreva 450 kg em 15 hectares e informe a quantidade por hectare.','Qual a receita de 30 sacas com preço atual do trigo hoje?','Qual a receita estimada de 130 sacas a R$ 93 por saca ou R$ 98 por saca?'])assert.equal(suppliedDimensionalArithmetic(message),null,message)
})

test('cancelled pending turn is settled once in its own thread and never becomes a grounded reply',()=>{
 const a=[{role:'user',turnId:'a1',text:'A'}],b=[{role:'user',turnId:'b1',text:'B'}]
 const threads={A:a,B:b}
 const settled=settleCancelledConversationTurn(threads,{threadKey:'B',turnId:'b1',at:'2026-10-01T12:00:00Z'})
 assert.equal(settled.A,a)
 assert.equal(settled.B[0].status,'cancelled')
 assert.equal(settled.B[1].role,'system')
 assert.equal(settled.B[1].followUpEligible,false)
 assert.equal(settled.B[1].serverGrounded,undefined)
 assert.equal(threads.B.length,1)
 assert.equal(settleCancelledConversationTurn(settled,{threadKey:'B',turnId:'b1'}),settled)
 const completed={B:[...b,{role:'assistant',status:'completed',turnId:'b1'}]}
 assert.equal(settleCancelledConversationTurn(completed,{threadKey:'B',turnId:'b1'}),completed)
 assert.equal(settleCancelledConversationTurn(threads,{threadKey:'A',turnId:'b1'}),threads)
})

test('general behavioral explanations keep their answer instead of claiming a personal profile',()=>{
 assert.equal(isBehavioralProfileResponse({premises:{profile_specific:false,context_scope:{domain:'PROFILE'}}}),false)
 assert.equal(isBehavioralProfileResponse({run:{tool_result:{capability:'AI_GENERAL_KNOWLEDGE'}},premises:{context_scope:{domain:'PROFILE'}}}),false)
 assert.equal(isBehavioralProfileResponse({commercial_context:{data_path:'BEHAVIORAL_PROFILE'},premises:{profile_specific:true,context_scope:{domain:'PROFILE',producer_id:'a'}}}),true)
})
