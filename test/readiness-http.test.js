import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
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
  child.once('exit',code=>finish(reject,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}

async function stop(child){
 if(child.exitCode!==null)return
 child.kill('SIGTERM')
 await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
}

test('/ready é JSON de readiness e source.commitSha identifica o source implantado',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-readiness-http-'))
 const port=await availablePort()
 const deployedCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim()
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:'00000000-0000-4000-8000-000000000001',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:'',RAILWAY_GIT_COMMIT_SHA:deployedCommit},
  stdio:['ignore','pipe','pipe']
 })
 try{
  await waitForStartup(child)
  const ready=await fetch(`http://127.0.0.1:${port}/ready`)
  assert.equal(ready.status,200)
  assert.match(ready.headers.get('content-type')||'',/^application\/json/)
  const readiness=await ready.json()
  assert.equal(readiness.status,'ready')
  assert.equal(readiness.dependencies.storage.ready,true)
  assert.equal(readiness.dependencies.security.ready,true)

  const releaseResponse=await fetch(`http://127.0.0.1:${port}/api/release`)
  assert.equal(releaseResponse.status,200)
  const release=await releaseResponse.json()
  assert.equal(release.source.commitSha,deployedCommit)
  assert.equal(release.source.runtimeCommitSha,deployedCommit)
  assert.notEqual(release.source.match,false)
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
