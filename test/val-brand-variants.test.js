import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

// Contrato da MARCA OFICIAL da VAL: o V em marfim/floresta com a folha em
// verde-oliva, o wordmark VAL e a assinatura INTELIGÊNCIA QUE GERA VALOR.
// Substituiu a marca anterior (traço azul + folha verde-água) no rebrand R1.
// Ver docs/rebrand/VAL_BRAND_SYSTEM.md.

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')
const hash=relative=>createHash('sha256').update(read(relative)).digest('hex')

const brandAssets=[
 'public/brand/val-logo-on-light.svg',
 'public/brand/val-logo-on-dark.svg',
 'public/brand/val-logo-monochrome.svg',
 'public/brand/val-logo-monochrome-light.svg',
 'public/brand/val-logo-compact.svg',
 'public/brand/val-logo-vertical-on-light.svg',
 'public/brand/val-logo-vertical-on-dark.svg',
 'public/brand/val-icon-only.svg',
 'public/brand/val-icon-only-on-dark.svg',
 'public/brand/val-icon-only-monochrome.svg',
 'public/brand/val-icon-maskable.svg'
]

// Geometria aprovada. Se mudar aqui, muda no componente e no gerador.
const STEM='M3.6 5.2H17.8L33.4 53.6L30.2 61.2Z'
const LEAF='M30.6 61C32.8 45.6 39.4 24.4 52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61Z'

const luminance=hex=>{
 const channels=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.03928?value/12.92:((value+.055)/1.055)**2.4)
 return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]
}
const contrast=(first,second)=>{
 const values=[luminance(first),luminance(second)].sort((a,b)=>b-a)
 return (values[0]+.05)/(values[1]+.05)
}

test('componente da marca oferece variantes e mantém o compact legado',()=>{
 const logo=read('src/components/Logo.jsx')
 assert.match(logo,/new Set\(\['full','compact','icon-only','monochrome'\]\)/)
 assert.match(logo,/compact\?'icon-only'/)
 assert.match(logo,/data-logo-variant=\{resolvedVariant\}/)
 assert.match(logo,/data-logo-surface=\{resolvedSurface\}/)
 assert.match(logo,/is-surface-\$\{resolvedSurface\}/)
 assert.match(logo,/resolvedVariant==='full'/)
 assert.match(logo,/INTELIGÊNCIA QUE GERA VALOR/)
 assert.match(logo,/aria-label/)
 assert.match(logo,/decorative\?\{role:'presentation','aria-label':undefined,'aria-hidden':true\}/)
})

test('superfícies clara e escura usam wordmarks com contraste forte',()=>{
 const css=read('src/val-brand.css')
 assert.match(css,/--val-logo-word:#12291b/)
 assert.match(css,/--val-logo-word:#edede6/)
 assert.match(css,/\[data-val-surface="dark"\]/)
 assert.match(css,/\.sidebar \.val-brand\.is-surface-auto/)
 assert.match(css,/\.public-welcome \.val-brand\.is-surface-auto/)
 assert.ok(contrast('#12291B','#FFFFFF')>=4.5,'wordmark escuro precisa passar em fundo claro')
 assert.ok(contrast('#EDEDE6','#0D1F15')>=4.5,'wordmark marfim precisa passar em fundo floresta')
 // O verde da assinatura também é lido, não é só decoração.
 assert.ok(contrast('#9BC85A','#0D1F15')>=4.5,'assinatura precisa passar em fundo floresta')
})

test('o V e a folha são a geometria oficial, sem resquício da marca antiga',()=>{
 const logo=read('src/components/Logo.jsx')
 assert.ok(logo.includes(STEM),'o braço do V não é o oficial')
 assert.ok(logo.includes(LEAF),'a folha não é a oficial')
 assert.match(logo,/val-logo-detail/)
 assert.match(logo,/val-logo-fold/)
 assert.match(read('src/val-brand.css'),/is-icon-only \.val-logo-detail/)
 // Marca anterior: traço azul em "raio" com folha verde-água.
 assert.doesNotMatch(logo,/M40\.8 28\.8|M12\.5 10\.1|val-logo-blue|#0757b6|#2d8cff|#082c57/i)
})

test('catálogo vetorial contém dark, light, mono, compact, vertical, icon-only e maskable',()=>{
 for(const relative of brandAssets){
  assert.equal(existsSync(join(root,relative)),true,`${relative} ausente`)
  const source=read(relative)
  assert.match(source,/^<svg[\s\S]*<\/svg>\s*$/)
  assert.match(source,/viewBox=/)
  assert.match(source,/<title id="title">VAL — inteligência que gera valor<\/title>/)
  assert.doesNotMatch(source,/#0757B6|#2D8CFF|#082C57|#00C896/i)
 }
 assert.match(read('public/brand/val-logo-on-light.svg'),/#12291B/)
 assert.match(read('public/brand/val-logo-on-dark.svg'),/#EDEDE6/)
 assert.match(read('public/brand/val-logo-monochrome.svg'),/currentColor/)
 assert.match(read('public/brand/val-icon-only-monochrome.svg'),/currentColor/)
})

test('as variantes derivam do gerador, nunca de desenho manual',()=>{
 const generator=read('scripts/build-brand-assets.mjs')
 assert.ok(generator.includes(STEM)&&generator.includes(LEAF),'o gerador saiu de sincronia com o componente')
 for(const relative of brandAssets)assert.match(generator,new RegExp(relative.replace(/[/.]/g,'\\$&')))
})

test('aliases públicos permanecem estáveis e sincronizados',()=>{
 assert.equal(hash('logo.svg'),hash('public/val-logo.svg'))
 assert.ok(read('public/val-logo.svg').includes(LEAF))
 // O favicon é o símbolo sobre a superfície floresta da marca.
 assert.match(read('public/icon.svg'),/<rect width="64" height="64" fill="#0D1F15"\/>/)
 assert.ok(read('public/icon.svg').includes(STEM))
 // O maskable respeita a zona segura: a marca ocupa o centro reduzido.
 assert.match(read('public/brand/val-icon-maskable.svg'),/scale\(\.72\)/)
})

test('manifesto separa ícones any, maskable e monochrome',()=>{
 const manifest=JSON.parse(read('public/manifest.webmanifest'))
 const byPurpose=Object.fromEntries(manifest.icons.map(icon=>[icon.purpose,icon]))
 assert.equal(byPurpose.any.src,'/icon.svg')
 assert.equal(byPurpose.maskable.src,'/brand/val-icon-maskable.svg')
 assert.equal(byPurpose.monochrome.src,'/brand/val-icon-only-monochrome.svg')
 assert.notEqual(byPurpose.any.src,byPurpose.maskable.src)
 assert.equal(manifest.theme_color,'#0D1F15')
 assert.equal(manifest.background_color,'#0D1F15')
 assert.match(read('index.html'),/rel="mask-icon" href="\/brand\/val-icon-only-monochrome\.svg" color="#0D1F15"/)
 assert.match(read('index.html'),/name="theme-color" content="#0D1F15"/)
})
