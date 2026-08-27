import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')
const hash=relative=>createHash('sha256').update(read(relative)).digest('hex')

const brandAssets=[
 'public/brand/val-logo-on-light.svg',
 'public/brand/val-logo-on-dark.svg',
 'public/brand/val-logo-monochrome.svg',
 'public/brand/val-logo-monochrome-light.svg',
 'public/brand/val-logo-compact.svg',
 'public/brand/val-icon-only.svg',
 'public/brand/val-icon-only-on-dark.svg',
 'public/brand/val-icon-only-monochrome.svg',
 'public/brand/val-icon-maskable.svg'
]

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
 assert.match(css,/--val-logo-word:#082c57/)
 assert.match(css,/--val-logo-word:#f4f8f6/)
 assert.match(css,/\[data-val-surface="dark"\]/)
 assert.match(css,/\.sidebar \.val-brand\.is-surface-auto/)
 assert.match(css,/\.public-welcome \.val-brand\.is-surface-auto/)
 assert.ok(contrast('#082C57','#FFFFFF')>=4.5)
 assert.ok(contrast('#F4F8F6','#071B19')>=4.5)
})

test('folha refinada é orgânica, simplificável e sem a cunha rígida antiga',()=>{
 const logo=read('src/components/Logo.jsx')
 const css=read('src/val-brand.css')
 assert.match(logo,/M40\.8 28\.8C41\.8 17\.4 48\.5 8\.9 58\.2 6\.2/)
 assert.match(logo,/val-logo-detail/)
 assert.match(css,/is-icon-only \.val-logo-detail/)
 assert.doesNotMatch(logo,/leafShade|val-leaf-shade|M42\.1 28\.5/)
})

test('catálogo vetorial contém dark, light, mono, compact, icon-only e maskable',()=>{
 for(const relative of brandAssets){
  assert.equal(existsSync(join(root,relative)),true,`${relative} ausente`)
  const source=read(relative)
  assert.match(source,/^<svg[\s\S]*<\/svg>\s*$/)
  assert.match(source,/viewBox=/)
  assert.doesNotMatch(source,/leafShade|65ED22|58E21A/)
 }
 assert.match(read('public/brand/val-logo-on-light.svg'),/#082C57/)
 assert.match(read('public/brand/val-logo-on-dark.svg'),/#F4F8F6/)
 assert.match(read('public/brand/val-logo-monochrome.svg'),/currentColor/)
 assert.match(read('public/brand/val-logo-compact.svg'),/width="420" height="128"/)
})

test('aliases públicos permanecem estáveis e sincronizados',()=>{
 assert.equal(hash('logo.svg'),hash('public/val-logo.svg'))
 assert.match(read('public/val-logo.svg'),/M40\.8 28\.8C41\.8 17\.4/)
 assert.match(read('public/icon.svg'),/fill="url\(#surface\)"/)
 assert.match(read('public/icon.svg'),/transform="translate\(7 7\) scale\(\.78\)"/)
})

test('manifesto separa ícones any, maskable e monochrome',()=>{
 const manifest=JSON.parse(read('public/manifest.webmanifest'))
 const byPurpose=Object.fromEntries(manifest.icons.map(icon=>[icon.purpose,icon]))
 assert.equal(byPurpose.any.src,'/icon.svg')
 assert.equal(byPurpose.maskable.src,'/brand/val-icon-maskable.svg')
 assert.equal(byPurpose.monochrome.src,'/brand/val-icon-only-monochrome.svg')
 assert.notEqual(byPurpose.any.src,byPurpose.maskable.src)
 assert.match(read('index.html'),/rel="mask-icon" href="\/brand\/val-icon-only-monochrome\.svg" color="#071B19"/)
})
