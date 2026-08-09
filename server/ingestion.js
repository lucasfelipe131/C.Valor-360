import {createHash,createHmac,timingSafeEqual} from 'node:crypto'

export const supportedIntegrationEvents=new Set([
  'business.closed','business.lost','business.updated',
  'field_report.completed','soil_analysis.completed','ndvi.observation',
  'manual.record.saved','manual.producer.updated','manual.workspace.updated'
])
const signedTechnicalEvents=new Set(['field_report.completed','soil_analysis.completed','manual.record.saved','manual.producer.updated','manual.workspace.updated'])

const clean=value=>String(value??'').trim().slice(0,500)
const externalKey=value=>clean(value).slice(0,180)
const finite=value=>Number.isFinite(Number(value))?Number(value):null
const provided=value=>value!==undefined&&value!==null&&String(value).trim()!==''
const requireDate=(value,label)=>{if(provided(value)&&Number.isNaN(Date.parse(String(value))))throw new Error(`${label} precisa ser uma data válida.`)}
const requireRange=(value,label,min,max)=>{if(!provided(value))return;const number=Number(value);if(!Number.isFinite(number)||number<min||number>max)throw new Error(`${label} precisa estar entre ${min} e ${max}.`)}

export function verifyWebhookSignature(rawBody,signature,secret){
  if(!secret||!signature)return false
  const received=String(signature).replace(/^sha256=/,'')
  const expected=createHmac('sha256',secret).update(rawBody).digest('hex')
  const left=Buffer.from(received);const right=Buffer.from(expected)
  return left.length===right.length&&timingSafeEqual(left,right)
}

export function verifyIntegrationToken(received,expected){
  if(!received||!expected)return false
  const left=Buffer.from(String(received));const right=Buffer.from(String(expected))
  return left.length===right.length&&timingSafeEqual(left,right)
}

export function requiresTechnicalSignature(type){
  return signedTechnicalEvents.has(clean(type))
}

function compact(value,depth=0){
  if(depth>7)return null
  if(Array.isArray(value))return value.slice(0,100).map(item=>compact(item,depth+1))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([key,item])=>[clean(key).slice(0,80),compact(item,depth+1)]))
  if(typeof value==='string')return value.slice(0,10_000)
  if(typeof value==='number'||typeof value==='boolean'||value===null)return value
  return clean(value)
}

export function normalizeIntegrationEvent(input){
  const schemaVersion=Number(input?.schemaVersion??input?.schema_version??1)
  if(schemaVersion!==1)throw new Error('Versão de evento não suportada pela engine da VAL.')
  const type=clean(input?.type)
  if(!supportedIntegrationEvents.has(type))throw new Error('Tipo de evento não suportado pela engine da VAL.')
  const externalId=externalKey(input.externalId||input.external_id)
  if(externalId.length<4)throw new Error('externalId é obrigatório para impedir importações duplicadas.')
  const rawOccurredAt=clean(input.occurredAt||input.occurred_at)||new Date().toISOString()
  const timestamp=Date.parse(rawOccurredAt)
  if(Number.isNaN(timestamp))throw new Error('occurredAt precisa ser uma data válida.')
  const payload=compact(input.payload||{})
  requireDate(payload.observedAt,'payload.observedAt');requireDate(payload.sampledAt,'payload.sampledAt');requireDate(payload.validation?.reviewedAt,'payload.validation.reviewedAt')
  if(type==='ndvi.observation'){requireRange(payload.cloudPercent,'payload.cloudPercent',0,100);requireRange(payload.resolutionM,'payload.resolutionM',0.01,100_000)}
  if(type==='soil_analysis.completed'){
    requireRange(payload.depthFromCm,'payload.depthFromCm',0,10_000);requireRange(payload.depthToCm,'payload.depthToCm',0,10_000)
    if(provided(payload.depthFromCm)&&provided(payload.depthToCm)&&Number(payload.depthToCm)<=Number(payload.depthFromCm))throw new Error('payload.depthToCm precisa ser maior que depthFromCm.')
    for(const measurement of Array.isArray(payload.measurements)?payload.measurements:[])requireRange(measurement?.confidence,'measurement.confidence',0,100)
  }
  if(type==='field_report.completed')for(const finding of Array.isArray(payload.findings)?payload.findings:[])requireRange(finding?.confidence,'finding.confidence',0,100)
  return {
    externalId,
    schemaVersion,
    type,
    occurredAt:new Date(timestamp).toISOString(),
    source:clean(input.source).slice(0,80)||'manual-do-agronomo',
    clientExternalKey:externalKey(input.clientExternalKey||input.client_external_key),
    propertyExternalKey:externalKey(input.propertyExternalKey||input.property_external_key),
    fieldExternalKey:externalKey(input.fieldExternalKey||input.field_external_key),
    payload,
    payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  }
}

function signal(type,severity,title,evidence,commercialHypothesis,requiresAgronomist=true){
  return {type,severity,title,evidence,commercialHypothesis,requiresAgronomist,status:'new'}
}

export function hasTechnicalApproval(payload){
  const validation=payload?.validation||{}
  const reviewer=clean(validation.reviewerId||validation.reviewerExternalId||validation.reviewer)
  const reviewedAt=Date.parse(clean(validation.reviewedAt))
  return clean(validation.status).toLowerCase()==='approved'&&reviewer.length>=3&&!Number.isNaN(reviewedAt)&&reviewedAt<=Date.now()+300_000
}

export function deriveSignals(event){
  const payload=event.payload||{}
  if(event.type==='business.closed')return [signal('business_outcome','positive','Negócio fechado incorporado ao aprendizado',{value:finite(payload.value),category:clean(payload.category)},'Usar como evidência de conversão, sem assumir causalidade.',false)]
  if(event.type==='business.lost')return [signal('business_outcome','attention','Negócio perdido requer classificação do motivo',{reason:clean(payload.lossReason||payload.reason),category:clean(payload.category)},'Revisar valor percebido, timing, concorrência e risco antes da próxima abordagem.',false)]
  if(event.type==='field_report.completed'){
    const findings=Array.isArray(payload.findings)?payload.findings.slice(0,20):[]
    const actions=hasTechnicalApproval(payload)&&Array.isArray(payload.validatedActions)?payload.validatedActions.slice(0,20):[]
    if(!actions.length)return []
    return [signal('field_follow_up',clean(payload.severity)||'attention','Relatório de campo aprovado gerou acompanhamento',{findings,validatedActions:actions,reportId:clean(payload.reportId),validation:payload.validation},'Verificar relevância, janela e autonomia antes de converter uma ação validada em oportunidade ou compromisso.')]
  }
  if(event.type==='soil_analysis.completed'){
    const flags=hasTechnicalApproval(payload)&&Array.isArray(payload.validatedFlags)?payload.validatedFlags.slice(0,30):[]
    if(!flags.length)return []
    return [signal('soil_follow_up',clean(payload.severity)||'attention','Análise de solo possui pontos validados para revisão',{validatedFlags:flags,analysisId:clean(payload.analysisId),laboratory:clean(payload.laboratory)},'Preparar conversa de diagnóstico e quantificação; recomendação final depende do responsável técnico.')]
  }
  if(event.type==='ndvi.observation'){
    const anomaly=payload.anomaly===true||clean(payload.classification).toLowerCase()==='anomalia'
    if(!anomaly)return []
    return [signal('ndvi_anomaly',clean(payload.severity)||'attention','Anomalia de vigor detectada no talhão',{observedAt:clean(payload.observedAt),index:clean(payload.index||'NDVI'),changePercent:finite(payload.changePercent),mapId:clean(payload.mapId)},'Priorizar vistoria; imagem orbital é sinal de triagem, não diagnóstico nem prescrição.')]
  }
  return []
}
