import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
const engine=readFileSync(new URL('../server/conversion-engine.js',import.meta.url),'utf8')
const golden=JSON.parse(readFileSync(new URL('../evals/conversion-golden.json',import.meta.url),'utf8'))

test('produção carrega o núcleo determinístico antes do servidor',()=>{
  assert.match(packageJson.scripts.start,/--import\s+\.\/server\/conversion-bootstrap\.js\s+server\.js/)
  assert.match(bootstrap,/ValEngine\.prototype\.answer/)
  assert.match(bootstrap,/ValRepository\.prototype\.recordRecommendation/)
  assert.match(bootstrap,/decisionMode:'deterministic_first'/)
  assert.match(bootstrap,/generativeRole:'language_summary_only'/)
})

test('núcleo declara regras de não invenção e reconciliação final',()=>{
  assert.match(engine,/noInventedAmount/)
  assert.match(engine,/noInventedProbability/)
  assert.match(engine,/generic_response_blocked=true/)
  assert.match(engine,/decision_source='deterministic_conversion_core'/)
  assert.match(engine,/conversion_probability:null/)
})

test('dataset dourado cobre conversão, preço, lacunas e revisão técnica',()=>{
  assert.equal(golden.version,'val-conversion-core-v1')
  assert.ok(golden.cases.length>=5)
  const workflows=new Set(golden.cases.map(item=>item.expected.workflow))
  for(const required of ['fechar_compromisso','defender_valor','completar_contexto','validar_contexto_tecnico'])assert.ok(workflows.has(required))
})
