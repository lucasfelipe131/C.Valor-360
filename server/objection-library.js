const DAY=86_400_000
const array=value=>Array.isArray(value)?value:[]
const text=(value,max=360)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const timestamp=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.getTime()}
const iso=value=>timestamp(value)===null?null:new Date(value).toISOString()
const unique=items=>[...new Set(items.map(item=>text(item,180)).filter(Boolean))]
const idOf=(prefix,item,index=0)=>`${prefix}:${text(item?.id||item?.external_id||item?.externalId||index,160)}`
const eventDate=item=>item?.occurred_at||item?.occurredAt||item?.created_at||item?.createdAt||null
const eventType=item=>lower(item?.event_type||item?.eventType||item?.outcome||item?.status||item?.type)
const lossReason=item=>text(item?.loss_reason||item?.lossReason||item?.payload?.loss_reason||item?.payload?.lossReason||item?.metadata?.loss_reason||item?.metadata?.lossReason,260)
const categoryOf=item=>text(item?.category||item?.payload?.category||item?.metadata?.category,120)
const productOf=item=>text(item?.product||item?.payload?.product||item?.metadata?.product,140)
const isLoss=item=>/business\.lost|\blost\b|perdid|derrot|cancelad/.test(eventType(item))&&Boolean(lossReason(item))
const isWin=item=>/business\.closed|\bwon\b|\bclosed\b|ganh|fechad|conclu/.test(eventType(item))
const recommendationDate=item=>item?.created_at||item?.createdAt||null
const recommendationOutcome=item=>lower(item?.feedback?.outcome||item?.feedback?.status)
const usedRecommendation=item=>/accepted|edited|adapted|used|scheduled|executed|won|aceit|edit|adapt|usad|agend|execut|ganh|fechad/.test(recommendationOutcome(item))
const recommendationAction=item=>text(item?.advice?.executive_brief?.action||item?.advice?.next_best_action||item?.next_best_action||item?.advice?.approach_plan?.objective||item?.user_question,280)

const patterns=[
 {id:'price',label:'Preço ou condição comercial',rx:/pre[cç]o|caro|desconto|condi[cç][aã]o|valor alto|mais barato/},
 {id:'proof',label:'Falta de prova ou segurança',rx:/prova|evid[eê]ncia|resultado|seguran[cç]a|confian[cç]a|compar(a|á)c[aã]o|demonstra[cç][aã]o/},
 {id:'timing',label:'Momento ou janela inadequados',rx:/momento|janela|prazo|tarde|cedo|safra|adiad|posterg/},
 {id:'competitor',label:'Concorrente ou solução atual',rx:/concorr|fornecedor atual|marca atual|j[aá] comprou|fechou com/},
 {id:'decision',label:'Decisor ou alinhamento interno',rx:/decisor|diretoria|comit[eê]|s[oó]cio|aprova[cç][aã]o|compras|financeiro/},
 {id:'credit',label:'Crédito, limite ou fluxo financeiro',rx:/cr[eé]dito|limite|caixa|fluxo|prazo de pagamento|financi/},
 {id:'priority',label:'Sem prioridade ou necessidade confirmada',rx:/sem prioridade|n[aã]o precisa|sem necessidade|n[aã]o viu valor|desinteresse|n[aã]o decidiu/}
]

function classify(reason){
 const normalized=lower(reason)
 const known=patterns.find(item=>item.rx.test(normalized))
 return known||{id:`other:${normalized.slice(0,80)}`,label:text(reason,120),rx:null}
}

function similarity(a,b){
 const aCategory=lower(categoryOf(a)),bCategory=lower(categoryOf(b))
 const aProduct=lower(productOf(a)),bProduct=lower(productOf(b))
 if(aProduct&&bProduct&&aProduct===bProduct)return 3
 if(aCategory&&bCategory&&aCategory===bCategory)return 2
 if(aProduct&&bProduct&&(aProduct.includes(bProduct)||bProduct.includes(aProduct)))return 1
 return 0
}

function observedMoveFor(loss,history,recommendations,now){
 const lossAt=timestamp(eventDate(loss))
 if(lossAt===null)return null
 const wins=array(history).filter(item=>isWin(item)&&timestamp(eventDate(item))>lossAt&&timestamp(eventDate(item))<=now&&similarity(loss,item)>0).sort((a,b)=>timestamp(eventDate(a))-timestamp(eventDate(b)))
 const win=wins[0]
 if(!win)return null
 const winAt=timestamp(eventDate(win))
 const candidates=array(recommendations).filter(item=>{
  const at=timestamp(recommendationDate(item))
  return at!==null&&at>lossAt&&at<=winAt&&usedRecommendation(item)&&recommendationAction(item)
 }).sort((a,b)=>timestamp(recommendationDate(b))-timestamp(recommendationDate(a)))
 const recommendation=candidates[0]
 if(!recommendation)return {
  label:'Houve fechamento posterior em caso semelhante',
  action:'O histórico registra um fechamento posterior na mesma categoria ou produto, mas não há abordagem executada registrada para atribuir o avanço.',
  evidenceIds:[idOf('business-loss',loss),idOf('business-win',win)],
  causalClaim:false,
  outcomeAt:iso(eventDate(win))
 }
 return {
  label:'Movimento observado antes de um fechamento posterior',
  action:recommendationAction(recommendation),
  evidenceIds:[idOf('business-loss',loss),idOf('recommendation',recommendation),idOf('business-win',win)],
  causalClaim:false,
  outcomeAt:iso(eventDate(win)),
  feedbackOutcome:text(recommendation?.feedback?.outcome||recommendation?.feedback?.status,80)
 }
}

export function buildObjectionLibrary(context={},options={}){
 const now=options.now??Date.now()
 const horizonStart=now-365*DAY
 const losses=array(context.businessHistory).filter(item=>isLoss(item)&&timestamp(eventDate(item))!==null&&timestamp(eventDate(item))>=horizonStart&&timestamp(eventDate(item))<=now)
 const groups=new Map()
 losses.forEach((loss,index)=>{
  const reason=lossReason(loss)
  const classification=classify(reason)
  const key=classification.id
  if(!groups.has(key))groups.set(key,{id:`objection:${key}`,label:classification.label,records:[],categories:[],products:[],evidenceIds:[],latestAt:null})
  const group=groups.get(key)
  group.records.push(loss)
  group.categories.push(categoryOf(loss))
  group.products.push(productOf(loss))
  group.evidenceIds.push(idOf('business-loss',loss,index))
  const at=timestamp(eventDate(loss))
  if(!group.latestAt||at>timestamp(group.latestAt))group.latestAt=eventDate(loss)
 })
 const objections=[...groups.values()].map(group=>{
  const sorted=[...group.records].sort((a,b)=>timestamp(eventDate(b))-timestamp(eventDate(a)))
  const move=sorted.map(loss=>observedMoveFor(loss,context.businessHistory,context.priorRecommendations,now)).find(Boolean)||null
  return {
   id:group.id,label:group.label,count:group.records.length,
   categories:unique(group.categories),products:unique(group.products),
   lastSeen:iso(group.latestAt),evidenceIds:unique(group.evidenceIds),
   sampleConfidence:group.records.length>=5?'moderate':group.records.length>=2?'low':'insufficient',
   observedMove:move,
   guidance:move?`${move.label}. Use apenas como precedente desta carteira e confirme se o contexto atual é realmente comparável.`:'Ainda não há abordagem associada a avanço real. Descubra a objeção atual em vez de usar um script pronto.',
   guardrail:'O histórico mostra ocorrência e sequência temporal; não prova causalidade nem autoriza pressão, medo, culpa, vergonha ou falsa urgência.'
  }
 }).sort((a,b)=>b.count-a.count||timestamp(b.lastSeen)-timestamp(a.lastSeen)||a.label.localeCompare(b.label,'pt-BR')).slice(0,8)
 return {
  version:'val-objection-library-v1',generatedAt:new Date(now).toISOString(),lookbackDays:365,
  objections,lossEventsConsidered:losses.length,
  policy:{structuredLossReasonOnly:true,freeNotesExcluded:true,genericScripts:false,causalClaims:false},
  emptyReason:objections.length?'':'Nenhuma objeção estruturada de negócio perdido foi registrada nos últimos 12 meses.',
  guardrails:['Sempre cite evidenceIds.','Não trate correlação como causa.','Não transforme histórico em pressão ou urgência artificial.','Confirme se a situação atual é comparável antes de reutilizar qualquer abordagem.']
 }
}
