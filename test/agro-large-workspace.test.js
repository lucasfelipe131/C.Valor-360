import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const agro=readFileSync(new URL('../src/pages/Agro.jsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../src/agro-workspace.css',import.meta.url),'utf8')
const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')

test('Inteligência Agronômica usa toda a área útil e mantém somente um cabeçalho básico',()=>{
 assert.match(agro,/agro-full-page/)
 assert.match(agro,/agro-minimal-header/)
 assert.doesNotMatch(agro,/agro-native-hero|agro-capability-strip|agro-native-footnote/)
 assert.match(css,/width:calc\(100% \+ 56px\)/)
 assert.match(css,/min-height:calc\(100dvh - 92px\)/)
 assert.match(css,/grid-template-rows:58px minmax\(0,1fr\)/)
 assert.match(css,/height:calc\(100dvh - 150px\)/)
 assert.match(css,/@media\(max-width:760px\)/)
 assert.match(css,/\.agro-full-page\{[\s\S]*width:100%/)
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

test('estilos do ambiente e da marca final entram no bundle principal',()=>{
 assert.match(main,/import '\.\/agro-workspace\.css'/)
 assert.match(main,/import '\.\/val-logo-final\.css'/)
})
