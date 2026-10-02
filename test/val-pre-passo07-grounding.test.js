import assert from 'node:assert/strict'
import test from 'node:test'
import {evaluateResponseGrounding,evaluateReasoningGrounding} from '../server/decision-copilot/response-grounding.js'
import {buildCapabilityExecutionResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {selectKnowledge} from '../server/knowledge/selection.js'

const visit='Visita Realizada em 08/09/2026 na Fazenda Sintética.'
const evidence={source_type:'visit',source_id:'uat-visit-a',statement:visit,evidence_type:'FACT',observed_at:'2026-09-08T12:00:00Z',producer_id:'uat-a',tenant_id:'uat-tenant',owner_id:'uat-owner'}
const scope={question:'quando foi a última visita concluída do Produtor Sintético A?',activeProducerId:'uat-a',activeProducerName:'Produtor Sintético A',tenantId:'uat-tenant',ownerId:'uat-owner',now:new Date('2026-09-19T12:00:00Z')}
const general=(question,answer)=>{
 const route=routeSystemCapability({message:question,intentHint:'ASK_GENERAL',hasClient:false})
 const tool={status:'EXECUTED',capability:'AI_GENERAL_KNOWLEDGE',tool:'ai_general_knowledge',title:'Conhecimento geral do modelo (não verificado)',summary:answer,page:'copilot',manual_page:null,mode:'general_unverified',context:{client_id:null,private_memory_used:false}}
 const execution={path:route.path,capabilities_planned:route.capabilities,capabilities_used:['AI_GENERAL_KNOWLEDGE'],capability_results:[{capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',source_ref:'system:ai-general-knowledge:v1',tool_result:tool}],tool_result:tool,active_context:null}
 return buildCapabilityExecutionResponse({execution,route,message:question,organizationId:'uat-tenant',ownerId:'uat-owner',conversationId:'uat-conversation'}).advice.ai_reasoning.grounding
}

test('GROUND-02: authorized completed visit answers through fast and deep grounding',()=>{
 assert.equal(evaluateResponseGrounding({...scope,answer:visit,evidence:[evidence]}).passed,true)
 assert.equal(evaluateReasoningGrounding({...scope,blocks:{'recommended_strategy.reading':visit},evidence:[evidence]}).passed,true)
})

test('GROUND-02: facet relevance cannot authorize another owner, producer, future visit or invented date',()=>{
 for(const patch of [{owner_id:'other'},{tenant_id:'other'},{producer_id:'uat-b'},{source_type:'scheduled_visit',statement:'Próxima visita agendada para 25/09/2026.'},{statement:'Visita cancelada em 08/09/2026.',status:'Cancelada'},{statement:'Visita agendada para 25/09/2026.',lifecycle_status:'PLANNED'}]){
  const record={...evidence,...patch}
  assert.equal(evaluateResponseGrounding({...scope,answer:record.statement,evidence:[record]}).passed,false,JSON.stringify(patch))
 }
 assert.equal(evaluateResponseGrounding({...scope,answer:'Visita Realizada em 09/09/2026 na Fazenda Sintética.',evidence:[evidence]}).passed,false)
 assert.equal(evaluateResponseGrounding({...scope,answer:visit,evidence:[]}).passed,false)
})

test('question_relevance: elliptical explanation retains the requested concept without requiring a domain keyword twice',()=>{
 assert.equal(general('o que é um inseticida sistêmico?','Um sistêmico é absorvido pela planta. Ele exige menos cobertura.').blocked===true,false)
 for(const answer of ['A cobertura é um tipo de telhado.','O fungicida controla doenças na lavoura.','O perfil é analítico e ele tem 500 hectares.'])assert.equal(general('o que é um inseticida sistêmico?',answer).blocked===true,true,answer)
})

test('genericAssertion: an explicit agronomic antecedent and passive predicate do not become a producer claim',()=>{
 for(const [question,answer] of [
  ['o que é cigarrinha-do-milho?','A cigarrinha-do-milho transmite enfezamentos. Ela é favorecida por plantios escalonados.'],
  ['o que é ferrugem na lavoura?','A ferrugem é uma doença da lavoura. Ela é favorecida pelo plantio escalonado.'],
  ['o que é um inseticida sistêmico?','Um inseticida sistêmico é absorvido pela planta. Ele é transportado nos tecidos da cultura.']
 ])assert.equal(general(question,answer).blocked===true,false,answer)
})

test('genericAssertion: a conceptual preface cannot launder private claims or ambiguous pronouns',()=>{
 for(const tail of ['Ele é analítico.','Ela está com a proposta parada.','Ele tem 500 hectares.','Ela vendeu soja.','Ela é favorecida por plantios e ele comprou insumos.','Ela deve ao banco.']){
  assert.equal(general('o que é cigarrinha-do-milho?',`A cigarrinha-do-milho transmite enfezamentos. ${tail}`).blocked===true,true,tail)
 }
 assert.equal(general('o que é cigarrinha-do-milho?','Ela é favorecida por plantios escalonados.').blocked===true,true,'no explicit antecedent')
 for(const subject of ['A mulher trabalha no plantio.','A Joana trabalha no plantio.','O produtor trabalha no plantio.'])assert.equal(general('o que é cigarrinha-do-milho?',`${subject} Ela é favorecida por plantios escalonados.`).blocked===true,true,subject)
})

test('Library: grammatical prepositional phrases do not become a rare subject veto',()=>{
 for(const query of ['o que fazer diante da resistência de plantas daninhas?','como agir frente à resistência de plantas daninhas?','explique acerca da resistência de plantas daninhas']){
  const result=selectKnowledge({query,limit:1,now:scope.now})
  assert.equal(result.status,'SELECTED',JSON.stringify({query,audit:result.audit}))
  assert.equal(result.items[0].knowledge_item_id,'KI-112')
 }
 for(const query of ['qual a capital da Austrália?','qual a temperatura ideal para germinação do milho?','como lidar com souvenir diante da resistência de plantas daninhas?']){
  assert.equal(selectKnowledge({query,limit:1,now:scope.now}).status,'NO_APPLICABLE_KNOWLEDGE',query)
 }
})
