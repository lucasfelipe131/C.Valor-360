export const conversationLatencyVersion='val.conversation_latency.v2'

export const conversationServiceClasses=Object.freeze([
 'FAST','CONTEXT','DEEP','TOOL','LIVE_DATA','VOICE'
])

export const conversationLatencySources=Object.freeze([
 'SERVER_PROCESSING','BROWSER_VOICE_TURN'
])

const serverProcessingMetrics=Object.freeze([
 'server_processing_total_latency'
])

const browserVoiceTurnMetrics=Object.freeze([
 'speech_end_to_turn_detected',
 'speech_end_to_transcript',
 'speech_end_to_first_useful_text',
 'speech_end_to_first_audio',
 'transcript_to_first_reasoning',
 'reasoning_to_first_text',
 'reasoning_to_first_audio',
 'browser_voice_turn_total_latency'
])

export const conversationLatencyMetrics=Object.freeze([
 ...serverProcessingMetrics,
 ...browserVoiceTurnMetrics
])

export const conversationLatencyContracts=Object.freeze({
 SERVER_PROCESSING:Object.freeze({
  version:'val.conversation_latency.server_processing.v1',
  clock_scope:'SERVER_MONOTONIC',
  service_classes:conversationServiceClasses,
  metrics:serverProcessingMetrics,
  legacy_input_aliases:Object.freeze({total_turn_latency:'server_processing_total_latency'})
 }),
 BROWSER_VOICE_TURN:Object.freeze({
  version:'val.conversation_latency.browser_voice_turn.v1',
  clock_scope:'BROWSER_MONOTONIC',
  service_classes:Object.freeze(['VOICE']),
  metrics:browserVoiceTurnMetrics,
  legacy_input_aliases:Object.freeze({total_turn_latency:'browser_voice_turn_total_latency'})
 })
})

export const conversationLatencyPercentilePolicy=Object.freeze({
 method:'nearest_rank',
 minimum_samples:Object.freeze({p50:1,p90:10,p95:20})
})

const traceEvents=Object.freeze([
 'speech_end','turn_detected','transcript','first_reasoning','first_text','first_audio','turn_end'
])
const outcomes=Object.freeze(['SUCCESS','ERROR','CANCELLED','FALLBACK'])
const now=()=>globalThis.performance?.now?.()??Date.now()

const duration=value=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null
 return Number(value.toFixed(3))
}

const timestamp=value=>typeof value==='number'&&Number.isFinite(value)?value:null

const serviceClass=value=>{
 const normalized=typeof value==='string'?value.trim().toUpperCase():''
 return conversationServiceClasses.includes(normalized)?normalized:null
}

const source=value=>{
 const normalized=typeof value==='string'?value.trim().toUpperCase():''
 return conversationLatencySources.includes(normalized)?normalized:null
}

const inferredSource=(rawSource,metrics={})=>{
 if(rawSource!==undefined&&rawSource!==null&&String(rawSource).trim())return source(rawSource)
 const keys=Object.keys(metrics&&typeof metrics==='object'?metrics:{})
 return keys.some(metric=>browserVoiceTurnMetrics.includes(metric))?'BROWSER_VOICE_TURN':'SERVER_PROCESSING'
}

const outcome=value=>{
 const normalized=typeof value==='string'?value.trim().toUpperCase():''
 return outcomes.includes(normalized)?normalized:'SUCCESS'
}

const percentile=(ordered,ratio)=>{
 if(!ordered.length)return null
 const rank=Math.max(1,Math.ceil(ordered.length*ratio))
 return duration(ordered[rank-1])
}

const canonicalMetrics=(contract,metrics={})=>{
 const input=metrics&&typeof metrics==='object'?metrics:{}
 const safe={}
 for(const metric of contract.metrics){
  const aliases=Object.entries(contract.legacy_input_aliases).filter(([,canonical])=>canonical===metric).map(([legacy])=>legacy)
  const candidates=[metric,...aliases].filter(key=>Object.hasOwn(input,key)).map(key=>duration(input[key])).filter(value=>value!==null)
  if(new Set(candidates).size>1)throw new TypeError('Conflicting conversation latency metric aliases')
  if(candidates.length)safe[metric]=candidates[0]
 }
 return safe
}

export function summarizeConversationLatency(values=[]){
 const safe=values.map(duration).filter(value=>value!==null).sort((left,right)=>left-right)
 const count=safe.length
 const minimum=conversationLatencyPercentilePolicy.minimum_samples
 return Object.freeze({
  count,
  p50:count>=minimum.p50?percentile(safe,.5):null,
  p90:count>=minimum.p90?percentile(safe,.9):null,
  p95:count>=minimum.p95?percentile(safe,.95):null,
  sufficient_samples:Object.freeze({
   p50:count>=minimum.p50,
   p90:count>=minimum.p90,
   p95:count>=minimum.p95
  })
 })
}

function emptyServiceClassSnapshot(metrics){
 return Object.freeze({
  sample_count:0,
  outcomes:Object.freeze(Object.fromEntries(outcomes.map(value=>[value,0]))),
  error_rate:0,
  metrics:Object.freeze(Object.fromEntries(metrics.map(metric=>[
   metric,summarizeConversationLatency()
  ])))
 })
}

export function createConversationLatencyRegistry({limitPerServiceClass=500}={}){
 const limit=Math.max(20,Math.min(5_000,Number(limitPerServiceClass)||500))
 const samples=new Map(conversationLatencySources.map(currentSource=>[
  currentSource,
  new Map(conversationLatencyContracts[currentSource].service_classes.map(currentServiceClass=>[currentServiceClass,[]]))
 ]))

 const resolveCoordinates=(rawServiceClass,rawSource,metrics={})=>{
  const normalizedServiceClass=serviceClass(rawServiceClass)
  if(!normalizedServiceClass)throw new TypeError('Unsupported conversation service class')
  const normalizedSource=inferredSource(rawSource,metrics)
  if(!normalizedSource)throw new TypeError('Unsupported conversation latency source')
  const contract=conversationLatencyContracts[normalizedSource]
  if(!contract.service_classes.includes(normalizedServiceClass))throw new TypeError('Conversation latency source does not support service class')
  return {normalizedServiceClass,normalizedSource,contract}
 }

 return Object.freeze({
  record({serviceClass:rawServiceClass,source:rawSource,contractVersion,metrics={},outcome:rawOutcome}={}){
   const {normalizedServiceClass,normalizedSource,contract}=resolveCoordinates(rawServiceClass,rawSource,metrics)
   if(contractVersion&&contractVersion!==contract.version)throw new TypeError('Unsupported conversation latency contract')
   const safeMetrics=canonicalMetrics(contract,metrics)
   if(!Object.keys(safeMetrics).length)return false

   const current=samples.get(normalizedSource).get(normalizedServiceClass)
   current.push(Object.freeze({metrics:Object.freeze(safeMetrics),outcome:outcome(rawOutcome)}))
   if(current.length>limit)current.splice(0,current.length-limit)
   return true
  },

  snapshot(){
   const sources={}
   for(const currentSource of conversationLatencySources){
    const contract=conversationLatencyContracts[currentSource]
    const sourceSamples=samples.get(currentSource)
    const serviceClasses={}
    let sourceSampleCount=0
    for(const currentServiceClass of contract.service_classes){
     const current=sourceSamples.get(currentServiceClass)
     sourceSampleCount+=current.length
     if(!current.length){serviceClasses[currentServiceClass]=emptyServiceClassSnapshot(contract.metrics);continue}

     const outcomeCounts=Object.fromEntries(outcomes.map(value=>[value,0]))
     const metricValues=Object.fromEntries(contract.metrics.map(metric=>[metric,[]]))
     for(const sample of current){
      outcomeCounts[sample.outcome]+=1
      for(const metric of contract.metrics){
       if(sample.metrics[metric]!==undefined)metricValues[metric].push(sample.metrics[metric])
      }
     }

     serviceClasses[currentServiceClass]=Object.freeze({
      sample_count:current.length,
      outcomes:Object.freeze(outcomeCounts),
      error_rate:Number((outcomeCounts.ERROR/current.length).toFixed(6)),
      metrics:Object.freeze(Object.fromEntries(contract.metrics.map(metric=>[
       metric,summarizeConversationLatency(metricValues[metric])
      ])))
     })
    }

    sources[currentSource]=Object.freeze({
     contract_version:contract.version,
     clock_scope:contract.clock_scope,
     content_free:true,
     sample_count:sourceSampleCount,
     canonical_metrics:contract.metrics,
     legacy_input_aliases:contract.legacy_input_aliases,
     service_classes:Object.freeze(serviceClasses)
    })
   }

   return Object.freeze({
    version:conversationLatencyVersion,
    content_free:true,
    aggregation_boundary:'SOURCE_AND_CONTRACT',
    retained_samples_per_source_and_service_class:limit,
    percentile_policy:conversationLatencyPercentilePolicy,
    sources:Object.freeze(sources)
   })
  },

  clear(rawServiceClass=null,rawSource=null){
   if(rawServiceClass===null&&rawSource===null){for(const sourceSamples of samples.values())for(const current of sourceSamples.values())current.length=0;return}
   if(rawServiceClass===null){
    const normalizedSource=source(rawSource)
    if(!normalizedSource)throw new TypeError('Unsupported conversation latency source')
    for(const current of samples.get(normalizedSource).values())current.length=0
    return
   }
   if(rawSource===null){
    const normalizedServiceClass=serviceClass(rawServiceClass)
    if(!normalizedServiceClass)throw new TypeError('Unsupported conversation service class')
    for(const sourceSamples of samples.values())sourceSamples.get(normalizedServiceClass)?.splice(0)
    return
   }
   const {normalizedServiceClass,normalizedSource}=resolveCoordinates(rawServiceClass,rawSource)
   samples.get(normalizedSource).get(normalizedServiceClass).length=0
  },

  size(rawServiceClass=null,rawSource=null){
   if(rawServiceClass===null&&rawSource===null)return [...samples.values()].reduce((total,sourceSamples)=>total+[...sourceSamples.values()].reduce((subtotal,current)=>subtotal+current.length,0),0)
   if(rawServiceClass===null){
    const normalizedSource=source(rawSource)
    if(!normalizedSource)throw new TypeError('Unsupported conversation latency source')
    return [...samples.get(normalizedSource).values()].reduce((total,current)=>total+current.length,0)
   }
   const normalizedServiceClass=serviceClass(rawServiceClass)
   if(!normalizedServiceClass)throw new TypeError('Unsupported conversation service class')
   if(rawSource===null)return [...samples.values()].reduce((total,sourceSamples)=>total+(sourceSamples.get(normalizedServiceClass)?.length||0),0)
   const normalizedSource=source(rawSource)
   if(!normalizedSource)throw new TypeError('Unsupported conversation latency source')
   if(!conversationLatencyContracts[normalizedSource].service_classes.includes(normalizedServiceClass))return 0
   return samples.get(normalizedSource).get(normalizedServiceClass).length
  }
 })
}

export const valConversationLatency=createConversationLatencyRegistry()

export function createConversationLatencyTrace({
 serviceClass:rawServiceClass='VOICE',
 registry=valConversationLatency,
 clock=now,
 startAt=null
}={}){
 const normalizedServiceClass=serviceClass(rawServiceClass)
 if(normalizedServiceClass!=='VOICE')throw new TypeError('Browser voice latency trace only supports VOICE')

 const initial=timestamp(startAt)??timestamp(clock())??0
 const marks=new Map([['turn_start',initial]])
 let completed=null

 const mark=(event,at=null)=>{
  if(completed||!traceEvents.includes(event)||marks.has(event))return api
  const observed=timestamp(at)??timestamp(clock())
  if(observed!==null)marks.set(event,observed)
  return api
 }
 const interval=(from,to)=>{
  if(!marks.has(from)||!marks.has(to))return null
  return duration(marks.get(to)-marks.get(from))
 }
 const currentMetrics=()=>Object.freeze({
  speech_end_to_turn_detected:interval('speech_end','turn_detected'),
  speech_end_to_transcript:interval('speech_end','transcript'),
  speech_end_to_first_useful_text:interval('speech_end','first_text'),
  speech_end_to_first_audio:interval('speech_end','first_audio'),
  transcript_to_first_reasoning:interval('transcript','first_reasoning'),
  reasoning_to_first_text:interval('first_reasoning','first_text'),
  reasoning_to_first_audio:interval('first_reasoning','first_audio'),
  browser_voice_turn_total_latency:marks.has('turn_end')?interval(marks.has('speech_end')?'speech_end':'turn_start','turn_end'):null
 })

 const api={
  mark,
  speechEnded(at=null){return mark('speech_end',at)},
  turnDetected(at=null){return mark('turn_detected',at)},
  transcriptReady(at=null){return mark('transcript',at)},
  reasoningStarted(at=null){return mark('first_reasoning',at)},
  firstText(at=null){return mark('first_text',at)},
  firstAudio(at=null){return mark('first_audio',at)},
  finish({at=null,outcome:rawOutcome='SUCCESS',record=true}={}){
   if(completed)return completed
   mark('turn_end',at)
   const contract=conversationLatencyContracts.BROWSER_VOICE_TURN
   const metrics=currentMetrics()
   completed=Object.freeze({
    version:conversationLatencyVersion,
    contract_version:contract.version,
    source:'BROWSER_VOICE_TURN',
    service_class:normalizedServiceClass,
    content_free:true,
    metrics
   })
   if(record&&registry?.record)registry.record({
    serviceClass:normalizedServiceClass,
    source:'BROWSER_VOICE_TURN',
    contractVersion:contract.version,
    metrics,
    outcome:rawOutcome
   })
   return completed
  },
  snapshot(){
   const contract=conversationLatencyContracts.BROWSER_VOICE_TURN
   return Object.freeze({
    version:conversationLatencyVersion,
    contract_version:contract.version,
    source:'BROWSER_VOICE_TURN',
    service_class:normalizedServiceClass,
    content_free:true,
    metrics:currentMetrics()
   })
  }
 }
 return Object.freeze(api)
}

export function buildConversationLatencyBenchmark(samples=[],options={}){
 const registry=createConversationLatencyRegistry(options)
 for(const sample of samples)registry.record(sample)
 return registry.snapshot()
}
