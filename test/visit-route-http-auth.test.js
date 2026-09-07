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


test('rotas, demonstração e propriedade recusam acesso sem sessão autenticada',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-route-auth-'))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEMO_ENVIRONMENT:'',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'route-gate@example.test',VAL_ADMIN_PASSWORD:'Synthetic-route-gate-42!',VAL_SESSION_SECRET:'synthetic-local-route-gate-session-key-42'},stdio:['ignore','pipe','pipe']})
 try{
  await waitForStartup(child)
  const base=`http://127.0.0.1:${port}`
  for(const [path,method] of [['/api/demo/producer','GET'],['/api/demo/producer','POST'],['/api/visit-routes/day?date=2026-09-06','GET'],['/api/visit-routes/day?date=2026-09-06','PUT'],['/api/visit-routes/driving','POST'],['/api/clients/foreign/property','GET'],['/api/clients/foreign/property','PUT']]){
   const denied=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(method!=='GET'?{body:'{}'}:{})})
   assert.equal(denied.status,401,`${method} ${path}`)
  }
  const live=await fetch(`${base}/live`);assert.equal(live.status,200)
 }finally{await stop(child);await rm(dataRoot,{recursive:true,force:true})}
})
