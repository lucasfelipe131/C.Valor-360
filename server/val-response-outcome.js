// Structured diagnostics contain enums/counts only; never discarded model text,
// prompts, private client IDs or provider exception messages.
const enumValue=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,80}$/.test(value)?value:'UNKNOWN'
export function classifyValResponse(payload={},httpStatus=200){
 const meta=payload.responseMetadata||{},reasoning=payload.advice?.ai_reasoning||{},run=reasoning.run||{}
 const tool=run.tool_result||{},general=meta.generalKnowledge||{},language=payload.advice?.language_enhancement||{}
 const rejected=meta.aiGeneralKnowledgeRejectionReasons||[]
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
 return {version:'val.response_outcome.v1',response_class,reason_code,
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
 observe('val.answer.diagnostic',{responseClass:diagnostic.response_class,reasonCode:diagnostic.reason_code,
  reasoningPath:diagnostic.route_path,intent:diagnostic.intent,capabilityStatus:diagnostic.tool_status,
  runStatus:diagnostic.run_status,engineMode:diagnostic.engine_mode,fallbackFlag:diagnostic.fallback_flag,
  groundingStatus:diagnostic.grounding_status,aiGeneralKnowledgeStatus:diagnostic.general_knowledge_status,
  aiUnavailableReason:diagnostic.ai_unavailable_reason,languageEnhancementStatus:diagnostic.language_enhancement_status,
  languageFailureCode:diagnostic.language_failure_code,reasonCodes:[...diagnostic.rejection_codes,...diagnostic.grounding_reason_codes].join(','),
  coverage:diagnostic.coverage,capabilitiesPlanned:diagnostic.capabilities_planned.join(','),capabilitiesUsed:diagnostic.capabilities_used.join(',')})
 return {...payload,responseMetadata:{...payload.responseMetadata,outcome:diagnostic}}
}
