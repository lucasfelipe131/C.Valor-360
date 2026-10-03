import {createHash} from 'node:crypto'
export const LEARNING_VERSION='val.organizational-learning.v1'
export const LEARNING_FLAGS=['organizational_learning_v1','learning_center_v1','shadow_ranker_v1','knowledge_promotion_v1','drift_monitor_v1']
export const LEARNING_POLICIES=Object.fromEntries(['learning_candidate','dataset_eligibility','promotion','knowledge_generalization','sample_sufficiency','shadow_ranker','drift','rollback'].map(id=>[`${id}_policy`,{version:`val.${id}_policy.v1`,automatic_promotion:false,production_enabled:false}]))
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x
export const fingerprint=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex')
export const fail=(code,statusCode=422)=>{throw Object.assign(new Error(code),{code,statusCode})}
export const FEATURES=['COMMERCIAL_VALUE','URGENCY','RELATIONSHIP','AGRONOMIC_SIGNAL','TIMING','RISK','data_quality','confidence','missing_count','contradiction_count','evidence_count']
export function numericFeatures(value={}){return Object.fromEntries(FEATURES.filter(k=>typeof value[k]==='number'&&Number.isFinite(value[k])).map(k=>[k,value[k]]))}
export function sampleSufficiency(n,policy){
 if(!policy||policy.status!=='APPROVED'||!policy.review?.reviewer||!policy.version)return 'INSUFFICIENT_FOR_PROMOTION'
 const t=policy.thresholds
 if(!t||![t.limited,t.sufficient,t.strong].every(Number.isInteger)||t.limited<2||t.sufficient<t.limited||t.strong<t.sufficient)return 'INSUFFICIENT_FOR_PROMOTION'
 return n<t.limited?'INSUFFICIENT':n<t.sufficient?'LIMITED':n<t.strong?'SUFFICIENT':'STRONG'
}
export function rate(numerator,denominator,{period,scope,sample_size=denominator}={}){return {numerator,denominator,value:denominator?numerator/denominator:null,period,scope,sample_size,engine_version:LEARNING_VERSION}}
export function recommendationSnapshot({timestamp,engine_version,prompt_version,policy_version,model_version,features={},evidence_refs=[],selected_candidate=null,alternatives=[],dimensions={}}){
 if(!Number.isFinite(Date.parse(timestamp)))fail('snapshot_timestamp_required')
 const clean=item=>({id:item.id,known_at:item.known_at,features:numericFeatures(item.features),current_score:typeof item.current_score==='number'?item.current_score:null})
 const candidates=alternatives.map(clean)
 if(candidates.some(c=>!c.id||!Number.isFinite(Date.parse(c.known_at))||Date.parse(c.known_at)>Date.parse(timestamp)))fail('snapshot_future_leakage')
 return {contract_version:'val.recommendation_snapshot.v1',context_timestamp:timestamp,engine_version:engine_version||'UNKNOWN',prompt_version:prompt_version||'UNKNOWN',policy_version:policy_version||'UNKNOWN',model_version:model_version||'UNKNOWN',score_components:numericFeatures(features),data_quality:features.data_quality??null,confidence:features.confidence??null,evidence_refs:evidence_refs.map(r=>({id:r.id||r,type:r.type||'SOURCE',known_at:r.known_at||timestamp,source:r.source||r.type||'SOURCE',external_id:r.external_id||null,canonical_identity:r.canonical_identity||r.id||r,observed_at:r.observed_at||r.known_at||timestamp,ingested_at:r.ingested_at||r.known_at||timestamp,version:r.version||'UNKNOWN'})),selected_candidate,alternatives:candidates,dimensions:Object.fromEntries(['crop','region','recommendation_type','fallback','score_band'].filter(k=>typeof dimensions[k]==='string'&&dimensions[k].length<=80).map(k=>[k,dimensions[k]]))}
}
export const candidateTransitions={CANDIDATE:['UNDER_REVIEW','REJECTED','EXPIRED'],UNDER_REVIEW:['APPROVED','REJECTED','EXPIRED'],APPROVED:['UNDER_REVIEW','EXPIRED'],REJECTED:[],EXPIRED:[]}
export const promotionTransitions={DRAFT:['UNDER_REVIEW','REJECTED'],UNDER_REVIEW:['APPROVED','REJECTED'],APPROVED:['PUBLISHED','REJECTED'],PUBLISHED:['SUPERSEDED','ROLLED_BACK'],REJECTED:[],SUPERSEDED:['ROLLED_BACK'],ROLLED_BACK:[]}
export function reviewRecord(actor,input,{technical=false}={}){
 if(technical?actor.role!=='technical_reviewer':actor.role!=='admin')fail('learning_review_role_denied',403)
 if(!String(input.reason||'').trim()||!Array.isArray(input.evidence_reviewed)||!input.evidence_reviewed.length||!Array.isArray(input.contrary_evidence_reviewed))fail('learning_review_evidence_required')
 return {reviewer:actor.id,role:actor.role,reviewed_at:new Date().toISOString(),decision:input.status,reason:String(input.reason).slice(0,2000),evidence_reviewed:input.evidence_reviewed,contrary_evidence_reviewed:input.contrary_evidence_reviewed}
}
// Captured from the already-built deterministic context, never from a later CRM read.
export function snapshotFromRecommendation(record,context,advice,sourceIds){
 const foundation=context.conversionFoundation||context.conversionIntelligence||context.conversion||{}
 const timestamp=context.contextSnapshot?.freshness?.generated_at||foundation.generatedAt||new Date().toISOString()
 const mapFeatures=components=>({COMMERCIAL_VALUE:components?.economic,URGENCY:components?.urgency,RELATIONSHIP:components?.momentum,AGRONOMIC_SIGNAL:components?.evidence,TIMING:components?.readiness,data_quality:components?.dataQuality})
 const alternatives=(foundation.rankedOpportunities||[]).map(c=>({id:c.id,known_at:timestamp,features:mapFeatures(c.components),current_score:c.score}))
 return recommendationSnapshot({timestamp,engine_version:foundation.version||'val.reasoning.v1',prompt_version:record.promptHash,policy_version:context.contextSnapshot?.selection?.policy_version,model_version:record.model,features:{...mapFeatures(foundation.selectedOpportunity?.components),confidence:advice?.confidence?.score,evidence_count:sourceIds.length},evidence_refs:sourceIds.map(id=>{const ref=(context.contextSnapshot?.evidence_refs||[]).find(r=>r.id===id);return ref?{...ref,id,known_at:ref.ingested_at||timestamp}:id}),selected_candidate:foundation.selectedOpportunity?.id||null,alternatives,dimensions:{crop:context.client?.commercial?.crop,region:context.client?.municipality,recommendation_type:record.mode,score_band:foundation.selectedOpportunity?.priority}})
}
