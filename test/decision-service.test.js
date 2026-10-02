import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {createDatabase} from '../server/db.js'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {ValRepository} from '../server/repository.js'
import {DecisionService} from '../server/decision-service.js'
import {createManagementService} from '../server/management-service.js'
import {createAuth} from '../server/auth.js'

const tenantId=process.env.VAL_DECISION_TEST_DATABASE_URL?'00000000-0000-4000-8000-000000000001':randomUUID(),foreignTenant=randomUUID()
const actor={id:randomUUID(),tenantId,role:'consultant'},other={id:randomUUID(),tenantId,role:'consultant'},admin={id:randomUUID(),tenantId,role:'admin'},viewer={id:randomUUID(),tenantId,role:'bi_viewer'},foreign={id:randomUUID(),tenantId:foreignTenant,role:'consultant'}
let db,pg,repository,service,management,unit
const now=Date.now(),recent=new Date(now-3600000).toISOString(),soon=new Date(now+86400000).toISOString()
const period={start:new Date(now-86400000).toISOString().slice(0,10),end:new Date(now+86400000).toISOString().slice(0,10)}
async function producer(owner=actor,{name='SYNTHETIC homonym',opportunity=true,source='manual'}={}){
 const id=randomUUID(),key=`synthetic-nba-${randomUUID()}`
 await db.query('INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,source) VALUES($1,$2,$3,$4,$5,$6)',[id,owner.tenantId,key,owner.id,name,source])
 const opId=randomUUID()
 if(opportunity)await db.query("INSERT INTO opportunities(id,tenant_id,client_id,title,stage,estimated_value,next_action,next_action_at,updated_at) VALUES($1,$2,$3,'SYNTHETIC next decision','Negociação',2500,'Confirmar prazo',$4,$5)",[opId,owner.tenantId,id,soon,recent])
 return {id,key,opId}
}
const generate=client=>service.generate(actor,{clientId:client.key,now})
before(async()=>{
 if(process.env.VAL_DECISION_TEST_DATABASE_URL){
  const url=new URL(process.env.VAL_DECISION_TEST_DATABASE_URL)
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'synthetic loopback database only')
  db=createDatabase({databaseUrl:url.href,databaseSsl:false})
  assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000),16)
 }else{
  pg=new PGlite()
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
  db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)})),close:()=>pg.close()}
 }
 for(const id of [tenantId,foreignTenant])await db.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text) ON CONFLICT(id) DO NOTHING',[id,'SYNTHETIC decision test'])
 for(const user of [actor,other,admin,viewer,foreign]){
  await db.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[user.id,'SYNTHETIC decision owner',`${user.id}@example.test`,'synthetic-no-login'])
  await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[user.tenantId,user.id,user.role])
 }
 repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{throw new Error('No fallback writes')}})
 service=new DecisionService({db,repository,tenantId,environment:'test'})
 management=createManagementService({db,tenantId})
 unit=(await management.createUnit(admin,{name:`SYNTHETIC unit ${randomUUID()}`})).unit
 for(const user of [actor,viewer])await management.assignUnit(admin,{userId:user.id,unitId:unit.id})
})
after(async()=>{await db?.close()})

test('NBA database canonical identity, idempotent generation and append-only evidence versions',async()=>{
 const client=await producer(),first=(await generate(client)).cards[0],second=(await generate(client)).cards[0]
 assert.equal(first.id,second.id);assert.equal(first.producer.canonical_id,client.id);assert.equal(first.revision,1)
 assert.ok(first.context_snapshot_ref)
 await db.query("UPDATE opportunities SET estimated_value=250000,next_action_at=$2,updated_at=now() WHERE id=$1",[client.opId,new Date(now-86400000).toISOString()])
 const changed=(await generate(client)).cards[0]
 assert.equal(changed.revision,2);assert.notEqual(changed.id,first.id)
 const detail=await service.detail(actor,changed.id)
 assert.ok(['decision_generated','evidence_changed','priority_changed'].every(action=>detail.audit.some(a=>a.action===action)))
 assert.equal((await service.detail(actor,first.id)).card.expected_value.amount,2500)
 assert.equal(changed.policy_version,detail.audit[0].policy_version)
})
test('NBA database rejects cross-owner/tenant and homonyms without linking by name',async()=>{
 const a=await producer(),b=await producer(other),f=await producer(foreign)
 const card=(await generate(a)).cards[0]
 for(const key of [b.key,b.id,f.key,f.id])await assert.rejects(service.generate(actor,{clientId:key,now}),{statusCode:404})
 await assert.rejects(service.generate({...actor,tenantId:foreignTenant}),{statusCode:403})
 await assert.rejects(service.detail(other,card.id),{statusCode:404})
 await assert.rejects(service.feedback(other,card.id,{requestId:randomUUID(),feedback:'USEFUL'}),{statusCode:404})
 await assert.rejects(service.review(other,card.id,{status:'RESOLVED',reason:'spoofed'}),{statusCode:404})
 assert.ok((await service.generate(actor,{now})).cards.every(c=>c.producer_id!==b.key&&c.producer_id!==f.key))
})
test('NBA database revocation and portfolio transfer hide historical cards and feedback',async()=>{
 const client=await producer(),card=(await generate(client)).cards[0]
 await db.query('UPDATE clients SET consultant_id=$2 WHERE id=$1',[client.id,other.id])
 await assert.rejects(service.detail(actor,card.id),{statusCode:404})
 await assert.rejects(service.feedback(actor,card.id,{requestId:randomUUID(),feedback:'ACTION_EXECUTED'}),{statusCode:404})
 assert.ok(!(await service.queue(actor)).items.some(r=>r.card_id===card.id))
 await db.query("UPDATE users SET status='inactive' WHERE id=$1",[other.id])
 try{await assert.rejects(service.generate(other,{now}),{statusCode:403})}finally{await db.query("UPDATE users SET status='active' WHERE id=$1",[other.id])}
 await assert.rejects(service.generate({...actor,role:'admin'}),{statusCode:403})
 await assert.rejects(service.generate(viewer),{statusCode:403})
})
test('NBA feedback is idempotent, audited and never mutates CRM or scoring',async()=>{
 const client=await producer(),card=(await generate(client)).cards[0],input={requestId:randomUUID(),feedback:'ACTION_SELECTED',note:'SYNTHETIC human choice'}
 const before=(await db.query('SELECT * FROM opportunities WHERE id=$1',[client.opId])).rows[0]
 assert.equal((await service.feedback(actor,card.id,input)).saved,true)
 assert.equal((await service.feedback(actor,card.id,input)).duplicate,true)
 await assert.rejects(service.feedback(actor,card.id,{...input,feedback:'ACTION_DISMISSED'}),{statusCode:409})
 for(const feedback of ['USEFUL','NOT_USEFUL','ACTION_EXECUTED','ACTION_ADAPTED','ACTION_DISMISSED'])await service.feedback(actor,card.id,{requestId:randomUUID(),feedback})
 assert.equal((await generate(client)).cards[0].id,card.id)
 assert.deepEqual((await db.query('SELECT * FROM opportunities WHERE id=$1',[client.opId])).rows[0],before)
 const detail=await service.detail(actor,card.id)
 assert.equal(detail.feedback.length,6);assert.ok(detail.audit.some(a=>a.action==='action_selected'));assert.ok(detail.audit.some(a=>a.action==='action_dismissed'))
})
test('NBA review queue preserves evidence and requires explicit owned resolution',async()=>{
 const client=await producer(actor,{opportunity:false}),card=(await generate(client)).cards[0]
 assert.equal(card.status,'REVIEW_REQUIRED')
 assert.ok((await service.queue(actor)).items.some(r=>r.card_id===card.id&&r.status==='PENDING'))
 await assert.rejects(service.review(actor,card.id,{status:'APPROVED'}),{statusCode:400})
 assert.equal((await service.review(actor,card.id,{status:'RESOLVED',reason:'SYNTHETIC review completed'})).canonicalEvidenceUnchanged,true)
 await assert.rejects(service.review(actor,card.id,{status:'REJECTED',reason:'second review'}),{statusCode:409})
 const detail=await service.detail(actor,card.id)
 assert.equal(detail.reviews[0].status,'RESOLVED');assert.deepEqual(detail.card.evidence,card.evidence)
 assert.ok(detail.audit.some(a=>a.action==='review_requested'));assert.ok(detail.audit.some(a=>a.action==='review_resolved'))
})
test('NBA flags and policy changes are admin-only, optimistic, staging-first and reversibly versioned',async()=>{
 const initial=await service.registryView(admin)
 await assert.rejects(service.configure(actor,{expectedRevision:0,reason:'SYNTHETIC',flags:{nba_v1:false}}),{statusCode:403})
 const changed=await service.configure(admin,{expectedRevision:initial.revision,reason:'SYNTHETIC disable test',flags:{nba_v1:false},policyVersion:'val.decision-scoring.conservative.v1'})
 assert.equal((await service.generate(actor,{now})).enabled,false)
 await assert.rejects(service.configure(admin,{expectedRevision:initial.revision,reason:'stale'}),{statusCode:409})
 await assert.rejects(service.configure(admin,{expectedRevision:changed.revision,reason:'invalid',flags:{unknown:true}}),{statusCode:400})
 const restored=await service.configure(admin,{expectedRevision:changed.revision,reason:'SYNTHETIC rollback',rollbackRevision:initial.revision})
 assert.equal(restored.flags.nba_v1,true);assert.equal(restored.policy_version,initial.policy_version)
 const registry=await service.registryView(admin)
 assert.equal(registry.runtime_registry_drift,false);assert.equal(registry.history.length,3)
 const prod=new DecisionService({db,repository,tenantId,environment:'production'})
 await assert.rejects(prod.configure(admin,{expectedRevision:restored.revision,reason:'denied'}),{statusCode:403})
 assert.ok((await db.query("SELECT action FROM audit_events WHERE tenant_id=$1 AND action='decision_policy_rollback'",[tenantId])).rows.length)
})
test('NBA card and radar flags preserve history and expose legacy logical fallback',async()=>{
 let revision=(await service.settings()).revision
 const off=await service.configure(admin,{expectedRevision:revision,reason:'SYNTHETIC card flag',flags:{decision_cards:false,portfolio_radar_v2:false}})
 const result=await service.generate(actor,{now})
 assert.equal(result.cards.length,0);assert.ok(result.legacyRadar);assert.equal(result.items.length,0)
 await service.configure(admin,{expectedRevision:off.revision,reason:'SYNTHETIC restore cards',rollbackRevision:revision})
})
test('NBA repository consumes canonical SOG and only scoped memories through ContextSnapshot',async()=>{
 const client=await producer(actor,{opportunity:false})
 await db.query("INSERT INTO sog_negotiation_intents(tenant_id,owner_user_id,client_id,commodity,direction,volume,volume_unit,price_unit,source,observed_at,delivery_end) VALUES($1,$2,$3,'soy','sell',100,'t','BRL/t','consultant_interview',$4,$5)",[tenantId,actor.id,client.id,recent,soon.slice(0,10)])
 const contexts=await repository.getDecisionContexts(actor.id,client.key,db,now)
 assert.equal(contexts[0].grainDecision.volume,100)
 const card=(await generate(client)).cards[0]
 assert.ok(card.missing_information.some(m=>m.key==='market_source'));assert.ok(card.source_refs.some(ref=>ref.startsWith('grain:')))
})
test('NBA management aggregates only current unit and RBAC, without exposing producer names',async()=>{
 const outside=await producer(other),inside=await producer(actor)
 await service.generate(actor,{now});await service.generate(other,{now})
 const report=await management.decisions(viewer,period,await service.settings())
 assert.equal(report.scope,'CURRENT_UNIT');assert.equal(report.causality,'NOT_ESTABLISHED')
 assert.ok(report.items.some(m=>m.consultantId===actor.id&&m.cards>0));assert.ok(!report.items.some(m=>m.consultantId===other.id))
 assert.doesNotMatch(JSON.stringify(report),new RegExp(`${outside.key}|${inside.key}|SYNTHETIC homonym`))
 await assert.rejects(management.decisions(viewer,{...period,consultantId:other.id},await service.settings()),{statusCode:403})
 await assert.rejects(management.decisions(actor,period,await service.settings()),{statusCode:403})
 await assert.rejects(management.decisions({...viewer,tenantId:foreignTenant},period,await service.settings()),{statusCode:403})
})
test('NBA migration is repeatable without deleting decisions, settings or audit',async()=>{
 const counts=async()=>JSON.stringify((await db.query('SELECT (SELECT count(*) FROM val_decision_cards) cards,(SELECT count(*) FROM val_decision_audit) audit,(SELECT count(*) FROM val_decision_settings_history) history')).rows)
 const before=await counts(),sql=await readFile(new URL('../database/migrations/20261002_017_decision_engine_expand.sql',import.meta.url),'utf8')
 if(pg)await pg.exec(sql);else await db.query(sql)
 assert.equal(await counts(),before)
})

if(process.env.VAL_DECISION_TEST_DATABASE_URL)test('NBA real HTTP authenticated cards, spoofed scopes, review, registry and same-engine Copilot',async()=>{
 const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve))
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
 const config={adminEmail:`nba-admin-${randomUUID()}@example.test`,adminPassword:'Synthetic-nba-test-42!',sessionSecret:'synthetic-nba-session-test-only-42',defaultTenantId:tenantId,sessionTtlSeconds:3600}
 const child=spawn(process.execPath,['server/start.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATABASE_URL:process.env.VAL_DECISION_TEST_DATABASE_URL,PG_SSL:'false',AUTO_MIGRATE:'false',VAL_DEMO_MODE:'false',VAL_DEMO_ENVIRONMENT:'test',OPENAI_API_KEY:'',VAL_DEFAULT_TENANT_ID:tenantId,VAL_ADMIN_EMAIL:config.adminEmail,VAL_ADMIN_PASSWORD:config.adminPassword,VAL_SESSION_SECRET:config.sessionSecret},stdio:['ignore','pipe','pipe']})
 const auth=createAuth(config),cookie=user=>`valor360_session=${auth.issue({...user,email:`${user.id}@example.test`})}`
 const call=(path,user=actor,options={})=>fetch(`http://127.0.0.1:${port}${path}`,{...options,headers:{...(user?{cookie:cookie(user)}:{}),'Content-Type':'application/json',...options.headers}})
 try{
  await new Promise((resolve,reject)=>{let output='',diagnostic='';const timer=setTimeout(()=>reject(new Error('NBA HTTP startup timeout')),20000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('VALOR 360 disponível na porta')){clearTimeout(timer);resolve()}});child.stderr.on('data',chunk=>{diagnostic+=String(chunk).slice(0,1000)});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`NBA HTTP exit ${code}: ${diagnostic.slice(0,1000)}`))})})
  assert.equal((await call('/api/decisions',null)).status,401)
  const client=await producer(),result=await call(`/api/decisions?clientId=${client.key}`),data=await result.json()
  assert.equal(result.status,200,JSON.stringify(data));assert.match(result.headers.get('cache-control'),/no-store/)
  const id=data.cards[0].id
  assert.equal((await call(`/api/decisions/cards/${id}`,other)).status,404)
  assert.equal((await call(`/api/decisions?clientId=${client.key}&ownerId=${actor.id}`,other)).status,404)
  assert.equal((await call('/api/decisions/settings',actor,{method:'PATCH',body:JSON.stringify({expectedRevision:0,reason:'denied',flags:{nba_v1:false}})})).status,403)
  assert.equal((await call('/api/decisions/registry')).status,200)
  assert.equal((await call('/api/decisions/reviews')).status,200)
  const feedback=await call(`/api/decisions/cards/${id}/feedback`,actor,{method:'POST',body:JSON.stringify({requestId:randomUUID(),feedback:'USEFUL'})})
  assert.equal(feedback.status,200)
  for(const message of ['Qual produtor merece atenção agora?','Quem eu deveria visitar hoje?','Qual é minha próxima melhor ação?','Por que eu deveria agir agora?']){
   const response=await call('/api/val/chat',actor,{method:'POST',body:JSON.stringify({clientId:client.key,message,conversationId:randomUUID()})}),body=await response.json()
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.responseMetadata?.providerCalls,0,JSON.stringify(body))
   assert.ok(body.decisionCards.length);assert.equal(body.advice.ai_reasoning.premises.context_scope.owner_id,actor.id)
  }
  const named=await producer(actor,{name:'SYNTHETIC João NBA único'})
  repository.invalidateAuthorizedClientReferences({ownerId:actor.id})
  const namedResponse=await call('/api/val/chat',actor,{method:'POST',body:JSON.stringify({clientId:client.key,message:'Por que SYNTHETIC João NBA único está em primeiro?',conversationId:randomUUID()})}),namedBody=await namedResponse.json()
  assert.equal(namedResponse.status,200,JSON.stringify(namedBody));assert.equal(namedBody.decisionCards?.[0]?.producer_id,named.key,JSON.stringify(namedBody))
  assert.equal((await call(`/api/management/decisions?start=${period.start}&end=${period.end}`,viewer)).status,200)
  assert.equal((await call('/api/decisions',viewer)).status,403)
  assert.equal((await call('/live',null)).status,200)
 }finally{child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,3000).unref()})}
})
