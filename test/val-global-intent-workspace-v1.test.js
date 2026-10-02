import test from 'node:test'
import assert from 'node:assert/strict'
import {globalIntentRouterVersion,routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {createValWorkspaceContext,validateValWorkspaceAction,VAL_WORKSPACE_CONTEXT_VERSION} from '../src/lib/val-workspace-context.js'
import {workspaceGuide} from '../server/decision-copilot/workspace-guide.js'

const antonio={id:'client-antonio',name:'Antônio Silva'}

test('screen help uses allowlisted page/tool/tab metadata without inventing screen data or navigating',()=>{
 for(const page of ['dashboard','clients','client360','visits','opportunities','datahub','reports','management','settings','admin','questionnaire','agro','val','copilot']){
  const route=routeGlobalIntent({message:'Como uso esta tela?',workspaceContext:{current_module:page,current_client:{name:'UNTRUSTED_SCREEN_VALUE'}},role:'admin'})
  assert.equal(route.direct,true,page)
  assert.equal(route.reason,'WORKSPACE_GUIDE',page)
  assert.equal(route.workspace_action,null,page)
  assert.doesNotMatch(route.summary,/UNTRUSTED_SCREEN_VALUE/)
 }
 assert.match(workspaceGuide({message:'Me ajuda nesta guia',workspaceContext:{current_module:'agro',current_tool:'solo'}}).summary,/Análise de solo/)
 assert.match(workspaceGuide({message:'Como uso esta tela?',workspaceContext:{current_module:'client360',current_tab:'credit'}}).summary,/guia Crédito/)
 for(const message of ['Como manejar cigarrinha na soja?','Me ajuda a calcular a adubação','Qual o perfil do produtor?','Salve o telefone dele'])assert.equal(workspaceGuide({message,workspaceContext:{current_module:'agro'}}),null,message)
 assert.equal(workspaceGuide({message:'Como uso esta tela?',workspaceContext:{current_module:'unknown-private-page'}}),null)
})

test('voice navigation reaches existing guides and enforces role limits',()=>{
 for(const [message,page,tool] of [['Pode abrir Relatórios?','reports',''],['Abra Coletar preferências','questionnaire',''],['Abra Preferências','settings',''],['Abra Manual do Agrônomo','agro','manual'],['Abra Clima e mercado','agro','clima'],['Abra Bulas e registros','agro','bulas'],['Abra Documentos','agro','biblioteca']]){
  const route=routeGlobalIntent({message,client:antonio})
  assert.equal(route.workspace_action?.page,page,message)
  assert.equal(route.workspace_action?.tool||'',tool,message)
 }
 for(const [message,page] of [['Abra Administração','admin'],['Abra Visão gerencial','management']]){
  assert.equal(routeGlobalIntent({message,role:'consultant'}).workspace_action,null)
  assert.equal(routeGlobalIntent({message,role:'admin'}).workspace_action.page,page)
 }
})

test('GlobalIntentRouter v1 abre produtor, prepara visita e navega sem modelo',()=>{
 const opened=routeGlobalIntent({message:'Abra o produtor Antônio.',client:antonio})
 assert.equal(opened.contract_version,globalIntentRouterVersion)
 assert.equal(opened.intent,'OPEN')
 assert.equal(opened.direct,true)
 assert.equal(opened.workspace_action.type,'OPEN_CLIENT')
 assert.equal(opened.workspace_action.client_id,antonio.id)

 const prepared=routeGlobalIntent({message:'Abra a preparação de visita do Antônio.',client:antonio})
 assert.equal(prepared.intent,'PREPARE')
 assert.equal(prepared.workspace_action.type,'PREPARE_VISIT')

 // Pedir a preparação em si não é comando de navegação: sem verbo de abrir,
 // o pedido segue para o raciocínio em vez de só trocar de tela.
 for(const message of ['Prepare a visita do Antônio.','Me prepare para a próxima visita com este produtor.','prepare uma visita']){
  const reasoned=routeGlobalIntent({message,client:antonio})
  assert.equal(reasoned.intent,'ASK',message)
  assert.equal(reasoned.direct,false,message)
  assert.equal(reasoned.workspace_action,null,message)
 }

 const soil=routeGlobalIntent({message:'Abra a análise de solo.',client:antonio})
 assert.equal(soil.intent,'NAVIGATE')
 assert.equal(soil.workspace_action.page,'agro')
 assert.equal(soil.workspace_action.tool,'soil')
})

test('writes são classificados mas nunca executados pelo router',()=>{
 const route=routeGlobalIntent({message:'Marque o compromisso como concluído.',client:antonio})
 assert.equal(route.intent,'MARK_COMPLETE')
 assert.equal(route.requires_confirmation,true)
 assert.equal(route.direct,false)
 assert.equal(route.workspace_action,null)
})

test('VALWorkspaceContext invalida filhos incompatíveis e valida allowlist de ação',()=>{
 const context=createValWorkspaceContext({module:'agro',client:antonio,property:{id:'p1',name:'Boa Vista'},field:{id:'f1',name:'Talhão 1'},analysis:{id:'a1',name:'Solo'}})
 assert.equal(context.contract_version,VAL_WORKSPACE_CONTEXT_VERSION)
 assert.equal(context.current_client.id,antonio.id)
 assert.equal(context.current_property.id,'p1')
 assert.equal(context.current_field.id,'f1')

 const invalidated=createValWorkspaceContext({module:'agro',property:{id:'foreign-property'},field:{id:'foreign-field'}})
 assert.equal(invalidated.current_property,null)
 assert.equal(invalidated.current_field,null)

 assert.equal(validateValWorkspaceAction({contract_version:'val.workspace_action.v1',type:'NAVIGATE',page:'clients'}).page,'clients')
 assert.equal(validateValWorkspaceAction({contract_version:'val.workspace_action.v1',type:'DELETE',page:'clients'}),null)
 assert.equal(validateValWorkspaceAction({contract_version:'val.workspace_action.v1',type:'NAVIGATE',page:'production'}),null)
})
