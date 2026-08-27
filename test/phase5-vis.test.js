import test from 'node:test'
import assert from 'node:assert/strict'
import {buildInsightFeed} from '../server/execution/insight-card.js'
import {buildCommitmentCandidate} from '../server/execution/commitment.js'
import {tenantA,actorA,phase4Context} from '../support/phase4-test-context.js'

const now=new Date('2026-08-22T12:00:00.000Z')
const actor={id:actorA,role:'consultant'}
const candidate=(index,overrides={})=>({subject_id:'producer-a',category:'FOLLOW_UP',title:`Insight ${index}`,summary:`Sinal ${index}`,why_now:`Motivo ${index}`,recommended_action:`Ação ${index}`,urgency:index/20,impact:index/20,confidence:.8,risk:.2,evidence_refs:[{id:`evidence-${index}`}],expires_at:'2026-09-01T00:00:00.000Z',...overrides})
const context=overrides=>phase4Context({commitments:[],visits:[],learning:{},...overrides})
const commitment=due=>buildCommitmentCandidate({organization_id:tenantA,client_id:'producer-a',description:'Retornar com o comparativo.',owner_type:'USER',owner_id:actorA,due_at:due,status:'ACCEPTED',success_criteria:'Resposta registrada.',agreed_with_client:true,evidence_refs:[],source_ref:'manual:test',request_id:'request-vis',created_by:actorA,now}).commitment

test('VIS 8 — 20 insights mostram apenas prioridades',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor,contexts:[context()],candidates:Array.from({length:20},(_,index)=>candidate(index+1)),now,maxItems:5})
 assert.equal(feed.items.length,5)
 assert.ok(feed.items[0].priority>=feed.items.at(-1).priority)
})

test('VIS 9 — Commitment vencido gera ACT_NOW',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor,contexts:[context({commitments:[commitment('2026-08-20T00:00:00.000Z')]})],now})
 assert.ok(feed.items.some(item=>item.category==='ACT_NOW'))
})

test('VIS 10 — visita futura importante gera PREPARE',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor,contexts:[context({visits:[{id:'visit-a',scheduledAt:'2026-08-25T12:00:00.000Z',objective:'Negociar fertilizante',status:'Agendada'}]})],now})
 assert.ok(feed.items.some(item=>item.category==='PREPARE'))
})

test('VIS 11 — follow-up pendente gera FOLLOW_UP',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor,contexts:[context({commitments:[commitment('2026-08-28T00:00:00.000Z')]})],now})
 assert.ok(feed.items.some(item=>item.category==='FOLLOW_UP'))
})

test('VIS 12 — aprendizado relevante gera LEARN para gestor',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor:{id:actorA,role:'manager'},contexts:[context({learning:{wins:2,losses:1}})],now})
 assert.ok(feed.items.some(item=>item.category==='LEARN'))
})

test('VIS 13 — insight expirado não aparece',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor,contexts:[context()],candidates:[candidate(1,{expires_at:'2026-08-21T00:00:00.000Z'})],now})
 assert.equal(feed.items.length,0)
})

test('VIS 14 — baixa confiança aparece como hipótese',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor,contexts:[context()],candidates:[candidate(1,{confidence:.2})],now})
 assert.equal(feed.items[0].epistemic_status,'HYPOTHESIS')
})

test('VIS 15 — usuário sem permissão não vê card',()=>{
 const feed=buildInsightFeed({organizationId:tenantA,actor:{id:actorA,role:'technical_reviewer'},contexts:[context()],candidates:[candidate(1,{category:'LEARN',allowed_roles:['manager','admin']})],now})
 assert.equal(feed.items.length,0)
})
