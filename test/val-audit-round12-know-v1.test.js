import assert from 'node:assert/strict'
import test from 'node:test'
import {buildGeneralNoClientResponse,regulatedClaimStub} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
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


test('KNOW-01 — nome cientifico, toponimo e instituicao nao sao marca',()=>{
 // A rodada 13 mediu 6 de 12 respostas conceituais legítimas recusadas com um texto REGULATÓRIO
 // mandando consultar a bula, porque qualquer palavra maiúscula no meio da oração virava "marca".
 // Na agronomia brasileira isso é o vocabulário normal.
 for(const resposta of [
  'O controle biologico de lagartas usa Bacillus thuringiensis, que controla larvas de lepidopteros ao produzir toxinas no intestino do inseto.',
  'Trichoderma harzianum atua sobre patogenos de solo por competicao e parasitismo, e e eficaz em condicoes de boa umidade.',
  'Beauveria bassiana e um fungo entomopatogenico que combate percevejos em condicoes de alta umidade relativa.',
  'A ferrugem asiatica e causada por Phakopsora pachyrhizi. O fungo elimina area foliar e reduz o enchimento de graos.',
  'A adubacao verde com Crotalaria spectabilis controla nematoides de galha por ser planta nao hospedeira.',
  'Spodoptera frugiperda combate-se melhor com manejo integrado do que com aplicacao isolada.',
  'Em Mato Grosso a janela de semeadura e mais estreita, e o vazio sanitario protege a lavoura da ferrugem.',
  'O Plano Safra define condicoes de custeio; ele nao e indicado para capital de giro de curto prazo.',
  'A Instrucao Normativa do Ministerio da Agricultura e a fonte que registra o uso autorizado.',
  'Em Goias e no Parana a Brachiaria em consorcio protege o solo da erosao.',
  'Sclerotinia sclerotiorum e favorecida por temperatura amena e molhamento foliar prolongado.'
 ])assert.equal(regulatedBrandClaim(resposta),false,`recusou resposta legítima: ${resposta.slice(0,70)} | nomes=${JSON.stringify(namedProductMentions(resposta))}`)
})

test('KNOW-01 — o binomio nao pode virar porta de saida para a marca',()=>{
 // A primeira versão da regra de binômio aceitava qualquer palavra minúscula como epíteto, e
 // "O Lannate controla a lagarta" passava a ser lido como nome científico.
 for(const resposta of [
  'O Lannate controla a lagarta-do-cartucho no milho.',
  'O Fox Xpro e indicado para ferrugem asiatica na soja.',
  'O Roundup Transorb elimina as principais daninhas em soja RR.',
  'A Elatus tem maior residual que a Aproach Prima.',
  'O Engeo Pleno funciona bem contra percevejo na soja.',
  'O Standak Top protege a semente contra pragas iniciais.'
 ])assert.equal(regulatedBrandClaim(resposta),true,`deixou passar: ${resposta}`)
})

test('KNOW-01 — falha do provedor nao e anunciada como bloqueio de bula',async()=>{
 // regulatedClaim é calculado sobre o texto DESCARTADO: bastava a primeira resposta ser rejeitada e
 // a segunda chamada morrer no provedor para o consultor ler "consulte a bula" quando a causa era
 // HTTP 500 no modelo.
 const message='o que e fotossintese?'
 const route=routeSystemCapability({message,hasClient:false})
 let chamada=0
 const aiClient={responses:{create:async()=>{
  chamada+=1
  if(chamada===1)return {status:'completed',output_text:'O Fox Xpro e eficaz contra a ferrugem asiatica da soja.',usage:{input_tokens:10,output_tokens:10}}
  throw Object.assign(new Error('Internal Server Error'),{status:500})
 }}}
 const payload=await buildGeneralNoClientResponse({message,route,organizationId:'00000000-0000-4000-8000-000000000001',ownerId:'owner-r13',conversationId:'r13',contextEpoch:0,now:new Date('2026-08-30T12:00:00.000Z'),aiClient,aiModel:'gpt-5-mini'})
 const tool=payload.advice.ai_reasoning.run.tool_result
 assert.equal(tool.title,'IA indisponível',`título disse "${tool.title}" com o provedor em 500`)
 assert.doesNotMatch(tool.summary,/informação de bula/i)
 assert.equal(payload.advice.ai_reasoning.run.status,'completed')
})
