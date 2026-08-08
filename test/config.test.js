import test from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_TENANT_ID,validateDefaultTenantId} from '../server/config.js'

test('piloto bloqueia tenant customizado que a migração não provisiona',()=>{
  assert.equal(validateDefaultTenantId(undefined),DEFAULT_TENANT_ID)
  assert.equal(validateDefaultTenantId(DEFAULT_TENANT_ID.toUpperCase()),DEFAULT_TENANT_ID)
  assert.throws(()=>validateDefaultTenantId('11111111-1111-4111-8111-111111111111'),/não é provisionado/)
})
