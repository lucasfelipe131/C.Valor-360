import assert from 'node:assert/strict'
import test from 'node:test'
import {attachLatencyPerformance,createLatencyMetricsRegistry,createLatencyTrace,latencyStages,legacyLatencyBreakdown,percentileSummary} from '../server/decision-copilot/latency-observability.js'
import {observe,runWithRequestContext} from '../server/observability.js'

test('latência cobre todos os estágios e preserva latency_breakdown legado',()=>{
 assert.deepEqual(latencyStages,['AUTH','ENTITY','INTENT','CONTEXT','MEMORY','MCA','MIA','TOOL','MODEL','VALIDATION','TTS','TOTAL','TTFR'])
 let now=0;const registry=createLatencyMetricsRegistry();const trace=createLatencyTrace({clock:()=>now,path:'TOOL',intent:'CALCULATE',registry})
 trace.start('INTENT');now=4;trace.end('INTENT').start('TOOL');now=14;trace.end('TOOL').firstUseful();now=20
 const latency=trace.finish()
 assert.equal(latency.INTENT,4)
 assert.equal(latency.TOOL,10)
 assert.equal(latency.TTFR,14)
 assert.equal(latency.TOTAL,20)
 assert.equal(latency.MODEL,null)
 const legacy=legacyLatencyBreakdown(latency,{DATABASE:3})
 assert.equal(legacy.EXTERNAL_DATA,10)
 assert.equal(legacy.RESPONSE,20)
 assert.equal(legacy.DATABASE,3)
 assert.equal(registry.snapshot().series['TOOL:CALCULATE'].TOTAL.count,1)
})

test('TOTAL pode começar antes do roteamento e MCA/MIA reutilizam medição real da engine',()=>{
 let now=25
 const trace=createLatencyTrace({clock:()=>now,startAt:5,path:'DEEP',intent:'PREPARE_VISIT'})
 trace.set('AUTH',3).set('INTENT',7);now=55;trace.firstUseful();now=65
 const latency=trace.finish({record:false})
 assert.equal(latency.TOTAL,60)
 assert.equal(latency.TTFR,50)
 const payload={advice:{ai_reasoning:{run:{latency_breakdown:{MCA:11,MIA:13,MODEL_INFERENCE:17}}}}}
 const attached=attachLatencyPerformance(payload,{latency,path:'DEEP',intent:'PREPARE_VISIT'})
 assert.equal(attached.responseMetadata.performance.latency.MCA,11)
 assert.equal(attached.responseMetadata.performance.latency.MIA,13)
 assert.equal(attached.responseMetadata.performance.latency.MODEL,17)
})

test('percentis p50/p75/p90/p95 são calculados em memória sem conteúdo',()=>{
 assert.deepEqual(percentileSummary([10,20,30,40]),{count:4,p50:20,p75:30,p90:40,p95:40})
 const registry=createLatencyMetricsRegistry({limitPerSeries:20})
 for(const total of [10,20,30,40])registry.record({path:'FAST',intent:'ASK_CLIENT',latency:{TOTAL:total,TTFR:total/2}})
 const snapshot=registry.snapshot()
 assert.equal(snapshot.content_free,true)
 assert.equal(snapshot.series['FAST:ASK_CLIENT'].TOTAL.p95,40)
 assert.equal(JSON.stringify(snapshot).includes('mensagem do produtor'),false)
})

test('anexo de performance mantém contrato e distingue planned de used',()=>{
 const payload={responseMetadata:{provider:'rules'},advice:{ai_reasoning:{run:{path:'DEEP',capabilities_planned:['CALCULATORS'],capabilities_used:[],latency_breakdown:{DATABASE:2}}}}}
 const toolExecution={capabilities_planned:['CALCULATORS'],capabilities_used:[],capability_results:[{capability:'CALCULATORS',status:'INPUT_REQUIRED'}],tool_result:{status:'INPUT_REQUIRED',capability:'CALCULATORS'}}
 const attached=attachLatencyPerformance(payload,{latency:{TOTAL:12,TTFR:8,TOOL:4},path:'TOOL',intent:'CALCULATE',toolExecution})
 assert.equal(attached.advice.ai_reasoning.run.path,'TOOL')
 assert.deepEqual(attached.advice.ai_reasoning.run.capabilities_used,[])
 assert.equal(attached.advice.ai_reasoning.run.tool_result.status,'INPUT_REQUIRED')
 assert.equal(attached.advice.ai_reasoning.run.latency_breakdown.DATABASE,2)
 assert.equal(attached.advice.ai_reasoning.run.latency_breakdown.EXTERNAL_DATA,4)
})

test('observabilidade retém intent/path/capability, mas não registra conteúdo',()=>{
 const logs=[]
 runWithRequestContext({requestId:'f5af988d-3cb6-4c1b-9224-9471f35f6f33',method:'POST',path:'/api/val/chat',tenantId:'tenant-a',actorId:'owner-a'},()=>{
  observe('val.answer.completed',{intent:'CALCULATE',reasoningPath:'TOOL',capability:'CALCULATORS',capabilityStatus:'INPUT_REQUIRED',ttfrMs:12,outcome:'ok',message:'segredo'})
 },{logger:value=>logs.push(JSON.parse(value))})
 assert.equal(logs[0].intent,'CALCULATE')
 assert.equal(logs[0].reasoningPath,'TOOL')
 assert.equal(logs[0].capability,'CALCULATORS')
 assert.equal(logs[0].message,undefined)
 assert.ok(logs[0].tenant_ref)
})
