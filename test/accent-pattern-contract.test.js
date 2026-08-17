import assert from 'node:assert/strict'
import {readdirSync,readFileSync,statSync} from 'node:fs'
import {dirname,join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const folders=['server','src']
const extensions=new Set(['.js','.jsx','.mjs','.ts','.tsx'])
const ignored=new Set(['node_modules','dist','.next','.git'])

function filesUnder(path,files=[]){
 for(const name of readdirSync(path)){
  if(ignored.has(name))continue
  const entry=join(path,name)
  const stat=statSync(entry)
  if(stat.isDirectory())filesUnder(entry,files)
  else if([...extensions].some(extension=>name.endsWith(extension)))files.push(entry)
 }
 return files
}

const files=folders.flatMap(folder=>filesUnder(join(root,folder)))
const sources=files.map(path=>({path:relative(root,path).replaceAll('\\','/'),content:readFileSync(path,'utf8')}))
const all=sources.map(item=>item.content).join('\n')

test('classes de caracteres com variação de acento continuam sendo tratadas como código',()=>{
 assert.match(all,/defici\[eê\]ncia/)
 assert.match(all,/aduba\[cç\]\[aã\]o/)
 const classes=all.match(/\[[^\]\n]*(?:[áéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ])[^\]\n]*\]/g)||[]
 assert.ok(classes.length>=10,`esperava pelo menos 10 classes de variação de acento; encontrei ${classes.length}`)
})

test('normalização que remove acentos permanece explícita e intencional',()=>{
 const nfdSources=sources.filter(item=>/\.normalize\(['"]NFD['"]\)/.test(item.content))
 assert.ok(nfdSources.length>=1,'nenhuma normalização NFD foi localizada')
 assert.ok(nfdSources.some(item=>/\\u0300-\\u036f|̀-ͯ/.test(item.content)),'a remoção explícita de marcas combinantes desapareceu')
})

test('revisão de copy não altera automaticamente regex nem funções normalize/lower',()=>{
 const docs=readFileSync(join(root,'docs','VAL_ENGINE.md'),'utf8')
 assert.match(docs,/Regex de reconhecimento não é texto de interface/)
 assert.match(docs,/defici\[eê\]ncia/)
 assert.match(docs,/aduba\[cç\]\[aã\]o/)
 assert.match(docs,/normalize\(\) e lower\(\)/)
})
