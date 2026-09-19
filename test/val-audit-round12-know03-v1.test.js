import assert from 'node:assert/strict'
import test from 'node:test'
import {selectKnowledge} from '../server/knowledge/library.js'

// KNOW-03. O portao "assunto fora do acervo" reprovava a pergunta inteira quando UM unico termo de
// 5+ letras nao estivesse no vocabulario da Biblioteca. Com limit=1 - exatamente o que o chat usa -
// isso pulava os 198 itens sem pontuar nenhum. Medido: "resistencia de plantas daninhas" achava
// KI-112, e "como lidar com resistencia de plantas daninhas?" nao achava nada; "tratar" estava no
// acervo e "lidar", "manejar", "enfrentar", "combater", "rotacionar" e "abordar" nao. O acervo e
// prosa expositiva e nunca vai cobrir o leque de verbos com que se pergunta.
const now=new Date('2026-08-30T12:00:00.000Z')
const perguntar=query=>selectKnowledge({query,modules:['MCTX','MDI','MVV','MIA','MIC'],geography:'General',limit:1,now})?.items?.[0]||null

test('KNOW-03 — trocar o verbo da pergunta nao pode desligar a Biblioteca',()=>{
 const referencia=perguntar('como tratar resistência de plantas daninhas?')
 assert.ok(referencia,'pré-requisito: com o verbo do corpus a Biblioteca responde')
 for(const verbo of ['lidar com','manejar','enfrentar','combater']){
  const item=perguntar(`como ${verbo} resistência de plantas daninhas?`)
  assert.ok(item,`"${verbo}" não pode desligar a Biblioteca`)
  assert.equal(item.knowledge_item_id,referencia.knowledge_item_id,`"${verbo}" tem que chegar no mesmo item que "tratar"`)
 }
 assert.ok(perguntar('por que rotacionar mecanismos de ação ajuda contra resistência?'))
 assert.ok(perguntar('como abordar a construção de fertilidade do solo?'))
})

test('KNOW-03 — assunto que o acervo nao conhece continua sem resposta da Biblioteca',()=>{
 const foraDoAcervo=[
  'como configurar o roteador wifi da fazenda?',
  'qual a melhor linguagem de programação para um ERP?',
  'como declarar imposto de renda pessoa física?',
  'qual o melhor tratamento para enxaqueca crônica?',
  'como funciona a fotossíntese em plantas aquáticas de aquário?',
  'quem ganhou o campeonato brasileiro de futebol?',
  'como trocar a embreagem de um caminhão?',
  'qual a cotação do bitcoin hoje?',
  'qual a dosagem de paracetamol para uma criança?',
  'qual o salário médio de um agrônomo no Brasil?',
  'como funciona a aposentadoria de um produtor rural?',
  'qual o melhor horário para postar no instagram da revenda?',
  'como emitir a nota fiscal da venda de soja?',
  'como declarar o funrural na folha de pagamento?'
 ]
 for(const pergunta of foraDoAcervo){
  const item=perguntar(pergunta)
  assert.equal(item,null,`não pode responder "${pergunta}" com ${item?.knowledge_item_id} "${item?.title}"`)
 }
})

test('KNOW-03 — substantivo terminado em -ar/-er/-ir nao ganha a isencao de verbo',()=>{
 // A isenção é posicional. A primeira versão era morfológica (sufixo de infinitivo menos uma lista
 // de sufixos de substantivo) e a rodada 13 a derrubou: 60 de 60 perguntas fora do acervo voltaram a
 // ser respondidas com item curado, fonte SRC- e VERIFICADO 0.9 — "qual o risco do souvenir para a
 // marca?" recebia o guardrail FRAC de fungicida. Substantivo em -ar/-er/-ir é conjunto aberto e
 // nenhuma lista de sufixo fecha sobre ele.
 for(const pergunta of [
  'como configurar o celular corporativo da equipe?',
  'qual o calendário escolar do município?',
  'qual a potência do reator nuclear?',
  'quem é o titular da conta bancária?',
  'qual o valor do auxiliar de escritório?',
  'como funciona um filtro circular de piscina?',
  'qual o preço de um carro popular?',
  'quem é o mister do time de futebol?'
 ])assert.equal(perguntar(pergunta),null,`não pode responder "${pergunta}"`)
})

test('KNOW-03 — substantivo de assunto ausente do acervo continua vetando a pergunta',()=>{
 // "amostragem" não está no vocabulário da Biblioteca. O portão segue valendo para substantivo:
 // é o assunto, e assunto ausente não pode ser respondido por um item qualquer.
 assert.equal(perguntar('por que a amostragem de solo precisa respeitar a camada?'),null)
})


test('KNOW-03 — substantivo e antroponimo em posicao de assunto nunca sao isentos',()=>{
 // Corpus do ataque da rodada 13: o termo desconhecido é O ASSUNTO da pergunta, depois de
 // determinante. Antroponimo é conjunto aberto — Cesar, Valter, Gilmar, Wagner terminam em -ar/-er.
 const substantivos=['souvenir','cancer','revolver','hamster','caviar','jaguar','container','poster','talher','elixir','menir','nectar','paladar','avatar','bazar','altar','pomar','milhar','jantar','manjar']
 const nomes=['cesar','valter','gilmar','gleyber','wagner','wilmar','edinar']
 const moldes=['qual o risco do %s para a marca?','qual a margem do %s na venda?','qual o peso do %s na compra?']
 for(const termo of [...substantivos,...nomes]){
  for(const molde of moldes){
   const pergunta=molde.replace('%s',termo)
   const item=perguntar(pergunta)
   assert.equal(item,null,`respondeu "${pergunta}" com ${item?.knowledge_item_id} "${item?.title}"`)
  }
 }
})

test('KNOW-03 — a isencao de verbo vem do lexico, nao da posicao nem do sufixo',()=>{
 // A rodada 13 decidia pela POSICAO ("como LIDAR" isenta, "do LIDAR" nao) e a rodada 14 mediu o
 // preco: 100 perguntas que a Biblioteca respondia pararam de ser respondidas, porque as locucoes
 // mais comuns do portugues poem outra palavra no slot. E o buraco oposto seguia aberto: nome
 // comercial tambem termina em -ar/-er/-ir e tambem vem depois de "para" e "sem".
 // Contrato atual: verbo do lexico e isento em QUALQUER posicao; palavra fora do lexico nunca e
 // isenta, nem em slot verbal.
 for(const pergunta of [
  'qual a melhor forma de manejar a ferrugem asiática na soja?',
  'vale a pena combater o percevejo na soja?',
  'antes de combater o percevejo na soja, o que avaliar?',
  'é possível enfrentar a ferrugem asiática na soja?',
  'o produtor deveria manejar a resistência de plantas daninhas?',
  'dá pra manejar a ferrugem asiática na soja?'
 ])assert.ok(perguntar(pergunta),`verbo fora do slot verbal nao pode desligar a Biblioteca: "${pergunta}"`)

 // O outro lado: produto desconhecido em slot verbal continua vetando, com e sem artigo. Antes
 // dependia do artigo - "para Premier" respondia e "para o Premier" recusava, e o consultor nao
 // tinha como saber qual das duas respostas era a verdadeira.
 for(const produto of ['Premier','Cruiser','Cropstar','Talstar','imazetapir','clorfenapir']){
  for(const molde of ['existe restrição de aplicação para %s na cultura da soja?','da para fazer o tratamento de sementes da soja sem %s?','por que %s falhou no controle da ferrugem asiática da soja?']){
   const pergunta=molde.replace('%s',produto)
   const item=perguntar(pergunta)
   assert.equal(item,null,`respondeu "${pergunta}" com ${item?.knowledge_item_id} "${item?.title}"`)
   const comArtigo=molde.replace('%s',`o ${produto}`)
   assert.equal(perguntar(comArtigo),null,`o artigo nao pode mudar o veredito: "${comArtigo}"`)
  }
 }
})
