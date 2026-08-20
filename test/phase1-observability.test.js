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
