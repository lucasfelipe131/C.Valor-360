import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {createConversationState,lastCompletedAssistantTurn as lastServerTurn,normalizeConversationState} from '../server/decision-copilot/conversation-state.js'
import {assertValResponseScope,createValResponseScope} from '../server/decision-copilot/response-scope.js'
import {selectScopedPriorRecommendations} from '../server/conversation-thread-context.js'
import {buildContextSnapshot,validateContextSnapshot} from '../server/memory/context-snapshot.js'
import {buildRealtimeValContext} from '../server/realtime-voice/context.js'
import {createRealtimeVoiceService} from '../server/realtime-voice/service.js'
import {validatePreloadedValContext} from '../server/val-engine.js'
import {realtimeVoiceScopeKey} from '../src/hooks/useNaturalRealtimeVoice.js'
import {assertResponseScopeForRequest,lastCompletedAssistantTurn,realtimeTurnMatchesScope,rehomeResolvedProducerQuestion,responseCardActionMatchesScope} from '../src/lib/full-screen-conversation.js'

const invalidEpochs=[null,'0',false,true,0.5,-1,Number.MAX_SAFE_INTEGER+1]
const validEpochs=[0,1,Number.MAX_SAFE_INTEGER]
const tenantId='tenant-a',ownerId='owner-a',producerId='producer-a',conversationId='conversation-a'

const responseScope={contractVersion:'val.response_scope.v1',tenantId,ownerId,producerId,conversationId,contextEpoch:0,domain:'PROFILE'}
const responsePayload={
 responseScope,
 advice:{answer:'Perfil analítico.',ai_reasoning:{reasoning_id:'reasoning-a',organization:{id:tenantId},client:{id:producerId},conversation_id:conversationId,premises:{context_scope:{tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:0,domain:'PROFILE'},session_context:{tenant_id:tenantId,owner_id:ownerId,conversation_id:conversationId,context_epoch:0,current_domain:'PROFILE',current_client:{id:producerId}}},decision_interview:{session_context:{conversation_id:conversationId,context_epoch:0}},recommended_strategy:{reading:'Perfil analítico.'}}}
}
const completedBrowserTurn={role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',responseId:'reasoning-a',payload:responsePayload}

const stateScope={tenantId,ownerId,conversationId,clientId:producerId,client:{id:producerId,name:'Produtor A'}}
const baseState=()=>createConversationState(stateScope)
const scopedServerTurn=epoch=>({role:'assistant',text:'Perfil analítico.',status:'completed',scope_verified:true,server_grounded:true,conversation_id:conversationId,context_epoch:epoch,modality:'text',intent:'ASK_CLIENT',created_at:'2026-08-30T12:00:00.000Z',subject_client_id:producerId,tenant_id:tenantId,owner_id:ownerId})

const snapshotContext=()=>({client:{id:producerId,name:'Produtor A'},memories:[],memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments:[]})
const snapshotInput=epoch=>({organizationId:tenantId,subjectType:'client',subjectId:producerId,actorId:ownerId,role:'consultant',scope:'own_portfolio',objective:'profile_query',message:'qual o perfil dele?',conversationId,contextEpoch:epoch,requestId:'epoch-boundary',now:'2026-08-30T12:00:00.000Z'})
const validSnapshot=epoch=>buildContextSnapshot(snapshotContext(),snapshotInput(epoch))

test('frontend nunca aliases epoch explícito inválido com epoch zero',()=>{
 const active={tenantId,ownerId,producerId,conversationId,contextEpoch:0,domain:'PROFILE'}
 const turn={clientId:producerId,conversationId,contextEpoch:0}
 const zeroKey=realtimeVoiceScopeKey({clientId:producerId,conversationId,contextEpoch:0})
 for(const epoch of invalidEpochs){
  assert.equal(realtimeTurnMatchesScope({...turn,contextEpoch:epoch},turn),false,String(epoch))
  assert.equal(realtimeTurnMatchesScope(turn,{...turn,contextEpoch:epoch}),false,String(epoch))
  assert.equal(responseCardActionMatchesScope(responseScope,{...active,contextEpoch:epoch}),false,String(epoch))
  assert.throws(()=>realtimeVoiceScopeKey({clientId:producerId,conversationId,contextEpoch:epoch}),error=>error.code==='realtime_voice_context_epoch_invalid',String(epoch))
  assert.throws(()=>assertResponseScopeForRequest(responsePayload,{...active,contextEpoch:epoch}),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='contextEpoch'&&error.reason==='invalid',String(epoch))
  assert.throws(()=>lastCompletedAssistantTurn([completedBrowserTurn],{...active,contextEpoch:epoch}),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='contextEpoch',String(epoch))
  assert.throws(()=>rehomeResolvedProducerQuestion({threads:{source:[{role:'user',turnId:'turn-a',text:'perfil'}]},sourceThreadKey:'source',targetThreadKey:'target',turnId:'turn-a',targetScope:{producerId,conversationId,contextEpoch:epoch}}),/producer_thread_transition_invalid/,String(epoch))
 }
 assert.equal(realtimeVoiceScopeKey({clientId:producerId,conversationId}),zeroKey)
 assert.notEqual(realtimeVoiceScopeKey({clientId:producerId,conversationId,contextEpoch:Number.MAX_SAFE_INTEGER}),zeroKey)
})

test('ConversationState rejeita epochs inválidos no estado, alias, turno e follow-up',()=>{
 const initial=baseState()
 for(const epoch of invalidEpochs){
  assert.throws(()=>normalizeConversationState({...initial,context_epoch:epoch}),error=>error.code==='conversation_state_epoch_invalid',`state ${String(epoch)}`)
  assert.throws(()=>normalizeConversationState({...initial,contextEpoch:epoch}),error=>error.code==='conversation_state_epoch_invalid',`alias ${String(epoch)}`)
  assert.throws(()=>normalizeConversationState({...initial,conversation_turns:[scopedServerTurn(epoch)]}),error=>error.code==='conversation_state_epoch_invalid',`turn ${String(epoch)}`)
  assert.throws(()=>lastServerTurn(initial,{...stateScope,contextEpoch:epoch}),error=>error.code==='conversation_state_epoch_invalid',`follow-up ${String(epoch)}`)
 }
 for(const epoch of validEpochs)assert.equal(normalizeConversationState({...initial,context_epoch:epoch}).context_epoch,epoch)
 assert.equal(normalizeConversationState({}).context_epoch,0)
 assert.throws(()=>normalizeConversationState({...initial,context_epoch:0,contextEpoch:1}),error=>error.code==='conversation_state_epoch_invalid')
})

test('ContextSnapshot rejeita input explícito inválido e valida inteiro seguro máximo',()=>{
 for(const epoch of invalidEpochs)assert.throws(()=>buildContextSnapshot(snapshotContext(),snapshotInput(epoch)),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='INVALID_CONTEXT_EPOCH',String(epoch))
 const zero=validSnapshot(0)
 for(const epoch of invalidEpochs){
  const poisoned=structuredClone(zero);poisoned.context_scope.context_epoch=epoch
  assert.ok(validateContextSnapshot(poisoned).includes('context_scope'),String(epoch))
 }
 assert.equal(validSnapshot(Number.MAX_SAFE_INTEGER).context_scope.context_epoch,Number.MAX_SAFE_INTEGER)
 const absentInput=snapshotInput(0);delete absentInput.contextEpoch
 assert.equal(buildContextSnapshot(snapshotContext(),absentInput).context_scope.context_epoch,0)
 const omittedByOptionalPlumbing={...absentInput,contextEpoch:undefined}
 assert.equal(buildContextSnapshot(snapshotContext(),omittedByOptionalPlumbing).context_scope.context_epoch,0)
})

test('schemas limitam estado, turno e snapshot ao maior inteiro seguro',()=>{
 const stateSchema=JSON.parse(readFileSync(new URL('../contracts/v1/conversation-state.schema.json',import.meta.url),'utf8'))
 const snapshotSchema=JSON.parse(readFileSync(new URL('../contracts/v1/context-snapshot.schema.json',import.meta.url),'utf8'))
 assert.equal(stateSchema.properties.context_epoch.maximum,Number.MAX_SAFE_INTEGER)
 assert.equal(stateSchema.$defs.turn.properties.context_epoch.maximum,Number.MAX_SAFE_INTEGER)
 assert.equal(snapshotSchema.properties.context_scope.properties.context_epoch.maximum,Number.MAX_SAFE_INTEGER)
})

test('response scope exige epoch seguro nas três declarações e na criação',()=>{
 const scope=responseScope
 for(const epoch of invalidEpochs){
  for(const path of ['context','session','interview']){
   const poisoned=structuredClone(responsePayload)
   if(path==='context')poisoned.advice.ai_reasoning.premises.context_scope.context_epoch=epoch
   if(path==='session')poisoned.advice.ai_reasoning.premises.session_context.context_epoch=epoch
   if(path==='interview')poisoned.advice.ai_reasoning.decision_interview.session_context.context_epoch=epoch
   assert.throws(()=>assertValResponseScope(poisoned,scope),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.scopeField==='contextEpoch',`${path} ${String(epoch)}`)
  }
  assert.throws(()=>createValResponseScope({...baseState(),context_epoch:epoch}),error=>['conversation_state_epoch_invalid','CONTEXT_SCOPE_VIOLATION'].includes(error.code),String(epoch))
 }
 const maxScope=createValResponseScope(normalizeConversationState({...baseState(),context_epoch:Number.MAX_SAFE_INTEGER}))
 assert.equal(maxScope.contextEpoch,Number.MAX_SAFE_INTEGER)
})

test('realtime backend rejeita browser, estado e snapshot inválidos antes de efeitos externos',async()=>{
 const identity={id:ownerId,tenantId,role:'admin',email:'owner@example.test'}
 const runtimeConfig={realtimeVoiceEnabled:true,realtimeVoiceTesters:[ownerId],realtimeVoiceBudgetUsd:25,realtimeVoiceReservationUsd:1,realtimeVoiceMaxSessionSeconds:600,realtimeVoiceVadEagerness:'low'}
 for(const epoch of invalidEpochs){
  let repositoryCalls=0,reservations=0,providerCalls=0
  const service=createRealtimeVoiceService({runtimeConfig,client:{realtime:{clientSecrets:{create:async()=>{providerCalls++;return {value:'secret',expires_at:1,session:{id:'provider'}}}}}},repository:{getClientContext:async()=>{repositoryCalls++;return {client:{id:producerId},contextSnapshot:validSnapshot(0)}}},conversationSessions:{ensure:()=>baseState()},costStore:{reserve:async()=>{reservations++;return {reserved:true}},record:async()=>({}),snapshot:async()=>({})}})
  await assert.rejects(()=>service.createSession({identity,input:{clientId:producerId,conversationId,contextEpoch:epoch}}),error=>error.code==='realtime_voice_context_epoch_mismatch',String(epoch))
  assert.deepEqual([repositoryCalls,reservations,providerCalls],[0,0,0],String(epoch))
 }
 for(const epoch of invalidEpochs)assert.throws(()=>buildRealtimeValContext({context:{client:{id:producerId}},conversationState:{...baseState(),context_epoch:epoch}}),error=>error.code==='realtime_voice_context_epoch_invalid',String(epoch))
 for(const epoch of invalidEpochs){
  const snapshot=validSnapshot(0);snapshot.context_scope.context_epoch=epoch
  assert.throws(()=>buildRealtimeValContext({context:{client:{id:producerId},contextSnapshot:snapshot},conversationState:baseState()}),error=>error.code==='realtime_voice_context_epoch_invalid',String(epoch))
 }
})

test('preload, prior turn e capability falham fechados para epoch inválido',async()=>{
 const snapshot=validSnapshot(0)
 const state=baseState()
 const preloaded={scope:{tenantId,ownerId,clientId:producerId,conversationId,contextEpoch:0,contextDomain:'PROFILE'},context:{client:{id:producerId},contextSnapshot:snapshot,conversationState:state}}
 for(const epoch of invalidEpochs){
  const poisoned=structuredClone(preloaded);poisoned.scope.contextEpoch=epoch
  assert.throws(()=>validatePreloadedValContext(poisoned,{tenantId,ownerId,clientId:producerId,conversationId,contextEpoch:0,contextDomain:'PROFILE',message:'qual o perfil dele?',conversationState:state}),error=>error.code==='val_preloaded_context_scope_mismatch',String(epoch))

  const prior={user_question:'Resume.',tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:epoch,domain:'COMMERCIAL'}
  assert.deepEqual(selectScopedPriorRecommendations({contextSnapshot:{context_scope:{tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:0,domain:'COMMERCIAL'},subject:{type:'client',id:producerId}},conversationState:{tenant_id:tenantId,owner_id:ownerId,conversation_id:conversationId,context_epoch:0,current_domain:'COMMERCIAL',current_client:{id:producerId}},client:{id:producerId},priorRecommendations:[prior]},'Resume.'),[],String(epoch))

  await assert.rejects(()=>executeCapabilityPlan({route:{path:'FAST',capabilities:[]},message:'perfil',context:{client:{id:producerId},contextSnapshot:snapshot,conversationState:state},clientId:producerId,tenantId,ownerId,conversationId,contextEpoch:epoch}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='INVALID_CONTEXT_EPOCH',String(epoch))
 }
})
