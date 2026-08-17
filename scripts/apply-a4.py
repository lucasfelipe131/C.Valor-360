from pathlib import Path
import re

path=Path('server/sales-playbook.js')
source=path.read_text()

# Importa a fonte metodológica única.
import_marker="import {buildValueBridge} from './product-intelligence.js'\n"
method_import="""import {
  applyValWorkingStage,
  buildValMethodologyPrompt,
  buildValStageQuestions as stageQuestions,
  deriveValMethodology as deriveMethodology,
  normalizeValMethodStage,
  valMethodConversationStage as conversationStage,
  VAL_METHOD_SEQUENCE,
  VAL_METHOD_STAGE_LABELS as stageLabels
} from './val-methodology.js'
"""
if source.count(import_marker)!=1:
    raise RuntimeError('A4: marcador de import não encontrado')
source=source.replace(import_marker,import_marker+method_import,1)

# O schema passa a usar a mesma sequência, sem flexibilizar campos ou adicionais.
old_methodology=re.search(r"const methodologyState=\{type:'object'.*?\nconst approachPlan=",source,re.S)
if not old_methodology:
    raise RuntimeError('A4: schema methodologyState não encontrado')
new_methodology="""const methodologyState={type:'object',additionalProperties:false,properties:{sequence:{type:'array',items:{type:'string',enum:VAL_METHOD_SEQUENCE},minItems:VAL_METHOD_SEQUENCE.length,maxItems:VAL_METHOD_SEQUENCE.length},current_stage:{type:'string',enum:VAL_METHOD_SEQUENCE},completed_stages:{type:'array',items:{type:'string',enum:VAL_METHOD_SEQUENCE},maxItems:VAL_METHOD_SEQUENCE.length},next_stage:{type:'string',enum:VAL_METHOD_SEQUENCE},advance_gate:{type:'string'},reason:{type:'string'},working_stage:{type:'string',enum:VAL_METHOD_SEQUENCE},working_stage_source:{type:'string',enum:['actual_progress','user_selection']},working_stage_gate:{type:'string'}},required:['sequence','current_stage','completed_stages','next_stage','advance_gate','reason','working_stage','working_stage_source','working_stage_gate']}
const approachPlan="""
source=source[:old_methodology.start()]+new_methodology+source[old_methodology.end():]

# O prompt deixa de repetir a sequência e passa a ser gerado pela mesma fonte.
prompt_start=source.find("const VAL_OPERATIONAL_INSTRUCTIONS=`")
method_start=source.find('MÉTODO OPERACIONAL VAL, INVISÍVEL NA FALA',prompt_start)
next_section=source.find('VAL É COPILOTA DE DECISÃO, NÃO UMA IA SOBRE CRM',method_start)
if min(prompt_start,method_start,next_section)<0:
    raise RuntimeError('A4: bloco metodológico do prompt não encontrado')
source=source[:method_start]+"${buildValMethodologyPrompt()}\n\n"+source[next_section:]
source=source.replace("export const VAL_INSTRUCTIONS_VERSION='val-playbook-v8-tiered'","export const VAL_INSTRUCTIONS_VERSION='val-playbook-v9-tiered'",1)

# Remove constantes e helpers metodológicos duplicados, mantendo exportações compatíveis.
local_start=source.find("export const VAL_METHOD_SEQUENCE=['preparar'")
local_end=source.find('const hasText=',local_start)
if local_start<0 or local_end<0:
    raise RuntimeError('A4: bloco metodológico local não encontrado')
compat="""export {VAL_METHOD_SEQUENCE,normalizeValMethodStage}
export const applyWorkingStage=applyValWorkingStage
"""
source=source[:local_start]+compat+source[local_end:]

# Remove deriveMethodology, stageQuestions e conversationStage locais.
derive_start=source.find('function deriveMethodology(')
fallback_start=source.find('\nexport function buildFallbackAdvice(',derive_start)
if derive_start<0 or fallback_start<0:
    raise RuntimeError('A4: funções metodológicas duplicadas não encontradas')
source=source[:derive_start]+source[fallback_start:]
path.write_text(source)

# Documenta a fonte canônica.
doc_path=Path('docs/VAL_ENGINE.md')
docs=doc_path.read_text()
marker='## Instruções modulares e cache de prompt\n'
section='''## Fonte única da sequência metodológica\n\n`server/val-methodology.js` é a fonte canônica de preparar → alinhar → descobrir → dimensionar → construir_valor → propor → comprometer. Cada etapa define, no mesmo lugar, nome, descrição para o prompt, porta objetiva, tipo de passo da conversa e perguntas aberta e fechada.\n\nEssa fonte alimenta quatro comportamentos que antes podiam divergir:\n\n- o trecho metodológico enviado ao modelo por `buildValMethodologyPrompt()`;\n- a inferência determinística de `deriveValMethodology()`;\n- as perguntas do fallback por `buildValStageQuestions()`;\n- os enums estritos de `methodology_state` no `valAdviceSchema`.\n\n`applyValWorkingStage()` também usa a porta definida na mesma etapa. Assim, selecionar uma etapa de trabalho não altera o avanço real, e prompt, fallback e schema não precisam manter cópias independentes da sequência. Alterar uma etapa exige atualizar a definição canônica e os testes; não é permitido editar somente o texto do prompt.\n\n'''
if docs.count(marker)!=1:
    raise RuntimeError('A4: marcador de instruções modulares não encontrado')
doc_path.write_text(docs.replace(marker,section+marker,1))

Path('test/val-methodology-source.test.js').write_text(r'''import assert from 'node:assert/strict'
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
''')

Path('scripts/apply-a4.py').unlink(missing_ok=True)
Path('.github/workflows/apply-a4.yml').unlink(missing_ok=True)
print('A4 aplicado com sucesso.')
