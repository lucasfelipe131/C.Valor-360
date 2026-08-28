import {createHash} from 'node:crypto'
import {readdir,readFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const defaultDirectory=join(dirname(fileURLToPath(import.meta.url)),'..','database','migrations')
const migrationFile=/^[0-9]{8}_[0-9]{3}_[a-z0-9_]+\.sql$/

export async function listVersionedMigrations(directory=defaultDirectory){
  let names=[]
  try{names=await readdir(directory)}catch(error){if(error?.code==='ENOENT')return [];throw error}
  const migrations=[]
  for(const name of names.filter(item=>migrationFile.test(item)).sort()){
    const sql=await readFile(join(directory,name),'utf8')
    migrations.push({version:name.replace(/\.sql$/,''),name,sql,checksum:createHash('sha256').update(sql).digest('hex')})
  }
  return migrations
}

export async function applyVersionedMigrations(database,{directory=defaultDirectory,logger=console.log}={}){
  const migrations=await listVersionedMigrations(directory)
  const applied=[]
  for(const migration of migrations){
    await database.transaction(async connection=>{
      await connection.query("SELECT pg_advisory_xact_lock(hashtext('valor360-versioned-migrations'))")
      await connection.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)')
      const current=await connection.query('SELECT checksum FROM schema_migrations WHERE version=$1 FOR UPDATE',[migration.version])
      if(current.rowCount){
        const existing=String(current.rows[0].checksum||'').trim()
        if(existing&&existing!==migration.checksum)throw new Error(`Migration histórica alterada: ${migration.version}.`)
        if(!existing)await connection.query('UPDATE schema_migrations SET checksum=$2 WHERE version=$1',[migration.version,migration.checksum])
        applied.push({version:migration.version,status:'already-applied',checksum:migration.checksum})
        return
      }
      await connection.query(migration.sql)
      await connection.query('INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)',[migration.version,migration.checksum])
      applied.push({version:migration.version,status:'applied',checksum:migration.checksum})
    })
    logger(`Migration ${migration.version}: ${applied.at(-1).status}.`)
  }
  return applied
}
