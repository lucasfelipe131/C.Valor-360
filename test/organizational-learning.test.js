import test from 'node:test'
import assert from 'node:assert/strict'
import {recommendationSnapshot,sampleSufficiency,reviewRecord,fingerprint} from '../server/learning/policy.js'
import {buildLearningDataset,temporalSplit} from '../server/learning/dataset.js'
import {discoverPatterns,driftMonitor} from '../server/learning/patterns.js'
import {evaluateShadow} from '../server/learning/shadow.js'
const options={tenantId:'tenant',ownerIds:['owner'],period_start:'2026-01-01',period_end:'2026-04-01',scope:{geography_scope:'LOCAL'},created_by:'admin'}
const policy={status:'APPROVED',version:'test-only',review:{reviewer:'reviewer'},thresholds:{limited:2,sufficient:3,strong:5}}
function event(id='r',date='2026-02-01',value='accepted'){
 return {id,tenant_id:'tenant',owner_id:'owner',account_id:`account-${id}`,source:'canonical',version:'v1',displayed:true,created_at:date,snapshot:recommendationSnapshot({timestamp:date,engine_version:'v1',features:{URGENCY:10,religion:'secret'},selected_candidate:`op-${id}`,alternatives:[{id:`op-${id}`,known_at:date,features:{URGENCY:10},current_score:10}]}),labels:value?[{id:`label-${id}`,tenant_id:'tenant',owner_id:'owner',recommendation_id:id,created_at:'2026-03-01',kind:'FEEDBACK',value}]:[]}
}
test('snapshot excludes sensitive and free text features and rejects future information',()=>{
 const e=event();assert.deepEqual(e.snapshot.score_components,{URGENCY:10});assert.ok(!JSON.stringify(e.snapshot).includes('secret'))
 assert.throws(()=>recommendationSnapshot({timestamp:'2026-01-01',alternatives:[{id:'x',known_at:'2026-02-01'}]}),/future_leakage/)
})
test('accepted is not won; scheduled is not executed; missing label is UNLABELED',()=>{
 const d=buildLearningDataset([event('a'),event('b','2026-02-01','scheduled'),event('c','2026-02-01',null),event('d','2026-02-01','won')],options)
 assert.equal(d.labeled_count,2);assert.equal(d.unlabeled_count,2);assert.equal(d.rows[0].labels[0].value,'accepted');assert.equal(d.rows[1].labels[0].value,'scheduled');assert.equal(d.rows[2].label_status,'UNLABELED')
})
test('dataset excludes demo, synthetic, duplicates, missing identity, cross tenant and owner',()=>{
 const base=event();const d=buildLearningDataset([base,base,{...event('s'),source:'k5_synthetic_fixture'},{...event('t'),tenant_id:'other'},{...event('o'),owner_id:'other'},{...event('i'),id:null},{...event('d'),synthetic:true}],options)
 assert.equal(d.row_count,1);assert.equal(d.excluded_count,6);assert.equal(d.quality.DUPLICATES,1);assert.equal(d.quality.MISSING_IDENTITY,1)
 assert.ok(!JSON.stringify(d.rows).includes('account-r'));assert.equal(d.hash,buildLearningDataset([base,base,{...event('s'),source:'k5_synthetic_fixture'},{...event('t'),tenant_id:'other'},{...event('o'),owner_id:'other'},{...event('i'),id:null},{...event('d'),synthetic:true}],options).hash)
})
test('future evidence and unlinked outcome fail eligibility',()=>{
 const e=event();e.snapshot.evidence_refs=[{id:'future',known_at:'2026-03-01'}]
 assert.equal(buildLearningDataset([e],options).quality.TEMPORAL_VIOLATIONS,1)
 const wrong=event();wrong.labels[0].recommendation_id='unlinked';assert.equal(buildLearningDataset([wrong],options).row_count,0)
})
test('contrary evidence retained with lower descriptive confidence and no causal claim',()=>{
 const d=buildLearningDataset([event('a'),event('b','2026-02-01','rejected')],options)
 const p=discoverPatterns(d).find(p=>p.hypothesis.includes('accepted'));assert.equal(p.contrary_evidence.length,1);assert.equal(p.confidence,.5);assert.equal(p.attribution,'CAUSAL_NOT_PROVEN');assert.equal(p.classification,'ACCOUNT_OBSERVATION');assert.equal(p.sample_sufficiency,'INSUFFICIENT_FOR_PROMOTION');assert.equal(p.metric.denominator,2)
})
test('small sample never promoted; thresholds require reviewed policy',()=>{
 assert.equal(sampleSufficiency(10000), 'INSUFFICIENT_FOR_PROMOTION');assert.equal(sampleSufficiency(1,policy),'INSUFFICIENT');assert.equal(sampleSufficiency(3,policy),'SUFFICIENT');assert.equal(sampleSufficiency(10,{...policy,review:null}),'INSUFFICIENT_FOR_PROMOTION')
})
test('temporal split purges future labels and overlapping opportunities',()=>{
 const rows=[{created_at:'2026-01-01',opportunity_id:'a',labels:[{created_at:'2026-01-03'}]},{created_at:'2026-03-01',opportunity_id:'a',labels:[]},{created_at:'2026-01-01',opportunity_id:'b',labels:[{created_at:'2026-03-01'}]},{created_at:'2026-03-01',opportunity_id:'c',labels:[]}]
 const split=temporalSplit(rows,'2026-02-01');assert.equal(split.training.length,1);assert.equal(split.evaluation.length,1);assert.equal(split.excluded_count,2)
})
test('shadow leaves current ranking unchanged and suppresses small sample',()=>{
 const d=buildLearningDataset([event('a')],options),before=structuredClone(d)
 const result=evaluateShadow(d,{cutoff:'2026-01-15',weights:{URGENCY:2}});assert.equal(result.mode,'SHADOW');assert.equal(result.production_changed,false);assert.equal(result.comparisons.length,0);assert.deepEqual(d,before)
 const many=buildLearningDataset(['a','b','c'].map(id=>event(id)),options),r=evaluateShadow(many,{cutoff:'2026-01-15',weights:{URGENCY:2},sample_policy:policy});assert.equal(r.comparisons.length,3);assert.equal(r.comparisons[0].candidate_ranker[0].score,20)
})
test('technical human review cannot be replaced by manager/admin and requires contrary field',()=>{
 const input={status:'APPROVED',reason:'checked',evidence_reviewed:['e'],contrary_evidence_reviewed:[]}
 for(const role of ['consultant','manager','admin'])assert.throws(()=>reviewRecord({id:'a',role},input,{technical:true}),/role_denied/)
 assert.equal(reviewRecord({id:'r',role:'technical_reviewer'},input,{technical:true}).reviewer,'r')
 assert.throws(()=>reviewRecord({id:'a',role:'admin'},{...input,contrary_evidence_reviewed:undefined}),/evidence_required/)
})
test('drift defaults insufficient; approved thresholds produce review only',()=>{
 const a=buildLearningDataset(['a','b','c'].map(id=>event(id)),options),b=buildLearningDataset(['d','e','f'].map(id=>event(id,'2026-02-01','rejected')),options)
 assert.equal(driftMonitor(a,b).state,'INSUFFICIENT_SAMPLE')
 const drift=driftMonitor(a,b,{status:'APPROVED',review:{reviewer:'r'},minimum_sample:3,watch:.1,shift:.5});assert.equal(drift.state,'SHIFT_DETECTED');assert.equal(drift.action,'REVIEW_REQUIRED');assert.equal(drift.automatic_change,false)
})

test('ranking metrics require complete labels and retain denominators',async()=>{
 const {rankingMetrics}=await import('../server/learning/shadow.js')
 const comparison={recommendation:'r',candidate_ranker:[{id:'a'},{id:'b'}]},row={id:'r',labels:[{kind:'OUTCOME',value:'lost',opportunity_id:'a'},{kind:'OUTCOME',value:'won',opportunity_id:'b'}]}
 const metrics=rankingMetrics([row],[comparison],1,{scope:'test',period:['a','b']});assert.equal(metrics.top_1_progress_rate.denominator,1);assert.equal(metrics.top_1_progress_rate.numerator,0);assert.equal(metrics.ranking_regret.value,1);assert.equal(metrics.ndcg_at_k.value,0)
 assert.equal(rankingMetrics([{...row,labels:row.labels.slice(0,1)}],[comparison],1).status,'INSUFFICIENT_CANDIDATE_LABELS')
})
test('offline training uses only training rows and returns no probability',async()=>{
 const {fitOfflineWeights}=await import('../server/learning/shadow.js')
 const training=[{features:{URGENCY:1},labels:[{kind:'OUTCOME',value:'lost'}]},{features:{URGENCY:3},labels:[{kind:'OUTCOME',value:'won'}]},{features:{URGENCY:5},labels:[{kind:'OUTCOME',value:'won'}]}]
 const model=fitOfflineWeights(training,{sample_policy:policy});assert.equal(model.status,'FITTED_OFFLINE');assert.equal(model.weights.URGENCY,.75);assert.equal(model.score_meaning,'PRIORITIZATION_NOT_PROBABILITY')
})
test('same KnowledgeItem contract blocks scope expansion and unregistered sources',async()=>{
 const {validatePromotedKnowledge,publishedKnowledgeView}=await import('../server/knowledge/promotion.js'),{loadKnowledgeLibrary}=await import('../server/knowledge/library.js')
 const original=loadKnowledgeLibrary().items.find(i=>i.risk==='LOW'),scope={geography_scope:'LOCAL',crop_scope:['SOY'],season_scope:['2026']}
 const item={...original,status:'APPROVED',geographic_scope:'LOCAL',crop_scope:['SOY'],season_scope:['2026'],valid_from:'2026-01-01',valid_until:'2027-01-01',review_at:'2026-12-01',provenance:{candidate_id:'candidate'}}
 const now=Date.parse('2026-10-03');assert.equal(validatePromotedKnowledge(item,{scope,now}).status,'APPROVED')
 assert.throws(()=>validatePromotedKnowledge({...item,geographic_scope:'Brazil'},{scope,now}),/scope_expansion/)
 assert.throws(()=>validatePromotedKnowledge({...item,source_refs:['invented']},{scope,now}),/source_not_registered/)
 assert.throws(()=>validatePromotedKnowledge({...item,risk:'HIGH'},{scope,now}),/technical_review/)
 assert.equal(publishedKnowledgeView([{kind:'KNOWLEDGE',payload:{knowledge_item:item},valid_until:'2026-01-01',review_at:'2025-12-01'}],now)[0].status,'EXPIRED')
})
