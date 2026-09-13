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

// FATO-03: área citada num relato pode ser de outra pessoa. "O vizinho do João, o Ademar, planta
// 1200 ha de milho na divisa" entrava na resposta de "quantos hectares o João planta de milho".
test('Fato registrado — área de terceiro no relato não vira fato do produtor', () => {
 const presentation=registeredFactPresentation({
  query:{kind:'crop_area',crop:'milho',season:null},
  client:{id:'joao',name:'João Pereira'},
  declaredSeasons:[{season:'2627V',updatedAt:'2026-08-01T12:00:00Z',crops:[{crop:'Milho',areaHa:70}]}],
  narratives:[{id:'visit-1',source_type:'visit',observedAt:'2026-08-02T12:00:00Z',text:'O vizinho do João, o Ademar, planta 1200 ha de milho na divisa. O sócio dele tem 300 ha de milho.'}],
  now:new Date('2026-09-13T12:00:00Z')})
 assert.doesNotMatch(presentation.answer,/1200|Ademar/)
 assert.doesNotMatch(presentation.answer,/300 ha/)
 // Nada some em silêncio: o consultor é avisado de que houve relato deixado de fora.
 assert.match(presentation.action,/área de terceiro/)
 assert.match(presentation.action,/2 relatos citam/)
})

test('Fato registrado — relato sobre o próprio produtor continua entrando', () => {
 const presentation=registeredFactPresentation({
  query:{kind:'crop_area',crop:'milho',season:null},
  client:{id:'joao',name:'João Pereira'},
  declaredSeasons:[{season:'2627V',updatedAt:'2026-08-01T12:00:00Z',crops:[{crop:'Milho',areaHa:70}]}],
  narratives:[{id:'visit-2',source_type:'visit',observedAt:'2026-08-02T12:00:00Z',text:'O João plantou 55 ha de milho neste ano.'}],
  now:new Date('2026-09-13T12:00:00Z')})
 assert.match(presentation.answer,/55 ha de milho/)
 assert.doesNotMatch(presentation.action,/área de terceiro/)
})

// FATO-04: o único registro tinha quatro safras de idade e respondia uma pergunta no presente sem
// uma palavra sobre isso — o consultor lia 33 ha como a área atual.
test('Fato registrado — registro antigo declara a lacuna em vez de passar por atual', () => {
 const presentation=registeredFactPresentation({
  query:{kind:'crop_area',crop:'milho',season:null},
  client:{id:'ivo',name:'Ivo Dallagnol'},
  properties:[{id:'p1',name:'Fazenda Boa Vista',fields:[{id:'f1',name:'Talhão Sede',seasons:[{season:'2223V',crop:'Milho',areaHa:33,created_at:'2023-02-21T14:44:15Z'}]}]}],
  now:new Date('2026-09-13T12:00:00Z')})
 assert.equal(presentation.stale,true)
 assert.match(presentation.answer,/Informação ausente: registro de área de milho posterior a este\./)
 assert.match(presentation.action,/Confirme com o produtor a área de milho atual/)
 assert.match(presentation.keyUncertainty,/Não há registro de área de milho posterior a este/)
 // A frase da lacuna não pode carregar número nem ';': o contrato de grounding parte a resposta em
 // afirmações e derrubava a resposta inteira com 400.
 const gap=presentation.answer.split(/(?<=[.!?])\s+/).at(-1)
 assert.doesNotMatch(gap,/\d/)
 assert.doesNotMatch(gap,/;/)
})

test('Fato registrado — registro recente não recebe o aviso de lacuna', () => {
 const presentation=registeredFactPresentation({
  query:{kind:'crop_area',crop:'milho',season:null},
  client:{id:'ivo',name:'Ivo Dallagnol'},
  properties:[{id:'p1',name:'Fazenda Boa Vista',fields:[{id:'f1',name:'Talhão Sede',seasons:[{season:'2627V',crop:'Milho',areaHa:33,created_at:'2026-08-01T12:00:00Z'}]}]}],
  now:new Date('2026-09-13T12:00:00Z')})
 assert.equal(presentation.stale,false)
 assert.doesNotMatch(presentation.answer,/Informação ausente/)
 assert.equal(presentation.keyUncertainty,'')
})

// FATO-05: a palavra "safra" empurrava a intenção para ASK_AGRONOMIC e a pergunta pelo cadastro do
// produtor aberto era respondida como conceito geral, sem nunca consultar a área declarada.
test('Fato registrado — pergunta com safra específica continua sendo consulta de fato registrado', () => {
 for(const message of ['Qual a área de milho na safra 2526V?','Qual a área de milho do João na safra 2526V?','Qual a área de soja na safra 2627V?']){
  const query=registeredFactQuery(message)
  assert.ok(query,message)
  assert.equal(query.kind,'crop_area',message)
  assert.ok(query.season,message)
 }
})
