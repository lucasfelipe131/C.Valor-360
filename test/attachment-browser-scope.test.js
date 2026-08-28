import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {attachmentBrowserScopeVersion,attachmentContentUrl,attachmentMatchesBrowserScope} from '../src/lib/attachment-browser-scope.js'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const clientA='cliente-a'
const clientB='cliente-b'
const attachmentA='50000000-0000-4000-8000-000000000101'
const attachmentB='50000000-0000-4000-8000-000000000102'
const unlinked='50000000-0000-4000-8000-000000000103'

async function availablePort(){
 const server=createServer()
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const port=server.address().port
 await new Promise(resolve=>server.close(resolve))
 return port
}

function waitForStartup(child,timeoutMs=15_000){
 return new Promise((resolve,reject)=>{
  let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(reject,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta'))finish(resolve)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>finish(reject,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}

async function stop(child){
 if(child.exitCode!==null)return
 child.kill('SIGTERM')
 await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
}

const storedAttachment=({id,clientId=null,name,analysis={},status='interpreted',confirmedAt=null})=>({
 id,tenantId,tenant_id:tenantId,ownerId:null,clientId,client_id:clientId,client_external_key:clientId,
 original_name:name,mime_type:'image/jpeg',size_bytes:3,content_base64:'YWJj',sha256:'a'.repeat(64),
 status,analysis:{association:{state:clientId?'LINKED_CLIENT':'UNLINKED'},...analysis},confirmed_at:confirmedAt,
 created_at:'2026-08-28T12:00:00.000Z',updated_at:'2026-08-28T12:00:00.000Z'
})

test('helper do browser vincula URL e autorização ao produtor ativo ou a UNLINKED explícito',()=>{
 const linked={id:attachmentA,clientId:clientA,association:'LINKED_CLIENT'}
 const detached={id:unlinked,clientId:null,association:'UNLINKED'}
 assert.equal(attachmentBrowserScopeVersion,'val.attachment_browser_scope.v1')
 assert.equal(attachmentMatchesBrowserScope(linked,{clientId:clientA}),true)
 assert.equal(attachmentMatchesBrowserScope(linked,{clientId:clientB}),false)
 assert.equal(attachmentContentUrl(linked,{clientId:clientA}),`/api/val/attachments/${attachmentA}?clientId=cliente-a`)
 assert.throws(()=>attachmentContentUrl(linked,{clientId:clientB}),error=>error.code==='ATTACHMENT_BROWSER_SCOPE_DENIED')
 assert.equal(attachmentContentUrl(detached,{allowUnlinked:true}),`/api/val/attachments/${unlinked}?association=UNLINKED`)
 assert.throws(()=>attachmentContentUrl(detached,{clientId:clientA,allowUnlinked:true}),error=>error.code==='ATTACHMENT_BROWSER_SCOPE_DENIED')
})

test('HTTP de attachment nega card cross-client, exige escopo e preserva provenance UNLINKED e metadata-only',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-attachment-scope-'))
 const port=await availablePort()
 const store={surveys:[],imports:[],val:{attachments:[
  storedAttachment({id:attachmentA,clientId:clientA,name:'campo-a.jpg',analysis:{latestScanResult:{attachment_id:attachmentA,organization_id:tenantId,result_reference:'scan-a'}}}),
  storedAttachment({id:attachmentB,clientId:clientB,name:'campo-b.jpg',status:'confirmed',confirmedAt:'2026-08-27T14:00:00.000Z'}),
  storedAttachment({id:unlinked,name:'sem-vinculo.jpg'})
 ]}}
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe']
 })
 const base=`http://127.0.0.1:${port}`
 try{
  await waitForStartup(child)
  const missingScope=await fetch(`${base}/api/val/attachments/${attachmentA}`)
  assert.equal(missingScope.status,400)
  assert.equal((await missingScope.json()).code,'attachment_browser_scope_required')

  const own=await fetch(`${base}/api/val/attachments/${attachmentA}?clientId=${clientA}`)
  assert.equal(own.status,200)
  assert.equal(Buffer.from(await own.arrayBuffer()).toString(),'abc')

  const crossClient=await fetch(`${base}/api/val/attachments/${attachmentA}?clientId=${clientB}`)
  assert.equal(crossClient.status,404)
  assert.equal((await crossClient.json()).code,'attachment_scope_not_found')

  const unlinkedAsClient=await fetch(`${base}/api/val/attachments/${unlinked}?clientId=${clientA}`)
  assert.equal(unlinkedAsClient.status,404)
  const unlinkedResponse=await fetch(`${base}/api/val/attachments/${unlinked}?association=UNLINKED`)
  assert.equal(unlinkedResponse.status,200)

  const fieldPhoto={label:'Talhão Norte',category:'Nutrição',observedAt:'2026-08-28',notes:'Reboleira observada.'}
  const wrongPatch=await fetch(`${base}/api/val/attachments?clientId=${clientB}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:attachmentA,fieldPhoto})})
  assert.equal(wrongPatch.status,404)

  const metadataPatch=await fetch(`${base}/api/val/attachments?clientId=${clientA}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:attachmentA,fieldPhoto})})
  assert.equal(metadataPatch.status,200)
  const updated=(await metadataPatch.json()).attachment
  assert.equal(updated.status,'interpreted')
  assert.equal(updated.analysis.fieldPhoto.label,'Talhão Norte')
  assert.equal(updated.analysis.latestScanResult.attachment_id,attachmentA)
  assert.equal(updated.analysis.latestScanResult.organization_id,tenantId)

  const confirmedMetadataPatch=await fetch(`${base}/api/val/attachments?clientId=${clientB}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:attachmentB,fieldPhoto})})
  assert.equal(confirmedMetadataPatch.status,200)
  const confirmedUpdated=(await confirmedMetadataPatch.json()).attachment
  assert.equal(confirmedUpdated.status,'confirmed')
  assert.equal(confirmedUpdated.confirmedAt,'2026-08-27T14:00:00.000Z')

  const forgedState=await fetch(`${base}/api/val/attachments?clientId=${clientA}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:attachmentA,status:'interpreted',fieldPhoto})})
  assert.equal(forgedState.status,400)
  assert.equal((await forgedState.json()).code,'attachment_public_patch_status_forbidden')
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
