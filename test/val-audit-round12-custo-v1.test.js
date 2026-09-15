import assert from 'node:assert/strict'
import test from 'node:test'
import {aiBudgetExhaustedStub,buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'

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
