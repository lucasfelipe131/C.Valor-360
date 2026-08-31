import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConversationContinuity,
  buildConversationOrchestration,
  chooseAutomaticRoute,
  enrichAdviceWithOrchestration,
  extractProductMentions
} from '../server/conversation-orchestrator-runtime.js'
import {prepareConversationThread} from '../server/conversation-thread-context.js'

const question='FIZEMOS A APLICAÇÃO DE DESSECAÇÃO NA ÁREA PRÉ MILHO, ENTRAMOS COM GLUFOSINATO, CALARIS, DUAL GOLD E TRINCA CAPS. Preciso projetar o manejo de inseticidas visando cigarrinha no milho e me ajudar em uma venda de valor para o produto novo eficon da basf que custa 170 reais/ha'

const threadScope={
  tenant_id:'tenant-conversation-test',
  owner_id:'owner-conversation-test',
  producer_id:'produtor-1',
  conversation_id:'conversation-orchestrator-test',
  context_epoch:0,
  domain:'GENERAL'
}
const scopedTurn=(item,activeContext=question)=>({...threadScope,...item,user_question:activeContext===item.user_question?item.user_question:`${item.user_question}\nContexto técnico-comercial ativo do último turno concluído: ${activeContext}`})

const baseContext={
  client:{id:'produtor-1',name:'João da Silva',area:100,cultures:'Milho',commercial:{potentialTotal:800000,purchaseCurrentSeason:300000}},
  contextSnapshot:{organization_id:threadScope.tenant_id,subject:{type:'client',id:threadScope.producer_id},context_scope:{tenant_id:threadScope.tenant_id,owner_id:threadScope.owner_id,producer_id:threadScope.producer_id,conversation_id:threadScope.conversation_id,context_epoch:threadScope.context_epoch,domain:threadScope.domain}},
  opportunities:[{id:'o1',title:'Programa inicial de milho',category:'Milho',stage:'Proposta',estimated_value:45000,next_action:'Validar programa com o produtor',next_action_at:'2026-08-20T12:00:00.000Z',updated_at:'2026-08-15T12:00:00.000Z',evidence:[{id:'e1'}]}],
  visits:[{id:'v1',summary:'Área pré-milho em preparação.',updated_at:'2026-08-15T12:00:00.000Z'}],
  interactions:[],businessHistory:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[]
}

function genericAdvice(){
  return {
    answer:'Converse com o cliente, entenda suas necessidades e apresente os benefícios do produto.',
    objective:'Ajudar na negociação.',
    executive_brief:{priority:'acompanhar',headline:'Preparar conversa',reason:'Há uma oportunidade.',action:'Converse com o cliente.',deadline:'No próximo contato',question:'O que ele precisa?',decision_basis:[],evidence_ids:[],missing_data:[]},
    next_best_action:'Faça contato com o cliente.',
    next_question:{stage:'situação',type:'aberta',question:'O que ele precisa?',ask_when:'Agora',purpose:'Entender.',evidence_needed:'Resposta.',grounding_ids:[]},
    questions:[],
    conversation_plan:{opening:'',steps:[],closing_options:[],do_not_say:[]},
    confidence:{level:'not_calibrated',missing_data:[]},
    evidence_used:[],human_review:{required:false,reason:'',required_role:'none'},blocked_actions:[],guardrails:[],
    conversion_intelligence:{score:74,priority:'esta_semana',selected_opportunity:{id:'o1',title:'Programa inicial de milho',score:74,reasons:['proposta registrada','janela próxima'],components:{economic:70,urgency:80,evidence:62}},workflow:{label:'Construir valor',action:'Validar critério e proposta.',question:'Qual resultado precisa ser protegido?'},data_quality:{score:68,missing:[],contradictions:[]},learning:{sample_size:0,mature:false,status:'amostra insuficiente'}}
  }
}

test('reconhece todos os produtos e corrige a grafia de Efficon',()=>{
  const products=extractProductMentions(question)
  assert.deepEqual(products.map(item=>item.name),['Glufosinato','Calaris®','Dual Gold®','Efficon®','Trinca Caps®'])
})

test('classifica pergunta técnico-comercial para rota híbrida com base oficial',()=>{
  const orchestration=buildConversationOrchestration(baseContext,question)
  assert.equal(orchestration.route.intent,'agronomic_commercial_decision')
  assert.equal(orchestration.route.mode,'retrieval_hybrid')
  assert.equal(orchestration.route.useGenerativeAi,true)
  assert.equal(orchestration.route.retrieval,true)
  assert.equal(orchestration.route.humanReview,true)
  assert.equal(orchestration.technicalCommercialPlan.focusProduct.name,'Efficon®')
  assert.equal(orchestration.technicalCommercialPlan.costPerHa,170)
  assert.equal(orchestration.technicalCommercialPlan.areaHa,100)
  assert.equal(orchestration.technicalCommercialPlan.totalInvestment,17000)
  assert.match(orchestration.technicalCommercialPlan.focusProduct.labelReference.target,/Dalbulus maidis/)
})

test('a próxima conversa herda produtos, operação e custo da pergunta anterior',()=>{
  const context={
    ...baseContext,
    priorRecommendations:[scopedTurn({
      id:'r1',user_question:question,created_at:'2026-08-16T21:20:00.000Z',next_best_action:'Mapear risco e proposta.'
    })]
  }
  const continuity=buildConversationContinuity(context,'E agora como eu conduzo a próxima conversa e fecho a decisão?')
  assert.equal(continuity.carryForward,true)
  assert.equal(continuity.operation,'Dessecação pré-milho')
  assert.equal(continuity.costPerHa,170)
  for(const product of ['Glufosinato','Calaris®','Dual Gold®','Trinca Caps®','Efficon®'])assert.ok(continuity.productNames.includes(product),`Produto não herdado: ${product}`)
  assert.match(continuity.contextSentence,/Glufosinato/)
  assert.match(continuity.contextSentence,/Efficon/)
})

test('resposta técnica deixa de ser genérica e cita toda a sequência anterior',()=>{
  const context={...baseContext,priorRecommendations:[scopedTurn({id:'r1',user_question:question,created_at:'2026-08-16T21:20:00.000Z'})]}
  const orchestration=buildConversationOrchestration(context,'Continue e me ajude a tomar a decisão.')
  const advice=enrichAdviceWithOrchestration(genericAdvice(),orchestration,{usedGenerativeAi:true})
  assert.doesNotMatch(advice.answer,/Converse com o cliente, entenda suas necessidades/)
  for(const product of ['Glufosinato','Calaris','Dual Gold','Trinca Caps','Efficon'])assert.match(advice.answer,new RegExp(product,'i'))
  assert.match(advice.answer,/cigarrinha/i)
  assert.match(advice.answer,/170/)
  assert.equal(advice.human_review.required,true)
  assert.match(advice.human_review.reason,/Efficon/)
  assert.ok(advice.technical_commercial_plan)
  assert.ok(advice.decision_sequence.steps.length>=6)
  assert.equal(advice.automatic_routing.used_generative_ai,true)
  assert.equal(advice.generic_response_blocked,true)
})

test('cálculo de valor usa números confirmados sem inventar perda',()=>{
  const message=`${question}. A saca está 68 reais/sc e a área é 100 ha.`
  const orchestration=buildConversationOrchestration(baseContext,message)
  const plan=orchestration.technicalCommercialPlan
  assert.equal(plan.totalInvestment,17000)
  assert.ok(Math.abs(plan.breakEvenBagsPerHa-2.5)<0.0001)
  assert.match(plan.commercialValue.breakEvenSentence,/2,5 sc\/ha/)
  assert.match(plan.commercialValue.positioning,/não vender/i)
})

test('botão de priorização usa regras e não precisa chamar IA',()=>{
  const message='Cruze todo o dossiê deste produtor, compare as oportunidades abertas e indique qual decisão merece prioridade agora, com score, evidências, lacunas e próxima ação.'
  const continuity=buildConversationContinuity(baseContext,message)
  const route=chooseAutomaticRoute(baseContext,message,continuity)
  assert.equal(route.intent,'account_priority')
  assert.equal(route.mode,'deterministic')
  assert.equal(route.useGenerativeAi,false)
})

test('botão de preparação de visita é determinístico quando o pedido é direto',()=>{
  const message='Prepare a próxima visita para este produtor. Defina objetivo, oportunidade prioritária, perguntas úteis, critério de avanço e compromisso esperado.'
  const continuity=buildConversationContinuity(baseContext,message)
  const route=chooseAutomaticRoute(baseContext,message,continuity)
  assert.equal(route.intent,'visit_preparation')
  assert.equal(route.useGenerativeAi,false)
  const orchestration=buildConversationOrchestration(baseContext,message)
  const advice=enrichAdviceWithOrchestration(genericAdvice(),orchestration,{usedGenerativeAi:false})
  assert.match(advice.answer,/João da Silva/)
  assert.match(advice.answer,/Programa inicial de milho/)
  assert.match(advice.answer,/74\/100/)
  assert.equal(advice.automatic_routing.used_generative_ai,false)
})

test('mudança explícita de assunto não carrega os produtos anteriores',()=>{
  const context={...baseContext,priorRecommendations:[scopedTurn({id:'r1',user_question:question,created_at:'2026-08-16T21:20:00.000Z'})]}
  const continuity=buildConversationContinuity(context,'Novo assunto: quero falar de trigo.')
  assert.equal(continuity.carryForward,false)
  assert.equal(continuity.previousProductNames.length,5)
  assert.deepEqual(continuity.products,[])
})

test('sequência avança um dado por vez em vez de repetir perguntas prontas',()=>{
  const context={...baseContext,priorRecommendations:[scopedTurn({id:'r1',user_question:question,created_at:'2026-08-16T21:20:00.000Z'})]}
  const firstThread=prepareConversationThread(context,'Continue o planejamento.')
  const first=buildConversationOrchestration(firstThread.context,firstThread.message).technicalCommercialPlan
  assert.match(first.nextQuestion,/data prevista de emergência|milho tiguera|lavoura de milho mais velha/i)
  const secondContext={...context,priorRecommendations:[
    scopedTurn({id:'r2',user_question:'A emergência será dia 10 e não há tiguera, mas existe milho mais velho ao lado.',created_at:'2026-08-16T21:30:00.000Z'}),
    ...context.priorRecommendations
  ]}
  const secondThread=prepareConversationThread(secondContext,'Pode seguir.')
  assert.equal(secondThread.continued,true)
  assert.match(secondThread.message,/Efficon|eficon/i)
  const second=buildConversationOrchestration(secondThread.context,secondThread.message).technicalCommercialPlan
  assert.match(second.nextQuestion,/híbrido|tratamento de sementes/i)
  assert.notEqual(second.nextQuestion,first.nextQuestion)
})

test('o fio ativo sobrevive a uma resposta intermediária sem repetir os produtos',()=>{
  const context={...baseContext,priorRecommendations:[
    scopedTurn({id:'r3',user_question:'O híbrido será X e o tratamento de sementes já foi definido.',created_at:'2026-08-16T21:40:00.000Z'}),
    scopedTurn({id:'r2',user_question:'A emergência será dia 10 e existe milho mais velho ao lado.',created_at:'2026-08-16T21:30:00.000Z'}),
    scopedTurn({id:'r1',user_question:question,created_at:'2026-08-16T21:20:00.000Z'})
  ]}
  const thread=prepareConversationThread(context,'Prossiga para a próxima decisão.')
  const orchestration=buildConversationOrchestration(thread.context,thread.message)
  assert.equal(orchestration.route.intent,'agronomic_commercial_decision')
  assert.equal(orchestration.technicalCommercialPlan.focusProduct.name,'Efficon®')
  for(const product of ['Glufosinato','Calaris®','Dual Gold®','Trinca Caps®','Efficon®'])assert.ok(orchestration.continuity.productNames.includes(product))
})
