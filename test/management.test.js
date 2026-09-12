import {profilePhoto,validateProfilePhoto} from '../server/profile-photo.js'
import {readDailyVisitSuggestions} from '../server/daily-visit-suggestions.js'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {createManagementService,managementFilters} from '../server/management-service.js'
import {managementOnlyAllowed} from '../server/management-access.js'
import {readRouteProperties} from '../server/route-properties.js'
import {managementCsv,recordedTravel} from '../src/lib/management-data.js'

// These fixtures live only in an in-memory PostgreSQL engine; never in staging.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(100),foreignTenant=id(101),admin={id:id(1),tenantId,role:'admin'},viewer={id:id(2),tenantId,role:'bi_viewer'},consultant=id(3),outside=id(4),foreign=id(5),unassigned={id:id(6),tenantId,role:'manager'}
const period={start:'2026-09-01',end:'2026-09-12'}
let pg,db,service,unit,otherUnit,foreignUnit
before(async()=>{
 pg=new PGlite()
 // Execute the repository's actual schema and migrations. gen_random_uuid is
 // built into this PostgreSQL; only the optional pgcrypto extension is omitted.
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 service=createManagementService({db,tenantId})
 for(const [key,name] of [[tenantId,'TEST organization'],[foreignTenant,'OTHER TEST organization']])await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[key,name])
 for(const [key,role,tenant] of [[admin.id,'admin',tenantId],[viewer.id,'bi_viewer',tenantId],[consultant,'consultant',tenantId],[outside,'consultant',tenantId],[foreign,'consultant',foreignTenant],[unassigned.id,'manager',tenantId]]){
  await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[key,`TEST user ${key}`,`${key}@example.test`])
  await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,key,role])
 }
 unit=(await service.createUnit(admin,{name:'TEST own unit'})).unit
 otherUnit=(await service.createUnit(admin,{name:'TEST other unit'})).unit
 foreignUnit=id(199);await pg.query('INSERT INTO val_management_units(tenant_id,id,name) VALUES($1,$2,$3)',[foreignTenant,foreignUnit,'TEST foreign unit'])
 for(const [userId,unitId] of [[viewer.id,unit.id],[consultant,unit.id],[outside,otherUnit.id]])await service.assignUnit(admin,{userId,unitId})
 for(const [key,owner,tenant,source,profile] of [[20,consultant,tenantId,'manual',{}],[21,outside,tenantId,'manual',{}],[22,foreign,foreignTenant,'manual',{}],[23,consultant,tenantId,'val-demo-synthetic-v1',{isDemo:true}],[24,consultant,tenantId,'manual',{isDemo:true}]]){
  await pg.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,cultures,source,commercial_profile) VALUES($1::uuid,$2,$1::text,$3,$4,'TEST Town','Soja',$5,$6)`,[id(key),tenant,owner,`TEST producer ${key}`,source,JSON.stringify(profile)])
  await pg.query('INSERT INTO properties(id,tenant_id,client_id,name,metadata) VALUES($1,$2,$3,$4,$5)',[id(key+10),tenant,id(key),`TEST property ${key}`,JSON.stringify({location:{lat:-28,lng:-54}})])
 }
 await pg.query('INSERT INTO properties(id,tenant_id,client_id,name,metadata) VALUES($1,$2,$3,$4,$5)',[id(35),tenantId,id(20),'TEST second property',JSON.stringify({location:{lat:-29,lng:-53}})])
 await pg.query('INSERT INTO properties(id,tenant_id,client_id,name,metadata) VALUES($1,$2,$3,$4,$5)',[id(36),tenantId,id(20),'TEST missing location',JSON.stringify({location:{lat:null,lng:null}})])
 for(const [key,producer,owner,tenant,status,at] of [[40,20,consultant,tenantId,'COMPLETED','2026-09-12T15:00Z'],[41,21,outside,tenantId,'COMPLETED','2026-09-12T15:00Z'],[42,22,foreign,foreignTenant,'COMPLETED','2026-09-12T15:00Z'],[43,23,consultant,tenantId,'COMPLETED','2026-09-12T15:00Z'],[44,20,consultant,tenantId,'PLANNED','2026-09-15T15:00Z'],[45,20,consultant,tenantId,'COMPLETED_PENDING_REVIEW','2026-09-11T15:00Z']])await pg.query(`INSERT INTO visits(id,tenant_id,client_id,consultant_id,scheduled_at,lifecycle_status,objective) VALUES($1,$2,$3,$4,$5,$6,'TEST objective')`,[id(key),tenant,id(producer),owner,at,status])
 for(const [key,status,summary,confirmed] of [[50,'CONFIRMED','TEST human confirmed report','2026-09-12T16:00Z'],[51,'PENDING_REVIEW','TEST unconfirmed AI text',null]])await pg.query(`INSERT INTO val_visit_reports(id,tenant_id,visit_id,client_id,created_by,confirmed_by,contract_version,source_type,source_ref,visit_objective,summary,confidence,confirmation_status,idempotency_key,initial_extraction,confirmed_at)
  VALUES($1::uuid,$2,$3,$4,$5,$5,'val.visit_report.v1','TEXT',$1::text,'TEST objective',$6,1,$7,$1::text,'{}',$8)`,[id(key),tenantId,id(40),id(20),consultant,summary,status,confirmed])
 for(const owner of [consultant,outside])await pg.query(`INSERT INTO val_visit_routes(tenant_id,owner_id,route_date,trace) VALUES($1,$2,'2026-09-12',$3)`,[tenantId,owner,JSON.stringify([{lat:-28,lng:-54,timestamp:'2026-09-12T15:00:00Z'},{lat:-28,lng:-54.001,timestamp:'2026-09-12T15:01:00Z'},{lat:-29,lng:-55,timestamp:'2026-09-12T17:00:00Z'}])])
})
after(async()=>{await pg?.close()})

test('management SQL isolates both tenant and unit and excludes demo and unconfirmed reports',async()=>{
 const result=await service.overview(viewer,period)
 assert.deepEqual(result.producers.map(item=>item.id),[id(20)])
 assert.deepEqual(result.visits.map(item=>item.id),[id(40),id(45)])
 assert.equal(result.visits[0].report.summary,'TEST human confirmed report')
 assert.equal(result.producers[0].areaHa,null)
 assert.equal(result.summary.completed,1);assert.equal(result.summary.pending,1)
 assert.equal(result.summary.reports,1);assert.equal(result.summary.reached,1)
 assert.equal(result.routes.length,1);assert.ok(result.summary.recordedKm>0&&result.summary.recordedKm<1)
 assert.equal(result.routes[0].recordedSeconds,60)
 assert.equal(result.routes[0].date,'2026-09-12')
 assert.ok(!JSON.stringify(result).includes('TEST unconfirmed AI text'))
 assert.ok(!Object.hasOwn(result.routes[0],'trace'))
 assert.equal(result.demoExcluded,true)
})
test('unassigned managers get an empty configuration state, never tenant-wide facts',async()=>{
 const result=await service.overview(unassigned,period)
 assert.deepEqual(result,{configured:false,reason:'UNIT_NOT_ASSIGNED',filters:{...period,consultantId:null,municipality:'',status:''}})
})
test('server validates consultant filters, fresh roles and tenant instead of trusting caller scope',async()=>{
 await assert.rejects(service.overview(viewer,{...period,consultantId:outside}),{statusCode:403})
 await assert.rejects(service.overview({...viewer,tenantId:foreignTenant},period),{statusCode:403})
 await assert.rejects(service.overview({...viewer,role:'consultant'},period),{statusCode:403})
 await assert.rejects(service.overview(viewer,{...period,unitId:otherUnit.id}),{statusCode:400})
 await pg.query("UPDATE memberships SET role='consultant' WHERE tenant_id=$1 AND user_id=$2",[tenantId,viewer.id])
 try{await assert.rejects(service.overview(viewer,period),{statusCode:403})}finally{await pg.query("UPDATE memberships SET role='bi_viewer' WHERE tenant_id=$1 AND user_id=$2",[tenantId,viewer.id])}
})
test('unit changes are admin-only, reject cross-tenant membership and take effect on the next read',async()=>{
 await assert.rejects(service.assignUnit(viewer,{userId:consultant,unitId:unit.id}),{statusCode:403})
 await assert.rejects(service.assignUnit(admin,{userId:consultant,unitId:foreignUnit}),{statusCode:404})
 await assert.rejects(service.assignUnit(admin,{userId:foreign,unitId:unit.id}),{statusCode:404})
 await assert.rejects(pg.query('INSERT INTO val_management_memberships(tenant_id,user_id,unit_id) VALUES($1,$2,$3)',[foreignTenant,foreign,unit.id]),{code:'23503'})
 await service.assignUnit(admin,{userId:viewer.id,unitId:otherUnit.id})
 try{assert.deepEqual((await service.overview(viewer,period)).producers.map(item=>item.id),[id(21)])}finally{await service.assignUnit(admin,{userId:viewer.id,unitId:unit.id})}
 const audit=await pg.query("SELECT COUNT(*) FROM audit_events WHERE tenant_id=$1 AND action='management_unit_assigned'",[tenantId]);assert.ok(Number(audit.rows[0].count)>=5)
})
test('filters preserve missing GPS and only expose confirmed reports',async()=>{
 const result=await service.overview(viewer,{start:'2026-09-11',end:'2026-09-11',status:'COMPLETED_PENDING_REVIEW'})
 assert.equal(result.visits.length,1);assert.equal(result.summary.recordedKm,null);assert.equal(result.visits[0].report,null)
 for(const input of [{...period,start:'2026-02-30'},{...period,end:'2025-01-01'},{...period,start:'2020-01-01'},{...period,status:'ALL; DROP TABLE visits'}])assert.throws(()=>managementFilters(input),{statusCode:400})
})
test('route property query includes every owned property and never geocodes a missing location',async()=>{
 const result=await readRouteProperties({db,tenantId},consultant)
 const actual=result.properties.filter(item=>item.clientId===id(20))
 assert.equal(actual.length,3);assert.equal(actual.filter(item=>item.location).length,2)
 assert.equal(actual.find(item=>item.id===id(36)).locationStatus,'MISSING')
 assert.ok(!result.properties.some(item=>[id(21),id(22)].includes(item.clientId)))
 assert.ok(result.properties.filter(item=>[id(23),id(24)].includes(item.clientId)).every(item=>item.isDemo&&item.locationStatus==='DEMO'))
 assert.equal(actual[0].producerName,'TEST producer 20')
})
test('bi viewer may read management and maintain own session but cannot open operations or Manual',()=>{
 for(const [path,method] of [['/api/management/overview','GET'],['/api/auth/logout','POST'],['/api/auth/session','GET'],['/api/auth/password','PUT']])assert.equal(managementOnlyAllowed(viewer,path,method),true)
 for(const [path,method] of [['/api/management/overview','POST'],['/api/visits','POST'],['/api/intelligence','GET'],['/api/admin/management-units','PUT'],['/tecnico','GET'],['/tecnico/api/producers','POST'],['/api/val/chat','POST']])assert.equal(managementOnlyAllowed(viewer,path,method),false)
})
test('GPS gaps and missing values remain missing; CSV quotes values and neutralizes formulas',()=>{
 assert.equal(recordedTravel([]).distanceKm,null)
 assert.equal(recordedTravel([{lat:null,lng:null,timestamp:'2026-09-12T15:00Z'}]).distanceKm,null)
 assert.equal(recordedTravel([{lat:0,lng:0,timestamp:'2026-09-12T15:00Z'},{lat:0,lng:0,timestamp:'2026-09-12T15:01Z'}]).distanceKm,0)
 const csv=managementCsv([{key:'name'},{key:'area'}],[{name:'=HYPERLINK("bad")',area:null},{name:'José, Silva\nLinha 2',area:0},{name:'  +cmd',area:12.5}])
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("\"'=HYPERLINK(\"\"bad\"\")\""));assert.ok(csv.includes('"José, Silva\nLinha 2","0"'));assert.ok(csv.includes("\"'  +cmd\",\"12.5\""))
})
test('management migration remains idempotent without assigning existing users',async()=>{
 const migration=await readFile(new URL('../database/migrations/20260912_012_management_units_expand.sql',import.meta.url),'utf8')
 await pg.exec(migration)
 assert.equal((await service.overview(unassigned,period)).configured,false)
 assert.equal((await service.overview(viewer,period)).unit.id,unit.id)
})

test('profile photos persist separately and reject foreign producer access',async()=>{
 const actor={id:consultant,tenantId,role:'consultant'}
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N8AAAAASUVORK5CYII='
 const own=await profilePhoto({db,tenantId},actor,{write:true,input:{name:'TEST edited consultant',photo}})
 assert.equal(own.name,'TEST edited consultant');assert.equal(own.photo,photo)
 assert.equal((await profilePhoto({db,tenantId},actor,{clientId:id(20)})).photo,null)
 await profilePhoto({db,tenantId},actor,{clientId:id(20),write:true,input:{photo}})
 assert.equal((await profilePhoto({db,tenantId},actor,{clientId:id(20)})).photo,photo)
 await profilePhoto({db,tenantId},actor,{write:true,input:{photo:null}})
 assert.equal((await profilePhoto({db,tenantId},actor)).photo,null)
 assert.equal((await profilePhoto({db,tenantId},actor,{clientId:id(20)})).photo,photo)
 for(const clientId of [id(21),id(22)])await assert.rejects(profilePhoto({db,tenantId},actor,{clientId,write:true,input:{photo}}),{statusCode:404})
 assert.throws(()=>validateProfilePhoto('data:image/svg+xml;base64,PHN2Zz4='),{statusCode:400})
 assert.throws(()=>validateProfilePhoto('data:image/png;base64,'+Buffer.from('not an image with enough bytes').toString('base64')),{statusCode:400})
})
test('daily suggestions read owned historical next steps without scheduled visits',async()=>{
 await pg.query("INSERT INTO visits(id,tenant_id,client_id,consultant_id,summary,next_commitment,next_action_at,status) VALUES($1,$2,$3,$4,'TEST visit','TEST compare alternatives',$5,'Realizada')",[id(990),tenantId,id(20),consultant,'2026-09-12T15:00:00Z'])
 const result=await readDailyVisitSuggestions({db,tenantId},consultant,{now:new Date('2026-09-12T14:00:00Z')})
 const row=result.suggestions.find(item=>item.clientId===id(20))
 assert.equal(row.reason,'TEST compare alternatives');assert.equal(row.classification,'DUE_TODAY');assert.equal(row.confirmed,false)
 assert.ok(result.suggestions.every(item=>![id(21),id(22)].includes(item.clientId)))
 await pg.query("UPDATE visits SET next_action_at='2026-09-15' WHERE id=$1",[id(990)])
 assert.ok(!(await readDailyVisitSuggestions({db,tenantId},consultant,{now:new Date('2026-09-12T14:00:00Z')})).suggestions.some(item=>item.sourceId==='visit:'+id(990)))
})
