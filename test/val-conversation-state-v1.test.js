import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {advanceConversationState,conversationStateContext,conversationStatePromptContext,conversationStateVersion,createConversationState,messageNeedsSessionReference} from '../server/decision-copilot/conversation-state.js'
import {conversationSessionKey,createConversationSessionStore} from '../server/decision-copilot/conversation-session-store.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'conversation-a',clientId:'client-a',client:{id:'client-a',name:'João Pereira'}}

test('schema do ConversationState formaliza tenant, owner, sujeitos, epoch e grounding do servidor',()=>{
 const schema=JSON.parse(readFileSync(new URL('../contracts/v1/conversation-state.schema.json',import.meta.url),'utf8'))
 for(const field of ['tenant_id','owner_id','context_epoch','recent_clients','conversation_turns'])assert.ok(schema.required.includes(field),field)
 for(const field of ['subject_client_id','subject_client_ids','tenant_id','owner_id'])assert.ok(Object.hasOwn(schema.$defs.sessionKnowledge.properties,field),field)
 for(const field of ['scope_verified','server_grounded','conversation_id','context_epoch','tenant_id','owner_id'])assert.ok(schema.$defs.turn.required.includes(field),field)
})

test('ConversationState v1 preserva entidades e conhecimento somente na sessão',()=>{
 const created=createConversationState({...scope,activeContext:{type:'field',id:'field-a',label:'Talhão Norte'},now:'2026-08-28T10:00:00.000Z'})
 const next=advanceConversationState(created,{
  scope,
  message:'Ele comentou preço de novo no milho 2026/27.',
  inputModality:'voice',responseMode:'audio',conversationMode:true,now:'2026-08-28T10:01:00.000Z',
  response:{advice:{ai_reasoning:{intent:'PREPARE_VISIT',objective:'Preparar a visita do João',recommended_strategy:{reading:'Eu não começaria pelo preço.',action:'Confirmar o critério de valor.'},decision_thesis:{THESIS:'Começar por valor.',KEY_UNCERTAINTY:'Qual é o critério real?'},facts_used:[{id:'fact-a',subject_client_id:'client-a',statement:'João voltou a mencionar preço.'}],hypotheses:[{id:'hypothesis-a',subject_client_id:'client-a',label:'Pode ser falta de valor percebido.'}],golden_questions:[{question:'O que ele compara ao falar de preço?'}],run:{capability_results:[{capability:'CLIENT_CONTEXT',status:'EXECUTED',source_ref:'snapshot-a'}]}}}}
 })
 assert.equal(next.contract_version,conversationStateVersion)
 assert.equal(next.tenant_id,'tenant-a')
 assert.equal(next.owner_id,'owner-a')
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

test('conversation_turn INFERENCE permanece no turno e nunca é promovido a SESSION_FACT',()=>{
 const created=createConversationState({...scope,now:'2026-08-30T10:00:00.000Z'})
 const next=advanceConversationState(created,{
  scope,message:'Resume.',now:'2026-08-30T10:01:00.000Z',
  response:{advice:{ai_reasoning:{
   intent:'FOLLOW_UP',recommended_strategy:{reading:'Resumo inferido da resposta anterior.'},
   facts_used:[
    {id:'session:conversation-a:0:SUMMARIZE',source_ref:'session:conversation-a:0:SUMMARIZE',sourceType:'conversation_turn',evidence_type:'INFERENCE',subject_client_id:'client-a',tenant_id:'tenant-a',owner_id:'owner-a',statement:'Resumo inferido da resposta anterior.'},
    {id:'visit-confirmed',source_ref:'visit-confirmed',source_type:'visit',epistemic_type:'FACT',subject_client_id:'client-a',tenant_id:'tenant-a',owner_id:'owner-a',statement:'A visita foi confirmada.'}
   ],
   run:{capability_results:[{capability:'SESSION_COMMAND',status:'EXECUTED',source_ref:'session:conversation-a:0:SUMMARIZE'}]}
  }}}
 })
 assert.deepEqual(next.session_facts.map(item=>item.source_ref),['visit-confirmed'])
 const assistant=next.conversation_turns.findLast(item=>item.role==='assistant')
 assert.equal(assistant.text,'Resumo inferido da resposta anterior.')
 assert.deepEqual(assistant.facts.map(item=>item.source_ref),['visit-confirmed'])
 assert.equal(JSON.stringify(next.session_facts).includes('Resumo inferido'),false)
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
 assert.throws(()=>store.get({...scope,contextEpoch:1}),error=>error.code==='conversation_epoch_scope_mismatch')
 assert.throws(()=>store.set(scope,{...store.get(scope),tenant_id:'tenant-b'}),error=>error.code==='conversation_state_tenant_mismatch')
 assert.throws(()=>store.set(scope,{...store.get(scope),owner_id:'owner-b'}),error=>error.code==='conversation_state_owner_mismatch')
 assert.equal(initial.persistent_memory_unchanged,true)
 const stats=store.stats()
 assert.equal(stats.content_free,true)
 assert.equal(JSON.stringify(stats).includes('João'),false)
 now=60_001
 assert.equal(store.get(scope),null)
 assert.equal(store.stats().expirations,1)
})

test('store valida contextEpoch exato em key/get/set/invalidate e nunca converte epoch inválido em zero',()=>{
 const store=createConversationSessionStore()
 const epochZero=store.ensure(scope)
 assert.equal(epochZero.context_epoch,0)
 assert.equal(conversationSessionKey(scope),conversationSessionKey({...scope,contextEpoch:0}))

 const invalidEpochs=[undefined,null,'0',false,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,-1,0.5,Number.MAX_SAFE_INTEGER+1]
 for(const value of invalidEpochs){
  const invalidScope={...scope,contextEpoch:value}
  assert.throws(()=>conversationSessionKey(invalidScope),error=>error.code==='conversation_epoch_scope_invalid')
  assert.throws(()=>store.get(invalidScope),error=>error.code==='conversation_epoch_scope_invalid')
  assert.throws(()=>store.set(invalidScope,epochZero),error=>error.code==='conversation_epoch_scope_invalid')
  assert.throws(()=>store.invalidate(invalidScope),error=>error.code==='conversation_epoch_scope_invalid')
  assert.throws(()=>store.reset(invalidScope),error=>error.code==='conversation_epoch_scope_invalid')
 }
 assert.equal(store.get({...scope,contextEpoch:0}).context_epoch,0)

 for(const value of invalidEpochs)assert.throws(()=>store.set(scope,{...epochZero,context_epoch:value}),error=>error.code==='conversation_state_epoch_invalid')
 assert.throws(()=>store.set(scope,{...epochZero,contextEpoch:'0'}),error=>error.code==='conversation_state_epoch_invalid')
 assert.throws(()=>store.set(scope,{...epochZero,contextEpoch:1}),error=>error.code==='conversation_state_epoch_invalid')

 const epochOneScope={...scope,conversationId:'conversation-epoch-one'}
 const epochOneState={...createConversationState(epochOneScope),context_epoch:1}
 assert.equal(store.set({...epochOneScope,contextEpoch:1},epochOneState).context_epoch,1)
 assert.equal(store.invalidate({tenantId:scope.tenantId,ownerId:scope.ownerId,contextEpoch:0}),1)
 assert.equal(store.get(scope),null)
 assert.equal(store.get({...epochOneScope,contextEpoch:1}).context_epoch,1)
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
 assert.deepEqual(switched.recent_clients.map(item=>item.id),['client-b','client-a'])
 assert.equal(store.get({...scope,clientId:'client-b'}).current_client.id,'client-b')
 assert.throws(()=>store.get(scope),error=>error.code==='conversation_client_scope_mismatch')
})
