import {createHash,createHmac,randomUUID} from 'node:crypto'
import {dateOnly} from './grain-repository.js'

// Saída VAL -> VAL Cred (contrato val-cred-integration.v1, parte B). Depois que a SOG salva uma
// intenção, um perfil ou uma cotação, o mesmo DTO do bootstrap vira um evento assinado para
// POST {VAL_CRED_BASE_URL}/api/v1/integrations/val/events. O envio nunca lança nem segura a rota:
// devolve um resultado por evento. Sem VAL_CRED_BASE_URL e VAL_CRED_INBOUND_SECRET nada sai.
// Privacidade: o payload é uma lista fechada de campos (sem notas, detalhes de fonte, nome do
// produtor ou UUIDs internos além do val.client.upserted) e texto livre passa pelo filtro de CPF/CNPJ.

export const CRED_CONTRACT='val-cred-integration.v1'
export const CRED_EVENTS_PATH='/api/v1/integrations/val/events'
export const CRED_TIMEOUT_MS=10_000
export const credOutboundTypes=Object.freeze(['sog.intent.upserted','sog.profile.upserted','sog.market.snapshot','val.client.upserted'])

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DOCUMENT=/(?<!\d)(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g
const text=(value,max=240)=>String(value??'').trim().slice(0,max)
const safeText=(value,max=240)=>text(value,max).replace(DOCUMENT,'[documento omitido]').slice(0,max)
const safeUrl=value=>{const url=text(value,1000);return /^https?:\/\//i.test(url)&&url.search(DOCUMENT)===-1?url:''}
const num=value=>{if(value===null||value===undefined||value==='')return null;const number=Number(value);return Number.isFinite(number)?number:null}
const time=value=>{const at=value instanceof Date?value.getTime():Date.parse(String(value??''));return Number.isNaN(at)?null:at}
const isoOrNull=value=>{const at=time(value);return at===null?null:new Date(at).toISOString()}
const uuid=value=>UUID.test(String(value??''))?String(value):''
const list=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[]
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,12)

/** JSON com todo caractere fora do ASCII escapado (\uXXXX): bytes estáveis para o HMAC dos dois lados. */
export const asciiJson=value=>JSON.stringify(value).replace(/[\u007f-￿]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
/** X-Valor-Signature do corpo bruto: sha256=<hex HMAC-SHA256(VAL_CRED_INBOUND_SECRET, corpo)>. */
export const signCredBody=(raw,secret)=>'sha256='+createHmac('sha256',String(secret)).update(raw).digest('hex')

const pick=(source,keys)=>{for(const key of keys){const value=source?.[key];if(value!==undefined&&value!==null)return String(value).trim()}return undefined}
/** Aceita o env ou um objeto de config (credBaseUrl/credInboundSecret); chave ausente cai no process.env. */
export function credPublisherConfig(source){
 const baseUrl=(pick(source,['credBaseUrl','valCredBaseUrl','VAL_CRED_BASE_URL'])??pick(process.env,['VAL_CRED_BASE_URL'])??'').replace(/\/+$/,'')
 const secret=pick(source,['credInboundSecret','valCredInboundSecret','VAL_CRED_INBOUND_SECRET'])??pick(process.env,['VAL_CRED_INBOUND_SECRET'])??''
 const validUrl=/^https?:\/\/[^\s/]+/i.test(baseUrl)
 return {baseUrl:validUrl?baseUrl:'',eventsUrl:validUrl?baseUrl+CRED_EVENTS_PATH:'',secret,enabled:Boolean(validUrl&&secret)}
}

const intentPayload=dto=>({
 id:text(dto.id,80),commodity:text(dto.commodity,40),direction:text(dto.direction||'sell',10),season:safeText(dto.season,40),
 volume:num(dto.volume),volumeUnit:text(dto.volumeUnit,20),targetPrice:num(dto.targetPrice),priceUnit:text(dto.priceUnit,20),
 deliveryStart:dateOnly(dto.deliveryStart),deliveryEnd:dateOnly(dto.deliveryEnd),deliveryLocation:safeText(dto.deliveryLocation,240),
 status:text(dto.status,20),confidence:num(dto.confidence),source:text(dto.source,80),observedAt:isoOrNull(dto.observedAt),updatedAt:isoOrNull(dto.updatedAt)
})
const profilePayload=dto=>({
 id:text(dto.id,80),commodities:Array.isArray(dto.commodities)?dto.commodities.map(item=>text(item,40)).filter(Boolean).slice(0,20):[],
 storageCapacityT:num(dto.storageCapacityT),storageStructure:safeText(dto.storageStructure,500),logisticsMode:safeText(dto.logisticsMode,120),
 usualDeliveryLocations:safeText(dto.usualDeliveryLocations,1000),source:text(dto.source,80),observedAt:isoOrNull(dto.observedAt),confirmedAt:isoOrNull(dto.confirmedAt)
})
const marketPayload=dto=>({
 id:text(dto.id,80),commodity:text(dto.commodity,40),marketKind:text(dto.marketKind||'spot',20),region:safeText(dto.region,240),
 price:num(dto.price),priceUnit:text(dto.priceUnit,20),sourceName:safeText(dto.sourceName,240),sourceUrl:safeUrl(dto.sourceUrl),
 confidence:num(dto.confidence),observedAt:isoOrNull(dto.observedAt),status:text(dto.status||'active',20)
})
const kinds={
 intent:{type:'sog.intent.upserted',prefix:'sog-intent',payload:intentPayload,client:true},
 profile:{type:'sog.profile.upserted',prefix:'sog-profile',payload:profilePayload,client:true},
 market:{type:'sog.market.snapshot',prefix:'sog-market',payload:marketPayload,client:false}
}

function envelope({type,externalId,occurredAt,tenantId,ownerUserId,clientExternalKey,payload}){
 return {schemaVersion:1,type,externalId,...(occurredAt?{occurredAt}:{}),source:'val',...(uuid(tenantId)?{tenantId:uuid(tenantId)}:{}),...(uuid(ownerUserId)?{ownerUserId:uuid(ownerUserId)}:{}),...(clientExternalKey?{clientExternalKey}:{}),payload}
}
// externalId = versão do conteúdo: updatedAt em ms + impressão do payload. Mesmo conteúdo, mesmo id (200 duplicate);
// conteúdo novo, id novo (nunca 409 no VAL Cred, que compara o hash do payload).
const versionId=(prefix,id,at,payload)=>[prefix,text(id,100),...(at===null?[]:[String(at)]),fingerprint(payload)].join(':').slice(0,180)

function clientEvents({id,clientExternalKey,ownerUserId,tenantId}){
 const clientId=uuid(id),key=text(clientExternalKey,180)
 if(!clientId||!key)return []
 const payload={id:clientId}
 return [envelope({type:'val.client.upserted',externalId:`val-client:${clientId}:${fingerprint({id:clientId,key,owner:uuid(ownerUserId)})}`,tenantId,ownerUserId,clientExternalKey:key,payload})]
}

/**
 * Envelopes do contrato B para um DTO da SOG (mesmo formato do bootstrap). kind: intent|profile|market|client.
 * Intenção e perfil sem chave de cliente não geram evento (o vínculo no VAL Cred é pela chave).
 * clientUuid (UUID de clients.id) acrescenta o val.client.upserted do mesmo cliente.
 */
export function buildSogEvents({kind,dto,clientExternalKey,ownerUserId,tenantId,clientUuid}={}){
 if(!dto||typeof dto!=='object'||!text(dto.id))return []
 if(kind==='client')return clientEvents({id:dto.id,clientExternalKey:clientExternalKey??dto.externalKey,ownerUserId,tenantId})
 const spec=kinds[kind];if(!spec)return []
 const clientKey=spec.client?text(clientExternalKey??dto.clientId,180):''
 if(spec.client&&!clientKey)return []
 const payload=spec.payload(dto)
 if(kind==='market'&&!payload.observedAt)return []
 const at=time(dto.updatedAt)??time(dto.observedAt)
 return [
  ...(spec.client&&clientUuid?clientEvents({id:clientUuid,clientExternalKey:clientKey,ownerUserId,tenantId}):[]),
  envelope({type:spec.type,externalId:versionId(spec.prefix,payload.id,at,payload),occurredAt:at===null?null:new Date(at).toISOString(),tenantId,ownerUserId,clientExternalKey:clientKey,payload})
 ]
}

/** Bootstrap inteiro da SOG em eventos (perfis, intenções e cotações ativas) para republicação idempotente. */
export function backfillWorkspace(workspace,{ownerUserId,tenantId,clients=[]}={}){
 const scope={ownerUserId,tenantId}
 const profiles=list(workspace?.profiles),intentions=list(workspace?.intentions)
 const market=list(workspace?.marketSnapshots).filter(item=>text(item.status||'active')==='active')
 // val.client.upserted só para clientes que já aparecem nos registros da SOG: nenhum cliente a mais sai da VAL.
 const referenced=new Set([...profiles,...intentions].map(item=>text(item.clientId,180)).filter(Boolean))
 const links=list(clients).filter(client=>uuid(client.id)&&referenced.has(text(client.externalKey,180)))
 const events=[
  ...links.flatMap(client=>buildSogEvents({kind:'client',dto:client,...scope})),
  ...profiles.flatMap(dto=>buildSogEvents({kind:'profile',dto,...scope})),
  ...intentions.flatMap(dto=>buildSogEvents({kind:'intent',dto,...scope})),
  ...market.flatMap(dto=>buildSogEvents({kind:'market',dto,...scope}))
 ]
 const seen=new Set()
 return events.filter(event=>!seen.has(event.externalId)&&seen.add(event.externalId))
}

const validEvent=event=>Boolean(event&&typeof event==='object'&&event.schemaVersion===1&&credOutboundTypes.includes(event.type)&&event.source==='val'&&typeof event.externalId==='string'&&event.externalId.length>=4&&event.externalId.length<=180&&event.payload&&typeof event.payload==='object')
const replyError=body=>text(body?.error,300)
async function readReply(response){try{const raw=await response.text();try{return JSON.parse(raw)}catch{return {raw:text(raw,300)}}}catch{return null}}

function classify(base,status,body){
 if(status>=200&&status<300){const duplicate=body?.duplicate===true;return {...base,ok:true,status,outcome:duplicate?'duplicate':'sent',duplicate,retryable:false,...(body?.status?{credStatus:text(body.status,40)}:{})}}
 if(status===409)return {...base,ok:false,status,outcome:'conflict',retryable:false,error:replyError(body)||'externalId já usado com outro conteúdo no VAL Cred.'}
 if([400,401,403,404].includes(status))return {...base,ok:false,status,outcome:'rejected',retryable:false,error:replyError(body)||`VAL Cred recusou o evento (${status}).`}
 return {...base,ok:false,status,outcome:'retry',retryable:true,error:replyError(body)||`VAL Cred respondeu ${status}.`}
}

async function sendOne(event,{settings,send,timeoutMs}){
 const base={type:text(event?.type,80),externalId:text(event?.externalId,180)}
 if(!validEvent(event))return {...base,ok:false,outcome:'invalid',retryable:false,error:'Evento fora do contrato val-cred-integration.v1.'}
 try{
  const raw=asciiJson(event)
  const response=await send(settings.eventsUrl,{method:'POST',headers:{'content-type':'application/json','x-valor-signature':signCredBody(raw,settings.secret),'x-request-id':randomUUID()},body:raw,signal:AbortSignal.timeout(timeoutMs)})
  return classify(base,Number(response?.status)||0,await readReply(response))
 }catch(error){
  const timeout=error?.name==='TimeoutError'||error?.name==='AbortError'
  return {...base,ok:false,outcome:'retry',retryable:true,error:timeout?'Tempo esgotado ao enviar para o VAL Cred.':'VAL Cred indisponível.'}
 }
}

function writeLog(logger,level,data){
 try{const target=logger===undefined?console:logger;const fn=typeof target==='function'?target:(target?.[level]||target?.info);if(typeof fn==='function')fn.call(target,JSON.stringify(data))}catch{}
}

export function summarizeCredResults(results){
 const summary={sent:0,duplicate:0,conflict:0,rejected:0,retry:0,skipped:0,invalid:0}
 for(const item of Array.isArray(results)?results:[])if(item?.outcome in summary)summary[item.outcome]+=1
 return summary
}

/**
 * Envia os envelopes ao VAL Cred (timeout de 10 s por evento). Nunca lança: devolve um resultado por evento
 * ({type,externalId,ok,outcome:'sent'|'duplicate'|'conflict'|'rejected'|'retry'|'skipped'|'invalid',status?,retryable,error?}).
 */
export async function publishToCred(events,{config,fetcher,logger,timeoutMs=CRED_TIMEOUT_MS,concurrency=4}={}){
 try{
  const queue=Array.isArray(events)?events.filter(Boolean):[]
  const settings=credPublisherConfig(config)
  if(!settings.enabled)return queue.map(event=>({type:text(event?.type,80),externalId:text(event?.externalId,180),ok:false,outcome:'skipped',retryable:false,reason:'not_configured'}))
  const send=typeof fetcher==='function'?fetcher:globalThis.fetch
  const limit=Math.max(1,Math.min(16,Math.trunc(Number(concurrency))||1,queue.length||1))
  const results=new Array(queue.length);let next=0
  const worker=async()=>{while(next<queue.length){const index=next++;results[index]=await sendOne(queue[index],{settings,send,timeoutMs})}}
  await Promise.all(Array.from({length:limit},worker))
  for(const item of results)if(!item.ok)writeLog(logger,'warn',{event:'val_cred_publish',outcome:item.outcome,type:item.type,externalId:item.externalId,status:item.status??null})
  if(results.length)writeLog(logger,'info',{event:'val_cred_publish_batch',...summarizeCredResults(results)})
  return results
 }catch{
  writeLog(logger,'warn',{event:'val_cred_publish',outcome:'error'})
  return []
 }
}

async function clientLink(repository,ownerUserId,key){
 if(!key||typeof repository?.clientLinks!=='function')return null
 try{const links=await repository.clientLinks(ownerUserId,{keys:[key]});return links.find(link=>link.externalKey===key)||links.find(link=>link.id===key)||null}catch{return null}
}

/**
 * Atalho para as rotas da SOG: monta e publica o DTO salvo, resolvendo chave e UUID do cliente pelo repositório.
 * Nunca rejeita; chame sem await (`void publishSogChange(...)`) para não segurar a resposta.
 */
export async function publishSogChange({kind,dto,ownerUserId,tenantId,repository,config,fetcher,logger}={}){
 try{
  if(!credPublisherConfig(config).enabled)return []
  const link=kind==='market'?null:await clientLink(repository,ownerUserId,text(dto?.clientId,180))
  const events=buildSogEvents({kind,dto,ownerUserId,tenantId,clientExternalKey:link?.externalKey||undefined,clientUuid:link?.id})
  return await publishToCred(events,{config,fetcher,logger})
 }catch{return []}
}

/** Republica o bootstrap inteiro de um dono (idempotente: o que já chegou volta como duplicate). Nunca rejeita. */
export async function backfillOwnerToCred({repository,ownerUserId,tenantId,config,fetcher,logger,concurrency}={}){
 try{
  if(!credPublisherConfig(config).enabled)return {enabled:false,events:0,results:[],summary:summarizeCredResults([])}
  const workspace=await repository.getWorkspace(ownerUserId)
  const clients=typeof repository.clientLinks==='function'?await repository.clientLinks(ownerUserId).catch(()=>[]):[]
  const events=backfillWorkspace(workspace,{ownerUserId,tenantId,clients})
  const results=await publishToCred(events,{config,fetcher,logger,concurrency})
  return {enabled:true,events:events.length,results,summary:summarizeCredResults(results)}
 }catch{
  writeLog(logger,'warn',{event:'val_cred_backfill',outcome:'error'})
  return {enabled:true,events:0,results:[],summary:summarizeCredResults([]),error:'A republicação da SOG para o VAL Cred falhou.'}
 }
}
