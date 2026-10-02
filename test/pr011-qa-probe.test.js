import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {canUsePr011Probe,K5_STAGING,K5_ACCOUNTS} from '../server/k5-staging-fixtures.js'
import {pr011Visible,runPr011Probe} from '../src/lib/pr011-probe.js'
const hostname='val-web-staging-production.up.railway.app'
const user=(email=K5_ACCOUNTS[0])=>({id:'synthetic-actor',email,role:'consultant',status:'active',pr011Qa:true})
const json=(status,payload)=>({status,json:async()=>payload})
const session=email=>json(200,{authenticated:true,user:user(email)})

test('QA is absent outside exact staging and active canonical consultant sessions',()=>{
 assert.equal(canUsePr011Probe(user(),K5_STAGING),true)
 for(const key of Object.keys(K5_STAGING))assert.equal(canUsePr011Probe(user(),{...K5_STAGING,[key]:'production'}),false)
 for(const patch of [{email:'other@example.test'},{role:'admin'},{status:'inactive'},{id:null},{mustChangePassword:true},{demo:true}])assert.equal(canUsePr011Probe({...user(),...patch},K5_STAGING),false)
 assert.equal(canUsePr011Probe(null,K5_STAGING),false)
 assert.equal(pr011Visible(user(),hostname),true)
 for(const host of ['localhost','cvalor360.up.railway.app','production.example.test'])assert.equal(pr011Visible(user(),host),false)
 assert.equal(pr011Visible({...user(),pr011Qa:false},hostname),false)
 assert.equal(pr011Visible(user('other@example.test'),hostname),false)
})
test('A probe sends only fixed same-origin requests and reports actual own 200 and foreign 404',async()=>{
 const calls=[]
 const fetchImpl=async(path,options)=>{
  calls.push({path,options});assert.equal(options.credentials,'same-origin');assert.equal(options.headers,undefined);assert.equal(options.body,undefined);assert.ok(!path.includes('?'))
  if(path==='/api/auth/session')return session(K5_ACCOUNTS[0])
  return path.includes('portfolio-b')?json(404,{error:'Cliente não encontrado na base autorizada.'}):json(200,{client:{id:'k5-uat-producer-a',name:'PRIVATE OWN'},opportunities:[]})
 }
 const r=await runPr011Probe({fetchImpl,hostname,expectedEmail:K5_ACCOUNTS[0],ownerId:'injected',tenant:'injected',user:'injected'})
 assert.deepEqual(r.results.map(x=>[x.httpStatus,x.result]),[[200,'PASS'],[404,'BLOCKED']]);assert.equal(r.results[1].dataLeak,0)
 assert.equal(calls.length,3);assert.doesNotMatch(JSON.stringify(r),/PRIVATE OWN|injected/)
})
test('B probe uses same exclusive identifier and does not substitute A',async()=>{
 const paths=[]
 const r=await runPr011Probe({hostname,expectedEmail:K5_ACCOUNTS[1],fetchImpl:async path=>{paths.push(path);return path==='/api/auth/session'?session(K5_ACCOUNTS[1]):json(200,{client:{id:'k5-uat-portfolio-b-exclusive'}})}})
 assert.deepEqual(paths,['/api/auth/session','/api/clients/k5-uat-portfolio-b-exclusive/conversion-studio']);assert.equal(r.results[0].result,'PASS')
})
test('foreign content or unexpected status never becomes PASS or leaks through report',async()=>{
 for(const response of [json(200,{client:{id:'foreign',name:'PRIVATE B'}}),json(404,{error:'Cliente não encontrado na base autorizada.',memories:['PRIVATE B']}),json(404,{error:'PRIVATE B'}),json(403,{error:'unauthorized'})]){
  const r=await runPr011Probe({hostname,expectedEmail:K5_ACCOUNTS[0],fetchImpl:async path=>path==='/api/auth/session'?session(K5_ACCOUNTS[0]):path.includes('portfolio-b')?response:json(200,{client:{id:'own'}})})
  assert.equal(r.results[1].result,'FAIL');assert.equal(r.results[1].dataLeak,'NOT_EXCLUDED');assert.doesNotMatch(JSON.stringify(r),/PRIVATE B/)
 }
})
test('transport failures and session changes are not HTTP isolation evidence',async()=>{
 await assert.rejects(runPr011Probe({hostname,expectedEmail:K5_ACCOUNTS[0],fetchImpl:async()=>{throw new Error('ERR_BLOCKED_BY_CLIENT')}}))
 let calls=0
 await assert.rejects(runPr011Probe({hostname,expectedEmail:K5_ACCOUNTS[0],fetchImpl:async()=>{calls++;return session(K5_ACCOUNTS[1])}}));assert.equal(calls,1)
})
test('existing HTTP route derives identity only from session, never query identity overrides',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8')
 const route=server.slice(server.indexOf("if(studioMatch&&request.method==='GET')"),server.indexOf('const contextMatch='))
 assert.match(route,/tenantId:identity\?\.tenantId/);assert.match(route,/ownerId:identity\?\.id\|\|identity\?\.email/)
 assert.doesNotMatch(route,/searchParams|body\(request\)|payload/)
 assert.match(server,/pr011Qa:true/)
})
