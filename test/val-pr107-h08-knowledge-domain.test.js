import assert from 'node:assert/strict'
import test from 'node:test'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {createConversationState,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildGeneralNoClientResponse,isGeneralConceptRequest} from '../server/decision-copilot/capability-executor.js'

const message='O que fazer diante da resistência de plantas daninhas?'

test('H08: pergunta canônica mantém domínio agronômico e entrega KI-112 com produtor aberto',async()=>{
 for(const hasClient of [false,true]){
  const scope={tenantId:'uat-tenant',ownerId:'uat-owner',conversationId:'uat-h08',clientId:hasClient?'uat-b':'',client:hasClient?{id:'uat-b',name:'Produtor Sintético B'}:null}
  const intent=routeValIntent({message,hasClient})
  // Mirror server.js: resolve intent, prepare the domain boundary, resolve the
  // capability, then build the general answer using that prepared domain.
  const previous={...createConversationState(scope),current_domain:'PROFILE'}
  const state=prepareConversationTurnState(previous,{message,intent:intent.intent,sessionCommand:intent.session_command,scope})
  const route=routeSystemCapability({message,intentHint:intent.intent,hasClient})
  let modelCalls=0
  const payload=await buildGeneralNoClientResponse({message,route,organizationId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId,contextDomain:state.current_domain,contextEpoch:state.context_epoch,aiModel:'gpt-test',aiClient:{responses:{create:async()=>{modelCalls+=1;throw new Error('KI-112 must answer without a provider')}}}})
  assert.equal(intent.intent,'ASK_AGRONOMIC')
  assert.equal(state.current_domain,'AGRONOMY')
  assert.equal(state.current_client?.id||null,hasClient?'uat-b':null)
  assert.equal(modelCalls,0)
  assert.equal(payload.advice.ai_reasoning.grounding.blocked===true,false)
  assert.equal(payload.advice.ai_reasoning.run.tool_result.context.knowledge_item_id,'KI-112')
  assert.equal(payload.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
  assert.equal(payload.advice.ai_reasoning.run.tool_result.context.client_id,null)
  const reference=payload.advice.ai_reasoning.knowledge_refs.find(item=>item.knowledge_item_id==='KI-112')
  assert.ok(reference)
  assert.deepEqual(reference.source_refs,['SRC-038'])
  assert.equal(reference.library_version,'1.0')
  assert.equal(reference.requires_human_review,true)
  assert.match(payload.advice.answer,/plantas daninhas resistentes/)
  assert.doesNotMatch(payload.advice.answer,/Informe a cultura, o conceito ou a decisão geral/)
 }
})

test('H08: resistência comercial e objeção explícita continuam vinculadas ao produtor',()=>{
 for(const question of [
  'Como lidar com a resistência dele?',
  'O produtor tem objeção ao preço do herbicida.',
  'Como lidar com a resistência do produtor à mudança de manejo de plantas daninhas?',
  'Como tratar a objeção dele à recomendação para resistência de plantas daninhas?',
  'Como superar a resistência do produtor ao manejo de resistência de plantas daninhas?',
  'Como lidar com a resistência dele à mudança e com a resistência de plantas daninhas?'
 ]){
  const route=routeValIntent({message:question,hasClient:true})
  assert.equal(route.intent,'OBJECTION_HELP',question)
  assert.equal(route.client_context_required,true,question)
 }
})

test('H08: contexto de talhão e dose continuam exigindo escopo ou fonte',()=>{
 const scoped='O que fazer diante da resistência de plantas daninhas no talhão dele?'
 assert.equal(isGeneralConceptRequest(scoped),false)
 assert.equal(routeValIntent({message:scoped,hasClient:true}).client_context_required,true)
 for(const question of ['Qual a dose de herbicida para plantas daninhas resistentes?','Qual a bula do produto para resistência de plantas daninhas?'])assert.equal(routeValIntent({message:question,hasClient:true}).intent,'CHECK_LABEL',question)
})
