// Rebrand R1 — troca os tokens da marca antiga (azul + folha verde-água)
// pelos tokens da marca oficial (V marfim/floresta + folha verde-oliva).
//
// Migração determinística e idempotente: cada bloco contíguo de declarações
// `--val-logo-*` é substituído inteiro pelo conjunto novo, escolhido pelo valor
// que o bloco antigo usava para `--val-logo-word`:
//   #082c57  -> superfície clara   (V escuro sobre fundo claro)
//   #f4f8f6  -> superfície escura   (V marfim sobre fundo escuro)
//   currentColor -> monocromática
//
// Uso: node scripts/rebrand-logo-tokens.mjs [--check]

import {readFileSync,writeFileSync} from 'node:fs'

const TARGET='src/val-brand.css'
const LEGACY=/^(\s*)--val-logo-(?:blue-start|blue-mid|blue-end|fold-start|fold-end|green-start|green-mid|green-end|leaf-start|leaf-mid|leaf-end|word|accent|highlight)\s*:\s*[^;]+;\s*$/

const SETS={
 light:[
  ['stem-top','#1d3b27'],['stem-bottom','#12291b'],
  ['leaf-top','#a6cc5b'],['leaf-mid','#79a63e'],['leaf-deep','#3f6b26'],
  ['leaf-shade-top','#5f8a32'],['leaf-shade-bottom','#2f5720'],
  ['vein','#f2f6e9'],['word','#12291b'],['accent','#5f8a32'],['highlight','#f2f6e9']
 ],
 dark:[
  ['stem-top','#f1f1ea'],['stem-bottom','#cfcfc6'],
  ['leaf-top','#b6d96b'],['leaf-mid','#8cbc49'],['leaf-deep','#4e7a2e'],
  ['leaf-shade-top','#6e9c38'],['leaf-shade-bottom','#3a6624'],
  ['vein','#0d1f15'],['word','#edede6'],['accent','#9bc85a'],['highlight','#f4f7ec']
 ],
 mono:[
  ['stem-top','currentColor'],['stem-bottom','currentColor'],
  ['leaf-top','currentColor'],['leaf-mid','currentColor'],['leaf-deep','currentColor'],
  ['leaf-shade-top','currentColor'],['leaf-shade-bottom','currentColor'],
  ['vein','currentColor'],['word','currentColor'],['accent','currentColor'],['highlight','currentColor']
 ]
}

const surfaceOf=block=>{
 const word=block.find(line=>/--val-logo-word\s*:/.test(line))||''
 if(/currentColor/i.test(word))return 'mono'
 if(/#f4f8f6/i.test(word))return 'dark'
 return 'light'
}

const source=readFileSync(TARGET,'utf8')
const lines=source.split(/\r?\n/)
const output=[]
let block=[]
let replaced=0

const flush=()=>{
 if(!block.length)return
 const indent=block[0].match(/^\s*/)[0]
 const set=SETS[surfaceOf(block)]
 for(const [name,value] of set)output.push(`${indent}--val-logo-${name}:${value};`)
 replaced+=1
 block=[]
}

for(const line of lines){
 if(LEGACY.test(line)){block.push(line);continue}
 flush()
 output.push(line)
}
flush()

const result=output.join('\n')
if(process.argv.includes('--check')){
 const pending=(source.match(LEGACY)||[]).length
 console.log(`blocos legados encontrados: ${replaced}`)
 process.exit(replaced===0?0:1)
}
if(result===source){
 console.log('nenhum token legado da marca antiga restou — nada a fazer.')
}else{
 writeFileSync(TARGET,result)
 console.log(`marca oficial instalada: ${replaced} bloco(s) de tokens migrado(s) em ${TARGET}`)
}
