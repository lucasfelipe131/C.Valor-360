import {generalAnswerTopicMatches} from '../knowledge/selection.js'
import {safeGeneralModelAnswer,regulatedBrandClaim,requiresVerifiedGeneralSource} from '../knowledge/general-answer-provider.js'

const violationFields={unsupported_claims:'UNSUPPORTED_CLAIM',scope_violations:'SCOPE_VIOLATION',incompatible_evidence:'INCOMPATIBLE_EVIDENCE',provenance_violations:'PROVENANCE_VIOLATION',temporal_violations:'TEMPORAL_VIOLATION'}
export const generalGroundingHasNoViolations=grounding=>Object.keys(violationFields).every(key=>Array.isArray(grounding?.[key])&&grounding[key].length===0)
export function applyGeneralTopicGrounding({grounding,question,summary,clientId='',sources=[],tool={},trusted=false}={}){
 const violations=Object.entries(violationFields).filter(([key])=>!Array.isArray(grounding?.[key])||grounding[key].length).map(([,reason])=>reason)
 const eligible=trusted&&!clientId&&tool.capability==='AI_GENERAL_KNOWLEDGE'&&tool.status==='EXECUTED'&&tool.context?.private_memory_used===false&&!tool.context?.client_id&&sources.length===1&&sources[0].capability==='AI_GENERAL_KNOWLEDGE'&&sources[0].source_type==='model_general_knowledge'&&sources[0].scope==='GENERAL_KNOWLEDGE'&&!sources[0].producer_id&&sources[0].id==='system:ai-general-knowledge:v1'
 const approved=eligible&&grounding?.passed===false&&grounding.question_relevance==='FAIL'&&grounding.question_relevance_reason==='LEXICAL_OVERLAP'&&grounding.claim_ledger?.length>0&&generalGroundingHasNoViolations(grounding)&&generalAnswerTopicMatches(question,summary)&&safeGeneralModelAnswer(summary)&&!regulatedBrandClaim(summary)&&!requiresVerifiedGeneralSource(question)&&!requiresVerifiedGeneralSource(summary)
 return {...grounding,...(approved?{passed:true,question_relevance:'GENERAL_TOPIC_VALIDATED'}:{}),grounding_override:approved?'GENERAL_TOPIC_VALIDATED':'NONE',grounding_block_reason:approved||grounding?.passed?'NONE':violations.join(',')||grounding?.question_relevance_reason||'QUESTION_RELEVANCE'}
}
