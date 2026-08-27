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

test('composição real da ValEngine persiste artefatos comerciais tenant-safe',async()=>{
 installValRuntimeComposition()
 let store={surveys:[],imports:[],opportunities:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},attachments:[]}}
 const repository=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:value=>{store=value},tenantId:tenantA})
 const client={id:'producer-a',name:'Produtor A',scores:{analitico:2},profileAnswers:{7:'Resultados técnicos, números e retorno financeiro.'}}
 const engine=new ValEngine({runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},repository,logger:()=>{}})
 const answer=await engine.answer({tenantId:tenantA,ownerId:actorA,clientId:client.id,client,message:'O produtor pediu ROI e comparativos.',attachmentIds:[],mode:'daily',contextRequest:{requestId:'00000000-0000-4000-8000-000000000406',objective:'next_best_action',actorRole:'consultant',scope:'own_portfolio'}})
 assert.equal(answer.advice.behavioral_profile.organization_id,tenantA)
 assert.equal(answer.advice.decision_thesis.context_snapshot_id,answer.contextSnapshotId)
 assert.equal(answer.advice.value_plan.guardrails.automatic_discount,false)
 assert.equal(store.val.recommendations[0].advice.commercial_modules.version,'val.commercial_composition.v1')
})
