import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {AccessRepository} from '../server/access-repository.js'
import {createAuth,hashPassword,verifyPassword} from '../server/auth.js'
import {listVersionedMigrations} from '../server/migration-runner.js'

// Exercise PostgreSQL query semantics rather than matching SQL in a mock. All
// schema, migrations and records are local to this disposable PGlite instance.
test('recuperação bootstrap persiste com LEFT JOIN e revoga a sessão anterior em PGlite',async()=>{
 const pg=new PGlite()
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 try{
  const schema=await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')
  await pg.exec(schema.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
  const tenantId='00000000-0000-4000-8000-000000000001'
  const userId='00000000-0000-4000-8000-000000000019'
  const oldPassword='SyntheticBefore123'
  const newPassword='SyntheticAfter456'
  const runtimeConfig={adminEmail:'synthetic-admin@example.test',adminPassword:newPassword,sessionSecret:'synthetic-session-secret-only-not-runtime-12345',defaultTenantId:tenantId}
  await db.query('INSERT INTO users(id,name,email,password_hash,session_version) VALUES($1,$2,$3,$4,$5)',[userId,'SYNTHETIC bootstrap recovery',runtimeConfig.adminEmail,await hashPassword(oldPassword),4])
  await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,userId,'admin'])
  const otherTenant='00000000-0000-4000-8000-000000000002'
  const otherUser='00000000-0000-4000-8000-000000000020'
  await db.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)',[otherTenant,'SYNTHETIC other tenant','synthetic-other-tenant'])
  await db.query('INSERT INTO users(id,name,email,password_hash,session_version) VALUES($1,$2,$3,$4,$5)',[otherUser,'SYNTHETIC other user','other@example.test',await hashPassword(oldPassword),9])
  await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[otherTenant,otherUser,'consultant'])
  const otherState=()=>db.query('SELECT u.password_hash,u.session_version,u.status,m.tenant_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1',[otherUser])
  const otherBefore=(await otherState()).rows
  const repository=new AccessRepository({db,tenantId,runtimeConfig})
  const oldSession={sub:userId,sessionVersion:4}
  assert.ok(await repository.resolveSession(oldSession))
  assert.equal(await repository.authenticate(runtimeConfig.adminEmail,newPassword),null)
  const auth=createAuth(runtimeConfig)
  assert.equal(auth.verifyBootstrapCredentials(runtimeConfig.adminEmail,'SyntheticWrong789'),false)
  assert.equal(auth.verifyBootstrapCredentials(runtimeConfig.adminEmail,newPassword),true)
  const before=(await db.query('SELECT session_version FROM users WHERE id=$1',[userId])).rows[0]
  assert.equal(before.session_version,4,'a configuração sozinha não deve substituir a senha persistida')

  const recovered=await repository.recoverBootstrapAdminPassword()
  assert.equal(recovered.id,userId)
  assert.equal(recovered.tenantId,tenantId)
  assert.equal(recovered.role,'admin')
  assert.equal(recovered.sessionVersion,5)
  const persisted=(await db.query('SELECT password_hash,session_version,must_change_password FROM users WHERE id=$1',[userId])).rows[0]
  assert.equal(await verifyPassword(newPassword,persisted.password_hash),true)
  assert.equal(await verifyPassword(oldPassword,persisted.password_hash),false)
  assert.equal(persisted.session_version,5)
  assert.equal(persisted.must_change_password,false)
  assert.equal(await repository.resolveSession(oldSession),null)
  assert.equal((await repository.resolveSession({sub:userId,sessionVersion:5})).role,'admin')
  assert.equal(await repository.authenticate(runtimeConfig.adminEmail,oldPassword),null)
  assert.equal((await repository.authenticate(runtimeConfig.adminEmail,newPassword)).id,userId)
  const audits=(await db.query("SELECT before_data,after_data FROM audit_events WHERE tenant_id=$1 AND entity_id=$2 AND action='bootstrap_admin_password_recovered'",[tenantId,userId])).rows
  assert.equal(audits.length,1)
  assert.deepEqual(audits[0].before_data,{status:'active',sessionVersion:4})
  assert.deepEqual(audits[0].after_data,{status:'active',sessionVersion:5})
  const usage=(await db.query("SELECT COUNT(*)::integer total FROM usage_events WHERE tenant_id=$1 AND user_id=$2 AND event_type='login'",[tenantId,userId])).rows[0]
  assert.equal(usage.total,2,'recuperação e login normal devem manter a auditoria de uso')

  // The nullable side remains optional: recovery must also recreate a missing
  // admin membership while locking only the existing user row.
  await db.query('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId])
  assert.equal((await repository.recoverBootstrapAdminPassword()).sessionVersion,6)
  const membership=(await db.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId])).rows[0]
  assert.equal(membership.role,'admin')
  assert.deepEqual((await otherState()).rows,otherBefore,'recuperação não pode alterar outro usuário ou tenant')
  const otherAudit=(await db.query('SELECT COUNT(*)::integer total FROM audit_events WHERE tenant_id=$1 OR actor_id=$2',[otherTenant,otherUser])).rows[0]
  assert.equal(otherAudit.total,0)
 }finally{await pg.close()}
})
