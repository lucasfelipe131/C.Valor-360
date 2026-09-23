import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {commodityLabels,freshnessFor,pricePerTonne,selectMarketReference} from './grain-intelligence.js'

const ANALYSIS_RULES_VERSION='sog-analysis-v1'
const objectives={
 caixa:{label:'Fazer caixa',shares:[50,30,20],note:'Prioriza liquidez: parcela maior no gatilho imediato.'},
 margem:{label:'Maximizar preço médio',shares:[25,35,40],note:'Aceita esperar: parcela maior nos alvos superiores.'},
 risco:{label:'Reduzir risco',shares:[40,35,25],note:'Trava mais cedo e deixa menos volume em aberto.'},
 equilibrio:{label:'Equilíbrio',shares:[34,33,33],note:'Divide o volume em três parcelas semelhantes.'}
}
const directions=new Set(['sell','buy'])
const volumeUnits=new Set(['sc_60kg','t','kg'])
const priceUnits=new Set(['BRL/sc_60kg','BRL/t'])
const monthNames=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']

const domainError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
const text=(value,max=240)=>String(value??'').normalize('NFKC').trim().slice(0,max)
const number=value=>{if(value===null||value===undefined||value==='')return null;let raw=String(value).replace(/\s/g,'');if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw))raw=raw.replace(/\./g,'');const parsed=Number(raw.replace(',','.'));return Number.isFinite(parsed)?parsed:null}
const dateOnly=value=>{if(!value)return null;const raw=text(value,10);return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:null}
const normalized=value=>text(value,240).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const round=(value,digits=2)=>Number(Number(value).toFixed(digits))
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(value)
const percent=value=>`${Math.abs(value).toFixed(1).replace('.',',')}%`
const toSacks=(volume,unit)=>unit==='t'?volume/0.06:unit==='kg'?volume/60:volume
const toPricePerSack=(price,unit)=>price==null?null:unit==='BRL/t'?price*0.06:price
const monthLabel=month=>monthNames[month-1]||''
const monthRange=months=>months?.length?`${monthLabel(months[0])}–${monthLabel(months[months.length-1])}`:''

let cachedPraca=null
export function loadPracaProfile(){
 if(cachedPraca)return cachedPraca
 const file=join(dirname(fileURLToPath(import.meta.url)),'data','sog-praca-sao-luiz-gonzaga.json')
 cachedPraca=JSON.parse(readFileSync(file,'utf8'))
 return cachedPraca
}

export function pracaMatches(praca,location){
 const target=normalized(location)
 if(!praca||!target)return false
 return [praca.label,...(praca.aliases||[])].some(alias=>{const key=normalized(alias);return key&&(target.includes(key)||key.includes(target))})
}

export function normalizeGrainAnalysisRequest(input={}){
 const clientId=text(input.clientId,180)
 if(!clientId)throw domainError('Selecione o produtor que fez o pedido.')
 const commodity=text(input.commodity,40)
 if(!commodityLabels[commodity])throw domainError('Selecione um grão válido para a análise.')
 const direction=text(input.direction||'sell',20)
 if(!directions.has(direction))throw domainError('A direção da análise é inválida.')
 const volume=number(input.volume)
 if(volume===null||volume<=0)throw domainError('Informe o volume que o produtor quer negociar.')
 const volumeUnit=text(input.volumeUnit||'sc_60kg',30)
 if(!volumeUnits.has(volumeUnit))throw domainError('A unidade do volume é inválida.')
 const priceUnit=text(input.priceUnit||'BRL/sc_60kg',40)
 if(!priceUnits.has(priceUnit))throw domainError('A unidade do preço é inválida.')
 const targetPrice=number(input.targetPrice)
 if(targetPrice!==null&&targetPrice<=0)throw domainError('O preço-alvo precisa ser maior que zero.')
 const costPrice=number(input.costPrice)
 if(costPrice!==null&&costPrice<=0)throw domainError('O custo de produção precisa ser maior que zero.')
 const objective=text(input.objective||'equilibrio',40)
 if(!objectives[objective])throw domainError('Escolha o objetivo do produtor para a análise.')
 const deliveryStart=dateOnly(input.deliveryStart);const deliveryEnd=dateOnly(input.deliveryEnd)
 if(input.deliveryStart&&!deliveryStart)throw domainError('A data inicial de entrega é inválida.')
 if(input.deliveryEnd&&!deliveryEnd)throw domainError('A data final de entrega é inválida.')
 if(deliveryStart&&deliveryEnd&&deliveryEnd<deliveryStart)throw domainError('A data final de entrega não pode vir antes da inicial.')
 const cashNeedBRL=number(input.cashNeedBRL)
 if(cashNeedBRL!==null&&cashNeedBRL<0)throw domainError('A necessidade de caixa não pode ser negativa.')
 const cashNeedDate=dateOnly(input.cashNeedDate)
 if(input.cashNeedDate&&!cashNeedDate)throw domainError('A data da necessidade de caixa é inválida.')
 const hasStorage=input.hasStorage===undefined||input.hasStorage===null||input.hasStorage===''?null:/^(1|true|yes|sim)$/i.test(String(input.hasStorage))
 return {
  clientId,clientName:text(input.clientName,180),commodity,direction,volume,volumeUnit,targetPrice,priceUnit,costPrice,objective,
  deliveryStart,deliveryEnd,deliveryLocation:text(input.deliveryLocation,240),qualityNotes:text(input.qualityNotes,600),
  cashNeedBRL,cashNeedDate,hasStorage,request:text(input.request,2000)
 }
}

const stageFor=(calendar,month)=>{
 if(!calendar)return null
 if(calendar.harvest?.includes(month))return {key:'harvest',label:'Colheita',note:'Oferta concentrada; a base costuma piorar e o frete sobe.'}
 if(calendar.planting?.includes(month))return {key:'planting',label:'Plantio',note:'Janela de travar parte da safra nova quando o preço cobre custo mais margem.'}
 if(calendar.recovery?.includes(month))return {key:'recovery',label:'Entressafra',note:'Historicamente a base recupera; bom momento para o volume armazenado.'}
 return {key:'transition',label:'Transição',note:'Sem pressão sazonal clara; a decisão depende do preço e do caixa.'}
}

const portReference=(commodity,marketSnapshots,now)=>{
 const candidates=marketSnapshots.filter(item=>item.status!=='inactive'&&item.commodity===commodity&&/paranagua|rio grande|porto/.test(normalized(item.region))).map(item=>({...item,_freshness:freshnessFor(item.observedAt,now)})).filter(item=>item._freshness.state!=='expired')
 candidates.sort((left,right)=>new Date(right.observedAt)-new Date(left.observedAt))
 return candidates[0]||null
}

const daysBetween=(target,now)=>target?Math.ceil((new Date(`${target}T23:59:59`).getTime()-now.getTime())/86_400_000):null

export function analyzeProducerRequest({request,profile=null,intentions=[],marketSnapshots=[],praca=null,producer=null}={},options={}){
 if(!request)throw domainError('A análise precisa de um pedido do produtor.')
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const month=now.getUTCMonth()+1
 const label=commodityLabels[request.commodity]||request.commodity
 const sell=request.direction==='sell'
 const volumeSc=toSacks(request.volume,request.volumeUnit)
 const targetSc=toPricePerSack(request.targetPrice,request.priceUnit)
 const costSc=toPricePerSack(request.costPrice,request.priceUnit)
 const assumptions=[];const alerts=[];const dataGaps=[];const reasons=[]
 const location=request.deliveryLocation||profile?.usualDeliveryLocations||producer?.municipality||''
 const pracaApplies=pracaMatches(praca,location)||pracaMatches(praca,producer?.municipality)
 const pracaCommodity=pracaApplies?praca?.commodities?.[request.commodity]||null:null
 const stage=stageFor(pracaCommodity?.calendar,month)
 const reference=selectMarketReference({commodity:request.commodity,deliveryLocation:location},marketSnapshots,now)
 const referenceSc=reference?toPricePerSack(reference.price,reference.priceUnit):null
 const port=portReference(request.commodity,marketSnapshots,now)
 const portSc=port?toPricePerSack(port.price,port.priceUnit):null
 const storage=request.hasStorage!==null?request.hasStorage:profile?.storageCapacityT?Number(profile.storageCapacityT)>0:null
 const deliveryDays=daysBetween(request.deliveryStart||request.deliveryEnd,now)
 const cashDays=daysBetween(request.cashNeedDate,now)

 if(!reference){dataGaps.push('Sem cotação registrada para este grão; registre uma referência com fonte e horário para comparar preço.')}
 else{
  reasons.push(`Referência ${reference._freshness.label.toLowerCase()} de ${reference.sourceName} em ${reference.region}: ${money(referenceSc)} por saca.`)
  if(reference._freshness.state==='expired')alerts.push('A cotação usada está vencida; os alvos ficam indicativos até uma referência nova.')
  if(!reference._regional&&location)alerts.push(`A praça da cotação (${reference.region}) difere do local de entrega (${location}); valide frete e base.`)
 }
 let priceGapPercent=null
 if(reference&&targetSc){priceGapPercent=round((sell?referenceSc-targetSc:targetSc-referenceSc)/targetSc*100);reasons.push(priceGapPercent>=0?`O mercado já ${sell?'atinge':'cabe no'} preço-alvo (${percent(priceGapPercent)} ${sell?'acima':'abaixo'}).`:`O mercado está ${percent(priceGapPercent)} ${sell?'abaixo':'acima'} do preço-alvo de ${money(targetSc)}.`)}
 if(!targetSc)dataGaps.push('Sem preço-alvo do produtor; os alvos partem do mercado e do custo.')
 let marginPercent=null
 if(costSc&&referenceSc){marginPercent=round((referenceSc-costSc)/costSc*100);reasons.push(marginPercent>=0?`A cotação cobre o custo informado com margem de ${percent(marginPercent)}.`:`A cotação está ${percent(marginPercent)} abaixo do custo informado.`)}
 if(!costSc)dataGaps.push('Sem custo de produção; a análise não calcula margem nem piso de proteção.')
 let basisSc=null
 if(referenceSc&&portSc&&reference.id!==port.id){basisSc=round(referenceSc-portSc);reasons.push(`Base local contra ${port.region}: ${money(basisSc)} por saca.`)}
 else if(pracaApplies&&praca?.logistics?.basisVsParanaguaBRLPerSc){const basis=praca.logistics.basisVsParanaguaBRLPerSc;assumptions.push(`Base histórica da praça contra Paranaguá entre ${money(basis.low)} e ${money(basis.high)} por saca (${basis.source}, ${basis.observedAt}).`)}
 if(stage)reasons.push(`Momento da praça para ${label.toLowerCase()}: ${stage.label.toLowerCase()} (${stage.note.toLowerCase()})`)
 if(!pracaApplies)assumptions.push('Local de entrega fora da praça mapeada; dicas de calendário e base regional não foram aplicadas.')
 if(storage===null)dataGaps.push('Armazenagem própria não informada; a análise assume venda na entrega.')
 if(deliveryDays!==null&&deliveryDays<0)alerts.push('A janela de entrega informada já venceu; ajuste antes de negociar.')
 if(request.qualityNotes)assumptions.push(`Qualidade declarada: ${request.qualityNotes}.`)
 if(pracaCommodity?.qualityStandard)assumptions.push(pracaCommodity.qualityStandard)

 const objective=objectives[request.objective]
 const anchor=referenceSc||targetSc||costSc||null
 const floor=costSc?costSc*1.03:null
 const closingTargets=[]
 if(anchor){
  const level1=sell?Math.max(anchor,floor||0):Math.min(anchor,floor?Infinity:anchor)
  const level2=sell?Math.max(targetSc||anchor*1.03,level1*1.02):Math.min(targetSc||anchor*0.97,level1*0.98)
  const level3=sell?Math.max(level2*1.04,level1*1.07):Math.min(level2*0.96,level1*0.93)
  const levels=[
   {key:'trigger',label:'Alvo 1 — gatilho imediato',price:level1,condition:reference?`Fechar ao preço ${reference._freshness.state==='fresh'?'executável hoje':'da última referência'}${floor&&level1===floor?', que também cobre custo mais 3%':''}.`:'Fechar assim que uma cotação com fonte atingir este valor.',trigger:sell?'Cotação registrada igual ou superior':'Cotação registrada igual ou inferior'},
   {key:'target',label:'Alvo 2 — preço do produtor',price:level2,condition:targetSc?'Preço-alvo declarado pelo produtor; fechar parcela ao ser atingido.':'Sem preço-alvo declarado; nível derivado da referência mais 3%.',trigger:'Ordem de venda ou compra deixada com o comprador'},
   {key:'stretch',label:'Alvo 3 — esticada condicional',price:level3,condition:stage?.key==='harvest'?'Só com melhora de base após a colheita; caso contrário rebaixar para o Alvo 2 em 30 dias.':'Depende de evento de mercado (câmbio, Chicago, prêmio); revisar a cada nova cotação.',trigger:'Evento de mercado confirmado por nova referência registrada'}
  ]
  levels.forEach((level,index)=>{
   const share=objective.shares[index];const volume=round(volumeSc*share/100,0)
   closingTargets.push({...level,price:round(level.price),priceUnit:'BRL/sc_60kg',share,volumeSc:volume,revenueBRL:round(volume*level.price,0),deadline:index===0?(deliveryDays!==null&&deliveryDays>=0?request.deliveryStart||request.deliveryEnd:null):null})
  })
  if(cashDays!==null&&request.cashNeedBRL){const coverage=closingTargets[0].revenueBRL;if(coverage<request.cashNeedBRL){const needed=Math.ceil(request.cashNeedBRL/closingTargets[0].price);alerts.push(`A parcela do Alvo 1 (${money(coverage)}) não cobre a necessidade de caixa de ${money(request.cashNeedBRL)} em ${cashDays} dias; seriam necessárias cerca de ${needed} sacas no gatilho imediato.`)}else reasons.push(`A parcela do Alvo 1 cobre a necessidade de caixa de ${money(request.cashNeedBRL)}.`)}
 }else dataGaps.push('Sem referência, preço-alvo ou custo não há como calcular alvos de fechamento.')

 const scenarios=anchor?[
  {key:'pessimista',label:'Pessimista',price:round(anchor*(sell?0.95:1.05)),note:'Base piora 5% (pressão de colheita ou frete).'},
  {key:'base',label:'Base',price:round(anchor),note:reference?'Última referência registrada.':'Ponto de partida informado.'},
  {key:'otimista',label:'Otimista',price:round(sell?Math.max(targetSc||0,anchor*1.05):Math.min(targetSc||Infinity,anchor*0.95)),note:'Preço-alvo atingido ou melhora de 5%.'}
 ].map(item=>({...item,revenueBRL:round(volumeSc*item.price,0)})):[]
 const ladderRevenue=closingTargets.reduce((sum,item)=>sum+item.revenueBRL,0)
 const ladderAverage=closingTargets.length?round(ladderRevenue/Math.max(1,closingTargets.reduce((sum,item)=>sum+item.volumeSc,0))):null

 const tips=[]
 if(pracaCommodity?.closingTips)tips.push(...pracaCommodity.closingTips.map(tip=>({scope:'praca',text:tip})))
 if(storage===false&&stage?.key==='harvest')tips.push({scope:'pedido',text:'Sem armazenagem na colheita: negociar armazenagem paga na cooperativa ou fixar preço antes da entrega para não vender no pior momento.'})
 if(storage===true&&stage?.key==='harvest')tips.push({scope:'pedido',text:`Com armazenagem própria, guardar as parcelas dos Alvos 2 e 3 para ${monthRange(pracaCommodity?.calendar?.recovery)||'a entressafra'}.`})
 if(request.cashNeedBRL)tips.push({scope:'pedido',text:'Fechar primeiro o volume que cobre o caixa e deixar o restante com ordens de venda nos alvos superiores.'})
 if(reference&&reference._freshness.state!=='fresh')tips.push({scope:'pedido',text:'Pedir cotação atualizada a dois compradores antes de qualquer fechamento; a referência atual não é de hoje.'})
 if(priceGapPercent!==null&&priceGapPercent>=0)tips.push({scope:'pedido',text:'O preço-alvo já foi atingido: registrar a confirmação do produtor e executar a parcela do Alvo 1 sem esperar nova alta.'})
 if(priceGapPercent!==null&&priceGapPercent<-5)tips.push({scope:'pedido',text:'O alvo está mais de 5% acima do mercado: combinar com o produtor um alvo intermediário ou uma data-limite para revisar.'})
 if(marginPercent!==null&&marginPercent<0)tips.push({scope:'pedido',text:'Preço abaixo do custo: vender só o necessário para o caixa e registrar a decisão com o produtor.'})
 if(request.direction==='buy')tips.push({scope:'pedido',text:'Compra: comparar preço posto na propriedade (frete incluso) e prazo de pagamento; um preço menor com frete maior pode sair mais caro.'})
 if(!tips.length)tips.push({scope:'geral',text:'Escalonar vendas, comparar duas cotações com fonte e registrar a decisão com o produtor.'})

 const headline=!anchor?`Faltam dados para orientar o pedido de ${label.toLowerCase()}.`
  :priceGapPercent!==null&&priceGapPercent>=0?`O mercado já atende o pedido do produtor para ${label.toLowerCase()}: executar o Alvo 1.`
  :priceGapPercent!==null?`${label}: mercado ${percent(priceGapPercent)} ${sell?'abaixo':'acima'} do alvo; escalonar em três parcelas.`
  :`${label}: alvos montados a partir da referência registrada; confirmar preço-alvo com o produtor.`

 return {
  rulesVersion:ANALYSIS_RULES_VERSION,generatedAt:now.toISOString(),humanReviewRequired:true,automaticTrading:false,
  request:{...request,volumeSc:round(volumeSc,0),targetPriceSc:targetSc==null?null:round(targetSc),costPriceSc:costSc==null?null:round(costSc),objectiveLabel:objective.label,objectiveNote:objective.note},
  producer:{id:request.clientId,name:producer?.name||request.clientName||'Produtor',municipality:producer?.municipality||'',linked:Boolean(producer),profileConfirmed:Boolean(profile?.confirmedAt),storage},
  praca:{applies:pracaApplies,id:pracaApplies?praca?.id:null,label:pracaApplies?praca?.label:null,stage,commodityLabel:label},
  marketReading:{
   reference:reference?{id:reference.id,price:round(referenceSc),priceUnit:'BRL/sc_60kg',originalPrice:Number(reference.price),originalUnit:reference.priceUnit,region:reference.region,sourceName:reference.sourceName,sourceUrl:reference.sourceUrl||'',observedAt:reference.observedAt,freshness:reference._freshness.label,freshnessState:reference._freshness.state,regionalMatch:reference._regional}:null,
   port:port?{id:port.id,price:round(portSc),region:port.region,sourceName:port.sourceName,observedAt:port.observedAt}:null,
   basisSc,priceGapPercent,marginPercent
  },
  closingTargets,ladder:{averagePriceSc:ladderAverage,revenueBRL:round(ladderRevenue,0),sharesNote:objective.note},
  scenarios,tips,reasons,alerts,assumptions,dataGaps,headline,
  activeIntentions:intentions.filter(item=>item.clientId===request.clientId&&item.commodity===request.commodity&&!['closed','cancelled'].includes(item.status)).map(item=>({id:item.id,status:item.status,volume:Number(item.volume),volumeUnit:item.volumeUnit,targetPrice:item.targetPrice==null?null:Number(item.targetPrice),priceUnit:item.priceUnit})),
  disclaimer:'Análise determinística e explicável para apoiar a conversa; não é recomendação de investimento nem ordem de negociação. A decisão permanece com o consultor e o produtor.'
 }
}

export function buildMarketBrief({praca=null,marketSnapshots=[]}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const month=now.getUTCMonth()+1
 const brief=praca?.marketBrief||{references:[],reading:{},risks:[],sources:[]}
 const briefAgeDays=brief.observedAt?Math.floor((now.getTime()-new Date(`${brief.observedAt}T12:00:00Z`).getTime())/86_400_000):null
 const stale=briefAgeDays!==null&&briefAgeDays>(brief.validityDays||7)
 const commodities=Object.entries(praca?.commodities||{}).map(([commodity,data])=>{
  const registered=marketSnapshots.filter(item=>item.status!=='inactive'&&item.commodity===commodity).map(item=>({...item,_freshness:freshnessFor(item.observedAt,now)})).sort((left,right)=>new Date(right.observedAt)-new Date(left.observedAt))[0]||null
  return {
   commodity,label:commodityLabels[commodity]||commodity,stage:stageFor(data.calendar,month),calendar:data.calendar,qualityStandard:data.qualityStandard,structuralNotes:data.structuralNotes||[],closingTips:data.closingTips||[],
   reading:brief.reading?.[commodity]||[],
   seededReferences:(brief.references||[]).filter(item=>item.commodity===commodity),
   registeredReference:registered?{id:registered.id,price:Number(registered.price),priceUnit:registered.priceUnit,region:registered.region,sourceName:registered.sourceName,observedAt:registered.observedAt,freshness:registered._freshness.label,freshnessState:registered._freshness.state}:null
  }
 })
 return {
  rulesVersion:ANALYSIS_RULES_VERSION,generatedAt:now.toISOString(),praca:praca?{id:praca.id,label:praca.label,version:praca.version,updatedAt:praca.updatedAt,geography:praca.geography,buyers:praca.buyers||[],logistics:praca.logistics||{}}:null,
  brief:{observedAt:brief.observedAt||null,ageDays:briefAgeDays,stale,macro:(brief.references||[]).filter(item=>item.commodity==='cambio'),risks:brief.risks||[],sources:brief.sources||[]},
  commodities,
  governance:{seededReferencesAreNotQuotes:true,note:'As referências do briefing são datadas e servem para leitura; a comparação de preço usa somente cotações registradas com fonte e horário.'},
  warning:stale?`O briefing da praça foi observado há ${briefAgeDays} dias; atualize as referências antes de usar na negociação.`:null
 }
}

export {ANALYSIS_RULES_VERSION,objectives as analysisObjectives}
