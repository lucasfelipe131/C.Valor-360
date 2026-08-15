import {readFileSync} from 'node:fs'

const agrofitProducts=JSON.parse(readFileSync(new URL('../manual/app/agrofit-products.json',import.meta.url),'utf8'))
const foliarProducts=JSON.parse(readFileSync(new URL('../manual/app/foliar-products.json',import.meta.url),'utf8'))
const AGROFIT_URL='https://agrofit.agricultura.gov.br/agrofit_cons/principal_agrofit_cons'

const array=value=>Array.isArray(value)?value:[]
const clean=(value,max=260)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,1000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim()
const words=value=>new Set(normalize(value).split(/\s+/).filter(item=>item.length>2))
const overlap=(left,right)=>{const a=words(left);const b=words(right);return [...a].filter(item=>b.has(item)).length}
const catalogAliases=product=>clean(product.name,500).split(';').map(normalize).filter(item=>item.length>=4)
const trueStatus=value=>['true','ativo','active','liberado'].includes(normalize(value))
const cropText=context=>[context.client?.cultures,...array(context.properties).flatMap(property=>array(property.fields).flatMap(field=>array(field.seasons).map(season=>season.crop)))].filter(Boolean).join(' ')
const accountProductText=context=>[
  ...array(context.businessHistory).map(item=>item.product),
  ...array(context.opportunities).flatMap(item=>[item.title,item.category]),
  context.client?.commercial?.mainCategories
].filter(Boolean).join(' ')
const ingredientSignature=value=>normalize(String(value||'').replace(/\([^)]*(?:g\s*\/\s*[lk]|grama|ml\s*\/\s*l|%)?[^)]*\)/gi,' ')).split(/\s+\+\s+|\s+e\s+/).map(item=>item.trim()).filter(Boolean).sort().join(' + ')
const exactComposition=value=>normalize(value)
const cropMatch=(product,cultures)=>array(product.crops).some(crop=>normalize(crop).includes('todas as culturas')||overlap(crop,cultures)>0)
const evidence=(id,product,claim)=>({id,claim_supported:clean(claim,650),source_type:'official_product_catalog',source_id:product.registration?`mapa:${product.registration}`:product.source||product.id||product.name,observed_at:'unknown',direct_observation:true,quality:'moderate',relevance:'high',uncertainty:'O catálogo é uma base de consulta. Confirme registro, cultura, alvo, modalidade, formulação, restrições e bula ou ficha técnica vigentes antes de comparar ou recomendar.'})

function locateProduct(text,products,kind){
  const normalized=` ${normalize(text)} `
  if(normalized.trim().length<4)return null
  const direct=products.map(product=>({product,alias:catalogAliases(product).filter(alias=>normalized.includes(` ${alias} `)||normalized.includes(alias)).sort((a,b)=>b.length-a.length)[0]})).filter(item=>item.alias).sort((a,b)=>b.alias.length-a.alias.length)[0]
  if(direct)return {...direct.product,kind}
  return null
}

function sourceText(context,message){
  const latestBusiness=array(context.businessHistory)[0]
  const latestOpportunity=array(context.opportunities).find(item=>normalize(item.stage)!=='fechado')||array(context.opportunities)[0]
  return [message,latestBusiness?.product,latestOpportunity?.title,latestOpportunity?.hypothesis,context.client?.commercial?.opportunity].filter(Boolean).join(' • ')
}

function locateAnchor(context,message){
  const text=sourceText(context,message)
  return locateProduct(text,agrofitProducts,'agrofit')||locateProduct(text,foliarProducts,'foliar')
}

function similarAgrofit(anchor,context){
  const exact=exactComposition(anchor.active)
  const ingredients=ingredientSignature(anchor.active)
  const cultures=cropText(context)
  const accountProducts=normalize(accountProductText(context))
  return agrofitProducts
    .filter(product=>product.name!==anchor.name&&trueStatus(product.status))
    .map(product=>{
      const sameComposition=exact&&exactComposition(product.active)===exact
      const sameIngredients=ingredients&&ingredientSignature(product.active)===ingredients
      if(!sameComposition&&!sameIngredients)return null
      const matchesCrop=cropMatch(product,cultures)
      const seen=catalogAliases(product).some(alias=>accountProducts.includes(alias))
      return {product,sameComposition,sameIngredients,matchesCrop,seen,score:(sameComposition?100:70)+(matchesCrop?24:0)+(seen?28:0)+(normalize(product.type)===normalize(anchor.type)?12:0)}
    })
    .filter(Boolean)
    .sort((a,b)=>b.score-a.score||a.product.name.localeCompare(b.product.name,'pt-BR'))
    .slice(0,3)
}

function similarFoliar(anchor,context){
  const composition=normalize(anchor.composition||anchor.guarantee)
  if(!composition)return []
  const accountProducts=normalize(accountProductText(context))
  return foliarProducts
    .filter(product=>product.name!==anchor.name&&product.verified===true&&normalize(product.composition||product.guarantee)===composition)
    .map(product=>({product,sameComposition:true,sameIngredients:true,matchesCrop:false,seen:catalogAliases(product).some(alias=>accountProducts.includes(alias)),score:100+(catalogAliases(product).some(alias=>accountProducts.includes(alias))?28:0)}))
    .sort((a,b)=>b.score-a.score||a.product.name.localeCompare(b.product.name,'pt-BR'))
    .slice(0,3)
}

function emptyBridge(status='not_applicable'){
  return {
    status,
    price_zone_reading:status==='needs_product'?'A conversa menciona preço ou comparação, mas o produto de referência ainda não foi identificado.':'A conversa atual não exige uma comparação de produtos.',
    reframe:status==='needs_product'?'Saia do “qual é mais barato” para “qual opção entrega o resultado verificável com menor risco e custo total”.':'',
    value_dimensions:status==='needs_product'?['resultado que precisa ser protegido','custo total por área ou operação','risco e reversibilidade','prova e suporte necessários']:[],
    anchor_product:null,
    alternatives:[],
    argument_path:status==='needs_product'?[
      {step:'Diagnosticar',suggested_line:'“Antes de comparar preço, qual resultado esta escolha precisa proteger?”',evidence_needed:'Resultado, área, horizonte e risco.'},
      {step:'Tornar comparável',suggested_line:'“Vamos comparar custo total, forma de comprovação e risco na mesma base?”',evidence_needed:'Mesma unidade, escopo, condição e fonte.'}
    ]:[],
    negotiation_question:status==='needs_product'?'Qual produto está sendo comparado, em qual cultura e para qual decisão?':'',
    do_not_claim:'Não chamar uma opção de equivalente, superior ou mais econômica sem base comparável e validação técnica.',
    technical_review:'Qualquer equivalência de uso, adequação agronômica, dose ou execução exige conferência da fonte vigente e responsável habilitado.',
    grounding_ids:[]
  }
}

const priceIntent=value=>/\b(?:pre[cç]o|barat[oa]|car[oa]|desconto|negocia[cç][aã]o|concorr[eê]ncia|concorrente|similar|equivalent|alternativa|trocar|substitu)/i.test(String(value||''))

export function buildValueBridge(context={},message=''){
  const pricedBusiness=array(context.businessHistory).slice(0,8).find(item=>priceIntent(item.loss_reason))
  const pricedOpportunity=array(context.opportunities).slice(0,5).find(item=>priceIntent(item.hypothesis)||priceIntent(item.next_action))
  if(!priceIntent(message)&&!pricedBusiness&&!pricedOpportunity)return {value_bridge:emptyBridge(),evidence:[],anchor:null}
  const comparisonText=[message,pricedBusiness?.product,pricedBusiness?.category,pricedOpportunity?.title,pricedOpportunity?.category].filter(Boolean).join(' • ')
  const anchor=locateProduct(comparisonText,agrofitProducts,'agrofit')||locateProduct(comparisonText,foliarProducts,'foliar')||locateAnchor(context,message)
  if(!anchor)return {value_bridge:emptyBridge('needs_product'),evidence:[],anchor:null}

  const similar=anchor.kind==='agrofit'?similarAgrofit(anchor,context):similarFoliar(anchor,context)
  const anchorEvidence=evidence('product-anchor',anchor,anchor.kind==='agrofit'
    ? `Produto de referência “${anchor.name}”; registro ${anchor.registration}; categoria ${anchor.type}; composição cadastrada ${anchor.active}; culturas no catálogo: ${array(anchor.crops).join(', ')}.`
    : `Produto de referência “${anchor.name}”; fabricante ${anchor.maker}; categoria ${anchor.category}; composição ou garantia cadastrada ${anchor.composition||anchor.guarantee||'não publicada'}.`)
  const alternativeEvidence=similar.map((item,index)=>evidence(`product-alternative-${index+1}`,item.product,item.product.registration
    ? `Alternativa candidata “${item.product.name}”; registro ${item.product.registration}; fabricante ${item.product.maker}; composição cadastrada ${item.product.active}; culturas no catálogo: ${array(item.product.crops).join(', ')}.`
    : `Alternativa candidata “${item.product.name}”; fabricante ${item.product.maker}; composição ou garantia cadastrada ${item.product.composition||item.product.guarantee||'não publicada'}.`))
  const anchorProduct={name:clean(anchor.name,180),registration:clean(anchor.registration,60),manufacturer:clean(anchor.maker,180),category:clean(anchor.type||anchor.category,120),composition:clean(anchor.active||anchor.composition||anchor.guarantee,420),evidence_id:'product-anchor'}
  const alternatives=similar.map((item,index)=>({
    name:clean(item.product.name,180),
    registration:clean(item.product.registration,60),
    manufacturer:clean(item.product.maker,180),
    category:clean(item.product.type||item.product.category,120),
    composition:clean(item.product.active||item.product.composition||item.product.guarantee,420),
    comparison_level:item.sameComposition?'mesma composição cadastrada':'mesmos ingredientes cadastrados; formulação ou concentração pode diferir',
    why_candidate:item.sameComposition?'A composição cadastrada coincide com a referência; isso permite iniciar uma comparação controlada, não concluir equivalência de uso.':'Os ingredientes cadastrados coincidem, mas concentração, formulação ou indicação podem mudar o resultado e o custo total.',
    advantage_to_validate:[item.seen?'já aparece no histórico comercial desta conta':'não aparece no histórico comercial recente da conta',item.matchesCrop?'o catálogo inclui cultura presente no dossiê':'a cultura do dossiê ainda precisa ser conferida',`fabricante: ${clean(item.product.maker,120)}`].join(' • '),
    tradeoffs:'Confirmar alvo, cultura, modalidade, formulação, concentração, restrições, bula vigente, custo total, disponibilidade e suporte. Similaridade cadastral não prova desempenho superior.',
    crops:array(item.product.crops).map(crop=>clean(crop,80)).slice(0,8),
    evidence_id:`product-alternative-${index+1}`,
    seen_in_account_history:item.seen,
    official_check_required:true
  }))
  const status=alternatives.length?'ready':'needs_context'
  const groundingIds=['product-anchor',...alternatives.map(item=>item.evidence_id),context.decisionIntelligence?.top_signal_id&&context.decisionIntelligence?.signals?.[0]?.evidence_ids?.[0]].filter(Boolean).slice(0,6)
  return {
    value_bridge:{
      status,
      price_zone_reading:`A referência encontrada foi “${anchor.name}”. A negociação só sai da zona de preço quando todas as opções são comparadas pelo mesmo resultado, custo total, risco e forma de comprovação.`,
      reframe:`Em vez de defender “${anchor.name}” ou trocar por preço, organize a decisão em quatro perguntas: resultado, custo total, risco e prova.`,
      value_dimensions:['resultado agronômico ou operacional a proteger','custo total na mesma área e horizonte','risco, restrições e reversibilidade','qualidade da prova, disponibilidade e suporte'],
      anchor_product:anchorProduct,
      alternatives,
      argument_path:[
        {step:'Tirar o preço do centro',suggested_line:'“Se o preço fosse igual, o que faria uma opção ser a escolha mais segura para esta decisão?”',evidence_needed:'Critério principal nas palavras do produtor.'},
        {step:'Comparar na mesma base',suggested_line:'“Podemos comparar resultado esperado, custo total, risco e como vamos conferir?”',evidence_needed:'Mesma cultura, alvo, área, horizonte, unidade e fonte vigente.'},
        {step:'Oferecer escolhas, não pressão',suggested_line:`“Tenho ${Math.max(1,alternatives.length)} caminho${alternatives.length===1?'':'s'} para conferir com você; primeiro validamos qual atende ao critério que você definiu.”`,evidence_needed:'Aceite para comparar e responsável pela validação técnica.'},
        {step:'Fechar com prova',suggested_line:'“Qual evidência precisa aparecer para esta opção justificar o investimento?”',evidence_needed:'Métrica, fonte, prazo e critério de interrupção.'}
      ],
      negotiation_question:'Além do preço, qual resultado, risco ou forma de comprovação vai decidir entre estas opções?',
      do_not_claim:'Não diga “é igual”, “é melhor”, “vai render mais” ou “sai mais barato” sem comparação válida, fonte vigente e revisão técnica.',
      technical_review:'As opções são candidatas para comparação comercial. Confirme no Agrofit/MAPA ou na fonte do fabricante registro, cultura, alvo, modalidade, formulação, concentração, restrições e bula vigente; adequação, dose e execução exigem responsável habilitado.',
      grounding_ids:groundingIds
    },
    evidence:[anchorEvidence,...alternativeEvidence],
    anchor:{...anchor,officialSource:anchor.kind==='agrofit'?AGROFIT_URL:anchor.source||''}
  }
}

export function isCommercialProductComparison(message=''){
  const text=String(message||'')
  return priceIntent(text)&&/\b(?:produto|marca|ingrediente|portf[oó]lio|alternativa|similar|equivalent|concorrente)/i.test(text)&&!/\b(?:dose|dosagem|mistura|aplica[cç][aã]o|aplicar|diagn[oó]stico|receita|controle|manejo|alvo|praga|doen[cç]a|daninha|defici[eê]ncia)/i.test(text)
}
