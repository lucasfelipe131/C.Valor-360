import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

// Only the provider/service boundary is synthetic. Requests traverse the real
// server/start.js, handleApi and HTTP error handler that dropped currentContext.
test('real HTTP preserves voice resync context and serves current-screen guidance without a provider',async()=>{
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve))
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 const dir=await mkdtemp(join(tmpdir(),'val-voice-navigation-'))
 const serviceUrl=new URL('../server/realtime-voice/service.js',import.meta.url).href
 const stub=`export function createRealtimeVoiceService(){return {
  status:()=>({enabled:false}),availability:async()=>({available:false}),
  createSession:async({input})=>{throw Object.assign(new Error('A conversa foi atualizada. Sincronize o contexto para retomar a voz.'),{
   statusCode:409,code:input.denied?'realtime_voice_session_scope_denied':'realtime_voice_context_epoch_mismatch',
   currentContext:{conversationId:'synthetic-thread',clientId:null,contextEpoch:3,contextDomain:'GENERAL'}
  })}
 }}`
 const loader=join(dir,'voice-boundary-loader.mjs')
 await writeFile(loader,`export async function load(url,context,nextLoad){if(url===${JSON.stringify(serviceUrl)})return {format:'module',shortCircuit:true,source:${JSON.stringify(stub)}};return nextLoad(url,context)}`)
 const child=spawn(process.execPath,['--loader',loader,'server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:dir,AUTO_MIGRATE:'false',VAL_DEMO_MODE:'true',VAL_REALTIME_VOICE_ENABLED:'false',VAL_AI_REQUESTS_PER_10_MINUTES:'60',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
 const post=async(path,payload)=>{
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  return {status:response.status,payload:await response.json()}
 }
 try{
  for(let i=0;i<150&&!output.includes('VALOR 360 disponível na porta')&&child.exitCode===null;i++)await delay(50)
  assert.match(output,/VALOR 360 disponível na porta/)
  const stale=await post('/api/v1/realtime-voice/sessions',{conversationId:'synthetic-thread',contextEpoch:2})
  assert.equal(stale.status,409)
  assert.deepEqual(stale.payload.currentContext,{conversationId:'synthetic-thread',clientId:null,contextEpoch:3,contextDomain:'GENERAL'})
  const denied=await post('/api/v1/realtime-voice/sessions',{denied:true})
  assert.equal(denied.payload.currentContext,undefined,'scope errors must not disclose a context to reconcile')
  for(const [page,tool,label] of [['reports','','Relatórios'],['visits','','Visitas'],['agro','calculadoras','Calculadoras'],['datahub','','Base Inteligente']]){
   const guide=await post('/api/val/chat',{message:'Como uso esta tela?',conversationId:`guide-${page}`,workspaceContext:{current_module:page,current_tool:tool}})
   assert.equal(guide.status,200,JSON.stringify(guide.payload))
   assert.ok(guide.payload.advice.answer.includes(label),JSON.stringify(guide.payload))
   assert.equal(guide.payload.workspaceAction,null,'help explains the current page without navigating')
   assert.equal(guide.payload.responseScope.producerId,null)
   assert.equal(guide.payload.advice.ai_reasoning.run.tool_result.tool,'workspace_guide')
  }
 }finally{
  if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}
  await rm(dir,{recursive:true,force:true})
 }
})
