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

test('evidência manual só entra no mapa com confirmação explícita',()=>{
 const result=buildMultiDecisionMap({client:{id:'p1'},opportunities:[{id:'o1',title:'Programa',evidence:[
  {id:'dp-1',type:'decision_participant',name:'Ana',role:'Compras',perspective:'Comparação de custo total',confirmed:true,observedAt:'2026-08-17T12:00:00Z'},
  {id:'dp-2',type:'decision_participant',name:'Pessoa não confirmada',role:'Financeiro',confirmed:false}
 ]}],interactions:[],profile:{answers:{}}})
 assert.equal(result.actors.length,1)
 assert.equal(result.actors[0].name,'Ana')
 assert.equal(result.actors[0].roleCategory,'commercial')
 assert.deepEqual(result.actors[0].evidenceIds,['decision-participant:dp-1'])
 assert.equal(result.policy.explicitEvidenceForManualRegistration,true)
})

test('estúdio permite registrar mais de um papel sem substituir a evidência atual',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/MultiDecisionMapPanel.jsx',import.meta.url),'utf8')
 assert.match(studio,/opportunities=\{data\.opportunities\|\|\[\]\}/)
 assert.match(studio,/onSaved=\{reload\}/)
 assert.match(panel,/Registrar participante/)
 assert.match(panel,/type:'decision_participant'/)
 assert.match(panel,/confirmed:true/)
 assert.match(panel,/\[\.\.\.\(Array\.isArray\(opportunity\.evidence\)\?opportunity\.evidence:\[\]\),participant\]/)
 assert.match(panel,/fetchJsonResource\('\/api\/opportunities'/)
 assert.match(panel,/candidateKey:opportunity\.candidateKey\|\|opportunity\.candidate_key\|\|opportunity\.title/)
 assert.match(panel,/Confirmo que o papel foi informado em conversa ou registro real/)
 assert.match(panel,/Não inclua família, hobbies, dificuldades pessoais ou informação financeira pessoal/)
})

test('estúdio exibe o mapa, as evidências e o próximo alinhamento',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/MultiDecisionMapPanel.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 const css=readFileSync(new URL('../src/multi-decision-register.css',import.meta.url),'utf8')
 assert.match(studio,/MultiDecisionMapPanel/)
 assert.match(panel,/MAPA DE DECISORES/)
 assert.match(panel,/PRÓXIMO ALINHAMENTO/)
 assert.match(panel,/Interesse, influência e postura de risco não são inferidos/)
 assert.match(panel,/multi-decision-register\.css/)
 assert.match(css,/@media\(max-width:700px\)/)
 assert.match(bootstrap,/multiDecisionMap:buildMultiDecisionMap/)
})
