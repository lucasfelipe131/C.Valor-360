import {collectLearningSources} from './sources.js'
import {randomUUID} from 'node:crypto'
import {fail,fingerprint,LEARNING_VERSION,candidateTransitions,promotionTransitions,reviewRecord,sampleSufficiency,rate} from './policy.js'
import {buildLearningDataset} from './dataset.js'
import {discoverPatterns,driftMonitor} from './patterns.js'
import {evaluateShadow} from './shadow.js'
import {validatePromotedKnowledge,publishedKnowledgeView} from '../knowledge/promotion.js'
import {outcomeEvidenceViolations} from '../revenue-policy.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const date=x=>Number.isFinite(Date.parse(x))
export class LearningService{
 constructor({decisionService}){this.decisions=decisionService;this.db=decisionService.db;this.tenantId=decisionService.tenantId}
 async access(actor,c=this.db,{write=false,admin=false}={}){
  if(!this.db.configured||actor?.tenantId!==this.tenantId||!uuid.test(actor?.id||'')||actor.demo)fail('learning_access_denied',403)
  const row=(await c.query("SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND u.status='active' AND (u.expires_at IS NULL OR u.expires_at>now())",[this.tenantId,actor.id])).rows[0]
  if(!row||row.role!==actor.role||admin&&row.role!=='admin'||write&&!['admin','technical_reviewer'].includes(row.role))fail('learning_access_denied',403)
  const settings=await this.decisions.settings(c)
  if(!settings.flags.organizational_learning_v1)fail('learning_disabled',409)
  if(actor.role==='admin')return {settings,owners:(await c.query('SELECT user_id FROM memberships WHERE tenant_id=$1',[this.tenantId])).rows.map(r=>r.user_id)}
  if(['manager','bi_viewer','technical_reviewer'].includes(actor.role))return {settings,owners:(await c.query('SELECT b.user_id FROM val_management_memberships a JOIN val_management_memberships b ON b.tenant_id=a.tenant_id AND b.unit_id=a.unit_id WHERE a.tenant_id=$1 AND a.user_id=$2',[this.tenantId,actor.id])).rows.map(r=>r.user_id)}
  return {settings,owners:[actor.id]}
 }
 async audit(c,actor,action,id,payload){await c.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'organizational_learning',$4,$5)",[this.tenantId,actor.id,action,id,JSON.stringify(payload)])}
 async artifact(c,actor,kind,payload){const hash=fingerprint({kind,payload:{...payload,created_at:null,created_by:null}});const row=(await c.query('INSERT INTO val_learning_artifacts(tenant_id,owner_id,kind,fingerprint,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,kind,fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING *',[this.tenantId,actor.id,kind,hash,JSON.stringify(payload)])).rows[0];return row}
 async candidate(c,actor,id,access,{lock=false}={}){
  const row=(await c.query(`SELECT l.*,v.consultant_id,v.client_id FROM val_learning_candidates l JOIN visits v ON v.tenant_id=l.tenant_id AND v.id=l.source_visit_id JOIN clients cl ON cl.tenant_id=v.tenant_id AND cl.id=v.client_id WHERE l.tenant_id=$1 AND l.id=$2 AND v.consultant_id=ANY($3::uuid[]) AND cl.consultant_id=ANY($3::uuid[]) ${lock?'FOR UPDATE OF l':''}`,[this.tenantId,id,access.owners])).rows[0]
  if(!row)fail('learning_candidate_not_found',404)
  return row
 }
 async candidateDetail(actor,id){if(['manager','bi_viewer'].includes(actor.role))fail('learning_aggregate_only',403);const access=await this.access(actor);const row=await this.candidate(this.db,actor,id,access);return {...row,review_history:(await this.db.query('SELECT payload FROM val_learning_reviews WHERE tenant_id=$1 AND candidate_id=$2 ORDER BY created_at',[this.tenantId,id])).rows.map(r=>r.payload),promotion_eligibility:'HUMAN_REVIEW_AND_RELEASE_GATES_REQUIRED'}}
 async createCandidate(actor,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{write:true})
  if(!uuid.test(input.outcome_id||''))fail('learning_outcome_required')
  const outcome=(await c.query('SELECT o.*,v.consultant_id,cl.source FROM val_outcomes o JOIN visits v ON v.tenant_id=o.tenant_id AND v.id=o.visit_id JOIN clients cl ON cl.tenant_id=o.tenant_id AND cl.id=o.client_id WHERE o.tenant_id=$1 AND o.id=$2 AND v.consultant_id=ANY($3::uuid[]) AND cl.consultant_id=ANY($3::uuid[])',[this.tenantId,input.outcome_id,access.owners])).rows[0]
  if(!outcome)fail('learning_outcome_not_found',404)
  if(!String(input.hypothesis||'').trim()||!Array.isArray(input.contrary_evidence))fail('candidate_hypothesis_and_contrary_field_required')
  if(input.attribution&&input.attribution!=='CAUSAL_NOT_PROVEN')fail('learning_causal_claim_denied')
  if(input.contrary_evidence.length)fail('contrary_evidence_requires_canonical_outcome_ids')
  const contraryIds=input.contrary_outcome_ids||[]
  if(!Array.isArray(contraryIds)||contraryIds.some(id=>!uuid.test(id)))fail('contrary_ids_invalid')
  const contrary=(await c.query('SELECT id,evidence_refs FROM val_outcomes WHERE tenant_id=$1 AND client_id=$2 AND id=ANY($3::uuid[])',[this.tenantId,outcome.client_id,contraryIds])).rows
  if(contrary.length!==new Set(contraryIds).size)fail('contrary_evidence_scope_invalid')
  const supportingIds=[...new Set([outcome.id,...(input.supporting_outcome_ids||[])])]
  if(supportingIds.some(id=>!uuid.test(id))||supportingIds.some(id=>contraryIds.includes(id)))fail('supporting_ids_invalid')
  const supporting=(await c.query('SELECT id,evidence_refs FROM val_outcomes WHERE tenant_id=$1 AND client_id=$2 AND recorded_by=ANY($3::uuid[]) AND id=ANY($4::uuid[]) AND outcome_type=$5 ORDER BY id',[this.tenantId,outcome.client_id,access.owners,supportingIds,outcome.outcome_type])).rows
  if(supporting.length!==supportingIds.length)fail('supporting_scope_invalid')
  const feedbackRefs=(await c.query('SELECT id FROM val_feedback WHERE tenant_id=$1 AND recommendation_id=$2',[this.tenantId,outcome.recommendation_id||null])).rows
  const impacts=(await c.query('SELECT id FROM val_observed_impacts WHERE tenant_id=$1 AND outcome_id=ANY($2::uuid[])',[this.tenantId,supportingIds])).rows
  const hash=fingerprint([[...supportingIds].sort(),[...contraryIds].sort(),'val.learning_candidate_policy.v1']),metadata={engine_version:LEARNING_VERSION,policy_version:'val.learning_candidate_policy.v1',technical:outcome.outcome_type==='TECHNICAL_RESULT',classification:supporting.length>1?'LOCAL_PATTERN':'ACCOUNT_OBSERVATION',sample_sufficiency:sampleSufficiency(supporting.length+contrary.length,await this.approvedControl(c,'SAMPLE')),attribution:'CAUSAL_NOT_PROVEN',source_decision:outcome.result?.decision_card_id||null,source_recommendation:outcome.recommendation_id||null,source_feedback:feedbackRefs.map(f=>f.id),source_commitment:outcome.commitment_id||null,source_value_plan:outcome.result?.opportunity_id||null,source_impact:impacts.map(i=>i.id),source:outcome.source,tenant:this.tenantId}
  if(supporting.length===1&&!contrary.length){
   const existing=(await c.query('SELECT * FROM val_learning_candidates WHERE tenant_id=$1 AND source_outcome_id=$2 AND candidate_fingerprint IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE',[this.tenantId,outcome.id])).rows[0]
   if(existing){await c.query('UPDATE val_learning_candidates SET candidate_fingerprint=$3,learning_metadata=$4 WHERE tenant_id=$1 AND id=$2',[this.tenantId,existing.id,hash,JSON.stringify(metadata)]);return {...existing,candidate_fingerprint:hash,learning_metadata:metadata}}
  }
  const row=(await c.query("INSERT INTO val_learning_candidates(tenant_id,source_visit_id,source_visit_report_id,source_outcome_id,created_by,contract_version,hypothesis,scope,supporting_evidence,contrary_evidence,confidence,status,learning_metadata,candidate_fingerprint) VALUES($1,$2,$3,$4,$5,'val.learning_candidate.v1',$6,$7,$8,$9,$10,'CANDIDATE',$11,$12) ON CONFLICT(tenant_id,candidate_fingerprint) WHERE candidate_fingerprint IS NOT NULL DO NOTHING RETURNING *",[this.tenantId,outcome.visit_id,outcome.visit_report_id,outcome.id,actor.id,input.hypothesis.slice(0,4000),JSON.stringify({client_id:outcome.client_id,geography_scope:input.geography_scope||'ACCOUNT_ONLY',crop_scope:input.crop_scope||[],season_scope:input.season_scope||[],commercial_scope:'ACCOUNT_ONLY'}),JSON.stringify(supporting.map(r=>({id:r.id,type:'OUTCOME',evidence_refs:r.evidence_refs}))),JSON.stringify(contrary.map(r=>({id:r.id,type:'OUTCOME',evidence_refs:r.evidence_refs}))),supporting.length/(supporting.length+contrary.length),JSON.stringify(metadata),hash])).rows[0]
  if(row){await this.audit(c,actor,'learning_candidate_created',row.id,{source_outcome:outcome.id,fingerprint:hash});return row}
  return (await c.query('SELECT * FROM val_learning_candidates WHERE tenant_id=$1 AND candidate_fingerprint=$2',[this.tenantId,hash])).rows[0]
 })}
 async addContrary(actor,id,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{write:true}),row=await this.candidate(c,actor,id,access,{lock:true})
  if(!Array.isArray(input.outcome_ids)||!input.outcome_ids.length||input.outcome_ids.some(id=>!uuid.test(id)))fail('contrary_ids_required')
  const evidence=(await c.query('SELECT id,evidence_refs FROM val_outcomes WHERE tenant_id=$1 AND client_id=$2 AND id=ANY($3::uuid[])',[this.tenantId,row.client_id,input.outcome_ids])).rows
  if(evidence.length!==new Set(input.outcome_ids).size||evidence.some(e=>row.supporting_evidence.some(s=>s.id===e.id)))fail('contrary_scope_invalid')
  const contrary=[...new Map([...row.contrary_evidence,...evidence.map(e=>({id:e.id,type:'OUTCOME',evidence_refs:e.evidence_refs}))].map(e=>[e.id,e])).values()]
  const confidence=row.supporting_evidence.length/(row.supporting_evidence.length+contrary.length)
  await c.query("UPDATE val_learning_candidates SET contrary_evidence=$3,confidence=$4,status='UNDER_REVIEW',updated_at=now() WHERE tenant_id=$1 AND id=$2",[this.tenantId,id,JSON.stringify(contrary),confidence])
  await this.audit(c,actor,'pattern_invalidated',id,{contrary_ids:evidence.map(e=>e.id),before_status:row.status,after_status:'UNDER_REVIEW',confidence,reason:'NEW_CONTRARY_EVIDENCE'})
  return {status:'UNDER_REVIEW',confidence,contrary_evidence:contrary}
 })}
 async reviewCandidate(actor,id,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{write:true}),row=await this.candidate(c,actor,id,access,{lock:true})
  if(row.status!==input.expected_status)fail('candidate_revision_conflict',409)
  if(!candidateTransitions[row.status]?.includes(input.status))fail('candidate_transition_invalid')
  const origin=(await c.query('SELECT outcome_type FROM val_outcomes WHERE tenant_id=$1 AND id=$2',[this.tenantId,row.source_outcome_id])).rows[0]
  const technical=origin?.outcome_type==='TECHNICAL_RESULT'||['TECHNICAL','AGRONOMIC'].includes(row.scope?.domain)||row.learning_metadata?.technical===true
  const review=reviewRecord(actor,input,{technical})
  const expectedContrary=row.contrary_evidence.map(e=>e.id).sort();if(JSON.stringify([...new Set(input.contrary_evidence_reviewed)].sort())!==JSON.stringify(expectedContrary))fail('contrary_evidence_not_reviewed')
  if(row.supporting_evidence.some(e=>!input.evidence_reviewed.includes(e.id)))fail('supporting_evidence_not_reviewed')
  await c.query('UPDATE val_learning_candidates SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,input.status])
  await c.query('INSERT INTO val_learning_reviews(tenant_id,candidate_id,reviewer,decision,payload) VALUES($1,$2,$3,$4,$5)',[this.tenantId,id,actor.id,input.status,JSON.stringify(review)])
  await this.audit(c,actor,'learning_candidate_reviewed',id,review);return {status:input.status,automatic_promotion:false}
 })}
 async dataset(actor,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{admin:true})
  if(!date(input.period_start)||!date(input.period_end)||Date.parse(input.period_end)<=Date.parse(input.period_start)||Date.parse(input.period_end)>Date.now()||Date.parse(input.period_end)-Date.parse(input.period_start)>366*86400000)fail('dataset_period_invalid')
  const records=(await c.query("SELECT r.*,cl.source,cl.commercial_profile FROM val_recommendations r JOIN clients cl ON cl.tenant_id=r.tenant_id AND cl.id=r.client_id AND cl.consultant_id=r.consultant_id WHERE r.tenant_id=$1 AND r.consultant_id=ANY($2::uuid[]) AND r.created_at BETWEEN $3 AND $4 ORDER BY r.created_at,r.id LIMIT 5001",[this.tenantId,access.owners,input.period_start,input.period_end])).rows
  if(records.length>5000)fail('dataset_period_too_large')
  const ids=records.map(r=>r.id)
  const feedback=(await c.query('SELECT * FROM val_feedback WHERE tenant_id=$1 AND recommendation_id=ANY($2::uuid[]) AND created_at<=$3',[this.tenantId,ids,input.period_end])).rows
  const outcomes=(await c.query('SELECT * FROM val_outcomes WHERE tenant_id=$1 AND recommendation_id=ANY($2::uuid[]) AND measured_at<=$3',[this.tenantId,ids,input.period_end])).rows
  const labels=new Map(ids.map(id=>[id,[]]))
  for(const f of feedback)labels.get(f.recommendation_id)?.push({id:f.id,recommendation_id:f.recommendation_id,tenant_id:f.tenant_id,owner_id:f.user_id,created_at:f.created_at,kind:'FEEDBACK',value:f.outcome})
  for(const o of outcomes)labels.get(o.recommendation_id)?.push({id:o.id,recommendation_id:o.recommendation_id,tenant_id:o.tenant_id,owner_id:o.recorded_by,created_at:o.measured_at,kind:'OUTCOME',opportunity_id:o.result?.opportunity_id||null,value:o.outcome_type==='WON'?'won':o.outcome_type==='LOST'?'lost':o.outcome_type,commercial_proof:outcomeEvidenceViolations(o).length===0})
  const events=records.map(r=>({id:r.id,tenant_id:r.tenant_id,owner_id:r.consultant_id,account_id:r.client_id,created_at:new Date(r.created_at).toISOString(),snapshot:r.learning_snapshot,labels:labels.get(r.id),source:r.source||'canonical_recommendation',version:r.context_snapshot_version||'val.recommendation.v1',synthetic:r.commercial_profile?.synthetic||r.commercial_profile?.isDemo,technical_unreviewed:r.status==='pending_review',cancelled:r.status==='cancelled',displayed:Boolean(r.learning_displayed_at)}))
  const extra=await collectLearningSources(c,{tenantId:this.tenantId,owners:access.owners,start:input.period_start,end:input.period_end})
  const dataset=buildLearningDataset([...events,...extra],{tenantId:this.tenantId,ownerIds:access.owners,period_start:input.period_start,period_end:input.period_end,scope:{tenant:this.tenantId,geography_scope:'RECORDED_SCOPE_ONLY'},created_by:actor.id})
  const artifact=await this.artifact(c,actor,'DATASET',dataset)
  await this.audit(c,actor,'dataset_created',artifact.id,{hash:dataset.hash,quality:dataset.quality})
  const patterns=discoverPatterns(dataset,await this.approvedControl(c,'SAMPLE'))
  for(const pattern of patterns){const p=await this.artifact(c,actor,'PATTERN',{...pattern,dataset_id:artifact.id});await this.audit(c,actor,'pattern_detected',p.id,{fingerprint:pattern.fingerprint})}
  return {...artifact,payload:{...dataset,rows:undefined,excluded:undefined}}
 })}
 async displayed(actor,id){return this.db.transaction(async c=>{await this.access(actor,c);const row=(await c.query("UPDATE val_recommendations r SET learning_displayed_at=COALESCE(learning_displayed_at,now()) FROM clients cl WHERE r.tenant_id=$1 AND r.id=$2 AND r.consultant_id=$3 AND r.status='generated' AND cl.id=r.client_id AND cl.tenant_id=r.tenant_id AND cl.consultant_id=$3 RETURNING r.id",[this.tenantId,id,actor.id])).rows[0];if(!row)fail('recommendation_not_found',404);return {recorded:true}})}
 async control(actor,input){return this.db.transaction(async c=>{
  await this.access(actor,c,{admin:true})
  if(!['SAMPLE','DRIFT','REGRESSION'].includes(input.kind)||!input.version||!input.reason)fail('learning_control_required')
  const payload={...input,status:'DRAFT'}
  if(input.kind==='SAMPLE'){
   const t=input.thresholds;if(!t||![t.limited,t.sufficient,t.strong].every(Number.isInteger)||t.limited<2||t.sufficient<t.limited||t.strong<t.sufficient)fail('sample_thresholds_invalid')
  }
  if(input.kind==='DRIFT'&&(!Number.isInteger(input.minimum_sample)||input.minimum_sample<2||!Number.isFinite(input.watch)||!Number.isFinite(input.shift)||input.watch<0||input.shift<input.watch||input.shift>1))fail('drift_thresholds_invalid')
  if(input.kind==='REGRESSION'){
   const exists=(await c.query("SELECT id FROM val_learning_artifacts WHERE tenant_id=$1 AND id=$2 AND kind='SHADOW'",[this.tenantId,input.shadow_id])).rows[0]
   if(!exists||!['safety','isolation','grounding','technical_review','provenance'].every(k=>['PASS','FAIL'].includes(input.checks?.[k]))||!input.evidence_refs?.length)fail('regression_report_required')
  }
  const row=(await c.query('INSERT INTO val_learning_controls(tenant_id,kind,version,payload,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[this.tenantId,input.kind,input.version,JSON.stringify(payload),actor.id])).rows[0]
  await this.audit(c,actor,'policy_candidate_created',row.id,{kind:input.kind,version:input.version});return row
 })}
 async reviewControl(actor,id,input){return this.db.transaction(async c=>{
  await this.access(actor,c,{admin:true})
  const row=(await c.query('SELECT * FROM val_learning_controls WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[this.tenantId,id])).rows[0]
  if(!row)fail('control_not_found',404)
  if(row.status!=='DRAFT'||!['APPROVED','REJECTED'].includes(input.status))fail('control_transition_invalid')
  if(row.created_by===actor.id)fail('independent_human_review_required',403)
  const review=reviewRecord(actor,input),payload={...row.payload,status:input.status,review}
  await c.query('UPDATE val_learning_controls SET status=$3,payload=$4,reviewed_by=$5 WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,input.status,JSON.stringify(payload),actor.id])
  await this.audit(c,actor,input.status==='APPROVED'?'promotion_approved':'promotion_rejected',id,{kind:'LEARNING_CONTROL',...review});return {status:input.status,automatic_runtime_change:false}
 })}
 async approvedControl(c,kind,id=null){return (await c.query("SELECT payload FROM val_learning_controls WHERE tenant_id=$1 AND kind=$2 AND status='APPROVED' AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at DESC LIMIT 1",[this.tenantId,kind,id])).rows[0]?.payload||null}
 async runShadow(actor,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{admin:true});if(!access.settings.flags.shadow_ranker_v1)fail('shadow_disabled',409)
  const row=(await c.query("SELECT * FROM val_learning_artifacts WHERE tenant_id=$1 AND id=$2 AND kind='DATASET'",[this.tenantId,input.dataset_id])).rows[0]
  if(!row)fail('dataset_not_found',404)
  if(!date(input.cutoff)||Date.parse(input.cutoff)<=Date.parse(row.payload.period_start)||Date.parse(input.cutoff)>=Date.parse(row.payload.period_end))fail('temporal_cutoff_invalid')
  const result=evaluateShadow(row.payload,{cutoff:input.cutoff,weights:input.weights||{},sample_policy:await this.approvedControl(c,'SAMPLE'),k:input.k})
  const artifact=await this.artifact(c,actor,'SHADOW',{...result,dataset_id:row.id})
  await this.audit(c,actor,'shadow_ranker_evaluated',artifact.id,{mode:'SHADOW',production_changed:false});return artifact
 })}
 async drift(actor,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{admin:true});if(!access.settings.flags.drift_monitor_v1)fail('drift_disabled',409)
  const rows=(await c.query("SELECT * FROM val_learning_artifacts WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND kind='DATASET'",[this.tenantId,[input.previous_id,input.current_id]])).rows
  const previous=rows.find(r=>r.id===input.previous_id),current=rows.find(r=>r.id===input.current_id)
  if(!previous||!current||previous.id===current.id||Date.parse(previous.payload.period_end)>=Date.parse(current.payload.period_start))fail('drift_temporal_datasets_required')
  const result=driftMonitor(previous.payload,current.payload,await this.approvedControl(c,'DRIFT')),artifact=await this.artifact(c,actor,'DRIFT',{...result,previous_id:previous.id,current_id:current.id});await this.audit(c,actor,'drift_detected',artifact.id,result);return artifact
 })}
 async propose(actor,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{write:true});if(!access.settings.flags.knowledge_promotion_v1)fail('promotion_disabled',409)
  const candidate=await this.candidate(c,actor,input.candidate_id,access,{lock:true})
  if(candidate.status!=='APPROVED')fail('approved_candidate_required')
  if(!['KNOWLEDGE','PROMPT','POLICY','WEIGHT','MODEL','QUESTION','RULE'].includes(input.kind)||!input.current_version||!input.candidate_version||input.current_version===input.candidate_version||!input.reason||!input.risk||!input.expected_effect||!input.rollback_target)fail('promotion_contract_required')
  if(input.kind!=='KNOWLEDGE'&&(!input.target_id||!input.diff))fail('proposal_target_and_diff_required')
  if(input.kind==='WEIGHT'&&(!Number.isFinite(input.current_weight)||!Number.isFinite(input.candidate_weight)))fail('weight_proposal_required')
  if(input.kind==='MODEL'&&(!input.dataset_id||!input.training_version||!input.shadow_period))fail('model_registry_fields_required')
  if(input.kind==='KNOWLEDGE'&&(!input.knowledge_item||input.knowledge_item.provenance?.candidate_id!==candidate.id||input.knowledge_item.version!==input.candidate_version))fail('knowledge_candidate_version_mismatch')
  const payload={...input,scope:candidate.scope,prompt_id:input.kind==='PROMPT'?input.target_id:null,policy_id:input.kind==='POLICY'?input.target_id:null,model_id:input.kind==='MODEL'?input.target_id:null,evidence:candidate.supporting_evidence,contrary_evidence:candidate.contrary_evidence,sample_size:candidate.supporting_evidence.length+candidate.contrary_evidence.length,automatic_apply:false,production_authorized:false,previous_version:input.current_version,review_history:[],sample_sufficiency:candidate.learning_metadata?.sample_sufficiency||'INSUFFICIENT_FOR_PROMOTION'}
  const hash=fingerprint([candidate.id,input.kind,input.candidate_version,payload])
  const row=(await c.query("INSERT INTO val_learning_promotions(tenant_id,candidate_id,created_by,kind,fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING *",[this.tenantId,candidate.id,actor.id,input.kind,hash,JSON.stringify(payload)])).rows[0]
  await this.audit(c,actor,'promotion_proposed',row.id,{kind:row.kind,version:input.candidate_version})
  const event={PROMPT:'prompt_candidate_created',POLICY:'policy_candidate_created',MODEL:'model_candidate_created'}[row.kind];if(event)await this.audit(c,actor,event,row.id,{current_version:input.current_version,candidate_version:input.candidate_version})
  return row
 })}
 async reviewPromotion(actor,id,input){return this.db.transaction(async c=>{
  const access=await this.access(actor,c,{write:true});if(!access.settings.flags.knowledge_promotion_v1)fail('promotion_disabled',409)
  const row=(await c.query('SELECT * FROM val_learning_promotions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[this.tenantId,id])).rows[0]
  if(!row)fail('promotion_not_found',404)
  const candidate=await this.candidate(c,actor,row.candidate_id,access,{lock:true})
  if(input.expected_revision!==row.revision)fail('promotion_revision_conflict',409)
  if(!promotionTransitions[row.status]?.includes(input.status))fail('promotion_transition_invalid')
  const origin=(await c.query('SELECT outcome_type FROM val_outcomes WHERE tenant_id=$1 AND id=$2',[this.tenantId,candidate.source_outcome_id])).rows[0]
  const technical=origin?.outcome_type==='TECHNICAL_RESULT'||row.payload.risk==='HIGH'||row.payload.knowledge_item?.risk==='HIGH'||row.payload.knowledge_item?.domain==='AGRONOMIC'||row.payload.domain==='AGRONOMIC'||candidate.learning_metadata?.technical
  const review=reviewRecord(actor,input,{technical:Boolean(technical)})
  if(row.created_by===actor.id&&['APPROVED','PUBLISHED'].includes(input.status))fail('independent_human_review_required',403)
  if(candidate.supporting_evidence.some(e=>!input.evidence_reviewed.includes(e.id))||candidate.contrary_evidence.some(e=>!input.contrary_evidence_reviewed.includes(e.id)))fail('promotion_evidence_review_incomplete')
  let payload={...row.payload,review_history:[...(row.payload.review_history||[]),review]}
  if(['APPROVED','PUBLISHED'].includes(input.status)){
   if(candidate.status!=='APPROVED')fail('candidate_approval_no_longer_valid')
   // Client-provided booleans cannot authorize safety or sufficiency. Evidence
   // must be a persisted evaluation from this tenant with approved policy.
   const evaluation=(await c.query("SELECT payload FROM val_learning_artifacts WHERE tenant_id=$1 AND id=$2 AND kind='SHADOW'",[this.tenantId,payload.evaluation_id||null])).rows[0]?.payload
   if(!evaluation||!['SUFFICIENT','STRONG'].includes(evaluation.sample_sufficiency)||evaluation.mode!=='SHADOW'||!evaluation.comparisons?.length||!evaluation.training_count)fail('promotion_offline_evaluation_required')
   const regression=await this.approvedControl(c,'REGRESSION',payload.regression_id||null)
   if(!regression||regression.shadow_id!==payload.evaluation_id||!['safety','isolation','grounding','technical_review','provenance'].every(k=>regression.checks?.[k]==='PASS'))fail('promotion_safety_regression_required')
   const sufficiency=sampleSufficiency(candidate.supporting_evidence.length+candidate.contrary_evidence.length,await this.approvedControl(c,'SAMPLE'))
   if(candidate.supporting_evidence.length<2||!['SUFFICIENT','STRONG'].includes(sufficiency))fail('candidate_sample_insufficient')
  }
  if(input.status==='PUBLISHED'){
   if(!['staging','test','development'].includes(this.decisions.environment))fail('production_release_not_authorized',403)
   if(!date(payload.valid_until)||!date(payload.review_at)||Date.parse(payload.valid_until)<=Date.now()||Date.parse(payload.review_at)<=Date.now())fail('promotion_expiry_required')
   if(row.kind==='KNOWLEDGE')payload.knowledge_item=validatePromotedKnowledge(payload.knowledge_item,{scope:candidate.scope,technicalReview:payload.review_history.find(r=>r.role==='technical_reviewer'&&r.decision==='APPROVED')})
   await c.query('INSERT INTO val_learning_publications(tenant_id,promotion_id,kind,version,previous_version,rollback_target,payload,published_by,valid_until,review_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[this.tenantId,id,row.kind,payload.candidate_version,payload.previous_version,payload.rollback_target,JSON.stringify(payload),actor.id,payload.valid_until,payload.review_at])
   await this.audit(c,actor,row.kind==='KNOWLEDGE'?'knowledge_published':'promotion_published',id,{version:payload.candidate_version,runtime_applied:false})
  }
  if(input.status==='ROLLED_BACK'){payload={...payload,rollback_reason:input.reason,rolled_back_by:actor.id,rolled_back_at:review.reviewed_at};await this.audit(c,actor,'rollback_executed',id,{previous_version:payload.previous_version,rollback_target:payload.rollback_target,reason:input.reason})}
  if(input.status==='SUPERSEDED')await this.audit(c,actor,'knowledge_superseded',id,{reason:input.reason})
  await c.query('UPDATE val_learning_promotions SET status=$3,payload=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,input.status,JSON.stringify(payload)])
  await c.query('INSERT INTO val_learning_reviews(tenant_id,promotion_id,reviewer,decision,payload) VALUES($1,$2,$3,$4,$5)',[this.tenantId,id,actor.id,input.status,JSON.stringify(review)])
  await this.audit(c,actor,input.status==='APPROVED'?'promotion_approved':input.status==='REJECTED'?'promotion_rejected':'promotion_reviewed',id,review)
  return {status:input.status,revision:row.revision+1,runtime_applied:false}
 })}
 async center(actor,{limit=30,offset=0}={}){
  const access=await this.access(actor);if(!access.settings.flags.learning_center_v1)fail('learning_center_disabled',409)
  limit=Math.max(1,Math.min(100,Number(limit)||30));offset=Math.max(0,Math.min(100000,Number(offset)||0))
  const candidates=(await this.db.query('SELECT l.* FROM val_learning_candidates l JOIN visits v ON v.tenant_id=l.tenant_id AND v.id=l.source_visit_id JOIN clients cl ON cl.id=v.client_id AND cl.tenant_id=v.tenant_id WHERE l.tenant_id=$1 AND v.consultant_id=ANY($2::uuid[]) AND cl.consultant_id=ANY($2::uuid[]) ORDER BY l.created_at DESC,l.id LIMIT $3 OFFSET $4',[this.tenantId,access.owners,limit,offset])).rows
  if(['manager','bi_viewer'].includes(actor.role))return {enabled:true,candidates:[],patterns:[],datasets:[],shadow:[],drift:[],promotions:[],publications:[],history:[],rollback_history:[],knowledge:[],summary:{visible_candidates:candidates.length,review_pending:candidates.filter(c=>['CANDIDATE','UNDER_REVIEW'].includes(c.status)).length,scope:'AUTHORIZED_UNIT',sample_note:'Agregado da página da unidade, sem ranking pessoal.'},aggregate:{by_status:Object.fromEntries(['CANDIDATE','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED'].map(status=>[status,candidates.filter(c=>c.status===status).length])),supporting_count:candidates.reduce((n,c)=>n+c.supporting_evidence.length,0),contrary_count:candidates.reduce((n,c)=>n+c.contrary_evidence.length,0)},personal_ranking:false,page:{limit,offset}}
  const privileged=['admin','technical_reviewer'].includes(actor.role)
  const artifacts=actor.role==='admin'?(await this.db.query("SELECT id,kind,created_at,payload-'rows'-'excluded' AS payload FROM val_learning_artifacts WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",[this.tenantId,limit,offset])).rows:[]
  const promotions=privileged?(await this.db.query('SELECT p.* FROM val_learning_promotions p JOIN val_learning_candidates l ON l.tenant_id=p.tenant_id AND l.id=p.candidate_id JOIN visits v ON v.tenant_id=l.tenant_id AND v.id=l.source_visit_id JOIN clients cl ON cl.tenant_id=v.tenant_id AND cl.id=v.client_id WHERE p.tenant_id=$1 AND v.consultant_id=ANY($2::uuid[]) AND cl.consultant_id=ANY($2::uuid[]) ORDER BY p.created_at DESC,p.id LIMIT $3 OFFSET $4',[this.tenantId,access.owners,limit,offset])).rows:[]
  const publications=actor.role==='admin'?(await this.db.query('SELECT u.*,p.status FROM val_learning_publications u JOIN val_learning_promotions p ON p.tenant_id=u.tenant_id AND p.id=u.promotion_id WHERE u.tenant_id=$1 ORDER BY u.created_at DESC,u.id LIMIT $2 OFFSET $3',[this.tenantId,limit,offset])).rows:[]
  const history=actor.role==='admin'?(await this.db.query("SELECT action,entity_id,after_data,actor_id,created_at FROM audit_events WHERE tenant_id=$1 AND entity_type='organizational_learning' ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",[this.tenantId,limit,offset])).rows:[]
  const controls=actor.role==='admin'?(await this.db.query('SELECT * FROM val_learning_controls WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[this.tenantId,limit,offset])).rows:[]
  const pageScope={scope:{tenant:this.tenantId,page:{limit,offset}},period:[candidates.at(-1)?.created_at||null,candidates[0]?.created_at||null]}
  return {enabled:true,engine_version:LEARNING_VERSION,controls,coverage:{review:rate(candidates.filter(c=>['APPROVED','REJECTED','EXPIRED'].includes(c.status)).length,candidates.length,pageScope),publication:rate(promotions.filter(p=>p.status==='PUBLISHED').length,promotions.length,pageScope)},candidates,patterns:artifacts.filter(a=>a.kind==='PATTERN'),datasets:artifacts.filter(a=>a.kind==='DATASET'),shadow:artifacts.filter(a=>a.kind==='SHADOW'),drift:artifacts.filter(a=>a.kind==='DRIFT'),promotions,publications,knowledge:publishedKnowledgeView(publications),history,rollback_history:history.filter(h=>h.action==='rollback_executed'),registry:{...this.decisions.registry,candidates:promotions.filter(p=>['MODEL','PROMPT','POLICY','WEIGHT'].includes(p.kind))},summary:{visible_candidates:candidates.length,review_pending:candidates.filter(c=>['CANDIDATE','UNDER_REVIEW'].includes(c.status)).length,scope:'AUTHORIZED_PORTFOLIOS',sample_note:'Contagem da página; não representa taxa organizacional.'},page:{limit,offset},personal_ranking:false,automatic_promotion:false}
 }
}
