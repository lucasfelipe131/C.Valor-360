import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {isTechnicalWorkspaceRequest,signedTechnicalIdentity} from '../server/technical-workspace.js'

test('núcleo técnico roteia somente páginas, APIs e ativos do Manual incorporado',()=>{
 assert.equal(isTechnicalWorkspaceRequest('/tecnico/'),true)
 assert.equal(isTechnicalWorkspaceRequest('/tecnico/_next/static/app.js'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/diagnosis'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/workspace'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/geospatial/search'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/geospatial/official-boundaries'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/admin/users'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/admin/usage'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/admin/metrics'),false)
 assert.equal(isTechnicalWorkspaceRequest('/api/portfolio-admin/users'),false)
 assert.equal(isTechnicalWorkspaceRequest('/tessdata/por.traineddata.gz'),true)
 assert.equal(isTechnicalWorkspaceRequest('/api/technical/bootstrap'),false)
 assert.equal(isTechnicalWorkspaceRequest('/api/val/chat'),false)
})

test('identidade interna é curta, assinada e vinculada à sessão do VALOR 360',()=>{
 const secret='s'.repeat(64)
 const signed=signedTechnicalIdentity({session:{email:'consultor@exemplo.com',role:'admin'},tenantId:'tenant-1',secret})
 assert.ok(signed)
 assert.equal(signed.signature,createHmac('sha256',secret).update(signed.payload).digest('base64url'))
 const identity=JSON.parse(Buffer.from(signed.payload,'base64url').toString('utf8'))
 assert.match(identity.id,/^[0-9a-f-]{36}$/)
 assert.equal(identity.email,'consultor@exemplo.com')
 assert.equal(identity.role,'admin')
 assert.ok(identity.exp>Math.floor(Date.now()/1000))
 const consultant=JSON.parse(Buffer.from(signedTechnicalIdentity({session:{email:'campo@exemplo.com'},tenantId:'tenant-1',secret}).payload,'base64url').toString('utf8'))
 assert.equal(consultant.role,'tester')
 const linked=JSON.parse(Buffer.from(signedTechnicalIdentity({session:{id:'00000000-0000-4000-8000-000000000321',email:'campo@exemplo.com',name:'Campo Norte'},tenantId:'tenant-1',secret}).payload,'base64url').toString('utf8'))
 assert.equal(linked.id,'00000000-0000-4000-8000-000000000321')
 assert.equal(linked.displayName,'Campo Norte')
 assert.equal(signedTechnicalIdentity({session:{email:'consultor@exemplo.com'},tenantId:'tenant-1',secret:'curto'}),null)
})
