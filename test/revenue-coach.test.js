import test from 'node:test'
import assert from 'node:assert/strict'
import {buildCommercialCoach} from '../server/sales-playbook.js'
import {buildRevenueIntelligence} from '../server/conversion-engine.js'
import {revenueDecisionQuery,revenueDecisionResponse} from '../server/decision-copilot/revenue-decision.js'
import {visitOutcomeLoop} from '../server/revenue-policy.js'
const now=Date.parse('2026-10-03'),opportunity={id:'op',title:'Test',estimated_value:100,updated_at:'2026-10-01',evidence:[]}
const view=(override={})=>buildRevenueIntelligence({client:{id:'producer'},opportunities:[{...opportunity,...override}],commitments:[]},{now,ownerId:'owner',tenantId:'tenant'})
test('coach only describes recorded behavior; missing value is not price chronology',()=>{
 const cards=buildCommercialCoach(view(),{now})
 assert.ok(cards.some(c=>c.signal==='opportunity_without_next_step'))
 assert.ok(!cards.some(c=>c.signal==='price_too_early'))
 assert.ok(cards.every(c=>c.evidence_refs.length&&c.consultant==='owner'))
 assert.equal(buildCommercialCoach({...view(),opportunities:[{...view().opportunities[0],id:null}]}).length,0)
})
test('price too early requires timestamped evidence',()=>{
 const cards=buildCommercialCoach(view({evidence:[{id:'price',type:'PRICE_DISCUSSION',observed_at:'2026-09-01'},{id:'problem',type:'PROBLEM_CONFIRMED',observed_at:'2026-09-02'}]}))
 assert.ok(cards.some(c=>c.signal==='price_too_early'))
 assert.ok(!buildCommercialCoach(view({evidence:[{id:'price',type:'PRICE_DISCUSSION'}]})).some(c=>c.signal==='price_too_early'))
})
test('weak and useful commitments use action, owner, deadline, evidence and next decision',()=>{
 const revenue=view();revenue.opportunities[0].commitments=[{id:'weak',description:'Compare',owner_id:'owner'},{id:'strong',description:'Compare',owner_id:'owner',due_at:'2026-10-10',evidence_refs:[{id:'proof'}],success_criteria:'Choose the trial'}]
 const cards=buildCommercialCoach(revenue)
 assert.ok(cards.some(c=>c.signal==='weak_commitment'));assert.ok(cards.some(c=>c.signal==='good_commitment_capture'))
})
test('text report alone does not close visit loop',()=>{
 const loops=visitOutcomeLoop({visits:[{id:'visit',summary:'Done',status:'Realizada'}],outcomes:[]})
 assert.equal(loops[0].state,'OPEN');assert.equal(loops[0].text_report_completes_loop,false)
})
test('all eight revenue questions route to rules; no invented share change or win',()=>{
 for(const question of ['Quanto valor tenho aberto?','O que está parado?','O que ganhamos este mês?','Por que esta oportunidade não avança?','O que eu poderia ter feito melhor?','Quais compromissos estão fracos?','Qual meu impacto nesta carteira?','Quais produtores aumentaram share?'])assert.equal(revenueDecisionQuery(question),true,question)
 const response=revenueDecisionResponse({enabled:true,producers:[view()]},{message:'Quais produtores aumentaram share?'})
 assert.match(response.advice.answer,/Não há aumento/);assert.equal(response.responseMetadata.providerCalls,0)
})
