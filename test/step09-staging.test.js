import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {prepareStep09StagingFixture,STEP09_STAGING,STEP09_SOURCE,STEP09_ACCOUNT,STEP09_OBSERVED} from '../server/step09-staging-fixture.js'
import {ValRepository} from '../server/repository.js'
import {DecisionService} from '../server/decision-service.js'
import {AgroGeoService} from '../server/agro-geo-service.js'
import {AccessRepository} from '../server/access-repository.js'
import {agronomicDecisionResponse} from '../server/decision-copilot/agronomic-decision.js'
import {realBusinessClients} from '../src/lib/business-metrics-scope.js'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('Step09 fixture rejects other environments and leaves KPI clients out of frontend metrics',async()=>{
 assert.equal((await prepareStep09StagingFixture({env:{},db:null})).status,'SKIPPED_NOT_STEP09_STAGING')
 for(const key of Object.keys(STEP09_STAGING))assert.equal((await prepareStep09StagingFixture({env:{...STEP09_STAGING,[key]:'foreign'},db:null})).status,'SKIPPED_NOT_STEP09_STAGING')
 assert.deepEqual(realBusinessClients([{id:'real',source:'manual'},{id:'synthetic',source:STEP09_SOURCE}]).map(c=>c.id),['real'])
})
test('Step09 staging source → Hub → report → signal → priority → persisted card is idempotent and isolated',async()=>{
 const pg=new PGlite(),tenantId=id(700),ownerId=id(701),other=id(702)
 try{
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const m of await listVersionedMigrations())await pg.exec(m.sql)
  const db={configured:true,query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(tx=>fn({query:(...args)=>tx.query(...args)}))}
  await db.query("INSERT INTO organizations(id,name,slug) VALUES($1,'TEST','step09')",[tenantId])
  for(const [user,email] of [[ownerId,STEP09_ACCOUNT],[other,'step09-other@example.test']]){await db.query("INSERT INTO users(id,name,email,status,must_change_password) VALUES($1,'TEST',$2,'active',false)",[user,email]);await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'consultant')",[tenantId,user])}
  const args={db,tenantId,env:STEP09_STAGING},first=await prepareStep09StagingFixture(args),again=await prepareStep09StagingFixture(args)
  assert.equal(first.created,true);assert.equal(again.created,false);assert.equal(first.eventId,again.eventId)
  assert.equal((await new AccessRepository({db,tenantId}).getAdminMetrics({role:'admin'})).summary.producers,0)
  const repo=new ValRepository({db,tenantId}),service=new DecisionService({db,repository:repo,tenantId,environment:'test'}),agro=new AgroGeoService({decisionService:service}),actor={id:ownerId,role:'consultant',tenantId}
  const generated=await agro.generate(actor,{clientId:first.clientId,now:Date.parse(STEP09_OBSERVED)+3600000}),card=generated.cards[0]
  assert.equal(generated.cards.length,1);assert.equal(card.source,STEP09_SOURCE);assert.equal(card.crop,'Soja');assert.equal(card.season,'2026/27');assert.equal(card.signal_type,'ESTANDE');assert.ok(card.recommended_next_step)
  assert.equal(card.source_refs[0].source_event_id,first.eventId);assert.ok(card.evidence_refs[0].id);assert.ok(card.signal.signal_id);assert.ok(card.priority.policy_version)
  assert.equal(card.map_focus.geometry_version,first.geometryVersion);assert.ok(card.map_focus.property_geometry);assert.equal(card.map_focus.source,STEP09_SOURCE)
  assert.deepEqual(agronomicDecisionResponse(generated).agronomicDecisionCards,generated.items)
  assert.equal((await agro.generate(actor,{clientId:first.clientId,now:Date.parse(STEP09_OBSERVED)+3600000})).cards[0].id,card.id)
  await assert.rejects(agro.generate({id:other,role:'consultant',tenantId},{clientId:first.clientId}),{statusCode:404})
  await assert.rejects(agro.generate({...actor,tenantId:id(999)},{clientId:first.clientId}),{statusCode:403})
  assert.equal(Number((await db.query("SELECT count(*) n FROM integration_events WHERE source=$1",[STEP09_SOURCE])).rows[0].n),1)
 }finally{await pg.close()}
})
