import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {routeSessionCommand} from '../server/decision-copilot/session-command-router.js'
import {resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const antonio={id:'client-antonio',name:'Antônio Silva'}

test('pergunta sobre dado nunca vira navegação, mesmo com verbo de abrir ou de busca',()=>{
 for(const message of ['mostra o perfil dele','mostra o perfil do produtor','busca a cotação da soja hoje','procura o preço do milho','vai chover na fazenda dele essa semana?','quantos talhões ele vai plantar de milho?','vai ter geada na propriedade dele?','qual a bula do produto X?']){
  const route=routeGlobalIntent({message,client:antonio})
  assert.equal(route.direct,false,message)
  assert.equal(route.workspace_action,null,message)
 }
 for(const [message,type,page] of [['abre a agenda','NAVIGATE','visits'],['vai para oportunidades','NAVIGATE','opportunities'],['mostra os talhões cadastrados','NAVIGATE','agro'],['Abra o produtor Antônio.','OPEN_CLIENT','client360'],['busca o Antônio','OPEN_CLIENT','client360']]){
  const route=routeGlobalIntent({message,client:antonio})
  assert.equal(route.direct,true,message)
  assert.equal(route.workspace_action?.type,type,message)
  assert.equal(route.workspace_action?.page,page,message)
 }
})

test('variações naturais de follow-up são o mesmo comando no servidor e no navegador',()=>{
 const expected=[
  ['resume pra mim','SUMMARIZE','SUMMARIZE'],['faz um resumo disso','SUMMARIZE','SUMMARIZE'],['me faz um resumo','SUMMARIZE','SUMMARIZE'],['resume isso aí','SUMMARIZE','SUMMARIZE'],
  ['me manda escrito','OUTPUT_TEXT','OUTPUT_TEXT'],['manda por escrito','OUTPUT_TEXT','OUTPUT_TEXT'],['me manda isso por escrito','OUTPUT_TEXT','OUTPUT_TEXT'],['por escrito','OUTPUT_TEXT','OUTPUT_TEXT'],
  ['aprofunda isso','DEEPEN','DEEPEN'],['explica melhor isso','EXPLAIN','EXPLAIN'],['me explica melhor','EXPLAIN','EXPLAIN'],['repete isso pra mim','REPEAT','REPEAT']
 ]
 for(const [message,server,browser] of expected){
  assert.equal(routeSessionCommand(message)?.command,server,`servidor: ${message}`)
  assert.equal(resolveValNaturalCommand(message)?.action,browser,`navegador: ${message}`)
 }
 for(const message of ['qual o perfil dele?','resume a conta dele','me explica o que é WASDE','explica a diferença entre basis e hedge']){
  assert.equal(routeSessionCommand(message),null,message)
  assert.equal(resolveValNaturalCommand(message),null,message)
 }
})

async function availablePort(){
 const server=createServer()
 await new Promise((resolvePort,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolvePort)})
 const port=server.address().port
 await new Promise(resolvePort=>server.close(resolvePort))
 return port
}
function waitForStartup(child,timeoutMs=20_000){
 return new Promise((resolveStartup,reject)=>{
  let stdout='';let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(reject,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('VALOR 360 disponível na porta'))finish(resolveStartup)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>finish(reject,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}
async function stop(child){
 if(child.exitCode!==null)return
 child.kill('SIGTERM')
 await new Promise(resolveStop=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolveStop()},3_000);child.once('exit',()=>{clearTimeout(timer);resolveStop()})})
}

test('HTTP em modo demo: navegação e comando local respondem, e follow-up natural reutiliza a última leitura',async()=>{
 const matheus=scoped({id:'matheus',name:'Matheus Nascimento Jaeger',primaryProfile:'Analítico',decisionDriver:'Compara custo por hectare e retorno antes de decidir',technicalPresentation:'Prefere dados objetivos e comparáveis',profileUpdatedAt:'2026-08-01T12:00:00.000Z',profileValidUntil:'2027-08-01T12:00:00.000Z',profileSourceRef:'profile-matheus',profileEvidence:[
  {id:'profile-matheus-q7',profile_source_ref:'profile-matheus',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decisionDriver',statement:'Compara custo por hectare e retorno antes de decidir',assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'},
  {id:'profile-matheus-q8',profile_source_ref:'profile-matheus',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'technicalPresentation',statement:'Prefere dados objetivos e comparáveis',assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'}
 ]})
 const store={surveys:[],imports:[scoped({id:'import-a',clients:[matheus]})],visits:[],businessEvents:[],val:{commitments:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const dataRoot=await mkdtemp(join(tmpdir(),'val-navigation-variants-'))
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'200',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 const turn=async(message,conversationId,clientId='matheus')=>{
  const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId:clientId||undefined,client:clientId?matheus:undefined,conversationId,mode:'daily'})})
  return {status:response.status,payload:await response.json()}
 }
 try{
  await waitForStartup(child)
  const agenda=await turn('abre a agenda','thread-nav')
  assert.equal(agenda.status,200)
  assert.equal(agenda.payload.workspaceAction?.type,'NAVIGATE')
  assert.equal(agenda.payload.workspaceAction?.page,'visits')
  assert.match(agenda.payload.advice.answer,/Abrindo Visitas/)
  const agendaNoClient=await turn('abre a agenda','thread-nav-n','')
  assert.equal(agendaNoClient.status,200)
  assert.match(agendaNoClient.payload.advice.answer,/Abrindo Visitas/)
  const profile=await turn('mostra o perfil dele','thread-profile')
  assert.equal(profile.status,200)
  assert.equal(profile.payload.workspaceAction??null,null)
  assert.match(profile.payload.advice.answer,/Perfil principal: Analítico/)
  const concept=await turn('O que é WASDE?','thread-follow','')
  assert.match(concept.payload.advice.answer,/WASDE/)
  const summary=await turn('resume pra mim','thread-follow','')
  assert.equal(summary.status,200)
  assert.match(summary.payload.advice.answer,/WASDE/)
  const written=await turn('por escrito','thread-follow','')
  assert.equal(written.status,200)
  assert.match(written.payload.advice.answer,/Preferência desta conversa alterada para texto/)
  const again=await turn('resume','thread-follow','')
  assert.match(again.payload.advice.answer,/WASDE/,'o comando local de preferência não vira a última leitura resumível')
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
