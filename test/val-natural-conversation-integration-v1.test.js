import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {ValCore} from '../server/core/val-core.js'
import {prepareConversationThread} from '../server/conversation-thread-context.js'
import {createConversationState} from '../server/decision-copilot/conversation-state.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')

test('referência curta recebe somente o contexto efêmero da mesma conversa',()=>{
 const conversationState=createConversationState({conversationId:'thread-a',clientId:'client-a',client:{id:'client-a',name:'Antônio Silva'},activeContext:{type:'field',id:'field-a',label:'Talhão Norte'}})
 const prepared=prepareConversationThread({conversationState,priorRecommendations:[]},'Isso muda a conversa com ele?')
 assert.equal(prepared.continued,true)
 assert.match(prepared.message,/Contexto temporário desta conversa/)
 assert.match(prepared.message,/produtor Antônio Silva/)
 assert.match(prepared.message,/talhão Talhão Norte/)
 assert.doesNotMatch(prepared.message,/memória confirmada: produtor/)
})

test('ValCore encaminha ConversationState normalizado à engine existente, sem executor paralelo',async()=>{
 let received
 const engine={answer:async input=>{received=input;return {advice:{answer:'ok'}}}}
 const core=new ValCore({engine,tenantId:'tenant-a',observeFn:()=>true})
 const request=core.createRequest({
  request_id:'10000000-0000-4000-8000-000000000001',organization_id:'tenant-a',
  actor:{id:'owner-a',role:'consultant'},subject:{type:'client',id:'client-a'},objective:'prepare_visit',
  context_refs:[{type:'client',id:'client-a'}],policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:'owner-a'}
 })
 const state=createConversationState({conversationId:'thread-a',clientId:'client-a',client:{id:'client-a',name:'Antônio'}})
 await core.execute(request,{engineInput:{tenantId:'tenant-a',ownerId:'owner-a',clientId:'client-a',client:{id:'client-a'},conversationId:'thread-a',sessionState:state}})
 assert.equal(received.contextRequest.conversationId,'thread-a')
 assert.equal(received.contextRequest.conversationState.contract_version,'val.conversation_state.v1')
 assert.equal(received.contextRequest.conversationState.persistence_mode,'NONE')
})

test('superfícies HTTP e UI conectam resolver, sessão, voz, métricas e confirmação',()=>{
 const server=read('server.js')
 const copilot=read('src/components/GlobalValCopilot.jsx')
 assert.match(server,/createConversationSessionStore/)
 assert.match(server,/resolveAuthorizedClientReference/)
 assert.match(server,/val_client_reference_ambiguous/)
 assert.match(server,/sessionState:requestConversationState/)
 assert.match(server,/reasoningState:turnOnlyClientOverride\?requestConversationState:sessionState/)
 assert.match(server,/activeContext:null\}\n  let sessionState=/)
 assert.match(server,/activeContextRef=validateActiveContext[\s\S]*sessionState=advanceConversationState\(sessionState,\{activeContext:activeContextRef/)
 assert.match(server,/valConversationRequests\.assertCurrent[\s\S]*valConversationSessions\.set\(persistedScope,completedState\)/)
 assert.doesNotMatch(server,/valConversationSessions\.advance\(sessionScope/)
 assert.doesNotMatch(server,/active:activeContextRef\|\|activeContext/)
 assert.match(server,/valConversationLatency\.record/)
 assert.match(server,/normalizePublicAttachmentPatch/)
 assert.match(copilot,/ValRealtimeConversation/)
 assert.match(copilot,/conversation_mode:turnOptions\.conversationMode===true/)
 assert.match(copilot,/input_modality:turnOptions\.inputModality==='voice'/)
 assert.match(copilot,/global-val-clarification/)
 assert.match(copilot,/registrationDraft/)
 assert.match(copilot,/onMetrics=\{recordConversationMetrics\}/)
 assert.match(copilot,/onStart=\{\(\)=>\{if\(!hasValOutputModePreference\(storageScope\)\)setOutputMode\(writeValOutputMode\(storageScope,'audio'\)\)\}\}/)
 assert.match(copilot,/turnOptions:\{\.\.\.turnOptions\},activeThreadKey/)
 assert.match(copilot,/ask\(pending\.prompt,pending\.intent,\{\.\.\.\(pending\.turnOptions\|\|\{\}\),retry:true\}\)/)
 assert.match(copilot,/realtimeClarificationRef\.current=\{resolve,reject,activeThreadKey\}/)
 assert.match(copilot,/setRegistrationAutoOpenKey\(`register-\$\{Date\.now\(\)\}-\$\{activeThreadKey\}`\)/)
 assert.match(copilot,/mode==='ASK'&&<ValRealtimeConversation/)
 assert.match(copilot,/autoOpenKey=\{registrationAutoOpenKey\}/)
})
