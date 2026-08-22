import test from 'node:test'
import assert from 'node:assert/strict'
import {buildBehavioralProfile} from '../server/commercial/behavioral-profile.js'
import {questionnaireDefinition} from '../server/commercial/questionnaire-definition.js'
import {tenantA,phase4Context} from '../support/phase4-test-context.js'

test('MIC 1 — Analítico pede ROI e aumenta o peso analítico',()=>{
 const context=phase4Context()
 const result=buildBehavioralProfile(context,{organizationId:tenantA,currentMessage:'O produtor pediu ROI, custo/ha e comparativos.'})
 assert.ok(result.profile_weights.analytical>result.profile_weights.relational)
})

test('MIC 2 — Relacional valoriza compromisso e recebe orientação relacional',()=>{
 const context=phase4Context({client:{id:'producer-a',name:'Produtor A',scores:{}},profile:{answers:{},evidence:[]}})
 const result=buildBehavioralProfile(context,{organizationId:tenantA,currentMessage:'Valoriza compromisso, confiança, presença e histórico de entrega.'})
 assert.match(result.approach_guidance.proof_preference,/compromissos|histórico/i)
})

test('MIC 3 — sinais mistos formam perfil híbrido',()=>{
 const context=phase4Context({client:{id:'producer-a',name:'Produtor A',scores:{}},profile:{answers:{},evidence:[]}})
 const result=buildBehavioralProfile(context,{organizationId:tenantA,currentMessage:'Quer ROI e comparativos, mas valoriza confiança e compromisso.'})
 assert.ok(result.profile_weights.analytical>0.2)
 assert.ok(result.profile_weights.relational>0.2)
})

test('MIC 4 — sem sinais permanece desconhecido com baixa confiança',()=>{
 const context=phase4Context({client:{id:'producer-a',name:'Produtor A',scores:{}},profile:{answers:{},evidence:[]}})
 context.contextSnapshot.behavioral_signals=[]
 const result=buildBehavioralProfile(context,{organizationId:tenantA})
 assert.deepEqual(result.profile_weights,{analytical:0.25,relational:0.25,innovative:0.25,conservative:0.25})
 assert.ok(result.confidence<=0.2)
})

test('MIC 5 — perfil não altera fato técnico',()=>{
 const context=phase4Context()
 const analytical=buildBehavioralProfile(context,{organizationId:tenantA,currentMessage:'ROI e dados.'})
 const conservative=buildBehavioralProfile(context,{organizationId:tenantA,currentMessage:'Segurança, tradição e continuidade.'})
 assert.deepEqual(context.contextSnapshot.facts,context.contextSnapshot.facts)
 assert.notDeepEqual(analytical.profile_weights,conservative.profile_weights)
})

test('MIC 6 — evidência do perfil é rastreável',()=>{
 const context=phase4Context()
 const result=buildBehavioralProfile(context,{organizationId:tenantA})
 assert.ok(result.signals.every(signal=>signal.evidence_ref))
 assert.ok(result.evidence_refs.length>0)
})

test('MIC 7 — contrato 26/27 é resolvido e versionado',()=>{
 assert.equal(questionnaireDefinition.core_question_count,27)
 assert.equal(questionnaireDefinition.required_question_count,26)
 assert.equal(questionnaireDefinition.questions.find(item=>item.question_id===27).required,false)
 assert.equal(questionnaireDefinition.questions.filter(item=>item.question_id>=28).length,18)
})
