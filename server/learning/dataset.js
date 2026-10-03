import {fingerprint,numericFeatures,LEARNING_VERSION,rate} from './policy.js'
const time=x=>Date.parse(x)
export function buildLearningDataset(events,{tenantId,ownerIds,period_start,period_end,scope={},created_by,now=new Date().toISOString()}={}){
 const rows=[],excluded=[],seen=new Set(),quality={TOTAL:events.length,ELIGIBLE:0,LABELED:0,UNLABELED:0,EXCLUDED:0,DUPLICATES:0,CONFLICTS:0,MISSING_IDENTITY:0,TEMPORAL_VIOLATIONS:0}
 const pseudo=id=>fingerprint([tenantId,'learning-v1',id]).slice(0,24)
 for(const e of events){
  const reasons=[],s=e.snapshot
  if(!e.id||!e.owner_id||!e.account_id||!e.source||!e.version){reasons.push('MISSING_IDENTITY');quality.MISSING_IDENTITY++}
  if(e.tenant_id!==tenantId||!ownerIds.includes(e.owner_id))reasons.push('SCOPE_MISMATCH')
  if(e.synthetic||/demo|fixture|synthetic|automated.test|passo09|k5/i.test(e.source||''))reasons.push('SYNTHETIC_OR_DEMO')
  if(e.cancelled||e.displayed!==true)reasons.push('NOT_DISPLAYED')
  if(e.technical_unreviewed)reasons.push('TECHNICAL_UNREVIEWED')
  if(e.conflicts||e.units_invalid){reasons.push('CONFLICTS');quality.CONFLICTS++}
  if(seen.has(e.id)){reasons.push('DUPLICATES');quality.DUPLICATES++}seen.add(e.id)
  if(e.ingested_at&&time(e.ingested_at)>time(e.created_at)){reasons.push('TEMPORAL_VIOLATIONS');quality.TEMPORAL_VIOLATIONS++}
  if(!s||!Number.isFinite(time(s.context_timestamp))||!s.engine_version||s.engine_version==='UNKNOWN')reasons.push('MISSING_SNAPSHOT')
  else if(time(s.context_timestamp)>time(e.created_at)||time(e.created_at)<time(period_start)||time(e.created_at)>time(period_end)||[...(s.alternatives||[]),...(s.evidence_refs||[])].some(f=>!Number.isFinite(time(f.known_at))||time(f.known_at)>time(s.context_timestamp))){reasons.push('TEMPORAL_VIOLATIONS');quality.TEMPORAL_VIOLATIONS++}
  const labels=[]
  for(const label of e.labels||[]){
   if(label.tenant_id!==tenantId||label.owner_id!==e.owner_id||label.recommendation_id!==e.id||!label.id){reasons.push('RESULT_WITHOUT_LINK');continue}
   if(!Number.isFinite(time(label.created_at))||time(label.created_at)<time(s?.context_timestamp)||time(label.created_at)>time(period_end)){reasons.push('TEMPORAL_VIOLATIONS');quality.TEMPORAL_VIOLATIONS++;continue}
   if(['won','lost'].includes(label.value)&&label.kind!=='OUTCOME')continue
   if(label.value==='won'&&!label.commercial_proof)continue
   if(!['accepted','edited','rejected','scheduled','executed','progress','won','lost','NO_DECISION','impact'].includes(label.value))continue
   labels.push({id:pseudo(label.id),kind:label.kind,value:label.value,created_at:label.created_at,source:label.source||e.source,opportunity_id:label.opportunity_id?pseudo(label.opportunity_id):null})
  }
  if(reasons.length){excluded.push({event_ref:pseudo(e.id||'missing'),reasons:[...new Set(reasons)]});continue}
  const clean=(s.alternatives||[]).map(c=>({id:pseudo(c.id),known_at:c.known_at,features:numericFeatures(c.features),current_score:c.current_score}))
  rows.push({id:pseudo(e.id),account_id:pseudo(e.account_id),opportunity_id:s.selected_candidate?pseudo(s.selected_candidate):null,created_at:e.created_at,features:numericFeatures(s.score_components),dimensions:s.dimensions||{},alternatives:clean,selected_candidate:s.selected_candidate?pseudo(s.selected_candidate):null,labels,label_status:labels.length?'LABELED':'UNLABELED',source:{source:e.source,external_id:e.external_id?pseudo(e.external_id):null,canonical_identity:pseudo(e.id),observed_at:e.created_at,ingested_at:e.ingested_at||e.created_at,version:e.version,provenance:[...(e.provenance||[]),...(s.evidence_refs||[])].map(p=>({source:p.source,external_id:p.external_id?pseudo(p.external_id):null,canonical_identity:p.canonical_identity?pseudo(p.canonical_identity):null,observed_at:p.observed_at,ingested_at:p.ingested_at,version:p.version,signal:p.signal}))},source_versions:{engine:s.engine_version,prompt:s.prompt_version,policy:s.policy_version,model:s.model_version}})
 }
 quality.ELIGIBLE=rows.length;quality.LABELED=rows.filter(r=>r.labels.length).length;quality.UNLABELED=rows.length-quality.LABELED;quality.EXCLUDED=excluded.length
 const exclusion_reasons={};for(const e of excluded)for(const reason of e.reasons)exclusion_reasons[reason]=(exclusion_reasons[reason]||0)+1
 const hash=fingerprint({rows,excluded,period_start,period_end,scope})
 return {dataset_id:hash,version:hash.slice(0,16),created_at:now,period_start,period_end,scope,row_count:rows.length,labeled_count:quality.LABELED,unlabeled_count:quality.UNLABELED,excluded_count:excluded.length,exclusion_reasons,feature_schema_version:'val.learning_features.v1',source_versions:[...new Set(rows.map(r=>JSON.stringify(r.source_versions)))].map(x=>JSON.parse(x)),hash,created_by,engine_version:LEARNING_VERSION,quality,rows,excluded,coverage:{feedback:rate(rows.filter(r=>r.labels.some(l=>l.kind==='FEEDBACK')).length,rows.length,{period:[period_start,period_end],scope}),impact:rate(rows.filter(r=>r.labels.some(l=>l.kind==='IMPACT')).length,rows.length,{period:[period_start,period_end],scope}),recommendations_displayed:rows.length,label:rate(quality.LABELED,rows.length,{period:[period_start,period_end],scope}),outcome:rate(rows.filter(r=>r.labels.some(l=>l.kind==='OUTCOME')).length,rows.length,{period:[period_start,period_end],scope})}}
}
export function temporalSplit(rows,cutoff){
 const training=rows.filter(r=>time(r.created_at)<time(cutoff)&&r.labels.every(l=>time(l.created_at)<time(cutoff))),trainingGroups=new Set(training.map(r=>r.opportunity_id||r.account_id))
 const evaluation=rows.filter(r=>time(r.created_at)>=time(cutoff)&&!trainingGroups.has(r.opportunity_id||r.account_id))
 return {training,evaluation,excluded_count:rows.length-training.length-evaluation.length,cutoff,method:'TEMPORAL_GROUP_HOLDOUT'}
}
