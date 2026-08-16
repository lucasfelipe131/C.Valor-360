import {createHash} from 'node:crypto'

const VERSION='val-conversation-orchestrator-v1'
const MAX_TURNS=10
const DAY=86_400_000

const OFFICIAL_PRODUCTS=[
  {
    key:'efficon',
    name:'Efficon®',
    aliases:['efficon','eficon'],
    manufacturer:'BASF',
    category:'Inseticida',
    active:'Dimpropiridaz 120 g/L — tecnologia Axalion® Active',
    crops:['Milho'],
    targets:['Cigarrinha-do-milho (Dalbulus maidis)','Pulgão-dos-cereais (Rhopalosiphum maidis)'],
    officialSource:'https://agriculture.basf.com/br/pt/protecao-de-cultivos-e-sementes/produtos/efficon',
    sourceLabel:'BASF — página oficial e bula Efficon®',
    verifiedAt:'2026-08-16',
    labelReference:{
      crop:'Milho',
      target:'Cigarrinha-do-milho (Dalbulus maidis)',
      productRate:'800–1000 mL de produto comercial/ha',
      sprayVolume:'150 L/ha',
      maximumApplications:'3 aplicações por ciclo',
      interval:'7 dias',
      timing:'Iniciar no começo da infestação e reavaliar reinfestação',
      adjuvant:'Espalhante adesivo não iônico a 0,008% v/v, conforme bula',
      safety:'Uso agrícola sob receituário agronômico; confirmar rótulo, bula e registro vigentes antes de executar.'
    },
    valueClaims:[
      'Modo de ação voltado à interrupção da alimentação de insetos sugadores.',
      'Ferramenta para programas de manejo de resistência por apresentar modo de ação diferenciado.',
      'A página oficial posiciona o produto para Dalbulus maidis na cultura do milho.'
    ]
  },
  {
    key:'trinca_caps',
    name:'Trinca Caps®',
    aliases:['trinca caps','trincacaps'],
    manufacturer:'UPL',
    category:'Inseticida',
    active:'Lambda-cialotrina 250 g/L',
    officialSource:'https://www.uplcorp.com/br/defensivos-agricolas/inseticidas/trinca-caps',
    sourceLabel:'UPL — página oficial Trinca Caps®',
    verifiedAt:'2026-08-16',
    labelReference:null,
    valueClaims:['Produto citado pelo consultor na aplicação pré-milho; não presumir que essa aplicação substitui o programa de monitoramento da cigarrinha.']
  }
]

const CONTEXT_PRODUCTS=[
  {key:'glufosinato',name:'Glufosinato',aliases:['glufosinato','glufosinate'],category:'Herbicida/ingrediente citado'},
  {key:'calaris',name:'Calaris®',aliases:['calaris'],category:'Herbicida citado'},
  {key:'dual_gold',name:'Dual Gold®',aliases:['dual gold','dualgold'],category:'Herbicida residual citado'},
  ...OFFICIAL_PRODUCTS
]

const normalize=value=>String(value??'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9%/.,$]+/g,' ')
  .replace(/\s+/g,' ')
  .trim()
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const array=value=>Array.isArray(value)?value:[]
const unique=items=>[...new Set(items.filter(Boolean))]
const numeric=value=>Number.isFinite(Number(value))?Number(value):null
const dateValue=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date}
const hash=value=>createHash('sha256').update(String(value??'')).digest('hex').slice(0,20)
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2})
const sentenceList=items=>{
  const values=unique(items.map(item=>clean(item,120)).filter(Boolean))
  if(!values.length)return ''
  if(values.length===1)return values[0]
  if(values.length===2)return `${values[0]} e ${values[1]}`
  return `${values.slice(0,-1).join(', ')} e ${values.at(-1)}`
}

function containsAlias(text,alias){
  const target=` ${normalize(text)} `
  const candidate=` ${normalize(alias)} `
  return target.includes(candidate)
}

export function extractProductMentions(text=''){
  const mentions=[]
  for(const product of CONTEXT_PRODUCTS){
    const alias=product.aliases.find(item=>containsAlias(text,item))
    if(alias)mentions.push({...product,matchedAlias:alias})
  }
  return mentions
}

function extractPerHectareCost(text=''){
  const normalized=String(text||'')
  const patterns=[
    /(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:reais?)?\s*(?:\/|por\s*)?(?:ha|hectare)s?\b/i,
    /(?:custa|custo|investimento)\s*(?:de\s*)?(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)/i
  ]
  for(const pattern of patterns){
    const match=normalized.match(pattern)
    if(match){const parsed=Number(match[1].replace('.','').replace(',','.'));if(Number.isFinite(parsed))return parsed}
  }
  return null
}

function extractCommodityPrice(text=''){
  const match=String(text||'').match(/(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:reais?)?\s*(?:\/|por\s*)?(?:sc|saca)\b/i)
  if(!match)return null
  const parsed=Number(match[1].replace('.','').replace(',','.'))
  return Number.isFinite(parsed)?parsed:null
}

function extractArea(context={},text=''){
  const direct=[context.client?.area,context.client?.totalArea,context.client?.commercial?.area,context.client?.commercial?.totalArea]
    .map(numeric).find(value=>value!==null&&value>0)
  if(direct)return direct
  const match=String(text||'').match(/\b(\d{1,7}(?:[.,]\d+)?)\s*(?:ha|hectares?)\b/i)
  if(!match)return null
  const parsed=Number(match[1].replace('.','').replace(',','.'))
  return Number.isFinite(parsed)&&parsed>0?parsed:null
}

function cropsFrom(text=''){
  const candidates=[['milho','Milho'],['soja','Soja'],['trigo','Trigo'],['canola','Canola'],['sorgo','Sorgo'],['algodao','Algodão']]
  const source=normalize(text)
  return candidates.filter(([key])=>source.includes(key)).map(([,label])=>label)
}

function targetsFrom(text=''){
  const candidates=[
    ['cigarrinha','Cigarrinha-do-milho'],['dalbulus maidis','Cigarrinha-do-milho'],['enfezamento','Complexo de enfezamentos'],
    ['pulg','Pulgões'],['mosca branca','Mosca-branca'],['lagarta','Lagartas'],['percevejo','Percevejos']
  ]
  const source=normalize(text)
  return unique(candidates.filter(([key])=>source.includes(key)).map(([,label])=>label))
}

function operationFrom(text=''){
  const source=normalize(text)
  if(/dessecacao/.test(source)&&/(pre milho|pre semeadura|antes do milho)/.test(source))return 'Dessecação pré-milho'
  if(/dessecacao/.test(source))return 'Dessecação'
  if(/tratamento de sementes|ts\b/.test(source))return 'Tratamento de sementes'
  if(/plantio|semeadura|emergencia/.test(source))return 'Implantação do milho'
  if(/pulverizacao|aplicacao/.test(source))return 'Aplicação agrícola informada'
  return ''
}

function priorTurn(item,index){
  const question=clean(item?.user_question||item?.userQuestion||item?.question,3000)
  const createdAt=item?.created_at||item?.createdAt||null
  return {
    id:String(item?.id||`prior-${index}`),
    question,
    createdAt:dateValue(createdAt)?.toISOString()||null,
    nextBestAction:clean(item?.next_best_action||item?.nextBestAction,1200),
    nextQuestion:item?.next_question||item?.nextQuestion||null,
    methodology:item?.methodology_state||item?.methodologyState||null,
    commercialContext:item?.commercial_context||item?.commercialContext||null,
    feedback:item?.feedback||null,
    products:extractProductMentions(question),
    crops:cropsFrom(question),
    targets:targetsFrom(question),
    operation:operationFrom(question),
    costPerHa:extractPerHectareCost(question),
    commodityPrice:extractCommodityPrice(question)
  }
}

function explicitThreadReset(message=''){
  return /\b(?:novo assunto|outra conta|outro produtor|ignore a conversa anterior|desconsidere o anterior|mudar de assunto)\b/i.test(String(message||''))
}

export function buildConversationContinuity(context={},message=''){
  const history=array(context.priorRecommendations)
    .map(priorTurn)
    .filter(turn=>turn.question)
    .sort((left,right)=>String(right.createdAt||'').localeCompare(String(left.createdAt||'')))
    .slice(0,MAX_TURNS)
  const lastTurn=history[0]||null
  const currentProducts=extractProductMentions(message)
  const previousProducts=lastTurn?.products||[]
  const carryForward=Boolean(previousProducts.length&&!explicitThreadReset(message))
  const mergedProducts=[]
  const seen=new Set()
  for(const item of [...currentProducts,...(carryForward?previousProducts:[]),...history.slice(1,4).flatMap(turn=>turn.products)]){
    if(!seen.has(item.key)){seen.add(item.key);mergedProducts.push({...item,source:currentProducts.some(product=>product.key===item.key)?'current':'previous'})}
  }
  const currentCrops=cropsFrom(message)
  const currentTargets=targetsFrom(message)
  const crops=unique([...currentCrops,...(carryForward?(lastTurn?.crops||[]):[])])
  const targets=unique([...currentTargets,...(carryForward?(lastTurn?.targets||[]):[])])
  const operation=operationFrom(message)||(carryForward?lastTurn?.operation:'')||''
  const costPerHa=extractPerHectareCost(message)??(carryForward?lastTurn?.costPerHa:null)
  const commodityPrice=extractCommodityPrice(message)??(carryForward?lastTurn?.commodityPrice:null)
  const productNames=mergedProducts.map(item=>item.name)
  const previousProductNames=previousProducts.map(item=>item.name)
  const contextSentence=carryForward
    ?`Retomando a conversa anterior: você citou ${sentenceList(previousProductNames)}${lastTurn?.operation?` na ${lastTurn.operation.toLocaleLowerCase('pt-BR')}`:''}${lastTurn?.costPerHa?` e informou custo de ${money(lastTurn.costPerHa)}/ha`:''}.`
    :''
  const sequence=[...history].reverse().map((turn,index)=>({
    order:index+1,id:turn.id,createdAt:turn.createdAt,question:turn.question,products:turn.products.map(item=>item.name),operation:turn.operation,
    nextBestAction:turn.nextBestAction,feedback:turn.feedback
  }))
  return {
    version:VERSION,
    currentMessage:clean(message,3000),
    lastTurn,
    sequence,
    carryForward,
    products:mergedProducts,
    productNames,
    previousProductNames,
    crops,
    targets,
    operation,
    costPerHa,
    commodityPrice,
    areaHa:extractArea(context,[message,lastTurn?.question].filter(Boolean).join(' ')),
    contextSentence,
    turnCount:history.length,
    threadFingerprint:hash(JSON.stringify({client:context.client?.id||context.client?.name,products:productNames,crops,targets,operation}))
  }
}

function detectsTechnicalWork(text=''){
  return /\b(?:manejo|inseticida|herbicida|fungicida|produto|dose|aplica[cç][aã]o|pulveriza[cç][aã]o|praga|cigarrinha|enfezamento|tratamento de sementes|desseca[cç][aã]o|monitoramento)\b/i.test(text)
}
function detectsCommercialWork(text=''){
  return /\b(?:venda|vender|valor|custa|custo|pre[cç]o|argumenta[cç][aã]o|obje[cç][aã]o|proposta|negocia[cç][aã]o|retorno|roi|ponto de equil[ií]brio)\b/i.test(text)
}
function detectsPriority(text=''){
  return /\b(?:priorizar|prioridade|compare as oportunidades|qual decis[aã]o merece prioridade|radar da conta)\b/i.test(text)
}
function detectsVisit(text=''){
  return /\b(?:preparar|planejar|roteiro).{0,30}\bvisita\b|\bpr[oó]xima visita\b/i.test(text)
}
function detectsCommitment(text=''){
  return /\b(?:fechar pr[oó]ximo passo|pr[oó]ximo compromisso|compromisso verific[aá]vel|avan[cç]ar a negocia[cç][aã]o|fechamento)\b/i.test(text)
}
function detectsValueSale(text=''){
  return /\b(?:sair do pre[cç]o|venda de valor|defender valor|comparando pre[cç]o|sem desconto|produto novo)\b/i.test(text)
}
function isShortFollowUp(text=''){
  const value=clean(text)
  return value.length<=180&&/\b(?:e agora|continue|como sigo|o que fa[cç]o|e a venda|e o manejo|ent[aã]o|pr[oó]ximo passo|como vendo|monte a proposta|fa[cç]a isso)\b/i.test(value)
}

export function classifyConversationIntent(context={},message='',continuity=buildConversationContinuity(context,message)){
  const current=clean(message,3000)
  const inherited=continuity.carryForward?clean(continuity.lastTurn?.question,3000):''
  const combined=`${current} ${isShortFollowUp(current)?inherited:''}`
  const technical=detectsTechnicalWork(combined)
  const commercial=detectsCommercialWork(combined)
  if(technical&&commercial)return 'agronomic_commercial_decision'
  if(detectsPriority(current))return 'account_priority'
  if(detectsVisit(current))return 'visit_preparation'
  if(detectsCommitment(current))return 'commitment'
  if(detectsValueSale(current))return 'value_sale'
  if(technical)return 'technical_decision'
  if(isShortFollowUp(current)&&continuity.lastTurn){
    const prior=continuity.lastTurn.question
    if(detectsTechnicalWork(prior)&&detectsCommercialWork(prior))return 'agronomic_commercial_decision'
    if(detectsVisit(prior))return 'visit_preparation'
    if(detectsValueSale(prior))return 'value_sale'
  }
  return 'decision_support'
}

function countContextSources(context={}){
  return ['businessHistory','visits','interactions','opportunities','properties','fieldReports','soilAnalyses','ndviObservations','manualRecords','signals','memories','priorRecommendations']
    .reduce((sum,key)=>sum+array(context[key]).length,0)
}

export function chooseAutomaticRoute(context={},message='',continuity=buildConversationContinuity(context,message),options={}){
  const intent=classifyConversationIntent(context,message,continuity)
  const sourceCount=countContextSources(context)
  const attachmentCount=Number(options.attachmentCount||0)
  const current=clean(message,3000)
  const nuanced=current.length>220||/(?:por[eé]m|ao mesmo tempo|considerando|cruze|estrat[eé]gia|cen[aá]rio|alternativa)/i.test(current)
  let mode='deterministic'
  let useGenerativeAi=false
  let reason='Regras e dados estruturados são suficientes para calcular a próxima decisão.'
  let retrieval=false
  let humanReview=false

  if(attachmentCount>0){mode='hybrid';useGenerativeAi=true;reason='Há arquivo ou imagem para interpretar; a IA organiza a leitura e as regras preservam os limites.'}
  else if(['agronomic_commercial_decision','technical_decision'].includes(intent)){
    mode='retrieval_hybrid';useGenerativeAi=true;retrieval=true;humanReview=true
    reason='A solicitação combina contexto técnico, produto e decisão comercial; exige síntese de linguagem, base oficial e revisão humana.'
  }else if(intent==='value_sale'&&(continuity.products.length||nuanced)){
    mode='hybrid';useGenerativeAi=true;retrieval=Boolean(continuity.products.length);humanReview=continuity.products.some(item=>item.category?.toLocaleLowerCase('pt-BR').includes('inseticida'))
    reason='A negociação de valor depende de contexto, produto, objeção e linguagem adaptada; o cálculo continua determinístico.'
  }else if(['account_priority','visit_preparation','commitment'].includes(intent)&&!nuanced){
    mode='deterministic';useGenerativeAi=false
    reason='O botão aciona um fluxo calculado sobre a conta; a resposta não depende de texto generativo.'
  }else if(sourceCount>=4||nuanced||isShortFollowUp(current)){
    mode='hybrid';useGenerativeAi=true
    reason='Há contexto suficiente para uma síntese não trivial; a IA explica, enquanto regras escolhem score, lacunas e ação.'
  }

  return {version:VERSION,intent,mode,useGenerativeAi,retrieval,humanReview,reason,sourceCount,attachmentCount}
}

function phraseFound(text,patterns=[]){return patterns.some(pattern=>pattern.test(String(text||'')))}
function conversationCorpus(continuity){return [continuity.currentMessage,...continuity.sequence.map(turn=>turn.question)].join(' ')}

function buildDecisionSequence(continuity,plan={}){
  const corpus=conversationCorpus(continuity)
  const hasRiskMap=phraseFound(corpus,[/milho (?:mais velho|vizinho|pr[oó]ximo)/i,/tiguera|milho volunt[aá]rio/i,/press[aã]o|infesta[cç][aã]o|monitoramento/i,/data (?:de )?(?:plantio|semeadura|emerg[eê]ncia)/i])
  const hasHybridAndSeed=phraseFound(corpus,[/h[ií]brido/i])&&phraseFound(corpus,[/tratamento de sementes|\bts\b/i])
  const hasEconomics=continuity.costPerHa!==null&&continuity.commodityPrice!==null&&continuity.areaHa!==null
  const hasProof=phraseFound(corpus,[/faixa|talh[aã]o comparativo|pontos de monitoramento|crit[eé]rio de reavalia[cç][aã]o|prova/i])
  const hasCommitment=phraseFound(corpus,[/agend|data combinada|respons[aá]vel|fechado|aprovado/i])
  const steps=[
    {id:'context',label:'Fixar o contexto da área',status:continuity.operation&&continuity.products.length?'complete':'current',evidence:continuity.operation||'Operação anterior ainda não registrada.'},
    {id:'risk',label:'Mapear a pressão e a janela',status:hasRiskMap&&hasHybridAndSeed?'complete':continuity.operation?'current':'pending',evidence:hasRiskMap?'Há parte do mapa de risco registrada.':'Faltam emergência, tiguera, milho vizinho e pressão local.'},
    {id:'technical',label:'Posicionar o manejo',status:hasRiskMap&&plan.focusProduct?'current':'pending',evidence:plan.focusProduct?`${plan.focusProduct.name} identificado; execução depende de validação técnica.`:'Produto foco ainda não identificado.'},
    {id:'economics',label:'Traduzir investimento em valor',status:hasEconomics?'complete':continuity.costPerHa!==null?'current':'pending',evidence:continuity.costPerHa!==null?`Custo informado: ${money(continuity.costPerHa)}/ha.`:'Custo por hectare ainda não informado.'},
    {id:'proof',label:'Definir prova e acompanhamento',status:hasProof?'complete':hasRiskMap?'current':'pending',evidence:hasProof?'Plano de prova mencionado.':'Definir indicadores, pontos e data de reavaliação.'},
    {id:'commitment',label:'Fechar a próxima decisão',status:hasCommitment?'complete':hasProof?'current':'pending',evidence:hasCommitment?'Compromisso registrado.':'Faltam responsável, prazo e condição de avanço.'}
  ]
  const currentIndex=Math.max(0,steps.findIndex(step=>step.status==='current'))
  return {steps,currentStep:steps[currentIndex],nextStep:steps[Math.min(currentIndex+1,steps.length-1)],completed:steps.filter(step=>step.status==='complete').length,total:steps.length}
}

function officialProductByKey(key){return OFFICIAL_PRODUCTS.find(item=>item.key===key)||null}
function focusProduct(continuity){
  const efficon=continuity.products.find(item=>item.key==='efficon')
  if(efficon)return officialProductByKey('efficon')
  const official=continuity.products.find(item=>officialProductByKey(item.key))
  return official?officialProductByKey(official.key):null
}

function missingDecisionData(continuity){
  const corpus=conversationCorpus(continuity)
  const checks=[
    ['Data prevista de semeadura e emergência',/data (?:de )?(?:plantio|semeadura|emerg[eê]ncia)|vai emergir|semeadura em/i],
    ['Presença de milho tiguera e lavouras mais velhas no entorno',/tiguera|milho volunt[aá]rio|milho (?:mais velho|vizinho|pr[oó]ximo)/i],
    ['Híbrido e tolerância ao complexo de enfezamentos',/h[ií]brido|toler[aâ]ncia.*enfezamento/i],
    ['Tratamento de sementes utilizado',/tratamento de sementes|\bts\b/i],
    ['Pressão ou monitoramento regional de cigarrinha',/press[aã]o|infesta[cç][aã]o|captura|armadilha|monitoramento/i],
    ['Área que entrará no programa',/\d+[.,]?\d*\s*(?:ha|hectare)/i],
    ['Preço de referência da saca de milho',/(?:r\$\s*)?\d+[.,]?\d*\s*(?:\/|por\s*)?(?:sc|saca)/i],
    ['Critério de reavaliação após a primeira intervenção',/reavalia[cç][aã]o|reinfesta[cç][aã]o|pontos de monitoramento|crit[eé]rio de parada/i]
  ]
  return checks.filter(([,pattern])=>!pattern.test(corpus)).map(([label])=>label)
}

function highValueQuestion(missing=[]){
  if(missing.includes('Data prevista de semeadura e emergência')||missing.includes('Presença de milho tiguera e lavouras mais velhas no entorno'))return 'Qual é a data prevista de emergência e existe milho tiguera ou lavoura de milho mais velha no entorno da área?'
  if(missing.includes('Híbrido e tolerância ao complexo de enfezamentos')||missing.includes('Tratamento de sementes utilizado'))return 'Qual híbrido será semeado e qual tratamento de sementes foi definido para essa área?'
  if(missing.includes('Pressão ou monitoramento regional de cigarrinha'))return 'Qual é a pressão observada ou o dado de monitoramento de cigarrinha na região e na propriedade?'
  if(missing.includes('Área que entrará no programa')||missing.includes('Preço de referência da saca de milho'))return 'Quantos hectares entrarão no programa e qual preço de referência da saca de milho devemos usar na conta?'
  if(missing.includes('Critério de reavaliação após a primeira intervenção'))return 'Qual indicador e qual data serão usados para reavaliar reinfestação e decidir o próximo movimento?'
  return 'Qual decisão precisa ficar fechada na próxima conversa com o produtor?'
}

function consultantEvidence(continuity){
  const sourceText=continuity.lastTurn?.question||continuity.currentMessage
  if(!sourceText)return null
  return {
    id:`conversation-${hash(sourceText)}`,
    claim_supported:`O consultor informou: ${clean(sourceText,650)}`,
    source_type:'interaction',
    source_id:continuity.lastTurn?.id||`current:${continuity.threadFingerprint}`,
    observed_at:continuity.lastTurn?.createdAt||new Date().toISOString(),
    direct_observation:true,
    quality:'moderate',
    relevance:'high',
    uncertainty:'A informação foi declarada pelo consultor e precisa ser vinculada à área, data e registro técnico antes de orientar execução.'
  }
}

function officialEvidence(product){
  if(!product)return null
  return {
    id:`official-product-${product.key}`,
    claim_supported:`${product.name}, ${product.manufacturer}: ${product.active}. ${product.valueClaims.join(' ')}`,
    source_type:'official_product_catalog',
    source_id:product.officialSource,
    observed_at:`${product.verifiedAt}T00:00:00.000Z`,
    direct_observation:true,
    quality:'high',
    relevance:'high',
    uncertainty:'Confirmar rótulo, bula, registro, cultura, alvo, modalidade e restrições vigentes antes da recomendação ou execução.'
  }
}

function buildTechnicalCommercialPlan(context,continuity,intent){
  if(!['agronomic_commercial_decision','technical_decision','value_sale'].includes(intent)&&!continuity.targets.includes('Cigarrinha-do-milho'))return null
  const product=focusProduct(continuity)
  const priorApplicationProducts=continuity.products.filter(item=>['glufosinato','calaris','dual_gold','trinca_caps'].includes(item.key)).map(item=>item.name)
  const missing=missingDecisionData(continuity)
  const breakEven=continuity.costPerHa!==null&&continuity.commodityPrice
    ?continuity.costPerHa/continuity.commodityPrice
    :null
  const totalInvestment=continuity.costPerHa!==null&&continuity.areaHa!==null?continuity.costPerHa*continuity.areaHa:null
  const plan={
    version:VERSION,
    topic:'Manejo da cigarrinha no milho e venda de valor',
    focusProduct:product,
    previousOperation:continuity.operation||'Operação anterior não confirmada',
    previousProducts:priorApplicationProducts,
    costPerHa:continuity.costPerHa,
    areaHa:continuity.areaHa,
    commodityPrice:continuity.commodityPrice,
    totalInvestment,
    breakEvenBagsPerHa:breakEven,
    knownFacts:[
      continuity.operation&&`Operação informada: ${continuity.operation}.`,
      priorApplicationProducts.length&&`Produtos citados nessa operação: ${sentenceList(priorApplicationProducts)}.`,
      product&&`Produto foco da venda: ${product.name}, da ${product.manufacturer}.`,
      continuity.costPerHa!==null&&`Investimento informado: ${money(continuity.costPerHa)}/ha.`
    ].filter(Boolean),
    technicalSequence:[
      {step:'Fechar a ponte pré-milho',decision:'Confirmar se a dessecação eliminou milho tiguera e se há ponte verde no entorno.',why:'O manejo de enfezamentos é preventivo e regional; a operação herbicida anterior não define sozinha o risco da cigarrinha.',status:continuity.operation?'context_recorded':'missing_context'},
      {step:'Mapear a janela de risco',decision:'Registrar emergência, milho mais velho próximo, híbrido, tratamento de sementes e pressão monitorada.',why:'Esses dados determinam urgência, formato de acompanhamento e o momento de reavaliação.',status:'needs_data'},
      {step:'Posicionar a ferramenta',decision:product?`Usar ${product.name} como ferramenta do programa, com os fatos de bula separados da recomendação final.`:'Identificar e validar o produto foco na fonte oficial.',why:product?'A fonte oficial o posiciona para cigarrinha-do-milho e descreve interrupção da alimentação.':'Sem produto validado não existe argumento técnico defensável.',status:product?'official_reference_found':'needs_product'},
      {step:'Monitorar e reavaliar',decision:'Definir pontos, frequência, registro de reinfestação e condição para o próximo movimento.',why:'Uma aplicação não encerra automaticamente o risco; o sistema precisa conduzir a próxima decisão com evidência.',status:'needs_protocol'},
      {step:'Rotacionar e integrar',decision:'Manter MIP, manejo de resistência, práticas culturais e revisão da bula vigente.',why:'Nenhuma ferramenta isolada substitui eliminação de tiguera, híbrido, tratamento de sementes e monitoramento.',status:'human_review'}
    ],
    commercialValue:{
      positioning:'Não vender “um inseticida de R$ 170/ha”; vender uma decisão de proteção da janela inicial, com critério de uso, monitoramento e reavaliação.',
      costSentence:continuity.costPerHa===null?'O custo por hectare ainda precisa ser confirmado.':`O investimento informado é ${money(continuity.costPerHa)}/ha.`,
      totalSentence:totalInvestment===null?'Informe a área para calcular o investimento total.':`Na área informada, o investimento total é ${money(totalInvestment)}.`,
      breakEvenSentence:breakEven===null?'O ponto de equilíbrio será calculado por: custo por hectare ÷ preço da saca de milho.':`Com saca a ${money(continuity.commodityPrice)}, o ponto de equilíbrio é ${breakEven.toLocaleString('pt-BR',{maximumFractionDigits:2})} sc/ha.`,
      proofPlan:'Definir antes da proposta quais dados serão registrados: pressão inicial, data, pontos de monitoramento, reinfestação, condição da lavoura e decisão tomada. Qualquer área comparativa deve ser tecnicamente aprovada.',
      argumentPath:[
        'Reconhecer o investimento já realizado na dessecação e não desqualificar Glufosinato, Calaris®, Dual Gold® ou Trinca Caps®.',
        'Mostrar que a decisão seguinte é proteger o milho na janela de maior vulnerabilidade, e não repetir a lógica da operação anterior.',
        product?`Apresentar ${product.name} pelo problema que resolve e pelo modo de ação documentado, sem prometer produtividade.`:'Validar o produto foco e sua fonte oficial.',
        'Traduzir R$/ha em ponto de equilíbrio por saca, sem transformar perda evitada em garantia.',
        'Fechar monitoramento, responsável, data de reavaliação e condição para o próximo passo.'
      ],
      suggestedOpening:`“Na dessecação vocês já investiram em ${sentenceList(priorApplicationProducts)||'um programa pré-milho'}. Agora a decisão é outra: como proteger a fase inicial do milho contra a entrada e a alimentação da cigarrinha, com monitoramento e critério claro de reavaliação.”`,
      valueQuestion:'“Quanto de produtividade por hectare precisa ser protegido para esse investimento se pagar, usando o preço de milho que você considera realista?”',
      commitmentQuestion:'“Podemos fechar a área, os pontos de monitoramento, quem acompanha e a data da primeira reavaliação antes da emergência?”'
    },
    missingData:missing,
    nextQuestion:highValueQuestion(missing),
    evidence:[consultantEvidence(continuity),officialEvidence(product)].filter(Boolean)
  }
  plan.sequence=buildDecisionSequence(continuity,plan)
  return plan
}

function isGenericText(value=''){
  const source=clean(value).toLocaleLowerCase('pt-BR')
  if(!source)return true
  const generic=[
    'converse com o cliente','entenda as necessidades','faça uma abordagem consultiva','apresente os benefícios','avalie o cenário',
    'identifique as dores','mostre o valor','faça um acompanhamento','busque mais informações','adapte a abordagem'
  ]
  return generic.some(item=>source.includes(item))&&source.length<700
}

function coreData(advice={}){
  const core=advice.conversion_intelligence||{}
  return {
    selected:core.selected_opportunity||{},
    workflow:core.workflow||{},
    quality:core.data_quality||{},
    learning:core.learning||{},
    score:numeric(core.score??core.selected_opportunity?.score),
    priority:clean(core.priority||advice.executive_brief?.priority||'acompanhar')
  }
}

function dynamicDecisionAnswer(advice,orchestration){
  const {continuity,intent}=orchestration
  const data=coreData(advice)
  const producer=clean(orchestration.producerName||'Produtor',140)
  const title=clean(data.selected.title||advice.opportunity_review?.selected_title||'oportunidade ainda não qualificada',180)
  const score=data.score===null?'sem score suficiente':`${Math.round(data.score)}/100`
  const reasons=array(data.selected.reasons).slice(0,3).map(clean).filter(Boolean)
  const action=clean(advice.executive_brief?.action||advice.next_best_action||data.workflow.action,'Registrar o próximo passo verificável.')
  const question=clean(advice.executive_brief?.question||advice.next_question?.question||data.workflow.question)
  const prefix=continuity.contextSentence
  if(intent==='visit_preparation')return `${prefix} Para a visita com ${producer}, a prioridade calculada é “${title}” (${score})${reasons.length?`, por ${reasons.join('; ')}`:''}. Entre para confirmar a decisão afetada, faça a pergunta “${question||'qual decisão precisa ser tomada nesta janela?'}” e só saia com responsável, prazo e evidência do próximo avanço. ${action}`.trim()
  if(intent==='account_priority')return `${prefix} Na conta de ${producer}, “${title}” ficou em primeiro lugar com score operacional ${score}${reasons.length?`, porque ${reasons.join('; ')}`:''}. Esse score organiza o trabalho e não prevê compra. ${action}`.trim()
  if(intent==='commitment')return `${prefix} Para transformar “${title}” em avanço real, não peça uma decisão ampla: confirme a única pendência, quem resolve e a data. Pergunta sugerida: “${question||'qual pendência impede o próximo passo agora?'}” ${action}`.trim()
  if(intent==='value_sale')return `${prefix} Para ${producer}, a conversa de valor deve partir de “${title}”, com score ${score}, e não de uma apresentação genérica de benefícios. Compare impacto, risco, custo total e forma de comprovação; depois feche um próximo passo datado. ${action}`.trim()
  return `${prefix} Para ${producer}, a decisão prioritária é “${title}” (${score}). ${action}${question?` A próxima pergunta é: “${question}”`:''}`.trim()
}

function mergeEvidence(current=[],incoming=[]){
  const seen=new Set()
  return [...array(incoming),...array(current)].filter(item=>item?.id&&!seen.has(item.id)&&seen.add(item.id)).slice(0,15)
}

function technicalAnswer(plan,continuity){
  const product=plan.focusProduct
  const productSentence=product
    ?`${product.name}, da ${product.manufacturer}, foi identificado como o produto foco; a fonte oficial o posiciona para cigarrinha-do-milho, mas rótulo, bula e receituário precisam governar a execução.`
    :'O produto foco ainda precisa ser validado em fonte oficial antes de qualquer posicionamento.'
  const economics=plan.commercialValue.breakEvenSentence
  return `${continuity.contextSentence||`Contexto registrado: ${plan.previousOperation} com ${sentenceList(plan.previousProducts)}.`} O próximo bloco não é repetir a dessecação: é fechar a ponte entre tiguera, milho mais velho no entorno, emergência, híbrido, tratamento de sementes e monitoramento da cigarrinha. ${productSentence} ${economics} A venda de valor deve fechar área, pontos de monitoramento, responsável e data de reavaliação; o próximo dado que mais muda a decisão é: ${plan.nextQuestion}`.trim()
}

function technicalConversationPlan(plan){
  const product=plan.focusProduct?.name||'a ferramenta selecionada'
  return {
    opening:plan.commercialValue.suggestedOpening,
    steps:[
      {stage:'diagnóstico',question_type:'aberta',goal:'Fechar o mapa de risco da área.',suggested_line:plan.nextQuestion,advance_signal:'Emergência, tiguera/milho vizinho, híbrido, tratamento de sementes e pressão estão registrados.',if_resistance:'Explique que sem esses dados qualquer calendário vira uma resposta pronta.'},
      {stage:'valor',question_type:'aberta',goal:'Traduzir o investimento em proteção mensurável.',suggested_line:plan.commercialValue.valueQuestion,advance_signal:'Preço da saca, área e ponto de equilíbrio estão confirmados.',if_resistance:'Mostre a fórmula e peça os números do produtor; não invente perda evitada.'},
      {stage:'proposta',question_type:'não_aplicável',goal:`Posicionar ${product} dentro do programa e da fonte vigente.`,suggested_line:product?`Apresente ${product} pelo alvo, modo de ação documentado, critério de uso e monitoramento — não por promessa de produtividade.`:'Valide o produto e a fonte oficial antes da proposta.',advance_signal:'Produto, fonte, revisão técnica, área e forma de acompanhamento estão acordados.',if_resistance:'Volte ao critério de decisão e à prova necessária.'},
      {stage:'fechamento',question_type:'fechada',goal:'Converter a proposta em compromisso verificável.',suggested_line:plan.commercialValue.commitmentQuestion,advance_signal:'Área, responsável, data e critério de reavaliação foram aceitos.',if_resistance:'Reduza o compromisso para coleta de dados e nova data.'}
    ],
    closing_options:[{when:'Depois de validar o mapa de risco e a revisão técnica.',suggested_line:plan.commercialValue.commitmentQuestion,commitment:'Área, responsável, pontos de monitoramento e data.'}],
    do_not_say:['Não prometer produtividade ou ausência de enfezamento.','Não tratar a aplicação anterior como prova de proteção futura.','Não transformar similaridade ou material de marketing em prescrição.']
  }
}

export function buildConversationOrchestration(context={},message='',options={}){
  const continuity=buildConversationContinuity(context,message)
  const route=chooseAutomaticRoute(context,message,continuity,options)
  const technicalCommercialPlan=buildTechnicalCommercialPlan(context,continuity,route.intent)
  const sequence=technicalCommercialPlan?.sequence||buildDecisionSequence(continuity,{focusProduct:focusProduct(continuity)})
  return {
    version:VERSION,
    generatedAt:new Date().toISOString(),
    producerId:String(context.client?.id||''),
    producerName:clean(context.client?.name||context.client?.id||'Produtor',180),
    continuity,
    route,
    sequence,
    technicalCommercialPlan,
    authority:{rules:'priority_score_next_action',officialKnowledge:'technical_facts',generativeAi:'language_and_synthesis',human:'approval_and_execution'}
  }
}

export function enrichAdviceWithOrchestration(advice={},orchestration={},options={}){
  const result=structuredClone(advice&&typeof advice==='object'?advice:{})
  const continuity=orchestration.continuity||{}
  const route=orchestration.route||{}
  const plan=orchestration.technicalCommercialPlan||null
  result.automatic_routing={
    version:orchestration.version||VERSION,
    intent:route.intent||'decision_support',
    mode:route.mode||'deterministic',
    used_generative_ai:options.usedGenerativeAi===true,
    retrieval_required:route.retrieval===true,
    human_review_required:route.humanReview===true,
    reason:route.reason||'',
    authority:orchestration.authority||{}
  }
  result.conversation_continuity={
    thread_fingerprint:continuity.threadFingerprint||'',
    carried_from_previous_turn:continuity.carryForward===true,
    turn_count:Number(continuity.turnCount||0),
    previous_question:clean(continuity.lastTurn?.question,1200),
    products:array(continuity.products).map(item=>({key:item.key,name:item.name,source:item.source||'current',manufacturer:item.manufacturer||'',category:item.category||''})),
    crops:array(continuity.crops),targets:array(continuity.targets),operation:continuity.operation||'',cost_per_ha:continuity.costPerHa,
    sequence:array(continuity.sequence).slice(-6)
  }
  result.decision_sequence=orchestration.sequence||null

  if(plan){
    result.technical_commercial_plan=plan
    result.answer=technicalAnswer(plan,continuity)
    result.objective='Transformar o contexto técnico já informado em um programa de decisão e em uma venda de valor mensurável, sem substituir a revisão agronômica.'
    result.executive_brief={
      priority:'esta_semana',
      headline:`Fechar o mapa de risco e o caso de valor para ${plan.focusProduct?.name||'o manejo da cigarrinha'}`,
      reason:`A área já tem uma operação pré-milho registrada com ${sentenceList(plan.previousProducts)||'produtos informados'}, há foco em cigarrinha e investimento de ${plan.costPerHa===null?'valor ainda não confirmado':`${money(plan.costPerHa)}/ha`}.`,
      action:`Registrar ${plan.missingData.slice(0,4).join(', ')}; depois validar o posicionamento técnico e fechar o plano de monitoramento.`,
      deadline:'Antes da emergência e de qualquer proposta final ao produtor',
      question:plan.nextQuestion,
      decision_basis:plan.knownFacts.slice(0,3),
      evidence_ids:plan.evidence.map(item=>item.id).slice(0,3),
      missing_data:plan.missingData.slice(0,3)
    }
    result.next_best_action=result.executive_brief.action
    result.next_question={stage:'situação',type:'aberta',question:plan.nextQuestion,ask_when:'Na próxima interação desta sequência.',purpose:'Preencher o dado que mais altera risco, urgência e posicionamento.',evidence_needed:'Resposta vinculada à área e à safra.',grounding_ids:plan.evidence.map(item=>item.id).slice(0,5)}
    result.questions=[result.next_question,{stage:'necessidade',type:'aberta',question:plan.commercialValue.valueQuestion,ask_when:'Depois de fechar o mapa de risco.',purpose:'Calcular ponto de equilíbrio sem inventar perda.',evidence_needed:'Preço da saca, área e critério de valor.',grounding_ids:plan.evidence.map(item=>item.id).slice(0,5)}]
    result.conversation_plan=technicalConversationPlan(plan)
    result.value_hypothesis={
      problem:'Risco de entrada, alimentação e reinfestação de cigarrinha na fase inicial do milho, com decisão comercial ainda não dimensionada.',
      baseline:`Operação pré-milho informada com ${sentenceList(plan.previousProducts)||'programa ainda a detalhar'}; pressão, emergência, híbrido e tratamento de sementes ainda precisam ser consolidados.`,
      act_now:plan.commercialValue.positioning,
      wait:'Esperar sem monitoramento reduz a capacidade de agir no início da infestação; o risco exato não foi quantificado.',
      maintain:'Manter somente o que já foi aplicado não comprova proteção após a emergência.',
      impact_to_quantify:'Custo por hectare, preço da saca, área, pressão monitorada, reinfestação e produtividade que precisa ser protegida.',
      value_metric:plan.breakEvenBagsPerHa===null?'Ponto de equilíbrio = custo/ha ÷ preço da saca.':`${plan.breakEvenBagsPerHa.toLocaleString('pt-BR',{maximumFractionDigits:2})} sc/ha para cobrir o investimento informado.`,
      time_horizon:'Da pré-emergência à janela inicial de desenvolvimento do milho, com reavaliações definidas no plano.',
      proof_plan:plan.commercialValue.proofPlan,
      double_counting_guard:'Não somar a mesma produtividade como ganho adicional e perda evitada; não atribuir todo o resultado a um único produto.',
      uncertainty:plan.missingData.join('; ')
    }
    result.value_bridge={
      status:plan.focusProduct?'ready':'needs_product',
      price_zone_reading:plan.commercialValue.positioning,
      reframe:plan.commercialValue.breakEvenSentence,
      value_dimensions:['janela de vulnerabilidade','pressão e reinfestação','ponto de equilíbrio em sc/ha','monitoramento e prova','MIP e manejo de resistência'],
      anchor_product:plan.focusProduct?{name:plan.focusProduct.name,registration:'Confirmar no Agrofit/MAPA',manufacturer:plan.focusProduct.manufacturer,category:plan.focusProduct.category,composition:plan.focusProduct.active,evidence_id:`official-product-${plan.focusProduct.key}`}:null,
      alternatives:[],
      argument_path:plan.commercialValue.argumentPath.map((line,index)=>({step:`Passo ${index+1}`,suggested_line:line,evidence_needed:index===3?'Preço da saca e custo por hectare.':'Resposta e registro do produtor.'})).slice(0,4),
      negotiation_question:plan.commercialValue.valueQuestion,
      do_not_claim:'Não prometer controle absoluto, produtividade, ausência de enfezamento ou retorno financeiro. Não afirmar compatibilidade de mistura sem fonte e validação.',
      technical_review:plan.focusProduct?.labelReference?`Referência de bula localizada: ${plan.focusProduct.labelReference.productRate}; ${plan.focusProduct.labelReference.timing}; máximo ${plan.focusProduct.labelReference.maximumApplications}; intervalo ${plan.focusProduct.labelReference.interval}. Confirmar versão vigente e receituário antes de executar.`:'Validar produto, bula e registro vigentes.',
      grounding_ids:plan.evidence.map(item=>item.id)
    }
    result.evidence_used=mergeEvidence(result.evidence_used,plan.evidence)
    result.human_review={required:true,reason:`O sistema organizou o manejo e a venda de valor de ${plan.focusProduct?.name||'produto regulado'}, mas dose, mistura, sequência de aplicações e execução dependem do responsável técnico e da bula vigente.`,required_role:'technical_reviewer',status:'pending'}
    result.blocked_actions=unique([...(array(result.blocked_actions)),'Executar dose, mistura ou sequência sem validação técnica','Prometer controle absoluto, produtividade ou retorno','Tratar os produtos da dessecação como automaticamente compatíveis com o programa pós-emergência'])
    result.guardrails=unique([...(array(result.guardrails)),'Usar a conversa anterior como contexto, não como prescrição','Separar fato de bula, dado do consultor, inferência e decisão humana','Calcular valor com números confirmados e registrar a condição de reavaliação'])
    result.confidence={
      ...(result.confidence||{}),
      level:'not_calibrated',calibration_status:'not_calibrated',conversion_probability:null,
      rationale:`A orientação usa ${plan.evidence.length} fonte(s), preserva os produtos citados e explicita ${plan.missingData.length} dado(s) faltante(s). Não é probabilidade de compra nem prescrição automática.`,
      evidence_quality:plan.focusProduct?'Há fonte oficial do produto e declaração do consultor; o contexto da área ainda está incompleto.':'Há declaração do consultor, mas falta fonte oficial do produto.',
      relevance:'Alta para organizar a próxima decisão comercial e técnica.',
      freshness:'A conversa mais recente foi carregada automaticamente.',
      source_agreement:'A fonte oficial sustenta o alvo e o modo de ação; os dados específicos da área ainda precisam ser confirmados.',
      missing_data:plan.missingData.slice(0,10),
      contradictions:array(result.confidence?.contradictions)
    }
  }else{
    const existing=clean(result.answer)
    const needsRewrite=isGenericText(existing)||!existing
    if(needsRewrite)result.answer=dynamicDecisionAnswer(result,orchestration)
    else if(continuity.contextSentence&&continuity.previousProductNames?.length&&!continuity.previousProductNames.some(name=>normalize(existing).includes(normalize(name))))result.answer=`${continuity.contextSentence} ${existing}`
    result.evidence_used=mergeEvidence(result.evidence_used,[consultantEvidence(continuity)].filter(Boolean))
  }

  result.generic_response_blocked=true
  result.conversation_orchestrator_version=VERSION
  return result
}

export const conversationOrchestratorVersion=VERSION
export const officialProductKnowledge=OFFICIAL_PRODUCTS
