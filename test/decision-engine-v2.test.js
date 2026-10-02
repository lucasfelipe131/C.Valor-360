import assert from 'node:assert/strict'
import test from 'node:test'
import {buildNextBestAction} from '../server/decision-intelligence.js'
import {buildPortfolioRadar} from '../server/portfolio-radar.js'
import {SCORING_POLICIES,decisionRegistries,hashDecision,stagingDecisionDefaults} from '../server/decision-governance.js'
import {portfolioDecisionQuery,portfolioDecisionResponse} from '../server/decision-copilot/portfolio-decision.js'

const now=Date.parse('2026-10-02T12:00:00Z'),observed='2026-10-01T12:00:00Z'
const context=(id='a',extra={})=>({client:{id,name:`SYNTHETIC ${id}`,updatedAt:observed},canonicalClientId:`canonical-${id}`,opportunities:[],commitments:[],visits:[],...extra})
const opportunity=(extra={})=>({id:'op-a',title:'SYNTHETIC registered decision',stage:'Negociação',estimated_value:1000,next_action:'Confirmar prazo',next_action_at:'2026-10-04T12:00:00Z',updated_at:observed,...extra})
const card=c=>buildNextBestAction(c,{now})
const radar=rows=>buildPortfolioRadar(rows,{now,version:'v2'})

test('NBA ranking is deterministic for shuffled input and stable ties, limited to five home priorities',()=>{
 const rows=Array.from({length:9},(_,i)=>context(String(i),{opportunities:[opportunity()]}))
 assert.deepEqual(radar(rows).cards,radar(rows.toReversed()).cards)
 assert.equal(radar(rows).items.length,5)
 assert.deepEqual(radar(rows).cards.map(c=>c.producer_id),rows.map(c=>c.client.id))
})
test('NBA overdue low value precedes high commercial potential without urgency',()=>{
 const high=context('high',{client:{id:'high',name:'SYNTHETIC high',commercial:{potentialTotal:1000000,purchaseCurrentSeason:0,lastBusinessAt:observed}}})
 const urgent=context('urgent',{opportunities:[opportunity({estimated_value:100,next_action_at:'2026-10-01T10:00:00Z'})]})
 assert.equal(radar([high,urgent]).cards[0].producer_id,'urgent')
 assert.equal(card(high).priority_band,'THIS_WEEK')
 assert.equal(card(urgent).priority_band,'NOW')
 assert.equal(card(urgent).expected_value.amount,100)
})
test('NBA same producer with changed context changes priority and evidence fingerprint',()=>{
 const empty=card(context()),active=card(context('a',{opportunities:[opportunity()]}))
 assert.notEqual(empty.priority_score,active.priority_score)
 assert.notEqual(empty.evidence_fingerprint,active.evidence_fingerprint)
 assert.equal(active.engine_version,'val-nexo-v1')
 assert.ok(active.evidence.some(e=>e.engine_evidence_ref==='selected-opportunity'))
})
test('NBA share gap uses registered commercial values without probability or ROI',()=>{
 const result=card(context('share',{client:{id:'share',name:'Share',commercial:{potentialTotal:100000,purchaseCurrentSeason:25000,lastBusinessAt:observed}}}))
 assert.equal(result.expected_value.amount,75000)
 assert.equal(result.commercial_gap,75000)
 assert.match(result.why_this_producer,/25/)
 assert.equal(result.expected_value.not_expected_profit,true)
 assert.equal(result.risk_of_waiting.financial_loss,null)
})
test('NBA absent data means NO_DATA and one material interview question, not negative points',()=>{
 const result=card(context())
 assert.equal(result.priority_score,0);assert.equal(result.eligible,false)
 assert.equal(result.confidence.level,'LOW');assert.equal(result.expected_value.status,'UNKNOWN')
 assert.ok(Object.values(result.score_breakdown.dimensions).every(d=>d.state==='NO_DATA'&&d.points===0))
 assert.equal(result.score_breakdown.missing_data_penalizes_producer,false)
 assert.ok(result.missing_information.every(m=>m.classification==='MATERIAL_MISSING_INFORMATION'))
 assert.equal(result.decision_interview.questions.length,1)
})
test('NBA closed opportunities and cancelled commitments and visits cannot trigger action',()=>{
 for(const status of ['Fechado','closed','won','lost','cancelled','cancelado']){
  const result=card(context('a',{opportunities:[opportunity({stage:status})],commitments:[{id:'c',status:'CANCELLED',due_at:observed,description:'Cancelled',updated_at:observed}],visits:[{id:'v',status:'cancelled',scheduled_at:'2026-10-03T12:00:00Z'}]}))
  assert.equal(result.opportunity_id,null);assert.equal(result.priority_score,0)
 }
 const metadata=card(context('a',{opportunities:[opportunity({evidence:[{type:'opportunity_workspace_v1',status:'closed'}]})]}))
 assert.equal(metadata.opportunity_id,null)
})
test('NBA stale and future evidence reduce contribution and require qualified confidence',()=>{
 const fresh=card(context('a',{opportunities:[opportunity()]}))
 const stale=card(context('a',{opportunities:[opportunity({updated_at:'2024-01-01T00:00:00Z'})]}))
 const future=card(context('a',{opportunities:[opportunity({updated_at:'2027-01-01T00:00:00Z'})]}))
 assert.ok(stale.priority_score<fresh.priority_score)
 assert.equal(stale.confidence.level,'LOW');assert.ok(stale.score_breakdown.penalties.length)
 assert.equal(future.priority_score,0);assert.equal(future.decision_type,'COLETAR_DADO')
 assert.ok(future.review_reasons.includes('INCOMPATIBLE_DATE'))
})
test('NBA visit preparation requires a near visit plus a relevant decision and retains existing method',()=>{
 const visits=[{id:'v',status:'planned',scheduled_at:'2026-10-03T12:00:00Z',created_at:observed}]
 const result=card(context('a',{visits,opportunities:[opportunity()]}))
 assert.equal(result.decision_type,'PREPARAR_VISITA');assert.equal(result.visit_id,'v')
 assert.match(result.next_best_action,/SPIN\/OPC\/APC\/EPA/)
 assert.notEqual(card(context('a',{visits})).decision_type,'PREPARAR_VISITA')
})
test('NBA unvalidated agronomy is review only; validated evidence never becomes dose or mixture',()=>{
 const record={id:'technical',summary:'SYNTHETIC anomaly',observed_at:observed}
 const unvalidated=card(context('a',{fieldReports:[record]}))
 assert.equal(unvalidated.score_breakdown.dimensions.AGRONOMIC_SIGNAL.points,0)
 assert.ok(unvalidated.review_reasons.includes('UNVALIDATED_AGRONOMY'))
 const validated=card(context('a',{fieldReports:[{...record,validated_at:observed}]}))
 assert.ok(validated.score_breakdown.dimensions.AGRONOMIC_SIGNAL.points>0)
 assert.equal(validated.decision_type,'REVISAR_AGRONOMIA');assert.match(validated.next_best_action,/responsável habilitado/)
})
test('NBA Hub provenance retains source, external identity, canonical entity and version; foreign canonical events excluded',()=>{
 const event={id:'hub-event',status:'processed',canonical_client_id:'canonical-a',source:'manual-do-agronomo',external_id:'external',event_type:'manual.record.saved',observed_at:observed,ingested_at:observed,source_version:4,payload_hash:'hash',hub_contract_version:'val.hub.v1'}
 const result=card(context('a',{hubEvidence:[event,{...event,id:'foreign',canonical_client_id:'canonical-b'}]}))
 const fact=result.evidence[0]
 assert.equal(result.evidence.length,1);assert.equal(fact.source,event.source)
 assert.equal(fact.external_id,'external');assert.equal(fact.canonical_entity,'canonical-a');assert.equal(fact.version,4)
 assert.equal(fact.ingested_at,observed);assert.equal(fact.provenance.payload_hash,'hash')
})
test('NBA conflicts enter review and do not instruct advancing the opportunity',()=>{
 const result=card(context('a',{opportunities:[opportunity()],evidenceConflicts:['test']}))
 assert.equal(result.confidence.level,'LOW');assert.equal(result.status,'REVIEW_REQUIRED')
 assert.equal(result.decision_type,'COLETAR_DADO')
})
test('NBA consumes only current governed snapshot facts, never raw ungoverned memory',()=>{
 const result=card(context('a',{memories:[{id:'private',value:'UNAUTHORIZED'}],contextSnapshot:{context_snapshot_id:'snap',facts:[{memory_ref:'approved',key:'Fato',value:'CONFIRMED',freshness:'CURRENT',observed_at:observed},{memory_ref:'old',key:'OLD',value:'STALE',freshness:'STALE'}],validated_knowledge:[]}}))
 assert.equal(result.context_snapshot_ref,'snap')
 assert.match(result.why_this_producer,/CONFIRMED/);assert.doesNotMatch(JSON.stringify(result),/UNAUTHORIZED|memory:old/)
})
test('NBA grain without market source asks material data and does not manufacture a price',()=>{
 const result=card(context('a',{grainDecision:{id:'grain',volume:100,unit:'t',place:'Sorriso',observed_at:observed,deadline:'2026-10-05',volumeConfirmed:false}}))
 assert.ok(['market_source','target_price','confirmed_volume'].every(key=>result.missing_information.some(m=>m.key===key)))
 assert.equal(result.expected_value.status,'UNKNOWN');assert.equal(result.automatic_execution,false)
})
test('NBA governed policies are configurable, versioned and auditable with stable canonical hashes',()=>{
 const c=context('a',{opportunities:[opportunity()]})
 const other=buildNextBestAction(c,{now,policy:SCORING_POLICIES['val.decision-scoring.conservative.v1']})
 assert.notEqual(other.priority_score,card(c).priority_score)
 assert.equal(other.policy_version,other.score_breakdown.version)
 assert.equal(hashDecision({b:2,a:{y:1,x:3}}),hashDecision({a:{x:3,y:1},b:2}))
 assert.ok(Object.values(stagingDecisionDefaults('production')).every(v=>v===false))
 assert.ok(Object.values(stagingDecisionDefaults('staging')).every(v=>v===true))
})
test('NBA registries enumerate actual capabilities and sources without secret or prompt bodies',()=>{
 const registry=decisionRegistries({modelDaily:'explicit-model',apiKey:'NEVER_RETURN',sessionSecret:'NEVER_RETURN'})
 assert.equal(registry.models.find(m=>m.capability==='daily').model,'explicit-model')
 assert.ok(registry.prompts.length>=7)
 assert.ok(['routing','grounding','freshness','decision_scoring','safety','memory','source_requirements','isolation'].every(id=>registry.policies.some(p=>p.policy_id===id)))
 assert.ok(registry.prompts.every(p=>p.rollback_version&&p.version&&p.created_at&&p.approved_at===null))
 assert.doesNotMatch(JSON.stringify(registry),/NEVER_RETURN/)
})
test('NBA Copilot recognizes required questions and returns the identical decision contract without provider calls',()=>{
 for(const question of ['Quem eu deveria visitar hoje?','Qual produtor merece atenção agora?','Por que João está em primeiro?','Quem tem maior potencial parado?','Qual é minha próxima melhor ação?','Por que eu deveria agir agora?'])assert.equal(portfolioDecisionQuery(question).matched,true,question)
 const result={...radar([context('a',{opportunities:[opportunity()]})]),enabled:true}
 const response=portfolioDecisionResponse(result,{message:'Qual produtor merece atenção agora?',tenantId:'t',ownerId:'o',conversationId:'conversation'})
 assert.deepEqual(response.decisionCards[0],result.cards[0])
 assert.equal(response.responseMetadata.providerCalls,0)
 assert.equal(response.advice.ai_reasoning.premises.context_scope.owner_id,'o')
})

test('NBA a neutral secondary value does not erase a positive dimension state',()=>{
 const result=card(context('a',{client:{id:'a',commercial:{potentialTotal:250000,purchaseCurrentSeason:0,lastBusinessAt:observed}},opportunities:[opportunity({estimated_value:0})]}))
 assert.equal(result.score_breakdown.dimensions.COMMERCIAL_VALUE.points,20)
 assert.equal(result.score_breakdown.dimensions.COMMERCIAL_VALUE.state,'POSITIVE_SIGNAL')
})
