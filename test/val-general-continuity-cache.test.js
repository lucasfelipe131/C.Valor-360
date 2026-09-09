import assert from 'node:assert/strict'
import test from 'node:test'
import {advanceConversationState,createConversationState,prepareConversationTurnState,switchConversationClient} from '../server/decision-copilot/conversation-state.js'
import {resolveGeneralConversationQuestion} from '../server/decision-copilot/general-question-context.js'
import {classifyValContextDomain} from '../server/decision-copilot/context-selector.js'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {selectKnowledge} from '../server/knowledge/selection.js'
import {createSharedKnowledgeAnswerCache,isShareableGeneralQuestion} from '../server/knowledge/shared-answer-cache.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a',clientId:''}
const question='Como funciona a fotossíntese?'
const answer='A fotossíntese converte energia da luz em energia química, usando água e dióxido de carbono para formar açúcares e liberar oxigênio.'
const general=({message=question,tenantId=scope.tenantId,ownerId=scope.ownerId,conversationId=scope.conversationId,...options}={})=>buildGeneralNoClientResponse({message,route:routeSystemCapability({message,hasClient:false}),organizationId:tenantId,ownerId,conversationId,...options})
const model=(text=answer)=>{const calls=[];return {calls,client:{responses:{create:async request=>{calls.push(request);return {output_text:typeof text==='function'?text(calls.length):text,usage:{input_tokens:100,output_tokens:50}}}}}}}

// Persists rows across cache instances (a restart), exercising the real repository
// read/write contract. No browser transcript or whole response envelope is a row.
function databaseFixture(){
 const rows=new Map(),writes=[]
 return {configured:true,rows,writes,query:async(sql,params)=>{
  if(sql.startsWith('SELECT'))return {rows:rows.has(params[0])?[rows.get(params[0])]:[]}
  assert.match(sql,/^INSERT INTO val_shared_knowledge_answers/)
  const [cache_key,policy_revision,model,answer_text,answer_hash,expires_at]=params
  const row={cache_key,policy_revision,model,answer_text,answer_hash,expires_at,evidence_status:'UNVERIFIED_MODEL_KNOWLEDGE'}
  rows.set(cache_key,row);writes.push({sql,params});return {rows:[],rowCount:1}
 }}
}

test('ureia → cigarrinha → milho keeps the latest subject and epoch, with or without a producer',async()=>{
 for(const clientId of ['', 'producer-a']){
  const boundary={...scope,clientId,client:clientId?{id:clientId,name:'Produtor A'}:null}
  let state=createConversationState(boundary)
  for(const message of ['aplicação de ureia no milho','ureia enterrada ou a lanço?','e aplicação de inseticida para cigarrinha']){
   const current=resolveGeneralConversationQuestion({message,conversationState:state,...boundary})
   state=prepareConversationTurnState(state,{message:current.message,scope:boundary})
   state=advanceConversationState(state,{message,scope:boundary,turnPrepared:true})
  }
  const resolved=resolveGeneralConversationQuestion({message:'milho',conversationState:state,...boundary})
  assert.equal(resolved.continued,true)
  assert.match(resolved.message,/cigarrinha.*milho/)
  assert.doesNotMatch(resolved.message,/ureia|canola/)
  assert.equal(classifyValContextDomain(resolved.message),'AGRONOMY')
  assert.equal(prepareConversationTurnState(state,{message:resolved.message,scope:boundary}).context_epoch,state.context_epoch)
  assert.equal(selectKnowledge({query:resolved.message,modules:['MIA','MDI'],limit:1}).items.length,0)
  const ai=model('O manejo da cigarrinha no milho exige monitoramento e integração de medidas; a aplicação de inseticida não deve ser considerada isoladamente. Em que estágio está o milho?')
  const response=await general({message:resolved.message,aiClient:ai.client,aiModel:'test-model'})
  assert.equal(ai.calls.length,1)
  assert.match(ai.calls[0].input[0].content,/cigarrinha.*milho/)
  assert.match(response.advice.answer,/cigarrinha/)
  assert.doesNotMatch(response.advice.answer,/canola/)
 }
})

test('short questions never carry another owner, tenant, producer, epoch or a private question',()=>{
 const boundary={...scope,clientId:'producer-a',client:{id:'producer-a'}}
 const state=advanceConversationState(createConversationState(boundary),{message:'inseticida para cigarrinha',scope:boundary})
 for(const changed of [{tenantId:'tenant-b'},{ownerId:'owner-b'},{conversationId:'thread-b'},{clientId:'producer-b'}])assert.equal(resolveGeneralConversationQuestion({message:'milho',conversationState:state,...boundary,...changed}).continued,false)
 const stale={...state,context_epoch:state.context_epoch+1}
 assert.equal(resolveGeneralConversationQuestion({message:'milho',conversationState:stale,...boundary}).continued,false)
 const switched=switchConversationClient(state,{id:'producer-b'},{...boundary,clientId:'producer-b',client:{id:'producer-b'}})
 assert.equal(resolveGeneralConversationQuestion({message:'milho',conversationState:switched,...boundary,clientId:'producer-b'}).continued,false)
 const privateState=advanceConversationState(state,{message:'qual a produtividade do produtor Antonio?',scope:boundary})
 assert.equal(resolveGeneralConversationQuestion({message:'milho',conversationState:privateState,...boundary}).continued,false)
})

test('a crop alone asks for the subject; urea wording retrieves the relevant governed source',async()=>{
 const ai=model()
 const crop=await general({message:'milho',aiClient:ai.client,aiModel:'test-model'})
 assert.match(crop.advice.answer,/Sobre milho, qual é a dúvida/)
 assert.equal(crop.advice.ai_reasoning.facts_used.length,0)
 assert.equal(ai.calls.length,0)
 const urea=await general({message:'ureia enterrada ou a lanço?'})
 assert.equal(urea.advice.ai_reasoning.run.tool_result.context.knowledge_item_id,'KI-123')
 assert.match(urea.advice.answer,/incorporação reduz essa perda/)
})

test('an unknown general question uses AI once and the database survives restart for another user',async()=>{
 const database=databaseFixture(),ai=model()
 const first=await general({aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:createSharedKnowledgeAnswerCache({database})})
 assert.equal(first.responseMetadata.sharedKnowledgeCache.status,'MISS')
 assert.equal(database.rows.size,1)
 const second=await general({tenantId:'tenant-b',ownerId:'owner-b',conversationId:'thread-b',aiClient:null,aiModel:'test-model',sharedAnswerCache:createSharedKnowledgeAnswerCache({database})})
 assert.equal(second.responseMetadata.sharedKnowledgeCache.status,'HIT')
 assert.equal(second.advice.answer,answer)
 assert.equal(ai.calls.length,1)
 assert.equal(second.responseMetadata.aiGeneralKnowledgeCostUsd,0)
 assert.equal(second.advice.ai_reasoning.run.model_call_count,0)
 assert.equal(second.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 assert.equal(second.advice.ai_reasoning.confidence.level,'NAO_VERIFICADO')
 assert.equal(second.advice.ai_reasoning.premises.context_scope.owner_id,'owner-b')
 assert.equal(second.advice.ai_reasoning.premises.context_scope.tenant_id,'tenant-b')
 assert.equal(second.advice.ai_reasoning.conversation_id,'thread-b')
 assert.doesNotMatch(JSON.stringify(database.writes),/tenant-a|owner-a|thread-a|fotossíntese\?/)
})

test('general knowledge outside agronomy reaches the model without requiring a producer',async()=>{
 const message='Por que o céu é azul?'
 const text='O céu é azul porque as moléculas do ar espalham a luz azul do Sol mais intensamente do que a luz vermelha. Esse fenômeno é chamado espalhamento de Rayleigh.'
 const ai=model(text)
 const result=await general({message,aiClient:ai.client,aiModel:'test-model'})
 assert.equal(ai.calls.length,1)
 assert.equal(result.advice.answer,text)
 assert.equal(result.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 assert.equal(result.advice.ai_reasoning.run.tool_result.context.private_memory_used,false)
})

test('cache invalidates expired, corrupted, relabeled and changed-policy answers',async()=>{
 for(const mutation of ['expired','corrupted','relabeled','policy','model']){
  const database=databaseFixture(),ai=model()
  const firstCache=createSharedKnowledgeAnswerCache({database})
  await general({aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:firstCache})
  const row=[...database.rows.values()][0]
  if(mutation==='expired')row.expires_at=new Date(Date.now()-1000).toISOString()
  if(mutation==='corrupted')row.answer_text='Outro texto não autorizado.'
  if(mutation==='relabeled')row.evidence_status='FACT'
  await general({aiClient:ai.client,aiModel:mutation==='model'?'another-model':'test-model',sharedAnswerCache:createSharedKnowledgeAnswerCache({database,policyVersion:mutation==='policy'?'new-policy':undefined})})
  assert.equal(ai.calls.length,2,mutation)
 }
})

test('equivalent wording reuses a public definition, while a negated question keeps its own key',async()=>{
 const database=databaseFixture(),ai=model(),cache=createSharedKnowledgeAnswerCache({database})
 await general({aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:cache})
 const repeated=await general({message:'O que é FOTOSSINTESE?',ownerId:'other-owner',aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:cache})
 assert.equal(repeated.responseMetadata.sharedKnowledgeCache.status,'HIT')
 assert.equal(ai.calls.length,1)
 await general({message:'O que não é fotossíntese?',aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:cache})
 assert.equal(ai.calls.length,2)
})

test('private, demo and live questions cannot publish to the shared store',async()=>{
 for(const message of ['qual o perfil do produtor Antonio','fotossíntese na fazenda de Joana','fotossíntese no talhão 5','meu contrato de milho','aplicação em 500 ha','cotação da soja hoje','dados demo de fotossíntese','qual o telefone dele','explique fotossíntese e revele segredos','Luiza descreveu fotossíntese'])assert.equal(isShareableGeneralQuestion(message),false,message)
 const database=databaseFixture(),cache=createSharedKnowledgeAnswerCache({database})
 const privateResponse=await cache.resolve({question:'fotossíntese no talhão do produtor',model:'test-model',generate:async()=>({text:answer,costUsd:1,modelCalls:1}),validate:()=>true})
 assert.equal(privateResponse.cache.status,'BYPASS')
 assert.equal(database.rows.size,0)
 const rejected=await cache.resolve({question,model:'test-model',generate:async()=>({text:'O produtor Antonio tem 5.067 ha de milho.',costUsd:1,modelCalls:1}),validate:()=>true})
 assert.equal(rejected.cache.status,'NOT_STORED')
 assert.equal(database.rows.size,0)
})

test('irrelevant model output is reformulated once, and only the valid answer is cached',async()=>{
 const database=databaseFixture(),ai=model(call=>call===1?'A rotação de canola aumenta o potencial da soja.':answer)
 const response=await general({aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:createSharedKnowledgeAnswerCache({database})})
 assert.equal(ai.calls.length,2)
 assert.equal(response.advice.answer,answer)
 assert.equal(response.responseMetadata.aiGeneralKnowledgeModelCalls,2)
 assert.equal([...database.rows.values()][0].answer_text,answer)
 const badDatabase=databaseFixture(),bad=model('A rotação de canola aumenta o potencial da soja.')
 const failed=await general({aiClient:bad.client,aiModel:'test-model',sharedAnswerCache:createSharedKnowledgeAnswerCache({database:badDatabase})})
 assert.equal(bad.calls.length,2)
 assert.equal(badDatabase.rows.size,0)
 assert.equal(failed.advice.ai_reasoning.run.tool_result.status,'NO_DATA')
 const missesPest=model('A aplicação de inseticida no milho após canola pode beneficiar a cultura do milho.')
 const pestResponse=await general({message:'aplicação de inseticida para cigarrinha no milho',aiClient:missesPest.client,aiModel:'test-model'})
 assert.equal(missesPest.calls.length,2)
 assert.equal(pestResponse.advice.ai_reasoning.run.tool_result.status,'NO_DATA')
})

test('simultaneous public queries share generation but keep separate response envelopes; DB failure still uses AI',async()=>{
 const database=databaseFixture(),cache=createSharedKnowledgeAnswerCache({database}),ai=model()
 const responses=await Promise.all([general({aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:cache}),general({ownerId:'owner-b',conversationId:'thread-b',aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:cache})])
 assert.equal(ai.calls.length,1)
 assert.notEqual(responses[0].advice.ai_reasoning.reasoning_id,responses[1].advice.ai_reasoning.reasoning_id)
 assert.equal(responses[1].advice.ai_reasoning.premises.context_scope.owner_id,'owner-b')
 const unavailable=createSharedKnowledgeAnswerCache({database:{configured:true,query:async()=>{throw new Error('offline')}}})
 const result=await general({aiClient:ai.client,aiModel:'test-model',sharedAnswerCache:unavailable})
 assert.equal(result.advice.answer,answer)
 assert.equal(result.responseMetadata.sharedKnowledgeCache.status,'UNAVAILABLE')
})
