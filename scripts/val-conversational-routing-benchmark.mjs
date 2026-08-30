#!/usr/bin/env node

import {createHash,randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'

export const routingBenchmarkVersion='val.conversational_routing_benchmark.v1'
export const routingBenchmarkDefaults=Object.freeze({warmup:3,repeat:30,timeoutMs:10_000,delayMs:0})

const stages=Object.freeze(['AUTH','ENTITY','INTENT','DATABASE','CONTEXT','MEMORY','MCA','MIA','TOOL','MODEL','VALIDATION','TTS','TOTAL','TTFR'])
const fastIncidentMs=5_000

const clean=(value,max=500)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))
const round=value=>Number(Number(value).toFixed(3))
const wait=milliseconds=>milliseconds>0?new Promise(resolveWait=>setTimeout(resolveWait,milliseconds)):Promise.resolve()
const safeCode=value=>clean(value,120).replace(/[^A-Za-z0-9_.:-]/g,'_')||''
const ref=value=>createHash('sha256').update(String(value??'')).digest('hex').slice(0,16)

function numberArgument(value,label,{minimum,maximum,integer=true}={}){
 const numeric=Number(value)
 if(!Number.isFinite(numeric)||(integer&&!Number.isInteger(numeric))||numeric<minimum||numeric>maximum)throw new Error(`${label} deve estar entre ${minimum} e ${maximum}.`)
 return numeric
}

function valueAfter(argv,index,key){
 const value=argv[index+1]
 if(value==null||String(value).startsWith('--'))throw new Error(`Argumento sem valor: ${key}`)
 return value
}

export function parseArgs(argv=[],env=process.env){
 const options={
  baseUrl:clean(env.VAL_ROUTING_BENCH_BASE_URL,500),
  expectedSha:clean(env.VAL_ROUTING_BENCH_EXPECTED_SHA,64).toLowerCase(),
  phase:clean(env.VAL_ROUTING_BENCH_PHASE,20).toLowerCase()||'current',
  clientA:{id:clean(env.VAL_ROUTING_BENCH_CLIENT_A_ID,180),name:clean(env.VAL_ROUTING_BENCH_CLIENT_A_NAME,180)},
  clientB:{id:clean(env.VAL_ROUTING_BENCH_CLIENT_B_ID,180),name:clean(env.VAL_ROUTING_BENCH_CLIENT_B_NAME,180)},
  warmup:routingBenchmarkDefaults.warmup,repeat:routingBenchmarkDefaults.repeat,
  timeoutMs:routingBenchmarkDefaults.timeoutMs,delayMs:routingBenchmarkDefaults.delayMs,
  output:'',offline:false,confirmStagingOnly:env.VAL_ROUTING_BENCH_CONFIRM_STAGING_ONLY==='STAGING_ONLY',help:false,
 }
 for(let index=0;index<argv.length;index+=1){
  const key=argv[index]
  if(key==='--help'||key==='-h'){options.help=true;continue}
  if(key==='--offline'){options.offline=true;continue}
  if(key==='--confirm-staging-only'){options.confirmStagingOnly=true;continue}
  const value=valueAfter(argv,index,key)
  if(key==='--base-url')options.baseUrl=clean(value,500)
  else if(key==='--expected-sha')options.expectedSha=clean(value,64).toLowerCase()
  else if(key==='--phase')options.phase=clean(value,20).toLowerCase()
  else if(key==='--client-a-id')options.clientA.id=clean(value,180)
  else if(key==='--client-a-name')options.clientA.name=clean(value,180)
  else if(key==='--client-b-id')options.clientB.id=clean(value,180)
  else if(key==='--client-b-name')options.clientB.name=clean(value,180)
  else if(key==='--warmup')options.warmup=numberArgument(value,'--warmup',{minimum:0,maximum:20})
  else if(key==='--repeat')options.repeat=numberArgument(value,'--repeat',{minimum:1,maximum:100})
  else if(key==='--timeout-ms')options.timeoutMs=numberArgument(value,'--timeout-ms',{minimum:1_000,maximum:120_000})
  else if(key==='--delay-ms')options.delayMs=numberArgument(value,'--delay-ms',{minimum:0,maximum:60_000})
  else if(key==='--output')options.output=String(value)
  else throw new Error(`Argumento desconhecido: ${key}`)
  index+=1
 }
 if(!['before','after','current'].includes(options.phase))throw new Error('--phase deve ser before, after ou current.')
 return Object.freeze({...options,clientA:Object.freeze({...options.clientA}),clientB:Object.freeze({...options.clientB})})
}

export function usage(){
 return [
  'Uso:',
  '  node scripts/val-conversational-routing-benchmark.mjs --base-url https://... --expected-sha <40-hex> --confirm-staging-only [opções]',
  '  node scripts/val-conversational-routing-benchmark.mjs --offline [opções]',
  '',
  'Opções:',
  '  --phase before|after|current        Fase registrada no relatório (default: current)',
  '  --warmup N                         Sequências de aquecimento excluídas (default: 3)',
  '  --repeat N                         Sequências medidas (default: 30)',
  '  --timeout-ms N                     Timeout por request (default: 10000)',
  '  --delay-ms N                       Intervalo entre requests (default: 0)',
  '  --client-a-id/--client-a-name      Produtor A controlado do staging',
  '  --client-b-id/--client-b-name      Produtor B controlado do staging',
  '  --output arquivo.json              Grava o JSON; sem a opção, escreve em stdout',
  '  --offline                          Valida argumentos e imprime o plano sem rede',
  '',
  'As opções também aceitam VAL_ROUTING_BENCH_BASE_URL, VAL_ROUTING_BENCH_EXPECTED_SHA,',
  'VAL_ROUTING_BENCH_CLIENT_A_ID/NAME e VAL_ROUTING_BENCH_CLIENT_B_ID/NAME.',
  'Autenticação é lida SOMENTE de VAL_ROUTING_BENCH_COOKIE ou VAL_ROUTING_BENCH_BEARER',
  '(com fallback para VAL_PERFORMANCE_STAGING_COOKIE/BEARER) e nunca entra no relatório.',
 ].join('\n')
}

function canonicalBaseUrl(value,{offline=false,confirmStagingOnly=false}={}){
 const candidate=clean(value,500)||(offline?'http://127.0.0.1:3000':'')
 if(!candidate)throw new Error('--base-url ou VAL_ROUTING_BENCH_BASE_URL é obrigatório.')
 let url
 try{url=new URL(candidate)}catch{throw new Error('Base URL inválida.')}
 if(url.username||url.password)throw new Error('Credenciais na URL são proibidas; use somente variáveis de ambiente.')
 const local=['localhost','127.0.0.1','::1'].includes(url.hostname.toLowerCase())
 if(local&&!['http:','https:'].includes(url.protocol))throw new Error('Base URL local deve usar HTTP(S).')
 if(!local&&url.protocol!=='https:')throw new Error('Benchmark remoto exige HTTPS.')
 if(!local&&!confirmStagingOnly)throw new Error('Destino remoto exige --confirm-staging-only ou VAL_ROUTING_BENCH_CONFIRM_STAGING_ONLY=STAGING_ONLY.')
 url.pathname=url.pathname.replace(/\/+$/,'')+'/'
 url.search='';url.hash=''
 return {url,local}
}

function fixture(options,{offline=false}={}){
 const fallback=offline?{clientA:{id:'offline-client-a',name:'Produtor A'},clientB:{id:'offline-client-b',name:'Produtor B'}}:{clientA:{},clientB:{}}
 const clientA={id:options.clientA.id||fallback.clientA.id,name:options.clientA.name||fallback.clientA.name}
 const clientB={id:options.clientB.id||fallback.clientB.id,name:options.clientB.name||fallback.clientB.name}
 for(const [label,client] of [['A',clientA],['B',clientB]])if(!clean(client.id)||!clean(client.name))throw new Error(`Produtor ${label} exige id e nome controlados.`)
 if(clientA.id===clientB.id)throw new Error('Produtores A e B precisam ter IDs diferentes.')
 return Object.freeze({clientA:Object.freeze(clientA),clientB:Object.freeze(clientB)})
}

export function buildCasePlan(controlledFixture){
 const {clientA,clientB}=controlledFixture
 return Object.freeze([
  {id:'OPEN',label:'Open producer',client:clientA,message:`Abra ${clientA.name}.`,expectedPath:'FAST',expectedIntent:'OPEN',expectedAction:'OPEN_CLIENT',expectedCapability:'WORKSPACE_NAVIGATION',expectedClient:'A',target:{p50:300,p95:800}},
  {id:'LAST_VISIT',label:'Last visit',client:clientA,message:'Qual foi a última visita dele?',expectedPath:'FAST',expectedIntent:'ASK_CLIENT',expectedDataPath:'LATEST_VISIT',expectedCapability:'VISIT_HISTORY',expectedClient:'A',target:{p50:700,p95:1_500}},
  {id:'OBJECTION',label:'Last objection',client:clientA,message:'Qual foi a principal objeção?',expectedPath:'FAST',expectedIntent:'OBJECTION_HELP',expectedDataPath:'LATEST_CONFIRMED_OBJECTION',expectedCapability:'VISIT_HISTORY',expectedClient:'A',target:{p50:700,p95:1_500}},
  {id:'PURCHASE',label:'Last purchase',client:clientA,message:'Quanto foi a última compra?',expectedPath:'FAST',expectedIntent:'ASK_CLIENT',expectedDataPath:'LATEST_PURCHASE',expectedCapability:'COMMERCIAL_HISTORY',expectedClient:'A',target:{p50:700,p95:1_500}},
  {id:'FOLLOWUP',label:'Stateful follow-up (server fallback)',client:clientA,message:`Resume sua resposta anterior em uma linha, mantendo ${clientA.name} como produtor atual e sem executar nova busca.`,expectedPath:'FAST',expectedIntent:'ASK_CLIENT',expectedCapability:'SESSION_COMMAND',expectedClient:'A',target:{p50:800,p95:1_800}},
  {id:'CALC',label:'Canonical simple calculation',client:clientA,message:'Calcule demanda de sementes: área 100 ha, população 300000 sementes/ha, margem 5%, embalagem 60000 sementes.',expectedPath:'TOOL',expectedIntent:'CALCULATE',expectedCapability:'CALCULATORS',expectedClient:'A',expectedBags:525,target:{p50:500,p95:1_000}},
  {id:'SWITCH',label:'Context switch',client:clientB,message:`Agora abre ${clientB.name}.`,expectedPath:'FAST',expectedIntent:'OPEN',expectedAction:'OPEN_CLIENT',expectedCapability:'WORKSPACE_NAVIGATION',expectedClient:'B',target:{p50:300,p95:800}},
  {id:'SWITCH_FOLLOWUP',label:'Fact after context switch',client:clientB,message:'E a última visita dele?',expectedPath:'FAST',expectedIntent:'ASK_CLIENT',expectedDataPath:'LATEST_VISIT',expectedCapability:'VISIT_HISTORY',expectedClient:'B',target:{p50:800,p95:1_800}},
  {id:'COMPARE',label:'Compare current and previous producer',client:clientB,message:'Compare os dois.',expectedPath:'FAST',expectedIntent:'ASK_CLIENT',expectedDataPath:'CLIENT_COMPARISON',expectedCapability:'CLIENT_CONTEXT',expectedClient:'B',expectedCompared:[clientB.id,clientA.id],expectedToolCalls:2,target:{p50:700,p95:1_500}},
 ].map(item=>Object.freeze(item)))
}

function authHeaders(env,{local=false,offline=false}={}){
 const cookie=String(env.VAL_ROUTING_BENCH_COOKIE||env.VAL_PERFORMANCE_STAGING_COOKIE||'').trim()
 const bearer=String(env.VAL_ROUTING_BENCH_BEARER||env.VAL_PERFORMANCE_STAGING_BEARER||'').trim()
 if(cookie&&bearer)throw new Error('Configure apenas um método de autenticação do benchmark: cookie ou bearer.')
 if(!local&&!offline&&!cookie&&!bearer)throw new Error('Benchmark remoto exige autenticação via variável de ambiente; não envie credenciais pela CLI.')
 const headers={'Accept':'application/json','Content-Type':'application/json'}
 if(cookie)headers.Cookie=cookie
 if(bearer)headers.Authorization=`Bearer ${bearer}`
 return Object.freeze({mode:cookie?'cookie':bearer?'bearer':'none',headers:Object.freeze(headers)})
}

function nestedObjects(value,maxDepth=9){
 const output=[];const queue=[{value,depth:0}];const seen=new Set()
 while(queue.length){
  const current=queue.shift();const item=current.value
  if(!item||typeof item!=='object'||seen.has(item)||current.depth>maxDepth)continue
  seen.add(item);output.push(item)
  for(const nested of Object.values(item))if(nested&&typeof nested==='object')queue.push({value:nested,depth:current.depth+1})
 }
 return output
}

function responseRun(payload){
 return payload?.advice?.ai_reasoning?.run
  ||nestedObjects(payload).find(item=>item?.run&&typeof item.run==='object')?.run
  ||null
}

function performanceData(payload,run){
 return payload?.responseMetadata?.performance||run?.performance||null
}

function numberOrNull(...values){
 for(const value of values)if(finite(value))return Number(value)
 return null
}

function responseExecution(payload,run){
 const budget=payload?.responseMetadata?.executionBudget||{}
 return {
  model_calls:numberOrNull(budget.modelCalls,run?.model_call_count),
  tool_calls:numberOrNull(budget.toolCalls,run?.tool_call_count),
  data_lookups:numberOrNull(budget.dataLookups),
  entity_resolutions:numberOrNull(budget.entityResolutions),
  hops:numberOrNull(budget.hops,run?.hop_count),
  estimated_input_tokens:numberOrNull(budget.estimatedInputTokens,run?.estimated_input_tokens),
  estimated_output_tokens:numberOrNull(budget.estimatedOutputTokens,run?.estimated_output_tokens),
  estimated_cost_usd:numberOrNull(budget.estimatedCostUsd,run?.estimated_cost_usd),
 }
}

function responseLatency(performanceInfo,run){
 const canonical=performanceInfo?.latency&&typeof performanceInfo.latency==='object'?performanceInfo.latency:{}
 const legacy=run?.latency_breakdown&&typeof run.latency_breakdown==='object'?run.latency_breakdown:{}
 const aliases={AUTH:'AUTH',ENTITY:'ENTITY',INTENT:'INTENT',DATABASE:'DATABASE',CONTEXT:'CONTEXT_RETRIEVAL',MEMORY:'MEMORY',MCA:'MCA',MIA:'MIA',TOOL:'EXTERNAL_DATA',MODEL:'MODEL_INFERENCE',VALIDATION:'VALIDATION',TTS:'TTS',TOTAL:'RESPONSE',TTFR:'TTFR'}
 return Object.fromEntries(stages.map(stage=>[stage,numberOrNull(canonical[stage],legacy[aliases[stage]])]))
}

function capabilities(run){
 const results=Array.isArray(run?.capability_results)?run.capability_results:[]
 return results.map(item=>({capability:clean(item?.capability,80).toUpperCase(),status:clean(item?.status,40).toUpperCase()})).filter(item=>item.capability)
}

function responseComparedClients(payload){
 const candidates=payload?.responseMetadata?.comparedClients||payload?.comparisonResolution?.clients||[]
 return Array.isArray(candidates)?candidates.map(item=>clean(item?.id,180)).filter(Boolean):[]
}

function validateOutcome(spec,payload,observed){
 const failures=[]
 const expect=(condition,code)=>{if(!condition)failures.push(code)}
 expect(observed.http_status===200,'HTTP_NOT_200')
 expect(observed.path===spec.expectedPath,'PATH_MISMATCH')
 expect(observed.intent===spec.expectedIntent,'INTENT_MISMATCH')
 if(spec.expectedDataPath)expect(observed.data_path===spec.expectedDataPath,'DATA_PATH_MISMATCH')
 if(spec.expectedAction)expect(observed.workspace_action===spec.expectedAction,'WORKSPACE_ACTION_MISMATCH')
 expect(observed.current_client_ref===ref(spec.client.id),'CURRENT_CLIENT_MISMATCH')
 const capability=observed.capabilities.find(item=>item.capability===spec.expectedCapability)
 expect(capability?.status==='EXECUTED','CAPABILITY_NOT_EXECUTED')
 expect(observed.execution.model_calls===0,'MODEL_CALL_COUNT_NOT_ZERO')
 if(spec.expectedToolCalls!=null)expect(observed.execution.tool_calls===spec.expectedToolCalls,'TOOL_CALL_COUNT_MISMATCH')
 if(spec.expectedBags!=null)expect(observed.calculation_bags===spec.expectedBags,'CALCULATOR_RESULT_MISMATCH')
 if(spec.expectedCompared){
  const actual=observed.compared_client_refs
  const expected=spec.expectedCompared.map(ref)
  expect(actual.length===expected.length&&expected.every(item=>actual.includes(item)),'COMPARED_CLIENTS_MISMATCH')
 }
 if(spec.expectedPath==='FAST'){
  expect(observed.latency.CONTEXT===null,'FAST_USED_CONTEXT')
  expect(observed.latency.MODEL===null,'FAST_USED_MODEL_STAGE')
  expect(observed.wall_ms<fastIncidentMs,'FAST_LATENCY_INCIDENT')
 }
 return failures
}

async function readResponse(response,startedAt){
 if(!response.body)return {text:'',firstByteMs:null}
 const reader=response.body.getReader();const chunks=[];let bytes=0;let firstByteMs=null
 while(true){
  const {done,value}=await reader.read();if(done)break
  if(firstByteMs===null)firstByteMs=round(performance.now()-startedAt)
  bytes+=value.byteLength
  if(bytes>10_000_000){await reader.cancel();throw Object.assign(new Error('Resposta excedeu o limite do benchmark.'),{code:'RESPONSE_TOO_LARGE'})}
  chunks.push(Buffer.from(value))
 }
 return {text:Buffer.concat(chunks).toString('utf8'),firstByteMs}
}

export function benchmarkRequestBody({spec,conversationId,requestId=randomUUID()}={}){
 return Object.freeze({
  message:spec.message,mode:'daily',conversationId,requestId,
  sessionContext:{objective:`Benchmark controlado ${spec.id}`,persistence_mode:'NONE',input_modality:'text',response_mode:'text'},
 })
}

async function executeRequest({baseUrl,headers,spec,conversationId,timeoutMs,phase,iteration,warmup}){
 const requestId=randomUUID()
 // O benchmark precisa provar resolução nominal, carry-over e troca de
 // produtor pela thread. Declarar clientId em cada turno mascararia falhas.
 const body=benchmarkRequestBody({spec,conversationId,requestId})
 const startedAt=performance.now();let response=null;let payload=null;let firstByteMs=null;let transportCode=''
 try{
  response=await fetch(new URL('/api/val/chat',baseUrl),{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)})
  const read=await readResponse(response,startedAt);firstByteMs=read.firstByteMs
  try{payload=read.text?JSON.parse(read.text):null}catch{transportCode='INVALID_JSON'}
 }catch(error){transportCode=error?.name==='TimeoutError'?'TIMEOUT':safeCode(error?.code||'TRANSPORT_ERROR')}
 const wallMs=round(performance.now()-startedAt)
 const run=responseRun(payload);const performanceInfo=performanceData(payload,run);const latency=responseLatency(performanceInfo,run);const execution=responseExecution(payload,run)
 const observed={
  case_id:spec.id,phase,iteration,warmup:Boolean(warmup),http_status:response?.status??null,wall_ms:wallMs,first_byte_ms:firstByteMs,
  path:clean(performanceInfo?.path||run?.path||payload?.route,30).toUpperCase(),
  intent:clean(performanceInfo?.intent||payload?.responseMetadata?.intent||run?.intent,80).toUpperCase(),
  data_path:clean(payload?.responseMetadata?.dataPath||run?.premises?.data_path,80).toUpperCase(),
  workspace_action:clean(payload?.workspaceAction?.type||payload?.workspace_action?.type,80).toUpperCase(),
  current_client_ref:payload?.conversationState?.current_client?.id?ref(payload.conversationState.current_client.id):'',
  compared_client_refs:responseComparedClients(payload).map(ref),
  capabilities:capabilities(run),execution,latency,
  calculation_bags:numberOrNull(run?.tool_result?.facts?.bagsRequired),
  error_code:safeCode(payload?.code||transportCode||(response&&!response.ok?`HTTP_${response.status}`:'')),validation_errors:[],
 }
 observed.validation_errors=validateOutcome(spec,payload,observed)
 return Object.freeze(observed)
}

export function nearestRank(values=[],ratio=.5){
 const ordered=values.filter(finite).map(Number).sort((left,right)=>left-right)
 if(!ordered.length)return null
 const index=Math.max(0,Math.ceil(ordered.length*ratio)-1)
 return round(ordered[index])
}

export function distribution(values=[]){
 const valid=values.filter(finite).map(Number)
 return Object.freeze({count:valid.length,p50:nearestRank(valid,.5),p90:nearestRank(valid,.9),p95:nearestRank(valid,.95),max:valid.length?round(Math.max(...valid)):null})
}

function counts(values=[]){
 return Object.fromEntries([...new Set(values.map(value=>String(value??'null')))].sort().map(value=>[value,values.filter(item=>String(item??'null')===value).length]))
}

export function summarizeCase(spec,samples=[]){
 const selected=samples.filter(sample=>sample.case_id===spec.id&&!sample.warmup)
 const latencyStages=Object.fromEntries(stages.map(stage=>[stage,distribution(selected.flatMap(sample=>sample.latency?.[stage]==null?[]:[sample.latency[stage]]))]))
 const validationFailures=selected.flatMap(sample=>sample.validation_errors||[])
 const fastContextUses=selected.filter(sample=>spec.expectedPath==='FAST'&&sample.latency?.CONTEXT!==null).length
 const fastModelUses=selected.filter(sample=>spec.expectedPath==='FAST'&&(sample.execution?.model_calls!==0||sample.latency?.MODEL!==null)).length
 const wall=distribution(selected.map(sample=>sample.wall_ms))
 const checks={
  sample_count:selected.length>=20,
  http_success:selected.length>0&&selected.every(sample=>sample.http_status===200),
  correctness:selected.length>0&&validationFailures.length===0,
  p50_target:wall.p50!==null&&wall.p50<spec.target.p50,
  p95_target:wall.p95!==null&&wall.p95<spec.target.p95,
  no_fast_incident:spec.expectedPath!=='FAST'||selected.every(sample=>sample.wall_ms<fastIncidentMs),
  fast_no_model:spec.expectedPath!=='FAST'||fastModelUses===0,
  fast_no_context:spec.expectedPath!=='FAST'||fastContextUses===0,
 }
 return Object.freeze({
  case_id:spec.id,label:spec.label,expected_path:spec.expectedPath,target_ms:spec.target,
  samples:selected.length,http_status_counts:counts(selected.map(sample=>sample.http_status)),path_counts:counts(selected.map(sample=>sample.path)),
  model_call_counts:counts(selected.map(sample=>sample.execution?.model_calls)),tool_call_counts:counts(selected.map(sample=>sample.execution?.tool_calls)),
  latency_ms:{wall,first_byte:distribution(selected.flatMap(sample=>sample.first_byte_ms==null?[]:[sample.first_byte_ms])),ttfr:latencyStages.TTFR,stages:latencyStages},
  validation_failure_counts:counts(validationFailures),fast_context_uses:fastContextUses,fast_model_uses:fastModelUses,
  checks,status:Object.values(checks).every(Boolean)?'PASS':'FAIL',
 })
}

export function evaluateSamples({plan,samples,repeat}){
 const cases=plan.map(spec=>summarizeCase(spec,samples))
 const failed=cases.filter(item=>item.status!=='PASS')
 const rateLimited=samples.filter(sample=>sample.http_status===429).length
 const gate={
  status:failed.length?'FAIL':'PASS',
  failed_cases:failed.map(item=>item.case_id),
  sample_count:samples.filter(sample=>!sample.warmup).length,
  expected_sample_count:plan.length*repeat,
  rate_limited_samples:rateLimited,
  fast_incident_threshold_ms:fastIncidentMs,
 }
 return Object.freeze({cases,gate})
}

async function releaseMetadata(baseUrl,headers,expectedSha){
 let response;let payload
 try{
  response=await fetch(new URL('/api/release',baseUrl),{headers:{Accept:'application/json',...(headers.Cookie?{Cookie:headers.Cookie}:{}),...(headers.Authorization?{Authorization:headers.Authorization}:{})},signal:AbortSignal.timeout(10_000)})
  payload=await response.json()
 }catch{throw new Error('Não foi possível ler /api/release antes do benchmark.')}
 const commitSha=clean(payload?.source?.commitSha,64).toLowerCase()
 if(!response.ok)throw new Error(`/api/release respondeu HTTP ${response.status}.`)
 if(commitSha!==expectedSha)throw new Error(`SHA runtime divergente: esperado ${expectedSha}, recebido ${commitSha||'(ausente)'}.`)
 if(payload?.source?.match===false)throw new Error('Runtime metadata informa divergência entre build e runtime.')
 return Object.freeze({schema_version:payload?.schemaVersion||null,source:{commit_sha:commitSha,build_commit_sha:clean(payload?.source?.buildCommitSha,64).toLowerCase()||null,runtime_commit_sha:clean(payload?.source?.runtimeCommitSha,64).toLowerCase()||null,match:payload?.source?.match??null},release_id:payload?.release?.id||null})
}

function validateOnline(options,base){
 if(!/^[0-9a-f]{40}$/.test(options.expectedSha))throw new Error('--expected-sha deve conter o SHA completo de 40 caracteres.')
 if(!base.local&&!options.confirmStagingOnly)throw new Error('Confirmação explícita de staging ausente.')
 if(!base.local&&options.delayMs<21_000)throw new Error('Benchmark remoto deve usar --delay-ms >= 21000 para respeitar o rate limit padrão do staging; não eleve nem contorne o limite.')
}

export function offlinePlan(options,env=process.env){
 const base=canonicalBaseUrl(options.baseUrl,{offline:true,confirmStagingOnly:options.confirmStagingOnly})
 const controlled=fixture(options,{offline:true});const plan=buildCasePlan(controlled);const auth=authHeaders(env,{local:base.local,offline:true})
 return Object.freeze({
  schema_version:routingBenchmarkVersion,mode:'OFFLINE_PLAN',generated_at:new Date().toISOString(),
  config:{base_url:base.url.origin,warmup:options.warmup,repeat:options.repeat,timeout_ms:options.timeoutMs,delay_ms:options.delayMs,phase:options.phase,auth_mode:auth.mode,concurrency:1},
  fixture:{client_a_ref:ref(controlled.clientA.id),client_b_ref:ref(controlled.clientB.id)},
  cases:plan.map(item=>({case_id:item.id,label:item.label,expected_path:item.expectedPath,target_ms:item.target})),
  secrets_in_output:false,network_executed:false,
 })
}

export async function runBenchmark(options,env=process.env){
 const base=canonicalBaseUrl(options.baseUrl,{confirmStagingOnly:options.confirmStagingOnly});validateOnline(options,base)
 const controlled=fixture(options);const plan=buildCasePlan(controlled);const auth=authHeaders(env,{local:base.local})
 const runtime=await releaseMetadata(base.url,auth.headers,options.expectedSha)
 const samples=[];const warmupFailures=[]
 for(let iteration=-options.warmup;iteration<options.repeat;iteration+=1){
  const warmup=iteration<0;const visibleIteration=warmup?iteration+options.warmup+1:iteration+1
  const conversationId=`val-routing-bench-${options.phase}-${warmup?'warmup':'run'}-${visibleIteration}-${randomUUID()}`
  for(const spec of plan){
   const sample=await executeRequest({baseUrl:base.url,headers:auth.headers,spec,conversationId,timeoutMs:options.timeoutMs,phase:options.phase,iteration:visibleIteration,warmup})
   if(warmup){if(sample.http_status!==200)warmupFailures.push({case_id:sample.case_id,http_status:sample.http_status,error_code:sample.error_code})}
   else samples.push(sample)
   await wait(options.delayMs)
  }
 }
 const evaluated=evaluateSamples({plan,samples,repeat:options.repeat})
 return {
  schema_version:routingBenchmarkVersion,generated_at:new Date().toISOString(),phase:options.phase,
  evidence_boundary:'Authenticated sequential HTTP benchmark of /api/val/chat. Browser render time and the frontend-local follow-up path are not measured; FOLLOWUP is the governed server fallback.',
  runtime,
  config:{base_url:base.url.origin,warmup:options.warmup,repeat:options.repeat,timeout_ms:options.timeoutMs,delay_ms:options.delayMs,concurrency:1,auth_mode:auth.mode},
  fixture:{client_a_ref:ref(controlled.clientA.id),client_b_ref:ref(controlled.clientB.id),controlled_data_required:true},
  warmup:{count:options.warmup*plan.length,failure_count:warmupFailures.length,failures:warmupFailures},
  cases:evaluated.cases,gate:evaluated.gate,samples,secrets_in_output:false,
 }
}

async function emit(document,output=''){
 const serialized=`${JSON.stringify(document,null,2)}\n`
 if(output)await writeFile(resolve(output),serialized,'utf8')
 else process.stdout.write(serialized)
}

async function main(){
 const options=parseArgs(process.argv.slice(2))
 if(options.help){process.stdout.write(`${usage()}\n`);return}
 if(options.offline){await emit(offlinePlan(options),options.output);return}
 const report=await runBenchmark(options)
 await emit(report,options.output)
 if(report.gate.status!=='PASS')throw Object.assign(new Error(`Golden routing/latency reprovado: ${report.gate.failed_cases.join(', ')||'falha desconhecida'}.`),{reportWritten:true})
 process.stderr.write(`VAL routing benchmark: PASS (${report.gate.sample_count} amostras, SHA ${report.runtime.source.commit_sha}).\n`)
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href
if(isMain)main().catch(error=>{process.stderr.write(`val-conversational-routing-benchmark: ${error.message}\n`);process.exitCode=1})
