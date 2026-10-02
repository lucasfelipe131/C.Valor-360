import test from 'node:test'
import assert from 'node:assert/strict'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {generalAnswerTopicMatches} from '../server/knowledge/selection.js'
import {suppliedDimensionalArithmetic} from '../server/dimensional-arithmetic.js'

// Authored offline reproductions; no historical provider text or human scores.
const respond=(message,answer)=>buildGeneralNoClientResponse({message,route:routeSystemCapability({message,hasClient:false}),organizationId:'synthetic',ownerId:'synthetic',aiModel:'offline',aiClient:{responses:{create:async()=>({status:'completed',output_text:answer})}}})

test('a common concept at sentence start is not a named individual',async()=>{
 for(const [question,answer] of [
  ['O que é porcentagem?','Porcentagem é uma proporção expressa por cem.'],
  ['O que é amostragem?','Amostragem é a seleção de uma parte representativa de um conjunto.'],
  ['O que é logística?','Logística é a organização de fluxos de materiais e informações.']
 ])assert.equal((await respond(question,answer)).advice.answer,answer)
})

test('unit denominators do not assert ownership of land',async()=>{
 for(const unit of ['por hectare','por hectares','/ha']){
  const question='Como comparar despesas por hectare?'
  const answer=`Compare as despesas ${unit} usando a mesma unidade de área e o mesmo período.`
  assert.equal((await respond(question,answer)).advice.answer,answer)
 }
})

test('concept names and unit words cannot launder private assertions',async()=>{
 const question='O que é porcentagem?',prefix='Porcentagem é uma proporção expressa por cem. '
 for(const tail of ['Joana possui 350 hectares.','Porcentagem Silva possui 350 hectares.','Porcentagem possui saldo bloqueado.','Logística é uma pessoa inadimplente.','Ele tem dívida no banco.','A propriedade tem 350 hectares.','Ele paga R$ 30 por hectare.','Custos Santos vendeu a produção.']){
  assert.notEqual((await respond(question,prefix+tail)).advice.answer,prefix+tail,tail)
 }
})

test('communication verbs do not become topic anchors, while nouns and crop conflicts remain material',()=>{
 for(const [q,a] of [
  ['Como oferecer alternativas para uma reunião?','As alternativas para uma reunião incluem horários diferentes.'],
  ['Como escrever uma pergunta objetiva?','Uma pergunta objetiva aborda um assunto de cada vez.'],
  ['Como distinguir receita de lucro?','Receita e lucro são medidas diferentes.'],
  ['Como organizar tarefas urgentes?','Tarefas urgentes precisam de critérios de prioridade.']
 ])assert.equal(generalAnswerTopicMatches(q,a),true,q)
 assert.equal(generalAnswerTopicMatches('Como oferecer alternativas para uma reunião?','As sementes germinam no solo.'),false)
 assert.equal(generalAnswerTopicMatches('Como controlar cigarrinha no milho?','A cigarrinha da soja exige monitoramento.'),false)
 assert.equal(generalAnswerTopicMatches('Qual o risco do souvenir para a marca?','Uma marca pode ter risco.'),false)
})

test('available quantity is arithmetic only with explicit undelivered reservations and no others',()=>{
 for(const [stock,reserved] of [[800,275],[640,0],[200,200],[150,220]]){
  const q=`Tenho ${stock} sacas físicas e contrato de ${reserved} sacas ainda não entregue, sem outras reservas. Quanto está livre nesse cenário?`
  const r=suppliedDimensionalArithmetic(q)
  assert.equal(r?.status,'EXECUTED');assert.equal(r.output.free_sc,stock-reserved)
  assert.equal(routeSystemCapability({message:q,hasClient:false}).intent,'CALCULATE')
  assert.match(r.summary,/cenário informado/);assert.match(r.summary,/não confirma/i)
 }
 for(const q of [
  'Tenho 800 sacas físicas e contrato de 275 sacas. Quanto está livre?',
  'Tenho 800 sacas físicas e contrato de 275 sacas já entregue, sem outras reservas. Quanto está livre?',
  'Tenho 800 sacas físicas e contrato de 275 sacas ainda não entregue, mais 30 sacas reservadas. Quanto está livre?',
  'Tenho 800 sacas físicas e contrato de 275 sacas ainda não entregue, sem outras reservas. Qual preço devo usar hoje?'
 ])assert.notEqual(suppliedDimensionalArithmetic(q)?.calculator,'available_quantity_scenario',q)
})
