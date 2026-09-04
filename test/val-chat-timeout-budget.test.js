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

test('a documentação distingue deadlines atuais do teto defensivo legado',()=>{
  assert.match(engineDocs,/Orçamento de tempo do cliente/)
  assert.match(engineDocs,/deadline total do modelo conversacional \| 20 s/)
  assert.match(engineDocs,/deadline do módulo obrigatório no Core \| 22 s/)
  assert.match(engineDocs,/timeout visível do Copilot full-screen \| 30 s/)
  assert.match(engineDocs,/teto defensivo das duas interfaces legadas \| 120 s/)
  assert.match(engineDocs,/query PostgreSQL já em voo não é revertida/)
})
