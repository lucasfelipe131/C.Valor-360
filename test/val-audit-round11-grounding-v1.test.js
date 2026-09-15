import assert from 'node:assert/strict'
import test from 'node:test'
import {evaluateReasoningGrounding,evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'

const registro='Visita concluida em 08/09/2026 na Fazenda Boa Vista.'
const evidencia=statement=>[{source_type:'visit',source_id:'v1',statement,evidence_type:'FACT',observed_at:'2026-09-08T12:00:00.000Z',direct_observation:true,producer_id:'p1'}]
// O nome só é escopo do turno quando há produtor selecionado: sem produtor, o chamador preenche o
// campo com um rótulo de tela ("Carteira"). Os três chamadores de produção passam id e nome juntos.
const aterrada=({question,answer,statement=registro,activeProducerName='Joao Pereira',activeProducerId='p1'})=>evaluateResponseGrounding({
 question,
 answer,
 evidence:evidencia(statement),
 activeProducerId,
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

test('o caminho profundo tambem conhece o escopo do turno', () => {
 // A correção anterior ligou o nome só no caminho rápido. No caminho profundo — onde vivem as
 // respostas do modelo — uma leitura que citasse o produtor continuava sendo descartada por
 // cauda semântica, porque o nome não está no texto do registro.
 const evidencia=[{source_type:'visit',source_id:'v1',statement:'Visita concluída em 08/09/2026 na Fazenda Boa Vista.',evidence_type:'FACT',observed_at:'2026-09-08T13:00:00.000Z',direct_observation:true,producer_id:'p1',tenant_id:'t1',owner_id:'o1'}]
 const avaliar=({activeProducerId='p1',activeProducerName='',question,reading})=>evaluateReasoningGrounding({
  question,
  evidence:evidencia,
  activeProducerId,
  activeProducerName,
  tenantId:'t1',
  ownerId:'o1',
  blocks:{'recommended_strategy.reading':reading},
  now:new Date('2026-09-14T12:00:00.000Z')
 })
 const pergunta='quando foi a visita concluída do João Pereira?'
 const leitura='A visita concluída do João Pereira foi em 08/09/2026 na Fazenda Boa Vista.'
 assert.deepEqual(avaliar({question:pergunta,reading:leitura}).unsupported_terms,['UNSUPPORTED_SEMANTIC_TAIL'])
 const comNome=avaliar({question:pergunta,activeProducerName:'João Pereira',reading:leitura})
 assert.deepEqual(comNome.unsupported_terms,[])
 assert.equal(comNome.question_relevance,'PASS')
})

test('rotulo de tela nao vira escopo do turno quando nao ha produtor', () => {
 // Sem produtor selecionado o chamador preenche o campo com "Carteira" (capability-executor.js).
 // Sem a guarda, essa palavra viraria contexto compartilhado em toda conversa de carteira.
 const evidencia=[{source_type:'visit',source_id:'v1',statement:'Visita concluída em 08/09/2026.',evidence_type:'FACT',observed_at:'2026-09-08T13:00:00.000Z',direct_observation:true,tenant_id:'t1',owner_id:'o1'}]
 const resultado=evaluateReasoningGrounding({
  question:'o que houve na visita concluída?',
  evidence:evidencia,
  activeProducerId:'',
  activeProducerName:'Carteira',
  tenantId:'t1',
  ownerId:'o1',
  blocks:{'recommended_strategy.reading':'A visita concluída da Carteira Premium foi em 08/09/2026.'},
  now:new Date('2026-09-14T12:00:00.000Z')
 })
 assert.ok(resultado.unsupported_claims.length,'sem produtor, o rótulo não pode sustentar nada')
})
