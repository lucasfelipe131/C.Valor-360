import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {basename,resolve} from 'node:path'
import {assertControlledDatabase,postgresCliEnv} from './lib/controlled-database.mjs'

const source=String(process.env.STAGING_DATABASE_URL||'').trim()
if(!source)throw new Error('STAGING_DATABASE_URL é obrigatória; este comando não assume produção.')
const sourceTarget=assertControlledDatabase(source,{confirmation:process.env.CONFIRM_CONTROLLED_STAGING,requiredConfirmation:'STAGING_ONLY'})
const directory=resolve(process.env.BACKUP_DIR||'.backups/staging')
await mkdir(directory,{recursive:true})
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
const output=resolve(directory,`valor360-staging-${stamp}.dump`)

await new Promise((resolveRun,reject)=>{
  const child=spawn('pg_dump',['--format=custom','--no-owner','--no-acl','--file',output],{stdio:['ignore','inherit','inherit'],env:postgresCliEnv(source)})
  child.once('error',reject);child.once('exit',code=>code===0?resolveRun():reject(new Error(`pg_dump terminou com código ${code}.`)))
})
const data=await readFile(output)
const metadata={createdAt:new Date().toISOString(),environment:'staging',database:sourceTarget.name,file:basename(output),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),format:'pg_dump-custom'}
await writeFile(`${output}.json`,JSON.stringify(metadata,null,2))
console.log(JSON.stringify(metadata,null,2))
