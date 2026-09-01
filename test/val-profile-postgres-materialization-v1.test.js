import assert from 'node:assert/strict'
import test from 'node:test'
import {ValRepository} from '../server/repository.js'
import {buildFastClientResponse,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {advanceConversationState,createConversationState,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {buildCapabilityExecutionResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {routeSessionCommand} from '../server/decision-copilot/session-command-router.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='00000000-0000-4000-8000-000000000010'
const producerId='producer-matheus-sanitized'
const internalClientId='00000000-0000-4000-8000-000000000501'
const profileId='00000000-0000-4000-8000-000000000901'
const surveyId='00000000-0000-4000-8000-000000000902'
const assessedAt='2026-08-01T12:00:00.000Z'
const validUntil='2027-02-01T12:00:00.000Z'
const now=new Date('2026-08-25T15:00:00.000Z')

const sanitizedPostgresRow=()=>({
 client_external_key:producerId,
 client_internal_id:internalClientId,
 client_tenant_id:tenantId,
 client_consultant_id:ownerId,
 name:'Matheus Nascimento Jaeger',
 profile_id:profileId,
 profile_tenant_id:tenantId,
 profile_client_id:internalClientId,
 primary_profile:'Conservador',
 secondary_profile:'Relacional',
 source_survey_id:surveyId,
 profile_answers:{
  7:'Resultados técnicos, números e retorno financeiro.',
  8:'Resultados de produtos já utilizados por vários anos.',
  10:'Adoto quando os resultados e custos comprovam a vantagem.',
  11:'Visitas presenciais frequentes.',
  14:'Dados técnicos e retorno sobre o investimento.'
 },
 profile_evidence:[{source:'producer_360',self_reported:true}],
 profile_snapshot:{
  decisionDriver:'Resultados técnicos, números e retorno financeiro.',
  technicalPresentation:'Resultados de produtos já utilizados por vários anos.',
  innovationBehavior:'Adoto quando os resultados e custos comprovam a vantagem.',
  servicePreference:'Visitas presenciais frequentes.',
  trustDriver:'Dados técnicos e retorno sobre o investimento.',
  priority:'PRIORIDADE: relançar fertilizantes.',
  opportunity:'OPORTUNIDADE: CPF financeira e contrato de grãos.',
  commercial:{product:'fertilizantes',price:'preço',margin:'margem',negotiation:'negociação'}
 },
 profile_assessed_at:assessedAt,
 profile_valid_until:validUntil,
})

test('PostgreSQL real sanitizado materializa profile_snapshot por campo sem contaminar a resposta PROFILE',async()=>{
 let sql=''
 const repository=new ValRepository({
  db:{configured:true,query:async statement=>{
   sql=statement
   return {rowCount:1,rows:[sanitizedPostgresRow()]}
  }},
  tenantId,readStore:()=>({}),saveStore:()=>{},
 })

 const facts=await repository.getFastClientFacts({
  tenantId,ownerId,clientId:producerId,dataPath:'BEHAVIORAL_PROFILE',now,
 })

 const response=buildFastClientResponse({
  facts,message:'qual o perfil dele?',organizationId:tenantId,ownerId,
  conversationId:'thread-profile-postgres-sanitized',contextEpoch:1,now,
 })

 assert.match(sql,/source_survey_id/)
 assert.match(sql,/profile_snapshot/)
 assert.match(sql,/client_internal_id/)
 assert.equal(facts.profileSourceRef,`client_profile:${profileId}`)
 assert.ok(facts.profileEvidence.some(item=>item.source_locator==='profile_snapshot.innovationBehavior'||item.source_locator==='answers.q10'))
 assert.deepEqual(new Set(facts.profileEvidence.map(item=>item.source_field)),new Set([
  'decisionDriver','innovationBehavior','servicePreference','trustDriver','primaryProfile','secondaryProfile',
 ]))
 assert.ok(facts.profileEvidence.filter(item=>item.question_id).every(item=>item.source_id===surveyId))
 assert.ok(facts.profileEvidence.every(item=>item.source_locator&&item.epistemic_type&&item.evidence_refs))
 assert.ok(facts.profileEvidence.every(item=>item.producer_id===producerId))
 assert.ok(facts.profileEvidence.every(item=>item.tenant_id===tenantId))
 assert.ok(facts.profileEvidence.every(item=>item.context_owner_id===ownerId))
 assert.ok(facts.profileRejectedEvidence.some(item=>item.reason==='PROFILE_FIELD_POISON'))

 assert.equal(response.responseMetadata.dataPath,'BEHAVIORAL_PROFILE')
 assert.equal(response.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.match(response.advice.answer,/Perfil principal: Conservador/i)
 assert.ok(response.advice.ai_reasoning.facts_used.length>=3)
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 assert.ok(response.advice.ai_reasoning.facts_used.some(item=>item.evidence_claims?.some(claim=>claim.field==='innovationBehavior'&&claim.question_id==='10')))
 assert.ok(response.advice.ai_reasoning.context_trace.selected.length>=response.advice.ai_reasoning.facts_used.length)
 assert.ok(response.advice.ai_reasoning.context_trace.selected.every(item=>item.sourceId&&item.reasonSelected==='BEHAVIORAL_EVIDENCE'))
 assert.ok(response.advice.ai_reasoning.context_trace.rejected.some(item=>item.reasonSelected==='PROFILE_FIELD_POISON'))
 assert.ok(response.advice.ai_reasoning.facts_used.every(item=>item.producer_id===producerId))
 assert.ok(response.advice.ai_reasoning.facts_used.every(item=>item.tenant_id===tenantId))
 assert.ok(response.advice.ai_reasoning.facts_used.every(item=>item.owner_id===ownerId))
 assert.doesNotMatch(response.advice.answer,/fertilizantes|CPF financeira|contrato de grãos|PRIORIDADE|OPORTUNIDADE|produto|preço|margem|negociação/i)
 assert.doesNotMatch(JSON.stringify(response.advice.ai_reasoning.facts_used),/fertilizantes|CPF financeira|contrato de grãos|PRIORIDADE|OPORTUNIDADE|produto|preço|margem|negociação/i)
})

test('PROFILE PostgreSQL mantém Por quê? no mesmo turno server-grounded sem falso OPPORTUNITY',async()=>{
 const repository=new ValRepository({
  db:{configured:true,query:async()=>({rowCount:1,rows:[sanitizedPostgresRow()]})},
  tenantId,readStore:()=>({}),saveStore:()=>{},
 })
 const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId:producerId,dataPath:'BEHAVIORAL_PROFILE',now})
 const conversationId='thread-profile-postgres-follow-up'
 const scope={tenantId,ownerId,conversationId,clientId:producerId,client:facts.client,now}
 const initial=buildFastClientResponse({
  facts,message:'qual o perfil dele?',organizationId:tenantId,ownerId,
  conversationId,contextEpoch:0,now,
 })
 let state=createConversationState(scope)
 state=advanceConversationState(state,{scope,message:'qual o perfil dele?',client:facts.client,response:initial,intent:'ASK_CLIENT',now})

 const message='Por quê?'
 const followUpNow=new Date(now.getTime()+1_000)
 state=prepareConversationTurnState(state,{scope:{...scope,now:followUpNow},message,intent:'FOLLOW_UP',now:followUpNow})
 const route={...routeSystemCapability({message,hasClient:true}),session_command:routeSessionCommand(message)}
 const execution=await executeCapabilityPlan({
  route,message,context:{client:facts.client,conversationState:state},clientId:producerId,
  tenantId,ownerId,conversationId,contextEpoch:state.context_epoch,
 })
 const response=buildCapabilityExecutionResponse({
  execution,route,message,organizationId:tenantId,ownerId,clientId:producerId,
  clientName:facts.client.name,conversationId,contextEpoch:state.context_epoch,
  contextDomain:state.current_domain,now:followUpNow,
 })

 assert.equal(execution.tool_result.context.deterministic_follow_up,true)
 assert.equal(response.advice.ai_reasoning.grounding.passed,true,JSON.stringify(response.advice.ai_reasoning.grounding))
 assert.equal(response.advice.ai_reasoning.grounding.blocked??false,false)
 assert.equal(response.advice.ai_reasoning.facts_used.length,1)
 assert.equal(response.advice.ai_reasoning.facts_used[0].source_type,'conversation_turn')
 assert.match(response.advice.answer,/Perfil principal: Conservador/i)
 assert.doesNotMatch(response.advice.answer,/fertilizantes|CPF financeira|contrato de grãos|PRIORIDADE|OPORTUNIDADE|produto|preço|margem|negociação/i)
})

test('PostgreSQL profile falha fechado antes da materialização quando tenant, owner ou client_profile divergem',async()=>{
 for(const patch of [
  {profile_tenant_id:'00000000-0000-4000-8000-000000000099'},
  {client_consultant_id:'00000000-0000-4000-8000-000000000099'},
  {profile_client_id:'00000000-0000-4000-8000-000000000099'},
 ]){
  const repository=new ValRepository({
   db:{configured:true,query:async()=>({rowCount:1,rows:[{...sanitizedPostgresRow(),...patch}]})},
   tenantId,readStore:()=>({}),saveStore:()=>{},
  })
  await assert.rejects(
   repository.getFastClientFacts({tenantId,ownerId,clientId:producerId,dataPath:'BEHAVIORAL_PROFILE',now}),
   error=>error?.statusCode===503,
  )
 }
})

test('profile_evidence canônico por campo prevalece sobre answers e mantém locator/source id originais',async()=>{
 const explicitId='00000000-0000-4000-8000-000000000903'
 const row=sanitizedPostgresRow()
 row.profile_evidence=[{
  id:explicitId,source_type:'producer_questionnaire',profile_source_ref:`client_profile:${profileId}`,
  producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerId,assessed_at:assessedAt,
  valid_until:validUntil,epistemic_type:'QUOTE',field:'innovationBehavior',
  statement:'Adoto quando os resultados e custos comprovam a vantagem.',
 }]
 const repository=new ValRepository({
  db:{configured:true,query:async()=>({rowCount:1,rows:[row]})},tenantId,readStore:()=>({}),saveStore:()=>{},
 })
 const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId:producerId,dataPath:'BEHAVIORAL_PROFILE',now})
 const innovation=facts.profileEvidence.find(item=>item.source_field==='innovationBehavior')
 assert.equal(innovation.source_id,explicitId)
 assert.equal(innovation.source_locator,'evidence.field.innovationBehavior')
 assert.equal(innovation.statement,'Adoto quando os resultados e custos comprovam a vantagem.')
 assert.equal(innovation.observed_at,assessedAt)
 assert.equal(innovation.valid_until,validUntil)
})

async function factsForRow(row){
 const repository=new ValRepository({
  db:{configured:true,query:async()=>({rowCount:1,rows:[row]})},tenantId,readStore:()=>({}),saveStore:()=>{},
 })
 return repository.getFastClientFacts({tenantId,ownerId,clientId:producerId,dataPath:'BEHAVIORAL_PROFILE',now})
}

const profileResponse=facts=>buildFastClientResponse({
 facts,message:'qual o perfil dele?',organizationId:tenantId,ownerId,
 conversationId:'thread-profile-postgres-shape',contextEpoch:2,now,
})

test('snapshot-only legítimo materializa locators do client_profile sem fabricar origem externa',async()=>{
 const row={...sanitizedPostgresRow(),profile_answers:{},profile_evidence:[],source_survey_id:null,profile_snapshot:{
  decisionDriver:'Compara dados técnicos e retorno antes de decidir.',
  innovationBehavior:'Decide adotar quando a evidência comprova a vantagem.',
  trustDriver:'Dados técnicos e retorno sobre o investimento.',
 }}
 const facts=await factsForRow(row)
 const behavioral=facts.profileEvidence.filter(item=>item.question_id)
 assert.equal(behavioral.length,3)
 assert.ok(behavioral.every(item=>item.source_id===profileId&&item.source_type==='behavioral_profile_evidence'))
 assert.deepEqual(behavioral.map(item=>item.source_locator),[
  'profile_snapshot.decisionDriver','profile_snapshot.innovationBehavior','profile_snapshot.trustDriver',
 ])
 assert.equal(profileResponse(facts).advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
})

test('answers-only com source_survey_id materializa evidência de questionário por campo',async()=>{
 const row={...sanitizedPostgresRow(),profile_evidence:[],profile_snapshot:{},profile_answers:{
  7:'Compara dados e retorno antes de decidir.',10:'Decide adotar quando a evidência comprova a vantagem.',14:'Valoriza dados técnicos e retorno.',
 }}
 const facts=await factsForRow(row)
 const behavioral=facts.profileEvidence.filter(item=>item.question_id)
 assert.equal(behavioral.length,3)
 assert.ok(behavioral.every(item=>item.source_id===surveyId&&item.source_type==='producer_questionnaire'))
 assert.deepEqual(behavioral.map(item=>item.source_locator),['answers.q7','answers.q10','answers.q14'])
 assert.equal(profileResponse(facts).advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
})

test('perfil registrado atual mais uma observação canônica é suficiente; registro sozinho continua NO_DATA',async()=>{
 const partial={...sanitizedPostgresRow(),profile_evidence:[],profile_snapshot:{},profile_answers:{14:'Valoriza dados técnicos e retorno.'}}
 const partialResponse=profileResponse(await factsForRow(partial))
 assert.equal(partialResponse.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.ok(partialResponse.advice.ai_reasoning.facts_used.some(item=>item.evidence_claims?.some(claim=>claim.field==='primaryProfile')))
 assert.ok(partialResponse.advice.ai_reasoning.facts_used.some(item=>item.evidence_claims?.some(claim=>claim.field==='trustDriver')))

 const registeredOnly={...partial,profile_answers:{}}
 const noData=profileResponse(await factsForRow(registeredOnly))
 assert.equal(noData.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.deepEqual(noData.advice.ai_reasoning.facts_used,[])
})

test('respostas sem primary_profile, perfil expirado e sourceRef divergente não apresentam perfil atual',async()=>{
 const answersWithoutProfile={...sanitizedPostgresRow(),primary_profile:null,profile_evidence:[],profile_snapshot:{},profile_answers:{
  7:'Compara dados e retorno antes de decidir.',14:'Valoriza dados técnicos e retorno.',
 }}
 const expired={...sanitizedPostgresRow(),profile_valid_until:'2026-08-01T12:00:00.000Z'}
 const divergent={...sanitizedPostgresRow(),profile_answers:{},profile_snapshot:{},profile_evidence:[{
  id:'evidence-foreign-parent',source_type:'producer_questionnaire',profile_source_ref:'client_profile:foreign',
  producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerId,assessed_at:assessedAt,valid_until:validUntil,
  epistemic_type:'QUOTE',field:'decisionDriver',statement:'Compara dados antes de decidir.',
 }]}
 for(const row of [answersWithoutProfile,expired,divergent]){
  const response=profileResponse(await factsForRow(row))
  assert.equal(response.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
  assert.deepEqual(response.advice.ai_reasoning.facts_used,[])
 }
})

test('conflito de valores bloqueia apenas o campo e registra reason code content-free',async()=>{
 const row={...sanitizedPostgresRow(),profile_evidence:[],profile_answers:{
  7:'Compara números antes de decidir.',14:'Valoriza dados técnicos e retorno.',
 },profile_snapshot:{
  decisionDriver:'Decide somente pelo relacionamento.',trustDriver:'Valoriza dados técnicos e retorno.',
 }}
 const facts=await factsForRow(row)
 assert.equal(facts.profileEvidence.some(item=>item.source_field==='decisionDriver'),false)
 assert.ok(facts.profileRejectedEvidence.some(item=>item.reason==='PROFILE_FIELD_CONFLICT'))
 const response=profileResponse(facts)
 assert.equal(response.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.ok(response.advice.ai_reasoning.context_trace.rejected.some(item=>item.reasonSelected==='PROFILE_FIELD_CONFLICT'))
})

test('aliases conflitantes nunca escolhem silenciosamente o valor seguro nem lavam poison',async()=>{
 const row={...sanitizedPostgresRow(),profile_answers:{
  decisionDriver:'Compara números antes de decidir.',7:'Decide somente pelo relacionamento.',
  14:'Valoriza dados técnicos e retorno.',
 },profile_snapshot:{},profile_evidence:[{
  id:'evidence-alias-safe',source_id:'evidence-alias-poison',source_type:'producer_questionnaire',
  profile_source_ref:`client_profile:${profileId}`,producer_id:producerId,tenant_id:tenantId,
  context_owner_id:ownerId,assessed_at:assessedAt,valid_until:validUntil,epistemic_type:'QUOTE',
  answers:{innovationBehavior:'Decide adotar quando a evidência comprova a vantagem.',10:'OPORTUNIDADE de fertilizantes.'},
 }]}
 const facts=await factsForRow(row)
 assert.equal(facts.profileEvidence.some(item=>item.source_field==='decisionDriver'),false)
 assert.equal(facts.profileEvidence.some(item=>item.source_field==='innovationBehavior'),false)
 assert.ok(facts.profileRejectedEvidence.some(item=>item.reason==='PROFILE_FIELD_ALIAS_CONFLICT'))
 assert.ok(facts.profileRejectedEvidence.some(item=>item.reason==='PROFILE_EVIDENCE_ALIAS_CONFLICT'))
 const response=profileResponse(facts)
 assert.doesNotMatch(JSON.stringify({answer:response.advice.answer,facts:response.advice.ai_reasoning.facts_used,trace:response.advice.ai_reasoning.context_trace}),/fertilizantes|OPORTUNIDADE/i)
})

test('profile_evidence explícito exige origem, parent, escopo, timestamp e validade próprios',async()=>{
 const valid={
  id:'strict-evidence',source_type:'producer_questionnaire',profile_source_ref:`client_profile:${profileId}`,
  producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerId,assessed_at:assessedAt,
  valid_until:validUntil,epistemic_type:'QUOTE',field:'decisionDriver',statement:'Compara dados antes de decidir.',
 }
 const variants=[
  [{producer_id:undefined},'MISSING_PRODUCER_SCOPE'],
  [{tenant_id:undefined},'MISSING_TENANT_SCOPE'],
  [{context_owner_id:undefined},'MISSING_OWNER_SCOPE'],
  [{profile_source_ref:undefined},'MISSING_PROFILE_SOURCE_REF'],
  [{source_type:undefined},'INVALID_PROFILE_EVIDENCE_SOURCE_TYPE'],
  [{assessed_at:undefined},'MISSING_PROFILE_EVIDENCE_TIMESTAMP'],
  [{valid_until:undefined},'MISSING_PROFILE_EVIDENCE_VALID_UNTIL'],
 ]
 for(const [patch,reason] of variants){
  const item={...valid,...patch}
  for(const key of Object.keys(item))if(item[key]===undefined)delete item[key]
  const row={...sanitizedPostgresRow(),profile_answers:{},profile_snapshot:{},profile_evidence:[item]}
  const facts=await factsForRow(row)
  assert.equal(facts.profileEvidence.some(evidence=>evidence.source_field==='decisionDriver'),false,reason)
  assert.ok(facts.profileRejectedEvidence.some(evidence=>evidence.reason===reason),reason)
 }
})

test('poison em answers, snapshot, evidence e client fields nunca entra em materialização, facts_used ou resposta',async()=>{
 const row={...sanitizedPostgresRow(),profile_answers:{
  7:'PRIORIDADE: negociar preço e margem.',14:'Valoriza dados técnicos e retorno.',
 },profile_snapshot:{innovationBehavior:'OPORTUNIDADE de fertilizantes.',servicePreference:'Atendimento presencial frequente.'},profile_evidence:[{
  id:'poison-evidence',source_type:'producer_questionnaire',profile_source_ref:`client_profile:${profileId}`,
  producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerId,assessed_at:assessedAt,valid_until:validUntil,
  epistemic_type:'QUOTE',field:'buyingBehavior',statement:'CPF financeira e contrato de grãos para produto.',
 }]}
 const facts=await factsForRow(row)
 const response=profileResponse(facts)
 assert.equal(response.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.ok(facts.profileRejectedEvidence.length>=3)
 const publicMaterial=JSON.stringify({answer:response.advice.answer,facts_used:response.advice.ai_reasoning.facts_used})
 assert.doesNotMatch(publicMaterial,/fertilizantes|CPF financeira|contrato de grãos|PRIORIDADE|OPORTUNIDADE|produto|preço|margem|negociação/i)
})

test('getClientContext PostgreSQL reutiliza o mesmo adapter canônico sem reagregar answers legadas',async()=>{
 const row={
  ...sanitizedPostgresRow(),id:internalClientId,external_key:producerId,tenant_id:tenantId,consultant_id:ownerId,
  answers:sanitizedPostgresRow().profile_answers,evidence:undefined,profile_evidence:sanitizedPostgresRow().profile_evidence,
  commercial_profile:{},relationship_profile:{},signals:[],learning:{},feedback_learning:{},visit_outcomes:[],memories:[],memory_history:[],
  business_history:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],field_reports:[],soil_analyses:[],
  ndvi_observations:[],manual_records:[],attachments:[],prior_recommendations:[],
 }
 const repository=new ValRepository({
  db:{configured:true,query:async()=>({rowCount:1,rows:[row]})},tenantId,readStore:()=>({}),saveStore:()=>{},
 })
 const context=await repository.getClientContext({
  tenantId,ownerId,clientId:producerId,
  contextRequest:{requestId:'00000000-0000-4000-8000-000000000777',objective:'profile_query',message:'qual o perfil dele?',intent:'PROFILE_QUERY',contextDomain:'PROFILE',actorRole:'consultant',now},
 })
 assert.ok(context.profile.evidence.length>=5)
 assert.ok(context.profile.evidence.every(item=>item.source_field&&item.source_locator&&!item.answers))
 assert.equal(context.client.innovationBehavior,'Adoto quando os resultados e custos comprovam a vantagem.')
 assert.equal(context.client.technicalPresentation,null)
 assert.doesNotMatch(JSON.stringify(context.profile.evidence),/fertilizantes|CPF financeira|contrato de grãos|PRIORIDADE|OPORTUNIDADE|produto|preço|margem|negociação/i)
})
