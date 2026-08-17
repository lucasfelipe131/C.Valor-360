import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('Centro de Decisão da VAL não força largura maior que o viewport móvel',()=>{
 const css=read('src/val-mobile-overflow.css')
 const main=read('src/main.jsx')
 assert.match(main,/import '\.\/val-mobile-overflow\.css'/)
 assert.ok(main.indexOf("./val-mobile-overflow.css")>main.indexOf("./mobile-login.css"))
 assert.match(css,/@media \(max-width: 820px\)/)
 assert.match(css,/\.val-decision-workspace[\s\S]*max-width: 100%/)
 assert.match(css,/\.vdc-hero[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/)
 assert.match(css,/\.vdc-decision-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/)
 assert.match(css,/\.vdc-layer-grid[\s\S]*overflow-x: auto !important/)
 assert.match(css,/\.vdc-composer[\s\S]*grid-template-columns: 24px minmax\(0, 1fr\) 46px !important/)
 assert.match(css,/padding-bottom: calc\(132px \+ env\(safe-area-inset-bottom\)\) !important/)
})
