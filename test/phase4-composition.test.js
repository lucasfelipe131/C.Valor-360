import test from 'node:test'
import assert from 'node:assert/strict'
import {runWithRequestContext} from '../server/observability.js'
import {attachCommercialComposition} from '../server/commercial/composition.js'
import {ValEngine} from '../server/val-engine.js'
import {ValRepository} from '../server/repository.js'
import {installValRuntimeComposition} from '../server/core/composition.js'
import {tenantA,actorA,phase4Context,baseAdvice,baseConversion} from '../support/phase4-test-context.js'

test('adapter anexa MIC, MDI e MVV sem remover campos legados',()=>{
 const context=phase4Context()
 const result=attachCommercialComposition(baseAdvice,{context,message:'Prepare a próxima ação.',conversion:baseConversion})
 assert.equal(result.next_best_action,baseAdvice.next_best_action)
 assert.equal(result.behavioral_profile.context_snapshot_id,context.contextSnapshot.context_snapshot_id)
 assert.equal(result.decision_thesis.context_snapshot_id,context.contextSnapshot.context_snapshot_id)
 assert.equal(result.value_plan.context_snapshot_id,context.contextSnapshot.context_snapshot_id)
 assert.deepEqual(result.commercial_modules.modules_called,['MIC','MDI','MVV'])
})

test('telemetria comercial registra referências e versões sem conteúdo sensível',async()=>{
 const logs=[]
 const secret='objeção privada e sensível do produtor'
 await runWithRequestContext({requestId:'00000000-0000-4000-8000-000000000405',method:'POST',path:'/api/v1/val/recommendations',tenantId:tenantA,actorId:actorA},async()=>{
  attachCommercialComposition(baseAdvice,{context:phase4Context(),message:secret,conversion:baseConversion,scenarioFixture:'RAUL-WEAK'})
 },{logger:value=>logs.push(JSON.parse(value))})
 const event=logs.find(item=>item.stage==='commercial.modules.completed')
 assert.equal(event.modulesCalled,'MIC,MDI,MVV')
 assert.equal(event.behaviorProfileVersion,'val.behavioral_profile.v1')
 assert.equal(event.scenarioFixture,'RAUL-WEAK')
 assert.doesNotMatch(JSON.stringify(logs),new RegExp(secret))
})

test('composição real da ValEngine persiste somente resposta grounded tenant-safe',async()=>{
 installValRuntimeComposition()
 let store={surveys:[],imports:[],opportunities:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},attachments:[]}}
 const repository=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:value=>{store=value},tenantId:tenantA})
 const profileSource='profile-evidence-roi'
 const client={
  id:'producer-a',name:'Produtor A',primaryProfile:'Analítico',secondaryProfile:'Relacional',scores:{analitico:2},
  profileAnswers:{7:'Resultados técnicos, números e retorno financeiro.',8:'Comparativos, custos, gráficos e dados de produtividade.'},
  profileSource,profileUpdatedAt:'2026-08-20T10:00:00.000Z',profileValidUntil:'2027-08-20T10:00:00.000Z',
  profileEvidence:[
   {id:profileSource,profile_source_ref:profileSource,source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decision_driver',statement:'Pediu comparativos de custo por hectare e retorno antes de decidir.',tenant_id:tenantA,producer_id:'producer-a',context_owner_id:actorA,assessed_at:'2026-08-20T10:00:00.000Z',valid_until:'2027-08-20T10:00:00.000Z'},
   {id:'profile-evidence-data',profile_source_ref:profileSource,source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'technical_presentation',statement:'Prefere dados objetivos e comparáveis.',tenant_id:tenantA,producer_id:'producer-a',context_owner_id:actorA,assessed_at:'2026-08-20T10:00:00.000Z',valid_until:'2027-08-20T10:00:00.000Z'}
  ]
 }
 const engine=new ValEngine({runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},repository,logger:()=>{}})
 const answer=await engine.answer({tenantId:tenantA,ownerId:actorA,clientId:client.id,client,message:'Qual é o perfil dele?',attachmentIds:[],mode:'daily',contextRequest:{requestId:'00000000-0000-4000-8000-000000000406',objective:'profile_query',intent:'PROFILE_QUERY',actorRole:'consultant',scope:'own_portfolio',conversationId:'phase4-composition-profile',contextEpoch:0,contextDomain:'PROFILE'}})
 const reasoning=answer.advice.ai_reasoning
 assert.deepEqual(reasoning.premises.context_scope,{tenant_id:tenantA,owner_id:actorA,producer_id:client.id,active_entity:null,conversation_id:'phase4-composition-profile',context_epoch:0,domain:'PROFILE',requested_domains:['PROFILE'],query_fingerprint:reasoning.premises.context_scope.query_fingerprint,selector_version:'val.context_selector.v1',minimum_sufficient_context:true})
 assert.equal(reasoning.organization.id,tenantA)
 assert.equal(reasoning.client.id,client.id)
 assert.equal(reasoning.context_snapshot.id,answer.contextSnapshotId)
 assert.equal(reasoning.grounding.passed,true)
 assert.equal(reasoning.grounding.question_relevance,'PASS')
 assert.equal(reasoning.grounding.blocked_or_regenerated,true)
 assert.ok(reasoning.context_trace.selected.every(item=>item.sourceType==='behavioral_profile'))
 assert.equal(answer.advice.answer,'Não há evidência comportamental atual e auditável suficiente para determinar o perfil comportamental.')
 assert.equal(answer.advice.behavioral_profile,undefined)
 assert.equal(answer.advice.value_plan,undefined)
 const persisted=store.val.recommendations[0].advice
 assert.equal(persisted.ai_reasoning.organization.id,tenantA)
 assert.equal(persisted.ai_reasoning.client.id,client.id)
 assert.equal(persisted.ai_reasoning.grounding.passed,true)
 assert.equal(persisted.behavioral_profile,undefined)
})
