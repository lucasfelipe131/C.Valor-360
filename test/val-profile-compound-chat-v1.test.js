import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {buildDemoProducerFixture} from '../server/demo-producer.js'
import {classifyStructuredClientFact,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {behavioralProfileViewModel} from '../src/lib/full-screen-conversation.js'

const message='Qual é o perfil comportamental do Rafael e como devo abordar a conversa?'
const tenantId='00000000-0000-4000-8000-000000000001'
const syntheticOwner='00000000-0000-4000-8000-000000000102'
const ownerId='demo@valor360.local'

test('perfil e abordagem completos compartilham o contrato PROFILE sem capturar pedidos mistos',()=>{
  for(const question of [message,'Qual o perfil dele e como devo abordar ele?','Qual é o perfil comportamental da Ana e como conversar com ela?','Qual o perfil comportamental do Rafael?']){
    const route=routeSystemCapability({message:question,hasClient:true})
    assert.equal(route.path,'FAST',question)
    assert.equal(route.data_path,'BEHAVIORAL_PROFILE',question)
  }
  for(const question of [
    'Qual o perfil do Rafael e como negociar a proposta?',
    'Qual o perfil do Rafael e como devo abordar a conversa sobre crédito?',
    'Qual o perfil do Rafael e como devo abordar a conversa sobre soja?',
    'Qual o perfil do Rafael e como devo abordar a conversa sobre solo?',
    'Qual o perfil do Rafael e como devo abordar a conversa na próxima visita?',
    'Qual o perfil do Rafael e como devo abordar a conversa considerando a última compra?',
    'Qual o perfil do Rafael e como devo abordar a conversa e registre isso?',
    'Qual o perfil do Rafael e João e como devo abordar a conversa?',
    'Qual o perfil comercial do Rafael e como devo abordar a conversa?',
    'Qual o perfil financeiro do Rafael e como devo abordar a conversa?',
    'Cruze perfil e histórico e como devo abordar a conversa?',
  ])assert.notEqual(classifyStructuredClientFact(question),'BEHAVIORAL_PROFILE',question)
  assert.notEqual(routeSystemCapability({message,hasClient:true,attachmentTypes:['image/jpeg']}).data_path,'BEHAVIORAL_PROFILE')
  assert.notEqual(routeSystemCapability({message,hasClient:false}).data_path,'BEHAVIORAL_PROFILE')
})

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

test('HTTP real com composição completa responde perfil e abordagem do Rafael com evidência auditável',async()=>{
  const fixture=buildDemoProducerFixture({tenantId,ownerId:syntheticOwner})
  const profile=fixture.rows.find(item=>item.table==='client_profiles').row
  // Local HTTP demo authentication uses this email identity; adapt only fixture
  // ownership to that test identity, retaining the real questionnaire and source links.
  const client={...JSON.parse(profile.profile_snapshot),id:fixture.externalKey,tenantId,ownerId,
    profileAnswers:JSON.parse(profile.answers),profileSourceRef:`client_profile:${profile.id}`,
    profileUpdatedAt:profile.assessed_at,profileValidUntil:profile.valid_until,
    profileEvidence:JSON.parse(profile.evidence).map(item=>({...item,context_owner_id:ownerId}))}
  const emptyClient={id:'profile-empty',name:'Produtor Sem Evidência',tenantId,ownerId}
  const store={surveys:[],imports:[{id:'synthetic-profile-chat',tenantId,ownerId,clients:[client,emptyClient]}],visits:[],opportunities:[],val:{}}
  const dataRoot=await mkdtemp(join(tmpdir(),'val-profile-compound-http-'))
  await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
  const port=await availablePort()
  const child=spawn(process.execPath,['server/start.js'],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),
    env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
    stdio:['ignore','pipe','pipe'],
  })
  // Drain logs so a complete runtime can never block on a full pipe.
  child.stderr.on('data',()=>{})
  const turn=async(question,selected)=>{
    const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,clientId:selected.id,client:{id:selected.id,name:selected.name},conversationId:`compound-${selected.id}`,mode:'daily'})})
    const payload=await response.json()
    assert.equal(response.status,200,JSON.stringify(payload))
    return payload
  }
  try{
    await ready(child)
    const result=await turn(message,client)
    const reasoning=result.advice.ai_reasoning
    assert.equal(result.responseMetadata.performance.path,'FAST')
    assert.equal(result.responseMetadata.dataPath,'BEHAVIORAL_PROFILE')
    assert.equal(reasoning.run.model_call_count,0)
    assert.equal(reasoning.grounding.passed,true)
    assert.notEqual(reasoning.confidence.level,'INSUFICIENTE')
    assert.ok(reasoning.facts_used.length>=2)
    assert.ok(reasoning.facts_used.flatMap(item=>item.evidence_claims||[]).length>=3)
    assert.ok(reasoning.facts_used.every(item=>item.producer_id===fixture.externalKey&&item.tenant_id===tenantId&&item.owner_id===ownerId))
    assert.ok(reasoning.facts_used.some(item=>item.source_type==='producer_questionnaire'))
    assert.doesNotMatch(result.advice.answer,/fertilizantes|contrato de grãos|limite de crédito|dose/i)
    const view=behavioralProfileViewModel({reasoning,answer:result.advice.answer,facts:reasoning.facts_used})
    assert.match(view.primary,/Analítico/)
    assert.match(view.confidence,/alta/)
    assert.match(view.why,/declaração|registro|observou-se/i)
    assert.match(view.approach,/premissas|compar|evidência|dados/i)
    assert.ok(view.evidence.length>0)
    const missing=await turn('Qual o perfil dele e como devo abordar ele?',emptyClient)
    assert.equal(missing.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
    assert.deepEqual(missing.advice.ai_reasoning.facts_used,[])
  }finally{
    if(child.exitCode===null){
      child.kill('SIGTERM')
      await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
    }
    await rm(dataRoot,{recursive:true,force:true})
  }
})
