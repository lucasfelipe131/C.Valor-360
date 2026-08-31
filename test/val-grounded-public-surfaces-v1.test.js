import assert from 'node:assert/strict'
import test from 'node:test'
import {attachAIReasoning} from '../server/ai-reasoning/index.js'

const poison='ZXQ_PUBLIC_POISON: repassar Fertilizante X por R$ 100, usar CPF financeira e travar contrato de grãos amanhã.'

function emptyContext(domain='GENERAL'){
 return {
  client:{id:'producer-a',name:'Matheus Nascimento Jaeger'},
  contextSnapshot:{
   organization_id:'tenant-a',subject:{type:'client',id:'producer-a'},context_snapshot_id:`snapshot-${domain.toLowerCase()}`,contract_version:'val.context_snapshot.v1',
   context_scope:{tenant_id:'tenant-a',owner_id:'owner-a',producer_id:'producer-a',conversation_id:'thread-a',context_epoch:4,domain},
   confidence:{level:'INSUFICIENTE'},facts:[],inferences:[],hypotheses:[],validated_knowledge:[],behavioral_signals:[],missing_information:[],
   commercial_context:{business_history:[],opportunities:[]},
   agronomic_context:{properties:[],field_reports:[],soil_analyses:[],ndvi_observations:[]},
   relationship_context:{interactions:[],visits:[],commitments:[]}
  }
 }
}

function poisonedAdvice(){
 return {
  answer:poison,objective:poison,evidence_used:[],
  executive_brief:{headline:poison,reason:poison,action:poison,question:poison,missing_data:[poison]},
  strategic_synthesis:{moment:poison,non_obvious_connection:poison,decision_at_stake:poison,do_not_do:poison,highest_value_unknown:{question:poison,why_it_matters:poison,how_to_get:poison}},
  decision_thesis:{objective:poison,recommended_action:poison,rationale:[poison],missing_information:[poison],what_would_change_my_mind:[poison],next_action:poison},
  next_best_action:poison,next_question:{question:poison,purpose:poison,evidence_needed:poison},questions:[{question:poison,purpose:poison,evidence_needed:poison}],
  commercial_context:{status:'known',detail:poison},behavioral_profile:{version:poison,approach_guidance:{adaptation:poison}},
  human_review:{required:false,reason:poison},blocked_actions:[],guardrails:[poison],unknown_public_surface:{nested:poison}
 }
}

test('grounding regeneration substitui todas as superfícies públicas e elimina poison do JSON completo',()=>{
 const result=attachAIReasoning(poisonedAdvice(),{context:emptyContext(),message:'Como avançar?',conversationId:'thread-a'})
 assert.equal(result.ai_reasoning.grounding.passed,true)
 assert.equal(result.ai_reasoning.grounding.blocked_or_regenerated,true)
 assert.equal(result.answer,result.ai_reasoning.recommended_strategy.reading)
 assert.equal(result.executive_brief.headline,result.answer)
 assert.equal(result.next_best_action,result.ai_reasoning.recommended_strategy.action)
 assert.deepEqual(result.val_response_quality,result.ai_reasoning.quality)
 assert.equal(Object.hasOwn(result,'unknown_public_surface'),false)
 assert.doesNotMatch(JSON.stringify(result),/ZXQ_PUBLIC_POISON|Fertilizante X|R\$ 100|CPF financeira|contrato de grãos/i)
})

test('PROFILE sem evidência usa template puro suportado sem nome nem exceção',()=>{
 const result=attachAIReasoning(poisonedAdvice(),{context:emptyContext('PROFILE'),message:'qual o perfil dele?',conversationId:'thread-a'})
 assert.equal(result.ai_reasoning.grounding.passed,true)
 assert.equal(result.ai_reasoning.grounding.question_relevance,'PASS')
 assert.equal(result.ai_reasoning.grounding.blocked_or_regenerated,true)
 assert.equal(result.answer,'Não há evidência comportamental atual e auditável suficiente para determinar o perfil comportamental.')
 assert.equal(result.answer,result.ai_reasoning.recommended_strategy.reading)
 assert.doesNotMatch(result.answer,/Matheus Nascimento Jaeger|produtor-a/i)
 assert.doesNotMatch(JSON.stringify(result),/ZXQ_PUBLIC_POISON|Fertilizante X|R\$ 100|CPF financeira|contrato de grãos/i)
})
