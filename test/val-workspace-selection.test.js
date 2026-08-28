import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('VAL exposes separate and selectable environments for inputs and grains',()=>{
 const workspace=read('src/components/ValWorkspace.jsx')
 assert.match(workspace,/title:'VAL Insumos'/)
 assert.match(workspace,/title:'VAL Grãos'/)
 assert.match(workspace,/onModeChange\(id\)/)
 assert.match(workspace,/role="tablist" aria-label="Ambiente ativo"/)
 assert.match(workspace,/aria-selected=\{mode==='insumos'\}/)
 assert.match(workspace,/aria-selected=\{mode==='graos'\}/)
 assert.match(workspace,/A seleção não altera nem duplica a carteira/)
})

test('grain environment opens the operational SOG without mixing the inputs journey',()=>{
 const workspace=read('src/components/ValWorkspace.jsx')
 assert.match(workspace,/import SogWorkspace/)
 assert.match(workspace,/status:'SOG operacional'/)
 assert.match(workspace,/Intenções reais/)
 assert.match(workspace,/Mercado com fonte/)
 assert.match(workspace,/mode==='graos'[\s\S]*<SogWorkspace clients=\{clients\}/)
 const sog=read('src/components/SogWorkspace.jsx')
 for(const label of ['Oportunidades','Intenções','Mercado','Produtores','Alimentação'])assert.match(sog,new RegExp(label))
 assert.match(sog,/Nenhuma intenção é presumida/)
 assert.match(sog,/sem execução automática/)
 assert.match(sog,/A SOG não busca nem inventa cotações/)
})

test('direct producer preparation opens the focused visit journey while VAL navigation opens the selector',()=>{
 const app=read('src/App.jsx')
 assert.match(app,/const \[valMode,setValMode\]=useState\(null\)/)
 assert.match(app,/const prepareClient=c=>\{if\(!c\?\.id\)return;setSelected\(c\);setPrepareVisitClientId\(c\.id\);setPage\('visits'\)/)
 assert.match(app,/if\(next==='val'\)setValMode\(null\)/)
 assert.match(app,/<ValWorkspace mode=\{valMode\} onModeChange=\{setValMode\}[^>]*onPrepareVisit=\{prepareClient\}/)
 assert.match(app,/<Visits[^>]*initialClientId=\{prepareVisitClientId\}/)
 assert.match(app,/valMode==='graos'\?\['VAL Grãos'/)
})

test('VAL environment selection remains usable on smartphones',()=>{
 const styles=read('src/styles.css')
 assert.match(styles,/\.val-environment-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(styles,/@media\(max-width:760px\)[\s\S]*\.val-environment-grid\{grid-template-columns:1fr/)
 assert.match(styles,/\.sog-tabs\{display:flex;min-width:0;overflow-x:auto/)
 assert.match(styles,/@media\(max-width:760px\)[\s\S]*\.sog-modal-backdrop\{align-items:end/)
 assert.match(styles,/@media\(max-width:760px\)[\s\S]*\.sog-opportunity-metrics\{grid-template-columns:1fr 1fr/)
 assert.match(styles,/@media\(max-width:430px\)[\s\S]*\.val-environment-switcher\{display:grid;grid-template-columns:1fr\}/)
})
