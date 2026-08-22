import assert from 'node:assert/strict'

export const phase1GateTenantA='00000000-0000-4000-8000-000000000001'
export const phase1GateUserA='00000000-0000-4000-8000-000000000101'
export const phase3EmptyFixtureKey='gate-client-empty-a'

export function assertPhase1TenantAClients(actualClientIds,{
  verifyOnly=false,
  allowPhase3EmptyFixture=false,
  fixtureRows=[]
}={}){
  const actual=[...actualClientIds].sort()
  const fixtureVisible=actual.includes(phase3EmptyFixtureKey)
  const expected=['gate-client-a']

  if(fixtureVisible){
    assert.equal(verifyOnly,true,'O fixture vazio da Fase 3 só é válido em verificação de restore.')
    assert.equal(allowPhase3EmptyFixture,true,'O fixture vazio da Fase 3 exige autorização explícita do cenário.')
    assert.equal(fixtureRows.length,1,'O fixture vazio da Fase 3 deve ser único no tenant controlado.')
    const fixture=fixtureRows[0]
    assert.equal(fixture.external_key,phase3EmptyFixtureKey)
    assert.equal(fixture.tenant_id,phase1GateTenantA)
    assert.equal(fixture.consultant_id,phase1GateUserA)
    assert.equal(fixture.name,'Produtor sintético sem histórico')
    assert.equal(fixture.status,'active')
    assert.equal(fixture.source,'phase3_gate')
    assert.equal(Number(fixture.material_rows),0,'O fixture autorizado deve permanecer sem histórico material.')
    expected.push(phase3EmptyFixtureKey)
  }

  assert.deepEqual(actual,expected.sort(),'O tenant A contém cliente sintético não autorizado pelo cenário do gate.')
  return expected
}
