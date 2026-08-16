import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
const orchestrator=readFileSync(new URL('../server/conversation-orchestrator.js',import.meta.url),'utf8')
const thread=readFileSync(new URL('../server/conversation-thread-context.js',import.meta.url),'utf8')

test('runtime escolhe automaticamente entre regras e IA',()=>{
  assert.match(bootstrap,/if\(!orchestration\.route\.useGenerativeAi/)
  assert.match(bootstrap,/originalAnswer\.call\(this,input\)/)
  assert.match(bootstrap,/engineMode:'rules'/)
  assert.match(bootstrap,/automaticRouting:orchestration\.route/)
  assert.match(bootstrap,/generativeRole:'not_used_for_this_request'/)
})

test('resposta e persistência recebem o mesmo contexto de conversa',()=>{
  assert.match(bootstrap,/prepareConversationThread/)
  assert.match(bootstrap,/conversationOrchestration:resolved\.orchestration/)
  assert.match(bootstrap,/conversationThread:resolved\.thread/)
  assert.match(bootstrap,/question:originalMessage/)
})

test('orquestrador contém base oficial e bloqueio contra resposta genérica',()=>{
  assert.match(orchestrator,/Efficon®/)
  assert.match(orchestrator,/Dimpropiridaz 120 g\/L/)
  assert.match(orchestrator,/Cigarrinha-do-milho \(Dalbulus maidis\)/)
  assert.match(orchestrator,/generic_response_blocked=true/)
  assert.match(orchestrator,/technical_commercial_plan/)
  assert.match(orchestrator,/conversation_continuity/)
  assert.match(orchestrator,/decision_sequence/)
})

test('fio ativo encontra produtos em conversas anteriores intermediadas',()=>{
  assert.match(thread,/activeAnchor/)
  assert.match(thread,/Contexto técnico-comercial ativo das conversas anteriores/)
  assert.match(thread,/Continue a sequência técnica e comercial já iniciada/)
  assert.match(thread,/pode\\s\+\?\)\?\(\?:seguir|continuation/)
})
