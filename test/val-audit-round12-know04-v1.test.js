import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCapabilityExecutionResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// KNOW-04. A regra GLOBAL_PRODUCER_SPECIFIC_CLAIM casava os pronomes NUS "ele"/"ela" em evidencia
// global e isentava so a Biblioteca, nao o fallback de IA. Em portugues "ela" e o pronome anaforico
// de qualquer substantivo anterior: "A fotossintese ... Ela ocorre nos cloroplastos" era descartada,
// e a MESMA resposta com "O processo ocorre" passava. O consultor lia o pedido de reformular a
// pergunta DEPOIS de duas chamadas pagas ao modelo.
const avaliar=(message,answer)=>{
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const tool={status:'EXECUTED',capability:'AI_GENERAL_KNOWLEDGE',tool:'ai_general_knowledge',title:'Conhecimento geral do modelo (não verificado)',summary:answer,page:'copilot',manual_page:null,mode:'general_unverified',context:{client_id:null,private_memory_used:false}}
 const execution={path:route.path,capabilities_planned:route.capabilities||['KNOWLEDGE_LIBRARY'],capabilities_used:['AI_GENERAL_KNOWLEDGE'],capability_results:[{capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',source_ref:'system:ai-general-knowledge:v1',tool_result:tool}],tool_result:tool,active_context:null}
 return buildCapabilityExecutionResponse({execution,route,message,organizationId:'t',ownerId:'o',conversationId:'c'}).advice.ai_reasoning.grounding
}

test('KNOW-04 — o pronome sozinho deixa de derrubar a resposta geral',()=>{
 const pergunta='o que e fotossintese?'
 const comPronome='A fotossintese e o processo pelo qual a planta converte luz, agua e gas carbonico em carboidratos e oxigenio. Ela ocorre nos cloroplastos, onde a clorofila capta a energia luminosa.'
 const semPronome=comPronome.replace('Ela ocorre','O processo ocorre')
 assert.equal(avaliar(pergunta,semPronome).blocked===true,false,'pré-requisito: sem o pronome a resposta sempre passou')
 assert.equal(avaliar(pergunta,comPronome).blocked===true,false,'a única diferença é o pronome — não pode mudar o veredicto')
})

test('KNOW-04 — respostas gerais legitimas com pronome anaforico atravessam',()=>{
 for(const [pergunta,resposta] of [
  ['o que e manejo integrado de pragas?','O manejo integrado combina monitoramento, controle biologico e quimico. Ele reduz a pressao de selecao sobre a populacao alvo.'],
  ['o que e capital de giro?','Capital de giro e o recurso que sustenta a operacao entre o desembolso e o recebimento. Na lavoura ele cobre o intervalo entre o custeio e a comercializacao.'],
  ['o que e ferrugem asiatica?','A ferrugem asiatica e uma doenca foliar da soja. Ela reduz a area fotossinteticamente ativa e antecipa a senescencia.'],
  ['o que e plantio direto?','O plantio direto mantem a palhada sobre o solo. Ele reduz a erosao e melhora a infiltracao de agua.']
 ])assert.equal(avaliar(pergunta,resposta).blocked===true,false,resposta.slice(0,50))
})

test('KNOW-04 — afirmacao sobre produtor individual continua barrada em evidencia global',()=>{
 // A proteção que a regra existia para dar não pode ter sido perdida junto com o pronome nu.
 for(const [pergunta,resposta] of [
  ['o que e capital de giro?','Ele tem 500 hectares em Sorriso e opera com capital proprio.'],
  ['o que e perfil de compra?','Ela esta com a proposta parada desde marco e nao respondeu.'],
  ['o que e perfil analitico?','Este produtor prefere pagamento a vista e compara custo por hectare.'],
  ['o que e objecao comercial?','O cliente reclamou do preco da proposta na ultima visita.'],
  ['o que e perfil comportamental?','Ele e analitico e demonstra preferencia por dados objetivos.'],
  ['o que e area plantada?','A fazenda dele tem 1.200 hectares e cultiva soja e milho.'],
  ['o que e historico de compra?','Ela possui historico de compra concentrado em fertilizantes.'],
  ['o que e risco de credito?','O produtor esta inadimplente desde a safra passada.']
 ])assert.equal(avaliar(pergunta,resposta).blocked===true,true,`passou e não podia: ${resposta}`)
})


test('KNOW-04 — pronome nu com verbo de ACAO continua barrado em evidencia global',()=>{
 // A rodada 13 mediu o custo de ter apoiado a remoção do pronome nu só em genericAssertion: a lista
 // de verbos era de estado e posse, então todo verbo de ação escapava — 10 de 10 frases sobre
 // produtor individual passaram a ser entregues verbatim ao consultor como "conhecimento geral".
 for(const [pergunta,resposta] of [
  ['o que e custeio?','Ele plantou soja e vendeu a producao antecipada.'],
  ['o que e colheita?','Ela colheu a soja e entregou o lote na cooperativa.'],
  ['o que e inadimplencia?','Inadimplencia no custeio e o nao pagamento da parcela no vencimento. Ela deve ao banco e nao pagou a parcela do custeio.'],
  ['o que e arrendamento?','Ele arrendou area do vizinho e assumiu o custo.'],
  ['o que e terceirizacao?','Ela contratou a pulverizacao terceirizada.'],
  ['o que e objecao?','Ele reclamou do preco da proposta.'],
  ['o que e contrato?','Ela assinou o contrato de compra na semana passada.'],
  ['o que e barter?','Ele fechou barter e antecipou a entrega de insumo.'],
  ['o que e hedge?','Ela travou preco e fixou 40% da producao.'],
  ['o que e renegociacao?','Ele renegociou a divida e quitou duas parcelas.']
 ])assert.equal(avaliar(pergunta,resposta).blocked===true,true,`passou e não podia: ${resposta}`)
})

test('KNOW-04 — "deve" modal continua sendo explicacao geral, nao obrigacao de pessoa',()=>{
 // "ela deve ao banco" é afirmação sobre alguém; "ele deve ser aplicado" é explicação. O que separa
 // os dois é o infinitivo logo depois — não uma lista de assuntos.
 assert.equal(avaliar('o que e um fungicida sistemico?','Um fungicida sistemico e absorvido pela planta. Ele deve ser aplicado antes do fechamento das linhas para alcancar o terco inferior.').blocked===true,false)
 assert.equal(avaliar('o que e monitoramento?','O monitoramento e a amostragem periodica da lavoura. Ele deve comecar antes do fechamento do dossel.').blocked===true,false)
 assert.equal(avaliar('o que e inadimplencia?','Ela deve ao banco desde a safra passada.').blocked===true,true)
})
