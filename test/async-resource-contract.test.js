import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const hook=read('../src/hooks/useAsyncResource.js')
const files={
 ValPanel:read('../src/components/ValPanel.jsx'),
 ValDecisionWorkspace:read('../src/components/ValDecisionWorkspace.jsx'),
 SogWorkspace:read('../src/components/SogWorkspace.jsx'),
 AccessManagement:read('../src/components/AccessManagement.jsx'),
 ProducerBusinessOverview:read('../src/components/ProducerBusinessOverview.jsx')
}

test('as cinco telas usam o contrato assíncrono compartilhado',()=>{
 for(const [name,source] of Object.entries(files)){
  assert.match(source,/useAsyncResource/,`${name} precisa usar o hook compartilhado`)
 }
 assert.doesNotMatch(files.ValPanel,/useState\(\{loading:true,data:null,error:''\}\)/)
 assert.doesNotMatch(files.ValDecisionWorkspace,/useState\(\{loading:true,data:null,error:''\}\)/)
 assert.doesNotMatch(files.ProducerBusinessOverview,/setState\(\{loading:false,data,error:''\}\)/)
 assert.doesNotMatch(files.SogWorkspace,/const \[workspace,setWorkspace\]=useState/)
 assert.doesNotMatch(files.AccessManagement,/const \[loading,setLoading\]=useState/)
})

test('hook cancela requisição anterior, bloqueia resposta atrasada e centraliza sessão expirada',()=>{
 assert.match(hook,/controllerRef\.current\?\.abort\(\)/)
 assert.match(hook,/sequenceRef\.current===sequence/)
 assert.match(hook,/valor360:unauthorized/)
 assert.match(hook,/normalizeAsyncError/)
 assert.match(hook,/requestJsonResource/)
})

test('timeouts e cópias de erro ficam definidos junto ao recurso',()=>{
 assert.match(files.ValPanel,/timeoutMs:8_000/)
 assert.match(files.ValDecisionWorkspace,/timeoutMs:8_000/)
 assert.match(files.ProducerBusinessOverview,/timeoutMs:12_000/)
 assert.match(files.SogWorkspace,/timeoutMs:15_000/)
 assert.match(files.AccessManagement,/timeoutMs:10_000/)
 assert.match(files.ProducerBusinessOverview,/A consolidação demorou além do limite/)
 assert.match(files.SogWorkspace,/A SOG demorou além do limite para carregar a carteira/)
 assert.match(files.AccessManagement,/A consulta de acessos demorou além do limite/)
})
