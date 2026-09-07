// Road estimates use registered portfolio pins. GPS is stored only after an
// explicit tracking request; order, trace and audit writes share a transaction.
import {createHash} from 'node:crypto'
import {visitLifecycle,visitMoment} from '../src/lib/home-command-center.js'

const MAX_ROUTE_POINTS=15
const MAX_TRACE_POINTS=2000
const MAX_TRACE_BATCH=250
const MAX_ORDERED_VISITS=100
const DEFAULT_TIME_ZONE='America/Sao_Paulo'
const providerGates=new Map()
const fail=(message,statusCode=400,code='visit_route_invalid')=>{throw Object.assign(new Error(message),{statusCode,code,exposeMessage:true})}
const unavailable=reason=>({available:false,geometry:[],distanceMeters:null,durationSeconds:null,legs:[],source:'osrm',estimated:true,reason})
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const finite=value=>typeof value==='number'&&Number.isFinite(value)
const id=value=>typeof value==='string'&&value.trim()&&value.length<=180?value.trim():null

function coordinate(value){
  if(!plain(value))return null
  const lat=value.lat??value.latitude;const lng=value.lng??value.longitude
  return finite(lat)&&finite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null
}

function timezone(value=DEFAULT_TIME_ZONE){
  if(typeof value!=='string'||value.length>80)fail('O fuso horário da rota é inválido.')
  try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();return value}catch{fail('O fuso horário da rota é inválido.')}
}

function dayAt(value,timeZone){
  const date=new Date(value)
  if(!Number.isFinite(date.getTime()))return null
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const part=type=>parts.find(item=>item.type===type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function routeDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Informe a data da rota no formato AAAA-MM-DD.')
  const date=new Date(`${value}T12:00:00.000Z`)
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)fail('A data da rota é inválida.')
  return value
}

function identifiers(value,max,label,{unique=true}={}){
  if(!Array.isArray(value)||value.length>max)fail(`${label}: informe uma lista com até ${max} itens.`)
  const ids=value.map(item=>id(item))
  if(ids.some(item=>!item)||(unique&&new Set(ids).size!==ids.length))fail(`${label}: há identificadores inválidos ou repetidos.`)
  return ids
}

function eligibleVisitOnDay(visit,date,timeZone){
  const lifecycle=visitLifecycle(visit)
  if(lifecycle==='CANCELLED')return false
  const at=visitMoment({...visit,scheduledAt:visit.scheduledAt||visit.scheduled_at})
  if(!at)return false
  const scheduledDay=dayAt(at,timeZone)
  return scheduledDay===date||(scheduledDay<date&&['IN_PROGRESS','COMPLETED_PENDING_REVIEW'].includes(lifecycle))
}

function scope(repository,ownerId){
  if(!id(ownerId)||!id(repository?.tenantId))fail('O proprietário e a organização da carteira são obrigatórios.',403,'visit_route_scope_required')
  return {tenantId:repository.tenantId,ownerId}
}

function requireDatabase(repository){
  if(!repository.db?.configured||typeof repository.db.query!=='function'||typeof repository.db.transaction!=='function')fail('Não foi possível salvar ou recuperar a rota: PostgreSQL indisponível.',503,'visit_route_storage_unavailable')
}

function dayRecord(row,date,timeZone){
  return {
    date,orderedVisitIds:row?.ordered_visit_ids||[],trace:row?.trace||[],tracking:row?.tracking===true,
    timeZone:row?.time_zone||timeZone,updatedAt:row?.updated_at?new Date(row.updated_at).toISOString():null,
    trackingStartedAt:row?.tracking_started_at?new Date(row.tracking_started_at).toISOString():null
  }
}

function validMetrics(value){return plain(value)&&finite(value.distance)&&value.distance>=0&&finite(value.duration)&&value.duration>=0}

async function responseJson(response){
  const maxBytes=4*1024*1024
  if(Number(response.headers?.get('content-length'))>maxBytes)throw new Error('provider_response_too_large')
  const reader=response.body?.getReader?.()
  if(!reader)return response.json()
  let bytes=0;const chunks=[]
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new Error('provider_response_too_large');chunks.push(value)}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** No caller supplied destination coordinates or provider URL cross this boundary. */
export function createVisitRouteService({repository,fetchImpl=globalThis.fetch,routingUrl=process.env.VAL_ROUTING_URL||'https://router.project-osrm.org',clock=()=>Date.now(),minProviderIntervalMs=1000,timeoutMs=8000}={}){
  const cache=new Map();const inflight=new Map();const userRates=new Map()
  const now=()=>Number(new Date(clock()))
  const providerTimeout=Math.min(8000,Math.max(1,Number(timeoutMs)||8000))
  let baseUrl
  try{
    const parsed=new URL(routingUrl)
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error()
    baseUrl=parsed.href.replace(/\/$/,'')
  }catch{baseUrl=null}

  async function portfolio(ownerId){
    scope(repository,ownerId)
    const data=await repository.getIntelligence(ownerId)
    return {clients:Array.isArray(data?.clients)?data.clients:[],visits:Array.isArray(data?.visits)?data.visits:[]}
  }

  async function providerRoute(points){
    const controller=new AbortController();let timer
    try{
      const task=(async()=>{
        const coordinates=points.map(point=>`${point.lng},${point.lat}`).join(';')
        const response=await fetchImpl(`${baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=false`,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}})
        if(!response.ok)return unavailable(response.status===429?'provider_rate_limited':'provider_unavailable')
        const payload=await responseJson(response)
        if(payload?.code!=='Ok')return unavailable(payload?.code==='NoRoute'||payload?.code==='NoSegment'?'no_road_route':'provider_unavailable')
        const route=payload.routes?.[0];const geometry=route?.geometry
        if(!validMetrics(route)||geometry?.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||geometry.coordinates.length>50000||!geometry.coordinates.every(point=>Array.isArray(point)&&point.length>=2&&coordinate({lat:point[1],lng:point[0]}))||!Array.isArray(route.legs)||route.legs.length!==points.length-1||!route.legs.every(validMetrics))return unavailable('invalid_provider_route')
        return {available:true,geometry:geometry.coordinates.map(([lng,lat])=>[lat,lng]),distanceMeters:route.distance,durationSeconds:route.duration,legs:route.legs.map(leg=>({distanceMeters:leg.distance,durationSeconds:leg.duration})),source:'osrm',estimated:true}
      })()
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable('provider_timeout'))},providerTimeout)})
      return await Promise.race([task,deadline])
    }catch(error){return unavailable(error?.name==='AbortError'?'provider_timeout':'provider_unavailable')}
    finally{clearTimeout(timer)}
  }

  async function driving({ownerId,input={}}={}){
    const {tenantId}=scope(repository,ownerId)
    if(!plain(input))fail('A solicitação de rota é inválida.')
    const clientIds=identifiers(input.clientIds,MAX_ROUTE_POINTS,'Produtores da rota',{unique:false})
    if(input.candidateClientId!==undefined){
      const candidate=id(input.candidateClientId)
      if(!candidate||clientIds.includes(candidate))fail('O produtor adicional é inválido ou já está na rota.')
      const insertion=input.insertionIndex??clientIds.length
      if(!Number.isInteger(insertion)||insertion<0||insertion>clientIds.length)fail('A posição do produtor adicional é inválida.')
      clientIds.splice(insertion,0,candidate)
    }
    const origin=input.origin===undefined?null:coordinate(input.origin)
    if(input.origin!==undefined&&!origin)fail('A posição GPS inicial é inválida.')
    const count=clientIds.length+(origin?1:0)
    if(count<2||count>MAX_ROUTE_POINTS)fail(`O cálculo requer de 2 a ${MAX_ROUTE_POINTS} pontos, incluindo a posição GPS.`)
    const data=await portfolio(ownerId);const clients=new Map(data.clients.map(client=>[String(client.id),client]))
    const destinations=clientIds.map(clientId=>{
      const client=clients.get(clientId)
      if(!client)fail('Produtor não encontrado na sua carteira.',404,'visit_route_client_not_found')
      return coordinate(client.location)
    })
    if(destinations.some(point=>!point))return unavailable('missing_registered_location')
    if(!baseUrl||typeof fetchImpl!=='function')return unavailable('provider_not_configured')
    const points=origin?[origin,...destinations]:destinations
    const key=createHash('sha256').update(JSON.stringify([tenantId,ownerId,baseUrl,points])).digest('hex')
    const cached=cache.get(key);const timestamp=now()
    if(cached&&cached.expiresAt>timestamp)return structuredClone(cached.result)
    if(inflight.has(key))return structuredClone(await inflight.get(key))
    for(const [cacheKey,entry] of cache)if(entry.expiresAt<=timestamp)cache.delete(cacheKey)
    for(const [userKey,times] of userRates)if(!times.some(time=>timestamp-time<60000))userRates.delete(userKey)
    const userKey=`${tenantId}:${ownerId}`;const recent=(userRates.get(userKey)||[]).filter(time=>timestamp-time<60000)
    if(recent.length>=20)return unavailable('route_rate_limited')
    const lastProviderRequest=providerGates.get(baseUrl)
    if(lastProviderRequest!==undefined&&timestamp-lastProviderRequest<minProviderIntervalMs)return unavailable('route_rate_limited')
    if(userRates.size>=500&&!userRates.has(userKey))return unavailable('route_rate_limited')
    providerGates.set(baseUrl,timestamp);userRates.set(userKey,[...recent,timestamp])
    const task=providerRoute(points)
    inflight.set(key,task)
    try{
      const result=await task
      if(cache.size>=250)cache.delete(cache.keys().next().value)
      cache.set(key,{result,expiresAt:now()+(result.available?300000:15000)})
      return structuredClone(result)
    }finally{inflight.delete(key)}
  }

  async function getDay({ownerId,date,timeZone:requestedTimeZone}={}){
    const {tenantId}=scope(repository,ownerId);date=routeDate(date);const timeZone=timezone(requestedTimeZone)
    requireDatabase(repository)
    try{
      const result=await repository.db.query('SELECT ordered_visit_ids,trace,tracking,time_zone,tracking_started_at,updated_at FROM val_visit_routes WHERE tenant_id=$1 AND owner_id=$2 AND route_date=$3',[tenantId,ownerId,date])
      const day=dayRecord(result.rows[0],date,timeZone)
      if(day.orderedVisitIds.length){
        const data=await portfolio(ownerId)
        const authorizedClients=new Set(data.clients.map(client=>String(client.id)))
        const permitted=new Set(data.visits.filter(visit=>authorizedClients.has(String(visit.clientId))&&eligibleVisitOnDay(visit,date,day.timeZone)).map(visit=>String(visit.id)))
        day.orderedVisitIds=day.orderedVisitIds.filter(visitId=>permitted.has(visitId))
      }
      return day
    }catch(error){if(error.statusCode)throw error;fail('A rota do dia não pôde ser recuperada.',503,'visit_route_storage_unavailable')}
  }

  async function saveDay({ownerId,date,input={}}={}){
    const {tenantId}=scope(repository,ownerId);date=routeDate(date)
    if(!plain(input))fail('Os dados da rota são inválidos.')
    const requestedTimeZone=input.timeZone===undefined?undefined:timezone(input.timeZone)
    if(input.tracking!==undefined&&typeof input.tracking!=='boolean')fail('O estado de gravação GPS é inválido.')
    const order=input.orderedVisitIds===undefined?undefined:identifiers(input.orderedVisitIds,MAX_ORDERED_VISITS,'Visitas ordenadas')
    const suppliedPoints=input.tracePoints??[]
    if(!Array.isArray(suppliedPoints)||suppliedPoints.length>MAX_TRACE_BATCH)fail(`Envie até ${MAX_TRACE_BATCH} pontos GPS por solicitação.`)
    const timestamp=now()
    const points=suppliedPoints.map(point=>{
      const location=coordinate(point)
      const captured=typeof point?.timestamp==='number'||typeof point?.timestamp==='string'?new Date(point.timestamp).getTime():NaN
      if(!location||!Number.isFinite(captured)||captured>timestamp+120000)fail('O ponto GPS ou o horário de captura é inválido.')
      if(point.accuracy!==undefined&&(!finite(point.accuracy)||point.accuracy<0||point.accuracy>10000))fail('A precisão do ponto GPS é inválida.')
      return {...location,timestamp:new Date(captured).toISOString(),...(point.accuracy!==undefined?{accuracy:point.accuracy}:{})}
    })
    requireDatabase(repository)
    const data=order===undefined?null:await portfolio(ownerId)
    try{return await repository.db.transaction(async connection=>{
      // INSERT establishes a row lock even when two tabs create today's route.
      await connection.query(`INSERT INTO val_visit_routes (tenant_id,owner_id,route_date,time_zone) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,owner_id,route_date) DO NOTHING`,[tenantId,ownerId,date,requestedTimeZone||DEFAULT_TIME_ZONE])
      const selected=await connection.query('SELECT ordered_visit_ids,trace,tracking,time_zone,tracking_started_at,updated_at FROM val_visit_routes WHERE tenant_id=$1 AND owner_id=$2 AND route_date=$3 FOR UPDATE',[tenantId,ownerId,date])
      const current=selected.rows[0]
      if(!current)throw new Error('route_row_missing')
      const timeZone=requestedTimeZone||current.time_zone||DEFAULT_TIME_ZONE
      if(timeZone!==current.time_zone&&(current.trace?.length||current.tracking))fail('Mantenha o fuso horário usado ao iniciar a gravação GPS.',409,'visit_route_timezone_conflict')
      if(order!==undefined){
        const authorizedClients=new Set(data.clients.map(client=>String(client.id)))
        const visits=new Map(data.visits.map(visit=>[String(visit.id),visit]))
        for(const visitId of order){
          const visit=visits.get(visitId)
          if(!visit||!authorizedClients.has(String(visit.clientId)))fail('Visita não encontrada na sua carteira.',404,'visit_route_visit_not_found')
          if(!eligibleVisitOnDay(visit,date,timeZone))fail('A visita não está disponível na rota deste dia.',400,'visit_route_visit_date_mismatch')
        }
      }
      const started=input.tracking===true&&!current.tracking
      if((input.tracking===true||points.length)&&dayAt(timestamp,timeZone)!==date)fail('A gravação GPS só pode ser feita na rota de hoje.')
      if(points.length&&!current.tracking&&input.tracking!==true)fail('Inicie a gravação GPS antes de enviar pontos.',409,'visit_route_tracking_required')
      const tracking=input.tracking??current.tracking
      const trackingStartedAt=started?new Date(timestamp).toISOString():current.tracking_started_at
      const trace=new Map((current.trace||[]).map(point=>[point.timestamp,point]))
      for(const point of points){
        if(dayAt(point.timestamp,timeZone)!==date)fail('O ponto GPS pertence a outro dia.')
        const existing=trace.get(point.timestamp)
        if(existing){if(existing.lat!==point.lat||existing.lng!==point.lng)fail('O horário GPS já existe com outra posição.',409,'visit_route_trace_conflict');continue}
        if(!trackingStartedAt||new Date(point.timestamp).getTime()<new Date(trackingStartedAt).getTime()-30000)fail('O ponto GPS foi capturado antes do início da gravação.')
        trace.set(point.timestamp,point)
      }
      if(trace.size>MAX_TRACE_POINTS)fail(`A rota atingiu o limite de ${MAX_TRACE_POINTS} pontos GPS.`,409,'visit_route_trace_limit')
      const mergedTrace=[...trace.values()].sort((left,right)=>left.timestamp.localeCompare(right.timestamp))
      const updated=await connection.query(`UPDATE val_visit_routes SET ordered_visit_ids=$4::jsonb,trace=$5::jsonb,tracking=$6,time_zone=$7,tracking_started_at=$8,updated_at=NOW() WHERE tenant_id=$1 AND owner_id=$2 AND route_date=$3 RETURNING ordered_visit_ids,trace,tracking,time_zone,tracking_started_at,updated_at`,[tenantId,ownerId,date,JSON.stringify(order??current.ordered_visit_ids??[]),JSON.stringify(mergedTrace),tracking,timeZone,trackingStartedAt])
      // Audit counts and explicit tracking transitions, never raw coordinates.
      await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,after_data,created_at) VALUES ($1,$2,'visit_route_updated','visit_route',$3,$4::jsonb,NOW())`,[tenantId,ownerId,date,JSON.stringify({routeDate:date,orderedVisitCount:(order??current.ordered_visit_ids??[]).length,tracePointCount:mergedTrace.length,addedTracePointCount:mergedTrace.length-(current.trace?.length||0),tracking,trackingChanged:tracking!==current.tracking})])
      return dayRecord(updated.rows[0],date,timeZone)
    })}catch(error){if(error.statusCode)throw error;fail('A rota do dia não pôde ser salva.',503,'visit_route_storage_unavailable')}
  }

  return {driving,getDay,saveDay}
}
