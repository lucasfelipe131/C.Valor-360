const commodityLabels={soja:'Soja',milho:'Milho',trigo:'Trigo',sorgo:'Sorgo',feijao:'Feijão',arroz:'Arroz',cevada:'Cevada'}
const commodityCodes=new Set(Object.keys(commodityLabels))
const directions=new Set(['sell','buy'])
const intentStatuses=new Set(['draft','confirmed','monitoring','negotiating','closed','cancelled'])
const creatableIntentStatuses=new Set(['draft','confirmed','monitoring'])
const volumeUnits=new Set(['sc_60kg','t','kg'])
const priceUnits=new Set(['BRL/sc_60kg','BRL/t'])
const marketKinds=new Set(['spot','forward','futures'])
const profileSources=new Set(['producer_confirmation','consultant_interview','crm_import','integration'])
const intentSources=new Set(['producer_confirmation','consultant_interview','crm_import','integration'])
const marketSources=new Set(['market_feed','broker','cooperative','manual_quote','integration'])

const domainError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
const text=(value,max=240)=>String(value??'').normalize('NFKC').trim().slice(0,max)
const number=value=>{
 if(value===null||value===undefined||value==='')return null
 const parsed=Number(String(value).replace(/\s/g,'').replace(',','.'))
 return Number.isFinite(parsed)?parsed:null
}
const date=value=>{
 if(!value)return null
 const parsed=new Date(value)
 return Number.isNaN(parsed.getTime())?null:parsed.toISOString()
}
const dateOnly=value=>{
 if(!value)return null
 const raw=text(value,10)
 return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:null
}
const normalized=value=>text(value,240).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value))
const unique=value=>[...new Set((Array.isArray(value)?value:[]).map(item=>text(item,80)).filter(Boolean))]
const requiredChoice=(value,allowed,message)=>{const selected=text(value,80);if(!allowed.has(selected))throw domainError(message);return selected}
const positive=(value,message,{required=true}={})=>{const parsed=number(value);if(parsed===null&&!required)return null;if(parsed===null||parsed<=0)throw domainError(message);return parsed}
const confidence=value=>{const parsed=number(value);if(parsed===null)return 50;if(parsed<0||parsed>100)throw domainError('A confiança precisa estar entre 0 e 100.');return Math.round(parsed)}
const deliveryWindow=input=>{
 const deliveryStart=dateOnly(input.deliveryStart)
 const deliveryEnd=dateOnly(input.deliveryEnd)
 if(input.deliveryStart&&!deliveryStart)throw domainError('A data inicial de entrega é inválida.')
 if(input.deliveryEnd&&!deliveryEnd)throw domainError('A data final de entrega é inválida.')
 if(deliveryStart&&deliveryEnd&&deliveryEnd<deliveryStart)throw domainError('A data final de entrega não pode vir antes da inicial.')
 return {deliveryStart,deliveryEnd}
}

export const grainCatalog={
 commodities:Object.entries(commodityLabels).map(([value,label])=>({value,label})),
 volumeUnits:[{value:'sc_60kg',label:'sc 60 kg'},{value:'t',label:'toneladas'},{value:'kg',label:'kg'}],
 priceUnits:[{value:'BRL/sc_60kg',label:'R$/sc 60 kg'},{value:'BRL/t',label:'R$/t'}],
 marketKinds:[{value:'spot',label:'Disponível'},{value:'forward',label:'A termo'},{value:'futures',label:'Futuro'}]
}

export function normalizeGrainProfile(input={}){
 const clientId=text(input.clientId,180)
 if(!clientId)throw domainError('Selecione um produtor da sua carteira.')
 const commodities=unique(input.commodities)
 if(commodities.some(item=>!commodityCodes.has(item)))throw domainError('Há uma cultura inválida no perfil de grãos.')
 const storageCapacityT=positive(input.storageCapacityT,'A capacidade de armazenagem precisa ser maior que zero.',{required:false})
 const observedAt=date(input.observedAt)||(!input.observedAt?new Date().toISOString():null)
 if(!observedAt)throw domainError('A data do perfil de grãos é inválida.')
 if(new Date(observedAt).getTime()>Date.now()+3_600_000)throw domainError('O perfil de grãos não pode ter uma data futura.')
 return {
  clientId,commodities,storageCapacityT,
  storageStructure:text(input.storageStructure,500),
  logisticsMode:text(input.logisticsMode,120),
  usualDeliveryLocations:text(input.usualDeliveryLocations,1000),
  marketingNotes:text(input.marketingNotes,5000),
  source:requiredChoice(input.source||'consultant_interview',profileSources,'A origem do perfil de grãos é inválida.'),
  sourceDetails:text(input.sourceDetails,1000),observedAt,
  confirmed:Boolean(input.confirmed)
 }
}

export function normalizeGrainIntent(input={}){
 const clientId=text(input.clientId,180)
 if(!clientId)throw domainError('Selecione o produtor desta intenção.')
 const commodity=requiredChoice(input.commodity,commodityCodes,'Selecione um grão válido.')
 const direction=requiredChoice(input.direction||'sell',directions,'A direção da negociação é inválida.')
 const volume=positive(input.volume,'Informe um volume maior que zero.')
 const volumeUnit=requiredChoice(input.volumeUnit||'sc_60kg',volumeUnits,'A unidade do volume é inválida.')
 const targetPrice=positive(input.targetPrice,'O preço-alvo precisa ser maior que zero.',{required:false})
 const priceUnit=requiredChoice(input.priceUnit||'BRL/sc_60kg',priceUnits,'A unidade do preço é inválida.')
 const status=requiredChoice(input.status||'draft',intentStatuses,'O estado da intenção é inválido.')
 if(!creatableIntentStatuses.has(status))throw domainError('Uma nova intenção deve entrar como sinal, monitoramento ou confirmação do produtor.')
 const source=requiredChoice(input.source||'consultant_interview',intentSources,'A origem da intenção é inválida.')
 const {deliveryStart,deliveryEnd}=deliveryWindow(input)
 const intentConfidence=confidence(input.confidence)
 const observedAt=date(input.observedAt)||(!input.observedAt?new Date().toISOString():null)
 if(!observedAt)throw domainError('A data da intenção é inválida.')
 if(new Date(observedAt).getTime()>Date.now()+3_600_000)throw domainError('A intenção não pode ter uma data futura.')
 if(status==='confirmed'&&(source!=='producer_confirmation'||intentConfidence<80))throw domainError('Uma intenção confirmada exige confirmação do produtor e confiança mínima de 80%.')
 return {
  clientId,commodity,direction,season:text(input.season,40),volume,volumeUnit,targetPrice,priceUnit,
  deliveryStart,deliveryEnd,deliveryLocation:text(input.deliveryLocation,240),
  qualitySpecs:text(input.qualitySpecs,2000),status,confidence:intentConfidence,source,
  sourceDetails:text(input.sourceDetails,1000),notes:text(input.notes,5000),observedAt
 }
}

export function normalizeGrainMarketSnapshot(input={}){
 const commodity=requiredChoice(input.commodity,commodityCodes,'Selecione um grão válido para a referência de mercado.')
 const marketKind=requiredChoice(input.marketKind||'spot',marketKinds,'O tipo de referência de mercado é inválido.')
 const price=positive(input.price,'Informe uma cotação maior que zero.')
 const priceUnit=requiredChoice(input.priceUnit||'BRL/sc_60kg',priceUnits,'A unidade da cotação é inválida.')
 const region=text(input.region,240)
 if(!region)throw domainError('Informe a praça ou região da cotação.')
 const sourceName=text(input.sourceName,240)
 if(!sourceName)throw domainError('Identifique a fonte da cotação.')
 const sourceType=requiredChoice(input.sourceType||'manual_quote',marketSources,'O tipo da fonte de mercado é inválido.')
 const sourceUrl=text(input.sourceUrl,1000)
 if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))throw domainError('O link da fonte precisa começar com http:// ou https://.')
 const observedAt=date(input.observedAt)
 if(!observedAt)throw domainError('Informe quando a cotação foi observada.')
 if(new Date(observedAt).getTime()>Date.now()+3_600_000)throw domainError('A cotação não pode estar no futuro.')
 const {deliveryStart,deliveryEnd}=deliveryWindow(input)
 return {commodity,marketKind,region,price,priceUnit,deliveryStart,deliveryEnd,sourceName,sourceType,sourceUrl,confidence:confidence(input.confidence),notes:text(input.notes,3000),observedAt,status:'active'}
}

const pricePerTonne=(price,unit)=>unit==='BRL/sc_60kg'?Number(price)/0.06:Number(price)
const freshnessFor=(observedAt,now)=>{
 const hours=Math.max(0,(now.getTime()-new Date(observedAt).getTime())/3_600_000)
 if(hours<=24)return {hours,label:'Atual',state:'fresh',score:10}
 if(hours<=72)return {hours,label:'Atenção',state:'attention',score:7}
 if(hours<=168)return {hours,label:'No limite',state:'limit',score:3}
 return {hours,label:'Vencida',state:'expired',score:0}
}
const locationMatch=(intent,quote)=>{
 const intentLocation=normalized(intent.deliveryLocation)
 const quoteLocation=normalized(quote.region)
 if(!intentLocation||!quoteLocation)return false
 return intentLocation.includes(quoteLocation)||quoteLocation.includes(intentLocation)
}
const matchingQuote=(intent,quotes,now)=>{
 const candidates=quotes.filter(quote=>quote.status!=='inactive'&&quote.commodity===intent.commodity).map(quote=>({...quote,_freshness:freshnessFor(quote.observedAt,now),_regional:locationMatch(intent,quote)}))
 candidates.sort((left,right)=>Number(left._freshness.state==='expired')-Number(right._freshness.state==='expired')||Number(right._regional)-Number(left._regional)||new Date(right.observedAt)-new Date(left.observedAt))
 return candidates[0]||null
}
const daysUntil=(value,now)=>value?Math.ceil((new Date(`${value}T23:59:59`).getTime()-now.getTime())/86_400_000):null
const priorityFor=score=>score>=75?{level:'high',label:'Prioridade alta'}:score>=55?{level:'medium',label:'Em validação'}:score>=35?{level:'watch',label:'Monitorar'}:{level:'incomplete',label:'Completar dados'}
const statusReadiness={draft:4,monitoring:9,confirmed:14,negotiating:16}

export function buildGrainOpportunities({intentions=[],marketSnapshots=[]}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 return intentions.filter(intent=>!['closed','cancelled'].includes(intent.status)).map(intent=>{
  const reasons=[];const warnings=[];let readiness=statusReadiness[intent.status]||0
  reasons.push(intent.status==='confirmed'||intent.status==='negotiating'?'Intenção confirmada para condução comercial':intent.status==='monitoring'?'Intenção relatada e ainda em acompanhamento':'Sinal inicial ainda precisa de confirmação do produtor')
  readiness+=intent.confidence>=80?8:intent.confidence>=60?6:3
  if(Number(intent.volume)>0)readiness+=3
  if(intent.deliveryLocation)readiness+=3
  const quote=matchingQuote(intent,marketSnapshots,now)
  let marketEvidence=0;let priceAlignment=0;let priceGapPercent=null
  if(quote){
   marketEvidence=10+(quote.sourceName?5:0)+quote._freshness.score
   const intentPrice=intent.targetPrice?pricePerTonne(intent.targetPrice,intent.priceUnit):null
   const quotePrice=pricePerTonne(quote.price,quote.priceUnit)
   if(intentPrice){
    priceGapPercent=(intent.direction==='sell'?(quotePrice-intentPrice):(intentPrice-quotePrice))/intentPrice*100
    if(quote._freshness.state==='expired')priceAlignment=4
    else priceAlignment=priceGapPercent>=0?30:priceGapPercent>=-1?24:priceGapPercent>=-3?18:priceGapPercent>=-5?10:4
    reasons.push(priceGapPercent>=0?'Referência de mercado atingiu ou superou o preço-alvo':`Referência está ${Math.abs(priceGapPercent).toFixed(1).replace('.',',')}% distante do preço-alvo`)
   }else{priceAlignment=6;reasons.push('Há referência de mercado, mas falta registrar o preço-alvo do produtor')}
   reasons.push(`Cotação ${quote._freshness.label.toLowerCase()} observada em ${quote.region}`)
   if(!quote._regional&&intent.deliveryLocation)warnings.push('A praça da cotação difere do local de entrega informado; valide frete e base.')
   if(quote._freshness.state==='expired')warnings.push('Cotação vencida para priorização; atualize a referência antes de negociar.')
  }else{warnings.push('Sem cotação verificável para este grão; não há comparação de preço.')}
  const deliveryDate=intent.deliveryStart||intent.deliveryEnd
  const remaining=daysUntil(deliveryDate,now)
  const timing=remaining===null||remaining<0?0:remaining<=14?15:remaining<=30?12:remaining<=60?8:remaining<=120?4:2
  if(remaining!==null)reasons.push(remaining<0?'Janela de entrega informada já iniciou ou venceu':`Janela de entrega começa em ${remaining} dia${remaining===1?'':'s'}`)
  else warnings.push('Sem janela de entrega; complete o prazo para orientar o contato.')
  if(remaining!==null&&remaining<0)warnings.push('A janela de entrega está vencida; atualize a intenção antes de negociar.')
  const intentAgeDays=Math.max(0,(now.getTime()-new Date(intent.observedAt||intent.updatedAt||now).getTime())/86_400_000)
  if(intentAgeDays>30)warnings.push(`A intenção foi observada há ${Math.floor(intentAgeDays)} dias; reconfirme com o produtor.`)
  let score=clamp(Math.round(readiness+marketEvidence+priceAlignment+timing),0,100)
  if(intent.status==='draft'||Number(intent.confidence)<60||intentAgeDays>90||remaining<0)score=Math.min(score,54)
  const priority=priorityFor(score)
  const nextAction=remaining!==null&&remaining<0
   ?'Atualizar a janela e reconfirmar volume e disponibilidade com o produtor.'
   :intentAgeDays>90
    ?'Reconfirmar a intenção com o produtor antes de usar a cotação na negociação.'
    :intent.status==='draft'||Number(intent.confidence)<60
   ?'Validar intenção, volume, preço e janela diretamente com o produtor.'
   :!quote||quote._freshness.state==='expired'
    ?'Atualizar a referência de mercado antes de avançar a negociação.'
    :priority.level==='high'
     ?'Contatar o produtor agora e preparar a condição comercial com base na cotação registrada.'
     :priority.level==='medium'
      ?'Preparar cenários e alinhar a próxima conversa com o produtor.'
      :'Monitorar preço e janela; revisar quando houver nova cotação ou mudança na intenção.'
  const completed=[intent.clientId,intent.commodity,intent.volume,intent.deliveryLocation,intent.deliveryStart||intent.deliveryEnd,intent.targetPrice,intent.source,quote?.sourceName,quote?.observedAt].filter(Boolean).length
  return {
   id:`sog-${intent.id}`,intentId:intent.id,clientId:intent.clientId,clientName:intent.clientName||'Produtor',commodity:intent.commodity,commodityLabel:commodityLabels[intent.commodity]||intent.commodity,
   direction:intent.direction,season:intent.season,volume:Number(intent.volume),volumeUnit:intent.volumeUnit,targetPrice:intent.targetPrice==null?null:Number(intent.targetPrice),priceUnit:intent.priceUnit,
   deliveryStart:intent.deliveryStart,deliveryEnd:intent.deliveryEnd,deliveryLocation:intent.deliveryLocation,status:intent.status,confidence:Number(intent.confidence||0),score,priority,nextAction,
   reasons,reasonsVersion:'sog-rules-v1',warnings,dataCompleteness:Math.round(completed/9*100),priceGapPercent:priceGapPercent==null?null:Number(priceGapPercent.toFixed(2)),
   marketReference:quote?{id:quote.id,price:Number(quote.price),priceUnit:quote.priceUnit,region:quote.region,sourceName:quote.sourceName,sourceUrl:quote.sourceUrl||'',observedAt:quote.observedAt,confidence:Number(quote.confidence||0),freshness:{...quote._freshness,hours:Number(quote._freshness.hours.toFixed(1))},regionalMatch:quote._regional}:null,
   generatedAt:now.toISOString()
  }
 }).sort((left,right)=>right.score-left.score||String(left.clientName).localeCompare(String(right.clientName),'pt-BR'))
}

export function summarizeGrainWorkspace({producers=[],profiles=[],intentions=[],marketSnapshots=[],opportunities=[]}={}){
 const activeIntentions=intentions.filter(item=>!['closed','cancelled'].includes(item.status))
 const freshMarket=marketSnapshots.filter(item=>item.status!=='inactive'&&freshnessFor(item.observedAt,new Date()).state==='fresh')
 return {
  producerCount:producers.length,profiledProducers:profiles.length,activeIntentions:activeIntentions.length,
  confirmedIntentions:activeIntentions.filter(item=>['confirmed','negotiating'].includes(item.status)).length,
  freshMarketReferences:freshMarket.length,highPriority:opportunities.filter(item=>item.priority.level==='high').length,
  generatedOpportunities:opportunities.length
 }
}

export {commodityLabels,intentStatuses}
