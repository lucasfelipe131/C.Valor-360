import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {prepareK5StagingFixtures,K5_STAGING,K5_ACCOUNTS,K5_SOURCE,isK5Staging} from '../server/k5-staging-fixtures.js'
import {AccessRepository} from '../server/access-repository.js'
import {relationshipSummary} from '../src/lib/commercial-metrics.js'
import {realBusinessClients,realBusinessRecords} from '../src/lib/business-metrics-scope.js'
import {buildOpportunityWorkspace,opportunityMetrics} from '../src/lib/opportunity-workspace.js'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`

test('K5 seed is restricted to exact staging deployment identity',async()=>{
 assert.equal(isK5Staging(K5_STAGING),true)
 for(const key of Object.keys(K5_STAGING))assert.equal(isK5Staging({...K5_STAGING,[key]:'other'}),false)
 assert.deepEqual(await prepareK5StagingFixtures({env:{},db:null}),{status:'SKIPPED_NOT_K5_STAGING'})
})
test('real producers enter frontend KPIs; K5 and derived values do not, operational cards stay available',()=>{
 const real={id:'real',source:'manual',commercial:{potentialTotal:100}},synthetic={id:'k5',source:K5_SOURCE,commercial:{potentialTotal:900}},clients=[real,synthetic]
 assert.equal(relationshipSummary(clients).total,1)
 assert.deepEqual(realBusinessClients(clients),[real])
 assert.deepEqual(realBusinessRecords([{clientId:'real'},{clientId:'k5'}],clients),[{clientId:'real'}])
 const items=buildOpportunityWorkspace(clients,clients.map(c=>({id:c.id,clientId:c.id,value:c.commercial.potentialTotal,stage:'Diagnóstico',status:'open'})))
 assert.equal(items.length,2)
 assert.equal(opportunityMetrics(items).openValue,100)
})
test('canonical seed is idempotent, owns separate portfolios and does not change real SQL KPIs or erase audit',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const f of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile(new URL('../database/migrations/'+f,import.meta.url),'utf8'))
  const db={configured:true,query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(tx=>fn({query:(...args)=>tx.query(...args)}))},tenantId=id(100)
  await pg.query("INSERT INTO organizations(id,name,slug) VALUES($1,'TEST','test')",[tenantId])
  for(const [index,email] of K5_ACCOUNTS.entries()){
   await pg.query("INSERT INTO users(id,name,email,status,must_change_password) VALUES($1,'TEST UAT',$2,'active',false)",[id(index+1),email])
   await pg.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'consultant')",[tenantId,id(index+1)])
  }
  await pg.query("INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,source) VALUES($1,$2,'real',$3,'REAL PRODUCER','manual')",[id(200),tenantId,id(1)])
  const args={db,tenantId,env:K5_STAGING},result=await prepareK5StagingFixtures(args)
  assert.equal(result.status,'READY');assert.equal(result.metricExclusion.equal,true)
  assert.equal(result.metricExclusion.after.summary.producers,1)
  assert.equal(result.metricExclusion.after.summary.visits,0)
  assert.equal(new Set(result.fixtures.map(f=>f.owner)).size,2)
  assert.equal(result.fixtures.filter(f=>f.owner===id(1)).length,2)
  assert.equal(result.fixtures.filter(f=>f.owner===id(2)).length,1)
  const repeat=await prepareK5StagingFixtures(args)
  assert.ok(repeat.fixtures.every(f=>!f.created))
  assert.equal(Number((await pg.query("SELECT COUNT(*) FROM audit_events WHERE action='k5_fixture_seeded'")).rows[0].count),3)
  const b=result.fixtures.find(f=>f.externalKey==='k5-uat-producer-b')
  assert.equal(Object.hasOwn((await pg.query('SELECT relationship_profile FROM clients WHERE id=$1',[b.id])).rows[0].relationship_profile,'hobbies'),false)
  for(const [key,client] of [[301,id(200)],[302,b.id]]){
   await pg.query("INSERT INTO visits(id,tenant_id,client_id,consultant_id) VALUES($1,$2,$3,$4)",[id(key),tenantId,client,id(1)])
   await pg.query("INSERT INTO opportunities(id,tenant_id,client_id,title,stage,estimated_value) VALUES($1,$2,$3,'TEST','Diagnóstico',100)",[id(key+10),tenantId,client])
   await pg.query("INSERT INTO val_recommendations(id,tenant_id,client_id,consultant_id,mode,model_version,generated_content) VALUES($1,$2,$3,$4,'test','test','{}')",[id(key+20),tenantId,client,id(1)])
   await pg.query('INSERT INTO val_feedback(tenant_id,recommendation_id,rating) VALUES($1,$2,4)',[tenantId,id(key+20)])
  }
  await pg.query("INSERT INTO usage_events(tenant_id,user_id,event_type) VALUES($1,$2,'login')",[tenantId,id(1)])
  const repo=new AccessRepository({db,tenantId}),metrics=await repo.getAdminMetrics({role:'admin'})
  for(const key of ['producers','visits','opportunities','val_analyses','val_feedback','accesses'])assert.equal(metrics.summary[key],1,key)
  const user=metrics.users.find(u=>u.id===id(1))
  for(const key of ['producerCount','visits','opportunities','valAnalyses'])assert.equal(user[key],1,key)
  assert.equal((await repo.listUsers({role:'admin'})).find(u=>u.id===id(1)).producerCount,1)
  assert.equal(metrics.daily.reduce((s,d)=>s+d.valAnalyses,0),1)
  await pg.query("UPDATE clients SET relationship_profile='{"+'"hobbies":"contradiction"'+"}' WHERE id=$1",[b.id])
  await assert.rejects(prepareK5StagingFixtures(args),/K5_B_HOBBY_PRECONDITION_FAILED/)
  await pg.query("UPDATE memberships SET role='admin' WHERE user_id=$1",[id(2)])
  await assert.rejects(prepareK5StagingFixtures(args),/K5_UAT_ACCOUNTS_NOT_READY/)
 }finally{await pg.close()}
})
