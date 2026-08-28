import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const agro=readFileSync(new URL('../src/pages/Agro.jsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../src/agro-workspace.css',import.meta.url),'utf8')
const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')

test('Inteligência Agronômica combina hub nativo e ferramenta técnica em área útil ampla',()=>{
 assert.match(agro,/agro-decision-page/)
 assert.match(agro,/agro-capability-groups/)
 assert.match(agro,/agro-tool-workspace/)
 assert.match(agro,/agro-minimal-header/)
 assert.match(agro,/CAMPO E SOLO/)
 assert.match(agro,/DECISÃO TÉCNICA/)
 assert.match(agro,/CONHECIMENTO/)
 assert.match(css,/\.agro-decision-page\{/)
 assert.match(css,/\.agro-tool-workspace\{[\s\S]*min-height:calc\(100dvh - 150px\)/)
 assert.match(css,/\.agro-tool-workspace iframe\{[\s\S]*height:calc\(100dvh - 215px\)/)
 assert.match(css,/@media\(max-width:760px\)/)
 assert.match(css,/@media\(max-width:700px\)\{\.agro-decision-page/)
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
