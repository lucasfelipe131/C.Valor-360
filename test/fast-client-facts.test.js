import test from 'node:test'
import assert from 'node:assert/strict'
import {ValRepository} from '../server/repository.js'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const otherTenantId='00000000-0000-4000-8000-000000000002'
const ownerA='00000000-0000-4000-8000-000000000010'
const ownerB='00000000-0000-4000-8000-000000000011'
const now=new Date('2026-08-25T15:00:00.000Z')
const fastScope=producerId=>({producer_id:producerId,tenant_id:tenantId,context_owner_id:ownerA})

const fallbackRepository=store=>new ValRepository({
  db:{configured:false},tenantId,readStore:()=>store,saveStore:()=>{},
})

test('FAST fallback aplica tenant+owner em imports, clientes, visitas e compromissos',async()=>{
  const store={
    imports:[
      {tenantId,ownerId:ownerB,clients:[{id:'shared-client',name:'Produtor da carteira B'}]},
      {tenantId,ownerId:ownerA,clients:[{id:'shared-client',name:'Produtor da carteira A'}]},
      {tenantId:otherTenantId,ownerId:ownerA,clients:[{id:'shared-client',name:'Produtor de outro tenant'}]},
      {clients:[{id:'shared-client',name:'Produtor sem escopo'}]},
    ],
    visits:[
      {id:'completed-old',tenantId,ownerId:ownerA,clientId:'shared-client',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-20T12:00:00.000Z',updatedAt:'2026-08-25T14:59:00.000Z'},
      {id:'completed-new',tenantId,ownerId:ownerA,clientId:'shared-client',status:'Concluída',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z',completedAt:'2026-08-24T13:00:00.000Z',updatedAt:'2026-08-24T13:00:00.000Z'},
      {id:'planned-near',tenantId,ownerId:ownerA,clientId:'shared-client',status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt:'2026-08-26T12:00:00.000Z',updatedAt:'2026-08-25T15:30:00.000Z'},
      {id:'planned-far',tenantId,ownerId:ownerA,clientId:'shared-client',status:'Preparada',lifecycleStatus:'PREPARED',scheduledAt:'2026-08-29T12:00:00.000Z'},
      {id:'owner-b-completed',tenantId,ownerId:ownerB,clientId:'shared-client',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-25T14:00:00.000Z'},
      {id:'unscoped-completed',clientId:'shared-client',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-25T14:30:00.000Z'},
    ],
    val:{commitments:[
      {commitment_id:'commitment-a',tenantId,ownerId:ownerA,client_id:'shared-client',description:'Compromisso A',updated_at:'2026-08-24T10:00:00.000Z'},
      {commitment_id:'commitment-b',tenantId,ownerId:ownerB,client_id:'shared-client',description:'Compromisso B',updated_at:'2026-08-25T10:00:00.000Z'},
      {commitment_id:'commitment-unscoped',client_id:'shared-client',description:'Sem escopo',updated_at:'2026-08-25T14:00:00.000Z'},
    ]},
  }
  const repository=fallbackRepository(store)
  const factsA=await repository.getFastClientFacts({tenantId,ownerId:ownerA,clientId:'shared-client',now})
  assert.equal(factsA.client.name,'Produtor da carteira A')
  assert.equal(factsA.latestCompletedVisit.id,'completed-new')
  assert.equal(factsA.latestVisit.id,'completed-new')
  assert.equal(factsA.latestCompletedVisit.lifecycleStatus,'COMPLETED')
  assert.equal(factsA.nextScheduledVisit.id,'planned-near')
  assert.equal(factsA.nextScheduledVisit.status,'Agendada')
  assert.equal(factsA.latestCommitment.commitment_id,'commitment-a')

  const factsB=await repository.getFastClientFacts({tenantId,ownerId:ownerB,clientId:'shared-client',now})
  assert.equal(factsB.client.name,'Produtor da carteira B')
  assert.equal(factsB.latestCompletedVisit.id,'owner-b-completed')
  assert.equal(factsB.latestCommitment.commitment_id,'commitment-b')
})

test('FAST fallback falha fechado quando owner está ausente ou o cliente só existe sem escopo',async()=>{
  const repository=fallbackRepository({imports:[{clients:[{id:'unscoped',name:'Sem escopo'}]}],visits:[],val:{commitments:[]}})
  await assert.rejects(
    repository.getFastClientFacts({tenantId,clientId:'unscoped',now}),
    error=>error?.statusCode===403&&error?.code==='owner_scope_required',
  )
  await assert.rejects(
    repository.getFastClientFacts({tenantId,ownerId:ownerA,clientId:'unscoped',now}),
    error=>error?.statusCode===404,
  )
})

test('fallback de inteligência e contexto técnico isola owners com a mesma chave de cliente',async()=>{
  let store={
    imports:[
      {tenantId,ownerId:ownerA,id:'import-a',clients:[{id:'shared-client',name:'Carteira A'}]},
      {tenantId,ownerId:ownerB,id:'import-b',clients:[{id:'shared-client',name:'Carteira B'}]},
      {clients:[{id:'unscoped',name:'Sem escopo'}]},
    ],
    visits:[
      {tenantId,ownerId:ownerA,id:'visit-a',clientId:'shared-client'},
      {tenantId,ownerId:ownerB,id:'visit-b',clientId:'shared-client'},
    ],
    opportunities:[
      {tenantId,ownerId:ownerA,id:'opportunity-a',clientId:'shared-client'},
      {tenantId,ownerId:ownerB,id:'opportunity-b',clientId:'shared-client'},
    ],
    val:{technicalContexts:{}},
  }
  const repository=new ValRepository({
    db:{configured:false},tenantId,
    readStore:()=>structuredClone(store),
    saveStore:next=>{store=structuredClone(next)},
  })
  const intelligenceA=await repository.getIntelligence(ownerA)
  assert.deepEqual(intelligenceA.imports.map(item=>item.id),['import-a'])
  assert.deepEqual(intelligenceA.clients.map(item=>item.name),['Carteira A'])
  assert.deepEqual(intelligenceA.visits.map(item=>item.id),['visit-a'])
  assert.deepEqual(intelligenceA.opportunities.map(item=>item.id),['opportunity-a'])

  await repository.saveTechnicalContext('shared-client',{property:'Fazenda A'},ownerA)
  await repository.saveTechnicalContext('shared-client',{property:'Fazenda B'},ownerB)
  assert.equal((await repository.getTechnicalContext('shared-client',ownerA)).property,'Fazenda A')
  assert.equal((await repository.getTechnicalContext('shared-client',ownerB)).property,'Fazenda B')
  assert.equal(Object.keys(store.val.technicalContexts).length,2)
})

test('FAST responde última visita só com a concluída e descarta a próxima agendada',()=>{
  const response=buildFastClientResponse({
    facts:{
      client:{id:'producer-1',name:'Produtor Um',...fastScope('producer-1')},
      latestCompletedVisit:{id:'visit-completed',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-20T12:00:00.000Z',updatedAt:'2026-08-25T10:00:00.000Z',summary:'Revisão concluída.',...fastScope('producer-1')},
      nextScheduledVisit:{id:'visit-planned',status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt:'2026-08-26T12:00:00.000Z',updatedAt:'2026-08-25T14:00:00.000Z',...fastScope('producer-1')},
    },
    message:'Qual foi a última visita?',organizationId:tenantId,ownerId:ownerA,conversationId:'thread-1',now,
  })
  assert.match(response.advice.answer,/última visita concluída/i)
  assert.match(response.advice.answer,/20\/08\/2026/)
  assert.doesNotMatch(response.advice.answer,/próxima visita|26\/08\/2026/i)
  assert.doesNotMatch(response.advice.answer,/25\/08\/2026/)
  assert.equal(response.responseMetadata.latestCompletedVisit.lifecycleStatus,'COMPLETED')
  assert.equal(response.responseMetadata.nextScheduledVisit,null)
  assert.deepEqual(response.advice.ai_reasoning.facts_used.map(item=>item.lifecycle_status),['COMPLETED'])
  assert.equal(response.advice.ai_reasoning.grounding.passed,true)

  const plannedOnly=buildFastClientResponse({
    facts:{client:{id:'producer-1',name:'Produtor Um',...fastScope('producer-1')},latestVisit:{id:'legacy-wrong-alias',status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt:'2026-08-27T12:00:00.000Z',updatedAt:'2026-08-25T14:00:00.000Z',...fastScope('producer-1')},nextScheduledVisit:{id:'visit-planned',status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt:'2026-08-26T12:00:00.000Z',...fastScope('producer-1')}},
    message:'Qual foi a última visita?',organizationId:tenantId,ownerId:ownerA,conversationId:'thread-2',now,
  })
  assert.match(plannedOnly.advice.answer,/ainda não há visita concluída registrada/i)
  assert.doesNotMatch(plannedOnly.advice.answer,/próxima visita|26\/08\/2026|27\/08\/2026/i)
  assert.equal(plannedOnly.responseMetadata.latestCompletedVisit,null)
  assert.equal(plannedOnly.responseMetadata.nextScheduledVisit,null)
  assert.deepEqual(plannedOnly.advice.ai_reasoning.facts_used,[])
  assert.equal(plannedOnly.advice.ai_reasoning.grounding.passed,true)
})

test('consulta PostgreSQL FAST projeta lifecycle/status e usa datas da visita, não updated_at, para a seleção',async()=>{
  let sql=''
  const repository=new ValRepository({
    db:{configured:true,query:async statement=>{
      sql=statement
      return {rowCount:1,rows:[{client_external_key:'producer-1',name:'Produtor Um',latest_completed_visit:{id:'completed',status:'Realizada',lifecycle_status:'COMPLETED',occurred_at:'2026-08-20T12:00:00.000Z'},next_scheduled_visit:{id:'planned',status:'Agendada',lifecycle_status:'PLANNED',scheduled_at:'2026-08-26T12:00:00.000Z'}}]}
    }},tenantId,readStore:()=>({}),saveStore:()=>{},
  })
  const facts=await repository.getFastClientFacts({tenantId,ownerId:ownerA,clientId:'producer-1'})
  assert.equal(facts.latestCompletedVisit.lifecycle_status,'COMPLETED')
  assert.equal(facts.nextScheduledVisit.status,'Agendada')
  assert.match(sql,/latest_completed_visit/)
  assert.match(sql,/next_scheduled_visit/)
  assert.match(sql,/visit\.lifecycle_status/)
  assert.doesNotMatch(sql,/ORDER BY COALESCE\(visit\.updated_at/)
})

test('PostgreSQL FAST materializa Q7/Q8 como evidence comportamental identificável e não circular',async()=>{
  let sql=''
  const repository=new ValRepository({
    db:{configured:true,query:async statement=>{
      sql=statement
      return {rowCount:1,rows:[{
        client_external_key:'producer-profile',client_internal_id:'client-db-profile',client_tenant_id:tenantId,client_consultant_id:ownerA,
        name:'Matheus Nascimento Jaeger',profile_id:'profile-db-1',profile_tenant_id:tenantId,profile_client_id:'client-db-profile',
        primary_profile:'Analítico',secondary_profile:'Relacional',
        profile_snapshot:{
          decisionDriver:'Compara custo por hectare e retorno antes de decidir',
          technicalPresentation:'Prefere dados objetivos e comparáveis',
        },
        profile_answers:{7:'Compara custo por hectare e retorno antes de decidir',8:'Prefere dados objetivos e comparáveis'},
        profile_evidence:[{source:'producer_360',survey_id:'survey-db-1',self_reported:true}],
        source_survey_id:'survey-db-1',
        profile_assessed_at:'2026-08-01T12:00:00.000Z',profile_valid_until:'2027-02-01T12:00:00.000Z',
      }]}
    }},tenantId,readStore:()=>({}),saveStore:()=>{},
  })
  const facts=await repository.getFastClientFacts({tenantId,ownerId:ownerA,clientId:'producer-profile',dataPath:'BEHAVIORAL_PROFILE',now})
  assert.match(sql,/p\.answers profile_answers/)
  assert.match(sql,/LEFT JOIN LATERAL \(SELECT id,tenant_id,client_id,primary_profile,secondary_profile,answers,evidence,profile_snapshot,source_survey_id,valid_until,assessed_at FROM client_profiles/)
  assert.equal(facts.profileSourceRef,'client_profile:profile-db-1')
  assert.equal(facts.profileEvidence.length,4)
  const decision=facts.profileEvidence.find(item=>item.source_field==='decisionDriver')
  const presentation=facts.profileEvidence.find(item=>item.source_field==='technicalPresentation')
  const primary=facts.profileEvidence.find(item=>item.source_field==='primaryProfile')
  assert.equal(decision.id,'client_profile:profile-db-1:answers.q7')
  assert.equal(decision.source_id,'survey-db-1')
  assert.equal(decision.source_type,'producer_questionnaire')
  assert.equal(decision.epistemic_type,'QUOTE')
  assert.equal(decision.source_locator,'answers.q7')
  assert.equal(presentation.source_locator,'answers.q8')
  assert.equal(primary.epistemic_type,'FACT')
  assert.ok(facts.profileEvidence.every(item=>item.producer_id==='producer-profile'&&item.tenant_id===tenantId&&item.context_owner_id===ownerA))
  assert.ok(facts.profileEvidence.every(item=>item.profile_source_ref==='client_profile:profile-db-1'&&item.assessed_at==='2026-08-01T12:00:00.000Z'))

  const response=buildFastClientResponse({facts,message:'qual o perfil dele?',organizationId:tenantId,ownerId:ownerA,conversationId:'thread-profile-db',now})
  assert.equal(response.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
  assert.match(response.advice.answer,/Perfil principal: Analítico/i)
  const observations=response.advice.ai_reasoning.facts_used.filter(item=>item.epistemic_type==='QUOTE')
  const inference=response.advice.ai_reasoning.facts_used.find(item=>item.epistemic_type==='INFERENCE')
  assert.equal(observations.length,2)
  assert.match(observations[0].statement,/Compara custo por hectare e retorno antes de decidir/i)
  assert.match(observations[1].statement,/Prefere dados objetivos e comparáveis/i)
  assert.deepEqual(observations.flatMap(item=>item.evidence_claims).map(item=>[item.field,item.question_id,item.source_locator]),[
    ['decisionDriver','7','answers.q7'],
    ['technicalPresentation','8','answers.q8'],
  ])
  assert.equal(inference.source_ref,'client_profile:profile-db-1:primary_profile')
  assert.notEqual(inference.id,inference.source_ref)
  assert.deepEqual(inference.evidence_refs,[
    'client_profile:profile-db-1:primary_profile','client_profile:profile-db-1:secondary_profile',
    'client_profile:profile-db-1:answers.q7','client_profile:profile-db-1:answers.q8',
  ])
})
