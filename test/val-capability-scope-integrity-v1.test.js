import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCapabilityExecutionResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {advanceConversationState,conversationStateContext,createConversationState,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {attachLatencyPerformance} from '../server/decision-copilot/latency-observability.js'
import {routeSessionCommand} from '../server/decision-copilot/session-command-router.js'

const tenant='tenant-a'
const owner='owner-a'
const producer='producer-a'
const otherProducer='producer-b'
const baseScope={tenantId:tenant,ownerId:owner,clientId:producer}
const context=patch=>({client:{id:producer,name:'Produtor A'},...patch})
const fastRoute=capability=>({path:'FAST',intent:'ASK_CLIENT',direct:true,capabilities:[capability],materiality:{engine_required:false}})

test('capability bloqueia commitment e memória de outro produtor antes de compor a resposta',async()=>{
 await assert.rejects(
  executeCapabilityPlan({route:fastRoute('COMMERCIAL_HISTORY'),message:'Qual o compromisso?',context:context({commitments:[{id:'commit-b',producer_id:otherProducer,tenant_id:tenant,context_owner_id:owner,status:'OPEN',description:'Contrato secreto de B',updated_at:'2026-08-30T00:00:00Z'}]}),...baseScope}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH'
 )
 await assert.rejects(
  executeCapabilityPlan({route:fastRoute('CONFIRMED_MEMORY'),message:'Qual o decisor confirmado?',context:context({memories:[{id:'memory-b',producer_id:otherProducer,tenant_id:tenant,context_owner_id:owner,status:'verified',memory_state:'FACT',key:'decision_maker',value:{name:'Decisor secreto de B'},source_type:'confirmed_memory',observed_at:'2026-08-30T00:00:00Z'}]}),...baseScope}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH'
 )
})

test('record producer-specific sem tenant ou owner não é completado por relabel',async()=>{
 const route=fastRoute('COMMERCIAL_HISTORY')
 const base={id:'commit-a',producer_id:producer,status:'OPEN',description:'Compromisso A',updated_at:'2026-08-30T00:00:00Z'}
 await assert.rejects(executeCapabilityPlan({route,message:'Qual o compromisso?',context:context({commitments:[{...base,context_owner_id:owner}]}),clientId:producer}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='MISSING_TENANT_SCOPE')
 await assert.rejects(executeCapabilityPlan({route,message:'Qual o compromisso?',context:context({commitments:[{...base,tenant_id:tenant}]}),clientId:producer}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='MISSING_OWNER_SCOPE')
})

test('soil, mapping, imagem e activeContext validam o record consumido sem relabel',async()=>{
 const scopedB={producer_id:otherProducer,tenant_id:tenant,context_owner_id:owner}
 const cases=[
  executeCapabilityPlan({route:{path:'TOOL',intent:'ANALYZE_SOIL',capabilities:['SOIL_ANALYSIS'],materiality:{engine_required:false}},message:'Analise o solo.',context:context({soilAnalyses:[{id:'soil-b',...scopedB,measurements:[]}]}),...baseScope}),
  executeCapabilityPlan({route:{path:'TOOL',intent:'ASK_AGRONOMIC',capabilities:['AREA_MAPPING'],materiality:{engine_required:false}},message:'Abra o mapeamento.',context:context({properties:[{id:'property-b',...scopedB,fields:[]}]}),...baseScope}),
  executeCapabilityPlan({route:{path:'TOOL',intent:'IMAGE_DIAGNOSIS',capabilities:['IMAGE_DIAGNOSIS'],materiality:{engine_required:false}},message:'Analise a foto.',context:context({}),attachments:[{id:'photo-b',clientId:otherProducer,organizationId:tenant,contextOwnerId:owner,mimeType:'image/jpeg'}],...baseScope}),
  executeCapabilityPlan({route:{path:'TOOL',intent:'CALCULATE',capabilities:['CALCULATORS'],materiality:{engine_required:false}},message:'Calcule custo/ha.',context:context({opportunities:[{id:'opp-b',...scopedB,title:'Oportunidade secreta de B'}]}),activeContext:{type:'opportunity',id:'opp-b'},...baseScope})
 ]
 for(const execution of cases)await assert.rejects(execution,error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH')
})

test('valida escopo recursivamente em payloads e arrays de tool_result',()=>{
 const route=fastRoute('COMMERCIAL_HISTORY')
 const build=nested=>{
  const tool={status:'EXECUTED',capability:'COMMERCIAL_HISTORY',title:'Histórico',summary:'Compromisso confirmado.',context:{client_id:producer,tenant_id:tenant,context_owner_id:owner,observed_at:'2026-08-30T00:00:00Z',...nested.context},...nested.tool}
  const execution={path:'FAST',capabilities_planned:['COMMERCIAL_HISTORY'],capabilities_used:['COMMERCIAL_HISTORY'],capability_results:[{capability:'COMMERCIAL_HISTORY',status:'EXECUTED',source_ref:'commit-a',tool_result:tool}],tool_result:tool}
  return ()=>buildCapabilityExecutionResponse({execution,route,message:'Qual o compromisso?',organizationId:tenant,ownerId:owner,clientId:producer,conversationId:'thread-a'})
 }
 assert.throws(build({context:{payload:{producer_id:otherProducer,tenant_id:'tenant-evil',context_owner_id:'owner-evil'}}}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH')
 assert.throws(build({tool:{facts:{records:[{producer_id:otherProducer}]}}}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH')
 const clientTool={status:'EXECUTED',capability:'CLIENT_CONTEXT',title:'Produtor',summary:'Produtor atual: Produtor A.',context:{client_id:producer,current_client_only:true}}
 const clientExecution={path:'FAST',capabilities_planned:['CLIENT_CONTEXT'],capabilities_used:['CLIENT_CONTEXT'],capability_results:[{capability:'CLIENT_CONTEXT',status:'EXECUTED',source_ref:`client:${producer}`,tool_result:clientTool}],tool_result:clientTool}
 assert.throws(()=>buildCapabilityExecutionResponse({execution:clientExecution,route:fastRoute('CLIENT_CONTEXT'),message:'Quem é o produtor atual?',organizationId:tenant,ownerId:owner,clientId:producer,conversationId:'thread-a'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='MISSING_TENANT_SCOPE')
})

test('grounding bloqueado remove todo tool_result contaminado e performance não o reintroduz',()=>{
 const poison='DECISOR_SECRETO_DE_B'
 const route=fastRoute('CONFIRMED_MEMORY')
 const tool={status:'EXECUTED',capability:'CONFIRMED_MEMORY',title:poison,summary:`Decisor confirmado: ${poison}.`,context:{client_id:producer,tenant_id:tenant,context_owner_id:owner,source_type:'visit',epistemic_type:'FACT',observed_at:'2026-08-30T00:00:00Z'}}
 const execution={path:'FAST',capabilities_planned:['CONFIRMED_MEMORY'],capabilities_used:['CONFIRMED_MEMORY'],capability_results:[{capability:'CONFIRMED_MEMORY',status:'EXECUTED',source_ref:'visit-a',tool_result:tool}],tool_result:tool}
 const response=buildCapabilityExecutionResponse({execution,route,message:'Quem decide?',organizationId:tenant,ownerId:owner,clientId:producer,conversationId:'thread-a',now:new Date('2026-08-30T01:00:00Z')})
 assert.equal(response.advice.ai_reasoning.grounding.blocked,true)
 assert.equal(response.advice.ai_reasoning.run.tool_result,null)
 assert.equal(response.advice.ai_reasoning.run.capability_results[0].tool_result,null)
 assert.equal(response.advice.executive_brief.headline,'Resposta bloqueada por grounding')
 const attached=attachLatencyPerformance(response,{latency:{TOTAL:5,TTFR:3},path:'FAST',intent:'ASK_CLIENT',toolExecution:execution})
 assert.equal(attached.advice.ai_reasoning.run.tool_result,null)
 assert.equal(attached.advice.ai_reasoning.run.capability_results[0].tool_result,null)
 assert.doesNotMatch(JSON.stringify(attached),new RegExp(poison))
})

test('general guidance e session command forjados não ganham confiança pelo envelope',()=>{
 const forged=(capability,summary,sourceRef,toolContext)=>{
  const tool={status:'EXECUTED',capability,title:'Forjado',summary,context:toolContext}
  return {path:'FAST',capabilities_planned:[capability],capabilities_used:[capability],capability_results:[{capability,status:'EXECUTED',source_ref:sourceRef,tool_result:tool}],tool_result:tool}
 }
 assert.throws(()=>buildCapabilityExecutionResponse({execution:forged('GENERAL_GUIDANCE','ROI secreto do produtor B.','system:general-guidance:v1',{client_id:null}),route:{path:'FAST',intent:'ASK_GENERAL',capabilities:['GENERAL_GUIDANCE']},message:'Explique ROI.',organizationId:tenant,conversationId:'general-a'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='GENERAL_SOURCE_CONTENT_MISMATCH')
 const canonicalRoi='ROI compara o ganho líquido com o investimento: (retorno menos investimento) dividido pelo investimento. Informe período, custos e premissas para evitar uma precisão falsa.'
 assert.throws(()=>buildCapabilityExecutionResponse({execution:forged('GENERAL_GUIDANCE',canonicalRoi,'system:general-guidance:v1',{client_id:null,private_memory_used:false,payload:{secret:'B'}}),route:{path:'FAST',intent:'ASK_GENERAL',capabilities:['GENERAL_GUIDANCE']},message:'Explique ROI.',organizationId:tenant,conversationId:'general-b'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='GENERAL_SOURCE_CONTENT_MISMATCH')
 const sessionRoute={path:'FAST',intent:'FOLLOW_UP',capabilities:['SESSION_COMMAND'],session_command:{command:'SUMMARIZE',requires_previous_turn:true}}
 assert.throws(()=>buildCapabilityExecutionResponse({execution:forged('SESSION_COMMAND','Resumo secreto de B.','session:thread-a:2:SUMMARIZE',{client_id:producer,conversation_id:'thread-a',context_epoch:2,command:'SUMMARIZE',source_turn_created_at:'2026-08-30T00:00:00Z'}),route:sessionRoute,message:'Resume.',organizationId:tenant,ownerId:owner,clientId:producer,conversationId:'thread-a',contextEpoch:2}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='SESSION_SOURCE_UNVERIFIED')
})

test('atestação SESSION_COMMAND é um snapshot profundamente imutável contra TOCTOU',async()=>{
 const threadScope={tenantId:tenant,ownerId:owner,conversationId:'thread-toctou',clientId:producer,client:{id:producer,name:'Produtor A'}}
 let state=createConversationState(threadScope)
 state=advanceConversationState(state,{scope:threadScope,message:'Qual o perfil dele?',client:threadScope.client,response:{advice:{ai_reasoning:{recommended_strategy:{reading:'Perfil analítico confirmado.'},facts_used:[],decision_thesis:{THESIS:'Perfil analítico confirmado.'}}}}})
 const command=routeSessionCommand('Resume.')
 state=prepareConversationTurnState(state,{scope:threadScope,message:'Resume.',sessionCommand:command})
 const route={path:'FAST',intent:'FOLLOW_UP',direct:true,capabilities:['SESSION_COMMAND'],session_command:command,materiality:{engine_required:false}}
 const execution=await executeCapabilityPlan({route,message:'Resume.',context:{client:threadScope.client,conversationState:conversationStateContext(state),priorRecommendations:[]},clientId:producer,tenantId:tenant,ownerId:owner})
 assert.equal(Object.isFrozen(execution),true)
 assert.equal(Object.isFrozen(execution.capability_results),true)
 assert.equal(Object.isFrozen(execution.tool_result.context),true)
 assert.throws(()=>{execution.tool_result.context.payload={secret:'POISON_AFTER_ATTESTATION'}},TypeError)
 assert.throws(()=>{execution.capability_results.push({capability:'POISON'})},TypeError)
 const response=buildCapabilityExecutionResponse({execution,route,message:'Resume.',organizationId:tenant,ownerId:owner,clientId:producer,clientName:'Produtor A',conversationId:'thread-toctou',contextEpoch:state.context_epoch,contextDomain:state.current_domain})
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 assert.doesNotMatch(JSON.stringify(response),/POISON_AFTER_ATTESTATION/)
})

test('SESSION_COMMAND rejeita conversationState de outro tenant, owner, produtor, conversa ou epoch antes de ler o turno',async()=>{
 const trusted={tenantId:tenant,ownerId:owner,conversationId:'thread-session-scope',clientId:producer,client:{id:producer,name:'Produtor A'}}
 let state=createConversationState(trusted)
 state=advanceConversationState(state,{scope:trusted,message:'Qual o perfil dele?',client:trusted.client,response:{advice:{ai_reasoning:{recommended_strategy:{reading:'Resposta segura de A.'},facts_used:[],decision_thesis:{THESIS:'Resposta segura de A.'}}}}})
 const command=routeSessionCommand('Resume.')
 const route={path:'FAST',intent:'FOLLOW_UP',direct:true,capabilities:['SESSION_COMMAND'],session_command:command,materiality:{engine_required:false}}
 const poisoned=[
  [{...state,tenant_id:'tenant-b'},'TENANT_MISMATCH'],
  [{...state,owner_id:'owner-b'},'OWNER_MISMATCH'],
  [{...state,current_client:{id:otherProducer,name:'Produtor B'}},'PRODUCER_MISMATCH'],
  [{...state,conversation_id:'thread-b'},'CONVERSATION_MISMATCH'],
  [{...state,context_epoch:state.context_epoch+1},'CONTEXT_EPOCH_MISMATCH']
 ]
 for(const [rawState,reason] of poisoned){
  rawState.conversation_turns=rawState.conversation_turns.map(turn=>turn.role==='assistant'?{...turn,text:'SEGREDO TENANT B'}:turn)
  await assert.rejects(
   executeCapabilityPlan({route,message:'Resume.',context:{client:trusted.client,conversationState:rawState},clientId:producer,tenantId:tenant,ownerId:owner,conversationId:trusted.conversationId,contextEpoch:state.context_epoch}),
   error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason===reason
  )
 }
})

test('live data produtor-específico não atravessa producer/tenant/owner e global exige marker',async()=>{
 for(const capability of ['WEATHER','MARKET_COMMODITY','LABELS']){
  const route={path:'LIVE_DATA',intent:'ASK_MARKET',capabilities:[capability],materiality:{engine_required:false}}
  const record={status:'CURRENT',source:'Fonte forjada',source_ref:`${capability.toLowerCase()}:b`,observed_at:'2026-08-30T00:00:00Z',summary:'Dado secreto de B.',producer_id:otherProducer,tenant_id:'tenant-evil',context_owner_id:'owner-evil'}
  await assert.rejects(executeCapabilityPlan({route,message:'Qual o dado atual?',context:context({}),liveData:{[capability]:record},...baseScope}),error=>error.code==='CONTEXT_SCOPE_VIOLATION')
 }
 const route={path:'LIVE_DATA',intent:'ASK_MARKET',capabilities:['MARKET_COMMODITY'],materiality:{engine_required:false}}
 const globalRecord={scope:'MARKET',tenant_id:tenant,context_owner_id:owner,status:'CURRENT',source:'Mercado global',source_ref:'market:global',observed_at:'2026-08-30T00:00:00Z',summary:'Mercado da soja: cotação regional observada.'}
 for(const [candidate,reason] of [
  [{...globalRecord,scope:undefined},'MISSING_GLOBAL_SCOPE'],
  [{...globalRecord,tenant_id:undefined},'MISSING_TENANT_SCOPE'],
  [{...globalRecord,context_owner_id:undefined},'MISSING_OWNER_SCOPE'],
  [{...globalRecord,tenant_id:'tenant-b'},'TENANT_MISMATCH'],
  [{...globalRecord,context_owner_id:'owner-b'},'OWNER_MISMATCH'],
  [{...globalRecord,producer_id:producer},'GLOBAL_PRODUCER_SCOPE_CONFLICT']
 ])await assert.rejects(executeCapabilityPlan({route,message:'Como está o mercado da soja?',context:context({}),liveData:{MARKET_COMMODITY:candidate},...baseScope}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason===reason)
 const global=await executeCapabilityPlan({route,message:'Como está o mercado da soja?',context:context({}),liveData:{MARKET_COMMODITY:globalRecord},...baseScope})
 assert.deepEqual(global.capabilities_used,['MARKET_COMMODITY'])
 assert.equal(global.tool_result.context.scope,'MARKET')
 const response=buildCapabilityExecutionResponse({execution:global,route,message:'Como está o mercado da soja?',organizationId:tenant,ownerId:owner,clientId:producer,conversationId:'market-global',contextDomain:'GRAINS'})
 const evidence=response.advice.ai_reasoning.facts_used[0]
 assert.equal(evidence.scope,'MARKET')
 assert.equal(evidence.producer_id,null)
 assert.equal(evidence.tenant_id,tenant)
 assert.equal(evidence.context_owner_id,owner)
})
