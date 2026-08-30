import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const now='2026-08-29T15:00:00.000Z'

async function availablePort(){
 const server=createServer()
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const port=server.address().port
 await new Promise(resolve=>server.close(resolve))
 return port
}

function waitForStartup(child,timeoutMs=15_000){
 return new Promise((resolve,reject)=>{
  let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(reject,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta'))finish(resolve)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>finish(reject,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}

async function stop(child){
 if(child.exitCode!==null)return
 child.kill('SIGTERM')
 await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
}

const scoped=value=>({tenantId,ownerId,...value})

test('HTTP A-G e fast follow-up encerram antes do contexto completo e do modelo',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-routing-http-'))
 const port=await availablePort()
 const store={
  surveys:[],
  imports:[scoped({id:'import-a',clients:[
   scoped({id:'antonio',name:'Antônio Carlos',area:428.5,cultures:'Soja, Milho'}),
   scoped({id:'carlos',name:'Carlos Oliveira',area:310,cultures:'Milho'}),
   scoped({id:'sem-dados',name:'Produtor Sem Dados'}),
   scoped({id:'joao-a',name:'João Pereira'}),
   scoped({id:'joao-b',name:'João Souza'}),
  ]})],
  visits:[
   scoped({id:'visit-antonio',clientId:'antonio',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z',summary:'Nutrição e preço.'}),
   scoped({id:'visit-carlos',clientId:'carlos',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-25T12:00:00.000Z',summary:'Milho.'}),
  ],
  businessEvents:[
   scoped({id:'purchase-antonio',clientId:'antonio',outcome:'won',occurredAt:'2026-08-20T12:00:00.000Z',value:185000,currency:'BRL',product:'Fertilizante X'}),
   scoped({id:'purchase-carlos',clientId:'carlos',outcome:'won',occurredAt:'2026-08-21T12:00:00.000Z',value:92000,currency:'BRL',product:'Semente Y'}),
  ],
  val:{
   commitments:[scoped({commitment_id:'commitment-antonio',client_id:'antonio',description:'Enviar proposta.',status:'OPEN',updated_at:'2026-08-25T12:00:00.000Z'})],
   visitReports:[
    scoped({visit_report_id:'report-antonio',client_id:'antonio',confirmation_status:'CONFIRMED',confirmed_at:'2026-08-24T13:00:00.000Z',objections:[{statement:'Preço acima do orçamento.'}]}),
    scoped({visit_report_id:'report-carlos',client_id:'carlos',confirmation_status:'CONFIRMED',confirmed_at:'2026-08-25T13:00:00.000Z',objections:[{statement:'Prazo de entrega.'}]}),
   ],
  },
 }
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe'],
 })
 const base=`http://127.0.0.1:${port}`
 const conversationId='thread-routing-http-a'
 const turn=async(message,clientId,thread=conversationId,payloadOverrides={})=>{
  const started=performance.now()
  const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:clientId?store.imports[0].clients.find(item=>item.id===clientId):undefined,conversationId:thread,mode:'daily',...payloadOverrides})})
  const payload=await response.json()
  return {status:response.status,payload,wallMs:performance.now()-started}
 }
 const assertFast=result=>{
  assert.equal(result.status,200,JSON.stringify(result.payload))
  assert.equal(result.payload.responseMetadata.performance.path,'FAST')
  assert.equal(result.payload.advice.ai_reasoning.run.model_call_count,0)
  assert.equal(result.payload.responseMetadata.performance.latency.MODEL,null)
  assert.ok(result.wallMs<5_000,`FAST path excedeu limite de incidente: ${result.wallMs} ms`)
 }
 try{
  await waitForStartup(child)
  const openAntonio=await turn('Abra Antônio Carlos.','antonio')
  assertFast(openAntonio)
  assert.equal(openAntonio.payload.workspaceAction.type,'OPEN_CLIENT')
  assert.equal(openAntonio.payload.conversationState.current_client.id,'antonio')
  assert.equal(openAntonio.payload.responseMetadata.executionBudget.entityResolutions,1)

  const lastVisit=await turn('Qual foi a última visita dele?','')
  assertFast(lastVisit)
  assert.equal(lastVisit.payload.responseMetadata.dataPath,'LATEST_VISIT')
  assert.match(lastVisit.payload.advice.answer,/visit.*24\/08\/2026/i)
  assert.notEqual(lastVisit.payload.responseMetadata.performance.latency.DATABASE,null)
  assert.equal(lastVisit.payload.responseMetadata.performance.latency.CONTEXT,null)
  assert.equal(lastVisit.payload.responseMetadata.executionBudget.entityResolutions,0)
  assert.equal(lastVisit.payload.responseMetadata.executionBudget.dataLookups,1)
  assert.equal(lastVisit.payload.responseMetadata.executionBudget.hops,1)

  const naturalLastVisit=await turn('Mostre a visita mais recente dele.','')
  assertFast(naturalLastVisit)
  assert.equal(naturalLastVisit.payload.responseMetadata.dataPath,'LATEST_VISIT')
  assert.equal(naturalLastVisit.payload.workspaceAction??null,null)
  assert.match(naturalLastVisit.payload.advice.answer,/visit.*24\/08\/2026/i)

  const objection=await turn('Qual foi a principal objeção?','')
  assertFast(objection)
  assert.equal(objection.payload.responseMetadata.dataPath,'LATEST_CONFIRMED_OBJECTION')
  assert.match(objection.payload.advice.answer,/Preço acima do orçamento/)

  const purchase=await turn('Quanto foi a última compra?','')
  assertFast(purchase)
  assert.equal(purchase.payload.responseMetadata.dataPath,'LATEST_PURCHASE')
  assert.match(purchase.payload.advice.answer,/185\.000,00/)

  const openCarlos=await turn('Agora abre Carlos.','')
  assertFast(openCarlos)
  assert.equal(openCarlos.payload.workspaceAction.client_id,'carlos')
  assert.equal(openCarlos.payload.conversationState.current_client.id,'carlos')

  const carlosVisit=await turn('E a última visita dele?','')
  assertFast(carlosVisit)
  assert.match(carlosVisit.payload.advice.answer,/Carlos Oliveira/)
  assert.match(carlosVisit.payload.advice.answer,/25\/08\/2026/)
  assert.doesNotMatch(carlosVisit.payload.advice.answer,/Antônio|24\/08\/2026/)

  const antonioCropsOverride=await turn('Quais culturas do Antônio estão cadastradas?','')
  assertFast(antonioCropsOverride)
  assert.equal(antonioCropsOverride.payload.responseMetadata.dataPath,'REGISTERED_CROPS')
  assert.match(antonioCropsOverride.payload.advice.answer,/Antônio Carlos/)
  assert.match(antonioCropsOverride.payload.advice.answer,/Soja.*Milho|Milho.*Soja/)
  assert.equal(antonioCropsOverride.payload.conversationState.current_client.id,'carlos')
  assert.equal(antonioCropsOverride.payload.conversationResolution.request_override,true)
  assert.equal(antonioCropsOverride.payload.responseMetadata.executionBudget.entityResolutions,1)
  assert.equal(antonioCropsOverride.payload.responseMetadata.executionBudget.dataLookups,1)
  assert.equal(antonioCropsOverride.payload.responseMetadata.executionBudget.hops,2)

  const contextualOverride=await turn('Mostre a principal objeção do Antônio e como devo responder.','')
  assert.equal(contextualOverride.status,200,JSON.stringify(contextualOverride.payload))
  assert.equal(contextualOverride.payload.conversationResolution.request_override,true)
  assert.equal(contextualOverride.payload.conversationState.current_client.id,'carlos')
  assert.equal(contextualOverride.payload.advice.ai_reasoning.client.id,'antonio')
  assert.equal(contextualOverride.payload.advice.ai_reasoning.premises.session_context.current_client.id,'antonio')
  assert.deepEqual(contextualOverride.payload.advice.ai_reasoning.premises.session_context.session_facts.filter(item=>item.subject_client_id==='carlos'),[])
  const currentAfterContextualOverride=await turn('Quem é o produtor atual?','')
  assertFast(currentAfterContextualOverride)
  assert.match(currentAfterContextualOverride.payload.advice.answer,/Carlos Oliveira/)
  assert.equal(currentAfterContextualOverride.payload.conversationState.current_client.id,'carlos')

  const afterOverrideSummary=await turn('Resume.','')
  assertFast(afterOverrideSummary)
  assert.match(afterOverrideSummary.payload.advice.answer,/Carlos Oliveira|25\/08\/2026|Milho/i)
  assert.doesNotMatch(afterOverrideSummary.payload.advice.answer,/Antônio|Preço acima do orçamento/)
  assert.equal(afterOverrideSummary.payload.conversationState.current_client.id,'carlos')

  await turn('Abra Antônio Carlos.','antonio','thread-summary-http')
  await turn('Qual foi a principal objeção?','','thread-summary-http')
  const summary=await turn('Resume sua resposta anterior em uma linha, mantendo Antônio como produtor atual e sem executar nova busca.','','thread-summary-http')
  assertFast(summary)
  assert.match(summary.payload.advice.answer,/Preço acima do orçamento/)
  assert.equal(summary.payload.responseMetadata.performance.latency.DATABASE,null)
  assert.equal(summary.payload.responseMetadata.performance.latency.CONTEXT,null)

  const ambiguousSummary=await turn('Resume sua resposta anterior em uma linha, mantendo João como produtor atual e sem executar nova busca.','','thread-summary-http')
  assert.equal(ambiguousSummary.status,409)
  assert.equal(ambiguousSummary.payload.code,'val_client_reference_ambiguous')
  assert.deepEqual(ambiguousSummary.payload.clarification.options.map(item=>item.id),['joao-a','joao-b'])

  const comparison=await turn('Compare os dois.','antonio')
  assertFast(comparison)
  assert.equal(comparison.payload.responseMetadata.dataPath,'CLIENT_COMPARISON')
  assert.deepEqual(comparison.payload.responseMetadata.comparedClients.map(item=>item.id),['carlos','antonio'])
  assert.equal(comparison.payload.conversationState.current_client.id,'carlos')
  assert.match(comparison.payload.advice.answer,/Antônio Carlos/)
  assert.match(comparison.payload.advice.answer,/Carlos Oliveira/)
  assert.equal(comparison.payload.responseMetadata.executionBudget.dataLookups,2)
  assert.equal(comparison.payload.responseMetadata.executionBudget.entityResolutions,1)
  assert.equal(comparison.payload.responseMetadata.executionBudget.hops,2)
  assert.equal(comparison.payload.responseMetadata.executionBudget.modelCalls,0)

  const comparisonSummary=await turn('Resume.','')
  assertFast(comparisonSummary)
  assert.match(comparisonSummary.payload.advice.answer,/Antônio Carlos/)
  assert.match(comparisonSummary.payload.advice.answer,/Carlos Oliveira/)

  const factWithActiveContext=await turn('Qual foi a última visita dele?','antonio','thread-fact-active-context',{
   context:{type:'opportunity',id:'stale-opportunity',label:'Objeto que não deve carregar o dossiê'},
  })
  assertFast(factWithActiveContext)
  assert.equal(factWithActiveContext.payload.responseMetadata.dataPath,'LATEST_VISIT')
  assert.equal(factWithActiveContext.payload.responseMetadata.performance.latency.CONTEXT,null)
  assert.equal(factWithActiveContext.payload.conversationState.current_opportunity??null,null)

  const calculation=await turn('Calcule custo/ha: custo total R$ 15.000 em 100 ha.','antonio','thread-canonical-calculator')
  assert.equal(calculation.status,200,JSON.stringify(calculation.payload))
  assert.equal(calculation.payload.responseMetadata.performance.path,'TOOL')
  assert.equal(calculation.payload.responseMetadata.performance.latency.MODEL,null)
  assert.equal(calculation.payload.responseMetadata.performance.latency.CONTEXT,null)
  assert.equal(calculation.payload.responseMetadata.executionBudget.modelCalls,0)
  assert.equal(calculation.payload.responseMetadata.executionBudget.entityResolutions,0)
  assert.equal(calculation.payload.responseMetadata.executionBudget.dataLookups,0)
  assert.equal(calculation.payload.advice.ai_reasoning.run.model_call_count,0)
  assert.equal(calculation.payload.advice.ai_reasoning.run.tool_result.capability,'CALCULATORS')
  assert.equal(calculation.payload.advice.ai_reasoning.run.tool_result.calculator,'cost_per_ha')
  assert.equal(calculation.payload.advice.ai_reasoning.run.tool_result.facts.cost_per_ha,150)

  const calculationWithStaleContext=await turn('Calcule custo/ha: custo total R$ 15.000 em 100 ha.','antonio','thread-canonical-calculator-stale-context',{
   context:{type:'opportunity',id:'stale-opportunity',label:'Oportunidade antiga que não participa do cálculo'},
  })
  assert.equal(calculationWithStaleContext.status,200,JSON.stringify(calculationWithStaleContext.payload))
  assert.equal(calculationWithStaleContext.payload.responseMetadata.performance.path,'TOOL')
  assert.equal(calculationWithStaleContext.payload.responseMetadata.performance.latency.CONTEXT,null)
  assert.deepEqual(calculationWithStaleContext.payload.advice.ai_reasoning.run.capabilities_planned,['CALCULATORS'])
  assert.equal(calculationWithStaleContext.payload.advice.ai_reasoning.run.tool_result.facts.cost_per_ha,150)

  const generalThread='thread-general-follow-up-http'
  const generalBase=await turn('Explique em uma frase como preparar uma reunião comercial.','',generalThread)
  assert.equal(generalBase.status,200,JSON.stringify(generalBase.payload))
  const generalFollowUp=await turn('Explica melhor.','',generalThread)
  assertFast(generalFollowUp)
  assert.equal(generalFollowUp.payload.responseMetadata.executionBudget.entityResolutions,0)
  assert.equal(generalFollowUp.payload.advice.ai_reasoning.run.tool_result.status,'EXECUTED')
  assert.equal(generalFollowUp.payload.advice.ai_reasoning.run.tool_result.context.reused_previous_response,true)

  const followUpThread='thread-deterministic-follow-up-http'
  await turn('Abra Antônio Carlos.','antonio',followUpThread)
  const numericBase=await turn('Quanto foi a última compra?','',followUpThread)
  assertFast(numericBase)
  for(const message of ['Por quê?','Mostra os números.']){
   const followUp=await turn(message,'',followUpThread)
   assertFast(followUp)
   assert.equal(followUp.payload.responseMetadata.performance.latency.CONTEXT,null,message)
   assert.equal(followUp.payload.responseMetadata.performance.latency.MODEL,null,message)
   assert.equal(followUp.payload.responseMetadata.executionBudget.modelCalls,0,message)
   assert.equal(followUp.payload.responseMetadata.executionBudget.entityResolutions,0,message)
   assert.equal(followUp.payload.advice.ai_reasoning.run.model_call_count,0,message)
   assert.equal(followUp.payload.advice.ai_reasoning.run.tool_result.capability,'SESSION_COMMAND',message)
   assert.equal(followUp.payload.advice.ai_reasoning.run.tool_result.context.deterministic_follow_up,true,message)
   assert.equal(followUp.payload.advice.ai_reasoning.run.tool_result.context.full_context_required,false,message)
  }

  const unclear=await turn('Compare os dois.','antonio','thread-without-previous-client')
  assert.equal(unclear.status,422)
  assert.equal(unclear.payload.code,'val_comparison_pair_required')

  const noData=await turn('Qual foi a última visita dele?','sem-dados','thread-no-data')
  assertFast(noData)
  assert.match(noData.payload.advice.answer,/ainda não há visita concluída registrada/i)
  assert.equal(noData.payload.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')

  const mismatchedSummary=await turn('Resume sua resposta anterior em uma linha, mantendo Carlos Oliveira como produtor atual e sem executar nova busca.','','thread-summary-http')
  assert.equal(mismatchedSummary.status,409)
  assert.equal(mismatchedSummary.payload.code,'val_session_command_client_mismatch')

  const expired=await turn('Qual foi a última visita dele?','', 'thread-without-active-client')
  assert.equal(expired.status,422)
  assert.equal(expired.payload.code,'val_client_reference_context_required')
 }finally{
  await stop(child)
  await rm(dataRoot,{recursive:true,force:true})
 }
})
