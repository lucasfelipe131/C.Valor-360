import assert from 'node:assert/strict'
import test from 'node:test'
import {generalAnswerTopicMatches,selectKnowledge,curatedAnswerCoversQuestion} from '../server/knowledge/selection.js'
import {requiresVerifiedGeneralSource} from '../server/knowledge/general-answer-provider.js'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// Offline regressions only. These are not K5 executions or rubric scores.
test('sampling strata do not request a regulated product mixture',()=>{
 assert.equal(requiresVerifiedGeneralSource('Como escolher pontos de amostragem sem misturar baixada e encosta?'),false)
 for(const question of [
  'Como fazer amostragem sem misturar herbicida e inseticida?',
  'Como fazer amostragem sem misturar baixada e encosta e aplicar herbicida?',
  'Como fazer amostragem sem misturar Priori Xtra e Lannate?',
  'Posso misturar dois produtos no tanque?',
  'Qual dose aplicar na amostragem sem misturar baixada e encosta?'
 ])assert.equal(requiresVerifiedGeneralSource(question),true,question)
})

test('topic validation checks subjects, not repetition of asking verbs',()=>{
 const question='Minhocas abundantes bastam para concluir que o solo está bem estruturado?'
 const answer='Minhocas abundantes são um indicador biológico, mas não demonstram sozinhas que o solo está bem estruturado. É necessário observar agregados, porosidade e raízes.'
 assert.equal(generalAnswerTopicMatches(question,answer),true)
 assert.equal(generalAnswerTopicMatches(question,'O solo pode ter boa estrutura.'),false)
 assert.equal(generalAnswerTopicMatches('Como controlar cigarrinha no milho?','O milho precisa de manejo integrado.'),false)
 assert.equal(generalAnswerTopicMatches('Como controlar cigarrinha no milho?','A cigarrinha da soja exige monitoramento.'),false)
})

test('a retrieved statement must cover the complete question before direct delivery',()=>{
 for(const question of [
  'Uma chuva leve depois da ureia sempre elimina o risco de volatilização?',
  'O que observar quando as sementes ficam a profundidades muito diferentes?',
  'O que comparar antes de atribuir falha de estande ao tratamento de sementes?'
 ]){
  const item=selectKnowledge({query:question,modules:['MCTX','MDI','MVV','MIA','MIC'],geography:'General',limit:1}).items[0]
  assert.ok(item,question)
  assert.equal(curatedAnswerCoversQuestion(question,item),false,question)
  assert.equal(curatedAnswerCoversQuestion(item.title,item),true,item.title)
 }
})

test('a rejected generated answer exposes its reason without leaking discarded text',async()=>{
 let calls=0
 const message='Como controlar cigarrinha no milho?'
 const result=await buildGeneralNoClientResponse({message,route:routeSystemCapability({message,hasClient:false}),organizationId:'synthetic-tenant',ownerId:'synthetic-owner',aiModel:'offline-mock',aiClient:{responses:{create:async()=>{calls++;return {status:'completed',output_text:'A órbita lunar depende da gravidade.'}}}}})
 assert.equal(calls,2)
 assert.ok(result.responseMetadata.aiGeneralKnowledgeRejectionReasons.includes('TOPIC_MISMATCH'))
 assert.doesNotMatch(JSON.stringify(result),/órbita lunar/)
})
