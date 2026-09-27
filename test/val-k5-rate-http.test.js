import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

test('application HTTP quota advertises actual window, structured 429, zero provider calls',async()=>{
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
 const directory=await mkdtemp(join(tmpdir(),'val-k5-rate-'))
 // Lower local-only quota for an offline contract check; staging is untouched.
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:directory,VAL_DEMO_MODE:'true',VAL_AI_REQUESTS_PER_10_MINUTES:'2',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let log='';child.stdout.on('data',chunk=>{log+=chunk});child.stderr.on('data',chunk=>{log+=chunk})
 try{
  for(let i=0;i<200&&!log.includes('VALOR 360 disponível na porta');i++){if(child.exitCode!==null)assert.fail(log);await delay(50)}
  assert.ok(log.includes('VALOR 360 disponível na porta'),log)
  const policy=await fetch(`http://127.0.0.1:${port}/api/val/status`).then(r=>r.json())
  assert.deepEqual(policy.rateLimit,{limit:2,windowMs:600000,scope:'identity',policy:'fixed-window'})
  for(let i=0;i<3;i++){
   const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Olá',conversationId:`offline-${i}`})})
   const payload=await response.json()
   assert.equal(response.status,i<2?200:429,JSON.stringify(payload))
   assert.equal(response.headers.get('x-ratelimit-limit'),'2')
   if(i===2){assert.equal(payload.reason_code,'APPLICATION_RATE_LIMIT');assert.equal(payload.responseMetadata.outcome.response_class,'RATE_LIMIT');assert.equal(payload.responseMetadata.outcome.reason_code,'APPLICATION_RATE_LIMIT');assert.ok(Number(response.headers.get('retry-after'))>0)}
  }
  assert.doesNotMatch(log,/knowledge.general.provider_call/)
 }finally{
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve();child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true})
 }
})
