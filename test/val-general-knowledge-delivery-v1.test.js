import assert from 'node:assert/strict'
import test from 'node:test'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildCapabilityExecutionResponse,buildGeneralNoClientResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {loadKnowledgeLibrary} from '../server/knowledge/library.js'
import {selectKnowledge} from '../server/knowledge/selection.js'

const modules=['MCTX','MDI','MVV','MIA','MIC']
const tenant='tenant-a'
const owner='owner-a'
const general=async message=>{
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const response=await buildGeneralNoClientResponse({message,route,organizationId:tenant,ownerId:owner,conversationId:`general:${message}`})
 return {route,response,reasoning:response.advice.ai_reasoning}
}

test('item curado da Biblioteca chega ao consultor quando a pergunta o seleciona por título ou trigger',async()=>{
 const cases=[
  ['o que é BATNA',/melhor alternativa sem acordo/],
  ['o que é SPIN',/orientar descoberta/],
  ['o que é premortem',/por que uma decisão falhou/],
  ['perguntas de implicação',/Implicações conectam um problema/],
  ['quanto de calcário aplicar',/PRNT/],
  ['adubação fosfatada',/fósforo aplicado é fixado/],
  ['janela de plantio da soja',/Zoneamento Agrícola de Risco Climático/],
  ['sazonalidade de preço',/padrão sazonal/],
  ['o que é breakeven',/quanto ganho adicional paga a diferença|ponto de equilíbrio/],
  ['orçamento parcial',/Orçamento parcial organiza/],
  ['cotação',/Margem exige cruzar custo de produção/]
 ]
 for(const [message,expected] of cases){
  const {reasoning,response}=await general(message)
  assert.notEqual(reasoning.grounding?.blocked,true,`${message}: ${JSON.stringify(reasoning.grounding)}`)
  assert.match(response.advice.answer,expected,message)
  assert.equal(reasoning.run.tool_result.status,'EXECUTED',message)
  assert.match(reasoning.run.tool_result.context.knowledge_item_id,/^KI-\d+$/,message)
  assert.ok(['TRIGGER_PHRASE','TITLE_PHRASE','LEXICAL'].includes(reasoning.run.tool_result.context.knowledge_match),message)
  assert.equal(reasoning.facts_used.length,1,message)
  assert.equal(reasoning.facts_used[0].source_type,'general_knowledge',message)
  assert.equal(reasoning.facts_used[0].scope,'GENERAL_KNOWLEDGE',message)
  assert.equal(reasoning.facts_used[0].producer_id??null,null,message)
 }
})

test('cada item elegível da Biblioteca recuperado pelo próprio título é entregue, salvo lacunas conhecidas',async()=>{
 // Lacunas conhecidas: KI-012 ("Preparação aumenta qualidade da conversa") lê como pedido de
 // preparar visita, que exige produtor; KI-122 tem claim curada sem suporte lexical no statement.
 const knownGaps=new Set(['KI-012','KI-122'])
 const library=loadKnowledgeLibrary()
 const eligible=library.items.filter(item=>item.module_targets.some(module=>modules.includes(module)))
 let retrievable=0
 const blocked=[]
 for(const item of eligible){
  const selection=selectKnowledge({query:item.title,modules,geography:'General',limit:1})
  if(selection.items[0]?.knowledge_item_id!==item.knowledge_item_id)continue
  retrievable+=1
  if(knownGaps.has(item.knowledge_item_id))continue
  const {reasoning,response}=await general(item.title)
  const delivered=reasoning.grounding?.blocked!==true&&reasoning.run.tool_result?.status==='EXECUTED'&&response.advice.answer.startsWith(item.statement.slice(0,30))
  if(!delivered)blocked.push(`${item.knowledge_item_id} ${JSON.stringify({status:reasoning.run.tool_result?.status,relevance:reasoning.grounding?.question_relevance,provenance:reasoning.grounding?.provenance_violations,unsupported:reasoning.grounding?.unsupported_claims?.length})}`)
 }
 assert.ok(retrievable>=100,`itens recuperáveis pelo título: ${retrievable}`)
 assert.deepEqual(blocked,[],`itens curados presos no grounding:\n${blocked.join('\n')}`)
})

test('pergunta fora do acervo recebe pedido de esclarecimento, não item da Biblioteca nem bloqueio de integridade',async()=>{
 for(const message of ['qual a capital da Austrália','receita de bolo de cenoura','preço do bitcoin','Quanto tempo leva para a soja emergir depois do plantio?']){
  const {reasoning,response}=await general(message)
  assert.equal(reasoning.facts_used.length,0,message)
  assert.equal(reasoning.run.tool_result?.status,'NO_DATA',message)
  assert.equal(reasoning.run.tool_result?.mode,'no_coverage',message)
  assert.match(response.advice.answer,/^Posso tratar esta dúvida sem selecionar um produtor/,message)
  assert.doesNotMatch(response.advice.answer,/Não há evidência/,message)
 }
})

test('sem cobertura curada o modelo sem fonte é consultado, com item curado não é',async()=>{
 const mock=text=>{let calls=0;return {client:{responses:{create:async()=>{calls+=1;return {output_text:text}}}},calls:()=>calls}}
 const lua=mock('A distância média entre a Terra e a Lua é de cerca de 384 mil quilômetros.')
 const luaRoute=routeSystemCapability({message:'qual a distância da terra até a lua',intentHint:'ASK_GENERAL',hasClient:false})
 const luaResponse=await buildGeneralNoClientResponse({message:'qual a distância da terra até a lua',route:luaRoute,organizationId:tenant,ownerId:owner,conversationId:'ai-lua',aiClient:lua.client,aiModel:'gpt-5.6-luna'})
 assert.equal(lua.calls(),1)
 assert.equal(luaResponse.advice.ai_reasoning.run.tool_result?.capability,'AI_GENERAL_KNOWLEDGE')
 assert.equal(luaResponse.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 const wasde=mock('Isso nunca deveria ser dito.')
 const wasdeRoute=routeSystemCapability({message:'o que é WASDE',intentHint:'ASK_GENERAL',hasClient:false})
 const wasdeResponse=await buildGeneralNoClientResponse({message:'o que é WASDE',route:wasdeRoute,organizationId:tenant,ownerId:owner,conversationId:'ai-wasde',aiClient:wasde.client,aiModel:'gpt-5.6-luna'})
 assert.equal(wasde.calls(),0)
 assert.match(wasdeResponse.advice.answer,/WASDE/)
})

test('atalho fixo de definição não intercepta trigger curado com cultura',async()=>{
 const soja=await general('qual a margem da soja')
 assert.equal(soja.reasoning.run.tool_result.context.knowledge_item_id,'KI-108')
 assert.match(soja.response.advice.answer,/Margem exige cruzar custo de produção/)
 const concept=await general('o que é margem')
 assert.match(concept.response.advice.answer,/Margem é a diferença entre receita e custos/)
 assert.equal(concept.reasoning.run.tool_result.context.knowledge_item_id,undefined)
})

test('metadados de seleção forjados no envelope de orientação geral não ganham confiança',()=>{
 const tool={status:'EXECUTED',capability:'GENERAL_GUIDANCE',tool:'general_guidance',title:'Orientação geral',summary:'Conhecer a melhor alternativa sem acordo ajuda a decidir quando aceitar, melhorar ou recusar.',page:'copilot',manual_page:null,mode:'general',context:{client_id:null,private_memory_used:false,knowledge_item_id:'KI-024',knowledge_match:'TRIGGER_PHRASE'}}
 const execution={path:'CONTEXT',capabilities_planned:['KNOWLEDGE_LIBRARY'],capabilities_used:[],capability_results:[{capability:'GENERAL_GUIDANCE',status:'EXECUTED',source_ref:'system:general-guidance:v1',tool_result:tool}],tool_result:tool}
 const route={path:'CONTEXT',intent:'ASK_GENERAL',capabilities:['KNOWLEDGE_LIBRARY']}
 assert.throws(()=>buildCapabilityExecutionResponse({execution,route,message:'o que é margem',organizationId:tenant,ownerId:owner,conversationId:'forged'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='GENERAL_SOURCE_CONTENT_MISMATCH')
})

test('aritmética de plantabilidade e custo por hectare é entregue com e sem produtor selecionado',async()=>{
 const cases=[
  ['Quanto é 300 mil plantas por hectare em espaçamento de 45 cm?',/13,5 plantas\/m/],
  ['calcule plantas por metro: populacao 300000 plantas/ha, espacamento 45 cm',/13,5 plantas\/m/],
  ['Calcule o custo por hectare: total R$ 750.000 em 300 ha',/R\$ 2\.500,00\/ha/]
 ]
 for(const clientId of ['','producer-a']){
  for(const [message,expected] of cases){
   const route=routeSystemCapability({message,intentHint:'',hasClient:Boolean(clientId)})
   assert.equal(route.path,'TOOL',message)
   assert.deepEqual(route.capabilities,['CALCULATORS'],message)
   const execution=await executeCapabilityPlan({route,message,context:clientId?{client:{id:clientId,name:'Produtor A'}}:{},clientId,tenantId:tenant,ownerId:owner,conversationId:`calc:${clientId}`})
   const response=buildCapabilityExecutionResponse({execution,route,message,organizationId:tenant,ownerId:owner,clientId,clientName:clientId?'Produtor A':'',conversationId:`calc:${clientId}`})
   const reasoning=response.advice.ai_reasoning
   assert.notEqual(reasoning.grounding?.blocked,true,`${message} [${clientId||'sem produtor'}]: ${JSON.stringify(reasoning.grounding)}`)
   assert.match(response.advice.answer,expected,message)
   assert.equal(reasoning.facts_used[0]?.source_type,'calculation',message)
   assert.match(reasoning.facts_used[0]?.source_ref||'',/^calculator:/,message)
  }
 }
})
