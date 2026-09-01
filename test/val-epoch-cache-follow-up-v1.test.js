import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {activeComparisonClientIds,advanceConversationState,conversationStateContext,createConversationState,lastCompletedAssistantTurn,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {createSessionContextCache,sessionContextCacheKey,sessionContextCacheNamespaces} from '../server/decision-copilot/session-context-cache.js'
import {routeSessionCommand} from '../server/decision-copilot/session-command-router.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-epoch',clientId:'producer-a',client:{id:'producer-a',name:'Produtor A'}}
const response=(reading,fact,intent='ASK_CLIENT',producerId=scope.clientId)=>({advice:{ai_reasoning:{intent,recommended_strategy:{reading},facts_used:fact?[{id:`source:${producerId}:${intent}`,source_ref:`source:${producerId}:${intent}`,producer_id:producerId,statement:fact}]:[],decision_thesis:{THESIS:reading}}}})

test('mudança PROFILE → CREDIT avança epoch antes do retrieval e elimina overlays anteriores',async()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o perfil dele?',client:scope.client,response:response('Perfil analítico.','Perfil score 82')})
 assert.equal(state.current_domain,'PROFILE')
 assert.equal(state.context_epoch,0)
 assert.equal(state.session_facts.length,1)

 const prepared=prepareConversationTurnState(state,{scope,message:'qual o limite de crédito?',intent:'ASK_CLIENT'})
 assert.equal(prepared.current_domain,'CREDIT')
 assert.equal(prepared.context_epoch,1)
 assert.deepEqual(prepared.session_facts,[])
 assert.deepEqual(prepared.session_hypotheses,[])
 assert.deepEqual(prepared.recent_tool_results,[])
 assert.deepEqual(prepared.recent_questions,[])
 assert.deepEqual(prepared.conversation_turns,[])
 assert.equal(prepared.current_decision_thesis,null)

 state=advanceConversationState(prepared,{turnPrepared:true,scope,message:'qual o limite de crédito?',client:scope.client,response:response('Limite atual confirmado.','Limite R$ 100.000')})
 const message='Mostra os números.'
 const route=routeSystemCapability({message,hasClient:true})
 const execution=await executeCapabilityPlan({route,message,context:{client:scope.client,conversationState:conversationStateContext(state),priorRecommendations:[]},clientId:scope.clientId})
 assert.match(execution.tool_result.summary,/R\$ 100\.000/)
 assert.doesNotMatch(execution.tool_result.summary,/score 82/i)
})

test('follow-up preserva domínio e usa somente assistant concluído da mesma conversa, produtor e epoch',async()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o perfil dele?',client:scope.client,response:response('Perfil analítico. Evidência suficiente.','Pediu ROI.')})
 const prepared=prepareConversationTurnState(state,{scope,message:'Resume.',sessionCommand:routeSessionCommand('Resume.')})
 assert.equal(prepared.current_domain,'PROFILE')
 assert.equal(prepared.context_epoch,0)
 assert.equal(prepared.conversation_turns.length,2)

 const same=lastCompletedAssistantTurn(prepared,{conversationId:scope.conversationId,clientId:scope.clientId,contextEpoch:0,client:scope.client})
 assert.match(same.text,/Perfil analítico/)
 assert.equal(lastCompletedAssistantTurn(prepared,{conversationId:'outra-thread',clientId:scope.clientId,contextEpoch:0,client:scope.client}),null)
 assert.equal(lastCompletedAssistantTurn(prepared,{conversationId:scope.conversationId,clientId:'producer-b',contextEpoch:0,client:{id:'producer-b'}}),null)
 assert.equal(lastCompletedAssistantTurn(prepared,{conversationId:scope.conversationId,clientId:scope.clientId,contextEpoch:1,client:scope.client}),null)
 const withIncomplete={...prepared,conversation_turns:[...prepared.conversation_turns,{role:'assistant',status:'pending',text:'POISON_INCOMPLETO',conversation_id:scope.conversationId,context_epoch:0,subject_client_id:scope.clientId}]}
 assert.match(lastCompletedAssistantTurn(withIncomplete,{conversationId:scope.conversationId,clientId:scope.clientId,contextEpoch:0,client:scope.client}).text,/Perfil analítico/)
 const legacyUnscoped={conversation_id:scope.conversationId,context_epoch:0,current_client:scope.client,conversation_turns:[{role:'assistant',text:'POISON_LEGADO'}]}
 assert.equal(lastCompletedAssistantTurn(legacyUnscoped,{conversationId:scope.conversationId,clientId:scope.clientId,contextEpoch:0,client:scope.client}),null)

 const message='Resume.'
 const route=routeSystemCapability({message,hasClient:true})
 const execution=await executeCapabilityPlan({route,message,context:{client:scope.client,conversationState:conversationStateContext(prepared),priorRecommendations:[{advice:{answer:'Resposta externa que não pode substituir o turno concluído.'}}]},clientId:scope.clientId})
 assert.match(execution.tool_result.summary,/Perfil analítico/)
 assert.doesNotMatch(execution.tool_result.summary,/Resposta externa/)
})

test('hint SUMMARIZE contraditório não transforma PROFILE em follow-up nem preserva poison de GRAINS',async()=>{
 let grainsState=createConversationState(scope)
 grainsState=advanceConversationState(grainsState,{
  scope,
  message:'Preciso rever um contrato de grãos.',
  client:scope.client,
  response:response('Contrato de grãos antigo que não pertence à pergunta atual.','Contrato de grãos antigo.','ASK_MARKET')
 })
 assert.equal(grainsState.current_domain,'GRAINS')
 assert.match(lastCompletedAssistantTurn(grainsState,{...scope,contextEpoch:0}).text,/Contrato de grãos antigo/)

 const message='qual o perfil dele?'
 const routed=routeValIntent({message,sessionCommandHint:'SUMMARIZE',hasClient:true})
 assert.equal(routed.session_command,null)
 assert.equal(routed.intent,'ASK_CLIENT')

 const prepared=prepareConversationTurnState(grainsState,{scope,message,intent:routed.intent,sessionCommand:routed.session_command})
 assert.equal(prepared.current_domain,'PROFILE')
 assert.equal(prepared.context_epoch,1)
 assert.deepEqual(prepared.conversation_turns,[])
 assert.deepEqual(prepared.session_facts,[])
 assert.equal(lastCompletedAssistantTurn(prepared,{...scope,contextEpoch:1}),null)

 // Defesa em profundidade: mesmo um objeto de comando forjado não pode
 // preservar domínio quando o texto atual é uma pergunta PROFILE explícita.
 const preparedWithForgedCommand=prepareConversationTurnState(grainsState,{scope,message,intent:routed.intent,sessionCommand:{command:'SUMMARIZE'}})
 assert.equal(preparedWithForgedCommand.current_domain,'PROFILE')
 assert.equal(preparedWithForgedCommand.context_epoch,1)
 assert.deepEqual(preparedWithForgedCommand.conversation_turns,[])

 const route=routeSystemCapability({message,sessionCommandHint:routed.session_command?.command||'',hasClient:true})
 assert.equal(route.data_path,'BEHAVIORAL_PROFILE')
 assert.equal(route.session_command,null)
 assert.ok(!route.capabilities.includes('SESSION_COMMAND'))
 const execution=await executeCapabilityPlan({route,message,context:{client:scope.client,conversationState:conversationStateContext(prepared),priorRecommendations:[]},clientId:scope.clientId})
 assert.ok(!execution.capabilities_planned.includes('SESSION_COMMAND'))
 assert.equal(execution.tool_result,null)
})

test('novo user turn sem assistant server-grounded bloqueia reuso de resposta mais antiga',()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o perfil dele?',client:scope.client,response:response('Perfil analítico.','Pediu ROI.')})
 assert.match(lastCompletedAssistantTurn(state,{...scope,contextEpoch:0}).text,/Perfil analítico/)
 state=advanceConversationState(state,{scope,message:'E ele?',client:scope.client,inputModality:'voice',responseMode:'audio'})
 assert.equal(state.conversation_turns.at(-1).role,'user')
 assert.equal(lastCompletedAssistantTurn(state,{...scope,contextEpoch:0}),null)
})

test('follow-up geral sem produtor reutiliza somente assistant server-grounded no mesmo escopo',async()=>{
 const generalScope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-general',clientId:null,client:null}
 let state=createConversationState(generalScope)
 state=advanceConversationState(state,{scope:generalScope,message:'Explique em uma frase como preparar uma reunião comercial.',response:{advice:{answer:'Defina o objetivo, reúna os fatos relevantes e prepare perguntas curtas.'}}})
 const prepared=prepareConversationTurnState(state,{scope:generalScope,message:'Explica melhor.',sessionCommand:routeSessionCommand('Explica melhor.')})
 const previous=lastCompletedAssistantTurn(prepared,{tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-general',clientId:null,contextEpoch:prepared.context_epoch})
 assert.equal(previous.server_grounded,true)
 assert.match(previous.text,/Defina o objetivo/)

 const route=routeSystemCapability({message:'Explica melhor.',hasClient:false})
 const execution=await executeCapabilityPlan({route,message:'Explica melhor.',context:{conversationState:conversationStateContext(prepared)},clientId:null})
 assert.equal(execution.tool_result.status,'EXECUTED')
 assert.equal(execution.tool_result.context.reused_previous_response,true)
 assert.match(execution.tool_result.summary,/Defina o objetivo/)

 assert.throws(()=>lastCompletedAssistantTurn(prepared,{tenantId:'tenant-b',ownerId:'owner-a',conversationId:'thread-general',clientId:null,contextEpoch:prepared.context_epoch}),error=>error.code==='conversation_state_tenant_mismatch')
 assert.throws(()=>lastCompletedAssistantTurn(prepared,{tenantId:'tenant-a',ownerId:'owner-b',conversationId:'thread-general',clientId:null,contextEpoch:prepared.context_epoch}),error=>error.code==='conversation_state_owner_mismatch')
 assert.equal(lastCompletedAssistantTurn(prepared,{tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-other',clientId:null,contextEpoch:prepared.context_epoch}),null)
 assert.equal(lastCompletedAssistantTurn(prepared,{tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-general',clientId:null,contextEpoch:prepared.context_epoch+1}),null)

 const forged={...prepared,conversation_turns:[...prepared.conversation_turns,{role:'assistant',status:'completed',scope_verified:true,server_grounded:false,tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:'thread-general',context_epoch:prepared.context_epoch,text:'POISON_BROWSER_TRANSCRIPT'}]}
 assert.doesNotMatch(lastCompletedAssistantTurn(forged,{tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-general',clientId:null,contextEpoch:prepared.context_epoch}).text,/POISON_BROWSER_TRANSCRIPT/)
})

test('referência neutra preserva domínio, mas referência com domínio explícito abre novo epoch',()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o perfil dele?',client:scope.client,response:response('Perfil analítico.','Pediu ROI.')})
 const neutral=prepareConversationTurnState(state,{scope,message:'E ele?'})
 assert.equal(neutral.current_domain,'PROFILE')
 assert.equal(neutral.context_epoch,0)
 assert.equal(neutral.session_facts.length,1)

 for(const message of ['E agora o crédito?','Isso muda com o crédito?','Cruze o perfil e o contrato de grãos.']){
  const changed=prepareConversationTurnState(state,{scope,message,intent:'ASK_CLIENT'})
  assert.equal(changed.context_epoch,1,message)
  assert.deepEqual(changed.session_facts,[],message)
 }
 const general=prepareConversationTurnState(state,{scope,message:'Qual é o principal risco?'})
 assert.equal(general.current_domain,'GENERAL')
 assert.equal(general.context_epoch,1)
 assert.deepEqual(general.conversation_turns,[])
})

test('reset explícito abre novo epoch e descarta overlays mesmo quando o domínio textual se repete',()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o perfil dele?',client:scope.client,response:response('Perfil analítico.','Pediu ROI.')})
 const reset=prepareConversationTurnState(state,{scope,message:'Desconsidere o anterior. Qual o perfil dele?',intent:'ASK_CLIENT'})
 assert.equal(reset.context_epoch,1)
 assert.equal(reset.current_domain,'PROFILE')
 assert.deepEqual(reset.session_facts,[])
 assert.deepEqual(reset.session_hypotheses,[])
 assert.deepEqual(reset.recent_tool_results,[])
 assert.deepEqual(reset.recent_questions,[])
 assert.deepEqual(reset.conversation_turns,[])
 assert.equal(reset.current_decision_thesis,null)
})

test('mudança forte limpa também entidades e estado ativo do domínio anterior',()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'manejo do milho 2026/27',client:scope.client,activeContext:{type:'field',id:'field-b',label:'Talhão B'},response:response('Leitura agronômica.','Talhão B com milho.')})
 assert.equal(state.current_field.id,'field-b')
 assert.equal(state.current_crop,'Milho')
 assert.equal(state.current_season,'2026/27')
 const credit=prepareConversationTurnState(state,{scope,message:'qual o limite de crédito?',intent:'ASK_CLIENT'})
 assert.equal(credit.context_epoch,1)
 assert.equal(credit.current_field,null)
 assert.equal(credit.current_crop,null)
 assert.equal(credit.current_season,null)
 assert.equal(credit.active_object,null)
 assert.deepEqual(credit.recent_entities,[{type:'client',id:'producer-a',label:'Produtor A'}])
})

test('SHOW_NUMBERS usa fatos comprovados do último assistant e rejeita poison do mesmo epoch',async()=>{
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o limite de crédito?',client:scope.client,response:response('Limite confirmado em R$ 100.000.','Limite R$ 100.000')})
 state=advanceConversationState(state,{scope,message:'qual a situação do crédito?',client:scope.client,response:response('Sem atualização numérica confirmada.',null)})
 const message='Mostra os números.'
 const route=routeSystemCapability({message,hasClient:true})
 const noStale=await executeCapabilityPlan({route,message,context:{client:scope.client,conversationState:conversationStateContext(state)},clientId:scope.clientId})
 assert.equal(noStale.tool_result.status,'NO_DATA')
 assert.doesNotMatch(noStale.tool_result.summary,/100\.000/)

 let poisoned=createConversationState(scope)
 poisoned=advanceConversationState(poisoned,{scope,message:'qual o limite de crédito?',client:scope.client,response:response('Score informado: 90.','Score 90 do produtor B','ASK_CLIENT','producer-b')})
 const isolated=await executeCapabilityPlan({route,message,context:{client:scope.client,conversationState:conversationStateContext(poisoned)},clientId:scope.clientId})
 assert.equal(isolated.tool_result.status,'NO_DATA')
 assert.doesNotMatch(isolated.tool_result.summary,/90|produtor B/i)

 let ungrounded=createConversationState(scope)
 ungrounded=advanceConversationState(ungrounded,{scope,message:'qual o limite de crédito?',client:scope.client,response:{advice:{ai_reasoning:{recommended_strategy:{reading:'Score informado: 99.'},facts_used:[{producer_id:scope.clientId,statement:'Score 99 sem fonte.'}],decision_thesis:{THESIS:'Sem fonte.'}}}}})
 assert.deepEqual(conversationStateContext(ungrounded).session_facts,[])
 const withoutSource=await executeCapabilityPlan({route,message,context:{client:scope.client,conversationState:conversationStateContext(ungrounded)},clientId:scope.clientId})
 assert.equal(withoutSource.tool_result.status,'NO_DATA')
 assert.doesNotMatch(withoutSource.tool_result.summary,/99|sem fonte/i)
})

test('memória de sessão falha fechada para tenant/owner ausente ou divergente',()=>{
 const valid=advanceConversationState(createConversationState(scope),{scope,message:'qual o perfil dele?',client:scope.client,response:response('Perfil analítico.','Pediu ROI.')})
 assert.deepEqual(valid.session_facts.map(item=>[item.tenant_id,item.owner_id,item.subject_client_id]),[['tenant-a','owner-a','producer-a']])

 for(const poisonedFact of [
  {id:'wrong-tenant',producer_id:'producer-a',tenant_id:'tenant-b',owner_id:'owner-a',statement:'POISON_TENANT'},
  {id:'wrong-owner',producer_id:'producer-a',tenant_id:'tenant-a',owner_id:'owner-b',statement:'POISON_OWNER'},
  {id:'missing-producer',tenant_id:'tenant-a',owner_id:'owner-a',statement:'POISON_NO_PRODUCER'},
  {id:'dual-subject-smuggling',producer_id:'producer-a',subject_client_ids:['producer-a','producer-b'],tenant_id:'tenant-a',owner_id:'owner-a',statement:'POISON_DUAL_SUBJECT'}
 ]){
  const state=advanceConversationState(createConversationState(scope),{scope,message:'qual o perfil dele?',client:scope.client,response:{advice:{ai_reasoning:{recommended_strategy:{reading:'Resposta sem evidência reutilizável.'},facts_used:[poisonedFact],decision_thesis:{THESIS:'Não persistir poison.'}}}}})
  assert.deepEqual(state.session_facts,[],poisonedFact.id)
  assert.equal(state.current_decision_thesis,null,poisonedFact.id)
 }

 const wrongOwnerTurn={tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:scope.conversationId,context_epoch:0,current_client:scope.client,conversation_turns:[{role:'assistant',status:'completed',scope_verified:true,tenant_id:'tenant-a',owner_id:'owner-b',conversation_id:scope.conversationId,context_epoch:0,subject_client_id:scope.clientId,text:'POISON_OWNER_TURN'}]}
 assert.equal(lastCompletedAssistantTurn(wrongOwnerTurn,{tenantId:'tenant-a',ownerId:'owner-a',conversationId:scope.conversationId,clientId:scope.clientId,contextEpoch:0,client:scope.client}),null)
 const missingTenantTurn={tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:scope.conversationId,context_epoch:0,current_client:scope.client,conversation_turns:[{role:'assistant',status:'completed',scope_verified:true,owner_id:'owner-a',conversation_id:scope.conversationId,context_epoch:0,subject_client_id:scope.clientId,text:'POISON_MISSING_TENANT'}]}
 assert.equal(lastCompletedAssistantTurn(missingTenantTurn,{tenantId:'tenant-a',ownerId:'owner-a',conversationId:scope.conversationId,clientId:scope.clientId,contextEpoch:0,client:scope.client}),null)
})

test('comparison follow-up sobrevive ao advance metadata-only e troca A+B por A+C sem B',async()=>{
 const producerB={id:'producer-b',name:'Produtor B'}
 const producerC={id:'producer-c',name:'Produtor C'}
 const comparisonResponse=(clients,marker)=>({
  responseMetadata:{comparedClients:clients},
  advice:{ai_reasoning:{recommended_strategy:{reading:`Comparação ${marker}: ${clients.map(item=>item.name).join(' e ')}.`},facts_used:clients.map(item=>({id:`${marker}:${item.id}`,producer_id:item.id,tenant_id:scope.tenantId,statement:`${item.name}: ${marker}.`})),decision_thesis:{THESIS:`Comparar ${marker}.`},golden_questions:[{question:`Qual conta priorizar em ${marker}?`}],run:{capability_results:[{capability:'CLIENT_COMPARISON',status:'EXECUTED',source_ref:`tool:${marker}`}]}}}
 })
 let state=advanceConversationState(createConversationState(scope),{scope,message:'Compare A e B.',client:scope.client,response:comparisonResponse([scope.client,producerB],'A+B')})
 assert.deepEqual(activeComparisonClientIds(state),['producer-a','producer-b'])
 const prepared=prepareConversationTurnState(state,{scope,message:'Resume.',sessionCommand:routeSessionCommand('Resume.')})
 const metadataOnly=advanceConversationState(prepared,{turnPrepared:true,scope,inputModality:'text',responseMode:'text',conversationMode:true,client:scope.client})
 assert.deepEqual(activeComparisonClientIds(metadataOnly),['producer-a','producer-b'])
 assert.equal(metadataOnly.conversation_turns.length,2)
 const route=routeSystemCapability({message:'Resume.',hasClient:true})
 const execution=await executeCapabilityPlan({route,message:'Resume.',context:{client:scope.client,conversationState:conversationStateContext(metadataOnly,{scope:'comparison',allowedClientIds:['producer-a','producer-b']})},clientId:scope.clientId})
 assert.equal(execution.tool_result.status,'EXECUTED')
 assert.match(execution.tool_result.summary,/Produtor A: A\+B/)
 assert.match(execution.tool_result.summary,/Produtor B: A\+B/)

 state=advanceConversationState(metadataOnly,{turnPrepared:true,scope,message:'Agora compare A e C.',client:scope.client,response:comparisonResponse([scope.client,producerC],'A+C')})
 assert.deepEqual(activeComparisonClientIds(state),['producer-a','producer-c'])
 const serialized=JSON.stringify(conversationStateContext(state,{scope:'comparison',allowedClientIds:['producer-a','producer-c']}))
 assert.doesNotMatch(serialized,/producer-b|Produtor B|A\+B/)
 assert.match(serialized,/producer-c|Produtor C|A\+C/)
})

test('activeComparisonClientIds falha fechado sem assistant concluído e verificado',()=>{
 assert.deepEqual(activeComparisonClientIds(createConversationState(scope)),[])
 const userOnly=advanceConversationState(createConversationState(scope),{scope,message:'Compare A e B.'})
 assert.deepEqual(activeComparisonClientIds(userOnly),[])
 const incomplete={...userOnly,conversation_turns:[...userOnly.conversation_turns,{role:'assistant',status:'incomplete',scope_verified:true,tenant_id:scope.tenantId,owner_id:scope.ownerId,conversation_id:scope.conversationId,context_epoch:0,subject_client_ids:['producer-a','producer-b'],text:'INCOMPLETE'}]}
 assert.deepEqual(activeComparisonClientIds(incomplete),[])
 const dualSubject={...userOnly,conversation_turns:[...userOnly.conversation_turns,{role:'assistant',status:'completed',scope_verified:true,tenant_id:scope.tenantId,owner_id:scope.ownerId,conversation_id:scope.conversationId,context_epoch:0,subject_client_id:'producer-a',subject_client_ids:['producer-a','producer-b'],text:'POISON_DUAL_SUBJECT_TURN'}]}
 assert.deepEqual(activeComparisonClientIds(dualSubject),[])
})

test('cache separa preload, versão do selector e assinatura objetiva da consulta',async()=>{
 const base={tenantId:'tenant-a',ownerId:'owner-a',clientId:'producer-a',conversationId:'thread-a',contextEpoch:3,contextDomain:'GENERAL',selectorVersion:'selector-v1'}
 const selectedA={...base,cacheNamespace:sessionContextCacheNamespaces.SELECTED,message:'Como abordar o produtor?',intent:'ASK_CLIENT',objective:'copilot_context'}
 const selectedB={...selectedA,message:'Quais dados ainda faltam?'}
 const preload={...selectedA,cacheNamespace:sessionContextCacheNamespaces.PRELOAD,objective:'background_preload_after_entity_resolution'}
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey(selectedB))
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey({...selectedA,intent:'PREPARE_VISIT'}))
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey({...selectedA,objective:'copilot_deep'}))
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey({...selectedA,actorRole:'admin'}))
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey({...selectedA,accessScope:'portfolio_admin'}))
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey(preload))
 assert.notEqual(sessionContextCacheKey(selectedA),sessionContextCacheKey({...selectedA,selectorVersion:'selector-v2'}))
 assert.throws(()=>sessionContextCacheKey({...selectedA,selectorSignature:'forced-collision'}),error=>error.code==='val_cache_selector_signature_invalid')

 const cache=createSessionContextCache()
 assert.equal((await cache.getOrLoad(preload,async()=>({source:'preload'}))).source,'preload')
 assert.equal((await cache.getOrLoad(selectedA,async()=>({source:'question-a'}))).source,'question-a')
 assert.equal((await cache.getOrLoad(selectedB,async()=>({source:'question-b'}))).source,'question-b')
 assert.equal(cache.stats().entries,3)
 assert.equal(cache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),3)
 assert.equal(cache.stats().entries,0)

 const raceCache=createSessionContextCache()
 let release
 const blocked=new Promise(resolve=>{release=resolve})
 const pending=raceCache.getOrLoad(selectedA,async()=>{await blocked;return {source:'stale'}})
 await Promise.resolve()
 assert.equal(raceCache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),1)
 release()
 await assert.rejects(pending,error=>error.code==='val_context_cache_invalidated'&&error.safeToRetry===true)
 assert.equal((await raceCache.getOrLoad(selectedA,async()=>({source:'fresh'}))).source,'fresh')
 const resolvedHit=raceCache.getOrLoad(selectedA,async()=>({source:'must-not-load'}))
 assert.equal(raceCache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),1)
 await assert.rejects(resolvedHit,error=>error.code==='val_context_cache_invalidated')
 assert.equal((await raceCache.getOrLoad(selectedA,async()=>({source:'fresh-after-hit-invalidation'}))).source,'fresh-after-hit-invalidation')
})

test('cache separa entidade ativa e invalida loads capturados após eviction ou expiry',async()=>{
 const base={tenantId:'tenant-a',ownerId:'owner-a',clientId:'producer-a',conversationId:'thread-cache-race',contextEpoch:2,contextDomain:'AGRONOMY',cacheNamespace:sessionContextCacheNamespaces.SELECTED,selectorVersion:'selector-v1',message:'E este talhão?',intent:'ASK_CLIENT',objective:'copilot_context'}
 const fieldA={...base,activeEntityType:'field',activeEntityId:'field-a'}
 const fieldB={...base,activeEntityType:'field',activeEntityId:'field-b'}
 const soilA={...base,activeEntityType:'soil_analysis',activeEntityId:'field-a'}
 assert.notEqual(sessionContextCacheKey(fieldA),sessionContextCacheKey(fieldB))
 assert.notEqual(sessionContextCacheKey(fieldA),sessionContextCacheKey(soilA))
 const entityCache=createSessionContextCache()
 await entityCache.getOrLoad(fieldA,async()=>({field:'a'}))
 await entityCache.getOrLoad(fieldB,async()=>({field:'b'}))
 assert.equal(entityCache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),2)

 const evictionCache=createSessionContextCache({maxEntries:10})
 let releaseEvicted
 const blockedEvicted=new Promise(resolve=>{releaseEvicted=resolve})
 const evictedPending=evictionCache.getOrLoad(fieldA,async()=>{await blockedEvicted;return {source:'evicted-stale'}})
 await Promise.resolve()
 for(let index=0;index<10;index++)await evictionCache.getOrLoad({...base,clientId:`other-${index}`},async()=>({index}))
 assert.equal(evictionCache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),1)
 releaseEvicted()
 await assert.rejects(evictedPending,error=>error.code==='val_context_cache_invalidated')

 let now=0
 const expiryCache=createSessionContextCache({ttlMs:1_000,clock:()=>now})
 let releaseExpired
 const blockedExpired=new Promise(resolve=>{releaseExpired=resolve})
 const expiredPending=expiryCache.getOrLoad(fieldA,async()=>{await blockedExpired;return {source:'expired-stale'}})
 await Promise.resolve();now=1_001;expiryCache.stats()
 assert.equal(expiryCache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),1)
 releaseExpired()
 await assert.rejects(expiredPending,error=>error.code==='val_context_cache_invalidated')

 const consumerCache=createSessionContextCache({maxEntries:10})
 await consumerCache.getOrLoad(fieldA,async()=>({source:'resolved-victim'}))
 const capturedHit=consumerCache.getOrLoad(fieldA,async()=>({source:'must-not-load'}))
 const fillers=[]
 for(let index=0;index<10;index++)fillers.push(consumerCache.getOrLoad({...base,clientId:`consumer-other-${index}`},async()=>({index})))
 assert.equal(consumerCache.invalidate({tenantId:base.tenantId,ownerId:base.ownerId,clientId:base.clientId}),1)
 await assert.rejects(capturedHit,error=>error.code==='val_context_cache_invalidated')
 await Promise.all(fillers)
})

test('server prepara epoch antes do request context e invalida rotas materiais de produtor',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 const preparedAt=server.indexOf('sessionState=prepareConversationTurnState(sessionState')
 const requestStateAt=server.indexOf('const requestConversationState=')
 const loaderAt=server.indexOf('const loadAuthorizedContext=async()=>')
 assert.ok(preparedAt>0&&preparedAt<requestStateAt&&requestStateAt<loaderAt)
 assert.match(server,/cacheNamespace:sessionContextCacheNamespaces\.PRELOAD/)
 assert.match(server,/cacheNamespace:sessionContextCacheNamespaces\.SELECTED/)
 assert.match(server,/activeEntityType,activeEntityId\},\(\)=>repository\.getClientContext/)
 assert.match(server,/contextEpoch:requestConversationState\.context_epoch,contextDomain,activeEntity:requestedEntity/)
 assert.match(server,/actorRole:identity\?\.role\|\|'consultant',accessScope:'own_portfolio'/)
 assert.match(server,/contextRequest:\{requestId,tenantId,ownerId:scopedOwnerId,producerId:clientId,objective:contextObjective,message,intent:routedIntent\.intent,contextEpoch:requestConversationState\.context_epoch,contextDomain,/)
 for(const mutation of ['saveVisit','confirmReport','saveActionPlan','saveCommitment','updateCommitment','saveOpportunity','updateClient','saveTechnicalContext','ingestCommercialImport']){
  const mutationAt=server.indexOf(mutation)
  const invalidationAt=server.indexOf('invalidateValContextScope',mutationAt)
  assert.ok(mutationAt>0&&invalidationAt>mutationAt&&invalidationAt-mutationAt<1_200,mutation)
 }
 assert.match(server,/valCore\.execute[\s\S]{0,1600}invalidateValContextScope\(\{tenantId,ownerId:scopedOwnerId,clientId\}\)/)
 assert.match(server,/updateClient[^\n]*invalidateValContextScope\(\{tenantId:[^\n]*ownerId:[^\n]*resetConversation:true\}/)
 assert.match(server,/archiveClient[^\n]*invalidateValContextScope\([^\n]*resetConversation:true/)
})
