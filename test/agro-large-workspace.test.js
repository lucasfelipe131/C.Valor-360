import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const agro=readFileSync(new URL('../src/pages/Agro.jsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../src/agro-workspace.css',import.meta.url),'utf8')
const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')

test('Inteligência Agronômica abre com área útil maior no desktop e no celular',()=>{
 assert.match(agro,/agro-large-page/)
 assert.match(css,/width:calc\(100% \+ 56px\)/)
 assert.match(css,/height:max\(820px,calc\(100vh - 96px\)\)/)
 assert.match(css,/@media\(max-width:760px\)/)
 assert.match(css,/width:calc\(100% \+ 28px\)/)
})

test('ambiente técnico oferece expansão real e saída acessível',()=>{
 assert.match(agro,/requestFullscreen/)
 assert.match(agro,/document\.exitFullscreen/)
 assert.match(agro,/fullscreenchange/)
 assert.match(agro,/Tela cheia/)
 assert.match(agro,/Reduzir/)
 assert.match(agro,/aria-pressed=\{expanded\}/)
 assert.match(css,/\.agro-native-workspace\.is-expanded/)
 assert.match(css,/\.agro-native-workspace:fullscreen/)
})

test('novo estilo entra no bundle principal',()=>{
 assert.match(main,/import '\.\/agro-workspace\.css'/)
})
