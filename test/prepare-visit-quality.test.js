import test from 'node:test'
import assert from 'node:assert/strict'
import {deterministicVoiceCandidateExtraction} from '../server/voice-capture/extraction.js'
import {isForbiddenPrepareVisitLanguage,prepareVisitQualityVersion} from '../server/execution/prepare-visit-quality.js'
import {costaBeberFixture,newProducerFixture,soyFungicideFixture} from './support/prepare-visit-quality-context.js'

const allDisplay=preparation=>[
 preparation.objective,preparation.why_now,preparation.val_thesis,preparation.objection_guidance,preparation.avoid_guidance,preparation.commitment_target,
 ...preparation.golden_questions,...(preparation.material_attention||[])
].join(' ')

test('PREPARE_VISIT_GOLDEN_001_COSTA_BEBER — voz legada não cria falso conflito nem dump',()=>{
 const result=costaBeberFixture()
 assert.equal(result.snapshot.conflicts.length,0)
 assert.doesNotMatch(result.preparation.objective,/Fato confirmado pelo consultor|Contexto de voz revisado|voice\.fact/i)
 assert.match(result.preparation.objective,/inseticida/i)
 assert.match(result.preparation.objective,/milho/i)
})

test('PREPARE_VISIT_GOLDEN_001_COSTA_BEBER — timing agronômico muda a preparação sem prescrever',()=>{
 const {preparation}=costaBeberFixture()
 assert.match(preparation.why_now,/milho.*emergiu.*primeira aplicação.*janela operacional/i)
 assert.match(preparation.material_attention.join(' '),/plantado.*emergido.*aplicação próxima/i)
 assert.doesNotMatch(allDisplay(preparation),/\b(?:dose|dosagem|ml\s*\/\s*ha|l\s*\/\s*ha|mistura de tanque|aplique)\b/i)
 assert.equal(preparation.safety.technical_review_required,false)
})

test('PREPARE_VISIT_GOLDEN_001_COSTA_BEBER — preço permanece hipótese comercial',()=>{
 const {commercial,preparation}=costaBeberFixture()
 assert.equal(commercial.decision_thesis.decision_context.commercial_signal.price_status,'HYPOTHESIS')
 assert.match(preparation.probable_objection,/pode ser um ponto de fricção|valide/i)
 assert.doesNotMatch(preparation.probable_objection,/confirmada pelo produtor/i)
 assert.match(preparation.material_attention.join(' '),/ponto de fricção.*não está confirmado/i)
})

test('PREPARE_VISIT_GOLDEN_001_COSTA_BEBER — MDI cria questões de decisão e MVV as torna naturais',()=>{
 const {commercial,preparation}=costaBeberFixture()
 assert.equal(commercial.decision_thesis.decision_questions.length,3)
 assert.equal(preparation.golden_questions.length,3)
 assert.ok(preparation.golden_questions.every(question=>question.endsWith('?')))
 assert.ok(preparation.golden_questions.some(question=>/primeira aplicação.*milho.*inseticida/i.test(question)))
 assert.ok(preparation.golden_questions.some(question=>/diferença de valor/i.test(question)))
 assert.ok(preparation.golden_questions.every(question=>!isForbiddenPrepareVisitLanguage(question)))
})

test('PREPARE_VISIT_GOLDEN_001_COSTA_BEBER — tese, evite e compromisso são acionáveis',()=>{
 const {commercial,preparation,actionPlan}=costaBeberFixture()
 assert.match(commercial.decision_thesis.recommended_action,/preço não deve ser tratado primeiro|valor ainda não demonstrado/i)
 assert.match(preparation.avoid_guidance,/não comece defendendo preço.*comparado/i)
 assert.match(preparation.commitment_target,/critério define a escolha.*próximo passo.*janela de aplicação/i)
 assert.ok(actionPlan.priorities.some(item=>/critério|próximo passo|janela de aplicação/i.test(item.description)))
})

test('PREPARE_VISIT_GOLDEN_001_COSTA_BEBER — histórico e perfil sustentados são usados',()=>{
 const {commercial,preparation}=costaBeberFixture('ANALYTICAL')
 assert.ok(preparation.proofs_to_take.some(item=>/histórico|números comerciais/i.test(item)))
 assert.equal(preparation.profile_approach.known,true)
 assert.match(preparation.profile_approach.guidance,/critérios|números/i)
 assert.ok(commercial.behavioral_profile.confidence>=.3)
})

test('perfil muda abordagem, não objetivo, fatos ou questões',()=>{
 const analytical=costaBeberFixture('ANALYTICAL')
 const relational=costaBeberFixture('RELATIONAL')
 assert.equal(analytical.preparation.objective,relational.preparation.objective)
 assert.deepEqual(analytical.preparation.golden_questions,relational.preparation.golden_questions)
 assert.deepEqual(analytical.snapshot.facts.map(item=>item.value),relational.snapshot.facts.map(item=>item.value))
 assert.notEqual(analytical.preparation.profile_approach.guidance,relational.preparation.profile_approach.guidance)
})

test('perfil de baixa confiança permanece neutro',()=>{
 const {preparation,commercial}=costaBeberFixture('UNKNOWN')
 assert.ok(commercial.behavioral_profile.confidence<.3)
 assert.equal(preparation.profile_approach.known,false)
 assert.doesNotMatch(preparation.profile_approach.guidance,/ROI|analítico/i)
})

test('casos Costa Beber, soja/fungicida e produtor novo são materialmente distintos',()=>{
 const costa=costaBeberFixture().preparation
 const soy=soyFungicideFixture().preparation
 const fresh=newProducerFixture().preparation
 assert.notEqual(costa.objective,soy.objective)
 assert.notEqual(costa.objective,fresh.objective)
 assert.notDeepEqual(costa.golden_questions,soy.golden_questions)
 assert.notDeepEqual(soy.golden_questions,fresh.golden_questions)
 assert.match(soy.objective,/soja|fungicida/i)
 assert.match(fresh.objective,/prioridade real|próximo passo/i)
})

test('produtor novo assume informação insuficiente sem linguagem interna',()=>{
 const {preparation}=newProducerFixture()
 assert.ok(preparation.golden_questions.length>=2&&preparation.golden_questions.length<=3)
 assert.ok(preparation.golden_questions.every(question=>!isForbiddenPrepareVisitLanguage(question)))
 assert.doesNotMatch(allDisplay(preparation),/fonte mestre|conflito material|dado crítico/i)
})

test('caso técnico soja/fungicida não vira produto, dose ou prescrição',()=>{
 const {preparation}=soyFungicideFixture()
 assert.equal(preparation.visit_type,'TECHNICAL')
 assert.equal(preparation.safety.commercial_close_forced,false)
 assert.match(preparation.why_now,/soja.*primeira aplicação|estágio atual da soja/i)
 assert.doesNotMatch(allDisplay(preparation),/\b(?:dose|dosagem|ml\s*\/\s*ha|l\s*\/\s*ha|aplique|misture)\b/i)
})

test('quality gate avalia nove dimensões, incluindo uso governado de conhecimento, e bloqueia linguagem genérica/interna',()=>{
 for(const fixture of [costaBeberFixture(),soyFungicideFixture(),newProducerFixture()]){
  const quality=fixture.preparation.quality_audit
  assert.equal(quality.version,prepareVisitQualityVersion)
  assert.equal(Object.keys(quality.dimensions).length,9)
  assert.equal(quality.dimensions.KNOWLEDGE_USAGE,1)
  assert.equal(quality.passed,true)
  assert.equal(quality.forbidden_language_detected.length,0)
 }
 for(const phrase of ['Obtenha o dado crítico.','Valide o contexto.','Confirme a fonte mestre.','Fato confirmado pelo consultor: milho emergiu.'])assert.equal(isForbiddenPrepareVisitLanguage(phrase),true)
})

test('Voice Capture PRE_VISIT classifica intenção, timing e fricção sem promover preço a fato',()=>{
 const result=deterministicVoiceCandidateExtraction({
  transcript:'Vou visitar o Antonio para falar sobre inseticida no milho. O milho já foi plantado e já emergiu. A primeira aplicação está próxima agora. A precificação está um pouco diferente.',
  voiceInteractionId:'00000000-0000-4000-8000-000000000999',transcriptRef:'voice-transcript:quality',interactionType:'PRE_VISIT',now:new Date('2026-08-24T12:00:00.000Z')
 })
 const semantic=new Map(result.candidates.map(item=>[item.metadata.semantic_type,item]))
 assert.equal(semantic.get('VISIT_INTENT').epistemic_status,'FACT_CANDIDATE')
 assert.equal(semantic.get('AGRONOMIC_STAGE').epistemic_status,'FACT_CANDIDATE')
 assert.equal(semantic.get('AGRONOMIC_TIMING').epistemic_status,'FACT_CANDIDATE')
 assert.equal(semantic.get('COMMERCIAL_SIGNAL').epistemic_status,'HYPOTHESIS')
})
