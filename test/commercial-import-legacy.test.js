import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {readFile,readdir,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test,{before,after,beforeEach} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {createDatabase} from '../server/db.js'
import {ValRepository} from '../server/repository.js'

let pg,db,directory
const tenant=randomUUID(),owner=randomUUID()
const otherTenant=randomUUID(),otherOwner=randomUUID(),evidence=[]
const mapping={client:'client',date:'date',product:'product',value:'value',status:'status'}
const row=extra=>({client:'SYNTHETIC Legacy Farm',date:'12/03/2026',product:'Ureia',value:'10000',status:'Ganho',...extra})
const input=(rows=[row()],extra={})=>({tenantId:tenant,ownerId:owner,summary:{id:randomUUID(),fileName:'synthetic.csv',rowCount:rows.length,truncated:false},clients:[{id:'synthetic-legacy',name:'SYNTHETIC Legacy Farm',commercial:{}}],rows,mapping,...extra})
const repository=(tenantId=tenant)=>new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{}})
const events=async()=> (await db.query('SELECT * FROM business_events WHERE tenant_id=$1 ORDER BY external_id',[tenant])).rows
async function openDatabase(){
 if(process.env.VAL_LEG_TEST_DATABASE_URL){
  const url=new URL(process.env.VAL_LEG_TEST_DATABASE_URL)
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'only disposable loopback PostgreSQL')
  db=createDatabase({databaseUrl:url.href,databaseSsl:false})
 }else{
  pg=new PGlite(directory)
  db={configured:true,query:(...args)=>pg.query(...args),transaction:f=>pg.transaction(tx=>f({query:(...args)=>tx.query(...args)})),close:()=>pg.close()}
 }
}
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'val-leg-'))
 await openDatabase()
 if(!process.env.VAL_LEG_TEST_DATABASE_URL){
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const f of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${f}`,import.meta.url),'utf8'))
 }
 await db.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$3)',[tenant,'SYNTHETIC LEG tests',tenant])
 await db.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[owner,'SYNTHETIC LEG operator',`${owner}@example.test`])
 await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,owner,'consultant'])
 await db.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$3)',[otherTenant,'SYNTHETIC other tenant',otherTenant])
 await db.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[otherOwner,'SYNTHETIC other operator',`${otherOwner}@example.test`])
 for(const [t,o] of [[tenant,otherOwner],[otherTenant,owner]])await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[t,o,'consultant'])
})
beforeEach(async()=>{await db.query('DELETE FROM business_events WHERE tenant_id=ANY($1::uuid[])',[[tenant,otherTenant]])})
after(async()=>{
 if(process.env.VAL_LEG_EVIDENCE_FILE)await writeFile(process.env.VAL_LEG_EVIDENCE_FILE,JSON.stringify({engine:process.env.VAL_LEG_TEST_DATABASE_URL?'PostgreSQL':'PGlite',synthetic:true,cases:evidence},null,2))
 await db?.close();if(directory)await rm(directory,{recursive:true,force:true})
})

// Exact legacy algorithm at ffbe53a4; only synthetic rows are modified to model
// data already persisted by that version. No real database is accessed.
async function makeLegacy(version='ffbe53a4'){
 const [event]=await events(),p=event.payload
 const base=[tenant,owner,event.client_external_key,new Date(event.occurred_at).toISOString(),p.product||'']
 const hash=createHash('sha256').update(JSON.stringify(version==='round14'?base:[...base,String(p.value??''),event.outcome,p.status||''])).digest('hex').slice(0,40)
 const externalId=`commercial_import:${hash}:1`
 await db.query("UPDATE business_events SET external_id=$1,payload=payload-'import_identity' WHERE id=$2",[externalId,event.id])
 return {...event,external_id:externalId}
}

const snapshot=async()=> (await db.query('SELECT tenant_id,owner_user_id,client_external_key,external_id,value,product FROM business_events WHERE tenant_id=ANY($1::uuid[]) ORDER BY tenant_id,owner_user_id,external_id',[[tenant,otherTenant]])).rows
function leg(id,description,expected,work){test(`${id} ${description}`,async()=>{
 const item={id,input:[],before:[],operation:description,expected,responses:[],result:'FAIL'}
 const act=async(data=input())=>{item.input.push({rows:data.rows,mapping:data.mapping,fileName:data.summary.fileName,tenant:data.tenantId,owner:data.ownerId});const result=await repository(data.tenantId).ingestCommercialImport(data);item.responses.push({created:result.createdEventCount,updated:result.updatedEventCount,ignored:result.ignoredEventCount,ambiguous:result.ambiguousEventCount,rejected:result.rejectedEventCount,rows:result.rowResults});return result}
 try{await work({act,checkpoint:async()=>{item.before=await snapshot()}});item.result='PASS'}finally{item.after=await snapshot();evidence.push(item)}
})}

leg('LEG-01','legacy -> current: exact replay preserves original external_id','1 event; value 10000; original ID',async({act,checkpoint})=>{
 await act()
 const original=await makeLegacy()
 await checkpoint();const outcome=await act()
 const result=await events()
 assert.equal(result.length,1)
 assert.equal(Number(result[0].value),10000)
 assert.equal(result[0].external_id,original.external_id)
 assert.equal(outcome.ignoredEventCount,1)
})

leg('LEG-02','current -> current replay','1 event; 10000; ignored=1',async({act,checkpoint})=>{
 await act();await checkpoint();const r=await act()
 assert.equal((await events()).length,1);assert.equal(r.ignoredEventCount,1);assert.equal(r.createdEventCount,0)
})
leg('LEG-03','correct legacy amount with explicit prior canonical ID','1 event; 15000; same ID',async({act,checkpoint})=>{
 await act();const old=await makeLegacy();await checkpoint()
 const r=await act(input([row({value:'15000',previous:old.external_id})],{mapping:{...mapping,previousExternalId:'previous'}}))
 const [event]=await events();assert.equal((await events()).length,1);assert.equal(Number(event.value),15000);assert.equal(event.external_id,old.external_id);assert.equal(r.updatedEventCount,1)
})
leg('LEG-04','correct current amount with stable source business/item ID','1 event; 15000; same ID',async({act,checkpoint})=>{
 const m={...mapping,eventId:'business'}
 await act(input([row({business:'NF001/item1'})],{mapping:m}));const old=(await events())[0];await checkpoint()
 const r=await act(input([row({business:'NF001/item1',value:'15000'})],{mapping:m}))
 const [event]=await events();assert.equal((await events()).length,1);assert.equal(Number(event.value),15000);assert.equal(event.external_id,old.external_id);assert.equal(r.updatedEventCount,1)
})
leg('LEG-05','two identical real rows on same day and their replay','2 events; total 20000; ignored=2',async({act,checkpoint})=>{
 await act(input([row(),row()]));await checkpoint();const r=await act(input([row(),row()]))
 assert.equal((await events()).length,2);assert.equal((await events()).reduce((s,e)=>s+Number(e.value),0),20000);assert.equal(r.ignoredEventCount,2)
})
leg('LEG-06','reorder same spreadsheet','same ID/value mapping; 3 events; ignored=3',async({act,checkpoint})=>{
 const rows=[row(),row({value:'20000'}),row({product:'KCl'})]
 await act(input(rows));const before=await snapshot();await checkpoint();const r=await act(input([...rows].reverse()))
 assert.deepEqual(await snapshot(),before);assert.equal(r.ignoredEventCount,3)
})
leg('LEG-07','long product descriptions sharing truncated prefix','2 distinct events; reorder/replay unchanged',async({act,checkpoint})=>{
 const prefix='SYNTHETIC FERTILIZER '.repeat(15),rows=[row({product:prefix+'A'}),row({product:prefix+'B'})]
 await act(input(rows));await checkpoint();const r=await act(input([...rows].reverse()))
 assert.equal((await events()).length,2);assert.equal(r.ignoredEventCount,2);assert.ok((await events()).every(e=>e.product.length<=180))
})
leg('LEG-08','long legal name and external producer key','1 owned event; no orphan',async({act,checkpoint})=>{
 const name='SYNTHETIC LONG LEGAL NAME '.repeat(12),data=input([row({client:name})],{clients:[{id:name.toLowerCase(),name,commercial:{}}]})
 await act(data);await checkpoint();const r=await act({...data,summary:{...data.summary,id:randomUUID()}})
 assert.equal((await events()).length,1);assert.equal(r.skippedEventCount,0);assert.equal(r.ignoredEventCount,1)
})
leg('LEG-09','missing status','0 events; rejected=1; missing status reason',async({act,checkpoint})=>{
 await checkpoint();const r=await act(input([row({status:''})]));assert.equal((await events()).length,0);assert.equal(r.rejectedEventCount,1);assert.equal(r.unrecognizedOutcomeCount,1)
})
leg('LEG-10','invalid date alongside valid row','valid row persists; rejected=1',async({act,checkpoint})=>{
 await checkpoint();const r=await act(input([row({date:'31/02/2026'}),row()]));assert.equal((await events()).length,1);assert.equal(r.rejectedEventCount,1);assert.equal(r.unrecognizedDateCount,1)
})
leg('LEG-11','uncertain correction never merges or inserts; partial batch reports every row','old value unchanged; valid new row persists; review=1; rejected=1',async({act,checkpoint})=>{
 await act();await makeLegacy();await checkpoint();const old=(await events())[0]
 const r=await act(input([row({value:'15000'}),row({product:'KCl'}),row({status:''})]))
 assert.equal((await events()).length,2);assert.equal(Number((await events()).find(e=>e.id===old.id).value),10000);assert.equal(r.ambiguousEventCount,1);assert.equal(r.rejectedEventCount,1);assert.equal(r.createdEventCount,1);assert.equal(r.rowResults.length,3)
 assert.equal(r.rowResults[0].status,'REVIEW_REQUIRED');assert.equal(r.rowResults[0].reason,'AMBIGUOUS_IDENTITY')
 assert.equal(r.acceptedClients[0].commercial.revenue,20000,'ambiguous and invalid rows cannot inflate the profile')
 // No business ID: the same safety boundary also applies to current metadata.
 const current=await act(input([row({product:'KCl',value:'15000'})]));assert.equal(current.ambiguousEventCount,1)
})
for(const [id,kind,extra] of [['LEG-12','tenant',{tenantId:otherTenant}],['LEG-13','owner',{ownerId:otherOwner}],['LEG-14','producer',{clients:[{id:'synthetic-other-producer',name:'SYNTHETIC Other Farm',commercial:{}}]}]]){
 leg(id,`same source key in another ${kind}`,`2 events; no cross-${kind} match`,async({act,checkpoint})=>{
  const m={...mapping,eventId:'business'};await act(input([row({business:'NF001/item1'})],{mapping:m}));await checkpoint()
  const r=await act(input([row({business:'NF001/item1',...(kind==='producer'?{client:'SYNTHETIC Other Farm'}:{})})],{mapping:m,...extra}))
  assert.equal((await snapshot()).length,2);assert.equal(r.createdEventCount,1)
 })
}
leg('LEG-15','two simultaneous import requests','1 canonical event; created total=1',async({act,checkpoint})=>{
 await checkpoint();const data=[input(),input()]
 const results=await Promise.all(data.map(d=>act(d)))
 assert.equal((await events()).length,1);assert.equal(results.reduce((n,r)=>n+r.createdEventCount,0),1)
 evidence.push({id:'LEG-15-engine',engine:process.env.VAL_LEG_TEST_DATABASE_URL?'PostgreSQL concurrent transactions':'PGlite serialized transactions; native concurrency gate runs separately in CI'})
})
leg('LEG-16','persist succeeds but response is lost; identical request retried','1 event; retry ignored',async({act,checkpoint})=>{
 const data=input();await act(data);await checkpoint();const r=await act(data)
 assert.equal((await events()).length,1);assert.equal(r.ignoredEventCount,1)
})
leg('LEG-17','application process restart between imports','1 durable event; child-process replay ignored',async({act,checkpoint})=>{
 await act();await checkpoint();await db.close()
 const source=`import {PGlite} from '@electric-sql/pglite';import {createDatabase} from './server/db.js';import {ValRepository} from './server/repository.js';let raw='';for await(const c of process.stdin)raw+=c;const {data,directory,url}=JSON.parse(raw);const pg=url?null:new PGlite(directory);const db=url?createDatabase({databaseUrl:url,databaseSsl:false}):{configured:true,query:(...a)=>pg.query(...a),transaction:f=>pg.transaction(t=>f({query:(...a)=>t.query(...a)})),close:()=>pg.close()};try{const r=await new ValRepository({db,tenantId:data.tenantId,readStore:()=>({}),saveStore:()=>{}}).ingestCommercialImport(data);process.stdout.write(JSON.stringify({ignored:r.ignoredEventCount}))}finally{await db.close()}`
 let output=''
 try{
  output=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe'],env:{...process.env,VAL_OBSERVABILITY_ENABLED:'false'}})
   let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>code?reject(new Error(`synthetic restart child ${code}: ${err}`)):resolve(out))
   child.stdin.end(JSON.stringify({data:input(),directory,url:process.env.VAL_LEG_TEST_DATABASE_URL||null}))
  })
 }finally{await openDatabase()}
 assert.equal(JSON.parse(output).ignored,1);assert.equal((await events()).length,1)
})
leg('LEG-extra-source','known distinct origins and IDs remain distinct','2 events; no merge',async({act,checkpoint})=>{
 const m={...mapping,eventId:'business',source:'origin'}
 await act(input([row({business:'001',origin:'SYNTHETIC-ERP-A'})],{mapping:m}));await checkpoint()
 await act(input([row({business:'001',origin:'SYNTHETIC-ERP-B'})],{mapping:m}));assert.equal((await events()).length,2)
})
leg('LEG-extra-foreign-reference','prior ID from another owner/producer cannot authorize update','review required; original unchanged',async({act,checkpoint})=>{
 await act();const old=(await events())[0];await checkpoint()
 const r=await act(input([row({previous:old.external_id,value:'15000'})],{ownerId:otherOwner,mapping:{...mapping,previousExternalId:'previous'}}))
 assert.equal(r.ambiguousEventCount,1);assert.equal((await snapshot()).length,1);assert.equal(Number((await events())[0].value),10000)
})
leg('LEG-extra-duplicate-id','two rows claim same explicit business ID','both require review; no business persisted',async({act,checkpoint})=>{
 await checkpoint();const r=await act(input([row({business:'001'}),row({business:'001',value:'15000'})],{mapping:{...mapping,eventId:'business'}}))
 assert.equal(r.ambiguousEventCount,2);assert.equal((await events()).length,0)
})
leg('LEG-extra-distinct-id','two real identical sales have different business IDs','2 events; value 20000; correction touches only selected ID',async({act,checkpoint})=>{
 const m={...mapping,eventId:'business'}
 await act(input([row({business:'A'}),row({business:'B'})],{mapping:m}));assert.equal((await events()).length,2);await checkpoint()
 const r=await act(input([row({business:'B'}),row({business:'A',value:'15000'})],{mapping:m}))
 assert.equal(r.updatedEventCount,1);assert.equal(r.ignoredEventCount,1);assert.equal((await events()).reduce((s,e)=>s+Number(e.value),0),25000)
})
leg('LEG-extra-long-legacy','truncated historical product requires reference, never a new duplicate','review first; explicit reference reuses original ID',async({act,checkpoint})=>{
 const long='SYNTHETIC LONG PRODUCT '.repeat(15)
 await act(input([row({product:long})]));const old=await makeLegacy();await checkpoint()
 const r=await act(input([row({product:long})]));assert.equal(r.ambiguousEventCount,1);assert.equal((await events()).length,1)
 const linked=await act(input([row({product:long,previous:old.external_id})],{mapping:{...mapping,previousExternalId:'previous'}}))
 assert.equal(linked.createdEventCount,0);assert.equal((await events()).length,1);assert.equal((await events())[0].external_id,old.external_id)
})
leg('LEG-extra-conflicting-reference','two corrections reference the same legacy event','both review; original unchanged',async({act,checkpoint})=>{
 await act();const old=await makeLegacy();await checkpoint()
 const r=await act(input([row({previous:old.external_id,value:'15000'}),row({previous:old.external_id,value:'20000'})],{mapping:{...mapping,previousExternalId:'previous'}}))
 assert.equal(r.ambiguousEventCount,2);assert.equal((await events()).length,1);assert.equal(Number((await events())[0].value),10000)
})
leg('LEG-extra-empty-identity','mapped source/business ID cannot silently disappear','both review; no inserts',async({act,checkpoint})=>{
 await checkpoint();const r=await act(input([row({origin:'ERP',business:''}),row({origin:'',business:'001'})],{mapping:{...mapping,eventId:'business',source:'origin'}}))
 assert.equal(r.ambiguousEventCount,2);assert.equal((await events()).length,0)
})
leg('LEG-extra-invalid-amount','numeric overflow and invalid amount alongside valid row','valid row persists; two rejected rows with reasons',async({act,checkpoint})=>{
 await checkpoint();const r=await act(input([row({value:1e20}),row({value:'invalid amount'}),row()]))
 assert.equal((await events()).length,1);assert.equal(r.createdEventCount,1);assert.equal(r.rejectedEventCount,2)
})
leg('LEG-extra-round14','replay record made by f2f0556 / round14 fingerprint','1 event; old ID preserved',async({act,checkpoint})=>{
 await act();const old=await makeLegacy('round14');await checkpoint();const r=await act()
 assert.equal(r.ignoredEventCount,1);assert.equal((await events()).length,1);assert.equal((await events())[0].external_id,old.external_id)
})
leg('LEG-extra-unverified-history','similar payload with unverified historical fingerprint','review required; no merge or insert',async({act,checkpoint})=>{
 await act();await makeLegacy();await db.query("UPDATE business_events SET external_id='commercial_import:unverified:1' WHERE tenant_id=$1",[tenant]);await checkpoint()
 const r=await act();assert.equal(r.ambiguousEventCount,1);assert.equal((await events()).length,1);assert.equal((await events())[0].external_id,'commercial_import:unverified:1')
})
