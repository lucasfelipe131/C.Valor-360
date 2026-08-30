import test from 'node:test'
import assert from 'node:assert/strict'
import {buildFastClientComparisonResponse,buildFastClientResponse,classifyStructuredClientFact,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {extractNaturalClientReference,resolveAuthorizedClientComparison,resolveAuthorizedClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {createConversationState,switchConversationClient} from '../server/decision-copilot/conversation-state.js'
import {latencyStages} from '../server/decision-copilot/latency-observability.js'
import {ValRepository} from '../server/repository.js'
import {resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const otherTenantId='00000000-0000-4000-8000-000000000002'
const ownerId='00000000-0000-4000-8000-000000000010'
const otherOwnerId='00000000-0000-4000-8000-000000000011'
const now=new Date('2026-08-29T15:00:00.000Z')
const antonio={id:'antonio',name:'Antônio Carlos'}
const carlos={id:'carlos',name:'Carlos Oliveira'}
const portfolio=[antonio,carlos]

const route=message=>routeSystemCapability({message,hasClient:true})

test('Fact First roteia fatos estruturados para FAST direto sem engine generativa',()=>{
 const cases=[
  ['Qual foi a última visita dele?','LATEST_VISIT','VISIT_HISTORY'],
  ['Qual a última visita?','LATEST_VISIT','VISIT_HISTORY'],
  ['Qual a visita mais recente?','LATEST_VISIT','VISIT_HISTORY'],
  ['E a última visita dele?','LATEST_VISIT','VISIT_HISTORY'],
  ['Qual foi a principal objeção?','LATEST_CONFIRMED_OBJECTION','VISIT_HISTORY'],
  ['Qual foi o último compromisso?','LATEST_COMMITMENT','COMMERCIAL_HISTORY'],
  ['Quanto foi a última compra?','LATEST_PURCHASE','COMMERCIAL_HISTORY'],
  ['Qual a última compra?','LATEST_PURCHASE','COMMERCIAL_HISTORY'],
  ['Quanto ele comprou?','LATEST_PURCHASE','COMMERCIAL_HISTORY'],
  ['Qual cultura ele está plantando?','REGISTERED_CROPS','CLIENT_CONTEXT'],
  ['Qual área dele está cadastrada?','REGISTERED_AREA','CLIENT_CONTEXT'],
  ['Mostre as culturas do Antônio','REGISTERED_CROPS','CLIENT_CONTEXT'],
  ['Mostre a safra do Antônio','REGISTERED_CROPS','CLIENT_CONTEXT'],
  ['Mostre a área do Antônio','REGISTERED_AREA','CLIENT_CONTEXT'],
 ]
 for(const [message,dataPath,capability] of cases){
  const decision=route(message)
  assert.equal(decision.path,'FAST',message)
  assert.equal(decision.direct,true,message)
  assert.equal(decision.data_path,dataPath,message)
  assert.equal(decision.materiality.engine_required,false,message)
  assert.ok(decision.capabilities.includes(capability),message)
 }
 const strategy=route('O que você acha que eu deveria fazer na próxima visita?')
 assert.equal(strategy.direct,false)
 assert.ok(['CONTEXT','DEEP'].includes(strategy.path))
})

test('Global router não confunde fato ou follow-up negado com OPEN/SEARCH',()=>{
 for(const message of ['Mostre a última visita dele.','Mostre a visita mais recente dele.','Mostre a última compra dele.','Mostre a compra mais recente dele.','Mostre a principal objeção dele.','Mostre a objeção principal dele.','Mostre as culturas do Antônio','Mostre a safra do Antônio','Mostre a área do Antônio']){
  const decision=routeGlobalIntent({message,client:antonio})
  assert.equal(decision.workspace_action,null,message)
 }
 const summary='Resume sua resposta anterior em uma linha, mantendo João como produtor atual e sem executar nova busca.'
 assert.equal(routeGlobalIntent({message:summary,client:antonio}).intent,'FOLLOW_UP')
 assert.equal(resolveValNaturalCommand(summary)?.action,'SUMMARIZE')
 const switched=routeGlobalIntent({message:'Agora abre Carlos Oliveira.',client:carlos})
 assert.equal(switched.intent,'OPEN')
 assert.equal(switched.workspace_action?.client_id,carlos.id)
 assert.equal(routeGlobalIntent({message:'Mostre Carlos Oliveira.',client:carlos}).workspace_action?.client_id,carlos.id)
})

test('sequência A-H preserva referência atual, troca explícita e par comparável',()=>{
 const opened=resolveAuthorizedClientReference({message:'Abra Antônio Carlos.',authorizedClients:portfolio})
 assert.equal(opened.client.id,antonio.id)
 assert.equal(routeGlobalIntent({message:'Abra Antônio Carlos.',client:opened.client}).workspace_action?.type,'OPEN_CLIENT')
 let state=createConversationState({conversationId:'thread-a',client:opened.client,clientId:opened.client.id,now})

 for(const message of ['Qual foi a última visita dele?','Qual foi a principal objeção?','Quanto foi a última compra?']){
  const inherited=resolveAuthorizedClientReference({message,authorizedClients:portfolio,currentClientId:state.current_client.id,recentClientIds:state.recent_clients.map(item=>item.id)})
  assert.equal(inherited.client?.id||state.current_client.id,antonio.id,message)
 }

 const next=resolveAuthorizedClientReference({message:'Agora abre Carlos.',authorizedClients:portfolio,currentClientId:state.current_client.id})
 assert.equal(next.client.id,carlos.id)
 state=switchConversationClient(state,next.client,{conversationId:'thread-a',now})
 const carlosFollowUp=resolveAuthorizedClientReference({message:'E a última visita dele?',authorizedClients:portfolio,currentClientId:state.current_client.id,recentClientIds:state.recent_clients.map(item=>item.id)})
 assert.equal(carlosFollowUp.client.id,carlos.id)

 assert.deepEqual(extractNaturalClientReference('Qual foi a objeção do Antônio?'),{kind:'FACT_OWNER',reference:'Antônio'})
 const override=resolveAuthorizedClientReference({message:'Qual foi a objeção do Antônio?',authorizedClients:portfolio,currentClientId:state.current_client.id,recentClientIds:state.recent_clients.map(item=>item.id)})
 assert.equal(override.client.id,antonio.id)
 assert.equal(resolveAuthorizedClientReference({message:'Qual é a área do Antônio?',authorizedClients:portfolio,currentClientId:state.current_client.id}).client.id,antonio.id)
 assert.deepEqual(extractNaturalClientReference('Qual área do Antônio está cadastrada?'),{kind:'FACT_OWNER',reference:'Antônio'})
 assert.equal(resolveAuthorizedClientReference({message:'Qual área do Antônio está cadastrada?',authorizedClients:portfolio,currentClientId:carlos.id}).client.id,antonio.id)
 for(const message of ['Quais culturas do Antônio tem cadastradas?','Quais culturas do Antônio têm cadastradas?','Quais culturas do Antônio estão cadastradas?']){
  assert.deepEqual(extractNaturalClientReference(message),{kind:'FACT_OWNER',reference:'Antônio'},message)
  assert.equal(resolveAuthorizedClientReference({message,authorizedClients:portfolio,currentClientId:carlos.id}).client.id,antonio.id,message)
  assert.equal(route(message).data_path,'REGISTERED_CROPS',message)
 }
 assert.equal(resolveAuthorizedClientReference({message:'Qual foi a objeção do antônlo?',authorizedClients:portfolio,currentClientId:carlos.id}).status,'NOT_FOUND')

 for(const message of ['Mostre a última visita do Antônio.','Mostre a principal objeção do Antônio.','Mostre a última compra do Antônio.']){
  assert.deepEqual(extractNaturalClientReference(message),{kind:'FACT_OWNER',reference:'Antônio'},message)
  const factualOwner=resolveAuthorizedClientReference({message,authorizedClients:portfolio,currentClientId:carlos.id})
  assert.equal(factualOwner.status,'RESOLVED',message)
  assert.equal(factualOwner.client.id,antonio.id,message)
 }
 assert.deepEqual(extractNaturalClientReference('Mostre Carlos Oliveira.'),{kind:'AUTHORIZED_NAME_CANDIDATE',reference:'Carlos Oliveira'})
 assert.equal(resolveAuthorizedClientReference({message:'Mostre Carlos Oliveira.',authorizedClients:portfolio,currentClientId:antonio.id}).client.id,carlos.id)

 const comparison=resolveAuthorizedClientComparison({message:'Compare os dois.',authorizedClients:portfolio,currentClientId:state.current_client.id,recentClientIds:state.recent_clients.map(item=>item.id)})
 assert.equal(comparison.status,'RESOLVED')
 assert.deepEqual(comparison.clients.map(item=>item.id),[carlos.id,antonio.id])
 assert.equal(resolveAuthorizedClientComparison({message:'Compare os dois.',authorizedClients:portfolio,currentClientId:carlos.id,recentClientIds:[]}).status,'CONTEXT_REQUIRED')
})

test('formatter factual é determinístico, honesto e declara orçamento zero-model',()=>{
 const facts={
  client:{id:antonio.id,name:antonio.name,totalAreaHa:428.5,areaBand:null,cultures:'Soja, Milho'},
  latestCompletedVisit:{id:'visit-1',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z',summary:'Revisão de nutrição.'},
  latestConfirmedObjection:{visit_report_id:'report-1',confirmed_at:'2026-08-24T13:00:00.000Z',objections:[{item_id:'obj-1',statement:'Preço acima do orçamento.',category:'PRICE'}]},
  latestCommitment:{commitment_id:'commitment-1',description:'Enviar proposta revisada.',status:'OPEN',due_at:'2026-09-02T12:00:00.000Z'},
  latestPurchase:{id:'purchase-1',occurred_at:'2026-08-20T12:00:00.000Z',product:'Fertilizante X',quantity:12,value:185000,currency:'BRL'},
  latestCropSeason:{season:'2026/27',crop:'Milho',area_ha:180,planted_at:'2026-08-10'},
 }
 const expectations=[
  ['Qual foi a última visita dele?',/24\/08\/2026/],
  ['Qual foi a principal objeção?',/Preço acima do orçamento/],
  ['Qual foi o último compromisso?',/Enviar proposta revisada/],
  ['Quanto foi a última compra?',/R\$\s*185\.000,00/],
  ['Qual cultura ele está plantando?',/Milho.*2026\/27|2026\/27.*Milho/],
  ['Qual área dele está cadastrada?',/428,5 ha/],
 ]
 for(const [message,pattern] of expectations){
  const response=buildFastClientResponse({facts,message,organizationId:tenantId,conversationId:'thread-a',now})
  assert.match(response.advice.answer,pattern,message)
  assert.equal(response.route,'FAST',message)
  assert.equal(response.responseMetadata.executionBudget.modelCalls,0,message)
  assert.equal(response.responseMetadata.executionBudget.toolCalls,1,message)
  assert.ok(response.responseMetadata.executionBudget.hops<=2,message)
  assert.equal(response.responseMetadata.executionBudget.estimatedCostUsd,0,message)
  assert.equal(response.advice.ai_reasoning.run.model_call_count,0,message)
 }

 const noData=buildFastClientResponse({facts:{client:{id:antonio.id,name:antonio.name}},message:'Qual foi a última visita dele?',organizationId:tenantId,conversationId:'thread-a',now})
 assert.match(noData.advice.answer,/Ainda não há visita (?:concluída )?registrada/i)
 assert.equal(noData.advice.ai_reasoning.facts_used.length,0)

 const noArea=buildFastClientResponse({facts:{client:{id:antonio.id,name:antonio.name,totalAreaHa:null}},message:'Qual área dele está cadastrada?',organizationId:tenantId,conversationId:'thread-a',now})
 assert.match(noArea.advice.answer,/Ainda não há área total cadastrada/i)
 assert.doesNotMatch(noArea.advice.answer,/0 ha/)
})

test('fatos legados sem source_ref falham fechados e nunca viram evidência verificada',()=>{
 const cases=[
  {
   message:'Qual foi o último compromisso?',
   facts:{client:antonio,latestCommitment:{description:'Enviar desconto secreto.',status:'OPEN',updated_at:'2026-08-25T12:00:00.000Z'}},
   forbidden:/Enviar desconto secreto/,
  },
  {
   message:'Quanto foi a última compra?',
   facts:{client:antonio,latestPurchase:{occurred_at:'2026-08-20T12:00:00.000Z',product:'Produto legado secreto',value:185000,currency:'BRL'}},
   forbidden:/Produto legado secreto|185\.000/,
  },
  {
   message:'Qual foi a principal objeção?',
   facts:{client:antonio,latestConfirmedObjection:{confirmed_at:'2026-08-24T13:00:00.000Z',objections:[{statement:'Objeção legada secreta.'}]}},
   forbidden:/Objeção legada secreta/,
  },
  {
   message:'Qual foi a objeção da última visita?',
   facts:{client:antonio,latestCompletedVisit:{id:'visit-legacy',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z'},latestVisitConfirmedObjection:{visit_id:'visit-legacy',confirmed_at:'2026-08-24T13:00:00.000Z',objections:[{statement:'Objeção sem relatório auditável.'}]}},
   forbidden:/Objeção sem relatório auditável/,
  },
 ]
 for(const {message,facts,forbidden} of cases){
  const response=buildFastClientResponse({facts,message,organizationId:tenantId,conversationId:'thread-legacy-no-source',now})
  const reasoning=response.advice.ai_reasoning
  assert.match(response.advice.answer,/referência auditável|referencia auditavel/i,message)
  assert.doesNotMatch(response.advice.answer,forbidden,message)
  assert.deepEqual(reasoning.facts_used,[],message)
  assert.deepEqual(reasoning.evidence_to_use,[],message)
  assert.equal(reasoning.context_snapshot.confidence.level,'INSUFICIENTE',message)
  assert.equal(reasoning.confidence.level,'INSUFICIENTE',message)
  assert.deepEqual(reasoning.run.capabilities_used,[],message)
  assert.equal(reasoning.run.capability_results[0].status,'NO_DATA',message)
  assert.equal(reasoning.run.capability_results[0].source_ref,null,message)
 }
})

test('comparação omite compromisso, compra e objeção legados sem identificador auditável',()=>{
 const response=buildFastClientComparisonResponse({
  entries:[
   {client:{...antonio,totalAreaHa:428.5},latestCommitment:{description:'Compromisso legado secreto.'},latestPurchase:{product:'Compra legada secreta',value:185000},latestConfirmedObjection:{objections:[{statement:'Objeção legada secreta.'}]}},
   {client:{...carlos,totalAreaHa:310}},
  ],
  message:'Compare os dois.',organizationId:tenantId,conversationId:'thread-comparison-legacy-no-source',now,
 })
 assert.doesNotMatch(response.advice.answer,/Compromisso legado secreto|Compra legada secreta|Objeção legada secreta|185\.000/)
 assert.ok(response.advice.ai_reasoning.facts_used.every(item=>Boolean(item.id)))
 const commercial=response.advice.ai_reasoning.run.capability_results.find(item=>item.capability==='COMMERCIAL_HISTORY')
 assert.deepEqual(commercial,{capability:'COMMERCIAL_HISTORY',status:'NO_DATA',source_ref:null})
})

test('objeção da última visita preserva proveniência do relatório e da visita concluída correlacionada',()=>{
 const facts={
  client:{id:antonio.id,name:antonio.name},
  latestCompletedVisit:{id:'visit-correlated',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z'},
  latestVisitConfirmedObjection:{visit_report_id:'report-correlated',visit_id:'visit-correlated',confirmed_at:'2026-08-24T13:00:00.000Z',visit_occurred_at:'2026-08-24T12:00:00.000Z',visit_lifecycle_status:'COMPLETED',objections:[{statement:'Preço acima do orçamento.',primary:true}]},
 }
 const response=buildFastClientResponse({facts,message:'Qual foi a objeção da última visita?',organizationId:tenantId,conversationId:'thread-visit-provenance',now})
 const reasoning=response.advice.ai_reasoning
 assert.equal(response.responseMetadata.dataPath,'LATEST_VISIT_CONFIRMED_OBJECTION')
 assert.deepEqual(response.responseMetadata.latestCompletedVisit,{id:'visit-correlated',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T12:00:00.000Z'})
 assert.deepEqual(reasoning.facts_used.map(item=>item.source_type),['confirmed_visit_report','visit'])
 const reportEvidence=reasoning.facts_used.find(item=>item.source_type==='confirmed_visit_report')
 assert.equal(reportEvidence.id,'report-correlated')
 assert.equal(reportEvidence.visit_id,'visit-correlated')
 assert.equal(reportEvidence.visit_observed_at,'2026-08-24T12:00:00.000Z')
 const visitEvidence=reasoning.facts_used.find(item=>item.source_type==='visit')
 assert.equal(visitEvidence.id,'visit-correlated')
 assert.equal(visitEvidence.observed_at,'2026-08-24T12:00:00.000Z')
})

test('comparação não escolhe primeira objeção sem primary e não verifica resposta sem evidência',()=>{
 const ambiguous=buildFastClientComparisonResponse({
  entries:[
   {client:{id:antonio.id,name:antonio.name},latestConfirmedObjection:{visit_report_id:'report-a',confirmed_at:'2026-08-24T13:00:00.000Z',objections:[{statement:'Preço acima do orçamento.'},{statement:'Prazo de entrega.'}]}},
   {client:{id:carlos.id,name:carlos.name,totalAreaHa:300}},
  ],
  message:'Compare os dois.',organizationId:tenantId,conversationId:'thread-comparison-ambiguous',now,
 })
 assert.match(ambiguous.advice.answer,/2 registradas, sem principal definida/i)
 assert.match(ambiguous.advice.answer,/Preço acima do orçamento.*Prazo de entrega/i)
 assert.doesNotMatch(ambiguous.advice.answer,/objeção confirmada Preço acima do orçamento/i)
 assert.ok(ambiguous.advice.ai_reasoning.missing_information.some(item=>/Marcação da objeção principal.*Antônio Carlos/i.test(item)))
 assert.ok(ambiguous.advice.ai_reasoning.decision_interview.questions.some(item=>/Qual objeção confirmada.*Antônio Carlos/i.test(item.question)))
 assert.equal(ambiguous.advice.ai_reasoning.facts_used.find(item=>item.id==='report-a').statement,'Objeções confirmadas de Antônio Carlos: Preço acima do orçamento.; Prazo de entrega.')

 const empty=buildFastClientComparisonResponse({
  entries:[{client:{id:antonio.id,name:antonio.name}},{client:{id:carlos.id,name:carlos.name}}],
  message:'Compare os dois.',organizationId:tenantId,conversationId:'thread-comparison-empty',now,
 })
 assert.deepEqual(empty.advice.ai_reasoning.facts_used,[])
 assert.equal(empty.advice.ai_reasoning.context_snapshot.confidence.level,'INSUFICIENTE')
 assert.equal(empty.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
 assert.deepEqual(empty.advice.ai_reasoning.run.capabilities_used,[])
})

test('Fact First não sequestra pedidos estratégicos, agronômicos, compostos ou com anexo',()=>{
 const cases=[
  'Como devo responder à objeção de preço?',
  'Como contornar uma objeção de preço?',
  'Explique a objeção do cliente.',
  'Me ajude com a objeção de preço.',
  'A objeção muda minha abordagem?',
  'Qual cultura seria melhor plantar?',
  'Quanto ele comprou e como isso muda a estratégia?',
  'Qual foi a última compra do João e o que devo fazer?',
  'Qual foi a principal objeção do João e como devo responder?',
  'Qual foi a última visita do João e por que isso importa?',
  'Quanto ele comprou no total este ano?',
  'Qual foi a última visita e o que devo fazer amanhã?',
 ]
 for(const message of cases){
  const decision=route(message)
  assert.equal(decision.direct,false,message)
  assert.notEqual(decision.data_path,'LATEST_VISIT',message)
  assert.notEqual(decision.data_path,'LATEST_CONFIRMED_OBJECTION',message)
  assert.notEqual(decision.data_path,'LATEST_PURCHASE',message)
  assert.notEqual(decision.data_path,'REGISTERED_CROPS',message)
 }
 const attachment=routeSystemCapability({message:'Qual foi a última visita e analise este PDF.',intentHint:'ASK_CLIENT',hasClient:true,attachmentTypes:['application/pdf']})
 assert.equal(attachment.direct,false)
 assert.equal(attachment.data_path,null)
})

test('complementos factuais comuns não são tratados como nomes de produtores',()=>{
 for(const message of ['Qual foi a visita de ontem?','Qual foi a compra de fertilizante?','Qual cultura de milho está cadastrada?','Qual foi a objeção de preço?']){
  assert.deepEqual(extractNaturalClientReference(message),{kind:'NONE',reference:null},message)
 }
 assert.deepEqual(extractNaturalClientReference('Qual foi a objeção da última visita?'),{kind:'NONE',reference:null})
 assert.equal(classifyStructuredClientFact('Qual foi a objeção da última visita?'),'LATEST_VISIT_CONFIRMED_OBJECTION')
 assert.equal(classifyStructuredClientFact('Qual foi a última objeção confirmada?'),'LATEST_CONFIRMED_OBJECTION')
})

test('lookup factual fallback mantém tenant+owner e ignora fatos não confirmados ou perdidos',async()=>{
 const store={
  imports:[
   {tenantId,ownerId,clients:[{id:'shared',name:'Carteira A',area:428.5,cultures:'Soja, Milho'}]},
   {tenantId,ownerId:otherOwnerId,clients:[{id:'shared',name:'Carteira B',area:999,cultures:'Algodão'}]},
   {tenantId:otherTenantId,ownerId,clients:[{id:'shared',name:'Outro tenant',area:1000,cultures:'Arroz'}]},
  ],
  visits:[
   {id:'visit-completed-a',tenantId,ownerId,clientId:'shared',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-23T12:00:00.000Z'},
  ],
  businessEvents:[
   {id:'won-a',tenantId,ownerId,clientId:'shared',outcome:'won',occurredAt:'2026-08-20T12:00:00.000Z',value:185000,currency:'BRL'},
   {id:'won-z',tenantId,ownerId,clientId:'shared',outcome:'won',occurredAt:'2026-08-20T12:00:00.000Z',createdAt:'2026-08-20T13:00:00.000Z',value:186000,currency:'BRL'},
   {id:'won-null-newer-created',tenantId,ownerId,clientId:'shared',outcome:'won',occurredAt:null,createdAt:'2026-08-29T12:00:00.000Z',value:999999,currency:'BRL'},
   {id:'lost-a',tenantId,ownerId,clientId:'shared',outcome:'lost',occurredAt:'2026-08-21T12:00:00.000Z',value:999000,currency:'BRL',lossReason:'Preço'},
   {id:'won-b',tenantId,ownerId:otherOwnerId,clientId:'shared',outcome:'won',occurredAt:'2026-08-22T12:00:00.000Z',value:777000,currency:'BRL'},
  ],
  val:{
   commitments:[],
   visitReports:[
   {visit_report_id:'pending-a',tenantId,ownerId,client_id:'shared',confirmation_status:'PENDING_REVIEW',confirmed_at:'2026-08-25T12:00:00.000Z',objections:[{statement:'Não usar'}]},
   {visit_report_id:'confirmed-a',tenantId,ownerId,client_id:'shared',confirmation_status:'CONFIRMED',confirmed_at:'2026-08-24T12:00:00.000Z',objections:[{statement:'Objeção confirmada A'}]},
   {visit_report_id:'visit-report-a',visit_id:'visit-completed-a',tenantId,ownerId,client_id:'shared',confirmation_status:'CONFIRMED',confirmed_at:'2026-08-23T13:00:00.000Z',objections:[{statement:'Objeção correlacionada à visita'}]},
   {visit_report_id:'confirmed-b',tenantId,ownerId:otherOwnerId,client_id:'shared',confirmation_status:'CONFIRMED',confirmed_at:'2026-08-26T12:00:00.000Z',objections:[{statement:'Objeção de B'}]},
   ],
  },
 }
 const repository=new ValRepository({db:{configured:false},tenantId,readStore:()=>store,saveStore:()=>{}})
 const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId:'shared',now})
 assert.equal(facts.client.name,'Carteira A')
 assert.equal(facts.client.totalAreaHa,428.5)
 assert.equal(facts.latestPurchase.id,'won-z')
 assert.equal(facts.latestConfirmedObjection.visit_report_id,'confirmed-a')
 assert.equal(facts.latestConfirmedObjection.objections[0].statement,'Objeção confirmada A')
 assert.equal(facts.latestVisitConfirmedObjection.visit_report_id,'visit-report-a')
 assert.equal(facts.latestVisitConfirmedObjection.visit_id,'visit-completed-a')
 assert.equal(facts.latestVisitConfirmedObjection.visit_occurred_at,'2026-08-23T12:00:00.000Z')
})

test('consulta PostgreSQL factual fica correlacionada ao cliente autorizado e mede DATABASE',async()=>{
 let sql=''
 const repository=new ValRepository({
  db:{configured:true,query:async statement=>{sql=statement;return {rowCount:1,rows:[{client_external_key:'antonio',name:'Antônio Carlos',total_area_ha:'428.5',cultures:'Soja, Milho',latest_purchase:{id:'purchase-1'},latest_confirmed_objection:{visit_report_id:'report-1',objections:[{statement:'Preço'}]}}]}}},
  tenantId,readStore:()=>({}),saveStore:()=>{},
 })
 const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId:'antonio',now})
 assert.equal(facts.client.totalAreaHa,428.5)
 assert.equal(facts.latestPurchase.id,'purchase-1')
 assert.match(sql,/c\.tenant_id=\$1 AND c\.consultant_id=\$2/)
 assert.match(sql,/outcome='won'/)
 assert.match(sql,/ORDER BY business\.occurred_at DESC NULLS LAST,business\.created_at DESC NULLS LAST,business\.id DESC/)
 assert.match(sql,/confirmation_status='CONFIRMED'/)
 assert.match(sql,/latest_visit\.occurred_at visit_occurred_at/)
 assert.match(sql,/latest_crop_season/)
 assert.ok(latencyStages.includes('DATABASE'))
})
