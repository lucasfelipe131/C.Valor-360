// Only server-accepted user turns can complete a short question. This is dialogue,
// never a producer fact, and is discarded on a producer/conversation/epoch change.
import {knownAgronomicTerm} from '../knowledge/agronomic-vocabulary.js'
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()
const crops='milho|soja|trigo|canola|sorgo|arroz|feijao|algodao|pastagem'
const cropReply=new RegExp(`^(?:(?:e|agora|no|na|em|para|o|a|cultura|de|do|da)\\s+)*(${crops})[.!?]*$`)
const cropMention=new RegExp(`\\b(${crops})\\b`)
const agronomy=/\b(?:aplicacao|ureia|nitrogenio|adubacao|inseticida|cigarrinha|lagarta|praga|fungicida|herbicida|plantio|solo|produtividade|germinacao)\b/
const agronomicReferent=/\b(?:plantas?|tecidos?|xilema|floema|raiz|raizes|folhas?|insetos?|pragas?|solo)\b/
const conceptDefinition=/^(?:o que [ée]|o que significa|(?:me )?explique(?: o que [ée])?)\s+(o|a|um|uma)\s+([^.!?;]+)[.!?]*$/i
export const hasPrivateQuestionContext=value=>/\b(?:produtor|cliente|fazenda|talhao|propriedade|matricula|cpf|cnpj|telefone|email|endereco|contrato|cadastro|carteira|visita|laudo|minha|minhas|meu|meus|nosso|nossa|seu|sua|dele|dela|desse|deste|selecionado|demo|demonstrativo|ficticio)\b/.test(normalize(value))

export function generalTopicClarification(message){
 const crop=cropReply.exec(normalize(message))?.[1]
 return crop?`Sobre ${crop}, qual é a dúvida: plantio, nutrição, pragas ou outro assunto?`:null
}

export function resolveGeneralConversationQuestion({message='',conversationState:state=null,tenantId='',ownerId='',conversationId='',clientId=''}={}){
 const original=String(message).trim().slice(0,3000)
 const result={message:original,continued:false}
 if(!state||!tenantId||!ownerId||!conversationId||state.tenant_id!==tenantId||state.owner_id!==ownerId||state.conversation_id!==conversationId||String(state.current_client?.id||'')!==String(clientId||'')||!Number.isSafeInteger(state.context_epoch))return result
 const source=normalize(original)
 const crop=cropReply.exec(source)?.[1]
 const additiveTopic=!crop&&/^e\s/.test(source)&&agronomy.test(source)&&!cropMention.test(source)&&!hasPrivateQuestionContext(source)
 const conceptPronoun=/^(?:e\s+)?(?:como|por que|onde|quando)\s+(ele|ela)\b/.exec(source)?.[1]
 const conceptFollowup=conceptPronoun&&agronomicReferent.test(source)&&!hasPrivateQuestionContext(source)
 if(!crop&&!additiveTopic&&!conceptFollowup)return result
 const turns=(Array.isArray(state.conversation_turns)?state.conversation_turns:[]).filter(turn=>turn.role==='user'&&turn.scope_verified===true&&turn.tenant_id===tenantId&&turn.owner_id===ownerId&&turn.conversation_id===conversationId&&turn.context_epoch===state.context_epoch&&String(turn.subject_client_id||'')===String(clientId||'')&&!(turn.subject_client_ids?.length)).slice(-5).reverse()
 if(conceptFollowup){
  const prior=String(turns[0]?.text||'').trim()
  const definition=conceptDefinition.exec(prior)
  if(state.current_domain!=='AGRONOMY'||!definition||hasPrivateQuestionContext(prior))return result
  const article=['a','uma'].includes(definition[1].toLowerCase())?'a':'o'
  const concept=definition[2].trim()
  const terms=normalize(concept).split(/\s+/)
  // A generic, explicit noun phrase can resolve a grammatical pronoun. A
  // product name, person, private clause or mismatched gender cannot inherit it.
  if(conceptPronoun!==(article==='a'?'ela':'ele')||!agronomy.test(normalize(concept))||!terms.every(term=>knownAgronomicTerm(term)||/^(?:de|do|da|dos|das|e|em|no|na)$/.test(term)))return result
  return {message:original.replace(/\b(?:ele|ela)\b/i,`${article} ${concept}`),continued:true,conceptContinuation:true}
 }
 let recentCrop=''
 for(const turn of turns){
  const prior=String(turn.text||'').trim()
  const priorSource=normalize(prior)
  // Never jump past an unrelated or private question to revive an older topic.
  if(hasPrivateQuestionContext(prior))return result
  const previousCrop=cropReply.exec(priorSource)?.[1]
  if(previousCrop){recentCrop||=previousCrop;continue}
  if(!agronomy.test(priorSource))return result
  if(crop){
   // Replace the stated crop, not pest names such as "cigarrinha-do-milho".
   const withoutCrop=prior.replace(new RegExp(`\\b(?:no|na|em|para o|para a|cultura de)\\s+(?:${crops})\\b`,'ig'),'').replace(/\s+/g,' ').replace(/[.!?]+$/,'').trim()
   return {message:`${withoutCrop} — cultura: ${crop}.`,continued:true}
  }
  const inheritedCrop=recentCrop||cropMention.exec(priorSource)?.[1]
  return inheritedCrop?{message:`${original.replace(/[.!?]+$/,'')} — cultura: ${inheritedCrop}.`,continued:true}:result
 }
 return result
}
