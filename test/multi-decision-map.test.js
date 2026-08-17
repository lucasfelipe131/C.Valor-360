import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildMultiDecisionMap} from '../server/multi-decision-map.js'

test('mapa separa decisores técnicos e financeiros usando somente dados confirmados',()=>{
 const context={
  client:{id:'p1',name:'Produtor'},
  opportunities:[{id:'o1',title:'Programa estratégico',decision_process:'Aprovação conjunta pelo comitê',decisionMakers:[
   {name:'Carlos',role:'Responsável técnico',perspective:'Evidência de campo',riskPosture:'Evita mudança sem validação',confirmed:true},
   {name:'Marina',role:'Financeiro',perspective:'Fluxo e ponto de equilíbrio',riskPosture:'Conservadora',confirmed:true}
  ]}],
  interactions:[],profile:{answers:{}}
 }
 const result=buildMultiDecisionMap(context)
 assert.equal(result.strategic,true)
 assert.equal(result.actors.length,2)
 assert.equal(result.roleSummary.technical,1)
 assert.equal(result.roleSummary.financial,1)
 assert.ok(result.actors.every(actor=>actor.evidenceIds.length===1))
 assert.equal(result.policy.confirmedDataOnly,true)
 assert.equal(result.policy.inferredPeople,false)
})

test('participante incompleto permanece visível como lacuna, não como inferência',()=>{
 const result=buildMultiDecisionMap({client:{id:'p1',decisionMakers:[{role:'Diretoria',confirmed:true}]},opportunities:[],interactions:[],profile:{answers:{}}})
 assert.equal(result.actors.length,1)
 assert.equal(result.actors[0].name,'')
 assert.ok(result.actors[0].missing.includes('nome do participante'))
 assert.ok(result.actors[0].missing.includes('critério ou perspectiva'))
 assert.match(result.nextAlignment.question,/O que Diretoria precisa comprovar/)
})

test('texto pessoal fora dos campos estruturados não cria decisor nem alavanca',()=>{
 const result=buildMultiDecisionMap({client:{id:'p1',notes:'A esposa influencia e a família está com dificuldades financeiras.'},opportunities:[],interactions:[],profile:{answers:{}}})
 assert.deepEqual(result.actors,[])
 assert.equal(result.policy.personalLeverage,false)
 assert.match(result.guardrail,/Não use informação pessoal, familiar ou financeira como alavanca/)
})

test('estúdio exibe o mapa, as evidências e o próximo alinhamento',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/MultiDecisionMapPanel.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 assert.match(studio,/MultiDecisionMapPanel/)
 assert.match(panel,/MAPA DE DECISORES/)
 assert.match(panel,/PRÓXIMO ALINHAMENTO/)
 assert.match(panel,/Interesse, influência e postura de risco não são inferidos/)
 assert.match(bootstrap,/multiDecisionMap:buildMultiDecisionMap/)
})
