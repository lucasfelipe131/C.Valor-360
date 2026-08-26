import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as capabilityRouter from '../server/decision-copilot/capability-router.js'
import {GrainRepository} from '../server/grain-repository.js'

const {
 answerCurrentMarket,
 buildFastClientResponse,
 buildFastMarketResponse,
 routeSystemCapability
}=capabilityRouter

const now=new Date('2026-08-25T15:00:00.000Z')

const currentQuote={
 id:'soja-cascavel-spot-current',
 commodity:'soja',
 marketKind:'spot',
 region:'Cascavel/PR',
 price:110,
 priceUnit:'BRL/sc_60kg',
 sourceName:'Boletim Mercado Teste',
 sourceUrl:'https://example.test/mercado/soja',
 observedAt:'2026-08-25T13:00:00.000Z',
 confidence:92,
 notes:'Safra 2026/27',
 status:'active'
}

function assertNotSyntheticPass(response,label){
 const quality=response?.advice?.ai_reasoning?.quality
 assert.ok(quality,`${label}: quality ausente`)
 assert.equal(quality.status,'NOT_EVALUATED',`${label}: FAST sem avaliador não pode declarar PASSED`)
 for(const [name,result] of Object.entries(quality.automatic_tests||{})){
  assert.notEqual(result?.passed,true,`${label}: ${name} não foi executado e não pode declarar passed=true`)
 }
}

test('mercado — movimento exige commodity, unidade, praça e marketKind idênticos',()=>{
 const incompatible=[
  {...currentQuote,id:'other-unit',price:20,priceUnit:'BRL/t',observedAt:'2026-08-25T12:30:00.000Z'},
  {...currentQuote,id:'other-region',price:20,region:'Paranaguá/PR',observedAt:'2026-08-25T12:00:00.000Z'},
  {...currentQuote,id:'other-kind',price:20,marketKind:'forward',observedAt:'2026-08-25T11:30:00.000Z'},
  {...currentQuote,id:'other-commodity',commodity:'milho',price:20,observedAt:'2026-08-25T11:00:00.000Z'}
 ]
 const withoutComparable=answerCurrentMarket({
  workspace:{marketSnapshots:[currentQuote,...incompatible]},
  message:'Qual é o preço da soja hoje?',
  now
 })
 assert.doesNotMatch(withoutComparable.answer,/\b(?:subiu|caiu|ficou est.vel)\b/i)

 const comparable={...currentQuote,id:'same-market-before',price:100,observedAt:'2026-08-24T13:00:00.000Z'}
 const withComparable=answerCurrentMarket({
  workspace:{marketSnapshots:[currentQuote,...incompatible,comparable]},
  message:'Qual é o preço da soja hoje?',
  now
 })
 assert.match(withComparable.answer,/subiu 10%/i)
})

test('mercado — answer e voice_output carregam fonte e data observada',()=>{
 const response=buildFastMarketResponse({
  workspace:{marketSnapshots:[currentQuote]},
  message:'Qual é o preço da soja hoje?',
  intentHint:'ASK_COMMODITY',
  organizationId:'tenant-a',
  ownerId:'owner-a',
  conversationId:'market-thread',
  now
 })
 const answer=response.advice.answer
 const spoken=response.advice.ai_reasoning.voice_output.speakable_text
 for(const text of [answer,spoken]){
  assert.match(text,/Boletim Mercado Teste/)
  assert.match(text,/25\/08\/2026/)
 }
 assert.equal(spoken,answer)
})

test('FAST — qualidade não inventa PASS nem sucesso de testes automáticos',()=>{
 const market=buildFastMarketResponse({
  workspace:{marketSnapshots:[currentQuote]},
  message:'Preço da soja hoje',
  organizationId:'tenant-a',
  now
 })
 const client=buildFastClientResponse({
  facts:{
   client:{id:'producer-a',name:'Produtor A'},
   latestCompletedVisit:{
    id:'visit-a',status:'Concluída',lifecycleStatus:'COMPLETED',
    occurredAt:'2026-08-24T14:00:00.000Z',summary:'Revisão comercial.'
   }
  },
  message:'Qual foi a última visita?',
  organizationId:'tenant-a',
  now
 })
 assertNotSyntheticPass(market,'market')
 assertNotSyntheticPass(client,'client')
})

test('router — PREPARE_VISIT não vira FAST por mencionar última visita',()=>{
 const route=routeSystemCapability({
  message:'Prepare a próxima visita usando o que aconteceu na última visita.',
  intentHint:'PREPARE_VISIT',
  hasClient:true
 })
 assert.equal(route.intent,'PREPARE_VISIT')
 assert.equal(route.path,'DEEP')
 assert.equal(route.direct,false)
 assert.ok(route.capabilities.includes('VISIT_HISTORY'))
 assert.ok(route.capabilities.includes('CLIENT_CONTEXT'))
})

test('GrainRepository.getMarketReferences — fallback mantém escopo estrito do owner',async()=>{
 const store={grains:{profiles:[],intentions:[],marketSnapshots:[
  {...currentQuote,id:'owner-a-current',ownerId:'owner-a'},
  {...currentQuote,id:'owner-b-current',ownerId:'owner-b'},
  {...currentQuote,id:'ownerless',ownerId:null},
  {...currentQuote,id:'owner-a-inactive',ownerId:'owner-a',status:'inactive'}
 ]}}
 const repository=new GrainRepository({
  db:{configured:false},
  readStore:()=>structuredClone(store),
  saveStore:()=>{},
  tenantId:'tenant-a'
 })
 const ownerA=await repository.getMarketReferences('owner-a')
 const ownerB=await repository.getMarketReferences('owner-b')
 assert.deepEqual(ownerA.marketSnapshots.map(item=>item.id),['owner-a-current'])
 assert.deepEqual(ownerB.marketSnapshots.map(item=>item.id),['owner-b-current'])
})

test('mercado + produtor — resposta DEEP cruza perfil e negociação sem promover memória',()=>{
 const buildClientMarketResponse=capabilityRouter.buildClientMarketResponse
 assert.equal(typeof buildClientMarketResponse,'function','buildClientMarketResponse precisa ser exportada')

 const response=buildClientMarketResponse({
  workspace:{
   marketSnapshots:[currentQuote],
   profiles:[{
    id:'grain-profile-a',clientId:'producer-a',commodities:['soja'],
    logisticsMode:'FOB',usualDeliveryLocations:'Cascavel/PR',confirmedAt:'2026-08-20T12:00:00.000Z'
   }],
   intentions:[{
    id:'intent-a',clientId:'producer-a',commodity:'soja',direction:'sell',
    volume:1200,volumeUnit:'sc_60kg',targetPrice:null,priceUnit:'BRL/sc_60kg',
    deliveryStart:null,deliveryEnd:null,deliveryLocation:'Cascavel/PR',
    status:'confirmed',confidence:90
   }]
  },
  context:{
   client:{
    id:'producer-a',name:'Antônio Carlos Costa Beber',municipality:'Cascavel',
    primaryProfile:'Analítico',decisionDriver:'comparativo econômico com dados da própria fazenda'
   },
   profile:{primaryProfile:'Analítico',status:'CONFIRMED',decisionDriver:'comparativo econômico com dados da própria fazenda'},
   opportunities:[{id:'opp-a',title:'Comercialização da soja',stage:'Diagnóstico',nextAction:'Validar preço-alvo e janela'}],
   visits:[{id:'visit-a',status:'Concluída',summary:'Produtor pediu cenário FOB antes de decidir.'}],
   commitments:[{commitment_id:'commitment-a',description:'Comparar cenário FOB com preço-alvo',status:'OPEN'}],
   memories:[]
  },
  message:'Como o preço da soja de hoje muda a negociação deste produtor?',
  intentHint:'ASK_COMMODITY',
  organizationId:'tenant-a',
  ownerId:'owner-a',
  conversationId:'producer-a-market',
  now
 })
 const reasoning=response.advice.ai_reasoning
 const specificityCorpus=JSON.stringify({answer:response.advice.answer,thesis:reasoning.decision_thesis,strategy:reasoning.recommended_strategy})

 assert.equal(response.route,'DEEP')
 assert.equal(reasoning.run.path,'DEEP')
 assert.match(specificityCorpus,/Antônio Carlos Costa Beber/)
 assert.match(specificityCorpus,/Analítico|comparativo econômico|FOB|1\.?200/)
 assert.equal(reasoning.premises.profile_specific,true)

 for(const capability of ['MARKET_COMMODITY','CLIENT_CONTEXT','COMMERCIAL_HISTORY']){
  assert.ok(reasoning.run.capabilities_used.includes(capability),capability)
  assert.ok(reasoning.run.capability_results.some(result=>(result.capability||result.name||result.id)===capability),`${capability}: resultado ausente`)
 }
 for(const used of reasoning.run.capabilities_used){
  const result=reasoning.run.capability_results.find(item=>(item.capability||item.name||item.id)===used)
  assert.ok(result,`${used}: capacidade usada sem resultado`)
  assert.ok(result.status,`${used}: resultado sem status`)
 }

 const questions=reasoning.decision_interview?.questions||[]
 assert.ok(questions.length<=2)
 assert.ok(questions.every(question=>question.classification==='MATERIAL'))
 assert.equal(reasoning.persistence_mode,'NONE')
 assert.deepEqual(reasoning.memory_refs,[])
 assert.equal(reasoning.premises.conversation_is_not_confirmed_memory,true)
 assert.equal(reasoning.voice_output.automatic_memory_effect,false)
})

test('mercado + produtor — respostas materiais acumuladas na sessão eliminam a terceira repetição',()=>{
 const input={
  workspace:{marketSnapshots:[currentQuote],intentions:[]},
  context:{client:{id:'producer-b',name:'Produtora B',primaryProfile:'Relacional'},opportunities:[],memories:[]},
  intentHint:'ASK_COMMODITY',organizationId:'tenant-a',ownerId:'owner-a',conversationId:'producer-b-market',now
 }
 const first=capabilityRouter.buildClientMarketResponse({...input,message:'Como a soja de hoje muda a negociação desta conta?'})
 assert.deepEqual(first.advice.ai_reasoning.decision_interview.material_missing_information,['target_price','decision_window'])
 const target=first.advice.ai_reasoning.decision_interview.questions[0]
 const second=capabilityRouter.buildClientMarketResponse({...input,message:`Contexto informado apenas nesta sessão; não promover a memória: Resposta 1 à pergunta “${target.question}”: R$ 118 por saca.`})
 assert.deepEqual(second.advice.ai_reasoning.decision_interview.material_missing_information,['decision_window'])
 const windowQuestion=second.advice.ai_reasoning.decision_interview.questions[0]
 const third=capabilityRouter.buildClientMarketResponse({...input,message:`Contexto informado apenas nesta sessão; não promover a memória: Resposta 1 à pergunta “${target.question}”: R$ 118 por saca. Resposta 2 à pergunta “${windowQuestion.question}”: vender na próxima semana.`})
 assert.equal(third.advice.ai_reasoning.decision_interview.status,'NOT_NEEDED')
 assert.deepEqual(third.advice.ai_reasoning.decision_interview.questions,[])
 assert.deepEqual(third.advice.ai_reasoning.memory_refs,[])
 const copilot=readFileSync(new URL('../src/components/GlobalValCopilot.jsx',import.meta.url),'utf8')
 const conversationHelpers=readFileSync(new URL('../src/lib/global-val-conversation.js',import.meta.url),'utf8')
 assert.match(copilot,/sessionReplies/)
 assert.match(conversationHelpers,/não promover a memória/)
 assert.match(conversationHelpers,/selectMarketContinuation/)
})

test('mercado + produtor — memória confirmada só vale para domínio, commodity e safra relevantes',()=>{
 const memories=[
  {
   id:'memory-milho-current',status:'verified',memory_state:'FACT',memory_domain:'COMMERCIAL',
   key:'grain_decision',value:{commodity:'milho',season:'2026/27',targetPrice:72,decisionWindow:'próxima semana'},
   valid_until:'2026-12-31T23:59:59.000Z',source_ref:'visit:milho'
  },
  {
   id:'memory-soja-old-season',status:'verified',memory_state:'FACT',memory_domain:'COMMERCIAL',
   key:'grain_decision',value:{commodity:'soja',season:'2025/26',targetPrice:145,decisionWindow:'próxima semana'},
   valid_until:'2026-12-31T23:59:59.000Z',source_ref:'visit:soja-old'
  },
  {
   id:'memory-soja-wrong-domain',status:'verified',memory_state:'FACT',memory_domain:'AGRONOMIC',
   key:'soil_note',value:{commodity:'soja',season:'2026/27',targetPrice:160,decisionWindow:'agosto'},
   valid_until:'2026-12-31T23:59:59.000Z',source_ref:'soil:soja'
  }
 ]
 const response=capabilityRouter.buildClientMarketResponse({
  workspace:{marketSnapshots:[currentQuote],intentions:[]},
  context:{client:{id:'producer-memory',name:'Produtor Memória'},opportunities:[],memories},
  message:'Como a soja da safra 2026/27 muda a negociação deste produtor?',
  intentHint:'ASK_COMMODITY',organizationId:'tenant-a',ownerId:'owner-a',conversationId:'memory-scope',now
 })
 const reasoning=response.advice.ai_reasoning
 assert.deepEqual(reasoning.decision_interview.material_missing_information,['target_price','decision_window'])
 assert.deepEqual(reasoning.memory_refs,[])
 assert.deepEqual(reasoning.premises.confirmed_memory_refs,[])
 assert.equal(reasoning.run.capabilities_used.includes('CONFIRMED_MEMORY'),false)
 assert.equal(reasoning.run.capability_results.find(item=>item.capability==='CONFIRMED_MEMORY')?.status,'NO_DATA')
})

test('mercado + produtor — perfil vencido não é apresentado nem usado como confirmado',()=>{
 const response=capabilityRouter.buildClientMarketResponse({
  workspace:{marketSnapshots:[currentQuote],intentions:[]},
  context:{
   client:{id:'producer-expired',name:'Produtor Perfil Vencido',primaryProfile:'Analítico'},
   profile:{primaryProfile:'Analítico',assessedAt:'2025-01-01T12:00:00.000Z',validUntil:'2026-08-24T23:59:59.000Z'},
   opportunities:[],memories:[]
  },
  message:'Como a soja de hoje muda a negociação deste produtor?',
  intentHint:'ASK_COMMODITY',organizationId:'tenant-a',ownerId:'owner-a',conversationId:'expired-profile',now
 })
 const reasoning=response.advice.ai_reasoning
 const corpus=JSON.stringify({answer:response.advice.answer,thesis:reasoning.decision_thesis,commercial:reasoning.commercial_context})
 assert.doesNotMatch(corpus,/perfil confirmado (?:é )?analítico/i)
 assert.match(corpus,/perfil de decisão (?:está )?vencido/i)
 assert.equal(reasoning.facts_used.some(item=>item.source_type==='producer_profile'),false)
 assert.deepEqual(reasoning.premises.confirmed_profile,{status:'EXPIRED',valid_until:'2026-08-24T23:59:59.000Z'})
 assert.equal(reasoning.commercial_context.profile_status,'EXPIRED')
})

test('mercado + produtor — oportunidade de outra commodity e histórico não incorporado ficam fora das capacidades usadas',()=>{
 const response=capabilityRouter.buildClientMarketResponse({
  workspace:{marketSnapshots:[currentQuote],intentions:[]},
  context:{
   client:{id:'producer-opportunity',name:'Produtor Oportunidade'},
   opportunities:[{id:'opp-milho',title:'Venda de milho 2026/27',stage:'Diagnóstico',nextAction:'Definir lote de milho'}],
   businessHistory:[{id:'business-milho',product:'Milho',outcome:'won',value:90000}],
   memories:[]
  },
  message:'Como a soja da safra 2026/27 muda a negociação deste produtor?',
  intentHint:'ASK_COMMODITY',organizationId:'tenant-a',ownerId:'owner-a',conversationId:'irrelevant-opportunity',now
 })
 const reasoning=response.advice.ai_reasoning
 assert.doesNotMatch(response.advice.answer,/Venda de milho/)
 assert.equal(reasoning.commercial_context.opportunity_id,null)
 assert.equal(reasoning.facts_used.some(item=>item.id==='opp-milho'||item.id==='business-milho'),false)
 assert.equal(reasoning.run.capabilities_used.includes('OPPORTUNITY_PIPELINE'),false)
 assert.equal(reasoning.run.capabilities_used.includes('COMMERCIAL_HISTORY'),false)
 assert.equal(reasoning.run.capability_results.find(item=>item.capability==='OPPORTUNITY_PIPELINE')?.status,'NO_DATA')
 assert.equal(reasoning.run.capability_results.find(item=>item.capability==='COMMERCIAL_HISTORY')?.status,'NO_DATA')
})

test('mercado + produtor — seleção de oportunidade procura a ativa da commodity pedida',()=>{
 const response=capabilityRouter.buildClientMarketResponse({
  workspace:{marketSnapshots:[currentQuote],intentions:[]},
  context:{
   client:{id:'producer-opportunity-match',name:'Produtor Oportunidade Compatível'},
   opportunities:[
    {id:'opp-milho-first',title:'Venda de milho',stage:'Diagnóstico'},
    {id:'opp-soja-second',title:'Venda de soja',stage:'Validação',nextAction:'Validar preço-alvo da soja'}
   ],
   memories:[]
  },
  message:'Como a soja de hoje muda a oportunidade deste produtor?',
  intentHint:'ASK_COMMODITY',organizationId:'tenant-a',ownerId:'owner-a',conversationId:'relevant-opportunity',now
 })
 const reasoning=response.advice.ai_reasoning
 assert.equal(reasoning.commercial_context.opportunity_id,'opp-soja-second')
 assert.match(response.advice.answer,/Venda de soja/)
 assert.doesNotMatch(response.advice.answer,/Venda de milho/)
 assert.ok(reasoning.run.capabilities_used.includes('OPPORTUNITY_PIPELINE'))
 assert.equal(reasoning.run.capability_results.find(item=>item.capability==='OPPORTUNITY_PIPELINE')?.source_ref,'opp-soja-second')
})
