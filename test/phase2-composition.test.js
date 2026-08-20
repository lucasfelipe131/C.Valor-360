import assert from 'node:assert/strict'
import test from 'node:test'
import {ValEngine} from '../server/val-engine.js'
import {ValRepository} from '../server/repository.js'
import {currentValRuntimeComposition,installValRuntimeComposition,valRuntimeCompositionOrder} from '../server/core/composition.js'

test('imports não alteram protótipos e a composição explícita instala a ordem uma única vez',()=>{
  const beforeContext=ValRepository.prototype.getClientContext
  const beforeAnswer=ValEngine.prototype.answer
  assert.equal(currentValRuntimeComposition(),null)
  assert.equal(ValRepository.prototype.getClientContext,beforeContext)
  assert.equal(ValEngine.prototype.answer,beforeAnswer)

  const state=installValRuntimeComposition()
  assert.deepEqual(state.order,valRuntimeCompositionOrder)
  assert.deepEqual(state.steps.map(step=>step.id),['conversion','innovation'])
  assert.ok(state.steps.every(step=>step.installed))
  assert.notEqual(ValRepository.prototype.getClientContext,beforeContext)
  assert.notEqual(ValEngine.prototype.answer,beforeAnswer)
  assert.equal(installValRuntimeComposition(),state)
})
