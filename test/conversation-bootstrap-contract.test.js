import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
const orchestrator=readFileSync(new URL('../server/conversation-orchestrator.js',import.meta.url),'utf8')
const thread=readFileSync(new URL('../server/conversation-thread-context.js',import.meta.url),'utf8')
const specificity=readFileSync(new URL('../server/val-specificity.js',import.meta.url),'utf8')

test('runtime calcula fatos, usa raciocínio estruturado e reconcilia a saída',()=>{
  assert.match(bootstrap,/resolveStructuredReasoningRoute/)
  assert.match(bootstrap,/if\(attachmentCount===0&&reasoning\.useGenerativeAi\)/)
  assert.match(bootstrap,/originalAnswer\.call\(this,/)
  assert.match(bootstrap,/mergeStructuredReasoning/)
  assert.match(bootstrap,/enforceValSpecificity/)
  assert.match(bootstrap,/deterministicDecision\(/)
  assert.match(bootstrap,/providerFailureBlocksDecision:false/)
  assert.match(bootstrap,/textRequestsUseStructuredReasoning:true/)
  assert.match(bootstrap,/textRequestsUseSlimLanguageEnhancer:false/)
  assert.doesNotMatch(bootstrap,/enhanceDecisionLanguage\(/)
})

test('resposta e persistência preservam a pergunta original e a conversa contínua',()=>{
  assert.match(bootstrap,/prepareConversationThread/)
  assert.match(bootstrap,/originalQuestionContext=new AsyncLocalStorage/)
  assert.match(bootstrap,/originalQuestionContext\.run\(originalMessage/)
  assert.match(bootstrap,/const canonicalQuestion=String\(originalQuestionContext\.getStore\(\)\|\|input\.question/)
  assert.match(bootstrap,/question:canonicalQuestion/)
  assert.match(bootstrap,/conversationOrchestration:resolved\.orchestration/)
  assert.match(bootstrap,/conversationThread:resolved\.thread/)
})

test('orquestrador contém base oficial e continuidade técnico-comercial',()=>{
  assert.match(orchestrator,/Efficon®/)
  assert.match(orchestrator,/Dimpropiridaz 120 g\/L/)
  assert.match(orchestrator,/Cigarrinha-do-milho \(Dalbulus maidis\)/)
  assert.match(orchestrator,/generic_response_blocked=true/)
  assert.match(orchestrator,/technical_commercial_plan/)
  assert.match(orchestrator,/conversation_continuity/)
  assert.match(orchestrator,/decision_sequence/)
})

test('barreira de especificidade mantém fatos e segurança determinísticos',()=>{
  assert.match(specificity,/model_reasoning_rejected/)
  assert.match(specificity,/invented|numberTokens/)
  assert.match(specificity,/safetyBlocked/)
  assert.match(specificity,/distinct_source_types/)
  assert.match(specificity,/substitution_fingerprint/)
  assert.match(specificity,/doubleCountingGuardFor/)
})

test('fio ativo encontra produtos em conversas anteriores intermediadas',()=>{
  assert.match(thread,/activeAnchor/)
  assert.match(thread,/const continuation=/)
  assert.match(thread,/Contexto técnico-comercial ativo das conversas anteriores/)
  assert.match(thread,/Continue a sequência técnica e comercial já iniciada/)
})
