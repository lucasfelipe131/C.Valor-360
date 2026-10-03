// Versioned rules, shared by the canonical conversion and outcome engines.
export const REVENUE_FLAGS=['revenue_intelligence_v1','commercial_coach_v1','impact_engine_v1','management_revenue_view_v1']
export const REVENUE_POLICIES=Object.freeze(Object.fromEntries(['revenue_calculation_policy','pipeline_health_policy','stalled_value_policy','impact_attribution_policy','coach_signal_policy','outcome_policy'].map(id=>[id,Object.freeze({version:`val.${id}.v1`,stalledDays:30,automaticWeightChange:false,defaultAttribution:'CAUSAL_NOT_PROVEN'})])))
export const LOSS_REASONS=['PRICE','TIMING','COMPETITOR','TECHNICAL','CREDIT','NO_DECISION','RELATIONSHIP','OTHER']
export const revenueNumber=value=>!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value))?null:Number(value)
export const commercialProof=refs=>Array.isArray(refs)&&refs.some(ref=>ref&&['ORDER','INVOICE','COMMERCIAL_EVENT','CONFIRMED_RECORD'].includes(ref.type)&&ref.confirmed===true&&typeof ref.id==='string'&&ref.id.trim())
export function outcomeEvidenceViolations(outcome){
 const errors=[]
 if(outcome.result?.value!=null&&(revenueNumber(outcome.result.value)===null||revenueNumber(outcome.result.value)<0))errors.push('outcome_value_invalid')
 if(outcome.outcome_type==='WON'&&!commercialProof(outcome.evidence_refs))errors.push('won_commercial_evidence_required')
 if(outcome.outcome_type==='LOST'&&!LOSS_REASONS.includes(outcome.result?.loss_reason))errors.push('loss_reason_required')
 if(outcome.outcome_type==='LOST'&&outcome.result?.loss_reason==='NO_DECISION')errors.push('use_no_decision_outcome')
 if(['TECHNICAL_RESULT','RELATIONSHIP_PROGRESS'].includes(outcome.outcome_type)&&!outcome.evidence_refs?.some(ref=>ref?.id))errors.push('outcome_evidence_required')
 return errors
}
export function calculateObservedImpact(input){
 const before=revenueNumber(input.baseline?.value),after=revenueNumber(input.measurement?.value)
 const missing=['producer','action','outcome','metric','measured_at'].filter(key=>!input[key])
 if(before===null||after===null)missing.push('baseline_and_measurement')
 if(!input.baseline?.unit||input.baseline.unit!==input.measurement?.unit)missing.push('compatible_units')
 if(!input.baseline?.measured_at||!input.baseline?.method||!input.measurement?.method||input.baseline.method!==input.measurement.method)missing.push('comparable_method')
 if(!input.source_refs?.length)missing.push('source_refs')
 if(!Number.isFinite(Date.parse(input.measured_at))||!Number.isFinite(Date.parse(input.baseline?.measured_at))||Date.parse(input.measured_at)<Date.parse(input.baseline?.measured_at))missing.push('measurement_dates')
 if(missing.length)throw Object.assign(new Error('Impacto exige baseline, medição comparável e evidência.'),{statusCode:422,code:'impact_insufficient_data',missing})
 return {...input,before,after,delta:after-before,unit:input.baseline.unit,confidence:Math.max(0,Math.min(1,revenueNumber(input.confidence)??0)),attribution_status:'CAUSAL_NOT_PROVEN'}
}
export function calculateEconomicCase(inputs={}){
 const known=key=>inputs[key]?.status==='KNOWN'?revenueNumber(inputs[key].value):null
 const cost=known('cost'),area=known('area_ha'),baseline=known('baseline_cost')
 const results={}
 if(cost!==null&&cost>=0)results.total_cost={value:cost,formula:'cost'}
 if(cost!==null&&cost>=0&&area>0)results.cost_per_hectare={value:cost/area,formula:'cost / area_ha'}
 if(cost!==null&&baseline!==null)results.investment_difference={value:cost-baseline,formula:'cost - baseline_cost'}
 const observed=key=>inputs[key]?.evidence_refs?.length&&inputs[key]?.observed===true?known(key):null
 const revenueBefore=observed('revenue_before'),revenueAfter=observed('revenue_after'),costBefore=observed('cost_before'),costAfter=observed('cost_after')
 if(revenueBefore!==null&&revenueAfter!==null)results.observed_incremental_revenue={value:revenueAfter-revenueBefore,formula:'observed revenue_after - observed revenue_before',attribution_status:'CAUSAL_NOT_PROVEN'}
 if(costBefore!==null&&costAfter!==null)results.proved_saving={value:costBefore-costAfter,formula:'observed cost_before - observed cost_after',attribution_status:'CAUSAL_NOT_PROVEN'}
 const avoided=known('avoided_loss')
 if(avoided!==null&&inputs.avoided_loss?.validated===true&&inputs.avoided_loss?.evidence_refs?.length)results.avoided_loss={value:avoided,formula:'validated avoided_loss',source_refs:inputs.avoided_loss.evidence_refs}
 return {status:Object.keys(results).length?'CALCULATED':'INSUFFICIENT_DATA',inputs,results}
}
export function visitOutcomeLoop(context){
 return (context.visits||[]).map(visit=>{
  const outcomes=(context.outcomes||[]).filter(outcome=>outcome.visit_id===visit.id)
  const complete=outcomes.some(outcome=>(outcome.result?.decision_card_id||outcome.recommendation_id)&&outcome.action_plan_id&&outcome.commitment_id&&outcome.evidence_refs?.length)
  return {visit_id:visit.id,state:complete?'OUTCOME_RECORDED':'OPEN',learning_status:complete?'PROPOSED':null,missing_information:complete?[]:['Confirme decisão, ação, compromisso, resultado e evidência.'],text_report_completes_loop:false}
 })
}
