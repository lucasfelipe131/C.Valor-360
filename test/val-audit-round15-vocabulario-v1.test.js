import assert from 'node:assert/strict'
import test from 'node:test'
import {namedProductMentions} from '../server/knowledge/general-answer-provider.js'
import {selectKnowledge} from '../server/knowledge/library.js'
import {knownAgronomicTerm,scientificGenus,verbForm,verbInfinitive} from '../server/knowledge/agronomic-vocabulary.js'

// Rodada 15, ataque ao vocabulario fechado criado na rodada 14. Cinco achados, e o fio comum e o
// mesmo: o portao de marca perguntava "esta palavra esta em alguma lista?" e tratava a AUSENCIA como
// prova de que a palavra e marca. Na posicao 0 a maiuscula e gramatica, entao ausencia nao prova
// nada - e o proprio lexico de 343 infinitivos que a rodada 14 criou nao era consultado.
const marcado=texto=>namedProductMentions(texto).length>0

test('VOC-01 — oracao aberta por infinitivo nao tem a primeira palavra lida como marca',()=>{
 // E o registro em que o proprio acervo curado esta escrito. Medido na rodada 15: 5 dos 187 itens da
 // Biblioteca eram recusados por isso, e o consultor recebia "consulte a bula" numa pergunta que nao
 // cita produto nenhum - depois de duas chamadas pagas ao modelo.
 for(const texto of [
  'Rotacionar mecanismos de ação protege a vida útil da molécula.',
  'Monitorar a lavoura antes do limiar evita aplicação que não controla nada além do custo.',
  'Calibrar o pulverizador protege o resultado tanto quanto o produto.',
  'Reforçar a habilidade em vários momentos protege o aprendizado.',
  'Combinar um multissítio a modos específicos controla a erosão de eficácia.'
 ])assert.deepEqual(namedProductMentions(texto),[],`infinitivo lido como marca: "${texto}"`)
 assert.equal([...verbInfinitive].filter(verbo=>!knownAgronomicTerm(verbo)).length,0,'todo infinitivo do lexico tem de ser reconhecido pelo oraculo')
})

test('BINO-229 — genero cientifico fora da lista nao vira marca por causa de outra oracao',()=>{
 // A lista de generos e finita e o mundo tem milhares. O conserto nao foi alargar a lista: foi
 // exigir que o verbo de eficacia esteja na MESMA oracao do nome sinalizado. Alegacao de marca tem
 // os dois juntos por construcao; aqui sao duas oracoes, e nenhuma delas e alegacao.
 assert.deepEqual(namedProductMentions('A mancha da folha do trigo é causada por Zymoseptoria tritici. O manejo integrado combate a doença com rotação de culturas.'),[])
 for(const texto of [
  'A murcha é causada por Verticillium dahliae, que o manejo integrado combate com rotação.',
  'A ferrugem do cafeeiro, Hemileia vastatrix, é controlada com fungicida sistêmico.'
 ])assert.deepEqual(namedProductMentions(texto),[],`binomio lido como marca: "${texto}"`)
})

test('SIGLA — sigla tecnica em caixa alta nao e marca comercial',()=>{
 // Sigla e simbolo se escrevem sem minuscula; marca em prosa vem em caixa de titulo. Medido: 51 dos
 // 56 falsos positivos saem por essa guarda, sem reabrir nenhuma alegacao de marca.
 for(const texto of [
  'A análise mostra que o MAP e o DAP diferem na solubilidade e a escolha protege o rendimento.',
  'O ILPF combina lavoura, pecuária e floresta e o sistema protege o solo da erosão.',
  'O LMR é o limite máximo de resíduo e o respeito à carência protege a comercialização.',
  'A leitura do NDRE indica vigor e o manejo correto protege o potencial produtivo.'
 ])assert.deepEqual(namedProductMentions(texto),[],`sigla lida como marca: "${texto}"`)
})

test('PRIMEIRA-PALAVRA — o verbo de eficacia vale por proximidade, nao pela oracao inteira',()=>{
 // A rodada 14 abriu para a oracao INTEIRA e comprou o erro oposto: qualquer frase cuja primeira
 // palavra e maiuscula passava a ser marca se um verbo de eficacia aparecesse 20 palavras depois,
 // sobre outro sujeito. A janela de 8 foi MEDIDA no portao inteiro, nao escolhida.
 for(const texto of [
  'Sorriso concentra a maior área de soja do país e o manejo integrado controla a lagarta com monitoramento.',
  'Mato Grosso lidera a produção e a rotação de culturas combate a resistência das daninhas na região.',
  'Uma lavoura bem manejada controla a praga com menos aplicação ao longo da safra.',
  'Tolerância é diferente de resistência e a distinção protege a decisão de manejo do consultor.'
 ])assert.deepEqual(namedProductMentions(texto),[],`frase legitima lida como marca: "${texto}"`)
})

test('PRIMEIRA-PALAVRA — a alegacao de marca de verdade continua barrada',()=>{
 // Contraprova de tudo acima. "Lannate tem acao de contato e ingestao e controla..." e o caso em que
 // a janela de 7 falhava e a de 8 pega: por isso 8, e nao 7.
 for(const texto of [
  'Lannate tem ação de contato e ingestão e controla a lagarta-do-cartucho no milho.',
  'Lannate também controla a lagarta-do-cartucho no milho.',
  'Prêmio controla a lagarta-do-cartucho no milho.',
  'Elatus comprovadamente protege a soja contra a ferrugem asiática.',
  'Zapp elimina a rebrota das daninhas na dessecação.'
 ])assert.ok(marcado(texto),`alegacao de marca entregue: "${texto}"`)
})

test('VOC-02 — forma conjugada e quantificador no plural nao desligam a Biblioteca',()=>{
 // "quais modos de acao CONTROLAM a ferrugem?" perguntava sobre ferrugem, e o portao reprovava a
 // pergunta inteira porque "controlam" nao esta no acervo e nao e infinitivo. As formas conjugadas
 // sao GERADAS dos 343 infinitivos, nao listadas a mao.
 const agora=new Date('2026-08-30T12:00:00.000Z')
 const responde=pergunta=>selectKnowledge({query:pergunta,modules:['MCTX','MDI','MVV','MIA','MIC'],geography:'General',limit:1,now:agora}).status==='SELECTED'
 for(const pergunta of [
  'vários modos de ação controlam a ferrugem asiática da soja?',
  'quais os principais grupos de fungicidas contra a ferrugem asiática?',
  'quais os diversos modos de ação contra a ferrugem asiática?'
 ])assert.ok(responde(pergunta),`quantificador ou forma conjugada desligou a Biblioteca: "${pergunta}"`)
})

test('VOC-02 — a forma conjugada NAO entra no oraculo de marca',()=>{
 // "esta palavra e assunto?" e "esta palavra e marca?" sao perguntas diferentes. "opera" e forma de
 // "operar" E e um fungicida registrado: ela isenta o assunto e nao pode isentar a marca.
 assert.equal(verbForm.has('opera'),false,'homografo de marca nao pode entrar na deteccao de assunto')
 assert.ok(marcado('Opera controla a ferrugem asiática da soja.'),'a marca Opera tem de continuar barrada')
 assert.equal(knownAgronomicTerm('controlam'),false,'forma conjugada nao isenta o oraculo de marca')
 assert.ok(verbForm.has('controlam'),'mas isenta a deteccao de assunto')
})

test('rodada 15 — nenhuma marca real entra nas listas do vocabulario',()=>{
 // A contraprova da rodada 14, estendida com as marcas que sao palavra comum do portugues - a classe
 // que eu criei ao por functionWord no oraculo.
 const marcas=['lannate','roundup','elatus','fox','priori','opera','premio','score','certeza','cruiser','premier','cropstar','talstar','panzer','spider','scepter','tracer','standak','verdadero','zapp','engeo','curbix','belt','intrepid','altacor','ampligo','galil','orkestra','aproach','unizeb','sphere','nativo','folicur','abacus','vessarya','miravis','boral','nomolt','decis','karate','provence','finale','match','select','alto','primo','forte','maestro','triunfo','aurora']
 for(const marca of marcas){
  assert.equal(scientificGenus.has(marca),false,`"${marca}" nao pode ser genero`)
  assert.equal(verbForm.has(marca),false,`"${marca}" nao pode ser forma verbal`)
 }
})
