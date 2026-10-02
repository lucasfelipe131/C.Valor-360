import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCapabilityExecutionResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {selectKnowledge} from '../server/knowledge/selection.js'

// No model/provider is invoked: exercise the final response validator with
// synthetic, explicitly unverified general-knowledge tool output.
function response(message,summary){
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const tool={status:'EXECUTED',capability:'AI_GENERAL_KNOWLEDGE',tool:'ai_general_knowledge',title:'Conhecimento geral do modelo (não verificado)',summary,page:'copilot',manual_page:null,mode:'general_unverified',context:{client_id:null,private_memory_used:false}}
 const execution={path:route.path,capabilities_planned:route.capabilities,capabilities_used:['AI_GENERAL_KNOWLEDGE'],capability_results:[{capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',source_ref:'system:ai-general-knowledge:v1',tool_result:tool}],tool_result:tool,active_context:null}
 return buildCapabilityExecutionResponse({execution,route,message,organizationId:'synthetic-tenant',ownerId:'synthetic-owner',conversationId:'synthetic-conversation'})
}

test('PR106 + GR15: response-wide first sentence survives clause-level antecedent resolution',()=>{
 for(const [question,answer] of [
  ['o que e a calda de pulverizacao?','A calda de pulverização perde eficácia com o tempo. Ela perdeu estabilidade depois de seis horas no tanque de pulverização.'],
  ['o que e o mofo branco?','O mofo branco sobrevive no solo por anos. Ele fechou o ciclo com a chuva prolongada e o dossel fechado do mofo branco.'],
  ['o que é cigarrinha-do-milho?','A cigarrinha-do-milho transmite enfezamentos. Ela é favorecida por plantios escalonados.']
 ])assert.notEqual(response(question,answer).advice.ai_reasoning.grounding.blocked,true,answer)
})

test('PR106 + GR15: first sentence and later private transactions remain blocked in final response',()=>{
 for(const answer of [
  'Ele plantou cedo no calendário de plantio.',
  'O produtor tem 500 hectares de soja no calendário de plantio.',
  'O calendário de plantio orienta a semeadura. Ele comprou insumos para a safra.',
  'O calendário de plantio orienta a semeadura. Ela deve ter assinado o contrato.',
  'O calendário de plantio orienta a semeadura. Ela deve rapidamente estar inadimplente com o banco.'
 ])assert.equal(response('o que é o calendário de plantio?',answer).advice.ai_reasoning.grounding.blocked,true,answer)
})

test('PR106 + lexical selection: normalized infinitive and relation retain topic, never unknown brand',()=>{
 for(const query of ['COMO AGIR FRENTE À RESISTÊNCIA DE PLANTAS DANINHAS?','como manejar diante da resistência de plantas daninhas?']){
  const result=selectKnowledge({query,limit:1})
  assert.equal(result.status,'SELECTED',query)
  assert.equal(result.items[0].knowledge_item_id,'KI-112')
 }
 for(const query of ['como usar Premier diante da resistência de plantas daninhas?','como agir diante de souvenir nas plantas daninhas?'])assert.equal(selectKnowledge({query,limit:1}).status,'NO_APPLICABLE_KNOWLEDGE',query)
})
