import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
const center=readFileSync(new URL('../src/components/ValDecisionWorkspace.jsx',import.meta.url),'utf8')
const panel=readFileSync(new URL('../src/components/ValPanel.jsx',import.meta.url),'utf8')
const feedback=readFileSync(new URL('../src/components/ValProgressFeedback.jsx',import.meta.url),'utf8')
const progressClient=readFileSync(new URL('../src/lib/val-progress-client.js',import.meta.url),'utf8')

test('backend expõe progresso protegido e vinculado ao usuário autenticado',()=>{
  assert.ok(server.includes("url.pathname==='/api/val/progress'"))
  assert.ok(server.includes('progressOwnerKey(identity,request)'))
  assert.match(server,/valProgress\.get\(\{requestId,tenantId:/)
  assert.match(server,/valProgress\.start\(\{requestId,tenantId,ownerId:/)
  assert.ok(server.includes('onProgress:stage=>valProgress.update'))
  assert.ok(server.includes('valProgress.fail'))
})

test('motor sinaliza as etapas calculadas antes da resposta final',()=>{
  for(const stage of ['context','products','language','persist','complete'])assert.match(bootstrap,new RegExp("emitProgress\\(input,'"+stage+"'\\)"))
})

test('as duas interfaces acompanham a mesma requisição estratégica',()=>{
  for(const source of [center,panel]){
    assert.match(source,/createValProgressRequestId/)
    assert.match(source,/startValProgressPolling/)
    assert.match(source,/requestId/)
    assert.match(source,/ValProgressFeedback/)
  }
  assert.match(feedback,/VAL_PROGRESS_STEPS/)
  assert.match(progressClient,/Cruzando histórico e sinais/)
  assert.match(progressClient,/Comparando alternativas de produto/)
  assert.match(progressClient,/Redigindo a recomendação/)
})
