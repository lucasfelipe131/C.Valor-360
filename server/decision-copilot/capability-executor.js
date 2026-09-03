import {createHash,randomUUID} from 'node:crypto'
import {isCurrentClientIdentityRequest} from '../ai-reasoning/intent-router.js'
import {executeCopilotCalculator} from '../agronomic-calculator-adapter.js'
import {conversationStateContext,lastCompletedAssistantTurn,normalizeConversationState} from './conversation-state.js'
import {assertActiveProducerBoundary,assertContextScopeAliases,classifyValContextDomain,explicitlyGlobalContext} from './context-selector.js'
import {evaluateReasoningGrounding} from './response-grounding.js'
import {selectKnowledge} from '../knowledge/library.js'
import {describeSelectionMatch} from '../knowledge/selection.js'

export const capabilityExecutorVersion='val.capability_executor.v1'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const own=(value,key)=>Boolean(value)&&Object.prototype.hasOwnProperty.call(value,key)
const groundingBlockedAnswer='Não há evidência verificável suficiente nesta execução para responder com segurança.'
const idOf=item=>clean(item?.id??item?.opportunity_id??item?.commitment_id??item?.external_key??item?.externalId??item?.candidateKey,180)
const deepFreeze=(value,seen=new WeakSet())=>{
 if(!value||typeof value!=='object'||seen.has(value)||ArrayBuffer.isView(value))return value
 seen.add(value)
 for(const key of Reflect.ownKeys(value))deepFreeze(value[key],seen)
 return Object.freeze(value)
}
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/gif'])
const supportedAgroTools=new Set(['solo','produtores','diagnostico','calculadoras','bulas','mercado','clima','manual','biblioteca','observacoes'])
const producerScopeKeys=Object.freeze(['producer_id','producerId','client_id','clientId','subject_client_id','client_external_key','clientExternalKey'])
const tenantScopeKeys=Object.freeze(['tenant_id','tenantId','organization_id','organizationId'])
const ownerScopeKeys=Object.freeze(['context_owner_id','contextOwnerId','consultant_id','consultantId','owner_id','ownerId','created_by','createdBy'])
const globalScopeKeys=Object.freeze(['scope','context_scope','knowledge_scope','knowledgeScope'])
const sourceIdentityKeys=Object.freeze(['source_ref','sourceRef','id','commitment_id','commitmentId','analysis_id','analysisId','attachment_id','attachmentId','result_reference','resultReference','external_key','externalKey'])
const trustedCapabilityExecutions=new WeakSet()

const navigation=Object.freeze({
 AGRONOMIC_WORKSPACE:{tool:'',title:'Inteligência Agronômica da VAL',page:'agro',manual_page:null,mode:'catalog'},
 AREA_MAPPING:{tool:'area_mapping',title:'Mapeamento de áreas',page:'agro',manual_page:'produtores',mode:'mapping'},
 CALCULATORS:{tool:'calculators',title:'Calculadoras agronômicas',page:'agro',manual_page:'calculadoras',mode:'calculator'},
 SOIL_ANALYSIS:{tool:'soil_analysis',title:'Análise de solo',page:'agro',manual_page:'solo',mode:'soil'},
 IMAGE_DIAGNOSIS:{tool:'image_diagnosis',title:'Diagnóstico por imagem',page:'agro',manual_page:'diagnostico',mode:'diagnosis'},
 NUTRISCAN:{tool:'nutriscan',title:'NutriScan',page:'agro',manual_page:'diagnostico',mode:'nutrition'},
 FITOSCAN:{tool:'fitoscan',title:'FitoScan',page:'agro',manual_page:'diagnostico',mode:'disease'},
 SESSION_COMMAND:{tool:'session_command',title:'Comando da conversa',page:'copilot',manual_page:null,mode:'session'},
 MARKET_COMMODITY:{tool:'market',title:'Mercado e commodities',page:'agro',manual_page:'mercado',mode:'live_data'},
 WEATHER:{tool:'weather',title:'Clima',page:'agro',manual_page:'inicio',mode:'live_data'},
 LABELS:{tool:'labels',title:'Bulas e registros',page:'agro',manual_page:'bulas',mode:'live_data'},
 AGRONOMIST_MANUAL:{tool:'manual',title:'Manual do Agrônomo',page:'agro',manual_page:'inicio',mode:'knowledge'},
 KNOWLEDGE_LIBRARY:{tool:'biblioteca',title:'Biblioteca e histórico',page:'agro',manual_page:'relatorios',mode:'knowledge'}
 ,CLIENT_CONTEXT:{tool:'client_fact',title:'Contexto do produtor',page:'copilot',manual_page:null,mode:'fast'}
 ,CONFIRMED_MEMORY:{tool:'confirmed_memory',title:'Memória confirmada',page:'copilot',manual_page:null,mode:'fast'}
 ,COMMERCIAL_HISTORY:{tool:'commercial_history',title:'Histórico comercial',page:'copilot',manual_page:null,mode:'fast'}
})

const agronomicCatalogCapabilities=Object.freeze([
 'AREA_MAPPING','SOIL_ANALYSIS','IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN','CALCULATORS',
 'LABELS','WEATHER','MARKET_COMMODITY','AGRONOMIST_MANUAL','KNOWLEDGE_LIBRARY'
])

const agronomicCatalogPolicy=Object.freeze({
 AREA_MAPPING:{availability:'SPECIALIZED_WORKSPACE',integration_state:'PARTIAL',requires_current_source:false,human_review_required:true},
 SOIL_ANALYSIS:{availability:'SPECIALIZED_WORKSPACE',integration_state:'AVAILABLE',requires_current_source:false,human_review_required:true},
 IMAGE_DIAGNOSIS:{availability:'SPECIALIZED_WORKSPACE',integration_state:'PARTIAL',requires_current_source:false,human_review_required:true},
 NUTRISCAN:{availability:'SPECIALIZED_WORKSPACE',integration_state:'PARTIAL',requires_current_source:false,human_review_required:true},
 FITOSCAN:{availability:'SPECIALIZED_WORKSPACE',integration_state:'PARTIAL',requires_current_source:false,human_review_required:true},
 CALCULATORS:{availability:'SPECIALIZED_WORKSPACE',integration_state:'AVAILABLE',requires_current_source:false,human_review_required:true},
 LABELS:{availability:'CURRENT_SOURCE_REQUIRED',integration_state:'SOURCE_DEPENDENT',requires_current_source:true,human_review_required:true},
 WEATHER:{availability:'CURRENT_SOURCE_REQUIRED',integration_state:'SOURCE_DEPENDENT',requires_current_source:true,human_review_required:false},
 MARKET_COMMODITY:{availability:'CURRENT_SOURCE_REQUIRED',integration_state:'SOURCE_DEPENDENT',requires_current_source:true,human_review_required:false},
 AGRONOMIST_MANUAL:{availability:'SPECIALIZED_WORKSPACE',integration_state:'AVAILABLE',requires_current_source:false,human_review_required:false},
 KNOWLEDGE_LIBRARY:{availability:'SPECIALIZED_WORKSPACE',integration_state:'AVAILABLE',requires_current_source:false,human_review_required:false}
})

const contextCollections=Object.freeze({
 opportunity:'opportunities',visit:'visits',soil_analysis:'soilAnalyses',analysis:'soilAnalyses',property:'properties'
})

function fieldRecords(context={}){
 return list(context.properties).flatMap(property=>list(property?.fields).map(field=>({...field,property_id:idOf(property)})))
}

function scopeError(message,statusCode=404,code='val_active_context_scope_invalid'){
 return Object.assign(new Error(message),{statusCode,code})
}

const declaredScopeValues=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)?[...new Set(keys.map(key=>clean(value[key],180)).filter(Boolean))]:[]
function capabilityScopeViolation(reason,details={}){
 return Object.assign(new Error('A execução da capability não pertence ao escopo ativo.'),{statusCode:422,code:'CONTEXT_SCOPE_VIOLATION',reason,...details})
}
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0

function capabilityExecutionScope(options={}){
 const {context={},clientId='',tenantId='',ownerId='',conversationId='',contextEpoch}=options
 const snapshot=context?.contextSnapshot&&typeof context.contextSnapshot==='object'?context.contextSnapshot:{}
 const snapshotScope=snapshot?.context_scope&&typeof snapshot.context_scope==='object'?snapshot.context_scope:{}
 const conversationState=context?.conversationState&&typeof context.conversationState==='object'&&!Array.isArray(context.conversationState)?context.conversationState:null
 for(const node of [context,snapshot,snapshotScope,context?.client,conversationState,conversationState?.current_client].filter(value=>value&&typeof value==='object'&&!Array.isArray(value)))assertContextScopeAliases(node)
 const expectedProducer=clean(clientId||context?.client?.id||snapshotScope?.producer_id||snapshot?.subject?.id,180)
 const expectedTenant=clean(tenantId||snapshotScope?.tenant_id||snapshot?.organization_id||context?.tenant_id||context?.tenantId||context?.organization_id||context?.organizationId||context?.conversationState?.tenant_id,180)
 const expectedOwner=clean(ownerId||snapshotScope?.owner_id||context?.context_owner_id||context?.contextOwnerId||context?.owner_id||context?.ownerId||context?.conversationState?.owner_id,180)
 const expectedConversation=clean(conversationId||snapshotScope?.conversation_id||context?.conversationSession?.id||conversationState?.conversation_id,180)
 const explicitEpoch=own(options,'contextEpoch')
 const snapshotHasEpoch=own(snapshotScope,'context_epoch')
 const epochCandidates=[]
 for(const [present,value] of [[explicitEpoch,contextEpoch],[snapshotHasEpoch,snapshotScope.context_epoch],[own(conversationState,'context_epoch'),conversationState?.context_epoch],[own(conversationState,'contextEpoch'),conversationState?.contextEpoch]])if(present){
  if(!exactEpoch(value))throw capabilityScopeViolation('INVALID_CONTEXT_EPOCH')
  epochCandidates.push(value)
 }
 const expectedEpoch=epochCandidates[0]??0
 if(epochCandidates.some(value=>value!==expectedEpoch))throw capabilityScopeViolation('CONTEXT_EPOCH_MISMATCH',{expectedContextEpoch:expectedEpoch})
 const contextProducer=clean(context?.client?.id??context?.client?.client_id??context?.client?.clientId,180)
 const snapshotProducer=clean(snapshotScope?.producer_id??snapshotScope?.producerId??snapshot?.subject?.id??snapshot?.client_id,180)
 const snapshotTenant=clean(snapshotScope?.tenant_id??snapshotScope?.tenantId??snapshot?.organization_id,180)
 const snapshotOwner=clean(snapshotScope?.owner_id??snapshotScope?.ownerId,180)
 if(expectedProducer&&contextProducer&&contextProducer!==expectedProducer)throw capabilityScopeViolation('PRODUCER_MISMATCH',{expectedProducerId:expectedProducer,actualProducerId:contextProducer})
 if(expectedProducer&&snapshotProducer&&snapshotProducer!==expectedProducer)throw capabilityScopeViolation('PRODUCER_MISMATCH',{expectedProducerId:expectedProducer,actualProducerId:snapshotProducer})
 if(expectedTenant&&snapshotTenant&&snapshotTenant!==expectedTenant)throw capabilityScopeViolation('TENANT_MISMATCH',{expectedTenantId:expectedTenant,actualTenantId:snapshotTenant})
 if(expectedOwner&&snapshotOwner&&snapshotOwner!==expectedOwner)throw capabilityScopeViolation('OWNER_MISMATCH',{expectedOwnerId:expectedOwner,actualOwnerId:snapshotOwner})
 if(conversationState){
  const stateTenant=clean(conversationState.tenant_id??conversationState.tenantId,180)
  const stateOwner=clean(conversationState.owner_id??conversationState.ownerId,180)
  const stateProducer=clean(conversationState.current_client?.id??conversationState.current_client?.client_id??conversationState.currentClient?.id,180)
  const stateConversation=clean(conversationState.conversation_id??conversationState.conversationId,180)
  const stateHasEpoch=own(conversationState,'context_epoch')||own(conversationState,'contextEpoch')
  const stateEpoch=own(conversationState,'context_epoch')?conversationState.context_epoch:conversationState.contextEpoch
  if(expectedTenant&&(!stateTenant||stateTenant!==expectedTenant))throw capabilityScopeViolation(stateTenant?'TENANT_MISMATCH':'MISSING_TENANT_SCOPE',{expectedTenantId:expectedTenant,actualTenantId:stateTenant||null,sourceKind:'conversation_state'})
  if(expectedOwner&&(!stateOwner||stateOwner!==expectedOwner))throw capabilityScopeViolation(stateOwner?'OWNER_MISMATCH':'MISSING_OWNER_SCOPE',{expectedOwnerId:expectedOwner,actualOwnerId:stateOwner||null,sourceKind:'conversation_state'})
  if(expectedProducer&&(!stateProducer||stateProducer!==expectedProducer))throw capabilityScopeViolation(stateProducer?'PRODUCER_MISMATCH':'MISSING_PRODUCER_SCOPE',{expectedProducerId:expectedProducer,actualProducerId:stateProducer||null,sourceKind:'conversation_state'})
  if(!expectedProducer&&stateProducer)throw capabilityScopeViolation('PRODUCER_MISMATCH',{expectedProducerId:null,actualProducerId:stateProducer,sourceKind:'conversation_state'})
  if(expectedConversation&&(!stateConversation||stateConversation!==expectedConversation))throw capabilityScopeViolation(stateConversation?'CONVERSATION_MISMATCH':'MISSING_CONVERSATION_SCOPE',{expectedConversationId:expectedConversation,actualConversationId:stateConversation||null,sourceKind:'conversation_state'})
  if((explicitEpoch||snapshotHasEpoch)&&(!stateHasEpoch||stateEpoch!==expectedEpoch))throw capabilityScopeViolation(stateHasEpoch?'CONTEXT_EPOCH_MISMATCH':'MISSING_CONTEXT_EPOCH',{expectedContextEpoch:expectedEpoch,actualContextEpoch:stateHasEpoch?stateEpoch:null,sourceKind:'conversation_state'})
 }
 return Object.freeze({producerId:expectedProducer,tenantId:expectedTenant,ownerId:expectedOwner,conversationId:expectedConversation,contextEpoch:expectedEpoch,requireOwner:Boolean(expectedOwner)})
}

const sourceIdentity=value=>sourceIdentityKeys.map(key=>clean(value?.[key],240)).find(Boolean)||idOf(value)
const unexpectedKeys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).filter(key=>!allowed.has(key)):[]

function validateGeneralGuidanceSource(item,message){
 const tool=item?.tool_result
 const allowedTool=new Set(['status','capability','tool','title','summary','page','manual_page','mode','context'])
 const allowedContext=new Set(['client_id','private_memory_used','knowledge_item_id','knowledge_match'])
 const expected=generalGuidance(message)
 if(!tool||clean(item?.source_ref,240)!=='system:general-guidance:v1'||clean(tool.capability,80).toUpperCase()!=='GENERAL_GUIDANCE'||clean(tool.summary,1200)!==clean(expected.summary,1200)||unexpectedKeys(tool,allowedTool).length||unexpectedKeys(tool.context,allowedContext).length||tool.context?.client_id!=null||tool.context?.private_memory_used!==false||(tool.context?.knowledge_item_id??null)!==expected.knowledge_item_id||(tool.context?.knowledge_match??null)!==expected.knowledge_match)throw capabilityScopeViolation('GENERAL_SOURCE_CONTENT_MISMATCH')
 return true
}

/**
 * Records are checked before any field is read into a capability result. Missing
 * scope may only be inherited by a true nested child from its already-validated
 * parent (for example a field inside a property or a scan inside an attachment).
 */
function validateConsumedRecord(record,scope,{kind='record',parentScope=null,requireSource=true}={}){
 if(!record||typeof record!=='object'||Array.isArray(record))throw capabilityScopeViolation('INVALID_SOURCE_RECORD',{sourceKind:kind})
 assertContextScopeAliases(record)
 const producers=declaredScopeValues(record,producerScopeKeys)
 const tenants=declaredScopeValues(record,tenantScopeKeys)
 const owners=declaredScopeValues(record,ownerScopeKeys)
 if(producers.length>1)throw capabilityScopeViolation('PRODUCER_ALIAS_CONFLICT',{sourceKind:kind})
 if(tenants.length>1)throw capabilityScopeViolation('TENANT_ALIAS_CONFLICT',{sourceKind:kind})
 if(owners.length>1)throw capabilityScopeViolation('OWNER_ALIAS_CONFLICT',{sourceKind:kind})
 const effectiveProducer=producers[0]||parentScope?.producerId||''
 const effectiveTenant=tenants[0]||parentScope?.tenantId||''
 const effectiveOwner=owners[0]||parentScope?.ownerId||''
 if(!effectiveProducer)throw capabilityScopeViolation('MISSING_PRODUCER_SCOPE',{sourceKind:kind})
 if(!effectiveTenant)throw capabilityScopeViolation('MISSING_TENANT_SCOPE',{sourceKind:kind})
 if(!effectiveOwner)throw capabilityScopeViolation('MISSING_OWNER_SCOPE',{sourceKind:kind})
 validateDeclaredScopeTree(record,{producerId:scope.producerId,tenantId:scope.tenantId,ownerId:scope.ownerId},kind)
 assertActiveProducerBoundary([{...record,...(!producers.length&&effectiveProducer?{producer_id:effectiveProducer}:{}),...(!tenants.length&&effectiveTenant?{tenant_id:effectiveTenant}:{}),...(!owners.length&&effectiveOwner?{context_owner_id:effectiveOwner}:{})}],scope.producerId,{tenantId:scope.tenantId,ownerId:scope.ownerId,requireOwner:scope.requireOwner})
 if(requireSource&&!sourceIdentity(record))throw capabilityScopeViolation('MISSING_SOURCE_ID',{sourceKind:kind})
 return Object.freeze({producerId:effectiveProducer,tenantId:effectiveTenant,ownerId:effectiveOwner,sourceRef:sourceIdentity(record)})
}

function validateNestedRecords(records,scope,{kind,parentScope,requireSource=true}={}){
 const validated=[];let collectionScope=parentScope
 for(const record of list(records)){
  const recordScope=validateConsumedRecord(record,scope,{kind,parentScope,requireSource})
  if(collectionScope){
   if(recordScope.producerId!==collectionScope.producerId)throw capabilityScopeViolation('PRODUCER_MISMATCH',{sourceKind:kind,expectedProducerId:collectionScope.producerId,actualProducerId:recordScope.producerId})
   if(recordScope.tenantId!==collectionScope.tenantId)throw capabilityScopeViolation('TENANT_MISMATCH',{sourceKind:kind,expectedTenantId:collectionScope.tenantId,actualTenantId:recordScope.tenantId})
   if(recordScope.ownerId!==collectionScope.ownerId)throw capabilityScopeViolation('OWNER_MISMATCH',{sourceKind:kind,expectedOwnerId:collectionScope.ownerId,actualOwnerId:recordScope.ownerId})
  }else collectionScope=recordScope
  validated.push({record,scope:recordScope})
 }
 return validated
}

function validateDeclaredScopeTree(value,{producerId='',tenantId='',ownerId=''}={},path='record',seen=new Set()){
 if(!value||typeof value!=='object'||value instanceof Date||seen.has(value))return true
 seen.add(value)
 if(Array.isArray(value)){
  value.forEach((item,index)=>validateDeclaredScopeTree(item,{producerId,tenantId,ownerId},`${path}[${index}]`,seen))
  return true
 }
 assertContextScopeAliases(value)
 const producers=declaredScopeValues(value,producerScopeKeys)
 const tenants=declaredScopeValues(value,tenantScopeKeys)
 const owners=declaredScopeValues(value,ownerScopeKeys)
 if(producers.length>1)throw capabilityScopeViolation('PRODUCER_ALIAS_CONFLICT',{sourcePath:path})
 if(tenants.length>1)throw capabilityScopeViolation('TENANT_ALIAS_CONFLICT',{sourcePath:path})
 if(owners.length>1)throw capabilityScopeViolation('OWNER_ALIAS_CONFLICT',{sourcePath:path})
 if(producerId&&producers.some(actual=>actual!==producerId))throw capabilityScopeViolation('PRODUCER_MISMATCH',{sourcePath:path,expectedProducerId:producerId,actualProducerId:producers.find(actual=>actual!==producerId)})
 if(tenantId&&tenants.some(actual=>actual!==tenantId))throw capabilityScopeViolation('TENANT_MISMATCH',{sourcePath:path,expectedTenantId:tenantId,actualTenantId:tenants.find(actual=>actual!==tenantId)})
 if(ownerId&&owners.some(actual=>actual!==ownerId))throw capabilityScopeViolation('OWNER_MISMATCH',{sourcePath:path,expectedOwnerId:ownerId,actualOwnerId:owners.find(actual=>actual!==ownerId)})
 for(const [key,nested] of Object.entries(value))if(nested&&typeof nested==='object')validateDeclaredScopeTree(nested,{producerId,tenantId,ownerId},`${path}.${key}`,seen)
 return true
}

function declaredScopeTreeValues(value,keys,seen=new Set()){
 if(!value||typeof value!=='object'||value instanceof Date||seen.has(value))return []
 seen.add(value)
 if(Array.isArray(value))return [...new Set(value.flatMap(item=>declaredScopeTreeValues(item,keys,seen)))]
 return [...new Set([...declaredScopeValues(value,keys),...Object.values(value).flatMap(item=>declaredScopeTreeValues(item,keys,seen))])]
}

function validateGlobalLiveScope(record,scope={},sourceKind='live_data'){
 if(!record||typeof record!=='object'||Array.isArray(record))throw capabilityScopeViolation('INVALID_SOURCE_RECORD',{sourceKind})
 assertContextScopeAliases(record)
 const markers=declaredScopeValues(record,globalScopeKeys).map(value=>value.toUpperCase())
 const tenants=declaredScopeValues(record,tenantScopeKeys)
 const owners=declaredScopeValues(record,ownerScopeKeys)
 const producers=declaredScopeTreeValues(record,producerScopeKeys)
 if(markers.length!==1||markers[0]!=='MARKET')throw capabilityScopeViolation(markers.length?'GLOBAL_SCOPE_MISMATCH':'MISSING_GLOBAL_SCOPE',{sourceKind,actualScope:markers[0]||null})
 if(!scope.tenantId||tenants.length!==1||tenants[0]!==scope.tenantId)throw capabilityScopeViolation(tenants.length?(tenants[0]===scope.tenantId?'TENANT_ALIAS_CONFLICT':'TENANT_MISMATCH'):'MISSING_TENANT_SCOPE',{sourceKind,expectedTenantId:scope.tenantId||null,actualTenantId:tenants[0]||null})
 if(!scope.ownerId||owners.length!==1||owners[0]!==scope.ownerId)throw capabilityScopeViolation(owners.length?(owners[0]===scope.ownerId?'OWNER_ALIAS_CONFLICT':'OWNER_MISMATCH'):'MISSING_OWNER_SCOPE',{sourceKind,expectedOwnerId:scope.ownerId||null,actualOwnerId:owners[0]||null})
 if(producers.length)throw capabilityScopeViolation('GLOBAL_PRODUCER_SCOPE_CONFLICT',{sourceKind,actualProducerId:producers[0]})
 validateDeclaredScopeTree(record,{tenantId:scope.tenantId,ownerId:scope.ownerId},sourceKind)
 if(!sourceIdentity(record))throw capabilityScopeViolation('MISSING_SOURCE_ID',{sourceKind})
 return Object.freeze({scope:'MARKET',tenantId:tenants[0],ownerId:owners[0],producerId:null})
}

function validateCapabilityExecutionScope({execution,clientId='',tenantId='',ownerId=''}={}){
 const expectedProducer=clean(clientId,180);const expectedTenant=clean(tenantId,180);const expectedOwner=clean(ownerId,180)
 const candidates=[...list(execution?.capability_results),execution?.tool_result].filter(Boolean)
 for(const candidate of candidates){
  validateDeclaredScopeTree(candidate,{producerId:expectedProducer,tenantId:expectedTenant,ownerId:expectedOwner},'capability_result')
  const tool=candidate?.tool_result&&typeof candidate.tool_result==='object'?candidate.tool_result:candidate
  const nodes=[candidate,tool,tool?.context,tool?.facts].filter(value=>value&&typeof value==='object'&&!Array.isArray(value))
  for(const node of nodes){
   assertContextScopeAliases(node)
   const producers=declaredScopeValues(node,producerScopeKeys)
   const tenants=declaredScopeValues(node,tenantScopeKeys)
   const owners=declaredScopeValues(node,ownerScopeKeys)
   if(producers.length>1)throw capabilityScopeViolation('PRODUCER_ALIAS_CONFLICT')
   if(tenants.length>1)throw capabilityScopeViolation('TENANT_ALIAS_CONFLICT')
   if(owners.length>1)throw capabilityScopeViolation('OWNER_ALIAS_CONFLICT')
   if(expectedProducer&&producers.some(value=>value!==expectedProducer))throw capabilityScopeViolation('PRODUCER_MISMATCH',{expectedProducerId:expectedProducer,actualProducerId:producers.find(value=>value!==expectedProducer)})
   if(expectedTenant&&tenants.some(value=>value!==expectedTenant))throw capabilityScopeViolation('TENANT_MISMATCH',{expectedTenantId:expectedTenant,actualTenantId:tenants.find(value=>value!==expectedTenant)})
   if(expectedOwner&&owners.some(value=>value!==expectedOwner))throw capabilityScopeViolation('OWNER_MISMATCH',{expectedOwnerId:expectedOwner,actualOwnerId:owners.find(value=>value!==expectedOwner)})
  }
 }
 return true
}

const globalLiveCapabilities=new Set(['MARKET_COMMODITY','WEATHER','LABELS'])
const contextFreeCapabilities=new Set(['AGRONOMIC_WORKSPACE','GENERAL_GUIDANCE',...globalLiveCapabilities,'WORKSPACE_NAVIGATION'])
function validateCapabilitySourceBinding({sources=[],clientId='',tenantId='',ownerId='',conversationId='',contextEpoch=0,route={}}={}){
 if(!exactEpoch(contextEpoch))throw capabilityScopeViolation('INVALID_CONTEXT_EPOCH')
 const expectedProducer=clean(clientId,180)
 const expectedTenant=clean(tenantId,180)
 const expectedOwner=clean(ownerId,180)
 for(const item of sources){
  const capability=clean(item?.capability,80).toUpperCase()
  const sourceRef=clean(item?.source_ref,240)
  const context=item?.tool_result?.context&&typeof item.tool_result.context==='object'?item.tool_result.context:{}
  const declaredProducer=declaredScopeValues(context,producerScopeKeys)[0]||''
  const globalLive=globalLiveCapabilities.has(capability)&&explicitlyGlobalContext(context)
  if(globalLive)validateGlobalLiveScope({...context,source_ref:sourceRef},{tenantId:expectedTenant,ownerId:expectedOwner},`capability_${capability.toLowerCase()}`)
  else if(globalLiveCapabilities.has(capability)&&!declaredProducer)throw capabilityScopeViolation('MISSING_GLOBAL_SCOPE',{sourceKind:`capability_${capability.toLowerCase()}`})
  if(sourceRef==='system:general-guidance:v1'&&capability!=='GENERAL_GUIDANCE')throw capabilityScopeViolation('RESERVED_SOURCE_REF_MISMATCH')
  if(expectedProducer&&!contextFreeCapabilities.has(capability)&&declaredProducer!==expectedProducer)throw capabilityScopeViolation(declaredProducer?'PRODUCER_MISMATCH':'MISSING_PRODUCER_SCOPE',{expectedProducerId:expectedProducer,actualProducerId:declaredProducer||null})
  if(capability==='CLIENT_CONTEXT'){
   if(!expectedProducer||sourceRef!==`client:${expectedProducer}`||context.current_client_only!==true)throw capabilityScopeViolation('CLIENT_SOURCE_REF_MISMATCH')
  }
  if(capability==='SESSION_COMMAND'){
   const command=clean(route?.session_command?.command??context.command,80).toUpperCase()
   const expectedConversation=clean(conversationId,180)||'stateless'
   const expectedEpoch=contextEpoch
   const expectedRef=`session:${expectedConversation}:${expectedEpoch}:${command}`
   if(!command||sourceRef!==expectedRef||clean(context.conversation_id,180)!==expectedConversation||!exactEpoch(context.context_epoch)||context.context_epoch!==expectedEpoch||clean(context.command,80).toUpperCase()!==command)throw capabilityScopeViolation('SESSION_SOURCE_REF_MISMATCH')
  }
  if(expectedProducer&&!contextFreeCapabilities.has(capability)){
   const declaredTenant=declaredScopeValues(context,tenantScopeKeys)[0]||''
   const declaredOwner=declaredScopeValues(context,ownerScopeKeys)[0]||''
   if(expectedTenant&&declaredTenant!==expectedTenant)throw capabilityScopeViolation(declaredTenant?'TENANT_MISMATCH':'MISSING_TENANT_SCOPE',{expectedTenantId:expectedTenant,actualTenantId:declaredTenant||null})
   if(expectedOwner&&declaredOwner!==expectedOwner)throw capabilityScopeViolation(declaredOwner?'OWNER_MISMATCH':'MISSING_OWNER_SCOPE',{expectedOwnerId:expectedOwner,actualOwnerId:declaredOwner||null})
  }
 }
 return true
}

export function validateActiveContext({activeContext,context={},clientId='',tenantId='',ownerId='',requireRecordScope=false}={}){
 if(activeContext==null)return null
 if(!activeContext||typeof activeContext!=='object'||Array.isArray(activeContext))throw scopeError('O contexto ativo enviado não é válido.',400,'val_active_context_invalid')
 const type=clean(activeContext.type,80).toLowerCase()
 const id=clean(activeContext.id,180)
 if(type==='visit_draft'){
  const draftId=id||'rascunho'
  return Object.freeze({type,id:draftId,label:clean(activeContext.label,180),source_ref:`visit_draft:${draftId}`})
 }
 if(!type||!id)throw scopeError('O contexto ativo precisa informar tipo e identificador.',400,'val_active_context_invalid')
 if(type==='agronomic_tool'){
  if(!supportedAgroTools.has(id))throw scopeError('A ferramenta agronômica informada não existe neste ambiente.')
  return Object.freeze({type,id,label:clean(activeContext.label,180),source_ref:`agronomic_tool:${id}`})
 }
 if(type==='client'){
  if(String(id)!==String(clientId)&&String(id)!==String(context?.client?.id))throw scopeError('O produtor do contexto ativo não pertence à conversa atual.')
  if(requireRecordScope&&tenantId)validateConsumedRecord(context?.contextSnapshot?.context_scope,capabilityExecutionScope({context,clientId,tenantId,ownerId}),{kind:'active_client_context',requireSource:false})
  return Object.freeze({type,id:String(clientId||id),label:clean(context?.client?.name||activeContext.label,180),source_ref:`client:${clientId||id}`})
 }
 let parentRecord=null
 const collection=type==='field'?fieldRecords(context):list(context[contextCollections[type]])
 if(!contextCollections[type]&&type!=='field')throw scopeError('O tipo de contexto ativo não é suportado.',400,'val_active_context_type_invalid')
 const record=collection.find(item=>idOf(item)===id)
 if(!record)throw scopeError('O objeto ativo não pertence ao produtor e à carteira autenticados.')
 if(type==='field')parentRecord=list(context.properties).find(property=>list(property?.fields).some(field=>idOf(field)===id))||null
 if(requireRecordScope){
  const scope=capabilityExecutionScope({context,clientId,tenantId,ownerId})
  const parentScope=parentRecord?validateConsumedRecord(parentRecord,scope,{kind:'active_property'}):null
  validateConsumedRecord(record,scope,{kind:`active_${type}`,parentScope})
 }
 return Object.freeze({type,id,label:clean(record.name||record.title||record.objective||record.laboratory||activeContext.label,180),source_ref:`${type}:${id}`})
}

function descriptor(capability,{status='EXECUTED',summary='',context=null,toolResult={}}={}){
 const target=navigation[capability]||{tool:capability.toLowerCase(),title:capability,page:null,manual_page:null,mode:null}
 return Object.freeze({
  status,capability,tool:target.tool,title:target.title,summary:clean(summary,1200),
  page:target.page,manual_page:target.manual_page,mode:target.mode,context:context||null,
  ...toolResult
 })
}

function result(capability,status,toolResult,sourceRef=null){
 return Object.freeze({capability,status,source_ref:sourceRef||null,tool_result:toolResult})
}

function agronomicToolCatalogResult(){
 const availableTools=agronomicCatalogCapabilities.map(capability=>Object.freeze({capability,...navigation[capability],...agronomicCatalogPolicy[capability]}))
 const summary='Na Inteligência Agronômica há módulos para propriedades, talhões e mapeamento de áreas; análises de solo; diagnóstico por foto, incluindo NutriScan e FitoScan; nove calculadoras canônicas; bulas; clima; mercado; Manual e Biblioteca. Clima, mercado e bulas exigem fonte atual autorizada; diagnósticos exigem revisão humana; mapeamento, diagnóstico por foto e scans ainda dependem de UAT físico e agronômico. Use o ambiente especializado para aprofundar cada capacidade.'
 const tool=descriptor('AGRONOMIC_WORKSPACE',{status:'CATALOG',summary,context:{client_id:null,private_memory_used:false,catalog_version:'val.agronomic_tool_catalog.v1'},toolResult:{available_tools:availableTools}})
 return result('AGRONOMIC_WORKSPACE','EXECUTED',tool,'val.agronomic_tool_catalog.v1')
}

function mappingResult({context,clientId,activeContext,scope}){
 const properties=list(context.properties)
 const validatedProperties=validateNestedRecords(properties,scope,{kind:'property'})
 for(const {record:property,scope:propertyScope} of validatedProperties)validateNestedRecords(property?.fields,scope,{kind:'field',parentScope:propertyScope})
 const fields=fieldRecords(context)
 const mapped=fields.filter(item=>item?.geometry_ref||item?.geometryRef).length
 const summary=properties.length
  ?`${properties.length} propriedade(s) e ${fields.length} talhão(ões) autorizados; ${mapped} com geometria registrada.`
  :'Nenhuma propriedade vinculada foi encontrada; a ferramenta pode iniciar um mapeamento sem inventar geometria.'
 const sourceRef=activeContext?.source_ref||context?.contextSnapshot?.context_snapshot_id||validatedProperties[0]?.scope?.sourceRef||null
 const sourceScope=validatedProperties[0]?.scope||scope
 const tool=descriptor('AREA_MAPPING',{summary,context:{client_id:clientId||null,...(sourceScope.tenantId?{tenant_id:sourceScope.tenantId}:{}),...(sourceScope.ownerId?{context_owner_id:sourceScope.ownerId}:{}),active_context:activeContext||null},toolResult:{facts:{properties:properties.length,fields:fields.length,mapped_fields:mapped}}})
 return result('AREA_MAPPING','EXECUTED',tool,sourceRef)
}

async function calculatorResult({message,clientId,activeContext,calculatorOptions,scope}){
 const execution=await executeCopilotCalculator(message,calculatorOptions)
 const status=execution.status==='EXECUTED'?'EXECUTED':execution.status==='READY'?'READY':execution.status
 const tool=descriptor('CALCULATORS',{
  status,
  summary:execution.summary,
  context:{client_id:clientId||null,...(scope.tenantId?{tenant_id:scope.tenantId}:{}),...(scope.ownerId?{context_owner_id:scope.ownerId}:{}),active_context:activeContext||null,calculator:execution.calculator||null},
  toolResult:{
   calculator:execution.calculator||null,calculator_contract_version:execution.contract_version,
   calculator_adapter_version:execution.adapter_version,required_inputs:execution.required_inputs||[],
   catalog:execution.catalog||undefined,inputs:execution.input||execution.inputs||undefined,
   facts:execution.output||undefined,source_status:execution.status,
  },
 })
 return result('CALCULATORS',status,tool,execution.source_ref||null)
}

function soilResult({context,clientId,activeContext,scope}){
 const analyses=list(context.soilAnalyses)
 const validatedAnalyses=validateNestedRecords(analyses,scope,{kind:'soil_analysis'})
 for(const {record:analysis,scope:analysisScope} of validatedAnalyses)validateNestedRecords(analysis?.measurements,scope,{kind:'soil_measurement',parentScope:analysisScope})
 const selectedEntry=activeContext&&['soil_analysis','analysis'].includes(activeContext.type)?validatedAnalyses.find(item=>idOf(item.record)===activeContext.id):validatedAnalyses[0]
 const selected=selectedEntry?.record
 if(!selected){
  const tool=descriptor('SOIL_ANALYSIS',{status:'INPUT_REQUIRED',summary:'Nenhuma análise de solo autorizada foi encontrada. Anexe ou selecione um laudo para interpretar.',context:{client_id:clientId||null,active_context:activeContext||null}})
  return result('SOIL_ANALYSIS','INPUT_REQUIRED',tool,null)
 }
 const measurements=list(selected.measurements)
 const summary=`Análise de solo ${idOf(selected)} localizada com ${measurements.length} medição(ões); interpretação continua sujeita a método, unidade, vigência e revisão técnica.`
 const sourceScope=selectedEntry.scope
 const tool=descriptor('SOIL_ANALYSIS',{summary,context:{client_id:clientId||null,tenant_id:sourceScope.tenantId,context_owner_id:sourceScope.ownerId,analysis_id:idOf(selected),active_context:activeContext||null},toolResult:{facts:{analysis_id:idOf(selected),sampled_at:selected.sampled_at||selected.sampledAt||null,laboratory:clean(selected.laboratory,180)||null,measurement_count:measurements.length},human_review_required:true}})
 return result('SOIL_ANALYSIS','EXECUTED',tool,idOf(selected))
}

function imageResult({capability,attachments,savedAttachments,message,clientId,activeContext,scope}){
 const source=String(message||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 const wantsLatest=['NUTRISCAN','FITOSCAN'].includes(capability)&&/\b(?:ultimo|ultima|mais recente|mostr\w*|abr\w*|ver)\b/.test(source)
 if(wantsLatest){
  const scopedAttachments=validateNestedRecords(savedAttachments,scope,{kind:'attachment'})
  const candidates=scopedAttachments.map(({record:attachment,scope:attachmentScope})=>({attachment,attachmentScope,scan:attachment?.analysis?.latestScanResult}))
  for(const item of candidates){
   if(item.attachment?.analysis&&typeof item.attachment.analysis==='object')validateConsumedRecord(item.attachment.analysis,scope,{kind:'attachment_analysis',parentScope:item.attachmentScope,requireSource:false})
   if(item.scan)validateConsumedRecord(item.scan,scope,{kind:'scan_result',parentScope:item.attachmentScope})
  }
  const scan=candidates.find(item=>item.scan?.analysis_type===capability)
  if(!scan){
   const tool=descriptor(capability,{status:'NO_DATA',summary:`Nenhum ${capability==='NUTRISCAN'?'NutriScan':'FitoScan'} foi localizado neste produtor e nesta carteira.`,context:{client_id:clientId||null,active_context:activeContext||null,latest_result:true}})
   return result(capability,'NO_DATA',tool,null)
  }
  const summary=clean(scan.scan?.result?.summary,1200)||`${capability==='NUTRISCAN'?'NutriScan':'FitoScan'} localizado; o resultado permanece uma triagem assistida e exige revisão agronômica.`
  const tool=descriptor(capability,{summary,context:{client_id:clientId||null,tenant_id:scan.attachmentScope.tenantId,context_owner_id:scan.attachmentScope.ownerId,attachment_id:idOf(scan.attachment),result_reference:scan.scan.result_reference,property_id:scan.scan.property_id||null,field_id:scan.scan.field_id||null,active_context:activeContext||null,latest_result:true},toolResult:{facts:{attachment_id:idOf(scan.attachment),organization_id:scan.scan.organization_id,client_external_key:scan.scan.client_external_key||null,property_id:scan.scan.property_id||null,field_id:scan.scan.field_id||null,association:scan.scan.association,analysis_type:scan.scan.analysis_type,result_reference:scan.scan.result_reference,result_created_at:scan.scan.result_created_at,source_attachment_reference:scan.scan.attachment_id,provenance_contract_version:scan.scan.contract_version},human_review_required:true,diagnostic_status:'assisted_triage_not_prescription'}})
  return result(capability,'EXECUTED',tool,idOf(scan.attachment))
 }
 const scopedAttachments=validateNestedRecords(attachments,scope,{kind:'attachment'})
 for(const {record:attachment,scope:attachmentScope} of scopedAttachments)if(attachment?.analysis&&typeof attachment.analysis==='object')validateConsumedRecord(attachment.analysis,scope,{kind:'attachment_analysis',parentScope:attachmentScope,requireSource:false})
 const imageEntry=scopedAttachments.find(item=>imageTypes.has(String(item.record?.mimeType||item.record?.mime_type||'').toLowerCase()))
 const image=imageEntry?.record
 if(!image){
  const tool=descriptor(capability,{status:'INPUT_REQUIRED',summary:'Envie uma foto de campo para iniciar a triagem; nenhuma imagem foi presumida.',context:{client_id:clientId||null,active_context:activeContext||null},toolResult:{required_inputs:['image']}})
  return result(capability,'INPUT_REQUIRED',tool,null)
 }
 const analysis=image.analysis&&typeof image.analysis==='object'?image.analysis:null
 const interpreted=analysis&&clean(analysis.summary,1200)
 const status=interpreted?'EXECUTED':'READY'
 const summary=interpreted||'Imagem autorizada recebida. A triagem ainda precisa ser executada e não constitui diagnóstico ou prescrição.'
 const tool=descriptor(capability,{status,summary,context:{client_id:clientId||null,tenant_id:imageEntry.scope.tenantId,context_owner_id:imageEntry.scope.ownerId,attachment_id:idOf(image),active_context:activeContext||null},toolResult:{human_review_required:true,diagnostic_status:analysis?.diagnosticStatus||'not_a_diagnosis'}})
 return result(capability,status,tool,interpreted?idOf(image):null)
}

const statement=value=>clean(value,700).replace(/[.!?]+$/,'')
const sentence=value=>{const text=statement(value);return text?`${text}.`:''}
const statementKey=value=>statement(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')

function uniqueStatements(values=[],limit=8){
 const seen=new Set();const output=[]
 for(const value of values){const text=statement(value);const key=statementKey(text);if(!key||seen.has(key))continue;seen.add(key);output.push(text);if(output.length>=limit)break}
 return output
}

function deterministicExplanation({previousText='',thesis=null,facts=[],uncertainty=null,nextAction=null}={}){
 if(clean(previousText,1200)===groundingBlockedAnswer)return groundingBlockedAnswer
 const previousSentence=clean(previousText,600).match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim()||clean(previousText,600)
 const anchor=thesis||previousSentence
 const parts=[]
 if(anchor)parts.push(`A leitura anterior foi: ${sentence(anchor)}`)
 if(facts.length)parts.push(`Ela se apoia nos fatos já presentes na sessão: ${facts.slice(0,3).map(statement).join('; ')}.`)
 if(uncertainty)parts.push(`A principal incerteza continua sendo: ${sentence(uncertainty)}`)
 // "Próximo passo" é um marcador semântico de OPPORTUNITY. Em um follow-up
 // PROFILE ele reclassificava o próprio rótulo processual como conteúdo
 // comercial, embora a ação reutilizada continuasse estritamente no turno.
 // O rótulo neutro preserva a ação original; qualquer domínio estrangeiro no
 // conteúdo da ação ainda é avaliado e bloqueado pelo grounding claim-by-claim.
 if(nextAction)parts.push(`A ação indicada na resposta foi: ${sentence(nextAction)}`)
 if(!thesis&&!facts.length&&previousText)parts.push('A sessão não contém tese ou fatos estruturados adicionais; explicar além disso exigiria recomputar a resposta.')
 return clean(parts.join(' '),1200)
}

function sessionCommandResult({route,context,clientId,scope}){
 const command=route.session_command?.command
 const rawState=context?.conversationState||{}
 const scopedClient=context?.client||(clientId?{id:clientId}:null)
 const normalizedState=normalizeConversationState(rawState,{tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId,contextEpoch:scope.contextEpoch,clientId,client:scopedClient})
 const latestAssistant=normalizedState.conversation_turns.findLast(item=>item?.role==='assistant'&&item?.status==='completed')
 const comparisonSubjects=[...new Set(list(latestAssistant?.subject_client_ids).map(item=>clean(item,180)).filter(Boolean))]
 const comparisonScope=comparisonSubjects.length>1&&(!clientId||comparisonSubjects.includes(clean(clientId,180)))
 const state=conversationStateContext(normalizedState,comparisonScope?{tenantId:normalizedState.tenant_id,ownerId:normalizedState.owner_id,clientId,scope:'comparison',allowedClientIds:comparisonSubjects}:{tenantId:normalizedState.tenant_id,ownerId:normalizedState.owner_id,clientId})
 const previousAssistant=lastCompletedAssistantTurn(state,{tenantId:state.tenant_id,ownerId:state.owner_id,conversationId:state.conversation_id,clientId,contextEpoch:state.context_epoch,client:scopedClient,includeCrossClient:comparisonScope,allowedClientIds:comparisonSubjects})
 const hasTurnThesis=Object.prototype.hasOwnProperty.call(previousAssistant||{},'decision_thesis')
 const turnThesis=hasTurnThesis?previousAssistant?.decision_thesis:state.current_decision_thesis
 const thesis=clean(turnThesis?.thesis,1000)||null
 const uncertainty=clean(turnThesis?.uncertainty,700)||null
 const nextAction=clean(turnThesis?.next_action,700)||null
 const hasTurnFacts=Array.isArray(previousAssistant?.facts)
 const allowedSubjects=comparisonScope?new Set(comparisonSubjects):new Set(clientId?[clean(clientId,180)]:[])
 const scopedFactItems=(hasTurnFacts?previousAssistant.facts:list(state.session_facts)).filter(item=>{
  if(!clean(item?.source_ref,180))return false
  const subjects=[...new Set([clean(item?.subject_client_id,180),...list(item?.subject_client_ids).map(value=>clean(value,180))].filter(Boolean))]
  return Boolean(allowedSubjects.size&&subjects.length)&&subjects.every(subject=>allowedSubjects.has(subject))
 })
 const sessionFacts=uniqueStatements(scopedFactItems.map(item=>item?.statement??item),16)
 const deterministicFollowUp=route.session_command?.deterministic_follow_up===true||['EXPLAIN','SHOW_NUMBERS'].includes(command)
 if(route.session_command?.requires_previous_turn&&!previousAssistant){
  const tool=descriptor('SESSION_COMMAND',{status:'INPUT_REQUIRED',summary:'Este comando precisa de uma resposta anterior na mesma conversa.',context:{client_id:clientId||null,command}})
  return result('SESSION_COMMAND','INPUT_REQUIRED',tool,null)
 }
 const previousText=clean(previousAssistant?.text||'',1200)
 const firstSentence=previousText.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim()||previousText
 const scopedComparisonSubjects=[...new Set(list(previousAssistant?.subject_client_ids).map(item=>clean(item,180)).filter(Boolean))]
 const comparisonFacts=scopedComparisonSubjects.map(subject=>scopedFactItems.find(item=>clean(item?.subject_client_id,180)===subject)?.statement).filter(Boolean)
 const summaryText=scopedComparisonSubjects.length>1
  ?clean(comparisonFacts.length===scopedComparisonSubjects.length?comparisonFacts.join(' '):previousText,500)
  :clean(firstSentence,500)
 const questionSource=Array.isArray(previousAssistant?.questions)?previousAssistant.questions:list(state.recent_questions)
 const questions=questionSource.slice(0,3).map((item,index)=>`${index+1}. ${clean(item?.question||item,400)}`).filter(Boolean)
 const sessionSourcePrefix=`session:${state.conversation_id||'stateless'}:${state.context_epoch}:`
 const trustedPriorSessionResult=state.recent_tool_results.find(item=>clean(item?.capability,80)==='SESSION_COMMAND'&&clean(item?.status,80)==='EXECUTED'&&clean(item?.source_ref,240).startsWith(sessionSourcePrefix)&&clean(item?.summary,500)&&previousText.startsWith(clean(item.summary,500)))
 const numericTurnStatements=trustedPriorSessionResult?uniqueStatements(clean(trustedPriorSessionResult.summary,500).split(/(?<=[.!?])\s+/).filter(item=>/\d/.test(item)),8):[]
 const numericFacts=uniqueStatements([...sessionFacts.filter(item=>/\d/.test(item)),...numericTurnStatements],8)
 const explain=deterministicExplanation({previousText,thesis,facts:sessionFacts,uncertainty,nextAction})
 const numbers=numericFacts.length?`Fatos numéricos já presentes na sessão: ${numericFacts.map(item=>sentence(item)).join(' ')}`:'Não há fatos numéricos estruturados na resposta anterior ou nesta sessão.'
 const summaries={OUTPUT_TEXT:'Preferência desta conversa alterada para texto.',OUTPUT_AUDIO:'Preferência desta conversa alterada para áudio.',DO_NOT_REGISTER:'Nada será registrado na memória confirmada.',REGISTER_LAST:'A última informação precisa passar por revisão e confirmação humana.',REPEAT:previousText||'A resposta anterior foi localizada na conversa.',SUMMARIZE:summaryText||'A resposta anterior foi localizada para resumo.',EXPLAIN:explain||'A resposta anterior não contém tese, fatos ou texto suficientes para explicação.',GOLDEN_QUESTIONS:questions.join('\n')||'A resposta anterior não contém Perguntas de Ouro estruturadas.',SHOW_NUMBERS:numbers,DEEPEN:'A próxima resposta pode usar raciocínio aprofundado.',BRIEF:'A próxima resposta deve trazer apenas o essencial.'}
 const status=command==='SHOW_NUMBERS'&&!numericFacts.length?'NO_DATA':'EXECUTED'
 const toolContext={client_id:clientId||null,...(clientId&&scope.tenantId?{tenant_id:scope.tenantId}:{}),...(clientId&&scope.ownerId?{context_owner_id:scope.ownerId}:{}),command,conversation_id:state.conversation_id||'stateless',context_epoch:state.context_epoch,source_turn_created_at:previousAssistant?.created_at||null,conversation_only:true,...(deterministicFollowUp?{deterministic_follow_up:true,full_context_required:false,model_required:false,reused_thesis:Boolean(thesis),reused_fact_count:sessionFacts.length,reused_previous_response:Boolean(previousText)}:{})}
 const toolResult=command==='SHOW_NUMBERS'?{facts:{numeric_facts:numericFacts}}:{}
 const tool=descriptor('SESSION_COMMAND',{status,summary:summaries[command]||'Comando da conversa reconhecido.',context:toolContext,toolResult})
 return result('SESSION_COMMAND',status,tool,`session:${state.conversation_id||'stateless'}:${state.context_epoch}:${command}`)
}

function liveDataResult({capability,liveData,scope}){
 const record=liveData?.[capability]||liveData?.[capability.toLowerCase()]||null
 const current=record&&record.source&&record.observed_at&&record.status!=='UNAVAILABLE'
 if(!current){
  const tool=descriptor(capability,{status:'NO_DATA',summary:'A fonte atual autorizada não devolveu um registro com origem e data. A VAL falhou fechada.',context:{current_data_required:true}})
  return result(capability,'NO_DATA',tool,null)
 }
 const global=explicitlyGlobalContext(record)
 let globalOrigin=null
 if(global){
  globalOrigin=validateGlobalLiveScope(record,scope,`live_${capability.toLowerCase()}`)
 }else{
  if(globalLiveCapabilities.has(capability)&&!declaredScopeTreeValues(record,producerScopeKeys).length)throw capabilityScopeViolation('MISSING_GLOBAL_SCOPE',{sourceKind:`live_${capability.toLowerCase()}`})
  validateConsumedRecord(record,scope,{kind:`live_${capability.toLowerCase()}`})
 }
 const sourceRef=clean(record.source_ref||record.id,180)||null
 const tool=descriptor(capability,{summary:clean(record.summary||'Fonte atual consultada com origem e data identificadas.',1200),context:{...(global?{scope:globalOrigin.scope,producer_id:null,tenant_id:globalOrigin.tenantId,context_owner_id:globalOrigin.ownerId}:{client_id:scope.producerId||null,tenant_id:scope.tenantId,context_owner_id:scope.ownerId}),current_data_required:true,observed_at:record.observed_at,valid_until:record.valid_until??record.validUntil??null,source:clean(record.source,180)}})
 return result(capability,'EXECUTED',tool,sourceRef)
}

function confirmedMemoryValue(item={}){
 const value=item.value&&typeof item.value==='object'?item.value:{}
 return clean(value.decision_maker||value.decisionMaker||value.decisor||value.who_decides||value.whoDecides||value.name||'',300)
}

function fastContextResult({capability,message,context,clientId,scope}){
 const source=String(message).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(capability==='CLIENT_CONTEXT'&&isCurrentClientIdentityRequest(source)){
  const clientName=clean(context?.client?.name,180)
  const status=clientName?'EXECUTED':'NO_DATA'
  const summary=clientName?`Produtor atual: ${clientName}.`:'Não consegui confirmar o produtor atual no contexto autorizado.'
  if(clientName&&(!scope.tenantId||!scope.ownerId))throw capabilityScopeViolation(!scope.tenantId?'MISSING_TENANT_SCOPE':'MISSING_OWNER_SCOPE',{sourceKind:'client_context'})
  if(clientName&&context?.contextSnapshot?.context_scope)validateConsumedRecord(context.contextSnapshot.context_scope,scope,{kind:'client_context_scope',requireSource:false})
  return result(capability,status,descriptor(capability,{status,summary,context:{client_id:clientId||null,...(scope.tenantId?{tenant_id:scope.tenantId}:{}),...(scope.ownerId?{context_owner_id:scope.ownerId}:{}),current_client_only:true}}),clientName?`client:${clientId}`:null)
 }
 if(capability==='CONFIRMED_MEMORY'&&/\b(?:quem decide|decisor)\b/.test(source)){
  const scopedMemories=validateNestedRecords(context.memories,scope,{kind:'confirmed_memory'})
  const memoryEntry=scopedMemories.find(item=>String(item.record?.status||'').toLowerCase()==='verified'&&String(item.record?.memory_state||item.record?.memoryState||'FACT').toUpperCase()==='FACT'&&(/decis|quem decide/i.test(String(item.record?.key||''))||confirmedMemoryValue(item.record)))
  const memory=memoryEntry?.record
  const value=memory&&confirmedMemoryValue(memory)
  const status=value?'EXECUTED':'NO_DATA';const summary=value?`Decisor confirmado: ${value}.`:'Nenhum decisor confirmado foi localizado para este produtor.'
  const sourceScope=memoryEntry?.scope||scope
  return result(capability,status,descriptor(capability,{status,summary,context:{client_id:clientId,...(value?{tenant_id:sourceScope.tenantId,context_owner_id:sourceScope.ownerId}:{}),confirmed_memory_only:true,source_type:clean(memory?.source_type??memory?.sourceType,120)||'confirmed_memory',epistemic_type:clean(memory?.epistemic_type??memory?.epistemicType??memory?.memory_state??memory?.memoryState,40).toUpperCase()||'FACT',observed_at:memory?.observed_at??memory?.observedAt??memory?.updated_at??memory?.updatedAt??memory?.created_at??memory?.createdAt??null,valid_until:memory?.valid_until??memory?.validUntil??null}}),value?idOf(memory):null)
 }
 if(capability==='COMMERCIAL_HISTORY'&&/\bcompromisso\b/.test(source)){
  const scopedCommitments=validateNestedRecords(context.commitments,scope,{kind:'commitment'})
  const openEntry=scopedCommitments.filter(item=>!['COMPLETED','CANCELLED','REJECTED','DONE','CONCLUIDO','CANCELADO'].includes(String(item.record?.status||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase())).sort((left,right)=>new Date(left.record?.due_at||left.record?.dueAt||left.record?.updated_at||0)-new Date(right.record?.due_at||right.record?.dueAt||right.record?.updated_at||0))[0]
  const open=openEntry?.record
  const description=clean(open?.description||open?.action,500);const due=clean(open?.due_at||open?.dueAt,40)
  const status=description?'EXECUTED':'NO_DATA';const summary=description?`Compromisso aberto: ${description}${due?` — prazo ${due}`:''}.`:'Nenhum compromisso aberto foi localizado.'
  const sourceScope=openEntry?.scope||scope
  return result(capability,status,descriptor(capability,{status,summary,context:{client_id:clientId,...(description?{tenant_id:sourceScope.tenantId,context_owner_id:sourceScope.ownerId}:{}),commitment_id:idOf(open)||null,source_type:'commitment',epistemic_type:'FACT',observed_at:open?.updated_at??open?.updatedAt??open?.created_at??open?.createdAt??null,valid_until:open?.valid_until??open?.validUntil??null}}),description?idOf(open):null)
 }
 if(capability==='CLIENT_CONTEXT'&&/\b(?:resume|resuma|resumo)\b/.test(source)){
  if(!scope.tenantId||!scope.ownerId||!context?.contextSnapshot?.context_scope)throw capabilityScopeViolation(!scope.tenantId?'MISSING_TENANT_SCOPE':!scope.ownerId?'MISSING_OWNER_SCOPE':'MISSING_CLIENT_CONTEXT_SOURCE',{sourceKind:'client_context'})
  validateConsumedRecord(context.contextSnapshot.context_scope,scope,{kind:'client_context_scope',requireSource:false})
  validateNestedRecords(context.visits,scope,{kind:'visit'})
  validateNestedRecords(context.opportunities,scope,{kind:'opportunity'})
  const clientName=clean(context?.client?.name,180)||'Produtor';const visits=list(context.visits).length;const opportunities=list(context.opportunities).filter(item=>String(item?.stage||'').toLowerCase()!=='fechado').length
  return result(capability,'EXECUTED',descriptor(capability,{summary:`${clientName}: ${visits} visita(s) e ${opportunities} oportunidade(s) aberta(s) no contexto autorizado.`,context:{client_id:clientId,...(scope.tenantId?{tenant_id:scope.tenantId}:{}),...(scope.ownerId?{context_owner_id:scope.ownerId}:{})}}),context?.contextSnapshot?.context_snapshot_id||null)
 }
 return result(capability,'PLANNED',null,null)
}

const cancelled=value=>value?.reason instanceof Error?value.reason:Object.assign(new Error('A execução da ferramenta foi cancelada.'),{name:'AbortError',statusCode:499,code:'val_tool_cancelled',safeToRetry:true})
const throwIfCancelled=signal=>{if(signal?.aborted)throw cancelled(signal)}

export async function executeCapabilityPlan(options={}){
 const {route={},message='',context={},attachments=[],clientId='',tenantId='',ownerId='',conversationId='',contextEpoch,activeContext=null,liveData={},calculatorOptions={},signal}=options
 throwIfCancelled(signal)
 const scope=capabilityExecutionScope({context,clientId,tenantId,ownerId,conversationId,...(own(options,'contextEpoch')?{contextEpoch}:{})})
 const validatedContext=activeContext?validateActiveContext({activeContext,context,clientId,tenantId:scope.tenantId,ownerId:scope.ownerId,requireRecordScope:true}):null
 const results=[]
 for(const capability of list(route.capabilities)){
  throwIfCancelled(signal)
  if(capability==='SESSION_COMMAND')results.push(sessionCommandResult({route,context,clientId,scope}))
  else if(capability==='AGRONOMIC_WORKSPACE'&&route.tool_hint==='AGRONOMIC_TOOL_CATALOG')results.push(agronomicToolCatalogResult())
  else if(capability==='AREA_MAPPING')results.push(mappingResult({context,clientId,activeContext:validatedContext,scope}))
  else if(capability==='CALCULATORS')results.push(await calculatorResult({message,clientId,activeContext:validatedContext,calculatorOptions:{...calculatorOptions,signal},scope}))
  else if(capability==='SOIL_ANALYSIS')results.push(soilResult({context,clientId,activeContext:validatedContext,scope}))
  else if(['IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(capability))results.push(imageResult({capability,attachments,savedAttachments:context.attachments,message,clientId,activeContext:validatedContext,scope}))
  else if(['MARKET_COMMODITY','WEATHER','LABELS'].includes(capability)&&route.path==='LIVE_DATA')results.push(liveDataResult({capability,liveData,scope}))
  else if(route.path==='FAST'&&['CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY'].includes(capability))results.push(fastContextResult({capability,message,context,clientId,scope}))
  else results.push(result(capability,'PLANNED',null,null))
  throwIfCancelled(signal)
 }
 const used=results.filter(item=>item.status==='EXECUTED').map(item=>item.capability)
 const primary=results.find(item=>item.tool_result&&['EXECUTED','INPUT_REQUIRED','READY','NO_DATA','SOURCE_UNAVAILABLE'].includes(item.status))?.tool_result||null
 const execution=deepFreeze({
  version:capabilityExecutorVersion,
  path:route.path,
  capabilities_planned:[...list(route.capabilities)],
  capabilities_used:used,
  capability_results:results,
  tool_result:primary,
  active_context:validatedContext,
  reasoning_required:Boolean(route.materiality?.engine_required&&(route.path!=='TOOL'||['READY','EXECUTED'].includes(primary?.status)))
 })
 trustedCapabilityExecutions.add(execution)
 return execution
}

// Texto exposto quando nada na Biblioteca de Conhecimento cobre a pergunta. Extraida como
// constante para buildGeneralNoClientResponse detectar com seguranca quando deve tentar o
// fallback de conhecimento geral do modelo, sem duplicar a string em dois lugares.
const noKnowledgeCoverageStub='Posso tratar esta dúvida sem selecionar um produtor e sem consultar memória privada. Informe a cultura, o conceito ou a decisão geral que deseja entender; dados atuais e recomendações técnicas continuam exigindo fonte, contexto e revisão.'

// Um cumprimento puro ("oi", "bom dia") não tem nenhuma palavra com 4+ letras para o
// mecanismo de relevância comparar contra a resposta, e nunca deveria acionar a busca na
// Knowledge Library — o retriever de lá sempre devolve algum item mesmo sem relação real
// com a pergunta (não tem piso de relevância), e esse item aleatório é que falhava o
// grounding, não o cumprimento em si. Resolvido com resposta fixa antes da busca.
const greetingOnlyRequest=/^\s*(?:val[, ]+)?(oi+|ol[aá]|opa|e\s*a[ií]|eae|hey|hi|hello|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|como\s*vai|como\s*voc[eê]\s*est[aá]|beleza)(?:[\s!.,]*(?:val|viu|hein))?[\s!.,?]*$/i
// Agradecimento ou fechamento ("obrigado", "valeu", "perfeito") tambem nao e pergunta: sem esta
// resposta fixa, "Obrigado!" caia na Biblioteca e terminava em bloqueio de evidencia.
const thanksOnlyRequest=/^\s*(?:val[, ]+)?(?:(?:muito\s+)?(?:obrigad[oa]s?|valeu|show|perfeito|entendi|certo|ok|okay|blz|t[aá]\s*bom|combinado|legal|beleza)[\s!.,?]*){1,3}(?:(?:val|viu|hein|demais|mesmo)[\s!.,?]*)?$/i

// Resposta geral com a sua proveniência: de onde veio o texto (definição fixa, item da Biblioteca
// ou ausência de cobertura) e, quando veio da Biblioteca, como o item foi selecionado. O mesmo
// objeto é recomputado em validateGeneralGuidanceSource, byte a byte, para que um envelope forjado
// não ganhe a confiança do item curado.
const curatedGuidance=(summary,coverage='CURATED')=>Object.freeze({summary,knowledge_item_id:null,knowledge_match:null,coverage})
function generalGuidance(message=''){
 const source=String(message).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(isCurrentClientIdentityRequest(source))return curatedGuidance('Nenhum produtor está selecionado nesta conversa.')
 const greetingMatch=greetingOnlyRequest.exec(String(message||''))
 if(greetingMatch){const greetingText=greetingMatch[1];return curatedGuidance(`${greetingText.charAt(0).toUpperCase()}${greetingText.slice(1)}, posso ajudar com dúvidas gerais, agronomia, mercado ou sobre um produtor específico.`)}
 if(thanksOnlyRequest.test(String(message||'')))return curatedGuidance('Disponha. Posso ajudar com dúvidas gerais, agronomia, mercado ou sobre um produtor específico.')
 if(/\bmargem\b/.test(source))return curatedGuidance('Margem é a diferença entre receita e custos. Em percentual, divida a margem em valor pela receita e multiplique por 100; confirme quais custos entram na comparação.')
 if(/\broi\b|retorno sobre investimento/.test(source))return curatedGuidance('ROI compara o ganho líquido com o investimento: (retorno menos investimento) dividido pelo investimento. Informe período, custos e premissas para evitar uma precisão falsa.')
 if(/\bcusto\s*\/\s*ha|custo por hectare/.test(source))return curatedGuidance('Custo por hectare é o custo total dividido pela área efetivamente considerada. Informe ambos com unidade e período para a VAL calcular.')
 if(/\bctc\b/.test(source))return curatedGuidance('CTC representa a capacidade do solo de reter e trocar cátions. Sua interpretação depende do método, da camada amostrada, do pH e das demais medições do laudo.')
 if(/\bph\b/.test(source))return curatedGuidance('O pH indica a acidez ou alcalinidade do solo e influencia disponibilidade de nutrientes e manejo de correção. A interpretação prática depende do método, da camada, da cultura e das demais medições do laudo.')
 const governed=governedGeneralAnswer(message)
 if(governed)return Object.freeze({summary:governed.text,knowledge_item_id:governed.knowledge_item_id,knowledge_match:governed.knowledge_match,coverage:'LIBRARY'})
 return curatedGuidance(noKnowledgeCoverageStub,'NONE')
}
function generalAnswer(message=''){return generalGuidance(message).summary}

// Bloqueia o fallback de IA nao verificada para qualquer pergunta com cheiro de decisao
// prescritiva ou de dado vivo: dose/produto/defensivo (mesmo padrao de explicitAgronomyRequest
// em val-engine.js), credito/financiamento especifico, ou cotacao/clima/hoje/agora. Essas
// classes de pergunta continuam exigindo fonte real e responsavel tecnico; conhecimento geral
// do modelo nunca deve preencher essa lacuna.
const highStakesGeneralRequest=/\b(?:(?:qual|quais|quanto|quantos|calcule|indique|recomende|prescreva|monte|fa[cç]a|devo|posso|como)\b.{0,80}\b(?:dose|dosagem|mistura|produto|defensivo|fungicida|herbicida|inseticida|aduba[cç][aã]o|calagem|receita agron[oô]mica|diagn[oó]stico)\b|(?:aplique|misture|prescreva|diagnostique)\b|\b(?:financiamento|emprestimo|empr[eé]stimo|credito|cr[eé]dito|taxa de juros|parcelamento)\b.{0,40}\b(?:aprovar|aprovacao|liberar|liminar|contratar|contrata[cç][aã]o|limite)\b|\b(?:cota[cç][aã]o|preco atual|pre[cç]o atual|clima atual|previsao do tempo|previs[aã]o do tempo|quanto est[aá]|quanto esta)\b|\bhoje\b|\bagora\b)/i

// Ultima camada antes de deixar o modelo responder sem fonte: alem do bloqueio lexico acima,
// a propria instrucao ao modelo pede que ele recuse (sentinela PRECISA_FONTE) qualquer pergunta
// que dependa de dado atual, especifico do produtor, ou de uma decisao tecnica prescritiva.
const aiUnverifiedRefusalSentinel='PRECISA_FONTE'
const aiUnverifiedSourceRef='system:ai-general-knowledge:v1'

// Estimativa conservadora para o tier "fast" (config.modelFast) — não há tabela de preço
// real para os modelos internos deste projeto, então isto é propositalmente uma estimativa
// documentada (padrão de tier econômico), suficiente para o teto de orçamento por login
// funcionar como trava de segurança, não como faturamento exato.
const aiGeneralKnowledgePricePerMillionInputTokensUsd=.15
const aiGeneralKnowledgePricePerMillionOutputTokensUsd=.6
const estimateAiGeneralKnowledgeCostUsd=usage=>{
 const inputTokens=Number(usage?.input_tokens)||0
 const outputTokens=Number(usage?.output_tokens)||0
 return Number((inputTokens*aiGeneralKnowledgePricePerMillionInputTokensUsd/1_000_000+outputTokens*aiGeneralKnowledgePricePerMillionOutputTokensUsd/1_000_000).toFixed(8))
}

async function unverifiedModelKnowledgeAnswer({message='',aiClient=null,model=''}={}){
 if(!aiClient||!model)return {text:'',costUsd:0}
 if(highStakesGeneralRequest.test(String(message||'')))return {text:'',costUsd:0}
 const instructions='Você responde SOMENTE com conhecimento geral, amplamente estabelecido e atemporal, em português do Brasil, em no máximo 3 frases curtas.\n'+
  'Nunca informe: preço ou cotação atual, previsão do tempo, dose ou produto específico, recomendação técnica prescritiva, ou qualquer dado que dependeria do contexto de um produtor específico.\n'+
  'Se a pergunta pedir qualquer coisa dessas, ou depender de dado atual, responda apenas com a palavra '+aiUnverifiedRefusalSentinel+', sem mais nada.'
 let response
 try{
  response=await aiClient.responses.create({model,instructions,input:[{role:'user',content:clean(message,2000)}],max_output_tokens:400,text:{format:{type:'text'}}})
 }catch{return {text:'',costUsd:0}}
 const costUsd=estimateAiGeneralKnowledgeCostUsd(response?.usage)
 const text=clean(response?.output_text,1200)
 if(!text||text.toUpperCase().includes(aiUnverifiedRefusalSentinel))return {text:'',costUsd}
 return {text,costUsd}
}

// Consulta a Knowledge Library governada (server/knowledge) antes de recorrer ao texto
// genérico de esclarecimento. Arredondado ao minuto para que a nova chamada de
// validação em validateGeneralGuidanceSource produza o mesmo texto byte a byte.
function governedGeneralAnswer(message){
 const now=new Date(Math.floor(Date.now()/60_000)*60_000)
 let selection
 try{selection=selectKnowledge({query:String(message||''),modules:['MCTX','MDI','MVV','MIA','MIC'],geography:'General',limit:1,now})}
 catch{return null}
 const item=selection?.items?.[0]
 if(!item?.statement)return null
 // application_val é nota interna de engenharia (ex.: "MDI usa X para separar Y pago na
 // praça do produtor") e menciona "produtor" genericamente; incluí-la aqui já disparou
 // GLOBAL_PRODUCER_SPECIFIC_CLAIM no grounding por parecer uma afirmação individual.
 // Só o princípio (statement) é apropriado para fala/exibição direta ao usuário.
 const caveat=item.requires_human_review?' A execução prática continua exigindo responsável técnico habilitado.':''
 // Frase inteira de trigger contida na pergunta, ou termo discriminante/maioria do título, é o
 // curador dizendo "este item responde sobre X": relevância atestada pela seleção. Casamento
 // apenas lexical continua sujeito ao overlap do grounding a jusante.
 const match=describeSelectionMatch({query:String(message||''),item}).match
 return {text:`${item.statement}`.replace(/\s+/g,' ').trim()+caveat,knowledge_item_id:clean(item.knowledge_item_id,80)||null,knowledge_match:match}
}

// Reconhece perguntas conceituais gen\u00e9ricas (agronomia, comercial, etc.) pelo formato
// da pergunta, n\u00e3o por uma lista fixa de termos \u2014 sem isso, qualquer conceito fora de
// ctc/ph/margem/roi/custo-ha ca\u00eda no bloqueio "selecione um produtor", mesmo sem
// nenhuma refer\u00eancia a um produtor, cliente ou dado espec\u00edfico. Uma lista fechada de
// frases de abertura ("o que \u00e9", "explique"...) vira ca\u00e7a a fantasma a cada nova forma de
// perguntar ("qual o...", "por que..."); em vez disso, qualquer pergunta sem refer\u00eancia a um
// produtor/cliente/dado espec\u00edfico \u00e9 tratada como geral. Isso nunca exp\u00f5e dado privado: o
// caminho geral (generalAnswer/governedGeneralAnswer) nunca consulta base de produtor, e o
// grounding a jusante continua exigindo evid\u00eancia real para qualquer afirma\u00e7\u00e3o factual.
function isGeneralConceptRequest(message=''){
 const original=String(message).replace(/\s+/g,' ').trim()
 const source=original.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 const contextual=/\b(?:deste|desse|dessa|desta|daquele|daquela|daquilo|atual|selecionad[oa]|produtor|cliente|conta|oportunidade|visita|talhao|propriedade|laudo|analise|fazenda|dele|dela)\b/.test(source)
 if(contextual)return false
 const questionShape=/^(?:o que|que|qual|quais|como|por\s*que|quando|quanto|quantos|quantas|quem|onde|explique|defina|resuma|me\s+(?:explic[ae]|fal[ae]|conta)|(?:eu\s+)?(?:quero|queria|gostaria\s+de|preciso)\s+(?:saber|entender|aprender))\b/.test(source)
 return questionShape||/\?\s*$/.test(original)
}

function isPureAbsenceOrInputSummary(value=''){
 const source=clean(value,1200)
 if(!source)return false
 const clauses=source.split(/(?:[.!?]+\s+|;\s*)/).map(item=>item.trim()).filter(Boolean)
 const safeLead=/^(?:nenhum(?:a)?\b|n[aã]o h[aá]\b|ainda n[aã]o h[aá]\b|a fonte atual autorizada n[aã]o\b|este comando precisa\b|envie\b|informe\b|selecione\b|anexe\b|forne[cç]a\b|confirme\b|tente\b|a val falhou fechada\b)/i
 return clauses.length>0&&clauses.every(clause=>safeLead.test(clause))
}

export function buildCapabilityExecutionResponse({execution,route,message='',organizationId='unknown',ownerId='',clientId='',clientName='',conversationId='',contextEpoch=0,contextDomain='',now=new Date(),executionCounts={}}={}){
 const createdAt=(now instanceof Date?now:new Date(now)).toISOString()
 if(!exactEpoch(contextEpoch))throw capabilityScopeViolation('INVALID_CONTEXT_EPOCH')
 validateCapabilityExecutionScope({execution,clientId,tenantId:organizationId,ownerId})
 const tool=execution?.tool_result||null
 const contextRequired=tool?.status==='CONTEXT_REQUIRED'
 const summary=clean(tool?.summary||'A capacidade solicitada não produziu resultado factual.',1200)
 const selectedDomain=contextDomain||classifyValContextDomain(message,route?.intent)
 const executedSources=list(execution?.capability_results).filter(item=>item.status==='EXECUTED'&&item.source_ref)
 if(!executedSources.length&&!clientId&&tool?.status==='EXECUTED'&&tool?.capability==='GENERAL_GUIDANCE')executedSources.push({capability:'GENERAL_GUIDANCE',status:'EXECUTED',source_ref:'system:general-guidance:v1',tool_result:tool})
 if(executedSources.some(item=>clean(item?.capability,80).toUpperCase()==='SESSION_COMMAND')&&!trustedCapabilityExecutions.has(execution))throw capabilityScopeViolation('SESSION_SOURCE_UNVERIFIED')
 for(const item of executedSources)if(clean(item?.capability,80).toUpperCase()==='GENERAL_GUIDANCE')validateGeneralGuidanceSource(item,message)
 validateCapabilitySourceBinding({sources:executedSources,clientId,tenantId:organizationId,ownerId,conversationId,contextEpoch,route})
 const sourceRefs=executedSources.map(item=>{
  const capability=clean(item.capability,80).toUpperCase()
  const context=item.tool_result?.context||{}
  const live=['MARKET_COMMODITY','WEATHER','LABELS'].includes(capability)
  const globalSource=explicitlyGlobalContext(context)
  const globalOrigin=globalSource?validateGlobalLiveScope({...context,source_ref:item.source_ref},{tenantId:clean(organizationId,180),ownerId:clean(ownerId,180)},`response_${capability.toLowerCase()}`):null
  const sourceType=live?'market_snapshot':capability==='AGRONOMIC_WORKSPACE'?'official_product_catalog':capability==='SESSION_COMMAND'?'conversation_turn':capability==='CLIENT_CONTEXT'?'client_registration':capability==='CONFIRMED_MEMORY'?clean(context.source_type,120).toLowerCase()||'confirmed_memory':capability==='COMMERCIAL_HISTORY'?'commitment':capability==='SOIL_ANALYSIS'?'soil_analysis':['IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(capability)?'attachment_analysis':capability==='AREA_MAPPING'?'context_snapshot':capability==='CALCULATORS'?'calculation':capability==='AI_GENERAL_KNOWLEDGE'?'model_general_knowledge':capability==='GENERAL_GUIDANCE'?'general_knowledge':'system_capability'
  const sourceEpistemic=capability==='SESSION_COMMAND'?'INFERENCE':capability==='CONFIRMED_MEMORY'?clean(context.epistemic_type,40).toUpperCase()||'FACT':['SOIL_ANALYSIS','IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(capability)?'OBSERVATION':'FACT'
  const sourceObservedAt=capability==='SESSION_COMMAND'?context.source_turn_created_at:live?context.observed_at:capability==='CONFIRMED_MEMORY'||capability==='COMMERCIAL_HISTORY'?context.observed_at:capability==='SOIL_ANALYSIS'?item.tool_result?.facts?.sampled_at:['IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(capability)?item.tool_result?.facts?.result_created_at:createdAt
  const sourceValidUntil=context.valid_until??null
  return {
   id:item.source_ref,source_ref:item.source_ref,source_type:sourceType,
   epistemic_type:sourceEpistemic,evidence_type:sourceEpistemic,
   ...(globalSource?{scope:globalOrigin.scope,producer_id:null}:clientId?{producer_id:String(clientId)}:capability==='SESSION_COMMAND'?{}:{scope:'GENERAL_KNOWLEDGE'}),
   tenant_id:globalSource?globalOrigin.tenantId:String(organizationId),...(globalSource?{context_owner_id:globalOrigin.ownerId}:ownerId?{owner_id:String(ownerId)}:{}),
   ...(sourceObservedAt?{observed_at:sourceObservedAt}:{}),...(sourceValidUntil?{valid_until:sourceValidUntil}:{}),statement:clean(item.tool_result?.summary||summary,1200),capability
  }
 })
 const client={id:clientId||'portfolio',name:clean(clientName,180)||'Carteira'}
 const hash=createHash('sha256').update(JSON.stringify({organizationId,clientId,message,tool:tool?.tool||null,createdAt:createdAt.slice(0,13)})).digest('hex')
 const count=(value,fallback=0)=>Math.max(0,Number.isFinite(Number(value))?Number(value):fallback)
 const entityResolutions=count(executionCounts.entityResolutions)
 const dataLookups=count(executionCounts.dataLookups)
 const toolCalls=count(executionCounts.toolCalls,tool&&list(execution?.capabilities_used).length?1:0)
 const hops=count(executionCounts.hops,entityResolutions+dataLookups+toolCalls)
 const executionBudget=Object.freeze({entityResolutions,dataLookups,modelCalls:0,toolCalls,hops,estimatedInputTokens:0,estimatedOutputTokens:0,estimatedCostUsd:0})
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client,
  context_snapshot:{id:`tool-${hash.slice(0,16)}`,version:'val.tool_context.v1',confidence:{level:execution?.capabilities_used?.length?'VERIFICADO':'INSUFICIENTE'},hash},
  conversation_id:clean(conversationId,180)||'stateless',intent:route?.intent||'ASK_GENERAL',persistence_mode:'NONE',objective:clean(message,1200)||tool?.title||'Executar capacidade',situation_summary:summary,
  key_signals:[],facts_used:sourceRefs,hypotheses:[],missing_information:tool?.required_inputs||[],
  decision_thesis:{CURRENT_SITUATION:summary,WHAT_MATTERS:contextRequired?'A solicitação depende de um produtor autorizado selecionado.':'A ferramenta precisa produzir evidência própria antes de qualquer síntese.',KEY_UNCERTAINTY:contextRequired?'Nenhum produtor autorizado está ativo nesta conversa.':tool?.status==='INPUT_REQUIRED'?'Faltam entradas materiais para executar com segurança.':'O resultado ainda depende de validação humana quando houver decisão técnica.',THESIS:summary,WHY:'A resposta reflete somente o adapter e os dados autorizados desta requisição.',WHAT_TO_VALIDATE:contextRequired?'Selecione explicitamente um produtor da carteira autorizada.':'Confirme contexto, unidades, fonte e vínculo antes de usar o resultado.',WHAT_WOULD_CHANGE_MY_VIEW:contextRequired?'A seleção de um produtor autorizado.':'Novas entradas confirmadas ou uma execução técnica revisada.'},
  golden_questions:[],recommended_strategy:{reading:summary,action:contextRequired?'Selecione um produtor autorizado para continuar.':tool?.status==='INPUT_REQUIRED'?'Forneça apenas as entradas faltantes.':'Revise o resultado e abra a ferramenta para aprofundar.',do_not_do:'Não transformar disponibilidade da ferramenta em cálculo, diagnóstico ou prescrição.'},evidence_to_use:sourceRefs,
  agronomic_context:{status:['AREA_MAPPING','CALCULATORS','SOIL_ANALYSIS','IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(tool?.capability)?'tool_result':'not_applicable',human_review_required:Boolean(tool?.human_review_required),sources:{}},commercial_context:{status:'not_applicable'},next_commitment:contextRequired?'Selecionar o produtor autorizado.':tool?.status==='INPUT_REQUIRED'?'Completar as entradas materiais.':'Validar o resultado antes de decidir.',risks:[],confidence:{level:execution?.capabilities_used?.length?'VERIFICADO':'INSUFICIENTE',score:execution?.capabilities_used?.length?.9:.2,rationale:'Confiança limitada à execução factual da capability; nenhuma capability planejada é contada como usada.'},reasoning_confidence:{version:'val.reasoning_confidence.v1',context:execution?.active_context?.source_ref?.length?.9:.5,thesis:.8,question:.8,agronomy:tool?.human_review_required?.5:null,knowledge:1,threshold:{ask_below:.72,answer_at_or_above:.72}},knowledge_refs:[],memory_refs:[],created_at:createdAt,model:'rules-capability-executor-v1',prompt_version:'val-performance-architecture-v2',
  run:{provider:'capability-executor',model:'rules-capability-executor-v1',prompt_version:'val-performance-architecture-v2',context_hash:hash,latency_ms:0,status:'completed',fallback:false,path:route?.path||execution?.path||'TOOL',model_call_count:0,tool_call_count:toolCalls,hop_count:hops,estimated_input_tokens:0,estimated_output_tokens:0,estimated_cost_usd:0,capabilities_planned:execution?.capabilities_planned||[],capabilities_used:execution?.capabilities_used||[],capability_results:execution?.capability_results||[],tool_result:tool,latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},
  premises:{recomputed_for_request:true,source:'authorized_capability_execution',profile_specific:Boolean(clientId)&&route?.tool_hint!=='AGRONOMIC_TOOL_CATALOG',conversation_is_not_confirmed_memory:true,confirmed_memory_refs:[],context_scope:{tenant_id:String(organizationId),owner_id:ownerId?String(ownerId):null,producer_id:clientId?String(clientId):null,conversation_id:clean(conversationId,180)||'stateless',context_epoch:contextEpoch,domain:selectedDomain}},voice_output:{version:'val.voice_output.v1',speakable_text:summary,persistence:'NONE',automatic_memory_effect:false},decision_interview:{version:'val.decision_interview.v1',status:tool?.status==='INPUT_REQUIRED'?'NEEDS_INPUT':'NOT_NEEDED',questions:[],material_missing_information:tool?.required_inputs||[],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'stateless',persistence_mode:'NONE'},explanation:tool?.status==='INPUT_REQUIRED'?'Faltam entradas materiais; nenhum valor foi inventado.':'A capability respondeu sem alterar memória.'},quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{}}
 }
 const groundingBlocks=route?.session_command?{'session_turn.reading':summary,'recommended_strategy.action':reasoning.recommended_strategy.action,'session_turn.voice':summary}:{'recommended_strategy.reading':summary,'recommended_strategy.action':reasoning.recommended_strategy.action,'voice_output.speakable_text':summary}
 const evaluatedGrounding=evaluateReasoningGrounding({question:message,domain:selectedDomain,evidence:sourceRefs,activeProducerId:clientId,tenantId:String(organizationId),ownerId:String(ownerId||''),blocks:groundingBlocks,now:new Date(createdAt)})
 const scopedSessionCommand=Boolean(route?.session_command?.requires_previous_turn&&sourceRefs.length&&evaluatedGrounding.unsupported_claims.length===0&&evaluatedGrounding.scope_violations.length===0&&evaluatedGrounding.incompatible_evidence.length===0&&evaluatedGrounding.provenance_violations.length===0&&evaluatedGrounding.temporal_violations.length===0)
 const trustedGeneralGuidance=Boolean(!clientId&&sourceRefs.length===1&&sourceRefs[0].id==='system:general-guidance:v1'&&sourceRefs[0].capability==='GENERAL_GUIDANCE'&&tool?.capability==='GENERAL_GUIDANCE'&&evaluatedGrounding.question_relevance==='PASS'&&evaluatedGrounding.unsupported_claims.length===0&&evaluatedGrounding.scope_violations.length===0&&evaluatedGrounding.incompatible_evidence.length===0&&evaluatedGrounding.provenance_violations.length===0&&evaluatedGrounding.temporal_violations.length===0)
 // Resultado de calculadora: entradas e resultado já foram validados numericamente claim a claim
 // (unsupported_claims vazio) e a fonte é a própria execução determinística. O overlap lexical
 // entre "gastei 750 mil reais em 300 hectares" e "Custo calculado: R$ 2.500,00/ha" não mede nada.
 const calculatorResultGuidance=Boolean(sourceRefs.length===1&&sourceRefs[0].source_type==='calculation'&&sourceRefs[0].capability==='CALCULATORS'&&tool?.capability==='CALCULATORS'&&tool?.status==='EXECUTED'&&evaluatedGrounding.unsupported_claims.length===0&&evaluatedGrounding.scope_violations.length===0&&evaluatedGrounding.incompatible_evidence.length===0&&evaluatedGrounding.provenance_violations.length===0&&evaluatedGrounding.temporal_violations.length===0)
 // Item da Biblioteca selecionado por frase inteira de trigger: a relevância foi atestada pelo
 // curador na seleção, e o overlap lexical do grounding não pode derrubar a resposta ("janela de
 // plantio da soja" respondida pelo item do ZARC). Todas as outras barreiras seguem obrigatórias.
 const libraryTriggerGuidance=Boolean(!clientId&&sourceRefs.length===1&&sourceRefs[0].id==='system:general-guidance:v1'&&sourceRefs[0].capability==='GENERAL_GUIDANCE'&&tool?.capability==='GENERAL_GUIDANCE'&&['TRIGGER_PHRASE','TITLE_PHRASE'].includes(tool?.context?.knowledge_match)&&evaluatedGrounding.unsupported_claims.length===0&&evaluatedGrounding.scope_violations.length===0&&evaluatedGrounding.incompatible_evidence.length===0&&evaluatedGrounding.provenance_violations.length===0&&evaluatedGrounding.temporal_violations.length===0)
 const safeAbsence=Boolean(
  !sourceRefs.length
  &&['CONTEXT_REQUIRED','NO_DATA','INPUT_REQUIRED','SOURCE_UNAVAILABLE'].includes(String(tool?.status||''))
  &&isPureAbsenceOrInputSummary(summary)
  &&evaluatedGrounding.unsupported_claims.length===0
  &&evaluatedGrounding.scope_violations.length===0
  &&evaluatedGrounding.incompatible_evidence.length===0
  &&evaluatedGrounding.provenance_violations.length===0
  &&evaluatedGrounding.temporal_violations.length===0
 )
 const grounding=scopedSessionCommand&&!evaluatedGrounding.passed
  ?{...evaluatedGrounding,passed:true,question_relevance:'SCOPED_TURN_CONTENT'}
  :trustedGeneralGuidance&&!evaluatedGrounding.passed
   ?{...evaluatedGrounding,passed:true,question_relevance:'TRUSTED_GENERAL_GUIDANCE'}
  :libraryTriggerGuidance&&!evaluatedGrounding.passed
   ?{...evaluatedGrounding,passed:true,question_relevance:'LIBRARY_SELECTION_MATCH'}
  :calculatorResultGuidance&&!evaluatedGrounding.passed
   ?{...evaluatedGrounding,passed:true,question_relevance:'CALCULATOR_RESULT'}
  :safeAbsence
   ?{...evaluatedGrounding,passed:true,question_relevance:'SAFE_NO_DATA'}
   :evaluatedGrounding
 reasoning.grounding=grounding
 let answer=summary
 if(!grounding.passed){
  answer=groundingBlockedAnswer
  reasoning.situation_summary=answer
  reasoning.facts_used=[]
  reasoning.evidence_to_use=[]
  reasoning.decision_thesis={CURRENT_SITUATION:answer,WHAT_MATTERS:'A saída foi bloqueada antes de expor qualquer resultado sem suporte verificável.',KEY_UNCERTAINTY:'A origem ou o escopo do resultado não pôde ser comprovado.',THESIS:'Não usar esta execução como base de decisão.',WHY:'O grounding determinístico falhou fechado.',WHAT_TO_VALIDATE:'Confirme a fonte e o escopo em uma nova execução autorizada.',WHAT_WOULD_CHANGE_MY_VIEW:'Uma nova execução com proveniência e escopo integralmente verificados.'}
  reasoning.recommended_strategy={reading:answer,action:'Confirme a fonte e o escopo antes de continuar.',do_not_do:'Não reutilizar resultado sem proveniência verificável.'}
  reasoning.voice_output={...reasoning.voice_output,speakable_text:answer}
  reasoning.confidence={level:'INSUFICIENTE',score:.2,rationale:'O grounding determinístico bloqueou a saída sem suporte completo.'}
  reasoning.grounding={...grounding,blocked:true}
  reasoning.run={...reasoning.run,capabilities_used:[],capability_results:list(reasoning.run?.capability_results).map(item=>({capability:clean(item?.capability,80)||'UNKNOWN',status:'GROUNDING_BLOCKED',source_ref:null,tool_result:null})),tool_result:null}
 }
 const blocked=reasoning.grounding?.blocked===true
 return {route:route?.path||execution?.path||'TOOL',engineMode:'rules',model:'rules-capability-executor-v1',warning:'',responseMetadata:{toolExecutionVersion:capabilityExecutorVersion,executionBudget},advice:{answer,executive_brief:{headline:blocked?'Resposta bloqueada por grounding':tool?.title||'Capacidade da VAL',reason:answer,action:reasoning.recommended_strategy.action},next_best_action:reasoning.recommended_strategy.action,ai_reasoning:reasoning}}
}

export async function buildGeneralNoClientResponse({message='',route={},organizationId='unknown',ownerId='',conversationId='',contextEpoch=0,contextDomain='',now=new Date(),aiClient=null,aiModel=''}={}){
 const catalog=route?.tool_hint==='AGRONOMIC_TOOL_CATALOG'&&list(route.capabilities).includes('AGRONOMIC_WORKSPACE')
 const contextRequired=!catalog&&route?.client_context_required===true&&!isGeneralConceptRequest(message)
 const catalogExecution=catalog?agronomicToolCatalogResult():null
 const guidance=catalog||contextRequired?null:generalGuidance(message)
 const curatedSummary=catalog
  ?catalogExecution.tool_result.summary
  :contextRequired
   ?isCurrentClientIdentityRequest(message)?'Nenhum produtor está selecionado nesta conversa.':'Nenhum produtor está selecionado nesta conversa. Selecione um produtor autorizado para continuar.'
   :guidance.summary
 const curatedExecution=deepFreeze(catalog
  ?{path:route.path,capabilities_planned:[...list(route.capabilities)],capabilities_used:['AGRONOMIC_WORKSPACE'],capability_results:[catalogExecution],tool_result:catalogExecution.tool_result,active_context:null}
  :contextRequired
   ?{path:route.path,capabilities_planned:[...list(route.capabilities)],capabilities_used:[],capability_results:[{capability:'CLIENT_CONTEXT',status:'CONTEXT_REQUIRED',source_ref:null,tool_result:null},...list(route.capabilities).filter(capability=>capability!=='CLIENT_CONTEXT').map(capability=>({capability,status:'PLANNED',source_ref:null,tool_result:null}))],tool_result:{status:'CONTEXT_REQUIRED',capability:'CLIENT_CONTEXT',tool:'client_selector',title:'Produtor necessário',summary:curatedSummary,page:'clients',manual_page:null,mode:'select_client',context:{client_id:null,private_memory_used:false},required_inputs:['client_id']},active_context:null}
   :{path:route.path,capabilities_planned:route.capabilities||['KNOWLEDGE_LIBRARY'],capabilities_used:[],capability_results:list(route.capabilities).map(capability=>({capability,status:'PLANNED',source_ref:null,tool_result:null})),tool_result:{status:'EXECUTED',capability:'GENERAL_GUIDANCE',tool:'general_guidance',title:'Orientação geral',summary:curatedSummary,page:'copilot',manual_page:null,mode:'general',context:{client_id:null,private_memory_used:false,...(guidance?.knowledge_item_id?{knowledge_item_id:guidance.knowledge_item_id,knowledge_match:guidance.knowledge_match}:{})}},active_context:null})
 const finalize=(execution,{unverified=false}={})=>{
  trustedCapabilityExecutions.add(execution)
  const built=buildCapabilityExecutionResponse({execution,route,message,organizationId,ownerId,conversationId,contextEpoch,contextDomain,now,executionCounts:{entityResolutions:0,dataLookups:0,toolCalls:catalog?1:0,hops:catalog?1:0}})
  built.advice.ai_reasoning.client={id:'portfolio',name:'Conversa geral'}
  built.advice.ai_reasoning.premises.profile_specific=false
  built.advice.ai_reasoning.premises.source=contextRequired?'client_context_required':unverified?'ai_general_knowledge_unverified':'general_request_without_private_context'
  if(unverified&&!built.advice.ai_reasoning.grounding?.blocked){
   built.advice.ai_reasoning.confidence={level:'NAO_VERIFICADO',score:null,rationale:'Resposta de conhecimento geral do modelo, sem fonte na Biblioteca de Conhecimento; não passou por verificação de evidência ou revisão humana.'}
   built.advice.ai_reasoning.evidence_status='UNVERIFIED_MODEL_KNOWLEDGE'
  }
  return built
 }
 const curatedResponse=finalize(curatedExecution)
 // A Knowledge Library quase sempre devolve algum item (o retriever não tem piso de
 // relevância), então "nada encontrado" raramente chega como stub puro — na prática, o
 // sinal real de "esta pergunta não tem cobertura real" é o próprio grounding bloqueando
 // a resposta a jusante (item errado, sem overlap real com a pergunta). Só aí tentamos o
 // modelo sem fonte; perguntas de alto risco continuam bloqueadas dentro de
 // unverifiedModelKnowledgeAnswer independentemente do motivo do bloqueio aqui.
 if(catalog||contextRequired||curatedResponse.advice.ai_reasoning.grounding?.blocked!==true)return curatedResponse
 const {text:aiAnswer,costUsd:aiCostUsd}=await unverifiedModelKnowledgeAnswer({message,aiClient,model:aiModel})
 if(!aiAnswer)return curatedResponse
 const aiToolResult={status:'EXECUTED',capability:'AI_GENERAL_KNOWLEDGE',tool:'ai_general_knowledge',title:'Conhecimento geral do modelo (não verificado)',summary:aiAnswer,page:'copilot',manual_page:null,mode:'general_unverified',context:{client_id:null,private_memory_used:false}}
 const aiExecution=deepFreeze({path:route.path,capabilities_planned:route.capabilities||['KNOWLEDGE_LIBRARY'],capabilities_used:['AI_GENERAL_KNOWLEDGE'],capability_results:[{capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',source_ref:aiUnverifiedSourceRef,tool_result:aiToolResult}],tool_result:aiToolResult,active_context:null})
 const aiResponse=finalize(aiExecution,{unverified:true})
 aiResponse.responseMetadata={...aiResponse.responseMetadata,aiGeneralKnowledgeCostUsd:aiCostUsd}
 return aiResponse
}
