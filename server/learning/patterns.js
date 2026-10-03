import {fingerprint,sampleSufficiency,rate,LEARNING_VERSION} from './policy.js'
export function discoverPatterns(dataset,policy){
 const values=['accepted','rejected','executed','progress','won','lost','NO_DECISION']
 return values.map(value=>{
  const eligible=dataset.rows.filter(r=>r.labels.some(l=>value==='won'||value==='lost'||value==='NO_DECISION'?l.kind==='OUTCOME':l.kind==='FEEDBACK'||l.kind==='PROGRESS'))
  const supporting=eligible.filter(r=>r.labels.some(l=>l.value===value)),contrary=eligible.filter(r=>!r.labels.some(l=>l.value===value))
  if(!supporting.length)return null
  return {fingerprint:fingerprint([dataset.hash,value]),hypothesis:`Padrão candidato: ${value} observado em ${supporting.length}/${eligible.length} registros elegíveis.`,scope:dataset.scope,classification:supporting.length===1?'ACCOUNT_OBSERVATION':'LOCAL_PATTERN',state:'OBSERVED_PATTERN',attribution:'CAUSAL_NOT_PROVEN',supporting_evidence:supporting.map(r=>({id:r.id})),contrary_evidence:contrary.map(r=>({id:r.id})),confidence:eligible.length?supporting.length/eligible.length:0,sample_sufficiency:sampleSufficiency(eligible.length,policy),metric:rate(supporting.length,eligible.length,{period:[dataset.period_start,dataset.period_end],scope:dataset.scope}),engine_version:LEARNING_VERSION,policy_version:'val.learning_candidate_policy.v1',promotion_automatic:false}
 }).filter(Boolean)
}
export function driftMonitor(previous,current,policy){
 const enough=policy?.status==='APPROVED'&&policy.review?.reviewer&&Number.isInteger(policy.minimum_sample)&&policy.minimum_sample>=2&&previous.rows.length>=policy.minimum_sample&&current.rows.length>=policy.minimum_sample
 if(!enough)return {state:'INSUFFICIENT_SAMPLE',action:'REVIEW_REQUIRED',automatic_change:false,previous_sample:previous.rows.length,current_sample:current.rows.length}
 const dimensions={};for(const label of ['accepted','rejected','executed','NO_DECISION']){
  const count=d=>d.rows.filter(r=>r.labels.some(l=>l.value===label)).length
  dimensions[label]={previous:rate(count(previous),previous.rows.length,{scope:previous.scope,period:[previous.period_start,previous.period_end]}),current:rate(count(current),current.rows.length,{scope:current.scope,period:[current.period_start,current.period_end]})}
 }
 const distribution=(dataset,extract)=>{const counts={};for(const row of dataset.rows){const value=String(extract(row)??'UNKNOWN');counts[value]=(counts[value]||0)+1}return {counts,denominator:dataset.rows.length,period:[dataset.period_start,dataset.period_end],scope:dataset.scope,sample_size:dataset.rows.length,engine_version:LEARNING_VERSION}}
 const distributions={}
 for(const [key,extract] of Object.entries({recommendation_type:r=>r.dimensions?.recommendation_type||r.source.source,data_quality:r=>r.features.data_quality,confidence:r=>r.features.confidence,score_bands:r=>r.dimensions?.score_band,outcomes:r=>r.labels.find(l=>l.kind==='OUTCOME')?.value,coach_signals:r=>r.source.provenance.find(p=>p.signal)?.signal,cultures:r=>r.dimensions?.crop,regions:r=>r.dimensions?.region,missing_data:r=>r.features.missing_count,fallback:r=>r.dimensions?.fallback})){
  const a=distribution(previous,extract),b=distribution(current,extract),keys=new Set([...Object.keys(a.counts),...Object.keys(b.counts)]),distance=[...keys].reduce((n,k)=>n+Math.abs((a.counts[k]||0)/a.denominator-(b.counts[k]||0)/b.denominator),0)/2
  distributions[key]={previous:a,current:b,total_variation:distance}
 }
 const shifts=Object.values(dimensions).map(d=>Math.abs(d.current.value-d.previous.value)),max=Math.max(...shifts,...Object.values(distributions).map(d=>d.total_variation))
 if(!Number.isFinite(policy.watch)||!Number.isFinite(policy.shift)||policy.watch<0||policy.shift<policy.watch)return {state:'INSUFFICIENT_SAMPLE',reason:'POLICY_REQUIRED',automatic_change:false}
 return {state:max>=policy.shift?'SHIFT_DETECTED':max>=policy.watch?'WATCH':'STABLE',dimensions,distributions,action:max>=policy.watch?'REVIEW_REQUIRED':'MONITOR',causality:'CAUSAL_NOT_PROVEN',automatic_change:false}
}
