const DAY=86_400_000
const CACHE_TTL=5*60*1000
const CACHE_LIMIT=500
const portfolioCache=new Map()

const array=value=>Array.isArray(value)?value:[]
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
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
const clientIdOf=item=>String(item?.client_external_key||item?.clientExternalKey||item?.client_id||item?.clientId||'')
const isLoss=item=>/business\.lost|\blost\b|perdid|derrot|cancelad/.test(eventType(item))&&Boolean(lossReason(item))
const isWin=item=>/business\.closed|\bwon\b|\bclosed\b|ganh|fechad|conclu/.test(eventType(item))
const recommendationDate=item=>item?.created_at||item?.createdAt||null
const recommendationOutcome=item=>lower(item?.feedback?.outcome||item?.feedback?.status)
const usedRecommendation=item=>/accepted|edited|adapted|used|scheduled|executed|won|aceit|edit|adapt|usad|agend|execut|ganh|fechad/.test(recommendationOutcome(item))
const recommendationAction=item=>text(item?.advice?.executive_brief?.action||item?.advice?.next_best_action||item?.next_best_action||item?.advice?.approach_plan?.objective||item?.advice?.approach_plan?.prioritize||item?.user_question,280)

const STOP_WORDS=new Set(['para','com','sem','uma','um','de','da','do','das','dos','e','ou','em','no','na','nos','nas','por','que','esta','este','sobre','produto','oportunidade','negocio','cliente','produtor'])
const tokens=value=>unique(lower(value).replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(token=>token.length>=3&&!STOP_WORDS.has(token)))
const overlap=(left,right)=>{const rightTokens=new Set(tokens(right));return tokens(left).filter(token=>rightTokens.has(token)).length}

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

function focusFrom(context={}){
 const selected=context?.conversionFoundation?.selectedOpportunity||{}
 const opportunities=array(context.opportunities)
 const selectedRecord=opportunities.find(item=>String(item?.id||item?.external_key||'')===String(selected?.id||''))||opportunities[0]||{}
 return {
  clientId:String(context?.client?.id||''),
  clientName:text(context?.client?.name,180),
  title:text(selected?.title||selectedRecord?.title,220),
  category:text(selected?.category||selectedRecord?.category,140),
  product:text(selectedRecord?.product||selectedRecord?.payload?.product,160),
  stage:text(selected?.stage||selectedRecord?.stage,80)
 }
}

function similarityToFocus(item,focus){
 let score=0
 const reasons=[]
 const category=categoryOf(item),product=productOf(item)
 if(focus.clientId&&clientIdOf(item)===focus.clientId){score+=4;reasons.push('mesma conta')}
 if(focus.product&&product&&lower(focus.product)===lower(product)){score+=7;reasons.push('mesmo produto')}
 if(focus.category&&category&&lower(focus.category)===lower(category)){score+=6;reasons.push('mesma categoria')}
 const common=overlap(`${category} ${product} ${item?.payload?.opportunityTitle||''}`,`${focus.title} ${focus.category} ${focus.product}`)
 if(common){score+=Math.min(4,common*2);reasons.push(`${common} ${common===1?'termo em comum':'termos em comum'}`)}
 const stage=text(item?.payload?.stage,80)
 if(stage&&focus.stage&&lower(stage)===lower(focus.stage)){score+=2;reasons.push('mesma etapa registrada')}
 return {score,reasons}
}

function similarity(a,b){
 const aCategory=lower(categoryOf(a)),bCategory=lower(categoryOf(b))
 const aProduct=lower(productOf(a)),bProduct=lower(productOf(b))
 let score=0
 if(aProduct&&bProduct&&aProduct===bProduct)score+=7
 else if(aProduct&&bProduct&&(aProduct.includes(bProduct)||bProduct.includes(aProduct)))score+=2
 if(aCategory&&bCategory&&aCategory===bCategory)score+=6
 score+=Math.min(4,overlap(`${aCategory} ${aProduct}`,`${bCategory} ${bProduct}`)*2)
 if(clientIdOf(a)&&clientIdOf(a)===clientIdOf(b))score+=3
 return score
}

const explicitWorkedAction=item=>{
 const payload=object(item?.payload)
 return [
  payload.whatWorked,payload.workedApproach,payload.successfulApproach,payload.responseThatWorked,payload.resolution,payload.proofUsed,payload.decisionReason,
  payload.conversion?.whatWorked,payload.conversion?.approach,payload.result?.whatWorked,payload.feedback?.whatWorked
 ].map(value=>text(value,600)).find(value=>value.length>=12)||''
}

function observedMoveFor(loss,history,recommendations,focus,now){
 const lossAt=timestamp(eventDate(loss))
 if(lossAt===null)return null
 const wins=array(history).filter(item=>isWin(item)&&timestamp(eventDate(item))>lossAt&&timestamp(eventDate(item))<=now&&similarity(loss,item)>=6).sort((a,b)=>timestamp(eventDate(a))-timestamp(eventDate(b)))
 const win=wins[0]
 if(!win)return null
 const explicitAction=explicitWorkedAction(win)
 if(explicitAction)return {
  label:'Resposta registrada antes de um fechamento semelhante',
  action:explicitAction,
  evidenceIds:[idOf('business-loss',loss),idOf('business-win',win)],
  causalClaim:false,
  outcomeAt:iso(eventDate(win)),
  source:'business.closed'
 }
 const allowCurrentAccountRecommendations=!clientIdOf(loss)||clientIdOf(loss)===focus.clientId
 if(!allowCurrentAccountRecommendations)return {
  label:'Houve fechamento posterior em caso semelhante',
  action:'O histórico registra um fechamento posterior na mesma categoria ou produto, mas não existe uma abordagem executada rastreável para atribuir o avanço.',
  evidenceIds:[idOf('business-loss',loss),idOf('business-win',win)],
  causalClaim:false,
  outcomeAt:iso(eventDate(win))
 }
 const winAt=timestamp(eventDate(win))
 const candidates=array(recommendations).filter(item=>{
  const at=timestamp(recommendationDate(item))
  return at!==null&&at>lossAt&&at<=winAt&&usedRecommendation(item)&&recommendationAction(item)
 }).sort((a,b)=>timestamp(recommendationDate(b))-timestamp(recommendationDate(a)))
 const recommendation=candidates[0]
 if(!recommendation)return {
  label:'Houve fechamento posterior em caso semelhante',
  action:'O histórico registra um fechamento posterior na mesma categoria ou produto, mas não existe uma abordagem executada rastreável para atribuir o avanço.',
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
 const focus=focusFrom(context)
 const hasFocus=Boolean(focus.title||focus.category||focus.product||focus.clientId)
 const history=array(options.portfolioHistory||context.portfolioBusinessHistory||context.businessHistory)
 const losses=history
  .filter(item=>isLoss(item)&&timestamp(eventDate(item))!==null&&timestamp(eventDate(item))>=horizonStart&&timestamp(eventDate(item))<=now)
  .map(item=>({item,similarity:similarityToFocus(item,focus)}))
  .filter(entry=>hasFocus?entry.similarity.score>=3:true)
 const groups=new Map()
 losses.forEach((entry,index)=>{
  const loss=entry.item
  const reason=lossReason(loss)
  const classification=classify(reason)
  const key=classification.id
  if(!groups.has(key))groups.set(key,{id:`objection:${key}`,label:classification.label,records:[],categories:[],products:[],evidenceIds:[],latestAt:null,highestSimilarity:0,similarityReasons:[]})
  const group=groups.get(key)
  group.records.push(loss)
  group.categories.push(categoryOf(loss))
  group.products.push(productOf(loss))
  group.evidenceIds.push(idOf('business-loss',loss,index))
  group.highestSimilarity=Math.max(group.highestSimilarity,entry.similarity.score)
  group.similarityReasons.push(...entry.similarity.reasons)
  const at=timestamp(eventDate(loss))
  if(!group.latestAt||at>timestamp(group.latestAt))group.latestAt=eventDate(loss)
 })
 const objections=[...groups.values()].map(group=>{
  const sorted=[...group.records].sort((a,b)=>timestamp(eventDate(b))-timestamp(eventDate(a)))
  const move=sorted.map(loss=>observedMoveFor(loss,history,context.priorRecommendations,focus,now)).find(Boolean)||null
  return {
   id:group.id,label:group.label,count:group.records.length,
   categories:unique(group.categories),products:unique(group.products),
   lastSeen:iso(group.latestAt),evidenceIds:unique(group.evidenceIds),
   highestSimilarity:group.highestSimilarity,similarityReasons:unique(group.similarityReasons),
   sampleConfidence:group.records.length>=5?'moderate':group.records.length>=2?'low':'insufficient',
   observedMove:move,
   guidance:move?`${move.label}. Use apenas como precedente desta carteira e confirme se o contexto atual é realmente comparável.`:'Ainda não há abordagem associada a avanço real. Descubra a objeção atual em vez de usar um script pronto.',
   guardrail:'O histórico mostra ocorrência e sequência temporal; não prova causalidade nem autoriza pressão, medo, culpa, vergonha ou falsa urgência.'
  }
 }).sort((a,b)=>(b.observedMove?1:0)-(a.observedMove?1:0)||b.highestSimilarity-a.highestSimilarity||b.count-a.count||timestamp(b.lastSeen)-timestamp(a.lastSeen)||a.label.localeCompare(b.label,'pt-BR')).slice(0,8)
 return {
  version:'val-objection-library-v2',generatedAt:new Date(now).toISOString(),lookbackDays:365,focus,
  objections,lossEventsConsidered:losses.length,portfolioEventsConsidered:history.length,
  policy:{structuredLossReasonOnly:true,freeNotesExcluded:true,genericScripts:false,causalClaims:false,portfolioScoped:true,personalDataUsed:false},
  emptyReason:objections.length?'':'Nenhuma objeção estruturada de negócio parecido foi registrada nesta carteira nos últimos 12 meses.',
  guardrails:['Sempre cite evidenceIds.','Não trate correlação como causa.','Não transforme histórico em pressão ou urgência artificial.','Confirme se a situação atual é comparável antes de reutilizar qualquer abordagem.']
 }
}

const cacheKey=(repository,ownerId)=>`${repository?.tenantId||'tenant'}:${ownerId||'owner'}`

export async function loadPortfolioBusinessHistory(repository,ownerId,options={}){
 const now=Number(options.now||Date.now())
 const ttlMs=Math.max(1000,Number(options.ttlMs)||CACHE_TTL)
 const key=cacheKey(repository,ownerId)
 const cached=portfolioCache.get(key)
 if(cached&&cached.expiresAt>now)return cached.events
 let events=[]
 if(repository?.db?.configured&&ownerId!=null){
  const result=await repository.db.query(`SELECT business.id,business.source,business.external_id,business.occurred_at,business.outcome,business.category,business.product,business.value,business.loss_reason,business.payload,client.external_key client_external_key,client.name client_name
    FROM business_events business
    JOIN clients client ON client.tenant_id=business.tenant_id AND client.id=business.client_id
    WHERE business.tenant_id=$1 AND client.consultant_id=$2 AND business.outcome IN ('won','lost') AND business.occurred_at>=NOW()-INTERVAL '12 months'
    ORDER BY business.occurred_at DESC LIMIT $3`,[repository.tenantId,ownerId,CACHE_LIMIT])
  events=result.rows.map(row=>({
   id:row.id,source:row.source,externalId:row.external_id,occurredAt:iso(row.occurred_at),outcome:row.outcome,
   category:row.category,product:row.product,value:row.value==null?null:Number(row.value),lossReason:row.loss_reason,
   payload:object(row.payload),clientExternalKey:row.client_external_key,clientName:row.client_name
  }))
 }else{
  const store=repository?.readStore?.()||{}
  events=array(store.businessEvents||store.val?.businessEvents).filter(item=>isLoss(item)||isWin(item)).slice(-CACHE_LIMIT)
 }
 portfolioCache.set(key,{expiresAt:now+ttlMs,events})
 return events
}

export function clearObjectionLibraryCache(){portfolioCache.clear()}
