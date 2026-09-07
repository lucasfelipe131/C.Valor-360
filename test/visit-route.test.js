import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {buildDayItinerary,getNearbySuggestions,proposeRouteOrder,routeLocation,approximateDistanceKm} from '../src/lib/visit-route.js'

const date='2026-09-06'
const client=(id,lat=0,lng=0,extra={})=>({id,name:`Produtor ${id}`,location:{lat,lng},...extra})
const visit=(id,clientId,time='12:00',lifecycleStatus='PLANNED',extra={})=>({id,clientId,date,time,lifecycleStatus,...extra})
const stop=(visitId,location,lifecycle='PLANNED',extra={})=>({visitId,clientId:visitId,name:visitId,location,lifecycle,visit:{id:visitId,timeFlexible:true},...extra})

test('o dia inclui realizadas, aguardando revisão, atual atrasada e todas as planejadas sem canceladas',()=>{
 const clients=[client('done'),client('review'),client('active'),client('early'),client('late',0,0,{location:null})]
 const visits=[visit('late','late','16:00'),visit('cancel','done','10:00','CANCELLED'),visit('active','active','13:00','IN_PROGRESS',{date:'2026-09-05'}),visit('review','review','11:00','COMPLETED_PENDING_REVIEW'),visit('done','done','09:00','COMPLETED'),visit('early','early','14:00','PREPARED'),visit('tomorrow','early','09:00','PLANNED',{date:'2026-09-07'}),visit('future-active','early','09:00','IN_PROGRESS',{date:'2026-09-07'})]
 const result=buildDayItinerary({visits,clients,date})
 assert.deepEqual(result.map(item=>item.visitId),['done','active','review','early','late'])
 assert.deepEqual(result.map(item=>item.tone),['visited','current','current','planned','planned'])
 assert.deepEqual(result.map(item=>item.order),[1,2,3,4,5])
 assert.equal(result[4].location,null)
 assert.ok(result.every(item=>item.at instanceof Date))
 assert.equal(result[0].visit,visits[4])
 assert.equal(result[0].client,clients[0])
})

test('revisão pendente de dia anterior continua ativa em âmbar sem assumir localização atual',()=>{
 const clients=[client('review')]
 const stops=buildDayItinerary({date,clients,visits:[visit('review','review','10:00','COMPLETED_PENDING_REVIEW',{date:'2026-09-05'}),visit('future-review','review','10:00','COMPLETED_PENDING_REVIEW',{date:'2026-09-07'})]})
 assert.deepEqual(stops.map(item=>[item.visitId,item.tone,item.order]),[['review','current',1]])
 assert.deepEqual(getNearbySuggestions({stops,clients:[client('near',0,0.01)]}),[])
})

test('o dia civil usa fuso local e não a data UTC de scheduledAt',()=>{
 const moduleURL=new URL('../src/lib/visit-route.js',import.meta.url).href
 const output=execFileSync(process.execPath,['--input-type=module','-e',`import {buildDayItinerary} from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(buildDayItinerary({date:'2026-09-06',visits:[{id:'local-night',scheduledAt:'2026-09-07T01:30:00Z'},{id:'local-tomorrow',scheduledAt:'2026-09-07T04:00:00Z'}]}).map(s=>s.visitId)))`],{env:{...process.env,TZ:'America/Sao_Paulo'},encoding:'utf8'})
 assert.deepEqual(JSON.parse(output),['local-night'])
 assert.deepEqual(buildDayItinerary({date:'2026-02-30',visits:[visit('x','x')]}),[])
 assert.deepEqual(buildDayItinerary({date:'invalid',visits:[visit('x','x')]}),[])
})

test('coordenadas vazias ou não numéricas nunca viram pinos em zero',()=>{
 for(const location of [{lat:'',lng:0},{lat:' ',lng:0},{lat:null,lng:0},{lat:false,lng:0},{lat:[],lng:0},{lat:Infinity,lng:0},{lat:91,lng:0},{lat:0,lng:-181}])assert.equal(routeLocation(location),null)
 assert.deepEqual(routeLocation({latitude:'0',longitude:'-55.5'}),{lat:0,lng:-55.5})
 const stops=buildDayItinerary({date,visits:[visit('v1','missing'),visit('v2','blank'),visit('v3','ok')],clients:[client('blank',0,0,{location:{lat:'',lng:''}}),client('ok')]})
 assert.deepEqual(stops.map(item=>[item.order,item.location]),[[1,null],[2,null],[3,{lat:0,lng:0}]])
 assert.equal(stops[0].name,'Produtor não vinculado')
 assert.equal(approximateDistanceKm(null,{lat:0,lng:0}),null)
 assert.ok(Math.abs(approximateDistanceKm({lat:0,lng:0},{lat:0,lng:1})-111.195)<0.01)
})

test('sugestões usam o desvio de inserção restante e dados comerciais existentes',()=>{
 const stops=[stop('done',{lat:2,lng:2},'COMPLETED'),stop('current',{lat:0,lng:0},'IN_PROGRESS'),stop('next',{lat:0,lng:0.2})]
 const candidates=[client('near-current',0.025,0),client('along-route',0,0.1,{commercial:{opportunity:'Revisar análise de solo'}}),client('done',0,0.03),client('next',0,0.04),client('archived',0,0.05,{status:'archived'}),client('blank',0,0,{location:{lat:'',lng:''}}),client('far',10,10)]
 const result=getNearbySuggestions({stops,clients:candidates,origin:{lat:50,lng:50}})
 assert.deepEqual(result.map(item=>item.clientId),['along-route','near-current'])
 assert.equal(result[0].afterVisitId,'current')
 assert.equal(result[0].beforeVisitId,'next')
 assert.ok(result[0].detourKm<0.0001)
 assert.ok(result[1].detourKm>0)
 assert.equal(result[0].reason,'Registro comercial: Revisar análise de solo')
 assert.equal(result[0].reasonSource,'commercial.opportunity')
 assert.ok(result.every(item=>item.approximate&&/aproximada em linha reta/.test(item.distanceLabel)))
 assert.ok(result.every(item=>!('minutes' in item)&&!('driveMinutes' in item)&&!('eta' in item)))
})

test('sem atual usa origem informada ou primeira planejada; histórico não inventa posição atual',()=>{
 const clients=[client('near',0,0.01)]
 const done=stop('done',{lat:0,lng:0},'COMPLETED')
 assert.deepEqual(getNearbySuggestions({stops:[done],clients}),[])
 const fromOrigin=getNearbySuggestions({stops:[done],clients,origin:{lat:0,lng:0}})
 assert.equal(fromOrigin.length,1)
 assert.equal(fromOrigin[0].afterVisitId,null)
 assert.equal(fromOrigin[0].beforeVisitId,null)
 const fallback=getNearbySuggestions({stops:[done,stop('planned',{lat:0,lng:0})],clients})
 assert.equal(fallback[0].afterVisitId,'planned')
 assert.equal(fallback[0].reasonSource,'proximity')
 assert.deepEqual(getNearbySuggestions({stops:[stop('missing',null),stop('later',{lat:0,lng:0})],clients}),[])
 assert.deepEqual(getNearbySuggestions({stops:[],clients,origin:{lat:'',lng:''}}),[])
})

test('não calcula inserção atravessando sede ausente nem sugere clientes duplicados ou arquivados',()=>{
 const stops=[stop('current',{lat:0,lng:0},'IN_PROGRESS'),stop('unknown',null),stop('next',{lat:0,lng:0.2})]
 const result=getNearbySuggestions({stops,clients:[client('one',0,0.1),client('one',0,0.1),client('hidden',0,0.1,{archivedAt:'2026-09-01'})]})
 assert.equal(result.length,1)
 assert.equal(result[0].afterVisitId,'next')
 assert.equal(result[0].beforeVisitId,null)
 assert.ok(result[0].detourKm>10)
 assert.deepEqual(getNearbySuggestions({stops,clients:[client('one',0,0.1)],limit:0}),[])
 assert.deepEqual(getNearbySuggestions({stops,clients:[client('one',0,0.1)],maxKm:1}),[])
})

test('proposta reduz só o bloco flexível e conserva histórico, atual e compromissos fixos',()=>{
 const stops=[stop('done',{lat:0,lng:-1},'COMPLETED'),stop('current',{lat:0,lng:0},'IN_PROGRESS'),stop('far',{lat:0,lng:0.3}),stop('near',{lat:0,lng:0.1}),stop('middle',{lat:0,lng:0.2}),stop('fixed',{lat:0,lng:0.4},'PLANNED',{visit:{time:'15:00'}}),stop('last',{lat:0,lng:0.5})]
 const snapshot=structuredClone(stops)
 assert.deepEqual(proposeRouteOrder(stops),['done','current','near','middle','far','fixed','last'])
 assert.deepEqual(stops,snapshot)
 const clients=stops.map(item=>client(item.clientId,item.location.lat,item.location.lng))
 const visits=stops.map((item,index)=>visit(item.visitId,item.clientId,`${String(8+index).padStart(2,'0')}:00`,item.lifecycle,{timeFlexible:item.visit.timeFlexible===true}))
 const accepted=buildDayItinerary({date,visits,clients,orderedIds:proposeRouteOrder(stops)})
 assert.deepEqual(accepted.map(item=>item.visitId),['done','current','near','middle','far','fixed','last'])
 assert.deepEqual(accepted.map(item=>item.order),[1,2,3,4,5,6,7])
})

test('horários fixos não mudam nem com orderedIds; sem coordenadas a proposta é conservadora',()=>{
 const clients=[client('a',0,0.3),client('b',0,0.1),client('c',0,0.2)]
 const visits=[visit('a','a','09:00'),visit('b','b','10:00'),visit('c','c','11:00')]
 const stops=buildDayItinerary({date,visits,clients,orderedIds:['c','b','a']})
 assert.deepEqual(stops.map(item=>item.visitId),['a','b','c'])
 assert.deepEqual(proposeRouteOrder(stops,{origin:{lat:0,lng:0}}),['a','b','c'])
 assert.deepEqual(proposeRouteOrder([stop('a',{lat:0,lng:0.3}),stop('missing',null),stop('b',{lat:0,lng:0.1})],{origin:{lat:0,lng:0}}),['a','missing','b'])
})

test('ordem manual explícita move planejadas sem alterar horários nem o prefixo concluído e ativo',()=>{
 const clients=['done','current','review','a','b','c'].map(id=>client(id))
 const visits=[visit('done','done','08:00','COMPLETED'),visit('current','current','09:00','IN_PROGRESS'),visit('review','review','10:00','COMPLETED_PENDING_REVIEW'),visit('a','a','11:00'),visit('b','b','12:00','PREPARED'),visit('c','c','13:00')]
 const snapshot=structuredClone(visits)
 const orderedIds=['c','review','b','done','a','current']
 const defaultOrder=buildDayItinerary({date,visits,clients,orderedIds})
 const manualOrder=buildDayItinerary({date,visits,clients,orderedIds,allowManualOrder:true})
 assert.deepEqual(defaultOrder.map(item=>item.visitId),['done','current','review','a','b','c'])
 assert.deepEqual(manualOrder.map(item=>item.visitId),['done','current','review','c','b','a'])
 assert.deepEqual(manualOrder.map(item=>item.order),[1,2,3,4,5,6])
 assert.deepEqual(manualOrder.slice(3).map(item=>[item.visitId,item.at.getHours(),item.visit.time]),[['c',13,'13:00'],['b',12,'12:00'],['a',11,'11:00']])
 assert.deepEqual(visits,snapshot)
 assert.deepEqual(proposeRouteOrder(defaultOrder,{origin:{lat:0,lng:0}}),['done','current','review','a','b','c'])
})
