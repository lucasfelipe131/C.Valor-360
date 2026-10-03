import {createDatabase} from '../server/db.js'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {ValRepository} from '../server/repository.js'
import {DecisionService} from '../server/decision-service.js'
import {RevenueService} from '../server/revenue-service.js'
import {createManagementService} from '../server/management-service.js'
const tenantId=randomUUID(),otherTenant=randomUUID(),actor={id:randomUUID(),tenantId,role:'consultant'},other={id:randomUUID(),tenantId,role:'consultant'},admin={id:randomUUID(),tenantId,role:'admin'},viewer={id:randomUUID(),tenantId,role:'bi_viewer'}
let pg,db,service,decisions,management,clientId,opportunityId
before(async()=>{
 if(process.env.VAL_REVENUE_TEST_DATABASE_URL){const url=new URL(process.env.VAL_REVENUE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));db=createDatabase({databaseUrl:url.href,databaseSsl:false});assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000),16)}else{
 pg=new PGlite();await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
 db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 }
 for(const id of [tenantId,otherTenant])await db.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[id,'SYNTHETIC revenue organization'])
 for(const user of [actor,other,admin,viewer]){await db.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[user.id,'SYNTHETIC revenue owner',`${user.id}@example.test`,'synthetic-no-login']);await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,user.id,user.role])}
 const repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>assert.fail('No fallback')})
 decisions=new DecisionService({db,repository,tenantId,environment:'test'});service=new RevenueService({decisionService:decisions});management=createManagementService({db,tenantId})
 clientId=randomUUID();opportunityId=randomUUID()
 await db.query("INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,commercial_profile) VALUES($1::uuid,$2,$1::text,$3,'SYNTHETIC revenue producer',$4)",[clientId,tenantId,actor.id,JSON.stringify({purchaseCurrentSeason:100,potentialTotal:1000})])
 await db.query("INSERT INTO opportunities(id,tenant_id,client_id,title,stage,estimated_value,updated_at) VALUES($1,$2,$3,'SYNTHETIC opportunity','Diagnóstico',200,now()-interval '40 days')",[opportunityId,tenantId,clientId])
})
after(async()=>{if(pg)await pg.close();else await db?.close()})
test('revenue canonical projection, coach persistence idempotency and audit',async()=>{
 const first=await service.generate(actor,{clientId}),second=await service.generate(actor,{clientId})
 assert.equal(first.producers[0].metrics.open_pipeline,200);assert.equal(first.producers[0].metrics.realized_share_percent,10)
 assert.ok(first.coach_cards.length);assert.deepEqual(first.coach_cards.map(c=>c.id),second.coach_cards.map(c=>c.id))
 const audits=(await db.query("SELECT action FROM audit_events WHERE tenant_id=$1 AND action IN ('coach_card_generated','revenue_view_opened')",[tenantId])).rows
 assert.equal(audits.filter(a=>a.action==='coach_card_generated').length,first.coach_cards.length)
 assert.equal(audits.filter(a=>a.action==='revenue_view_opened').length,2)
})
test('cross owner and tenant blocked, even with same visible producer name',async()=>{
 await assert.rejects(()=>service.generate(other,{clientId}),{statusCode:404})
 await assert.rejects(()=>service.generate({...actor,tenantId:otherTenant},{clientId}),{statusCode:403})
 assert.equal((await service.generate(other)).producers.length,0)
})
test('coach feedback persists result, replays idempotently and never changes weights',async()=>{
 const card=(await service.generate(actor,{clientId})).coach_cards[0]
 const input={requestId:randomUUID(),feedback:'ADAPTED',result:'SYNTHETIC: ação adaptada com o produtor'}
 assert.equal((await service.feedback(actor,card.id,input)).automaticWeightChange,false)
 assert.equal((await service.feedback(actor,card.id,input)).replayed,true)
 await assert.rejects(()=>service.feedback(other,card.id,{...input,requestId:randomUUID()}),{statusCode:404})
 await assert.rejects(()=>service.feedback(actor,card.id,{...input,feedback:'EXECUTED'}),{statusCode:409})
})
test('ValuePlan update requires current version and canonical scope',async()=>{
 const row=(await db.query('SELECT updated_at FROM opportunities WHERE id=$1',[opportunityId])).rows[0]
 const input={expectedUpdatedAt:new Date(row.updated_at).toISOString(),plan:{commercial_stage:'DIAGNOSE',problem_statement:'SYNTHETIC problem',proof_strategy:['Comparar medição'],economic_inputs:{cost:{status:'KNOWN',value:200},area_ha:{status:'KNOWN',value:2}}}}
 await assert.rejects(()=>service.valuePlan(other,opportunityId,input),{statusCode:404})
 const saved=await service.valuePlan(actor,opportunityId,input)
 assert.equal(saved.value_plan.economic_case.results.cost_per_hectare.value,100)
 await assert.rejects(()=>service.valuePlan(actor,opportunityId,input),{statusCode:409})
})
test('management requires unit membership and never exposes another portfolio',async()=>{
 const unit=(await management.createUnit(admin,{name:'SYNTHETIC revenue unit'})).unit
 await management.assignUnit(admin,{userId:viewer.id,unitId:unit.id})
 const date=new Date().toISOString().slice(0,10),filters={start:date,end:date}
 assert.equal((await management.revenue(viewer,filters,await decisions.settings())).producers.length,0)
 await management.assignUnit(admin,{userId:actor.id,unitId:unit.id})
 const view=await management.revenue(viewer,filters,await decisions.settings())
 assert.equal(view.producers.length,1);assert.equal(view.ranking,false)
 await assert.rejects(()=>management.revenue(viewer,{...filters,consultantId:other.id},awaitSettings()),{statusCode:403})
 function awaitSettings(){return {flags:{management_revenue_view_v1:true,revenue_intelligence_v1:true}}}
})
test('flags are staging first and reversible through existing governance',async()=>{
 const state=await decisions.settings()
 const changed=await decisions.configure(admin,{expectedRevision:state.revision,reason:'SYNTHETIC rollback test',flags:{revenue_intelligence_v1:false}})
 assert.equal((await service.generate(actor)).enabled,false)
 await decisions.configure(admin,{expectedRevision:changed.revision,reason:'SYNTHETIC restore',rollbackRevision:state.revision})
 assert.equal((await service.generate(actor)).enabled,true)
 const production=new DecisionService({db:{...db,query:async()=>({rows:[]})},repository:{},tenantId,environment:'production'})
 assert.equal((await production.settings()).flags.revenue_intelligence_v1,false)
})

test('canonical outcome evidence guard, duplicate rejection and observed impact persistence',async()=>{
 const visit=randomUUID(),plan=randomUUID(),outcome=randomUUID(),snapshot=randomUUID()
 await db.query("INSERT INTO val_context_snapshots(id,tenant_id,actor_id,subject_type,subject_id,objective,contract_version,selection_policy_version,freshness_policy_version,snapshot_payload,generated_at) VALUES($1,$2,$3,'client',$4,'synthetic','val.context_snapshot.v1','v1','v1','{}',now())",[snapshot,tenantId,actor.id,clientId])
 await db.query("INSERT INTO visits(id,tenant_id,client_id,consultant_id,status) VALUES($1,$2,$3,$4,'Realizada')",[visit,tenantId,clientId,actor.id])
 await db.query("INSERT INTO val_action_plans(id,tenant_id,client_id,visit_id,owner_user_id,context_snapshot_id,contract_version,decision_thesis_id,decision_thesis_version,value_plan_id,value_plan_version) VALUES($1,$2,$3,$4,$5,$6,'val.action_plan.v1','synthetic-thesis','v1','synthetic-value-plan','val.value_plan.v1')",[plan,tenantId,clientId,visit,actor.id,snapshot])
 const insert=(type,refs,result={})=>db.query("INSERT INTO val_outcomes(id,tenant_id,visit_id,client_id,action_plan_id,contract_version,outcome_type,result,evidence_refs,measured_at,recorded_by,confidence) VALUES($1,$2,$3,$4,$5,'val.outcome.v1',$6,$7,$8,now(),$9,.8)",[outcome,tenantId,visit,clientId,plan,type,JSON.stringify(result),JSON.stringify(refs),actor.id])
 await assert.rejects(()=>insert('WON',[]),error=>error.code==='23514')
 await assert.rejects(()=>insert('LOST',[],{}),error=>error.code==='23514')
 await insert('TECHNICAL_RESULT',[{id:'synthetic-measurement'}],{opportunity_id:opportunityId})
 await assert.rejects(()=>insert('NO_DECISION',[]),error=>error.code==='23505')
 const input={requestId:randomUUID(),producer:clientId,outcome,action:plan,opportunity:opportunityId,decision:null,metric:'stand',baseline:{value:10,unit:'plants/m',method:'count',measured_at:'2026-01-01'},measurement:{value:12,unit:'plants/m',method:'count'},measured_at:'2026-10-01',source_refs:['synthetic-measurement'],attribution_status:'VALIDATED_CAUSAL_LINK'}
 const result=await service.impact(actor,input)
 assert.equal(result.impact.delta,2);assert.equal(result.impact.attribution_status,'CAUSAL_NOT_PROVEN')
 assert.equal((await service.impact(actor,input)).replayed,true)
 await assert.rejects(()=>service.impact(other,{...input,requestId:randomUUID()}),{statusCode:404})
 await assert.rejects(()=>service.validateImpact(actor,result.impact.impact_id,{status:'VALIDATED_CAUSAL_LINK'}),{statusCode:403})
 await assert.rejects(()=>service.validateImpact(admin,result.impact.impact_id,{status:'VALIDATED_CAUSAL_LINK',reason:'SYNTHETIC',source_refs:['synthetic-proof']}),{statusCode:422})
 assert.equal((await service.generate(actor,{clientId})).producers[0].metrics.won_value,0)
})

test('large portfolio uses bounded batch queries rather than a write per coach card',async()=>{
 const clients=Array.from({length:250},()=>({id:randomUUID(),key:randomUUID()}))
 await db.query("INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,commercial_profile) SELECT c.id,$1,c.key,$2,'SYNTHETIC same name','{\"purchaseCurrentSeason\":10,\"potentialTotal\":100}'::jsonb FROM jsonb_to_recordset($3::jsonb) c(id uuid,key text)",[tenantId,other.id,JSON.stringify(clients)])
 await db.query("INSERT INTO opportunities(tenant_id,client_id,title,stage,estimated_value) SELECT $1,c.id,'SYNTHETIC opportunity','Diagnóstico',20 FROM jsonb_to_recordset($2::jsonb) c(id uuid)",[tenantId,JSON.stringify(clients)])
 let queries=0
 const counted={...db,transaction:work=>db.transaction(connection=>work({query:(...args)=>{queries++;return connection.query(...args)}}))}
 const batch=new RevenueService({decisionService:new DecisionService({db:counted,repository:decisions.repository,tenantId,environment:'test'})})
 const start=performance.now(),result=await batch.generate(other)
 assert.equal(result.producers.length,250);assert.ok(result.coach_cards.length>=1000);assert.ok(queries<=25,`Expected bounded queries, got ${queries}`);assert.ok(performance.now()-start<10000)
})
