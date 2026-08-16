import assert from 'node:assert/strict'
import test from 'node:test'
import {buildConversionFoundation,buildConversionIntelligence,reconcileAdviceWithConversion} from '../server/conversion-engine.js'

const now='2026-08-16T18:00:00.000Z'
const baseContext={
  client:{id:'p1',name:'João',municipality:'São Luiz Gonzaga',area:1200,cultures:'soja, milho',commercial:{purchaseCurrentSeason:400000,potentialTotal:1000000,openPipeline:280000,lastBusinessAt:'2026-08-05T12:00:00Z'}},
  profile:{answers:{7:'segurança e estabilidade',14:'evidência de campo'},assessedAt:'2026-08-01T12:00:00Z'},
  visits:[{id:'v1',summary:'Produtor ampliará milho e está preocupado com estabilidade.',updated_at:'2026-08-10T12:00:00Z'}],
  interactions:[{id:'i1',summary:'Pediu comparação de proposta e retorno nesta semana.',occurred_at:'2026-08-12T12:00:00Z'}],
  opportunities:[
    {id:'o1',title:'Expansão de milho',category:'Milho',stage:'Negociação',estimated_value:220000,probability:70,next_action:'Confirmar proposta e decisão',next_action_at:'2026-08-18T12:00:00Z',updated_at:'2026-08-12T12:00:00Z',evidence:[{id:'ev1'}]},
    {id:'o2',title:'Manejo de soja',category:'Soja',stage:'Diagnóstico',estimated_value:300000,next_action:'Mapear necessidade',next_action_at:'2026-09-10T12:00:00Z',updated_at:'2026-08-05T12:00:00Z'}
  ],
  priorRecommendations:[]
}

test('prioriza por motor determinístico e produz orientação específica',()=>{
  const intelligence=buildConversionIntelligence(baseContext,'Prepare a visita para avançar esta negociação',{now})
  assert.equal(intelligence.selectedOpportunity.id,'o1')
  assert.ok(intelligence.selectedOpportunity.score>=68)
  assert.equal(intelligence.authority.decisionCore,'deterministic_rules')
  assert.equal(intelligence.authority.generativeAiRole,'language_summary_only')
  assert.match(intelligence.narrative.answer,/João/)
  assert.match(intelligence.narrative.answer,/Expansão de milho/)
  assert.match(intelligence.workflow.action,/compromisso|decisão/i)
  assert.equal(intelligence.guardrails.noInventedProbability,false)
})

test('não inventa valor nem probabilidade quando a conta está incompleta',()=>{
  const context={client:{id:'p2',name:'Maria'},opportunities:[],visits:[],interactions:[],priorRecommendations:[]}
  const intelligence=buildConversionIntelligence(context,'Qual a próxima ação?',{now})
  assert.equal(intelligence.selectedOpportunity.amount,null)
  assert.equal(intelligence.selectedOpportunity.probabilityRegistered,null)
  assert.equal(intelligence.guardrails.noInventedAmount,true)
  assert.equal(intelligence.guardrails.noInventedProbability,true)
  assert.equal(intelligence.workflow.code,'completar_contexto')
  assert.equal(intelligence.confidence.level,'baixa')
  assert.match(intelligence.workflow.action,/Atualizar a conta de Maria/)
})

test('objeção de preço aciona workflow de valor sem desconto automático',()=>{
  const intelligence=buildConversionIntelligence(baseContext,'O produtor disse que está caro e quer desconto',{now})
  assert.equal(intelligence.workflow.code,'defender_valor')
  assert.match(intelligence.workflow.question,/além do preço/i)
  assert.match(intelligence.workflow.avoid,/desconto automático/i)
})

test('feedback só altera pesos com amostra mínima e permanece limitado',()=>{
  const immature=buildConversionFoundation({...baseContext,priorRecommendations:baseContext.priorRecommendations.slice(0,0)},{now})
  assert.equal(immature.learning.mature,false)
  assert.deepEqual(immature.learning.adjustments,{evidence:0,urgency:0,momentum:0})
  const priorRecommendations=Array.from({length:8},(_,index)=>({id:`r${index}`,created_at:`2026-08-${String(index+1).padStart(2,'0')}T12:00:00Z`,feedback:{outcome:index<6?'won':'lost',notes:index<6?'':'Preço'}}))
  const mature=buildConversionFoundation({...baseContext,priorRecommendations},{now})
  assert.equal(mature.learning.mature,true)
  assert.ok(Math.abs(mature.learning.adjustments.evidence)<=4)
  assert.ok(Math.abs(mature.learning.adjustments.urgency)<=3)
  assert.ok(Math.abs(mature.learning.adjustments.momentum)<=3)
})

test('reconciliação substitui resposta genérica pelos fatos calculados',()=>{
  const conversion=buildConversionIntelligence(baseContext,'Qual a próxima ação?',{now})
  const advice=reconcileAdviceWithConversion({answer:'Converse com o cliente e entenda suas necessidades.',next_best_action:'Faça contato.',confidence:{}},conversion)
  assert.doesNotMatch(advice.answer,/Converse com o cliente e entenda suas necessidades/)
  assert.match(advice.answer,/João/)
  assert.equal(advice.generic_response_blocked,true)
  assert.equal(advice.decision_source,'deterministic_conversion_core')
  assert.equal(advice.generative_ai_role,'language_summary_only')
  assert.equal(advice.confidence.conversion_probability,null)
  assert.ok(advice.evidence_used.length>=3)
})

test('reconciliação preserva bloqueio técnico humano',()=>{
  const conversion=buildConversionIntelligence(baseContext,'Qual dose e produto devo aplicar?',{now})
  const advice=reconcileAdviceWithConversion({
    answer:'A orientação técnica foi retida para revisão.',
    next_best_action:'Encaminhar ao responsável técnico.',
    executive_brief:{action:'Encaminhar ao responsável técnico.',question:'Quais dados faltam?'},
    human_review:{required:true},
    blocked_actions:['Prescrever dose']
  },conversion)
  assert.equal(advice.answer,'A orientação técnica foi retida para revisão.')
  assert.equal(advice.next_best_action,'Encaminhar ao responsável técnico.')
  assert.equal(advice.conversion_intelligence.workflow.code,'validar_contexto_tecnico')
})

test('assinatura é estável para o mesmo contexto, mensagem e relógio',()=>{
  const first=buildConversionIntelligence(baseContext,'Prepare a visita',{now})
  const second=buildConversionIntelligence(baseContext,'Prepare a visita',{now})
  assert.equal(first.decisionSignature,second.decisionSignature)
  assert.equal(first.contextFingerprint,second.contextFingerprint)
})

test('prazo vencido muda a próxima ação para retomada verificável',()=>{
  const context={...baseContext,opportunities:[{...baseContext.opportunities[0],next_action_at:'2026-08-14T12:00:00Z'}]}
  const intelligence=buildConversionIntelligence(context,'Qual a próxima ação?',{now})
  assert.equal(intelligence.selectedOpportunity.urgency.overdue,true)
  assert.equal(intelligence.workflow.code,'retomar')
  assert.match(intelligence.workflow.action,/novo compromisso|reprogramada|encerrada|validar se a decisão continua ativa/i)
})

test('inconsistências comerciais reduzem a confiança e ficam explícitas',()=>{
  const context={...baseContext,client:{...baseContext.client,commercial:{...baseContext.client.commercial,purchaseCurrentSeason:1200000,potentialTotal:1000000,openPotential:1400000}}}
  const intelligence=buildConversionIntelligence(context,'Priorize a conta',{now})
  assert.ok(intelligence.dataQuality.contradictions.length>=2)
  assert.deepEqual(intelligence.confidence.contradictions,intelligence.dataQuality.contradictions)
  assert.match(intelligence.narrative.dataWarning,/Corrigir antes de usar em decisão/)
  assert.ok(intelligence.selectedOpportunity.penalties.includes('há inconsistências na conta'))
})

test('oportunidades fechadas e perdidas não entram no radar ativo',()=>{
  const context={...baseContext,opportunities:[
    {...baseContext.opportunities[0],stage:'Fechado',estimated_value:900000},
    {...baseContext.opportunities[1],stage:'Perdido',estimated_value:800000}
  ]}
  const intelligence=buildConversionIntelligence(context,'Priorize a carteira',{now})
  assert.equal(intelligence.actualOpenOpportunityCount,0)
  assert.match(intelligence.selectedOpportunity.id,/^account:/)
  const advice=reconcileAdviceWithConversion({},intelligence)
  assert.equal(advice.opportunity_review.open_count,0)
})

test('comparação comercial de produtos não é confundida com prescrição',()=>{
  const intelligence=buildConversionIntelligence(baseContext,'Compare o produto A com o produto B por preço, custo e margem',{now})
  assert.equal(intelligence.workflow.code,'defender_valor')
  assert.equal(intelligence.request.technicalIntent,false)
  assert.match(intelligence.workflow.avoid,/superioridade técnica sem validação/i)
})

test('pedido de produto e dose continua exigindo revisão técnica',()=>{
  const intelligence=buildConversionIntelligence(baseContext,'Qual produto e dose devo aplicar no milho?',{now})
  assert.equal(intelligence.request.technicalIntent,true)
  assert.equal(intelligence.workflow.code,'validar_contexto_tecnico')
  assert.equal(intelligence.guardrails.humanReviewForTechnical,true)
})

test('grafo contextual conecta produtor, culturas, propriedades e oportunidades',()=>{
  const context={...baseContext,properties:[{id:'faz1',name:'Fazenda Horizonte',fields:[{id:'t1',seasons:[{crop:'milho'}]}]}]}
  const foundation=buildConversionFoundation(context,{now})
  assert.ok(foundation.graph.nodes.some(item=>item.type==='producer'))
  assert.ok(foundation.graph.nodes.some(item=>item.type==='culture'&&/milho/i.test(item.label)))
  assert.ok(foundation.graph.nodes.some(item=>item.type==='property'))
  assert.ok(foundation.graph.nodes.some(item=>item.type==='opportunity'))
  assert.ok(foundation.graph.edges.some(item=>item.type==='has_opportunity'))
})
