import assert from 'node:assert/strict'
import test from 'node:test'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'

const tenantId='tenant-a'
const ownerId='owner-a'
const producerId='producer-matheus'
const now=new Date('2026-08-30T12:00:00.000Z')

const evidence=(overrides={})=>({
 id:'profile-evidence-a',profile_source_ref:'profile-source-a',source_type:'producer_questionnaire',
 producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerId,
 assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',
 epistemic_type:'OBSERVATION',
 answers:{
  decisionDriver:'Compara custo por hectare e retorno antes de decidir',
  technicalPresentation:'Prefere dados objetivos e comparáveis'
 },
 ...overrides
})

function profile(overrides={},factsOverrides={}){
 const profileEvidence=factsOverrides.profileEvidence??[evidence()]
 return buildFastClientResponse({
  facts:{
   client:{
    id:producerId,name:'Matheus Nascimento Jaeger',primaryProfile:'Analítico',
    producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerId,
    decisionDriver:'Compara custo por hectare e retorno antes de decidir',
    technicalPresentation:'Prefere dados objetivos e comparáveis',
    ...overrides
   },
   profileEvidence,profileSourceRef:factsOverrides.profileSourceRef??'profile-source-a',
   profileAssessedAt:'2026-08-01T12:00:00.000Z',profileValidUntil:'2027-08-01T12:00:00.000Z'
  },
  message:'qual o perfil dele?',organizationId:tenantId,ownerId,conversationId:'thread-a',contextEpoch:3,now
 })
}

test('FAST profile exige vínculo exato entre sourceRef e evidence',()=>{
 const disconnected=profile({}, {profileSourceRef:'profile-source-foreign',profileEvidence:[evidence()]})
 assert.equal(disconnected.responseMetadata.dataPath,'BEHAVIORAL_PROFILE')
 assert.equal(disconnected.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.doesNotMatch(disconnected.advice.answer,/Perfil principal: Analítico/i)
 assert.deepEqual(disconnected.advice.ai_reasoning.facts_used,[])
})

test('FAST profile rejeita detalhes comerciais e preserva somente sinais comportamentais',()=>{
 const result=profile({planningStyle:'Preço da proposta, margem e negociação comercial em aberto'})
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.match(result.advice.answer,/Perfil principal: Analítico/i)
 assert.match(result.advice.answer,/custo por hectare e retorno/i)
 assert.doesNotMatch(result.advice.answer,/proposta|margem|negociação/i)
})

test('FAST profile não usa evidence sem conteúdo relacionado para re-carimbar campos do client',()=>{
 const result=profile({}, {profileEvidence:[evidence({answers:undefined,statement:'Questionário respondido e perfil calculado.'})]})
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.deepEqual(result.advice.ai_reasoning.facts_used,[])
 assert.doesNotMatch(result.advice.answer,/Perfil principal: Analítico/i)
})

test('FAST profile exige suporte campo a campo e não deixa uma resposta de Q7 sustentar Q8',()=>{
 const result=profile({}, {profileEvidence:[evidence({answers:{decisionDriver:'Compara custo por hectare e retorno antes de decidir'}})]})
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.deepEqual(result.advice.ai_reasoning.facts_used,[])
})

test('FAST profile válido publica apenas conteúdo observado e inferência não circular',()=>{
 const result=profile()
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.match(result.advice.answer,/Perfil principal: Analítico/i)
 assert.match(result.advice.answer,/Compara custo por hectare e retorno antes de decidir/i)
 assert.match(result.advice.answer,/Prefere dados objetivos e comparáveis/i)
 const facts=result.advice.ai_reasoning.facts_used
 const observation=facts.find(item=>item.epistemic_type==='OBSERVATION')
 const inference=facts.find(item=>item.epistemic_type==='INFERENCE')
 assert.equal(observation.id,'profile-evidence-a')
 assert.match(observation.statement,/critério de decisão: Compara custo por hectare e retorno antes de decidir/i)
 assert.match(observation.statement,/forma preferida de apresentação: Prefere dados objetivos e comparáveis/i)
 assert.ok(inference.id.startsWith('profile-inference:'))
 assert.equal(inference.source_ref,observation.id)
 assert.notEqual(inference.id,inference.source_ref)
 assert.deepEqual(inference.evidence_refs,[observation.id])
})

test('FAST profile rejeita poison comercial mesmo quando está rotulado como campo comportamental',()=>{
 const result=profile({}, {profileEvidence:[evidence({answers:{
  decisionDriver:'Pediu comparativo antes da negociação da proposta',
  technicalPresentation:'Prefere avaliar margem e preço da proposta'
 }})]})
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.doesNotMatch(result.advice.answer,/proposta|margem|negociação/i)
 assert.deepEqual(result.advice.ai_reasoning.facts_used,[])
})

test('FAST profile falha fechado quando as supostas evidências só contêm estado comercial',()=>{
 const result=profile({decisionDriver:'Proposta em negociação comercial',technicalPresentation:'Preço da proposta e margem'})
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.doesNotMatch(result.advice.answer,/proposta|margem|negociação/i)
})

test('FAST profile exige sourceType e timestamp comprováveis na evidence',()=>{
 for(const invalid of [evidence({source_type:''}),evidence({assessed_at:undefined})]){
  const result=profile({}, {profileEvidence:[invalid]})
  assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 }
})
