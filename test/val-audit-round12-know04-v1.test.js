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
