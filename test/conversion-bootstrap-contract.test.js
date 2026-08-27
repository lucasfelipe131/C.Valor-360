import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
const innovationBootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
const start=readFileSync(new URL('../server/start.js',import.meta.url),'utf8')
const composition=readFileSync(new URL('../server/core/composition.js',import.meta.url),'utf8')
const engine=readFileSync(new URL('../server/conversion-engine.js',import.meta.url),'utf8')
const specificity=readFileSync(new URL('../server/val-specificity.js',import.meta.url),'utf8')
const golden=JSON.parse(readFileSync(new URL('../evals/conversion-golden.json',import.meta.url),'utf8'))

test('produção instala explicitamente o núcleo determinístico, as inovações e depois o servidor',()=>{
  assert.equal(packageJson.scripts.start,'node server/start.js')
  assert.match(start,/installValRuntimeComposition\(\)/)
  assert.ok(start.indexOf('installValRuntimeComposition()')<start.indexOf("import('../server.js')"))
  assert.ok(composition.indexOf('installConversionComposition()')<composition.indexOf('installInnovationComposition()'))
  assert.match(bootstrap,/ValEngine\.prototype\.answer/)
  assert.match(bootstrap,/ValRepository\.prototype\.recordRecommendation/)
  assert.match(bootstrap,/decisionMode:'deterministic_facts_structured_reasoning'/)
  assert.match(bootstrap,/generativeRole:'structured_reasoning_with_deterministic_reconciliation'/)
  assert.match(bootstrap,/textRequestsUseSlimLanguageEnhancer:false/)
  assert.match(bootstrap,/textRequestsUseStructuredReasoning:true/)
  assert.match(bootstrap,/specificityEngine:specificityVersion/)
  assert.match(innovationBootstrap,/ValRepository\.prototype\.getClientContext/)
  assert.match(bootstrap,/export function installConversionComposition/)
  assert.match(innovationBootstrap,/export function installInnovationComposition/)
})

test('núcleo declara regras de não invenção, reconciliação e especificidade final',()=>{
  assert.match(engine,/noInventedAmount/)
  assert.match(engine,/noInventedProbability/)
  assert.match(engine,/generic_response_blocked=true/)
  assert.match(engine,/decision_source='deterministic_conversion_core'/)
  assert.match(engine,/conversion_probability:null/)
  assert.match(specificity,/numberTokens/)
  assert.match(specificity,/safetyBlocked/)
  assert.match(specificity,/enforceValSpecificity/)
})

test('dataset dourado cobre conversão, preço, lacunas e revisão técnica',()=>{
  assert.equal(golden.version,'val-conversion-core-v1')
  assert.ok(golden.cases.length>=5)
  const workflows=new Set(golden.cases.map(item=>item.expected.workflow))
  for(const required of ['fechar_compromisso','defender_valor','completar_contexto','validar_contexto_tecnico'])assert.ok(workflows.has(required))
})
