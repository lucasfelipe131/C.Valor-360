import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

test('dataset dourado da VAL mantém contrato auditável',async()=>{
  const cases=JSON.parse(await readFile(new URL('../evals/val-golden.json',import.meta.url),'utf8'))
  assert.ok(cases.length>=8)
  const ids=new Set()
  for(const item of cases){
    assert.ok(item.id&&!ids.has(item.id));ids.add(item.id)
    assert.ok(item.input?.message)
    assert.ok(Array.isArray(item.must_include)&&item.must_include.length)
    assert.ok(Array.isArray(item.must_not_include))
    assert.equal(typeof item.requires_human_review,'boolean')
  }
})
