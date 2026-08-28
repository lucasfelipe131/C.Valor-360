import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {Agent,request} from 'node:http'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))

async function availablePort(){
 const server=createServer()
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const port=server.address().port
 await new Promise(resolve=>server.close(resolve))
 return port
}

function waitForStartup(child,timeoutMs=15_000){
 return new Promise((resolve,reject)=>{
  let stdout='';let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(reject,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('VALOR 360 disponível na porta'))finish(resolve)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>{if(!stdout.includes('VALOR 360 disponível na porta'))finish(reject,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`))})
 })
}

function requestJson({port,path,method='GET',agent,body='',chunked=false}){
 return new Promise((resolve,reject)=>{
  const headers={accept:'application/json',connection:'keep-alive'}
  if(body){headers['content-type']='application/json';if(!chunked)headers['content-length']=Buffer.byteLength(body)}
  let socket
  const outgoing=request({host:'127.0.0.1',port,path,method,agent,headers},response=>{
   const chunks=[]
   response.on('data',chunk=>chunks.push(chunk))
   response.on('end',()=>{
    const raw=Buffer.concat(chunks).toString('utf8')
    try{resolve({status:response.statusCode,headers:response.headers,payload:raw?JSON.parse(raw):{},socket})}catch(error){reject(error)}
   })
  })
  outgoing.once('socket',value=>{socket=value})
  outgoing.once('error',reject)
  if(chunked&&body){for(let offset=0;offset<body.length;offset+=97)outgoing.write(body.slice(offset,offset+97));outgoing.end()}
  else outgoing.end(body||undefined)
 })
}

async function stop(child){
 if(child.exitCode!==null)return
 child.kill('SIGTERM')
 await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
}

test('Voice HTTP — body excedido retorna JSON 413 e preserva o keep-alive',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-voice-body-limit-'))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:'00000000-0000-4000-8000-000000000001',VAL_MAX_BODY_BYTES:'256',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe']
 })
 const agent=new Agent({keepAlive:true,maxSockets:1})
 try{
  await waitForStartup(child)
  const oversized=JSON.stringify({client_id:'demo-client',interaction_type:'CLIENT_NOTE',manual_text:'x'.repeat(2_000)})
  const rejected=await requestJson({port,path:'/api/v1/voice-interactions',method:'POST',agent,body:oversized,chunked:true})
  assert.equal(rejected.status,413)
  assert.equal(rejected.payload.code,'request_too_large')
  assert.match(rejected.payload.error,/muito grande/i)
  assert.notEqual(rejected.headers.connection,'close')

  const declared=await requestJson({port,path:'/api/v1/voice-interactions',method:'POST',agent,body:oversized})
  assert.equal(declared.status,413)
  assert.equal(declared.payload.code,'request_too_large')
  assert.notEqual(declared.headers.connection,'close')
  assert.strictEqual(declared.socket,rejected.socket,'O atalho por Content-Length também deve drenar sem trocar o socket.')

  const live=await requestJson({port,path:'/live',agent})
  assert.equal(live.status,200)
  assert.equal(live.payload.status,'ok')
  assert.strictEqual(live.socket,rejected.socket,'A conexão HTTP deveria continuar reutilizável depois do 413 drenado.')
 }finally{
  agent.destroy()
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
