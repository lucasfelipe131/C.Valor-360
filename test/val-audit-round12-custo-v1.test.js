import assert from 'node:assert/strict'
import test from 'node:test'
import {aiBudgetExhaustedStub,aiProviderUnavailableStub,buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'

const rota={path:'fast',capabilities:['KNOWLEDGE_LIBRARY'],client_context_required:false}
const responder=aiUnavailableReason=>buildGeneralNoClientResponse({
 message:'O que é um contrato de barter?',
 route:rota,
 organizationId:'00000000-0000-4000-8000-000000000001',
 ownerId:'00000000-0000-4000-8000-000000000010',
 aiClient:null,
 aiUnavailableReason,
 now:new Date('2026-09-15T12:00:00.000Z')
})

test('o teto de IA para de culpar a pergunta do consultor', async () => {
 // Com o teto estourado a tela respondia EXATAMENTE como se a pergunta estivesse incompleta
 // ("Informe a cultura, o conceito ou a decisão geral"). O consultor reescrevia a pergunta de três
 // jeitos achando que o problema era ele. A causa era conhecida no servidor e jogada fora.
 const semCobertura=await responder('')
 const comTeto=await responder('BUDGET_EXHAUSTED')
 const leitura=resposta=>String(resposta.advice.ai_reasoning.recommended_strategy?.reading||'')

 assert.match(leitura(semCobertura),/Informe a cultura/)
 assert.notEqual(leitura(comTeto),leitura(semCobertura))
 assert.equal(leitura(comTeto),aiBudgetExhaustedStub)
 assert.doesNotMatch(leitura(comTeto),/Informe a cultura/)
 // Diz as três coisas que mudam o que ele faz a seguir: o que acabou, de quem é o limite e o que o
 // restaura. Mesmo padrão do teto da voz.
 assert.match(leitura(comTeto),/limite de uso da IA/i)
 assert.match(leitura(comTeto),/por consultor e por acesso/i)
 assert.match(leitura(comTeto),/novo login restaura/i)
})

test('o teto nao pede assunto nem cai no bloqueio de integridade', async () => {
 const comTeto=await responder('BUDGET_EXHAUSTED')
 const resultado=comTeto.advice.ai_reasoning.run.tool_result
 // required_inputs:['topic'] é o campo que AFIRMA que faltou assunto — não pode sobreviver quando
 // a causa foi orçamento.
 assert.deepEqual(resultado.required_inputs,[])
 assert.equal(resultado.title,'Limite de IA atingido')
 // Ponto load-bearing: noCoverageGuidance compara o texto BYTE A BYTE contra uma lista de frases
 // permitidas. Uma frase fora dessa lista vira afirmação factual, cai no grounding de claims e é
 // trocada pela mensagem de bloqueio de integridade.
 assert.equal(comTeto.advice.ai_reasoning.run.status,'completed')
})

test('sem teto estourado nada muda', async () => {
 const semCobertura=await responder('')
 const resultado=semCobertura.advice.ai_reasoning.run.tool_result
 assert.deepEqual(resultado.required_inputs,['topic'])
 assert.equal(resultado.title,'Orientação geral')
 assert.equal(semCobertura.advice.ai_reasoning.run.status,'completed')
})

const provedorQuebrado=status=>({responses:{create:async()=>{const erro=new Error('provedor indisponível');erro.status=status;erro.headers={'retry-after':'30'};throw erro}}})
const responderComProvedor=aiClient=>buildGeneralNoClientResponse({
 message:'O que é um contrato de barter?',
 route:rota,
 organizationId:'00000000-0000-4000-8000-000000000001',
 ownerId:'00000000-0000-4000-8000-000000000010',
 aiClient,
 aiModel:'gpt-5-mini',
 now:new Date('2026-09-15T12:00:00.000Z')
})

test('queda do provedor deixa de parecer pergunta incompleta', async () => {
 // Provedor em 500 ou em 429 devolvia EXATAMENTE o texto de "a Biblioteca não cobre este assunto",
 // com required_inputs ['topic'] — o campo que afirma que faltou assunto. O consultor reformulava
 // a pergunta contra uma indisponibilidade temporária.
 for(const status of [500,429]){
  const resposta=await responderComProvedor(provedorQuebrado(status))
  const ia=resposta.advice.ai_reasoning
  assert.equal(String(ia.recommended_strategy?.reading||''),aiProviderUnavailableStub,`status ${status}`)
  assert.doesNotMatch(String(ia.recommended_strategy?.reading||''),/Informe a cultura/)
  assert.equal(ia.run.tool_result.title,'IA indisponível')
  assert.deepEqual(ia.run.tool_result.required_inputs,[])
  // Mesmo ponto load-bearing do teto: a frase precisa estar na lista byte a byte, senão vira
  // afirmação factual e o consultor lê a mensagem de bloqueio de integridade.
  assert.equal(ia.run.status,'completed')
 }
})

test('a queda do provedor existe para o operador, nao so para o consultor', async () => {
 // O turno inteiro saía com outcome "ok" e zero evento de erro: ninguém ficava sabendo que a IA
 // esteve fora. As duas chaves já são permitidas no contrato de observabilidade.
 const resposta=await responderComProvedor(provedorQuebrado(429))
 assert.equal(resposta.responseMetadata.aiProviderStatus,429)
 assert.equal(resposta.responseMetadata.aiProviderRetryAfterSeconds,30)
})

test('as tres causas de resposta vazia sao distinguiveis', async () => {
 const semCobertura=await responder('')
 const comTeto=await responder('BUDGET_EXHAUSTED')
 const semProvedor=await responderComProvedor(provedorQuebrado(500))
 const leitura=resposta=>String(resposta.advice.ai_reasoning.recommended_strategy?.reading||'')
 const textos=new Set([leitura(semCobertura),leitura(comTeto),leitura(semProvedor)])
 assert.equal(textos.size,3,'sem cobertura, teto estourado e provedor fora do ar não podem ler igual')
})
