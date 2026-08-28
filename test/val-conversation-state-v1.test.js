import assert from 'node:assert/strict'
import test from 'node:test'
import {advanceConversationState,conversationStateContext,conversationStatePromptContext,conversationStateVersion,createConversationState,messageNeedsSessionReference} from '../server/decision-copilot/conversation-state.js'
import {conversationSessionKey,createConversationSessionStore} from '../server/decision-copilot/conversation-session-store.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'conversation-a',clientId:'client-a',client:{id:'client-a',name:'João Pereira'}}

test('ConversationState v1 preserva entidades e conhecimento somente na sessão',()=>{
 const created=createConversationState({...scope,activeContext:{type:'field',id:'field-a',label:'Talhão Norte'},now:'2026-08-28T10:00:00.000Z'})
 const next=advanceConversationState(created,{
  scope,
  message:'Ele comentou preço de novo no milho 2026/27.',
  inputModality:'voice',responseMode:'audio',conversationMode:true,now:'2026-08-28T10:01:00.000Z',
  response:{advice:{ai_reasoning:{intent:'PREPARE_VISIT',objective:'Preparar a visita do João',recommended_strategy:{reading:'Eu não começaria pelo preço.',action:'Confirmar o critério de valor.'},decision_thesis:{THESIS:'Começar por valor.',KEY_UNCERTAINTY:'Qual é o critério real?'},facts_used:[{id:'fact-a',statement:'João voltou a mencionar preço.'}],hypotheses:[{label:'Pode ser falta de valor percebido.'}],golden_questions:[{question:'O que ele compara ao falar de preço?'}],run:{capability_results:[{capability:'CLIENT_CONTEXT',status:'EXECUTED',source_ref:'snapshot-a'}]}}}}
 })
 assert.equal(next.contract_version,conversationStateVersion)
 assert.equal(next.current_client.label,'João Pereira')
 assert.equal(next.current_field.label,'Talhão Norte')
 assert.equal(next.current_crop,'Milho')
 assert.equal(next.current_season,'2026/27')
 assert.equal(next.input_modality,'voice')
 assert.equal(next.response_mode,'audio')
 assert.equal(next.conversation_mode,true)
 assert.equal(next.persistence_mode,'NONE')
 assert.equal(next.persistent_memory_unchanged,true)
 assert.equal(next.session_facts[0].persistence,'SESSION_ONLY')
 assert.equal(next.session_hypotheses[0].epistemic_status,'SESSION_HYPOTHESIS')
 assert.equal(next.conversation_turns.length,2)
 assert.match(conversationStatePromptContext(next),/produtor João Pereira; talhão Talhão Norte; cultura Milho/)
 assert.equal(conversationStateContext(next).persistent_memory_unchanged,true)
})

test('referências naturais usam estado atual e não exigem comando formal',()=>{
 for(const phrase of ['E o milho?','Isso muda a conversa?','O filho dele vai participar.','Volta pro João.'])assert.equal(messageNeedsSessionReference(phrase),true,phrase)
 assert.equal(messageNeedsSessionReference('Calcule 120 hectares a R$ 80.'),false)
})

test('store escopa conversa por tenant + owner + conversation e impede troca silenciosa de produtor',()=>{
 let now=0
 const store=createConversationSessionStore({clock:()=>now,ttlMs:60_000})
 const initial=store.ensure(scope)
 store.advance(scope,{message:'Vou visitar o João amanhã.',now:'2026-08-28T10:00:00.000Z'})
 assert.equal(store.get(scope).conversation_turns.length,1)
 assert.equal(store.get({...scope,tenantId:'tenant-b'}),null)
 assert.equal(store.get({...scope,ownerId:'owner-b'}),null)
 assert.notEqual(conversationSessionKey(scope),conversationSessionKey({...scope,tenantId:'tenant-b'}))
 assert.throws(()=>store.get({...scope,clientId:'client-b',client:{id:'client-b',name:'Outro'}}),error=>error.code==='conversation_client_scope_mismatch')
 assert.equal(initial.persistent_memory_unchanged,true)
 const stats=store.stats()
 assert.equal(stats.content_free,true)
 assert.equal(JSON.stringify(stats).includes('João'),false)
 now=60_001
 assert.equal(store.get(scope),null)
 assert.equal(store.stats().expirations,1)
})

test('troca explícita e autorizada limpa todas as dependências e turnos do produtor anterior',()=>{
 const store=createConversationSessionStore()
 store.advance(scope,{message:'João comentou preço.',response:{advice:{ai_reasoning:{facts_used:[{statement:'João comentou preço.'}],run:{capability_results:[{capability:'CLIENT_CONTEXT',status:'EXECUTED',source_ref:'ctx-a'}]}}}}})
 const switched=store.switchClient(scope,{id:'client-b',name:'Maria Souza'})
 assert.equal(switched.current_client.id,'client-b')
 assert.equal(switched.current_client.label,'Maria Souza')
 assert.equal(switched.current_property,null)
 assert.equal(switched.current_crop,null)
 assert.equal(switched.current_season,null)
 assert.equal(switched.current_topic,null)
 assert.equal(switched.current_decision_thesis,null)
 assert.deepEqual(switched.recent_entities,[{type:'client',id:'client-b',label:'Maria Souza'}])
 assert.deepEqual(switched.recent_tool_results,[])
 assert.deepEqual(switched.session_facts,[])
 assert.deepEqual(switched.conversation_turns,[])
 assert.equal(store.get({...scope,clientId:'client-b'}).current_client.id,'client-b')
 assert.throws(()=>store.get(scope),error=>error.code==='conversation_client_scope_mismatch')
})
