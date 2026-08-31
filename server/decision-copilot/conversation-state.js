import {classifyValContextDomain,conversationReferenceKind} from './context-selector.js'

export const conversationStateVersion='val.conversation_state.v1'

export const conversationStateLimits=Object.freeze({
 turns:20,
 entities:16,
 clients:6,
 toolResults:12,
 questions:12,
 facts:16,
 hypotheses:12
})

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=600)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const identifier=(value,max=180)=>clean(value,max).replace(/[^a-zA-Z0-9._:@/-]/g,'')
const own=(value,key)=>Boolean(value&&typeof value==='object')&&Object.prototype.hasOwnProperty.call(value,key)
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0
const invalidEpoch=source=>Object.assign(new Error('contextEpoch deve ser um inteiro seguro não negativo quando informado.'),{code:'conversation_state_epoch_invalid',epochSource:source})
const epochAliases=(value={},source='state')=>{
 const hasSnake=own(value,'context_epoch'),hasCamel=own(value,'contextEpoch')
 if(!hasSnake&&!hasCamel)return {provided:false,value:0}
 const snake=value?.context_epoch,camel=value?.contextEpoch
 if(hasSnake&&!exactEpoch(snake)||hasCamel&&!exactEpoch(camel)||hasSnake&&hasCamel&&snake!==camel)throw invalidEpoch(source)
 return {provided:true,value:hasSnake?snake:camel}
}
const scopeEpoch=scope=>{
 if(!own(scope,'contextEpoch'))return {provided:false,value:0}
 if(!exactEpoch(scope.contextEpoch))throw invalidEpoch('scope.contextEpoch')
 return {provided:true,value:scope.contextEpoch}
}
const iso=(value,fallback=new Date())=>{const date=new Date(value||fallback);return Number.isNaN(date.getTime())?fallback.toISOString():date.toISOString()}
const uniqueBy=(items,keyOf,limit)=>{
 const seen=new Set();const output=[]
 for(const item of items){const key=keyOf(item);if(!key||seen.has(key))continue;seen.add(key);output.push(item);if(output.length>=limit)break}
 return output
}
const normalize=value=>clean(value,4000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')

const cropLabels=Object.freeze({milho:'Milho',soja:'Soja',trigo:'Trigo',canola:'Canola',sorgo:'Sorgo',arroz:'Arroz',feijao:'Feijão',algodao:'Algodão',pastagem:'Pastagem'})

function entityRef(value,type='entity'){
 if(!value||typeof value!=='object')return null
 const id=identifier(value.id??value.client_id??value.clientId)
 const label=clean(value.label??value.name??value.title,180)
 if(!id&&!label)return null
 return {type:clean(value.type||type,80).toLowerCase()||type,id:id||null,label:label||null}
}

function cropFrom(text=''){
 const source=normalize(text);let selected='';let at=-1
 for(const [key,label] of Object.entries(cropLabels)){
  const pattern=new RegExp(`\\b${key}\\b`,'g');let match
  while((match=pattern.exec(source))){if(match.index>=at){selected=label;at=match.index}}
 }
 return selected
}

function seasonFrom(text=''){
 const matches=[...clean(text,4000).matchAll(/\b(20\d{2})\s*[\/_-]\s*((?:20)?\d{2})\b/g)]
 const match=matches.at(-1)
 if(!match)return ''
 return `${match[1]}/${match[2].slice(-2)}`
}

function topicFrom(text=''){
 const source=normalize(text)
 const topics=[
  ['nutrição',/\b(?:nutricao|fertilidade|adubacao|fertilizante)\b/],
  ['inseticidas',/\b(?:inseticida|cigarrinha|lagarta|percevejo|praga)\b/],
  ['herbicidas',/\b(?:herbicida|dessecacao|daninha)\b/],
  ['fungicidas',/\b(?:fungicida|doenca|ferrugem)\b/],
  ['mercado',/\b(?:mercado|cotacao|commodity|preco da saca)\b/],
  ['análise de solo',/\b(?:analise de solo|laudo de solo)\b/],
  ['mapeamento',/\b(?:mapa|mapeamento|talhao|poligono)\b/],
  ['preparação de visita',/\b(?:visita|preparar conversa|perguntas de ouro)\b/]
 ]
 return topics.find(([,pattern])=>pattern.test(source))?.[0]||''
}

const explicitSubjectClientId=value=>identifier(value?.subject_client_id??value?.subjectClientId??value?.producer_id??value?.producerId??value?.client_id??value?.clientId??(String(value?.subject?.type||'').toLowerCase()==='client'?value?.subject?.id:null))
const explicitTenantId=value=>identifier(value?.tenant_id??value?.tenantId??value?.organization_id??value?.organizationId??value?.organization?.id)
const explicitOwnerId=value=>identifier(value?.owner_id??value?.ownerId??value?.subject_owner_id??value?.subjectOwnerId??value?.owner?.id??(typeof value?.owner==='string'?value.owner:null))
const clientIds=value=>uniqueBy(list(value).map(item=>identifier(item)).filter(Boolean),item=>item,conversationStateLimits.clients)

function comparisonSubject(value,comparedClients=[]){
 const candidates=list(comparedClients).map(item=>entityRef(item,'client')).filter(item=>item?.id)
 if(!candidates.length)return {subjectClientId:null,subjectClientIds:[]}
 const source=normalize(value?.statement??value?.claim??value?.label??value)
 const matches=candidates.filter(item=>item.label&&source.includes(normalize(item.label)))
 if(matches.length===1)return {subjectClientId:matches[0].id,subjectClientIds:[matches[0].id]}
 return {subjectClientId:null,subjectClientIds:candidates.map(item=>item.id)}
}

function sessionItem(value,epistemicStatus,{tenantId='',ownerId='',requireScope=true}={}){
 const statement=clean(value?.statement??value?.claim??value?.label??value,700)
 const sourceRef=clean(value?.source_ref??value?.source_id??value?.sourceId??value?.id,180)
 if(!statement||!sourceRef)return null
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 if(explicitClientId&&explicitClientIds.length&&(explicitClientIds.length!==1||explicitClientIds[0]!==explicitClientId))return null
 const comparison=explicitClientId||explicitClientIds.length?{subjectClientId:explicitClientId||(explicitClientIds.length===1?explicitClientIds[0]:null),subjectClientIds:explicitClientIds}:{subjectClientId:null,subjectClientIds:[]}
 const subjectClientId=comparison.subjectClientId
 const subjectClientIds=uniqueBy([subjectClientId,...comparison.subjectClientIds].filter(Boolean),item=>item,conversationStateLimits.clients)
 if(!subjectClientId&&!subjectClientIds.length)return null
 const expectedTenantId=identifier(tenantId)
 const expectedOwnerId=identifier(ownerId)
 const itemTenantId=explicitTenantId(value)
 const itemOwnerId=explicitOwnerId(value)
 if(requireScope&&(!expectedTenantId||!expectedOwnerId||itemTenantId!==expectedTenantId||itemOwnerId!==expectedOwnerId))return null
 return {
  statement,
  epistemic_status:epistemicStatus,
  persistence:'SESSION_ONLY',
  source_ref:sourceRef,
  ...(subjectClientId?{subject_client_id:subjectClientId}:{}),
  ...(subjectClientIds.length>1?{subject_client_ids:subjectClientIds}:{}),
  ...(itemTenantId?{tenant_id:itemTenantId}:{}),
  ...(itemOwnerId?{owner_id:itemOwnerId}:{})
 }
}

const sessionItemKey=item=>`${item?.subject_client_id||clientIds(item?.subject_client_ids).join(',')||'unscoped'}:${normalize(item?.statement)}`

function scopedFields(value,{fallbackClientId=null,subjectClientIds=[],tenantId='',ownerId='',trustedScope=false}={}){
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 const subjects=uniqueBy([...explicitClientIds,...clientIds(subjectClientIds)].filter(Boolean),item=>item,conversationStateLimits.clients)
 const subjectClientId=explicitClientId||(!subjects.length&&trustedScope?identifier(fallbackClientId):subjects.length===1?subjects[0]:null)
 const itemTenantId=explicitTenantId(value)||(trustedScope?identifier(tenantId):'')
 const itemOwnerId=explicitOwnerId(value)||(trustedScope?identifier(ownerId):'')
 return {
  ...(subjectClientId?{subject_client_id:subjectClientId}:{}),
  ...(subjects.length>1?{subject_client_ids:subjects}:{}),
  ...(itemTenantId?{tenant_id:itemTenantId}:{}),
  ...(itemOwnerId?{owner_id:itemOwnerId}:{})
 }
}

function toolResult(value,scope={}){
 if(!value||typeof value!=='object')return null
 const capability=clean(value.capability,80)
 if(!capability)return null
 return {
  capability,
  status:clean(value.status,80),
  source_ref:clean(value.source_ref,180)||null,
  summary:clean(value.summary??value.tool_result?.summary,500)||null,
  ...scopedFields(value,scope)
 }
}

const toolResultKey=item=>`${item?.subject_client_id||clientIds(item?.subject_client_ids).join(',')||'unscoped'}:${item?.capability}:${item?.source_ref||item?.status}`

function questionItem(value,{comparedClients=[],fallbackClientId=null,tenantId='',ownerId='',trustedScope=false}={}){
 const question=clean(value?.question??value,700)
 if(!question)return null
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 const comparison=explicitClientId||explicitClientIds.length
  ?{subjectClientId:explicitClientId||(explicitClientIds.length===1?explicitClientIds[0]:null),subjectClientIds:explicitClientIds}
  :comparisonSubject({statement:question},comparedClients)
 const subjectClientIds=uniqueBy([comparison.subjectClientId,...comparison.subjectClientIds,...(!comparison.subjectClientId&&!comparison.subjectClientIds.length&&fallbackClientId?[identifier(fallbackClientId)]:[])].filter(Boolean),item=>item,conversationStateLimits.clients)
 // Mantém string[] para perguntas legadas/single-client. Apenas itens que
 // precisam de isolamento carregam metadados aditivos de sujeito.
 const itemTenantId=explicitTenantId(value)||(trustedScope?identifier(tenantId):'')
 const itemOwnerId=explicitOwnerId(value)||(trustedScope?identifier(ownerId):'')
 if(!subjectClientIds.length&&!itemTenantId&&!itemOwnerId)return question
 return {
  question,
  ...(subjectClientIds.length===1?{subject_client_id:subjectClientIds[0]}:subjectClientIds.length>1?{subject_client_ids:subjectClientIds}:{}),
  ...(itemTenantId?{tenant_id:itemTenantId}:{}),
  ...(itemOwnerId?{owner_id:itemOwnerId}:{})
 }
}

const questionItemKey=item=>`${item?.subject_client_id||clientIds(item?.subject_client_ids).join(',')||'unscoped'}:${normalize(item?.question??item)}`

function itemMatchesTenantOwner(item,tenantId,ownerId){
 const expectedTenantId=identifier(tenantId)
 const expectedOwnerId=identifier(ownerId)
 if(!expectedTenantId||!expectedOwnerId)return false
 return explicitTenantId(item)===expectedTenantId&&explicitOwnerId(item)===expectedOwnerId
}

function itemHasProducerScope(item){
 return Boolean(explicitSubjectClientId(item)||clientIds(item?.subject_client_ids??item?.subjectClientIds).length)
}

function withTrustedTenantOwner(value,{tenantId='',ownerId=''}={}){
 if(!value||typeof value!=='object')return value
 return {
  ...value,
  ...(!explicitTenantId(value)&&identifier(tenantId)?{tenant_id:identifier(tenantId)}:{}),
  ...(!explicitOwnerId(value)&&identifier(ownerId)?{owner_id:identifier(ownerId)}:{})
 }
}

function turn(value,scope={}){
 if(!value||typeof value!=='object')return null
 const role=['user','assistant','system'].includes(String(value.role))?String(value.role):'user'
 const text=clean(value.text??value.message??value.summary,1200)
 if(!text)return null
 const explicitConversationId=identifier(value.conversation_id??value.conversationId)
 const conversationId=explicitConversationId||identifier(scope.conversationId)
 const explicitEpoch=epochAliases(value,'turn.context_epoch')
 const inheritedEpoch=scopeEpoch(scope)
 const hasExplicitEpoch=explicitEpoch.provided
 const contextEpoch=hasExplicitEpoch?explicitEpoch.value:inheritedEpoch.value
 const status=role==='assistant'
  ?String(value.status||'').toLowerCase()==='completed'?'completed':'incomplete'
  :String(value.status||'accepted').toLowerCase()==='completed'?'completed':'accepted'
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 const trustedClientIds=clientIds(scope.subjectClientIds)
 const conflictingSubjectMetadata=Boolean(explicitClientId&&explicitClientIds.length&&(explicitClientIds.length!==1||explicitClientIds[0]!==explicitClientId))
 const expectedClientId=identifier(scope.fallbackClientId)
 const expectedTenantId=identifier(scope.tenantId)
 const expectedOwnerId=identifier(scope.ownerId)
 const itemTenantId=explicitTenantId(value)
 const itemOwnerId=explicitOwnerId(value)
 const explicitScopeMatches=Boolean(!conflictingSubjectMetadata&&explicitConversationId&&hasExplicitEpoch&&(!inheritedEpoch.provided||contextEpoch===inheritedEpoch.value)&&expectedTenantId&&expectedOwnerId&&itemTenantId===expectedTenantId&&itemOwnerId===expectedOwnerId&&(!expectedClientId||explicitClientId===expectedClientId||explicitClientIds.includes(expectedClientId)))
 const producerScoped=Boolean(explicitClientId||explicitClientIds.length||trustedClientIds.length||expectedClientId)
 const trustedGeneralScope=Boolean(scope.allowGeneralScope===true&&!producerScoped)
 const trustedScopeComplete=Boolean(scope.trustedScope===true&&conversationId&&expectedTenantId&&expectedOwnerId&&(producerScoped||trustedGeneralScope))
 const scopeVerified=trustedScopeComplete||value.scope_verified===true&&explicitScopeMatches
 const serverGrounded=Boolean(role==='assistant'&&status==='completed'&&value.server_grounded===true&&(scope.trustedScope===true||value.scope_verified===true&&explicitScopeMatches))
 const hasTurnFacts=Array.isArray(value.facts)||Array.isArray(value.fact_statements)
 const facts=hasTurnFacts?uniqueBy(list(value.facts??value.fact_statements).map(item=>sessionItem(item,'SESSION_FACT',{tenantId:expectedTenantId,ownerId:expectedOwnerId,requireScope:true})).filter(Boolean),sessionItemKey,conversationStateLimits.facts):[]
 const hasTurnQuestions=Array.isArray(value.questions)
 const questions=hasTurnQuestions?list(value.questions).map(item=>clean(item?.question??item,700)).filter(Boolean).slice(0,conversationStateLimits.questions):[]
 const hasTurnThesis=Object.prototype.hasOwnProperty.call(value,'decision_thesis')
 const decisionThesis=hasTurnThesis&&value.decision_thesis&&typeof value.decision_thesis==='object'?{
  thesis:clean(value.decision_thesis.thesis??value.decision_thesis.THESIS,1000)||null,
  uncertainty:clean(value.decision_thesis.uncertainty??value.decision_thesis.KEY_UNCERTAINTY,700)||null,
  next_action:clean(value.decision_thesis.next_action??value.decision_thesis.nextAction,700)||null
 }:null
 return {role,text,status,scope_verified:scopeVerified,server_grounded:serverGrounded,conversation_id:conversationId||null,context_epoch:contextEpoch,modality:['text','voice','photo','file','tool'].includes(String(value.modality))?String(value.modality):'text',intent:clean(value.intent,80)||null,created_at:iso(value.created_at??value.at),...scopedFields(value,scope),...(hasTurnFacts?{facts}:{}),...(hasTurnQuestions?{questions}:{}),...(hasTurnThesis?{decision_thesis:decisionThesis?{...decisionThesis,...scopedFields(value.decision_thesis,scope)}:null}:{})}
}

export function normalizeConversationState(value={},scope={}){
 const now=iso(value.updated_at??scope.now)
 const valueTenantId=explicitTenantId(value)
 const valueOwnerId=explicitOwnerId(value)
 const scopedTenantId=identifier(scope.tenantId)
 const scopedOwnerId=identifier(scope.ownerId)
 const valueConversationId=identifier(value.conversation_id??value.conversationId)
 const scopedConversationId=identifier(scope.conversationId)
 const valueEpoch=epochAliases(value,'state.context_epoch')
 const requestedEpoch=scopeEpoch(scope)
 if(requestedEpoch.provided&&valueEpoch.value!==requestedEpoch.value)throw Object.assign(invalidEpoch('scope.contextEpoch'),{code:'conversation_state_epoch_mismatch',expectedContextEpoch:requestedEpoch.value,actualContextEpoch:valueEpoch.value})
 if(valueTenantId&&scopedTenantId&&valueTenantId!==scopedTenantId)throw Object.assign(new Error('O estado conversacional não pertence ao tenant solicitado.'),{code:'conversation_state_tenant_mismatch'})
 if(valueOwnerId&&scopedOwnerId&&valueOwnerId!==scopedOwnerId)throw Object.assign(new Error('O estado conversacional não pertence ao owner solicitado.'),{code:'conversation_state_owner_mismatch'})
 if(valueConversationId&&scopedConversationId&&valueConversationId!==scopedConversationId)throw Object.assign(new Error('O estado conversacional não pertence à conversa solicitada.'),{code:'conversation_state_conversation_mismatch'})
 const tenantId=scopedTenantId||valueTenantId
 const ownerId=scopedOwnerId||valueOwnerId
 const conversationId=scopedConversationId||valueConversationId
 const client=entityRef(value.current_client??scope.client,'client')
 const scopedClientId=identifier(scope.clientId??scope.client?.id)
 const fallbackClientId=scopedClientId||client?.id||null
 if(client?.id&&scopedClientId&&client.id!==scopedClientId)throw Object.assign(new Error('O cliente do estado conversacional não pertence ao escopo solicitado.'),{code:'conversation_state_client_mismatch'})
 const active=value.active_object??scope.activeContext
 const activeRef=entityRef(active,active?.type||'entity')
 const normalizedThesis=value.current_decision_thesis&&typeof value.current_decision_thesis==='object'?{
  thesis:clean(value.current_decision_thesis.thesis,1000)||null,
  uncertainty:clean(value.current_decision_thesis.uncertainty,700)||null,
  next_action:clean(value.current_decision_thesis.next_action,700)||null,
  ...scopedFields(value.current_decision_thesis)
 }:null
 const normalizedTools=uniqueBy(list(value.recent_tool_results).map(item=>toolResult(item)).filter(item=>item&&itemHasProducerScope(item)&&itemMatchesTenantOwner(item,tenantId,ownerId)),toolResultKey,conversationStateLimits.toolResults)
 const normalizedQuestions=uniqueBy(list(value.recent_questions).map(item=>questionItem(item)).filter(item=>item&&itemHasProducerScope(item)&&itemMatchesTenantOwner(item,tenantId,ownerId)),questionItemKey,conversationStateLimits.questions)
 const normalizedTurns=list(value.conversation_turns).map(item=>turn(item,{fallbackClientId,conversationId,contextEpoch:valueEpoch.value,tenantId,ownerId})).filter(item=>item?.scope_verified===true&&itemMatchesTenantOwner(item,tenantId,ownerId)).slice(-conversationStateLimits.turns)
 const state={
  contract_version:conversationStateVersion,
  conversation_id:conversationId,
  tenant_id:tenantId||null,
  owner_id:ownerId||null,
  persistence_mode:'NONE',
  persistent_memory_unchanged:true,
  context_epoch:valueEpoch.value,
  current_domain:clean(value.current_domain,40)||null,
  current_client:client,
  recent_clients:uniqueBy(list(value.recent_clients).map(item=>entityRef(item,'client')).filter(Boolean),item=>item.id||item.label,conversationStateLimits.clients),
  current_property:entityRef(value.current_property,'property'),
  current_field:entityRef(value.current_field,'field'),
  current_crop:clean(value.current_crop,80)||null,
  current_season:clean(value.current_season,40)||null,
  current_opportunity:entityRef(value.current_opportunity,'opportunity'),
  current_visit:entityRef(value.current_visit,'visit'),
  current_objective:clean(value.current_objective,900)||null,
  current_topic:clean(value.current_topic,180)||null,
  current_decision_thesis:normalizedThesis&&itemHasProducerScope(normalizedThesis)&&itemMatchesTenantOwner(normalizedThesis,tenantId,ownerId)?normalizedThesis:null,
  recent_entities:uniqueBy(list(value.recent_entities).map(item=>entityRef(item)).filter(Boolean),item=>`${item.type}:${item.id||item.label}`,conversationStateLimits.entities),
  recent_tool_results:normalizedTools,
  recent_questions:normalizedQuestions,
  session_facts:uniqueBy(list(value.session_facts).map(item=>sessionItem(item,'SESSION_FACT',{tenantId,ownerId,requireScope:true})).filter(Boolean),sessionItemKey,conversationStateLimits.facts),
  session_hypotheses:uniqueBy(list(value.session_hypotheses).map(item=>sessionItem(item,'SESSION_HYPOTHESIS',{tenantId,ownerId,requireScope:true})).filter(Boolean),sessionItemKey,conversationStateLimits.hypotheses),
  conversation_turns:normalizedTurns,
  input_modality:['text','voice','photo','file'].includes(String(value.input_modality))?String(value.input_modality):'text',
  response_mode:['text','audio','both'].includes(String(value.response_mode))?String(value.response_mode):'text',
  conversation_mode:Boolean(value.conversation_mode),
  active_object:activeRef,
  created_at:iso(value.created_at??scope.now),
  updated_at:now
 }
 if(activeRef?.type==='property')state.current_property=activeRef
 if(activeRef?.type==='field')state.current_field=activeRef
 if(activeRef?.type==='opportunity')state.current_opportunity=activeRef
 if(['visit','visit_draft'].includes(activeRef?.type))state.current_visit={...activeRef,type:'visit'}
 return Object.freeze(state)
}

export function createConversationState(scope={}){
 return normalizeConversationState({},scope)
}

export function switchConversationClient(current={},client,scope={}){
 const previous=normalizeConversationState(current,{tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId,now:scope.now})
 const nextClient=entityRef(client,'client')
 if(!nextClient?.id)throw Object.assign(new Error('A troca de produtor exige uma referência autorizada.'),{code:'conversation_client_required'})
 if(previous.current_client?.id===nextClient.id)return previous
 return normalizeConversationState({
  ...previous,
  current_client:nextClient,
  recent_clients:uniqueBy([nextClient,previous.current_client,...previous.recent_clients].filter(Boolean),item=>item.id||item.label,conversationStateLimits.clients),
  current_property:null,
  current_field:null,
  current_crop:null,
  current_season:null,
  current_opportunity:null,
  current_visit:null,
  current_objective:null,
  current_topic:null,
  current_decision_thesis:null,
  context_epoch:previous.context_epoch+1,
  current_domain:null,
  recent_entities:[nextClient],
  recent_tool_results:[],
  recent_questions:[],
  session_facts:[],
  session_hypotheses:[],
  conversation_turns:[],
  active_object:null,
  updated_at:iso(scope.now)
 },{...scope,clientId:nextClient.id,client:nextClient,activeContext:null})
}

function shouldPreserveDomain(message,event={},classifiedDomain='GENERAL'){
 const referenceKind=conversationReferenceKind(message)
 if(event.preserveDomain===true||event.sessionCommand)return referenceKind==='TURN_CONTENT'&&classifiedDomain==='GENERAL'
 return ['TURN_CONTENT','ENTITY_ONLY'].includes(referenceKind)&&classifiedDomain==='GENERAL'
}

function clearedDomainOverlay(previous,nextDomain,nextEpoch,now){
 return {
  ...previous,
  context_epoch:nextEpoch,
  current_domain:nextDomain||null,
  current_property:null,
  current_field:null,
  current_crop:null,
  current_season:null,
  current_opportunity:null,
  current_visit:null,
  current_objective:null,
  current_topic:null,
  current_decision_thesis:null,
  recent_entities:previous.current_client?[previous.current_client]:[],
  recent_tool_results:[],
  recent_questions:[],
  session_facts:[],
  session_hypotheses:[],
  conversation_turns:[],
  active_object:null,
  updated_at:iso(now)
 }
}

/**
 * Resolves the epoch/domain boundary before any retrieval or model call.
 * A strong domain change keeps the authorized producer identity but drops all
 * conversational overlays that belonged to the previous epoch.
 */
export function prepareConversationTurnState(current={},event={}){
 const previous=normalizeConversationState(current,event.scope||{})
 const message=clean(event.message,3000)
 const referenceKind=conversationReferenceKind(message)
 const reset=event.reset===true||referenceKind==='RESET'
 const classified=message?classifyValContextDomain(message,event.intent):previous.current_domain
 const preserve=shouldPreserveDomain(message,event,classified)&&!reset
 const nextDomain=preserve&&previous.current_domain?previous.current_domain:(classified||previous.current_domain||null)
 const strongDomainChange=Boolean(!reset&&previous.current_domain&&nextDomain&&previous.current_domain!==nextDomain)
 if(!reset&&!strongDomainChange){
  if(nextDomain===previous.current_domain)return previous
  return normalizeConversationState({...previous,current_domain:nextDomain,updated_at:iso(event.now)},event.scope||{})
 }
 const nextEpoch=previous.context_epoch+1
 return normalizeConversationState(clearedDomainOverlay(previous,nextDomain,nextEpoch,event.now),event.scope||{})
}

function responseReasoning(response={}){return response?.advice?.ai_reasoning||response?.recommendation?.advice?.ai_reasoning||{}}

function itemMatchesAuthorizedSubjects(item,authorizedClientIds=[],{tenantId='',ownerId=''}={}){
 if(!itemMatchesTenantOwner(item,tenantId,ownerId))return false
 const allowed=new Set(clientIds(authorizedClientIds))
 const explicit=explicitSubjectClientId(item)
 const subjects=uniqueBy([explicit,...clientIds(item?.subject_client_ids??item?.subjectClientIds)].filter(Boolean),item=>item,conversationStateLimits.clients)
 if(!allowed.size)return !subjects.length
 return Boolean(subjects.length)&&subjects.every(subject=>allowed.has(subject))
}

export function advanceConversationState(current={},event={}){
 const message=clean(event.message,3000)
 const previous=event.turnPrepared===true
  ?normalizeConversationState(current,event.scope||{})
  :prepareConversationTurnState(current,event)
 const reasoning=responseReasoning(event.response)
 const client=entityRef(event.client??previous.current_client,'client')
 const active=entityRef(event.activeContext??previous.active_object,event.activeContext?.type||previous.active_object?.type||'entity')
 const comparedClients=list(event.response?.responseMetadata?.comparedClients??event.response?.comparisonResolution?.clients)
 const comparedClientIds=comparedClients.map(item=>entityRef(item,'client')?.id).filter(Boolean)
 const metadataOnly=!message&&!event.response
 const previousComparisonIds=activeComparisonClientIds(previous)
 const preservedComparisonIds=metadataOnly?previousComparisonIds:[]
 const comparisonPairChanged=comparedClientIds.length>1&&(previousComparisonIds.length!==comparedClientIds.length||comparedClientIds.some(item=>!previousComparisonIds.includes(item)))
 const authorizedSubjectIds=comparedClientIds.length>1?comparedClientIds:preservedComparisonIds.length>1?preservedComparisonIds:[client?.id].filter(Boolean)
 const tenantId=identifier(event.scope?.tenantId)||previous.tenant_id
 const ownerId=identifier(event.scope?.ownerId)||previous.owner_id
 const scopeBoundary={tenantId,ownerId}
 const turnScope={...(comparedClientIds.length>1?{subjectClientIds:comparedClientIds}:client?.id?{fallbackClientId:client.id}:{allowGeneralScope:true}),conversationId:previous.conversation_id,contextEpoch:previous.context_epoch,tenantId,ownerId,trustedScope:true}
 const userTurn=message?turn({role:'user',text:message,modality:event.inputModality||previous.input_modality,intent:event.intent,created_at:event.now},turnScope):null
 const capabilityResults=list(reasoning.run?.capability_results).map(item=>toolResult(item,turnScope)).filter(item=>item&&itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const tool=reasoning.run?.tool_result
 if(tool?.capability){const scopedTool=toolResult(tool,turnScope);if(scopedTool&&itemMatchesAuthorizedSubjects(scopedTool,authorizedSubjectIds,scopeBoundary))capabilityResults.unshift(scopedTool)}
 const newQuestions=[...list(reasoning.decision_interview?.questions),...list(reasoning.golden_questions)].map(item=>questionItem(item,{comparedClients,...turnScope})).filter(item=>item&&itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const facts=list(reasoning.facts_used).filter(item=>clean(item?.source_type??item?.sourceType,120).toLowerCase()!=='conversation_turn').map(item=>sessionItem(withTrustedTenantOwner(item,scopeBoundary),'SESSION_FACT',{tenantId,ownerId,requireScope:true})).filter(item=>item&&itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const hypotheses=list(reasoning.hypotheses).map(item=>sessionItem(withTrustedTenantOwner(item,scopeBoundary),'SESSION_HYPOTHESIS',{tenantId,ownerId,requireScope:true})).filter(item=>item&&itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const turnDecisionThesis=reasoning.decision_thesis&&facts.length?{
  thesis:clean(reasoning.decision_thesis.THESIS,1000)||null,
  uncertainty:clean(reasoning.decision_thesis.KEY_UNCERTAINTY,700)||null,
  next_action:clean(reasoning.recommended_strategy?.action??reasoning.next_commitment,700)||null
 }:null
 const reading=clean(reasoning.recommended_strategy?.reading??event.response?.advice?.answer,1200)
 const assistantTurn=reading?turn({role:'assistant',status:'completed',server_grounded:true,text:reading,facts,questions:newQuestions,decision_thesis:turnDecisionThesis,modality:event.responseMode==='audio'?'voice':'text',intent:reasoning.intent??event.intent,created_at:event.now},turnScope):null
 const mentionedEntities=[client,active].filter(Boolean)
 const scopedPreviousFacts=comparisonPairChanged?[]:previous.session_facts.filter(item=>itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const scopedPreviousHypotheses=comparisonPairChanged?[]:previous.session_hypotheses.filter(item=>itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const scopedPreviousTools=comparisonPairChanged?[]:previous.recent_tool_results.filter(item=>itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const scopedPreviousQuestions=comparisonPairChanged?[]:previous.recent_questions.filter(item=>itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const scopedPreviousTurns=comparisonPairChanged?[]:previous.conversation_turns.filter(item=>itemMatchesAuthorizedSubjects(item,authorizedSubjectIds,scopeBoundary))
 const scopedPreviousThesis=comparisonPairChanged?null:itemMatchesAuthorizedSubjects(previous.current_decision_thesis,authorizedSubjectIds,scopeBoundary)?previous.current_decision_thesis:null
 const next={
  ...previous,
  current_client:client,
  active_object:active,
  current_crop:cropFrom(message)||previous.current_crop,
  current_season:seasonFrom(message)||previous.current_season,
  current_objective:clean(event.objective??reasoning.objective??previous.current_objective,900)||null,
  current_topic:topicFrom(message)||previous.current_topic,
  context_epoch:previous.context_epoch,
  current_domain:previous.current_domain,
  current_decision_thesis:turnDecisionThesis?{...turnDecisionThesis,...scopedFields(reasoning.decision_thesis,turnScope)}:scopedPreviousThesis,
  recent_entities:uniqueBy([...mentionedEntities,...previous.recent_entities],item=>`${item.type}:${item.id||item.label}`,conversationStateLimits.entities),
  recent_tool_results:uniqueBy([...capabilityResults,...scopedPreviousTools].filter(item=>item?.capability),toolResultKey,conversationStateLimits.toolResults),
  recent_questions:uniqueBy([...newQuestions,...scopedPreviousQuestions].filter(Boolean),questionItemKey,conversationStateLimits.questions),
  session_facts:uniqueBy([...facts,...scopedPreviousFacts],sessionItemKey,conversationStateLimits.facts),
  session_hypotheses:uniqueBy([...hypotheses,...scopedPreviousHypotheses],sessionItemKey,conversationStateLimits.hypotheses),
  conversation_turns:[...scopedPreviousTurns,userTurn,assistantTurn].filter(Boolean).slice(-conversationStateLimits.turns),
  input_modality:['text','voice','photo','file'].includes(String(event.inputModality))?String(event.inputModality):previous.input_modality,
  response_mode:['text','audio','both'].includes(String(event.responseMode))?String(event.responseMode):previous.response_mode,
  conversation_mode:event.conversationMode===undefined?previous.conversation_mode:Boolean(event.conversationMode),
  updated_at:iso(event.now)
 }
 return normalizeConversationState(next,{...(event.scope||{}),client,activeContext:active,now:event.now})
}

function itemMatchesClient(item,clientId,includeCrossClient,allowedClientIds=[],tenantId='',ownerId=''){
 if(!itemMatchesTenantOwner(item,tenantId,ownerId))return false
 const expected=identifier(clientId)
 if(includeCrossClient){
  const allowed=new Set(clientIds(allowedClientIds))
  if(!allowed.size)return false
  const subjects=uniqueBy([identifier(item?.subject_client_id),...clientIds(item?.subject_client_ids)].filter(Boolean),item=>item,conversationStateLimits.clients)
  return Boolean(subjects.length)&&subjects.every(subject=>allowed.has(subject))
 }
 const subjects=uniqueBy([identifier(item?.subject_client_id),...clientIds(item?.subject_client_ids)].filter(Boolean),item=>item,conversationStateLimits.clients)
 if(!expected)return !subjects.length
 // Um agregado que mistura dois produtores só é disponibilizado quando o
 // chamador declara explicitamente que está construindo contexto comparativo.
 return subjects.length===1&&subjects[0]===expected
}

function turnMatchesScope(item,{conversationId='',clientId='',contextEpoch=0,includeCrossClient=false,allowedClientIds=[],tenantId='',ownerId=''}={}){
 if(item?.scope_verified!==true||!itemMatchesClient(item,clientId,includeCrossClient,allowedClientIds,tenantId,ownerId))return false
 const expectedConversation=identifier(conversationId)
 const actualConversation=identifier(item?.conversation_id??item?.conversationId)
 if(expectedConversation&&actualConversation!==expectedConversation)return false
 const itemEpoch=epochAliases(item,'turn.context_epoch')
 return itemEpoch.provided&&exactEpoch(contextEpoch)&&itemEpoch.value===contextEpoch
}

export function conversationStateContext(state={},options={}){
 const current=normalizeConversationState(state)
 const clientId=identifier(options.clientId??current.current_client?.id)
 const tenantId=identifier(options.tenantId??current.tenant_id)
 const ownerId=identifier(options.ownerId??current.owner_id)
 if(options.tenantId&&tenantId!==current.tenant_id)throw Object.assign(new Error('O contexto conversacional não pertence ao tenant solicitado.'),{code:'conversation_state_tenant_mismatch'})
 if(options.ownerId&&ownerId!==current.owner_id)throw Object.assign(new Error('O contexto conversacional não pertence ao owner solicitado.'),{code:'conversation_state_owner_mismatch'})
 const includeCrossClient=options.includeCrossClient===true||options.scope==='comparison'
 const latest=current.conversation_turns.at(-1)
 const latestEpoch=latest?epochAliases(latest,'turn.context_epoch'):{provided:false,value:0}
 const latestAtCurrentScope=latest?.role==='assistant'&&latest?.status==='completed'&&latest?.scope_verified===true&&identifier(latest?.conversation_id)===current.conversation_id&&latestEpoch.provided&&latestEpoch.value===current.context_epoch&&itemMatchesTenantOwner(latest,tenantId,ownerId)
 const inferredComparisonIds=latestAtCurrentScope?clientIds(latest?.subject_client_ids):[]
 const allowedClientIds=clientIds(options.allowedClientIds??options.clientIds??inferredComparisonIds)
 return Object.freeze({
  contract_version:current.contract_version,
  conversation_id:current.conversation_id,
  tenant_id:tenantId||null,
  owner_id:ownerId||null,
  persistence_mode:'NONE',
  persistent_memory_unchanged:true,
  context_epoch:current.context_epoch,
  current_domain:current.current_domain,
  current_client:current.current_client,
  recent_clients:current.recent_clients,
  current_property:current.current_property,
  current_field:current.current_field,
  current_crop:current.current_crop,
  current_season:current.current_season,
  current_opportunity:current.current_opportunity,
  current_visit:current.current_visit,
  active_object:current.active_object,
  current_objective:current.current_objective,
  current_topic:current.current_topic,
  current_decision_thesis:itemMatchesClient(current.current_decision_thesis,clientId,includeCrossClient,allowedClientIds,tenantId,ownerId)?current.current_decision_thesis:null,
  recent_entities:current.recent_entities,
  recent_tool_results:current.recent_tool_results.filter(item=>itemMatchesClient(item,clientId,includeCrossClient,allowedClientIds,tenantId,ownerId)),
  recent_questions:current.recent_questions.filter(item=>itemMatchesClient(item,clientId,includeCrossClient,allowedClientIds,tenantId,ownerId)),
  session_facts:current.session_facts.filter(item=>itemMatchesClient(item,clientId,includeCrossClient,allowedClientIds,tenantId,ownerId)),
  session_hypotheses:current.session_hypotheses.filter(item=>itemMatchesClient(item,clientId,includeCrossClient,allowedClientIds,tenantId,ownerId)),
  conversation_turns:current.conversation_turns.filter(item=>turnMatchesScope(item,{conversationId:current.conversation_id,clientId,contextEpoch:current.context_epoch,includeCrossClient,allowedClientIds,tenantId,ownerId})),
  input_modality:current.input_modality,
  response_mode:current.response_mode,
  conversation_mode:current.conversation_mode
 })
}

export function lastCompletedAssistantTurn(state={},options={}){
 const requestedConversationId=identifier(options.conversationId)
 const stateConversationId=identifier(state?.conversation_id??state?.conversationId)
 if(requestedConversationId&&stateConversationId&&requestedConversationId!==stateConversationId)return null
 const requestedClientId=identifier(options.clientId??options.client?.id)
 const stateClientId=identifier(state?.current_client?.id)
 if(requestedClientId&&stateClientId&&requestedClientId!==stateClientId)return null
 const fallbackClient=state?.current_client||options.client||(requestedClientId?{id:requestedClientId}:null)
 const requestedTenantId=identifier(options.tenantId)
 const requestedOwnerId=identifier(options.ownerId)
 const current=normalizeConversationState(state,{conversationId:requestedConversationId||stateConversationId,clientId:requestedClientId||stateClientId,client:fallbackClient,...(requestedTenantId?{tenantId:requestedTenantId}:{}),...(requestedOwnerId?{ownerId:requestedOwnerId}:{})})
 const conversationId=requestedConversationId||current.conversation_id
 const clientId=requestedClientId||current.current_client?.id
 const tenantId=requestedTenantId||current.tenant_id
 const ownerId=requestedOwnerId||current.owner_id
 const requestedEpoch=scopeEpoch(options)
 const contextEpoch=requestedEpoch.provided?requestedEpoch.value:current.context_epoch
 const includeCrossClient=options.includeCrossClient===true||options.scope==='comparison'
 const allowedClientIds=clientIds(options.allowedClientIds??options.clientIds??(includeCrossClient?current.conversation_turns.at(-1)?.subject_client_ids:[]))
 const scopedTurns=current.conversation_turns.filter(item=>turnMatchesScope(item,{conversationId,clientId,contextEpoch,includeCrossClient,allowedClientIds,tenantId,ownerId}))
 // Um novo turno do usuário sem resposta server-grounded é uma barreira. Isso
 // acontece, por exemplo, quando o browser ouviu uma resposta realtime que o
 // backend deliberadamente não promoveu a assistant completed.
 if(scopedTurns.at(-1)?.role==='user')return null
 return scopedTurns.findLast(item=>{
  if(item?.role!=='assistant'||item?.status!=='completed'||item?.scope_verified!==true||item?.server_grounded!==true||!turnMatchesScope(item,{conversationId,clientId,contextEpoch,includeCrossClient,allowedClientIds,tenantId,ownerId}))return false
  if(!includeCrossClient||!clientId)return true
  const subjects=uniqueBy([identifier(item.subject_client_id),...clientIds(item.subject_client_ids)].filter(Boolean),item=>item,conversationStateLimits.clients)
  return Boolean(subjects.length)&&subjects.includes(clientId)
 })||null
}

// A comparison is reusable only while it is the immediately preceding
// assistant turn. This keeps deterministic follow-ups on the compared pair
// without reopening older cross-client material after an unrelated turn.
export function activeComparisonClientIds(state={}){
 const current=normalizeConversationState(state)
 const latest=current.conversation_turns.at(-1)
 const subjects=clientIds(latest?.subject_client_ids)
 if(latest?.role!=='assistant'||latest?.status!=='completed'||latest?.scope_verified!==true||latest?.server_grounded!==true||subjects.length<2||!turnMatchesScope(latest,{conversationId:current.conversation_id,contextEpoch:current.context_epoch,includeCrossClient:true,allowedClientIds:subjects,tenantId:current.tenant_id,ownerId:current.owner_id}))return Object.freeze([])
 return Object.freeze(subjects.length>1?subjects:[])
}

export function conversationStatePromptContext(state={}){
 const current=normalizeConversationState(state)
 return [
  current.current_client?.label&&`produtor ${current.current_client.label}`,
  current.current_property?.label&&`propriedade ${current.current_property.label}`,
  current.current_field?.label&&`talhão ${current.current_field.label}`,
  current.current_crop&&`cultura ${current.current_crop}`,
  current.current_season&&`safra ${current.current_season}`,
  current.current_topic&&`assunto ${current.current_topic}`,
  current.current_objective&&`objetivo ${current.current_objective}`
 ].filter(Boolean).join('; ')
}

export function messageNeedsSessionReference(message=''){
 const source=normalize(message)
 return /\b(?:ele|ela|dele|dela|essa area|esse talhao|essa analise|esse produto|aquela visita|isso|o filho dele|a primeira aplicacao|volta pro|volte para)\b/.test(source)||clean(message).length<=90&&/^(?:e|agora|mas|entao|por que|porque|aprofunda|resume|repete)\b/.test(source)
}
