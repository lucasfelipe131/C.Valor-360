import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'
import {createVisitLoopService} from '../server/visit-loop/service.js'

const id=n=>`00000000-0000-4000-9000-${String(n).padStart(12,'0')}`
const tenant=id(1),owner=id(2),other=id(3),producer=id(4),foreignProducer=id(5),visit=id(6)
let pg,service
before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 service=createVisitLoopService({repository:new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId:tenant})})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1,\'Synthetic admission tenant\',\'uat-admission\')',[tenant])
 for(const user of [owner,other]){
  await pg.query('INSERT INTO users(id,name,email) VALUES($1,\'Synthetic operator\',$2)',[user,`${user}@example.test`])
  await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,\'consultant\')',[tenant,user])
 }
 for(const [client,actor] of [[producer,owner],[foreignProducer,other]])await pg.query("INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,status) VALUES($1::uuid,$2,$1::text,$3,'Synthetic producer','active')",[client,tenant,actor])
 await pg.query("INSERT INTO visits(id,tenant_id,client_id,consultant_id,status) VALUES($1,$2,$3,$4,'Realizada')",[visit,tenant,producer,owner])
 for(const [commitment,client,actor] of [[id(10),producer,owner],[id(11),foreignProducer,other],[id(12),producer,other]])await pg.query("INSERT INTO val_commitments(id,tenant_id,client_id,description,owner_type,owner_id,due_at,status,success_criteria,evidence_refs,source_ref,audit) VALUES($1,$2,$3,'Synthetic reviewed commitment','USER',$4,'2026-10-01','ACCEPTED','Synthetic completion','[]','synthetic-uat','{}')",[commitment,tenant,client,actor])
})
after(async()=>{await pg?.close()})
const record=commitment=>service.recordOutcome({tenantId:tenant,ownerId:owner,input:{visit_id:visit,commitment_id:commitment,outcome_type:'NO_CHANGE',result:{summary:'Synthetic UAT'}},now:new Date('2026-09-19T12:00:00Z')})

test('PLAN-03: the public service path rejects another owner or producer commitment before writing',async()=>{
 for(const commitment of [id(11),id(12),id(999)]){
  const count=(await pg.query('SELECT count(*)::int n FROM val_outcomes')).rows[0].n
  await assert.rejects(()=>record(commitment),error=>[403,404].includes(error.statusCode))
  assert.equal((await pg.query('SELECT count(*)::int n FROM val_outcomes')).rows[0].n,count)
 }
})
test('PLAN-03: own commitment and an outcome with no commitment remain valid',async()=>{
 assert.equal((await record(id(10))).outcome.commitment_id,id(10))
 assert.equal((await record(null)).outcome.commitment_id,null)
})
