import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {emptySeasonCrops} from '../src/lib/producer-seasons.js'
async function availablePort(){
  const server=createServer()
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const port=server.address().port
  await new Promise(resolve=>server.close(resolve))
  return port
}

function ready(child){
  return new Promise((resolve,reject)=>{
    let completed=false
    const finish=(fn,value)=>{if(completed)return;completed=true;clearTimeout(timer);fn(value)}
    const timer=setTimeout(()=>finish(reject,new Error('Servidor local não iniciou em 15 segundos.')),15000)
    child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta'))finish(resolve)})
    child.once('exit',code=>finish(reject,new Error(`Servidor encerrou antes da regressão HTTP: ${code}`)))
  })
}


test('HTTP season plans persist across restart, preserve missing values and reject foreign scope or stale revisions',async()=>{
 const tenantId='00000000-0000-4000-8000-000000000001',ownerId='demo@valor360.local'
 const client={id:'season-uat-demo',name:'DEMO safras HTTP',isDemo:true,tenantId,ownerId}
 const store={surveys:[],imports:[{id:'synthetic-season-http',tenantId,ownerId,clients:[client]}],visits:[],opportunities:[],val:{}}
 const dataRoot=await mkdtemp(join(tmpdir(),'val-season-http-'))
 const storePath=join(dataRoot,'valor360-store.json');await writeFile(storePath,JSON.stringify(store))
 const port=await availablePort()
 let child
 const start=async()=>{
  child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
  child.stderr.on('data',()=>{});await ready(child)
 }
 const stop=async()=>{if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
 const call=async(id,method='GET',input)=>{const response=await fetch(`http://127.0.0.1:${port}/api/clients/${id}/season-plans`,{method,headers:{'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,payload:await response.json()}}
 try{
  await start()
  assert.deepEqual((await call(client.id)).payload.seasons,[])
  assert.equal((await call('foreign')).status,404)
  const input={season:'2627V',revision:0,observedOn:'2026-09-07',sourceNote:'Fixture explícita de UAT local',crops:emptySeasonCrops(),isDemo:false,tenantId:'other'}
  input.crops[0].areaHa=100;input.crops[0].expectedYield=60
  const saved=await call(client.id,'PUT',input);assert.equal(saved.status,200,JSON.stringify(saved.payload))
  assert.equal(saved.payload.season.isDemo,true);assert.equal(saved.payload.season.revision,1)
  assert.equal(saved.payload.season.crops[0].retainedSc,null)
  assert.equal((await call(client.id,'PUT',input)).status,409)
  assert.equal((await call('foreign','PUT',input)).status,404)
  await stop();await start()
  const reloaded=await call(client.id);assert.equal(reloaded.status,200)
  assert.equal(reloaded.payload.seasons[0].crops[0].areaHa,100)
  assert.equal(reloaded.payload.seasons[0].crops[0].otherBuyersSc,null)
  assert.equal((await call(client.id,'PUT',{...input,season:'2727I'})).status,200)
  const persisted=JSON.parse(await readFile(storePath,'utf8'))
  assert.equal(persisted.val.producerSeasons.length,2)
  assert.equal(persisted.val.producerSeasons[0].crops[0].productionSc,undefined)
  assert.deepEqual(persisted.opportunities,[]);assert.deepEqual(persisted.imports,store.imports)
 }finally{await stop();await rm(dataRoot,{recursive:true,force:true})}
})
