// Structured diagnostics contain enums/counts only; never discarded model text,
// prompts, private client IDs or provider exception messages.
const enumValue=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,80}$/.test(value)?value:'UNKNOWN'
export function classifyValResponse(payload={},httpStatus=200){
 const meta=payload.responseMetadata||{},reasoning=payload.advice?.ai_reasoning||{},run=reasoning.run||{}
 const tool=run.tool_result||{},general=meta.generalKnowledge||{},language=payload.advice?.language_enhancement||{}
 const rejected=meta.aiGeneralKnowledgeRejectionReasons||[]
 const trace=meta.decisionTrace||{}
 const decisionReasons={ROUTE_REASON:trace.ROUTE_REASON||'NOT_RECORDED',RETRIEVAL_REASON:trace.RETRIEVAL_REASON||'NOT_RECORDED',SELECTION_REASON:trace.SELECTION_REASON||'NOT_RECORDED',SELECTION_REJECTION_REASON:trace.SELECTION_REJECTION_REASON||'NOT_RECORDED',GROUNDING_REASON:trace.GROUNDING_REASON||(reasoning.grounding?.blocked?'OUTPUT_GROUNDING_BLOCKED':reasoning.grounding?.passed?'OUTPUT_GROUNDING_PASSED':'NOT_RECORDED'),LANGUAGE_REJECTION_REASON:language.languageRejectionReason||trace.LANGUAGE_REJECTION_REASON||'NOT_USED',PROVIDER_REASON:language.providerReason||trace.PROVIDER_REASON||'NOT_RECORDED',FALLBACK_ORIGIN:trace.FALLBACK_ORIGIN||(run.fallback?'UNATTRIBUTED_FALLBACK':'NONE')}
 let response_class='SUCCESS',reason_code='ANSWER_DELIVERED'
 const set=(kind,reason)=>{response_class=kind;reason_code=reason}
 if(httpStatus===429)set('RATE_LIMIT',payload.reason_code==='APPLICATION_RATE_LIMIT'?'APPLICATION_RATE_LIMIT':'UNEXPECTED_RATE_LIMIT')
 else if(meta.aiGeneralKnowledgeUnavailableReason==='PROVIDER_ERROR')set('PROVIDER_FAILURE',meta.aiProviderStatus===429?'PROVIDER_RATE_LIMIT':'PROVIDER_ERROR')
 else if(reasoning.grounding?.blocked===true)set('GROUNDING_BLOCKED','GROUNDING_BLOCKED')
 else if(tool.status==='SOURCE_UNAVAILABLE')set('SOURCE_UNAVAILABLE','CAPABILITY_SOURCE_UNAVAILABLE')
 else if(general.aiUnavailableReason==='BUDGET_EXHAUSTED')set('GENERIC_FALLBACK','AI_BUDGET_EXHAUSTED')
 else if(general.contextRequired||tool.status==='CONTEXT_REQUIRED')set('SPECIFIC_CLARIFICATION','MISSING_CONTEXT')
 else if(general.topicClarification||tool.status==='INPUT_REQUIRED'&&tool.required_inputs?.length)set('SPECIFIC_CLARIFICATION','MATERIAL_INPUT_REQUIRED')
 else if(tool.mode==='no_coverage'){
  if(rejected.includes('GROUNDING_BLOCKED'))set('GROUNDING_BLOCKED','GENERATED_ANSWER_GROUNDING_BLOCKED')
  else if(rejected.length)set('GENERIC_FALLBACK','GENERATED_ANSWER_REJECTED')
  else if(meta.aiGeneralKnowledgeUnavailableReason)set('GENERIC_FALLBACK',enumValue(meta.aiGeneralKnowledgeUnavailableReason))
  else set('GENERIC_FALLBACK',general.libraryOnly?'RETRIEVAL_NO_DATA':'ROUTING_NO_COVERAGE')
 }else if(tool.status==='NO_DATA')set('SOURCE_UNAVAILABLE','RETRIEVAL_NO_DATA')
 else if(run.fallback===true)set('GENERIC_FALLBACK','DETERMINISTIC_FALLBACK')
 else if(httpStatus>=400)set('REQUEST_FAILURE','REQUEST_REJECTED')
 else if(!payload.advice?.answer)set('UNCLASSIFIED','RESPONSE_CONTRACT_UNRECOGNIZED')
 return {version:'val.response_outcome.v1',response_class,reason_code,decision_reasons:decisionReasons,
  route_path:enumValue(payload.route||run.path),intent:enumValue(reasoning.intent),
  tool_status:enumValue(tool.status||'NOT_APPLICABLE'),run_status:enumValue(run.status),
  engine_mode:enumValue(payload.engineMode),fallback_flag:run.fallback===true||['GENERIC_FALLBACK','PROVIDER_FAILURE','GROUNDING_BLOCKED'].includes(response_class),
  grounding_status:reasoning.grounding?.blocked?'BLOCKED':reasoning.grounding?.passed?'PASS':'NOT_RECORDED',
  general_knowledge_status:run.capabilities_used?.includes('AI_GENERAL_KNOWLEDGE')?'DELIVERED':meta.aiGeneralKnowledgeModelCalls>0?'ATTEMPTED_NOT_DELIVERED':'NOT_USED',
  ai_unavailable_reason:enumValue(meta.aiGeneralKnowledgeUnavailableReason||general.aiUnavailableReason||'NONE'),
  language_enhancement_status:enumValue(language.status||'NOT_USED'),language_failure_code:enumValue(language.failureCode||'NONE'),
  grounding_reason_codes:(meta.aiGeneralKnowledgeGroundingReasons||[]).map(enumValue),rejection_codes:rejected.map(enumValue),coverage:enumValue(general.coverage||'NOT_RECORDED'),
  capabilities_planned:(run.capabilities_planned||[]).map(enumValue),capabilities_used:(run.capabilities_used||[]).map(enumValue)}
}
export function attachValResponseOutcome(payload,status,observe){
 const diagnostic=classifyValResponse(payload,status)
 const trace=payload.responseMetadata?.decisionTrace||{},reasons=diagnostic.decision_reasons
 observe('val.decision.trace',{topicRequestedAnchors:(trace.TOPIC_REQUESTED_ANCHORS||[]).join(','),topicMatchedAnchors:(trace.TOPIC_MATCHED_ANCHORS||[]).join(','),topicMissingAnchors:(trace.TOPIC_MISSING_ANCHORS||[]).join(','),topicConceptConflict:trace.TOPIC_CONCEPT_CONFLICT,groundingOverride:trace.GROUNDING_OVERRIDE||'NONE',groundingBlockReason:trace.GROUNDING_BLOCK_REASON||'NONE',routeReason:reasons.ROUTE_REASON,retrievalReason:reasons.RETRIEVAL_REASON,selectionReason:reasons.SELECTION_REASON,selectionRejectionReason:reasons.SELECTION_REJECTION_REASON,groundingReason:reasons.GROUNDING_REASON,languageRejectionReason:reasons.LANGUAGE_REJECTION_REASON,providerReason:reasons.PROVIDER_REASON,fallbackOrigin:reasons.FALLBACK_ORIGIN,candidateCount:trace.candidate_count,selectedCount:trace.selected_count,groundingDecision:trace.grounding_decision,languageValidationDecision:trace.language_validation_decision,generalValidationDecision:trace.general_validation_decision,generalValidationReason:trace.GENERAL_VALIDATION_REASON,selectionGroundingDecision:trace.selection_grounding_decision})
 // Only public governed knowledge IDs, never query terms or producer identifiers.
 for(const [mode,ids] of [['selected',trace.selected_ids],['rejected',trace.rejected_ids]])for(const id of ids||[]){
  const reason=mode==='selected'?'RANK_SELECTED':trace.delivery_rejected_ids?.includes(id)?trace.SELECTION_REJECTION_REASON:trace.rank_rejection_reason||'NOT_RECORDED'
  observe('val.selection.item',{mode,source:/^KI-[0-9]{1,6}$/.test(id)?id:'REDACTED_KNOWLEDGE_ID',selectionRejectionReason:reason})
 }
 for(const [reason,count] of Object.entries(trace.eligibility_rejection_counts||{}))observe('val.selection.eligibility',{selectionRejectionReason:reason,rowCount:count})
 observe('val.answer.diagnostic',{responseClass:diagnostic.response_class,reasonCode:diagnostic.reason_code,
  reasoningPath:diagnostic.route_path,intent:diagnostic.intent,capabilityStatus:diagnostic.tool_status,
  runStatus:diagnostic.run_status,engineMode:diagnostic.engine_mode,fallbackFlag:diagnostic.fallback_flag,
  groundingStatus:diagnostic.grounding_status,aiGeneralKnowledgeStatus:diagnostic.general_knowledge_status,
  aiUnavailableReason:diagnostic.ai_unavailable_reason,languageEnhancementStatus:diagnostic.language_enhancement_status,
  languageFailureCode:diagnostic.language_failure_code,reasonCodes:[...diagnostic.rejection_codes,...diagnostic.grounding_reason_codes].join(','),
  coverage:diagnostic.coverage,capabilitiesPlanned:diagnostic.capabilities_planned.join(','),capabilitiesUsed:diagnostic.capabilities_used.join(',')})
 return {...payload,responseMetadata:{...payload.responseMetadata,outcome:diagnostic}}
}
