import assert from 'node:assert/strict'
import test from 'node:test'
import {buildDecisionIntelligence} from '../server/decision-intelligence.js'
import {buildFallbackAdvice} from '../server/sales-playbook.js'
import {enforceValSpecificity,resolveStructuredReasoningRoute} from '../server/val-specificity.js'

const NOW=Date.parse('2026-08-17T12:00:00.000Z')
const QUESTION='Prepare a próxima melhor ação para essa conta.'

function contextAna(){
  return {
    client:{
      id:'ana-ribeiro',name:'Ana Ribeiro',municipality:'Sorriso',cultures:'Soja',area:3200,
      commercial:{purchaseCurrentSeason:2_400_000,potentialTotal:3_600_000,openPipeline:900_000,lastBusinessAt:'2026-08-12T12:00:00Z'}
    },
    profile:{answers:{7:'Estabilidade e comprovação econômica',8:'Faixa comparativa na área',14:'Dados medidos na propriedade'},assessedAt:'2026-07-20T12:00:00Z'},
    opportunities:[{
      id:'opp-ana',title:'Programa de fungicida',category:'Fungicidas',stage:'Negociação',estimated_value:900_000,
      next_action:'Revisar proposta com o agrônomo',next_action_at:'2026-08-08T12:00:00Z',updated_at:'2026-08-10T12:00:00Z'
    }],
    visits:[{
      id:'visit-ana',status:'Planejada',objective:'Revisar a prova econômica do programa',next_commitment:'Validar a faixa comparativa',
      scheduled_at:'2026-08-05T12:00:00Z',updated_at:'2026-08-09T12:00:00Z'
    }],
    interactions:[{id:'interaction-ana',channel:'presencial',summary:'A produtora pediu evidência da própria área antes de fechar.',occurred_at:'2026-08-12T12:00:00Z'}],
    businessHistory:[{id:'business-ana',outcome:'won',category:'Fungicidas',product:'Programa anterior',value:760_000,occurred_at:'2026-04-20T12:00:00Z'}],
    properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[]
  }
}

function contextJoaquim(){
  return {
    client:{
      id:'joaquim-souza',name:'Joaquim Souza',municipality:'Ibiá',cultures:'Café',area:74,
      commercial:{purchaseCurrentSeason:35_000,potentialTotal:120_000,openPipeline:22_000,lastBusinessAt:'2026-08-11T12:00:00Z'}
    },
    profile:{answers:{7:'Menor desembolso imediato',8:'Comparação simples de custo',14:'Referência de vizinhos'},assessedAt:'2026-07-18T12:00:00Z'},
    opportunities:[{
      id:'opp-joaquim',title:'Adubação foliar',category:'Nutrição foliar',stage:'Diagnóstico',estimated_value:22_000,
      next_action:'Levantar análise foliar',next_action_at:'2026-09-04T12:00:00Z',updated_at:'2026-08-11T12:00:00Z'
    }],
    visits:[],
    interactions:[{id:'interaction-joaquim',channel:'telefone',summary:'O produtor voltou a comparar somente o preço por hectare.',occurred_at:'2026-08-11T12:00:00Z'}],
    businessHistory:[{id:'business-joaquim',outcome:'lost',category:'Nutrição foliar',product:'Programa foliar',value:18_000,loss_reason:'Preço',occurred_at:'2026-06-15T12:00:00Z'}],
    properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[]
  }
}

function answerFor(context){
  const decisionIntelligence=buildDecisionIntelligence(context,NOW)
  const enrichedContext={...context,decisionIntelligence}
  const fallback=buildFallbackAdvice({...enrichedContext,message:QUESTION,mode:'daily'})
  return enforceValSpecificity(fallback,enrichedContext,QUESTION,{usedGenerativeAi:false,route:{mode:'deterministic'}})
}

const neutralize=value=>String(value)
  .replace(/\b(Ana Ribeiro|Joaquim Souza|Ana|Joaquim)\b/g,'«nome»')
  .replace(/\b(Programa de fungicida|Adubação foliar)\b/g,'«oportunidade»')
  .replace(/\b(Sorriso|Ibiá|Soja|Café)\b/g,'«contexto»')
  .replace(/R\$\s?[\d.,]+/g,'«valor»')
  .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g,'«data»')
  .replace(/\b\d+(?:[.,]\d+)?\b/g,'«n»')
  .replace(/\s+/g,' ')
  .trim()

test('produtores opostos não recebem os mesmos campos de raciocínio',()=>{
  const ana=answerFor(contextAna())
  const joaquim=answerFor(contextJoaquim())
  const fields=[
    advice=>advice.strategic_synthesis.competing_hypotheses[0].explanation,
    advice=>advice.strategic_synthesis.competing_hypotheses[1].validation_move,
    advice=>advice.strategic_synthesis.learning_loop.success_signal,
    advice=>advice.strategic_synthesis.highest_value_unknown.how_to_get,
    advice=>advice.conversation_plan.do_not_say[0],
    advice=>advice.value_hypothesis.double_counting_guard
  ]
  for(const get of fields)assert.notEqual(get(ana),get(joaquim))
})

test('teste de substituição não reduz resposta e ação ao mesmo template',()=>{
  const ana=answerFor(contextAna())
  const joaquim=answerFor(contextJoaquim())
  assert.notEqual(neutralize(ana.answer),neutralize(joaquim.answer))
  assert.notEqual(neutralize(ana.executive_brief.action),neutralize(joaquim.executive_brief.action))
})

test('base da decisão cruza pelo menos duas fontes existentes',()=>{
  for(const context of [contextAna(),contextJoaquim()]){
    const advice=answerFor(context)
    const evidenceById=new Map(advice.evidence_used.map(item=>[item.id,item]))
    const types=new Set(advice.executive_brief.evidence_ids.map(id=>evidenceById.get(id)?.source_type).filter(Boolean))
    assert.ok(types.size>=2,`esperava duas fontes, recebeu ${[...types].join(', ')}`)
    assert.ok(advice.executive_brief.decision_basis.length>=2)
  }
})

test('botão comum usa raciocínio estruturado quando o dossiê tem fontes suficientes',()=>{
  const route=resolveStructuredReasoningRoute(
    {route:{intent:'account_priority',mode:'deterministic',useGenerativeAi:false},continuity:{}},
    contextAna(),
    'Priorizar a conta',
    {providerConfigured:true}
  )
  assert.equal(route.requested,true)
  assert.equal(route.useGenerativeAi,true)
  assert.equal(route.route.mode,'structured_hybrid')
  assert.ok(route.distinctCollections>=2)
})

test('barreira técnica permanece soberana sobre qualquer reparo de especificidade',()=>{
  const original={
    answer:'A VAL reteve qualquer orientação técnica acionável.',
    evidence_used:[],
    human_review:{required:true,reason:'Pedido de dose.',required_role:'technical_reviewer'},
    blocked_actions:['Prescrever produto, dose ou mistura'],
    executive_brief:{evidence_ids:[],missing_data:[]}
  }
  const result=enforceValSpecificity(original,contextAna(),'Qual dose devo aplicar?',{usedGenerativeAi:true})
  assert.equal(result.answer,original.answer)
  assert.equal(result.specificity_audit.status,'safety_preserved')
  assert.deepEqual(result.blocked_actions,original.blocked_actions)
})
