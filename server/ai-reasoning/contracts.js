export const aiReasoningResultVersion='val.ai_reasoning_result.v1'
export const valResponseQualityVersion='val.response_quality.v2'
export const goldenQuestionQualityVersion='val.golden_question_quality.v2'

const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=value=>String(value??'').trim()
const finite=value=>Number.isFinite(Number(value))

export function validateAIReasoningResult(value){
 const violations=[]
 if(!object(value))return ['ai_reasoning_result']
 if(value.contract_version!==aiReasoningResultVersion)violations.push('contract_version')
 for(const key of ['reasoning_id','objective','situation_summary','created_at','model','prompt_version'])if(!text(value[key]))violations.push(key)
 for(const key of ['organization','client','context_snapshot','decision_thesis','recommended_strategy','agronomic_context','commercial_context','confidence','run'])if(!object(value[key]))violations.push(key)
 for(const key of ['key_signals','facts_used','hypotheses','missing_information','golden_questions','evidence_to_use','risks','knowledge_refs','memory_refs'])if(!Array.isArray(value[key]))violations.push(key)
 if(Array.isArray(value.golden_questions)&&value.golden_questions.length>3)violations.push('golden_questions.length')
 for(const key of ['CURRENT_SITUATION','WHAT_MATTERS','KEY_UNCERTAINTY','THESIS','WHY','WHAT_TO_VALIDATE','WHAT_WOULD_CHANGE_MY_VIEW'])if(!text(value.decision_thesis?.[key]))violations.push(`decision_thesis.${key}`)
 if(!finite(value.confidence?.score)||Number(value.confidence.score)<0||Number(value.confidence.score)>1)violations.push('confidence.score')
 return [...new Set(violations)]
}

export function assertAIReasoningResult(value){
 const violations=validateAIReasoningResult(value)
 if(violations.length)throw Object.assign(new Error('AIReasoningResult v1 inválido.'),{name:'AIReasoningContractError',code:'ai_reasoning_contract_invalid',violations})
 return value
}
