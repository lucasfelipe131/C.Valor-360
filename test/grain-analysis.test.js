import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzeProducerRequest,buildMarketBrief,loadPracaProfile,normalizeGrainAnalysisRequest,pracaMatches} from '../server/grain-analysis.js'

const now=new Date('2026-09-23T12:00:00.000Z')
const praca=loadPracaProfile()
const producer={id:'p1',name:'João da Silva',municipality:'São Luiz Gonzaga'}
const quote={id:'q1',commodity:'soja',marketKind:'spot',region:'São Luiz Gonzaga',price:140,priceUnit:'BRL/sc_60kg',sourceName:'Cotrisal',sourceUrl:'https://www.cotrisal.com.br/',confidence:70,observedAt:'2026-09-23T09:00:00.000Z',status:'active'}
const port={id:'q2',commodity:'soja',marketKind:'spot',region:'Paranaguá/PR',price:161.52,priceUnit:'BRL/sc_60kg',sourceName:'CEPEA',confidence:85,observedAt:'2026-09-22T18:00:00.000Z',status:'active'}

test('perfil da praça carrega com calendário, compradores e briefing datado',()=>{
 assert.equal(praca.id,'sao-luiz-gonzaga-rs')
 assert.ok(praca.commodities.soja.calendar.harvest.includes(4))
 assert.ok(praca.buyers.some(item=>/Coopatrigo/.test(item.name)))
 assert.ok(praca.marketBrief.references.every(item=>item.source&&item.observedAt))
 assert.ok(pracaMatches(praca,'São Luiz Gonzaga'))
 assert.ok(pracaMatches(praca,'Bossoroca/RS'))
 assert.equal(pracaMatches(praca,'Cascavel/PR'),false)
})

test('pedido do produtor exige produtor, grão, volume e objetivo válidos',()=>{
 assert.equal(normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:'1.250,5'}).volume,1250.5)
 assert.throws(()=>normalizeGrainAnalysisRequest({commodity:'soja',volume:100}),/produtor/)
 assert.throws(()=>normalizeGrainAnalysisRequest({clientId:'p1',commodity:'cafe',volume:100}),/grão válido/)
 assert.throws(()=>normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:0}),/volume/)
 assert.throws(()=>normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:10,objective:'lucro'}),/objetivo/)
 assert.throws(()=>normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:10,deliveryStart:'2026-12-01',deliveryEnd:'2026-11-01'}),/data final/)
 const request=normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:'3.000',targetPrice:'150,00',costPrice:'120',objective:'caixa',hasStorage:'sim',request:'Quero vender 3 mil sacas até março'})
 assert.equal(request.volume,3000)
 assert.equal(request.targetPrice,150)
 assert.equal(request.hasStorage,true)
 assert.equal(request.direction,'sell')
})

test('análise personalizada monta três alvos escalonados, base e dicas da praça',()=>{
 const request=normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:3000,targetPrice:150,costPrice:120,objective:'caixa',deliveryLocation:'São Luiz Gonzaga',deliveryStart:'2026-10-15',cashNeedBRL:200000,cashNeedDate:'2026-10-20'})
 const analysis=analyzeProducerRequest({request,producer,marketSnapshots:[quote,port],praca},{now})
 assert.equal(analysis.rulesVersion,'sog-analysis-v1')
 assert.equal(analysis.humanReviewRequired,true)
 assert.equal(analysis.praca.applies,true)
 assert.equal(analysis.praca.stage.key,'recovery')
 assert.equal(analysis.marketReading.reference.price,140)
 assert.equal(analysis.marketReading.basisSc,-21.52)
 assert.equal(analysis.marketReading.priceGapPercent,-6.67)
 assert.equal(analysis.marketReading.marginPercent,16.67)
 assert.equal(analysis.closingTargets.length,3)
 assert.deepEqual(analysis.closingTargets.map(item=>item.share),[50,30,20])
 assert.equal(analysis.closingTargets[0].price,140)
 assert.equal(analysis.closingTargets[1].price,150)
 assert.ok(analysis.closingTargets[2].price>150)
 assert.equal(analysis.closingTargets[0].volumeSc,1500)
 assert.ok(analysis.closingTargets[0].revenueBRL>=200000)
 assert.ok(analysis.tips.some(item=>item.scope==='praca'&&/Escalonar/.test(item.text)))
 assert.ok(analysis.tips.some(item=>/mais de 5% acima/.test(item.text)))
 assert.equal(analysis.scenarios.length,3)
 assert.ok(analysis.ladder.averagePriceSc>140)
 assert.match(analysis.headline,/6,7% abaixo do alvo/)
})

test('sem cotação registrada a análise declara a lacuna e não inventa preço',()=>{
 const request=normalizeGrainAnalysisRequest({clientId:'p1',commodity:'milho',volume:1000,objective:'equilibrio'})
 const analysis=analyzeProducerRequest({request,producer,marketSnapshots:[],praca},{now})
 assert.equal(analysis.marketReading.reference,null)
 assert.equal(analysis.closingTargets.length,0)
 assert.ok(analysis.dataGaps.some(item=>/Sem cotação registrada/.test(item)))
 assert.ok(analysis.dataGaps.some(item=>/Sem preço-alvo/.test(item)))
 assert.match(analysis.headline,/Faltam dados/)
})

test('cotação vencida ou de outra praça gera alerta; alvo atingido pede execução',()=>{
 const stale={...quote,id:'q3',region:'Cascavel/PR',price:155,observedAt:'2026-08-01T09:00:00.000Z'}
 const request=normalizeGrainAnalysisRequest({clientId:'p1',commodity:'soja',volume:500,targetPrice:150,objective:'margem',deliveryLocation:'São Luiz Gonzaga'})
 const analysis=analyzeProducerRequest({request,producer,marketSnapshots:[stale],praca},{now})
 assert.ok(analysis.alerts.some(item=>/vencida/.test(item)))
 assert.ok(analysis.alerts.some(item=>/difere do local de entrega/.test(item)))
 assert.ok(analysis.tips.some(item=>/já foi atingido/.test(item.text)))
 assert.deepEqual(analysis.closingTargets.map(item=>item.share),[25,35,40])
 assert.match(analysis.headline,/executar o Alvo 1/)
})

test('fora da praça mapeada as dicas regionais não são aplicadas',()=>{
 const request=normalizeGrainAnalysisRequest({clientId:'p9',commodity:'soja',volume:100,targetPrice:150,deliveryLocation:'Cascavel/PR'})
 const analysis=analyzeProducerRequest({request,producer:{id:'p9',name:'Outro',municipality:'Cascavel'},marketSnapshots:[{...quote,region:'Cascavel/PR'}],praca},{now})
 assert.equal(analysis.praca.applies,false)
 assert.ok(analysis.assumptions.some(item=>/fora da praça mapeada/.test(item)))
 assert.equal(analysis.tips.filter(item=>item.scope==='praca').length,0)
})

test('briefing de mercado separa referências datadas das cotações registradas e avisa quando envelhece',()=>{
 const fresh=buildMarketBrief({praca,marketSnapshots:[quote]},{now})
 assert.equal(fresh.brief.stale,false)
 assert.equal(fresh.governance.seededReferencesAreNotQuotes,true)
 const soja=fresh.commodities.find(item=>item.commodity==='soja')
 assert.equal(soja.registeredReference.price,140)
 assert.ok(soja.seededReferences.length>=3)
 assert.equal(soja.stage.key,'recovery')
 const old=buildMarketBrief({praca,marketSnapshots:[]},{now:new Date('2026-11-15T12:00:00.000Z')})
 assert.equal(old.brief.stale,true)
 assert.match(old.warning,/atualize as referências/)
 assert.equal(old.commodities.find(item=>item.commodity==='trigo').stage.key,'harvest')
})
