// Entrada do VAL Cred (contrato val-cred-integration.v1). Reaproveita o envelope v1, o HMAC
// e a idempotência de integration_events do Manual, com segredo, origem e tipos próprios.
// Crédito não gera sinal nem decisão na VAL: fica como evidência e, na propriedade, só em
// properties.metadata.valCred. A decisão de crédito continua humana e fora da VAL.
import {deriveSignals,normalizeIntegrationEvent,verifyWebhookSignature} from './ingestion.js'
import {observe} from './observability.js'
import {assertTenantScope} from './tenant-scope.js'

export const CRED_SOURCE='val-cred'
export const CRED_CONTRACT='val-cred-integration.v1'
export const credEventTypes=new Set(['credit.request.updated','credit.analysis.completed','credit.decision.recorded','credit.property.updated','cooperative.unit.upserted'])
export const credDecisionValues=Object.freeze(['favoravel','desfavoravel','complementacao'])
export const credGovernance=Object.freeze({automaticDecision:false,humanDecisionRequired:true,documentsShared:false})

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// CPF/CNPJ, documentos e credenciais nunca entram na VAL, em qualquer profundidade.
const blockedKey=/cpf|cnpj|documen|passw|senha|secret|token/i
const fail=(message,statusCode=400,code='cred_event_invalid')=>Object.assign(new Error(message),{statusCode,code})
const isObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const given=value=>value!==undefined&&value!==null&&value!==''
const text=(value,max=180)=>typeof value==='string'||typeof value==='number'?String(value).trim().slice(0,max):''
const pick=(source,keys)=>Object.fromEntries(keys.filter(key=>isObject(source)&&source[key]!==undefined).map(key=>[key,source[key]]))
const iso=value=>{const time=Date.parse(value instanceof Date?value.toISOString():String(value||''));return Number.isNaN(time)?null:new Date(time).toISOString()}

export function stripDocuments(value,depth=0){
  if(depth>14)return null
  if(Array.isArray(value))return value.map(item=>stripDocuments(item,depth+1))
  if(isObject(value))return Object.fromEntries(Object.entries(value).filter(([key])=>!blockedKey.test(key)).map(([key,item])=>[key,stripDocuments(item,depth+1)]))
  return value
}

const need=(value,label)=>{if(!text(value))throw fail(`${label} é obrigatório.`)}
const objectAt=(value,label,{optional=false}={})=>{if(optional&&(value===undefined||value===null))return null;if(!isObject(value))throw fail(`${label} precisa ser um objeto.`);return value}
const number=(value,label,{min=-1e15,max=1e15,integer=false}={})=>{
  if(!given(value))return
  const parsed=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):Number.NaN
  if(!Number.isFinite(parsed)||parsed<min||parsed>max||(integer&&!Number.isInteger(parsed)))throw fail(`${label} está fora do formato numérico esperado.`)
}
const flag=(value,label)=>{if(given(value)&&typeof value!=='boolean')throw fail(`${label} precisa ser verdadeiro ou falso.`)}
const date=(value,label)=>{if(given(value)&&Number.isNaN(Date.parse(String(value))))throw fail(`${label} precisa ser uma data válida.`)}
const list=(value,label)=>{if(given(value)&&!Array.isArray(value))throw fail(`${label} precisa ser uma lista.`)}

// Validação mínima por tipo: campos que a VAL usa precisam existir e ter o tipo certo;
// campos extras inofensivos passam sem rejeição.
const validators={
  'credit.request.updated':payload=>{
    const request=objectAt(payload.request,'payload.request')
    need(request.id,'request.id');need(request.status,'request.status')
    number(request.revision,'request.revision',{min:0,integer:true});number(request.principal,'request.principal',{min:0})
    number(request.termMonths,'request.termMonths',{min:1,max:600,integer:true});date(request.periodStart,'request.periodStart');list(request.properties,'request.properties')
  },
  'credit.analysis.completed':payload=>{
    const analysis=objectAt(payload.analysis,'payload.analysis')
    need(analysis.id,'analysis.id');need(analysis.requestId,'analysis.requestId')
    number(analysis.revision,'analysis.revision',{min:0,integer:true})
    for(const key of ['coverage','stressCoverage','installment'])number(analysis[key],`analysis.${key}`)
    for(const key of ['coversPayments','stressCoversPayments'])flag(analysis[key],`analysis.${key}`)
    for(const key of ['missing','warnings'])number(analysis[key],`analysis.${key}`,{min:0,integer:true})
  },
  'credit.decision.recorded':payload=>{
    const decision=objectAt(payload.decision,'payload.decision')
    need(decision.id,'decision.id');need(decision.requestId,'decision.requestId')
    if(!credDecisionValues.includes(text(decision.decision)))throw fail('decision.decision precisa ser favoravel, desfavoravel ou complementacao.')
    if(decision.humanDecision!==true)throw fail('A VAL só aceita parecer de crédito registrado por uma pessoa.')
  },
  'credit.property.updated':payload=>{
    const property=objectAt(payload.property,'payload.property')
    need(property.name,'property.name');number(property.areaHa,'property.areaHa',{min:0})
    const location=objectAt(property.location,'property.location',{optional:true})
    if(location){if(!given(location.lat)||!given(location.lng))throw fail('property.location precisa de lat e lng.');number(location.lat,'location.lat',{min:-90,max:90});number(location.lng,'location.lng',{min:-180,max:180})}
    const mapping=objectAt(property.mapping,'property.mapping',{optional:true})
    if(mapping){number(mapping.revision,'mapping.revision',{min:0,integer:true});number(mapping.totalHa,'mapping.totalHa',{min:0});number(mapping.productiveHa,'mapping.productiveHa',{min:0})}
    const registry=objectAt(property.registry,'property.registry',{optional:true})
    if(registry){flag(registry.confirmed,'registry.confirmed');list(registry.activeLienTypes,'registry.activeLienTypes')}
    const details=objectAt(property.details,'property.details',{optional:true})
    if(details){list(details.activities,'details.activities');list(details.crops,'details.crops');number(details.arableHa,'details.arableHa',{min:0});number(details.storageCapacityT,'details.storageCapacityT',{min:0})}
    const crosscheck=objectAt(property.crosscheck,'property.crosscheck',{optional:true})
    if(crosscheck){date(crosscheck.at,'crosscheck.at');list(crosscheck.divergences,'crosscheck.divergences')}
  },
  'cooperative.unit.upserted':payload=>{
    const unit=objectAt(payload.unit,'payload.unit')
    need(unit.id,'unit.id');flag(unit.active,'unit.active')
    if(given(unit.uf)&&!/^[a-z]{2}$/i.test(text(unit.uf)))throw fail('unit.uf precisa ter duas letras.')
  }
}

/** Envelope do VAL Cred → evento normalizado da VAL, com origem forçada e documentos removidos. */
export function normalizeCredEvent(rawJson){
  let input=rawJson
  if(typeof input==='string'||Buffer.isBuffer(input)){try{input=JSON.parse(String(input))}catch{throw fail('Evento JSON inválido.')}}
  if(!isObject(input))throw fail('Envie um objeto JSON.')
  const externalId=text(input.externalId??input.external_id,400)
  if(externalId.length<4||externalId.length>180)throw fail('externalId precisa ter de 4 a 180 caracteres.')
  if(!isObject(input.payload))throw fail('payload precisa ser um objeto.')
  let event
  try{event=normalizeIntegrationEvent({...input,payload:stripDocuments(input.payload)},{allowedTypes:credEventTypes,source:CRED_SOURCE})}catch(error){throw fail(error.message)}
  if(event.payload.contract!==CRED_CONTRACT)throw fail(`payload.contract precisa ser ${CRED_CONTRACT}.`)
  const unit=objectAt(event.payload.unit,'payload.unit',{optional:true})
  if(unit&&given(unit.valTenantId)&&!uuid.test(text(unit.valTenantId)))throw fail('unit.valTenantId precisa ser o UUID da organização na VAL.')
  validators[event.type](event.payload)
  if(event.type==='cooperative.unit.upserted'){
    if(event.clientExternalKey||event.propertyExternalKey)throw fail('Evento de unidade não identifica produtor nem propriedade.')
  }else if(!event.clientExternalKey)throw fail('Eventos de crédito exigem clientExternalKey do produtor vinculado na VAL.')
  if(event.type==='credit.property.updated'&&!event.propertyExternalKey)throw fail('credit.property.updated exige propertyExternalKey.')
  if(event.propertyExternalKey&&!event.propertyExternalKey.startsWith(`${event.clientExternalKey}:`))throw fail('propertyExternalKey precisa pertencer ao produtor informado.')
  return {...event,fieldExternalKey:''}
}

/** O tenant vem sempre do servidor; o VAL Cred só pode confirmá-lo, nunca trocá-lo. */
export function assertCredTenant(input,event,tenantId){
  const expected=String(tenantId||'').trim().toLowerCase()
  const claims=[input?.tenantId,event?.payload?.unit?.valTenantId].filter(given).map(value=>text(value).toLowerCase())
  if(claims.some(claim=>claim!==expected))throw fail('A organização informada pelo VAL Cred não corresponde a esta VAL.',403,'cred_tenant_mismatch')
}

/** Recorte gravado em properties.metadata.valCred: lista fechada, sem location da VAL. */
export function credPropertyMetadata(event){
  const property=isObject(event?.payload?.property)?event.payload.property:{}
  const unit=isObject(event?.payload?.unit)?pick(event.payload.unit,['code','name','uf']):null
  return {contract:CRED_CONTRACT,externalId:text(event?.externalId),occurredAt:text(event?.occurredAt,40),...pick(property,['name','municipality','areaHa','tenure','location','mapping','registry','details','crosscheck']),...(unit?{unit}:{})}
}

const headerValue=(headers,name)=>{const value=headers?.[name]??headers?.[name.split('-').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join('-')];return Array.isArray(value)?value[0]:value}

/**
 * Webhook POST /api/v1/integrations/cred/events. Só HMAC (X-Valor-Signature) com o segredo
 * próprio; sem segredo a rota fica desligada (503). Devolve {status, body} no formato do
 * webhook do Manual (202 aceito, 200 duplicado, 409 conflito) e ownerId/event para o integrador.
 */
export async function handleCredEvent({rawBody,headers={},config={},repository,accessRepository,tenantId}={}){
  const reply=(status,body,extra={})=>({status,body,...extra})
  const secret=String(config.credWebhookSecret||'')
  if(!secret)return reply(503,{accepted:false,error:'A integração com o VAL Cred não está configurada nesta VAL.',code:'cred_integration_disabled'})
  const raw=Buffer.isBuffer(rawBody)?rawBody:String(rawBody??'')
  if(!verifyWebhookSignature(raw,headerValue(headers,'x-valor-signature'),secret))return reply(401,{accepted:false,error:'Assinatura da integração inválida.',code:'cred_signature_invalid'})
  const database=repository?.db
  if(!config.demoMode&&typeof database?.health==='function'){const health=await database.health();if(!health?.ready)return reply(503,{accepted:false,error:'O PostgreSQL precisa estar disponível para receber integrações fora do modo demonstrativo.',code:'cred_storage_unavailable'})}
  const scopeTenant=tenantId||config.defaultTenantId||repository?.tenantId
  let input,event
  try{input=JSON.parse(Buffer.isBuffer(raw)?raw.toString('utf8'):raw||'{}')}catch{return reply(400,{accepted:false,error:'Evento JSON inválido.',code:'cred_event_invalid'})}
  try{event=normalizeCredEvent(input);assertCredTenant(input,event,scopeTenant)}catch(error){return reply(error.statusCode||400,{accepted:false,error:error.message,code:error.code||'cred_event_invalid'})}
  observe('integration.received',{source:CRED_SOURCE,eventType:event.type})
  try{
    const ownerId=database?.configured?await accessRepository.resolveIntegrationOwner(event.ownerUserId):null
    const result=await repository.ingestEvent({tenantId:scopeTenant,ownerId,event,signals:deriveSignals(event)})
    if(!result.duplicate)await accessRepository?.recordUsage?.(ownerId,{eventType:'cred_sync',page:'integrations',entityType:'client',entityId:event.clientExternalKey||null,metadata:{eventType:event.type}})
    return reply(result.duplicate?200:202,{accepted:true,...result,eventType:event.type,externalId:event.externalId},{ownerId,event,processed:!result.duplicate})
  }catch(error){
    const status=Number(error?.statusCode)
    if(!Number.isInteger(status)||status<400||status>599)throw error
    return reply(status,{accepted:false,duplicate:false,...(status===409?{status:'CONFLICT'}:{}),error:error.message,...(error.code?{code:String(error.code)}:{}),eventType:event.type,externalId:event.externalId},{event,processed:false})
  }
}

const requestSlot=(map,id)=>{const key=text(id);if(!key)return null;if(!map.has(key))map.set(key,{id:key,request:null,analysis:null,decision:null});return map.get(key)}

/** Visão da ficha: últimas versões por solicitação e por propriedade, mais a linha do tempo. */
export function summarizeCredEvents(events=[],{clientExternalKey=''}={}){
  const ordered=[...events].sort((left,right)=>String(right.occurredAt||'').localeCompare(String(left.occurredAt||''))||String(right.receivedAt||'').localeCompare(String(left.receivedAt||'')))
  const requests=new Map(),properties=new Map();let unit=null
  for(const item of ordered){
    const payload=isObject(item.payload)?item.payload:{}
    if(!unit&&isObject(payload.unit))unit=pick(payload.unit,['code','name','uf'])
    if(item.type==='credit.request.updated'){const slot=requestSlot(requests,payload.request?.id);if(slot&&!slot.request)slot.request={...pick(payload.request,['title','status','revision','purpose','periodStart','principal','termMonths','properties']),updatedAt:item.occurredAt}}
    if(item.type==='credit.analysis.completed'){const slot=requestSlot(requests,payload.analysis?.requestId);if(slot&&!slot.analysis)slot.analysis={...pick(payload.analysis,['id','revision','model','status','coverage','coversPayments','stressCoverage','stressCoversPayments','installment','missing','warnings']),at:item.occurredAt}}
    if(item.type==='credit.decision.recorded'){const slot=requestSlot(requests,payload.decision?.requestId);if(slot&&!slot.decision)slot.decision={...pick(payload.decision,['id','analysisId','decision']),humanDecision:true,at:item.occurredAt}}
    if(item.type==='credit.property.updated'&&item.propertyExternalKey&&!properties.has(item.propertyExternalKey))properties.set(item.propertyExternalKey,{propertyExternalKey:item.propertyExternalKey,...pick(payload.property,['name','municipality','areaHa','tenure','location','mapping','registry','details','crosscheck']),updatedAt:item.occurredAt})
  }
  const requestViews=[...requests.values()].map(({id,request,analysis,decision})=>({id,...(request||{}),analysis:analysis?{...analysis,fresh:request&&given(request.revision)&&given(analysis.revision)?Number(analysis.revision)===Number(request.revision):null}:null,decision}))
  return {schemaVersion:1,source:CRED_SOURCE,contract:CRED_CONTRACT,clientExternalKey,unit,requests:requestViews,properties:[...properties.values()],events:ordered.map(item=>({id:item.id,type:item.type,externalId:item.externalId,occurredAt:item.occurredAt,receivedAt:item.receivedAt||null,propertyExternalKey:item.propertyExternalKey||null})),governance:credGovernance}
}

/** Leitura para a ficha do cliente: só eventos do VAL Cred do mesmo tenant, dono e produtor. */
export async function listCredEvents({repository,tenantId,ownerId,clientExternalKey,limit=50}={}){
  const scopedTenant=assertTenantScope(repository?.tenantId,tenantId||repository?.tenantId)
  const key=text(clientExternalKey),owner=text(ownerId,200)
  const size=Math.max(1,Math.min(200,Number.parseInt(limit,10)||50))
  if(!key||!owner)return summarizeCredEvents([],{clientExternalKey:key})
  if(repository?.db?.configured){
    if(!uuid.test(owner))return summarizeCredEvents([],{clientExternalKey:key})
    const {rows}=await repository.db.query(`SELECT id,external_id,event_type,occurred_at,ingested_at,property_external_key,payload FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND source=$3 AND client_external_key=$4 ORDER BY occurred_at DESC,ingested_at DESC,id DESC LIMIT $5`,[scopedTenant,owner,CRED_SOURCE,key,size])
    return summarizeCredEvents(rows.map(row=>({id:String(row.id),type:row.event_type,externalId:row.external_id,occurredAt:iso(row.occurred_at),receivedAt:iso(row.ingested_at),propertyExternalKey:row.property_external_key||'',payload:row.payload})),{clientExternalKey:key})
  }
  const stored=(repository?.fallback?.().val?.integrationEvents||[]).filter(item=>String(item.tenantId)===scopedTenant&&String(item.ownerId)===owner&&item.source===CRED_SOURCE&&item.clientExternalKey===key)
  const events=stored.map(item=>({id:item.externalId,type:item.type,externalId:item.externalId,occurredAt:iso(item.occurredAt),receivedAt:iso(item.ingestedAt),propertyExternalKey:item.propertyExternalKey||'',payload:item.payload}))
  return summarizeCredEvents(events.sort((left,right)=>String(right.occurredAt).localeCompare(String(left.occurredAt))).slice(0,size),{clientExternalKey:key})
}
