import assert from 'node:assert/strict'
import test from 'node:test'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
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
 assert.equal(routeSystemCapability({message:'Qual é o preço da soja hoje?',hasClient:false}).data_path,'LIVE_DATA')
 assert.equal(routeSystemCapability({message:'Qual foi a última visita?',hasClient:true}).materiality.engine_required,false)
 assert.equal(routeSystemCapability({message:'Cruze perfil e agronomia.',hasClient:true}).materiality.engine_required,true)
})

test('vNext — comandos naturais ficam na sessão e preservam confirmação humana',()=>{
 const samples={
  'Resume.':'SUMMARIZE','Repete.':'REPEAT','Explica melhor.':'EXPLAIN','Só as Perguntas de Ouro.':'GOLDEN_QUESTIONS',
  'Agora por escrito.':'OUTPUT_TEXT','Agora fala comigo.':'OUTPUT_AUDIO','Me mostra os números.':'SHOW_NUMBERS',
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
