import {observe} from '../observability.js'
import {buildActionPlan} from './action-plan.js'
import {executionCompositionVersion} from './contracts.js'

export function buildExecutionComposition(input={}){
 const started=Date.now()
 const advice=input.advice||{}
 const context=input.context||{}
 const snapshot=input.contextSnapshot||context.contextSnapshot
 const profile=input.behavioralProfile||advice.behavioral_profile
 const thesis=input.decisionThesis||advice.decision_thesis
 const valuePlan=input.valuePlan||advice.value_plan
 const actionPlan=buildActionPlan({
  organizationId:input.organizationId||snapshot?.organization_id,
  subjectId:snapshot?.subject?.id,
  contextSnapshot:snapshot,
  decisionThesis:thesis,
  valuePlan,
  actor:input.actor,
  defaultDueAt:input.defaultDueAt,
  candidateActions:input.candidateActions,
  now:input.now
 })
 const durationMs=Math.max(0,Date.now()-started)
 observe('execution.modules.completed',{
  contextSnapshotId:snapshot?.context_snapshot_id,
  behaviorProfileVersion:profile?.version,
  decisionThesisId:actionPlan.decision_thesis_id,
  decisionThesisVersion:thesis?.version,
  valuePlanId:actionPlan.value_plan_id,
  valuePlanVersion:valuePlan?.version,
  actionPlanId:actionPlan.action_plan_id,
  actionPlanVersion:actionPlan.version,
  modulesCalled:'MEX,VIS',
  confidence:thesis?.confidence,
  durationMs,
  outcome:'ok'
 })
 return {version:executionCompositionVersion,modules_called:['MEX','VIS'],action_plan:actionPlan,audit:{action_plan_id:actionPlan.action_plan_id,action_plan_version:actionPlan.version,latency_ms:durationMs}}
}

export function attachExecutionComposition(advice={},input={}){
 const execution=buildExecutionComposition({...input,advice})
 return {...advice,action_plan:execution.action_plan,execution_modules:{version:execution.version,modules_called:execution.modules_called,audit:execution.audit}}
}
