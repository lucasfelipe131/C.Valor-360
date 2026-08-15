import test from 'node:test'
import assert from 'node:assert/strict'
import {buildDecisionIntelligence,buildNexoFallback,buildStrategicSynthesis,isGenericValText} from '../server/decision-intelligence.js'
import {buildValueBridge,isCommercialProductComparison} from '../server/product-intelligence.js'

const NOW=new Date('2026-08-14T12:00:00.000Z').getTime()

function richContext(){return {
  client:{id:'produtor-1',name:'Marcos Almeida',cultures:'Soja, milho',technicalPresentation:'Comparativo em tabela',trustDriver:'Resultado medido no talhão',commercial:{purchaseCurrentSeason:100_000,potentialTotal:1_000_000,openPotential:900_000,openPipeline:0,lastBusinessAt:'2026-08-01T12:00:00.000Z'}},
  profile:{answers:{8:'Comparativo em tabela',14:'Resultado medido no talhão'},assessedAt:'2026-07-20T12:00:00.000Z'},
  opportunities:[{id:'opp-1',title:'2,4-D Nortox',stage:'Proposta',estimated_value:120_000,updated_at:'2026-08-02T12:00:00.000Z',evidence:[]}],
  interactions:[{id:'interaction-1',channel:'visita',summary:'Produtor pediu uma comparação antes de decidir.',occurred_at:'2026-08-02T12:00:00.000Z'}],
  businessHistory:[{id:'business-1',product:'2,4-D Nortox',category:'Herbicida',outcome:'lost',loss_reason:'Preço',value:80_000,occurred_at:'2026-08-01T12:00:00.000Z'}],
  properties:[{id:'property-1',name:'Fazenda Horizonte',fields:[{id:'field-1',name:'Talhão Norte',seasons:[{season:'2025/26',crop:'Soja',area_ha:180,productivity_target:75,productivity_actual:62,unit:'sc/ha',created_at:'2026-08-03T12:00:00.000Z'}]}]}],
  fieldReports:[{id:'report-1',crop_stage:'Fechamento',summary:'Desuniformidade registrada para conferência.',observed_at:'2026-08-10T12:00:00.000Z',observations:[]}],
  soilAnalyses:[],ndviObservations:[],manualRecords:[],memories:[],signals:[],
  priorRecommendations:[{id:'rec-1',next_best_action:'Confirmar o formato de prova antes da proposta.',created_at:'2026-08-04T12:00:00.000Z'}]
}}

test('VAL NEXO cruza fontes, mantém hipóteses concorrentes e escolhe o dado de maior valor',()=>{
  const context=richContext()
  const intelligence=buildDecisionIntelligence(context,NOW)
  const kinds=intelligence.signals.map(item=>item.kind)
  assert.ok(kinds.includes('technical_without_followup'))
  assert.ok(kinds.includes('proof_gap'))
  assert.ok(kinds.includes('potential_pipeline_gap'))
  assert.ok(kinds.includes('productivity_gap'))
  assert.ok(kinds.includes('unclosed_learning_loop'))
  assert.equal(intelligence.cross_source_ready,true)
  assert.ok(intelligence.evidence.some(item=>item.id==='latest-crop-season'&&/meta 75 sc por hectare/i.test(item.claim_supported)))
  assert.ok(intelligence.evidence.some(item=>item.id==='latest-field-report'&&/Desuniformidade registrada/i.test(item.claim_supported)))

  const synthesis=buildStrategicSynthesis(intelligence,context)
  assert.ok(synthesis.cross_source_connections.some(item=>item.evidence_ids.length>=2))
  assert.equal(synthesis.competing_hypotheses.length,2)
  assert.ok(synthesis.competing_hypotheses.every(item=>item.falsifier&&item.validation_move))
  assert.match(synthesis.highest_value_unknown.why_it_matters,/separa/i)
  assert.match(synthesis.learning_loop.next_update,/confirmado, refutado ou substituído/i)

  const fallback=buildNexoFallback(intelligence,context,'descobrir')
  assert.equal(isGenericValText(fallback.answer),false)
  assert.match(fallback.answer,/Marcos:/)
  assert.ok(fallback.executive_brief.evidence_ids.length>=2)
  assert.doesNotMatch(fallback.executive_brief.action,/conduzir uma conversa breve/i)
})

test('Ponte de Valor encontra candidatas oficiais sem prometer equivalência ou superioridade',()=>{
  const context=richContext()
  context.decisionIntelligence=buildDecisionIntelligence(context,NOW)
  const result=buildValueBridge(context,'O concorrente está mais barato no 2,4-D Nortox. Quero similares para negociar por valor.')
  assert.equal(result.value_bridge.status,'ready')
  assert.equal(result.value_bridge.anchor_product.name,'2,4-D Nortox')
  assert.ok(result.value_bridge.alternatives.length>=1&&result.value_bridge.alternatives.length<=3)
  assert.ok(result.value_bridge.alternatives.every(item=>item.evidence_id&&item.official_check_required))
  assert.ok(result.value_bridge.alternatives.every(item=>/não prova|confirmar/i.test(item.tradeoffs)))
  assert.match(result.value_bridge.do_not_claim,/é igual|é melhor/i)
  assert.match(result.value_bridge.negotiation_question,/Além do preço/i)
  assert.ok(result.evidence.every(item=>item.source_type==='official_product_catalog'))
  assert.equal(isCommercialProductComparison('Compare produtos similares para negociar preço.'),true)
  assert.equal(isCommercialProductComparison('Qual produto aplicar para controlar a praga?'),false)
})

test('Ponte de Valor pede referência em vez de inventar marcas',()=>{
  const result=buildValueBridge({client:{name:'Produtor'}},'O preço está alto e preciso de uma alternativa melhor.')
  assert.equal(result.value_bridge.status,'needs_product')
  assert.equal(result.value_bridge.anchor_product,null)
  assert.deepEqual(result.value_bridge.alternatives,[])
  assert.match(result.value_bridge.negotiation_question,/Qual produto está sendo comparado/i)
})
