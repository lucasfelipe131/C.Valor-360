import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {assertRequestEnvelope,assertResponseEnvelope,ContractValidationError,createRequestEnvelope,createResponseEnvelope,requestEnvelopeVersion,responseEnvelopeVersion} from '../server/core/contracts.js'

const requestId='00000000-0000-4000-8000-000000000201'
const tenantId='00000000-0000-4000-8000-000000000001'

const validRequest=()=>createRequestEnvelope({
  request_id:requestId,
  organization_id:tenantId,
  actor:{id:'00000000-0000-4000-8000-000000000111',role:'consultant'},
  subject:{type:'client',id:'cliente-1'},
  objective:'prepare_visit',
  context_refs:[{type:'client',id:'cliente-1'}],
  policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:'00000000-0000-4000-8000-000000000111'}
})

test('RequestEnvelope v1 exige identidade, tenant, objetivo, referências e policy context',()=>{
  const request=validRequest()
  assert.equal(request.contract_version,requestEnvelopeVersion)
  assert.equal(assertRequestEnvelope(request),request)
  assert.throws(()=>assertRequestEnvelope({...request,contract_version:'val.request.v0'}),error=>error instanceof ContractValidationError&&error.violations.includes('contract_version'))
  assert.throws(()=>assertRequestEnvelope({...request,organization_id:''}),error=>error.violations.includes('organization_id'))
  assert.throws(()=>assertRequestEnvelope({...request,field_not_in_v1:true}),error=>error.violations.includes('request.field_not_in_v1'))
})

test('ResponseEnvelope v1 exige request_id, confiança, próximos passos e auditoria',()=>{
  const response=createResponseEnvelope({
    request_id:requestId,
    organization_id:tenantId,
    status:'completed',
    recommendation:{recommendationId:'r-1'},
    evidence_refs:[{id:'ev-1',type:'business_event'}],
    assumptions:['Confirmar a data da visita.'],
    confidence:'HIPÓTESE',
    next_actions:[{description:'Confirmar a agenda com o produtor.'}],
    audit:{contract_version:'val.core.audit.v1',request_id:requestId,organization_id:tenantId,actor_ref:'0123456789abcdef',route_id:'prepare_visit.v1',objective:'prepare_visit',planned_modules:['MCTX'],module_runs:[{module_id:'LEGACY_VAL_ENGINE',status:'completed',required:true,duration_ms:3}],policy_decision:{allowed:true,policy_version:'val.core.policy.v1',scope:'own_portfolio'},started_at:'2026-08-20T12:00:00.000Z',completed_at:'2026-08-20T12:00:00.003Z'}
  })
  assert.equal(response.contract_version,responseEnvelopeVersion)
  assert.equal(assertResponseEnvelope(response),response)
  assert.throws(()=>assertResponseEnvelope({...response,confidence:'alta'}),error=>error.violations.includes('confidence'))
  assert.throws(()=>assertResponseEnvelope({...response,audit:{...response.audit,actor_id:'segredo'}}),error=>error.violations.includes('audit.actor_id'))
})

test('JSON Schemas publicados permanecem alinhados às versões do runtime',()=>{
  const requestSchema=JSON.parse(readFileSync(new URL('../contracts/v1/request-envelope.schema.json',import.meta.url),'utf8'))
  const responseSchema=JSON.parse(readFileSync(new URL('../contracts/v1/response-envelope.schema.json',import.meta.url),'utf8'))
  assert.equal(requestSchema.properties.contract_version.const,requestEnvelopeVersion)
  assert.equal(responseSchema.properties.contract_version.const,responseEnvelopeVersion)
  for(const field of ['request_id','organization_id','actor','subject','objective','context_refs','policy_context'])assert.ok(requestSchema.required.includes(field))
  for(const field of ['status','recommendation','evidence_refs','assumptions','confidence','next_actions','audit'])assert.ok(responseSchema.required.includes(field))
  assert.equal(requestSchema.additionalProperties,false)
  assert.equal(responseSchema.additionalProperties,false)
})
