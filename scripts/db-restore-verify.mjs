import {access,readFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import pg from 'pg'

const target=String(process.env.RESTORE_DATABASE_URL||'').trim()
const backup=resolve(String(process.env.BACKUP_FILE||''))
if(!target||!process.env.BACKUP_FILE)throw new Error('Defina RESTORE_DATABASE_URL e BACKUP_FILE para o banco controlado de restore.')
if(process.env.CONFIRM_CONTROLLED_RESTORE!=='RESTORE_ONLY')throw new Error('Defina CONFIRM_CONTROLLED_RESTORE=RESTORE_ONLY para confirmar que o alvo é descartável.')
if(target===String(process.env.STAGING_DATABASE_URL||'').trim()||target===String(process.env.DATABASE_URL||'').trim())throw new Error('O alvo de restore deve ser diferente do banco de origem e do DATABASE_URL corrente.')
await access(backup)
const metadata=JSON.parse(await readFile(`${backup}.json`,'utf8').catch(()=>'{}'))
const pool=new pg.Pool({connectionString:target,max:1,ssl:/railway\.internal/.test(target)?undefined:{rejectUnauthorized:false}})
try{
  const targetInfo=(await pool.query('SELECT current_database() name')).rows[0]
  if(!/(restore|sandbox|test)/i.test(String(targetInfo.name)))throw new Error(`Banco alvo não parece descartável: ${targetInfo.name}.`)
}finally{await pool.end()}

const started=Date.now()
await new Promise((resolveRun,reject)=>{
  const child=spawn('pg_restore',['--clean','--if-exists','--no-owner','--no-acl','--exit-on-error',backup],{stdio:['ignore','inherit','inherit'],env:{...process.env,PGDATABASE:target}})
  child.once('error',reject);child.once('exit',code=>code===0?resolveRun():reject(new Error(`pg_restore terminou com código ${code}.`)))
})
const verificationPool=new pg.Pool({connectionString:target,max:1,ssl:/railway\.internal/.test(target)?undefined:{rejectUnauthorized:false}})
try{
  const tables=['organizations','users','clients','val_recommendations','integration_events','app_workspace_data','app_records']
  const counts={}
  for(const table of tables)counts[table]=Number((await verificationPool.query(`SELECT COUNT(*)::bigint count FROM ${table}`)).rows[0].count)
  const result={verifiedAt:new Date().toISOString(),durationMs:Date.now()-started,database:(await verificationPool.query('SELECT current_database() name')).rows[0].name,backup:metadata.file||backup,backupSha256:metadata.sha256||null,counts,healthQuery:true}
  console.log(JSON.stringify(result,null,2))
}finally{await verificationPool.end()}
