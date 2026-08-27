import {observe} from '../observability.js'
import {behavioralProfileVersion,commercialCompositionVersion,decisionThesisVersion,valuePlanVersion} from './contracts.js'
import {buildBehavioralProfile} from './behavioral-profile.js'
import {buildDecisionThesis} from './decision-thesis.js'
import {buildValuePlan} from './value-plan.js'
import {selectKnowledge} from '../knowledge/library.js'
import {normalizeKnowledgeRetrieval} from './knowledge-support.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=900)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)

function knowledgeQuery(input,snapshot){
 const semanticContext=[
  input.message,
  snapshot?.objective,
  ...list(snapshot?.facts).slice(0,12).map(item=>item?.value?.statement??item?.value?.description),
  ...list(snapshot?.hypotheses).slice(0,6).map(item=>item?.value?.statement??item?.value?.description),
  ...list(snapshot?.missing_information).slice(0,6).map(item=>item?.description??item?.question),
  ...list(snapshot?.commercial_context?.opportunities).slice(0,4).map(item=>item?.data?.title??item?.data?.category)
 ].map(item=>text(item)).filter(Boolean)
 return semanticContext.join(' | ').slice(0,5000)
}

function retrieveKnowledge(input,snapshot,profile){
 const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
 if(input.knowledgeRetrieval)return normalizeKnowledgeRetrieval(input.knowledgeRetrieval,{now})
 try{
  return normalizeKnowledgeRetrieval(selectKnowledge({
   query:knowledgeQuery(input,snapshot),
   message:text(input.message,3000),
   contextSnapshot:snapshot,
   context:input.context,
   behavioralProfile:profile,
   modules:['MCTX','MDI','MVV','MIA'],
   geography:text(input.geography||input.context?.client?.country||'Brazil',120),
   limit:3,
   now
  }),{now})
 }catch(error){
  observe('knowledge.selection.failed',{contextSnapshotId:snapshot?.context_snapshot_id,errorCode:text(error?.code||'knowledge_selection_failed',120),outcome:'degraded'})
  return normalizeKnowledgeRetrieval({status:'NO_APPLICABLE_KNOWLEDGE',reason_codes:['SELECTION_UNAVAILABLE']})
 }
}

export function buildCommercialComposition(input={}){
 const started=Date.now()
 const context=input.context||{}
 const snapshot=input.contextSnapshot||context.contextSnapshot
 const organizationId=String(input.organizationId||snapshot?.organization_id||'')
 const behavioralProfile=buildBehavioralProfile(context,{organizationId,contextSnapshot:snapshot,currentMessage:input.message,now:input.now})
 const knowledgeRetrieval=retrieveKnowledge(input,snapshot,behavioralProfile)
 const decisionThesis=buildDecisionThesis({organizationId,contextSnapshot:snapshot,behavioralProfile,context,advice:input.advice,conversion:input.conversion,decisionIntelligence:context.decisionIntelligence,objective:snapshot?.objective,subjectId:snapshot?.subject?.id,message:input.message,knowledgeRetrieval,now:input.now})
 const valuePlan=buildValuePlan({organizationId,contextSnapshot:snapshot,behavioralProfile,decisionThesis,context,advice:input.advice,currentMessage:input.message,subjectId:snapshot?.subject?.id,analogy:input.analogy,analogyImprovesUnderstanding:input.analogyImprovesUnderstanding,knowledgeRetrieval,now:input.now})
 const durationMs=Math.max(0,Date.now()-started)
 observe('commercial.modules.completed',{
  contextSnapshotId:snapshot?.context_snapshot_id,
  behaviorProfileVersion:behavioralProfileVersion,
  decisionThesisVersion,
  valuePlanVersion,
  modulesCalled:'MIC,MDI,MVV',
  scenarioFixture:input.scenarioFixture,
  confidence:decisionThesis.confidence,
  knowledgeStatus:knowledgeRetrieval.status,
  knowledgeItems:knowledgeRetrieval.items.length,
  durationMs,
  outcome:'ok'
 })
 return {
  version:commercialCompositionVersion,
  modules_called:['MIC','MDI','MVV'],
  context_snapshot_id:snapshot.context_snapshot_id,
  behavioral_profile:behavioralProfile,
  decision_thesis:decisionThesis,
  value_plan:valuePlan,
  knowledge_retrieval:knowledgeRetrieval,
  audit:{behavior_profile_version:behavioralProfileVersion,decision_thesis_version:decisionThesisVersion,value_plan_version:valuePlanVersion,scenario_fixture:input.scenarioFixture||null,latency_ms:durationMs}
 }
}

export function attachCommercialComposition(advice={},input={}){
 const commercial=buildCommercialComposition({...input,advice})
 return {...advice,behavioral_profile:commercial.behavioral_profile,decision_thesis:commercial.decision_thesis,value_plan:commercial.value_plan,knowledge_retrieval:commercial.knowledge_retrieval,commercial_modules:{version:commercial.version,modules_called:commercial.modules_called,context_snapshot_id:commercial.context_snapshot_id,audit:commercial.audit}}
}
