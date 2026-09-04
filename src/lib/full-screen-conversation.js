const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const cleanAssistantText=(value,max=3000)=>String(value??'').replace(/[\r\t]+/g,' ').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n').slice(0,max)
const safePart=value=>encodeURIComponent(clean(value,180)||'none')
const own=(value,key)=>Boolean(value)&&Object.prototype.hasOwnProperty.call(value,key)
const scopedValue=(object,keys=[])=>{
 for(const key of keys)if(own(object,key))return {present:true,value:object[key]}
 return {present:false,value:undefined}
}
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0?value:null
const responseScopeDomains=new Set(['PROFILE','COMMERCIAL','AGRONOMY','GRAINS','CREDIT','GEO','VISIT','OPPORTUNITY','GENERAL','MULTI_DOMAIN'])
const followUpScopeError=(field,reason,source='')=>Object.assign(new Error('A última resposta concluída não pertence ao contexto ativo. Faça uma nova pergunta neste contexto antes do follow-up.'),{code:'val_follow_up_scope_mismatch',scopeField:field,reason,scopeSource:source||undefined})
const verifiedCompletedAssistantTurns=new WeakSet()
const markVerifiedCompletedAssistantTurn=turn=>{verifiedCompletedAssistantTurns.add(turn);return turn}
const producerScopeValue=value=>{
 const candidate=clean(value,180)
 return ['portfolio','general'].includes(candidate.toLowerCase())?'':candidate
}
const domainScopeValue=value=>clean(value,40).toUpperCase()

function completeActiveScope(scope={}){
 for(const field of ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain'])if(!own(scope,field))throw followUpScopeError(field,'missing_active_scope','active_scope')
 const canonical={
  tenantId:clean(scope.tenantId,180)||null,ownerId:clean(scope.ownerId,180)||null,producerId:producerScopeValue(scope.producerId)||null,
  conversationId:clean(scope.conversationId,180),contextEpoch:exactEpoch(scope.contextEpoch),domain:domainScopeValue(scope.domain)
 }
 if(!canonical.tenantId)throw followUpScopeError('tenantId','invalid_active_scope','active_scope')
 if(!canonical.ownerId)throw followUpScopeError('ownerId','invalid_active_scope','active_scope')
 if(!canonical.conversationId)throw followUpScopeError('conversationId','invalid_active_scope','active_scope')
 if(canonical.contextEpoch===null)throw followUpScopeError('contextEpoch','invalid_active_scope','active_scope')
 if(!responseScopeDomains.has(canonical.domain))throw followUpScopeError('domain','invalid_active_scope','active_scope')
 return Object.freeze(canonical)
}

const assertScopeDimension=(canonical,field,raw,{source='',normalize=clean}={})=>{
 if(raw===undefined)return
 if(normalize(raw,180)!==normalize(canonical[field],180))throw followUpScopeError(field,'mismatch',source)
}

/**
 * Escopo canônico da resposta retornada pelo backend. conversationState pode
 * continuar em A durante uma consulta pontual de B e, por isso, nunca serve de
 * fallback para identificar a resposta.
 */
function parseVerifiedResponseScope(payload={},requireReasoning=true){
 const raw=payload?.responseScope
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw followUpScopeError('responseScope','missing')
 if(raw.contractVersion!=='val.response_scope.v1')throw followUpScopeError('responseScope','invalid_version')
 for(const field of ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain'])if(!own(raw,field))throw followUpScopeError(field,'missing','responseScope')
 if(raw.tenantId!==null&&!clean(raw.tenantId,180)||raw.ownerId!==null&&!clean(raw.ownerId,180)||raw.producerId!==null&&!producerScopeValue(raw.producerId)||!clean(raw.conversationId,180)||exactEpoch(raw.contextEpoch)===null||typeof raw.domain!=='string'||!responseScopeDomains.has(domainScopeValue(raw.domain)))throw followUpScopeError('responseScope','invalid')
 const canonical=Object.freeze({
  contractVersion:'val.response_scope.v1',tenantId:clean(raw.tenantId,180)||null,ownerId:clean(raw.ownerId,180)||null,
  producerId:producerScopeValue(raw.producerId)||null,conversationId:clean(raw.conversationId,180),contextEpoch:raw.contextEpoch,domain:domainScopeValue(raw.domain)
 })
 if(!requireReasoning)return canonical
 const reasoning=payload?.advice?.ai_reasoning
 if(!reasoning||typeof reasoning!=='object'||Array.isArray(reasoning))throw followUpScopeError('reasoning','missing','advice.ai_reasoning')
 const contextScope=reasoning.premises?.context_scope
 if(!contextScope||typeof contextScope!=='object'||Array.isArray(contextScope))throw followUpScopeError('context_scope','missing','reasoning.premises.context_scope')
 const session=reasoning.premises?.session_context&&typeof reasoning.premises.session_context==='object'?reasoning.premises.session_context:{}
 const interview=reasoning.decision_interview?.session_context&&typeof reasoning.decision_interview.session_context==='object'?reasoning.decision_interview.session_context:{}
 if(!own(reasoning.organization,'id'))throw followUpScopeError('tenantId','missing','reasoning.organization.id')
 assertScopeDimension(canonical,'tenantId',reasoning.organization?.id,{source:'reasoning.organization.id'})
 if(!own(reasoning.client,'id'))throw followUpScopeError('producerId','missing','reasoning.client.id')
 if(!['portfolio','general'].includes(clean(reasoning.client?.id,180).toLowerCase()))assertScopeDimension(canonical,'producerId',reasoning.client?.id,{source:'reasoning.client.id',normalize:producerScopeValue})
 if(!own(reasoning,'conversation_id')&&!own(reasoning,'conversationId'))throw followUpScopeError('conversationId','missing','reasoning.conversation_id')
 assertScopeDimension(canonical,'conversationId',reasoning.conversation_id??reasoning.conversationId,{source:'reasoning.conversation_id'})
 for(const [field,key,normalize] of [['tenantId','tenant_id',clean],['ownerId','owner_id',clean],['producerId','producer_id',producerScopeValue],['conversationId','conversation_id',clean],['contextEpoch','context_epoch',exactEpoch],['domain','domain',domainScopeValue]]){
  const source=`reasoning.premises.context_scope.${key}`
  if(!own(contextScope,key))throw followUpScopeError(field,'missing',source)
  if(field==='contextEpoch'&&exactEpoch(contextScope[key])===null)throw followUpScopeError(field,'invalid',source)
  if(field==='domain'&&(typeof contextScope[key]!=='string'||!responseScopeDomains.has(domainScopeValue(contextScope[key]))))throw followUpScopeError(field,'invalid',source)
  assertScopeDimension(canonical,field,contextScope[key],{source,normalize})
 }
 for(const [field,keys,normalize] of [['tenantId',['tenant_id','tenantId'],clean],['ownerId',['owner_id','ownerId'],clean],['conversationId',['conversation_id','conversationId'],clean],['contextEpoch',['context_epoch','contextEpoch'],exactEpoch],['domain',['current_domain','domain'],domainScopeValue]]){
  const key=keys.find(candidate=>own(session,candidate));if(key){
   const source=`reasoning.premises.session_context.${key}`
   if(field==='contextEpoch'&&exactEpoch(session[key])===null)throw followUpScopeError(field,'invalid',source)
   if(field==='domain'&&(typeof session[key]!=='string'||!responseScopeDomains.has(domainScopeValue(session[key]))))throw followUpScopeError(field,'invalid',source)
   assertScopeDimension(canonical,field,session[key],{source,normalize:field==='contextEpoch'?exactEpoch:normalize})
  }
 }
 if(own(session,'current_client'))assertScopeDimension(canonical,'producerId',session.current_client?.id??null,{source:'reasoning.premises.session_context.current_client.id',normalize:producerScopeValue})
 for(const [field,keys,normalize] of [['conversationId',['conversation_id','conversationId'],clean],['contextEpoch',['context_epoch','contextEpoch'],exactEpoch]]){
  const key=keys.find(candidate=>own(interview,candidate));if(key){
   const source=`reasoning.decision_interview.session_context.${key}`
   if(field==='contextEpoch'&&exactEpoch(interview[key])===null)throw followUpScopeError(field,'invalid',source)
   assertScopeDimension(canonical,field,interview[key],{source,normalize:field==='contextEpoch'?exactEpoch:normalize})
  }
 }
 return canonical
}

export function verifiedResponseScope(payload={}){return parseVerifiedResponseScope(payload,true)}

export function assertResponseScopeForRequest(payload,expected={}){
 const canonical=verifiedResponseScope(payload)
 for(const [field,normalize] of [['tenantId',clean],['ownerId',clean],['producerId',producerScopeValue],['conversationId',clean],['contextEpoch',exactEpoch],['domain',domainScopeValue]])if(own(expected,field)){
  if(field==='contextEpoch'&&exactEpoch(expected[field])===null)throw followUpScopeError(field,'invalid','active_request')
  assertScopeDimension(canonical,field,expected[field],{source:'active_request',normalize})
 }
 return canonical
}

// v4 invalida respostas antigas sem responseScope canônico do backend.
export const fullScreenConversationVersion='val.full_screen_conversation.v4'
export const fullScreenThreadLimit=12
export const fullScreenTurnLimit=20

/**
 * Normaliza somente respostas concluídas e preserva se cada dimensão de
 * escopo estava de fato presente. Ausência não é tratada como escopo global.
 */
export function normalizeCompletedAssistantTurn(turn){
 if(!turn||!['assistant','assistant_text'].includes(String(turn.role)))return null
 if(turn.serverGrounded!==true)return null
 // assistant_text é produzido no browser. Sem o histórico não é possível
 // comprovar sua cadeia até uma resposta canônica do backend.
 if(turn.role==='assistant_text')return null
 const payload=turn.payload&&typeof turn.payload==='object'?turn.payload:null
 const reasoning=payload?.advice?.ai_reasoning||{}
 const rawStatus=String(turn.status??reasoning.run?.status??(turn.role==='assistant'?'completed':'')).toLowerCase()
 if(['pending','running','incomplete','cancelled','canceled','failed','error'].includes(rawStatus))return null
 const text=cleanAssistantText(turn.text??turn.answer??reasoning.recommended_strategy?.reading??payload?.advice?.answer,3000)
 if(!text)return null
 const canonical=turn.role==='assistant'&&payload?verifiedResponseScope(payload):null
 if(canonical){
  for(const [field,keys,normalize] of [['tenantId',['tenantId','tenant_id'],clean],['ownerId',['ownerId','owner_id'],clean],['producerId',['producerId','producer_id','clientId','client_id'],producerScopeValue],['conversationId',['conversationId','conversation_id'],clean],['contextEpoch',['contextEpoch','context_epoch'],exactEpoch],['domain',['domain','contextDomain','context_domain'],domainScopeValue]]){
   const declared=scopedValue(turn,keys);if(declared.present){
    if(field==='contextEpoch'&&exactEpoch(declared.value)===null)throw followUpScopeError(field,'invalid',`turn.${keys[0]}`)
    assertScopeDimension(canonical,field,declared.value,{source:`turn.${keys[0]}`,normalize})
   }
  }
 }
 const conversation=canonical?{present:true,value:canonical.conversationId}:scopedValue(turn,['conversationId','conversation_id'])
 const producer=canonical?{present:true,value:canonical.producerId}:scopedValue(turn,['producerId','producer_id','clientId','client_id'])
 const epoch=canonical?{present:true,value:canonical.contextEpoch}:scopedValue(turn,['contextEpoch','context_epoch'])
 const contextEpoch=exactEpoch(epoch.value)
 if(epoch.present&&contextEpoch===null)throw followUpScopeError('contextEpoch','invalid','turn.contextEpoch')
 const rawQuestions=Array.isArray(turn.goldenQuestions)?turn.goldenQuestions:Array.isArray(reasoning.golden_questions)?reasoning.golden_questions:[]
 return markVerifiedCompletedAssistantTurn({
  role:turn.role,status:'completed',serverGrounded:true,grounding:clean(turn.grounding,80)||'SERVER_GROUNDED',text,answer:text,responseId:clean(turn.responseId??reasoning.reasoning_id,180)||null,
  // Conversa sem produtor: o turno concluido carrega producerId null e o escopo ativo tambem
  // (completeActiveScope). Com clean() aqui o turno virava '' e "resume pra mim" sem produtor
  // falhava sempre com producerId mismatch.
  conversationId:clean(conversation.value,180),producerId:producerScopeValue(producer.value)||null,contextEpoch,
  tenantId:canonical?.tenantId||null,ownerId:canonical?.ownerId||null,domain:canonical?.domain||null,
  scopePresence:{conversationId:conversation.present,producerId:producer.present,contextEpoch:epoch.present,tenantId:Boolean(canonical),ownerId:Boolean(canonical),domain:Boolean(canonical)},
  goldenQuestions:rawQuestions.slice(0,3),sourceTurn:turn,canonicalResponseId:clean(turn.responseId??reasoning.reasoning_id,180)||null,provenanceDepth:0
 })
}

const completedTurnResponseId=turn=>clean(turn?.responseId??turn?.payload?.advice?.ai_reasoning?.reasoning_id,180)
const requiredDerivedScopeFields=[
 ['conversationId',['conversationId','conversation_id'],clean],
 ['producerId',['producerId','producer_id','clientId','client_id'],producerScopeValue],
 ['contextEpoch',['contextEpoch','context_epoch'],exactEpoch]
]
const inheritedDerivedScopeFields=[
 ['tenantId',['tenantId','tenant_id'],clean],
 ['ownerId',['ownerId','owner_id'],clean],
 ['domain',['domain','contextDomain','context_domain'],domainScopeValue]
]

/**
 * Valida um turno FAST local contra seu predecessor já comprovado. As
 * dimensões que o turno FAST não serializa são herdadas exclusivamente da
 * resposta canônica alcançada por sourceResponseId; nunca da tela ativa.
 */
function normalizeDerivedAssistantTurn(turn,source){
 const rawStatus=String(turn?.status||'').toLowerCase()
 if(rawStatus!=='completed')return null
 if(turn?.serverGrounded!==true||clean(turn?.grounding,80)!=='DERIVED_FROM_SERVER_GROUNDED'||clean(turn?.mode,20).toUpperCase()!=='FAST')throw followUpScopeError('grounding','unverified','turn.assistant_text')
 if(!source||!verifiedCompletedAssistantTurns.has(source)||!source.canonicalResponseId)throw followUpScopeError('sourceResponseId','unverified','turn.sourceResponseId')
 const sourceResponseId=clean(turn.sourceResponseId,180)
 const responseId=completedTurnResponseId(turn)
 if(!sourceResponseId)throw followUpScopeError('sourceResponseId','missing','turn.sourceResponseId')
 if(!responseId)throw followUpScopeError('responseId','missing','turn.responseId')
 if(responseId===sourceResponseId)throw followUpScopeError('sourceResponseId','cycle','turn.sourceResponseId')
 const text=cleanAssistantText(turn.text??turn.answer,3000)
 if(!text)throw followUpScopeError('grounding','unverified','turn.text')
 for(const [field,keys,normalize] of requiredDerivedScopeFields){
  const declared=scopedValue(turn,keys)
  if(!declared.present)throw followUpScopeError(field,'missing',`turn.${keys[0]}`)
  if(field==='contextEpoch'&&exactEpoch(declared.value)===null)throw followUpScopeError(field,'invalid',`turn.${keys[0]}`)
  assertScopeDimension(source,field,declared.value,{source:`turn.${keys[0]}`,normalize})
 }
 for(const [field,keys,normalize] of inheritedDerivedScopeFields){
  const declared=scopedValue(turn,keys)
  if(declared.present)assertScopeDimension(source,field,declared.value,{source:`turn.${keys[0]}`,normalize})
 }
 const rawQuestions=Array.isArray(turn.goldenQuestions)?turn.goldenQuestions:Array.isArray(source.goldenQuestions)?source.goldenQuestions:[]
 return markVerifiedCompletedAssistantTurn({
  role:'assistant_text',status:'completed',serverGrounded:true,grounding:'DERIVED_FROM_SERVER_GROUNDED',text,answer:text,responseId,sourceResponseId,
  conversationId:source.conversationId,producerId:source.producerId,contextEpoch:source.contextEpoch,tenantId:source.tenantId,ownerId:source.ownerId,domain:source.domain,
  scopePresence:{conversationId:true,producerId:true,contextEpoch:true,tenantId:true,ownerId:true,domain:true},
  goldenQuestions:rawQuestions.slice(0,3),sourceTurn:turn,canonicalResponseId:source.canonicalResponseId,provenanceDepth:Number(source.provenanceDepth||0)+1
 })
}

export function assertCompletedAssistantTurnScope(turn,scope={}){
 const normalized=verifiedCompletedAssistantTurns.has(turn)?turn:normalizeCompletedAssistantTurn(turn)
 if(!normalized||normalized.status!=='completed'||normalized.serverGrounded!==true||!cleanAssistantText(normalized.text,3000))throw followUpScopeError('grounding','unverified')
 const expected=completeActiveScope(scope)
 for(const field of ['tenantId','ownerId','conversationId','producerId','contextEpoch','domain']){
  if(normalized.scopePresence?.[field]!==true)throw followUpScopeError(field,'missing')
  if(normalized[field]!==expected[field])throw followUpScopeError(field,'mismatch')
 }
 return normalized
}

const userTurnScopeStatus=(turn,scope={})=>{
 if(turn?.role!=='user')return 'not_user'
 // Pergunta que terminou em erro (422, timeout, comando bloqueado) nao esta pendente de resposta:
 // sem esta excecao, "resume pra mim" ficava bloqueado ate uma nova resposta bem-sucedida.
 if(String(turn?.status||'').toLowerCase()==='failed')return 'not_user'
 const dimensions=[
  ['tenantId',['tenantId','tenant_id'],clean],['ownerId',['ownerId','owner_id'],clean],['conversationId',['conversationId','conversation_id'],clean],
  ['producerId',['producerId','producer_id','clientId','client_id'],producerScopeValue],['contextEpoch',['contextEpoch','context_epoch'],exactEpoch],['domain',['domain','contextDomain','context_domain'],domainScopeValue]
 ]
 for(const [field,keys,normalize] of dimensions){
  const declared=scopedValue(turn,keys)
  if(!declared.present||!own(scope,field)&&!(field==='producerId'&&own(scope,'clientId')))continue
  const active=field==='producerId'?scope.producerId??scope.clientId:scope[field]
  if(field==='contextEpoch'&&exactEpoch(declared.value)===null)return {field,reason:'invalid'}
  if(field==='contextEpoch'&&exactEpoch(active)===null)return {field,reason:'invalid_active_scope'}
  if(normalize(declared.value,180)!==normalize(active,180))return {field,reason:'mismatch'}
 }
 return 'active'
}

/** Seleciona o último assistant concluído; mismatch/pedido pendente recente bloqueia o follow-up. */
export function lastCompletedAssistantTurn(turns=[],scope={}){
 completeActiveScope(scope)
 const history=Array.isArray(turns)?turns:[]
 const resolving=new Set()
 const resolveAt=index=>{
  if(resolving.has(index))throw followUpScopeError('sourceResponseId','cycle','turn.sourceResponseId')
  const turn=history[index]
  if(turn?.role==='assistant')return normalizeCompletedAssistantTurn(turn)
  if(turn?.role!=='assistant_text')return null
  const rawStatus=String(turn?.status||'').toLowerCase()
  if(rawStatus!=='completed')return null
  const sourceResponseId=clean(turn.sourceResponseId,180)
  if(!sourceResponseId)throw followUpScopeError('sourceResponseId','missing','turn.sourceResponseId')
  const sourceIndexes=[]
  for(let sourceIndex=0;sourceIndex<index;sourceIndex+=1)if(completedTurnResponseId(history[sourceIndex])===sourceResponseId)sourceIndexes.push(sourceIndex)
  if(sourceIndexes.length!==1)throw followUpScopeError('sourceResponseId',sourceIndexes.length?'ambiguous':'missing','turn.sourceResponseId')
  resolving.add(index)
  try{
   const source=resolveAt(sourceIndexes[0])
   if(!source)throw followUpScopeError('sourceResponseId','unverified','turn.sourceResponseId')
   return normalizeDerivedAssistantTurn(turn,source)
  }finally{resolving.delete(index)}
 }
 for(let index=history.length-1;index>=0;index-=1){
  const turn=history[index]
  const realtimeUngrounded=turn?.role==='assistant_text'&&String(turn?.intent||'').toUpperCase()==='REALTIME_CONVERSATION'&&turn?.serverGrounded!==true
  if(realtimeUngrounded)throw followUpScopeError('grounding','unverified')
  const userScope=userTurnScopeStatus(turn,scope)
  if(userScope==='active')throw followUpScopeError('turn','pending_user_turn','turn.user')
  if(userScope&&typeof userScope==='object')throw followUpScopeError(userScope.field,userScope.reason,'turn.user')
  const candidate=resolveAt(index)
  if(candidate)return assertCompletedAssistantTurnScope(candidate,scope)
 }
 throw followUpScopeError('turn','missing_completed_turn')
}

/** Garante que callback assíncrono ainda pertence ao epoch renderizado. */
export function realtimeTurnMatchesScope(turnScope={},activeScope={}){
 const turnClient=clean(turnScope.clientId??turnScope.producerId,180)
 const activeClient=clean(activeScope.clientId??activeScope.producerId,180)
 const turnEpoch=exactEpoch(turnScope.contextEpoch),activeEpoch=exactEpoch(activeScope.contextEpoch)
 return Boolean(clean(turnScope.conversationId,180))&&clean(turnScope.conversationId,180)===clean(activeScope.conversationId,180)&&turnClient===activeClient&&own(turnScope,'contextEpoch')&&own(activeScope,'contextEpoch')&&turnEpoch!==null&&activeEpoch!==null&&turnEpoch===activeEpoch
}

/**
 * Ações originadas em uma resposta só podem operar no escopo em que o
 * backend concluiu essa resposta. Payload ausente, legado ou adulterado falha
 * fechado sem tentar inferir o produtor pela tela atual.
 */
export function responseCardActionMatchesScope(responseScope={},activeScope={}){
 // The complete payload was verified before this descriptor was rendered.
 // Card callbacks retain only its canonical responseScope projection.
 try{
  const response=parseVerifiedResponseScope({responseScope},false)
  const active=completeActiveScope(activeScope)
  return ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain'].every(field=>response[field]===active[field])
 }catch{return false}
}

/** Não renderiza nem resume turnos que declaram outro produtor/conversa. */
export function conversationTurnVisibleInScope(turn={},activeScope={}){
 const activeProducer=clean(activeScope.producerId??activeScope.clientId,180)
 const activeConversation=clean(activeScope.conversationId,180)
 if(turn?.role==='assistant'&&turn?.payload){
  try{
   const canonical=verifiedResponseScope(turn.payload)
   const active=completeActiveScope(activeScope)
   return ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain'].every(field=>canonical[field]===active[field])
  }catch{return false}
 }
 const declaredProducer=scopedValue(turn,['producerId','producer_id','clientId','client_id'])
 const declaredConversation=scopedValue(turn,['conversationId','conversation_id'])
 if(activeScope.requireConversation===true&&!activeConversation&&declaredConversation.present)return false
 if(declaredProducer.present&&clean(declaredProducer.value,180)!==activeProducer)return false
 if(activeConversation&&declaredConversation.present&&clean(declaredConversation.value,180)!==activeConversation)return false
 return true
}

export function rehomeResolvedProducerQuestion({threads={},sourceThreadKey='',targetThreadKey='',turnId='',userTurn=null,targetScope={}}={}){
 const source=clean(sourceThreadKey,500)
 const target=clean(targetThreadKey,500)
 const requestId=clean(turnId,180)
 const producerId=clean(targetScope.producerId??targetScope.clientId,180)
 const conversationId=clean(targetScope.conversationId,180)
 const validEpoch=own(targetScope,'contextEpoch')&&exactEpoch(targetScope.contextEpoch)!==null
 if(!source||!target||source===target||!requestId||!producerId||!conversationId||!validEpoch)throw new Error('producer_thread_transition_invalid')
 const sourceTurns=Array.isArray(threads[source])?threads[source]:[]
 let matchedUser=null
 const remaining=[]
 for(const turn of sourceTurns){
  if(!matchedUser&&turn?.role==='user'&&clean(turn.turnId,180)===requestId)matchedUser=turn
  else remaining.push(turn)
 }
 const fallbackUser=userTurn?.role==='user'&&clean(userTurn.turnId,180)===requestId?userTurn:null
 const exchangeUser=matchedUser||fallbackUser
 const targetTurns=Array.isArray(threads[target])?threads[target]:[]
 if(targetTurns.length)throw new Error('producer_thread_transition_target_not_empty')
 const scopedUser=exchangeUser?{...exchangeUser,tenantId:clean(targetScope.tenantId,180)||null,ownerId:clean(targetScope.ownerId,180)||null,producerId,conversationId,contextEpoch:targetScope.contextEpoch}:null
 return {...threads,[source]:remaining.slice(-fullScreenTurnLimit),[target]:(scopedUser?[scopedUser]:[])}
}

/**
 * Quando o entity resolver troca o produtor, move somente a pergunta corrente
 * e sua resposta para uma thread nova. O dossiê anterior permanece na thread
 * de origem e nunca é relabelado como pertencente ao produtor resolvido.
 */
export function rehomeResolvedProducerExchange({threads={},sourceThreadKey='',targetThreadKey='',turnId='',userTurn=null,assistantTurn=null}={}){
 if(!assistantTurn||typeof assistantTurn!=='object'||clean(assistantTurn.turnId,180)!==clean(turnId,180))throw new Error('producer_thread_transition_invalid')
 const target=clean(targetThreadKey,500)
 const moved=rehomeResolvedProducerQuestion({threads,sourceThreadKey,targetThreadKey:target,turnId,userTurn,targetScope:assistantTurn})
 return {...moved,[target]:[...(moved[target]||[]),assistantTurn].slice(-fullScreenTurnLimit)}
}

/** Epoch confirmado pela resposta de backend mais recente do escopo ativo. */
export function conversationContextEpoch(turns=[],scope={}){
 const conversationId=clean(scope.conversationId,180)
 const producerId=clean(scope.producerId??scope.clientId,180)
 for(const turn of [...(Array.isArray(turns)?turns:[])].reverse()){
  if(turn?.role!=='assistant'||!turn?.payload)continue
  const candidate=normalizeCompletedAssistantTurn(turn)
  if(!candidate||!candidate.scopePresence.conversationId||!candidate.scopePresence.producerId||!candidate.scopePresence.contextEpoch)continue
  if(candidate.conversationId===conversationId&&candidate.producerId===producerId)return candidate.contextEpoch
 }
 if(!own(scope,'fallbackContextEpoch'))return 0
 const fallback=exactEpoch(scope.fallbackContextEpoch)
 if(fallback===null)throw followUpScopeError('contextEpoch','invalid','fallbackContextEpoch')
 return fallback
}

const traceCode=(value,{lower=false}={})=>{
 const candidate=String(value??'').trim()
 if(!candidate||candidate.length>80||!(lower?/^[a-z][a-z0-9_.:-]*$/:/^[A-Z][A-Z0-9_,.:-]*$/).test(candidate))return null
 return candidate
}
const traceDomains=new Set(['PROFILE','COMMERCIAL','AGRONOMY','GRAINS','CREDIT','GEO','VISIT','OPPORTUNITY','GENERAL','MULTI_DOMAIN'])
const traceSourceTypes=new Set(['unknown','behavioral_profile','behavioral_profile_evidence','business_event','client_registration','commitment','confirmed_visit_report','confirmed_voice_interaction','consultant_attachment','consultant_input','context_snapshot','cooperative','current_interaction','interaction','laboratory','legacy_profile_score','manual_quote','market_feed','market_snapshot','memory','negotiation_intent','official_product_catalog','opportunity','producer_360','producer_profile','producer_questionnaire','scheduled_visit','soil_analysis','system_capability','val_memory','visit'])
const traceReasonPart=value=>['BEHAVIORAL_EVIDENCE','DOMAIN_MISMATCH','MISSING_SOURCE_PROVENANCE','UNAUTHORIZED_SCOPE','PRODUCER_MISMATCH','TENANT_MISMATCH','OWNER_MISMATCH','MISSING_PRODUCER_SCOPE','MISSING_TENANT_SCOPE','MISSING_OWNER_SCOPE','STALE','EXPIRED','SUPERSEDED'].includes(value)||/^(?:DOMAIN|COLLECTION)_(?:PROFILE|COMMERCIAL|AGRONOMY|GRAINS|CREDIT|GEO|VISIT|OPPORTUNITY|GENERAL|MULTI_DOMAIN)(?:_SEMANTIC_MATCH)?$/.test(value)
const traceEntryView=item=>{
 const sourceCandidate=traceCode(item?.sourceType,{lower:true})
 const reasonCandidate=traceCode(item?.reasonSelected)
 const sourceType=traceSourceTypes.has(sourceCandidate)?sourceCandidate:null
 const reasonSelected=reasonCandidate&&reasonCandidate.split(',').every(traceReasonPart)?reasonCandidate:null
 return sourceType||reasonSelected?{sourceType:sourceType||'unknown',reasonSelected:reasonSelected||'UNSPECIFIED'}:null
}

/**
 * O trace público não transporta IDs, timestamps, scores ou texto de origem.
 * Mesmo com safe=true, somente códigos estruturados entram na visualização.
 */
export function safeContextTraceView(reasoning={}){
 const trace=reasoning?.context_trace
 if(!trace||trace.safe!==true)return null
 const domainCandidate=traceCode(trace.domain)||traceCode(reasoning?.premises?.context_scope?.domain)
 const domain=traceDomains.has(domainCandidate)?domainCandidate:'GENERAL'
 return {
  domain,
  selected:(Array.isArray(trace.selected)?trace.selected:[]).map(traceEntryView).filter(Boolean).slice(0,20),
  rejected:(Array.isArray(trace.rejected)?trace.rejected:[]).map(traceEntryView).filter(Boolean).slice(0,20)
 }
}

export function contextTraceDebugEnabled(environment={}){
 return environment?.DEV===true||String(environment?.VITE_VAL_CONTEXT_TRACE_ENABLED??'').trim().toLowerCase()==='true'
}

/** Produção falha fechada: o trace exige payload safe e flag de debug/staging. */
export function debugContextTraceView(reasoning={},environment={}){
 return contextTraceDebugEnabled(environment)?safeContextTraceView(reasoning):null
}

export function isBehavioralProfileResponse(reasoning={}){
 const dataPath=String(reasoning?.commercial_context?.data_path||reasoning?.premises?.data_path||'').toUpperCase()
 const domain=String(reasoning?.premises?.context_scope?.domain||'').toUpperCase()
 return dataPath==='BEHAVIORAL_PROFILE'||domain==='PROFILE'
}

const profileCapture=(answer,pattern)=>String(answer||'').match(pattern)?.[1]?.trim().replace(/[.\s]+$/,'')||''

export function behavioralProfileViewModel({reasoning={},answer='',facts=[]}={}){
 const primary=profileCapture(answer,/Perfil principal:\s*(.*?)(?=\.\s*Confiança:|$)/i)||(reasoning.confidence?.level==='INSUFICIENTE'?'Não comprovado':'Não informado')
 const confidence=profileCapture(answer,/Confiança:\s*(.*?)(?=\.\s*(?:Por quê|Como abordar|O que ainda não sabemos):|$)/i)||String(reasoning.confidence?.level||'não calibrada').toLocaleLowerCase('pt-BR')
 const why=profileCapture(answer,/Por quê:\s*(.*?)(?=\.\s*(?:Como abordar|O que ainda não sabemos):|$)/i)||reasoning.decision_thesis?.WHY||reasoning.confidence?.rationale||'A fonte disponível ainda não sustenta uma explicação mais específica.'
 const approach=profileCapture(answer,/Como abordar:\s*(.*?)(?=\.\s*O que ainda não sabemos:|$)/i)||reasoning.recommended_strategy?.action||'Valide evidências comportamentais antes de personalizar a abordagem.'
 const unknown=profileCapture(answer,/O que ainda não sabemos:\s*(.*?)(?=\.\s*$|$)/i)||(Array.isArray(reasoning.missing_information)?reasoning.missing_information.filter(Boolean).slice(0,3).join(' '):'')||reasoning.decision_thesis?.KEY_UNCERTAINTY||'Nenhuma lacuna adicional foi informada.'
 return {primary,confidence,why,approach,unknown,evidence:(Array.isArray(facts)?facts:[]).slice(0,4)}
}

export function conversationScopeKey({clientId='',context=null}={}){
 const client=clean(clientId,180)
 // O objeto ativo evolui dentro da conversa; ele não cria uma nova thread.
 // Assim texto, voz, visita, talhão, foto, PDF e ferramentas mantêm o mesmo
 // conversationId enquanto o consultor conversa sobre o mesmo produtor.
 return client?`client:${client}`:'__global__'
}

export function createConversationThreadKey({clientId='',threadId=''}={}){
 const id=clean(threadId,180)||globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`
 return `${conversationScopeKey({clientId})}:conversation:${safePart(id)}`
}

export function createScopedRegistrationDraft({text='',clientId='',threadKey=''}={}){
 const candidate=clean(text,3000)
 const client=clean(clientId,180)
 const thread=clean(threadKey,500)
 return candidate&&client&&thread?{text:candidate,clientId:client,threadKey:thread}:null
}

export function registrationDraftTextForScope(draft,{clientId='',threadKey=''}={}){
 if(!draft||String(draft.clientId)!==String(clientId)||String(draft.threadKey)!==String(threadKey))return ''
 return clean(draft.text,3000)
}

export function conversationScopeLabel({client=null,context=null}={}){
 if(context?.label)return clean(context.label,120)
 if(client?.name)return clean(client.name,120)
 return 'Conversa geral'
}

export function conversationGroupLabel(value,now=new Date()){
 const date=new Date(value||0)
 if(Number.isNaN(date.getTime()))return 'Anteriores'
 const start=new Date(now);start.setHours(0,0,0,0)
 const target=new Date(date);target.setHours(0,0,0,0)
 const days=Math.round((start-target)/86_400_000)
 if(days===0)return 'Hoje'
 if(days===1)return 'Ontem'
 return 'Anteriores'
}

const latestText=turn=>{
 if(turn?.role==='user'||turn?.role==='system'||turn?.role==='assistant_text')return clean(turn.text,160)
 const reasoning=turn?.payload?.advice?.ai_reasoning||{}
 return clean(reasoning.recommended_strategy?.reading||turn?.payload?.advice?.answer,160)
}

export function buildConversationHistory({threads={},metadata={},clients=[],query='',now=new Date()}={}){
 const names=new Map((Array.isArray(clients)?clients:[]).map(client=>[String(client?.id),clean(client?.name,120)]))
 const needle=clean(query,120).toLocaleLowerCase('pt-BR')
 return Object.entries(threads).flatMap(([key,turns])=>{
  if(!Array.isArray(turns)||!turns.length)return []
  const meta=metadata[key]||{}
  const visibleTurns=turns.filter(turn=>conversationTurnVisibleInScope(turn,{tenantId:meta.tenantId||'',ownerId:meta.ownerId||'',producerId:meta.clientId||'',conversationId:meta.conversationId||'',contextEpoch:meta.contextEpoch,domain:meta.domain||'',requireConversation:true}))
  if(!visibleTurns.length)return []
  const last=visibleTurns.at(-1)||{}
  const clientName=names.get(String(meta.clientId||''))||clean(meta.clientName,120)
  const label=clean(meta.label,120)||clientName||'Conversa geral'
  const preview=latestText(last)||latestText([...visibleTurns].reverse().find(item=>latestText(item)))||'Conversa em andamento'
  const at=last.at||meta.updatedAt||meta.createdAt||new Date(0).toISOString()
  const searchable=`${label} ${clientName} ${preview}`.toLocaleLowerCase('pt-BR')
  if(needle&&!searchable.includes(needle))return []
  return [{key,label,clientName,clientId:clean(meta.clientId,180),conversationId:clean(meta.conversationId,180),context:meta.context||null,preview,at,group:conversationGroupLabel(at,now),turnCount:visibleTurns.length}]
 }).sort((left,right)=>new Date(right.at)-new Date(left.at)).slice(0,fullScreenThreadLimit)
}

export function conversationWorkspaceStorageKey(storageScope='session'){
 return `valor360:val-full-screen:v1:${safePart(storageScope||'session')}`
}

export function readConversationWorkspace(storage,storageScope='session'){
 if(!storage?.getItem)return {threads:{},metadata:{}}
 try{
  const parsed=JSON.parse(storage.getItem(conversationWorkspaceStorageKey(storageScope))||'null')
  if(parsed?.version!==fullScreenConversationVersion||!parsed.threads||!parsed.metadata)return {threads:{},metadata:{}}
  return {threads:parsed.threads,metadata:parsed.metadata}
 }catch{return {threads:{},metadata:{}}}
}

export function writeConversationWorkspace(storage,storageScope,{threads={},metadata={}}={}){
 if(!storage?.setItem)return false
 try{
  const allowed=buildConversationHistory({threads,metadata}).map(item=>item.key)
  const boundedThreads={};const boundedMetadata={}
  for(const key of allowed){boundedMetadata[key]=metadata[key]||{};boundedThreads[key]=(threads[key]||[]).filter(turn=>conversationTurnVisibleInScope(turn,{tenantId:boundedMetadata[key].tenantId||'',ownerId:boundedMetadata[key].ownerId||'',producerId:boundedMetadata[key].clientId||'',conversationId:boundedMetadata[key].conversationId||'',contextEpoch:boundedMetadata[key].contextEpoch,domain:boundedMetadata[key].domain||'',requireConversation:true})).slice(-fullScreenTurnLimit)}
  storage.setItem(conversationWorkspaceStorageKey(storageScope),JSON.stringify({version:fullScreenConversationVersion,threads:boundedThreads,metadata:boundedMetadata,savedAt:new Date().toISOString()}))
  return true
 }catch{return false}
}

// Rotulo legivel do intent no cabecalho do copiloto: o codigo interno ("ASK GENERAL",
// "CHECK OPPORTUNITY") nao e linguagem do consultor.
const intentLabels=Object.freeze({
 ASK_GENERAL:'Pergunta geral',ASK_CLIENT:'Sobre o produtor',ASK_AGRONOMIC:'Agronomia',ASK_MARKET:'Mercado',ASK_COMMODITY:'Mercado',
 CHECK_WEATHER:'Clima',CHECK_LABEL:'Bula / rótulo',CHECK_OPPORTUNITY:'Oportunidade',PREPARE_VISIT:'Preparar visita',POST_VISIT:'Pós-visita',
 REGISTER_INFORMATION:'Registro de informação',OBJECTION_HELP:'Objeção',FOLLOW_UP_HELP:'Follow-up',CALCULATE:'Cálculo',ANALYZE_SOIL:'Análise de solo',IMAGE_DIAGNOSIS:'Diagnóstico por imagem'
})
export function valIntentLabel(intent){
 const key=clean(intent,60).toUpperCase()
 if(!key)return ''
 return intentLabels[key]||key.toLowerCase().replaceAll('_',' ').replace(/^\p{L}/u,letter=>letter.toUpperCase())
}
export function contextStatusLabel({client=null,context=null}={}){
 if(context?.type==='opportunity')return 'Oportunidade ativa'
 if(context?.type==='visit'||context?.type==='visit_draft')return 'Visita ativa'
 if(context?.type==='agronomic_tool'||context?.type==='soil_analysis')return 'Contexto agronômico'
 if(client)return 'Contexto confirmado'
 return 'Sem produtor selecionado'
}
