import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'

// O Manual do Agrônomo é um app Next.js separado, embutido na VAL por iframe em
// /tecnico. Para o usuário não existe fronteira: ele continua "dentro da VAL".
// Logo a identidade e as regras de toque precisam valer dos dois lados.

const sheets=['manual/app/globals.css','manual/app/val-embedded-brand.css','manual/app/FieldMap.module.css'].filter(existsSync)
const css=sheets.map(file=>readFileSync(file,'utf8')).join('\n')

const rgbToHsl=([r,g,b])=>{
 const R=r/255,G=g/255,B=b/255
 const max=Math.max(R,G,B),min=Math.min(R,G,B),d=max-min
 const l=(max+min)/2
 if(!d)return [0,0,l]
 const s=l>0.5?d/(2-max-min):d/(max+min)
 const h=max===R?((G-B)/d+(G<B?6:0)):max===G?(B-R)/d+2:(R-G)/d+4
 return [h*60,s,l]
}

test('a superfície embutida existe e é lida por este contrato',()=>{
 assert.ok(sheets.length>=2,'as folhas do app embutido não foram encontradas')
})

test('a identidade não quebra na fronteira do iframe',()=>{
 const residual=[]
 for(const match of css.matchAll(/#([0-9a-fA-F]{6})\b/g)){
  const rgb=[0,2,4].map(index=>parseInt(match[1].slice(index,index+2),16))
  const [hue,saturation]=rgbToHsl(rgb)
  if(saturation>=0.18&&hue>=185&&hue<=245)residual.push(match[0])
 }
 for(const match of css.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)){
  const [hue,saturation]=rgbToHsl([+match[1],+match[2],+match[3]])
  if(saturation>=0.18&&hue>=185&&hue<=245)residual.push(match[0])
 }
 assert.deepEqual(residual,[],`azul da identidade anterior sobreviveu dentro do iframe:\n${residual.slice(0,10).join('\n')}`)
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
