import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildObjectionLibrary} from '../server/objection-library.js'

const context={
 businessHistory:[
  {id:'loss-1',event_type:'business.lost',loss_reason:'Preço acima da alternativa',category:'Milho',product:'Programa A',occurred_at:'2026-03-10T12:00:00Z'},
  {id:'loss-2',outcome:'lost',loss_reason:'Preço e condição comercial',category:'Milho',product:'Programa B',occurred_at:'2026-04-10T12:00:00Z'},
  {id:'loss-notes',event_type:'business.lost',notes:'Concorrente mais barato',category:'Soja',occurred_at:'2026-05-10T12:00:00Z'},
  {id:'win-1',event_type:'business.closed',category:'Milho',product:'Programa A',occurred_at:'2026-06-15T12:00:00Z'}
 ],
 priorRecommendations:[
  {id:'rec-1',created_at:'2026-05-01T12:00:00Z',feedback:{outcome:'executed'},advice:{executive_brief:{action:'Comparar escopo e quantificar o ponto de equilíbrio antes de negociar condição.'}}}
 ]
}
const now=Date.parse('2026-08-17T12:00:00Z')

test('biblioteca usa somente motivo estruturado de perda e agrupa objeções semelhantes',()=>{
 const library=buildObjectionLibrary(context,{now})
 assert.equal(library.lossEventsConsidered,2)
 assert.equal(library.objections.length,1)
 const objection=library.objections[0]
 assert.equal(objection.label,'Preço ou condição comercial')
 assert.equal(objection.count,2)
 assert.ok(objection.evidenceIds.includes('business-loss:loss-1'))
 assert.ok(objection.evidenceIds.includes('business-loss:loss-2'))
 assert.equal(library.policy.structuredLossReasonOnly,true)
 assert.equal(library.policy.freeNotesExcluded,true)
})

test('movimento observado exige recomendação executada e fechamento posterior semelhante',()=>{
 const objection=buildObjectionLibrary(context,{now}).objections[0]
 assert.ok(objection.observedMove)
 assert.match(objection.observedMove.action,/Comparar escopo e quantificar/)
 assert.ok(objection.observedMove.evidenceIds.includes('recommendation:rec-1'))
 assert.ok(objection.observedMove.evidenceIds.includes('business-win:win-1'))
 assert.equal(objection.observedMove.causalClaim,false)
 assert.match(objection.guardrail,/não prova causalidade/)
})

test('sem resultado posterior a VAL pede descoberta em vez de produzir script genérico',()=>{
 const library=buildObjectionLibrary({businessHistory:[{id:'l',event_type:'business.lost',loss_reason:'Faltou prova de resultado',occurred_at:'2026-08-01T12:00:00Z'}],priorRecommendations:[]},{now})
 assert.equal(library.objections[0].observedMove,null)
 assert.match(library.objections[0].guidance,/Descubra a objeção atual/)
 assert.equal(library.policy.genericScripts,false)
 assert.equal(library.policy.causalClaims,false)
})

test('estúdio exibe objeções reais, evidências e limite causal',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/ObjectionEvidencePanel.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 assert.match(studio,/ObjectionEvidencePanel/)
 assert.match(panel,/BIBLIOTECA DE OBJEÇÕES REAIS/)
 assert.match(panel,/Evidências rastreáveis/)
 assert.match(bootstrap,/objectionLibrary:buildObjectionLibrary/)
})
