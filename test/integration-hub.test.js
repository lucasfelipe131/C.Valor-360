import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {createDatabase} from '../server/db.js'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {ValRepository} from '../server/repository.js'
import {normalizeIntegrationEvent} from '../server/ingestion.js'
import {IntegrationHub} from '../server/integration-hub/service.js'
import {describeEvent,SOURCE_SYSTEMS} from '../server/integration-hub/registry.js'
import {createAuth} from '../server/auth.js'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'

const tenantId=randomUUID(),ownerId=randomUUID(),otherTenant=randomUUID(),otherOwner=randomUUID()
const scope={tenantId,ownerId}
let db,pg,repository,hub
const input=(extra={})=>normalizeIntegrationEvent({schemaVersion:1,type:'manual.producer.updated',externalId:randomUUID(),ownerUserId:ownerId,source:'manual-do-agronomo',occurredAt:'2026-09-28T10:00:00Z',clientExternalKey:`synthetic-${randomUUID()}`,payload:{producer:{id:randomUUID(),name:`SYNTHETIC ${randomUUID()}`,city:'Sorriso',areaHa:100}},...extra})
const receive=(event,extra={})=>hub.ingest({...scope,event,...extra})
const client=async id=>(await db.query('SELECT * FROM clients WHERE id=$1',[id])).rows[0]
const ledger=async id=>(await db.query('SELECT * FROM integration_events WHERE id=$1',[id])).rows[0]
before(async()=>{
 if(process.env.VAL_HUB_TEST_DATABASE_URL){
  const url=new URL(process.env.VAL_HUB_TEST_DATABASE_URL)
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'synthetic loopback database only')
  db=createDatabase({databaseUrl:url.href,databaseSsl:false})
  assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000),16)
 }else{
  pg=new PGlite()
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
  db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)})),close:()=>pg.close()}
 }
 for(const id of [tenantId,otherTenant])await db.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[id,'SYNTHETIC Hub test'])
 for(const id of [ownerId,otherOwner])await db.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[id,'SYNTHETIC Hub owner',`${id}@example.test`])
 for(const t of [tenantId,otherTenant])for(const o of [ownerId,otherOwner])await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'consultant')",[t,o])
 repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{}})
 hub=new IntegrationHub({db,repository,tenantId})
})
after(async()=>{await db?.close()})

test('Hub registry uses the ten real Manual events and stable object hashing',()=>{
 assert.equal(SOURCE_SYSTEMS['manual-do-agronomo'].events.length,10)
 const event=input({payload:{b:2,a:1}})
 assert.equal(describeEvent(event).envelopeHash,describeEvent({...event,payload:{a:1,b:2},occurredAt:'2026-09-29T00:00:00Z'}).envelopeHash)
 assert.throws(()=>describeEvent({...event,sourceVersion:-1}),/hub|Versão/)
})
test('Hub creates once in canonical clients and preserves provenance without exposing payload',async()=>{
 const event=input(),result=await receive(event)
 assert.equal(result.status,'PROCESSED',JSON.stringify(result));assert.ok(result.canonicalClientId)
 assert.equal((await client(result.canonicalClientId)).external_key,event.clientExternalKey)
 const detail=await hub.detail({...scope,eventId:result.eventId})
 assert.equal(detail.provenance.ownerId,ownerId);assert.equal(detail.provenance.sourceEvent,event.externalId)
 assert.equal(detail.provenance.canonicalClientId,result.canonicalClientId)
 assert.deepEqual(detail.audit.map(x=>x.action),['RECEIVED','PROCESSED'])
 assert.ok(detail.provenance.receivedAt);assert.ok(detail.provenance.observedAt)
 assert.equal(detail.event.attempts,1);assert.equal('payload' in detail.event,false)
})
test('Hub concurrent repeated deliveries preserve one event, one client and one projection',async()=>{
 const event=input(),results=await Promise.all(Array.from({length:6},()=>receive(event)))
 assert.equal(results.filter(x=>x.status==='PROCESSED').length,1)
 assert.equal(results.filter(x=>x.status==='DUPLICATE').length,5)
 assert.equal((await db.query('SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND external_key=$3',[tenantId,ownerId,event.clientExternalKey])).rows.length,1)
 const id=results[0].eventId
 assert.equal((await ledger(id)).attempt_count,1)
 assert.equal((await hub.detail({...scope,eventId:id})).audit.filter(x=>x.action==='DUPLICATE').length,5)
})
test('Hub immutable event id rejects content and target substitution while preserving original',async()=>{
 const event=input(),first=await receive(event),original=await ledger(first.eventId)
 for(const changed of [{...event,payload:{producer:{...event.payload.producer,name:'MUST NOT OVERWRITE'}}},{...event,clientExternalKey:'other-key'}]){
  const result=await receive(changed);assert.equal(result.status,'CONFLICT')
 }
 assert.deepEqual((await ledger(first.eventId)).payload,original.payload)
 assert.equal((await client(first.canonicalClientId)).name,event.payload.producer.name)
 const reviews=await hub.overview({...scope,status:'REVIEW_REQUIRED'})
 assert.ok(reviews.events.some(x=>x.id===first.eventId&&x.reviewRequired))
})
test('Hub resolves canonical UUID/key/alias/producer id and keeps the canonical key stable',async()=>{
 const event=input(),first=await receive(event),id=first.canonicalClientId
 const next=input({...event,externalId:randomUUID(),clientExternalKey:'new-external-'+randomUUID(),occurredAt:'2026-09-29T10:00:00Z'})
 const result=await receive(next)
 assert.equal(result.status,'PROCESSED',JSON.stringify(result));assert.equal(result.canonicalClientId,id)
 assert.equal((await client(id)).external_key,event.clientExternalKey)
 assert.ok((await client(id)).commercial_profile.manual_identity.external_key_aliases.includes(next.clientExternalKey))
 const record=input({type:'manual.record.saved',clientExternalKey:next.clientExternalKey,payload:{recordId:randomUUID(),title:'SYNTHETIC record'}})
 assert.equal((await receive(record)).canonicalClientId,id)
 const byUuid=input({type:'manual.record.saved',clientExternalKey:id,payload:{recordId:randomUUID()}})
 const linked=await receive(byUuid);assert.equal(linked.canonicalClientId,id)
 const context=await repository.getClientContext({...scope,clientId:event.clientExternalKey})
 assert.ok(context.manualRecords.some(x=>x.id===linked.eventId),'canonical linkage feeds the existing VAL context')
})
test('Hub ambiguous aliases and unproven homonyms require review without a new client',async()=>{
 const first=input(),second=input(),a=await receive(first),b=await receive(second)
 const event=input({clientExternalKey:first.clientExternalKey,payload:{producer:{id:second.payload.producer.id,name:'SYNTHETIC ambiguous'}}})
 assert.equal((await receive(event)).status,'REVIEW_REQUIRED')
 const homonym=input({payload:{producer:{id:randomUUID(),name:first.payload.producer.name}}})
 const result=await receive(homonym);assert.equal(result.errorCode,'hub_identity_name_collision')
 assert.equal((await db.query('SELECT id FROM clients WHERE tenant_id=$1 AND external_key=$2',[tenantId,homonym.clientExternalKey])).rows.length,0)
 assert.ok(await client(a.canonicalClientId));assert.ok(await client(b.canonicalClientId))
})
test('Hub rejects unresolved and archived targets instead of silently reviving or creating producers',async()=>{
 const unresolved=await receive(input({type:'manual.record.saved',payload:{recordId:'unresolved'}}))
 assert.equal(unresolved.status,'REVIEW_REQUIRED')
 const event=input(),created=await receive(event)
 await db.query("UPDATE clients SET status='archived' WHERE id=$1",[created.canonicalClientId])
 const result=await receive({...event,externalId:randomUUID()})
 assert.equal(result.errorCode,'hub_producer_archived');assert.equal((await client(created.canonicalClientId)).status,'archived')
})
test('Hub accepts Manual record before producer, then resolves the exact dependency without duplicate or cross-owner retry',async()=>{
 const producer=input()
 const event=input({type:'manual.record.saved',clientExternalKey:producer.clientExternalKey,payload:{recordId:randomUUID(),recordType:'producer_change',title:'SYNTHETIC out-of-order record'}})
 const early=await receive(event),foreign=await receive({...event,ownerUserId:otherOwner},{ownerId:otherOwner})
 assert.equal(early.status,'REVIEW_REQUIRED');assert.equal(early.retryEligible,true)
 // Preserve and recover unresolved records written by the first Hub staging build.
 await db.query('UPDATE integration_events SET retry_eligible=false WHERE id=$1',[early.eventId])
 const created=await receive(producer)
 const resolved=await ledger(early.eventId)
 assert.equal(resolved.status,'processed');assert.equal(resolved.canonical_client_id,created.canonicalClientId)
 assert.equal(resolved.attempt_count,2);assert.equal((await ledger(foreign.eventId)).status,'review_required')
 assert.deepEqual((await hub.detail({...scope,eventId:early.eventId})).audit.map(x=>x.action),['RECEIVED','REVIEW_REQUIRED','IDENTITY_RECHECK','PROCESSED'])
 assert.equal((await receive(event)).status,'DUPLICATE')
 const context=await repository.getClientContext({...scope,clientId:producer.clientExternalKey})
 assert.equal(context.manualRecords.filter(x=>x.id===early.eventId).length,1)
})
test('Hub older / same-version conflict / newer versions do not overwrite out of order',async()=>{
 const event=input({sourceVersion:2}),first=await receive(event)
 const change=(version,name,occurredAt)=>({...event,externalId:randomUUID(),sourceVersion:version,occurredAt,payload:{producer:{...event.payload.producer,name}}})
 assert.equal((await receive(change(1,'OLD','2026-09-29T00:00:00Z'))).status,'OLDER')
 assert.equal((await receive(change(2,'CONFLICT','2026-09-29T00:00:00Z'))).decision,'CONFLICT')
 assert.equal((await receive(change(3,'NEW','2026-09-27T00:00:00Z'))).status,'PROCESSED')
 assert.equal((await receive(change(2,'OLD AGAIN','2026-09-30T00:00:00Z'))).status,'OLDER')
 assert.equal((await client(first.canonicalClientId)).name,'NEW')
 assert.equal((await receive(change(null,'NO VERSION','2026-09-30T00:00:00Z'))).errorCode,'hub_version_missing')
})
test('Hub preserves stronger canonical facts and local edits',async()=>{
 const event=input(),first=await receive(event)
 await db.query("UPDATE clients SET source='survey',name='SYNTHETIC authoritative' WHERE id=$1",[first.canonicalClientId])
 const result=await receive({...event,externalId:randomUUID(),occurredAt:'2026-09-29T00:00:00Z'})
 assert.equal(result.errorCode,'hub_canonical_data_conflict');assert.equal((await client(first.canonicalClientId)).name,'SYNTHETIC authoritative')
 const manual=input(),created=await receive(manual)
 await db.query("UPDATE clients SET name='SYNTHETIC local edit',updated_at=now()+interval '1 second' WHERE id=$1",[created.canonicalClientId])
 assert.equal((await receive({...manual,externalId:randomUUID(),occurredAt:'2026-09-29T00:00:00Z'})).errorCode,'hub_canonical_data_conflict')
})
test('Hub validated record cannot be downgraded by a newer unapproved record',async()=>{
 const producer=input();await receive(producer)
 const event=input({type:'manual.record.saved',clientExternalKey:producer.clientExternalKey,payload:{recordId:randomUUID(),validation:{status:'approved',reviewerId:'synthetic-reviewer',reviewedAt:'2026-09-27T00:00:00Z'}}})
 assert.equal((await receive(event)).status,'PROCESSED')
 const result=await receive({...event,externalId:randomUUID(),occurredAt:'2026-09-29T00:00:00Z',payload:{...event.payload,validation:{status:'pending'}}})
 assert.equal(result.errorCode,'hub_approved_data_conflict')
 const context=await repository.getClientContext({tenantId,ownerId,clientId:producer.clientExternalKey})
 assert.ok(!JSON.stringify(context.manualRecords).includes(result.eventId),'quarantine must not enter ContextSnapshot inputs')
})
test('Hub projection failure rolls back domain writes, records safe error, retries exactly once',async()=>{
 const event=input(),real=repository.ingestEvent.bind(repository)
 let fail=true
 const failing={ingestEvent:async args=>{const result=await real(args);if(fail)throw Object.assign(new Error('secret MUST NOT LEAK'),{code:'40001'});return result}}
 const service=new IntegrationHub({db,repository:failing,tenantId})
 const result=await service.ingest({...scope,event})
 assert.equal(result.status,'FAILED');assert.equal(result.retryEligible,true)
 assert.equal((await db.query('SELECT id FROM clients WHERE tenant_id=$1 AND external_key=$2',[tenantId,event.clientExternalKey])).rows.length,0)
 assert.ok(!JSON.stringify(await service.detail({...scope,eventId:result.eventId})).includes('MUST NOT LEAK'))
 await assert.rejects(service.retry({...scope,eventId:result.eventId}),e=>e.code==='hub_retry_backoff')
 await db.query("UPDATE integration_events SET next_retry_at=now()-interval '1 second' WHERE id=$1",[result.eventId]);fail=false
 const retry=await service.retry({...scope,eventId:result.eventId})
 assert.equal(retry.status,'PROCESSED');assert.equal((await ledger(result.eventId)).attempt_count,2)
 await assert.rejects(service.retry({...scope,eventId:result.eventId}),e=>e.code==='hub_retry_not_eligible')
 assert.equal((await receive(event)).status,'DUPLICATE')
})
test('Hub retry exhaustion and permanent errors remain auditable without blocking other events',async()=>{
 const broken=new IntegrationHub({db,repository:{ingestEvent:async()=>{throw Object.assign(new Error('fail'),{statusCode:503})}},tenantId})
 const result=await broken.ingest({...scope,event:input()})
 for(let i=0;i<4;i++){await db.query("UPDATE integration_events SET next_retry_at=now()-interval '1 second' WHERE id=$1",[result.eventId]);await broken.retry({...scope,eventId:result.eventId})}
 assert.equal((await ledger(result.eventId)).attempt_count,5);assert.equal((await ledger(result.eventId)).retry_eligible,false)
 const permanent=new IntegrationHub({db,repository:{ingestEvent:async()=>{throw Object.assign(new Error('unsafe private diagnostic'),{statusCode:422,code:'invalid_geometry'})}},tenantId})
 const rejected=await permanent.ingest({...scope,event:input()})
 assert.equal(rejected.status,'REJECTED');assert.equal(rejected.retryEligible,false)
 assert.equal((await receive(input())).status,'PROCESSED')
})
test('Hub tenant/owner isolation for identity, event ids, audit, reads and retry',async()=>{
 const event=input(),first=await receive(event)
 const second=await receive({...event,ownerUserId:otherOwner},{ownerId:otherOwner})
 assert.equal(second.status,'PROCESSED');assert.notEqual(first.canonicalClientId,second.canonicalClientId)
 const foreignRepo=new ValRepository({db,tenantId:otherTenant,readStore:()=>({}),saveStore:()=>{}})
 const foreign=new IntegrationHub({db,repository:foreignRepo,tenantId:otherTenant})
 const third=await foreign.ingest({tenantId:otherTenant,ownerId,event})
 assert.equal(third.status,'PROCESSED');assert.notEqual(third.canonicalClientId,first.canonicalClientId)
 for(const method of ['detail','retry'])await assert.rejects(hub[method]({tenantId,ownerId:otherOwner,eventId:first.eventId}),e=>e.statusCode===404)
 await assert.rejects(hub.overview({tenantId:otherTenant,ownerId}),e=>e.statusCode===403)
 await assert.rejects(receive({...event,ownerUserId:otherOwner}),e=>e.statusCode===403)
 const overview=await hub.overview({tenantId,ownerId:otherOwner,status:null})
 assert.ok(overview.events.every(x=>x.id!==first.eventId&&x.id!==third.eventId))
})
test('Hub resolves owner reassignment without revealing current producer data to old owner',async()=>{
 const event=input(),first=await receive(event)
 await db.query('UPDATE clients SET consultant_id=$2,name=$3 WHERE id=$1',[first.canonicalClientId,otherOwner,'PRIVATE new portfolio name'])
 const detail=await hub.detail({...scope,eventId:first.eventId})
 assert.equal(detail.provenance.canonicalClientId,null);assert.equal(detail.event.clientName,null)
 assert.ok(!JSON.stringify(detail).includes('PRIVATE'))
})
test('Hub migration repeat keeps ledger and audit byte-equivalent',async()=>{
 const snapshot=async()=>JSON.stringify((await db.query('SELECT * FROM integration_events WHERE tenant_id=$1 ORDER BY id',[tenantId])).rows)
 const before=snapshot();const sql=await readFile(new URL('../database/migrations/20261002_016_integration_hub_expand.sql',import.meta.url),'utf8')
 if(pg)await pg.exec(sql);else await db.query(sql)
 assert.equal(await snapshot(),await before)
})

// The same suite is executed against disposable PostgreSQL 16 by the CI gate.
// Only that run can start the real application against the test database.
if(process.env.VAL_HUB_TEST_DATABASE_URL)test('Hub real HTTP: signed Manual webhook, session ACL, spoofed owner, quarantine, liveness',async()=>{
 const httpTenant='00000000-0000-4000-8000-000000000001'
 for(const id of [ownerId,otherOwner])await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'consultant') ON CONFLICT (tenant_id,user_id) DO NOTHING",[httpTenant,id])
 const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve))
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
 const config={adminEmail:`hub-admin-${randomUUID()}@example.test`,adminPassword:'Synthetic-hub-test-42!',sessionSecret:'synthetic-hub-session-not-a-deployed-secret-42',defaultTenantId:httpTenant,sessionTtlSeconds:3600}
 const signingSecret='synthetic-hub-webhook-only'
 // Prevent the legacy bootstrap recovery from claiming deliberately synthetic users.
 await db.query("UPDATE users SET password_hash='synthetic-no-login' WHERE id=ANY($1::uuid[])",[[ownerId,otherOwner]])
 const child=spawn(process.execPath,['server/start.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATABASE_URL:process.env.VAL_HUB_TEST_DATABASE_URL,PG_SSL:'false',AUTO_MIGRATE:'false',VAL_DEMO_MODE:'false',OPENAI_API_KEY:'',VAL_DEFAULT_TENANT_ID:httpTenant,VAL_ADMIN_EMAIL:config.adminEmail,VAL_ADMIN_PASSWORD:config.adminPassword,VAL_SESSION_SECRET:config.sessionSecret,VAL_MANUAL_WEBHOOK_SECRET:signingSecret,VAL_INTEGRATION_TOKEN:'synthetic-hub-token-only'},stdio:['ignore','pipe','pipe']})
 const auth=createAuth(config),cookie=id=>`valor360_session=${auth.issue({id,email:`${id}@example.test`,tenantId:httpTenant,role:'consultant'})}`
 const call=(path,options={})=>fetch(`http://127.0.0.1:${port}${path}`,options)
 try{
  await new Promise((resolve,reject)=>{let output='',diagnostic='';const timer=setTimeout(()=>reject(new Error('Hub HTTP startup timeout')),20000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('VALOR 360 disponível na porta')){clearTimeout(timer);resolve()}});child.stderr.on('data',chunk=>{diagnostic+=String(chunk).slice(0,1000)});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Hub HTTP exit ${code}: ${diagnostic.slice(0,1000)}`))})})
  assert.equal((await call('/api/integration-hub/overview')).status,401)
  const event=input(),{createHmac}=await import('node:crypto'),raw=JSON.stringify(event)
  const headers={'content-type':'application/json','x-valor-signature':`sha256=${createHmac('sha256',signingSecret).update(raw).digest('hex')}`}
  const accepted=await call('/api/v1/integrations/manual/events',{method:'POST',headers,body:raw})
  const result=await accepted.json();assert.equal(accepted.status,202,JSON.stringify(result));assert.equal(result.status,'PROCESSED')
  const privatePath=`/api/integration-hub/events/${result.eventId}`
  assert.equal((await call(privatePath,{headers:{cookie:cookie(otherOwner)}})).status,404)
  assert.equal((await call(privatePath+'/retry',{method:'POST',headers:{cookie:cookie(otherOwner)}})).status,404)
  const own=await call(privatePath,{headers:{cookie:cookie(ownerId)}});assert.equal(own.status,200);assert.match(own.headers.get('cache-control'),/no-store/)
  const overviewResponse=await call(`/api/integration-hub/overview?ownerId=${ownerId}`,{headers:{cookie:cookie(otherOwner)}})
  const overview=await overviewResponse.json();assert.equal(overviewResponse.status,200,JSON.stringify(overview))
  assert.ok(overview.events.every(x=>x.id!==result.eventId),'query owner cannot override session')
  await db.query("UPDATE memberships SET role='bi_viewer' WHERE tenant_id=$1 AND user_id=$2",[httpTenant,otherOwner])
  assert.equal((await call('/api/integration-hub/overview',{headers:{cookie:cookie(otherOwner)}})).status,403)
  const tampered=await call('/api/v1/integrations/manual/events',{method:'POST',headers,body:raw+' '});assert.equal(tampered.status,401)
  assert.equal((await call('/live')).status,200)
 }finally{
  child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
 }
})
