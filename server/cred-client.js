// Leitura do VAL Cred para a ficha do Cliente 360 (contrato val-cred-integration.v1, parte C).
// GET {VAL_CRED_BASE_URL}/api/v1/integrations/val/producers/{clientExternalKey}/credit-summary
// com Authorization: Bearer VAL_CRED_READ_TOKEN. Sem as duas variáveis a leitura fica desligada.
// Nunca lança: com o VAL Cred fora do ar, a ficha do produtor continua de pé e diz o que houve.
// Só os campos do contrato atravessam. CPF/CNPJ, documentos e nomes de terceiros não fazem parte
// do contrato, e qualquer campo a mais na resposta é descartado aqui.
// O resumo não depende de quem pergunta: a rota de sessão precisa provar, antes de chamar,
// que o cliente pertence ao login (mesmo escopo de /api/clients/:id/overview).

export const CRED_CONTRACT='val-cred-integration.v1'
export const CRED_SOURCE='val-cred'
export const CRED_SUMMARY_TIMEOUT_MS=8_000
export const CRED_SUMMARY_CACHE_TTL_MS=60_000
// Falha fica pouco tempo no cache: evita martelar um VAL Cred caído sem esconder a volta dele.
export const CRED_SUMMARY_FAILURE_TTL_MS=10_000
export const credEventTypes=Object.freeze(['credit.request.updated','credit.analysis.completed','credit.decision.recorded','credit.property.updated','cooperative.unit.upserted'])
export const credDecisions=Object.freeze(['favoravel','desfavoravel','complementacao'])

const MAX_BODY_CHARS=1_000_000
const MAX_CACHE_KEYS=500
const sharedCache=new Map()

const text=(value,max=200)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null
const num=value=>value===null||value===undefined||value===''||typeof value==='boolean'?null:Number.isFinite(Number(value))?Number(value):null
const bool=value=>typeof value==='boolean'?value:null
const isoDate=value=>{if(!value)return null;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed.toISOString()}
const list=(value,limit)=>Array.isArray(value)?value.slice(0,limit):[]
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}

/** Variáveis da leitura. Ausentes = desligado (status not_configured). */
export function credReadConfig(env=process.env){
 return {baseUrl:String(env.VAL_CRED_BASE_URL||'').trim().replace(/\/+$/,''),readToken:String(env.VAL_CRED_READ_TOKEN||'').trim()}
}

const validBaseUrl=value=>{try{const url=new URL(value);return (url.protocol==='https:'||url.protocol==='http:')&&!url.username&&!url.password}catch{return false}}
const validKey=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=180

function normalizeUnit(value){
 const unit=object(value);const code=text(unit.code,40),name=text(unit.name,120)
 return code||name?{code,name}:null
}

function normalizeAnalysis(value){
 if(!value||typeof value!=='object')return null
 return {fresh:bool(value.fresh),coverage:num(value.coverage),coversPayments:bool(value.coversPayments),stressCoversPayments:bool(value.stressCoversPayments),at:isoDate(value.at)}
}

/** Resposta do VAL Cred → somente os campos do contrato C. Fora do contrato devolve null. */
export function normalizeCreditSummary(body,expectedKey){
 if(!body||typeof body!=='object'||Array.isArray(body))return null
 if(body.schemaVersion!==undefined&&Number(body.schemaVersion)!==1)return null
 const clientExternalKey=text(body.clientExternalKey,180)
 // Nunca mostrar o resumo de outro produtor: a chave devolvida tem de ser a pedida.
 if(expectedKey!==undefined&&clientExternalKey!==String(expectedKey).trim())return null
 const producer=object(body.producer),governance=object(body.governance)
 return {
  schemaVersion:1,
  source:CRED_SOURCE,
  clientExternalKey,
  generatedAt:isoDate(body.generatedAt),
  producer:{name:text(producer.name,160),municipality:text(producer.municipality,120),unit:normalizeUnit(producer.unit)},
  properties:list(body.properties,100).filter(item=>item&&typeof item==='object').map(item=>({
   name:text(item.name,160),municipality:text(item.municipality,120),areaHa:num(item.areaHa),tenure:text(item.tenure,60),
   mapped:bool(item.mapped),registryConfirmed:bool(item.registryConfirmed),activeLiens:num(item.activeLiens)
  })),
  requests:list(body.requests,50).filter(item=>item&&typeof item==='object').map(item=>({
   id:text(item.id,80),title:text(item.title,200),status:text(item.status,40),principal:num(item.principal),termMonths:num(item.termMonths),
   analysis:normalizeAnalysis(item.analysis),updatedAt:isoDate(item.updatedAt)
  })),
  governance:{automaticDecision:governance.automaticDecision===true,humanDecisionRequired:governance.humanDecisionRequired!==false,documentsShared:governance.documentsShared===true}
 }
}

const result=(status,extra={})=>({configured:status!=='not_configured',status,...extra})
const unavailable=error=>result('unavailable',{error})

async function requestSummary({baseUrl,readToken,key,fetcher,timeoutMs}){
 const url=`${baseUrl}/api/v1/integrations/val/producers/${encodeURIComponent(key)}/credit-summary`
 let response
 try{
  response=await fetcher(url,{method:'GET',headers:{Accept:'application/json',Authorization:`Bearer ${readToken}`},signal:AbortSignal.timeout(timeoutMs),redirect:'error'})
 }catch(error){
  return unavailable(error?.name==='TimeoutError'||error?.name==='AbortError'?'O VAL Cred demorou além do limite para responder.':'Não foi possível falar com o VAL Cred agora.')
 }
 if(response.status===404)return result('not_linked')
 if(response.status===401||response.status===403)return unavailable('O VAL Cred recusou o token de leitura da VAL.')
 if(!response.ok)return unavailable(`O VAL Cred respondeu com erro (${response.status}).`)
 let body
 try{
  const raw=await response.text()
  if(raw.length>MAX_BODY_CHARS)return unavailable('A resposta do VAL Cred excede o tamanho aceito.')
  body=JSON.parse(raw)
 }catch{return unavailable('A resposta do VAL Cred não é um JSON válido.')}
 const summary=normalizeCreditSummary(body,key)
 return summary?result('ok',{summary}):unavailable('A resposta do VAL Cred está fora do contrato val-cred-integration.v1.')
}

function remember(cache,cacheKey,entry){
 cache.delete(cacheKey);cache.set(cacheKey,entry)
 while(cache.size>MAX_CACHE_KEYS)cache.delete(cache.keys().next().value)
}

/**
 * Lê o resumo de crédito de um produtor no VAL Cred. Nunca lança.
 * @returns {Promise<{configured:boolean,status:'ok'|'not_linked'|'unavailable'|'not_configured',summary?:object,error?:string}>}
 */
export async function fetchCreditSummary({clientExternalKey,config=credReadConfig(),fetcher=globalThis.fetch,cache=sharedCache,now=Date.now,timeoutMs=CRED_SUMMARY_TIMEOUT_MS}={}){
 const baseUrl=String(config?.baseUrl||'').trim().replace(/\/+$/,''),readToken=String(config?.readToken||'').trim()
 if(!baseUrl||!readToken)return result('not_configured')
 if(!validBaseUrl(baseUrl))return {configured:false,status:'not_configured',error:'VAL_CRED_BASE_URL não é um endereço http(s) válido.'}
 if(!validKey(clientExternalKey))return result('not_linked')
 if(typeof fetcher!=='function')return unavailable('Não foi possível falar com o VAL Cred agora.')
 const key=clientExternalKey.trim(),cacheKey=`${baseUrl}|${key}`
 const cached=cache.get(cacheKey)
 if(cached&&cached.expiresAt>now())return structuredClone(await cached.value)
 const pending=requestSummary({baseUrl,readToken,key,fetcher,timeoutMs}).catch(()=>unavailable('Não foi possível falar com o VAL Cred agora.'))
 // A promessa entra no cache antes de resolver: dois cartões abertos juntos fazem uma chamada só.
 remember(cache,cacheKey,{value:pending,expiresAt:now()+timeoutMs})
 const value=await pending
 if(cache.get(cacheKey)?.value===pending)remember(cache,cacheKey,{value,expiresAt:now()+(value.status==='unavailable'?CRED_SUMMARY_FAILURE_TTL_MS:CRED_SUMMARY_CACHE_TTL_MS)})
 return structuredClone(value)
}

export const clearCreditSummaryCache=()=>sharedCache.clear()

// ---- Eventos val-cred já recebidos pela VAL (tabela integration_events, rota da parte A) ----

const pick={
 'credit.request.updated':payload=>{const request=object(payload.request);return {request:{id:text(request.id,80),title:text(request.title,200),status:text(request.status,40),revision:num(request.revision)}}},
 'credit.analysis.completed':payload=>{const analysis=object(payload.analysis);return {analysis:{requestId:text(analysis.requestId,80),status:text(analysis.status,40),coverage:num(analysis.coverage),coversPayments:bool(analysis.coversPayments),stressCoverage:num(analysis.stressCoverage),stressCoversPayments:bool(analysis.stressCoversPayments)}}},
 'credit.decision.recorded':payload=>{const decision=object(payload.decision);return {decision:{requestId:text(decision.requestId,80),decision:credDecisions.includes(decision.decision)?decision.decision:null,humanDecision:decision.humanDecision===true}}},
 'credit.property.updated':payload=>{const property=object(payload.property),mapping=object(property.mapping),registry=object(property.registry),crosscheck=object(property.crosscheck);return {property:{name:text(property.name,160),municipality:text(property.municipality,120),mapped:num(mapping.revision)>0,registryConfirmed:registry.confirmed===true,activeLiens:Array.isArray(registry.activeLienTypes)?registry.activeLienTypes.length:null,divergences:Array.isArray(crosscheck.divergences)?crosscheck.divergences.length:null}}},
 'cooperative.unit.upserted':payload=>({unit:normalizeUnit(payload.unit)})
}

/** Linha de integration_events → fatos mínimos para o cartão (sem payload bruto). */
export function toCredEventView(row){
 const type=text(row?.event_type??row?.type,100)
 if(!type||!credEventTypes.includes(type))return null
 let payload=row.payload
 if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch{payload={}}}
 return {id:text(String(row.id??''),80),type,occurredAt:isoDate(row.occurred_at??row.occurredAt),receivedAt:isoDate(row.ingested_at??row.receivedAt),status:text(row.status,40),...pick[type](object(payload))}
}

export const CRED_EVENTS_SQL=`SELECT id,event_type,occurred_at,ingested_at,status,payload FROM integration_events
 WHERE tenant_id=$1 AND owner_user_id=$2 AND source='val-cred' AND client_external_key=$3
 ORDER BY occurred_at DESC,ingested_at DESC LIMIT $4`

/**
 * Últimos eventos val-cred do produtor, no escopo do login. Nunca lança.
 * [] = nenhum evento (inclusive sem PostgreSQL, onde a rota da parte A não grava); null = a leitura falhou.
 */
export async function listCredEvents(db,{tenantId,ownerId,clientExternalKey,limit=8}={}){
 if(!db?.configured||typeof db.query!=='function'||!tenantId||!ownerId||!validKey(clientExternalKey))return []
 try{
  const rows=(await db.query(CRED_EVENTS_SQL,[tenantId,ownerId,clientExternalKey.trim(),Math.max(1,Math.min(20,Number(limit)||8))])).rows||[]
  return rows.map(toCredEventView).filter(Boolean)
 }catch{return null}
}

// Aceita a linha crua de integration_events (tem event_type) ou a visão já montada por listCredEvents.
const asEventView=item=>item&&typeof item==='object'&&'event_type' in item?toCredEventView(item):item&&credEventTypes.includes(item.type)?item:null

/** Corpo de GET /api/clients/:id/credit: o que o CreditSummaryCard consome. events=null → eventsAvailable:false. */
export function buildCreditView({result:read,events}={}){
 const status=['ok','not_linked','unavailable','not_configured'].includes(read?.status)?read.status:'unavailable'
 const view={contract:CRED_CONTRACT,configured:read?.configured===true,status,summary:status==='ok'&&read.summary?read.summary:null,events:Array.isArray(events)?events.map(asEventView).filter(Boolean).slice(0,20):[],eventsAvailable:Array.isArray(events)}
 if(read?.error)view.error=String(read.error).slice(0,300)
 return view
}
