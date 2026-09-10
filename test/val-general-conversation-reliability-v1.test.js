import assert from 'node:assert/strict'
import test from 'node:test'
import {buildGeneralNoClientResponse,buildCapabilityExecutionResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {generalProductCatalogGuidance} from '../server/product-intelligence.js'
import {generateGeneralModelAnswer,requiresVerifiedGeneralSource} from '../server/knowledge/general-answer-provider.js'

const message='Qual a diferença entre CTC efetiva e CTC potencial?'
const answer='A CTC efetiva representa a capacidade de troca nas condições atuais do solo, enquanto a CTC potencial corresponde à capacidade estimada em um pH de referência. Essa diferença exige observar o método do laudo.'
const mock=responses=>{const calls=[];return {calls,client:{responses:{create:async(request,options)=>{calls.push({request,options});const response=responses[Math.min(calls.length-1,responses.length-1)];return typeof response==='function'?response(request,options):response}}}}}
const general=(options={})=>buildGeneralNoClientResponse({message,route:routeSystemCapability({message:options.message||message,hasClient:false}),organizationId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a',...options})

test('comparação de conceitos não vira definição fixa por conter CTC, pH ou margem',async()=>{
 const ai=mock([{status:'completed',output_text:answer}])
 const result=await general({aiClient:ai.client,aiModel:'gpt-test'})
 assert.equal(result.advice.answer,answer)
 assert.equal(ai.calls.length,1)
 assert.equal(result.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 const ph=await general({message:'Como o pH afeta a volatilização da ureia?'})
 assert.doesNotMatch(ph.advice.answer,/^O pH indica a acidez/)
 const margin=await general({message:'Qual a diferença entre margem bruta e margem de contribuição?'})
 assert.doesNotMatch(margin.advice.answer,/^Margem é a diferença entre receita e custos/)
})

test('limite do provedor descarta parcial, recupera uma vez e contabiliza as duas chamadas',async()=>{
 const ai=mock([{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:'A CTC efetiva é sempre idêntica',usage:{input_tokens:100,output_tokens:1600}},{status:'completed',output_text:answer,usage:{input_tokens:110,output_tokens:100}}])
 const result=await general({aiClient:ai.client,aiModel:'gpt-5.6-luna'})
 assert.equal(result.advice.answer,answer)
 assert.equal(ai.calls.length,2)
 assert.equal(ai.calls[0].request.reasoning.effort,'low')
 assert.ok(ai.calls[1].request.max_output_tokens>ai.calls[0].request.max_output_tokens)
 assert.equal(ai.calls[0].options.maxRetries,0)
 assert.equal(result.responseMetadata.aiGeneralKnowledgeModelCalls,2)
 assert.ok(result.responseMetadata.aiGeneralKnowledgeCostUsd>0)
 assert.doesNotMatch(JSON.stringify(result),/sempre idêntica/)
})

test('segunda saída parcial nunca é publicada nem entra no cache público',async()=>{
 const ai=mock([{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:answer}])
 let cachedText
 const sharedAnswerCache={resolve:async({generate})=>{const result=await generate();cachedText=result.text;return result}}
 const result=await general({aiClient:ai.client,aiModel:'gpt-test',sharedAnswerCache})
 assert.equal(ai.calls.length,2)
 assert.equal(cachedText,'')
 assert.equal(result.advice.ai_reasoning.run.tool_result.status,'NO_DATA')
 assert.doesNotMatch(result.advice.answer,/capacidade estimada/)
})

test('falha de conteúdo e status não concluído não viram texto factual nem retry em laço',async()=>{
 for(const response of [{status:'incomplete',incomplete_details:{reason:'content_filter'},output_text:answer},{status:'failed',error:{code:'provider_error'},output_text:answer}]){
  const ai=mock([response])
  const result=await general({aiClient:ai.client,aiModel:'gpt-test'})
  assert.equal(ai.calls.length,1)
  assert.equal(result.advice.ai_reasoning.run.tool_result.status,'NO_DATA')
 }
})

test('cancelamento acompanha provedor sem retry ou resposta tardia',async()=>{
 const controller=new AbortController()
 const reason=Object.assign(new Error('cancelado pelo cliente'),{name:'AbortError'})
 const ai=mock([async(_request,options)=>{assert.equal(options.signal,controller.signal);controller.abort(reason);throw reason}])
 await assert.rejects(general({aiClient:ai.client,aiModel:'gpt-test',signal:controller.signal}),error=>error===reason)
 assert.equal(ai.calls.length,1)
})

test('conceitos sobre produtos e manejo são permitidos; dose, marca sem ficha e dado vivo exigem fonte',async()=>{
 for(const question of ['Como comparar produtos pelo mecanismo de ação?','Quais características diferenciam produtos sistêmicos e de contato?','Como funciona o manejo integrado de cigarrinha no milho?'])assert.equal(requiresVerifiedGeneralSource(question),false,question)
 for(const question of ['Qual produto para cigarrinha no milho?','Qual dose de Fox Xpro aplicar no milho?','Posso usar fungicida para esse problema?','Qual a composição do produto Inventado Max?','Qual o preço atual da soja?']){
  const ai=mock([{output_text:'Não deveria ser entregue.'}])
  assert.equal(requiresVerifiedGeneralSource(question),true,question)
  const response=await generateGeneralModelAnswer({message:question,aiClient:ai.client,model:'gpt-test'})
  assert.equal(response.text,'')
  assert.equal(ai.calls.length,0)
 }
})

test('marca conhecida usa somente catálogo local com composição e proveniência explícita',async()=>{
 const ai=mock([{output_text:'Marca tem uma composição inventada.'}])
 const result=await general({message:'O que é o produto Fox Xpro?',aiClient:ai.client,aiModel:'gpt-test'})
 assert.equal(ai.calls.length,0)
 assert.match(result.advice.answer,/catálogo local.*Fox Xpro/)
 assert.match(result.advice.answer,/Composição cadastrada:/)
 assert.match(result.advice.answer,/atualidade.*não foi verificada/)
 assert.equal(result.advice.ai_reasoning.evidence_status,'LOCAL_CATALOG_REFERENCE')
 assert.equal(result.advice.ai_reasoning.facts_used[0].source_type,'official_product_catalog')
 assert.equal(result.advice.ai_reasoning.facts_used[0].producer_id,undefined)
 assert.equal(result.advice.ai_reasoning.knowledge_refs[0].current_status,'NOT_VERIFIED')
 assert.equal(result.advice.ai_reasoning.knowledge_refs[0].observed_at,null)
 assert.doesNotMatch(result.advice.answer,/\d\s*(?:L|mL)\/ha|indicado para|controla/)
})

test('princípio ativo, ingrediente ativo e composição de marca conhecida usam o alias integral do catálogo',async()=>{
 const ai=mock([{output_text:'Composição inventada.'}])
 for(const question of ['Qual o princípio ativo do Fox Xpro?','Qual a composição de Fox Xpro?','Quais são os ingredientes ativos de Fox Xpro?']){
  const result=await general({message:question,aiClient:ai.client,aiModel:'gpt-test'})
  assert.equal(result.advice.ai_reasoning.evidence_status,'LOCAL_CATALOG_REFERENCE',question)
  assert.equal(result.advice.ai_reasoning.run.tool_result.status,'EXECUTED',question)
  assert.match(result.advice.answer,/Bixafem.*Protioconazol.*trifloxistrobina/,question)
  assert.match(result.advice.answer,/atualidade.*não foi verificada/,question)
 }
 assert.equal(ai.calls.length,0)
 for(const question of ['Qual o princípio ativo do Fox Xpro Ultra?','Qual a composição de Fox Xpro para aplicar no milho?','Qual o princípio ativo do produto Inventado Max?'])assert.equal(generalProductCatalogGuidance(question),null,question)
})

test('definição e comparação de dose explicam o conceito por IA sem substituir por aviso regulatório',async()=>{
 const cases=[
  ['O que é dose de herbicida?','Dose de herbicida é a quantidade de produto considerada por área tratada; o conceito de dose não define um valor para uso no campo.'],
  ['Qual a diferença entre dose de produto comercial e dose de ingrediente ativo?','A dose de produto comercial considera a quantidade da formulação, enquanto a dose de ingrediente ativo considera apenas a substância ativa presente nela. A concentração relaciona essas duas formas de expressar a dose, sem definir uma recomendação de uso.']
 ]
 for(const [question,expected] of cases){
  const ai=mock([{output_text:expected}])
  assert.equal(requiresVerifiedGeneralSource(question),false,question)
  const route=routeSystemCapability({message:question,hasClient:false})
  assert.equal(route.intent,'ASK_GENERAL',question)
  const result=await general({message:question,route,aiClient:ai.client,aiModel:'gpt-test'})
  assert.equal(ai.calls.length,1,question)
  assert.equal(result.advice.answer,expected,question)
  assert.equal(result.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE',question)
 }
 for(const question of ['O que é a dose de Fox Xpro?','Explique a dose de 1 L/ha de herbicida','O que é dose de herbicida e qual devo aplicar?','Qual a diferença entre dose de produto comercial e a dose que devo usar?','Explique a dose de herbicida para o produtor Antônio'])assert.equal(requiresVerifiedGeneralSource(question),true,question)
})

test('referência de catálogo não troca variante, não presume composição ausente nem intercepta SPIN',async()=>{
 for(const question of ['O que é Fox Xpro Ultra?','Qual dose de Fox Xpro aplicar no milho?','Fox Xpro é melhor que outro produto?'])assert.equal(generalProductCatalogGuidance(question),null,question)
 const foliar=await general({message:'O que é o produto XTEND PROTECT?'})
 assert.match(foliar.advice.answer,/composição não está confirmada/)
 const spin=await general({message:'O que é SPIN?'})
 assert.match(spin.advice.answer,/orientar descoberta/)
 assert.equal(spin.advice.ai_reasoning.run.tool_result.context.knowledge_item_id,'KI-004')
})

test('envelope forjado não pode atribuir uma marca ou atualidade ao catálogo',async()=>{
 const question='O que é o produto Fox Xpro?'
 const response=await general({message:question})
 const tool=structuredClone(response.advice.ai_reasoning.run.tool_result)
 tool.context.product_catalog_ref.current_status='CURRENT'
 const execution={path:'CONTEXT',capabilities_planned:['KNOWLEDGE_LIBRARY'],capabilities_used:[],capability_results:[],tool_result:tool}
 assert.throws(()=>buildCapabilityExecutionResponse({execution,route:routeSystemCapability({message:question,hasClient:false}),message:question,organizationId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a'}),error=>error.reason==='GENERAL_SOURCE_CONTENT_MISMATCH')
})
