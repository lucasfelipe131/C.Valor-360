import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const dataRoot=await mkdtemp(join(tmpdir(),'val-phase2-smoke-'))

async function availablePort(){
  const server=createServer()
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const port=server.address().port
  await new Promise(resolve=>server.close(resolve))
  return port
}

function waitForStartup(child,timeoutMs=15_000){
  return new Promise((resolve,reject)=>{
    let stdout='';let stderr=''
    const timer=setTimeout(()=>reject(new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
    const done=()=>{clearTimeout(timer);resolve({stdout,stderr})}
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('VALOR 360 disponível na porta'))done()})
    child.stderr.on('data',chunk=>{stderr+=chunk})
    child.once('exit',code=>{if(!stdout.includes('VALOR 360 disponível na porta')){clearTimeout(timer);reject(new Error(`Servidor encerrou antes do smoke (code ${code}). ${stderr}`))}})
  })
}

async function requestJson(url,options){
  const response=await fetch(url,options)
  const payload=await response.json()
  return {status:response.status,payload}
}

const port=await availablePort()
const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:'00000000-0000-4000-8000-000000000001',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe']
})

try{
  await waitForStartup(child)
  const base=`http://127.0.0.1:${port}`
  const live=await requestJson(`${base}/live`)
  const status=await requestJson(`${base}/api/val/status`)
  const legacy=await requestJson(`${base}/api/val/recommendations`,{method:'POST',headers:{'content-type':'application/json','x-request-id':'00000000-0000-4000-8000-000000000206'},body:JSON.stringify({clientId:'demo-1',client:{id:'demo-1',name:'Fazenda Teste'},message:'Prepare a próxima melhor ação.',mode:'daily'})})
  const canonical=await requestJson(`${base}/api/v1/val/recommendations`,{method:'POST',headers:{'content-type':'application/json','x-request-id':'00000000-0000-4000-8000-000000000207'},body:JSON.stringify({clientId:'demo-1',client:{id:'demo-1',name:'Fazenda Teste'},message:'Prepare o roteiro da próxima visita.',mode:'daily'})})

  for(const response of [live,status,legacy,canonical])assert.equal(response.status,200)
  assert.equal(live.payload.status,'ok')
  assert.equal(status.payload.core.version,'val.core.v1')
  assert.deepEqual(status.payload.composition.order,['conversion','innovation'])
  assert.ok(legacy.payload.requestId)
  assert.equal(legacy.payload.contract_version,undefined)
  assert.equal(canonical.payload.contract_version,'val.response.v1')
  assert.equal(canonical.payload.request_id,'00000000-0000-4000-8000-000000000207')
  assert.equal(canonical.payload.audit.request_id,canonical.payload.request_id)
  assert.equal(canonical.payload.audit.route_id,'prepare_visit.v1')
  assert.equal(canonical.payload.audit.module_runs[0].module_id,'LEGACY_VAL_ENGINE')
  assert.ok(canonical.payload.recommendation)

  console.log(JSON.stringify({
    live:live.status,
    status:status.status,
    legacy:{status:legacy.status,requestId:Boolean(legacy.payload.requestId),contractVersion:legacy.payload.contract_version??null,engineMode:legacy.payload.engineMode},
    canonical:{status:canonical.status,contractVersion:canonical.payload.contract_version,requestId:canonical.payload.request_id,routeId:canonical.payload.audit.route_id,module:canonical.payload.audit.module_runs[0].module_id,engineMode:canonical.payload.recommendation.engineMode},
    composition:status.payload.composition
  },null,2))
}finally{
  if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
  await rm(dataRoot,{recursive:true,force:true})
}
