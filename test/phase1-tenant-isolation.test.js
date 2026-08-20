import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {createAuth} from '../server/auth.js'
import {ValRepository} from '../server/repository.js'
import {assertTenantScope} from '../server/tenant-scope.js'
import {signedTechnicalIdentity} from '../server/technical-workspace.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'

test('o escopo permite o tenant configurado e nega tentativa cross-tenant',()=>{
  assert.equal(assertTenantScope(tenantA,tenantA),tenantA)
  assert.throws(()=>assertTenantScope(tenantA,tenantB),error=>error.statusCode===403&&error.code==='cross_tenant_scope_denied')
})

test('sessão assinada de outro tenant falha fechada',()=>{
  const config={adminEmail:'admin@example.com',adminPassword:'senha-segura-123',sessionSecret:'segredo-de-sessao-com-mais-de-32-caracteres',defaultTenantId:tenantA,sessionTtlSeconds:60}
  const auth=createAuth(config)
  const token=auth.issue({id:'00000000-0000-4000-8000-000000000123',email:config.adminEmail,name:'Admin',role:'admin',tenantId:tenantB,sessionVersion:1})
  const request={headers:{cookie:`valor360_session=${token}`,'x-forwarded-proto':'https'}}
  assert.equal(auth.session(request),null)
})

test('entradas públicas do repositório não aceitam sobrescrever o tenant',async()=>{
  let saved=0
  const store={surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},attachments:[]}}
  const repository=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:()=>{saved++},tenantId:tenantA})
  const attempts=[
    ()=>repository.getClientContext({tenantId:tenantB,clientId:'c',ownerId:'u'}),
    ()=>repository.createAttachment({tenantId:tenantB,ownerId:'u',clientId:'c',originalName:'a.txt',mimeType:'text/plain',sizeBytes:1,dataBase64:'YQ=='}),
    ()=>repository.listAttachments({tenantId:tenantB,ownerId:'u',clientId:'c'}),
    ()=>repository.getAttachments({tenantId:tenantB,ownerId:'u',clientId:'c',ids:['00000000-0000-4000-8000-000000000099']}),
    ()=>repository.getAttachment({tenantId:tenantB,ownerId:'u',id:'00000000-0000-4000-8000-000000000099'}),
    ()=>repository.updateAttachment({tenantId:tenantB,ownerId:'u',id:'00000000-0000-4000-8000-000000000099',status:'rejected'}),
    ()=>repository.recordRecommendation({tenantId:tenantB,ownerId:'u',question:'q',advice:{}}),
    ()=>repository.recordModelRun({tenantId:tenantB,status:'failed'}),
    ()=>repository.recordFeedback({tenantId:tenantB,recommendationId:'r',rating:1}),
    ()=>repository.ingestEvent({tenantId:tenantB,ownerId:'u',event:{externalId:'e',source:'s'},signals:[]}),
    ()=>repository.ingestCommercialImport({tenantId:tenantB,ownerId:'u',summary:{},clients:[]})
  ]
  for(const attempt of attempts)await assert.rejects(attempt,error=>error.statusCode===403&&error.code==='cross_tenant_scope_denied')
  assert.equal(saved,0)
})

test('a identidade do Manual carrega o tenant assinado e as queries críticas o filtram',()=>{
  const secret='segredo-de-embed-com-mais-de-trinta-e-dois-caracteres'
  const signed=signedTechnicalIdentity({session:{email:'campo@example.com',role:'consultant'},tenantId:tenantA,secret})
  const identity=JSON.parse(Buffer.from(signed.payload,'base64url').toString('utf8'))
  assert.equal(identity.tenantId,tenantA)
  for(const path of ['../manual/app/api/workspace/route.ts','../manual/app/api/records/route.ts','../manual/app/api/integrations/valor360/sync/route.ts']){
    const code=readFileSync(new URL(path,import.meta.url),'utf8')
    assert.match(code,/tenant_id\s*=\s*\$1/)
    assert.match(code,/session\.tenantId/)
  }
})
