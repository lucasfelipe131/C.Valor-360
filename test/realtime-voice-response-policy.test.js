import test from 'node:test'
import assert from 'node:assert/strict'
import {createRealtimeVoiceService} from '../server/realtime-voice/service.js'
import {createConversationSessionStore} from '../server/decision-copilot/conversation-session-store.js'
import {createInMemoryRealtimeCostStore} from '../server/realtime-voice/cost-control.js'
import {buildRealtimeValContext} from '../server/realtime-voice/context.js'

const identity={id:'voice-owner',tenantId:'voice-tenant',role:'admin'}

test('voice requests always use a governed tool before speaking, with a bounded generation budget',async()=>{
 for(const [configured,expected] of [[undefined,4096],[512,1024],[2048,2048],[8192,4096],['invalid',4096],[Infinity,4096]]){
  let request
  const costStore=createInMemoryRealtimeCostStore()
  const service=createRealtimeVoiceService({
   runtimeConfig:{realtimeVoiceEnabled:true,realtimeVoiceMaxOutputTokens:configured},
   client:{realtime:{clientSecrets:{create:async body=>{request=body;return {value:'ek_test',expires_at:60}}}}},
   repository:{},conversationSessions:createConversationSessionStore(),costStore
  })
  const session=await service.createSession({identity,input:{conversationId:'voice-conversation'}})
  assert.equal(request.session.max_output_tokens,expected)
  assert.equal(request.session.tool_choice,'required')
  assert.equal(request.session.parallel_tool_calls,false)
  assert.ok(request.session.tools.some(tool=>tool.name==='val_governed_tool'))
  assert.equal(session.budget.limitUsd,25)
  assert.equal(session.context.clientId,null)
  assert.equal((await costStore.snapshot({budgetUsd:25})).totalUsd,1)
 }
})

test('voice resumption requires the latest server-grounded response in the exact scope',()=>{
 const state={tenant_id:'voice-tenant',owner_id:'voice-owner',conversation_id:'thread-b',context_epoch:3,current_domain:'GENERAL',current_client:{id:'b'}}
 const completed={...state,role:'assistant',status:'completed',scope_verified:true,server_grounded:true,subject_client_id:'b',response_id:'answer-b',text:'Resumo confirmado do produtor B.'}
 const context=turns=>buildRealtimeValContext({context:{client:{id:'b'}},conversationState:{...state,conversation_turns:turns}})
 assert.deepEqual(context([completed]).conversation.resume_response,{responseId:'answer-b',context:{clientId:'b',conversationId:'thread-b',contextEpoch:3}})
 for(const later of [{...completed,role:'user'},{...completed,server_grounded:false},{...completed,status:'incomplete'},{...completed,subject_client_id:'a'},{...completed,context_epoch:2},{...completed,owner_id:'other'},{...completed,response_id:null}]){
  assert.equal(context([completed,later]).conversation.resume_response,undefined)
 }
})
