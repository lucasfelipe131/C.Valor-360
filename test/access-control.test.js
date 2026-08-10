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
