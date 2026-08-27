#!/usr/bin/env node

import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export const CANONICAL_STAGES=Object.freeze([
 'AUTH','INTENT','CONTEXT','MEMORY','MCA','MIA','TOOL','MODEL','VALIDATION','TTS','TOTAL'
])
export const BENCHMARK_PERCENTILES=Object.freeze([50,75,90,95])

const ALLOWED_PATHS=new Set(['FAST','CONTEXT','DEEP','TOOL','LIVE_DATA'])
const ALLOWED_SAMPLE_KEYS=new Set([
 'case_id','path','status','ttfr_ms','transport_first_byte_ms','total_ms','stages_ms',
 'latency_breakdown','observed_at','source','http_status','observed_path','path_matches_contract',
 'target','target_executed','error_code'
])
const STAGE_ALIASES=Object.freeze({
 AUTH:['AUTH'],
 INTENT:['INTENT','INTENT_ROUTING'],
 CONTEXT:['CONTEXT','CONTEXT_RETRIEVAL','MCTX'],
 MEMORY:['MEMORY'],
 MCA:['MCA'],
 MIA:['MIA'],
 TOOL:['TOOL','TOOL_EXECUTION','EXTERNAL_DATA'],
 MODEL:['MODEL','MODEL_INFERENCE'],
 VALIDATION:['VALIDATION'],
 TTS:['TTS'],
 TOTAL:['TOTAL','RESPONSE']
})

const round=value=>Number(Number(value).toFixed(3))
const finiteNonNegative=value=>Number.isFinite(Number(value))&&Number(value)>=0
const list=value=>Array.isArray(value)?value:[]

export function nearestRankPercentile(values,percentile){
 const sample=list(values).map(Number).filter(Number.isFinite).sort((left,right)=>left-right)
 const requested=Number(percentile)
 if(!sample.length)return null
 if(!Number.isFinite(requested)||requested<=0||requested>100)throw new RangeError('Percentil deve estar no intervalo (0, 100].')
 return sample[Math.max(0,Math.ceil(requested/100*sample.length)-1)]
}

export function metricDistribution(values){
 const sample=list(values).map(Number).filter(Number.isFinite)
 if(!sample.length)return {count:0,min:null,max:null,mean:null,p50:null,p75:null,p90:null,p95:null}
 const result={
  count:sample.length,
  min:round(Math.min(...sample)),
  max:round(Math.max(...sample)),
  mean:round(sample.reduce((sum,value)=>sum+value,0)/sample.length)
 }
 for(const percentile of BENCHMARK_PERCENTILES)result[`p${percentile}`]=round(nearestRankPercentile(sample,percentile))
 return result
}

function stageValue(source,stage){
 for(const key of STAGE_ALIASES[stage]||[stage])if(finiteNonNegative(source?.[key]))return Number(source[key])
 return null
}

export function normalizeBenchmarkSample(sample,index=0){
 if(!sample||typeof sample!=='object'||Array.isArray(sample))throw new TypeError(`Amostra ${index+1} deve ser um objeto.`)
 const unknown=Object.keys(sample).filter(key=>!ALLOWED_SAMPLE_KEYS.has(key))
 if(unknown.length)throw new TypeError(`Amostra ${index+1} contém campos não métricos: ${unknown.join(', ')}.`)
 const caseId=String(sample.case_id||'').trim().toUpperCase()
 if(!/^GP-\d{3}$/.test(caseId))throw new TypeError(`Amostra ${index+1} não possui case_id GP válido.`)
 const path=String(sample.path||'').trim().toUpperCase()
 if(!ALLOWED_PATHS.has(path))throw new TypeError(`Amostra ${caseId} possui path inválido.`)
 const status=String(sample.status||'SUCCESS').trim().toUpperCase()
 if(!['SUCCESS','FAILED','SKIPPED'].includes(status))throw new TypeError(`Amostra ${caseId} possui status inválido.`)
 if(status==='SUCCESS'&&!finiteNonNegative(sample.total_ms))throw new TypeError(`Amostra ${caseId} SUCCESS exige total_ms não negativo.`)
 for(const key of ['ttfr_ms','transport_first_byte_ms','total_ms']){
  if(sample[key]!=null&&!finiteNonNegative(sample[key]))throw new TypeError(`Amostra ${caseId} possui ${key} inválido.`)
 }
 const rawStages=sample.stages_ms??sample.latency_breakdown??{}
 if(!rawStages||typeof rawStages!=='object'||Array.isArray(rawStages))throw new TypeError(`Amostra ${caseId} possui stages_ms inválido.`)
 const stages={}
 for(const stage of CANONICAL_STAGES){
  const measured=stageValue(rawStages,stage)
  if(measured!=null)stages[stage]=round(measured)
 }
 if(stages.TOTAL==null&&finiteNonNegative(sample.total_ms))stages.TOTAL=round(Number(sample.total_ms))
 return Object.freeze({
  case_id:caseId,
  path,
  status,
  ttfr_ms:sample.ttfr_ms==null?null:round(Number(sample.ttfr_ms)),
  transport_first_byte_ms:sample.transport_first_byte_ms==null?null:round(Number(sample.transport_first_byte_ms)),
  total_ms:sample.total_ms==null?null:round(Number(sample.total_ms)),
  stages_ms:Object.freeze(stages),
  observed_at:String(sample.observed_at||''),
  source:String(sample.source||'json-samples'),
  http_status:sample.http_status==null?null:Number(sample.http_status),
  observed_path:String(sample.observed_path||''),
  path_matches_contract:typeof sample.path_matches_contract==='boolean'?sample.path_matches_contract:null,
  target:String(sample.target||''),
  target_executed:typeof sample.target_executed==='boolean'?sample.target_executed:null,
  error_code:String(sample.error_code||'')
 })
}

function summarizeGroup(samples){
 const normalized=list(samples)
 const successful=normalized.filter(sample=>sample.status==='SUCCESS')
 const stages={}
 for(const stage of CANONICAL_STAGES)stages[stage]=metricDistribution(successful.flatMap(sample=>sample.stages_ms[stage]==null?[]:[sample.stages_ms[stage]]))
 return {
  count:normalized.length,
  success:successful.length,
  failed:normalized.filter(sample=>sample.status==='FAILED').length,
  skipped:normalized.filter(sample=>sample.status==='SKIPPED').length,
  contract_path_mismatches:normalized.filter(sample=>sample.path_matches_contract===false).length,
  target_execution_misses:normalized.filter(sample=>sample.target_executed===false).length,
  metrics_ms:{
   TTFR:metricDistribution(successful.flatMap(sample=>sample.ttfr_ms==null?[]:[sample.ttfr_ms])),
   TRANSPORT_FIRST_BYTE:metricDistribution(successful.flatMap(sample=>sample.transport_first_byte_ms==null?[]:[sample.transport_first_byte_ms])),
   TOTAL:metricDistribution(successful.flatMap(sample=>sample.total_ms==null?[]:[sample.total_ms])),
   stages
  }
 }
}

export function summarizeSamples(samples,{goldenSet=null,source='json-samples'}={}){
 const normalized=list(samples).map(normalizeBenchmarkSample)
 const byPath={}
 for(const path of ALLOWED_PATHS)byPath[path]=summarizeGroup(normalized.filter(sample=>sample.path===path))
 const byCase={}
 for(const caseId of [...new Set(normalized.map(sample=>sample.case_id))].sort())byCase[caseId]=summarizeGroup(normalized.filter(sample=>sample.case_id===caseId))
 const expectedIds=list(goldenSet?.cases).map(item=>String(item.id||''))
 const observedIds=[...new Set(normalized.map(sample=>sample.case_id))].sort()
 return {
  schema_version:'val.performance_benchmark_result.v1',
  generated_at:new Date().toISOString(),
  source,
  fixture_class:'SYNTHETIC_ONLY',
  contains_real_data:false,
  percentile_method:'nearest-rank',
  percentiles:[...BENCHMARK_PERCENTILES],
  coverage:{
   expected_cases:expectedIds.length||null,
   observed_cases:observedIds.length,
   missing_cases:expectedIds.length?expectedIds.filter(id=>!observedIds.includes(id)):[],
   ttfr_observations:normalized.filter(sample=>sample.status==='SUCCESS'&&sample.ttfr_ms!=null).length,
   ttfr_not_inferred_from_transport:true
  },
  overall:summarizeGroup(normalized),
  by_path:byPath,
  by_case:byCase,
  samples:normalized
 }
}

export async function loadGoldenSet(filePath){
 const parsed=JSON.parse(await readFile(resolve(filePath),'utf8'))
 if(parsed?.fixture_class!=='SYNTHETIC_ONLY'||parsed?.contains_real_data!==false)throw new Error('Golden set deve declarar SYNTHETIC_ONLY e contains_real_data=false.')
 if(!Array.isArray(parsed.cases)||!parsed.cases.length)throw new Error('Golden set não contém casos.')
 const ids=new Set()
 for(const item of parsed.cases){
  const id=String(item?.id||'').toUpperCase()
  const path=String(item?.path||'').toUpperCase()
  if(!/^GP-\d{3}$/.test(id)||ids.has(id))throw new Error(`Caso golden inválido ou duplicado: ${id||'(vazio)'}.`)
  if(!ALLOWED_PATHS.has(path)||!String(item?.target||'').trim())throw new Error(`Caso ${id} deve declarar path e target válidos.`)
  ids.add(id)
 }
 return parsed
}

export async function loadSampleDocument(filePath){
 const parsed=JSON.parse(await readFile(resolve(filePath),'utf8'))
 if(!parsed||Array.isArray(parsed)||parsed.fixture_class!=='SYNTHETIC_ONLY'||parsed.contains_real_data!==false){
  throw new Error('Arquivo de amostras deve declarar fixture_class=SYNTHETIC_ONLY e contains_real_data=false.')
 }
 if(!Array.isArray(parsed.samples))throw new Error('Arquivo de amostras deve conter samples[].')
 return parsed.samples.map(normalizeBenchmarkSample)
}

function secureStagingUrl(value){
 const url=new URL(String(value||''))
 if(!['http:','https:'].includes(url.protocol))throw new Error('Staging URL deve usar HTTP(S).')
 const host=url.hostname.toLowerCase()
 const allowed=host==='localhost'||host==='127.0.0.1'||host==='::1'||host.includes('staging')
 if(!allowed)throw new Error('Staging URL recusada: o hostname deve identificar staging ou localhost.')
 return url
}

function nestedObjects(value,maxDepth=8){
 const found=[];const queue=[{value,depth:0}];const seen=new Set()
 while(queue.length){
  const current=queue.shift();const item=current.value
  if(!item||typeof item!=='object'||seen.has(item)||current.depth>maxDepth)continue
  seen.add(item);found.push(item)
  for(const nested of Object.values(item))if(nested&&typeof nested==='object')queue.push({value:nested,depth:current.depth+1})
 }
 return found
}

function reportedRun(payload){
 return nestedObjects(payload).find(item=>item?.run&&typeof item.run==='object'&&(item.run.path||item.run.latency_breakdown))?.run
  ||nestedObjects(payload).find(item=>item?.path&&item?.latency_breakdown)
  ||null
}

function reportedTtfr(payload){
 const keys=['ttfr_ms','time_to_first_useful_response_ms','TIME_TO_FIRST_USEFUL_RESPONSE']
 for(const item of nestedObjects(payload))for(const key of keys)if(finiteNonNegative(item?.[key]))return Number(item[key])
 return null
}

function reportedLatency(payload,run){
 if(run?.performance?.latency&&typeof run.performance.latency==='object')return run.performance.latency
 for(const item of nestedObjects(payload)){
  if(item?.performance?.latency&&typeof item.performance.latency==='object')return item.performance.latency
  if(item?.latency&&typeof item.latency==='object'&&item?.content_free===true)return item.latency
 }
 return run?.latency_breakdown&&typeof run.latency_breakdown==='object'?run.latency_breakdown:{}
}

function capabilityExecuted(payload,target){
 const expected=String(target||'').toUpperCase()
 if(!expected)return null
 for(const item of nestedObjects(payload)){
  const results=Array.isArray(item?.capability_results)?item.capability_results:[]
  const match=results.find(result=>String(result?.capability||'').toUpperCase()===expected)
  if(match)return ['EXECUTED','SUCCESS','COMPLETED'].includes(String(match.status||'').toUpperCase())
 }
 return null
}

function stagingHeaders(){
 const headers={'Content-Type':'application/json','Accept':'application/json'}
 if(process.env.VAL_PERFORMANCE_STAGING_COOKIE)headers.Cookie=process.env.VAL_PERFORMANCE_STAGING_COOKIE
 if(process.env.VAL_PERFORMANCE_STAGING_BEARER)headers.Authorization=`Bearer ${process.env.VAL_PERFORMANCE_STAGING_BEARER}`
 return headers
}

async function responseBodyWithFirstByte(response,startedAt){
 if(!response.body)return {text:'',firstByteMs:null}
 const reader=response.body.getReader();const chunks=[];let size=0;let firstByteMs=null
 while(true){
  const {done,value}=await reader.read()
  if(done)break
  if(firstByteMs==null)firstByteMs=performance.now()-startedAt
  size+=value.byteLength
  if(size>10_000_000){reader.cancel();throw new Error('Resposta de staging excedeu 10 MB.')}
  chunks.push(Buffer.from(value))
 }
 return {text:Buffer.concat(chunks).toString('utf8'),firstByteMs}
}

async function executeStagingProbe({baseUrl,goldenCase,repeatIndex,timeoutMs}){
 const probe=goldenCase.staging_probe||{}
 if(probe.enabled!==true)return normalizeBenchmarkSample({
  case_id:goldenCase.id,path:goldenCase.path,target:goldenCase.target,status:'SKIPPED',source:'staging-opt-in',error_code:String(probe.kind||'PROBE_DISABLED')
 })
 const endpoint=new URL(String(probe.endpoint||'/api/val/chat'),baseUrl)
 const body=structuredClone(probe.body||{})
 body.requestId=`val-gp-${goldenCase.id.toLowerCase()}-${repeatIndex+1}-${Date.now()}`
 const startedAt=performance.now();let response
 try{
  response=await fetch(endpoint,{method:'POST',headers:stagingHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)})
  const {text,firstByteMs}=await responseBodyWithFirstByte(response,startedAt)
  const totalMs=performance.now()-startedAt
  let payload=null
  try{payload=text?JSON.parse(text):null}catch{}
  const run=reportedRun(payload);const observedPath=String(run?.path||'').toUpperCase()
  const latency=reportedLatency(payload,run)
  const success=response.ok
  return normalizeBenchmarkSample({
   case_id:goldenCase.id,
   path:goldenCase.path,
   target:goldenCase.target,
   status:success?'SUCCESS':'FAILED',
   ttfr_ms:success?reportedTtfr(payload):null,
   transport_first_byte_ms:firstByteMs,
   total_ms:totalMs,
   latency_breakdown:{...latency,TOTAL:totalMs},
   observed_at:new Date().toISOString(),
   source:'staging-opt-in',
   http_status:response.status,
   observed_path:observedPath,
   path_matches_contract:observedPath?observedPath===String(goldenCase.path).toUpperCase():null,
   target_executed:capabilityExecuted(payload,goldenCase.target),
   error_code:success?'':String(payload?.code||`HTTP_${response.status}`)
  })
 }catch(error){
  return normalizeBenchmarkSample({
   case_id:goldenCase.id,path:goldenCase.path,target:goldenCase.target,status:'FAILED',
   total_ms:performance.now()-startedAt,observed_at:new Date().toISOString(),source:'staging-opt-in',
   error_code:error?.name==='TimeoutError'?'TIMEOUT':'TRANSPORT_ERROR'
  })
 }
}

export async function runStagingBenchmark({stagingUrl,goldenSet,repeat=1,timeoutMs=120_000,optIn=false}={}){
 if(optIn!==true&&process.env.VAL_PERFORMANCE_STAGING_OPT_IN!=='STAGING_ONLY')throw new Error('Staging benchmark exige --confirm-staging-only ou VAL_PERFORMANCE_STAGING_OPT_IN=STAGING_ONLY.')
 const baseUrl=secureStagingUrl(stagingUrl)
 const repetitions=Math.max(1,Math.min(20,Number(repeat)||1))
 const samples=[]
 for(let index=0;index<repetitions;index+=1){
  for(const goldenCase of goldenSet.cases)samples.push(await executeStagingProbe({baseUrl,goldenCase,repeatIndex:index,timeoutMs}))
 }
 return samples
}

function parseArgs(argv){
 const args={goldenSet:'evals/val-golden-performance-v1.json',repeat:1,timeoutMs:120_000,optIn:false}
 for(let index=0;index<argv.length;index+=1){
  const key=argv[index]
  if(key==='--confirm-staging-only'){args.optIn=true;continue}
  if(key==='--help'){args.help=true;continue}
  const value=argv[index+1]
  if(value==null||value.startsWith('--'))throw new Error(`Argumento sem valor: ${key}`)
  if(key==='--samples')args.samples=value
  else if(key==='--staging-url')args.stagingUrl=value
  else if(key==='--golden-set')args.goldenSet=value
  else if(key==='--output')args.output=value
  else if(key==='--repeat')args.repeat=Number(value)
  else if(key==='--timeout-ms')args.timeoutMs=Number(value)
  else throw new Error(`Argumento desconhecido: ${key}`)
  index+=1
 }
 return args
}

function usage(){
 return [
  'Uso:',
  '  node scripts/val-performance-benchmark.mjs --samples samples.json [--output result.json]',
  '  node scripts/val-performance-benchmark.mjs --staging-url https://...staging... --confirm-staging-only [--repeat 3]',
  '',
  'Amostras precisam declarar SYNTHETIC_ONLY. Credenciais opcionais são lidas de',
  'VAL_PERFORMANCE_STAGING_COOKIE ou VAL_PERFORMANCE_STAGING_BEARER e nunca entram no relatório.'
 ].join('\n')
}

async function main(){
 const args=parseArgs(process.argv.slice(2))
 if(args.help){process.stdout.write(`${usage()}\n`);return}
 if(Boolean(args.samples)===Boolean(args.stagingUrl))throw new Error('Escolha exatamente uma origem: --samples ou --staging-url.')
 const goldenSet=await loadGoldenSet(args.goldenSet)
 const samples=args.samples
  ?await loadSampleDocument(args.samples)
  :await runStagingBenchmark({stagingUrl:args.stagingUrl,goldenSet,repeat:args.repeat,timeoutMs:args.timeoutMs,optIn:args.optIn})
 const report=summarizeSamples(samples,{goldenSet,source:args.samples?'json-samples':'staging-opt-in'})
 const serialized=`${JSON.stringify(report,null,2)}\n`
 if(args.output)await writeFile(resolve(args.output),serialized,'utf8')
 else process.stdout.write(serialized)
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href
if(isMain)main().catch(error=>{process.stderr.write(`val-performance-benchmark: ${error.message}\n`);process.exitCode=1})
