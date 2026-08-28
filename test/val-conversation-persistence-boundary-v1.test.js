import assert from 'node:assert/strict'
import test from 'node:test'
import {ValRepository,recommendationPersistencePayload} from '../server/repository.js'

const ephemeral='SEGREDO_EFEMERO_NAO_PERSISTIR'

const record=()=>({
 tenantId:'tenant-a',ownerId:'owner-a',clientId:'client-a',question:'Pergunta persistida pelo contrato existente.',mode:'daily',model:'rules',
 context:{
  client:{id:'client-a',name:'Cliente A'},
  conversationSession:{id:'thread-a',scope:'client_session'},
  conversationState:{conversation_id:'thread-a',conversation_turns:[{text:ephemeral}],session_facts:[{statement:ephemeral}],session_hypotheses:[{statement:ephemeral}]},
  conversationThread:{message:`Isso muda? ${ephemeral}`,originalMessage:'Isso muda?',continued:true,anchor:{id:'anchor-a',type:'conversation_state',question:ephemeral,context:ephemeral}},
  conversionIntelligence:{version:'val-conversion-core-v1',request:{message:`Isso muda? ${ephemeral}`,intent:'avançar',technicalIntent:false},decisionSignature:'content-free-hash'},
  conversationOrchestration:{
   version:'val-conversation-orchestrator-v1',generatedAt:'2026-08-28T10:00:00.000Z',producerId:'client-a',producerName:'Cliente A',
   continuity:{currentMessage:`Isso muda? ${ephemeral}`,lastTurn:{question:ephemeral},sequence:[{question:ephemeral}],carryForward:true,turnCount:2,threadFingerprint:'thread-fingerprint'},
   route:{intent:'decision_support',mode:'deterministic',reason:'Rota determinística.'},
   technicalCommercialPlan:{evidence:[{claim_supported:ephemeral}]},
   authority:{rules:'priority_score_next_action'}
  }
 },
 advice:{ai_reasoning:{conversation_id:'thread-a',decision_interview:{session_context:{conversation_id:'thread-a',persistence_mode:'NONE',turns:[{text:ephemeral}]}},premises:{session_context:{conversation_id:'thread-a',persistence_mode:'NONE',current_request:ephemeral}}}}
})

test('boundary remove estado, turnos e fatos efêmeros, preservando somente o id da thread',()=>{
 const persisted=recommendationPersistencePayload(record())
 const serialized=JSON.stringify(persisted)
 assert.equal(serialized.includes(ephemeral),false)
 assert.equal(serialized.includes('conversationState'),false)
 assert.equal(serialized.includes('session_facts'),false)
 assert.equal(persisted.advice.ai_reasoning.conversation_id,'thread-a')
 assert.deepEqual(persisted.advice.ai_reasoning.decision_interview.session_context,{conversation_id:'thread-a',persistence_mode:'NONE'})
 assert.deepEqual(persisted.context.conversationThread,{continued:true,anchor:{id:'anchor-a'}})
 assert.deepEqual(persisted.context.conversionIntelligence.request,{intent:'avançar',technicalIntent:false})
 assert.deepEqual(persisted.context.conversationOrchestration,{
  version:'val-conversation-orchestrator-v1',generatedAt:'2026-08-28T10:00:00.000Z',producerId:'client-a',
  continuity:{carryForward:true,turnCount:2,threadFingerprint:'thread-fingerprint'},
  route:{intent:'decision_support',mode:'deterministic',reason:'Rota determinística.'},
  authority:{rules:'priority_score_next_action'}
 })
})

test('fallback repository grava somente a visão sanitizada da recomendação',async()=>{
 const store={val:{recommendations:[],contextSnapshots:[],modelRuns:[]}}
 const repository=new ValRepository({db:{configured:false},tenantId:'tenant-a',readStore:()=>store,saveStore:next=>Object.assign(store,next)})
 await repository.recordRecommendation(record())
 assert.equal(store.val.recommendations.length,1)
 const persisted=JSON.stringify(store.val.recommendations[0])
 assert.equal(persisted.includes(ephemeral),false)
 assert.equal(persisted.includes('conversationState'),false)
 assert.equal(store.val.recommendations[0].advice.ai_reasoning.conversation_id,'thread-a')
 assert.deepEqual(store.val.recommendations[0].context.conversationThread,{continued:true,anchor:{id:'anchor-a'}})
})
