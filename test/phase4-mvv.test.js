import test from 'node:test'
import assert from 'node:assert/strict'
import {buildBehavioralProfile} from '../server/commercial/behavioral-profile.js'
import {buildDecisionThesis} from '../server/commercial/decision-thesis.js'
import {buildValuePlan} from '../server/commercial/value-plan.js'
import {evaluateCommercialApproach,raulScenarioFixtures} from '../server/commercial/scenario-fixtures.js'
import {tenantA,phase4Context,baseAdvice,baseConversion} from '../support/phase4-test-context.js'

function plan(message,context=phase4Context(),extra={}){
 const profile=buildBehavioralProfile(context,{organizationId:tenantA,currentMessage:message})
 const thesis=buildDecisionThesis({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,context,advice:baseAdvice,conversion:baseConversion})
 return buildValuePlan({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,decisionThesis:thesis,context,advice:baseAdvice,currentMessage:message,...extra})
}

test('MVV 13 — está caro não gera desconto automático',()=>{
 const result=plan('O produtor disse: está caro, quero desconto.')
 assert.equal(result.guardrails.automatic_discount,false)
 assert.equal(result.objection_guidance[0].automatic_discount,false)
 assert.deepEqual(result.objection_guidance[0].sequence.slice(0,3),['VALIDATE_OBJECTION','RETURN_TO_CONFIRMED_PROBLEM','QUANTIFY_IMPACT'])
})

test('MVV 14 — analítico prioriza números e comparativos',()=>assert.match(plan('Pediu ROI, números e comparativos.').approach.proof_preference,/ROI|comparativos/i))
const neutral=()=>phase4Context({client:{id:'producer-a',name:'Produtor A',scores:{}},profile:{answers:{},evidence:[]}})
test('MVV 15 — relacional prioriza confiança e histórico',()=>assert.match(plan('Valoriza confiança, compromisso e histórico de entrega.',neutral()).approach.proof_preference,/histórico|acordos/i))
test('MVV 16 — inovador prioriza diferenciação e teste',()=>assert.match(plan('Busca inovação, diferenciação e teste de tecnologia nova.',neutral()).approach.proof_preference,/teste|diferenciação/i))
test('MVV 17 — conservador prioriza segurança e continuidade',()=>assert.match(plan('Prioriza segurança, tradição e continuidade.',neutral()).approach.proof_preference,/segurança|continuidade/i))

test('MVV 18 — sem dor validada investiga antes de propor',()=>{
 const context=phase4Context({memoryHistory:[],businessHistory:[],interactions:[],opportunities:[]})
 const result=plan('Prepare a visita.',context)
 assert.ok(result.questions.length>0)
 assert.match(result.commitment_target,/dado|coleta|histórico/i)
})

test('MVV 19 — toda conversa relevante termina com próximo passo',()=>{
 const result=plan('Prepare uma estratégia de conversa.')
 assert.ok(result.follow_up)
 assert.ok(result.commitment_target)
 assert.ok(result.questions.length<=3)
})

test('MVV 20 — Raul fraca detecta padrões negativos',()=>{
 const result=evaluateCommercialApproach(raulScenarioFixtures.weak)
 assert.ok(result.negative_patterns.includes('GENERIC_APPROACH'))
 assert.ok(result.negative_patterns.includes('PREMATURE_DISCOUNT'))
 assert.ok(result.negative_patterns.includes('NO_COMMITMENT'))
})

test('MVV 21 — Raul boa detecta padrões positivos',()=>{
 const result=evaluateCommercialApproach(raulScenarioFixtures.value)
 assert.ok(result.positive_patterns.includes('PREPARATION'))
 assert.ok(result.positive_patterns.includes('ECONOMIC_DIMENSIONING'))
 assert.ok(result.positive_patterns.includes('EXPLICIT_NEXT_STEP'))
})

test('MVV 22 — analogia Ferrari é opcional e nunca evidência',()=>{
 assert.equal(plan('Compare as opções.').analogy_optional,null)
 const result=plan('Explique depois do diagnóstico.',phase4Context(),{analogy:'Solo preparado é pista; solução de maior qualidade é Ferrari.',analogyImprovesUnderstanding:true})
 assert.equal(result.analogy_optional.evidence,false)
 assert.equal(result.proof_strategy.some(item=>/Ferrari/i.test(item)),false)
})
