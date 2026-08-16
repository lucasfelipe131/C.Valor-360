import {
  buildConversationContinuity as buildConversationContinuityCore,
  buildConversationOrchestration as buildConversationOrchestrationCore,
  chooseAutomaticRoute as chooseAutomaticRouteCore,
  classifyConversationIntent as classifyConversationIntentCore,
  enrichAdviceWithOrchestration,
  extractProductMentions as extractProductMentionsCore,
  conversationOrchestratorVersion,
  officialProductKnowledge
} from './conversation-orchestrator.js'

const QUICK_DETERMINISTIC_INTENTS=new Set(['account_priority','visit_preparation','commitment'])

function normalizeSeparators(value=''){
  return String(value)
    .replace(/[;()\[\]]/g,' ')
    .replace(/,(?=\s|$)/g,' ')
    .replace(/\.(?=\s|$)/g,' ')
    .replace(/\bemerg[eê]ncia\s+(?=(?:ser[aá]|previst[ao]|dia|em)(?:\s|$))/gi,'data de emergência ')
    .replace(/\s+/g,' ')
    .trim()
}

function normalizePriorRecommendation(item){
  if(!item||typeof item!=='object')return item
  const question=item.user_question??item.userQuestion??item.question
  if(question===undefined)return item
  const normalized=normalizeSeparators(question)
  if('user_question' in item)return {...item,user_question:normalized}
  if('userQuestion' in item)return {...item,userQuestion:normalized}
  return {...item,question:normalized}
}

function normalizeContext(context={}){
  return {
    ...context,
    priorRecommendations:Array.isArray(context.priorRecommendations)
      ?context.priorRecommendations.map(normalizePriorRecommendation)
      :[]
  }
}

function deterministicButtonRoute(route,options={}){
  if(!QUICK_DETERMINISTIC_INTENTS.has(route?.intent)||Number(options.attachmentCount||0)>0)return route
  return {
    ...route,
    mode:'deterministic',
    useGenerativeAi:false,
    retrieval:false,
    humanReview:false,
    reason:'O comando executa score, ranking, lacunas e próxima ação diretamente sobre os dados da conta; a IA generativa não agrega valor nesta etapa.'
  }
}

export function extractProductMentions(text=''){
  return extractProductMentionsCore(normalizeSeparators(text))
}

export function buildConversationContinuity(context={},message=''){
  return buildConversationContinuityCore(normalizeContext(context),normalizeSeparators(message))
}

export function classifyConversationIntent(context={},message='',continuity=null){
  const normalizedContext=normalizeContext(context)
  const normalizedMessage=normalizeSeparators(message)
  const resolvedContinuity=continuity||buildConversationContinuityCore(normalizedContext,normalizedMessage)
  return classifyConversationIntentCore(normalizedContext,normalizedMessage,resolvedContinuity)
}

export function chooseAutomaticRoute(context={},message='',continuity=null,options={}){
  const normalizedContext=normalizeContext(context)
  const normalizedMessage=normalizeSeparators(message)
  const resolvedContinuity=continuity||buildConversationContinuityCore(normalizedContext,normalizedMessage)
  return deterministicButtonRoute(
    chooseAutomaticRouteCore(normalizedContext,normalizedMessage,resolvedContinuity,options),
    options
  )
}

export function buildConversationOrchestration(context={},message='',options={}){
  const normalizedContext=normalizeContext(context)
  const normalizedMessage=normalizeSeparators(message)
  const result=buildConversationOrchestrationCore(normalizedContext,normalizedMessage,options)
  return {...result,route:deterministicButtonRoute(result.route,options)}
}

export {
  enrichAdviceWithOrchestration,
  conversationOrchestratorVersion,
  officialProductKnowledge
}
