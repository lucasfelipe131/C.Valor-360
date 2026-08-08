import {readFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {config} from './config.js'
import {createDatabase} from './db.js'

const database=createDatabase(config)
if(!database.configured){
  if(config.demoMode){
    console.log('Migração ignorada somente porque VAL_DEMO_MODE=true.')
    process.exit(0)
  }
  throw new Error('DATABASE_URL é obrigatória fora do modo demonstrativo; migração interrompida.')
}

const here=dirname(fileURLToPath(import.meta.url))
const sql=await readFile(join(here,'..','database','schema.sql'),'utf8')
try{
  await database.query(sql)
  console.log('Banco VALOR 360 migrado com sucesso.')
}finally{await database.close()}
