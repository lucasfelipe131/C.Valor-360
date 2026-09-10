import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const repositoryRoot=fileURLToPath(new URL('..',import.meta.url))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})

async function availablePort(){
 const server=createServer()
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const port=server.address().port
 await new Promise(resolve=>server.close(resolve))
 return port
}

function waitForStartup(child){
 return new Promise((resolve,reject)=>{
  let output='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(reject,new Error(`Servidor HTTP não iniciou: ${output}`)),15_000)
  child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('VALOR 360 disponível na porta'))finish(resolve)})
  child.stderr.on('data',chunk=>{output+=chunk})
  child.once('exit',code=>finish(reject,new Error(`Servidor HTTP encerrou (${code}): ${output}`)))
 })
}

async function stop(child){
 if(child.exitCode!==null)return
 await new Promise(resolve=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000)
  child.once('exit',()=>{clearTimeout(timer);resolve()})
  child.kill('SIGTERM')
 })
}

test('HTTP conversa mantém produtor autorizado e separa conhecimento geral',async t=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-conversation-reliability-http-'))
 const port=await availablePort()
 const clients=[
  scoped({id:'matheus',name:'Matheus Nascimento Jaeger',area:321,cultures:'Trigo'}),
  scoped({id:'antonio',name:'Antônio da Silva',area:428.5,cultures:'Soja, Milho'}),
  scoped({id:'joao-a',name:'João Pereira',area:120,cultures:'Arroz',municipality:'Cascavel',properties:[{name:'Fazenda Boa Vista'}]}),
  scoped({id:'joao-b',name:'João Souza',area:250,cultures:'Canola'}),
  scoped({id:'bruno',name:'Bruno Costa',area:610,cultures:'Soja',municipality:'Londrina',properties:[{name:'Fazenda Estrela'}]}),
  scoped({id:'private-owner',name:'Roberto Privado',ownerId:'someone-else@example.test',area:9876,cultures:'Algodão'}),
 ]
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify({
  surveys:[],imports:[scoped({id:'conversation-test-fixtures',clients})],visits:[],businessEvents:[],val:{},grains:{profiles:[],intentions:[],marketSnapshots:[]},
 }))
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'120',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe'],
 })
 const turn=async(message,conversationId,clientId='',extra={})=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,conversationId,clientId,client:clientId?clients.find(item=>item.id===clientId):undefined,intent:'ASK_CLIENT',inputModality:'voice',...extra})})
  return {status:response.status,payload:await response.json()}
 }
 const diagnostic=payload=>JSON.stringify({code:payload.code,error:payload.error,answer:payload.advice?.answer,intent:payload.advice?.ai_reasoning?.intent,scope:payload.responseScope})
 const success=result=>{assert.equal(result.status,200,diagnostic(result.payload));return result.payload}
 try{
  await waitForStartup(child)
  await t.test('nome único muda Matheus para Antônio mesmo com clientId antigo do navegador',async()=>{
   const thread='reliability-switch'
   success(await turn('Quem é o produtor atual?',thread,'matheus'))
   const named=success(await turn('Me fala do Antônio.',thread,'matheus'))
   assert.equal(named.conversationResolution?.status,'RESOLVED')
   assert.equal(named.responseScope.producerId,'antonio')
   assert.equal(named.advice.ai_reasoning.client.id,'antonio')
   assert.equal(named.conversationState.current_client.id,'antonio')
   assert.equal(named.advice.ai_reasoning.intent,'ASK_CLIENT')
   assert.equal(named.workspaceAction,undefined)
   assert.match(named.advice.answer,/Antônio da Silva/)
   assert.doesNotMatch(named.advice.answer,/Matheus|321|Trigo/)
   assert.notEqual(named.advice.ai_reasoning.client.id,'portfolio')
   const area=success(await turn('Qual a área dele?',thread))
   assert.equal(area.responseScope.producerId,'antonio')
   assert.match(area.advice.answer,/428[,.]5/)
   assert.doesNotMatch(area.advice.answer,/321|Matheus/)
  })
  await t.test('nome único resolve em conversa geral, sem exigir produtor pré-selecionado',async()=>{
   const result=success(await turn('Me fala sobre o Antônio.','reliability-new'))
   assert.equal(result.conversationResolution?.status,'RESOLVED')
   assert.equal(result.responseScope.producerId,'antonio')
   assert.equal(result.advice.ai_reasoning.intent,'ASK_CLIENT')
  })
  await t.test('homônimo pede opção autorizada e não herda Matheus nem escolhe silenciosamente',async()=>{
   const thread='reliability-ambiguous'
   success(await turn('Quem é o produtor atual?',thread,'matheus'))
   const ambiguous=await turn('Me fala do João.',thread,'matheus')
   assert.equal(ambiguous.status,409,JSON.stringify(ambiguous.payload))
   assert.equal(ambiguous.payload.code,'val_client_reference_ambiguous')
   assert.deepEqual(ambiguous.payload.clarification.options.map(item=>item.id),['joao-a','joao-b'])
   const current=success(await turn('Quem é o produtor atual?',thread))
   assert.equal(current.responseScope.producerId,'matheus')
   const selected=success(await turn('Me fala do João.',thread,'matheus',{clarificationSelection:{contractVersion:'val.client_clarification.v1',reference:ambiguous.payload.clarification.reference,clientId:'joao-b'}}))
   assert.equal(selected.responseScope.producerId,'joao-b')
   assert.equal(selected.conversationState.current_client.id,'joao-b')
   assert.doesNotMatch(selected.advice.answer,/Matheus|Arroz|120/)
  })
  await t.test('fato de outro produtor responde só o turno e mantém o produtor da conversa',async()=>{
   const thread='reliability-fact-override'
   success(await turn('Quem é o produtor atual?',thread,'matheus'))
   const other=success(await turn('Qual a área do Antônio?',thread,'matheus'))
   assert.equal(other.responseScope.producerId,'antonio')
   assert.equal(other.conversationState.current_client.id,'matheus')
   assert.equal(other.conversationResolution.request_override,true)
   assert.match(other.advice.answer,/428[,.]5/)
   const current=success(await turn('Qual a área dele?',thread))
   assert.equal(current.responseScope.producerId,'matheus')
   assert.match(current.advice.answer,/321/)
   assert.doesNotMatch(current.advice.answer,/428[,.]5|Antônio/)
  })
  await t.test('propriedade ou município contraditório não usa o produtor ativo nem outra conta',async()=>{
   const thread='reliability-conflicting-qualifier'
   success(await turn('Quem é o produtor atual?',thread,'matheus'))
   for(const message of ['Qual a área do João Pereira na Fazenda Estrela?','Qual a área do João Pereira no município Londrina?']){
    const invalid=await turn(message,thread,'matheus')
    assert.equal(invalid.status,422,diagnostic(invalid.payload))
    assert.equal(invalid.payload.code,'val_client_reference_not_found')
    assert.equal(invalid.payload.advice,undefined)
    assert.equal(invalid.payload.conversationState,undefined)
   }
   const current=success(await turn('Qual a área dele?',thread))
   assert.equal(current.responseScope.producerId,'matheus')
   assert.match(current.advice.answer,/321/)
   assert.doesNotMatch(current.advice.answer,/120|610|João|Bruno/)
  })
  await t.test('nome de outro owner e ID injetado não ampliam carteira autorizada',async()=>{
   for(const [index,message] of ['Abra o produtor Roberto Privado.','Me fala do produtor Roberto Privado.'].entries()){
    const named=await turn(message,`reliability-other-owner-${index}`,'matheus')
    assert.equal(named.status,422,diagnostic(named.payload))
    assert.equal(named.payload.code,'val_client_reference_not_found')
    assert.equal(named.payload.clarification.options,undefined)
   }
   const injected=await turn('Quem é o produtor atual?','reliability-injected','private-owner')
   assert.equal(injected.status,404,diagnostic(injected.payload))
   assert.equal(injected.payload.code,'val_client_not_authorized')
  })
  for(const clientId of ['', 'matheus'])await t.test(`conhecimento geral ${clientId?'com produtor ativo':'sem produtor'} não recebe evidências privadas`,async()=>{
   for(const [index,message] of [
    'Como o pH afeta a volatilização da ureia?',
    'Qual a diferença entre CTC efetiva e CTC potencial?',
    'Como comparar produtos pelo mecanismo de ação?',
    'Como funciona o manejo integrado da cigarrinha no milho?',
    'O que é o produto Fox Xpro?',
   ].entries()){
    const result=success(await turn(message,`reliability-general-${clientId||'none'}-${index}`,clientId))
    assert.equal(result.responseScope.producerId,clientId||null,message)
    assert.equal(result.advice.ai_reasoning.client.id,'portfolio',message)
    assert.equal(result.responseMetadata.performance.latency.CONTEXT,null,message)
    assert.doesNotMatch(result.advice.answer,/Matheus|Antônio|428[,.]5|321|selecione.*produtor|escolha.*produtor/i,message)
    assert.ok((result.advice.ai_reasoning.facts_used||[]).every(fact=>!fact.producer_id),message)
    if(index===0)assert.doesNotMatch(result.advice.answer,/pH mede.*acidez.*alcalinidade.*escala/i)
    if(index===4){
     assert.match(result.advice.answer,/Fox Xpro/i)
     assert.doesNotMatch(result.advice.answer,/\d+(?:[,.]\d+)?\s*(?:l|ml|kg|g)\s*\/\s*ha/i)
    }
   }
  })
  await t.test('dose mantém requisito de fonte oficial atual',async()=>{
   const result=await turn('Qual dose de Fox Xpro aplicar no milho?','reliability-dose')
   assert.equal(result.status,422,diagnostic(result.payload))
   assert.equal(result.payload.code,'val_current_source_unavailable')
  })
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
