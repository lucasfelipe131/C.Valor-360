import assert from 'node:assert/strict'
import test from 'node:test'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {buildCapabilityExecutionResponse,buildGeneralNoClientResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {reasoningPaths,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {routeSessionCommand,sessionCommandHintMatchesMessage,sessionCommands} from '../server/decision-copilot/session-command-router.js'

const scopedFact=(id,statement)=>({id,source_ref:id,subject_client_id:'client-a',tenant_id:'tenant-a',owner_id:'owner-a',statement,epistemic_status:'SESSION_FACT'})
const completedConversation=({text,facts=[],thesis=null}={})=>({
 tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:'thread-a',context_epoch:0,current_client:{id:'client-a',name:'João'},
 current_decision_thesis:thesis?{...thesis,subject_client_id:'client-a',tenant_id:'tenant-a',owner_id:'owner-a'}:null,session_facts:facts,
 conversation_turns:[{role:'assistant',status:'completed',scope_verified:true,server_grounded:true,tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:'thread-a',context_epoch:0,subject_client_id:'client-a',text,facts,questions:[],decision_thesis:thesis?{...thesis,subject_client_id:'client-a',tenant_id:'tenant-a',owner_id:'owner-a'}:null}]
})

test('vNext — os cinco paths são explícitos e materialidade governa o uso da engine',()=>{
 assert.deepEqual(reasoningPaths,['FAST','CONTEXT','DEEP','TOOL','LIVE_DATA'])
 const cases=[
  ['FAST',{message:'Qual foi a última visita?',hasClient:true}],
  ['CONTEXT',{message:'Como abordar este produtor?',hasClient:true}],
  ['DEEP',{message:'Cruze agronomia, histórico, perfil e preço e monte a estratégia.',hasClient:true}],
  ['TOOL',{message:'Abra o mapeamento da área.',hasClient:true}],
  ['LIVE_DATA',{message:'Como está o clima hoje?',hasClient:false}]
 ]
 for(const [expected,input] of cases){
  const route=routeSystemCapability(input)
  assert.equal(route.path,expected,JSON.stringify(input))
  assert.equal(typeof route.materiality.engine_required,'boolean')
  assert.match(route.materiality.question,/mudar materialmente/i)
 }
 assert.equal(routeSystemCapability({message:'Qual é o preço da soja hoje?',hasClient:false}).path,'LIVE_DATA')
 assert.equal(routeSystemCapability({message:'Qual é o preço da soja hoje?',hasClient:false}).data_path,'LIVE_DATA')
 assert.equal(routeSystemCapability({message:'Qual foi a última visita?',hasClient:true}).materiality.engine_required,false)
 assert.equal(routeSystemCapability({message:'Cruze perfil e agronomia.',hasClient:true}).materiality.engine_required,true)
})

test('vNext — comandos naturais ficam na sessão e preservam confirmação humana',()=>{
 const samples={
  'Resume.':'SUMMARIZE','Repete.':'REPEAT','Explica melhor.':'EXPLAIN','Só as Perguntas de Ouro.':'GOLDEN_QUESTIONS','Só me manda as Perguntas de Ouro.':'GOLDEN_QUESTIONS',
  'Agora por escrito.':'OUTPUT_TEXT','Agora fala comigo.':'OUTPUT_AUDIO','Agora fala elas pra mim.':'OUTPUT_AUDIO','Me mostra os números.':'SHOW_NUMBERS',
  'Registra.':'REGISTER_LAST','Não registra.':'DO_NOT_REGISTER','Aprofunda.':'DEEPEN','Só o essencial.':'BRIEF'
 }
 assert.equal(sessionCommands.length,11)
 for(const [message,command] of Object.entries(samples)){
  const sessionCommand=routeSessionCommand(message)
  assert.equal(sessionCommand?.command,command,message)
  assert.equal(sessionCommand?.deterministic_follow_up,['EXPLAIN','SHOW_NUMBERS'].includes(command),message)
  const intent=routeValIntent({message,hasClient:true})
  assert.equal(intent.session_command.command,command)
  assert.equal(intent.persistence_mode,command==='REGISTER_LAST'?'CONFIRM_REQUIRED':'NONE')
 }
 assert.equal(routeSessionCommand('Explique por que chegou à última recomendação.','EXPLAIN_WHY').command,'EXPLAIN')
 assert.equal(routeSessionCommand('Por quê?').command,'EXPLAIN')
 assert.equal(routeSystemCapability({message:'Aprofunde a última leitura usando apenas os fatos confirmados desta conversa.',sessionCommandHint:'DEEPEN',hasClient:true}).path,'DEEP')
 assert.equal(routeSystemCapability({message:'Mostre os números materiais da última leitura usando apenas os fatos confirmados desta conversa.',sessionCommandHint:'SHOW_NUMBERS',hasClient:true}).path,'FAST')
 assert.equal(routeSystemCapability({message:'Por quê?',hasClient:true}).path,'FAST')
 assert.equal(sessionCommandHintMatchesMessage('qual o perfil dele?','SUMMARIZE'),false)
 assert.equal(routeSessionCommand('qual o perfil dele?','SUMMARIZE'),null)
 const profileWithForgedSummary=routeValIntent({message:'qual o perfil dele?',sessionCommandHint:'SUMMARIZE',hasClient:true})
 assert.equal(profileWithForgedSummary.session_command,null)
 assert.equal(routeSystemCapability({message:'qual o perfil dele?',sessionCommandHint:'SUMMARIZE',hasClient:true}).data_path,'BEHAVIORAL_PROFILE')
 assert.equal(routeSystemCapability({message:'Como devo abordar ele?',hasClient:true}).data_path,'BEHAVIORAL_PROFILE')
})

test('vNext — EXPLAIN reutiliza tese, fatos e resposta da sessão sem contexto completo ou modelo',async()=>{
 const message='Explica melhor.'
 const sessionCommand=routeSessionCommand(message)
 const route={path:'FAST',intent:'FOLLOW_UP',direct:true,capabilities:['SESSION_COMMAND'],session_command:sessionCommand,materiality:{engine_required:false}}
 const context={
 client:{id:'client-a',name:'João'},
  conversationState:completedConversation({
   text:'Eu não começaria por preço. Primeiro confirmaria o valor percebido.',
   thesis:{thesis:'Eu não começaria por preço',uncertainty:'O critério de valor ainda não foi confirmado',next_action:'Validar o foco em nutrição'},
   facts:[scopedFact('fact-area','João cultiva 420 ha'),scopedFact('fact-objection','A objeção confirmada na última visita foi preço')]
  }),
  priorRecommendations:[]
 }
 const execution=await executeCapabilityPlan({route,message,context,clientId:'client-a'})
 assert.deepEqual(execution.capabilities_used,['SESSION_COMMAND'])
 assert.equal(execution.reasoning_required,false)
 assert.equal(execution.tool_result.status,'EXECUTED')
 assert.equal(execution.tool_result.context.deterministic_follow_up,true)
 assert.equal(execution.tool_result.context.full_context_required,false)
 assert.equal(execution.tool_result.context.model_required,false)
 assert.equal(execution.tool_result.context.reused_thesis,true)
 assert.equal(execution.tool_result.context.reused_fact_count,2)
 assert.match(execution.tool_result.summary,/A leitura anterior foi: Eu não começaria por preço\./)
 assert.match(execution.tool_result.summary,/João cultiva 420 ha/)
 assert.match(execution.tool_result.summary,/objeção confirmada na última visita foi preço/)
 assert.match(execution.tool_result.summary,/principal incerteza.*critério de valor/i)
 assert.match(execution.tool_result.summary,/ação indicada.*foco em nutrição/i)

 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'João',conversationId:'thread-a',contextEpoch:0})
 assert.equal(response.route,'FAST')
 assert.equal(response.engineMode,'rules')
 assert.equal(response.responseMetadata.executionBudget.modelCalls,0)
 assert.equal(response.advice.ai_reasoning.run.model_call_count,0)
 assert.equal(response.advice.answer,execution.tool_result.summary)
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 assert.deepEqual(response.advice.ai_reasoning.facts_used.map(item=>({id:item.id,sourceType:item.source_type,evidenceType:item.evidence_type,producerId:item.producer_id,tenantId:item.tenant_id,ownerId:item.owner_id,observedAt:Boolean(item.observed_at)})),[
  {id:'session:thread-a:0:EXPLAIN',sourceType:'conversation_turn',evidenceType:'INFERENCE',producerId:'client-a',tenantId:'tenant-a',ownerId:'owner-a',observedAt:true}
 ])
 assert.deepEqual(response.advice.ai_reasoning.premises.context_scope,{tenant_id:'tenant-a',owner_id:'owner-a',producer_id:'client-a',conversation_id:'thread-a',context_epoch:0,domain:'GENERAL'})
})

test('vNext — rótulo neutro do EXPLAIN não libera ação cross-domain em PROFILE',async()=>{
 const message='Por quê?'
 const route={path:'FAST',intent:'FOLLOW_UP',direct:true,capabilities:['SESSION_COMMAND'],session_command:routeSessionCommand(message),materiality:{engine_required:false}}
 const context={client:{id:'client-a',name:'João'},conversationState:completedConversation({
  text:'Perfil principal: Conservador. Confiança: alta. Como abordar: confirme o critério de decisão com evidência.',
  facts:[scopedFact('profile-evidence','João decide comparando evidências.')],
  thesis:{
   thesis:'Perfil principal: Conservador',
   uncertainty:'Validar se a preferência continua atual',
   next_action:'Trave o contrato de grãos hoje'
  }
 })}
 const execution=await executeCapabilityPlan({route,message,context,clientId:'client-a'})
 const response=buildCapabilityExecutionResponse({
  execution,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'João',
  conversationId:'thread-a',contextEpoch:0,contextDomain:'PROFILE',now:new Date('2026-08-30T12:00:00.000Z')
 })
 assert.equal(response.advice.ai_reasoning.grounding.passed,false)
 assert.equal(response.advice.ai_reasoning.grounding.blocked,true)
 assert.ok(response.advice.ai_reasoning.grounding.unsupported_terms.includes('UNSUPPORTED_CROSS_DOMAIN_CLAIM'))
 assert.equal(response.advice.answer,'Não há evidência verificável suficiente nesta execução para responder com segurança.')
 assert.doesNotMatch(response.advice.answer,/contrato|grãos|trave/i)
})

test('vNext — SHOW_NUMBERS devolve somente fatos numéricos já presentes na sessão',async()=>{
 const message='Me mostra os números.'
 const sessionCommand=routeSessionCommand(message)
 const route={path:'FAST',intent:'FOLLOW_UP',direct:true,capabilities:['SESSION_COMMAND'],session_command:sessionCommand,materiality:{engine_required:false}}
 const context={conversationState:completedConversation({
  text:'A leitura anterior combinou área, preço e nutrição.',
  facts:[scopedFact('fact-area','João cultiva 420 ha'),scopedFact('fact-price','A proposta anterior foi de R$ 175 por hectare'),scopedFact('fact-focus','O foco atual é nutrição')]
 }),priorRecommendations:[]}
 const execution=await executeCapabilityPlan({route,message,context,clientId:'client-a'})
 assert.deepEqual(execution.capabilities_used,['SESSION_COMMAND'])
 assert.equal(execution.reasoning_required,false)
 assert.equal(execution.tool_result.status,'EXECUTED')
 assert.deepEqual(execution.tool_result.facts.numeric_facts,['João cultiva 420 ha','A proposta anterior foi de R$ 175 por hectare'])
 assert.match(execution.tool_result.summary,/420 ha/)
 assert.match(execution.tool_result.summary,/R\$ 175 por hectare/)
 assert.doesNotMatch(execution.tool_result.summary,/O foco atual é nutrição/)

 const noNumbers=await executeCapabilityPlan({route,message,clientId:'client-a',context:{conversationState:completedConversation({text:'Primeiro eu validaria a necessidade.',facts:[scopedFact('fact-focus-2','O foco atual é nutrição')]}),priorRecommendations:[]}})
 assert.deepEqual(noNumbers.capabilities_used,[])
 assert.equal(noNumbers.tool_result.status,'NO_DATA')
 assert.deepEqual(noNumbers.tool_result.facts.numeric_facts,[])
 assert.match(noNumbers.tool_result.summary,/Não há fatos numéricos estruturados/)
})

test('vNext — status NO_DATA não libera summary contaminado pelo grounding',()=>{
 const message='Qual o perfil dele?'
 const route={path:'FAST',intent:'ASK_CLIENT',direct:true,capabilities:['CLIENT_CONTEXT'],materiality:{engine_required:false}}
 const execution={
  path:'FAST',capabilities_planned:['CLIENT_CONTEXT'],capabilities_used:[],capability_results:[],
  tool_result:{status:'NO_DATA',capability:'CLIENT_CONTEXT',summary:'Não há dados suficientes. Ele quer travar um contrato de grãos.',required_inputs:[]}
 }
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'João',conversationId:'thread-a',contextEpoch:0,contextDomain:'PROFILE'})
 assert.equal(response.advice.ai_reasoning.grounding.passed,false)
 assert.equal(response.advice.ai_reasoning.grounding.blocked,true)
 assert.equal(response.advice.answer,'Não há evidência verificável suficiente nesta execução para responder com segurança.')
 assert.doesNotMatch(response.advice.answer,/contrato|gr[aã]os/i)

 const commaPoison={...execution,tool_result:{...execution.tool_result,summary:'Nenhum dado foi localizado, porém ele quer travar um contrato de grãos.'}}
 const commaResponse=buildCapabilityExecutionResponse({execution:commaPoison,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'João',conversationId:'thread-a',contextEpoch:0,contextDomain:'PROFILE'})
 assert.equal(commaResponse.advice.ai_reasoning.grounding.passed,false)
 assert.doesNotMatch(commaResponse.advice.answer,/contrato|gr[aã]os/i)
})

test('vNext — SAFE_NO_DATA não mascara atributo individual em pontuações alternativas',()=>{
 const message='Qual o perfil dele?'
 const route={path:'FAST',intent:'ASK_CLIENT',direct:true,capabilities:['CLIENT_CONTEXT'],materiality:{engine_required:false}}
 const poisons=[
  'Nenhum dado foi localizado, Matheus é analítico.',
  'Nenhum dado foi localizado — perfil analítico confirmado.',
  'Nenhum dado foi localizado, com perfil analítico.',
  'Nenhum dado foi localizado (perfil analítico).',
  'Não há dados suficientes, dívida oculta existente.'
 ]
 for(const summary of poisons){
  const execution={path:'FAST',capabilities_planned:['CLIENT_CONTEXT'],capabilities_used:[],capability_results:[],tool_result:{status:'NO_DATA',capability:'CLIENT_CONTEXT',summary,required_inputs:[]}}
  const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'Matheus',conversationId:'thread-a',contextEpoch:0,contextDomain:'PROFILE'})
  assert.equal(response.advice.ai_reasoning.grounding.passed,false,summary)
  assert.equal(response.advice.ai_reasoning.grounding.blocked,true,summary)
  assert.equal(response.advice.answer,'Não há evidência verificável suficiente nesta execução para responder com segurança.',summary)
  assert.doesNotMatch(response.advice.answer,/analítico|dívida/i,summary)
 }
})

test('vNext — capability nunca reetiqueta contexto de outro produtor',async()=>{
 const route={path:'FAST',intent:'ASK_CLIENT',direct:true,capabilities:['CLIENT_CONTEXT'],materiality:{engine_required:false}}
 await assert.rejects(()=>executeCapabilityPlan({route,message:'Quem é o produtor atual?',clientId:'client-a',context:{client:{id:'client-b',name:'Produtor B'}}}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH')
 const execution={path:'FAST',capabilities_planned:['CLIENT_CONTEXT'],capabilities_used:['CLIENT_CONTEXT'],capability_results:[{capability:'CLIENT_CONTEXT',status:'EXECUTED',source_ref:'client:client-b',tool_result:{status:'EXECUTED',capability:'CLIENT_CONTEXT',summary:'Produtor atual: Produtor B.',context:{client_id:'client-b',current_client_only:true}}}],tool_result:{status:'EXECUTED',capability:'CLIENT_CONTEXT',summary:'Produtor atual: Produtor B.',context:{client_id:'client-b',current_client_only:true}}}
 assert.throws(()=>buildCapabilityExecutionResponse({execution,route,message:'Quem é o produtor atual?',organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'Produtor A',conversationId:'thread-a'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_MISMATCH')
})

test('vNext — source binding falha fechado para SESSION, CLIENT_CONTEXT e source reservado forjados',()=>{
 const build=(execution,route,message='Consulta factual.')=>buildCapabilityExecutionResponse({
  execution,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'Produtor A',conversationId:'thread-a',contextEpoch:3
 })
 const execution=(capability,sourceRef,context)=>{
  const tool={status:'EXECUTED',capability,summary:'Resultado factual confirmado.',context}
  return {path:'FAST',capabilities_planned:[capability],capabilities_used:[capability],capability_results:[{capability,status:'EXECUTED',source_ref:sourceRef,tool_result:tool}],tool_result:tool}
 }

 const sessionRoute={path:'FAST',intent:'FOLLOW_UP',capabilities:['SESSION_COMMAND'],session_command:{command:'SUMMARIZE',requires_previous_turn:true}}
 assert.throws(
  ()=>build(execution('SESSION_COMMAND','session:thread-b:3:SUMMARIZE',{client_id:'client-a',conversation_id:'thread-a',context_epoch:3,command:'SUMMARIZE',source_turn_created_at:'2026-08-30T10:00:00.000Z'}),sessionRoute,'Resume.'),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='SESSION_SOURCE_UNVERIFIED'
 )

 const clientRoute={path:'FAST',intent:'ASK_CLIENT',capabilities:['CLIENT_CONTEXT']}
 assert.throws(
  ()=>build(execution('CLIENT_CONTEXT','client:client-b',{client_id:'client-a',current_client_only:true}),clientRoute,'Quem é o produtor atual?'),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='CLIENT_SOURCE_REF_MISMATCH'
 )

 const memoryRoute={path:'FAST',intent:'ASK_CLIENT',capabilities:['CONFIRMED_MEMORY']}
 assert.throws(
  ()=>build(execution('CONFIRMED_MEMORY','system:general-guidance:v1',{client_id:'client-a',source_type:'visit_report',epistemic_type:'FACT',observed_at:'2026-08-29T10:00:00.000Z'}),memoryRoute),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='RESERVED_SOURCE_REF_MISMATCH'
 )
})

test('vNext — provenance original é materializada sem timestamp ou tipo sintético',async()=>{
 const message='Qual é o decisor confirmado?'
 const route={path:'FAST',intent:'ASK_CLIENT',direct:true,capabilities:['CONFIRMED_MEMORY'],materiality:{engine_required:false}}
 const execution=await executeCapabilityPlan({
  route,message,clientId:'client-a',
  context:{client:{id:'client-a',name:'João'},memories:[{
   id:'memory-decider',status:'verified',memory_state:'FACT',key:'decision_maker',value:{decision_maker:'Maria'},
   producer_id:'client-a',tenant_id:'tenant-a',owner_id:'owner-a',
   source_type:'visit_report',epistemic_type:'FACT',observed_at:'2026-08-20T10:00:00.000Z',valid_until:'2027-08-20T10:00:00.000Z'
  }]}
 })
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'tenant-a',ownerId:'owner-a',clientId:'client-a',clientName:'João',conversationId:'thread-a',now:new Date('2026-08-30T12:00:00.000Z'),contextDomain:'GENERAL'})
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 assert.equal(response.advice.ai_reasoning.facts_used.length,1)
 const fact=response.advice.ai_reasoning.facts_used[0]
 assert.deepEqual({
  id:fact.id,sourceRef:fact.source_ref,sourceType:fact.source_type,epistemicType:fact.epistemic_type,evidenceType:fact.evidence_type,
  producerId:fact.producer_id,tenantId:fact.tenant_id,ownerId:fact.owner_id,observedAt:fact.observed_at,validUntil:fact.valid_until,
  statement:fact.statement,capability:fact.capability
 },{
  id:'memory-decider',sourceRef:'memory-decider',sourceType:'visit_report',epistemicType:'FACT',evidenceType:'FACT',
  producerId:'client-a',tenantId:'tenant-a',ownerId:'owner-a',observedAt:'2026-08-20T10:00:00.000Z',validUntil:'2027-08-20T10:00:00.000Z',
  statement:'Decisor confirmado: Maria.',capability:'CONFIRMED_MEMORY'
 })
})

test('vNext — live data conserva o timestamp da fonte e bloqueia registro stale',()=>{
 const route={path:'LIVE_DATA',intent:'ASK_MARKET',direct:true,capabilities:['MARKET_COMMODITY'],materiality:{engine_required:false}}
 const tool={status:'EXECUTED',capability:'MARKET_COMMODITY',summary:'Soja cotada a R$ 100 por saca.',context:{scope:'MARKET',producer_id:null,tenant_id:'tenant-a',context_owner_id:'owner-a',current_data_required:true,observed_at:'2020-01-01T12:00:00.000Z',source:'Fonte antiga'}}
 const execution={path:'LIVE_DATA',capabilities_planned:['MARKET_COMMODITY'],capabilities_used:['MARKET_COMMODITY'],capability_results:[{capability:'MARKET_COMMODITY',status:'EXECUTED',source_ref:'market:old',tool_result:tool}],tool_result:tool}
 const response=buildCapabilityExecutionResponse({execution,route,message:'Qual é o preço da soja hoje?',organizationId:'tenant-a',ownerId:'owner-a',conversationId:'thread-market',now:new Date('2026-08-30T12:00:00.000Z'),contextDomain:'GRAINS'})
 assert.equal(response.advice.ai_reasoning.grounding.passed,false)
 assert.deepEqual(response.advice.ai_reasoning.grounding.temporal_violations,['market:old'])
 assert.doesNotMatch(response.advice.answer,/R\$ 100/)
})

test('vNext — linguagem natural seleciona ferramentas sem converter planned em used',async()=>{
 const routes=[
  ['VAL, abre o mapeamento do João.','AREA_MAPPING','ASK_AGRONOMIC'],
  ['Interpreta essa análise.','SOIL_ANALYSIS','ANALYZE_SOIL'],
  ['Roda essa calculadora.','CALCULATOR','CALCULATE'],
  ['Me mostra o FitScan.','FITOSCAN','IMAGE_DIAGNOSIS'],
  ['Me mostra o NutriScan.','NUTRISCAN','IMAGE_DIAGNOSIS'],
  ['Analisa essa foto.','PHOTO_DIAGNOSIS','IMAGE_DIAGNOSIS']
 ]
 for(const [message,tool,intent] of routes){const routed=routeValIntent({message,hasClient:true});assert.equal(routed.tool_hint,tool,message);assert.equal(routed.intent,intent,message)}
 for(const [message,tool,intent] of routes){
  const routed=routeValIntent({message,intentHint:'ASK_AGRONOMIC',hasClient:true})
  assert.equal(routed.tool_hint,tool,`${message} com hint do hero`)
  assert.equal(routed.intent,intent,`${message} com hint do hero`)
  assert.equal(routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:true}).path,'TOOL',`${message} com hint do hero`)
 }

 const route=routeSystemCapability({message:'Calcule custo/ha.',hasClient:true})
 const execution=await executeCapabilityPlan({route,message:'Calcule custo/ha.',clientId:'client-a',context:{client:{id:'client-a'}}})
 assert.deepEqual(execution.capabilities_used,[])
 assert.equal(execution.tool_result.status,'INPUT_REQUIRED')
 assert.deepEqual(execution.tool_result.required_inputs,['total_cost_brl','area_ha'])
 assert.equal(execution.capability_results[0].status,'INPUT_REQUIRED')

 const calculated=await executeCapabilityPlan({route,message:'Calcule custo/ha: custo total R$ 15.000 em 100 ha.',clientId:'client-a',context:{client:{id:'client-a'}}})
 assert.deepEqual(calculated.capabilities_used,['CALCULATORS'])
 assert.equal(calculated.tool_result.facts.cost_per_ha,150)
 assert.equal(calculated.tool_result.page,'agro')
 assert.equal(calculated.tool_result.manual_page,'calculadoras')
})

test('vNext — catálogo agronômico responde com ou sem produtor pelo FAST determinístico',async()=>{
 const message='Quais ferramentas agronômicas posso usar aqui? Resuma.'
 const intent=routeValIntent({message,intentHint:'ASK_AGRONOMIC',hasClient:false})
 assert.equal(intent.intent,'ASK_AGRONOMIC')
 assert.equal(intent.tool_hint,'AGRONOMIC_TOOL_CATALOG')
 assert.equal(intent.client_context_required,false)

 const route=routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:false})
 assert.equal(route.path,'FAST')
 assert.equal(route.direct,true)
 assert.equal(route.client_context_required,false)
 assert.equal(route.materiality.engine_required,false)
 assert.deepEqual(route.capabilities,['AGRONOMIC_WORKSPACE'])

 const response=await buildGeneralNoClientResponse({message,route,organizationId:'tenant-a',conversationId:'thread-catalog'})
 const reasoning=response.advice.ai_reasoning
 assert.match(response.advice.answer,/mapeamento de áreas/i)
 assert.match(response.advice.answer,/NutriScan e FitoScan/)
 assert.match(response.advice.answer,/Manual e Biblioteca/)
 assert.match(response.advice.answer,/exigem fonte atual autorizada/)
 assert.match(response.advice.answer,/dependem de UAT físico e agronômico/)
 assert.doesNotMatch(response.advice.answer,/Informe a cultura/i)
 assert.deepEqual(reasoning.run.capabilities_used,['AGRONOMIC_WORKSPACE'])
 assert.equal(reasoning.run.tool_result.status,'CATALOG')
 assert.equal(reasoning.run.tool_result.available_tools.some(item=>item.capability==='CALCULATORS'),true)
 assert.equal(reasoning.run.tool_result.available_tools.find(item=>item.capability==='LABELS').availability,'CURRENT_SOURCE_REQUIRED')
 assert.equal(reasoning.run.tool_result.available_tools.find(item=>item.capability==='FITOSCAN').integration_state,'PARTIAL')
 assert.equal(reasoning.run.tool_result.available_tools.find(item=>item.capability==='IMAGE_DIAGNOSIS').integration_state,'PARTIAL')
 assert.doesNotMatch(response.advice.answer,/Posso abrir cada módulo pelo nome/i)
 assert.equal(reasoning.decision_interview.status,'NOT_NEEDED')
 assert.deepEqual(reasoning.memory_refs,[])
 assert.equal(reasoning.persistence_mode,'NONE')

 const clientRoute=routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(clientRoute.path,'FAST')
 assert.equal(clientRoute.client_context_required,false)
 const clientExecution=await executeCapabilityPlan({route:clientRoute,message,clientId:'client-a',context:{client:{id:'client-a',name:'Produtor Sintético'}}})
 const clientResponse=buildCapabilityExecutionResponse({execution:clientExecution,route:clientRoute,message,organizationId:'tenant-a',clientId:'client-a',clientName:'Produtor Sintético',conversationId:'thread-client-catalog'})
 assert.equal(clientResponse.advice.answer,response.advice.answer)
 assert.deepEqual(clientResponse.advice.ai_reasoning.run.capabilities_used,['AGRONOMIC_WORKSPACE'])
 assert.equal(clientResponse.advice.ai_reasoning.premises.profile_specific,false)
 assert.equal(clientResponse.advice.ai_reasoning.decision_interview.status,'NOT_NEEDED')
 assert.equal(clientResponse.advice.ai_reasoning.persistence_mode,'NONE')
})

test('vNext — identidade do produtor atual ignora hint agronômico e não abre entrevista',async()=>{
 const message='Confirme em uma linha qual é o produtor atual.'
 const intent=routeValIntent({message,intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(intent.intent,'ASK_CLIENT')
 assert.equal(intent.reason,'semantic_client_identity_override')

 const route=routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(route.intent,'ASK_CLIENT')
 assert.equal(route.path,'FAST')
 assert.equal(route.direct,true)
 assert.equal(route.materiality.engine_required,false)
 assert.deepEqual(route.capabilities,['CLIENT_CONTEXT'])

 const execution=await executeCapabilityPlan({route,message,clientId:'client-a',tenantId:'tenant-a',ownerId:'owner-a',context:{client:{id:'client-a',name:'Produtor Sintético'}}})
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'tenant-a',clientId:'client-a',clientName:'Produtor Sintético',conversationId:'thread-client'})
 const reasoning=response.advice.ai_reasoning
 assert.equal(response.advice.answer,'Produtor atual: Produtor Sintético.')
 assert.deepEqual(reasoning.run.capabilities_used,['CLIENT_CONTEXT'])
 assert.equal(reasoning.run.tool_result.context.current_client_only,true)
 assert.equal(reasoning.decision_interview.status,'NOT_NEEDED')
 assert.deepEqual(reasoning.decision_interview.questions,[])
 assert.deepEqual(reasoning.memory_refs,[])
 assert.equal(reasoning.persistence_mode,'NONE')

 const withoutAuthorizedClient=routeValIntent({message,intentHint:'ASK_AGRONOMIC',hasClient:false})
 assert.equal(withoutAuthorizedClient.intent,'ASK_CLIENT')
 const noClientRoute=routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:false})
 assert.equal(noClientRoute.path,'FAST')
 const noClientResponse=await buildGeneralNoClientResponse({message,route:noClientRoute,organizationId:'tenant-a',conversationId:'thread-no-client'})
 assert.equal(noClientResponse.advice.answer,'Nenhum produtor está selecionado nesta conversa.')
 assert.equal(noClientResponse.advice.ai_reasoning.decision_interview.status,'NOT_NEEDED')
 const missingExecution=await executeCapabilityPlan({route,message,clientId:'client-a',context:{}})
 assert.deepEqual(missingExecution.capabilities_used,[])
 assert.equal(missingExecution.tool_result.status,'NO_DATA')
 assert.doesNotMatch(missingExecution.tool_result.summary,/Produtor Sintético/)

 const compound='Qual é o produtor desta conversa e quais oportunidades ele tem?'
 const compoundIntent=routeValIntent({message:compound,intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(compoundIntent.intent,'CHECK_OPPORTUNITY')
 const compoundRoute=routeSystemCapability({message:compound,intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(compoundRoute.path,'DEEP')
 assert.deepEqual(compoundRoute.capabilities,['OPPORTUNITY_PIPELINE','COMMERCIAL_HISTORY'])
 const noClientCompoundRoute=routeSystemCapability({message:compound,intentHint:'ASK_AGRONOMIC',hasClient:false})
 assert.equal(noClientCompoundRoute.client_context_required,true)
 const noClientCompoundResponse=await buildGeneralNoClientResponse({message:compound,route:noClientCompoundRoute,organizationId:'tenant-a',conversationId:'thread-no-client-opportunity'})
 assert.match(noClientCompoundResponse.advice.answer,/Nenhum produtor está selecionado/)
 assert.match(noClientCompoundResponse.advice.answer,/Selecione um produtor autorizado/)
 assert.equal(noClientCompoundResponse.advice.ai_reasoning.run.tool_result.status,'CONTEXT_REQUIRED')
 assert.equal(noClientCompoundResponse.advice.ai_reasoning.run.tool_result.page,'clients')
 assert.deepEqual(noClientCompoundResponse.advice.ai_reasoning.run.capabilities_used,[])
 assert.equal(noClientCompoundResponse.advice.ai_reasoning.decision_interview.status,'NOT_NEEDED')
 assert.deepEqual(noClientCompoundResponse.advice.ai_reasoning.memory_refs,[])
 assert.equal(noClientCompoundResponse.advice.ai_reasoning.persistence_mode,'NONE')
 assert.doesNotMatch(noClientCompoundResponse.advice.answer,/Posso tratar esta dúvida sem selecionar um produtor/i)

 const generalConcepts=[
  ['O que é CTC?',/CTC representa/],
  ['O que é margem?',/diferença entre receita e custos/],
  ['O que é ROI?',/ROI compara/],
  ['Como calcular custo\/ha?',/Custo por hectare/],
  ['Qual é a importância do pH?',/acidez ou alcalinidade/]
 ]
 for(const [question,expected] of generalConcepts){
  const generalRoute=routeSystemCapability({message:question,intentHint:'ASK_AGRONOMIC',hasClient:false})
  const generalResponse=await buildGeneralNoClientResponse({message:question,route:generalRoute,organizationId:'tenant-a',conversationId:'thread-general-concept'})
  assert.match(generalResponse.advice.answer,expected,question)
  assert.notEqual(generalResponse.advice.ai_reasoning.run.tool_result.status,'CONTEXT_REQUIRED',question)
  assert.deepEqual(generalResponse.advice.ai_reasoning.run.capabilities_used,[],question)
  assert.deepEqual(generalResponse.advice.ai_reasoning.memory_refs,[],question)
 }

 const contextualCalculation='Como calcular custo/ha desta oportunidade?'
 const contextualCalculationRoute=routeSystemCapability({message:contextualCalculation,intentHint:'ASK_AGRONOMIC',hasClient:false})
 const contextualCalculationResponse=await buildGeneralNoClientResponse({message:contextualCalculation,route:contextualCalculationRoute,organizationId:'tenant-a',conversationId:'thread-contextual-calculation'})
 assert.equal(contextualCalculationResponse.advice.ai_reasoning.run.tool_result.status,'CONTEXT_REQUIRED')

 const clientAlias=routeSystemCapability({message:'Qual cliente está selecionado?',intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(clientAlias.path,'FAST')

 const realAgronomy=routeSystemCapability({message:'Qual é a principal hipótese agronômica para as manchas no talhão?',intentHint:'ASK_AGRONOMIC',hasClient:true})
 assert.equal(realAgronomy.intent,'ASK_AGRONOMIC')
 assert.equal(realAgronomy.path,'CONTEXT')
})

test('vNext — live data falha fechada sem fonte e data',async()=>{
 const route=routeSystemCapability({message:'Como está o clima hoje?',hasClient:false})
 const unavailable=await executeCapabilityPlan({route,message:'Como está o clima hoje?',liveData:{}})
 assert.deepEqual(unavailable.capabilities_used,[])
 assert.equal(unavailable.tool_result.status,'NO_DATA')
 const current=await executeCapabilityPlan({route,message:'Como está o clima hoje?',tenantId:'tenant-a',ownerId:'owner-a',liveData:{WEATHER:{scope:'MARKET',tenant_id:'tenant-a',context_owner_id:'owner-a',status:'CURRENT',source:'Estação autorizada',source_ref:'weather-1',observed_at:'2026-08-26T10:00:00Z',summary:'Chuva observada.'}}})
 assert.deepEqual(current.capabilities_used,['WEATHER'])
 assert.equal(current.tool_result.context.source,'Estação autorizada')
})

test('vNext — foto, NutriScan e FitoScan acionam reasoning quando READY, mas não sem imagem',async()=>{
 for(const message of ['Analisa essa foto.','Roda o NutriScan.','Roda o FitoScan.']){
  const route=routeSystemCapability({message,hasClient:true,attachmentTypes:['image/jpeg']})
  assert.equal(route.path,'TOOL',message)
  const ready=await executeCapabilityPlan({route,message,clientId:'client-a',tenantId:'tenant-a',ownerId:'owner-a',context:{client:{id:'client-a'}},attachments:[{id:'photo-a',clientId:'client-a',organizationId:'tenant-a',contextOwnerId:'owner-a',mimeType:'image/jpeg'}]})
  assert.equal(ready.tool_result.status,'READY',message)
  assert.equal(ready.reasoning_required,true,message)
  const missing=await executeCapabilityPlan({route,message,clientId:'client-a',context:{client:{id:'client-a'}},attachments:[]})
  assert.equal(missing.tool_result.status,'INPUT_REQUIRED',message)
  assert.equal(missing.reasoning_required,false,message)
 }
})

test('vNext — fallback de IA sem fonte só responde conceito geral fora da Knowledge Library, nunca prescrição ou dado vivo',async()=>{
 const mockAnswer=text=>({responses:{create:async()=>({output_text:text})}})
 const generalRoute=routeSystemCapability({message:'O que é fotossíntese?',intentHint:'ASK_GENERAL',hasClient:false})
 const withoutClient=await buildGeneralNoClientResponse({message:'O que é fotossíntese?',route:generalRoute,organizationId:'tenant-a',conversationId:'thread-ai-fallback-off',aiClient:null,aiModel:''})
 assert.notEqual(withoutClient.advice.ai_reasoning.run.tool_result?.capability,'AI_GENERAL_KNOWLEDGE')
 assert.equal(withoutClient.advice.ai_reasoning.evidence_status,undefined)

 const relevantAnswer='A fotossíntese é o processo pelo qual plantas convertem luz solar, água e CO2 em glicose e oxigênio, usando clorofila nos cloroplastos da fotossíntese.'
 const withClient=await buildGeneralNoClientResponse({message:'O que é fotossíntese?',route:generalRoute,organizationId:'tenant-a',conversationId:'thread-ai-fallback-on',aiClient:mockAnswer(relevantAnswer),aiModel:'gpt-5.6-luna'})
 assert.equal(withClient.advice.ai_reasoning.run.tool_result?.capability,'AI_GENERAL_KNOWLEDGE')
 assert.equal(withClient.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 assert.equal(withClient.advice.ai_reasoning.confidence.level,'NAO_VERIFICADO')
 assert.equal(withClient.advice.answer,relevantAnswer)

 let dosageModelCalled=false
 const dosageClient={responses:{create:async()=>{dosageModelCalled=true;return {output_text:'Isso nunca deveria ser dito.'}}}}
 const dosageRoute=routeSystemCapability({message:'Qual dose de fungicida devo aplicar no milho?',intentHint:'ASK_GENERAL',hasClient:false})
 const dosageResponse=await buildGeneralNoClientResponse({message:'Qual dose de fungicida devo aplicar no milho?',route:dosageRoute,organizationId:'tenant-a',conversationId:'thread-ai-fallback-dose',aiClient:dosageClient,aiModel:'gpt-5.6-luna'})
 assert.equal(dosageModelCalled,false)
 assert.notEqual(dosageResponse.advice.ai_reasoning.run.tool_result?.capability,'AI_GENERAL_KNOWLEDGE')

 let liveDataModelCalled=false
 const liveDataClient={responses:{create:async()=>{liveDataModelCalled=true;return {output_text:'Isso nunca deveria ser dito.'}}}}
 const liveDataRoute=routeSystemCapability({message:'Qual a cotação atual da soja hoje?',intentHint:'ASK_GENERAL',hasClient:false})
 await buildGeneralNoClientResponse({message:'Qual a cotação atual da soja hoje?',route:liveDataRoute,organizationId:'tenant-a',conversationId:'thread-ai-fallback-live',aiClient:liveDataClient,aiModel:'gpt-5.6-luna'})
 assert.equal(liveDataModelCalled,false)

 let coveredModelCalled=false
 const coveredClient={responses:{create:async()=>{coveredModelCalled=true;return {output_text:'Isso nunca deveria ser dito.'}}}}
 const coveredRoute=routeSystemCapability({message:'O que é CTC?',intentHint:'ASK_GENERAL',hasClient:false})
 const coveredResponse=await buildGeneralNoClientResponse({message:'O que é CTC?',route:coveredRoute,organizationId:'tenant-a',conversationId:'thread-ai-fallback-covered',aiClient:coveredClient,aiModel:'gpt-5.6-luna'})
 assert.equal(coveredModelCalled,false)
 assert.match(coveredResponse.advice.answer,/CTC representa/)
})

test('vNext — cumprimento puro responde direto sem cair no bloqueio de evidência',async()=>{
 for(const message of ['oi','Oi','olá','ola','opa','bom dia','boa tarde','boa noite','tudo bem?','tudo bem','eae','hey','hello','oii']){
  const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
  const response=await buildGeneralNoClientResponse({message,route,organizationId:'tenant-a',conversationId:'thread-greeting'})
  assert.equal(response.advice.ai_reasoning.run.tool_result?.status,'EXECUTED',message)
  assert.doesNotMatch(response.advice.answer,/Não há evidência/,message)
  assert.match(response.advice.answer,/posso ajudar/i,message)
 }
 const stillGated=routeSystemCapability({message:'Preparar visita',intentHint:'ASK_GENERAL',hasClient:false})
 const gatedResponse=await buildGeneralNoClientResponse({message:'Preparar visita',route:stillGated,organizationId:'tenant-a',conversationId:'thread-greeting-control'})
 assert.equal(gatedResponse.advice.ai_reasoning.run.tool_result?.status,'CONTEXT_REQUIRED')
})
