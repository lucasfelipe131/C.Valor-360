import test from 'node:test'
import assert from 'node:assert/strict'
import {createAuth} from '../server/auth.js'

const requestWith=token=>({headers:{cookie:token?`valor360_session=${token}`:'','x-forwarded-proto':'https'}})

test('autenticação falha fechada com segredo ou senha fracos',()=>{
  const auth=createAuth({adminEmail:'admin@example.com',adminPassword:'curta',sessionSecret:'fraco',defaultTenantId:'tenant',sessionTtlSeconds:60})
  assert.equal(auth.configured,false)
  assert.equal(auth.verifyCredentials('admin@example.com','curta'),false)
  assert.equal(auth.session(requestWith('qualquer')),null)
})

test('sessão assinada preserva tenant e rejeita adulteração',()=>{
  const config={adminEmail:'admin@example.com',adminPassword:'senha-segura-123',sessionSecret:'segredo-de-sessao-com-mais-de-32-caracteres',defaultTenantId:'tenant-1',sessionTtlSeconds:60}
  const auth=createAuth(config);const token=auth.issue(config.adminEmail)
  assert.equal(auth.session(requestWith(token)).tenantId,'tenant-1')
  assert.match(auth.storageScope({email:'admin@example.com',tenantId:'tenant-1'}),/^[A-Za-z0-9_-]{24}$/)
  assert.equal(auth.storageScope({email:'ADMIN@example.com',tenantId:'tenant-1'}),auth.storageScope({email:'admin@example.com',tenantId:'tenant-1'}))
  assert.notEqual(auth.storageScope({email:'outro@example.com',tenantId:'tenant-1'}),auth.storageScope({email:'admin@example.com',tenantId:'tenant-1'}))
  assert.notEqual(auth.storageScope({email:'admin@example.com',tenantId:'tenant-2'}),auth.storageScope({email:'admin@example.com',tenantId:'tenant-1'}))
  assert.equal(auth.session(requestWith(`${token}x`)),null)
  assert.match(auth.cookie(requestWith(),token),/HttpOnly/)
  assert.match(auth.cookie(requestWith(),token),/Secure/)
})
