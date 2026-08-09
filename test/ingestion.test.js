import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {deriveSignals,normalizeIntegrationEvent,requiresTechnicalSignature,verifyIntegrationToken,verifyWebhookSignature} from '../server/ingestion.js'

test('valida assinatura HMAC sem expor o segredo',()=>{
  const body=JSON.stringify({type:'ndvi.observation'});const secret='segredo-de-teste'
  const signature=`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`
  assert.equal(verifyWebhookSignature(body,signature,secret),true)
  assert.equal(verifyWebhookSignature(body,'sha256=00',secret),false)
  assert.equal(verifyIntegrationToken('token-seguro','token-seguro'),true)
  assert.equal(verifyIntegrationToken('outro','token-seguro'),false)
})

test('rejeita evento desconhecido e exige idempotência',()=>{
  assert.throws(()=>normalizeIntegrationEvent({type:'qualquer',externalId:'1234'}),/não suportado/)
  assert.throws(()=>normalizeIntegrationEvent({type:'business.closed'}),/externalId/)
  assert.throws(()=>normalizeIntegrationEvent({type:'business.closed',externalId:'1234',occurredAt:'ontem'}),/data válida/)
  assert.throws(()=>normalizeIntegrationEvent({type:'business.closed',externalId:'1234',schemaVersion:2}),/Versão/)
})

test('tipo técnico com espaços continua exigindo HMAC depois da normalização',()=>{
  const event=normalizeIntegrationEvent({type:'soil_analysis.completed ',externalId:'soil-hmac-001',payload:{}})
  assert.equal(event.type,'soil_analysis.completed')
  assert.equal(requiresTechnicalSignature(event.type),true)
})

test('registros e produtores do Manual entram como eventos autenticados sem fabricar sinal técnico',()=>{
  const record=normalizeIntegrationEvent({type:'manual.record.saved',externalId:'manual-record-001',clientExternalKey:'produtor-1',payload:{recordType:'season_report',title:'Safra 2025/26'}})
  const producer=normalizeIntegrationEvent({type:'manual.producer.updated',externalId:'manual-producer-001',clientExternalKey:'produtor-1',payload:{producer:{name:'Produtor 1',areaHa:120}}})
  assert.equal(requiresTechnicalSignature(record.type),true)
  assert.equal(requiresTechnicalSignature(producer.type),true)
  assert.deepEqual(deriveSignals(record),[])
  assert.deepEqual(deriveSignals(producer),[])
})

test('IDs externos e origem respeitam os limites do schema PostgreSQL',()=>{
  const event=normalizeIntegrationEvent({
    type:'business.closed',externalId:`event-${'x'.repeat(300)}`,source:`source-${'y'.repeat(100)}`,
    clientExternalKey:`client-${'z'.repeat(300)}`
  })
  assert.equal(event.externalId.length,180)
  assert.equal(event.source.length,80)
  assert.equal(event.clientExternalKey.length,180)
})

test('NDVI gera vistoria, não diagnóstico',()=>{
  const event=normalizeIntegrationEvent({type:'ndvi.observation',externalId:'ndvi-001',clientExternalKey:'cliente-1',payload:{anomaly:true,changePercent:-14,mapId:'map-1'}})
  const signals=deriveSignals(event)
  assert.equal(signals.length,1)
  assert.equal(signals[0].type,'ndvi_anomaly')
  assert.equal(signals[0].requiresAgronomist,true)
  assert.match(signals[0].commercialHypothesis,/vistoria/i)
})

test('solo só gera sinal a partir de flags validadas',()=>{
  const empty=normalizeIntegrationEvent({type:'soil_analysis.completed',externalId:'soil-001',payload:{p:2}})
  assert.deepEqual(deriveSignals(empty),[])
  const unproved=normalizeIntegrationEvent({type:'soil_analysis.completed',externalId:'soil-002',payload:{validatedFlags:['Fósforo baixo']}})
  assert.deepEqual(deriveSignals(unproved),[])
  const reviewed=normalizeIntegrationEvent({type:'soil_analysis.completed',externalId:'soil-003',payload:{validatedFlags:['Fósforo abaixo da faixa interpretada pelo responsável técnico'],validation:{status:'approved',reviewerExternalId:'agronomo-1',reviewedAt:'2026-08-08T12:00:00-03:00'}}})
  assert.equal(deriveSignals(reviewed).length,1)
})

test('rejeita datas, profundidades e percentuais fisicamente inválidos',()=>{
  assert.throws(()=>normalizeIntegrationEvent({type:'ndvi.observation',externalId:'ndvi-x',payload:{observedAt:'ontem'}}),/data válida/)
  assert.throws(()=>normalizeIntegrationEvent({type:'ndvi.observation',externalId:'ndvi-y',payload:{cloudPercent:120}}),/entre 0 e 100/)
  assert.throws(()=>normalizeIntegrationEvent({type:'soil_analysis.completed',externalId:'soil-x',payload:{depthFromCm:30,depthToCm:10}}),/maior/)
  assert.throws(()=>normalizeIntegrationEvent({type:'field_report.completed',externalId:'field-x',payload:{findings:[{confidence:140}]}}),/entre 0 e 100/)
})
