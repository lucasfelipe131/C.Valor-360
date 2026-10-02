import assert from 'node:assert/strict'
import test,{before,after} from 'node:test'
import {randomBytes} from 'node:crypto'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildSurveyOptions} from '../server/survey-validation.js'
import matrix from '../src/data/profile-matrix.json' with {type:'json'}

// Real HTTP handlers and repository fallback on disposable synthetic storage.
// No model, staging credentials, real producer data or network provider is used.
const tenant='00000000-0000-4000-8000-000000000001'
const tokens=Array.from({length:6},()=>randomBytes(24).toString('base64url'))
const options=buildSurveyOptions(matrix)
function answers(){
 const a={}
 for(let i=1;i<=45;i++)a[i]=i>=19&&i<=24?7:i>=7&&i<=18?[...options[i]][0]:i>=27?'':'SYNTHETIC answer'
 return a
}
let directory,child,base
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'val-survey-http-'))
 const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3600_000).toISOString()
 await writeFile(join(directory,'valor360-store.json'),JSON.stringify({surveys:tokens.map(token=>({token,tenantId:tenant,ownerId:'synthetic-owner@example.test',producerName:'SYNTHETIC survey producer',status:'aguardando',createdAt,expiresAt})),imports:[],val:{}}))
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening')
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
 base=`http://127.0.0.1:${port}`
 child=spawn(process.execPath,['server/start.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),NODE_ENV:'test',DATA_DIR:directory,VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenant,VAL_TRUST_PROXY:'true',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_REALTIME_VOICE_ENABLED:'false',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:'',VAL_OBSERVABILITY_ENABLED:'false'},stdio:['ignore','pipe','pipe']})
 await new Promise((resolve,reject)=>{
  let out='',err='';const timer=setTimeout(()=>reject(new Error(`Synthetic server startup timeout: ${err}`)),15000)
  child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta')){clearTimeout(timer);resolve()}})
  child.stderr.on('data',chunk=>{err+=chunk})
  child.once('error',error=>{clearTimeout(timer);reject(error)})
  child.once('exit',code=>{if(!out.includes('VALOR 360 disponível na porta')){clearTimeout(timer);reject(new Error(`Synthetic server exited ${code}: ${err}`))}})
 })
})
after(async()=>{
 if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped}
 if(directory)await rm(directory,{recursive:true,force:true})
})
async function submit(token,ip,body={answers:answers()}){
 const response=await fetch(`${base}/api/surveys/${token}/submit`,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify(body)})
 await response.json();return response.status
}

test('PS02 HTTP: attacker cannot consume another address quota for the same invitation',async()=>{
 for(let i=0;i<20;i++)assert.equal(await submit(tokens[0],'203.0.113.1',{}),400)
 assert.equal(await submit(tokens[0],'203.0.113.1',{}),429)
 assert.equal(await submit(tokens[0],'198.51.100.1'),200)
 assert.equal(await submit(tokens[0],'198.51.100.1'),409,'retry cannot submit the same invitation twice')
})
test('PS02 HTTP: two invitations behind the same NAT have independent quotas',async()=>{
 for(let i=0;i<20;i++)assert.equal(await submit(tokens[1],'203.0.113.2',{}),400)
 assert.equal(await submit(tokens[1],'203.0.113.2',{}),429)
 assert.equal(await submit(tokens[2],'203.0.113.2'),200)
})
test('PS02 HTTP: unknown tokens with invalid payload still spend the origin miss budget',async()=>{
 const before=JSON.parse(await readFile(join(directory,'valor360-store.json'),'utf8'))
 for(let i=0;i<60;i++)assert.equal(await submit(`synthetic-unknown-${i}`,'203.0.113.3',{}),404)
 assert.equal(await submit('synthetic-unknown-61','203.0.113.3',{}),429)
 assert.deepEqual(JSON.parse(await readFile(join(directory,'valor360-store.json'),'utf8')),before,'unknown tokens never mutate storage')
 assert.equal(await submit(tokens[3],'203.0.113.3'),200,'a known invitation behind the NAT remains usable')
})
test('PS02 HTTP: oversized token is rejected before validation; legitimate token remains usable',async()=>{
 for(let i=0;i<25;i++)assert.equal(await submit('x'.repeat(65),'203.0.113.4',{}),404)
 assert.equal(await submit(tokens[4],'203.0.113.4'),200)
})
