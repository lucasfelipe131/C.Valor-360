import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {createDatabase} from '../server/db.js'
import {ValEngine} from '../server/val-engine.js'
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
const staleMemory='00000000-0000-4000-8000-000000000401'
const conflictA='00000000-0000-4000-8000-000000000402'
const conflictB='00000000-0000-4000-8000-000000000403'
const foreignMemory='00000000-0000-4000-8000-000000000404'
const emptyClient='gate-client-empty-a'

const database=createDatabase({databaseUrl:connectionString,databaseSsl:Boolean(databaseSsl(connectionString))})
const repository=tenantId=>new ValRepository({db:database,tenantId,readStore:()=>({}),saveStore:()=>{throw new Error('Fallback não permitido no gate PostgreSQL.')}})

const runtimeConfig={openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'gate-daily',modelStrategic:'gate-strategic',modelFast:'gate-fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false}

try{
  const databaseName=String((await database.query('SELECT current_database() name')).rows[0].name)
  assert.equal(databaseName,target.name)
  const repositoryA=repository(tenantA)
  const repositoryB=repository(tenantB)

  if(!verifyOnly){
    await repositoryA.saveTechnicalContext('gate-client-a',{area:'500 ha',soil:'Argiloso'},userA)
    await repositoryA.saveTechnicalContext('gate-client-a',{area:'620 ha',soil:'Argiloso corrigido'},userA)
    await database.transaction(async connection=>{
      const clients=await connection.query(`SELECT tenant_id::text,id,external_key FROM clients WHERE (tenant_id=$1 AND external_key='gate-client-a') OR (tenant_id=$2 AND external_key='gate-client-b')`,[tenantA,tenantB])
      const clientA=clients.rows.find(row=>row.tenant_id===tenantA)
      const clientB=clients.rows.find(row=>row.tenant_id===tenantB)
      assert.ok(clientA?.id&&clientB?.id)
      await connection.query(`INSERT INTO clients (tenant_id,consultant_id,external_key,name,status,source) VALUES ($1,$2,$3,'Produtor sintético sem histórico','active','phase3_gate') ON CONFLICT (tenant_id,consultant_id,external_key) DO UPDATE SET status='active',updated_at=NOW()`,[tenantA,userA,emptyClient])
      const rows=[
        [staleMemory,tenantA,clientA.id,'AGRONOMIC','soil_summary',JSON.stringify({summary:'Amostra sintética antiga'}),'FACT','expired','gate:stale','laboratory','2020-01-01T12:00:00.000Z','2021-01-01T12:00:00.000Z',null,userA],
        [conflictA,tenantA,clientA.id,'PRODUCER','planted_area_ha',JSON.stringify(500),'FACT','verified','gate:conflict-a','consultant_input','2026-08-01T12:00:00.000Z',null,null,userA],
        [conflictB,tenantA,clientA.id,'PRODUCER','planted_area_ha',JSON.stringify(620),'FACT','verified','gate:conflict-b','laboratory','2026-08-02T12:00:00.000Z',null,null,userA],
        [foreignMemory,tenantB,clientB.id,'PRODUCER','planted_area_ha',JSON.stringify(999),'FACT','verified','gate:foreign','laboratory','2026-08-02T12:00:00.000Z',null,null,userB]
      ]
      for(const row of rows)await connection.query(`INSERT INTO val_memories (id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,confidence,status,source,source_ref,source_type,valid_from,valid_until,supersedes_id,created_by,acl,created_at,updated_at)
        VALUES ($1,$2,$3,'client',($3::uuid)::text,'fact',$7,$4,$5,$6::jsonb,'[]'::jsonb,80,$8,'phase3_gate',$9,$10,$11,$12,$13,$14,'{"scope":"own_portfolio"}'::jsonb,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value,status=EXCLUDED.status,valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,updated_at=NOW()`,row)
    })
  }

  const contextA=await repositoryA.getClientContext({tenantId:tenantA,clientId:'gate-client-a',ownerId:userA,contextRequest:{requestId:'00000000-0000-4000-8000-000000000411',objective:'agronomic_question',message:'Considere o histórico da área plantada estrutural e os conflitos materiais.',contextDomain:'AGRONOMY',actorRole:'consultant',scope:'own_portfolio'}})
  const emptyContext=await repositoryA.getClientContext({tenantId:tenantA,clientId:emptyClient,ownerId:userA,contextRequest:{requestId:'00000000-0000-4000-8000-000000000412',objective:'general_assistance',actorRole:'consultant',scope:'own_portfolio'}})
  const contextB=await repositoryB.getClientContext({tenantId:tenantB,clientId:'gate-client-b',ownerId:userB,contextRequest:{requestId:'00000000-0000-4000-8000-000000000413',objective:'general_assistance',actorRole:'consultant',scope:'own_portfolio'}})

  assert.ok(contextA.contextSnapshot.selection.selected_refs.length>0)
  assert.ok(contextA.contextSnapshot.selection.excluded_refs.includes(staleMemory))
  assert.ok(contextA.contextSnapshot.selection.exclusion_reason_codes.some(item=>item.ref===staleMemory&&item.reason_codes.includes('EXPIRED')))
  assert.ok(contextA.contextSnapshot.stale_information.some(item=>item.memory_ref===staleMemory))
  assert.ok(contextA.contextSnapshot.conflicts.some(item=>item.memory_refs.includes(conflictA)&&item.memory_refs.includes(conflictB)))
  assert.ok(emptyContext.contextSnapshot.missing_information.some(item=>item.code==='historical_context'))
  assert.equal(JSON.stringify(contextA.contextSnapshot).includes(foreignMemory),false)
  assert.equal(JSON.stringify(contextB.contextSnapshot).includes(conflictA),false)

  let scopeOverrideDenied=false
  try{await repositoryA.getClientContext({tenantId:tenantB,clientId:'gate-client-b',ownerId:userB})}catch(error){scopeOverrideDenied=error?.statusCode===403&&error?.code==='cross_tenant_scope_denied'}
  assert.equal(scopeOverrideDenied,true)
  let foreignClientDenied=false
  try{await repositoryA.getClientContext({tenantId:tenantA,clientId:'gate-client-b',ownerId:userA})}catch(error){foreignClientDenied=error?.statusCode===404}
  assert.equal(foreignClientDenied,true)

  const supersession=await database.query(`SELECT id::text,status,supersedes_id::text FROM val_memories memory WHERE tenant_id=$1 AND client_id=(SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND external_key='gate-client-a') AND key='consultant_technical_context' ORDER BY valid_from`,[tenantA,userA])
  assert.ok(supersession.rows.some(row=>row.status==='expired'))
  const currentTechnical=supersession.rows.find(row=>row.status==='proposed')
  assert.ok(currentTechnical?.supersedes_id)

  let recommendationId,contextSnapshotId,contextSnapshotVersion
  if(!verifyOnly){
    const engine=new ValEngine({runtimeConfig,repository:repositoryA,logger:()=>{},clock:()=>new Date('2026-08-20T12:00:00.000Z')})
    const answer=await engine.answer({tenantId:tenantA,ownerId:userA,clientId:'gate-client-a',client:contextA.client,message:'Prepare uma próxima ação sem inventar os dados conflitantes.',contextRequest:{requestId:'00000000-0000-4000-8000-000000000414',objective:'next_best_action',actorRole:'consultant',scope:'own_portfolio'}})
    recommendationId=answer.recommendationId;contextSnapshotId=answer.contextSnapshotId;contextSnapshotVersion=answer.contextSnapshotVersion
  }else{
    const restoredRecommendation=await database.query(`SELECT id::text,context_snapshot_id::text,context_snapshot_version FROM val_recommendations WHERE tenant_id=$1 AND consultant_id=$2 AND context_snapshot_version='val.context_snapshot.v1' ORDER BY created_at DESC LIMIT 1`,[tenantA,userA])
    recommendationId=restoredRecommendation.rows[0]?.id;contextSnapshotId=restoredRecommendation.rows[0]?.context_snapshot_id;contextSnapshotVersion=restoredRecommendation.rows[0]?.context_snapshot_version
  }
  assert.ok(contextSnapshotId)
  assert.equal(contextSnapshotVersion,'val.context_snapshot.v1')
  const persisted=await database.query('SELECT context_snapshot_id::text,context_snapshot_version,input_context FROM val_recommendations WHERE tenant_id=$1 AND id=$2',[tenantA,recommendationId])
  assert.equal(persisted.rows[0]?.context_snapshot_id,contextSnapshotId)
  assert.equal(persisted.rows[0]?.context_snapshot_version,'val.context_snapshot.v1')
  assert.equal(persisted.rows[0]?.input_context?.contextSnapshot?.context_snapshot_id,contextSnapshotId)
  const persistedSnapshot=await database.query(`SELECT id::text,tenant_id::text,contract_version,selection_policy_version,freshness_policy_version,selected_refs,excluded_refs,exclusion_reason_codes,snapshot_payload FROM val_context_snapshots WHERE tenant_id=$1 AND actor_id=$2 AND id=$3`,[tenantA,userA,contextSnapshotId])
  assert.equal(persistedSnapshot.rowCount,1)
  assert.equal(persistedSnapshot.rows[0].tenant_id,tenantA)
  assert.equal(persistedSnapshot.rows[0].contract_version,'val.context_snapshot.v1')
  assert.equal(persistedSnapshot.rows[0].selection_policy_version,'val.context.selection.v1')
  assert.equal(persistedSnapshot.rows[0].freshness_policy_version,'val.context.freshness.v1')
  assert.equal(persistedSnapshot.rows[0].snapshot_payload?.context_snapshot_id,contextSnapshotId)
  assert.deepEqual(persistedSnapshot.rows[0].selected_refs,persistedSnapshot.rows[0].snapshot_payload?.selection?.selected_refs)
  assert.deepEqual(persistedSnapshot.rows[0].excluded_refs,persistedSnapshot.rows[0].snapshot_payload?.selection?.excluded_refs)
  const crossTenantSnapshot=await database.query('SELECT id FROM val_context_snapshots WHERE tenant_id=$1 AND id=$2',[tenantB,contextSnapshotId])
  assert.equal(crossTenantSnapshot.rowCount,0)

  const migration=await database.query("SELECT version,checksum FROM schema_migrations WHERE version='20260820_002_memory_context_expand'")
  assert.equal(migration.rowCount,1)
  const evidence={
    verifiedAt:new Date().toISOString(),
    environment:verifyOnly?'restored-controlled':'staging-controlled',
    database:databaseName,
    syntheticDataOnly:true,
    migration:{version:migration.rows[0].version,checksum:String(migration.rows[0].checksum||'').trim()},
    supersession:{rows:supersession.rowCount,currentSupersedesPrevious:Boolean(currentTechnical?.supersedes_id)},
    context:{snapshotVersion:contextA.contextSnapshot.contract_version,selectedMemories:contextA.contextSnapshot.selection.selected_refs.length,excludedMemories:contextA.contextSnapshot.selection.excluded_refs.length,selectionAuditProven:true,staleProven:true,conflictProven:true,gapProven:true},
    tenantIsolation:{scopeOverrideDenied,foreignClientDenied,foreignMemoryVisibleInTenantA:false,tenantAMemoryVisibleInTenantB:false},
    recommendation:{id:recommendationId,contextSnapshotId,persisted:true,firstClassSnapshotPersisted:true}
  }
  if(process.env.GATE_EVIDENCE_FILE){
    await mkdir(dirname(process.env.GATE_EVIDENCE_FILE),{recursive:true})
    await writeFile(process.env.GATE_EVIDENCE_FILE,JSON.stringify(evidence,null,2))
  }
  console.log(JSON.stringify(evidence,null,2))
}finally{await database.close()}
