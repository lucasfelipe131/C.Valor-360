import test from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_TENANT_ID,infrastructureTimeoutDefaults,resolveInfrastructureTimeouts,validateDefaultTenantId} from '../server/config.js'

test('piloto bloqueia tenant customizado que a migração não provisiona',()=>{
  assert.equal(validateDefaultTenantId(undefined),DEFAULT_TENANT_ID)
  assert.equal(validateDefaultTenantId(DEFAULT_TENANT_ID.toUpperCase()),DEFAULT_TENANT_ID)
  assert.throws(()=>validateDefaultTenantId('11111111-1111-4111-8111-111111111111'),/não é provisionado/)
})

test('timeouts de infraestrutura têm defaults finitos, bounds e cabem no budget do core',()=>{
  assert.deepEqual(resolveInfrastructureTimeouts({}),infrastructureTimeoutDefaults)
  assert.deepEqual(resolveInfrastructureTimeouts({
    VAL_DATABASE_QUERY_TIMEOUT_MS:'1',
    VAL_TOOL_REQUEST_TIMEOUT_MS:'999999',
    VAL_CORE_REQUEST_TIMEOUT_MS:'500',
    VAL_CONVERSATIONAL_MODEL_TIMEOUT_MS:'999999',
    VAL_CHAT_REQUEST_TIMEOUT_MS:'999999'
  }),{
    databaseQueryTimeoutMs:250,
    toolRequestTimeoutMs:1_000,
    coreRequestTimeoutMs:1_000,
    conversationalModelTimeoutMs:1_000,
    valChatRequestTimeoutMs:30_000
  })
  assert.deepEqual(resolveInfrastructureTimeouts({
    VAL_DATABASE_QUERY_TIMEOUT_MS:'inválido',
    VAL_TOOL_REQUEST_TIMEOUT_MS:'inválido',
    VAL_CORE_REQUEST_TIMEOUT_MS:'inválido',
    VAL_CONVERSATIONAL_MODEL_TIMEOUT_MS:'inválido',
    VAL_CHAT_REQUEST_TIMEOUT_MS:'inválido'
  }),infrastructureTimeoutDefaults)
  assert.deepEqual(resolveInfrastructureTimeouts({VAL_DB_QUERY_TIMEOUT_MS:'1200',VAL_TOOL_CORE_REQUEST_TIMEOUT_MS:'6000'}),{
    databaseQueryTimeoutMs:1_200,
    toolRequestTimeoutMs:6_000,
    coreRequestTimeoutMs:6_000,
    conversationalModelTimeoutMs:6_000,
    valChatRequestTimeoutMs:28_000
  })
  assert.equal(resolveInfrastructureTimeouts({VAL_CORE_REQUEST_TIMEOUT_MS:'30000',VAL_CHAT_REQUEST_TIMEOUT_MS:'20000'}).valChatRequestTimeoutMs,30_000)
})
