import {AsyncLocalStorage} from 'node:async_hooks'
import {createHash,randomUUID} from 'node:crypto'

const requestContext=new AsyncLocalStorage()
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedDetailKeys=new Set(['durationMs','rowCount','status','method','path','source','eventType','mode','operation','outcome','errorCode','engineMode','attachmentCount','routeId','moduleId','contractVersion','required','contextSnapshotId','memoryRefsConsidered','memoryRefsSelected','memoryRefsExcluded','exclusionReasonCounts','confidence','selectionPolicy','behaviorProfileVersion','decisionThesisId','decisionThesisVersion','valuePlanId','valuePlanVersion','actionPlanId','actionPlanVersion','insightIds','commitmentIds','visitId','visitReportId','interactionId','transcriptId','outcomeIds','learningCandidateIds','confirmationStatus','modulesCalled','scenarioFixture'])
const staticPathSegments=new Set(['api','v1','live','health','val','core','status','auth','session','login','logout','password','admin','metrics','portfolio-admin','users','reset-password','usage','events','grains','bootstrap','profiles','intents','market','technical','attachments','progress','chat','recommendations','feedback','intelligence','insights','imports','import','google-sheet','visits','preparation','report','confirm','learning-context','outcomes','action-plans','commitments','opportunities','surveys','invitations','clients','context','overview','from-survey','integrations','manual','tecnico'])

const reference=value=>value?createHash('sha256').update(String(value)).digest('hex').slice(0,16):undefined
const limited=value=>typeof value==='string'?value.slice(0,180):typeof value==='number'&&Number.isFinite(value)?value:typeof value==='boolean'?value:undefined

export function routeShape(value){
  const path=String(value||'').split('?',1)[0]
  if(!path)return ''
  return path.split('/').map((segment,index)=>!segment||staticPathSegments.has(segment)||index===0?segment:':id').join('/').slice(0,240)
}

export function normalizeRequestId(value){
  const candidate=String(value||'').trim()
  return uuidPattern.test(candidate)?candidate.toLowerCase():randomUUID()
}

export function requestIdFrom(request){
  return normalizeRequestId(request?.headers?.['x-request-id']||request?.headers?.['x-correlation-id'])
}

export function runWithRequestContext(input,work,{logger=console.info}={}){
  const context={
    requestId:normalizeRequestId(input?.requestId),
    method:String(input?.method||'').slice(0,12),
    path:routeShape(input?.path),
    tenantId:String(input?.tenantId||''),
    actorId:String(input?.actorId||''),
    startedAt:Date.now(),
    logger
  }
  return requestContext.run(context,work)
}

export function currentRequestContext(){
  const context=requestContext.getStore()
  if(!context)return null
  return {requestId:context.requestId,method:context.method,path:context.path,tenantId:context.tenantId,actorId:context.actorId,startedAt:context.startedAt}
}

export function updateRequestContext(input={}){
  const context=requestContext.getStore()
  if(!context)return null
  if(input.tenantId!==undefined)context.tenantId=String(input.tenantId||'')
  if(input.actorId!==undefined)context.actorId=String(input.actorId||'')
  return currentRequestContext()
}

export function observe(stage,details={}){
  const context=requestContext.getStore()
  if(!context)return false
  const safeDetails={}
  for(const [key,value] of Object.entries(details||{})){
    if(!allowedDetailKeys.has(key))continue
    const safe=key==='path'?routeShape(value):limited(value)
    if(safe!==undefined)safeDetails[key]=safe
  }
  const event={
    timestamp:new Date().toISOString(),
    level:String(details?.status||'').startsWith('5')||details?.outcome==='error'?'error':'info',
    service:'valor360',
    stage:String(stage||'unknown').slice(0,100),
    request_id:context.requestId,
    method:context.method||undefined,
    path:context.path||undefined,
    tenant_ref:reference(context.tenantId),
    actor_ref:reference(context.actorId),
    ...safeDetails
  }
  try{context.logger(JSON.stringify(event));return true}catch{return false}
}

export function databaseOperation(sql){
  return String(sql||'').trim().match(/^(?:\/\*[\s\S]*?\*\/\s*)*([a-z]+)/i)?.[1]?.toUpperCase()||'UNKNOWN'
}
