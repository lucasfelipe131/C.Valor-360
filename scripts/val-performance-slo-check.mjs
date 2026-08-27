#!/usr/bin/env node

import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const finite=value=>Number.isFinite(Number(value))
const round=value=>Number(Number(value).toFixed(3))

export function evaluatePerformanceSlo(report,slo){
 const checks=[]
 const check=(name,passed,actual,expected)=>checks.push({name,passed:Boolean(passed),actual,expected})
 const expectedCases=Array.isArray(slo?.expected_cases)?slo.expected_cases:[]
 const observedCases=Object.keys(report?.by_case||{}).sort()
 const floors=slo?.quality_floors||{}

 check('schema',report?.schema_version==='val.performance_benchmark_result.v1',report?.schema_version,'val.performance_benchmark_result.v1')
 check('fixture_class',report?.fixture_class==='SYNTHETIC_ONLY',report?.fixture_class,'SYNTHETIC_ONLY')
 check('contains_real_data',report?.contains_real_data===false,report?.contains_real_data,false)
 check('case_coverage',JSON.stringify(observedCases)===JSON.stringify([...expectedCases].sort()),observedCases,expectedCases)
 check('missing_cases',Array.isArray(report?.coverage?.missing_cases)&&report.coverage.missing_cases.length===0,report?.coverage?.missing_cases,[])
 check('contract_path_mismatches',report?.overall?.contract_path_mismatches===0,report?.overall?.contract_path_mismatches,0)
 check('target_execution_misses',report?.overall?.target_execution_misses===0,report?.overall?.target_execution_misses,0)
 check('fast_generic_failures',report?.overall?.fast_generic_failures===0,report?.overall?.fast_generic_failures,0)

 for(const caseId of expectedCases){
  const summary=report?.by_case?.[caseId]
  check(`${caseId}.sample_count`,Number(summary?.count)>=Number(slo.p95_min_samples),summary?.count,`>=${slo.p95_min_samples}`)
 }

 for(const [serviceClass,budget] of Object.entries(slo?.service_classes||{})){
  const summary=report?.by_service_class?.[serviceClass]
  const ttfr=summary?.metrics_ms?.TTFR?.p95
  const total=summary?.metrics_ms?.TOTAL?.p95
  const errorRate=summary?.error_rate_percent
  check(`${serviceClass}.sample_count`,Number(summary?.count)>=Number(slo.p95_min_samples),summary?.count,`>=${slo.p95_min_samples}`)
  check(`${serviceClass}.ttfur_p95_ms`,finite(ttfr)&&Number(ttfr)<=Number(budget.ttfur_p95_ms),ttfr,`<=${budget.ttfur_p95_ms}`)
  check(`${serviceClass}.total_p95_ms`,finite(total)&&Number(total)<=Number(budget.total_p95_ms),total,`<=${budget.total_p95_ms}`)
  check(`${serviceClass}.error_rate_percent`,finite(errorRate)&&Number(errorRate)<=Number(budget.max_error_rate_percent),errorRate,`<=${budget.max_error_rate_percent}`)
  check(`${serviceClass}.quality_min`,finite(summary?.quality?.SCORE?.min)&&Number(summary.quality.SCORE.min)>=Number(floors.quality_score),summary?.quality?.SCORE?.min,`>=${floors.quality_score}`)
  check(`${serviceClass}.specificity_min`,finite(summary?.quality?.SPECIFICITY?.min)&&Number(summary.quality.SPECIFICITY.min)>=Number(floors.specificity_score),summary?.quality?.SPECIFICITY?.min,`>=${floors.specificity_score}`)
  check(`${serviceClass}.grounding_min`,finite(summary?.quality?.GROUNDING?.min)&&Number(summary.quality.GROUNDING.min)>=Number(floors.grounding_score),summary?.quality?.GROUNDING?.min,`>=${floors.grounding_score}`)
 }

 const failed=checks.filter(item=>!item.passed)
 return {
  schema_version:'val.performance_slo_check.v1',
  evidence_scope:slo?.evidence_scope||'UNSPECIFIED',
  generated_at:new Date().toISOString(),
  status:failed.length?'FAIL':'PASS',
  check_count:checks.length,
  failed_count:failed.length,
  measured:{
   samples:Number(report?.overall?.count)||0,
   error_rate_percent:finite(report?.overall?.error_rate_percent)?round(report.overall.error_rate_percent):null,
   cases:observedCases.length
  },
  checks
 }
}

function parseArgs(argv){
 const args={slo:'evals/val-performance-slos-v1.json'}
 for(let index=0;index<argv.length;index+=1){
  const key=argv[index]
  if(key==='--help'){args.help=true;continue}
  const value=argv[index+1]
  if(value==null||value.startsWith('--'))throw new Error(`Argumento sem valor: ${key}`)
  if(key==='--result')args.result=value
  else if(key==='--slo')args.slo=value
  else if(key==='--output')args.output=value
  else throw new Error(`Argumento desconhecido: ${key}`)
  index+=1
 }
 return args
}

async function main(){
 const args=parseArgs(process.argv.slice(2))
 if(args.help){process.stdout.write('Uso: node scripts/val-performance-slo-check.mjs --result resultado.json [--slo slos.json] [--output evidencia.json]\n');return}
 if(!args.result)throw new Error('--result é obrigatório.')
 const [report,slo]=await Promise.all([
  readFile(resolve(args.result),'utf8').then(JSON.parse),
  readFile(resolve(args.slo),'utf8').then(JSON.parse)
 ])
 const evidence=evaluatePerformanceSlo(report,slo)
 const serialized=`${JSON.stringify(evidence,null,2)}\n`
 if(args.output)await writeFile(resolve(args.output),serialized,'utf8')
 else process.stdout.write(serialized)
 if(evidence.status!=='PASS'){
  const failed=evidence.checks.filter(item=>!item.passed).map(item=>item.name).join(', ')
  throw new Error(`SLO de componente reprovado: ${failed}`)
 }
 process.stderr.write(`VAL performance SLO: PASS (${evidence.measured.samples} amostras, ${evidence.measured.cases} casos).\n`)
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href
if(isMain)main().catch(error=>{process.stderr.write(`val-performance-slo-check: ${error.message}\n`);process.exitCode=1})
