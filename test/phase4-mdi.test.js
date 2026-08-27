import test from 'node:test'
import assert from 'node:assert/strict'
import {buildBehavioralProfile} from '../server/commercial/behavioral-profile.js'
import {buildDecisionThesis} from '../server/commercial/decision-thesis.js'
import {tenantA,phase4Context,baseAdvice,baseConversion} from '../support/phase4-test-context.js'

const build=(context,overrides={})=>{
 const profile=buildBehavioralProfile(context,{organizationId:tenantA})
 return buildDecisionThesis({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,context,advice:baseAdvice,conversion:baseConversion,...overrides})
}

test('MDI 8 — base suficiente produz tese posicionada',()=>{
 const thesis=build(phase4Context())
 assert.equal(thesis.decision,'RECOMMEND')
 assert.match(thesis.recommended_action,/comparativo|teste/i)
})

test('MDI 9 — dado crítico ausente exige descoberta antes de recomendar',()=>{
 const context=phase4Context()
 context.contextSnapshot.missing_information.push({code:'critical_value',description:'Falta custo por hectare.',critical:true})
 const thesis=build(context)
 assert.equal(thesis.decision,'DISCOVER_BEFORE_RECOMMENDING')
 assert.match(thesis.recommended_action,/Antes de recomendar/i)
})

test('MDI 10 — duas soluções expõem alternativas e trade-offs',()=>{
 const thesis=build(phase4Context())
 assert.ok(thesis.alternatives.some(item=>item.id==='opp-b'))
 assert.ok(thesis.tradeoffs.some(item=>item.dimension==='PRODUCER_VALUE'))
 assert.ok(thesis.tradeoffs.some(item=>item.dimension==='SUSTAINABLE_MARGIN'))
})

test('MDI 11 — restrição técnica bloqueia solução acionável',()=>{
 const thesis=build(phase4Context(),{advice:{...baseAdvice,human_review:{required:true},blocked_actions:['dose']}})
 assert.equal(thesis.decision,'DISCOVER_BEFORE_RECOMMENDING')
 assert.match(thesis.risks.join(' '),/técnic/i)
})

test('MDI 12 — confidence acompanha evidência',()=>{
 const rich=build(phase4Context())
 const sparseContext=phase4Context({memoryHistory:[],businessHistory:[],interactions:[],opportunities:[]})
 const sparse=build(sparseContext)
 assert.ok(rich.confidence>sparse.confidence)
})
