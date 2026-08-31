import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {AGRONOMIC_CALCULATORS,agronomicCalculatorContractVersion,executeAgronomicCalculator} from '../src/lib/agronomic-calculators.js'
import {executeCopilotCalculator,identifyAgronomicCalculator,parseAgronomicCalculatorRequest} from '../server/agronomic-calculator-adapter.js'
import {consultZarc,zarcProviderVersion,zarcSourcePage} from '../server/zarc-provider.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildCapabilityExecutionResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {classifyValContextDomain} from '../server/decision-copilot/context-selector.js'

const root=join(import.meta.dirname,'..')
const read=relative=>readFileSync(join(root,relative),'utf8')
const fixedNow=new Date('2026-08-27T12:00:00.000Z')

function zarcCsv(){
 const headers=['Nome_cultura','Cod_Ciclo','Cod_Solo','UF','municipio','Cod_Outros_Manejos','Nome_Outros_Manejos','Portaria',...Array.from({length:36},(_,index)=>`dec${index+1}`)]
 const risks=[20,30,40,...Array.from({length:33},()=>0)]
 return `${headers.join(';')}\n${['Soja','21','13','MS','dourados','1','Sequeiro','Portaria Sintética',...risks].join(';')}\n`
}

const fetchZarc=async()=>({ok:true,status:200,text:async()=>zarcCsv()})
const zarcOptions=()=>({fetchImpl:fetchZarc,now:fixedNow,cacheStore:new Map()})

const matrix=[
 ['semeadora','VAL, calcula a regulagem da semeadora: população 70000, espaçamento 45 cm, germinação 95%, sobrevivência 92%, patinagem 2%, embalagem 60000 sementes, teste 50 m, 2 linhas, circunferência da roda 2,1 m.'],
 ['populacao','VAL, calcula a população ideal de soja, cultivar Alfa, ciclo 130 dias, faixa 124 a 138 dias, plantio 15/11/2026, em Dourados/MS, ambiente médio, yield gap 10%, germinação 90%, emergência 85%, espaçamento 45 cm.'],
 ['sementes','VAL, calcula a demanda de sementes: área 120 ha, população de semeadura 300000 sementes/ha, margem técnica 3%, embalagem 200000 sementes.'],
 ['colheita','VAL, calcula a previsão de colheita de soja, cultivar Alfa, ciclo 130 dias, faixa 124 a 138 dias, plantio 15/11/2026, em Dourados/MS, ajuste de colheita 7 dias.'],
 ['zoneamento','VAL, calcula o zoneamento ZARC para soja no município Dourados, UF MS, solo AD3, grupo II.'],
 ['pulverizacao','VAL, calcula a pulverização: área 120 ha, volume de calda 100 L/ha, volume do tanque 2000 L, produto Teste, dose 1,5 L/ha.'],
 ['fertilizante','VAL, calcula fertilizante 04-28-08: área 120 ha, dose 250 kg/ha, saco 50 kg, preço R$ 3000/t, eficiência 90%.'],
 ['reposicao','VAL, calcula reposição de nutrientes para soja com produtividade 70 sc/ha pela exportação.'],
 ['cotacao','VAL, calcula cotação de insumos: produto Fertilizante, quantidade 100 sacos, preço de sistema R$ 165, desconto 5%.'],
]

test('catálogo compartilhado contém exatamente as nove calculadoras do Manual',()=>{
 assert.equal(agronomicCalculatorContractVersion,'AgronomicCalculatorAdapter.v1')
 assert.deepEqual(AGRONOMIC_CALCULATORS.map(item=>item.key),matrix.map(([key])=>key))
 assert.equal(new Set(AGRONOMIC_CALCULATORS.map(item=>item.implementation)).size,9)
})

test('Manual e Copilot executam a mesma implementação canônica e devolvem resultados equivalentes nas nove calculadoras',async t=>{
 for(const [key,message] of matrix)await t.test(key,async()=>{
  assert.equal(identifyAgronomicCalculator(message),key)
  const input=parseAgronomicCalculatorRequest(message,key)
  const direct=await executeAgronomicCalculator(key,input,{zarcProvider:payload=>consultZarc(payload,zarcOptions())})
  assert.equal(direct.status,'EXECUTED')

  const route=routeSystemCapability({message,hasClient:true})
  assert.equal(route.intent,'CALCULATE')
  assert.equal(route.path,'TOOL')
  assert.deepEqual(route.capabilities,['CALCULATORS'])
  const copilot=await executeCapabilityPlan({
   route,message,clientId:'client-parity',context:{},
   calculatorOptions:{zarcOptions:zarcOptions()},
  })
  assert.equal(copilot.tool_result.status,'EXECUTED')
  assert.equal(copilot.tool_result.calculator,key)
  assert.equal(copilot.tool_result.calculator_contract_version,agronomicCalculatorContractVersion)
  assert.deepEqual(copilot.tool_result.facts,direct.output)
  assert.deepEqual(copilot.capabilities_used,['CALCULATORS'])
  assert.equal(copilot.capability_results[0].source_ref,direct.source_ref)
 })
})

test('inputs materiais ausentes geram INPUT_REQUIRED sem fórmula ou valor inventado',async()=>{
 const result=await executeCopilotCalculator('VAL, calcula a demanda de sementes.')
 assert.equal(result.calculator,'sementes')
 assert.equal(result.status,'INPUT_REQUIRED')
 assert.deepEqual(result.required_inputs,['areaHa','populationSeedsHa','bagSeeds'])
 assert.equal(result.output,undefined)
 const legacy=await executeCopilotCalculator('Calcule o custo por hectare.')
 assert.equal(legacy.status,'INPUT_REQUIRED')
 assert.deepEqual(legacy.required_inputs,['total_cost_brl','area_ha'])
})

test('ZARC usa o provider MAPA canônico, carrega fonte/data e falha fechado',async()=>{
 const input={uf:'MS',municipality:'Dourados',crop:'soja',soil:'13',cycle:'21'}
 const result=await consultZarc(input,zarcOptions())
 assert.equal(result.provider,zarcProviderVersion)
 assert.equal(result.sourceUrl,zarcSourcePage)
 assert.equal(result.updatedAt,fixedNow.toISOString())
 assert.equal(result.safra,'2026/2027')
 assert.deepEqual(result.windows[0].decendios,[1])

 const unavailable=await executeCopilotCalculator(matrix.find(([key])=>key==='zoneamento')[1],{
  zarcOptions:{fetchImpl:async()=>({ok:false,status:503,text:async()=>''}),now:fixedNow,cacheStore:new Map()},
 })
 assert.equal(unavailable.status,'SOURCE_UNAVAILABLE')
 assert.match(unavailable.summary,/fonte oficial está temporariamente indisponível/i)
 assert.equal(unavailable.output,undefined)
})

test('cancelamento do request atravessa capability executor e interrompe o provider ZARC',async()=>{
 const message=matrix.find(([key])=>key==='zoneamento')[1]
 const route=routeSystemCapability({message,hasClient:true})
 const controller=new AbortController()
 const reason=Object.assign(new Error('request encerrado'),{name:'AbortError',code:'val_request_cancelled'})
 let providerSignal=null
 const pending=executeCapabilityPlan({
  route,message,clientId:'client-parity',context:{},signal:controller.signal,
  calculatorOptions:{zarcOptions:{now:fixedNow,cacheStore:new Map(),fetchImpl:async(url,options)=>{
   providerSignal=options.signal
   return await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))
  }}},
 })
 await new Promise(resolve=>setImmediate(resolve))
 controller.abort(reason)
 await assert.rejects(pending,error=>error===reason)
 assert.ok(providerSignal instanceof AbortSignal)
 assert.equal(providerSignal.aborted,true)
})

test('cancelamento de um waiter ZARC não contamina outro waiter do mesmo cache',async()=>{
 const input={uf:'MS',municipality:'Dourados',crop:'soja',soil:'13',cycle:'21'}
 const cacheStore=new Map()
 const firstController=new AbortController()
 const secondController=new AbortController()
 const firstReason=Object.assign(new Error('primeiro request encerrado'),{name:'AbortError',code:'val_request_cancelled'})
 let fetchCalls=0
 let providerSignal=null
 let releaseFetch
 const responsePending=new Promise(resolve=>{releaseFetch=resolve})
 const fetchImpl=async(url,options)=>{
  fetchCalls+=1
  providerSignal=options.signal
  return responsePending
 }
 const first=consultZarc(input,{fetchImpl,now:fixedNow,cacheStore,signal:firstController.signal})
 const second=consultZarc(input,{fetchImpl,now:fixedNow,cacheStore,signal:secondController.signal})
 const firstRejected=assert.rejects(first,error=>error===firstReason)
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(fetchCalls,1)
 firstController.abort(firstReason)
 await firstRejected
 assert.equal(providerSignal.aborted,false)
 releaseFetch({ok:true,status:200,text:async()=>zarcCsv()})
 const result=await second
 assert.equal(result.safra,'2026/2027')
 assert.equal(secondController.signal.aborted,false)
 assert.equal(fetchCalls,1)
})

test('resultado do cálculo fica session-only e o modelo recebe fatos estruturados, não uma fórmula para recalcular',async()=>{
 const [key,message]=matrix.find(([calculator])=>calculator==='sementes')
 assert.equal(classifyValContextDomain(message,'CALCULATE'),'AGRONOMY')
 assert.equal(classifyValContextDomain('Qual é a margem comercial desta venda?'),'COMMERCIAL')
 const route=routeSystemCapability({message,hasClient:true})
 const execution=await executeCapabilityPlan({route,message,clientId:'client-parity',tenantId:'tenant-parity',context:{}})
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:'tenant-parity',clientId:'client-parity'})
 assert.equal(key,execution.tool_result.calculator)
 assert.equal(response.advice.ai_reasoning.persistence_mode,'NONE')
 assert.equal(response.advice.ai_reasoning.run.provider,'capability-executor')
 assert.equal(response.advice.ai_reasoning.run.tool_result.facts.seedsRequired,37080000)
 assert.equal(response.advice.ai_reasoning.premises.source,'authorized_capability_execution')
 assert.equal(response.advice.ai_reasoning.premises.context_scope.domain,'AGRONOMY')
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 assert.equal(response.advice.ai_reasoning.grounding.question_relevance,'PASS')
})

test('UI direta referencia os mesmos módulos canônicos, sem segunda fórmula de população/colheita',()=>{
 const page=read('manual/app/page.tsx')
 const nutrient=read('manual/app/NutrientRemovalCalculator.tsx')
 const planning=read('manual/app/agronomy-planning.ts')
 const zarcRoute=read('manual/app/api/zarc/route.ts')
 for(const symbol of ['calculatePlanter','calculateSeedDemand','calculateSpraying','calculateFertilizer','calculateQuote'])assert.match(page,new RegExp(symbol))
 assert.match(nutrient,/calculateNutrientRemoval/)
 assert.match(planning,/canonicalEstimateRegionalHarvest/)
 assert.match(planning,/canonicalRecommendPlantPopulation/)
 assert.match(zarcRoute,/consultZarc/)
 assert.doesNotMatch(page,/const rawSeedsMeter =/)
 assert.doesNotMatch(nutrient,/coefficients\[key\] \* Math\.max/)
})
