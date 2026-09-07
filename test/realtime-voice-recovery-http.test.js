import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

test('voice HTTP preserves auth failures and reports the separate abuse retry deadline',async()=>{
 const probe=createServer()
 await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve))
 const port=probe.address().port
 await new Promise(resolve=>probe.close(resolve))
 const dataRoot=await mkdtemp(join(tmpdir(),'val-voice-recovery-http-'))
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:dataRoot,AUTO_MIGRATE:'false',VAL_DEMO_MODE:'true',VAL_REALTIME_VOICE_ENABLED:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let output=''
 child.stdout.on('data',chunk=>{output+=chunk})
 child.stderr.on('data',()=>{})
 try{
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('Voice HTTP server did not start'))},15_000)
   const poll=setInterval(()=>{if(output.includes('VALOR 360 disponível na porta')){clearInterval(poll);clearTimeout(timeout);resolve()}},20)
  })
  const base=`http://127.0.0.1:${port}`
  const statusResponse=await fetch(`${base}/api/v1/realtime-voice/status`)
  assert.equal(statusResponse.status,200)
  const status=await statusResponse.json()
  assert.equal(status.available,false)
  assert.equal(status.unavailableCode,'realtime_voice_auth_required')
  assert.equal(status.canRetry,false)
  assert.doesNotMatch(JSON.stringify(status),/clientSecret|OPENAI_API_KEY|sk-/)
  for(let index=0;index<60;index++){
   const response=await fetch(`${base}/api/v1/realtime-voice/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
   assert.equal(response.status,401)
   assert.equal((await response.json()).code,'realtime_voice_auth_required')
  }
  const limited=await fetch(`${base}/api/v1/realtime-voice/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
  assert.equal(limited.status,429)
  const payload=await limited.json()
  assert.equal(payload.code,'realtime_voice_request_limit')
  assert.equal(payload.safe_to_retry,true)
  assert.equal(Number(limited.headers.get('Retry-After')),payload.retryAfterSeconds)
  assert.ok(payload.retryAfterSeconds>0&&payload.retryAfterSeconds<=60)
  const engine=await fetch(`${base}/api/val/status`)
  assert.equal((await engine.json()).realtimeVoice.unavailableCode,'realtime_voice_auth_required')
 }finally{
  if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timeout=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timeout);resolve()})})}
  await rm(dataRoot,{recursive:true,force:true})
 }
})
