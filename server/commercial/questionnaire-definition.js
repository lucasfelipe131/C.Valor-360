import questions from '../../src/data/questions.json' with {type:'json'}
import {assertContract,questionnaireDefinitionVersion,validateQuestionnaireDefinition} from './contracts.js'

const dimension=id=>{
 if(id<=5)return 'PRODUCER_CONTEXT'
 if(id===6)return 'DECISION_GOVERNANCE'
 if(id<=18)return 'BEHAVIOR_AND_INTERACTION'
 if(id<=24)return 'RELATIONSHIP_METRICS'
 if(id<=26)return 'SERVICE_VALUE'
 if(id===27)return 'COMMERCIAL_NEED'
 if(id<=30)return 'CONTACT_PREFERENCES'
 return 'COMPLEMENTARY_RELATIONSHIP'
}

export const questionnaireDefinition=assertContract({
 contract_version:questionnaireDefinitionVersion,
 questionnaire_id:'producer-360',
 version:'producer-360.v1',
 core_question_count:27,
 required_question_count:26,
 complementary_question_count:18,
 compatibility:{legacy_total:45,required_range:'1-26',optional_core:[27],optional_complementary_range:'28-45'},
 questions:questions.map(question=>({
  question_id:question.id,
  version:'producer-360.v1',
  dimension:dimension(question.id),
  required:question.id<=26,
  active:true,
  core:question.id<=27,
  text:question.text
 }))
},validateQuestionnaireDefinition,'QuestionnaireDefinition v1')

export function unansweredHighValueQuestions(answers={},options={}){
 const answered=id=>String(answers?.[id]??answers?.[String(id)]??'').trim().length>0
 const prioritized=[
  {question_id:7,reason_code:'DECISION_CRITERION_UNKNOWN'},
  {question_id:8,reason_code:'PROOF_PREFERENCE_UNKNOWN'},
  {question_id:6,reason_code:'DECISION_GOVERNANCE_UNKNOWN'},
  {question_id:10,reason_code:'INNOVATION_RISK_UNKNOWN'},
  {question_id:14,reason_code:'TRUST_EVIDENCE_UNKNOWN'},
  {question_id:27,reason_code:'COMMERCIAL_NEED_UNKNOWN'}
 ]
 const excluded=new Set((options.excludeQuestionIds||[]).map(Number))
 const limit=Math.max(1,Math.min(3,Number(options.limit)||3))
 return prioritized.filter(item=>!answered(item.question_id)&&!excluded.has(item.question_id)).slice(0,limit).map(item=>({
  ...item,
  question:questionnaireDefinition.questions.find(question=>question.question_id===item.question_id)?.text||''
 }))
}
