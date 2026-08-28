import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildBehavioralProfile} from '../server/commercial/behavioral-profile.js'
import {buildDecisionThesis} from '../server/commercial/decision-thesis.js'
import {buildValuePlan} from '../server/commercial/value-plan.js'
import {behavioralProfileVersion,decisionThesisVersion,questionnaireDefinitionVersion,valuePlanVersion,validateBehavioralProfile,validateDecisionThesis,validateValuePlan} from '../server/commercial/contracts.js'
import {questionnaireDefinition} from '../server/commercial/questionnaire-definition.js'
import {tenantA,tenantB,phase4Context,baseAdvice,baseConversion} from '../support/phase4-test-context.js'

test('schemas comerciais v1 permanecem alinhados ao runtime',()=>{
 const expected={
  'behavioral-profile.schema.json':behavioralProfileVersion,
  'questionnaire-definition.schema.json':questionnaireDefinitionVersion,
  'decision-thesis.schema.json':decisionThesisVersion,
  'value-plan.schema.json':valuePlanVersion
 }
 for(const [file,version] of Object.entries(expected)){
  const schema=JSON.parse(readFileSync(new URL(`../contracts/v1/${file}`,import.meta.url),'utf8'))
  assert.equal(schema.properties.contract_version.const,version)
 }
 assert.equal(questionnaireDefinition.version,'producer-360.v1')
})

test('contratos válidos rejeitam pesos, confiança e perguntas fora dos limites',()=>{
 const context=phase4Context()
 const profile=buildBehavioralProfile(context,{organizationId:tenantA})
 const thesis=buildDecisionThesis({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,context,advice:baseAdvice,conversion:baseConversion})
 const plan=buildValuePlan({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,decisionThesis:thesis,context,advice:baseAdvice})
 assert.deepEqual(validateBehavioralProfile(profile),[])
 assert.deepEqual(validateDecisionThesis(thesis),[])
 assert.deepEqual(validateValuePlan(plan),[])
 assert.ok(validateBehavioralProfile({...profile,profile_weights:{...profile.profile_weights,analytical:2}}).length)
 assert.ok(validateValuePlan({...plan,questions:[{},{},{},{}]}).includes('questions'))
})

test('MIC bloqueia ContextSnapshot de outro tenant',()=>{
 const context=phase4Context()
 assert.throws(()=>buildBehavioralProfile(context,{organizationId:tenantB}),error=>error.code==='cross_tenant_behavioral_profile_denied')
})

test('MDI bloqueia BehavioralProfile de outro tenant',()=>{
 const context=phase4Context()
 const profile=buildBehavioralProfile(context,{organizationId:tenantA})
 assert.throws(()=>buildDecisionThesis({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:{...profile,organization_id:tenantB},context,advice:baseAdvice,conversion:baseConversion}),error=>error.code==='cross_tenant_behavioral_profile_denied')
})

test('MVV bloqueia DecisionThesis de outro tenant',()=>{
 const context=phase4Context()
 const profile=buildBehavioralProfile(context,{organizationId:tenantA})
 const thesis=buildDecisionThesis({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,context,advice:baseAdvice,conversion:baseConversion})
 assert.throws(()=>buildValuePlan({organizationId:tenantA,contextSnapshot:context.contextSnapshot,behavioralProfile:profile,decisionThesis:{...thesis,organization_id:tenantB},context,advice:baseAdvice}),error=>error.code==='cross_tenant_decision_thesis_denied')
})
