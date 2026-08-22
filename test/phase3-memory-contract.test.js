import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {canonicalMemoryRecord,isMemoryAuthorized,memoryContractVersion,memoryDomains,memoryStates} from '../server/memory/contracts.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'

test('MemoryRecord v1 mantém legado sem classificação epistemológica automática',()=>{
  const fact=canonicalMemoryRecord({id:'memory-1',tenant_id:tenantA,client_id:'client-1',memory_type:'fact',key:'planted_area_ha',value:500,status:'verified',source:'consultant_input',confidence:80,created_at:'2026-08-01T12:00:00.000Z'})
  const unverified=canonicalMemoryRecord({id:'memory-2',tenant_id:tenantA,client_id:'client-1',memory_type:'fact',key:'soil_note',value:'Argiloso',status:'proposed',source:'consultant_input'})
  const explicit=canonicalMemoryRecord({id:'memory-3',tenant_id:tenantA,client_id:'client-1',memory_type:'fact',memory_state:'FACT',memory_domain:'AGRONOMIC',key:'soil_note',value:'Argiloso',status:'verified',source:'consultant_input'})
  assert.equal(fact.contract_version,memoryContractVersion)
  assert.equal(fact.memory_state,'HYPOTHESIS')
  assert.equal(fact.memory_type,'PRODUCER')
  assert.equal(fact.status,'ACTIVE')
  assert.equal(fact.source_ref,'val_memories:memory-1')
  assert.equal(unverified.memory_state,'HYPOTHESIS')
  assert.equal(explicit.memory_state,'FACT')
  assert.equal(explicit.memory_type,'AGRONOMIC')
  assert.notEqual(unverified.memory_state,'VALIDATED_KNOWLEDGE')
  assert.deepEqual(memoryStates,['FACT','INFERENCE','HYPOTHESIS','VALIDATED_KNOWLEDGE'])
  assert.deepEqual(memoryDomains,['PRODUCER','COMMERCIAL','AGRONOMIC','BEHAVIORAL','RELATIONSHIP','ORGANIZATIONAL','STRATEGIC'])
})

test('ACL e tenant são avaliados antes de qualquer memória ser selecionada',()=>{
  const record=canonicalMemoryRecord({id:'memory-1',tenant_id:tenantA,client_id:'client-1',memory_type:'fact',key:'area',value:500,status:'verified',acl:{scope:'own_portfolio',roles:['consultant'],actor_ids:['actor-1']}})
  assert.equal(isMemoryAuthorized(record,{organizationId:tenantA,subjectType:'client',subjectId:'client-1',actorId:'actor-1',role:'consultant',scope:'own_portfolio'}),true)
  assert.equal(isMemoryAuthorized(record,{organizationId:tenantB,subjectType:'client',subjectId:'client-1',actorId:'actor-1',role:'consultant',scope:'own_portfolio'}),false)
  assert.equal(isMemoryAuthorized(record,{organizationId:tenantA,subjectType:'client',subjectId:'client-2',actorId:'actor-1',role:'consultant',scope:'own_portfolio'}),false)
  assert.equal(isMemoryAuthorized(record,{organizationId:tenantA,subjectType:'client',subjectId:'client-1',actorId:'actor-2',role:'consultant',scope:'own_portfolio'}),false)
  assert.equal(isMemoryAuthorized(record,{organizationId:tenantA,subjectType:'client',subjectId:'client-1',actorId:'actor-1',role:'manager',scope:'own_portfolio'}),false)
})

test('schema publicado usa enums estáveis e exige rastreabilidade material',()=>{
  const schema=JSON.parse(readFileSync(new URL('../contracts/v1/memory-record.schema.json',import.meta.url),'utf8'))
  assert.equal(schema.properties.contract_version.const,memoryContractVersion)
  assert.deepEqual(schema.properties.memory_state.enum,memoryStates)
  assert.deepEqual(schema.properties.memory_type.enum,memoryDomains)
  for(const field of ['memory_id','organization_id','subject_type','subject_id','memory_type','memory_state','content','source_ref','source_type','observed_at','source_updated_at','freshness_policy_version','freshness_metadata','confidence','status','valid_from','valid_until','supersedes_id','created_by','evidence_refs','acl'])assert.ok(schema.required.includes(field),field)
  assert.equal(schema.additionalProperties,false)
})
