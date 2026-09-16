import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {contextCollectionPolicy,expandedValContextDomains,matchedValContextDomains,valContextDomains} from '../server/decision-copilot/context-selector.js'
import {assertContextSnapshot,buildContextSnapshot} from '../server/memory/context-snapshot.js'

// CONV-01. Uma pergunta mista classifica o fio como MULTI_DOMAIN, e o fio preserva esse rotulo
// enquanto o assunto nao muda. O acompanhamento seguinte ("qual o municipio dele?") nao casa
// dominio nenhum, e MULTI_DOMAIN expandia na lista casada da pergunta ATUAL: lista vazia. O
// contrato do ContextSnapshot exige requested_domains nao vazio, entao o snapshot que o proprio
// servidor montava era recusado pelo proprio validador. Medido: o fio morria a cada turno (503
// "o contexto do cliente nao pode ser lido no banco configurado" com Postgres, 400 "ContextSnapshot
// v1 invalido" em modo demo) ate alguem por acaso escrever uma palavra de dominio; a mesma pergunta
// em fio novo, mesmo banco, mesmo instante, respondia normalmente.
const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const actor='00000000-0000-4000-8000-000000000111'
const now=new Date('2026-08-20T12:00:00.000Z')
const followUp='Qual o municipio dele?'
const mixedQuestion='Qual o custo por hectare da adubacao de cobertura do milho?'

test('CONV-01 — MULTI_DOMAIN herdado sem casamento expande na largura do fio, nunca em lista vazia',()=>{
 assert.deepEqual(matchedValContextDomains(followUp),[],'a premissa do achado: o acompanhamento nao casa dominio')
 const expanded=expandedValContextDomains('MULTI_DOMAIN',followUp)
 assert.ok(expanded.length>0,'requested_domains nao pode sair vazio')
 for(const domain of expanded){
  assert.ok(valContextDomains.includes(domain),`dominio fora do contrato: ${domain}`)
  assert.notEqual(domain,'MULTI_DOMAIN','MULTI_DOMAIN nao pode aparecer dentro da propria expansao')
 }
 // Quando a pergunta casa dominios, o piso nao interfere: vale o que ela pediu.
 assert.deepEqual(expandedValContextDomains('MULTI_DOMAIN',mixedQuestion),matchedValContextDomains(mixedQuestion))
 assert.deepEqual(expandedValContextDomains('VISIT',followUp),['VISIT'])
 assert.deepEqual(expandedValContextDomains('GENERAL',followUp),['GENERAL'])
})

test('CONV-01 — a politica de coleta do fio herdado deixa de zerar todas as colecoes',()=>{
 const policy=contextCollectionPolicy('MULTI_DOMAIN',followUp)
 assert.deepEqual(policy,{commercial:true,agronomic:true,relationship:true,behavioral:true})
})

test('CONV-01 — o snapshot do acompanhamento passa no proprio contrato',()=>{
 const context={client:{id:'client-1',name:'Produtor Teste'},profile:{evidence:[],assessedAt:null,validUntil:null},businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],memories:[],memoryHistory:[]}
 const snapshot=buildContextSnapshot(context,{organizationId:tenantId,subjectType:'client',subjectId:'client-1',actorId:actor,role:'consultant',scope:'own_portfolio',objective:'general_assistance',requestId:'00000000-0000-4000-8000-000000000401',message:followUp,contextDomain:'MULTI_DOMAIN',conversationId:'fio-1',contextEpoch:0,now})
 assert.equal(snapshot.context_scope.domain,'MULTI_DOMAIN','o rotulo do fio e preservado: troca-lo subiria a epoca e apagaria turnos, fatos e tese')
 assert.ok(snapshot.context_scope.requested_domains.length>0)
 assert.doesNotThrow(()=>assertContextSnapshot(snapshot))
})

async function availablePort(){
 const server=createServer()
 await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res)})
 const port=server.address().port
 await new Promise(res=>server.close(res))
 return port
}

function waitForStartup(child,timeoutMs=45_000){
 return new Promise((res,rej)=>{
  let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(rej,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta'))finish(res)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>finish(rej,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}

test('CONV-01 HTTP — o fio sobrevive ao acompanhamento depois de uma pergunta mista',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-conv01-'))
 const port=await availablePort()
 const scoped=value=>({tenantId,ownerId,...value})
 const store={surveys:[],imports:[scoped({id:'imp-conv01',clients:[scoped({id:'produtor-conv01',name:'Antônio Carlos',area:428.5,cultures:'Soja, Milho'})]})],visits:[],businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 const turn=async(message,conversationId)=>{
  const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId:'produtor-conv01',client:{id:'produtor-conv01',name:'Antônio Carlos'},conversationId,mode:'daily'})})
  return {status:response.status,payload:await response.json()}
 }
 try{
  await waitForStartup(child)
  const mixed=await turn(mixedQuestion,'fio-conv01')
  assert.equal(mixed.status,200,JSON.stringify(mixed.payload))
  assert.equal(mixed.payload.advice.ai_reasoning.premises.context_scope.domain,'MULTI_DOMAIN')

  // O turno que morria. Repetir era o que a tela mandava fazer, e falhava identico.
  for(const attempt of [1,2]){
   const follow=await turn(followUp,'fio-conv01')
   assert.equal(follow.status,200,`tentativa ${attempt}: ${JSON.stringify(follow.payload)}`)
   assert.equal(follow.payload.code,undefined)
   assert.ok(String(follow.payload.advice.answer||'').trim(),'o acompanhamento precisa responder, nao apenas nao falhar')
  }

  // Nomear o dominio deixa de ser a unica saida do fio, e continua funcionando.
  const named=await turn('Quais os compromissos dele?','fio-conv01')
  assert.equal(named.status,200,JSON.stringify(named.payload))
  assert.equal(named.payload.advice.ai_reasoning.premises.context_scope.domain,'VISIT')
 }finally{
  if(child.exitCode===null){
   child.kill('SIGTERM')
   await new Promise(res=>{const timer=setTimeout(()=>{child.kill('SIGKILL');res()},3_000);child.once('exit',()=>{clearTimeout(timer);res()})})
  }
  await rm(dataRoot,{recursive:true,force:true})
 }
})
