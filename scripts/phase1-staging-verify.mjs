import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {createAuth} from '../server/auth.js'
import {createDatabase} from '../server/db.js'
import {ValRepository} from '../server/repository.js'
import {assertControlledDatabase,databaseSsl} from './lib/controlled-database.mjs'

const connectionString=String(process.env.GATE_DATABASE_URL||process.env.STAGING_DATABASE_URL||'').trim()
if(!connectionString)throw new Error('GATE_DATABASE_URL ou STAGING_DATABASE_URL é obrigatória.')
const target=assertControlledDatabase(connectionString,{confirmation:process.env.CONFIRM_CONTROLLED_STAGING,requiredConfirmation:'STAGING_ONLY'})
const verifyOnly=String(process.env.GATE_VERIFY_ONLY||'').toLowerCase()==='true'
const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const userA='00000000-0000-4000-8000-000000000101'
const userB='00000000-0000-4000-8000-000000000102'
const workspaceA='00000000-0000-4000-8000-000000000201'
const workspaceB='00000000-0000-4000-8000-000000000202'
const recordA='00000000-0000-4000-8000-000000000301'
const recordB='00000000-0000-4000-8000-000000000302'

const database=createDatabase({databaseUrl:connectionString,databaseSsl:Boolean(databaseSsl(connectionString))})
const repository=tenantId=>new ValRepository({db:database,tenantId,readStore:()=>({}),saveStore:()=>{throw new Error('Fallback não permitido no gate PostgreSQL.')}})

try{
  const databaseName=String((await database.query('SELECT current_database() name')).rows[0].name)
  assert.equal(databaseName,target.name)

  if(!verifyOnly){
    await database.transaction(async connection=>{
      await connection.query(`INSERT INTO organizations (id,name,slug,status) VALUES
        ($1,'GATE tenant A','gate-tenant-a','active'),($2,'GATE tenant B','gate-tenant-b','active')
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status='active',updated_at=NOW()`,[tenantA,tenantB])
      await connection.query(`INSERT INTO users (id,name,email,status,password_hash) VALUES
        ($1,'Consultor sintético A','gate-a@example.invalid','active','gate-only'),
        ($2,'Consultor sintético B','gate-b@example.invalid','active','gate-only')
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status='active',updated_at=NOW()`,[userA,userB])
      await connection.query(`INSERT INTO memberships (tenant_id,user_id,role,portfolio_scope) VALUES
        ($1,$2,'consultant','{}'::jsonb),($3,$4,'consultant','{}'::jsonb)
        ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role`,[tenantA,userA,tenantB,userB])
      await connection.query(`INSERT INTO clients (tenant_id,consultant_id,external_key,name,status,source) VALUES
        ($1,$2,'gate-client-a','Produtor sintético A','active','phase1_gate'),
        ($3,$4,'gate-client-b','Produtor sintético B','active','phase1_gate')
        ON CONFLICT (tenant_id,consultant_id,external_key) DO UPDATE SET name=EXCLUDED.name,status='active',updated_at=NOW()`,[tenantA,userA,tenantB,userB])
      await connection.query(`INSERT INTO app_workspace_data (tenant_id,workspace_id,producers,soil_analyses,professional_profile) VALUES
        ($1,$2,'[{"name":"Produtor sintético A"}]'::jsonb,'[]'::jsonb,'{}'::jsonb),
        ($3,$4,'[{"name":"Produtor sintético B"}]'::jsonb,'[]'::jsonb,'{}'::jsonb)
        ON CONFLICT (workspace_id) DO UPDATE SET producers=EXCLUDED.producers,updated_at=NOW()
        WHERE app_workspace_data.tenant_id=EXCLUDED.tenant_id`,[tenantA,workspaceA,tenantB,workspaceB])
      await connection.query(`INSERT INTO app_records (id,tenant_id,workspace_id,record_type,title,producer_name,payload) VALUES
        ($1,$2,$3,'field_report','Registro sintético A','Produtor sintético A','{}'::jsonb),
        ($4,$5,$6,'field_report','Registro sintético B','Produtor sintético B','{}'::jsonb)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,updated_at=NOW()
        WHERE app_records.tenant_id=EXCLUDED.tenant_id`,[recordA,tenantA,workspaceA,recordB,tenantB,workspaceB])
    })
  }

  const repositoryA=repository(tenantA)
  const repositoryB=repository(tenantB)
  const intelligenceA=await repositoryA.getIntelligence(userA)
  const intelligenceB=await repositoryB.getIntelligence(userB)
  assert.deepEqual(intelligenceA.clients.map(item=>item.id),['gate-client-a'])
  assert.deepEqual(intelligenceB.clients.map(item=>item.id),['gate-client-b'])
  assert.equal((await repositoryA.getIntelligence(userB)).clients.length,0)

  let scopeOverrideDenied=false
  try{await repositoryA.getClientContext({tenantId:tenantB,clientId:'gate-client-b',ownerId:userB})}catch(error){scopeOverrideDenied=error?.statusCode===403&&error?.code==='cross_tenant_scope_denied'}
  assert.equal(scopeOverrideDenied,true)

  let crossTenantClientDenied=false
  try{await repositoryA.getClientOverview('gate-client-b',userA)}catch(error){crossTenantClientDenied=error?.statusCode===404}
  assert.equal(crossTenantClientDenied,true)

  const manualA=await database.query('SELECT producer_name FROM app_records WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY producer_name',[tenantA,workspaceA])
  const manualCrossTenant=await database.query('SELECT producer_name FROM app_records WHERE tenant_id=$1 AND workspace_id=$2',[tenantA,workspaceB])
  assert.deepEqual(manualA.rows.map(row=>row.producer_name),['Produtor sintético A'])
  assert.equal(manualCrossTenant.rowCount,0)

  const auth=createAuth({
    adminEmail:'admin@example.invalid',
    adminPassword:'senha-gate-nao-utilizada-123',
    sessionSecret:'segredo-sintetico-do-gate-com-mais-de-32-caracteres',
    defaultTenantId:tenantA,
    sessionTtlSeconds:60
  })
  const foreignToken=auth.issue({id:userB,email:'gate-b@example.invalid',name:'Consultor B',role:'consultant',tenantId:tenantB,sessionVersion:0})
  const foreignSession=auth.session({headers:{cookie:`valor360_session=${foreignToken}`,'x-forwarded-proto':'https'}})
  assert.equal(foreignSession,null)

  const migrationRows=await database.query(`SELECT version,checksum FROM schema_migrations ORDER BY version`)
  const tenantCounts=await database.query(`SELECT tenant_id::text,COUNT(*)::int count FROM clients WHERE source='phase1_gate' GROUP BY tenant_id ORDER BY tenant_id`)
  const evidence={
    verifiedAt:new Date().toISOString(),
    environment:verifyOnly?'restored-controlled':'staging-controlled',
    database:databaseName,
    syntheticDataOnly:true,
    migrations:migrationRows.rows.map(row=>({version:row.version,checksum:String(row.checksum||'').trim()||null})),
    tenantIsolation:{
      tenantAVisibleClients:intelligenceA.clients.map(item=>item.id),
      tenantBVisibleClients:intelligenceB.clients.map(item=>item.id),
      wrongOwnerWithinTenantVisibleClients:0,
      scopeOverrideDenied,
      crossTenantClientDenied,
      manualCrossTenantRows:manualCrossTenant.rowCount,
      foreignSignedSessionRejected:foreignSession===null,
      syntheticClientCounts:tenantCounts.rows
    }
  }
  if(process.env.GATE_EVIDENCE_FILE){
    await mkdir(dirname(process.env.GATE_EVIDENCE_FILE),{recursive:true})
    await writeFile(process.env.GATE_EVIDENCE_FILE,JSON.stringify(evidence,null,2))
  }
  console.log(JSON.stringify(evidence,null,2))
}finally{await database.close()}
