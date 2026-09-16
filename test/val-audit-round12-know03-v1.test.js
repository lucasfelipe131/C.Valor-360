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
 // A isenção é morfológica; estes casos existem para que ela não vire um buraco.
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
