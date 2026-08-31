import {conversationStateContext} from './conversation-state.js'

const identifier=value=>String(value??'').trim().slice(0,180)
const producerIdentifier=value=>{
 const candidate=identifier(value)
 return ['portfolio','general'].includes(candidate.toLowerCase())?'':candidate
}
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0
const canonicalDomains=new Set(['PROFILE','COMMERCIAL','AGRONOMY','GRAINS','CREDIT','GEO','VISIT','OPPORTUNITY','GENERAL','MULTI_DOMAIN'])
const domain=value=>{const candidate=identifier(value).toUpperCase();return canonicalDomains.has(candidate)?candidate:'GENERAL'}
const own=(value,key)=>Boolean(value)&&Object.prototype.hasOwnProperty.call(value,key)

export const valResponseScopeVersion='val.response_scope.v1'

const violation=(field,source)=>Object.assign(new Error('A resposta foi bloqueada porque suas dimensões de escopo são contraditórias.'),{
 code:'CONTEXT_SCOPE_VIOLATION',statusCode:500,scopeField:field,scopeSource:source
})
const missingDimension=(field,source)=>Object.assign(violation(field,source),{scopeReason:'MISSING_SCOPE_DIMENSION'})

/**
 * O estado persistido da conversa pode continuar em A enquanto uma consulta
 * pontual é raciocinada para B. Por isso o escopo da resposta é derivado
 * exclusivamente do estado usado no raciocínio, nunca do estado a persistir.
 */
export function createValResponseScope(reasoningState={}){
 const state=conversationStateContext(reasoningState)
 if(!exactEpoch(state.context_epoch))throw violation('contextEpoch','reasoning_state.context_epoch')
 return Object.freeze({
  contractVersion:valResponseScopeVersion,
  tenantId:identifier(state.tenant_id)||null,
  ownerId:identifier(state.owner_id)||null,
  producerId:identifier(state.current_client?.id)||null,
  conversationId:identifier(state.conversation_id)||null,
  contextEpoch:state.context_epoch,
  domain:domain(state.current_domain)
 })
}

function assertDimension(scope,field,raw,{source,normalize=identifier}={}){
 if(raw===undefined)return
 const expected=normalize(scope[field])
 const observed=normalize(raw)
 if(observed!==expected)throw violation(field,source)
}

function assertRawDimension(scope,field,raw,{source,normalize=identifier}={}){
 if(field==='contextEpoch'&&(!exactEpoch(raw)||!exactEpoch(scope[field])))throw violation(field,source)
 if(field==='domain'&&(typeof raw!=='string'||!canonicalDomains.has(raw.trim().toUpperCase())))throw violation(field,source)
 assertDimension(scope,field,raw,{source,normalize})
}

/**
 * Valida declarações de escopo já presentes no payload. O conversationState
 * público é deliberadamente ignorado: ele descreve a thread persistida, não a
 * resposta pontual. Todas as declarações ligadas ao raciocínio devem coincidir.
 */
export function assertValResponseScope(payloadResult={},scope={}){
 const reasoning=payloadResult?.advice?.ai_reasoning
 if(!reasoning)throw missingDimension('reasoning','advice.ai_reasoning')
 const premises=reasoning.premises&&typeof reasoning.premises==='object'?reasoning.premises:{}
 const selected=premises.context_scope&&typeof premises.context_scope==='object'?premises.context_scope:{}
 const session=premises.session_context&&typeof premises.session_context==='object'?premises.session_context:{}
 const interview=reasoning.decision_interview?.session_context&&typeof reasoning.decision_interview.session_context==='object'?reasoning.decision_interview.session_context:{}

 if(reasoning.organization?.id===undefined)throw missingDimension('tenantId','reasoning.organization.id')
 assertDimension(scope,'tenantId',reasoning.organization.id,{source:'reasoning.organization.id'})
 if(reasoning.client?.id===undefined)throw missingDimension('producerId','reasoning.client.id')
 if(!['portfolio','general'].includes(identifier(reasoning.client.id).toLowerCase()))assertDimension(scope,'producerId',reasoning.client.id,{source:'reasoning.client.id',normalize:producerIdentifier})
 if(reasoning.conversation_id===undefined&&reasoning.conversationId===undefined)throw missingDimension('conversationId','reasoning.conversation_id')
 assertDimension(scope,'conversationId',reasoning.conversation_id??reasoning.conversationId,{source:'reasoning.conversation_id'})

 for(const [field,key,normalize] of [
  ['tenantId','tenant_id',identifier],['ownerId','owner_id',identifier],['producerId','producer_id',producerIdentifier],
  ['conversationId','conversation_id',identifier],['contextEpoch','context_epoch',value=>value],['domain','domain',domain]
 ]){
  const source=`reasoning.premises.context_scope.${key}`
  if(!own(selected,key))throw missingDimension(field,source)
  assertRawDimension(scope,field,selected[key],{source,normalize})
 }

 for(const [field,keys,normalize] of [
  ['tenantId',['tenant_id','tenantId'],identifier],['ownerId',['owner_id','ownerId'],identifier],
  ['conversationId',['conversation_id','conversationId'],identifier],['contextEpoch',['context_epoch','contextEpoch'],value=>value],
  ['domain',['current_domain','domain'],domain]
 ]){
  const key=keys.find(candidate=>own(session,candidate))
  if(key)assertRawDimension(scope,field,session[key],{source:`reasoning.premises.session_context.${key}`,normalize})
 }
 if(own(session,'current_client'))assertDimension(scope,'producerId',session.current_client?.id??null,{source:'reasoning.premises.session_context.current_client.id',normalize:producerIdentifier})

 for(const [field,keys,normalize] of [
  ['conversationId',['conversation_id','conversationId'],identifier],['contextEpoch',['context_epoch','contextEpoch'],value=>value]
 ]){
  const key=keys.find(candidate=>own(interview,candidate))
  if(key)assertRawDimension(scope,field,interview[key],{source:`reasoning.decision_interview.session_context.${key}`,normalize})
 }
 return scope
}
