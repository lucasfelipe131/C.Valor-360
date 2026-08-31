import test from 'node:test'
import assert from 'node:assert/strict'
import {GrainRepository} from '../server/grain-repository.js'

const futureDate=days=>new Date(Date.now()+days*86_400_000).toISOString().slice(0,10)

test('fallback SOG persiste as três fontes e deriva oportunidades no mesmo login',async()=>{
 let store={imports:[{tenantId:'tenant',ownerId:'owner-1',clients:[{id:'producer-1',name:'Produtor Um',municipality:'Cascavel',cultures:'Soja, Milho'}]}],grains:{profiles:[],intentions:[],marketSnapshots:[]}}
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
 let store={imports:[{tenantId:'tenant',ownerId:'owner-1',clients:[{id:'producer-1',name:'Produtor Um'}]}],grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const repository=new GrainRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:'tenant'})
 const draft=await repository.saveIntent({clientId:'producer-1',commodity:'milho',direction:'sell',volume:100,volumeUnit:'sc_60kg',targetPrice:null,priceUnit:'BRL/sc_60kg',deliveryStart:null,deliveryEnd:null,deliveryLocation:'',qualitySpecs:'',status:'draft',confidence:35,source:'consultant_interview',sourceDetails:'',notes:'',observedAt:new Date().toISOString()},'owner-1')
 const monitored=await repository.saveIntent({clientId:'producer-1',commodity:'soja',direction:'sell',volume:50,volumeUnit:'t',targetPrice:null,priceUnit:'BRL/t',deliveryStart:null,deliveryEnd:null,deliveryLocation:'',qualitySpecs:'',status:'monitoring',confidence:65,source:'consultant_interview',sourceDetails:'',notes:'',observedAt:new Date().toISOString()},'owner-1')
 assert.equal((await repository.getWorkspace('owner-2')).intentions.length,0)
 await assert.rejects(()=>repository.updateIntentStatus(draft.id,'confirmed','owner-1'),error=>error.statusCode===409)
 await assert.rejects(()=>repository.updateIntentStatus(monitored.id,'negotiating','owner-1'),error=>error.statusCode===409)
 assert.deepEqual((await repository.getWorkspace('owner-1')).intentions.map(item=>item.status),['draft','monitoring'])
})

test('fallback SOG rejeita produtores e perfis cross-tenant, cross-owner, unscoped e conflitantes',async()=>{
 const store={
  imports:[
   {tenantId:'tenant-a',ownerId:'owner-a',clients:[{id:'own',name:'Produtor A'}]},
   {tenantId:'tenant-b',ownerId:'owner-a',clients:[{id:'tenant-b',name:'Produtor B'}]},
   {tenantId:'tenant-a',ownerId:'owner-b',clients:[{id:'owner-b',name:'Produtor C'}]},
   {ownerId:'owner-a',clients:[{id:'unscoped',name:'Sem tenant'}]},
   {tenantId:'tenant-a',organizationId:'tenant-b',ownerId:'owner-a',clients:[{id:'conflict',name:'Conflito'}]},
   {tenantId:'tenant-a',ownerId:'owner-a',clients:[{id:'nested-conflict',name:'Nested',tenantId:'tenant-b'}]}
  ],
  grains:{profiles:[
   {id:'profile-own',tenantId:'tenant-a',ownerId:'owner-a',clientId:'profile-only',clientName:'Perfil A'},
   {id:'profile-tenant-b',tenantId:'tenant-b',ownerId:'owner-a',clientId:'profile-b',clientName:'Perfil B'},
   {id:'profile-owner-b',tenantId:'tenant-a',ownerId:'owner-b',clientId:'profile-c',clientName:'Perfil C'},
   {id:'profile-unscoped',ownerId:'owner-a',clientId:'profile-u',clientName:'Sem tenant'}
  ],intentions:[],marketSnapshots:[]}
 }
 const repository=new GrainRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:()=>{},tenantId:'tenant-a'})
 const workspace=await repository.getWorkspace('owner-a')
 assert.deepEqual(workspace.producers.map(item=>item.id).sort(),['own','profile-only'])
 assert.deepEqual(workspace.profiles.map(item=>item.id),['profile-own'])
 for(const item of [...workspace.producers,...workspace.profiles]){
  assert.equal(item.tenantId,'tenant-a')
  assert.equal(item.contextOwnerId,'owner-a')
 }
})
