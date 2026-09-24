import {createHash} from 'node:crypto'
import {ValRepository} from './repository.js'
import {realBusinessRecord} from './business-metrics-scope.js'
import {AccessRepository} from './access-repository.js'

export const K5_SOURCE='k5_synthetic_fixture'
export const K5_ACCOUNTS=['uat.val.20260919.a@example.test','uat.val.20260919.b@example.test']
export const K5_STAGING={RAILWAY_PROJECT_ID:'3689bcaa-603c-42f7-9e36-0b01274207c1',RAILWAY_ENVIRONMENT_ID:'8117b07b-7053-4a5a-a5c8-3f3401fef195',RAILWAY_SERVICE_ID:'28d9c5f8-40bb-412e-8a58-40a11c892f2a'}
export const isK5Staging=env=>Object.entries(K5_STAGING).every(([key,value])=>env[key]===value)
const idFor=(tenant,key)=>{
 const h=createHash('sha256').update(`${K5_SOURCE}:${tenant}:${key}`).digest('hex')
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
}
// Only the approved fixture facts. Numeric values below are synthetic test inputs,
// not new K5 thresholds/oracles. No birthday, phone or hobby is invented.
export const K5_PRODUCERS=[
 {key:'k5-uat-producer-a',name:'Produtor UAT A',account:0,area:100,channel:'WhatsApp',preferredName:'Horizonte',notes:'[SINTÉTICO K5] Área irrigada: 0 ha, confirmado no cadastro da fixture. Canal WhatsApp confirmado; origem: ficha canônica K5. Intenção comercial de teste; nenhum contrato assinado. Retorno futuro somente proposto, não confirmado.'},
 {key:'k5-uat-producer-b',name:'Produtor UAT B',account:0,area:80,channel:'Presencial',preferredName:'Horizonte',notes:'[SINTÉTICO K5] Canal presencial; origem: ficha canônica K5. Produtividade registrada somente como meta de planejamento, nunca colheita realizada.'},
 {key:'k5-uat-portfolio-b-exclusive',name:'Produtor UAT exclusivo carteira B',account:1,area:60,channel:'E-mail',preferredName:'UAT exclusivo B',notes:'[SINTÉTICO K5] Ficha exclusiva da carteira do consultor B; preferência de contato por e-mail. Não pertence à carteira A.'}
]

// Read actual application KPI queries, without impersonating an authenticated
// administrator: this internal job has no HTTP session and performs no PR011 proof.
async function metricSnapshot(connection,tenantId){
 const repo=new AccessRepository({db:{configured:true,query:(...args)=>connection.query(...args)},tenantId})
 const result=await repo.getAdminMetrics({role:'admin'},30)
 const keys=['producers','visits','opportunities','val_analyses','val_feedback']
 const money=(await connection.query(`SELECT (SELECT COALESCE(SUM(estimated_value),0)::text FROM opportunities WHERE tenant_id=$1 AND ${realBusinessRecord('opportunities')}) opportunity_value,(SELECT COALESCE(SUM(value),0)::text FROM business_events WHERE tenant_id=$1 AND ${realBusinessRecord('business_events')}) business_value`,[tenantId])).rows[0]
 return {money,summary:Object.fromEntries(keys.map(k=>[k,result.summary[k]])),users:result.users.map(u=>({id:u.id,producerCount:u.producerCount,valAnalyses:u.valAnalyses,visits:u.visits,opportunities:u.opportunities})).sort((a,b)=>a.id.localeCompare(b.id)),daily:result.daily.map(d=>({day:d.day,valAnalyses:d.valAnalyses}))}
}

export async function prepareK5StagingFixtures({db,tenantId,env=process.env}){
 if(!isK5Staging(env))return {status:'SKIPPED_NOT_K5_STAGING'}
 if(!db.configured)throw new Error('K5_FIXTURE_DATABASE_UNAVAILABLE')
 return db.transaction(async connection=>{
  await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${K5_SOURCE}:${tenantId}`])
  const accounts=(await connection.query(`SELECT u.id,u.email,u.status,u.must_change_password,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$1 WHERE u.email=ANY($2::text[]) ORDER BY u.email`,[tenantId,K5_ACCOUNTS])).rows
  if(accounts.length!==2||accounts.some((u,i)=>u.email!==K5_ACCOUNTS[i]||u.status!=='active'||u.must_change_password||u.role!=='consultant')||accounts[0].id===accounts[1].id)throw new Error('K5_UAT_ACCOUNTS_NOT_READY')
  const before=await metricSnapshot(connection,tenantId)
  const fixtures=[]
  for(const fixture of K5_PRODUCERS){
   const owner=accounts[fixture.account],id=idFor(tenantId,fixture.key)
   const existing=(await connection.query('SELECT id,consultant_id,source,status,relationship_profile FROM clients WHERE tenant_id=$1 AND (id=$2 OR external_key=$3)',[tenantId,id,fixture.key])).rows
   if(existing.some(c=>c.id!==id||c.consultant_id!==owner.id||c.source!==K5_SOURCE||c.status!=='active'))throw new Error('K5_FIXTURE_COLLISION')
   const inserted=await connection.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,total_area_ha,cultures,preferred_channel,commercial_profile,relationship_profile,source) VALUES($1,$2,$3,$4,$5,'Município sintético K5',$6,'Soja; Milho',$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING RETURNING id`,[id,tenantId,fixture.key,owner.id,fixture.name,fixture.area,fixture.channel,JSON.stringify({commercialNotes:fixture.notes,...(fixture.preferredName==='Horizonte'?{aliases:['Horizonte']}:{})}),JSON.stringify({preferredName:fixture.preferredName,communicationNotes:`[SINTÉTICO K5] Canal ${fixture.channel}; origem: fixture canônica K5.`}),K5_SOURCE])
   // Preserve edits after the initial seed. A contradictory hobby never silently
   // becomes PASS; fail the precondition and leave all data untouched by rollback.
   if(fixture.key==='k5-uat-producer-b'&&Object.hasOwn(existing[0]?.relationship_profile||{},'hobbies')&&String(existing[0].relationship_profile.hobbies||'').trim())throw new Error('K5_B_HOBBY_PRECONDITION_FAILED')
   if(inserted.rows.length){
    const property=idFor(tenantId,fixture.key+':property'),field=idFor(tenantId,fixture.key+':field')
    await connection.query(`INSERT INTO properties(id,tenant_id,client_id,name,area_ha,metadata) VALUES($1,$2,$3,$4,$5,$6)`,[property,tenantId,id,`Propriedade sintética ${fixture.name}`,fixture.area,JSON.stringify({source:K5_SOURCE})])
    await connection.query(`INSERT INTO fields(id,tenant_id,property_id,name,area_ha) VALUES($1,$2,$3,'Talhão sintético K5',$4)`,[field,tenantId,property,fixture.area])
    for(const [season,crop,target] of [['2025/26','Soja',fixture.account===0?60:55],['2026/27','Milho',fixture.account===0?100:90]])await connection.query(`INSERT INTO crop_seasons(id,tenant_id,field_id,season,crop,area_ha,productivity_target,productivity_actual,unit) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,'sc/ha')`,[idFor(tenantId,fixture.key+':'+season),tenantId,field,season,crop,fixture.area,target])
    if(fixture.key==='k5-uat-producer-a')await connection.query(`INSERT INTO visits(id,tenant_id,client_id,consultant_id,scheduled_at,objective,summary,status,lifecycle_status,completed_at) VALUES($1,$2,$3,$4,'2026-09-19T12:00:00Z','[SINTÉTICO K5] Visita de teste','[SINTÉTICO K5] Visita Realizada, sem contrato ou compromisso futuro confirmado.','Realizada','COMPLETED','2026-09-19T13:00:00Z')`,[idFor(tenantId,'visit-a'),tenantId,id,owner.id])
    await connection.query(`INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,NULL,'k5_fixture_seeded','client',$2,$3)`,[tenantId,id,JSON.stringify({source:K5_SOURCE,ownerId:owner.id,externalKey:fixture.key,seed:'2026-09-24-v1'})])
   }
   fixtures.push({id,externalKey:fixture.key,owner:owner.id,account:owner.email,tenantId,source:K5_SOURCE,created:Boolean(inserted.rows.length)})
  }
  const after=await metricSnapshot(connection,tenantId)
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('K5_METRIC_EXCLUSION_FAILED')
  const repositoryProof=await verifyK5RepositoryIsolation({db:{configured:true,query:(...args)=>connection.query(...args)},tenantId,fixtures})
  return {status:'READY',fixtures,metricExclusion:{before,after,equal:true},repositoryProof,pr011:'AUTHENTICATED_SESSION_PROOF_STILL_REQUIRED'}
 },{timeoutMs:60000})
}

// Zero provider calls: these checks exercise the production repository/resolver.
// They complement, and never substitute for, the two non-admin session checks.
export async function verifyK5RepositoryIsolation({db,tenantId,fixtures}){
 const repository=new ValRepository({db,tenantId})
 const a=fixtures.find(f=>f.externalKey==='k5-uat-producer-a'),b=fixtures.find(f=>f.externalKey==='k5-uat-portfolio-b-exclusive')
 const checks=[]
 for(const [own,foreign] of [[a,b],[b,a]]){
  await repository.getClientContext({tenantId,ownerId:own.owner,clientId:own.id})
  checks.push({owner:own.owner,case:'own_id',status:'PASS'})
  try{await repository.getClientContext({tenantId,ownerId:own.owner,clientId:foreign.id});throw new Error('K5_CROSS_PORTFOLIO_LEAK')}catch(error){if(error.statusCode!==404)throw error}
  checks.push({owner:own.owner,case:'foreign_id',status:'BLOCKED'})
  const foreignName=K5_PRODUCERS.find(f=>f.key===foreign.externalKey).name
  const resolved=await repository.resolveAuthorizedClientReference({ownerId:own.owner,reference:foreignName})
  if(resolved.status==='RESOLVED')throw new Error('K5_CROSS_PORTFOLIO_NAME_LEAK')
  checks.push({owner:own.owner,case:'foreign_name',status:'BLOCKED'})
  const followup=await repository.resolveAuthorizedClientReference({ownerId:own.owner,message:'E o que faço com ele?',currentClientId:foreign.externalKey,recentClientIds:[foreign.externalKey]})
  if(followup.status==='RESOLVED')throw new Error('K5_CROSS_PORTFOLIO_CONTEXT_LEAK')
  checks.push({owner:own.owner,case:'foreign_context_followup',status:'BLOCKED'})
 }
 return {layer:'REPOSITORY_WITH_CONSULTANT_OWNER_SCOPE',checks,crossPortfolioLeak:0,providerCalls:0}
}
