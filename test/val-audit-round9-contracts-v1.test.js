import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {registeredFactPresentation,registeredFactQuery} from '../server/registered-fact-query.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
import {validateProfilePhoto} from '../server/profile-photo.js'
import {readFileSync} from 'node:fs'
import {importedMunicipality} from '../server/repository.js'
import {visitPreparationEvidence,visitPreparationOutline} from '../server/ai-reasoning/visit-preparation-context.js'

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

// MAPA-001: o mapa nasce na visão do Brasil enquanto a carteira carrega. Se o consultor navegasse
// até a região dele nesse intervalo, o enquadramento automático rodava quando os pinos chegavam e
// jogava fora a navegação dele.
test('Mapa — gesto do consultor desliga o enquadramento automático',()=>{
 const mapa=readFileSync(new URL('../src/components/map/SatelliteMap.jsx',import.meta.url),'utf8')
 assert.match(mapa,/const userMovedRef=useRef\(false\)/)
 assert.match(mapa,/if\(fit&&!restoredViewRef\.current&&!userMovedRef\.current&&/)
 assert.match(mapa,/map\.on\('dragstart',markUserMove\)/)
 assert.match(mapa,/addEventListener\('wheel',markUserMove/)
 assert.match(mapa,/leaflet-control-zoom/)
 // Um mapa novo recomeça permitindo o enquadramento.
 assert.match(mapa,/userMovedRef\.current=false/)
})

// MAPA-002: parada e propriedade no mesmo ponto — só um nome cabe. O silenciado era o da parada, e
// como o pino numerado fica por cima, o produtor com visita agendada era o único sem nome no mapa.
test('Mapa — quem tem visita no dia mantém o nome; a propriedade no mesmo ponto é que cala',()=>{
 const rota=readFileSync(new URL('../src/components/map/RouteMap.jsx',import.meta.url),'utf8')
 const propriedade=rota.match(/\.\.\.visibleProperties\.filter\(item=>item\.location\).*$/m)[0]
 const parada=rota.match(/\.\.\.stops\.filter\(stop=>stop\.location\)\.map\(stop=>\(\{id:String\(stop\.visitId\).*$/m)[0]
 assert.match(propriedade,/caption:showNames&&!stops\.some\(/)
 assert.match(parada,/caption:showNames\?`\$\{stop\.order\}\. \$\{stop\.name\}`:null/)
 assert.doesNotMatch(parada,/visibleProperties\.some/)
})

// ADM-04: a importação comercial gravava o preenchimento automático "A definir" na coluna real
// clients.municipality, e a visão gerencial devolvia essa linha carimbada como REAL DATA.
test('Importação — preenchimento automático de município não vira cadastro',()=>{
 const fonte=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 const municipio=importedMunicipality
 for(const preenchimento of ['A definir','a definir','A Classificar','A confirmar','Aguardando cadastro','  A DEFINIR  '])
  assert.equal(municipio(preenchimento),null,preenchimento)
 for(const real of ['Palotina','Toledo','São Gabriel do Oeste','Assis Chateaubriand'])
  assert.equal(municipio(real),real)
 assert.equal(municipio(''),null)
 assert.equal(municipio(null),null)
 assert.equal(municipio(undefined),null)
 assert.equal(municipio('x'.repeat(200)).length,140)
 // O UPSERT preserva o município já cadastrado quando a reimportação chega sem ele.
 assert.match(fonte,/municipality=COALESCE\(EXCLUDED\.municipality,clients\.municipality\)/)
 assert.match(fonte,/importedMunicipality\(item\.municipality\)/)
})

// ADM-01: uma unidade com mais de 5.000 produtores nunca abria a tela gerencial, e a mensagem
// mandava reduzir o período — que nem entra na consulta de produtores.
test('Gerencial — excesso de produtores corta a lista em vez de derrubar a tela',()=>{
 const fonte=readFileSync(new URL('../server/management-service.js',import.meta.url),'utf8')
 // O 422 sobrou só para visitas e deslocamentos, onde o período é de fato a alavanca.
 assert.match(fonte,/if\(\[visitRows,routeRows\]\.some\(result=>result\.rows\.length>MAX_ROWS\)\)fail\('O período selecionado excede/)
 assert.doesNotMatch(fonte,/\[producerRows,visitRows,routeRows\]\.some/)
 assert.match(fonte,/const producersTruncated=producerRows\.rows\.length>MAX_ROWS/)
 // O total real vem de um COUNT e substitui a contagem da lista cortada.
 assert.match(fonte,/SELECT count\(\*\)::int AS total FROM clients c/)
 assert.match(fonte,/summarizeManagement\(\{producers,visits,routes\}\),producers:producerTotal/)
 // A mensagem cita os filtros que reduzem a carteira, nunca o período.
 const aviso=fonte.match(/producersTruncated\?`[^`]+`/)[0]
 assert.match(aviso,/Filtre por município ou por consultor/)
 assert.doesNotMatch(aviso,/período/)
})

const preparacaoSnapshot=(commitments,visits=[])=>({
 context_scope:{producer_id:'p1',tenant_id:'t1',owner_id:'o1'},
 relationship_context:{visits,interactions:[],commitments}
})
const wrapper=(id,data,observed='2026-09-01T12:00:00Z')=>({producerId:'p1',tenantId:'t1',ownerId:'o1',evidence_ref:{id},data,observed_at:observed})

// PREP-002: compromisso já concluído voltava como "Próximo passo registrado" e virava o foco
// declarado da próxima visita, com as três perguntas de ouro construídas em cima dele.
test('Preparação — compromisso concluído não vira o foco da próxima visita',()=>{
 const facts=visitPreparationEvidence(preparacaoSnapshot(
  [wrapper('c1',{description:'Enviar a proposta de calcário',status:'DONE',due_at:'2026-08-20T12:00:00Z'}),
   wrapper('c2',{description:'Levar o comparativo de custo',status:'ACCEPTED',due_at:'2026-08-25T12:00:00Z'})]))
 const concluido=facts.find(fact=>fact.source_ref==='c1')
 assert.equal(concluido.closed,true)
 assert.match(concluido.statement,/Compromisso concluído/)
 assert.doesNotMatch(concluido.statement,/Próximo passo registrado na visita/)
 const outline=visitPreparationOutline(facts)
 assert.doesNotMatch(outline.topic,/proposta de calcário/)
 assert.match(outline.topic,/comparativo de custo/)
 assert.equal(outline.focusRef,facts.find(fact=>fact.source_ref==='c2').id)
})

test('Preparação — o próximo passo da visita não ressuscita um compromisso já encerrado',()=>{
 const facts=visitPreparationEvidence(preparacaoSnapshot(
  [wrapper('c1',{description:'Enviar a proposta de calcário',status:'DONE'})],
  [wrapper('v1',{summary:'Conversamos sobre calcário.',next_commitment:'Enviar a proposta de calcário'})]))
 const visita=facts.find(fact=>fact.source_ref==='v1')
 assert.doesNotMatch(visita.statement,/Próximo passo registrado na visita/)
 assert.match(visita.statement,/já foi encerrado como compromisso/)
})

test('Preparação — compromisso em aberto continua sendo o próximo passo',()=>{
 const facts=visitPreparationEvidence(preparacaoSnapshot(
  [wrapper('c1',{description:'Enviar a proposta',status:'ACCEPTED'})],
  [wrapper('v1',{summary:'Conversa registrada.',next_commitment:'Levar o laudo de solo'})]))
 const visita=facts.find(fact=>fact.source_ref==='v1')
 assert.match(visita.statement,/Próximo passo registrado na visita: Levar o laudo de solo/)
 assert.equal(facts.every(fact=>fact.closed===false),true)
})

// PREP-001: o prazo do compromisso era tratado como data de validade da evidência, e o compromisso
// vencido — o que a preparação mais precisa mostrar — sumia do briefing.
test('Preparação — prazo de compromisso não é data de validade da evidência',()=>{
 const fonte=readFileSync(new URL('../server/memory/context-snapshot.js',import.meta.url),'utf8')
 const linha=fonte.split('\n').find(line=>line.includes("collectionItems(context.commitments,'commitment'"))
 assert.ok(linha)
 assert.doesNotMatch(linha,/validUntilKeys/)
 // Nenhuma outra coleção de relacionamento passou a expirar por acidente.
 assert.match(fonte.split('\n').find(line=>line.includes("collectionItems(context.interactions,'interaction'")),/dateKeys/)
})

// PREP-004: o corte fixo de 2 por tipo derrubava compromissos pendentes em silêncio.
test('Preparação — o briefing não corta compromissos em dois nem em silêncio',()=>{
 const fonte=readFileSync(new URL('../server/ai-reasoning/index.js',import.meta.url),'utf8')
 assert.match(fonte,/slice\(0,type==='commitment'\?12:2\)/)
 assert.match(fonte,/omittedCommitments\+=1/)
 assert.match(fonte,/candidate\.missing_information=omittedCommitments\?\['Compromissos registrados que não couberam neste resumo/)
 // A frase da lacuna não pode carregar número: o contrato de grounding derrubaria a preparação.
 const aviso=fonte.match(/\['Compromissos registrados que não couberam[^']*'\]/)[0]
 assert.doesNotMatch(aviso,/\d/)
 // O grupo de compromissos também deixou de ser cortado em 4 na montagem da evidência.
 assert.match(readFileSync(new URL('../server/ai-reasoning/visit-preparation-context.js',import.meta.url),'utf8'),/slice\(0,type==='commitment'\?12:4\)/)
})

// PREP-005: a mesma fonte entrava por dois caminhos e o painel de evidências mostrava o relato e o
// compromisso duplicados, com rótulos que se contradiziam.
test('Preparação — a mesma fonte não aparece duas vezes no painel de evidências',()=>{
 const fonte=readFileSync(new URL('../server/ai-reasoning/index.js',import.meta.url),'utf8')
 assert.match(fonte,/const seenRefs=new Set\(\)/)
 assert.match(fonte,/const canonicalRef=clean\(item\.source_ref\?\?item\.source_id\?\?item\.evidence_ref\?\.id,240\)/)
 assert.match(fonte,/if\(canonicalRef&&seenRefs\.has\(canonicalRef\)\)return \[\]/)
})

// PREP-006: preparação pedida pelo nome de outro produtor rodava sobre o produtor já aberto.
test('Preparação — o nome pedido é reconhecido em variantes naturais do pedido',()=>{
 for(const [mensagem,esperado] of [
  ['Prepara a visita do Sirlei','Sirlei'],
  ['prepara a proxima visita ao Sirlei','Sirlei'],
  ['monte a conversa de amanhã com a Marta','Marta'],
  ['prepara a visita para o Ivo','Ivo'],
  ['Prepare a próxima visita da Marta','Marta']
 ]){
  const referencia=extractNaturalClientReference(mensagem)
  assert.equal(referencia.kind,'EXPLICIT_NAME',mensagem)
  assert.equal(referencia.reference,esperado,mensagem)
 }
})

// NAV-06: o workspace era trocado ANTES da guarda e nada revertia — o consultor respondia que
// queria ficar e o menu passava a marcar outro contexto que a tela não tinha.
test('Navegação — cancelar a saída não troca o workspace',()=>{
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
 assert.match(app,/if\(!restoringNavigation\.current&&!permitNavigation\(\)\)return false/)
 assert.match(app,/const changeWorkspace=id=>\{if\(navigate\(workspaceEntryPoint\(id,currentUser\?\.role\)\)\)setWorkspace\(id\)\}/)
 // navigate precisa dizer que a navegação aconteceu.
 assert.match(app,/setPage\(next\);if\(next===page\)window\.requestAnimationFrame\(resetPageViewport\)\n  return true/)
})
