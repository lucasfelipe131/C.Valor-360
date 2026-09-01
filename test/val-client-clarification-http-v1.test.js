import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})

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

test('HTTP confirma homônimo por opção autorizada em conversa nova e rejeita ID injetado',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-clarification-http-'))
 const port=await availablePort()
 const clients=[scoped({id:'joao-a',name:'João Pereira'}),scoped({id:'joao-b',name:'João Souza'}),scoped({id:'carlos',name:'Carlos Lima'})]
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify({surveys:[],imports:[scoped({id:'import-clarification',clients})],visits:[],businessEvents:[],val:{},grains:{profiles:[],intentions:[],marketSnapshots:[]}}))
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'30',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe'],
 })
 const request=async({conversationId,clientId='',selection=null})=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Abra João.',clientId,conversationId,mode:'daily',clarificationSelection:selection||undefined})})
  return {status:response.status,payload:await response.json()}
 }
 try{
  await waitForStartup(child)
  const ambiguous=await request({conversationId:'conversation-ambiguous-origin'})
  assert.equal(ambiguous.status,409)
  assert.equal(ambiguous.payload.code,'val_client_reference_ambiguous')
  assert.equal(ambiguous.payload.clarification.contractVersion,'val.client_clarification.v1')
  assert.deepEqual(ambiguous.payload.clarification.options.map(item=>item.id),['joao-a','joao-b'])

  const selection={contractVersion:'val.client_clarification.v1',clientId:'joao-b',reference:ambiguous.payload.clarification.reference}
  const selected=await request({conversationId:'conversation-clarified-fresh',clientId:'joao-b',selection})
  assert.equal(selected.status,200,JSON.stringify(selected.payload))
  assert.equal(selected.payload.conversationResolution.reason_code,'USER_CLARIFICATION_SELECTED')
  assert.equal(selected.payload.conversationState.current_client.id,'joao-b')
  assert.equal(selected.payload.responseScope.producerId,'joao-b')
  assert.equal(selected.payload.responseScope.conversationId,'conversation-clarified-fresh')
  assert.equal(selected.payload.workspaceAction.client_id,'joao-b')

  const injected=await request({conversationId:'conversation-clarified-injected',clientId:'carlos',selection:{...selection,clientId:'carlos'}})
  assert.equal(injected.status,409)
  assert.equal(injected.payload.code,'val_client_clarification_invalid')
  assert.equal(injected.payload.reasonCode,'CLARIFICATION_OPTION_NOT_AUTHORIZED')

  const stale=await request({conversationId:'conversation-clarified-stale',clientId:'joao-b',selection:{...selection,reference:'Carlos'}})
  assert.equal(stale.status,409)
  assert.equal(stale.payload.code,'val_client_clarification_invalid')
  assert.equal(stale.payload.reasonCode,'CLARIFICATION_REFERENCE_MISMATCH')
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
