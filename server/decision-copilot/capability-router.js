import {createHash,randomUUID} from 'node:crypto'
import {routeValIntent} from '../ai-reasoning/intent-router.js'
import {legacyVisitLifecycle} from '../visit-loop/lifecycle.js'

export const systemCapabilityRouterVersion='val.system_capability_router.v1'
export const reasoningPathVersion='val.fast_deep_reasoning.v1'

export const systemCapabilities=Object.freeze([
 'CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','VISIT_HISTORY','OPPORTUNITY_PIPELINE',
 'AGRONOMIC_WORKSPACE','SOIL_ANALYSIS','IMAGE_DIAGNOSIS','CALCULATORS','LABELS','WEATHER',
 'MARKET_COMMODITY','KNOWLEDGE_LIBRARY','AGRONOMIST_MANUAL','VOICE_INPUT','VOICE_OUTPUT'
])

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,4000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const commodityLabels={soja:'Soja',milho:'Milho',trigo:'Trigo',sorgo:'Sorgo',feijao:'Feijão',arroz:'Arroz',cevada:'Cevada'}
const marketKindLabels={spot:'disponível (spot)',forward:'a termo (forward)',futures:'futuro (futures)'}
const clientIndependent=new Set(['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET'])

function commodityFrom(message=''){
 const source=normalize(message)
 let selected='';let selectedAt=-1
 for(const commodity of Object.keys(commodityLabels)){
  const matcher=new RegExp(`\\b${commodity}\\b`,'g');let match
  while((match=matcher.exec(source))){if(match.index>=selectedAt){selected=commodity;selectedAt=match.index}}
 }
 return selected
}

function marketKindFrom(message=''){
 const source=normalize(message)
 const explicit=[
  ['forward',/\b(?:a\s+termo|forward|contrato\s+a\s+termo|entrega\s+futura)\b/g],
  ['futures',/\b(?:futures|mercado\s+futuro|contrato\s+futuro|bolsa|vencimento)\b/g],
  ['spot',/\b(?:spot|disponivel|fisico|balcao)\b/g]
 ]
 let selected='';let selectedAt=-1
 for(const [kind,pattern] of explicit){for(const match of source.matchAll(pattern)){if(match.index>=selectedAt){selected=kind;selectedAt=match.index}}}
 if(selected)return selected
 if(/\b(?:hoje|agora|neste\s+momento)\b/.test(source))return 'spot'
 return /\b(?:cotacao|preco|mercado)\b/.test(source)&&canonicalSeason(source)?'forward':''
}

function priceUnitFrom(message=''){
 const source=normalize(message)
 if(/\b(?:por\s+tonelada|toneladas?|brl\s*\/\s*t|r\$\s*\/\s*t|reais?\s+por\s+tonelada)\b/.test(source))return 'BRL/t'
 if(/\b(?:por\s+saca|sacas?|sc(?:\s+de\s+60\s*kg)?|brl\s*\/\s*sc|r\$\s*\/\s*sc|reais?\s+por\s+saca)\b/.test(source))return 'BRL/sc_60kg'
 return ''
}

function regionFrom(message='',snapshots=[]){
 const source=normalize(message)
 const known=list(snapshots).map(item=>clean(item?.region,120)).filter(Boolean).flatMap(region=>{
  const full=normalize(region);const primary=full.split(/[\/,;|-]/)[0].trim()
  return [{requested:full,match:full},...(primary.length>=3&&primary!==full?[{requested:primary,match:primary}]:[])]
 }).filter(item=>new RegExp(`(?:^|[^a-z0-9])${item.match.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^a-z0-9])`).test(source)).sort((left,right)=>right.match.length-left.match.length)
 if(known[0])return known[0].requested
 const explicit=source.match(/\b(?:praca|regiao)(?:\s+de)?\s+([a-z][a-z0-9 '\/-]{1,80}?)(?=\s+(?:hoje|agora|neste momento|safra|para entrega|com entrega|por saca|por tonelada)\b|[?,.;]|$)/)
 if(explicit)return explicit[1].trim()
 const located=source.match(/\bem\s+([a-z][a-z '\/-]{1,60}?)(?=\s+(?:hoje|agora|neste momento|safra|para entrega|com entrega|por saca|por tonelada)\b|[?,.;]|$)/)
 const candidate=located?.[1]?.trim()||''
 return /\/[a-z]{2}$/.test(candidate)?candidate:''
}

function sameRegion(itemRegion='',requestedRegion=''){
 if(!requestedRegion)return true
 const item=normalize(itemRegion);const requested=normalize(requestedRegion)
 return item===requested||item.startsWith(`${requested}/`)||requested.startsWith(`${item}/`)
}

function dateOnly(value){
 const raw=clean(value,40).slice(0,10)
 return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:''
}

function dateRangeFrom(message='',season=''){
 const source=normalize(message)
 const dates=[]
 for(const match of source.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g)){
  const day=String(Number(match[1])).padStart(2,'0');const month=String(Number(match[2])).padStart(2,'0')
  dates.push(`${match[3]}-${month}-${day}`)
 }
 for(const match of source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))dates.push(`${match[1]}-${match[2]}-${match[3]}`)
 if(dates.length){const ordered=[...new Set(dates)].sort();return {start:ordered[0],end:ordered.at(-1),source:'explicit_date'}}
 const months={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12}
 for(const [label,month] of Object.entries(months)){
  const match=source.match(new RegExp(`\\b${label}\\s+(?:de\\s+)?(20\\d{2})\\b`))
  if(!match)continue
  const start=`${match[1]}-${String(month).padStart(2,'0')}-01`
  const endDate=new Date(Date.UTC(Number(match[1]),month,0)).getUTCDate()
  return {start,end:`${match[1]}-${String(month).padStart(2,'0')}-${endDate}`,source:'month'}
 }
 if(season){const [startYear,endSuffix]=season.split('/');const endYear=`${startYear.slice(0,2)}${endSuffix}`;return {start:`${startYear}-07-01`,end:`${endYear}-06-30`,source:'season'}}
 return null
}

function overlapsRange(item={},range=null){
 if(!range)return true
 const start=dateOnly(item.deliveryStart??item.delivery_start);const end=dateOnly(item.deliveryEnd??item.delivery_end)||start
 if(!start&&!end)return false
 const first=start||end;const last=end||start
 return first<=range.end&&last>=range.start
}

export function routeSystemCapability({message='',intentHint='',hasClient=false,attachmentTypes=[]}={}){
 const intentRoute=routeValIntent({message,intentHint,hasClient,attachmentTypes})
 const source=normalize(message)
 const capabilities=[]
 let path='DEEP'
 let direct=false

 if(intentRoute.intent==='ASK_CLIENT'&&(/\b(?:ultima|ultimo|mais recente)\b.*\bvisita\b|\bvisita\b.*\b(?:ultima|ultimo|mais recente)\b/.test(source))){
  capabilities.push('VISIT_HISTORY');path='FAST';direct=true
 }else if(['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET'].includes(intentRoute.intent)){
  capabilities.push('MARKET_COMMODITY')
  const crossAccount=hasClient&&/\b(?:muda|impacta|conversa|abordagem|oportunidade|negociacao|produtor|conta)\b/.test(source)
  if(crossAccount)capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','OPPORTUNITY_PIPELINE')
  if(attachmentTypes.length)capabilities.push(attachmentTypes.some(type=>String(type).startsWith('image/'))?'IMAGE_DIAGNOSIS':'KNOWLEDGE_LIBRARY')
  path=crossAccount||attachmentTypes.length?'DEEP':'FAST';direct=!crossAccount&&!attachmentTypes.length
 }else if(intentRoute.intent==='CHECK_WEATHER'){
  capabilities.push('WEATHER');path='DEEP';direct=false
 }else if(intentRoute.intent==='CHECK_LABEL'){
  capabilities.push('LABELS','AGRONOMIST_MANUAL');path='DEEP';direct=false
 }else if(intentRoute.intent==='CHECK_OPPORTUNITY'){
  capabilities.push('OPPORTUNITY_PIPELINE','COMMERCIAL_HISTORY');path='DEEP';direct=false
 }else if(intentRoute.intent==='CALCULATE'){
  capabilities.push('CALCULATORS');path='DEEP';direct=false
 }else if(intentRoute.intent==='ANALYZE_SOIL'){
  capabilities.push('SOIL_ANALYSIS','AGRONOMIC_WORKSPACE','AGRONOMIST_MANUAL');path='DEEP'
 }else if(intentRoute.intent==='IMAGE_DIAGNOSIS'){
  capabilities.push('IMAGE_DIAGNOSIS','AGRONOMIST_MANUAL');path='DEEP'
 }else if(intentRoute.intent==='ASK_AGRONOMIC'){
  capabilities.push('AGRONOMIC_WORKSPACE','AGRONOMIST_MANUAL','KNOWLEDGE_LIBRARY');path='DEEP'
 }else if(intentRoute.intent==='PREPARE_VISIT'){
  capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','VISIT_HISTORY','OPPORTUNITY_PIPELINE','KNOWLEDGE_LIBRARY');path='DEEP'
 }else if(intentRoute.intent==='ASK_CLIENT'){
  capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY');path='DEEP'
 }else capabilities.push('KNOWLEDGE_LIBRARY')

 return Object.freeze({
  version:systemCapabilityRouterVersion,
  reasoning_path_version:reasoningPathVersion,
  intent:intentRoute.intent,
  path,
  direct,
  capabilities:[...new Set(capabilities)],
  current_data_required:intentRoute.requires_current_data,
  client_context_required:!clientIndependent.has(intentRoute.intent),
  persistence_mode:intentRoute.persistence_mode,
  reason:path==='FAST'?'Uma capacidade determinística responde sem acionar raciocínio profundo.':'A pergunta exige cruzamento de contexto, fontes ou hipóteses.'
 })
}

function freshness(observedAt,now){
 const parsed=new Date(observedAt||'')
 if(Number.isNaN(parsed.getTime()))return {state:'INVALID',hours:null,label:'data inválida'}
 const deltaMs=now.getTime()-parsed.getTime()
 // Cinco minutos cobrem apenas pequena deriva de relógio; além disso o
 // registro futuro não pode ser apresentado como dado atual.
 if(deltaMs < -300_000)return {state:'INVALID',hours:null,label:'data futura inválida'}
 const hours=Math.max(0,deltaMs/3_600_000)
 if(hours<=24)return {state:'CURRENT',hours:Number(hours.toFixed(1)),label:'atual nas últimas 24 h'}
 if(hours<=168)return {state:'DATED',hours:Number(hours.toFixed(1)),label:'registrada nesta semana'}
 return {state:'STALE',hours:Number(hours.toFixed(1)),label:'histórica; precisa ser atualizada'}
}

function money(value){
 return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0))
}

function normalizedConfidence(value,fallback=.5){
 const numeric=Number(value)
 if(!Number.isFinite(numeric))return fallback
 return Math.max(0,Math.min(1,numeric>1?numeric/100:numeric))
}

function marketSelection(workspace,message,now){
 const commodity=commodityFrom(message)
 const requestedMarketKind=marketKindFrom(message)
 const requestedSeason=canonicalSeason(message)
 const requestedPriceUnit=priceUnitFrom(message)
 const requestedRegion=regionFrom(message,workspace?.marketSnapshots)
 const requestedRange=dateRangeFrom(message,requestedSeason)
 const temporalSelectionRequired=Boolean(requestedRange&&(requestedMarketKind==='forward'||requestedMarketKind==='futures'||/\b(?:entrega|janela|vencimento)\b/.test(normalize(message))))
 const snapshots=list(workspace?.marketSnapshots)
  .filter(item=>item?.status!=='inactive'&&(!commodity||item?.commodity===commodity))
  .filter(item=>!requestedMarketKind||normalize(item?.marketKind??item?.market_kind)===requestedMarketKind)
  .filter(item=>!requestedPriceUnit||clean(item?.priceUnit??item?.price_unit,40)===requestedPriceUnit)
  .filter(item=>sameRegion(item?.region,requestedRegion))
  .filter(item=>{
   const itemSeason=recordSeason(item)
   if(requestedSeason&&itemSeason!==requestedSeason)return false
   if(!temporalSelectionRequired)return true
   if(requestedRange?.source!=='season')return overlapsRange(item,requestedRange)
   return requestedSeason?true:overlapsRange(item,requestedRange)
  })
  .filter(item=>item?.sourceName&&item?.observedAt&&Number.isFinite(Number(item?.price))&&freshness(item.observedAt,now).state!=='INVALID')
  .sort((left,right)=>new Date(right.observedAt)-new Date(left.observedAt))
 const latest=snapshots[0]||null
 const previous=latest?snapshots.find(item=>item.id!==latest.id&&item.commodity===latest.commodity&&item.priceUnit===latest.priceUnit&&item.region===latest.region&&item.marketKind===latest.marketKind&&dateOnly(item.deliveryStart??item.delivery_start)===dateOnly(latest.deliveryStart??latest.delivery_start)&&dateOnly(item.deliveryEnd??item.delivery_end)===dateOnly(latest.deliveryEnd??latest.delivery_end))||null:null
 return {commodity,requestedMarketKind,requestedSeason,requestedPriceUnit,requestedRegion,requestedRange,latest,previous,freshness:latest?freshness(latest.observedAt,now):null}
}

export function answerCurrentMarket({workspace={},message='',intentHint='',now=new Date()}={}){
 const route=routeSystemCapability({message,intentHint,hasClient:false})
 const selected=marketSelection(workspace,message,now)
 const requestedLabel=commodityLabels[selected.commodity]||'a commodity solicitada'
 if(!selected.latest){
  const requestedDetails=[selected.requestedMarketKind&&`tipo ${marketKindLabels[selected.requestedMarketKind]||selected.requestedMarketKind}`,selected.requestedSeason&&`safra ${selected.requestedSeason}`,selected.requestedRegion&&`praça ${selected.requestedRegion}`,selected.requestedPriceUnit&&`unidade ${selected.requestedPriceUnit}`,selected.requestedRange&&selected.requestedRange.source!=='season'&&`entrega entre ${selected.requestedRange.start} e ${selected.requestedRange.end}`].filter(Boolean).join(', ')
  return {
   route,
   status:'UNAVAILABLE',
   answer:`Não encontrei uma cotação autorizada e identificada para ${requestedLabel}${requestedDetails?` com ${requestedDetails}`:''}. Não vou tratar memória antiga como preço atual nem substituir o tipo ou a janela pedidos por outra referência.`,
   action:'Abra Mercado e registre ou atualize uma referência com praça, horário e fonte antes de usar o valor em uma decisão.',
   facts:[],
   source:null,
   confidence:{level:'INSUFICIENTE',score:.12,rationale:'Nenhuma referência autorizada com fonte e data foi encontrada.'}
  }
 }
 const quote=selected.latest
 const label=commodityLabels[quote.commodity]||quote.commodity
 const kind=clean(quote.marketKind??quote.market_kind,80)
 const kindLabel=marketKindLabels[kind]||kind||'não informado'
 const dateText=new Date(quote.observedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
 const deliveryStart=dateOnly(quote.deliveryStart??quote.delivery_start)
 const deliveryEnd=dateOnly(quote.deliveryEnd??quote.delivery_end)
 const deliveryText=deliveryStart||deliveryEnd?` Janela de entrega: ${deliveryStart||deliveryEnd}${deliveryEnd&&deliveryEnd!==deliveryStart?` a ${deliveryEnd}`:''}.`:''
 const declaredConfidence=normalizedConfidence(quote.confidence,.5)
 const sourceConfidence=quote.sourceName&&quote.observedAt?(quote.sourceUrl?.startsWith('https://') ? 0.88 : 0.72):0.35
 const freshnessConfidence=selected.freshness.state==='CURRENT'?0.92:selected.freshness.state==='DATED'?0.7:0.42
 const calibratedScore=Number(Math.min(declaredConfidence,sourceConfidence,freshnessConfidence).toFixed(2))
 const confidenceLevel=calibratedScore>=.65?'PROVÁVEL':'INSUFICIENTE'
 let movement=''
 if(selected.previous){
  const delta=Number(quote.price)-Number(selected.previous.price)
  const percent=Number(selected.previous.price)?delta/Number(selected.previous.price)*100:0
  movement=` Em relação à referência anterior da mesma carteira, ${delta>0?'subiu':delta<0?'caiu':'ficou estável'} ${Math.abs(percent).toLocaleString('pt-BR',{maximumFractionDigits:2})}%.`
 }
 const currentPrefix=selected.commodity
  ?selected.freshness.state==='CURRENT'?'A referência mais recente':'A última referência disponível'
  :selected.freshness.state==='CURRENT'?'Entre as referências autorizadas registradas, a mais recente':'Entre as referências autorizadas registradas, a última disponível'
 const warning=selected.freshness.state==='CURRENT'?'':` Ela é ${selected.freshness.label}; confirme uma atualização antes de tratá-la como preço de hoje.`
 return {
  route,
  status:selected.freshness.state,
  answer:`${currentPrefix} é de ${label}: ${money(quote.price)} ${clean(quote.priceUnit,40)} em ${clean(quote.region,120)}. Tipo de mercado: ${kindLabel}.${deliveryText} Fonte ${clean(quote.sourceName,180)}, observada em ${dateText}.${movement}${warning}`,
  action:selected.freshness.state==='CURRENT'?'Cruze esta referência com praça, frete, janela e preço-alvo do produtor antes de avançar.':'Atualize a cotação na área Mercado antes de orientar uma negociação.',
  facts:[{id:clean(quote.id,180),source_type:'market_snapshot',statement:`${label}: ${money(quote.price)} ${clean(quote.priceUnit,40)} em ${clean(quote.region,120)}; tipo ${kindLabel}${deliveryStart||deliveryEnd?`; entrega ${deliveryStart||deliveryEnd}${deliveryEnd&&deliveryEnd!==deliveryStart?` a ${deliveryEnd}`:''}`:''}; fonte ${clean(quote.sourceName,180)}, observada em ${dateText}.`,observed_at:quote.observedAt,confidence:calibratedScore}],
  source:{id:clean(quote.id,180),name:clean(quote.sourceName,180),url:clean(quote.sourceUrl,1000)||null,observed_at:quote.observedAt,commodity:clean(quote.commodity,80),price_unit:clean(quote.priceUnit,40),market_kind:kind,market_kind_label:kindLabel,region:clean(quote.region,120),delivery_start:deliveryStart||null,delivery_end:deliveryEnd||null,requested_season:selected.requestedSeason||null,requested_region:selected.requestedRegion||null,requested_price_unit:selected.requestedPriceUnit||null,freshness:selected.freshness},
  confidence:{level:confidenceLevel,score:calibratedScore,rationale:`Confiança calibrada pela declaração da fonte, proveniência disponível e atualidade classificada como ${selected.freshness.label}; recência isolada não equivale a verificação.`}
 }
}

export function buildFastMarketResponse({workspace={},message='',intentHint='',organizationId='unknown',ownerId='unknown',conversationId='',now=new Date(),latencyMs=0}={}){
 const market=answerCurrentMarket({workspace,message,intentHint,now})
 const createdAt=now.toISOString()
 const contextHash=createHash('sha256').update(JSON.stringify({message,source:market.source?.id||null,createdAt:createdAt.slice(0,13)})).digest('hex')
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:'portfolio',name:'Carteira'},
  context_snapshot:{id:`market-${contextHash.slice(0,16)}`,version:'val.current_data_snapshot.v1',confidence:market.confidence,hash:contextHash},conversation_id:clean(conversationId,180)||'global',
  intent:market.route.intent,persistence_mode:'NONE',objective:clean(message,1200)||'Consultar mercado.',situation_summary:market.answer,key_signals:[],facts_used:market.facts,hypotheses:[],missing_information:market.status==='UNAVAILABLE'?['Cotação autorizada com fonte, praça e horário']:[],
  decision_thesis:{CURRENT_SITUATION:market.answer,WHAT_MATTERS:'Atualidade, praça, unidade e fonte precisam acompanhar qualquer número de mercado.',KEY_UNCERTAINTY:market.status==='CURRENT'?'O efeito específico sobre a conta ainda depende da janela e do preço-alvo do produtor.':'A referência ainda representa o mercado atual?',THESIS:market.action,WHY:market.confidence.rationale,WHAT_TO_VALIDATE:'Praça, frete, janela, preço-alvo e horário da referência.',WHAT_WOULD_CHANGE_MY_VIEW:'Uma referência autorizada mais recente ou de praça mais aderente.'},
  golden_questions:[],recommended_strategy:{reading:market.answer,action:market.action,do_not_do:'Não apresentar cotação sem fonte e data como preço atual.'},evidence_to_use:market.facts,agronomic_context:{status:'not_applicable',human_review_required:false,sources:{},safety_note:'Nenhuma recomendação agronômica foi produzida.'},commercial_context:{status:'current_market_reference'},next_commitment:market.action,risks:market.status==='CURRENT'?[]:['Referência não classificada como atual.'],confidence:market.confidence,reasoning_confidence:{context:market.confidence.score,thesis:market.confidence.score,question:.8,agronomy:null,knowledge:.9},knowledge_refs:market.source?[{id:market.source.id,title:market.source.name,source_refs:[market.source.url||market.source.id],status:market.status,requires_human_review:false}]:[],memory_refs:[],created_at:createdAt,model:'rules-market-v1',prompt_version:'val-decision-copilot-v3',
  run:{provider:'system-capability-router',model:'rules-market-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'FAST',capabilities_planned:market.route.capabilities,capabilities_used:market.status==='UNAVAILABLE'?[]:['MARKET_COMMODITY'],capability_results:[{capability:'MARKET_COMMODITY',status:market.status==='UNAVAILABLE'?'NO_DATA':'EXECUTED',source_ref:market.source?.id||null}],latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},
  premises:{recomputed_for_request:true,source:'authorized_current_data',profile_specific:false,conversation_is_not_confirmed_memory:true,current_data:{required:true,status:market.status,source:market.source}},
  voice_output:{version:'val.voice_output.v1',speakable_text:market.answer,persistence:'NONE',automatic_memory_effect:false},
  decision_interview:{version:'val.decision_interview.v1',status:'NOT_NEEDED',questions:[],material_missing_information:[],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'global',persistence_mode:'NONE'},explanation:'A capacidade de mercado respondeu com fonte e data; o cruzamento com um produtor pode exigir novas perguntas.'},
  quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{name_swap:{passed:null,evaluated:false,reason:'Não aplicável a uma cotação de carteira sem produtor.'},context_removal:{passed:null,evaluated:false,reason:'Não executado no FAST PATH determinístico.'}}}
 }
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'fast-system-capability',route:'FAST',model:'rules-market-v1',warning:'',globalCopilot:true,responseMetadata:{intent:market.route.intent,reasoningPath:'FAST',capabilities:market.route.capabilities,currentDataStatus:market.status},advice:{answer:market.answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}

function canonicalSeason(value=''){
 const match=clean(value,400).match(/\b(20\d{2})\s*[\/_-]\s*((?:20)?\d{2})\b/)
 if(!match)return ''
 const end=match[2].length===2?`${match[1].slice(0,2)}${match[2]}`:match[2]
 return `${match[1]}/${end.slice(-2)}`
}

function recordCorpus(item={}){
 return normalize([
  item?.key,item?.title,item?.category,item?.product,item?.commodity,item?.crop,item?.season,item?.safra,
  typeof item?.value==='string'?item.value:JSON.stringify(item?.value??{}),
  typeof item?.evidence==='string'?item.evidence:JSON.stringify(item?.evidence??{}),
  item?.hypothesis,item?.notes,item?.nextAction,item?.next_action
 ].filter(Boolean).join(' '))
}

function recordCommodities(item={}){
 const corpus=recordCorpus(item)
 return Object.keys(commodityLabels).filter(commodity=>new RegExp(`\\b${commodity}\\b`).test(corpus))
}

function recordSeason(item={}){
 const value=item?.value&&typeof item.value==='object'?item.value:{}
 return [item?.season,item?.safra,item?.cropSeason,item?.crop_season,value.season,value.safra,value.cropSeason,value.crop_season,recordCorpus(item)].map(canonicalSeason).find(Boolean)||''
}

function validThrough(item={},now=new Date()){
 const value=item?.valid_until??item?.validUntil??null
 if(value==null||value==='')return true
 const expiresAt=new Date(value)
 return !Number.isNaN(expiresAt.getTime())&&expiresAt.getTime()>now.getTime()
}

function confirmedMemories(context={},{commodity='',season='',now=new Date()}={}){
 return list(context.memories).filter(item=>{
  const status=String(item?.status||'').toUpperCase()
  const state=String(item?.memory_state||item?.memoryState||item?.epistemic_state||'').toUpperCase()
  const domain=normalize(item?.memory_domain||item?.memoryDomain||item?.domain)
  if(status!=='VERIFIED'||!['FACT','VERIFIED','CONFIRMED'].includes(state)||!validThrough(item,now))return false
  if(!/^(?:commercial|comercial|market|mercado|grain|graos|commodity|negotiation|negociacao)$/.test(domain))return false
  const commodities=recordCommodities(item)
  if(commodity&& !commodities.includes(commodity))return false
  const itemSeason=recordSeason(item)
  if(season)return itemSeason===season
  return !itemSeason
 })
}

function marketProfileGuidance(context={},now=new Date()){
 const client=context.client||{}
 const profile=context.profile||{}
 const label=clean(client.primaryProfile||client.primary_profile||profile.primaryProfile||profile.primary_profile,120)
 const validUntil=profile.validUntil??profile.valid_until??client.profileValidUntil??client.profile_valid_until??null
 const explicitStatus=normalize(profile.status||client.profileStatus||client.profile_status)
 const expired=/expired|expirado|vencido/.test(explicitStatus)||!validThrough({validUntil},now)
 if(expired)return {label:'',status:'EXPIRED',confirmed:false,validUntil:validUntil||null,guidance:'O perfil de decisão está vencido; não o trate como premissa confirmada. Valide novamente como este produtor compara alternativas.'}
 const rejected=/^(?:pending|pendente|draft|rascunho|proposed|proposto|hypothesis|hipotese|unconfirmed|nao confirmado)$/.test(explicitStatus)
 const evidence=[...list(profile.evidence),...list(client.profileEvidence)]
 const evidenceConfirmed=evidence.some(item=>item?.self_reported===true||/^(?:confirmed|verified|completed|integrated|confirmado|verificado|concluido|integrado)$/.test(normalize(item?.status||item?.verification)))
 const positivelyConfirmed=/^(?:confirmed|verified|completed|integrated|confirmado|verificado|concluido|integrado)$/.test(explicitStatus)||profile.confirmed===true||client.profileConfirmed===true||client.profileSelfReported===true||Boolean(profile.assessedAt&&evidenceConfirmed)
 if(rejected||!positivelyConfirmed)return {label:'',status:explicitStatus?explicitStatus.toUpperCase():'UNKNOWN',confirmed:false,validUntil:validUntil||null,guidance:'O perfil de decisão ainda não está confirmado; valide como este produtor compara alternativas antes de personalizar a abordagem.'}
 const normalizedLabel=normalize(label)
 const base={label,status:label?'CONFIRMED':'UNKNOWN',confirmed:Boolean(label),validUntil:validUntil||null}
 if(/analitic/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado é analítico, abra com a referência comparável, explicite praça e unidade e só depois teste a decisão econômica.'}
 if(/relacional/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado é relacional, conecte a referência ao histórico combinado e valide a leitura antes de propor qualquer avanço.'}
 if(/conservador|seguranca/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado privilegia segurança, trate a cotação como referência, mostre o risco de base e proponha um próximo passo reversível.'}
 if(/inovador/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado é inovador, transforme a referência em um cenário curto de teste, com critério de sucesso explícito, limite de exposição e revisão combinada.'}
 if(/digital|agil/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado aceita interação digital, envie a referência com fonte e data e use a conversa para confirmar o critério de decisão.'}
 if(label)return {...base,guidance:`Como o perfil confirmado é ${label}, use a referência como ponto de partida e valide explicitamente como este produtor compara alternativas.`}
 return {...base,label:'',status:'UNKNOWN',confirmed:false,guidance:'O perfil de decisão ainda não está confirmado; use a referência como ponto de partida e valide como este produtor compara alternativas.'}
}

function activeItem(items=[]){
 return list(items).find(item=>!/^(?:CLOSED|WON|LOST|CANCELLED|COMPLETED|FECHADO|GANHO|PERDIDO|CANCELADO|CONCLU[IÍ]DO)$/i.test(String(item?.status||item?.stage||'')))||null
}

function relevantOpportunity(items=[],{commodity='',season=''}={}){
 return activeItem(list(items).filter(item=>{
  const commodities=recordCommodities(item)
  if(commodity&&!commodities.includes(commodity))return false
  const itemSeason=recordSeason(item)
  return !season||itemSeason===season
 }))
}

function materialField(value=''){
 const source=normalize(value)
 if(/preco\s*[- ]?alvo|target[_ ]?price/.test(source))return 'target_price'
 if(/janela|entrega|decision[_ ]?window/.test(source))return 'decision_window'
 return 'material_response'
}

function sessionAnswers(message=''){
 const raw=String(message||'')
 const records=[]
 for(const match of raw.matchAll(/Resposta\s+\d+\s*\[([^\]]+)\]\s*:\s*([\s\S]*?)(?=\s+Resposta\s+\d+\s*\[|$)/gi))records.push({field:materialField(match[1]),answer:clean(match[2].replace(/\.\s*$/,''),1200)})
 if(records.length)return records
 for(const match of raw.matchAll(/Resposta\s+\d+\s+à\s+pergunta\s+[“"]([^”"]+)[”"]\s*:\s*([\s\S]*?)(?=\s+Resposta\s+\d+\s+à\s+pergunta|$)/gi))records.push({field:materialField(match[1]),answer:clean(match[2].replace(/\.\s*$/,''),1200)})
 if(records.length)return records
 for(const match of raw.matchAll(/Resposta\s+\d+\s*:\s*([\s\S]*?)\.\s*Pergunta\s+material\s*:\s*[“"]([^”"]+)[”"]/gi))records.push({field:materialField(match[2]),answer:clean(match[1],1200)})
 return records
}

function usefulAnswer(value=''){
 const source=normalize(value)
 return Boolean(source)&&!/^(?:nao\s+sei|nao\s+informad[oa]|a\s+confirmar|desconhecid[oa]|sem\s+informacao|n\/a)[.!]?$/.test(source)
}

function explicitTarget(value='',structured=false){
 const source=normalize(value)
 if(!usefulAnswer(source))return false
 const numeric=/(?:r\$\s*)?\d+(?:[.,]\d+)?/.test(source)
 const unit=/\b(?:por\s+saca|saca(?:\s+de\s+60\s*kg)?|sc(?:\s*60\s*kg)?|por\s+tonelada|tonelada|brl\s*\/\s*(?:sc|t)|r\$\s*\/\s*(?:sc|t)|\/\s*(?:saca|sc|t))\b/.test(source)
 return numeric&&unit&&(structured||/\b(?:preco\s*[- ]?alvo|alvo)\b/.test(source))
}

function explicitWindow(value='',structured=false){
 const source=normalize(value)
 if(!usefulAnswer(source))return false
 const temporal=/\b(?:hoje|amanha|esta\s+semana|proxima\s+semana|em\s+\d+\s+dias?|ate\s+\d+\s+dias?|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}[-\/]\d{1,2}(?:[-\/]\d{1,2})?|\d{1,2}[\/-]\d{1,2}(?:[\/-]20\d{2})?)\b/
 if(!temporal.test(source))return false
 if(structured)return true
 return /\b(?:janela|entrega|vender|venda|comprar|compra|decidir|decisao)\b.{0,70}\b(?:hoje|amanha|semana|dias?|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{1,2}[\/-]\d{1,2})\b|\b(?:hoje|amanha|semana|dias?|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{1,2}[\/-]\d{1,2})\b.{0,70}\b(?:janela|entrega|vender|venda|comprar|compra|decidir|decisao)\b/.test(source)
}

function memoryDecisionKnowledge(memories=[]){
 let targetKnown=false;let windowKnown=false
 for(const item of memories){
  const value=item?.value&&typeof item.value==='object'?item.value:{}
  const target=Number(value.targetPrice??value.target_price)
  const priceUnit=clean(value.priceUnit??value.price_unit,80)
  if(Number.isFinite(target)&&target>0&&priceUnit)targetKnown=true
  const window=clean(value.decisionWindow??value.decision_window,300)
  if((window&&usefulAnswer(window))||value.deliveryStart||value.delivery_start||value.deliveryEnd||value.delivery_end)windowKnown=true
  const key=normalize(item?.key)
  if(!targetKnown&&/target[_ .-]?price|preco[_ .-]?alvo/.test(key)&&explicitTarget(value.statement,true))targetKnown=true
  if(!windowKnown&&/decision[_ .-]?window|janela|entrega/.test(key)&&explicitWindow(value.statement,true))windowKnown=true
 }
 return {targetKnown,windowKnown}
}

function sessionKnowledge(message='',intention=null,memories=[]){
 const replies=sessionAnswers(message)
 const decision=memoryDecisionKnowledge(memories)
 const direct=replies.length?[]:[{field:'direct',answer:message}]
 const answerRecords=replies.length?replies:direct
 const targetKnown=intention?.targetPrice!=null&&intention.targetPrice!==''&&Number.isFinite(Number(intention.targetPrice))||decision.targetKnown||answerRecords.some(item=>(item.field==='target_price'||item.field==='direct')&&explicitTarget(item.answer,item.field==='target_price'))
 const windowKnown=Boolean(intention?.deliveryStart||intention?.deliveryEnd)||decision.windowKnown||answerRecords.some(item=>(item.field==='decision_window'||item.field==='direct')&&explicitWindow(item.answer,item.field==='decision_window'))
 return {targetKnown,windowKnown}
}

export function buildClientMarketResponse({workspace={},context={},facts={},message='',intentHint='',attachmentTypes=[],organizationId='unknown',ownerId='unknown',conversationId='',now=new Date(),latencyMs=0}={}){
 const market=answerCurrentMarket({workspace,message,intentHint,now})
 const client={...(facts.client||{}),...(context.client||{})}
 const route=routeSystemCapability({message,intentHint:intentHint||market.route.intent,hasClient:true,attachmentTypes})
 const clientId=String(client.id||'unknown')
 const commodity=market.source?.commodity||commodityFrom(message)
 const requestedSeason=canonicalSeason(message)
 const intention=activeItem(list(workspace.intentions).filter(item=>{
  if(String(item?.clientId||item?.client_id)!==clientId||!['confirmed','negotiating'].includes(String(item?.status||'').toLowerCase()))return false
  if(commodity&&normalize(item?.commodity)!==commodity)return false
  const itemSeason=recordSeason(item)
  return !requestedSeason||itemSeason===requestedSeason
 }))
 const decisionSeason=requestedSeason||recordSeason(intention)
 const memories=confirmedMemories(context,{commodity,season:decisionSeason,now})
 const opportunity=relevantOpportunity(context.opportunities,{commodity,season:decisionSeason})
 const profile=marketProfileGuidance(context,now)
 const knowledge=sessionKnowledge(message,intention,memories)
 const missing=market.status==='UNAVAILABLE'?[]:[
  !knowledge.targetKnown&&{field:'target_price',question:`Qual é o preço-alvo de ${clean(client.name,120)||'este produtor'} e em qual unidade ele compara?`,why:'Sem preço-alvo e unidade, a cotação não mostra se existe distância econômica relevante.'},
  !knowledge.windowKnown&&{field:'decision_window',question:'Qual é a janela real para essa decisão ou entrega?',why:'A janela muda a validade da referência, o risco de base e a urgência da conversa.'}
 ].filter(Boolean).slice(0,2)
 const accountSignals=[]
 if(intention){
  const direction=intention.direction==='buy'?'compra':intention.direction==='sell'?'venda':'negociação'
  const target=intention.targetPrice!=null&&intention.targetPrice!==''&&Number.isFinite(Number(intention.targetPrice))?` com alvo de ${money(intention.targetPrice)} ${clean(intention.priceUnit,40)}`:''
  const volume=intention.volume!=null&&intention.volume!==''&&Number.isFinite(Number(intention.volume))?` para ${Number(intention.volume).toLocaleString('pt-BR')} ${clean(intention.volumeUnit,40)}`:''
  accountSignals.push(`há uma intenção de ${direction}${volume}${target}`)
 }
 if(opportunity)accountSignals.push(`a oportunidade ativa “${clean(opportunity.title||opportunity.category,180)}” está em ${clean(opportunity.stage||opportunity.status||'acompanhamento',100)}`)
 const accountReading=market.status==='UNAVAILABLE'
  ?`Para ${clean(client.name,180)||'este produtor'}, não é seguro inferir impacto comercial sem uma referência atual autorizada.`
  :accountSignals.length
   ?`Para ${clean(client.name,180)}, ${accountSignals.join(' e ')}. ${profile.guidance}`
   :`Para ${clean(client.name,180)}, não encontrei intenção ou oportunidade ativa suficiente para concluir o impacto desta referência. ${profile.guidance}`
 const answer=`${market.answer} ${accountReading}`
 const action=market.status==='UNAVAILABLE'
  ?market.action
  :missing.length
   ?`Responda ${missing.length===1?'à pergunta material':'às perguntas materiais'} abaixo antes de transformar a referência em abordagem para ${clean(client.name,120)}.`
   :`Na conversa com ${clean(client.name,120)}, compare a referência com o alvo e a janela confirmados, explicite praça, unidade e fonte e feche um próximo passo datado.`
 const contextFacts=[]
 if(intention)contextFacts.push({id:clean(intention.id,180),source_type:'negotiation_intent',statement:`Intenção ${clean(intention.direction,60)} de ${clean(intention.commodity,80)}; status ${clean(intention.status,80)}${intention.targetPrice!=null&&intention.targetPrice!==''&&Number.isFinite(Number(intention.targetPrice))?`; alvo ${money(intention.targetPrice)} ${clean(intention.priceUnit,40)}`:''}.`,observed_at:intention.observedAt||intention.updatedAt||null,confidence:normalizedConfidence(intention.confidence,.5)})
 if(opportunity)contextFacts.push({id:clean(opportunity.id,180),source_type:'opportunity',statement:`${clean(opportunity.title||opportunity.category,220)}; etapa ${clean(opportunity.stage||opportunity.status||'não informada',100)}.`,observed_at:opportunity.updated_at||opportunity.updatedAt||null,confidence:null})
 if(profile.confirmed)contextFacts.push({id:`profile-${clientId}`,source_type:'producer_profile',statement:`Perfil confirmado: ${profile.label}.`,observed_at:context.profile?.assessedAt||client.profileUpdatedAt||null,confidence:null})
 const memoryRefs=memories.map(item=>({id:clean(item.id,180),key:clean(item.key,180),state:clean(item.memory_state||item.memoryState,80),source_ref:clean(item.source_ref||item.sourceRef,240)})).filter(item=>item.id).slice(0,12)
 const available=new Set(['CLIENT_CONTEXT'])
 if(market.status!=='UNAVAILABLE')available.add('MARKET_COMMODITY')
 if(memories.length)available.add('CONFIRMED_MEMORY')
 if(intention)available.add('COMMERCIAL_HISTORY')
 if(opportunity)available.add('OPPORTUNITY_PIPELINE')
 const planned=route.capabilities
 const capabilityResults=planned.map(capability=>({
  capability,
  status:available.has(capability)?'EXECUTED':'NO_DATA',
  source_ref:capability==='MARKET_COMMODITY'?market.source?.id||null:capability==='CLIENT_CONTEXT'?clientId:capability==='CONFIRMED_MEMORY'?memoryRefs[0]?.id||null:capability==='COMMERCIAL_HISTORY'?intention?.id||null:capability==='OPPORTUNITY_PIPELINE'?opportunity?.id||null:null
 }))
 const used=capabilityResults.filter(item=>item.status==='EXECUTED').map(item=>item.capability)
 const confidenceScore=market.status==='UNAVAILABLE'?0.12:Number(Math.min(market.confidence.score,missing.length?0.58:0.78).toFixed(2))
 const confidenceLevel=confidenceScore>=.65?'PROVÁVEL':'INSUFICIENTE'
 const createdAt=now.toISOString()
 const contextHash=createHash('sha256').update(JSON.stringify({client:clientId,message,source:market.source?.id||null,intention:intention?.id||null,opportunity:opportunity?.id||null,memories:memoryRefs.map(item=>item.id)})).digest('hex')
 const interview={
  version:'val.decision_interview.v1',status:missing.length?'NEEDS_INPUT':'NOT_NEEDED',
  questions:missing.map(item=>({...item,classification:'MATERIAL',already_known:false})),
  material_missing_information:missing.map(item=>item.field),non_material_missing_information:[],
  session_context:{conversation_id:clean(conversationId,180)||'stateless',persistence_mode:'NONE',confirmed_memory_unchanged:true},
  explanation:missing.length?`Faltam ${missing.length} informaç${missing.length===1?'ão':'ões'} materiais para ligar a referência de mercado à decisão de ${clean(client.name,120)}. A resposta vale apenas nesta conversa até confirmação de registro.`:'A fonte atual e o contexto confirmado disponíveis são suficientes para esta leitura.',
  recompute_after_reply:true,register_offer:{available:true,automatic:false,confirmation_required:true}
 }
 const spokenQuestions=missing.map((item,index)=>`Pergunta ${index+1}: ${item.question}`)
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:clientId,name:clean(client.name,180)||'Produtor'},
  context_snapshot:{id:`client-market-${contextHash.slice(0,16)}`,version:'val.current_data_context_snapshot.v1',confidence:{level:confidenceLevel,score:confidenceScore},hash:contextHash},conversation_id:clean(conversationId,180)||'stateless',
  intent:route.intent,persistence_mode:'NONE',objective:clean(message,1200)||'Cruzar mercado e contexto do produtor.',situation_summary:answer,key_signals:[],facts_used:[...market.facts,...contextFacts],hypotheses:[],missing_information:missing.map(item=>item.field),
  decision_thesis:{CURRENT_SITUATION:answer,WHAT_MATTERS:'A cotação só muda a abordagem quando é comparável à praça, unidade, alvo e janela do produtor.',KEY_UNCERTAINTY:missing[0]?.question||'A referência e o contexto representam a decisão atual?',THESIS:action,WHY:`${market.confidence.rationale} ${profile.guidance}`,WHAT_TO_VALIDATE:missing.map(item=>item.question).join(' ')||'Preço-alvo, janela, praça, frete e critério de decisão.',WHAT_WOULD_CHANGE_MY_VIEW:'Uma referência autorizada mais recente ou uma mudança confirmada no alvo, janela ou intenção do produtor.'},
  golden_questions:[],recommended_strategy:{reading:answer,action,do_not_do:'Não apresentar movimento de mercado como recomendação de compra ou venda nem presumir intenção do produtor.'},evidence_to_use:[...market.facts,...contextFacts],
  agronomic_context:{status:'not_applicable',human_review_required:false,sources:{},safety_note:'Nenhuma prescrição ou recomendação agronômica foi produzida.'},commercial_context:{status:'market_account_cross',commodity:commodity||null,season:decisionSeason||null,market_kind:market.source?.market_kind||null,profile_strategy:profile.guidance,profile_status:profile.status,profile_valid_until:profile.validUntil,intention_id:intention?.id||null,opportunity_id:opportunity?.id||null},next_commitment:action,risks:market.status==='CURRENT'?[]:['A referência de mercado não está classificada como atual.'],
  confidence:{level:confidenceLevel,score:confidenceScore,rationale:`Confiança limitada pela fonte de mercado e pela cobertura do contexto da conta; ${missing.length?'ainda há lacunas materiais.':'não há lacuna material detectada nesta solicitação.'}`},
  reasoning_confidence:{version:'val.reasoning_confidence.v1',context:intention||opportunity||profile.label?0.76:0.48,thesis:confidenceScore,question:missing.length?0.86:0.76,agronomy:null,knowledge:market.source?0.8:0.2,threshold:{ask_below:.72,answer_at_or_above:.72}},
  knowledge_refs:market.source?[{id:market.source.id,title:market.source.name,source_refs:[market.source.url||market.source.id],status:market.status,requires_human_review:false}]:[],memory_refs:memoryRefs,created_at:createdAt,model:'rules-client-market-v1',prompt_version:'val-decision-copilot-v3',
  run:{provider:'system-capability-router',model:'rules-client-market-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'DEEP',capabilities_planned:planned,capabilities_used:used,capability_results:capabilityResults,latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},
  premises:{recomputed_for_request:true,source:'confirmed_context_snapshot_plus_authorized_current_data_plus_session',profile_specific:true,confirmed_profile:profile.confirmed?{status:'CONFIRMED',label:profile.label,valid_until:profile.validUntil}:profile.status==='EXPIRED'?{status:'EXPIRED',valid_until:profile.validUntil}:null,profile_evaluation:{status:profile.status,valid_until:profile.validUntil},conversation_is_not_confirmed_memory:true,confirmed_memory_refs:memoryRefs,session_context:{conversation_id:clean(conversationId,180)||'stateless',persistence_mode:'NONE',current_request:clean(message,1200)},current_data:{required:true,status:market.status,source:market.source}},
  voice_output:{version:'val.voice_output.v1',speakable_text:clean([answer,action,...spokenQuestions].join(' '),3800),persistence:'NONE',automatic_memory_effect:false},decision_interview:interview,
  quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{name_swap:{passed:null,evaluated:false,reason:'Disponível na regressão; não executado inline.'},context_removal:{passed:null,evaluated:false,reason:'Disponível na regressão; não executado inline.'}}}
 }
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'deep-system-capability',route:'DEEP',model:'rules-client-market-v1',warning:'',globalCopilot:true,responseMetadata:{intent:route.intent,reasoningPath:'DEEP',capabilitiesPlanned:planned,capabilitiesUsed:used,capabilityResults,currentDataStatus:market.status},advice:{answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}

export function composeMarketAttachmentResponse({marketResponse={},attachmentResponse={},attachmentTypes=[]}={}){
 const attachments=list(attachmentResponse.attachments)
 const attachmentReasoning=attachmentResponse?.advice?.ai_reasoning||{}
 const marketReasoning=marketResponse?.advice?.ai_reasoning||{}
 const summaries=attachments.map(item=>{
  const analysis=item?.analysis||{}
  const observations=list(analysis.observations).map(entry=>clean(entry?.text||entry,400)).filter(Boolean)
  return clean(analysis.summary||observations.join(' '),900)
 }).filter(Boolean)
 const attachmentReading=summaries.length
  ?`Nos anexos processados: ${summaries.join(' ')}`
  :'Os anexos foram validados e processados, mas não produziram uma observação específica confirmada.'
 const answer=clean(`${marketResponse?.advice?.answer||marketReasoning.recommended_strategy?.reading||''} ${attachmentReading}`,3800)
 const attachmentCapabilities=[...new Set(attachmentTypes.map(type=>String(type).startsWith('image/')?'IMAGE_DIAGNOSIS':'KNOWLEDGE_LIBRARY'))]
 const planned=[...new Set([...list(marketReasoning.run?.capabilities_planned),...attachmentCapabilities])]
 const used=[...new Set([...list(marketReasoning.run?.capabilities_used),...attachmentCapabilities])]
 const attachmentFacts=attachments.map(item=>({id:clean(item.id,180),source_type:'consultant_attachment',statement:clean(item?.analysis?.summary||'Arquivo processado sem observação específica confirmada.',900),observed_at:item.updatedAt||item.createdAt||null,confidence:null})).filter(item=>item.id)
 const capabilityResults=[...list(marketReasoning.run?.capability_results).filter(item=>!attachmentCapabilities.includes(item?.capability)),...attachmentCapabilities.map(capability=>({capability,status:'EXECUTED',source_ref:attachments.find(item=>capability==='IMAGE_DIAGNOSIS'?String(item?.mimeType||'').startsWith('image/'):!String(item?.mimeType||'').startsWith('image/'))?.id||attachments[0]?.id||null}))]
 const reasoning={
  ...marketReasoning,
  situation_summary:answer,
  facts_used:[...list(marketReasoning.facts_used),...attachmentFacts],
  evidence_to_use:[...list(marketReasoning.evidence_to_use),...attachmentFacts],
  recommended_strategy:{...(marketReasoning.recommended_strategy||{}),reading:answer},
  agronomic_context:attachmentReasoning.agronomic_context||marketReasoning.agronomic_context,
  run:{...(marketReasoning.run||{}),path:'DEEP',capabilities_planned:planned,capabilities_used:used,capability_results:capabilityResults},
  premises:{...(marketReasoning.premises||{}),attachment_context:{status:'PROCESSED',ids:attachments.map(item=>clean(item.id,180)).filter(Boolean),confirmed_memory_unchanged:true}},
  voice_output:{version:'val.voice_output.v1',speakable_text:answer,persistence:'NONE',automatic_memory_effect:false}
 }
 return {
  ...marketResponse,
  recommendationId:attachmentResponse.recommendationId||marketResponse.recommendationId||null,
  engineMode:attachmentResponse.engineMode||marketResponse.engineMode,
  engineArchitecture:'current-data-plus-multimodal-composition',route:'DEEP',model:attachmentResponse.model||marketResponse.model,
  warning:attachmentResponse.warning||marketResponse.warning||'',attachments,
  responseMetadata:{...(marketResponse.responseMetadata||{}),reasoningPath:'DEEP',capabilitiesPlanned:planned,capabilitiesUsed:used,capabilityResults,attachmentCompositionStatus:'EXECUTED'},
  advice:{...(marketResponse.advice||{}),answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality||marketResponse?.advice?.val_response_quality}
 }
}

export function finalizeAttachmentRecommendation({draft={},attachmentIds=[],attachmentTypes=[],marketResponse=null}={}){
 const expected=[...new Set(list(attachmentIds).map(String).filter(Boolean))]
 const processed=new Set(list(draft.attachments).filter(item=>['interpreted','confirmed'].includes(String(item?.status||'').toLowerCase())).map(item=>String(item.id)))
 if(expected.some(id=>!processed.has(id)))throw Object.assign(new Error('A VAL validou os arquivos, mas a leitura multimodal não ficou disponível. Nenhuma recomendação foi persistida como se o anexo tivesse sido consumido.'),{statusCode:422,code:'val_attachment_analysis_unavailable'})
 return marketResponse?composeMarketAttachmentResponse({marketResponse,attachmentResponse:draft,attachmentTypes}):undefined
}

export function buildFastClientResponse({facts={},message='',organizationId='unknown',conversationId='',now=new Date(),latencyMs=0}={}){
 const route=routeSystemCapability({message,intentHint:'ASK_CLIENT',hasClient:true})
 const client=facts.client||{id:'unknown',name:'Produtor'}
 const completedCandidate=facts.latestCompletedVisit||facts.latestVisit||null
 const visit=completedCandidate&&legacyVisitLifecycle(completedCandidate)==='COMPLETED'?completedCandidate:null
 const scheduledCandidate=facts.nextScheduledVisit||null
 const scheduledAt=scheduledCandidate?.scheduled_at||scheduledCandidate?.scheduledAt||null
 const scheduledTime=new Date(scheduledAt||'').getTime()
 const nextVisit=scheduledCandidate&&['PLANNED','PREPARED'].includes(legacyVisitLifecycle(scheduledCandidate))&&Number.isFinite(scheduledTime)&&scheduledTime>=now.getTime()?scheduledCandidate:null
 const occurredAt=visit?.occurred_at||visit?.occurredAt||visit?.completed_at||visit?.completedAt||visit?.scheduled_at||visit?.scheduledAt||null
 const dateText=occurredAt&&!Number.isNaN(new Date(occurredAt).getTime())?new Date(occurredAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'data não informada'
 const nextDateText=nextVisit?new Date(scheduledAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):''
 const visitSummary=clean(visit?.summary||visit?.objective||'',1200)
 const visitStatus=[clean(visit?.status,80),clean(visit?.lifecycle_status||visit?.lifecycleStatus,40)].filter(Boolean).join(' / ')||'concluída'
 const nextStatus=[clean(nextVisit?.status,80),clean(nextVisit?.lifecycle_status||nextVisit?.lifecycleStatus,40)].filter(Boolean).join(' / ')||'agendada'
 const completedAnswer=visit
  ?`A última visita concluída de ${clean(client.name,180)} foi em ${dateText}, com status ${visitStatus}. ${visitSummary||'O registro não traz resumo ou objetivo.'}`
  :`Não encontrei visita concluída para ${clean(client.name,180)} na carteira autorizada.`
 const nextAnswer=nextVisit?` A próxima visita está agendada para ${nextDateText}, com status ${nextStatus}.`:''
 const answer=`${completedAnswer}${nextAnswer}`
 const action=visit?.next_commitment||visit?.nextCommitment||visit?.next_action||visit?.nextAction||facts.latestCommitment?.description||(nextVisit?`Prepare a visita agendada para ${nextDateText}.`:'Confirme o próximo compromisso antes de registrar uma nova ação.')
 const factList=[]
 if(visit)factList.push({id:clean(visit.id,180),source_type:'visit',statement:completedAnswer,observed_at:occurredAt,status:clean(visit.status,80)||null,lifecycle_status:clean(visit.lifecycle_status||visit.lifecycleStatus,40)||null,confidence:1})
 if(nextVisit)factList.push({id:clean(nextVisit.id,180),source_type:'scheduled_visit',statement:nextAnswer.trim(),observed_at:scheduledAt,status:clean(nextVisit.status,80)||null,lifecycle_status:clean(nextVisit.lifecycle_status||nextVisit.lifecycleStatus,40)||null,confidence:1})
 const hasFact=Boolean(visit||nextVisit)
 const createdAt=now.toISOString();const contextHash=createHash('sha256').update(JSON.stringify({client:client.id,latestCompletedVisit:visit?.id||null,nextScheduledVisit:nextVisit?.id||null,message})).digest('hex')
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:String(client.id),name:clean(client.name,180)},context_snapshot:{id:`fast-${contextHash.slice(0,16)}`,version:'val.fast_data_snapshot.v1',confidence:{level:hasFact?'VERIFICADO':'INSUFICIENTE'},hash:contextHash},conversation_id:clean(conversationId,180)||'stateless',intent:'ASK_CLIENT',persistence_mode:'NONE',objective:clean(message,1200),situation_summary:answer,key_signals:[],facts_used:factList,hypotheses:[],missing_information:visit?[]:['Visita concluída registrada'],decision_thesis:{CURRENT_SITUATION:answer,WHAT_MATTERS:'Visitas concluídas são ordenadas pela ocorrência ou conclusão; agenda futura é apresentada separadamente.',KEY_UNCERTAINTY:visit?'O registro reflete a última visita concluída salva, não contatos ainda não registrados.':'Nenhuma visita concluída foi localizada; uma agenda futura não comprova contato realizado.',THESIS:answer,WHY:hasFact?'O histórico autorizado contém lifecycle, status e data do registro apresentado.':'Nenhum registro concluído ou futuro foi encontrado.',WHAT_TO_VALIDATE:'Confirme se houve contato posterior ainda não registrado.',WHAT_WOULD_CHANGE_MY_VIEW:'Uma visita concluída ou interação mais recente confirmada.'},golden_questions:[],recommended_strategy:{reading:answer,action:clean(action,1200),do_not_do:'Não apresentar visita planejada como contato realizado.'},evidence_to_use:factList,agronomic_context:{status:'not_applicable',human_review_required:false,sources:{},safety_note:'Nenhuma orientação técnica foi produzida.'},commercial_context:{status:'history_lookup'},next_commitment:clean(action,1200),risks:[],confidence:{level:hasFact?'VERIFICADO':'INSUFICIENTE',score:hasFact?0.98:0.2,rationale:hasFact?'Leitura direta de registros autorizados com lifecycle e data próprios.':'Não há registro suficiente.'},reasoning_confidence:{version:'val.reasoning_confidence.v1',context:hasFact?0.98:0.2,thesis:hasFact?0.98:0.2,question:.9,agronomy:null,knowledge:1,threshold:{ask_below:.72,answer_at_or_above:.72}},knowledge_refs:[],memory_refs:[],created_at:createdAt,model:'rules-fast-client-v1',prompt_version:'val-decision-copilot-v3',run:{provider:'system-capability-router',model:'rules-fast-client-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'FAST',capabilities_planned:route.capabilities,capabilities_used:hasFact?['VISIT_HISTORY']:[],capability_results:[{capability:'VISIT_HISTORY',status:hasFact?'EXECUTED':'NO_DATA',source_ref:visit?.id||nextVisit?.id||null}],latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},premises:{recomputed_for_request:true,source:'authorized_fast_data',profile_specific:true,conversation_is_not_confirmed_memory:true},voice_output:{version:'val.voice_output.v1',speakable_text:answer,persistence:'NONE',automatic_memory_effect:false},decision_interview:{version:'val.decision_interview.v1',status:'NOT_NEEDED',questions:[],material_missing_information:[],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'stateless',persistence_mode:'NONE'},explanation:'A pergunta foi respondida diretamente pelo histórico, separando realizado de agendado.'},quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{name_swap:{passed:null,evaluated:false,reason:'Não aplicável a uma consulta literal de visita.'},context_removal:{passed:null,evaluated:false,reason:'Não executado no FAST PATH determinístico.'}}}
 }
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'fast-system-capability',route:'FAST',model:'rules-fast-client-v1',warning:'',globalCopilot:true,responseMetadata:{intent:'ASK_CLIENT',reasoningPath:'FAST',capabilities:route.capabilities,latestCompletedVisit:visit?{id:visit.id,status:visit.status||null,lifecycleStatus:visit.lifecycle_status||visit.lifecycleStatus||null,occurredAt}:null,nextScheduledVisit:nextVisit?{id:nextVisit.id,status:nextVisit.status||null,lifecycleStatus:nextVisit.lifecycle_status||nextVisit.lifecycleStatus||null,scheduledAt}:null},advice:{answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}
