import {buildValueBridge} from './product-intelligence.js'
import {buildGrainOpportunities} from './grain-intelligence.js'

const DAY=86_400_000
const commodityLabels={soja:'Soja',milho:'Milho',trigo:'Trigo',sorgo:'Sorgo',feijao:'Feijão',arroz:'Arroz',cevada:'Cevada'}
const array=value=>Array.isArray(value)?value:[]
const text=(value,max=420)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const timestamp=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.getTime()}
const iso=value=>timestamp(value)===null?null:new Date(value).toISOString()
const eventDate=item=>item?.occurred_at||item?.occurredAt||item?.created_at||item?.createdAt||null
const eventType=item=>lower(item?.event_type||item?.eventType||item?.outcome||item?.status||item?.type)
const isClosed=item=>/business\.closed|\bclosed\b|\bwon\b|ganh|fechad|conclu|faturad|vendid/.test(eventType(item))
const idOf=(prefix,item,index=0)=>`${prefix}:${text(item?.id||item?.external_id||item?.externalId||index,160)}`
const clientIdOf=item=>String(item?.clientId??item?.client_id??item?.clientExternalKey??item?.client_external_key??'')
const unique=items=>[...new Set(items.filter(Boolean))]

export function hasRecentClosedBusiness(context={},options={}){
 const now=options.now??Date.now()
 const horizon=now-(options.lookbackDays??365)*DAY
 return array(context.businessHistory).some(item=>isClosed(item)&&timestamp(eventDate(item))!==null&&timestamp(eventDate(item))>=horizon&&timestamp(eventDate(item))<=now)
}

function latestClosed(context,now,lookbackDays){
 const horizon=now-lookbackDays*DAY
 return array(context.businessHistory).filter(item=>isClosed(item)&&timestamp(eventDate(item))!==null&&timestamp(eventDate(item))>=horizon&&timestamp(eventDate(item))<=now).sort((a,b)=>timestamp(eventDate(b))-timestamp(eventDate(a)))[0]||null
}

function productCandidates(context,closed){
 const product=text(closed?.product||closed?.payload?.product||closed?.metadata?.product,180)
 const category=text(closed?.category||closed?.payload?.category||closed?.metadata?.category,140)
 if(!product)return []
 const bridge=buildValueBridge(context,`Compare o produto ${product} por preço e alternativas para uma próxima descoberta comercial.`)
 return array(bridge?.value_bridge?.alternatives).slice(0,2).map((item,index)=>({
  id:`product-expansion:${index+1}:${lower(item.name).replace(/[^a-z0-9]+/g,'-')}`,
  type:'product_discovery',domain:'inputs',label:item.name,
  subtitle:`Candidata oficial para comparação após ${product}`,
  reason:text(item.why_candidate||`O catálogo oficial permite iniciar uma comparação controlada na categoria ${category||'registrada'}.`),
  nextAction:`Confirmar se existe uma nova necessidade na conta e, somente depois, validar ${item.name} na mesma cultura, alvo, escopo e fonte vigente.`,
  question:`Depois do fechamento de ${product}, existe outra necessidade em que faça sentido comparar resultado, custo total, risco e prova?`,
  evidenceIds:unique([idOf('business-closed',closed),'product-anchor',item.evidence_id]),
  source:'official_product_catalog',technicalReviewRequired:true,
  caveat:item.tradeoffs||bridge?.value_bridge?.technical_review||'Similaridade cadastral não prova equivalência, adequação ou superioridade.'
 }))
}

function grainCandidates(context,workspace,closed,now){
 if(!workspace)return []
 const clientId=String(context.client?.id||'')
 const profiles=array(workspace.profiles).filter(item=>clientIdOf(item)===clientId&&Boolean(item.confirmedAt||item.confirmed))
 const intentions=array(workspace.intentions).filter(item=>clientIdOf(item)===clientId&&!['closed','cancelled'].includes(item.status))
 const opportunities=buildGrainOpportunities({intentions,marketSnapshots:array(workspace.marketSnapshots)},{now:new Date(now)}).slice(0,2)
 if(opportunities.length)return opportunities.map((item,index)=>({
  id:`grain-expansion:${item.intentId||index}`,
  type:'grain_intent',domain:'grains',label:`${item.commodityLabel}: intenção ${item.direction==='buy'?'de compra':'de venda'}`,
  subtitle:`Sinal SOG já registrado • score ${item.score}/100`,
  reason:text(item.reasons?.join(' • ')||'Há uma intenção de grãos registrada para esta conta.'),
  nextAction:text(item.nextAction,'Reconfirmar intenção, volume, preço e janela com o produtor.'),
  question:`A intenção de ${item.commodityLabel.toLowerCase()} continua válida depois do negócio fechado e qual é o próximo marco verificável?`,
  evidenceIds:unique([idOf('business-closed',closed),`sog-intent:${item.intentId}`,item.marketReference?.id&&`sog-market:${item.marketReference.id}`]),
  source:'sog_confirmed_intent',technicalReviewRequired:false,
  caveat:'A intenção e a cotação precisam permanecer atuais. A VAL não negocia nem cria ordem automaticamente.'
 }))
 const profile=profiles[0]
 if(!profile)return []
 return array(profile.commodities).slice(0,2).map((commodity,index)=>({
  id:`grain-discovery:${commodity}:${index}`,
  type:'grain_discovery',domain:'grains',label:`Descobrir intenção de ${commodityLabels[commodity]||commodity}`,
  subtitle:'Perfil SOG confirmado, sem intenção ativa',
  reason:`O perfil de grãos confirmado inclui ${commodityLabels[commodity]||commodity}, mas não existe intenção ativa com volume, preço e janela.`,
  nextAction:'Perguntar se existe intenção real de compra ou venda; registrar volume, unidade, preço-alvo, janela, praça e origem antes de priorizar.',
  question:`Existe alguma intenção de compra ou venda de ${(commodityLabels[commodity]||commodity).toLowerCase()} que você queira acompanhar nesta safra?`,
  evidenceIds:[idOf('business-closed',closed),`sog-profile:${profile.id}`],
  source:'sog_confirmed_profile',technicalReviewRequired:false,
  caveat:'Perfil de cultura não equivale a intenção comercial. Não crie oportunidade antes da confirmação do produtor.'
 }))
}

export function buildPostConversionExpansion(context={},options={}){
 const now=options.now??Date.now()
 const lookbackDays=options.lookbackDays??365
 const closed=latestClosed(context,now,lookbackDays)
 if(!closed)return {
  version:'val-post-conversion-expansion-v1',generatedAt:new Date(now).toISOString(),status:'not_triggered',trigger:null,candidates:[],
  policy:{requiresClosedEvent:true,automaticOpportunityCreation:false,automaticContact:false,technicalReviewPreserved:true},
  emptyReason:'Nenhum evento business.closed ou resultado ganho foi registrado nos últimos 12 meses.',
  guardrail:'O ciclo só começa depois de um fechamento comprovado e nunca cria pressão, oportunidade ou contato automaticamente.'
 }
 const candidates=[...productCandidates(context,closed),...grainCandidates(context,options.grainWorkspace,closed,now)].slice(0,4)
 const trigger={
  id:idOf('business-closed',closed),closedAt:iso(eventDate(closed)),
  product:text(closed.product||closed.payload?.product||closed.metadata?.product,180),
  category:text(closed.category||closed.payload?.category||closed.metadata?.category,140),
  value:Number.isFinite(Number(closed.value||closed.amount))?Number(closed.value||closed.amount):null,
  evidenceIds:[idOf('business-closed',closed)]
 }
 return {
  version:'val-post-conversion-expansion-v1',generatedAt:new Date(now).toISOString(),
  status:candidates.length?'ready':'closed_without_supported_expansion',trigger,candidates,
  nextAction:candidates[0]?.nextAction||'Registrar o resultado do fechamento e perguntar qual necessidade ou intenção deve ser descoberta a seguir.',
  policy:{requiresClosedEvent:true,automaticOpportunityCreation:false,automaticContact:false,technicalReviewPreserved:true,officialProductCandidatesOnly:true,grainIntentMustBeConfirmed:true},
  emptyReason:candidates.length?'':'O fechamento foi reconhecido, mas os catálogos e sinais SOG não sustentam uma expansão específica. Faça uma descoberta aberta sem sugerir produto ou intenção.',
  guardrail:'Candidatas de insumos são apenas pontos de descoberta e exigem fonte vigente e revisão técnica. Sinais de grãos exigem confirmação do produtor. Não prometa equivalência, resultado ou urgência.'
 }
}
