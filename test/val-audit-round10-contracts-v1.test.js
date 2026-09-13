import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildGrainOpportunities} from '../server/grain-intelligence.js'
import {dateOnly} from '../server/grain-repository.js'

const agora=new Date('2026-09-13T12:00:00Z')
const intencao=extra=>({id:'i1',clientId:'ivo',clientName:'Ivo Dallagnol',commodity:'soja',direction:'sell',season:'2026/27',
 volume:1000,volumeUnit:'t',targetPrice:130,priceUnit:'BRL/sc_60kg',deliveryLocation:'Palotina',status:'confirmed',
 confidence:80,source:'producer_confirmation',observedAt:'2026-09-10T12:00:00Z',...extra})
const cotacao=extra=>({id:'m1',commodity:'soja',marketKind:'spot',region:'Palotina',price:128,priceUnit:'BRL/sc_60kg',
 sourceName:'Boletim regional',sourceType:'manual_quote',confidence:80,observedAt:'2026-09-12T12:00:00Z',status:'active',...extra})

// GRAO-01: delivery_start é DATE no PostgreSQL e o driver devolve um objeto Date. Serializado virava
// "2026-08-01T00:00:00.000Z", e a conta de dias montava `${value}T23:59:59` em cima disso — data
// inválida, NaN, e o card escrevia "Janela de entrega começa em NaN dias".
test('Grãos — janela de entrega vencida avisa e nunca escreve NaN',()=>{
 for(const janela of ['2026-08-01','2026-08-01T00:00:00.000Z']){
  const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:janela,deliveryEnd:'2026-08-31'})],marketSnapshots:[cotacao()]},{now:agora})
  assert.doesNotMatch(JSON.stringify(op),/NaN/,janela)
  assert.ok(op.reasons.some(motivo=>/já iniciou ou venceu/.test(motivo)),janela)
  assert.ok(op.warnings.some(aviso=>/janela de entrega está vencida/.test(aviso)),janela)
 }
})

test('Grãos — janela futura continua contando os dias corretamente',()=>{
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-09-23'})],marketSnapshots:[cotacao()]},{now:agora})
 assert.ok(op.reasons.some(motivo=>/Janela de entrega começa em 11 dias/.test(motivo)),JSON.stringify(op.reasons))
 assert.equal(op.warnings.some(aviso=>/vencida/.test(aviso)),false)
})

test('Grãos — data impossível vira ausência declarada, não NaN',()=>{
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'sem data'})],marketSnapshots:[cotacao()]},{now:agora})
 assert.doesNotMatch(JSON.stringify(op),/NaN/)
 assert.ok(op.warnings.some(aviso=>/Sem janela de entrega/.test(aviso)))
})

// GRAO-02: matchingQuote só olhava commodity, praça e frescor. Um contrato futuro com entrega em
// maio/2028 servia de referência para uma entrega de agosto/2026 e a tela dizia que o preço-alvo
// tinha sido superado.
test('Grãos — cotação de outra janela de entrega não vence a da janela certa',()=>{
 const futuro=cotacao({id:'m2',marketKind:'futures',price:190,deliveryStart:'2028-05-01',deliveryEnd:'2028-05-31',sourceName:'Bolsa'})
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-08-01',deliveryEnd:'2026-08-31'})],marketSnapshots:[futuro,cotacao()]},{now:agora})
 assert.equal(op.marketReference.sourceName,'Boletim regional')
 assert.equal(op.marketReference.price,128)
 assert.equal(op.reasons.some(motivo=>/atingiu ou superou o preço-alvo/.test(motivo)),false)
})

test('Grãos — cotação sem janela declarada continua servindo de referência',()=>{
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-10-01',deliveryEnd:'2026-10-31'})],marketSnapshots:[cotacao()]},{now:agora})
 assert.equal(op.marketReference.id,'m1')
 assert.equal(op.warnings.some(aviso=>/outra janela de entrega/.test(aviso)),false)
})

test('Grãos — quando só existe cotação de outra janela, ela é usada e a tela diz isso',()=>{
 const futuro=cotacao({id:'m2',marketKind:'futures',price:190,deliveryStart:'2028-05-01',deliveryEnd:'2028-05-31'})
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-10-01',deliveryEnd:'2026-10-31'})],marketSnapshots:[futuro]},{now:agora})
 assert.equal(op.marketReference.id,'m2')
 assert.ok(op.warnings.some(aviso=>/outra janela de entrega/.test(aviso)&&/contrato futures/.test(aviso)),JSON.stringify(op.warnings))
})

// GRAO-03: o card renderizava só o primeiro aviso — "cotação vencida" e "reconfirme com o produtor"
// sumiam sem que nada indicasse que existiam outros.
test('Grãos — o card do roteiro mostra todos os avisos e conta os motivos que não couberam',()=>{
 const fonte=readFileSync(new URL('../src/components/SogWorkspace.jsx',import.meta.url),'utf8')
 assert.match(fonte,/\(opportunity\.warnings\|\|\[\]\)\.map\(warning=><p key=\{warning\} className="sog-warning">/)
 assert.doesNotMatch(fonte,/opportunity\.warnings\?\.\[0\]/)
 assert.match(fonte,/opportunity\.reasons\.length>3&&<li className="sog-more">/)
})

// GRAO-01, no repositório: a coluna DATE precisa sair como dia civil dos dois caminhos.
test('Grãos — o repositório normaliza a data de entrega para o dia civil',()=>{
 const fonte=readFileSync(new URL('../server/grain-repository.js',import.meta.url),'utf8')
 const dia=dateOnly
 assert.equal(dia(new Date('2026-08-01T00:00:00.000Z')),'2026-08-01')
 assert.equal(dia('2026-08-01'),'2026-08-01')
 assert.equal(dia('2026-08-01T00:00:00.000Z'),'2026-08-01')
 assert.equal(dia(null),null)
 assert.equal(dia(''),null)
 assert.equal(dia('amanhã'),null)
 assert.match(fonte,/deliveryStart:dateOnly\(row\.delivery_start\?\?row\.deliveryStart\)/)
})
