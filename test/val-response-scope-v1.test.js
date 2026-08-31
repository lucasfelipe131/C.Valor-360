import assert from 'node:assert/strict'
import test from 'node:test'
import {createConversationState,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {assertValResponseScope,createValResponseScope,valResponseScopeVersion} from '../server/decision-copilot/response-scope.js'

const reasoningState=prepareConversationTurnState(createConversationState({tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a',clientId:'producer-b',client:{id:'producer-b',name:'Produtor B'}}),{message:'qual o perfil dele?',scope:{tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a',clientId:'producer-b',client:{id:'producer-b'}}})

test('responseScope é derivado do estado de raciocínio B, não da thread persistida A',()=>{
 const scope=createValResponseScope(reasoningState)
 assert.deepEqual(scope,{contractVersion:valResponseScopeVersion,tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-b',conversationId:'thread-a',contextEpoch:0,domain:'PROFILE'})
 const persistedA=createConversationState({tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a',clientId:'producer-a',client:{id:'producer-a'}})
 assert.equal(persistedA.current_client.id,'producer-a')
 assert.equal(scope.producerId,'producer-b')
})

test('servidor aceita seis dimensões coincidentes e bloqueia aliases contraditórios',()=>{
 const scope=createValResponseScope(reasoningState)
 const valid={advice:{ai_reasoning:{organization:{id:'tenant-a'},client:{id:'producer-b'},conversation_id:'thread-a',premises:{context_scope:{tenant_id:'tenant-a',owner_id:'owner-a',producer_id:'producer-b',conversation_id:'thread-a',context_epoch:0,domain:'PROFILE'},session_context:{tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:'thread-a',context_epoch:0,current_domain:'PROFILE',current_client:{id:'producer-b'}}},decision_interview:{session_context:{conversation_id:'thread-a',context_epoch:0}}}}}
 assert.equal(assertValResponseScope(valid,scope),scope)
 assert.throws(()=>assertValResponseScope({advice:{}},scope),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.scopeField==='reasoning'&&error.scopeReason==='MISSING_SCOPE_DIMENSION')
 const poisoned={advice:{ai_reasoning:{...valid.advice.ai_reasoning,premises:{...valid.advice.ai_reasoning.premises,context_scope:{...valid.advice.ai_reasoning.premises.context_scope,producer_id:'producer-a'}}}}}
 assert.throws(()=>assertValResponseScope(poisoned,scope),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.scopeField==='producerId'&&error.scopeSource==='reasoning.premises.context_scope.producer_id')

 for(const badEpoch of [null,'',-1,-9,.5,'bogus',false,{},[]]){
  const bad={advice:{ai_reasoning:{...valid.advice.ai_reasoning,premises:{...valid.advice.ai_reasoning.premises,context_scope:{...valid.advice.ai_reasoning.premises.context_scope,context_epoch:badEpoch}}}}}
  assert.throws(()=>assertValResponseScope(bad,scope),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.scopeField==='contextEpoch')
 }
 for(const badDomain of [null,'',[],{},'TOTALLY_UNKNOWN','FACTUAL']){
  const bad={advice:{ai_reasoning:{...valid.advice.ai_reasoning,premises:{...valid.advice.ai_reasoning.premises,context_scope:{...valid.advice.ai_reasoning.premises.context_scope,domain:badDomain}}}}}
  assert.throws(()=>assertValResponseScope(bad,scope),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.scopeField==='domain')
 }

 for(const missing of ['tenant_id','owner_id','producer_id','conversation_id','context_epoch','domain']){
  const contextScope={...valid.advice.ai_reasoning.premises.context_scope};delete contextScope[missing]
  const bad={advice:{ai_reasoning:{...valid.advice.ai_reasoning,premises:{...valid.advice.ai_reasoning.premises,context_scope:contextScope}}}}
  assert.throws(()=>assertValResponseScope(bad,scope),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.scopeReason==='MISSING_SCOPE_DIMENSION')
 }
})
