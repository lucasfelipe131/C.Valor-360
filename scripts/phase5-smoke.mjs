import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const dataRoot=await mkdtemp(join(tmpdir(),'val-phase5-smoke-'))

async function availablePort(){
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port
}

function waitForStartup(child,timeoutMs=15_000){
 return new Promise((resolve,reject)=>{
  let stdout='';let stderr='';const timer=setTimeout(()=>reject(new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  const done=()=>{clearTimeout(timer);resolve({stdout,stderr})}
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('VALOR 360 disponível na porta'))done()})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>{if(!stdout.includes('VALOR 360 disponível na porta')){clearTimeout(timer);reject(new Error(`Servidor encerrou antes do smoke (code ${code}). ${stderr}`))}})
 })
}

async function requestJson(url,options={}){
 const response=await fetch(url,options);const payload=await response.json();return {status:response.status,payload}
}

const port=await availablePort()
const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:'00000000-0000-4000-8000-000000000001',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})

try{
 await waitForStartup(child)
 const base=`http://127.0.0.1:${port}`
 const headers={'content-type':'application/json','x-request-id':'00000000-0000-4000-8000-000000000590'}
 const visit=await requestJson(`${base}/api/visits`,{method:'POST',headers,body:JSON.stringify({clientId:'demo-client',scheduledAt:'2026-08-28T14:00:00.000Z',objective:'Preparar visita comercial com evidência.'})})
 assert.equal(visit.status,201)
 const visitId=visit.payload.visit.id
 const preparation=await requestJson(`${base}/api/v1/visits/${visitId}/preparation`,{method:'POST',headers,body:'{}'})
 assert.equal(preparation.status,201)
 assert.equal(preparation.payload.contract_version,'val.prepare_visit.response.v1')
 assert.equal(preparation.payload.preparation.version,'val.prepare_visit.v1')
 assert.equal(preparation.payload.action_plan.version,'val.action_plan.v1')
 assert.ok(preparation.payload.action_plan.priorities.length<=3)
 const recovered=await requestJson(`${base}/api/v1/visits/${visitId}/preparation`)
 assert.equal(recovered.status,200)
 assert.equal(recovered.payload.preparation.preparation_id,preparation.payload.preparation.preparation_id)
 const action=preparation.payload.action_plan.priorities[0]
 const commitment=await requestJson(`${base}/api/v1/commitments`,{method:'POST',headers,body:JSON.stringify({client_id:'demo-client',visit_id:visitId,action_plan_id:preparation.payload.action_plan.action_plan_id,action_id:action.action_id,description:action.description,due_at:action.due_at,status:'ACCEPTED',success_criteria:action.success_criteria,agreed_with_client:true})})
 assert.equal(commitment.status,201)
 assert.equal(commitment.payload.commitment.version,'val.commitment.v1')
 const commitments=await requestJson(`${base}/api/v1/commitments?clientId=demo-client`)
 assert.equal(commitments.status,200);assert.equal(commitments.payload.commitments.length,1)
 const done=await requestJson(`${base}/api/v1/commitments/${commitment.payload.commitment.commitment_id}`,{method:'PATCH',headers,body:JSON.stringify({status:'DONE',evidence_refs:[{id:'smoke:result'}]})})
 assert.equal(done.status,200);assert.equal(done.payload.commitment.status,'DONE')
 const insights=await requestJson(`${base}/api/v1/insights`)
 assert.equal(insights.status,200);assert.equal(insights.payload.contract_version,'val.insight_feed.v1')
 console.log(JSON.stringify({visit:visit.status,preparation:{status:preparation.status,version:preparation.payload.preparation.version,priorities:preparation.payload.action_plan.priorities.length},recovered:recovered.status,commitment:{created:commitment.status,completed:done.status},insights:{status:insights.status,version:insights.payload.contract_version}},null,2))
}finally{
 if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
 await rm(dataRoot,{recursive:true,force:true})
}
