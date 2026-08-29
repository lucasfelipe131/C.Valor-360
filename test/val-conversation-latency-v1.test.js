import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
 buildConversationLatencyBenchmark,
 conversationLatencyContracts,
 conversationLatencyMetrics,
 conversationLatencyPercentilePolicy,
 conversationLatencySources,
 conversationServiceClasses,
 createConversationLatencyRegistry,
 createConversationLatencyTrace,
 summarizeConversationLatency
} from '../server/decision-copilot/conversation-latency.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')

test('trace de browser mede cadeia VOICE e métricas realtime sem conteúdo',()=>{
 const registry=createConversationLatencyRegistry()
 let now=100
 const trace=createConversationLatencyTrace({serviceClass:'VOICE',registry,clock:()=>now,startAt:100})
 now=110;trace.speechEnded()
 now=120;trace.turnDetected()
 now=145;trace.transcriptReady()
 now=160;trace.reasoningStarted()
 now=210;trace.firstText()
 now=255;trace.firstAudio()
 now=280
 const result=trace.finish({outcome:'SUCCESS'})

 assert.deepEqual(result.metrics,{
  speech_end_to_turn_detected:10,
  speech_end_to_transcript:35,
  speech_end_to_first_useful_text:100,
  speech_end_to_first_audio:145,
  transcript_to_first_reasoning:15,
  reasoning_to_first_text:50,
  reasoning_to_first_audio:95,
  browser_voice_turn_total_latency:170
 })
 assert.equal(result.source,'BROWSER_VOICE_TURN')
 assert.equal(result.contract_version,conversationLatencyContracts.BROWSER_VOICE_TURN.version)
 assert.equal(result.content_free,true)
 assert.equal(registry.size('VOICE','BROWSER_VOICE_TURN'),1)
 assert.deepEqual(conversationLatencyContracts.BROWSER_VOICE_TURN.metrics,Object.keys(result.metrics))
 assert.ok(conversationLatencyMetrics.includes('server_processing_total_latency'))
})

test('registry separa TOTAL do backend e fala→fim TTS por source, contrato e campo',()=>{
 const registry=createConversationLatencyRegistry()
 registry.record({source:'SERVER_PROCESSING',contractVersion:conversationLatencyContracts.SERVER_PROCESSING.version,serviceClass:'VOICE',metrics:{server_processing_total_latency:80}})
 registry.record({source:'BROWSER_VOICE_TURN',contractVersion:conversationLatencyContracts.BROWSER_VOICE_TURN.version,serviceClass:'VOICE',metrics:{browser_voice_turn_total_latency:800}})
 const snapshot=registry.snapshot()
 const server=snapshot.sources.SERVER_PROCESSING.service_classes.VOICE
 const browser=snapshot.sources.BROWSER_VOICE_TURN.service_classes.VOICE

 assert.deepEqual(conversationLatencySources,['SERVER_PROCESSING','BROWSER_VOICE_TURN'])
 assert.equal(snapshot.aggregation_boundary,'SOURCE_AND_CONTRACT')
 assert.equal(Object.hasOwn(snapshot,'service_classes'),false)
 assert.equal(server.metrics.server_processing_total_latency.p50,80)
 assert.equal(Object.hasOwn(server.metrics,'browser_voice_turn_total_latency'),false)
 assert.equal(browser.metrics.browser_voice_turn_total_latency.p50,800)
 assert.equal(Object.hasOwn(browser.metrics,'server_processing_total_latency'),false)
 assert.equal(snapshot.sources.SERVER_PROCESSING.sample_count,1)
 assert.equal(snapshot.sources.BROWSER_VOICE_TURN.sample_count,1)
})

test('registro SERVER_PROCESSING é fail-closed por classe e mantém as seis classes isoladas',()=>{
 const registry=createConversationLatencyRegistry()
 for(const [index,currentServiceClass] of conversationServiceClasses.entries()){
  registry.record({source:'SERVER_PROCESSING',serviceClass:currentServiceClass,metrics:{server_processing_total_latency:10+index}})
 }
 const server=snapshotServer(registry)
 assert.deepEqual(Object.keys(server.service_classes),conversationServiceClasses)
 for(const [index,currentServiceClass] of conversationServiceClasses.entries()){
  assert.equal(server.service_classes[currentServiceClass].sample_count,1)
  assert.equal(server.service_classes[currentServiceClass].metrics.server_processing_total_latency.p50,10+index)
 }
 assert.throws(()=>registry.record({source:'SERVER_PROCESSING',serviceClass:'CLIENTE_JOAO',metrics:{server_processing_total_latency:1}}),/Unsupported conversation service class/)
 assert.equal(registry.size(null,'SERVER_PROCESSING'),6)
})

function snapshotServer(registry){return registry.snapshot().sources.SERVER_PROCESSING}

test('P90 e P95 só aparecem com amostra suficiente; P95 exige n >= 20',()=>{
 assert.deepEqual(conversationLatencyPercentilePolicy.minimum_samples,{p50:1,p90:10,p95:20})
 const nineteen=summarizeConversationLatency(Array.from({length:19},(_,index)=>index+1))
 assert.equal(nineteen.p50,10)
 assert.equal(nineteen.p90,18)
 assert.equal(nineteen.p95,null)
 assert.equal(nineteen.sufficient_samples.p95,false)

 const twenty=summarizeConversationLatency(Array.from({length:20},(_,index)=>index+1))
 assert.equal(twenty.p95,19)
 assert.equal(twenty.sufficient_samples.p95,true)
})

test('snapshot descarta transcript, nomes, ids e chaves arbitrárias por construção',()=>{
 const registry=createConversationLatencyRegistry()
 registry.record({
  source:'SERVER_PROCESSING',
  serviceClass:'FAST',
  transcript:'segredo do produtor',
  clientName:'João da Silva',
  tenantId:'tenant-confidencial',
  metrics:{
   server_processing_total_latency:42,
   message:'não persistir',
   client_id:'cliente-1'
  }
 })
 const serialized=JSON.stringify(registry.snapshot())
 assert.equal(serialized.includes('segredo'),false)
 assert.equal(serialized.includes('João'),false)
 assert.equal(serialized.includes('tenant-confidencial'),false)
 assert.equal(serialized.includes('cliente-1'),false)
 assert.equal(serialized.includes('message'),false)
 assert.equal(registry.snapshot().content_free,true)
})

test('benchmark agrega outcomes dentro da fonte sem cruzar distribuições ou reter payload',()=>{
 const benchmark=buildConversationLatencyBenchmark([
  {source:'SERVER_PROCESSING',serviceClass:'TOOL',outcome:'SUCCESS',metrics:{server_processing_total_latency:80},result:'resultado privado'},
  {source:'SERVER_PROCESSING',serviceClass:'TOOL',outcome:'ERROR',metrics:{server_processing_total_latency:120},error:'falha privada'},
  {source:'BROWSER_VOICE_TURN',serviceClass:'VOICE',outcome:'FALLBACK',metrics:{reasoning_to_first_audio:90,browser_voice_turn_total_latency:150},transcript:'privado'}
 ])
 const server=benchmark.sources.SERVER_PROCESSING.service_classes
 const browser=benchmark.sources.BROWSER_VOICE_TURN.service_classes
 assert.equal(server.TOOL.sample_count,2)
 assert.equal(server.TOOL.error_rate,.5)
 assert.equal(server.VOICE.sample_count,0)
 assert.equal(browser.VOICE.sample_count,1)
 assert.equal(browser.VOICE.outcomes.FALLBACK,1)
 assert.equal(JSON.stringify(benchmark).includes('privad'),false)
})

test('alias legado total_turn_latency é compatível, mas canonicalizado dentro da fonte explícita',()=>{
 const registry=createConversationLatencyRegistry()
 assert.equal(registry.record({source:'SERVER_PROCESSING',serviceClass:'VOICE',metrics:{total_turn_latency:70}}),true)
 assert.equal(registry.record({source:'BROWSER_VOICE_TURN',serviceClass:'VOICE',metrics:{total_turn_latency:700}}),true)
 const snapshot=registry.snapshot()
 assert.equal(snapshot.sources.SERVER_PROCESSING.service_classes.VOICE.metrics.server_processing_total_latency.p50,70)
 assert.equal(snapshot.sources.BROWSER_VOICE_TURN.service_classes.VOICE.metrics.browser_voice_turn_total_latency.p50,700)
 assert.equal(JSON.stringify(snapshot).includes('"total_turn_latency":{"count"'),false)
 assert.throws(()=>registry.record({source:'BROWSER_VOICE_TURN',serviceClass:'VOICE',metrics:{total_turn_latency:1,browser_voice_turn_total_latency:2}}),/Conflicting/)
})

test('fonte, classe e versão incompatíveis falham sem contaminar outro bucket',()=>{
 const registry=createConversationLatencyRegistry()
 assert.throws(()=>registry.record({source:'BROWSER_VOICE_TURN',serviceClass:'FAST',metrics:{browser_voice_turn_total_latency:10}}),/does not support/)
 assert.throws(()=>registry.record({source:'OUTRO_RELOGIO',serviceClass:'VOICE',metrics:{browser_voice_turn_total_latency:10}}),/Unsupported conversation latency source/)
 assert.throws(()=>registry.record({source:'BROWSER_VOICE_TURN',contractVersion:'val.incorreto.v1',serviceClass:'VOICE',metrics:{browser_voice_turn_total_latency:10}}),/Unsupported conversation latency contract/)
 assert.equal(registry.size(),0)
})

test('trace não produz duração silenciosamente falsa para marcos fora de ordem',()=>{
 const trace=createConversationLatencyTrace({serviceClass:'VOICE',clock:()=>0,startAt:0})
 trace.speechEnded(20).transcriptReady(10).reasoningStarted(30).firstText(25)
 const result=trace.finish({at:50,record:false})
 assert.equal(result.metrics.speech_end_to_transcript,null)
 assert.equal(result.metrics.reasoning_to_first_text,null)
 assert.equal(result.metrics.transcript_to_first_reasoning,20)
 assert.equal(result.metrics.browser_voice_turn_total_latency,30)
})

test('HTTP aceita apenas fonte browser; backend e hook usam contratos/campos distintos',()=>{
 const server=read('server.js')
 const hook=read('src/hooks/useRealtimeConversation.js')
 assert.match(server,/payload\.source[\s\S]*BROWSER_VOICE_TURN[\s\S]*val_conversation_metric_source_invalid/)
 assert.match(server,/source:'BROWSER_VOICE_TURN',contractVersion:payload\.contractVersion/)
 assert.match(server,/source:'SERVER_PROCESSING',contractVersion:'val\.conversation_latency\.server_processing\.v1'/)
 assert.match(server,/metrics:\{server_processing_total_latency:totalLatency\}/)
 assert.match(hook,/source:'BROWSER_VOICE_TURN'/)
 assert.match(hook,/contractVersion:'val\.conversation_latency\.browser_voice_turn\.v1'/)
 assert.match(hook,/browser_voice_turn_total_latency:elapsed\('speechEnd','turnEnd'\)/)
 assert.doesNotMatch(hook,/(?<!browser_voice_turn_)total_turn_latency:/)
})

test('schema v2 formaliza contratos disjuntos e deixa total_turn_latency apenas como alias legado',()=>{
 const schema=JSON.parse(read('contracts/v1/conversation-latency-sample.schema.json'))
 const server=schema.$defs.serverProcessing
 const browser=schema.$defs.browserVoiceTurn
 assert.equal(server.properties.source.const,'SERVER_PROCESSING')
 assert.equal(server.properties.contractVersion.const,conversationLatencyContracts.SERVER_PROCESSING.version)
 assert.deepEqual(Object.keys(server.properties.metrics.properties),['server_processing_total_latency','total_turn_latency'])
 assert.equal(server.properties.metrics.properties.total_turn_latency.deprecated,true)
 assert.equal(browser.properties.source.const,'BROWSER_VOICE_TURN')
 assert.equal(browser.properties.contractVersion.const,conversationLatencyContracts.BROWSER_VOICE_TURN.version)
 assert.equal(browser.properties.serviceClass.const,'VOICE')
 assert.ok(Object.hasOwn(browser.properties.metrics.properties,'browser_voice_turn_total_latency'))
 assert.equal(Object.hasOwn(browser.properties.metrics.properties,'server_processing_total_latency'),false)
})
