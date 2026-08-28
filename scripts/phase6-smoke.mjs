import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const dataRoot=await mkdtemp(join(tmpdir(),'val-phase6-smoke-'))

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
 const headers={'content-type':'application/json','x-request-id':'00000000-0000-4000-8000-000000000690'}
 const visit=await requestJson(`${base}/api/visits`,{method:'POST',headers,body:JSON.stringify({clientId:'demo-client',scheduledAt:'2026-08-29T14:00:00.000Z',objective:'Retornar com comparativo e registrar próximo passo.'})})
 assert.equal(visit.status,201)
 const visitId=visit.payload.visit.id
 const preparation=await requestJson(`${base}/api/v1/visits/${visitId}/preparation`,{method:'POST',headers,body:'{}'})
 assert.equal(preparation.status,201)
 assert.equal(preparation.payload.preparation.version,'val.prepare_visit.v1')
 const report=await requestJson(`${base}/api/v1/visits/${visitId}/report`,{method:'POST',headers,body:JSON.stringify({source_type:'TEXT',text:'O produtor achou o preço caro e pediu comparativo. Não fechou. Pediu retorno em 2026-08-29 depois de falar com o sócio. Comentou buva numa área.'})})
 assert.equal(report.status,201)
 assert.equal(report.payload.visit_report.confirmation_status,'PENDING_REVIEW')
 const commitmentIds=report.payload.visit_report.commitments_proposed.map(item=>item.item_id)
 const confirmed=await requestJson(`${base}/api/v1/visits/${visitId}/confirm`,{method:'POST',headers,body:JSON.stringify({visit_report_id:report.payload.visit_report.visit_report_id,confirm_commitment_ids:commitmentIds,outcome_type:'NO_DECISION',result:{decision:'pending'}})})
 assert.equal(confirmed.status,200)
 assert.equal(confirmed.payload.visit_report.confirmation_status,'CONFIRMED')
 assert.equal(confirmed.payload.commitments[0].version,'val.commitment.v1')
 assert.equal(confirmed.payload.outcome.version,'val.outcome.v1')
 assert.equal(confirmed.payload.learning_candidate.status,'CANDIDATE')
 const recovered=await requestJson(`${base}/api/v1/visits/${visitId}/report`)
 assert.equal(recovered.status,200)
 assert.equal(recovered.payload.visit_report.visit_report_id,report.payload.visit_report.visit_report_id)
 const learning=await requestJson(`${base}/api/v1/visits/${visitId}/learning-context`)
 assert.equal(learning.status,200)
 assert.equal(learning.payload.learning_candidates[0].status,'CANDIDATE')
 assert.equal(learning.payload.transcripts.length,0)
 console.log(JSON.stringify({visit:visit.status,preparation:preparation.status,report:{created:report.status,confirmed:confirmed.status,recovered:recovered.status},commitments:confirmed.payload.commitments.length,outcome:confirmed.payload.outcome.outcome_type,learning:{status:learning.status,candidates:learning.payload.learning_candidates.length}},null,2))
}finally{
 if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
 await rm(dataRoot,{recursive:true,force:true})
}
