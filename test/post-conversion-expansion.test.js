import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildPostConversionExpansion,hasRecentClosedBusiness} from '../server/post-conversion-expansion.js'

const now=Date.parse('2026-08-17T12:00:00Z')
const closedContext={client:{id:'p1',name:'Produtor'},businessHistory:[{id:'closed-1',event_type:'business.closed',product:'Produto já fechado',category:'Milho',value:120000,occurred_at:'2026-08-16T12:00:00Z'}],opportunities:[],properties:[]}
const grainWorkspace={
 profiles:[{id:'profile-1',clientId:'p1',commodities:['milho'],confirmedAt:'2026-08-01T12:00:00Z'}],
 intentions:[{id:'intent-1',clientId:'p1',clientName:'Produtor',commodity:'milho',direction:'sell',season:'2026/27',volume:1000,volumeUnit:'sc_60kg',targetPrice:85,priceUnit:'BRL/sc_60kg',deliveryStart:'2026-09-01',deliveryEnd:'2026-09-15',deliveryLocation:'São Luiz Gonzaga',status:'confirmed',confidence:90,source:'producer_confirmation',observedAt:'2026-08-16T12:00:00Z'}],
 marketSnapshots:[{id:'market-1',commodity:'milho',marketKind:'spot',region:'São Luiz Gonzaga',price:86,priceUnit:'BRL/sc_60kg',sourceName:'Cotação registrada',sourceType:'cooperative',confidence:90,observedAt:'2026-08-17T08:00:00Z',status:'active'}]
}

test('ciclo só é acionado por fechamento real recente',()=>{
 assert.equal(hasRecentClosedBusiness(closedContext,{now}),true)
 assert.equal(hasRecentClosedBusiness({businessHistory:[{event_type:'business.updated',occurred_at:'2026-08-16T12:00:00Z'}]},{now}),false)
 const empty=buildPostConversionExpansion({client:{id:'p1'},businessHistory:[]},{now})
 assert.equal(empty.status,'not_triggered')
 assert.deepEqual(empty.candidates,[])
})

test('intenção SOG confirmada vira descoberta pós-conversão com evidência',()=>{
 const result=buildPostConversionExpansion(closedContext,{now,grainWorkspace})
 assert.equal(result.status,'ready')
 const grain=result.candidates.find(item=>item.domain==='grains')
 assert.ok(grain)
 assert.match(grain.label,/Milho/)
 assert.match(grain.reason,/Intenção confirmada/)
 assert.ok(grain.evidenceIds.includes('business-closed:closed-1'))
 assert.ok(grain.evidenceIds.includes('sog-intent:intent-1'))
 assert.ok(grain.evidenceIds.includes('sog-market:market-1'))
 assert.equal(result.policy.automaticOpportunityCreation,false)
 assert.equal(result.policy.automaticContact,false)
})

test('perfil confirmado sem intenção gera pergunta de descoberta, não oportunidade',()=>{
 const result=buildPostConversionExpansion(closedContext,{now,grainWorkspace:{profiles:grainWorkspace.profiles,intentions:[],marketSnapshots:[]}})
 const candidate=result.candidates.find(item=>item.type==='grain_discovery')
 assert.ok(candidate)
 assert.match(candidate.reason,/não existe intenção ativa/)
 assert.match(candidate.caveat,/Perfil de cultura não equivale a intenção comercial/)
 assert.ok(candidate.evidenceIds.includes('sog-profile:profile-1'))
})

test('fechamento sem catálogo ou sinal SOG não inventa expansão',()=>{
 const result=buildPostConversionExpansion(closedContext,{now,grainWorkspace:null})
 assert.equal(result.status,'closed_without_supported_expansion')
 assert.deepEqual(result.candidates,[])
 assert.match(result.emptyReason,/não sustentam uma expansão específica/)
})

test('Estúdio exibe ciclo pós-conversão, preserva cadastro de decisores e consulta SOG só após fechamento',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/PostConversionExpansionPanel.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 const engine=readFileSync(new URL('../server/post-conversion-expansion.js',import.meta.url),'utf8')
 assert.match(studio,/PostConversionExpansionPanel/)
 assert.match(studio,/MultiDecisionMapPanel data=\{innovations\.multiDecisionMap\} client=\{client\} opportunities=\{data\.opportunities\|\|\[\]\} onSaved=\{reload\}/)
 assert.match(panel,/CICLO PÓS-CONVERSÃO/)
 assert.match(panel,/Nenhuma sugestão cria oportunidade, contato ou ordem automaticamente/)
 assert.match(bootstrap,/hasRecentClosedBusiness\(context\)\?await grainWorkspaceFor/)
 assert.match(bootstrap,/postConversionExpansion:buildPostConversionExpansion/)
 assert.match(engine,/buildValueBridge/)
 assert.match(engine,/buildGrainOpportunities/)
})
