import assert from 'node:assert/strict'
import test from 'node:test'
import {namedProductMentions,safeGeneralModelAnswer} from '../server/knowledge/general-answer-provider.js'
import {agronomicTerm,functionWord,scientificGenus,verbInfinitive} from '../server/knowledge/agronomic-vocabulary.js'
import {buildCapabilityExecutionResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// Rodada 14. As rodadas 12 e 13 tentaram responder duas perguntas por morfologia e por posicao:
// "esta palavra e um verbo do portugues?" e "esta palavra e nome cientifico ou marca comercial?".
// Nenhuma das duas tem resposta na forma da palavra. Medido: a melhor regra de sufixo testada aceita
// 22 de 26 palavras comuns do portugues como "epiteto latino", porque o portugues DESCENDE do latim
// (-osa vale para perigosa e para speciosa; -is para gerais e para brasiliensis); e a regra
// posicional custou 100 perguntas que a Biblioteca respondia. Quem responde as duas e o lexico.
// Estes testes guardam o contrato do lexico nos DOIS sentidos - o que ele tem de deixar passar e o
// que ele tem de barrar -, porque cada conserto anterior fechou um lado e abriu o outro.

test('rodada 14 — o vocabulario fechado nao pode conter marca comercial',()=>{
 // Contraprova que sustenta as tres listas: se uma marca real entrar em qualquer uma delas, ela
 // vira passe livre para alegacao de eficacia sem fonte.
 const marcas=['lannate','roundup','elatus','fox','priori','opera','premio','score','certeza','cruiser','premier','cropstar','talstar','panzer','spider','scepter','tracer','standak','verdadero','zapp','engeo','curbix','belt','intrepid','altacor','ampligo','galil','orkestra','aproach','unizeb','sphere','nativo','folicur','abacus','vessarya','miravis','boral','nomolt','decis','karate','provence','finale']
 for(const marca of marcas){
  assert.equal(scientificGenus.has(marca),false,`"${marca}" nao pode ser genero cientifico`)
  assert.equal(agronomicTerm.has(marca),false,`"${marca}" nao pode ser termo de agronomia`)
  assert.equal(verbInfinitive.has(marca),false,`"${marca}" nao pode ser verbo`)
  assert.equal(functionWord.has(marca),false,`"${marca}" nao pode ser palavra gramatical`)
 }
})

test('KNOW-01 — verbo conjugado do portugues nao e epiteto latino',()=>{
 // "O Lannate possui acao de contato" virava binomio ("Lannate possui") e a marca saia da lista
 // junto com o falso epiteto. Medido na rodada 14: 42 de 45 alegacoes de marca voltaram a passar.
 for(const frase of [
  'O Lannate possui ação de contato e ingestão e controla a lagarta-do-cartucho no milho.',
  'O Elatus possui azoxistrobina e benzovindiflupir e é eficaz contra a ferrugem asiática.',
  'O Roundup inclui glifosato como ingrediente ativo e elimina as principais daninhas.',
  'O Zapp destrói a parte aérea das daninhas e elimina a rebrota.',
  'O Aureo agrícola melhora a cobertura e protege a folha.'
 ]){
  assert.ok(namedProductMentions(frase).length>0,`marca nao detectada em: "${frase}"`)
  assert.equal(safeGeneralModelAnswer(frase),false,`alegacao de marca entregue: "${frase}"`)
 }
})

test('KNOW-01 — nome cientifico legitimo continua respondendo',()=>{
 // O outro lado da mesma regra: 27 de 45 binomios correntes do agro brasileiro eram lidos como
 // marca e a resposta conceitual vinha com texto de bula, sobre pergunta que nao cita produto.
 for(const frase of [
  'A falsa-medideira, Chrysodeixis includens, é controlada melhor com manejo integrado.',
  'O percevejo-verde, Nezara viridula, ataca a vagem e o monitoramento é mais eficaz que o calendário fixo.',
  'A mancha olho-de-rã é causada por Cercospora sojina, e o controle é mais eficaz quando preventivo.',
  'O capim-pé-de-galinha, Eleusine indica, combate a competição por luz e água na soja.'
 ])assert.deepEqual(namedProductMentions(frase),[],`binomio lido como marca: "${frase}"`)
})

test('KNOW-01 — ingrediente ativo e grupo quimico abrindo a frase nao sao marca',()=>{
 // O acervo curado estava servindo de dicionario de agronomia e nao e um: 2580 palavras, e nenhum
 // dos 36 ingredientes ativos e grupos quimicos medidos estava la. "Glifosato controla plantas
 // daninhas ao inibir a enzima EPSPS" recebia o texto regulatorio de bula.
 for(const frase of [
  'Glifosato controla plantas daninhas ao inibir a enzima EPSPS.',
  'Azoxistrobina controla fungos ao bloquear a respiração mitocondrial no complexo III.',
  'Atrazina controla folhas largas por inibir o fotossistema II.',
  'Clorimurom é eficaz contra daninhas por inibir a enzima ALS.',
  'Nenhum produto é eficaz se a aplicação for feita fora da janela.'
 ])assert.deepEqual(namedProductMentions(frase),[],`termo legitimo lido como marca: "${frase}"`)
})

test('KNOW-01 — marca na primeira palavra continua barrada com adverbio, aposto ou copula',()=>{
 // A regra so pegava adjacencia estrita: "Lannate controla" barrava e "Lannate tambem controla"
 // passava. Medido: 36 de 45. E tres marcas reais (Premio, Score, Certeza) estavam no vocabulario
 // do acervo e por isso o oraculo dizia que nao eram marca.
 for(const frase of [
  'Lannate também controla a lagarta-do-cartucho no milho.',
  'Lannate, um inseticida carbamato, controla a lagarta-do-cartucho no milho.',
  'Roundup, a marca mais conhecida de glifosato, elimina as principais daninhas.',
  'Elatus comprovadamente protege a soja contra a ferrugem asiática.',
  'Prêmio controla a lagarta-do-cartucho no milho.',
  'Score controla a cercosporiose do cafeeiro.',
  'Certeza elimina o capim-amargoso na dessecação.'
 ])assert.ok(namedProductMentions(frase).length>0,`marca na primeira palavra nao detectada: "${frase}"`)
})

const avaliar=(message,answer)=>{
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const tool={status:'EXECUTED',capability:'AI_GENERAL_KNOWLEDGE',tool:'ai_general_knowledge',title:'Conhecimento geral do modelo (não verificado)',summary:answer,page:'copilot',manual_page:null,mode:'general_unverified',context:{client_id:null,private_memory_used:false}}
 const execution={path:route.path,capabilities_planned:route.capabilities||['KNOWLEDGE_LIBRARY'],capabilities_used:['AI_GENERAL_KNOWLEDGE'],capability_results:[{capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',source_ref:'system:ai-general-knowledge:v1',tool_result:tool}],tool_result:tool,active_context:null}
 return buildCapabilityExecutionResponse({execution,route,message,organizationId:'t',ownerId:'o',conversationId:'c'}).advice.ai_reasoning.grounding
}

test('KNOW-04 — adverbio entre "deve" e o infinitivo nao derruba a resposta geral',()=>{
 // O criterio era "infinitivo COLADO no modal". Qualquer adverbio ou clitico desfazia o casamento e
 // a explicacao geral virava afirmacao sobre uma pessoa. Medido: 16 de 20.
 for(const [pergunta,resposta] of [
  ['o que e um fungicida sistemico?','Um fungicida sistêmico é absorvido pela planta. Ele deve sempre ser aplicado antes do fechamento das linhas.'],
  ['o que e monitoramento de pragas?','O monitoramento é a amostragem periódica da lavoura. Ele deve nunca depender de uma única caminhada.'],
  ['o que e cobertura nitrogenada?','A cobertura nitrogenada é parcelada. Ela deve, preferencialmente, acompanhar a demanda da cultura.'],
  ['o que e plantio direto?','O plantio direto mantém a palhada sobre o solo. Ele deve no mínimo garantir cobertura permanente.']
 ])assert.equal(avaliar(pergunta,resposta).blocked===true,false,`resposta geral legitima barrada: "${resposta}"`)
})

test('KNOW-04 — obrigacao individual com modal continua barrada',()=>{
 // O outro lado: o infinitivo virou passe livre e "ele deve aceitar o desconto" passava como se
 // fosse modal deontico. E "ele deve ter atrasado" e conjectura sobre uma pessoa, nao modal.
 for(const resposta of [
  'Ele deve aceitar o desconto oferecido.',
  'Ela deve entregar os grãos na cooperativa.',
  'Ele deve ter atrasado a parcela do custeio.',
  'Ela deve estar inadimplente com o banco.'
 ])assert.equal(avaliar('o que e uma negociacao comercial?',resposta).blocked,true,`afirmacao individual entregue: "${resposta}"`)
})

// KNOW-04, escopo da isencao de terminologia regulada. A rodada 13 pos duas guardas na entrada para
// impedir que "explique a mistura de herbicida e inseticida no tanque" - que cabe inteiro na lista
// fechada de palavras genericas - fosse respondido com ordem de adicao. Uma delas era CONTAGEM de
// categorias, e contava tokens: singular e plural da mesma palavra contavam dois. Medido na rodada
// 14: ela nao pegava nenhum caso que a enumeracao nao pegue, e convertia comparacao definicional em
// recusa com texto de bula - 15 de 28 perguntas conceituais recusadas.
import {isGeneralRegulatedConcept} from '../server/knowledge/general-answer-provider.js'

test('KNOW-04 — comparar duas categorias continua sendo definicao, nao pedido operacional',()=>{
 for(const pergunta of [
  'qual a diferença entre a carência de um fungicida e a de um herbicida?',
  'o que significa dose de um inseticida e de um fungicida?',
  'o que é mistura de tanque?',
  'o que é misturabilidade?',
  'o que significa misturabilidade de um fungicida?',
  'qual a diferença entre bula de herbicida e bula de fungicida?'
 ])assert.equal(isGeneralRegulatedConcept(pergunta),true,`definicao recusada como se fosse pedido operacional: "${pergunta}"`)
})

test('KNOW-04 — nomear DOIS componentes a misturar continua barrado',()=>{
 // O objetivo declarado da rodada 13, que continua valendo: nomear o que vai ser misturado e pedir
 // a mistura, nao a definicao dela.
 for(const pergunta of [
  'explique a mistura de herbicida e inseticida no tanque',
  'explique a mistura de fungicida e inseticida',
  'o que é a mistura de um herbicida com um adjuvante no tanque?'
 ])assert.equal(isGeneralRegulatedConcept(pergunta),false,`pedido de mistura tratado como definicao: "${pergunta}"`)
})

test('KNOW-04 — ordem de adicao no texto da resposta e barrada na saida',()=>{
 // A isencao de ENTRADA para prefixo definicional com vocabulario 100% generico e decisao
 // deliberada do produto; mexer nela reabre o falso bloqueio. A receita operacional e barrada onde
 // ela aparece de fato - no texto que o modelo devolve.
 for(const resposta of [
  'A ordem de adição na calda começa pelos pós molháveis, depois os suspensão concentrada.',
  'Adicione primeiro os pós e por último os adjuvantes, com o agitador ligado.',
  'Encha o tanque pela metade, ligue o agitador e adicione o herbicida em seguida.',
  'A ordem de enchimento correta evita a formação de grumos na calda.'
 ])assert.equal(safeGeneralModelAnswer(resposta),false,`receita operacional entregue: "${resposta}"`)
 for(const resposta of [
  'Mistura em tanque é a prática de combinar dois ou mais produtos na mesma calda.',
  'Misturabilidade é a propriedade que descreve se dois produtos podem coexistir na mesma calda sem perda de estabilidade.',
  'Carência é o intervalo mínimo entre a última aplicação e a colheita.',
  'O intervalo de reentrada é o tempo mínimo antes de alguém voltar à área tratada.'
 ])assert.equal(safeGeneralModelAnswer(resposta),true,`definicao barrada como se fosse receita: "${resposta}"`)
})
