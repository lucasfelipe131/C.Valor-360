const DAY_MS=86_400_000
const CACHE_TTL_MS=5*60*1000
const CACHE_LIMIT=500
const portfolioCache=new Map()

const array=value=>Array.isArray(value)?value:[]
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const text=(value,max=480)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const timestamp=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.getTime()}
const iso=value=>timestamp(value)===null?null:new Date(value).toISOString()
const unique=values=>[...new Set(values.filter(Boolean))]
const evidenceId=event=>`business-event:${text(event?.id||event?.externalId||event?.external_id||'unknown',180)}`
const eventDate=event=>event?.occurredAt||event?.occurred_at||event?.createdAt||event?.created_at||null
const eventOutcome=event=>normalized(event?.outcome)
const eventReason=event=>text(event?.lossReason||event?.loss_reason||event?.payload?.lossReason||event?.payload?.reason,320)
const eventCategory=event=>text(event?.category||event?.payload?.category||event?.payload?.culture||event?.payload?.segment,160)
const eventProduct=event=>text(event?.product||event?.payload?.product||event?.payload?.productName,180)
const eventClientId=event=>String(event?.clientExternalKey||event?.client_external_key||event?.clientId||event?.client_id||'')
const eventClientName=event=>text(event?.clientName||event?.client_name,180)

const STOP_WORDS=new Set(['para','com','sem','uma','um','de','da','do','das','dos','e','ou','em','no','na','nos','nas','por','que','esta','este','sobre','produto','oportunidade','negocio','cliente','produtor'])
const tokens=value=>unique(normalized(value).split(/\s+/).filter(token=>token.length>=3&&!STOP_WORDS.has(token)))
const tokenOverlap=(left,right)=>{
 const a=tokens(left),b=new Set(tokens(right))
 if(!a.length||!b.size)return 0
 return a.filter(token=>b.has(token)).length
}

const OBJECTION_TYPES=[
 {id:'price',label:'Preço e custo percebido',pattern:/\b(?:preco|caro|custo|valor alto|desconto|mais barato)\b/},
 {id:'competition',label:'Concorrente e comparação',pattern:/\b(?:concorrente|outra empresa|outra cooperativa|outra marca|comparacao)\b/},
 {id:'timing',label:'Momento e janela de decisão',pattern:/\b(?:momento|agora nao|adiou|adiamento|safra|janela|prazo|timing|depois)\b/},
 {id:'credit',label:'Crédito e condição comercial',pattern:/\b(?:credito|limite|prazo de pagamento|condicao|financiamento|caixa)\b/},
 {id:'proof',label:'Prova, confiança e risco técnico',pattern:/\b(?:prova|resultado|evidencia|confianca|risco|duvida tecnica|nao acredita|incerteza)\b/},
 {id:'scope',label:'Escopo ou solução inadequada',pattern:/\b(?:nao atende|escopo|solucao|produto inadequado|necessidade diferente|sem aderencia)\b/},
 {id:'relationship',label:'Relacionamento comercial',pattern:/\b(?:relacionamento|preferencia|fidelidade|fornecedor habitual|vinculo)\b/}
]

const objectionType=reason=>OBJECTION_TYPES.find(item=>item.pattern.test(normalized(reason)))||{id:'other',label:'Outro motivo registrado'}

function focusFromContext(context={}){
 const selected=context?.conversionFoundation?.selectedOpportunity||{}
 const opportunities=array(context.opportunities)
 const selectedRecord=opportunities.find(item=>String(item?.id||item?.external_key||'')===String(selected?.id||''))||opportunities[0]||{}
 return {
  clientId:String(context?.client?.id||''),
  clientName:text(context?.client?.name,180),
  opportunityId:String(selected?.id||selectedRecord?.id||selectedRecord?.external_key||''),
  title:text(selected?.title||selectedRecord?.title,220),
  category:text(selected?.category||selectedRecord?.category,160),
  product:text(selectedRecord?.product||selectedRecord?.payload?.product,180),
  stage:text(selected?.stage||selectedRecord?.stage,100)
 }
}

function eventSimilarity(event,focus){
 let score=0
 const reasons=[]
 const category=eventCategory(event)
 const product=eventProduct(event)
 const clientId=eventClientId(event)
 if(clientId&&focus.clientId&&clientId===focus.clientId){score+=4;reasons.push('mesma conta')}
 if(product&&focus.product&&normalized(product)===normalized(focus.product)){score+=7;reasons.push('mesmo produto')}
 if(category&&focus.category&&normalized(category)===normalized(focus.category)){score+=6;reasons.push('mesma categoria')}
 const overlap=tokenOverlap(`${category} ${product} ${event?.payload?.opportunityTitle||''}`,`${focus.title} ${focus.category} ${focus.product}`)
 if(overlap){score+=Math.min(5,overlap*2);reasons.push(`${overlap} ${overlap===1?'termo em comum':'termos em comum'}`)}
 const eventStage=text(event?.payload?.stage,100)
 if(eventStage&&focus.stage&&normalized(eventStage)===normalized(focus.stage)){score+=2;reasons.push('mesma etapa registrada')}
 return {score,reasons}
}

const explicitWorkedText=event=>{
 const payload=object(event?.payload)
 const candidates=[
  payload.whatWorked,
  payload.workedApproach,
  payload.successfulApproach,
  payload.resolution,
  payload.responseThatWorked,
  payload.proofUsed,
  payload.decisionReason,
  payload.conversion?.whatWorked,
  payload.conversion?.approach,
  payload.result?.whatWorked,
  payload.feedback?.whatWorked
 ]
 return candidates.map(value=>text(value,600)).find(value=>value.length>=12)||''
}

function similarityBetweenEvents(left,right){
 let score=0
 const leftProduct=eventProduct(left),rightProduct=eventProduct(right)
 const leftCategory=eventCategory(left),rightCategory=eventCategory(right)
 if(leftProduct&&rightProduct&&normalized(leftProduct)===normalized(rightProduct))score+=7
 if(leftCategory&&rightCategory&&normalized(leftCategory)===normalized(rightCategory))score+=6
 score+=Math.min(4,tokenOverlap(`${leftCategory} ${leftProduct}`,`${rightCategory} ${rightProduct}`)*2)
 if(eventClientId(left)&&eventClientId(left)===eventClientId(right))score+=3
 return score
}

function validatedResponseFor(losses,wins,focus){
 return wins.map(event=>{
  const worked=explicitWorkedText(event)
  if(!worked)return null
  const focusSimilarity=eventSimilarity(event,focus).score
  const lossSimilarity=Math.max(0,...losses.map(loss=>similarityBetweenEvents(loss,event)))
  const score=focusSimilarity+lossSimilarity
  return {event,worked,score,at:timestamp(eventDate(event))||0}
 }).filter(Boolean).filter(item=>item.score>=6).sort((left,right)=>right.score-left.score||right.at-left.at)[0]||null
}

function groupLosses(losses,wins,focus){
 const groups=new Map()
 for(const item of losses){
  const reason=eventReason(item.event)
  const type=objectionType(reason)
  const key=type.id
  const current=groups.get(key)||{type,items:[]}
  current.items.push(item)
  groups.set(key,current)
 }
 return [...groups.values()].map(group=>{
  const ordered=[...group.items].sort((left,right)=>right.similarity.score-left.similarity.score||(timestamp(eventDate(right.event))||0)-(timestamp(eventDate(left.event))||0))
  const latest=ordered[0]?.event
  const response=validatedResponseFor(ordered.map(item=>item.event),wins,focus)
  const evidence=ordered.slice(0,6).map(item=>({
   evidenceId:evidenceId(item.event),
   sourceType:item.event?.source||'business.lost',
   externalId:text(item.event?.externalId||item.event?.external_id,180),
   clientId:eventClientId(item.event),
   clientName:eventClientName(item.event),
   occurredAt:iso(eventDate(item.event))||'unknown',
   reason:eventReason(item.event),
   category:eventCategory(item.event),
   product:eventProduct(item.event),
   similarity:item.similarity.score,
   similarityReasons:item.similarity.reasons,
   quality:'high',
   uncertainty:'O evento confirma a perda e o motivo registrado; não prova que o mesmo motivo ocorrerá nesta oportunidade.'
  }))
  return {
   id:`objection:${group.type.id}`,
   type:group.type.id,
   label:group.type.label,
   occurrences:group.items.length,
   latestReason:eventReason(latest),
   lastSeenAt:iso(eventDate(latest)),
   highestSimilarity:Math.max(...group.items.map(item=>item.similarity.score)),
   evidenceIds:evidence.map(item=>item.evidenceId),
   evidence,
   validatedResponse:response?{
    summary:response.worked,
    evidenceId:evidenceId(response.event),
    sourceType:response.event?.source||'business.closed',
    occurredAt:iso(eventDate(response.event))||'unknown',
    category:eventCategory(response.event),
    product:eventProduct(response.event),
    clientName:eventClientName(response.event),
    quality:'moderate',
    uncertainty:'O registro mostra o que acompanhou um fechamento parecido; não comprova causalidade nem garante repetição do resultado.'
   }:null,
   recommendation:response
    ?`Reaproveite somente o princípio registrado em “${response.worked}” e confirme se o contexto atual é equivalente antes de adaptar a abordagem.`
    :'Ainda não existe uma resposta validada para esta objeção na carteira. Confirme o motivo com o produtor e registre o que foi testado antes de recomendar uma linha de resposta.'
  }
 }).sort((left,right)=>(right.validatedResponse?1:0)-(left.validatedResponse?1:0)||right.highestSimilarity-left.highestSimilarity||right.occurrences-left.occurrences).slice(0,5)
}

export function buildEvidenceObjectionLibrary(context={},portfolioHistory=[],options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const maxAgeDays=Math.max(1,Math.min(3650,Number(options.maxAgeDays)||365))
 const focus=focusFromContext(context)
 const history=array(portfolioHistory).filter(event=>{
  const at=timestamp(eventDate(event))
  return at!==null&&now.getTime()-at<=maxAgeDays*DAY_MS
 })
 const losses=history.filter(event=>eventOutcome(event)==='lost'&&eventReason(event)).map(event=>({event,similarity:eventSimilarity(event,focus)})).filter(item=>{
  const hasFocus=Boolean(focus.category||focus.product||focus.title)
  return hasFocus?item.similarity.score>=3:item.similarity.score>=4
 })
 const wins=history.filter(event=>eventOutcome(event)==='won')
 const patterns=groupLosses(losses,wins,focus)
 return {
  version:'val-evidence-objection-library-v1',
  generatedAt:now.toISOString(),
  maxAgeDays,
  focus,
  status:patterns.length?'ready':'empty',
  patterns,
  considered:{events:history.length,losses:losses.length,wins:wins.length},
  emptyReason:patterns.length?'':'Nenhuma objeção semelhante com motivo rastreável foi encontrada na carteira nos últimos 12 meses.',
  policy:{
   scriptsGenerated:false,
   personalDataUsed:false,
   automaticContact:false,
   evidenceRequired:true,
   message:'A biblioteca mostra somente motivos e respostas registrados. Sem evidência de resultado, a VAL se abstém de oferecer um script.'
  }
 }
}

const portfolioCacheKey=(repository,ownerId)=>`${repository?.tenantId||'tenant'}:${ownerId||'owner'}`

export async function loadPortfolioBusinessHistory(repository,ownerId,options={}){
 const now=Number(options.now||Date.now())
 const ttlMs=Math.max(1000,Number(options.ttlMs)||CACHE_TTL_MS)
 const key=portfolioCacheKey(repository,ownerId)
 const cached=portfolioCache.get(key)
 if(cached&&cached.expiresAt>now)return cached.events
 let events=[]
 if(repository?.db?.configured){
  const result=await repository.db.query(`SELECT business.id,business.source,business.external_id,business.occurred_at,business.outcome,business.category,business.product,business.value,business.loss_reason,business.payload,client.external_key client_external_key,client.name client_name
    FROM business_events business
    JOIN clients client ON client.tenant_id=business.tenant_id AND client.id=business.client_id
    WHERE business.tenant_id=$1 AND client.consultant_id=$2 AND business.outcome IN ('won','lost') AND business.occurred_at>=NOW()-INTERVAL '12 months'
    ORDER BY business.occurred_at DESC LIMIT $3`,[repository.tenantId,ownerId,CACHE_LIMIT])
  events=result.rows.map(row=>({
   id:row.id,
   source:row.source,
   externalId:row.external_id,
   occurredAt:iso(row.occurred_at),
   outcome:row.outcome,
   category:row.category,
   product:row.product,
   value:row.value==null?null:Number(row.value),
   lossReason:row.loss_reason,
   payload:object(row.payload),
   clientExternalKey:row.client_external_key,
   clientName:row.client_name
  }))
 }else{
  const store=repository?.readStore?.()||{}
  events=array(store.businessEvents||store.val?.businessEvents).filter(event=>['won','lost'].includes(eventOutcome(event))).slice(-CACHE_LIMIT)
 }
 portfolioCache.set(key,{expiresAt:now+ttlMs,events})
 return events
}

export function clearEvidenceObjectionCache(){portfolioCache.clear()}
