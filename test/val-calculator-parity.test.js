import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildCapabilityExecutionResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {estimateRegionalHarvest,recommendPlantPopulation} from '../manual/app/agronomy-planning.ts'
import {manualNavigationProtocolVersion,normalizeManualNavigation} from '../manual/app/valor360-navigation.ts'

const root=join(import.meta.dirname,'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

const calculators=[
 ['semeadora','Regulagem de semeadora','Plantabilidade'],
 ['populacao','População ideal','Plantabilidade'],
 ['sementes','Demanda de sementes','Plantabilidade'],
 ['colheita','Previsão de colheita','Plantabilidade'],
 ['zoneamento','Zoneamento ZARC','Plantabilidade'],
 ['pulverizacao','Pulverização','Pulverização'],
 ['fertilizante','Fertilizantes','Fertilizantes'],
 ['reposicao','Extração e exportação','Fertilizantes'],
 ['cotacao','Cotação de insumos','Custos'],
]

test('Manual expõe exatamente as nove calculadoras canônicas, com título e grupo atuais',()=>{
 const page=read('manual/app/page.tsx')
 const start=page.indexOf('const calcCards:')
 const end=page.indexOf('const calculatorGroups',start)
 assert.ok(start>0&&end>start)
 const registry=page.slice(start,end)
 const keys=[...registry.matchAll(/key: "([a-z]+)"/g)].map(match=>match[1])
 assert.deepEqual(keys,calculators.map(([key])=>key))
 for(const [key,title,group] of calculators){
  assert.match(registry,new RegExp(`key: "${key}",[\\s\\S]{0,180}?title: "${title}",[\\s\\S]{0,360}?group: "${group}"`))
 }
 assert.equal(new Set(keys).size,9)
})

test('protocolo contextual seleciona uma calculadora canônica sem executar nem persistir por si só',()=>{
 assert.equal(manualNavigationProtocolVersion,1)
 const command=normalizeManualNavigation({
  type:'valor360:navigate',version:1,requestId:'calc-test-1',tool:'calculators',calculator:'fertilizante',
  context:{clientId:'synthetic-client',fieldId:'synthetic-field'}
 })
 assert.equal(command.page,'calculadoras')
 assert.equal(command.tool,'calculators')
 assert.equal(command.calculator,'fertilizante')
 assert.equal(command.context.clientId,'synthetic-client')
 assert.equal(command.context.fieldId,'synthetic-field')
 assert.equal(command.requestId,'calc-test-1')
})

test('router usa TOOL PATH para cálculo e o executor não inventa inputs ausentes',async()=>{
 const missingRoute=routeSystemCapability({message:'Calcule o custo por hectare.',hasClient:true})
 assert.equal(missingRoute.intent,'CALCULATE')
 assert.equal(missingRoute.path,'TOOL')
 assert.deepEqual(missingRoute.capabilities,['CALCULATORS'])
 assert.equal(missingRoute.materiality.engine_required,false)
 const missing=await executeCapabilityPlan({route:missingRoute,message:'Calcule o custo por hectare.',context:{},clientId:'synthetic-client'})
 assert.equal(missing.tool_result.status,'INPUT_REQUIRED')
 assert.deepEqual(missing.tool_result.required_inputs,['total_cost_brl','area_ha'])
 assert.deepEqual(missing.capabilities_used,[])
})

test('executor calcula custo/ha deterministicamente e mantém resultado apenas na resposta',async()=>{
 const message='Calcule custo/ha com custo total de R$ 10.000 em área de 20 ha.'
 const route=routeSystemCapability({message,hasClient:true})
 const execution=await executeCapabilityPlan({route,message,context:{},clientId:'synthetic-client'})
 assert.equal(execution.path,'TOOL')
 assert.equal(execution.tool_result.status,'EXECUTED')
 assert.deepEqual(execution.tool_result.facts,{
  total_cost:10000,
  area_ha:20,
  cost_per_ha:500,
  currency:'BRL',
  formula:'total_cost / area_ha',
 })
 assert.deepEqual(execution.capabilities_used,['CALCULATORS'])
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'synthetic-tenant',clientId:'synthetic-client',clientName:'Produtor Sintético'})
 assert.equal(response.advice.ai_reasoning.persistence_mode,'NONE')
 assert.equal(response.advice.ai_reasoning.run.path,'TOOL')
 assert.equal(response.advice.ai_reasoning.run.capabilities_used[0],'CALCULATORS')
 assert.equal(response.advice.ai_reasoning.premises.conversation_is_not_confirmed_memory,true)
})

test('motores de população e colheita continuam determinísticos e regionalizados',()=>{
 const cultivar={name:'Material sintético GMR 5,9',cycleDays:131,cycleRangeDays:[124,138],cycleClass:'Precoce',gmr:5.9}
 const population=recommendPlantPopulation({
  crop:'Soja',cultivar,plantingDate:'2026-11-15',municipality:'Município Sintético',uf:'RS',
  environment:'medio',yieldGapPercent:10,germinationPercent:90,emergencePercent:85,spacingCm:45,
 })
 assert.ok(population.finalMin<population.finalTarget&&population.finalTarget<population.finalMax)
 assert.ok(Math.abs(population.seedsPerMeter-(population.seedsPerHa*.45/10000))<0.001)
 const harvest=estimateRegionalHarvest({
  crop:'Soja',cultivar,plantingDate:'2026-11-15',municipality:'Município Sintético',uf:'RS',latitude:-28,harvestConditionDays:7,
 })
 assert.equal(harvest.centralCycleDays,harvest.baseCycleDays+harvest.regionalAdjustmentDays+harvest.municipalityAdjustmentDays+harvest.seasonAdjustmentDays+harvest.harvestConditionDays)
 assert.ok(harvest.start<harvest.central&&harvest.central<harvest.end)
})

test('Manual salva cálculos em histórico owner-scoped, separado de memória confirmada',()=>{
 const page=read('manual/app/page.tsx')
 const records=read('manual/app/records.ts')
 const calculatorBlock=page.slice(page.indexOf('async function persistCurrentCalculator'),page.indexOf('return (',page.indexOf('async function persistCurrentCalculator')))
 assert.match(calculatorBlock,/await saveRecord\(\{/)
 assert.match(calculatorBlock,/type: "calculator"/)
 assert.match(calculatorBlock,/calculator: active/)
 assert.match(calculatorBlock,/inputs: controls/)
 assert.match(records,/const currentOwner = ownerId\(\)/)
 assert.match(records,/type: RecordType/)
 const master=read('VAL_MASTER_EXPERIENCE_vNEXT.md')
 assert.match(master,/Recording the result is a separate human action/)
})

test('fontes técnicas e safety permanecem visíveis nos cálculos sensíveis',()=>{
 const nutrient=read('manual/app/NutrientRemovalCalculator.tsx')
 const page=read('manual/app/page.tsx')
 for(const source of ['Embrapa Soja','Embrapa Milho e Sorgo','Embrapa Trigo','Canola Council of Canada'])assert.match(nutrient,new RegExp(source))
 assert.match(nutrient,/profile\.source/)
 assert.match(page,/ZARC define janela e risco de semeadura — não o ciclo da cultivar/)
 assert.match(page,/Fonte técnica do material/)
 assert.match(page,/Resultados instantâneos, unidades visíveis e memória de cálculo para/)
})

test('documentação declara paridade parcial: custo/ha não equivale aos nove motores',()=>{
 const parity=read('VAL_CALCULATOR_PARITY_v1.md')
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 assert.match(parity,/execução no Copilot:\*\* parcial para custo\/ha/i)
 assert.match(parity,/não prova paridade numérica com cada uma das nove calculadoras/i)
 assert.match(diff,/Generic cost per hectare/)
 assert.match(diff,/must not be presented as parity with the nine Manual engines/i)
 assert.match(diff,/numerically compared|numeric comparison/i)
})
