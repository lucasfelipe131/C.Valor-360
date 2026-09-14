import assert from 'node:assert/strict'
import test from 'node:test'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'

const registro='Visita concluida em 08/09/2026 na Fazenda Boa Vista.'
const evidencia=statement=>[{source_type:'visit',source_id:'v1',statement,evidence_type:'FACT',observed_at:'2026-09-08T12:00:00.000Z',direct_observation:true}]
const aterrada=({question,answer,statement=registro,activeProducerName='Joao Pereira'})=>evaluateResponseGrounding({
 question,
 answer,
 evidence:evidencia(statement),
 activeProducerName,
 now:new Date('2026-09-14T12:00:00.000Z')
}).passed

test('escrever a pergunta por extenso nao derruba a resposta', () => {
 // Mesma evidência, mesma resposta, todas as afirmações com suporte: só digitar o nome do produtor
 // fazia o portão de relevância exigir 50% de sobreposição sobre tokens que a resposta nunca teria.
 assert.equal(aterrada({question:'quando foi a ultima visita concluida?',answer:registro}),true)
 assert.equal(aterrada({question:'quando foi a ultima visita concluida do Joao Pereira?',answer:registro}),true)
})

test('a VAL pode usar o seletor que a propria pergunta usou', () => {
 // O eco literal do registro passava e o português natural não: "última" não está no registro.
 assert.equal(aterrada({question:'Quando foi a ultima visita concluida?',answer:'A ultima visita concluida foi em 08/09/2026 na Fazenda Boa Vista.'}),true)
})

test('o seletor nao autoriza trocar o registro escolhido', () => {
 // Seletor escolhe entre registros já selecionados; não inventa um que não foi selecionado.
 assert.equal(aterrada({question:'Quando foi a ultima visita?',answer:'A proxima visita esta marcada para 20/09/2026.'}),false)
})

test('nome do cadastro nao vira salvo-conduto para atributo sem evidencia', () => {
 // O vetor que decidiu o desenho: o nome vem do cadastro, que quem usa o sistema controla. Isentar
 // TOKEN a token transformaria o portão em passe-livre — bastaria gravar o produtor como "Joao
 // Pereira Inadimplente" para a palavra passar a se sustentar sozinha. Sai o nome INTEIRO.
 for(const palavra of ['inadimplente','negativado','falido','endividado','premium','exportador','devedor','processado']){
  const nome=`Joao Pereira ${palavra.charAt(0).toUpperCase()}${palavra.slice(1)}`
  assert.equal(
   aterrada({question:`quando foi a ultima visita concluida do ${nome}?`,answer:`A ultima visita concluida foi em 08/09/2026 na Fazenda Boa Vista e ele esta ${palavra}.`,activeProducerName:nome}),
   false,
   `"${palavra}" no nome do cadastro não pode sustentar a afirmação sobre o produtor`
  )
 }
})

test('atributo novo continua bloqueado mesmo com o nome na pergunta', () => {
 assert.equal(aterrada({question:'quando foi a ultima visita do Joao Pereira?',answer:'A ultima visita foi em 08/09/2026 e ele esta inadimplente.'}),false)
})

test('nome curto nao mutila palavra no meio', () => {
 // Sem fronteira de palavra um produtor chamado "Ana" partiria "analise" ao meio e o portão
 // passaria a julgar um texto que ninguém escreveu.
 assert.equal(aterrada({question:'qual a analise da Ana?',answer:'A analise pendente da Ana foi concluida.',activeProducerName:'Ana'}),false)
})

test('pergunta feita so do nome nao vira pergunta sem conteudo', () => {
 // Tirar o nome deixaria a pergunta sem termo material e ela cairia na saída de cumprimento, que
 // aceita qualquer resposta. Aí o nome volta a valer como conteúdo.
 assert.equal(aterrada({question:'Joao Pereira',answer:'A cotacao da soja hoje e de R$ 128,50 por saca.'}),false)
})
