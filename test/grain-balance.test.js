import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {appendGrainMovement,readGrainBalance,normalizeMovement,reconcileMovements} from '../server/grain-balance.js'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const tenant=id(801),otherTenant=id(802),owner=id(803),otherOwner=id(804),a=id(805),b=id(806),foreign=id(807)
let pg,repository
const input=(key,kind,quantity)=>({id:key,commodity:'soja',unit:'sc_60kg',kind,quantity,origin:'SYNTHETIC G3',reference:`REF-${key}`,occurredAt:'2026-09-01T12:00:00Z'})
before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
 for(const key of [tenant,otherTenant])await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)',[key,'SYNTHETIC G3',key])
 for(const key of [owner,otherOwner])await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[key,'SYNTHETIC G3',`${key}@example.test`])
 for(const t of [tenant,otherTenant])for(const o of [owner,otherOwner])await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[t,o,'consultant'])
 for(const [key,t,o] of [[a,tenant,owner],[b,tenant,owner],[foreign,otherTenant,owner],[id(808),tenant,otherOwner]])await pg.query('INSERT INTO clients(id,tenant_id,consultant_id,name,external_key) VALUES($1,$2,$3,$4,$5)',[key,t,o,'SYNTHETIC producer',`external-${key}`])
 repository={tenantId:tenant,db:{configured:true,transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}}
})
after(async()=>{await pg?.close()})
test('operational balance persists every parcel and reconciles 1000 + 200 + 300 - 150 = 1350',async()=>{
 for(const [key,kind,quantity] of [['opening','opening','1000'],['A','entry','200'],['B','entry','300'],['C','exit','150']])await appendGrainMovement(repository,a,owner,input(key,kind,quantity))
 const result=await readGrainBalance(repository,a,owner)
 assert.equal(result.balances[0].current,'1350.000')
 assert.equal(result.balances[0].opening,'1000.000');assert.equal(result.balances[0].entries,'500.000');assert.equal(result.balances[0].exits,'150.000')
 assert.equal(result.movements.length,4)
 for(const row of result.movements){assert.equal(row.producerId,a);assert.ok(row.id&&row.origin&&row.reference&&row.occurredAt);assert.ok(result.balances[0].movementIds.includes(row.id))}
})
test('retry and duplicate reference with a new id never count twice; conflicting content fails closed',async()=>{
 const retries=await Promise.all(Array.from({length:3},()=>appendGrainMovement(repository,a,owner,input('A','entry','200'))))
 assert.ok(retries.every(row=>row.idempotent))
 assert.equal((await appendGrainMovement(repository,a,owner,{...input('A','entry','200'),id:'new-id'})).idempotent,true)
 await assert.rejects(()=>appendGrainMovement(repository,a,owner,input('A','entry','201')),{statusCode:409})
 await assert.rejects(()=>appendGrainMovement(repository,a,owner,input('opening-again','opening','1')),{statusCode:409})
 assert.equal((await readGrainBalance(repository,a,owner)).balances[0].current,'1350.000')
})
test('invalid quantity, provenance, date and missing opening cannot mutate a balance',async()=>{
 for(const patch of [{quantity:'-1'},{quantity:'1.0001'},{quantity:true},{quantity:'NaN'},{origin:''},{reference:''},{occurredAt:'2026-09-01T12:00:00'},{kind:'unknown'}])assert.throws(()=>normalizeMovement({...input('invalid','entry','1'),...patch}))
 await assert.rejects(()=>appendGrainMovement(repository,b,owner,input('before-opening','entry','1')),{statusCode:409})
 assert.deepEqual((await readGrainBalance(repository,b,owner)).balances,[])
})
test('tenant, owner and producer boundaries apply to both reads and writes',async()=>{
 for(const [repo,producer,actor] of [[repository,a,otherOwner],[repository,foreign,owner],[{...repository,tenantId:otherTenant},a,owner],[repository,id(808),owner]]){
  await assert.rejects(()=>readGrainBalance(repo,producer,actor),{statusCode:404})
  await assert.rejects(()=>appendGrainMovement(repo,producer,actor,input('foreign','opening','999')),{statusCode:404})
 }
 await assert.rejects(()=>readGrainBalance(repository,a,null),{statusCode:401})
 await appendGrainMovement(repository,b,owner,{...input('opening','opening','7'),tenantId:otherTenant,ownerId:otherOwner,producerId:a})
 assert.equal((await readGrainBalance(repository,b,owner)).balances[0].current,'7.000')
 assert.equal((await readGrainBalance(repository,a,owner)).balances[0].current,'1350.000')
 await pg.query('UPDATE clients SET consultant_id=$2 WHERE id=$1',[b,otherOwner])
 await assert.rejects(()=>readGrainBalance(repository,b,owner),{statusCode:404})
 assert.deepEqual((await readGrainBalance(repository,b,otherOwner)).movements,[])
})
test('decimal arithmetic is exact and units remain separate',()=>{
 const rows=[{...input('0','opening','0.100')},{...input('1','entry','0.200')},{...input('2','exit','0.001')},{...input('3','opening','2.000'),unit:'t'}]
 const balances=reconcileMovements(rows)
 assert.equal(balances[0].current,'0.299');assert.equal(balances[1].current,'2.000')
})
test('movement migration is repeatable and database constraints retain uniqueness',async()=>{
 const sql=await readFile(new URL('../database/migrations/20260923_015_sog_movements_expand.sql',import.meta.url),'utf8')
 await pg.exec(sql)
 await assert.rejects(()=>pg.query(`INSERT INTO sog_movements SELECT tenant_id,owner_user_id,client_id,'different-id',commodity,unit,kind,quantity,origin,reference,occurred_at,created_at FROM sog_movements WHERE client_id=$1 AND id='A'`,[a]),error=>error.code==='23505')
 assert.equal((await readGrainBalance(repository,a,owner)).balances[0].current,'1350.000')
})
