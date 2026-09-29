import test from 'node:test'
import assert from 'node:assert/strict'
import {executeCopilotCalculator} from '../server/agronomic-calculator-adapter.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {requiresVerifiedGeneralSource} from '../server/knowledge/general-answer-provider.js'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {registeredFactQuery,registeredFactPresentation} from '../server/registered-fact-query.js'
for(const [rate,area] of [[35,40],[81.5,12.5],[0,40],[1250,8]])test(`cost dimensions: rate ${rate} times area ${area}`,async()=>{
 const message=`O serviço custa R$ ${String(rate).replace('.',',')} por hectare em ${String(area).replace('.',',')} hectares. Qual o custo total?`
 const r=await executeCopilotCalculator(message)
 assert.equal(r.calculator,'total_cost');assert.equal(r.output.total_cost,Math.round(rate*area*100)/100);assert.equal(r.output.formula,'cost_per_ha * area_ha');assert.match(r.summary,/Custo total calculado/)
})
test('total divided by area remains distinct, including zero',async()=>{
 for(const total of [0,4680,36000]){
  const r=await executeCopilotCalculator(`Calcule custo/ha com custo total de R$ ${total.toLocaleString('pt-BR')} em área de 20 ha.`)
  assert.equal(r.calculator,'cost_per_ha');assert.equal(r.output.cost_per_ha,total/20)
 }
})
test('arbitrary prices, multiple operands and unit rates never become total costs',async()=>{
 for(const message of ['Simule receita de 50 sc/ha em 80 ha a R$ 105/sc.','Custo R$ 25/ha, receita R$ 80/ha, área 10 ha; qual o resultado?','Custo R$ 25 por hectare em 10 hectares. Qual o preço de equilíbrio?','Custo total R$ 300 em 0 ha; quanto por hectare?'])assert.notEqual((await executeCopilotCalculator(message)).status,'EXECUTED',message)
})
test('live market references use market capability, not a product-label refusal',()=>{
 for(const crop of ['milho','trigo','arroz']){
  const r=routeSystemCapability({message:`Traga uma referência de ${crop} para hoje com fonte e horário.`})
  assert.equal(r.intent,'ASK_COMMODITY');assert.deepEqual(r.capabilities,['MARKET_COMMODITY'])
 }
})
test('market evidence methodology is general, while a mixed current-value request is not exempt',()=>{
 for(const message of ['Uma cotação de porto pode ser usada como preço líquido na fazenda?','Duas fontes divergem hoje; quais campos precisam ser comparados?','Recebi um preço sem horário: isso basta para afirmar que o mercado subiu?','Como devo apresentar uma captura de preço antiga sem chamá-la de atual?']){
  assert.equal(routeSystemCapability({message}).intent,'ASK_GENERAL',message);assert.equal(requiresVerifiedGeneralSource(message),false,message)
 }
 assert.equal(requiresVerifiedGeneralSource('Quais campos comparar? Traga o preço da soja hoje.'),true)
 assert.equal(routeSystemCapability({message:'Como está o clima em Cascavel hoje?'}).intent,'CHECK_WEATHER')
 for(const message of ['Por que clima e hospedeiro importam numa epidemia?','Qual a diferença entre clima e tempo meteorológico?'])assert.equal(routeSystemCapability({message}).intent,'ASK_GENERAL')
})
test('safety/source requirements survive conceptual evidence exception',()=>{
 for(const message of ['Quais campos comparar hoje? Recomende qual fungicida devo aplicar.','Duas fontes divergem hoje; quais campos comparar e posso misturar herbicida com inseticida?','Qual a cotação atual da soja?','Qual dose do produto aplicar?'])assert.equal(requiresVerifiedGeneralSource(message),true,message)
})
test('non-person indefinite objects and operations do not trigger producer lookup',()=>{
 for(const message of ['Encontrar um inseto na lavoura justifica controle?','Que verificações vêm antes de retomar a pulverização?'])assert.equal(extractNaturalClientReference(message).kind,'NONE')
 assert.equal(extractNaturalClientReference('Quero encontrar João').kind,'EXPLICIT_NAME')
})
test('contact lookup preserves origin, missing state and avoids behavioral inference',()=>{
 const query=registeredFactQuery('Qual canal de contato foi registrado e qual a origem do dado?')
 assert.equal(query.kind,'contact_channel')
 const a=registeredFactPresentation({query,client:{id:'a',name:'Pessoa A',servicePreference:'Telefone',source:'cadastro sintético'}})
 assert.match(a.answer,/Telefone/);assert.match(a.answer,/cadastro sintético/);assert.doesNotMatch(a.answer,/confirmado/)
 const b=registeredFactPresentation({query,client:{id:'b',name:'Pessoa B',primaryProfile:'Digital'}})
 assert.equal(b.capabilityStatus,'NO_DATA');assert.doesNotMatch(b.answer,/Telefone/)
})
test('time adverbs and diagnostic evidence questions are not prescriptions',()=>{
 for(const message of ['Uma preferência declarada hoje prevalece sobre um perfil antigo?','Quais perguntas de diagnóstico devo registrar sem recomendar produto?','Por que um diagnóstico visual continua sendo hipótese?','Como preparar uma conversa sem prescrever antes do diagnóstico?'])assert.equal(requiresVerifiedGeneralSource(message),false,message)
 for(const message of ['Quais perguntas de diagnóstico e qual dose devo usar?','Diagnostique a doença desta lavoura e prescreva o produto.','Qual a notícia do mercado hoje?'])assert.equal(requiresVerifiedGeneralSource(message),true,message)
})
test('supplied dimensional arithmetic covers production, mass conversion and both break-even directions',async()=>{
 const cases=[['Numa simulação, 20 hectares rendem 45 sacas por hectare. Qual a produção estimada em sacas?','production_sc',900],['Converta 12 toneladas em sacas de 50 kg.','bags',240],['Custo R$ 3.000 por hectare e produtividade 50 sc/ha. Qual o preço de equilíbrio?','price_brl_sc',60],['Custo R$ 3.000 por hectare e preço R$ 100 por saca. Qual a produtividade de equilíbrio?','yield_sc_ha',30]]
 for(const [message,key,expected] of cases){
  assert.equal(routeSystemCapability({message,intentHint:'ASK_GENERAL'}).intent,'CALCULATE')
  const r=await executeCopilotCalculator(message);assert.equal(r.status,'EXECUTED');assert.equal(r.output[key],expected)
 }
 for(const message of ['Custo R$ 300 por hectare e produtividade 0 sc/ha. Qual o preço de equilíbrio?','Converta 12 toneladas em sacas.'])assert.notEqual((await executeCopilotCalculator(message)).status,'EXECUTED')
})
test('decimal dot and comma stay decimal, grouping remains Brazilian',async()=>{
 for(const written of ['81.5','81,5'])assert.equal((await executeCopilotCalculator(`Custo R$ ${written} por hectare em 2 ha. Qual o custo total?`)).output.total_cost,163)
 assert.equal((await executeCopilotCalculator('Custo total R$ 1.250,50 em 10 ha. Calcule custo/ha.')).output.cost_per_ha,125.05)
 assert.equal(routeSystemCapability({message:'Por que clima influencia doenças? Traga o preço da soja hoje.'}).intent,'ASK_COMMODITY')
})
