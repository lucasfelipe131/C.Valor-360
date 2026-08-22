export const behavioralProfileVersion='val.behavioral_profile.v1'
export const questionnaireDefinitionVersion='val.questionnaire_definition.v1'
export const decisionThesisVersion='val.decision_thesis.v1'
export const valuePlanVersion='val.value_plan.v1'
export const commercialScenarioFixtureVersion='val.commercial_scenario_fixture.v1'
export const commercialCompositionVersion='val.commercial_composition.v1'

export const behavioralDimensions=Object.freeze(['analytical','relational','innovative','conservative'])
export const commercialStages=Object.freeze(['EXPLORE','DIAGNOSE','BUILD_VALUE','PROPOSE','NEGOTIATE','COMMIT'])
export const scenarioStates=Object.freeze(['NOT_MAPPED','MAPPED','TESTED','VALIDATED'])

const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=value=>String(value??'').trim()
const finite=value=>Number.isFinite(Number(value))
const list=value=>Array.isArray(value)?value:[]

export function validateBehavioralProfile(value){
 const violations=[]
 if(!object(value))return ['behavioral_profile']
 if(value.contract_version!==behavioralProfileVersion)violations.push('contract_version')
 if(!text(value.subject_id))violations.push('subject_id')
 if(!text(value.organization_id))violations.push('organization_id')
 if(!object(value.profile_weights))violations.push('profile_weights')
 for(const key of behavioralDimensions)if(!finite(value.profile_weights?.[key])||Number(value.profile_weights[key])<0||Number(value.profile_weights[key])>1)violations.push(`profile_weights.${key}`)
 const total=behavioralDimensions.reduce((sum,key)=>sum+Number(value.profile_weights?.[key]||0),0)
 if(Math.abs(total-1)>0.001)violations.push('profile_weights.total')
 for(const key of ['signals','evidence_refs','missing_information'])if(!Array.isArray(value[key]))violations.push(key)
 if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
 if(!text(value.updated_at)||!text(value.version))violations.push('versioning')
 if(!object(value.approach_guidance))violations.push('approach_guidance')
 return [...new Set(violations)]
}

export function validateQuestionnaireDefinition(value){
 const violations=[]
 if(!object(value))return ['questionnaire_definition']
 if(value.contract_version!==questionnaireDefinitionVersion)violations.push('contract_version')
 if(!text(value.questionnaire_id)||!text(value.version))violations.push('identity')
 if(!Array.isArray(value.questions)||value.questions.length!==45)violations.push('questions')
 const ids=new Set()
 for(const question of list(value.questions)){
  if(!Number.isInteger(question.question_id)||ids.has(question.question_id))violations.push('question_id')
  ids.add(question.question_id)
  if(!text(question.version)||!text(question.dimension)||typeof question.required!=='boolean'||typeof question.active!=='boolean')violations.push(`question:${question.question_id}`)
 }
 if(value.core_question_count!==27||value.required_question_count!==26||value.complementary_question_count!==18)violations.push('counts')
 return [...new Set(violations)]
}

export function validateDecisionThesis(value){
 const violations=[]
 if(!object(value))return ['decision_thesis']
 if(value.contract_version!==decisionThesisVersion)violations.push('contract_version')
 for(const key of ['organization_id','subject_id','decision','objective','recommended_action','next_action'])if(!text(value[key]))violations.push(key)
 for(const key of ['rationale','evidence_refs','risks','alternatives','tradeoffs','assumptions','missing_information','what_would_change_my_mind'])if(!Array.isArray(value[key]))violations.push(key)
 if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
 if(!text(value.version)||!text(value.context_snapshot_id))violations.push('traceability')
 return [...new Set(violations)]
}

export function validateValuePlan(value){
 const violations=[]
 if(!object(value))return ['value_plan']
 if(value.contract_version!==valuePlanVersion)violations.push('contract_version')
 if(!commercialStages.includes(value.commercial_stage))violations.push('commercial_stage')
 if(!Array.isArray(value.questions)||value.questions.length>3)violations.push('questions')
 for(const key of ['implications','proof_strategy','expected_objections','objection_guidance','cross_sell_candidates'])if(!Array.isArray(value[key]))violations.push(key)
 for(const key of ['organization_id','subject_id','problem_statement','value_thesis','commitment_target','follow_up','version','context_snapshot_id'])if(!text(value[key]))violations.push(key)
 if(value.analogy_optional!=null&&!object(value.analogy_optional))violations.push('analogy_optional')
 return [...new Set(violations)]
}

export function assertContract(value,validator,name='Contrato'){
 const violations=validator(value)
 if(violations.length)throw Object.assign(new Error(`${name} inválido.`),{name:'CommercialContractError',code:'commercial_contract_invalid',violations})
 return value
}
