import test from 'node:test'
import assert from 'node:assert/strict'
import {AccessRepository} from '../server/access-repository.js'
import {generateTemporaryPassword,hashPassword,validPassword,verifyPassword} from '../server/auth.js'

test('senhas de acesso usam scrypt e a senha temporária respeita a política',async()=>{
 const temporary=generateTemporaryPassword()
 assert.equal(validPassword(temporary),true)
 const encoded=await hashPassword(temporary)
 assert.match(encoded,/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/)
 assert.equal(await verifyPassword(temporary,encoded),true)
 assert.equal(await verifyPassword(`${temporary}x`,encoded),false)
})

test('administrador libera login ativo com carteira vazia e troca obrigatória',async()=>{
 const calls=[]
 const connection={query:async(sql,params=[])=>{
  calls.push({sql,params})
  if(sql.includes('INSERT INTO users'))return {rowCount:1,rows:[{id:params[0],name:params[1],email:params[2],status:'active',password_hash:params[3],must_change_password:true,session_version:0,created_at:new Date('2026-08-10T12:00:00Z')}]}
  return {rowCount:1,rows:[]}
 }}
 const db={configured:true,transaction:work=>work(connection)}
 const repository=new AccessRepository({db,tenantId:'00000000-0000-4000-8000-000000000001',runtimeConfig:{}})
 const created=await repository.createUser({id:'00000000-0000-4000-8000-000000000010',role:'admin'},{name:'Consultor Norte',email:'norte@example.com',role:'consultant'})
 assert.equal(created.user.email,'norte@example.com')
 assert.equal(created.user.mustChangePassword,true)
 assert.equal(validPassword(created.temporaryPassword),true)
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO memberships')&&call.params[2]==='consultant'))
 assert.ok(calls.some(call=>call.sql.includes('audit_events')&&call.sql.includes('actor_id')))
 assert.equal(calls.some(call=>call.sql.includes('INSERT INTO clients')),false)
})

test('usuário sem papel administrativo não libera novos logins',async()=>{
 const repository=new AccessRepository({db:{configured:true},tenantId:'tenant',runtimeConfig:{}})
 await assert.rejects(()=>repository.createUser({id:'user',role:'consultant'},{name:'Outro',email:'outro@example.com'}),error=>error.statusCode===403)
})

test('bootstrap atribui a carteira comercial sem promover produtores técnicos do Manual',async()=>{
 const calls=[]
 const connection={query:async(sql,params=[])=>{
  calls.push({sql,params})
  if(sql.includes('SELECT * FROM users'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000010',name:'Administrador',email:'admin@example.com',status:'active',password_hash:'hash',session_version:0}]}
  return {rowCount:1,rows:[]}
 }}
 const db={configured:true,transaction:work=>work(connection)}
 const repository=new AccessRepository({db,tenantId:'00000000-0000-4000-8000-000000000001',runtimeConfig:{adminEmail:'admin@example.com'}})
 await repository.ensureBootstrapAdmin()
 const portfolioAssignment=calls.find(call=>call.sql.includes('UPDATE clients client SET consultant_id'))
 assert.ok(portfolioAssignment)
 assert.match(portfolioAssignment.sql,/COALESCE\(client\.source,''\)<>'manual-do-agronomo'/)
})

test('métricas de uso aceitam somente eventos conhecidos e mantêm o login como proprietário',async()=>{
 const calls=[]
 const repository=new AccessRepository({db:{configured:true,query:async(sql,params)=>{calls.push({sql,params});return {rowCount:1,rows:[]}}},tenantId:'00000000-0000-4000-8000-000000000001',runtimeConfig:{}})
 const actor={id:'00000000-0000-4000-8000-000000000010',role:'consultant'}
 assert.equal(await repository.recordUsage(actor,{eventType:'page_view',page:'client 360<script>',entityType:'client',entityId:'produtor-1',metadata:{source:'navigation'}}),true)
 assert.equal(await repository.recordUsage(actor,{eventType:'val_attachment_uploaded',page:'client360',entityType:'client',entityId:'produtor-1',metadata:{mimeType:'image/jpeg'}}),true)
 assert.equal(await repository.recordUsage(actor,{eventType:'voice_interaction_confirmed',page:'val',entityType:'voice_interaction',entityId:'11111111-1111-4111-8111-111111111111',metadata:{interactionType:'CLIENT_NOTE',confirmedCandidates:2}}),true)
 assert.equal(await repository.recordUsage(actor,{eventType:'evento_inventado',page:'admin'}),false)
 assert.equal(calls.length,3)
 assert.deepEqual(calls[0].params.slice(0,3),['00000000-0000-4000-8000-000000000001',actor.id,'page_view'])
 assert.equal(calls[0].params[3],'client360script')
 assert.deepEqual(JSON.parse(calls[0].params[6]),{source:'navigation'})
 assert.equal(calls[1].params[2],'val_attachment_uploaded')
 assert.deepEqual(JSON.parse(calls[1].params[6]),{mimeType:'image/jpeg'})
 assert.equal(calls[2].params[2],'voice_interaction_confirmed')
 assert.deepEqual(JSON.parse(calls[2].params[6]),{interactionType:'CLIENT_NOTE',confirmedCandidates:2})
})

test('painel de métricas é exclusivo do administrador e consolida por tenant',async()=>{
 const tenantId='00000000-0000-4000-8000-000000000001'
 const calls=[]
 const db={configured:true,query:async(sql,params)=>{
  calls.push({sql,params})
  if(sql.includes('SELECT user_record.id,user_record.name'))return {rows:[{id:'00000000-0000-4000-8000-000000000010',name:'Consultor Norte',email:'norte@example.com',status:'active',role:'consultant',producer_count:3,accesses:2,page_views:8,direct_interactions:4,val_analyses:1,visits:2,opportunities:2,last_activity_at:new Date('2026-08-11T12:00:00Z')}]}
  if(sql.includes('WITH date_series AS'))return {rows:[{day_key:'2026-08-11',accesses:2,page_views:8,interactions:4,val_analyses:1}]}
  if(sql.includes('SELECT page,COUNT(*)'))return {rows:[{page:'client360',views:8,users:1}]}
  return {rows:[{users_total:2,users_active:2,users_blocked:0,active_users_period:1,producers:3,visits:2,opportunities:2,val_analyses:1,val_feedback:1,manual_syncs:2,accesses:2,page_views:8,direct_interactions:4}]}
 }}
 const repository=new AccessRepository({db,tenantId,runtimeConfig:{}})
 await assert.rejects(()=>repository.getAdminMetrics({id:'user',role:'consultant'},30),error=>error.statusCode===403)
 const result=await repository.getAdminMetrics({id:'admin',role:'admin'},30)
 assert.equal(result.periodDays,30)
 assert.equal(result.summary.producers,3)
 assert.equal(result.users[0].producerCount,3)
 assert.equal(result.users[0].lastActivityAt,'2026-08-11T12:00:00.000Z')
 assert.deepEqual(result.pages,[{page:'client360',views:8,users:1}])
 assert.equal(result.daily[0].day,'2026-08-11')
 const dailyCheck=calls.find(call=>call.sql.includes('WITH date_series AS'))
 assert.match(dailyCheck.sql,/AS event_day/)
 assert.match(dailyCheck.sql,/AS day_key/)
 assert.doesNotMatch(dailyCheck.sql,/::date\s+day\b/)
 assert.equal(calls.length,4)
 assert.ok(calls.every(call=>call.params[0]===tenantId))
})

test('teto de conhecimento geral de IA reinicia por login e bloqueia acima de US$ 5',async()=>{
 const tenantId='00000000-0000-4000-8000-000000000001'
 const actor={id:'00000000-0000-4000-8000-000000000010',role:'consultant'}
 let spentUsd=0
 const calls=[]
 const db={configured:true,query:async(sql,params)=>{
  calls.push({sql,params})
  return {rows:[{spent_usd:spentUsd}]}
 }}
 const repository=new AccessRepository({db,tenantId,runtimeConfig:{}})
 const fresh=await repository.checkAiGeneralKnowledgeBudget(actor)
 assert.equal(fresh.allowed,true)
 assert.equal(fresh.remainingUsd,5)
 assert.match(calls[0].sql,/event_type='ai_general_knowledge_usage'/)
 assert.match(calls[0].sql,/occurred_at>=COALESCE\(user_record\.last_login_at/)
 assert.deepEqual(calls[0].params,[tenantId,actor.id])

 spentUsd=4.999999
 const almostExhausted=await repository.checkAiGeneralKnowledgeBudget(actor)
 assert.equal(almostExhausted.allowed,true)
 assert.ok(almostExhausted.remainingUsd>0)

 spentUsd=5
 const exhausted=await repository.checkAiGeneralKnowledgeBudget(actor)
 assert.equal(exhausted.allowed,false)
 assert.equal(exhausted.remainingUsd,0)

 spentUsd=7.5
 const overBudget=await repository.checkAiGeneralKnowledgeBudget(actor)
 assert.equal(overBudget.allowed,false)
 assert.equal(overBudget.remainingUsd,0)

 const noDb=new AccessRepository({db:{configured:false},tenantId,runtimeConfig:{}})
 const disabled=await noDb.checkAiGeneralKnowledgeBudget(actor)
 assert.equal(disabled.allowed,true)

 assert.equal(await repository.recordUsage(actor,{eventType:'ai_general_knowledge_usage',page:'val',metadata:{costUsd:0.0004,model:'gpt-5.6-luna'}}),true)
})
