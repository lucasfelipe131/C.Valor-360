import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildPortfolioRadar} from '../server/portfolio-radar.js'

const now=Date.parse('2026-08-17T12:00:00.000Z')
const context=(id,days=2)=>({
 client:{id,name:`Produtor ${id}`,municipality:'São Luiz Gonzaga',commercial:{openPotential:200000,potentialTotal:300000,purchaseCurrentSeason:100000}},
 profile:{answers:{7:'segurança',14:'resultado de campo'},assessedAt:'2026-08-01T12:00:00Z'},
 opportunities:[{id:`o-${id}`,title:`Oportunidade ${id}`,stage:'Negociação',estimated_value:80000,next_action:'Confirmar decisão e área',next_action_at:new Date(now+days*86_400_000).toISOString(),updated_at:'2026-08-16T12:00:00Z',evidence:[{id:`ev-${id}`}]}],
 visits:[],interactions:[],businessHistory:[],signals:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],memories:[],priorRecommendations:[]
})

test('radar ordena somente contas com gatilho registrado e mostra o motivo',()=>{
 const radar=buildPortfolioRadar([context('a',-1),context('b',5)],{now,maxItems:5})
 assert.equal(radar.items.length,2)
 assert.equal(radar.items[0].clientId,'a')
 assert.equal(radar.items[0].priority,'agora')
 assert.match(radar.items[0].reason,/Prazo vencido/)
 assert.ok(radar.items[0].evidenceIds.includes('ev-a'))
 assert.match(radar.items[0].nextAction,/Confirmar decisão e área/)
})

test('radar nunca ultrapassa cinco contas e não automatiza contato ou CRM',()=>{
 const radar=buildPortfolioRadar(Array.from({length:8},(_,index)=>context(String(index),index-2)),{now,maxItems:9})
 assert.equal(radar.items.length,5)
 assert.equal(radar.maxItems,5)
 assert.equal(radar.policy.automaticContact,false)
 assert.equal(radar.policy.automaticCrmWrite,false)
 assert.equal(radar.policy.usesRecordedSignalsOnly,true)
})

test('conta sem prazo, visita, ação ou sinal não recebe urgência fabricada',()=>{
 const empty={client:{id:'empty',name:'Sem sinal'},profile:{answers:{}},opportunities:[],visits:[],interactions:[],businessHistory:[],signals:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],memories:[],priorRecommendations:[]}
 const radar=buildPortfolioRadar([empty],{now})
 assert.deepEqual(radar.items,[])
 assert.match(radar.emptyReason,/Nenhuma conta reuniu sinal/)
})

test('Dashboard expõe radar visível e backend o acrescenta à inteligência protegida',()=>{
 const dashboard=readFileSync(new URL('../src/pages/Dashboard.jsx',import.meta.url),'utf8')
 const component=readFileSync(new URL('../src/components/ConversionRadar.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
 assert.match(dashboard,/ConversionRadar/)
 assert.match(component,/RADAR DE CONVERSÃO DE HOJE/)
 assert.match(component,/Nada aqui dispara contato automático/)
 assert.match(component,/no máximo cinco contas/)
 assert.match(bootstrap,/ValRepository\.prototype\.getIntelligence/)
 assert.match(bootstrap,/buildPortfolioRadar/)
 assert.match(bootstrap,/portfolioRadar:true/)
})
