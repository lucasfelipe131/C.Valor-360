import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveAuthorizedClientReference,extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {routeSystemCapability,isClientOverviewRequest} from '../server/decision-copilot/capability-router.js'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {advanceConversationState,createConversationState,normalizeConversationState,prepareConversationTurnState,switchConversationClient,messageNeedsSessionReference} from '../server/decision-copilot/conversation-state.js'

const portfolio=[
 {id:'antonio-carlos',name:'Antônio Carlos Costa Beber',municipality:'São Luiz Gonzaga/RS',properties:[{name:'Fazenda Boa Vista'}]},
 {id:'antonio-silva',name:'Antônio Silva',municipality:'Giruá'},
 {id:'matheus',name:'Matheus Brum',municipality:'São Borja'},
]
const resolve=(message,authorizedClients=portfolio)=>resolveAuthorizedClientReference({message,authorizedClients,currentClientId:'matheus'})
const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'conversation-a',clientId:'matheus',client:{id:'matheus',name:'Matheus Brum'}}

test('conversa por voz localiza nomes sem depender de capitalização ou verbo de abertura',()=>{
 for(const message of ['antônio carlos','Pode me falar sobre Antônio Carlos?','O que você sabe sobre o Antônio Carlos?','Quero saber do produtor Antônio Carlos.','Como está o Antônio Carlos na soja?']){
  const result=resolve(message)
  assert.equal(result.status,'RESOLVED',message)
  assert.equal(result.client.id,'antonio-carlos',message)
  assert.equal(result.changed_client,true,message)
 }
 assert.equal(extractNaturalClientReference('O que o Matheus comprou?').reference,'Matheus')
 assert.equal(resolve('O que o Matheus comprou?').client.id,'matheus')
})

test('primeiro nome encontra candidatos; município e propriedade desambiguam somente o mesmo produtor',()=>{
 const candidates=resolve('antonio')
 assert.equal(candidates.status,'AMBIGUOUS')
 assert.deepEqual(candidates.options.map(item=>item.id),['antonio-carlos','antonio-silva'])
 assert.equal(resolve('Me fala do Antônio de São Luiz Gonzaga.').client.id,'antonio-carlos')
 assert.equal(resolve('Antônio da Fazenda Boa Vista').client.id,'antonio-carlos')
 assert.equal(resolve('Antônio da Fazenda Boa Vista',portfolio.map(item=>({...item,properties:item.id==='matheus'?[{name:'Fazenda Boa Vista'}]:[]}))).client,null)
})

test('qualificador literal de localização nunca desaparece como complemento agrícola',()=>{
 const clients=[
  {id:'joao-silva',name:'João Silva',municipality:'São Borja',properties:[{name:'Fazenda São João'}]},
  {id:'bruno',name:'Bruno Costa',municipality:'São Luiz Gonzaga',properties:[{name:'Fazenda Boa Vista'}]},
 ]
 for(const message of ['Me fala do João na Fazenda Boa Vista','Me fala do João no município São Luiz Gonzaga','Me fala do João em São Luiz Gonzaga','Me fala do João em Porto Alegre','Me fala do João na Fazenda Inexistente','Qual a área do João na Fazenda Boa Vista?']){
  const result=resolveAuthorizedClientReference({message,authorizedClients:clients,currentClientId:'bruno'})
  assert.equal(result.status,'NOT_FOUND',message)
  assert.equal(result.reason_code,'CLIENT_REFERENCE_QUALIFIER_MISMATCH',message)
  assert.equal(result.client,null,message)
 }
 assert.equal(resolveAuthorizedClientReference({message:'Me fala do João na soja',authorizedClients:clients}).client.id,'joao-silva')
 assert.equal(resolveAuthorizedClientReference({message:'Me fala do João na Fazenda São João',authorizedClients:clients}).client.id,'joao-silva')
 const homonyms=[...clients,{id:'joao-souza',name:'João Souza',municipality:'Giruá',properties:[{name:'Fazenda Boa Vista'}]}]
 assert.equal(resolveAuthorizedClientReference({message:'Me fala do João na Fazenda Boa Vista',authorizedClients:homonyms}).client.id,'joao-souza')
 const duplicated=[...homonyms,{id:'joao-lima',name:'João Lima',municipality:'Giruá',properties:[{name:'Fazenda Boa Vista'}]}]
 const ambiguous=resolveAuthorizedClientReference({message:'Me fala do João na Fazenda Boa Vista',authorizedClients:duplicated})
 assert.equal(ambiguous.status,'AMBIGUOUS')
 assert.deepEqual(ambiguous.options.map(item=>item.id),['joao-souza','joao-lima'])
})

test('nome parcial e pequena falha de transcrição preservam ambiguidade e limiar para nomes curtos',()=>{
 assert.equal(resolve('Antônio Beber').client.id,'antonio-carlos')
 assert.equal(resolve('Antoni Carlos').client.id,'antonio-carlos')
 assert.equal(resolve('Antoni').status,'AMBIGUOUS')
 assert.equal(resolve('Antoni Carlos',[...portfolio,{id:'antonio-extra',name:'Antônio Carlos Lima'}]).status,'AMBIGUOUS')
 assert.equal(resolveAuthorizedClientReference({reference:'Maria',authorizedClients:[{id:'marina',name:'Marina Souza'}]}).status,'NOT_FOUND')
 assert.equal(resolveAuthorizedClientReference({reference:'antônlo',authorizedClients:portfolio}).status,'NOT_FOUND')
})

test('produtor explicitamente desconhecido nunca reutiliza a conta ativa; assuntos gerais continuam livres',()=>{
 for(const message of ['Abra o produtor Roberto Privado.','Me fala do produtor Roberto Privado.']){
  const result=resolve(message)
  assert.equal(result.status,'NOT_FOUND',message)
  assert.equal(result.client,null,message)
 }
 for(const message of ['Me fala sobre ferrugem asiática.','Quais herbicidas usar no milho?','Oi val','Como está o mercado?']){
  assert.equal(resolve(message).status,'NONE',message)
 }
})

test('referência autorizada direciona narrativa e hint antigo à conta sem sequestrar assunto geral',()=>{
 const message='Me fala do Antônio Carlos.'
 assert.equal(routeValIntent({message,hasClient:true,resolvedClientReference:true,intentHint:'ASK_GENERAL'}).intent,'ASK_CLIENT')
 const route=routeSystemCapability({message,hasClient:true,resolvedClientReference:true,intentHint:'ASK_GENERAL'})
 assert.equal(route.intent,'ASK_CLIENT')
 assert.equal(route.path,'FAST')
 assert.deepEqual(route.capabilities,['CLIENT_CONTEXT'])
 assert.equal(route.client_context_required,true)
 assert.equal(routeSystemCapability({message:'Me fala sobre ferrugem asiática.',hasClient:true}).client_context_required,false)
 assert.equal(isClientOverviewRequest('Me fala do Antônio e como negociar com ele.'),false)
})

test('pergunta direta de área usa cadastro; dose concreta exige registro atual',()=>{
 for(const message of ['Qual a área do Antônio?','Qual a área dele?'])assert.equal(routeSystemCapability({message,hasClient:true,resolvedClientReference:true}).data_path,'REGISTERED_AREA')
 assert.equal(routeValIntent({message:'Qual dose de Fox Xpro aplicar no milho?',hasClient:true}).intent,'CHECK_LABEL')
 assert.equal(routeSystemCapability({message:'Qual dose de Fox Xpro aplicar no milho?'}).current_data_required,true)
 assert.equal(routeValIntent({message:'O que é dose de herbicida?'}).intent,'ASK_GENERAL')
 assert.equal(routeValIntent({message:'Calcule a pulverização: área 120 ha, calda 100 L/ha, tanque 2000 L, produto Teste, dose 1,5 L/ha.'}).intent,'CALCULATE')
})

test('continuidade da área mantém objeto autorizado e troca de produtor limpa todas as dependências',()=>{
 const created=createConversationState(scope)
 const state=normalizeConversationState({...created,current_domain:'AGRONOMY',current_field:{type:'field',id:'field-matheus',label:'Talhão Norte'},current_crop:'Milho',active_object:{type:'field',id:'field-matheus',label:'Talhão Norte'}},scope)
 for(const message of ['E nessa área?','E nesse talhão?','Nessa área, o que fazer?']){
  const next=prepareConversationTurnState(state,{message,scope})
  assert.equal(next.current_field.id,'field-matheus',message)
  assert.equal(next.context_epoch,state.context_epoch,message)
  assert.equal(messageNeedsSessionReference(message),true,message)
 }
 const general=prepareConversationTurnState(state,{message:'O que é liderança?',scope})
 assert.equal(general.current_field,null)
 assert.equal(general.active_object,null)
 const switched=switchConversationClient(state,{id:'antonio-carlos',name:'Antônio Carlos Costa Beber'},{tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId})
 assert.equal(switched.current_field,null)
 assert.equal(switched.current_crop,null)
 assert.deepEqual(switched.session_facts,[])
 assert.deepEqual(switched.conversation_turns,[])
})

test('retomada de voz retém response_id somente da resposta concluída e fundamentada pelo servidor',()=>{
 const state=advanceConversationState(createConversationState(scope),{scope,message:'Qual a área dele?',response:{advice:{answer:'Área cadastrada: 120 ha.',ai_reasoning:{reasoning_id:'server-response-1'}}}})
 const completed=state.conversation_turns.at(-1)
 assert.equal(completed.response_id,'server-response-1')
 assert.equal(state.conversation_turns[0].response_id,undefined)
 for(const altered of [{role:'user'},{status:'incomplete'},{server_grounded:false},{scope_verified:false}]){
  const normalized=normalizeConversationState({...state,conversation_turns:[{...completed,response_id:'untrusted-response',...altered}]},scope)
  assert.equal(normalized.conversation_turns[0]?.response_id,undefined,JSON.stringify(altered))
 }
})
