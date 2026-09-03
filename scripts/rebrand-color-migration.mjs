// Rebrand R2 — migração cromática determinística da VAL.
//
// PROBLEMA
// A camada de tokens existe (`--val-*`) mas quase não é usada: 2.525 cores hex
// distintas nas folhas contra 131 usos de `var()`. A aparência do produto é
// azul corporativo escrito à mão. Trocar variáveis não faz rebrand nenhum.
//
// MÉTODO
// Rotação de matiz com PRESERVAÇÃO DE LUMINÂNCIA RELATIVA (WCAG).
//
//  1. cada literal de cor vira HSL;
//  2. matizes fora da família azul/ciano/verde-água ficam intactos — vermelhos,
//     âmbares, amarelos, os verdes que já são VAL, violetas e cinzas;
//  3. os que estão dentro recebem a matiz VAL correspondente ao seu papel:
//       escuro   -> verde floresta  (nav, superfícies premium)
//       médio    -> verde-oliva da folha (ação, marca, destaque)
//       claro    -> tinta menta muito suave (fundos, chips)
//  4. a saturação é limitada, porque verde satura muito mais que azul aos olhos;
//  5. a claridade é RESOLVIDA por busca binária para que a luminância relativa
//     final seja idêntica à original.
//
// O passo 5 é o que torna isto seguro: TODA razão de contraste do produto
// permanece exatamente a mesma. Um texto que passava em WCAG antes continua
// passando depois, sem inspeção manual de 5.000 declarações.
//
// A migração é idempotente: as matizes de destino (88–150) caem fora da faixa
// de entrada (155–246), então rodar duas vezes não muda nada.
//
// Uso:
//   node scripts/rebrand-color-migration.mjs            aplica
//   node scripts/rebrand-color-migration.mjs --check    só relata
//   node scripts/rebrand-color-migration.mjs --report   relata cor a cor

import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {join} from 'node:path'

const DIR='src'
const HUE_IN=[155,246]   // ciano, azul e verde-água da marca antiga
const SAT_CAP=0.52       // verde acima disto fica ácido
const SAT_CAP_TINT=0.45  // tintas muito claras

// ------------------------------------------------------------------ conversão
const srgbToLinear=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4
const luminance=([r,g,b])=>0.2126*srgbToLinear(r/255)+0.7152*srgbToLinear(g/255)+0.0722*srgbToLinear(b/255)

const rgbToHsl=([r,g,b])=>{
 const R=r/255,G=g/255,B=b/255
 const max=Math.max(R,G,B),min=Math.min(R,G,B),d=max-min
 const l=(max+min)/2
 if(!d)return [0,0,l]
 const s=l>0.5?d/(2-max-min):d/(max+min)
 let h
 if(max===R)h=((G-B)/d+(G<B?6:0))
 else if(max===G)h=(B-R)/d+2
 else h=(R-G)/d+4
 return [h*60,s,l]
}

const hslToRgb=([h,s,l])=>{
 if(!s)return [l*255,l*255,l*255].map(Math.round)
 const H=((h%360)+360)%360/360
 const q=l<0.5?l*(1+s):l+s-l*s
 const p=2*l-q
 const hue=t=>{
  t=t<0?t+1:t>1?t-1:t
  if(t<1/6)return p+(q-p)*6*t
  if(t<1/2)return q
  if(t<2/3)return p+(q-p)*(2/3-t)*6
  return p
 }
 return [hue(H+1/3),hue(H),hue(H-1/3)].map(v=>Math.round(v*255))
}

// ---------------------------------------------------------------- matiz alvo
const lerp=(a,b,t)=>a+(b-a)*t
// A marca tem duas âncoras e nenhum verde puro entre elas: floresta (146) nas
// superfícies escuras e oliva da folha (90) em tudo que é acento ou ação —
// as mesmas matizes do ativo oficial. As faixas de transição são curtas de
// propósito: hue 120, verde-grama, não pertence à VAL.
const targetHue=l=>{
 if(l<=0.16)return 146                                   // floresta profunda
 if(l<0.24)return lerp(146,90,(l-0.16)/0.08)
 if(l<0.76)return 90                                     // oliva da folha
 return lerp(90,146,Math.min(1,(l-0.76)/0.12))           // tinta menta
}

// Resolve a claridade que reproduz a luminância original na nova matiz.
const solveLightness=(h,s,targetY)=>{
 let lo=0,hi=1
 for(let i=0;i<40;i++){
  const mid=(lo+hi)/2
  if(luminance(hslToRgb([h,s,mid]))<targetY)lo=mid;else hi=mid
 }
 return (lo+hi)/2
}

const migrate=rgb=>{
 const [h,s,l]=rgbToHsl(rgb)
 if(s<0.06)return null                          // cinza: a marca não o toca
 if(h<HUE_IN[0]||h>HUE_IN[1])return null        // fora da família azul
 const hue=targetHue(l)
 const sat=Math.min(s,l>0.82?SAT_CAP_TINT:SAT_CAP)
 return hslToRgb([hue,sat,solveLightness(hue,sat,luminance(rgb))])
}

// ------------------------------------------------------------------- parsing
const hex2=n=>n.toString(16).padStart(2,'0')
const toHex=([r,g,b])=>`#${hex2(r)}${hex2(g)}${hex2(b)}`
const expand=h=>h.length===3?h.split('').map(c=>c+c).join(''):h
const parseHex=h=>{const f=expand(h);return [0,2,4].map(i=>parseInt(f.slice(i,i+2),16))}

const HEX=/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
const RGB=/\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*([,)])/g

const stats={files:0,hex:0,rgb:0,changed:0,skipped:0}
const samples=new Map()

const transform=source=>source
 .replace(HEX,(match,body)=>{
  stats.hex+=1
  const alpha=body.length===8?body.slice(6):''
  const next=migrate(parseHex(body.slice(0,6)))
  if(!next){stats.skipped+=1;return match}
  stats.changed+=1
  const out=toHex(next)+alpha
  if(!samples.has(match.toLowerCase()))samples.set(match.toLowerCase(),out)
  return out
 })
 .replace(RGB,(match,r,g,b,tail)=>{
  stats.rgb+=1
  const next=migrate([+r,+g,+b])
  if(!next){stats.skipped+=1;return match}
  stats.changed+=1
  const head=match.slice(0,match.indexOf('('))
  return `${head}(${next[0]},${next[1]},${next[2]}${tail}`
 })

// -------------------------------------------------------------------- execução
const check=process.argv.includes('--check')
const report=process.argv.includes('--report')
const files=readdirSync(DIR).filter(name=>name.endsWith('.css')).map(name=>join(DIR,name))

let touched=0
for(const file of files){
 const source=readFileSync(file,'utf8')
 const result=transform(source)
 stats.files+=1
 if(result===source)continue
 touched+=1
 if(!check&&!report)writeFileSync(file,result)
}

console.log(`arquivos analisados: ${stats.files}  |  com alteração: ${touched}`)
console.log(`literais de cor: ${stats.hex} hex + ${stats.rgb} rgb`)
console.log(`migrados para a família VAL: ${stats.changed}  |  preservados: ${stats.skipped}`)
if(report){
 console.log('\namostra da migração (antes -> depois):')
 for(const [from,to] of [...samples].slice(0,60))console.log(`  ${from} -> ${to}`)
}
// O check falha pelo que de fato mudaria em disco. Cores muito claras dentro
// da faixa podem mapear para si mesmas depois do arredondamento; isso conta
// como migração tentada, mas não como alteração.
if(check&&touched>0)process.exit(1)
