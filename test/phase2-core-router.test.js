import assert from 'node:assert/strict'
import test from 'node:test'
import {config} from '../server/config.js'
import {createRequestEnvelope} from '../server/core/contracts.js'
import {resolveCoreObjective,routeCoreRequest} from '../server/core/router.js'

const envelope=objective=>createRequestEnvelope({request_id:'00000000-0000-4000-8000-000000000203',organization_id:'00000000-0000-4000-8000-000000000001',actor:{id:'ator-1',role:'consultant'},subject:{type:'client',id:'cliente-1'},objective,context_refs:[],policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:'ator-1'}})

test('classificação determinística cobre visita, agronomia crítica e próxima ação',()=>{
  assert.equal(resolveCoreObjective({message:'Prepare o roteiro da próxima visita'}),'prepare_visit')
  assert.equal(resolveCoreObjective({message:'Qual dose devo prescrever para essa doença?'}),'agronomic_critical')
  assert.equal(resolveCoreObjective({message:'Analise o solo e o NDVI'}),'agronomic_question')
  assert.equal(resolveCoreObjective({message:'Qual é a próxima melhor ação?'}),'next_best_action')
  assert.equal(resolveCoreObjective({message:'Ajude a organizar esta conta'}),'general_assistance')
})

test('mesmo envelope sempre produz a mesma rota e ordem de módulos',()=>{
  const request=envelope('prepare_visit')
  assert.deepEqual(routeCoreRequest(request),routeCoreRequest(request))
  assert.deepEqual(routeCoreRequest(request).modules,['MCTX','MMI','MIC','MDI','MVV','MEX','VIS'])
  assert.deepEqual(routeCoreRequest(request).execution_plan,[{module_id:'LEGACY_VAL_ENGINE',required:true,timeout_ms:config.coreRequestTimeoutMs}])
  assert.ok(Number.isFinite(config.coreRequestTimeoutMs)&&config.coreRequestTimeoutMs>0)
})

test('rota agronômica crítica inclui MGO e revisão humana obrigatória',()=>{
  const route=routeCoreRequest(envelope('agronomic_critical'))
  assert.ok(route.modules.includes('MIA'))
  assert.ok(route.modules.includes('MGO'))
  assert.equal(route.human_review,'required')
})
