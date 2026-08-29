export const latencyObservabilityVersion='val.latency_observability.v2'

export const latencyStages=Object.freeze([
 'AUTH','ENTITY','INTENT','CONTEXT','MEMORY','MCA','MIA','TOOL','MODEL','VALIDATION','TTS','TOTAL','TTFR'
])

const legacyStages=Object.freeze({
 AUTH:'AUTH',CONTEXT:'CONTEXT_RETRIEVAL',MEMORY:'MEMORY',MCA:'MCA',MIA:'MIA',
 TOOL:'EXTERNAL_DATA',MODEL:'MODEL_INFERENCE',VALIDATION:'VALIDATION',TOTAL:'RESPONSE'
})
const measured=value=>{
 if(value===null||value===undefined||value==='')return null
 return Number.isFinite(Number(value))?Math.max(0,Number(Number(value).toFixed(3))):null
}
const contentFreeKey=value=>String(value??'unknown').replace(/[^A-Z0-9_-]/gi,'_').slice(0,80)||'unknown'

function percentile(values,ratio){
 if(!values.length)return null
 const ordered=[...values].sort((left,right)=>left-right)
 const rank=Math.max(1,Math.ceil(ordered.length*ratio))
 return measured(ordered[rank-1])
}

export function percentileSummary(values=[]){
 const safe=values.map(measured).filter(value=>value!==null)
 return Object.freeze({count:safe.length,p50:percentile(safe,.5),p75:percentile(safe,.75),p90:percentile(safe,.9),p95:percentile(safe,.95)})
}

export function createLatencyMetricsRegistry({limitPerSeries=500}={}){
 const series=new Map()
 const limit=Math.max(20,Math.min(5_000,Number(limitPerSeries)||500))
 return Object.freeze({
  record({path='unknown',intent='unknown',latency={}}={}){
   const key=`${contentFreeKey(path)}:${contentFreeKey(intent)}`
   const current=series.get(key)||Object.fromEntries(latencyStages.map(stage=>[stage,[]]))
   for(const stage of latencyStages){const value=measured(latency?.[stage]);if(value!==null){current[stage].push(value);if(current[stage].length>limit)current[stage].splice(0,current[stage].length-limit)}}
   series.set(key,current)
   return key
  },
  snapshot(){
   return Object.freeze({
    version:latencyObservabilityVersion,
    content_free:true,
    series:Object.fromEntries([...series.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([key,stages])=>[key,Object.fromEntries(latencyStages.map(stage=>[stage,percentileSummary(stages[stage])]))]))
   })
  },
  clear(){series.clear()},
  size(){return series.size}
 })
}

export const valLatencyMetrics=createLatencyMetricsRegistry()

export function createLatencyTrace({clock=()=>performance.now(),path='unknown',intent='unknown',registry=valLatencyMetrics,startAt=null}={}){
 const started=Number.isFinite(Number(startAt))?Number(startAt):clock()
 const starts=new Map()
 const durations=Object.fromEntries(latencyStages.map(stage=>[stage,null]))
 let firstUseful=false
 const api={
  start(stage){if(latencyStages.includes(stage)&&stage!=='TOTAL'&&stage!=='TTFR')starts.set(stage,clock());return api},
  end(stage){if(!starts.has(stage))return api;durations[stage]=measured(clock()-starts.get(stage));starts.delete(stage);return api},
  set(stage,durationMs){if(latencyStages.includes(stage))durations[stage]=measured(durationMs);return api},
  firstUseful(){if(!firstUseful){durations.TTFR=measured(clock()-started);firstUseful=true}return api},
  finish({record=true}={}){
   for(const stage of starts.keys())api.end(stage)
   durations.TOTAL=measured(clock()-started)
   if(durations.TTFR===null)durations.TTFR=durations.TOTAL
   const latency=Object.freeze({...durations})
   if(record&&registry?.record)registry.record({path,intent,latency})
   return latency
  },
  snapshot(){return Object.freeze({...durations})}
 }
 return api
}

export function legacyLatencyBreakdown(latency={},previous={}){
 const result={
  AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,
  EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null,
  ...(previous&&typeof previous==='object'?previous:{})
 }
 for(const [stage,legacy] of Object.entries(legacyStages)){
  const value=measured(latency?.[stage]);if(value!==null)result[legacy]=value
 }
 return result
}

export function attachLatencyPerformance(payload,{latency,path,intent,toolExecution=null}={}){
 if(!payload||typeof payload!=='object')return payload
 const run=payload?.advice?.ai_reasoning?.run
 const canonicalLatency={...latency}
 if(run?.latency_breakdown&&typeof run.latency_breakdown==='object'){
  for(const [stage,legacy] of Object.entries(legacyStages)){
   if(measured(canonicalLatency[stage])!==null)continue
   const inherited=measured(run.latency_breakdown[legacy])
   if(inherited!==null)canonicalLatency[stage]=inherited
  }
 }
 const performance=Object.freeze({version:latencyObservabilityVersion,path,intent,latency:Object.freeze(canonicalLatency),content_free:true})
 const responseMetadata={...(payload.responseMetadata||{}),performance}
 if(!run)return {...payload,responseMetadata}
 const nextRun={
  ...run,
  path:path||run.path,
  latency_ms:canonicalLatency?.TOTAL??run.latency_ms,
  latency_breakdown:legacyLatencyBreakdown(canonicalLatency,run.latency_breakdown),
  performance,
  ...(toolExecution?{
   capabilities_planned:toolExecution.capabilities_planned,
   capabilities_used:toolExecution.capabilities_used,
   capability_results:toolExecution.capability_results,
   tool_result:toolExecution.tool_result
  }:{})
 }
 return {...payload,responseMetadata,advice:{...payload.advice,ai_reasoning:{...payload.advice.ai_reasoning,run:nextRun}}}
}
