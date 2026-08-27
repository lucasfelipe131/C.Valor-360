import test from 'node:test'
import assert from 'node:assert/strict'
import {commercialScenarioFixtures,raulScenarioFixtures,evaluateCommercialApproach,scenarioTraceability} from '../server/commercial/scenario-fixtures.js'

test('as 20 simuladas possuem fixture, owner, CASE_ONLY e estado governado',()=>{
 assert.equal(commercialScenarioFixtures.length,20)
 assert.equal(new Set(commercialScenarioFixtures.map(item=>item.scenario_id)).size,20)
 assert.ok(commercialScenarioFixtures.every(item=>item.technical_claims_status==='CASE_ONLY'))
 assert.ok(commercialScenarioFixtures.every(item=>['NOT_MAPPED','MAPPED','TESTED','VALIDATED'].includes(item.state)))
 assert.ok(commercialScenarioFixtures.every(item=>item.owner))
})

test('cenários comerciais principais saem TESTED e os demais MAPPED',()=>{
 for(const id of ['MASTER-01','MASTER-04','MASTER-05','MASTER-06','MASTER-07','MASTER-08','MASTER-09'])assert.equal(commercialScenarioFixtures.find(item=>item.scenario_id===id)?.state,'TESTED')
 assert.ok(commercialScenarioFixtures.filter(item=>item.state==='MAPPED').length>0)
})

test('matriz rastreia scenario, requirement, fixture, test, module e owner',()=>{
 const rows=scenarioTraceability()
 assert.equal(rows.length,20)
 for(const row of rows)for(const key of ['scenario','requirement','fixture','module','owner','state'])assert.ok(row[key])
})

test('Raul compara abordagem fraca e venda de valor executavelmente',()=>{
 const weak=evaluateCommercialApproach(raulScenarioFixtures.weak)
 const good=evaluateCommercialApproach(raulScenarioFixtures.value)
 assert.ok(weak.negative_patterns.length>=8)
 assert.ok(good.positive_patterns.length>=8)
 assert.equal(raulScenarioFixtures.weak.technical_claims_status,'CASE_ONLY')
 assert.equal(raulScenarioFixtures.value.state,'TESTED')
})
