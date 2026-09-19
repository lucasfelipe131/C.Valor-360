import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {conversationContextEpoch,conversationTurnVisibleInScope,readConversationWorkspace,responseCardActionMatchesScope,writeConversationWorkspace} from '../src/lib/full-screen-conversation.js'

// CONV-02. Mudar de assunto na mesma conversa sobe o context_epoch no servidor (clearedDomainOverlay)
// e troca o domain. O filtro de visibilidade exigia igualdade nas SEIS dimensoes, entao as respostas
// anteriores sumiam da tela; writeConversationWorkspace reaplica o mesmo filtro antes de gravar, o
// que tornava a perda definitiva. As perguntas nao declaram escopo e escapavam de todas as
// comparacoes: o consultor ficava com tres perguntas e uma resposta, sem aviso.
const tenantId='tenant-a',ownerId='owner-a',producerId='produtor-a',conversationId='conversa-a'
const escopo=(contextEpoch,domain)=>({contractVersion:'val.response_scope.v1',tenantId,ownerId,producerId,conversationId,contextEpoch,domain})
const resposta=(contextEpoch,domain,answer)=>({
 role:'assistant',serverGrounded:true,
 payload:{responseScope:escopo(contextEpoch,domain),advice:{answer,ai_reasoning:{organization:{id:tenantId},client:{id:producerId},conversation_id:conversationId,premises:{context_scope:{tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:contextEpoch,domain,minimum_sufficient_context:true}}}}}
})
const pergunta=text=>({role:'user',text,at:'2026-08-30T10:00:00.000Z'})
const ativo=(contextEpoch,domain)=>({tenantId,ownerId,producerId,conversationId,contextEpoch,domain})

test('CONV-02 — a resposta do assunto anterior continua visivel depois da troca de assunto',()=>{
 const anterior=resposta(0,'AGRONOMY','Manejo de cigarrinha: leitura anterior.')
 const atual=resposta(1,'OPPORTUNITY','Custo da proposta: leitura atual.')
 const agora=ativo(1,'OPPORTUNITY')
 assert.equal(conversationTurnVisibleInScope(atual,agora),true)
 assert.equal(conversationTurnVisibleInScope(anterior,agora),true,'a resposta que o consultor acabou de ler não pode sumir')
 assert.equal(conversationTurnVisibleInScope(pergunta('Qual o manejo de cigarrinha?'),agora),true)
})

test('CONV-02 — a troca de assunto nao apaga a resposta anterior do armazenamento',()=>{
 const threads={'client:produtor-a':[
  pergunta('Qual o manejo de cigarrinha no milho dele?'),
  resposta(0,'AGRONOMY','Manejo de cigarrinha: leitura anterior.'),
  pergunta('E o preço? Ele reclamou do custo da proposta.'),
  resposta(1,'OPPORTUNITY','Custo da proposta: leitura atual.')
 ]}
 const metadata={'client:produtor-a':{tenantId,ownerId,clientId:producerId,clientName:'Produtor A',conversationId,contextEpoch:1,domain:'OPPORTUNITY'}}
 const valores=new Map()
 writeConversationWorkspace({setItem:(key,value)=>valores.set(key,value)},'escopo-a',{threads,metadata})
 const gravado=readConversationWorkspace({getItem:key=>valores.get(key)||null},'escopo-a')
 const turnos=gravado.threads['client:produtor-a']
 assert.equal(turnos.length,4,`perguntas e respostas têm que sobreviver juntas: ${JSON.stringify(turnos.map(item=>item.role))}`)
 assert.deepEqual(turnos.map(item=>item.role),['user','assistant','user','assistant'])
 assert.match(turnos[1].payload.advice.answer,/leitura anterior/)
})

test('CONV-02 — isolamento por dono continua exato, e agir a partir do card continua exigindo 6D',()=>{
 const agora=ativo(1,'OPPORTUNITY')
 for(const [campo,valor] of [['tenantId','tenant-b'],['ownerId','owner-b'],['producerId','produtor-b'],['conversationId','conversa-b']]){
  const alheio=resposta(1,'OPPORTUNITY','Resposta de outro escopo')
  alheio.payload.responseScope={...alheio.payload.responseScope,[campo]:valor}
  alheio.payload.advice.ai_reasoning.premises.context_scope={...alheio.payload.advice.ai_reasoning.premises.context_scope,[{tenantId:'tenant_id',ownerId:'owner_id',producerId:'producer_id',conversationId:'conversation_id'}[campo]]:valor}
  if(campo==='tenantId')alheio.payload.advice.ai_reasoning.organization={id:valor}
  if(campo==='producerId')alheio.payload.advice.ai_reasoning.client={id:valor}
  if(campo==='conversationId')alheio.payload.advice.ai_reasoning.conversation_id=valor
  assert.equal(conversationTurnVisibleInScope(alheio,agora),false,campo)
 }
 // Época e domínio antigos: o texto continua à vista, a ação não.
 assert.equal(responseCardActionMatchesScope(escopo(0,'AGRONOMY'),agora),false)
 assert.equal(responseCardActionMatchesScope(escopo(1,'OPPORTUNITY'),agora),true)
})


test('CONV-02 — o card do assunto anterior nao oferece acao que o portao vai recusar',()=>{
 // A rodada 13 mediu: o card restaurado desenhava os quatro botões de sempre e todos morriam no
 // portão de ação (que continua 6D, e deve continuar). O consultor clicava e lia "abra a conversa de
 // origem" — instrução impossível, é a mesma conversa, o mesmo produtor, o mesmo consultor.
 const copiloto=readFileSync(new URL('../src/components/GlobalValCopilot.jsx',import.meta.url),'utf8')
 assert.match(copiloto,/readOnly=\{!responseCardActionMatchesScope\(item\.payload\?\.responseScope,activeCardScope\)\}/,'a tela decide por card se a ação é possível')
 assert.match(copiloto,/if\(readOnly\)return <article/,'card sem ação possível é renderizado como leitura')
 assert.match(copiloto,/Leitura de um assunto anterior desta conversa/,'e diz ao consultor o que está vendo')
 // O portão de ação em si não pode ter sido afrouxado para isso.
 assert.match(copiloto,/responseCardActionMatchesScope\(responseScope,activeScope\)/)
})


test('CONV-02 — a epoca corrente e a ultima que o servidor declarou, nao a do turno visivel',()=>{
 // Medido na rodada 13: com a resposta da época anterior visível de novo, o epoch derivado da tela
 // voltava a 0 e DESFAZIA a sincronização que o servidor tinha imposto no 409 da sessão de voz. O
 // consultor falava, a VAL respondia por voz, e nada entrava no fio — sem erro e sem aviso.
 const anterior=resposta(0,'AGRONOMY','Leitura do assunto anterior.')
 const escopo={conversationId,producerId}
 // Sem declaração do servidor, vale o turno mais recente visível.
 assert.equal(conversationContextEpoch([anterior],escopo),0)
 // Com declaração do servidor (o metadado do fio), ela manda — é informação mais nova que o turno.
 assert.equal(conversationContextEpoch([anterior],{...escopo,fallbackContextEpoch:1}),1)
 // E um turno com época que a conversa nunca alcançou não empurra a época para a frente.
 assert.equal(conversationContextEpoch([resposta(9,'AGRONOMY','Turno adulterado.')],{...escopo,fallbackContextEpoch:1}),1)
})
