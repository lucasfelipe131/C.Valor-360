import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const valPanel=readFileSync(new URL('../src/components/ValPanel.jsx',import.meta.url),'utf8')
const decisionWorkspace=readFileSync(new URL('../src/components/ValDecisionWorkspace.jsx',import.meta.url),'utf8')
const engineDocs=readFileSync(new URL('../docs/VAL_ENGINE.md',import.meta.url),'utf8')

function valChatTimeout(source,fileName){
  const endpointIndex=source.indexOf("fetch('/api/val/chat'")
  assert.notEqual(endpointIndex,-1,`${fileName} precisa chamar POST /api/val/chat`)
  const requestBlock=source.slice(Math.max(0,endpointIndex-600),endpointIndex+800)
  const timeouts=[...requestBlock.matchAll(/AbortSignal\.timeout\((\d+)\)/g)]
  assert.ok(timeouts.length,`${fileName} precisa aplicar timeout à chamada da VAL`)
  return Number(timeouts.at(-1)[1])
}

test('as duas telas usam o mesmo orçamento de 120 segundos para o chat da VAL',()=>{
  const panelTimeout=valChatTimeout(valPanel,'ValPanel.jsx')
  const workspaceTimeout=valChatTimeout(decisionWorkspace,'ValDecisionWorkspace.jsx')

  assert.equal(panelTimeout,120_000)
  assert.equal(workspaceTimeout,120_000)
  assert.equal(panelTimeout,workspaceTimeout)
  assert.ok(panelTimeout>100_000,'o cliente precisa ter folga acima do teto do provedor no servidor')
})

test('a documentação explica a folga entre provedor, pós-processamento e navegador',()=>{
  assert.match(engineDocs,/Orçamento de tempo do cliente/)
  assert.match(engineDocs,/chamada ao provedor no backend \| 100 s/)
  assert.match(engineDocs,/reconciliação, anexos e persistência \| 15 s/)
  assert.match(engineDocs,/transporte e entrega ao navegador \| 5 s/)
  assert.match(engineDocs,/timeout total do cliente\*\* \| \*\*120 s/)
})
