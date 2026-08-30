import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
 buildMarketContinuationMessage,
 buildRegisterPrefill,
 buildSessionReplyMessage,
 limitValChatMessage,
 normalizeValChatPayload,
 selectMarketContinuation,
 sessionRepliesForAsk,
 VAL_CHAT_MESSAGE_LIMIT
} from '../src/lib/global-val-conversation.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const component=readFileSync(new URL('../src/components/GlobalValCopilot.jsx',import.meta.url),'utf8')

test('nova ASK normal zera respostas transitórias mesmo quando repete a intenção',()=>{
 const replies=[
  {intent:'ASK_COMMODITY',question:'Qual preço-alvo?',answer:'R$ 118 por saca.'},
  {intent:'ASK_COMMODITY',question:'Qual janela?',answer:'Na próxima semana.'}
 ]
 assert.deepEqual(sessionRepliesForAsk({replies,activeReply:null,intent:'ASK_COMMODITY'}),[])
 assert.deepEqual(sessionRepliesForAsk({replies,activeReply:{question:'Qual janela?'},intent:'ASK_COMMODITY'}),replies)
 assert.deepEqual(sessionRepliesForAsk({replies,activeReply:{question:'Qual decisão?'},intent:'PREPARE_VISIT'}),[])
 assert.match(component,/if\(!activeReply\)\{setSessionReplies\(current=>\(\{\.\.\.current,\[activeThreadKey\]:\[\]\}\)\);setSessionReplyOffer\(null\)\}/)
 assert.match(component,/objective:reasoning\.objective/)
 assert.match(component,/sessionObjective=supersedesActiveChat\?prompt:activeReply\?\.objective\|\|priorSessionReplies/)
})

test('resposta HTTP direta ou envelopada é normalizada e contrato ausente falha fechado',()=>{
 const direct={advice:{answer:'direta'}}
 const wrapped={recommendation:{advice:{answer:'envelopada'}}}
 const nested={data:{response:{recommendation:{advice:{answer:'aninhada'}}}}}
 assert.equal(normalizeValChatPayload(direct),direct)
 assert.equal(normalizeValChatPayload(wrapped),wrapped.recommendation)
 assert.equal(normalizeValChatPayload(nested),nested.data.response.recommendation)
 assert.equal(normalizeValChatPayload({status:'ok'}),null)
 assert.match(component,/normalizeValChatPayload\(rawPayload\)/)
 assert.match(component,/resposta chegou fora do contrato esperado/)
})

test('payload de respostas fica abaixo de 3000 caracteres e prioriza a resposta mais recente',()=>{
 const replies=[
  {question:'Pergunta antiga',answer:`ANTIGA ${'a'.repeat(2600)}`},
  {question:'Pergunta recente',answer:`RECENTE-PRESERVADA ${'b'.repeat(2600)}`}
 ]
 const message=buildSessionReplyMessage({objective:'Cruzar a referência de soja com a conta.',replies})
 assert.ok(message.length<VAL_CHAT_MESSAGE_LIMIT)
 assert.match(message,/ANTIGA/)
 assert.match(message,/RECENTE-PRESERVADA/)
 assert.equal(limitValChatMessage('x'.repeat(VAL_CHAT_MESSAGE_LIMIT)).length,VAL_CHAT_MESSAGE_LIMIT-1)
 assert.match(component,/message:requestMessage/)
})

test('REGISTER prefila todas as respostas correntes que cabem no contrato limitado',()=>{
 const replies=[
  {question:'Qual preço-alvo?',answer:'R$ 118 por saca.'},
  {question:'Qual janela?',answer:'Na próxima semana.'},
  {question:'Quem decide?',answer:'O produtor e a sócia.'}
 ]
 const prefill=buildRegisterPrefill(replies)
 assert.ok(prefill.length<VAL_CHAT_MESSAGE_LIMIT)
 for(const expected of ['R$ 118 por saca','Na próxima semana','O produtor e a sócia'])assert.match(prefill,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
 assert.match(component,/buildRegisterPrefill\(sessionReplies\[threadKey\]\|\|\[\]\)/)
 assert.match(component,/initialText=\{registerInitialText\}/)
})

test('mercado global continua no produtor por pronome com intenção e objetivo herdados',()=>{
 const globalThread=[
  {role:'user',text:'Qual é a referência mais recente da soja?',at:'2026-08-25T12:00:00.000Z'},
  {role:'assistant',at:'2026-08-25T12:00:01.000Z',payload:{advice:{ai_reasoning:{intent:'ASK_COMMODITY',objective:'Entender a referência atual da soja.'}}}}
 ]
 const localThread=[
  {role:'assistant',at:'2026-08-24T12:00:00.000Z',payload:{advice:{ai_reasoning:{intent:'ASK_CLIENT',objective:'Revisar uma visita antiga.'}}}}
 ]
 const continuation=selectMarketContinuation({prompt:'Como isso afeta ele?',localThread,globalThread,hasClient:true})
 assert.deepEqual(continuation,{intent:'ASK_COMMODITY',objective:'Entender a referência atual da soja.',at:'2026-08-25T12:00:01.000Z',index:1})
 const request=buildMarketContinuationMessage({objective:continuation.objective,prompt:'Como isso afeta ele?'})
 assert.ok(request.length<VAL_CHAT_MESSAGE_LIMIT)
 assert.match(request,/Entender a referência atual da soja/)
 assert.match(request,/Como isso afeta ele/)
 assert.equal(selectMarketContinuation({prompt:'Abra a conta.',localThread,globalThread,hasClient:true}),null)
 assert.equal(selectMarketContinuation({prompt:'Me prepare para uma conversa comercial com este produtor.',localThread,globalThread,hasClient:true}),null)
 assert.equal(selectMarketContinuation({prompt:'Me prepare para negociar soja com este produtor.',localThread,globalThread,hasClient:true}),null)
 assert.equal(routeSystemCapability({message:'Me prepare para uma conversa comercial com este produtor.',intentHint:'ASK_COMMODITY',hasClient:true}).intent,'PREPARE_VISIT')
 assert.equal(routeSystemCapability({message:'Me prepare para negociar soja com este produtor.',intentHint:'ASK_COMMODITY',hasClient:true}).intent,'PREPARE_VISIT')
 const replyRequest=buildSessionReplyMessage({objective:request,replies:[{question:'Qual é o preço-alvo?',answer:'R$ 118 por saca.'}]})
 assert.equal(routeSystemCapability({message:replyRequest,intentHint:continuation.intent,hasClient:true}).path,'DEEP')
 assert.match(component,/globalThread:threads\.__global__\|\|\[\]/)
 assert.match(component,/intent\|\|activeReply\?\.intent\|\|continuation\?\.intent/)
 assert.match(component,/objective:continuation\?requestMessage:prompt/)
})

test('saída falável respeita acionamento do usuário e não inicia autoplay no painel global',()=>{
 assert.match(component,/<ValAudioResponse text=\{reasoning\.voice_output\?\.speakable_text\|\|answer\}\/>/)
 assert.doesNotMatch(component,/autoPlay=\{outputMode/)
})
