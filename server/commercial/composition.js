import {observe} from '../observability.js'
import {behavioralProfileVersion,commercialCompositionVersion,decisionThesisVersion,valuePlanVersion} from './contracts.js'
import {buildBehavioralProfile} from './behavioral-profile.js'
import {buildDecisionThesis} from './decision-thesis.js'
import {buildValuePlan} from './value-plan.js'

export function buildCommercialComposition(input={}){
 const started=Date.now()
 const context=input.context||{}
 const snapshot=input.contextSnapshot||context.contextSnapshot
 const organizationId=String(input.organizationId||snapshot?.organization_id||'')
 const behavioralProfile=buildBehavioralProfile(context,{organizationId,contextSnapshot:snapshot,currentMessage:input.message,now:input.now})
 const decisionThesis=buildDecisionThesis({organizationId,contextSnapshot:snapshot,behavioralProfile,context,advice:input.advice,conversion:input.conversion,decisionIntelligence:context.decisionIntelligence,objective:snapshot?.objective,subjectId:snapshot?.subject?.id,message:input.message})
 const valuePlan=buildValuePlan({organizationId,contextSnapshot:snapshot,behavioralProfile,decisionThesis,context,advice:input.advice,currentMessage:input.message,subjectId:snapshot?.subject?.id,analogy:input.analogy,analogyImprovesUnderstanding:input.analogyImprovesUnderstanding})
 const durationMs=Math.max(0,Date.now()-started)
 observe('commercial.modules.completed',{
  contextSnapshotId:snapshot?.context_snapshot_id,
  behaviorProfileVersion:behavioralProfileVersion,
  decisionThesisVersion,
  valuePlanVersion,
  modulesCalled:'MIC,MDI,MVV',
  scenarioFixture:input.scenarioFixture,
  confidence:decisionThesis.confidence,
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
  audit:{behavior_profile_version:behavioralProfileVersion,decision_thesis_version:decisionThesisVersion,value_plan_version:valuePlanVersion,scenario_fixture:input.scenarioFixture||null,latency_ms:durationMs}
 }
}

export function attachCommercialComposition(advice={},input={}){
 const commercial=buildCommercialComposition({...input,advice})
 return {...advice,behavioral_profile:commercial.behavioral_profile,decision_thesis:commercial.decision_thesis,value_plan:commercial.value_plan,commercial_modules:{version:commercial.version,modules_called:commercial.modules_called,context_snapshot_id:commercial.context_snapshot_id,audit:commercial.audit}}
}
