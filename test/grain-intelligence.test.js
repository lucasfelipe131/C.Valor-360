import test from 'node:test'
import assert from 'node:assert/strict'
import {buildGrainOpportunities,normalizeGrainIntent,normalizeGrainMarketSnapshot,normalizeGrainProfile} from '../server/grain-intelligence.js'

const now=new Date('2026-08-15T12:00:00.000Z')
const intention={id:'intent-1',clientId:'producer-1',clientName:'Produtor Teste',commodity:'soja',direction:'sell',season:'2026/27',volume:1000,volumeUnit:'sc_60kg',targetPrice:150,priceUnit:'BRL/sc_60kg',deliveryStart:'2026-08-20',deliveryEnd:'2026-08-31',deliveryLocation:'Cascavel/PR',status:'confirmed',confidence:90,source:'producer_confirmation',observedAt:'2026-08-15T10:00:00.000Z'}

test('SOG prioriza intenção confirmada quando preço, fonte e janela estão alinhados',()=>{
 const marketSnapshots=[{id:'quote-1',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:152,priceUnit:'BRL/sc_60kg',sourceName:'Fonte identificada',sourceUrl:'https://example.com/cotacao',confidence:95,observedAt:'2026-08-15T09:00:00.000Z',status:'active'}]
 const [opportunity]=buildGrainOpportunities({intentions:[intention],marketSnapshots},{now})
 assert.equal(opportunity.priority.level,'high')
 assert.ok(opportunity.score>=75)
 assert.equal(opportunity.priceGapPercent,1.33)
 assert.equal(opportunity.marketReference.sourceName,'Fonte identificada')
 assert.equal(opportunity.reasonsVersion,'sog-rules-v1')
 assert.match(opportunity.nextAction,/Contatar o produtor agora/)
})

test('SOG converte saca de 60 kg para comparar com cotação por tonelada',()=>{
 const marketSnapshots=[{id:'quote-2',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:2550,priceUnit:'BRL/t',sourceName:'Feed validado',confidence:95,observedAt:'2026-08-15T11:00:00.000Z',status:'active'}]
 const [opportunity]=buildGrainOpportunities({intentions:[intention],marketSnapshots},{now})
 assert.equal(opportunity.priceGapPercent,2)
 assert.equal(opportunity.priority.level,'high')
})

test('sinal não confirmado, cotação vencida e janela passada nunca viram chamada automática',()=>{
 const draft={...intention,id:'intent-2',status:'draft',confidence:35,deliveryStart:'2026-08-01',observedAt:'2026-04-01T10:00:00.000Z'}
 const stale=[{id:'quote-old',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:170,priceUnit:'BRL/sc_60kg',sourceName:'Fonte antiga',confidence:80,observedAt:'2026-07-01T09:00:00.000Z',status:'active'}]
 const [opportunity]=buildGrainOpportunities({intentions:[draft],marketSnapshots:stale},{now})
 assert.ok(opportunity.score<=54)
 assert.notEqual(opportunity.priority.level,'high')
 assert.match(opportunity.nextAction,/Atualizar a janela/)
 assert.ok(opportunity.warnings.some(item=>/vencida/.test(item)))
 assert.ok(opportunity.warnings.some(item=>/reconfirme/.test(item)))
})

test('referência atual vence uma praça coincidente porém vencida',()=>{
 const quotes=[
  {id:'regional-old',commodity:'soja',region:'Cascavel/PR',price:170,priceUnit:'BRL/sc_60kg',sourceName:'Antiga',confidence:90,observedAt:'2026-06-01T10:00:00.000Z',status:'active'},
  {id:'fresh-nearby',commodity:'soja',region:'Paraná',price:151,priceUnit:'BRL/sc_60kg',sourceName:'Atual',confidence:90,observedAt:'2026-08-15T10:00:00.000Z',status:'active'}
 ]
 const [opportunity]=buildGrainOpportunities({intentions:[intention],marketSnapshots:quotes},{now})
 assert.equal(opportunity.marketReference.id,'fresh-nearby')
 assert.ok(opportunity.warnings.some(item=>/praça/.test(item)))
})

test('normalização exige evidência forte para intenção confirmada e proveniência para mercado',()=>{
 assert.throws(()=>normalizeGrainIntent({clientId:'p1',commodity:'soja',volume:100,status:'confirmed',confidence:65,source:'consultant_interview'}),/confirmação do produtor/)
 assert.throws(()=>normalizeGrainIntent({clientId:'p1',commodity:'soja',volume:100,status:'negotiating',confidence:90,source:'producer_confirmation'}),/nova intenção/)
 const normalized=normalizeGrainIntent({clientId:'p1',commodity:'milho',direction:'sell',volume:'1000',volumeUnit:'sc_60kg',status:'confirmed',confidence:90,source:'producer_confirmation',observedAt:'2025-08-15T10:00:00Z'})
 assert.equal(normalized.volume,1000)
 assert.equal(normalized.status,'confirmed')
 assert.throws(()=>normalizeGrainMarketSnapshot({commodity:'milho',region:'Cascavel',price:70,observedAt:'2025-08-15T10:00:00Z'}),/fonte/i)
 const market=normalizeGrainMarketSnapshot({commodity:'milho',region:'Cascavel/PR',price:70,sourceName:'Fonte X',sourceType:'market_feed',observedAt:'2025-08-15T10:00:00Z'})
 assert.equal(market.priceUnit,'BRL/sc_60kg')
})

test('perfil SOG reutiliza o produtor e rejeita culturas ou datas inválidas',()=>{
 const profile=normalizeGrainProfile({clientId:'p1',commodities:['soja','milho'],storageCapacityT:'1200',source:'producer_confirmation',observedAt:'2025-08-15'})
 assert.deepEqual(profile.commodities,['soja','milho'])
 assert.equal(profile.storageCapacityT,1200)
 assert.throws(()=>normalizeGrainProfile({clientId:'p1',commodities:['inventada']}),/cultura inválida/)
 assert.throws(()=>normalizeGrainProfile({clientId:'p1',observedAt:'data ruim'}),/data do perfil/)
})
