import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPhase1TenantAClients,
  phase1GateTenantA,
  phase1GateUserA,
  phase3EmptyFixtureKey
} from '../scripts/lib/phase1-gate-fixtures.mjs'

const validFixture={
  external_key:phase3EmptyFixtureKey,
  tenant_id:phase1GateTenantA,
  consultant_id:phase1GateUserA,
  name:'Produtor sintético sem histórico',
  status:'active',
  source:'phase3_gate',
  material_rows:0
}

test('restore autoriza somente o fixture vazio exato e explicitamente habilitado da Fase 3',()=>{
  assert.deepEqual(assertPhase1TenantAClients(['gate-client-a',phase3EmptyFixtureKey],{
    verifyOnly:true,
    allowPhase3EmptyFixture:true,
    fixtureRows:[validFixture]
  }),['gate-client-a',phase3EmptyFixtureKey])
})

test('fixture vazio sem autorização explícita continua sendo detectado',()=>{
  assert.throws(()=>assertPhase1TenantAClients(['gate-client-a',phase3EmptyFixtureKey],{
    verifyOnly:true,
    allowPhase3EmptyFixture:false,
    fixtureRows:[validFixture]
  }),/exige autorização explícita/)
})

test('fixture com origem ou histórico material continua sendo detectado',()=>{
  assert.throws(()=>assertPhase1TenantAClients(['gate-client-a',phase3EmptyFixtureKey],{
    verifyOnly:true,
    allowPhase3EmptyFixture:true,
    fixtureRows:[{...validFixture,source:'unauthorized'}]
  }))
  assert.throws(()=>assertPhase1TenantAClients(['gate-client-a',phase3EmptyFixtureKey],{
    verifyOnly:true,
    allowPhase3EmptyFixture:true,
    fixtureRows:[{...validFixture,material_rows:1}]
  }),/sem histórico material/)
})

test('qualquer cliente vazio adicional continua quebrando o isolamento esperado',()=>{
  assert.throws(()=>assertPhase1TenantAClients(['gate-client-a','rogue-empty'],{
    verifyOnly:true,
    allowPhase3EmptyFixture:true,
    fixtureRows:[]
  }),/cliente sintético não autorizado/)
})
