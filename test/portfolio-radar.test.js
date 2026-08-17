import assert from 'node:assert/strict'
import test from 'node:test'
import {buildPortfolioRadar,VAL_PORTFOLIO_RADAR_LIMIT} from '../src/lib/portfolio-radar.js'

const now='2026-08-17T12:00:00.000Z'
const clients=[
 {id:'p1',name:'João Pereira',municipality:'São Luiz Gonzaga',profileUpdatedAt:'2026-08-10T12:00:00Z',commercial:{potentialTotal:500000,purchaseCurrentSeason:300000}},
 {id:'p2',name:'Maria Souza',municipality:'Roque Gonzales',additionalNeed:'Rever o programa de milho',profileUpdatedAt:'2026-08-12T12:00:00Z',commercial:{}},
 {id:'p3',name:'Carlos Lima',municipality:'Bossoroca',commercial:{}}
]

const opportunities=[
 {id:'o1',databaseId:'11111111-1111-4111-8111-111111111111',clientId:'p1',title:'Expansão de milho',stage:'Negociação',value:180000,nextAction:'Confirmar a proposta condicionada',nextActionAt:'2026-08-16T12:00:00Z',updatedAt:'2026-08-15T12:00:00Z',stageEvidence:{type:'manual_advance'}},
 {id:'o2',clientId:'p2',title:'Manejo da soja',stage:'Diagnóstico',value:90000,nextActionAt:'2026-09-10T12:00:00Z',updatedAt:'2026-08-12T12:00:00Z'}
]

const visits=[
 {id:'v1',clientId:'p2',scheduledAt:'2026-08-19T13:00:00Z',objective:'Confirmar janela e critério de decisão',status:'Agendada'}
]

test('prazo vencido e negociação registrada aparecem no topo com evidência',()=>{
 const radar=buildPortfolioRadar({clients,visits,opportunities},{now})
 assert.equal(radar.items[0].clientId,'p1')
 assert.equal(radar.items[0].priority,'imediata')
 assert.match(radar.items[0].reason,/Expansão de milho/)
 assert.match(radar.items[0].reason,/vencida/i)
 assert.match(radar.items[0].action,/confirmar se a decisão continua ativa/i)
 assert.ok(radar.items[0].evidence.some(item=>item.sourceType==='opportunity'))
 assert.equal(radar.policy.generativeAiUsed,false)
 assert.equal(radar.policy.automaticContact,false)
})

test('visita e necessidade declarada geram ação específica sem texto genérico',()=>{
 const radar=buildPortfolioRadar({clients,visits,opportunities},{now})
 const item=radar.items.find(entry=>entry.clientId==='p2')
 assert.ok(item)
 assert.match(item.reason,/visita agendada/i)
 assert.match(item.reason,/Rever o programa de milho/i)
 assert.match(item.action,/Manejo da soja|próximo passo|Preparar/i)
 assert.ok(item.evidence.some(evidence=>evidence.sourceType==='visit'))
 assert.ok(item.evidence.some(evidence=>evidence.sourceType==='producer_questionnaire'))
})

test('conta sem sinal registrado não é inventada para completar a lista',()=>{
 const radar=buildPortfolioRadar({clients,visits,opportunities},{now})
 assert.equal(radar.items.some(item=>item.clientId==='p3'),false)
 assert.equal(radar.evaluatedAccounts,3)
})

test('radar nunca ultrapassa cinco contas e mantém ordenação determinística',()=>{
 const manyClients=Array.from({length:12},(_,index)=>({id:`x${index}`,name:`Produtor ${index}`,commercial:{potentialTotal:100000+index*1000,purchaseCurrentSeason:0}}))
 const first=buildPortfolioRadar({clients:manyClients,visits:[],opportunities:[]},{now})
 const second=buildPortfolioRadar({clients:manyClients,visits:[],opportunities:[]},{now})
 assert.equal(first.items.length,VAL_PORTFOLIO_RADAR_LIMIT)
 assert.deepEqual(first,second)
})

test('campos pessoais não entram no motivo, ação ou evidências',()=>{
 const privateClient={id:'private',name:'Produtor Privado',relationship:{family:'Informação familiar',favoriteTeam:'Time pessoal',personalNotes:'Pressionar por medo'},commercial:{potentialTotal:200000,purchaseCurrentSeason:100000}}
 const radar=buildPortfolioRadar({clients:[privateClient],visits:[],opportunities:[]},{now})
 const serialized=JSON.stringify(radar)
 assert.doesNotMatch(serialized,/Informação familiar|Time pessoal|Pressionar por medo/)
 assert.equal(radar.policy.sensitiveRelationshipFieldsUsed,false)
})
