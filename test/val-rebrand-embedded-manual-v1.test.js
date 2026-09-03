import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'

// O Manual do Agrônomo é um app Next.js separado, embutido na VAL por iframe em
// /tecnico. Para o usuário não existe fronteira: ele continua "dentro da VAL".
// A marca e as regras de toque precisam valer dos dois lados.
//
// A PALETA do app embutido é a mesma da VAL e foi preservada: o rebrand trocou
// a marca, não as cores.

const sheets=['manual/app/globals.css','manual/app/val-embedded-brand.css','manual/app/FieldMap.module.css'].filter(existsSync)


test('a superfície embutida existe e é lida por este contrato',()=>{
 assert.ok(sheets.length>=2,'as folhas do app embutido não foram encontradas')
})

test('a marca embutida usa o ativo oficial servido pelo app pai',()=>{
 const brand=readFileSync('manual/app/val-embedded-brand.css','utf8')
 assert.match(brand,/url\('\/val-logo\.svg'\)/)
 // O arquivo servido é o gerado a partir da geometria aprovada.
 const logo=readFileSync('public/val-logo.svg','utf8')
 assert.ok(logo.includes('M30.6 61C32.8 45.6 39.4 24.4 52.4 3'),'a folha oficial não está no ativo servido')
})

test('as calculadoras empilham no mobile em vez de exigir arraste horizontal',()=>{
 const globals=readFileSync('manual/app/globals.css','utf8')
 const mobile=globals.slice(globals.indexOf('@media (max-width: 860px)'))
 assert.ok(mobile.length>0,'o breakpoint mobile do app embutido sumiu')
 // O formulário de cálculo vira coluna única.
 assert.match(mobile,/\.field-grid-form,\s*\n\s*\.field-grid-form\.three \{[^}]*grid-template-columns: 1fr/)
 // O espaço de trabalho da calculadora também.
 assert.match(mobile,/\.calculator-workspace \{[^}]*grid-template-columns: 1fr/)
})

test('os campos de cálculo respeitam alvo de toque no mobile',()=>{
 const globals=readFileSync('manual/app/globals.css','utf8')
 const mobile=globals.slice(globals.indexOf('@media (max-width: 860px)'))
 const heights=[...mobile.matchAll(/\.(input-wrap|field select)[^{]*\{[^}]*min-height:\s*(\d+)px/g)].map(match=>Number(match[2]))
 assert.ok(heights.length>0,'não há altura declarada para os campos no mobile')
 for(const height of heights)assert.ok(height>=44,`campo com ${height}px fica abaixo do alvo de toque de 44px`)
})
