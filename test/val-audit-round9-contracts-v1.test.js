import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {registeredFactPresentation,registeredFactQuery} from '../server/registered-fact-query.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'

// FATO-01: nome de produtor fora da carteira era descartado em silêncio e a consulta rodava sobre o
// produtor aberto — a frase de talhão não traz nome, então a troca era invisível para o consultor.
test('Fato registrado — substantivo-entidade sozinho não é nome de produtor', () => {
 for(const message of ['Quantos hectares a fazenda planta de milho?','Quantos hectares o produtor planta de milho?','Quantos hectares essa propriedade planta de soja?','Quantos hectares de milho ele tem?'])
  assert.equal(extractNaturalClientReference(message).kind,'NONE',message)
})

test('Fato registrado — nome próprio continua sendo nome, inclusive nome de fazenda', () => {
 assert.equal(extractNaturalClientReference('Quantos hectares o Sirlei planta de milho?').reference,'Sirlei')
 // O qualificador ("cliente", "fazenda") já era removido antes desta rodada; o que importa é que o
 // nome sobrevive como candidato em vez de virar substantivo comum.
 for(const message of ['Abre o cliente Fazenda Boa Vista.','Abre a Fazenda Boa Vista.','Quantos hectares a Fazenda Boa Vista planta de milho?']){
  const reference=extractNaturalClientReference(message)
  assert.equal(reference.kind,'AUTHORIZED_NAME_CANDIDATE',message)
  assert.match(reference.reference,/Boa Vista/,message)
 }
})

test('Fato registrado — a frase de talhão nomeia o produtor dono do número', () => {
 const presentation=registeredFactPresentation({
  query:registeredFactQuery('Quantos hectares planta de milho?'),
  client:{id:'ivo',name:'Ivo Dallagnol'},
  properties:[{id:'p1',name:'Fazenda Boa Vista',fields:[{id:'f1',name:'Talhão Sede',seasons:[{crop:'Milho',season:'2223V',areaHa:33}]}]}],
 })
 assert.match(presentation.answer,/^Ivo Dallagnol:/)
 assert.match(presentation.answer,/33 ha de Milho/)
})

// FATO-02: cultura sem cadastro derrubava a rota com HTTP 400 e mensagem interna.
test('Fato registrado — ausência é declarada, não é conteúdo sem suporte', () => {
 const presentation=registeredFactPresentation({query:registeredFactQuery('Quantos hectares planta de milho?'),client:{id:'nilo',name:'Nilo Vargas'}})
 assert.equal(presentation.primaryFound,false)
 assert.match(presentation.answer,/Informação ausente: área de milho/)
 const grounding=evaluateResponseGrounding({question:'Quantos hectares o Nilo planta de milho?',answer:presentation.answer,domain:'AGRONOMY',evidence:[],activeProducerId:'nilo',tenantId:'t1',ownerId:'o1'})
 assert.ok(grounding.claim_ledger.length&&grounding.claim_ledger.every(item=>item.supported),'a ausência declarada não afirma nada sobre o produtor')
 assert.ok(grounding.claim_ledger.some(item=>item.reason_code==='DECLARED_INFORMATION_GAP'))
 assert.equal(grounding.unsupported_claims.length,0)
})
