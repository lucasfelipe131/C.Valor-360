// Rebrand R1 — gerador dos ativos da marca oficial da VAL.
//
// Fonte de verdade única: a geometria abaixo é o ativo aprovado (V + folha).
// Todas as variantes de uso (horizontal, vertical, reduzida, símbolo isolado,
// clara, escura, monocromática, maskable) DERIVAM deste arquivo. Nenhuma delas
// é redesenhada à mão — regenerar sempre com:
//
//   node scripts/build-brand-assets.mjs
//
// A mesma geometria vive em src/components/Logo.jsx (versão React, com tokens
// CSS no lugar dos hex). Se um dos dois mudar, os dois mudam.

import {writeFileSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'

// ---------------------------------------------------------------- geometria
const MARK={
 stem:'M3.6 5.2H17.8L33.4 53.6L30.2 61.2Z',
 leaf:'M30.6 61C32.8 45.6 39.4 24.4 52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61Z',
 fold:'M52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61C36.9 44.4 44.6 22.9 52.4 3Z',
 vein:'M31.4 59.4C37.5 43.2 45 22.2 52.2 3.9'
}
const WORD=[
 'M2 8H12.5L29 50L45.5 8H56L33.5 64H24.5Z',
 'M76 64L101.5 8H108.5L134 64H123.5L105 26L86.5 64Z',
 'M154 8H164.5V53.5H212V64H154Z'
]

// ------------------------------------------------------------------ paletas
const LIGHT={
 stemTop:'#1D3B27',stemBottom:'#12291B',
 leafTop:'#A6CC5B',leafMid:'#79A63E',leafDeep:'#3F6B26',
 shadeTop:'#5F8A32',shadeBottom:'#2F5720',
 vein:'#F2F6E9',word:'#12291B',accent:'#5F8A32'
}
const DARK={
 stemTop:'#F1F1EA',stemBottom:'#CFCFC6',
 leafTop:'#B6D96B',leafMid:'#8CBC49',leafDeep:'#4E7A2E',
 shadeTop:'#6E9C38',shadeBottom:'#3A6624',
 vein:'#0D1F15',word:'#EDEDE6',accent:'#9BC85A'
}
const FOREST='#0D1F15'

// ------------------------------------------------------------------ helpers
const defs=(p,id)=>`  <defs>
    <linearGradient id="${id}stem" x1="6" y1="4" x2="30" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="${p.stemTop}"/><stop offset="1" stop-color="${p.stemBottom}"/></linearGradient>
    <linearGradient id="${id}leaf" x1="52" y1="4" x2="32" y2="59" gradientUnits="userSpaceOnUse"><stop stop-color="${p.leafTop}"/><stop offset=".52" stop-color="${p.leafMid}"/><stop offset="1" stop-color="${p.leafDeep}"/></linearGradient>
    <linearGradient id="${id}shade" x1="56" y1="10" x2="36" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="${p.shadeTop}"/><stop offset="1" stop-color="${p.shadeBottom}"/></linearGradient>
  </defs>`

const markPaths=(p,id,{detail=true}={})=>[
 `    <path d="${MARK.stem}" fill="url(#${id}stem)" stroke="url(#${id}stem)" stroke-width="1.6" stroke-linejoin="round"/>`,
 `    <path d="${MARK.leaf}" fill="url(#${id}leaf)"/>`,
 `    <path d="${MARK.fold}" fill="url(#${id}shade)"/>`,
 detail?`    <path d="${MARK.vein}" stroke="${p.vein}" stroke-opacity=".5" stroke-width="1.05" stroke-linecap="round" fill="none"/>`:''
].filter(Boolean).join('\n')

const flatMark=color=>[
 `    <path d="${MARK.stem}" fill="${color}"/>`,
 `    <path d="${MARK.leaf}" fill="${color}"/>`
].join('\n')

const wordPaths=(color,indent='    ')=>WORD.map(d=>`${indent}<path d="${d}" fill="${color}"/>`).join('\n')

const svg=(viewBox,body,extra='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" role="img" aria-labelledby="title"${extra}>
  <title id="title">VAL — inteligência que gera valor</title>
${body}
</svg>
`

const write=(path,content)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);console.log(`  ${path}`)}

// ------------------------------------------------------- símbolo isolado
const iconOnly=(p,id,background)=>svg('0 0 64 64',[
 background?`  <rect width="64" height="64" fill="${background}"/>`:'',
 defs(p,id),
 `  <g>`,
 markPaths(p,id),
 `  </g>`
].filter(Boolean).join('\n'))

// O maskable respeita a zona segura de 80%: a marca ocupa o centro.
const iconMaskable=svg('0 0 64 64',[
 `  <rect width="64" height="64" fill="${FOREST}"/>`,
 defs(DARK,'m'),
 `  <g transform="translate(32 32) scale(.72) translate(-32 -32)">`,
 markPaths(DARK,'m'),
 `  </g>`
].join('\n'))

const iconMono=svg('0 0 64 64',flatMark('currentColor'))

// ------------------------------------------------------- lockup horizontal
// símbolo 64x64 à esquerda + wordmark 220x72 à direita, alinhados pela altura
const horizontal=(p,id,background)=>svg('0 0 380 112',[
 background?`  <rect width="380" height="112" fill="${background}"/>`:'',
 defs(p,id),
 `  <g transform="translate(10 20) scale(1.1)">`,
 markPaths(p,id),
 `  </g>`,
 `  <g transform="translate(100 22) scale(.8)">`,
 wordPaths(p.word),
 `  </g>`,
 `  <text x="101" y="96" fill="${p.accent}" font-family="Manrope, Inter, ui-sans-serif, system-ui, sans-serif" font-size="10" font-weight="800" letter-spacing="2">INTELIGÊNCIA QUE GERA VALOR</text>`
].filter(Boolean).join('\n'))

const horizontalMono=svg('0 0 380 112',[
 `  <g transform="translate(10 20) scale(1.1)">`,
 flatMark('currentColor'),
 `  </g>`,
 `  <g transform="translate(100 22) scale(.8)">`,
 wordPaths('currentColor'),
 `  </g>`
].join('\n'))

// --------------------------------------------------------- lockup vertical
const vertical=(p,id,background)=>svg('0 0 320 260',[
 background?`  <rect width="320" height="260" fill="${background}"/>`:'',
 defs(p,id),
 `  <g transform="translate(112 24) scale(1.5)">`,
 markPaths(p,id),
 `  </g>`,
 `  <g transform="translate(50 148) scale(1)">`,
 wordPaths(p.word),
 `  </g>`,
 `  <text x="160" y="236" text-anchor="middle" fill="${p.accent}" font-family="Manrope, Inter, ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="800" letter-spacing="3.4">INTELIGÊNCIA QUE GERA VALOR</text>`
].filter(Boolean).join('\n'))

// ------------------------------------------------------------------ escrita
console.log('Gerando ativos da marca oficial VAL a partir da geometria aprovada:')

write('public/brand/val-icon-only.svg',iconOnly(LIGHT,'l'))
write('public/brand/val-icon-only-on-dark.svg',iconOnly(DARK,'d'))
write('public/brand/val-icon-only-monochrome.svg',iconMono)
write('public/brand/val-icon-maskable.svg',iconMaskable)

write('public/brand/val-logo-on-light.svg',horizontal(LIGHT,'l'))
write('public/brand/val-logo-on-dark.svg',horizontal(DARK,'d',FOREST))
write('public/brand/val-logo-compact.svg',horizontal(LIGHT,'l'))
write('public/brand/val-logo-monochrome.svg',horizontalMono)
write('public/brand/val-logo-monochrome-light.svg',horizontalMono)

write('public/brand/val-logo-vertical-on-light.svg',vertical(LIGHT,'l'))
write('public/brand/val-logo-vertical-on-dark.svg',vertical(DARK,'d',FOREST))

// Ativos históricos mantidos nos mesmos caminhos para não quebrar referências.
write('public/icon.svg',iconOnly(DARK,'d',FOREST))
write('public/val-logo.svg',horizontal(LIGHT,'l'))
write('logo.svg',horizontal(LIGHT,'l'))               // alias byte a byte de public/val-logo.svg

console.log('Pronto.')
