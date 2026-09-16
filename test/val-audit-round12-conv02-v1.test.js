import assert from 'node:assert/strict'
import test from 'node:test'
import {conversationTurnVisibleInScope,readConversationWorkspace,responseCardActionMatchesScope,writeConversationWorkspace} from '../src/lib/full-screen-conversation.js'

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
