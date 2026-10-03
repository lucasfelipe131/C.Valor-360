import test from 'node:test'
import assert from 'node:assert/strict'
import {buildRevenueIntelligence} from '../server/conversion-engine.js'
import {calculateObservedImpact,calculateEconomicCase,outcomeEvidenceViolations} from '../server/revenue-policy.js'
const now=Date.parse('2026-10-03T12:00:00Z')
const options={now,tenantId:'tenant',ownerId:'owner'}
const context=(opportunities=[],outcomes=[],commercial={})=>({canonicalClientId:'producer',client:{id:'producer',commercial},opportunities,outcomes})
const opportunity={id:'opportunity',stage:'Proposta',estimated_value:100,next_action:'Confirmar prova',next_action_at:'2026-10-10',updated_at:'2026-10-01',evidence:[{id:'proof'}]}
test('unknown potential and empty value stay unknown; no guessed share',()=>{
 const view=buildRevenueIntelligence(context([{...opportunity,estimated_value:''}],[],{purchaseCurrentSeason:50,realizedShare:99}),options)
 assert.equal(view.metrics.open_pipeline,null);assert.equal(view.metrics.realized_share_percent,null);assert.equal(view.opportunities[0].health,'MISSING_VALUE')
})
test('capture categories are separate and share discrepancy is explicit',()=>{
 const view=buildRevenueIntelligence(context([opportunity],[],{purchaseCurrentSeason:150,potentialTotal:100}),options)
 assert.equal(view.metrics.realized_share_percent,150);assert.deepEqual(view.warnings,['PURCHASES_EXCEED_POTENTIAL']);assert.equal(view.double_counting_guard.additive,false);assert.equal(view.metrics.open_pipeline,100)
})
test('closed opportunity with future action never enters pipeline or stalled value',()=>{
 const view=buildRevenueIntelligence(context([{...opportunity,stage:'Fechado',updated_at:'2020-01-01'}]),options)
 assert.equal(view.metrics.open_pipeline,0);assert.equal(view.metrics.stalled_value,0);assert.equal(view.opportunities[0].scenario,'CLOSED')
})
test('stagnation is versioned and only sums open opportunities',()=>{
 const view=buildRevenueIntelligence(context([{...opportunity,updated_at:'2026-01-01'}]),options)
 assert.equal(view.metrics.stalled_value,100);assert.equal(view.opportunities[0].health,'STALLED');assert.match(view.opportunities[0].policy_version,/v1$/)
})
test('WON requires confirmed commercial evidence; LOST needs reason and NO_DECISION remains separate',()=>{
 assert.deepEqual(outcomeEvidenceViolations({outcome_type:'WON',evidence_refs:[{id:'proposal',type:'PROPOSAL',confirmed:true}]}),['won_commercial_evidence_required'])
 assert.deepEqual(outcomeEvidenceViolations({outcome_type:'LOST',result:{}}),['loss_reason_required'])
 assert.deepEqual(outcomeEvidenceViolations({outcome_type:'NO_DECISION',result:{}}),[])
 const outcomes=['TECHNICAL_RESULT','NO_DECISION','RELATIONSHIP_PROGRESS'].map((type,index)=>({id:String(index),outcome_type:type,result:{value:100}}))
 const view=buildRevenueIntelligence(context([],outcomes),options);assert.equal(view.metrics.won_value,0);assert.equal(view.metrics.lost_value,0)
})
test('duplicate outcome and duplicated order do not double count; tenant and owner isolated',()=>{
 const won={id:'1',outcome_type:'WON',result:{value:100},evidence_refs:[{type:'ORDER',id:'order',confirmed:true}]}
 const view=buildRevenueIntelligence(context([],[won,won,{...won,id:'2'},{...won,id:'3',tenant_id:'other'},{...won,id:'4',recorded_by:'other'}]),options)
 assert.equal(view.metrics.won_value,100);assert.equal(view.outcomes.length,2)
})
test('impact requires comparable baseline, evidence and method; caller cannot claim causality',()=>{
 const input={producer:'producer',action:'action',outcome:'outcome',metric:'productivity',baseline:{value:40,unit:'sc/ha',measured_at:'2026-01-01',method:'harvest'},measurement:{value:50,unit:'sc/ha',method:'harvest'},measured_at:'2026-09-01',source_refs:['measurement'],attribution_status:'VALIDATED_CAUSAL_LINK'}
 assert.equal(calculateObservedImpact(input).delta,10);assert.equal(calculateObservedImpact(input).attribution_status,'CAUSAL_NOT_PROVEN')
 assert.throws(()=>calculateObservedImpact({...input,baseline:null}));assert.throws(()=>calculateObservedImpact({...input,measurement:{...input.measurement,unit:'kg/ha'}}))
})
test('economic case does not calculate from assumed inputs',()=>{
 assert.equal(calculateEconomicCase({cost:{value:100,status:'ASSUMED'}}).status,'INSUFFICIENT_DATA')
 assert.equal(calculateEconomicCase({cost:{value:100,status:'KNOWN'},area_ha:{value:2,status:'KNOWN'}}).results.cost_per_hectare.value,50)
})

test('large portfolio projection remains linear in independent producer data',()=>{
 const start=performance.now()
 for(let index=0;index<10000;index++)buildRevenueIntelligence(context([opportunity]),options)
 assert.ok(performance.now()-start<5000)
})
