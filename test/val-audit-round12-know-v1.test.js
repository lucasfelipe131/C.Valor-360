import assert from 'node:assert/strict'
import test from 'node:test'
import {buildGeneralNoClientResponse,regulatedClaimStub} from '../server/decision-copilot/capability-executor.js'
import {namedProductMentions,regulatedBrandClaim,safeGeneralModelAnswer} from '../server/knowledge/general-answer-provider.js'

// Respostas que a VAL não pode entregar: afirmam eficácia, alvo, cultura ou superioridade de marca.
const reguladas=[
 'O Engeo Pleno S é um inseticida da Syngenta com tiametoxam e lambda-cialotrina, eficaz contra a cigarrinha do milho.',
 'O Fox Xpro tem desempenho superior ao Priori Xtra no controle da ferrugem asiática da soja, com efeito residual mais longo.',
 'O Priori Xtra é eficaz contra a ferrugem asiática em soja.',
 'O Lannate controla a lagarta-do-cartucho no milho.',
 'O Roundup Transorb pode ser usado em soja RR e controla as principais daninhas.',
 'O Standak Top protege a soja contra percevejo no início do ciclo.',
 'O Elatus é indicado para mancha-alvo na soja.',
 'Entre os dois, o Fox Xpro é melhor que o Elatus para ferrugem.',
 'O Vessarya é superior ao Aproach para ferrugem asiática.',
 'O produto XYZ-9000 é eficaz contra a lagarta.'
]

// Respostas legítimas que têm de continuar sendo entregues.
const legitimas=[
 'Contrato de barter é a operação em que insumos são entregues hoje e pagos depois com parte da colheita.',
 'A fotossíntese é o processo pelo qual a planta converte luz, água e gás carbônico em açúcares.',
 'A ferrugem asiática é uma doença fúngica que reduz a área foliar e antecipa a senescência.',
 'O manejo integrado de pragas combina monitoramento, nível de dano e diferentes táticas de controle.',
 'O controle da ferrugem é mais eficaz quando a aplicação é preventiva.',
 'Um fungicida multissítio é indicado para reduzir o risco de resistência.',
 'O monitoramento é superior ao calendário fixo como critério de decisão.',
 'A rotação de mecanismos de ação combate a seleção de resistência.',
 'No Cerrado, a calagem é indicada para corrigir a acidez.',
 'Nenhum produto é eficaz se a aplicação for feita fora da janela.'
]

test('afirmacao de eficacia ou superioridade de marca nao passa', () => {
 // Indicação de uso de marca em cultura ou alvo, desempenho e superioridade são campos de BULA, que
 // a governança de fontes atuais coloca em bloqueio externo. O portão falhava FECHADO para dose e
 // bula e ABERTO para eficácia: a VAL afirmava "eficaz contra a cigarrinha do milho" sem fonte, e o
 // consultor pode repetir isso ao produtor como recomendação fitossanitária.
 const vazaram=reguladas.filter(texto=>safeGeneralModelAnswer(texto))
 assert.deepEqual(vazaram,[],`afirmação regulada entregue: ${vazaram.join(' | ')}`)
})

test('conceito agronomico e comercial continua respondendo', () => {
 // Falso positivo aqui tira a VAL do dia a dia: barrar conceito é pior que o defeito.
 const barradas=legitimas.filter(texto=>!safeGeneralModelAnswer(texto))
 assert.deepEqual(barradas,[],`resposta legítima barrada: ${barradas.join(' | ')}`)
})

test('marca se distingue de conceito pela maiuscula no meio da frase', () => {
 // Não dá para enumerar marca: medido, o catálogo de produtos não serve de registro — "Priori
 // Xtra", "Lannate" e "Roundup Transorb" não estão nele — e o casamento de alias por substring faz
 // "como" casar dentro de "como funciona a fotossíntese?". Na resposta o produto aparece escrito.
 assert.deepEqual(namedProductMentions('A ferrugem asiática reduz a área foliar da soja.'),[])
 assert.ok(namedProductMentions('O Fox Xpro tem desempenho superior ao Priori Xtra.').includes('Xpro'))
 // Instituição, sigla técnica e região não são marca.
 assert.deepEqual(namedProductMentions('No Cerrado, o MIP é eficaz segundo a Embrapa.'),[])
 // Predicado sem nome próprio não basta, e nome próprio sem predicado também não.
 assert.equal(regulatedBrandClaim('O controle é eficaz quando preventivo.'),false)
 assert.equal(regulatedBrandClaim('O Fox Xpro é um fungicida de aplicação foliar.'),false)
})

test('o filtro antigo continua valendo', () => {
 assert.equal(safeGeneralModelAnswer('Aplique 2 L/ha do produto na cultura.'),false)
 assert.equal(safeGeneralModelAnswer('Segundo a Embrapa, o manejo deve ser preventivo.'),false)
})

const rota={path:'fast',capabilities:['KNOWLEDGE_LIBRARY'],client_context_required:false}
const modelo=texto=>({responses:{create:async()=>({output_text:texto,status:'completed',usage:{input_tokens:400,output_tokens:60}})}})
const responder=(message,texto)=>buildGeneralNoClientResponse({message,route:rota,organizationId:'00000000-0000-4000-8000-000000000001',ownerId:'00000000-0000-4000-8000-000000000010',aiClient:modelo(texto),aiModel:'gpt-5-mini',now:new Date('2026-09-16T12:00:00.000Z')})

test('a tela diz que e informacao de bula, nao que a pergunta esta incompleta', async () => {
 // Sem motivo próprio a recusa cairia no texto de "a Biblioteca não cobre este assunto" e o
 // consultor reformularia a pergunta contra uma barreira regulatória.
 const resposta=await responder('o Engeo Pleno S funciona contra cigarrinha do milho?','O Engeo Pleno S é um inseticida da Syngenta, eficaz contra a cigarrinha do milho.')
 const ia=resposta.advice.ai_reasoning
 assert.equal(String(ia.recommended_strategy?.reading||''),regulatedClaimStub)
 assert.equal(ia.run.tool_result.title,'Informação de bula')
 assert.deepEqual(ia.run.tool_result.required_inputs,[])
 assert.doesNotMatch(String(ia.recommended_strategy?.reading||''),/Informe a cultura/)
 // O texto diz de onde vem a informação e o que a VAL ainda responde sobre o mesmo alvo.
 assert.match(regulatedClaimStub,/bula/i)
 assert.match(regulatedClaimStub,/mecanismo de ação/i)
 // Ponto load-bearing: a frase precisa estar na lista byte a byte, senão vira afirmação factual e
 // o consultor lê a mensagem de bloqueio de integridade.
 assert.equal(ia.run.status,'completed')
})

test('pergunta geral legitima continua entregue pelo modelo', async () => {
 const resposta=await responder('o que é um contrato de barter?','Contrato de barter é a operação em que insumos são entregues hoje e pagos depois com parte da colheita.')
 const ia=resposta.advice.ai_reasoning
 assert.equal(ia.run.tool_result.capability,'AI_GENERAL_KNOWLEDGE')
 assert.match(String(ia.recommended_strategy?.reading||''),/barter/i)
})
