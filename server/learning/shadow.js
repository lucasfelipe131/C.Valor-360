import {numericFeatures,sampleSufficiency,rate,fingerprint} from './policy.js'
import {temporalSplit} from './dataset.js'
export function evaluateShadow(dataset,{cutoff,weights={},sample_policy,k}={}){
 const split=temporalSplit(dataset.rows,cutoff),sample=sampleSufficiency(split.evaluation.length,sample_policy),allowed=['SUFFICIENT','STRONG'].includes(sample)
 const training=fitOfflineWeights(split.training,{sample_policy})
 const safeWeights=Object.keys(weights).length?numericFeatures(weights):training.weights
 const comparisons=allowed?split.evaluation.map(row=>{
  const shadow=row.alternatives.map(c=>{const contributions=Object.entries(c.features).map(([feature,value])=>({feature,value,weight:safeWeights[feature]||0,contribution:value*(safeWeights[feature]||0)}));return {id:c.id,score:contributions.reduce((n,c)=>n+c.contribution,0),feature_contributions:contributions,explanation:'Priorização shadow; não é probabilidade de compra.'}}).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
  return {recommendation:row.id,current_rule:row.alternatives.slice().sort((a,b)=>(b.current_score||0)-(a.current_score||0)).map(c=>c.id),candidate_ranker:shadow,divergent:shadow[0]?.id!==row.selected_candidate}
 }):[]
 const context={scope:dataset.scope,period:[dataset.period_start,dataset.period_end]},feedback=dataset.rows.filter(r=>r.labels.some(l=>l.kind==='FEEDBACK'))
 return {mode:'SHADOW',production_changed:false,score_meaning:'PRIORITIZATION',training,weights_origin:Object.keys(weights).length?'EXPLICIT_CANDIDATE':'OFFLINE_TRAINING',sample_sufficiency:sample,training_count:split.training.length,evaluation_count:split.evaluation.length,excluded_count:split.excluded_count,cutoff,weights:safeWeights,training_version:fingerprint([dataset.hash,cutoff,safeWeights]),comparisons,metrics:{accepted_rate:rate(feedback.filter(r=>r.labels.some(l=>l.value==='accepted')).length,feedback.length,context),executed_rate:rate(feedback.filter(r=>r.labels.some(l=>l.value==='executed')).length,feedback.length,context),progress_rate:rate(dataset.rows.filter(r=>r.labels.some(l=>l.value==='progress')).length,dataset.rows.length,context),outcome_coverage:dataset.coverage.outcome,top_1_progress_rate:{status:'INSUFFICIENT_CANDIDATE_LABELS'},precision_at_k:{status:'INSUFFICIENT_CANDIDATE_LABELS',k:k||null},ndcg_at_k:{status:'INSUFFICIENT_CANDIDATE_LABELS',k:k||null},ranking_regret:{status:'INSUFFICIENT_CANDIDATE_LABELS'}},ranking_metrics:rankingMetrics(split.evaluation,comparisons,k,{scope:dataset.scope,period:[dataset.period_start,dataset.period_end]}),evaluation_status:allowed?'DESCRIPTIVE_SHADOW':'INSUFFICIENT_SAMPLE',automatic_promotion:false}
}

export function rankingMetrics(rows,comparisons,k,{scope,period}={}){
 const base={scope,period},byId=new Map(rows.map(r=>[r.id,r])),eligible=[]
 if(!Number.isInteger(k)||k<1)return {status:'EVALUATION_POLICY_REQUIRED',k:null,numerator:0,denominator:0,...base}
 for(const comparison of comparisons){
  const row=byId.get(comparison.recommendation),labels=new Map()
  for(const label of row?.labels||[])if(label.opportunity_id&&['OUTCOME','PROGRESS'].includes(label.kind))labels.set(label.opportunity_id,['won','progress'].includes(label.value)?1:0)
  const ordered=comparison.candidate_ranker.map(c=>c.id)
  if(!ordered.length||ordered.some(id=>!labels.has(id)))continue
  const rel=ordered.map(id=>labels.get(id)),top=rel.slice(0,k),dcg=top.reduce((n,r,i)=>n+r/Math.log2(i+2),0),ideal=[...rel].sort((a,b)=>b-a).slice(0,k).reduce((n,r,i)=>n+r/Math.log2(i+2),0)
  eligible.push({top1:rel[0],hits:top.reduce((a,b)=>a+b,0),size:top.length,ndcg:ideal?dcg/ideal:0,regret:Math.max(...rel)-rel[0]})
 }
 const n=eligible.length,sum=key=>eligible.reduce((s,r)=>s+r[key],0)
 return {status:n?'EVALUATED':'INSUFFICIENT_CANDIDATE_LABELS',k,top_1_progress_rate:rate(sum('top1'),n,base),precision_at_k:rate(sum('hits'),sum('size'),{...base,sample_size:n}),ndcg_at_k:rate(sum('ndcg'),n,base),ranking_regret:rate(sum('regret'),n,base),fully_labeled_groups:n,excluded_groups:comparisons.length-n}
}

export function fitOfflineWeights(training,{sample_policy}={}){
 const labeled=training.filter(r=>r.labels.some(l=>['OUTCOME','PROGRESS'].includes(l.kind)))
 if(!['SUFFICIENT','STRONG'].includes(sampleSufficiency(labeled.length,sample_policy)))return {status:'INSUFFICIENT_SAMPLE',weights:{},training_count:labeled.length}
 const positives=labeled.filter(r=>r.labels.some(l=>['won','progress'].includes(l.value))),negatives=labeled.filter(r=>r.labels.some(l=>['lost','NO_DECISION'].includes(l.value))&&!r.labels.some(l=>['won','progress'].includes(l.value)))
 if(!positives.length||!negatives.length)return {status:'INSUFFICIENT_LABEL_VARIATION',weights:{},training_count:labeled.length}
 const keys=[...new Set(labeled.flatMap(r=>Object.keys(r.features)))],weights={}
 for(const key of keys){const p=positives.map(r=>r.features[key]).filter(Number.isFinite),n=negatives.map(r=>r.features[key]).filter(Number.isFinite);if(!p.length||!n.length)continue;const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,scale=Math.max(...p,...n)-Math.min(...p,...n);weights[key]=scale?(mean(p)-mean(n))/scale:0}
 return {status:'FITTED_OFFLINE',method:'NORMALIZED_OBSERVED_FEATURE_DIFFERENCE_V1',weights:numericFeatures(weights),training_count:labeled.length,positive_count:positives.length,negative_count:negatives.length,score_meaning:'PRIORITIZATION_NOT_PROBABILITY'}
}
