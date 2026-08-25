import {knowledgeLifecycleStates,knowledgePolicyVersion,list,text} from './policy.js'

export const knowledgeItemVersion='val.knowledge_item.v1'
export const knowledgeSourceVersion='val.knowledge_source.v1'
export const knowledgeSelectionVersion='val.knowledge_selection.v1'

const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const nullableText=value=>value==null||typeof value==='string'
const validDateTime=value=>value==null||(typeof value==='string'&&!Number.isNaN(new Date(value).getTime()))

export function validateKnowledgeItem(value){
 const violations=[]
 if(!object(value))return ['knowledge_item']
 if(value.contract_version!==knowledgeItemVersion)violations.push('contract_version')
 for(const key of ['knowledge_item_id','title','domain','statement','application_val','authority','risk','geographic_scope','status','version'])if(!text(value[key]))violations.push(key)
 for(const key of ['triggers','recommended_actions','avoid','module_targets','source_refs'])if(!Array.isArray(value[key]))violations.push(key)
 if(!['A','B','C','D'].includes(value.authority))violations.push('authority')
 if(!['LOW','HIGH'].includes(value.risk))violations.push('risk')
 if(!knowledgeLifecycleStates.includes(value.status))violations.push('status')
 if(!['DECISION_SUPPORT','GUARDRAIL_ONLY'].includes(value.usage_mode))violations.push('usage_mode')
 if(typeof value.requires_human_review!=='boolean')violations.push('requires_human_review')
 for(const key of ['valid_from','valid_until','review_at','owner','supersedes_id','created_at','updated_at'])if(!nullableText(value[key]))violations.push(key)
 for(const key of ['valid_from','valid_until','review_at','created_at','updated_at'])if(!validDateTime(value[key]))violations.push(`${key}.format`)
 return [...new Set(violations)]
}

export function validateKnowledgeSource(value){
 const violations=[]
 if(!object(value))return ['knowledge_source']
 if(value.contract_version!==knowledgeSourceVersion)violations.push('contract_version')
 for(const key of ['source_id','title','publisher','authority','geography','domain'])if(!text(value[key]))violations.push(key)
 if(!['A','B','C','D'].includes(value.authority))violations.push('authority')
 if(value.year!=null&&(!Number.isInteger(value.year)||value.year<1900))violations.push('year')
 for(const key of ['url','notes'])if(!nullableText(value[key]))violations.push(key)
 return [...new Set(violations)]
}

export function validateKnowledgeSelection(value){
 const violations=[]
 if(!object(value))return ['knowledge_selection']
 if(value.contract_version!==knowledgeSelectionVersion)violations.push('contract_version')
 if(value.policy_version!==knowledgePolicyVersion)violations.push('policy_version')
 if(!['SELECTED','NO_APPLICABLE_KNOWLEDGE'].includes(value.status))violations.push('status')
 if(!Array.isArray(value.selected)||value.selected.length>3)violations.push('selected')
 if(!Array.isArray(value.items)||value.items.length>3)violations.push('items')
 if(Array.isArray(value.items)&&Array.isArray(value.selected)&&JSON.stringify(value.items)!==JSON.stringify(value.selected))violations.push('items_selected_mismatch')
 if(value.status==='SELECTED'&&!value.selected?.length)violations.push('selected.empty')
 if(value.status==='NO_APPLICABLE_KNOWLEDGE'&&value.selected?.length)violations.push('selected.unexpected')
 if(!text(value.reason_code))violations.push('reason_code')
 if(!object(value.audit))violations.push('audit')
 return [...new Set(violations)]
}

export function assertKnowledgeContract(value,validator,name='Contrato de conhecimento'){
 const violations=list(validator(value))
 if(violations.length)throw Object.assign(new Error(`${name} inválido.`),{name:'KnowledgeContractError',code:'knowledge_contract_invalid',violations})
 return value
}
