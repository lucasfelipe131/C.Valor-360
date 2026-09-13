import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {registeredFactPresentation,registeredFactQuery} from '../server/registered-fact-query.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
import {validateProfilePhoto} from '../server/profile-photo.js'
import {readFileSync} from 'node:fs'

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

// VAL-FOTO-04: conferir só a assinatura deixava passar qualquer coisa. Oito bytes de PNG na frente
// de um shell script eram aceitos, guardados como foto do produtor e devolvidos depois com
// Content-Type image/png.
test('Foto de perfil — conteúdo que não é imagem não passa por assinatura',()=>{
 const fake=(prefix,corpo)=>Buffer.concat([Buffer.from(prefix),Buffer.from(corpo)])
 const casos=[
  ['png',fake([137,80,78,71,13,10,26,10],'#!/bin/sh\nrm -rf /\n'.repeat(20))],
  ['png',fake([137,80,78,71,13,10,26,10],'A'.repeat(400))],
  ['jpeg',Buffer.concat([Buffer.from([255,216,255]),Buffer.from('conteudo que nao e imagem '.repeat(10)),Buffer.from([255,217])])]
 ]
 for(const [tipo,bytes] of casos)
  assert.throws(()=>validateProfilePhoto(`data:image/${tipo};base64,${bytes.toString('base64')}`),/não corresponde ao formato/,tipo)
})

test('Foto de perfil — imagem de verdade continua sendo aceita',()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N8AAAAASUVORK5CYII='
 const jpeg='/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AP/Z'
 assert.equal(validateProfilePhoto('data:image/png;base64,'+png),'data:image/png;base64,'+png)
 assert.equal(validateProfilePhoto('data:image/jpeg;base64,'+jpeg),'data:image/jpeg;base64,'+jpeg)
 assert.equal(validateProfilePhoto(null),null)
})

// VAL-FOTO-02 e VAL-FOTO-03: o editor não tinha saída e o erro do navegador chegava em inglês.
test('Foto de perfil — o editor tem como desistir e a falha é explicada em português',()=>{
 const editor=readFileSync(new URL('../src/components/ProfileEditor.jsx',import.meta.url),'utf8')
 assert.match(editor,/Cancelar edição/)
 assert.match(editor,/const cancel=useCallback\(\(\)=>\{if\(busy\)return;setProfile\(saved\)/)
 // createImageBitmap devolve "The source image could not be decoded": nunca vai cru para a tela.
 assert.match(editor,/catch\{throw new Error\('Não foi possível abrir esta imagem/)
 // Falha na leitura inicial deixava a tela sem perfil e sem botão nenhum.
 assert.match(editor,/Tentar de novo/)
})

// VAL-FOTO-05: a foto de "Meu perfil" era gravada e nunca aparecia em lugar nenhum do produto.
test('Foto de perfil — a foto da conta aparece na topbar e na barra lateral',()=>{
 for(const arquivo of ['../src/components/Topbar.jsx','../src/components/Sidebar.jsx']){
  const fonte=readFileSync(new URL(arquivo,import.meta.url),'utf8')
  assert.match(fonte,/useAccountPhoto/,arquivo)
  assert.match(fonte,/accountPhoto\?<img src=\{accountPhoto\}/,arquivo)
 }
 const hook=readFileSync(new URL('../src/lib/use-account-photo.js',import.meta.url),'utf8')
 // Recarrega no mesmo evento que o editor já dispara ao salvar.
 assert.match(hook,/val:profile-updated/)
 assert.match(hook,/startsWith\('data:image\//)
})
