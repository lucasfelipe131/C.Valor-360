import {pathToFileURL} from 'node:url'
import {createDatabase} from '../server/db.js'
import {buildDemoProducerFixture,seedDemoProducer} from '../server/demo-producer.js'
import {assertControlledDatabase,databaseSsl} from './lib/controlled-database.mjs'

export async function runDemoProducerSeed({env=process.env,args=process.argv.slice(2)}={}){
 const tenantId=env.VAL_DEMO_TENANT_ID
 const ownerId=env.VAL_DEMO_OWNER_ID
 const environment=String(env.VAL_DEMO_ENVIRONMENT||'').toLowerCase()
 if(!['staging','test'].includes(environment))throw new Error('Defina VAL_DEMO_ENVIRONMENT=staging ou test; produção não é aceita.')
 if(args.some(value=>!['--dry-run','--apply'].includes(value))||args.includes('--dry-run')&&args.includes('--apply'))throw new Error('Use --dry-run ou --apply.')
 const fixture=buildDemoProducerFixture({tenantId,ownerId})
 if(!args.includes('--apply'))return {dryRun:true,synthetic:true,clientId:fixture.clientId,externalKey:fixture.externalKey,name:fixture.name,totalAreaHa:fixture.totalAreaHa,seasons:fixture.seasons,counts:fixture.counts}
 // Deliberately no fallback to DATABASE_URL, which may point to production.
 const connectionString=env.VAL_DEMO_DATABASE_URL
 if(!connectionString)throw new Error('VAL_DEMO_DATABASE_URL é obrigatório para aplicar em um banco controlado.')
 assertControlledDatabase(connectionString)
 const database=createDatabase({databaseUrl:connectionString,databaseSsl:Boolean(databaseSsl(connectionString)),databaseQueryTimeoutMs:15000})
 try{return await seedDemoProducer({database,tenantId,ownerId,environment})}finally{await database.close()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runDemoProducerSeed().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
  // PostgreSQL details may contain row data or connection metadata; expose only domain errors.
  console.error(error?.exposeMessage?error.message:'Não foi possível criar a demonstração. Confira ambiente controlado, tenant, proprietário e migrations aplicadas.')
  process.exitCode=1
 })
}
