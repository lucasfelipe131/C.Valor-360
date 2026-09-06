import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})

test('lexema de clima ou bula não vira pedido de dado vivo sem intenção de dado vivo',()=>{
 for(const message of ['Quanto tempo leva para a soja emergir depois do plantio?','Qual a temperatura ideal para germinação do milho?','Quanto de chuva o milho precisa no ciclo?','O que é período de carência de um defensivo?','quanto tempo faz desde a última visita dele?']){
  for(const hasClient of [false,true]){
   const route=routeValIntent({message,hasClient})
   assert.ok(!['CHECK_WEATHER','CHECK_LABEL'].includes(route.intent),`${message} [${hasClient?'com':'sem'} produtor] -> ${route.intent}`)
   assert.equal(route.requires_current_data,false,message)
  }
 }
 for(const [message,intent] of [['como está o clima em Cascavel?','CHECK_WEATHER'],['vai chover na fazenda dele essa semana?','CHECK_WEATHER'],['qual a temperatura hoje?','CHECK_WEATHER'],['qual a bula do produto X?','CHECK_LABEL'],['qual a carência do fungicida na soja?','CHECK_LABEL']]){
  assert.equal(routeValIntent({message,hasClient:true}).intent,intent,message)
 }
})

test('pergunta conceitual, cumprimento e agradecimento seguem para ASK_GENERAL mesmo com produtor selecionado',()=>{
 for(const message of ['O que é WASDE?','Qual a diferença entre nitrogênio enterrado e nitrogênio a lanço?','Como funciona o manejo de ferrugem asiática?','O que é margem de contribuição?','Qual a função do potássio na planta?','O que é CTC do solo?','explique o que é ZARC','oi','Bom dia, VAL','tudo bem?','Obrigado!','valeu','perfeito, obrigado']){
  const route=routeValIntent({message,hasClient:true})
  assert.equal(route.intent,'ASK_GENERAL',message)
  assert.equal(route.client_context_required,false,message)
  const capability=routeSystemCapability({message,hasClient:true})
  assert.equal(capability.path,'CONTEXT',message)
  assert.deepEqual(capability.capabilities,['KNOWLEDGE_LIBRARY'],message)
 }
 // Com referência individual a decisão continua sendo do produtor selecionado.
 for(const [message,intent] of [['qual o perfil dele?','ASK_CLIENT'],['Qual é a principal hipótese agronômica para as manchas no talhão?','ASK_AGRONOMIC'],['como foi a safra passada dele?','ASK_AGRONOMIC'],['Como explicar ROI para o produtor?','ASK_CLIENT']]){
  assert.equal(routeValIntent({message,intentHint:message.includes('talhão')?'ASK_AGRONOMIC':'',hasClient:true}).intent,intent,message)
 }
})

test('conceito de solo ou de indicador não é ferramenta; número ou verbo de cálculo é',()=>{
 for(const [message,intent] of [
  ['O que é CTC do solo?','ASK_GENERAL'],['Qual a função do potássio na planta?','ASK_GENERAL'],['O que é margem de contribuição?','ASK_GENERAL'],
  ['fósforo e potássio na adubação de base','ASK_AGRONOMIC'],
  ['interprete essa análise de solo','ANALYZE_SOIL'],['analise o laudo de solo do talhão 3','ANALYZE_SOIL'],
  ['Calcula a margem pra mim','CALCULATE'],['Simule o ponto de equilíbrio da lavoura','CALCULATE'],
  ['Quanto é 300 mil plantas por hectare em espaçamento de 45 cm?','CALCULATE'],
  ['Gastei 750 mil reais em 300 hectares, qual o custo por hectare?','CALCULATE'],
  ['Custo total de 900000 e área de 400 ha, quanto dá por hectare?','CALCULATE'],
  ['Qual o ROI de um investimento de 100 mil que retorna 130 mil?','CALCULATE']
 ]){
  assert.equal(routeValIntent({message,hasClient:false}).intent,intent,message)
 }
})

test('objeção e oportunidade exigem produtor concreto; sem ele a pergunta é de conhecimento',()=>{
 for(const message of ['produtor não quer mudar','resistência de fungo ao fungicida','resistência a inovação','Custo de oportunidade da terra muda o breakeven','Diagnóstico precede proposta']){
  const route=routeValIntent({message,hasClient:false})
  assert.equal(route.intent,'ASK_GENERAL',message)
  assert.equal(route.client_context_required,false,message)
 }
 assert.equal(routeValIntent({message:'produtor não quer mudar',hasClient:true}).intent,'OBJECTION_HELP')
 assert.equal(routeValIntent({message:'ele não quer fechar, o que eu digo?',hasClient:false}).intent,'OBJECTION_HELP')
 assert.equal(routeValIntent({message:'quais oportunidades abertas ele tem?',hasClient:false}).intent,'CHECK_OPPORTUNITY')
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

test('HTTP em modo demo: com produtor selecionado, cumprimento e conceito respondem e mantêm o produtor na sessão',async()=>{
 const antonio=scoped({id:'antonio',name:'Antônio Carlos',area:428.5,cultures:'Soja, Milho'})
 const store={surveys:[],imports:[scoped({id:'import-a',clients:[antonio]})],visits:[scoped({id:'visit-antonio',clientId:'antonio',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z',summary:'Nutrição e preço.'})],businessEvents:[],val:{commitments:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const dataRoot=await mkdtemp(join(tmpdir(),'val-conceptual-routing-'))
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'200',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 const turn=async(message,conversationId,clientId='antonio')=>{
  const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:antonio,conversationId,mode:'daily'})})
  return {status:response.status,payload:await response.json()}
 }
 try{
  await waitForStartup(child)
  const greeting=await turn('oi','thread-greeting')
  assert.equal(greeting.status,200)
  assert.match(greeting.payload.advice.answer,/posso ajudar/i)
  assert.doesNotMatch(greeting.payload.advice.answer,/Não há evidência/)
  const thanks=await turn('Obrigado!','thread-greeting')
  assert.equal(thanks.status,200)
  assert.match(thanks.payload.advice.answer,/Disponha/)
  const concept=await turn('O que é WASDE?','thread-concept')
  assert.equal(concept.status,200)
  assert.match(concept.payload.advice.answer,/WASDE/)
  assert.equal(concept.payload.advice.ai_reasoning.run.tool_result.context.knowledge_item_id,'KI-103')
  assert.equal(concept.payload.conversationState?.current_client?.id,'antonio','o produtor selecionado continua ativo na sessão')
  const emergence=await turn('Quanto tempo leva para a soja emergir depois do plantio?','thread-time')
  assert.equal(emergence.status,200,JSON.stringify(emergence.payload).slice(0,300))
  assert.notEqual(emergence.payload.code,'val_current_source_unavailable')
  const weather=await turn('como está o clima em Cascavel?','thread-weather')
  assert.equal(weather.status,422)
  assert.equal(weather.payload.code,'val_current_source_unavailable')
  const calc=await turn('Quanto é 300 mil plantas por hectare em espaçamento de 45 cm?','thread-calc','')
  assert.equal(calc.status,200)
  assert.match(calc.payload.advice.answer,/13,5 plantas\/m/)
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
