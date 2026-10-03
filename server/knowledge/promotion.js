import {validateKnowledgeItem} from './contracts.js'
import {loadKnowledgeLibrary} from './library.js'
import {containsPromptInjection,authorityRank} from './policy.js'
import {fail} from '../learning/policy.js'
// Explicit publication adapter for the same Knowledge Library contract. Runtime
// catalogue remains unchanged until a separately authorized release integrates it.
export function validatePromotedKnowledge(item,{scope,technicalReview,now=Date.now()}={}){
 const violations=validateKnowledgeItem(item)
 if(violations.length)fail('knowledge_contract_invalid:'+violations.join(','))
 if(containsPromptInjection([item.statement,item.title,item.recommended_actions]))fail('knowledge_prompt_injection')
 if(item.status!=='APPROVED'||!item.source_refs.length||!item.provenance?.candidate_id)fail('knowledge_approval_provenance_required')
 if(!item.valid_until||!item.valid_from||!item.review_at||Date.parse(item.valid_until)<=now||Date.parse(item.review_at)<=now||Date.parse(item.valid_from)>now||Date.parse(item.review_at)>Date.parse(item.valid_until))fail('knowledge_expiry_required')
 if(item.geographic_scope!==scope.geography_scope||JSON.stringify(item.crop_scope||[])!==JSON.stringify(scope.crop_scope||[])||JSON.stringify(item.season_scope||[])!==JSON.stringify(scope.season_scope||[]))fail('knowledge_scope_expansion_denied')
 const library=loadKnowledgeLibrary(),sources=library.sources||[]
 const sourceMap=new Map((Array.isArray(sources)?sources:Object.values(sources)).map(s=>[s.source_id,s]))
 if(item.source_refs.some(ref=>!sourceMap.has(ref)))fail('knowledge_source_not_registered')
 if(item.source_refs.every(ref=>authorityRank[sourceMap.get(ref).authority]>authorityRank[item.authority]))fail('knowledge_authority_exceeds_source')
 if(item.risk==='HIGH'&&(!technicalReview||technicalReview.role!=='technical_reviewer'||!item.source_refs.some(ref=>['A','B'].includes(sourceMap.get(ref)?.authority))))fail('knowledge_technical_review_required')
 return {...item,requires_human_review:item.risk==='HIGH',usage_mode:item.risk==='HIGH'?'GUARDRAIL_ONLY':'DECISION_SUPPORT'}
}
export function publishedKnowledgeView(publications,now=Date.now()){
 return publications.filter(p=>p.kind==='KNOWLEDGE').map(p=>({...p.payload.knowledge_item,status:p.status==='ROLLED_BACK'||p.status==='SUPERSEDED'?'SUPERSEDED':Date.parse(p.valid_until)<=now?'EXPIRED':Date.parse(p.review_at)<=now?'UNDER_REVIEW':'APPROVED',publication_id:p.id,runtime_activation:'RELEASE_REQUIRED'}))
}
