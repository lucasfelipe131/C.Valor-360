import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
  applyValWorkingStage,
  buildValMethodologyPrompt,
  buildValStageQuestions,
  deriveValMethodology,
  VAL_METHOD_SEQUENCE,
  VAL_METHOD_STAGES
} from '../server/val-methodology.js'
import {buildValInstructions,valAdviceSchema} from '../server/sales-playbook.js'

const sequence=['preparar','alinhar','descobrir','dimensionar','construir_valor','propor','comprometer']

test('uma definição canônica contém as sete etapas e seus contratos',()=>{
  assert.deepEqual([...VAL_METHOD_SEQUENCE],sequence)
  for(const id of sequence){
    const stage=VAL_METHOD_STAGES[id]
    assert.equal(stage.id,id)
    assert.ok(stage.label)
    assert.ok(stage.promptDescription)
    assert.ok(stage.gate)
    assert.ok(stage.conversationStage)
    const questions=stage.questions('a decisão da safra',['e1'])
    assert.equal(questions.length,2)
    assert.deepEqual(questions.map(item=>item.type),['aberta','fechada'])
    assert.ok(questions.every(item=>item.grounding_ids[0]==='e1'))
  }
})

test('prompt metodológico é gerado da sequência, descrições e portas canônicas',()=>{
  const prompt=buildValMethodologyPrompt()
  assert.match(prompt,/preparar → alinhar → descobrir → dimensionar → construir_valor → propor → comprometer/)
  for(const id of sequence){
    assert.ok(prompt.includes(VAL_METHOD_STAGES[id].promptDescription))
    assert.ok(prompt.includes(`${id}: ${VAL_METHOD_STAGES[id].gate}`))
  }
  const full=buildValInstructions('daily')
  assert.ok(full.includes(prompt))
  assert.equal(full.split('MÉTODO OPERACIONAL VAL, INVISÍVEL NA FALA').length-1,1)
})

test('fallback deriva avanço e perguntas pela mesma fonte',()=>{
  const initial=deriveValMethodology({mode:'daily'})
  assert.equal(initial.current_stage,'alinhar')
  assert.equal(initial.advance_gate,VAL_METHOD_STAGES.alinhar.gate)

  const proposal=deriveValMethodology({opportunity:{stage:'Proposta'}})
  assert.equal(proposal.current_stage,'construir_valor')
  assert.equal(proposal.next_stage,'propor')

  const followUp=deriveValMethodology({
    opportunity:{stage:'Diagnóstico'},
    priorRecommendations:[{methodology_state:{current_stage:'descobrir'}}],
    message:'O produtor confirmou que o impacto existe.'
  })
  assert.equal(followUp.current_stage,'dimensionar')
  assert.deepEqual(followUp.completed_stages,['preparar','alinhar','descobrir'])

  const questions=buildValStageQuestions('dimensionar','cigarrinha no milho',['campo-1'])
  assert.match(questions[0].question,/cigarrinha no milho/)
  assert.deepEqual(questions.map(item=>item.type),['aberta','fechada'])
})

test('etapa de trabalho usa a porta canônica sem fabricar avanço',()=>{
  const actual=deriveValMethodology({opportunity:{stage:'Diagnóstico'}})
  const working=applyValWorkingStage(actual,'propor')
  assert.equal(working.current_stage,'descobrir')
  assert.equal(working.working_stage,'propor')
  assert.equal(working.working_stage_source,'user_selection')
  assert.equal(working.working_stage_gate,VAL_METHOD_STAGES.propor.gate)
})

test('schema estrito compartilha a mesma sequência sem afrouxar o contrato',()=>{
  const methodology=valAdviceSchema.properties.methodology_state
  assert.equal(methodology.additionalProperties,false)
  assert.strictEqual(methodology.properties.sequence.items.enum,VAL_METHOD_SEQUENCE)
  assert.strictEqual(methodology.properties.current_stage.enum,VAL_METHOD_SEQUENCE)
  assert.strictEqual(methodology.properties.next_stage.enum,VAL_METHOD_SEQUENCE)
  assert.strictEqual(methodology.properties.working_stage.enum,VAL_METHOD_SEQUENCE)
  assert.equal(methodology.required.length,9)
})

test('sales-playbook não mantém cópias locais da metodologia',()=>{
  const source=readFileSync(new URL('../server/sales-playbook.js',import.meta.url),'utf8')
  assert.doesNotMatch(source,/export const VAL_METHOD_SEQUENCE=\[/)
  assert.doesNotMatch(source,/const stageGates=/)
  assert.doesNotMatch(source,/function deriveMethodology\(/)
  assert.doesNotMatch(source,/function stageQuestions\(/)
  assert.doesNotMatch(source,/const conversationStage=/)
  assert.match(source,/buildValMethodologyPrompt\(\)/)
})
