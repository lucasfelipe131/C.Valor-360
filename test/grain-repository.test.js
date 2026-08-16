import test from 'node:test'
import assert from 'node:assert/strict'
import {GrainRepository} from '../server/grain-repository.js'

const futureDate=days=>new Date(Date.now()+days*86_400_000).toISOString().slice(0,10)

test('fallback SOG persiste as três fontes e deriva oportunidades no mesmo login',async()=>{
 let store={imports:[{clients:[{id:'producer-1',name:'Produtor Um',municipality:'Cascavel',cultures:'Soja, Milho'}]}],grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const repository=new GrainRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:'tenant'})
 await repository.saveProfile({clientId:'producer-1',commodities:['soja'],storageCapacityT:800,storageStructure:'Silo próprio',logisticsMode:'FOB',usualDeliveryLocations:'Cascavel',marketingNotes:'',source:'producer_confirmation',sourceDetails:'Visita',observedAt:new Date().toISOString(),confirmed:true},'owner-1')
 const intention=await repository.saveIntent({clientId:'producer-1',commodity:'soja',direction:'sell',season:'2026/27',volume:1000,volumeUnit:'sc_60kg',targetPrice:150,priceUnit:'BRL/sc_60kg',deliveryStart:futureDate(10),deliveryEnd:futureDate(20),deliveryLocation:'Cascavel',qualitySpecs:'',status:'confirmed',confidence:90,source:'producer_confirmation',sourceDetails:'Ligação',notes:'',observedAt:new Date().toISOString()},'owner-1')
 await repository.saveMarketSnapshot({commodity:'soja',marketKind:'spot',region:'Cascavel',price:152,priceUnit:'BRL/sc_60kg',deliveryStart:null,deliveryEnd:null,sourceName:'Fonte identificada',sourceType:'market_feed',sourceUrl:'https://example.com',confidence:95,notes:'',observedAt:new Date().toISOString(),status:'active'},'owner-1')
 const workspace=await repository.getWorkspace('owner-1')
 assert.equal(workspace.producers[0].name,'Produtor Um')
 assert.equal(workspace.profiles.length,1)
 assert.equal(workspace.intentions.length,1)
 assert.equal(workspace.marketSnapshots.length,1)
 assert.equal(workspace.opportunities.length,1)
 assert.equal(workspace.opportunities[0].clientName,'Produtor Um')
 assert.equal(workspace.governance.automaticTrading,false)
 assert.equal(workspace.summary.highPriority,1)
 await repository.updateIntentStatus(intention.id,'negotiating','owner-1')
 assert.equal((await repository.getWorkspace('owner-1')).intentions[0].status,'negotiating')
})

test('fallback SOG isola registros por proprietário e bloqueia promoção sem validação',async()=>{
 let store={imports:[{clients:[{id:'producer-1',name:'Produtor Um'}]}],grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const repository=new GrainRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:'tenant'})
 const draft=await repository.saveIntent({clientId:'producer-1',commodity:'milho',direction:'sell',volume:100,volumeUnit:'sc_60kg',targetPrice:null,priceUnit:'BRL/sc_60kg',deliveryStart:null,deliveryEnd:null,deliveryLocation:'',qualitySpecs:'',status:'draft',confidence:35,source:'consultant_interview',sourceDetails:'',notes:'',observedAt:new Date().toISOString()},'owner-1')
 const monitored=await repository.saveIntent({clientId:'producer-1',commodity:'soja',direction:'sell',volume:50,volumeUnit:'t',targetPrice:null,priceUnit:'BRL/t',deliveryStart:null,deliveryEnd:null,deliveryLocation:'',qualitySpecs:'',status:'monitoring',confidence:65,source:'consultant_interview',sourceDetails:'',notes:'',observedAt:new Date().toISOString()},'owner-1')
 assert.equal((await repository.getWorkspace('owner-2')).intentions.length,0)
 await assert.rejects(()=>repository.updateIntentStatus(draft.id,'confirmed','owner-1'),error=>error.statusCode===409)
 await assert.rejects(()=>repository.updateIntentStatus(monitored.id,'negotiating','owner-1'),error=>error.statusCode===409)
 assert.deepEqual((await repository.getWorkspace('owner-1')).intentions.map(item=>item.status),['draft','monitoring'])
})
