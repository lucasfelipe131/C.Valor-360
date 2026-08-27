import assert from 'node:assert/strict'
import test from 'node:test'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {buildCapabilityExecutionResponse,buildGeneralNoClientResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {reasoningPaths,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {routeSessionCommand,sessionCommands} from '../server/decision-copilot/session-command-router.js'

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
  assert.equal(routeSessionCommand(message)?.command,command,message)
  const intent=routeValIntent({message,hasClient:true})
  assert.equal(intent.session_command.command,command)
  assert.equal(intent.persistence_mode,command==='REGISTER_LAST'?'CONFIRM_REQUIRED':'NONE')
 }
 assert.equal(routeSessionCommand('Prompt expandido sobre as premissas.','EXPLAIN_WHY').command,'EXPLAIN')
 assert.equal(routeSystemCapability({message:'Prompt expandido.',sessionCommandHint:'DEEPEN',hasClient:true}).path,'DEEP')
 assert.equal(routeSystemCapability({message:'Prompt expandido.',sessionCommandHint:'SHOW_NUMBERS',hasClient:true}).path,'CONTEXT')
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

 const response=buildGeneralNoClientResponse({message,route,organizationId:'tenant-a',conversationId:'thread-catalog'})
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

 const execution=await executeCapabilityPlan({route,message,clientId:'client-a',context:{client:{id:'client-a',name:'Produtor Sintético'}}})
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
 const noClientResponse=buildGeneralNoClientResponse({message,route:noClientRoute,organizationId:'tenant-a',conversationId:'thread-no-client'})
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
 const noClientCompoundResponse=buildGeneralNoClientResponse({message:compound,route:noClientCompoundRoute,organizationId:'tenant-a',conversationId:'thread-no-client-opportunity'})
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
  const generalResponse=buildGeneralNoClientResponse({message:question,route:generalRoute,organizationId:'tenant-a',conversationId:'thread-general-concept'})
  assert.match(generalResponse.advice.answer,expected,question)
  assert.notEqual(generalResponse.advice.ai_reasoning.run.tool_result.status,'CONTEXT_REQUIRED',question)
  assert.deepEqual(generalResponse.advice.ai_reasoning.run.capabilities_used,[],question)
  assert.deepEqual(generalResponse.advice.ai_reasoning.memory_refs,[],question)
 }

 const contextualCalculation='Como calcular custo/ha desta oportunidade?'
 const contextualCalculationRoute=routeSystemCapability({message:contextualCalculation,intentHint:'ASK_AGRONOMIC',hasClient:false})
 const contextualCalculationResponse=buildGeneralNoClientResponse({message:contextualCalculation,route:contextualCalculationRoute,organizationId:'tenant-a',conversationId:'thread-contextual-calculation'})
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
 const current=await executeCapabilityPlan({route,message:'Como está o clima hoje?',liveData:{WEATHER:{status:'CURRENT',source:'Estação autorizada',source_ref:'weather-1',observed_at:'2026-08-26T10:00:00Z',summary:'Chuva observada.'}}})
 assert.deepEqual(current.capabilities_used,['WEATHER'])
 assert.equal(current.tool_result.context.source,'Estação autorizada')
})

test('vNext — foto, NutriScan e FitoScan acionam reasoning quando READY, mas não sem imagem',async()=>{
 for(const message of ['Analisa essa foto.','Roda o NutriScan.','Roda o FitoScan.']){
  const route=routeSystemCapability({message,hasClient:true,attachmentTypes:['image/jpeg']})
  assert.equal(route.path,'TOOL',message)
  const ready=await executeCapabilityPlan({route,message,clientId:'client-a',context:{client:{id:'client-a'}},attachments:[{id:'photo-a',mimeType:'image/jpeg'}]})
  assert.equal(ready.tool_result.status,'READY',message)
  assert.equal(ready.reasoning_required,true,message)
  const missing=await executeCapabilityPlan({route,message,clientId:'client-a',context:{client:{id:'client-a'}},attachments:[]})
  assert.equal(missing.tool_result.status,'INPUT_REQUIRED',message)
  assert.equal(missing.reasoning_required,false,message)
 }
})
