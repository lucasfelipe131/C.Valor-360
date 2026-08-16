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
const DECISION_DATA_CHECKS=[
  ['Data prevista de semeadura e emergência',/data (?:de )?(?:plantio|semeadura|emerg[eê]ncia)|emerg[eê]ncia (?:ser[aá]|previst[ao]|dia|em)|vai emergir|semeadura em/i],
  ['Presença de milho tiguera e lavouras mais velhas no entorno',/tiguera|milho volunt[aá]rio|milho (?:mais velho|vizinho|pr[oó]ximo)/i],
  ['Híbrido e tolerância ao complexo de enfezamentos',/h[ií]brido|toler[aâ]ncia.*enfezamento/i],
  ['Tratamento de sementes utilizado',/tratamento de sementes|\bts\b/i],
  ['Pressão ou monitoramento regional de cigarrinha',/press[aã]o|infesta[cç][aã]o|captura|armadilha|monitoramento/i],
  ['Área que entrará no programa',/\d+[.,]?\d*\s*(?:ha|hectare)/i],
  ['Preço de referência da saca de milho',/(?:r\$\s*)?\d+[.,]?\d*\s*(?:\/|por\s*)?(?:sc|saca)/i],
  ['Critério de reavaliação após a primeira intervenção',/reavalia[cç][aã]o|reinfesta[cç][aã]o|pontos de monitoramento|crit[eé]rio de parada/i]
]

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

function conversationCorpus(context={},message=''){
  const history=Array.isArray(context.priorRecommendations)?context.priorRecommendations:[]
  return [message,...history.map(item=>item?.user_question??item?.userQuestion??item?.question??'')].join(' ')
}

function nextDecisionQuestion(missing=[]){
  if(missing.includes('Data prevista de semeadura e emergência')||missing.includes('Presença de milho tiguera e lavouras mais velhas no entorno'))return 'Qual é a data prevista de emergência e existe milho tiguera ou lavoura de milho mais velha no entorno da área?'
  if(missing.includes('Híbrido e tolerância ao complexo de enfezamentos')||missing.includes('Tratamento de sementes utilizado'))return 'Qual híbrido será semeado e qual tratamento de sementes foi definido para essa área?'
  if(missing.includes('Pressão ou monitoramento regional de cigarrinha'))return 'Qual é a pressão observada ou o dado de monitoramento de cigarrinha na região e na propriedade?'
  if(missing.includes('Área que entrará no programa')||missing.includes('Preço de referência da saca de milho'))return 'Quantos hectares entrarão no programa e qual preço de referência da saca de milho devemos usar na conta?'
  if(missing.includes('Critério de reavaliação após a primeira intervenção'))return 'Qual indicador e qual data serão usados para reavaliar reinfestação e decidir o próximo movimento?'
  return 'Qual decisão precisa ficar fechada na próxima conversa com o produtor?'
}

function reconcileDecisionProgress(result,context,message){
  const plan=result?.technicalCommercialPlan
  if(!plan)return result
  const corpus=conversationCorpus(context,message)
  const missing=DECISION_DATA_CHECKS.filter(([,pattern])=>!pattern.test(corpus)).map(([label])=>label)
  const nextQuestion=nextDecisionQuestion(missing)
  const sequence=result.sequence&&typeof result.sequence==='object'?structuredClone(result.sequence):null
  if(sequence?.steps){
    const riskReady=!missing.includes('Data prevista de semeadura e emergência')&&!missing.includes('Presença de milho tiguera e lavouras mais velhas no entorno')
    const setupReady=riskReady&&!missing.includes('Híbrido e tolerância ao complexo de enfezamentos')&&!missing.includes('Tratamento de sementes utilizado')
    sequence.steps=sequence.steps.map(step=>{
      if(step.id==='risk'&&riskReady)return {...step,status:'complete',evidence:'Emergência e ponte verde/entorno foram registrados na sequência.'}
      if(step.id==='technical'&&riskReady)return {...step,status:setupReady?'current':'current',evidence:setupReady?'Híbrido e tratamento de sementes registrados; validar pressão e posicionamento.':'Próximo passo: confirmar híbrido e tratamento de sementes.'}
      return step
    })
    sequence.completed=sequence.steps.filter(step=>step.status==='complete').length
    sequence.currentStep=sequence.steps.find(step=>step.status==='current')||sequence.currentStep
    const currentIndex=sequence.steps.findIndex(step=>step.id===sequence.currentStep?.id)
    sequence.nextStep=sequence.steps[Math.min(Math.max(0,currentIndex)+1,sequence.steps.length-1)]||sequence.nextStep
  }
  return {
    ...result,
    sequence,
    technicalCommercialPlan:{...plan,missingData:missing,nextQuestion,sequence:sequence||plan.sequence}
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
  const routed={...result,route:deterministicButtonRoute(result.route,options)}
  return reconcileDecisionProgress(routed,normalizedContext,normalizedMessage)
}

export {
  enrichAdviceWithOrchestration,
  conversationOrchestratorVersion,
  officialProductKnowledge
}
