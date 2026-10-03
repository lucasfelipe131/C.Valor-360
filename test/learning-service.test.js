import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {createDatabase} from '../server/db.js'
import {DecisionService} from '../server/decision-service.js'
import {LearningService} from '../server/learning/service.js'
import {recommendationSnapshot} from '../server/learning/policy.js'
import {loadKnowledgeLibrary} from '../server/knowledge/library.js'
const tenant=randomUUID(),otherTenant=randomUUID()
const actor=role=>({id:randomUUID(),tenantId:tenant,role})
const admin=actor('admin'),reviewer=actor('admin'),owner=actor('consultant'),other=actor('consultant'),manager=actor('manager'),technical=actor('technical_reviewer')
const client=randomUUID(),visit=randomUUID(),outcome=randomUUID(),contrary=randomUUID(),second=randomUUID(),third=randomUUID()
let db,pg,service,candidate,dataset,promotion
before(async()=>{
 if(process.env.VAL_LEARNING_TEST_DATABASE_URL){const url=new URL(process.env.VAL_LEARNING_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));db=createDatabase({databaseUrl:url.href,databaseSsl:false});assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000),16)}else{pg=new PGlite();await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));for(const m of await listVersionedMigrations())await pg.exec(m.sql);db={configured:true,query:(...a)=>pg.query(...a),transaction:work=>pg.transaction(tx=>work({query:(...a)=>tx.query(...a)}))}}
 for(const id of [tenant,otherTenant])await db.query("INSERT INTO organizations(id,name,slug) VALUES($1::uuid,'SYNTHETIC learning',$1::text)",[id])
 for(const a of [admin,reviewer,owner,other,manager,technical]){await db.query("INSERT INTO users(id,name,email,password_hash) VALUES($1,'SYNTHETIC learning user',$2,'test-no-login')",[a.id,a.id+'@example.test']);await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,a.id,a.role])}
 await db.query("INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,source) VALUES($1::uuid,$2,$1::text,$3,'SYNTHETIC learning account','canonical')",[client,tenant,owner.id])
 await db.query("INSERT INTO visits(id,tenant_id,client_id,consultant_id,status) VALUES($1,$2,$3,$4,'Realizada')",[visit,tenant,client,owner.id])
 for(const [id,type] of [[outcome,'NO_DECISION'],[contrary,'LOST'],[second,'NO_DECISION'],[third,'NO_DECISION']])await db.query("INSERT INTO val_outcomes(id,tenant_id,visit_id,client_id,contract_version,outcome_type,result,evidence_refs,measured_at,recorded_by,confidence) VALUES($1,$2,$3,$4,'val.outcome.v1',$5,$6,'[]',now(),$7,.5)",[id,tenant,visit,client,type,JSON.stringify(type==='LOST'?{loss_reason:'TIMING'}:{}),owner.id])
 service=new LearningService({decisionService:new DecisionService({db,repository:{},tenantId:tenant,environment:'test'})})
})
after(async()=>{if(pg)await pg.close();else await db?.close()})
test('canonical candidate creation and fingerprint dedup, no auto promotion',async()=>{
 const input={outcome_id:outcome,supporting_outcome_ids:[second,third],hypothesis:'SYNTHETIC hypothesis for test only',contrary_evidence:[],geography_scope:'LOCAL',crop_scope:['SOY'],season_scope:['2026']}
 candidate=await service.createCandidate(admin,input);const replay=await service.createCandidate(admin,input);assert.equal(replay.id,candidate.id);assert.equal(candidate.status,'CANDIDATE');assert.equal(candidate.supporting_evidence.length,3);assert.equal(candidate.learning_metadata.attribution,'CAUSAL_NOT_PROVEN')
 await assert.rejects(()=>service.createCandidate(owner,input),{statusCode:403})
 await assert.rejects(()=>service.createCandidate(admin,{...input,contrary_evidence:undefined}),/contrary_field/)
 await assert.rejects(()=>service.createCandidate(admin,{...input,attribution:'CAUSED'}),/causal_claim/)
})
test('cross tenant and cross owner denied; manager has only unit aggregates',async()=>{
 await assert.rejects(()=>service.candidateDetail({...admin,tenantId:otherTenant},candidate.id),{statusCode:403})
 await assert.rejects(()=>service.candidateDetail(other,candidate.id),{statusCode:404})
 const view=await service.center(manager);assert.deepEqual(view.candidates,[]);assert.equal(view.summary.visible_candidates,0);assert.equal(view.personal_ranking,false)
})
test('human candidate review and contrary evidence reopen review',async()=>{
 const review={reason:'SYNTHETIC review',evidence_reviewed:[outcome,second,third],contrary_evidence_reviewed:[]}
 await service.reviewCandidate(admin,candidate.id,{...review,expected_status:'CANDIDATE',status:'UNDER_REVIEW'})
 await service.reviewCandidate(admin,candidate.id,{...review,expected_status:'UNDER_REVIEW',status:'APPROVED'})
 const changed=await service.addContrary(admin,candidate.id,{outcome_ids:[contrary]});assert.equal(changed.status,'UNDER_REVIEW');assert.equal(changed.confidence,.75)
 await assert.rejects(()=>service.reviewCandidate(admin,candidate.id,{...review,expected_status:'UNDER_REVIEW',status:'APPROVED'}),/contrary_evidence_not_reviewed/)
 await service.reviewCandidate(admin,candidate.id,{...review,contrary_evidence_reviewed:[contrary],expected_status:'UNDER_REVIEW',status:'APPROVED'})
 assert.equal((await service.candidateDetail(admin,candidate.id)).review_history.length,3)
})
test('recommendation snapshots immutable and dataset contains linked labels only',async()=>{
 for(let i=0;i<6;i++){
  const id=randomUUID(),date=i<3?'2026-01-05T00:00:00Z':'2026-02-05T00:00:00Z',labelDate=i<3?'2026-01-06T00:00:00Z':'2026-02-06T00:00:00Z'
  const snapshot=recommendationSnapshot({timestamp:date,engine_version:'test-v1',selected_candidate:`op-${i}`,features:{URGENCY:i},alternatives:[{id:`op-${i}`,known_at:date,features:{URGENCY:i},current_score:i}]})
  await db.query("INSERT INTO val_recommendations(id,tenant_id,consultant_id,client_id,mode,model_version,generated_content,learning_snapshot,learning_displayed_at,created_at) VALUES($1,$2,$3,$4,'daily','rules','{}',$5,$6,$6)",[id,tenant,owner.id,client,JSON.stringify(snapshot),date])
  await db.query("INSERT INTO val_feedback(tenant_id,recommendation_id,user_id,outcome,created_at) VALUES($1,$2,$3,'accepted',$4)",[tenant,id,owner.id,labelDate])
  await assert.rejects(()=>db.query("UPDATE val_recommendations SET learning_snapshot='{}' WHERE id=$1",[id]),e=>e.code==='23514')
 }
 dataset=await service.dataset(admin,{period_start:'2026-01-01',period_end:'2026-03-01'});assert.equal(dataset.payload.row_count,6);assert.equal(dataset.payload.labeled_count,6);assert.ok(!dataset.payload.rows)
 const repeated=await service.dataset(admin,{period_start:'2026-01-01',period_end:'2026-03-01'});assert.equal(repeated.id,dataset.id)
 const view=await service.center(admin);assert.ok(view.patterns.length);assert.ok(view.datasets.length)
})
test('governed sample policy needs independent review; shadow stays offline',async()=>{
 const control=await service.control(admin,{kind:'SAMPLE',version:'SYNTHETIC-test-only',reason:'SYNTHETIC only',thresholds:{limited:2,sufficient:3,strong:5}})
 const review={status:'APPROVED',reason:'SYNTHETIC independent review',evidence_reviewed:['test-policy'],contrary_evidence_reviewed:[]}
 await assert.rejects(()=>service.reviewControl(admin,control.id,review),/independent_human_review/)
 await service.reviewControl(reviewer,control.id,review)
 const result=await service.runShadow(admin,{dataset_id:dataset.id,cutoff:'2026-02-01',weights:{URGENCY:2}})
 assert.equal(result.payload.mode,'SHADOW');assert.equal(result.payload.production_changed,false);assert.equal(result.payload.comparisons.length,3)
 globalThis.learningTestShadow=result.id
})
test('promotion proposal requires approved candidate; consultant cannot publish; no auto prompt',async()=>{
 promotion=await service.propose(admin,{candidate_id:candidate.id,kind:'PROMPT',target_id:'synthetic-prompt',diff:'SYNTHETIC wording change',current_version:'current',candidate_version:'candidate-test',reason:'SYNTHETIC',risk:'LOW',expected_effect:'SYNTHETIC',rollback_target:'current',evaluation_id:globalThis.learningTestShadow,valid_until:'2027-01-01',review_at:'2026-12-01'})
 assert.equal(promotion.status,'DRAFT');assert.equal(promotion.payload.automatic_apply,false)
 const input={expected_revision:1,status:'UNDER_REVIEW',reason:'SYNTHETIC review',evidence_reviewed:[outcome,second,third],contrary_evidence_reviewed:[contrary]}
 await assert.rejects(()=>service.reviewPromotion(owner,promotion.id,input),{statusCode:403})
 await assert.rejects(()=>service.reviewPromotion(manager,promotion.id,input),{statusCode:403})
 await service.reviewPromotion(reviewer,promotion.id,input)
 await assert.rejects(()=>service.reviewPromotion(reviewer,promotion.id,{...input,expected_revision:2,status:'APPROVED'}),/safety_regression_required/)
 const count=await db.query('SELECT count(*) n FROM val_learning_publications WHERE tenant_id=$1',[tenant]);assert.equal(Number(count.rows[0].n),0)
})
test('publication approval, expiry and rollback retain append-only history',async()=>{
 const regression=await service.control(admin,{kind:'REGRESSION',version:'SYNTHETIC-regression',shadow_id:globalThis.learningTestShadow,reason:'Isolated synthetic test',checks:{safety:'PASS',isolation:'PASS',grounding:'PASS',technical_review:'PASS',provenance:'PASS'},evidence_refs:['automated-test']})
 await service.reviewControl(reviewer,regression.id,{status:'APPROVED',reason:'Reviewed synthetic checks',evidence_reviewed:['automated-test'],contrary_evidence_reviewed:[]})
 // New versioned proposal carries the reviewed regression reference; old remains untouched.
 const base=promotion.payload,proposal=await service.propose(admin,{...base,candidate_version:'candidate-tested',regression_id:regression.id})
 const review={reason:'SYNTHETIC only',evidence_reviewed:[outcome,second,third],contrary_evidence_reviewed:[contrary]}
 await service.reviewPromotion(reviewer,proposal.id,{...review,expected_revision:1,status:'UNDER_REVIEW'})
 await service.reviewPromotion(reviewer,proposal.id,{...review,expected_revision:2,status:'APPROVED'})
 const published=await service.reviewPromotion(reviewer,proposal.id,{...review,expected_revision:3,status:'PUBLISHED'});assert.equal(published.runtime_applied,false)
 await service.reviewPromotion(reviewer,proposal.id,{...review,expected_revision:4,status:'ROLLED_BACK'})
 await assert.rejects(()=>db.query('DELETE FROM val_learning_publications WHERE tenant_id=$1',[tenant]),e=>e.code==='23514')
 const view=await service.center(admin);assert.equal(view.rollback_history.length,1);assert.equal(view.publications[0].status,'ROLLED_BACK');assert.ok(view.history.some(h=>h.action==='promotion_approved'))
})

test('KnowledgeItem publication uses existing library; expiry and rollback are visible',async()=>{
 const old=loadKnowledgeLibrary().items.find(i=>i.risk==='LOW')
 const item={...old,knowledge_item_id:'SYNTHETIC-KNOWLEDGE',version:'synthetic-v1',status:'APPROVED',geographic_scope:'LOCAL',crop_scope:['SOY'],season_scope:['2026'],valid_from:'2026-01-01',valid_until:'2027-01-01',review_at:'2026-12-01',provenance:{candidate_id:candidate.id}}
 const regression=(await db.query("SELECT id FROM val_learning_controls WHERE tenant_id=$1 AND kind='REGRESSION' AND status='APPROVED'",[tenant])).rows[0]
 const proposal=await service.propose(admin,{candidate_id:candidate.id,kind:'KNOWLEDGE',current_version:'NONE',candidate_version:'synthetic-v1',reason:'SYNTHETIC fixture only',risk:'LOW',expected_effect:'test',rollback_target:'NONE',evaluation_id:globalThis.learningTestShadow,regression_id:regression.id,knowledge_item:item,valid_until:'2027-01-01',review_at:'2026-12-01'})
 const review={reason:'SYNTHETIC independent review',evidence_reviewed:[outcome,second,third],contrary_evidence_reviewed:[contrary]}
 for(const [index,status] of ['UNDER_REVIEW','APPROVED','PUBLISHED'].entries())await service.reviewPromotion(reviewer,proposal.id,{...review,expected_revision:index+1,status})
 const view=await service.center(admin);assert.ok(view.knowledge.some(k=>k.knowledge_item_id==='SYNTHETIC-KNOWLEDGE'&&k.runtime_activation==='RELEASE_REQUIRED'))
 assert.ok(!loadKnowledgeLibrary().items.some(i=>i.knowledge_item_id==='SYNTHETIC-KNOWLEDGE'))
 await service.reviewPromotion(reviewer,proposal.id,{...review,expected_revision:4,status:'ROLLED_BACK'})
 assert.ok((await service.center(admin)).knowledge.some(k=>k.knowledge_item_id==='SYNTHETIC-KNOWLEDGE'&&k.status==='SUPERSEDED'))
})
test('decision, agro evidence and coach feed offline labels without changing current rules',async()=>{
 const cardId=randomUUID(),coachId=randomUUID(),timestamp='2026-02-07T00:00:00Z'
 const card={version:'val.decision-card.v1',status:'OPEN',opportunity_id:randomUUID(),priority_score:40,score_breakdown:{dimensions:{AGRONOMIC_SIGNAL:{points:10},URGENCY:{points:30}}},evidence:[{id:'SYNTHETIC-agro-geo-signal'}]}
 await db.query('INSERT INTO val_decision_cards(id,tenant_id,owner_id,client_id,version,fingerprint,policy_version,card,generated_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)',[cardId,tenant,owner.id,client,'synthetic','val.decision-scoring.v1',JSON.stringify(card),timestamp])
 await db.query("INSERT INTO val_decision_feedback(tenant_id,owner_id,card_id,request_id,feedback,actor_id,created_at) VALUES($1,$2,$3,$4,'ACTION_EXECUTED',$2,'2026-02-08')",[tenant,owner.id,cardId,randomUUID()])
 await db.query('INSERT INTO val_commercial_coach_cards(id,tenant_id,owner_id,client_id,source_key,card,fingerprint,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[coachId,tenant,owner.id,client,'synthetic',JSON.stringify({version:'val.commercial-coach.v1',context:{opportunity:card.opportunity_id},signal:'weak_commitment',evidence_refs:[{id:outcome}],confidence:.5}),'synthetic',timestamp])
 await db.query("INSERT INTO val_commercial_coach_feedback(tenant_id,owner_id,card_id,request_id,feedback,result,created_at) VALUES($1,$2,$3,$4,'EXECUTED','SYNTHETIC','2026-02-08')",[tenant,owner.id,coachId,randomUUID()])
 const d=await service.dataset(admin,{period_start:'2026-01-01',period_end:'2026-03-01'});assert.equal(d.payload.row_count,8)
 const after=(await db.query('SELECT card FROM val_decision_cards WHERE id=$1',[cardId])).rows[0].card;assert.deepEqual(after,card)
 const before=fingerprintForTest(service.decisions.registry);await service.runShadow(admin,{dataset_id:d.id,cutoff:'2026-02-01',weights:{URGENCY:2}});assert.equal(fingerprintForTest(service.decisions.registry),before)
 function fingerprintForTest(x){return JSON.stringify(x)}
})

test('legacy single-event candidate is reused and cannot become organizational knowledge',async()=>{
 const first=await service.createCandidate(admin,{outcome_id:outcome,hypothesis:'SYNTHETIC single occurrence',contrary_evidence:[]})
 const again=await service.createCandidate(admin,{outcome_id:outcome,hypothesis:'Different wording, same events',contrary_evidence:[]})
 assert.equal(first.id,again.id);assert.equal(first.learning_metadata.classification,'ACCOUNT_OBSERVATION')
 const count=(await db.query('SELECT count(*) n FROM val_learning_candidates WHERE tenant_id=$1 AND candidate_fingerprint=$2',[tenant,first.candidate_fingerprint])).rows[0];assert.equal(Number(count.n),1)
})
