import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

// Reproduzido no staging em 23/09/2026 00:12:40Z: "abre o produtor" por voz mudou o contexto da
// conversa, o servidor respondeu 409 realtime_voice_context_epoch_mismatch e o navegador NÃO
// ressincronizou — o 409 veio uma vez só. O serviço anexava currentContext ao erro, mas o catch da
// API que esse erro alcança devolvia só error/code. Só a fronteira do provider é sintética: a
// requisição atravessa o server/start.js, o handleApi e o catch reais.
test('HTTP real devolve currentContext no 409 de contexto da voz e nada num escopo negado',async()=>{
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve))
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 const dir=await mkdtemp(join(tmpdir(),'val-voice-epoch-resync-'))
 const serviceUrl=new URL('../server/realtime-voice/service.js',import.meta.url).href
 const stub=`export function createRealtimeVoiceService(){return {
  status:()=>({enabled:false}),availability:async()=>({available:false}),
  createSession:async({input})=>{throw Object.assign(new Error('A conversa foi atualizada. Sincronize o contexto para retomar a voz.'),{
   statusCode:409,code:input.denied?'realtime_voice_session_scope_denied':'realtime_voice_context_epoch_mismatch',
   currentContext:{conversationId:'synthetic-thread',clientId:'produtor-a',contextEpoch:3,contextDomain:'GENERAL'}
  })},
  recordUsage:async()=>({accepted:true}),recordTurn:async()=>({accepted:true}),budget:async()=>({})
 }}`
 const loader=join(dir,'voice-boundary-loader.mjs')
 await writeFile(loader,`export async function load(url,context,nextLoad){if(url===${JSON.stringify(serviceUrl)})return {format:'module',shortCircuit:true,source:${JSON.stringify(stub)}};return nextLoad(url,context)}`)
 const child=spawn(process.execPath,['--loader',loader,'server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:dir,AUTO_MIGRATE:'false',VAL_DEMO_MODE:'true',VAL_REALTIME_VOICE_ENABLED:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
 const post=async(path,payload)=>{
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  return {status:response.status,payload:await response.json()}
 }
 try{
  for(let i=0;i<150&&!output.includes('VALOR 360 disponível na porta')&&child.exitCode===null;i++)await delay(50)
  assert.match(output,/VALOR 360 disponível na porta/)
  const stale=await post('/api/v1/realtime-voice/sessions',{conversationId:'synthetic-thread',clientId:'produtor-a',contextEpoch:2})
  assert.equal(stale.status,409)
  assert.equal(stale.payload.code,'realtime_voice_context_epoch_mismatch')
  assert.deepEqual(stale.payload.currentContext,{conversationId:'synthetic-thread',clientId:'produtor-a',contextEpoch:3,contextDomain:'GENERAL'})
  const denied=await post('/api/v1/realtime-voice/sessions',{denied:true})
  assert.equal(denied.status,409)
  assert.equal(denied.payload.currentContext,undefined,'escopo negado não revela contexto para reconciliar')
 }finally{
  if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}
  await rm(dir,{recursive:true,force:true})
 }
})
