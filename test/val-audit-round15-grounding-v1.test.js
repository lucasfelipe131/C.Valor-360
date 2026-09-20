import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildCapabilityExecutionResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// Rodada 15, ataque aos consertos da rodada 14 em server/decision-copilot/response-grounding.js.
// O pior deles nao foi de projeto: foi um ESCAPE. A regra nasceu de uma edicao em Python e o literal
// de regex ficou com `produtor\\w*` - barra escapada - em vez de `produtor\w*`. O sujeito
// "produtor/produtora/produtores" e o ramo possessivo inteiro ("o cliente DELE tem") pararam de
// casar, sem erro nenhum: 5 de 10 afirmacoes individuais deixaram de ser barradas.
const avaliar=(message,answer)=>{
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const tool={status:'EXECUTED',capability:'AI_GENERAL_KNOWLEDGE',tool:'ai_general_knowledge',title:'Conhecimento geral do modelo (não verificado)',summary:answer,page:'copilot',manual_page:null,mode:'general_unverified',context:{client_id:null,private_memory_used:false}}
 const execution={path:route.path,capabilities_planned:route.capabilities||['KNOWLEDGE_LIBRARY'],capabilities_used:['AI_GENERAL_KNOWLEDGE'],capability_results:[{capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',source_ref:'system:ai-general-knowledge:v1',tool_result:tool}],tool_result:tool,active_context:null}
 return buildCapabilityExecutionResponse({execution,route,message,organizationId:'t',ownerId:'o',conversationId:'c'}).advice.ai_reasoning.grounding
}

test('GR15-01 — nenhum literal de regex pode carregar barra escapada',()=>{
 // Guarda de classe, nao de caso: `/\\w/` casa uma barra literal seguida de w, e falha em silencio.
 // Foi assim que a regra mais importante do arquivo morreu sem que nenhum teste percebesse.
 const fonte=readFileSync(new URL('../server/decision-copilot/response-grounding.js',import.meta.url),'utf8')
 const suspeitos=fonte.split('\n').filter(linha=>/^const \w+=\/.*\\\\[wsdbSWD]/.test(linha))
 assert.deepEqual(suspeitos,[],'literal de regex com \\\\ em vez de \\ nao casa o que promete')
})

test('GR15-01 — o sujeito "produtor" e o possessivo voltam a barrar afirmacao individual',()=>{
 const pergunta='o que e o perfil comercial de um produtor?'
 for(const resposta of [
  'O produtor tem 500 hectares de soja e milho no perfil comercial dele.',
  'A produtora possui área arrendada e o perfil comercial dela é conservador.',
  'O cliente dele tem contrato assinado para o perfil comercial da safra.'
 ])assert.equal(avaliar(pergunta,resposta).blocked,true,`afirmacao individual entregue: "${resposta}"`)
})

test('GR15-02 — narracao individual na primeira frase continua barrada',()=>{
 // A rodada 14 exigiu objeto de transacao perto do verbo no passado, para nao barrar a anafora de
 // coisa. So que na PRIMEIRA frase nao ha frase anterior que introduza a coisa retomada: ali nao
 // existe leitura anafórica, e a exigencia virou passe livre para narracao individual.
 const pergunta='o que e o calendario de plantio?'
 for(const resposta of [
  'Ele plantou cedo e o calendário de plantio respondeu bem.',
  'Ela colheu antes da chuva no calendário de plantio combinado.',
  'O produtor vendeu a produção inteira no pico do calendário de plantio.'
 ])assert.equal(avaliar(pergunta,resposta).blocked,true,`narracao individual entregue: "${resposta}"`)
})

test('GR15-02 — anafora de coisa nas frases seguintes continua passando',()=>{
 // O outro lado, que foi o motivo do conserto da rodada 14 e nao pode ser desfeito.
 for(const [pergunta,resposta] of [
  ['o que e a calda de pulverizacao?','A calda de pulverização perde eficácia com o tempo. Ela perdeu estabilidade depois de seis horas no tanque de pulverização.'],
  ['o que e o mofo branco?','O mofo branco sobrevive no solo por anos. Ele fechou o ciclo com a chuva prolongada e o dossel fechado do mofo branco.']
 ])assert.equal(avaliar(pergunta,resposta).blocked===true,false,`explicacao geral barrada: "${resposta}"`)
})

test('GR15-03 — substantivo comum depois de "deve ter" nao e participio',()=>{
 // O teste era morfologico: qualquer palavra terminada em -to/-ta/-ado/-ido virava participio, e
 // "ele deve ter cuidado", "ter contato", "ter conta" viravam conjectura sobre uma pessoa.
 assert.equal(avaliar('o que e um fungicida sistemico?','Um fungicida sistêmico é absorvido pela planta. Ele deve ter cuidado redobrado na aplicação de fungicida sistêmico em floração.').blocked===true,false)
})

test('GR15-03 — conjectura sobre pessoa continua barrada',()=>{
 for(const resposta of [
  'Ele deve ter atrasado a parcela do custeio.',
  'Ela deve ter assinado o contrato na semana passada.',
  'Ele deve ter recebido a proposta.'
 ])assert.equal(avaliar('o que e uma negociacao comercial?',resposta).blocked,true,`conjectura entregue: "${resposta}"`)
})

test('GR15-04 — adverbio em -mente nao derruba a resposta geral',()=>{
 // modalInterposer era lista fechada de 35 itens. Adverbio em -mente e classe ABERTA do portugues e
 // nunca e infinitivo, entao ele entra por regra, nao item a item.
 for(const [pergunta,resposta] of [
  ['o que e a cobertura nitrogenada?','A cobertura nitrogenada é parcelada. Ela deve tecnicamente acompanhar a demanda da cultura na cobertura nitrogenada.'],
  ['o que e um fungicida preventivo?','Um fungicida preventivo age antes do sintoma. Ele deve obrigatoriamente ser aplicado antes do fechamento das linhas.']
 ])assert.equal(avaliar(pergunta,resposta).blocked===true,false,`resposta geral barrada por adverbio: "${resposta}"`)
})

test('GR15 — a obrigacao individual com modal continua barrada',()=>{
 // Contraprova de tudo acima: nenhum dos quatro consertos pode reabrir o que a rodada 14 fechou.
 for(const resposta of [
  'Ele deve aceitar o desconto oferecido.',
  'Ela deve entregar os grãos na cooperativa.',
  'Ela deve estar inadimplente com o banco.'
 ])assert.equal(avaliar('o que e uma negociacao comercial?',resposta).blocked,true,`obrigacao individual entregue: "${resposta}"`)
})
