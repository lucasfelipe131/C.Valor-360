import {readdir,readFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..','..')

function splitColumns(body){
  const parts=[];let current='';let depth=0;let quote=''
  for(const character of body){
    if(quote){current+=character;if(character===quote)quote='';continue}
    if(character==='"'||character==="'"){quote=character;current+=character;continue}
    if(character==='(')depth++
    if(character===')')depth--
    if(character===','&&depth===0){parts.push(current);current='';continue}
    current+=character
  }
  if(current.trim())parts.push(current)
  return parts
}

function addSql(contract,sql){
  const clean=sql.replace(/--[^\n]*/g,' ')
  const create=/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_".]+)\s*\(([\s\S]*?)\);/gi
  for(const match of clean.matchAll(create)){
    const table=match[1].replaceAll('"','').split('.').at(-1)
    const columns=contract.get(table)||new Set()
    for(const definition of splitColumns(match[2])){
      const item=definition.trim()
      if(!item||/^(?:CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i.test(item))continue
      const column=item.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/)?.[1]
      if(column)columns.add(column)
    }
    contract.set(table,columns)
  }
  const alter=/ALTER\s+TABLE\s+([a-zA-Z0-9_".]+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi
  for(const match of clean.matchAll(alter)){
    const table=match[1].replaceAll('"','').split('.').at(-1)
    const columns=contract.get(table)||new Set();columns.add(match[2]);contract.set(table,columns)
  }
}

export async function sqlSources(){
  const sources=[{name:'database/schema.sql',sql:await readFile(join(root,'database','schema.sql'),'utf8')}]
  const directory=join(root,'database','migrations')
  let names=[];try{names=await readdir(directory)}catch(error){if(error?.code!=='ENOENT')throw error}
  for(const name of names.filter(item=>item.endsWith('.sql')).sort())sources.push({name:`database/migrations/${name}`,sql:await readFile(join(directory,name),'utf8')})
  return sources
}

export async function expectedSchemaContract(){
  const contract=new Map()
  for(const source of await sqlSources())addSql(contract,source.sql)
  return contract
}

export async function expectedIndexContract(){
  const indexes=new Map()
  const pattern=/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ON\s+([a-zA-Z0-9_".]+)/gi
  for(const source of await sqlSources())for(const match of source.sql.replace(/--[^\n]*/g,' ').matchAll(pattern))indexes.set(match[1],match[2].replaceAll('"','').split('.').at(-1))
  return indexes
}
