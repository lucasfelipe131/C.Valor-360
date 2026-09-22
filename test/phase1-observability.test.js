import assert from 'node:assert/strict'
import test from 'node:test'
import {createDatabase} from '../server/db.js'
import {currentRequestContext,databaseOperation,normalizeRequestId,observe,routeShape,runWithRequestContext,updateRequestContext} from '../server/observability.js'

const requestId='00000000-0000-4000-8000-000000000777'

test('request_id atravessa tarefas assíncronas e dados de identidade são pseudonimizados',async()=>{
  const logs=[]
  await runWithRequestContext({requestId,method:'POST',path:'/api/val/chat',tenantId:'tenant-secreto'},async()=>{
    updateRequestContext({actorId:'usuario@example.com'})
    await Promise.resolve()
    assert.equal(currentRequestContext().requestId,requestId)
    assert.equal(observe('val.answer.completed',{mode:'daily',engineMode:'rules',prompt:'não pode vazar'}),true)
  },{logger:value=>logs.push(value)})
  assert.equal(logs.length,1)
  const event=JSON.parse(logs[0])
  assert.equal(event.request_id,requestId)
  assert.equal(event.stage,'val.answer.completed')
  assert.equal(event.mode,'daily')
  assert.ok(event.tenant_ref)
  assert.ok(event.actor_ref)
  assert.doesNotMatch(logs[0],/tenant-secreto|usuario@example\.com|não pode vazar/)
})

test('ids externos inválidos são substituídos e SQL vira apenas operação segura',()=>{
  assert.notEqual(normalizeRequestId('id-controlado-pelo-cliente'),'id-controlado-pelo-cliente')
  assert.equal(databaseOperation('  SELECT * FROM clients'),'SELECT')
  assert.equal(databaseOperation('INSERT INTO clients VALUES ($1)'),'INSERT')
  assert.equal(routeShape('/api/clients/produtor-confidencial/overview'),'/api/clients/:id/overview')
  assert.equal(routeShape('/api/surveys/token-secreto'),'/api/surveys/:id')
})

test('falha do logger não altera o fluxo da aplicação',()=>{
  const result=runWithRequestContext({requestId},()=>observe('api.received'),{logger:()=>{throw new Error('logger indisponível')}})
  assert.equal(result,false)
})

test('o mesmo request_id liga API, ValEngine, banco e integração',async()=>{
  const logs=[]
  class FakePool{
    async query(){return {rowCount:1,rows:[{ok:true}]}}
    async end(){}
  }
  const database=createDatabase({databaseUrl:'postgres://controlado',databaseSsl:false},{PoolClass:FakePool})
  await runWithRequestContext({requestId,method:'POST',path:'/api/val/chat',tenantId:'tenant-a'},async()=>{
    observe('api.received')
    observe('val.answer.started',{mode:'daily'})
    await database.query('SELECT 1')
    observe('integration.sent',{source:'manual-do-agronomo'})
    observe('api.completed',{status:200})
  },{logger:value=>logs.push(JSON.parse(value))})
  await database.close()
  assert.deepEqual(logs.map(item=>item.stage),['api.received','val.answer.started','db.query','integration.sent','api.completed'])
  assert.ok(logs.every(item=>item.request_id===requestId))
  assert.equal(logs[2].operation,'SELECT')
})

// O motivo do encerramento da voz precisa atravessar o filtro de detalhes: sem isso, a correção
// no browser e no serviço morre na última fronteira e o log volta a ser só custo zero.
test('o encerramento da voz chega ao log com motivo, status e detalhe do transporte',()=>{
  const logs=[]
  runWithRequestContext({requestId,method:'POST',path:'/api/v1/realtime-voice/sessions/abc/usage',tenantId:'tenant-a'},()=>{
    observe('val.realtime_voice',{outcome:'val.realtime_voice.usage_recorded',sessionId:'sess-a',costUsd:0,disconnectReason:'WEBRTC_SDP_EXCHANGE_FAILED',transportDetail:'TypeError: Failed to fetch',providerStatus:401,transcript:'o que o produtor falou'})
  },{logger:value=>logs.push(JSON.parse(value))})
  assert.equal(logs.length,1)
  assert.equal(logs[0].disconnectReason,'WEBRTC_SDP_EXCHANGE_FAILED')
  assert.equal(logs[0].transportDetail,'TypeError: Failed to fetch')
  assert.equal(logs[0].providerStatus,401)
  assert.equal(logs[0].path,'/api/v1/realtime-voice/sessions/:id/usage')
  assert.equal(logs[0].transcript,undefined)
})
