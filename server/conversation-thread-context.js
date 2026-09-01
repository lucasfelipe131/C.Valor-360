import {extractProductMentions} from './conversation-orchestrator-runtime.js'
import {conversationStatePromptContext,messageNeedsSessionReference} from './decision-copilot/conversation-state.js'
import {classifyValContextDomain,conversationReferenceKind,valContextDomains} from './decision-copilot/context-selector.js'

const array=value=>Array.isArray(value)?value:[]
const clean=(value,max=3000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const questionOf=item=>clean(item?.user_question||item?.userQuestion||item?.question)
const technicalCommercial=/\b(?:manejo|inseticida|herbicida|fungicida|cigarrinha|enfezamento|desseca[cç][aã]o|produto|dose|aplica[cç][aã]o|venda|valor|pre[cç]o|custo|proposta|negocia[cç][aã]o)\b/i
const reset=/\b(?:novo assunto|outra conta|outro produtor|ignore a conversa anterior|desconsidere o anterior|mudar de assunto)\b/i

const own=(value,key)=>Boolean(value&&typeof value==='object')&&Object.prototype.hasOwnProperty.call(value,key)
const scopedStrings=(object,keys)=>keys.filter(key=>own(object,key)).map(key=>clean(object[key],180))
const exactExpectedString=values=>{
  const normalized=values.filter(value=>value!==undefined&&value!==null).map(value=>clean(value,180)).filter(Boolean)
  return normalized.length&&normalized.every(value=>value===normalized[0])?normalized[0]:null
}
const integerEpoch=value=>{
  return Number.isSafeInteger(value)&&value>=0?value:null
}
const exactExpectedEpoch=values=>{
  const supplied=values.filter(value=>value!==undefined)
  if(!supplied.length)return null
  const normalized=supplied.map(integerEpoch)
  return normalized.every(value=>value!==null&&value===normalized[0])?normalized[0]:null
}

function resolvedPriorScope(context={},override={}){
  const snapshot=context.contextSnapshot||context.context_snapshot||{}
  const snapshotScope=snapshot.context_scope||{}
  const state=context.conversationState||context.conversation_state||{}
  const subject=snapshot.subject||{}
  const overrideEpoch=own(override,'contextEpoch')?override.contextEpoch:own(override,'context_epoch')?override.context_epoch:undefined
  const tenantId=exactExpectedString([override.tenantId,override.tenant_id,snapshotScope.tenant_id,snapshot.organization_id,state.tenant_id])
  const ownerId=exactExpectedString([override.ownerId,override.owner_id,snapshotScope.owner_id,state.owner_id])
  const producerId=exactExpectedString([override.producerId,override.producer_id,override.clientId,override.client_id,snapshotScope.producer_id,subject.type==='client'?subject.id:undefined,state.current_client?.id,context.client?.id])
  const conversationId=exactExpectedString([override.conversationId,override.conversation_id,snapshotScope.conversation_id,state.conversation_id])
  const contextEpoch=exactExpectedEpoch([overrideEpoch,own(snapshotScope,'context_epoch')?snapshotScope.context_epoch:undefined,own(state,'context_epoch')?state.context_epoch:undefined])
  const classifiedDomain=classifyValContextDomain(override.message||'')
  const domain=exactExpectedString([override.contextDomain,override.context_domain,override.domain,snapshotScope.domain,state.current_domain])||(!snapshotScope.domain&&!state.current_domain?classifiedDomain:null)
  const normalizedDomain=clean(domain,40).toUpperCase()
  if(!tenantId||!ownerId||!producerId||!conversationId||contextEpoch===null||!valContextDomains.includes(normalizedDomain))return null
  return {tenantId,ownerId,producerId,conversationId,contextEpoch,domain:normalizedDomain}
}

function exactRecommendationString(item,keys,expected,{upper=false}={}){
  const values=scopedStrings(item,keys)
  if(!values.length||values.some(value=>!value))return false
  const normalized=upper?values.map(value=>value.toUpperCase()):values
  const target=upper?String(expected).toUpperCase():String(expected)
  return normalized.every(value=>value===target)
}

function recommendationMatchesScope(item,scope){
  if(!item||typeof item!=='object'||Array.isArray(item))return false
  const epochs=['context_epoch','contextEpoch'].filter(key=>own(item,key)).map(key=>integerEpoch(item[key]))
  return exactRecommendationString(item,['tenant_id','tenantId','organization_id','organizationId'],scope.tenantId)&&
    exactRecommendationString(item,['owner_id','ownerId','context_owner_id','contextOwnerId','consultant_id','consultantId'],scope.ownerId)&&
    exactRecommendationString(item,['producer_id','producerId','client_id','clientId','client_external_key','clientExternalKey','subject_client_id'],scope.producerId)&&
    exactRecommendationString(item,['conversation_id','conversationId'],scope.conversationId)&&
    epochs.length>0&&epochs.every(value=>value===scope.contextEpoch)&&
    exactRecommendationString(item,['domain','context_domain','contextDomain'],scope.domain,{upper:true})
}

/**
 * A recommendation is conversational evidence, not universal memory. It may
 * cross the boundary only for an explicit turn-content reference and only
 * when all six scope dimensions are complete and exactly current.
 */
export function selectScopedPriorRecommendations(context={},message='',scopeOverride={}){
  if(conversationReferenceKind(message)!=='TURN_CONTENT')return []
  const scope=resolvedPriorScope(context,{...scopeOverride,message})
  if(!scope||scope.domain==='PROFILE')return []
  return array(context.priorRecommendations).filter(item=>recommendationMatchesScope(item,scope)).slice(0,1)
}

function activeAnchor(history=[]){
  const productAnchor=history.find(item=>extractProductMentions(questionOf(item)).length>0)
  if(productAnchor)return productAnchor
  return history.find(item=>technicalCommercial.test(questionOf(item)))||null
}

export function prepareConversationThread(context={},message=''){
  const originalMessage=String(message||'')
  if(reset.test(originalMessage))return {context:{...context,priorRecommendations:[]},message:originalMessage,originalMessage,anchor:null,continued:false,carriedPriorTurn:false,domain:classifyValContextDomain(originalMessage),referenceKind:'RESET'}
  const referenceKind=conversationReferenceKind(originalMessage)
  const history=selectScopedPriorRecommendations(context,originalMessage)
  const selectedScope=resolvedPriorScope(context,{message:originalMessage})
  const domain=selectedScope?.domain||classifyValContextDomain(originalMessage)
  const entityPrompt=clean(context.conversationState?.current_client?.label||context.client?.name,240)
  const statePrompt=referenceKind==='ENTITY_ONLY'&&entityPrompt?`produtor ${entityPrompt}`:context.conversationState?conversationStatePromptContext(context.conversationState):''
  const stateContinuation=Boolean(statePrompt&&messageNeedsSessionReference(originalMessage))
  const stateMessage=stateContinuation?`${clean(originalMessage)}\nContexto temporário desta conversa (não é memória confirmada): ${statePrompt}`:originalMessage
  const resultMetadata={domain,referenceKind}
  if(!history.length)return {context:{...context,priorRecommendations:[]},message:stateMessage,originalMessage,anchor:stateContinuation?{type:'conversation_state',context:statePrompt}:null,continued:stateContinuation,carriedPriorTurn:false,...resultMetadata}
  const anchor=activeAnchor(history)
  if(!anchor){
   return {context:{...context,priorRecommendations:history.slice(0,1)},message:stateMessage,originalMessage,anchor:stateContinuation?{type:'conversation_state',context:statePrompt}:null,continued:true,carriedPriorTurn:true,...resultMetadata}
  }
  const latest=history[0]
  const latestQuestion=questionOf(latest)
  const anchorQuestion=questionOf(anchor)
  const latestHasProducts=extractProductMentions(latestQuestion).length>0
  // Resolver "dele/dela" usa somente a entidade ativa. Conteúdo de um turno
  // anterior só atravessa quando a mensagem referencia esse conteúdo ou pede
  // explicitamente continuidade. Perguntas curtas deixam de ser continuação
  // automática — essa heurística era a origem do vazamento entre domínios.
  const combinedLatest=latestHasProducts||latest===anchor
    ?latest
    :{...latest,user_question:`${latestQuestion}\nContexto técnico-comercial ativo das conversas anteriores: ${anchorQuestion}`}
  const priorRecommendations=[combinedLatest]
  const effectiveMessage=`${clean(stateMessage)}\nContinue a sequência técnica e comercial já iniciada. Contexto ativo: ${anchorQuestion}`
  return {
    context:{...context,priorRecommendations},
    message:effectiveMessage,
    originalMessage,
    anchor:{id:anchor.id||null,question:anchorQuestion,products:extractProductMentions(anchorQuestion).map(item=>item.name),createdAt:anchor.created_at||anchor.createdAt||null},
    continued:true,
    carriedPriorTurn:true,
    ...resultMetadata
  }
}
