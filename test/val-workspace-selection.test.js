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

test('grain environment is an honest foundation for a future operations panel',()=>{
 const workspace=read('src/components/ValWorkspace.jsx')
 for(const label of ['Originação','Oportunidades de compra','Contratos e posição','Entregas e execução'])assert.match(workspace,new RegExp(label))
 assert.match(workspace,/Fundação do ambiente ativa/)
 assert.match(workspace,/O painel operacional entra na próxima evolução/)
 assert.match(workspace,/Sem dados fictícios/)
 assert.match(workspace,/Cotação, saldo e posição só aparecerão após integração com uma fonte verificável/)
})

test('direct producer preparation keeps using inputs while VAL navigation opens the selector',()=>{
 const app=read('src/App.jsx')
 assert.match(app,/const \[valMode,setValMode\]=useState\(null\)/)
 assert.match(app,/const prepareClient=c=>\{setSelected\(c\);setValMode\('insumos'\);setPage\('val'\)/)
 assert.match(app,/if\(next==='val'\)setValMode\(null\)/)
 assert.match(app,/<ValWorkspace mode=\{valMode\} onModeChange=\{setValMode\}/)
 assert.match(app,/valMode==='graos'\?\['VAL Grãos'/)
})

test('VAL environment selection remains usable on smartphones',()=>{
 const styles=read('src/styles.css')
 assert.match(styles,/\.val-environment-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(styles,/@media\(max-width:760px\)[\s\S]*\.val-environment-grid\{grid-template-columns:1fr/)
 assert.match(styles,/@media\(max-width:760px\)[\s\S]*\.val-grains-roadmap>div\{grid-template-columns:1fr/)
 assert.match(styles,/\.val-grains-actions button\{min-height:45px/)
 assert.match(styles,/@media\(max-width:430px\)[\s\S]*\.val-environment-switcher\{display:grid;grid-template-columns:1fr\}/)
})
