import assert from 'node:assert/strict'
import test from 'node:test'
import {activeComparisonClientIds,advanceConversationState,conversationStateContext,createConversationState} from '../server/decision-copilot/conversation-state.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-comparison',clientId:'carlos',client:{id:'carlos',name:'Carlos Oliveira'}}

test('estado single-client descarta fatos e hipóteses explicitamente atribuídos a outro produtor',()=>{
 const state=advanceConversationState(createConversationState(scope),{
  scope,
  response:{advice:{ai_reasoning:{
   facts_used:[
    {id:'fact-carlos',statement:'Preço foi a objeção.',subject_client_id:'carlos',owner_id:'owner-a'},
    {id:'fact-antonio',statement:'Preço foi a objeção.',subject_client_ids:['antonio'],owner:'owner-a'},
   ],
   hypotheses:[{label:'Validar percepção de valor.',subject:{type:'client',id:'antonio'},ownerId:'owner-a'}]
  }}}
 })

 assert.equal(state.session_facts.length,1)
 assert.deepEqual(state.session_facts.map(item=>[item.subject_client_id,item.owner_id]),[['carlos','owner-a']])
 assert.deepEqual(state.session_hypotheses,[])
})

test('comparação rotula fatos por produtor e contexto single-client não expõe o outro cliente',()=>{
 const comparedClients=[{id:'carlos',name:'Carlos Oliveira'},{id:'antonio',name:'Antônio Carlos'}]
 const state=advanceConversationState(createConversationState(scope),{
  scope,
  response:{
   responseMetadata:{comparedClients},
   comparisonResolution:{clients:comparedClients},
   advice:{ai_reasoning:{recommended_strategy:{reading:'Carlos Oliveira teve visita dia 25; Antônio Carlos, dia 24.'},decision_thesis:{THESIS:'Comparar os dois históricos.',KEY_UNCERTAINTY:'Qual dimensão importa?'},facts_used:[
    {id:'visit-carlos',subject_client_id:'carlos',statement:'Última visita concluída de Carlos Oliveira em 25/08/2026.'},
    {id:'visit-antonio',subject_client_id:'antonio',statement:'Última visita concluída de Antônio Carlos em 24/08/2026.'},
   ],hypotheses:[],golden_questions:[
    {question:'Qual conta deve ser priorizada entre os dois produtores?'},
    {question:'O que Carlos Oliveira espera da próxima visita?'},
   ],run:{capability_results:[{capability:'CLIENT_COMPARISON',status:'EXECUTED',source_ref:'comparison-carlos-antonio',summary:'Comparação entre Carlos e Antônio.'}]}}}
  },
  message:'Compare os dois.'
 })

 assert.deepEqual(state.session_facts.map(item=>item.subject_client_id),['carlos','antonio'])
 const carlosContext=conversationStateContext(state)
 assert.deepEqual(carlosContext.session_facts.map(item=>item.source_ref),['visit-carlos'])
 assert.equal(carlosContext.current_decision_thesis,null)
 assert.deepEqual(carlosContext.conversation_turns,[])
 assert.deepEqual(carlosContext.recent_tool_results,[])
 assert.deepEqual(carlosContext.recent_questions.map(item=>item.question??item),['O que Carlos Oliveira espera da próxima visita?'])
 assert.deepEqual(conversationStateContext(state,{clientId:'antonio'}).session_facts.map(item=>item.source_ref),['visit-antonio'])
 assert.deepEqual(conversationStateContext(state,{clientId:'antonio'}).recent_questions,[])
 const comparisonContext=conversationStateContext(state,{scope:'comparison'})
 assert.deepEqual(comparisonContext.session_facts.map(item=>item.source_ref),['visit-carlos','visit-antonio'])
 assert.equal(comparisonContext.current_decision_thesis.thesis,'Comparar os dois históricos.')
 assert.equal(comparisonContext.conversation_turns.length,2)
 assert.equal(comparisonContext.recent_tool_results[0].source_ref,'comparison-carlos-antonio')
 assert.deepEqual(comparisonContext.recent_questions.map(item=>item.question??item),['Qual conta deve ser priorizada entre os dois produtores?','O que Carlos Oliveira espera da próxima visita?'])
 assert.deepEqual(activeComparisonClientIds(state),['carlos','antonio'])

 const afterSingleClientTurn=advanceConversationState(state,{scope,message:'Qual foi a última visita dele?',response:{advice:{answer:'A última visita de Carlos foi em 25/08/2026.'}}})
 assert.deepEqual(activeComparisonClientIds(afterSingleClientTurn),[])
})

test('fato agregado multi-cliente fica retido no estado mas só entra em contexto comparativo',()=>{
 const comparedClients=[{id:'carlos',name:'Carlos Oliveira'},{id:'antonio',name:'Antônio Carlos'}]
 const state=advanceConversationState(createConversationState(scope),{
  scope,
  response:{responseMetadata:{comparedClients},advice:{ai_reasoning:{facts_used:[{id:'aggregate',subject_client_ids:['carlos','antonio'],statement:'As duas contas precisam de validação adicional.'}],hypotheses:[]}}}
 })

 assert.deepEqual(state.session_facts[0].subject_client_ids,['carlos','antonio'])
 assert.deepEqual(conversationStateContext(state).session_facts,[])
 assert.equal(conversationStateContext(state,{includeCrossClient:true,allowedClientIds:['carlos','antonio']}).session_facts[0].source_ref,'aggregate')
})

test('itens legados sem subject falham fechados e não são reatribuídos ao produtor atual',()=>{
 const context=conversationStateContext({
  conversation_id:'legacy-thread',
  current_client:{id:'carlos',name:'Carlos Oliveira'},
  session_facts:[{statement:'Fato legado.',source_ref:'legacy-fact'}],
  session_hypotheses:[{statement:'Hipótese legada.',source_ref:'legacy-hypothesis'}],
  recent_questions:['Pergunta legada?'],
  recent_tool_results:[{capability:'LEGACY_TOOL',status:'EXECUTED',source_ref:'legacy-tool'}]
 })

 assert.deepEqual(context.session_facts,[])
 assert.deepEqual(context.session_hypotheses,[])
 assert.deepEqual(context.recent_questions,[])
 assert.deepEqual(context.recent_tool_results,[])
})
