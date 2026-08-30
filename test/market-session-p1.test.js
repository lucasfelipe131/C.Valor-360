import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {
 answerCurrentMarket,
 buildClientMarketResponse,
 buildFastClientResponse,
 buildFastMarketResponse,
 composeMarketAttachmentResponse,
 finalizeAttachmentRecommendation,
 routeSystemCapability
} from '../server/decision-copilot/capability-router.js'
import {applyRecommendationFinalizer,ValEngine} from '../server/val-engine.js'
import {
 buildMarketContinuationMessage,
 buildRegisterPrefill,
 buildSessionReplyMessage,
 selectMarketContinuation
} from '../src/lib/global-val-conversation.js'

const now=new Date('2026-08-25T15:00:00.000Z')
const quote=(overrides={})=>({
 id:'quote-base',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:110,
 priceUnit:'BRL/sc_60kg',sourceName:'Fonte autorizada',sourceUrl:'https://example.test/quote',
 observedAt:'2026-08-25T13:00:00.000Z',confidence:92,status:'active',...overrides
})

test('continuação de mercado — commodity nova e mais recente prevalece sobre a âncora antiga',()=>{
 const globalThread=[{role:'assistant',at:'2026-08-25T14:00:00.000Z',payload:{advice:{ai_reasoning:{intent:'ASK_COMMODITY',objective:'Entender a referência atual da soja.'}}}}]
 const prompt='E para o milho, como isso muda a conversa?'
 const continuation=selectMarketContinuation({prompt,globalThread,localThread:[],hasClient:true})
 assert.equal(continuation.intent,'ASK_COMMODITY')
 const message=buildMarketContinuationMessage({objective:continuation.objective,prompt})
 const market=answerCurrentMarket({workspace:{marketSnapshots:[
  quote({id:'soja-newer',commodity:'soja',observedAt:'2026-08-25T14:00:00.000Z'}),
  quote({id:'milho-correct',commodity:'milho',price:68,observedAt:'2026-08-25T13:00:00.000Z'})
 ]},message,intentHint:continuation.intent,now})
 assert.equal(market.source.commodity,'milho')
 assert.equal(market.source.id,'milho-correct')
 assert.match(market.answer,/Milho/)
 assert.doesNotMatch(market.answer,/é de Soja/)
})

test('cotação — tipo, safra e janela de entrega pedidos filtram estritamente e aparecem na resposta',()=>{
 const workspace={marketSnapshots:[
  quote({id:'spot-newer',marketKind:'spot',price:111,observedAt:'2026-08-25T14:30:00.000Z'}),
  quote({id:'forward-unknown-season',marketKind:'forward',price:119,deliveryStart:'2026-10-01',deliveryEnd:'2026-10-31',notes:'',observedAt:'2026-08-25T14:15:00.000Z'}),
  quote({id:'forward-wrong-window',marketKind:'forward',price:120,deliveryStart:'2026-12-01',deliveryEnd:'2026-12-31',notes:'Safra 2026/27',observedAt:'2026-08-25T14:00:00.000Z'}),
  quote({id:'forward-october',marketKind:'forward',price:118,deliveryStart:'2026-10-01',deliveryEnd:'2026-10-31',notes:'Safra 2026/27',observedAt:'2026-08-25T13:00:00.000Z'})
 ]}
 const message='Qual a cotação a termo da soja para entrega em outubro de 2026, safra 2026/27?'
 const market=answerCurrentMarket({workspace,message,intentHint:'ASK_COMMODITY',now})
 assert.equal(market.source.id,'forward-october')
 assert.equal(market.source.market_kind,'forward')
 assert.equal(market.source.delivery_start,'2026-10-01')
 assert.equal(market.source.delivery_end,'2026-10-31')
 assert.match(market.answer,/Tipo de mercado: a termo \(forward\)/)
 assert.match(market.answer,/Janela de entrega: 2026-10-01 a 2026-10-31/)

 const unavailable=answerCurrentMarket({workspace:{marketSnapshots:[workspace.marketSnapshots[0]]},message,intentHint:'ASK_COMMODITY',now})
 assert.equal(unavailable.status,'UNAVAILABLE')
 assert.match(unavailable.answer,/tipo a termo \(forward\)/)
 assert.match(unavailable.answer,/safra 2026\/27/)
 assert.doesNotMatch(unavailable.answer,/R\$\s*111/)
})

test('cotação — praça e unidade explícitas também são filtros estritos',()=>{
 const workspace={marketSnapshots:[
  quote({id:'rondonopolis-sc-newer',region:'Rondonópolis/MT',price:112,observedAt:'2026-08-25T14:30:00.000Z'}),
  quote({id:'cascavel-sc',region:'Cascavel/PR',price:110,observedAt:'2026-08-25T14:00:00.000Z'}),
  quote({id:'cascavel-t',region:'Cascavel/PR',price:1850,priceUnit:'BRL/t',observedAt:'2026-08-25T13:00:00.000Z'})
 ]}
 const tonne=answerCurrentMarket({workspace,message:'Qual a cotação spot da soja em Cascavel/PR por tonelada hoje?',now})
 assert.equal(tonne.source.id,'cascavel-t')
 assert.equal(tonne.source.region,'Cascavel/PR')
 assert.equal(tonne.source.price_unit,'BRL/t')
 const sack=answerCurrentMarket({workspace,message:'Qual a cotação spot da soja em Cascavel por saca hoje?',now})
 assert.equal(sack.source.id,'cascavel-sc')
 const missing=answerCurrentMarket({workspace,message:'Qual a cotação spot da soja na praça de Toledo/PR por tonelada hoje?',now})
 assert.equal(missing.status,'UNAVAILABLE')
 assert.match(missing.answer,/praça toledo\/pr/i)
})

test('cotação — timestamp futuro além da tolerância nunca vira CURRENT',()=>{
 const future=answerCurrentMarket({workspace:{marketSnapshots:[quote({id:'future',observedAt:'2026-08-25T15:10:01.000Z'})]},message:'Preço da soja hoje',now})
 assert.equal(future.status,'UNAVAILABLE')
 assert.equal(future.source,null)
 const clockSkew=answerCurrentMarket({workspace:{marketSnapshots:[quote({id:'clock-skew',observedAt:'2026-08-25T15:04:59.000Z'})]},message:'Preço da soja hoje',now})
 assert.equal(clockSkew.status,'CURRENT')
 assert.equal(clockSkew.source.id,'clock-skew')
})

test('Decision Interview — “não sei” não satisfaz preço-alvo e perguntas/wrappers não viram conhecimento',()=>{
 const base={
  workspace:{marketSnapshots:[quote()],intentions:[]},
  context:{client:{id:'producer-a',name:'Produtor A'},opportunities:[],memories:[]},
  facts:{client:{id:'producer-a',name:'Produtor A'}},intentHint:'ASK_COMMODITY',
  organizationId:'tenant-a',ownerId:'owner-a',conversationId:'decision-thread',now
 }
 const message=buildSessionReplyMessage({
  objective:'Como o preço da soja de hoje muda a negociação?',
  replies:[
   {field:'target_price',question:'Qual é o preço-alvo e a unidade?',answer:'não sei'},
   {field:'decision_window',question:'Qual é a janela real?',answer:'Vender na próxima semana'}
  ]
 })
 assert.doesNotMatch(message,/Qual é o preço-alvo|Qual é a janela real/)
 const response=buildClientMarketResponse({...base,message})
 assert.deepEqual(response.advice.ai_reasoning.decision_interview.material_missing_information,['target_price'])

 const legacy=buildClientMarketResponse({...base,message:'Solicitação original: preço da soja. Contexto nesta sessão. Resposta 1: não sei. Pergunta material: “Qual é o preço-alvo e em qual unidade?”.'})
 assert.ok(legacy.advice.ai_reasoning.decision_interview.material_missing_information.includes('target_price'))
})

test('memórias comerciais confirmadas e estruturadas satisfazem preço-alvo e janela só na commodity/safra corretas',()=>{
 const memories=[
  {id:'target',status:'verified',memory_state:'FACT',memory_domain:'COMMERCIAL',key:'grain_decision.target_price',value:{commodity:'soja',season:'2026/27',targetPrice:118,priceUnit:'BRL/sc_60kg',statement:'R$ 118 por saca'}},
  {id:'window',status:'verified',memory_state:'FACT',memory_domain:'COMMERCIAL',key:'grain_decision.decision_window',value:{commodity:'soja',season:'2026/27',decisionWindow:'Vender na próxima semana',statement:'Vender na próxima semana'}}
 ]
 const response=buildClientMarketResponse({
  workspace:{marketSnapshots:[quote()],intentions:[]},
  context:{client:{id:'producer-memory',name:'Produtor Memória'},opportunities:[],memories},
  facts:{client:{id:'producer-memory',name:'Produtor Memória'}},
  message:'Como a soja da safra 2026/27 muda a negociação deste produtor?',intentHint:'ASK_COMMODITY',
  organizationId:'tenant-a',ownerId:'owner-a',conversationId:'memory-thread',now
 })
 const reasoning=response.advice.ai_reasoning
 assert.equal(reasoning.decision_interview.status,'NOT_NEEDED')
 assert.deepEqual(reasoning.decision_interview.material_missing_information,[])
 assert.deepEqual(reasoning.memory_refs.map(item=>item.id),['target','window'])
 assert.ok(reasoning.run.capabilities_used.includes('CONFIRMED_MEMORY'))
})

test('anexos + dado atual — intenção semântica vence imagem e composição só declara anexos processados',()=>{
 const imageTypes=['image/jpeg']
 assert.equal(routeValIntent({message:'Como o preço da soja de hoje muda a negociação?',hasClient:true,attachmentTypes:imageTypes}).intent,'ASK_COMMODITY')
 assert.equal(routeValIntent({message:'Confira a previsão de chuva para amanhã.',hasClient:true,attachmentTypes:imageTypes}).intent,'CHECK_WEATHER')
 assert.equal(routeValIntent({message:'Confira a bula e o intervalo de segurança.',hasClient:true,attachmentTypes:imageTypes}).intent,'CHECK_LABEL')
 assert.equal(routeValIntent({message:'Analise esta foto da lavoura.',hasClient:true,attachmentTypes:imageTypes}).intent,'IMAGE_DIAGNOSIS')
 const staleHint=routeValIntent({message:'Confira a previsão de chuva para amanhã.',intentHint:'ASK_CLIENT',hasClient:true,attachmentTypes:imageTypes})
 assert.equal(staleHint.intent,'CHECK_WEATHER')
 assert.equal(staleHint.reason,'semantic_current_data_override')
 assert.equal(routeValIntent({message:'Confira a bula e o intervalo de segurança.',intentHint:'ASK_CLIENT',hasClient:true,attachmentTypes:imageTypes}).intent,'CHECK_LABEL')
 assert.equal(routeValIntent({message:'Qual o preço da soja hoje?',intentHint:'ASK_CLIENT',hasClient:true,attachmentTypes:imageTypes}).intent,'ASK_COMMODITY')
 const route=routeSystemCapability({message:'Como o preço da soja de hoje muda a negociação?',intentHint:'ASK_COMMODITY',hasClient:true,attachmentTypes:imageTypes})
 assert.equal(route.path,'DEEP')
 assert.equal(route.direct,false)
 assert.ok(route.capabilities.includes('MARKET_COMMODITY'))
 assert.ok(route.capabilities.includes('IMAGE_DIAGNOSIS'))

 const marketResponse=buildFastMarketResponse({workspace:{marketSnapshots:[quote()]},message:'Preço da soja hoje',intentHint:'ASK_COMMODITY',now})
 const composed=composeMarketAttachmentResponse({
  marketResponse,
  attachmentTypes:imageTypes,
  attachmentResponse:{recommendationId:'rec-attachment',engineMode:'structured_hybrid',model:'fixture',attachments:[{id:'image-a',mimeType:'image/jpeg',status:'interpreted',analysis:{summary:'Há amarelecimento visível; causa não confirmada.'},createdAt:'2026-08-25T14:00:00.000Z'}],advice:{ai_reasoning:{agronomic_context:{status:'requires_human_review',human_review_required:true}}}}
 })
 assert.equal(composed.engineArchitecture,'current-data-plus-multimodal-composition')
 assert.equal(composed.responseMetadata.attachmentCompositionStatus,'EXECUTED')
 assert.match(composed.advice.answer,/Tipo de mercado: disponível \(spot\)/)
 assert.match(composed.advice.answer,/amarelecimento visível/)
 assert.ok(composed.advice.ai_reasoning.run.capabilities_used.includes('IMAGE_DIAGNOSIS'))
 assert.ok(composed.advice.ai_reasoning.facts_used.some(item=>item.source_type==='consultant_attachment'&&item.id==='image-a'))
})

test('perfis confirmados — cinco produtores pela mesma rota geram premissas e abordagens materialmente diferentes',()=>{
 const profiles=[
  ['analítico','Analítico','CONFIRMED','referência comparável'],
  ['relacional','Relacional','VERIFIED','histórico combinado'],
  ['conservador','Conservador','COMPLETED','risco de base'],
  ['inovador','Inovador','INTEGRATED','cenário curto de teste'],
  ['pouco-historico','','','ainda não está confirmado']
 ]
 const responses=profiles.map(([id,label,status,expected])=>{
  const response=buildClientMarketResponse({
   workspace:{marketSnapshots:[quote()],intentions:[]},
   context:{client:{id:`producer-${id}`,name:`Produtor ${id}`},profile:label?{primaryProfile:label,status}:{},opportunities:[],memories:[]},
   facts:{client:{id:`producer-${id}`,name:`Produtor ${id}`}},
   message:'Como o preço da soja de hoje muda a negociação deste produtor?',intentHint:'ASK_COMMODITY',now
  })
  const reasoning=response.advice.ai_reasoning
  assert.equal(reasoning.run.path,'DEEP')
  assert.equal(reasoning.premises.profile_specific,true)
  assert.match(reasoning.commercial_context.profile_strategy,new RegExp(expected,'i'))
  if(label)assert.deepEqual(reasoning.premises.confirmed_profile,{status:'CONFIRMED',label,valid_until:null})
  else assert.equal(reasoning.premises.confirmed_profile,null)
  return response.advice.answer
 })
 assert.equal(new Set(responses).size,5)
})

test('perfil PENDING/PROPOSED nunca vira premissa confirmada nem personaliza a abordagem',()=>{
 for(const status of ['PENDING','PROPOSED']){
  const response=buildClientMarketResponse({
   workspace:{marketSnapshots:[quote()],intentions:[]},
   context:{client:{id:`producer-${status}`,name:`Produtor ${status}`,primaryProfile:'Analítico'},profile:{primaryProfile:'Analítico',status},opportunities:[],memories:[]},
   facts:{client:{id:`producer-${status}`,name:`Produtor ${status}`}},message:'Como o preço da soja de hoje muda a negociação deste produtor?',intentHint:'ASK_COMMODITY',now
  })
  const reasoning=response.advice.ai_reasoning
  assert.equal(reasoning.premises.profile_specific,true)
  assert.equal(reasoning.premises.confirmed_profile,null)
  assert.equal(reasoning.premises.profile_evaluation.status,status)
  assert.equal(reasoning.facts_used.some(item=>item.source_type==='producer_profile'),false)
  assert.doesNotMatch(response.advice.answer,/perfil confirmado é analítico/i)
 }
})

test('capabilities usadas e latência — NO_DATA fica apenas no plano e medição ausente fica nula',()=>{
 const fastMarket=buildFastMarketResponse({workspace:{marketSnapshots:[]},message:'Preço da soja hoje',now,latencyMs:7})
 const fastMarketRun=fastMarket.advice.ai_reasoning.run
 assert.ok(fastMarketRun.capabilities_planned.includes('MARKET_COMMODITY'))
 assert.deepEqual(fastMarketRun.capabilities_used,[])
 assert.equal(fastMarketRun.capability_results[0].status,'NO_DATA')
 assert.ok(Object.values(fastMarketRun.latency_breakdown).every(value=>value===null))

 const fastClient=buildFastClientResponse({facts:{client:{id:'producer-empty',name:'Sem histórico'}},message:'Qual foi a última visita?',now,latencyMs:5})
 const fastClientRun=fastClient.advice.ai_reasoning.run
 assert.deepEqual(fastClientRun.capabilities_used,[])
 assert.equal(fastClientRun.capability_results[0].status,'NO_DATA')
 assert.ok(Object.values(fastClientRun.latency_breakdown).every(value=>value===null))

 const deep=buildClientMarketResponse({workspace:{marketSnapshots:[],intentions:[]},context:{client:{id:'producer-deep',name:'Produtor Deep'},opportunities:[],memories:[]},facts:{client:{id:'producer-deep',name:'Produtor Deep'}},message:'Como o preço da soja hoje muda esta conta?',intentHint:'ASK_COMMODITY',now})
 const deepRun=deep.advice.ai_reasoning.run
 assert.equal(deepRun.capability_results.find(item=>item.capability==='MARKET_COMMODITY').status,'NO_DATA')
 assert.equal(deepRun.capabilities_used.includes('MARKET_COMMODITY'),false)
 assert.ok(deepRun.capabilities_used.includes('CLIENT_CONTEXT'))
 assert.ok(Object.values(deepRun.latency_breakdown).every(value=>value===null))

 const opportunity=routeSystemCapability({message:'Qual é a maior oportunidade desta conta?',intentHint:'CHECK_OPPORTUNITY',hasClient:true})
 assert.equal(opportunity.path,'DEEP')
 assert.equal(opportunity.direct,false)
})

test('finalização de anexo — falha antes da persistência e compõe somente evidência processada',async()=>{
 const draft={attachments:[{id:'attachment-a',status:'received'}],advice:{answer:'base'}}
 let persisted=false
 await assert.rejects(async()=>{
  const finalized=await applyRecommendationFinalizer(draft,value=>finalizeAttachmentRecommendation({draft:value,attachmentIds:['attachment-a']}))
  persisted=true
  return finalized
 },error=>error.code==='val_attachment_analysis_unavailable'&&error.statusCode===422)
 assert.equal(persisted,false)

 const valid={...draft,attachments:[{id:'attachment-a',status:'confirmed',mimeType:'application/pdf',analysis:{summary:'Documento confirmado.'}}]}
 const finalized=await applyRecommendationFinalizer(valid,value=>finalizeAttachmentRecommendation({draft:value,attachmentIds:['attachment-a']}))
 assert.equal(finalized.finalized,false)
 assert.equal(finalized.recommendation.attachments[0].status,'confirmed')
 assert.equal(finalized.recommendation.responseMetadata?.prePersistFinalized,undefined)
})

test('rastreabilidade — recommendationId persistido aponta para a mesma composição devolvida',async()=>{
 const context={client:{id:'producer-trace',name:'Produtor Trace'},profile:{answers:{},evidence:[]},signals:[],learning:{},memories:[],memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],priorRecommendations:[]}
 const attachment={id:'attachment-trace',clientId:'producer-trace',originalName:'trace.pdf',mimeType:'application/pdf',sizeBytes:3,status:'confirmed',analysis:{summary:'Documento confirmado para composição.'},dataBase64:Buffer.from('pdf').toString('base64'),createdAt:'2026-08-25T12:00:00.000Z'}
 const records=[]
 const repository={
  getClientContext:async()=>structuredClone(context),
  getAttachments:async()=>[structuredClone(attachment)],
  listAttachments:async()=>[],
  recordRecommendation:async input=>{records.push(structuredClone(input));return '00000000-0000-4000-8000-000000000999'}
 }
 const runtimeConfig={openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false}
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{},clock:()=>now})
 const marketResponse=buildFastMarketResponse({workspace:{marketSnapshots:[quote()]},message:'Preço da soja hoje',now})
 const finalizeRecommendation=draft=>finalizeAttachmentRecommendation({draft,attachmentIds:[attachment.id],attachmentTypes:[attachment.mimeType],marketResponse})
 const answer=await engine.answer({tenantId:'tenant-trace',ownerId:'owner-trace',clientId:'producer-trace',client:context.client,message:'Preço da soja hoje',attachmentIds:[attachment.id],finalizeRecommendation})
 assert.equal(answer.recommendationId,'00000000-0000-4000-8000-000000000999')
 assert.equal(records.length,1)
 assert.deepEqual(records[0].advice,answer.advice)
 assert.equal(records[0].responseMetadata.prePersistFinalized,true)
 assert.equal(answer.responseMetadata.prePersistFinalized,true)
 assert.equal(records[0].modelRun.prePersistFinalization.status,'completed')

 attachment.status='received'
 await assert.rejects(()=>engine.answer({tenantId:'tenant-trace',ownerId:'owner-trace',clientId:'producer-trace',client:context.client,message:'Preço da soja hoje',attachmentIds:[attachment.id],finalizeRecommendation}),error=>error.code==='val_attachment_analysis_unavailable')
 assert.equal(records.length,1)
})

test('dispatch HTTP — valida ownership/MIME antes do roteamento, não retorna mercado antes da leitura e falha fechado',()=>{
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')
 const routeAt=source.indexOf('const routedIntent=routeValIntent')
 const loadAt=source.indexOf('const requestedAttachments=')
 const finalizeAt=source.indexOf('const finalizeRecommendation=',routeAt)
 const executeAt=source.indexOf('const coreResponse=await valCore.execute',routeAt)
 assert.ok(loadAt>=0&&loadAt<routeAt)
 assert.match(source.slice(loadAt,routeAt),/val_attachment_scope_invalid/)
 assert.match(source.slice(routeAt,executeAt),/marketAttachmentBase=deep/)
 assert.ok(finalizeAt>routeAt&&finalizeAt<executeAt)
 assert.match(source.slice(finalizeAt,executeAt),/finalizeAttachmentRecommendation/)
 assert.match(source.slice(finalizeAt,executeAt),/attachmentIds\.length/)
 assert.match(source.slice(executeAt),/val_attachment_analysis_unavailable/)
 const applyAt=engine.indexOf('applyRecommendationFinalizer(draft,finalizeRecommendation,{signal})')
 const persistAt=engine.indexOf('this.repository.recordRecommendation',applyAt)
 assert.ok(applyAt>=0&&persistAt>applyAt)
 assert.match(source,/requestedAttachmentTypes/)
 assert.doesNotMatch(source,/attachmentTypes:attachmentIds\.length\?\['application\/octet-stream'\]/)
})

test('REGISTER prefill — mantém metadados estruturados e exclui texto das perguntas',()=>{
 const text=buildRegisterPrefill([
  {field:'target_price',question:'Qual é o preço-alvo?',answer:'R$ 118 por saca',intent:'ASK_COMMODITY',objective:'Soja 2026/27 para este produtor',commodity:'soja',season:'2026/27'},
  {field:'decision_window',question:'Qual a janela?',answer:'Próxima semana',intent:'ASK_COMMODITY',objective:'Soja 2026/27 para este produtor',commodity:'soja',season:'2026/27'}
 ])
 assert.match(text,/VAL_SESSION_REGISTER_V1/)
 assert.match(text,/Objetivo: Soja 2026\/27 para este produtor/)
 assert.match(text,/Intenção: ASK_COMMODITY/)
 assert.match(text,/Commodity: soja/)
 assert.match(text,/Safra: 2026\/27/)
 assert.match(text,/Resposta 1 \[target_price\]: R\$ 118 por saca/)
 assert.match(text,/Resposta 2 \[decision_window\]: Próxima semana/)
 assert.doesNotMatch(text,/Qual é o preço-alvo|Qual a janela/)
})
