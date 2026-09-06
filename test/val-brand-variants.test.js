import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync,statSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

// Contrato da MARCA OFICIAL da VAL.
//
// A logo é um ativo raster entregue pelo cliente: V com textura de pedra, duas
// lâminas de folha sobrepostas, wordmark com contorno próprio e assinatura.
// Uma tentativa anterior redesenhou tudo em SVG — o briefing proíbe
// explicitamente ("NÃO redesenhar, NÃO aproximar por CSS, usar o asset oficial
// fornecido") e o desenho foi recusado.
//
// Este arquivo existe para impedir que a aproximação volte.

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')
const size=relative=>statSync(join(root,relative)).size

const PIECES=[
 'public/brand/val-logo-official.png',
 'public/brand/val-symbol-official.png',
 'public/brand/val-wordmark-official.png',
 'public/brand/val-wordmark-only-official.png',
 'public/brand/val-signature-official.png'
]

// Geometria da marca anterior e da minha aproximação: nenhuma pode voltar.
const DESENHOS_PROIBIDOS=[
 'M12.5 10.1',      // traço azul da marca antiga
 'M40.8 28.8',      // folha verde-água da marca antiga
 'M3.6 5.2H17.8',   // braço do V redesenhado
 'M30.6 61C32.8'    // folha redesenhada
]

test('as peças oficiais existem e têm massa de imagem real',()=>{
 for(const piece of PIECES){
  assert.equal(existsSync(join(root,piece)),true,`${piece} ausente`)
  assert.ok(size(piece)>8000,`${piece} é pequeno demais para ser o recorte do ativo`)
 }
})

test('o componente usa o arquivo oficial, não um desenho',()=>{
 const logo=read('src/components/Logo.jsx')
 assert.match(logo,/\/brand\/val-symbol-official\.png/)
 assert.match(logo,/\/brand\/val-wordmark-only-official\.png/)
 assert.match(logo,/\/brand\/val-signature-official\.png/)
 assert.match(logo,/<img/)
 // Nenhum path vetorial: se voltar `<path d="…">`, é redesenho.
 assert.ok(!/<path\s/.test(logo),'a marca voltou a ser desenhada em SVG')
 assert.ok(!/<svg/.test(logo),'a marca voltou a ser desenhada em SVG')
 for(const desenho of DESENHOS_PROIBIDOS)
  assert.ok(!logo.includes(desenho),`geometria proibida "${desenho}" voltou ao componente`)
})

test('o componente mantém a API que o produto inteiro já usa',()=>{
 const logo=read('src/components/Logo.jsx')
 assert.match(logo,/new Set\(\['full','compact','icon-only','monochrome'\]\)/)
 assert.match(logo,/compact\?'icon-only'/)
 assert.match(logo,/data-logo-variant=\{resolvedVariant\}/)
 assert.match(logo,/data-logo-surface=\{resolvedSurface\}/)
 assert.match(logo,/is-surface-\$\{resolvedSurface\}/)
 assert.match(logo,/const accessibility=decorative/)
 assert.match(logo,/'aria-hidden':true/)
 assert.match(logo,/aria-label/)
})

test('a assinatura fica sob o conjunto, como no ativo oficial',()=>{
 const logo=read('src/components/Logo.jsx')
 // Espremida ao lado do wordmark ela ficaria com 4px e ilegível.
 assert.match(logo,/const withSignature=resolvedVariant==='full'/)
 assert.match(logo,/className="brand-lockup"/)
 const css=read('src/val-logo-final.css')
 assert.match(css,/\.val-final-brand\{[^}]*flex-direction:column/)
 assert.match(css,/\.val-final-brand \.brand-signature img\{[^}]*width:100%/)
})

test('o dimensionamento respeita a proporção do ativo',()=>{
 const css=read('src/val-logo-final.css')
 // Altura manda, largura acompanha: travar as duas deformaria a marca.
 assert.match(css,/--val-mark-height/)
 assert.match(css,/\.val-final-brand \.brand-mark img\{[^}]*width:auto/)
 assert.match(css,/\.val-final-brand \.brand-mark img\{[^}]*height:var\(--val-mark-height\)/)
 for(const superficie of ['.sidebar .val-final-brand','.val-login-shell .login-story>.val-final-brand'])
  assert.ok(css.includes(superficie),`superfície "${superficie}" perdeu o tamanho declarado`)
})

test('o extrator recorta o original em vez de imitá-lo',()=>{
 const script=read('scripts/extract-brand-asset.mjs')
 assert.match(script,/getImageData/)
 assert.match(script,/val-symbol-official\.png/)
 assert.match(script,/val-signature-official\.png/)
 // Nenhuma coordenada chumbada: os recortes vêm da medição do alfa.
 assert.ok(!/\bcrop\(\s*\{x:\s*\d+/.test(script),'o recorte voltou a ser posição fixa em vez de medida')
})

test('nenhum SVG redesenhado da marca sobrou no repositório',()=>{
 const mortos=[
  'public/brand/val-logo-on-light.svg','public/brand/val-logo-on-dark.svg',
  'public/brand/val-icon-only.svg','public/brand/val-icon-maskable.svg',
  'public/icon.svg','public/val-logo.svg','logo.svg','scripts/build-brand-assets.mjs'
 ]
 for(const morto of mortos)
  assert.equal(existsSync(join(root,morto)),false,`${morto} é a marca redesenhada e deveria ter saído`)
})

test('favicon, PWA e app embutido apontam para o ativo oficial',()=>{
 const html=read('index.html')
 assert.match(html,/rel="icon" href="\/brand\/val-symbol-official\.png"/)
 assert.ok(!/icon\.svg/.test(html),'o favicon ainda aponta para o SVG desenhado')

 const manifest=JSON.parse(read('public/manifest.webmanifest'))
 for(const icon of manifest.icons)assert.match(icon.src,/-official\.png$/)
 assert.equal(manifest.theme_color,'#071B19')

 const embedded=read('manual/app/val-embedded-brand.css')
 assert.match(embedded,/\/brand\/val-wordmark-official\.png/)
})

test('a paleta da VAL foi preservada — a troca foi de marca, não de cor',()=>{
 const brand=read('src/val-brand.css')
 for(const token of ['--val-ink:#071b19','--val-emerald:#00c896','--val-emerald-dark:#009f78','--val-mint:#72e6c5','--val-lime:#c8f25e'])
  assert.ok(brand.includes(token),`o token "${token}" da paleta VAL foi perdido`)
 // Os tokens que existiam só para colorir o desenho não fazem mais sentido.
 assert.ok(!/--val-logo-(stem|leaf|vein|blue|fold|green)/.test(brand),'sobraram tokens do desenho da marca')
})
