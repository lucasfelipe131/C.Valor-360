import assert from 'node:assert/strict'
import test from 'node:test'
import {benchmarkRequestBody,buildCasePlan,distribution,evaluateSamples,offlinePlan,parseArgs,routingBenchmarkDefaults,runBenchmark,usage} from '../scripts/val-conversational-routing-benchmark.mjs'

const sha='c19f1abe91069d9de00710031a6bd31a20c2b5dc'
const fixture={clientA:{id:'client-a',name:'Antônio Controlado'},clientB:{id:'client-b',name:'Carlos Controlado'}}

test('CLI preserva defaults, autenticação só por env e plano offline não expõe secret',()=>{
 const env={VAL_ROUTING_BENCH_COOKIE:'secret-cookie-that-must-not-leak'}
 const options=parseArgs(['--offline','--phase','before','--expected-sha',sha,'--client-a-id','client-a','--client-a-name','Antônio','--client-b-id','client-b','--client-b-name','Carlos'],env)
 assert.equal(options.warmup,routingBenchmarkDefaults.warmup)
 assert.equal(options.repeat,routingBenchmarkDefaults.repeat)
 const plan=offlinePlan(options,env)
 assert.equal(plan.mode,'OFFLINE_PLAN')
 assert.equal(plan.network_executed,false)
 assert.equal(plan.cases.length,9)
 assert.equal(plan.config.auth_mode,'cookie')
 assert.doesNotMatch(JSON.stringify(plan),/secret-cookie-that-must-not-leak/)
 assert.match(usage(),/--confirm-staging-only/)
})

test('golden stateful contém os nove casos e targets explícitos',()=>{
 const plan=buildCasePlan(fixture)
 assert.deepEqual(plan.map(item=>item.id),['OPEN','LAST_VISIT','OBJECTION','PURCHASE','FOLLOWUP','CALC','SWITCH','SWITCH_FOLLOWUP','COMPARE'])
 assert.equal(plan.find(item=>item.id==='CALC').expectedBags,525)
 assert.deepEqual(plan.find(item=>item.id==='COMPARE').expectedCompared,['client-b','client-a'])
 assert.deepEqual(distribution(Array.from({length:30},(_,index)=>index+1)),{count:30,p50:15,p90:27,p95:29,max:30})
 for(const spec of plan){
  const body=benchmarkRequestBody({spec,conversationId:'thread-controlled',requestId:'request-controlled'})
  assert.equal(Object.hasOwn(body,'clientId'),false,spec.id)
  assert.equal(Object.hasOwn(body,'client'),false,spec.id)
 }
})

test('benchmark remoto falha antes da rede quando o ritmo violaria o rate limit do staging',async()=>{
 const options=parseArgs(['--base-url','https://staging.example.test','--expected-sha',sha,'--confirm-staging-only','--client-a-id','client-a','--client-a-name','Antônio','--client-b-id','client-b','--client-b-name','Carlos'])
 await assert.rejects(()=>runBenchmark(options,{}),/--delay-ms >= 21000/)
})

test('gate reprova FAST acima do target, contexto ou modelo',()=>{
 const spec=buildCasePlan(fixture)[0]
 const samples=Array.from({length:30},(_,index)=>({
  case_id:spec.id,warmup:false,http_status:200,wall_ms:index>=28?900:200,first_byte_ms:100,path:'FAST',
  execution:{model_calls:index===0?1:0,tool_calls:1},latency:{CONTEXT:index===1?5:null,MODEL:null,TTFR:150},validation_errors:[],
 }))
 const result=evaluateSamples({plan:[spec],samples,repeat:30})
 assert.equal(result.gate.status,'FAIL')
 assert.equal(result.cases[0].checks.p95_target,false)
 assert.equal(result.cases[0].checks.fast_no_model,false)
 assert.equal(result.cases[0].checks.fast_no_context,false)
})
