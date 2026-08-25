import test from 'node:test'
import assert from 'node:assert/strict'
import {buildCommercialComposition} from '../server/commercial/composition.js'
import {buildActionPlan} from '../server/execution/action-plan.js'
import {buildPrepareVisit} from '../server/execution/prepare-visit.js'
import {buildPrepareVisitDecisionModel,evaluatePrepareVisitQuality} from '../server/execution/prepare-visit-quality.js'
import {knowledgeForModel,normalizeKnowledgeRetrieval} from '../server/commercial/knowledge-support.js'
import {loadKnowledgeLibrary,selectKnowledge} from '../server/knowledge/library.js'
import {costaBeberFixture,newProducerFixture,qualityActor,qualityTenant,soyFungicideFixture} from './support/prepare-visit-quality-context.js'

const library=loadKnowledgeLibrary()
const lowRiskItem=library.items.find(item=>item.risk==='LOW'&&item.module_targets.some(module=>['MDI','MVV'].includes(module)))
const highRiskItem=library.items.find(item=>item.risk==='HIGH')

function commercialFor(seed,knowledgeRetrieval){
 return buildCommercialComposition({
  context:seed.context,
  contextSnapshot:seed.snapshot,
  organizationId:qualityTenant,
  message:`Preparar visita: ${seed.visit.objective}`,
  knowledgeRetrieval,
  now:new Date('2026-08-24T12:00:00.000Z')
 })
}

function prepareFor(seed,commercial){
 const now=new Date('2026-08-24T12:00:00.000Z')
 const actionPlan=buildActionPlan({organizationId:qualityTenant,subjectId:seed.snapshot.subject.id,contextSnapshot:seed.snapshot,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actor:{type:'USER',id:qualityActor},defaultDueAt:seed.visit.scheduledAt,now})
 return buildPrepareVisit({organizationId:qualityTenant,contextSnapshot:seed.snapshot,context:seed.context,visit:seed.visit,behavioralProfile:commercial.behavioral_profile,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actionPlan,actor:{type:'USER',id:qualityActor},knowledgeRetrieval:commercial.knowledge_retrieval,now})
}

test('conhecimento governado sustenta MDI/MVV/Prepare sem poluir MMI ou elevar confiança factual',()=>{
 const seed=costaBeberFixture()
 const snapshotBefore=structuredClone(seed.snapshot)
 const withoutKnowledge=commercialFor(seed,{status:'NO_APPLICABLE_KNOWLEDGE',items:[]})
 const withKnowledge=commercialFor(seed,{status:'SELECTED',items:[lowRiskItem]})
 const preparation=prepareFor(seed,withKnowledge)

 assert.deepEqual(seed.snapshot,snapshotBefore)
 assert.equal('knowledge_retrieval' in seed.snapshot,false)
 assert.equal(seed.snapshot.facts.length,snapshotBefore.facts.length)
 assert.equal(withKnowledge.decision_thesis.confidence,withoutKnowledge.decision_thesis.confidence)
 assert.notDeepEqual(withKnowledge.decision_thesis.rationale,withoutKnowledge.decision_thesis.rationale)
 assert.ok(withKnowledge.decision_thesis.rationale.some(item=>item.includes(lowRiskItem.title)))
 assert.ok(!withKnowledge.decision_thesis.evidence_refs.some(item=>String(item.id).startsWith('knowledge:')))
 assert.equal(withKnowledge.knowledge_retrieval.items.length,1)
 assert.equal(withKnowledge.decision_thesis.knowledge_support[0].knowledge_item_id,lowRiskItem.knowledge_item_id)
 assert.equal(withKnowledge.value_plan.knowledge_support[0].knowledge_item_id,lowRiskItem.knowledge_item_id)
 assert.equal(preparation.knowledge_refs[0].knowledge_item_id,lowRiskItem.knowledge_item_id)
 assert.equal(preparation.quality_audit.dimensions.KNOWLEDGE_USAGE,1)
 assert.equal(preparation.quality_audit.knowledge_usage.status,'SELECTED_AND_USED')
 assert.ok(withKnowledge.value_plan.questions.every(item=>item.knowledge_refs.length===0))
})

test('seleção preserva no máximo três itens e rejeita KnowledgeItem/source_ref fabricados',()=>{
 const repeated=[...library.items.slice(0,4)]
 const normalized=normalizeKnowledgeRetrieval({status:'SELECTED',items:repeated})
 assert.equal(normalized.items.length,3)
 const fabricatedItem=normalizeKnowledgeRetrieval({status:'SELECTED',items:[{...lowRiskItem,knowledge_item_id:'KI-FABRICATED'}]})
 const fabricatedSource=normalizeKnowledgeRetrieval({status:'SELECTED',items:[{...lowRiskItem,source_refs:['SRC-999']}]})
 const multiSource=library.items.find(item=>item.source_refs.length>1&&item.risk==='LOW')
 const incompleteProvenance=normalizeKnowledgeRetrieval({status:'SELECTED',items:[{...multiSource,source_refs:multiSource.source_refs.slice(0,1)}]})
 assert.equal(fabricatedItem.status,'NO_APPLICABLE_KNOWLEDGE')
 assert.equal(fabricatedSource.status,'NO_APPLICABLE_KNOWLEDGE')
 assert.equal(incompleteProvenance.status,'NO_APPLICABLE_KNOWLEDGE')
 assert.equal(fabricatedItem.items.length,0)
 assert.equal(fabricatedSource.items.length,0)
 assert.equal(incompleteProvenance.items.length,0)
})

test('adapter preserva versão, caveats geográficos, freshness e reason codes até o modelo',()=>{
 const selected=selectKnowledge({query:'fertilizante preço solo corrigido',modules:['MIA','MDI','MVV'],geography:'Brazil',now:'2026-08-24T12:00:00.000Z'})
 const external=selected.items.find(item=>item.knowledge_item_id==='KI-019')
 assert.ok(external)
 const normalized=normalizeKnowledgeRetrieval({status:'SELECTED',items:[external],audit:selected.audit},{now:'2026-08-24T12:00:00.000Z'})
 assert.equal(normalized.library_version,'1.0')
 assert.ok(normalized.items[0].geography_caveats.length)
 assert.ok(normalized.items[0].reason_codes.some(code=>/EXTERNAL|LOCAL_VALIDATION/.test(code)))
 assert.equal(normalized.items[0].freshness,'UNKNOWN')
 assert.ok(normalized.items[0].freshness_caveats.length)
 const model=knowledgeForModel(normalized)
 assert.deepEqual(model.items[0].geography_caveats,normalized.items[0].geography_caveats)
 assert.deepEqual(model.items[0].freshness_caveats,normalized.items[0].freshness_caveats)
})

test('conteúdo HIGH_RISK permanece guardrail-only, sem ação ou prescrição no contexto do modelo',()=>{
 assert.ok(highRiskItem)
 const retrieval=normalizeKnowledgeRetrieval({status:'SELECTED',items:[{...highRiskItem,risk:'LOW',usage_mode:'DECISION_SUPPORT',requires_human_review:false}]})
 assert.equal(retrieval.items[0].risk,'HIGH')
 const model=knowledgeForModel(retrieval)
 assert.equal(model.items[0].usage_mode,'GUARDRAIL_ONLY')
 assert.equal(model.items[0].requires_human_review,true)
 assert.equal(model.items[0].statement,'')
 assert.deepEqual(model.items[0].recommended_actions,[])
 const seed=costaBeberFixture()
 const commercial=commercialFor(seed,retrieval)
 const preparation=prepareFor(seed,commercial)
 assert.equal(commercial.decision_thesis.knowledge_human_review_required,true)
 assert.match(commercial.decision_thesis.risks.join(' '),/guardrail|revisão humana/i)
 assert.ok(!commercial.decision_thesis.evidence_refs.some(item=>String(item.id).startsWith('knowledge:')))
 assert.equal(preparation.safety.knowledge_review_required,true)
 assert.equal(preparation.safety.technical_review_required,false)
 assert.doesNotMatch([preparation.objective,preparation.val_thesis,...preparation.golden_questions].join(' '),/\b(?:dose|dosagem|aplique|misture)\b/i)
})

test('KNOWLEDGE_USAGE é neutro quando explicitamente não aplicável e penaliza seleção ignorada',()=>{
 const seed=costaBeberFixture()
 const modelWithout=buildPrepareVisitDecisionModel({contextSnapshot:seed.snapshot,visitObjective:seed.visit.objective,behavioralProfile:seed.commercial.behavioral_profile,knowledgeRetrieval:{status:'NO_APPLICABLE_KNOWLEDGE',items:[]}})
 const neutral=evaluatePrepareVisitQuality(seed.preparation,{model:modelWithout,profile:seed.commercial.behavioral_profile,knowledgeRetrieval:{status:'NO_APPLICABLE_KNOWLEDGE',items:[]}})
 assert.equal(neutral.dimensions.KNOWLEDGE_USAGE,1)
 assert.equal(neutral.knowledge_usage.status,'NO_APPLICABLE_KNOWLEDGE')

 const retrieval=normalizeKnowledgeRetrieval({status:'SELECTED',items:[lowRiskItem]})
 const selectedModel=buildPrepareVisitDecisionModel({contextSnapshot:seed.snapshot,visitObjective:seed.visit.objective,behavioralProfile:seed.commercial.behavioral_profile,knowledgeRetrieval:retrieval})
 const ignored=evaluatePrepareVisitQuality({...seed.preparation,knowledge_refs:[]},{model:selectedModel,profile:seed.commercial.behavioral_profile,knowledgeRetrieval:retrieval})
 assert.equal(ignored.dimensions.KNOWLEDGE_USAGE,0)
 assert.equal(ignored.knowledge_usage.status,'SELECTED_IGNORED')
})

test('golden contrastivo recupera conhecimento diferente para milho/inseticida, soja/fungicida e produtor novo',()=>{
 const fixtures=[costaBeberFixture(),soyFungicideFixture(),newProducerFixture()]
 const selected=fixtures.map(fixture=>fixture.commercial.knowledge_retrieval.items.map(item=>item.knowledge_item_id))
 assert.equal(new Set(selected.map(items=>items.join(','))).size,3)
 for(const fixture of fixtures){
  assert.ok(fixture.commercial.knowledge_retrieval.items.length<=3)
  assert.equal(fixture.preparation.quality_audit.dimensions.KNOWLEDGE_USAGE,1)
  assert.equal(fixture.preparation.quality_audit.passed,true)
 }
 assert.ok(soyFungicideFixture().preparation.knowledge_refs.some(item=>item.risk==='HIGH'&&item.usage==='GUARDRAIL'))
})
