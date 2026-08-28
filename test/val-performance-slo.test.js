import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {evaluatePerformanceSlo} from '../scripts/val-performance-slo-check.mjs'

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8')
const result=JSON.parse(read('evals/val-golden-performance-local-result-v1.json'))
const sloContract=JSON.parse(read('evals/val-performance-slos-v1.json'))

test('GP-001–GP-016 — resultado medido contém latência, qualidade, especificidade, grounding e resultado',()=>{
 assert.equal(result.coverage.expected_cases,16)
 assert.equal(result.coverage.observed_cases,16)
 assert.deepEqual(result.coverage.missing_cases,[])
 assert.equal(result.coverage.p95_sufficient_sample_min,20)
 assert.equal(result.overall.count,320)
 assert.equal(result.overall.success,320)
 assert.equal(result.overall.failed,0)
 assert.equal(result.overall.error_rate_percent,0)
 assert.equal(result.overall.contract_path_mismatches,0)
 assert.equal(result.overall.target_execution_misses,0)
 assert.equal(result.overall.fast_generic_failures,0)
 for(const [caseId,summary] of Object.entries(result.by_case)){
  assert.equal(summary.count,20,caseId)
  for(const metric of ['p50','p90','p95']){
   assert.equal(Number.isFinite(summary.metrics_ms.TTFR[metric]),true,`${caseId}.TTFR.${metric}`)
   assert.equal(Number.isFinite(summary.metrics_ms.TOTAL[metric]),true,`${caseId}.TOTAL.${metric}`)
  }
  assert.ok(summary.quality.SCORE.p50>=.9,`${caseId}.quality`)
  assert.ok(summary.quality.SPECIFICITY.p50>=.8,`${caseId}.specificity`)
  assert.ok(summary.quality.GROUNDING.p50>=.8,`${caseId}.grounding`)
  const sample=result.samples.find(item=>item.case_id===caseId)
  assert.ok(sample.intent,`${caseId}.intent`)
  assert.equal(sample.path_matches_contract,true,`${caseId}.path`)
  assert.equal(sample.target_executed,true,`${caseId}.target`)
  assert.match(sample.result,/^(?:PASS|PARTIAL)_/,`${caseId}.result`)
 }
})

test('SLOs separam seis classes e preservam FAST + genérico = FAIL',()=>{
 assert.deepEqual(Object.keys(result.by_service_class).sort(),['CONTEXT','DEEP','FAST','LIVE_DATA','TOOL','VOICE'])
 const slo=read('VAL_PERFORMANCE_SLOS_v1.md')
 for(const serviceClass of ['FAST','CONTEXT','DEEP','TOOL','LIVE_DATA','VOICE'])assert.match(slo,new RegExp(`\\| ${serviceClass} \\|`))
 assert.match(slo,/FAST \+ GENÉRICO = FAIL/)
 assert.match(slo,/TTFUR/)
 assert.match(slo,/Error Rate/)
 assert.match(slo,/NOT_APPROVED_INSUFFICIENT_STAGING_EVIDENCE/)
})

test('SLO executável aprova a evidência medida e reprova FAST genérico',()=>{
 const evidence=evaluatePerformanceSlo(result,sloContract)
 assert.equal(evidence.status,'PASS')
 assert.equal(evidence.failed_count,0)

 const regressed=structuredClone(result)
 regressed.overall.fast_generic_failures=1
 const failed=evaluatePerformanceSlo(regressed,sloContract)
 assert.equal(failed.status,'FAIL')
 assert.ok(failed.checks.some(item=>item.name==='fast_generic_failures'&&!item.passed))
})
