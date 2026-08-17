import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildValueScenarios} from '../server/value-scenarios.js'

const opportunity={id:'o1',title:'Venda de valor do Efficon',stage:'Negociação',updated_at:'2026-08-16T12:00:00Z'}

test('simulação combina números confirmados em conversas diferentes sem inventar premissas',()=>{
 const context={
  opportunities:[opportunity],
  priorRecommendations:[
   {id:'q1',created_at:'2026-08-15T12:00:00Z',user_question:'A área da decisão tem 100 ha. O Efficon custa 170 reais/ha e a saca vale R$ 85.'},
   {id:'q2',created_at:'2026-08-16T12:00:00Z',user_question:'Use conservador 1 sc/ha, base 2 sc/ha e otimista 3 sc/ha.'}
  ]
 }
 const result=buildValueScenarios(context,{now:Date.parse('2026-08-17T12:00:00Z')})
 assert.equal(result.status,'calculated')
 assert.equal(result.confirmedInputs.areaHa,100)
 assert.equal(result.confirmedInputs.costPerHa,170)
 assert.equal(result.confirmedInputs.unitPrice,85)
 assert.equal(result.investmentTotal,17000)
 assert.equal(result.breakEvenPerHa,2)
 assert.deepEqual(result.scenarios.map(item=>item.unitsPerHa),[1,2,3])
 assert.equal(result.scenarios[1].netTotal,0)
 assert.equal(result.policy.generatedAssumptions,false)
 assert.ok(result.scenarios.every(item=>item.evidenceIds.length>=2))
})

test('pergunta com custo por hectare não autoriza usar a área total da fazenda',()=>{
 const context={
  client:{id:'p1',name:'Produtor',area:1200},
  opportunities:[opportunity],
  priorRecommendations:[{id:'q1',created_at:'2026-08-16T12:00:00Z',user_question:'Quero trabalhar o Efficon que custa 170 reais/ha.'}]
 }
 const result=buildValueScenarios(context)
 assert.equal(result.confirmedInputs.costPerHa,170)
 assert.equal(result.confirmedInputs.areaHa,null)
 assert.equal(result.investmentTotal,null)
 assert.ok(result.missingInputs.includes('área exata da decisão em hectares'))
 assert.ok(result.missingInputs.includes('preço confirmado da unidade de comparação'))
 assert.equal(result.scenarios.length,0)
})

test('valor estruturado da oportunidade vence texto antigo e mantém rastreabilidade',()=>{
 const context={
  opportunities:[{...opportunity,value_case:{area_ha:50,cost_per_ha:200,commodity_price_per_sack:100,scenarios:{conservative:{units_per_ha:1},base:{units_per_ha:2},optimistic:{units_per_ha:4}}}}],
  priorRecommendations:[{id:'old',created_at:'2026-07-01T12:00:00Z',user_question:'Área 10 ha, 50 reais/ha, saca a R$ 20, conservador 1 sc/ha, base 1 sc/ha e otimista 1 sc/ha.'}]
 }
 const result=buildValueScenarios(context)
 assert.equal(result.confirmedInputs.areaHa,50)
 assert.equal(result.confirmedInputs.costPerHa,200)
 assert.equal(result.confirmedInputs.unitPrice,100)
 assert.equal(result.investmentTotal,10000)
 assert.equal(result.scenarios[2].unitsPerHa,4)
 assert.match(result.confirmedInputs.inputEvidence.areaHa,/opportunity:o1:value-case/)
})

test('painel apresenta dados, ponto de equilíbrio e limite de previsão',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/ValueScenarioPanel.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 assert.match(studio,/ValueScenarioPanel/)
 assert.match(panel,/SIMULADOR DE VALOR/)
 assert.match(panel,/PONTO DE EQUILÍBRIO/)
 assert.match(panel,/Não são projeção automática da VAL/)
 assert.match(bootstrap,/valueScenarios:buildValueScenarios/)
})
