import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildContextSnapshot,contextSnapshotForModel,contextSnapshotVersion} from '../server/memory/context-snapshot.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const actor='00000000-0000-4000-8000-000000000111'
const now=new Date('2026-08-20T12:00:00.000Z')
const scoped=item=>({...item,tenant_id:tenantA,producer_id:'client-1',context_owner_id:actor})
const baseContext=()=>({client:{id:'client-1',name:'Produtor Teste'},profile:{evidence:[scoped({id:'survey-1',source:'producer_360',assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'})],assessedAt:'2026-08-01T12:00:00.000Z',validUntil:'2027-08-01T12:00:00.000Z'},businessHistory:[],visits:[],interactions:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],memories:[],memoryHistory:[]})
const memory=(id,overrides={})=>({id,tenant_id:tenantA,client_id:'client-1',context_owner_id:actor,subject_type:'client',subject_id:'client-1',memory_type:'fact',memory_state:'FACT',memory_domain:'PRODUCER',key:'planted_area_ha',value:500,status:'verified',source:'consultant_input',source_ref:`consultant_input:${id}`,source_type:'consultant_input',confidence:80,valid_from:'2026-01-01T12:00:00.000Z',created_at:'2026-01-01T12:00:00.000Z',updated_at:'2026-01-01T12:00:00.000Z',acl:{scope:'own_portfolio'},...overrides})
const snapshot=(context,input={})=>buildContextSnapshot(context,{organizationId:tenantA,subjectType:'client',subjectId:'client-1',actorId:actor,role:'consultant',scope:'own_portfolio',objective:'general_assistance',requestId:'00000000-0000-4000-8000-000000000301',now,...input})

test('correção prevalece e mantém a versão anterior como superseded auditável',()=>{
  const context=baseContext()
  context.memoryHistory=[memory('memory-old'),memory('memory-new',{value:620,supersedes_id:'memory-old',valid_from:'2026-08-10T12:00:00.000Z',updated_at:'2026-08-10T12:00:00.000Z'})]
  const result=snapshot(context)
  assert.equal(result.facts.length,1)
  assert.equal(result.facts[0].value,620)
  assert.equal(result.facts[0].memory_ref,'memory-new')
  assert.ok(result.selection.selection_reason_codes[0].reason_codes.includes('recorded_confidence'))
  assert.ok(result.stale_information.some(item=>item.memory_ref==='memory-old'&&item.reason==='superseded'))
  assert.ok(result.selection.considered_refs.includes('memory-old'))
  assert.ok(result.selection.excluded_refs.includes('memory-old'))
  assert.deepEqual(result.selection.exclusion_reason_codes.find(item=>item.ref==='memory-old').reason_codes,['SUPERSEDED'])
})

test('memória expirada não vira fato atual e permanece rastreável como stale',()=>{
  const context=baseContext()
  context.memoryHistory=[memory('memory-expired',{valid_until:'2026-01-31T12:00:00.000Z'})]
  const result=snapshot(context)
  assert.equal(result.facts.length,0)
  assert.ok(result.stale_information.some(item=>item.memory_ref==='memory-expired'&&item.freshness==='EXPIRED'))
  assert.deepEqual(result.selection.exclusion_reason_codes.find(item=>item.ref==='memory-expired').reason_codes,['EXPIRED'])
})

test('duas fontes materiais divergentes geram conflito e reduzem confiança',()=>{
  const context=baseContext()
  context.memoryHistory=[memory('memory-a',{value:500,source_type:'consultant_input'}),memory('memory-b',{value:620,source_type:'laboratory',source_ref:'laboratory:analysis-1'})]
  const result=snapshot(context)
  assert.equal(result.conflicts.length,1)
  assert.deepEqual(new Set(result.conflicts[0].memory_refs),new Set(['memory-a','memory-b']))
  assert.equal(result.confidence.level,'HIPÓTESE')
})

test('ausência de histórico permanece lacuna e não fabrica fato',()=>{
  const result=snapshot(baseContext(),{objective:'agronomic_question'})
  assert.equal(result.facts.length,0)
  assert.equal(result.inferences.length,0)
  assert.equal(result.hypotheses.length,0)
  assert.ok(result.missing_information.some(item=>item.code==='historical_context'))
  assert.ok(result.missing_information.some(item=>item.code==='current_soil_analysis'&&item.critical))
  assert.equal(result.confidence.level,'INSUFICIENTE')
})

test('análise de solo antiga é recuperada apenas com stale flag explícita',()=>{
  const context=baseContext()
  context.soilAnalyses=[scoped({id:'soil-old',sampled_at:'2020-02-01',laboratory:'Lab A',measurements:[{analyte:'pH',normalized_value:5.2}]})]
  const result=snapshot(context,{objective:'agronomic_question'})
  assert.equal(result.agronomic_context.soil_analyses[0].freshness,'STALE')
  assert.equal(result.agronomic_context.soil_analyses[0].freshness_metadata.rule_id,'val.context.freshness.agronomic.soil_analysis.v1')
  assert.ok(result.stale_information.some(item=>item.source_ref==='soil_analysis:soil-old'))
  assert.ok(result.missing_information.some(item=>item.code==='current_soil_analysis'))
})

test('análise de solo sem data permanece freshness desconhecida e não fecha lacuna',()=>{
  const context=baseContext()
  context.soilAnalyses=[scoped({id:'soil-undated',laboratory:'Lab sem data'})]
  const result=snapshot(context,{objective:'agronomic_question'})
  assert.equal(result.agronomic_context.soil_analyses[0].freshness,'UNKNOWN')
  assert.ok(result.missing_information.some(item=>item.code==='current_soil_analysis'))
})

test('tenant adversarial é descartado antes de refs, fatos e conflitos',()=>{
  const context=baseContext()
  context.memoryHistory=[memory('memory-own'),memory('memory-foreign',{tenant_id:tenantB,value:999,source_ref:'foreign-secret'})]
  const result=snapshot(context)
  assert.equal(result.selection.unauthorized_count,1)
  assert.deepEqual(result.selection.considered_refs,['memory-own'])
  const selectedPayload={facts:result.facts,inferences:result.inferences,hypotheses:result.hypotheses,validated_knowledge:result.validated_knowledge,evidence_refs:result.evidence_refs}
  assert.equal(JSON.stringify(selectedPayload).includes('memory-foreign'),false)
  assert.equal(JSON.stringify(selectedPayload).includes('foreign-secret'),false)
  const rejected=result.selection.context_trace.rejected.find(item=>item.reasonSelected==='UNAUTHORIZED_SCOPE'&&item.tenantId===tenantB)
  assert.match(rejected?.sourceId||'',/^sha256:/)
})

test('memória de propriedade e organização exige vínculo no contexto autorizado',()=>{
  const context=baseContext()
  context.properties=[scoped({id:'property-1',fields:[{id:'field-1'}]})]
  context.memoryHistory=[
    memory('memory-property',{subject_type:'property',subject_id:'property-1',memory_domain:'AGRONOMIC',key:'soil_texture'}),
    memory('memory-field',{subject_type:'field',subject_id:'field-1',memory_domain:'AGRONOMIC',key:'crop_stage'}),
    memory('memory-organization',{client_id:null,context_owner_id:null,subject_type:'organization',subject_id:tenantA,scope:'GLOBAL',memory_domain:'ORGANIZATIONAL',key:'commercial_policy',acl:{scope:'organization',roles:['consultant']}}),
    memory('memory-organization-unreviewed',{client_id:null,context_owner_id:null,subject_type:'organization',subject_id:tenantA,memory_domain:'ORGANIZATIONAL',key:'legacy_policy',source_ref:'organization:unreviewed'}),
    memory('memory-unrelated-property',{subject_type:'property',subject_id:'property-foreign',source_ref:'property:foreign'})
  ]
  const result=snapshot(context)
  assert.deepEqual(new Set(result.selection.selected_refs),new Set(['memory-property','memory-field']))
  assert.equal(result.selection.unauthorized_count,2)
  assert.ok(result.selection.exclusion_reason_codes.find(item=>item.ref==='memory-organization')?.reason_codes.includes('GLOBAL_CONTEXT_NOT_PRODUCER_SPECIFIC'))
  const selectedPayload={facts:result.facts,inferences:result.inferences,hypotheses:result.hypotheses,validated_knowledge:result.validated_knowledge,evidence_refs:result.evidence_refs}
  assert.equal(JSON.stringify(selectedPayload).includes('property:foreign'),false)
  assert.equal(JSON.stringify(selectedPayload).includes('organization:unreviewed'),false)
  assert.ok(result.selection.context_trace.rejected.some(item=>item.sourceId==='property:foreign'&&item.reasonSelected==='UNAUTHORIZED_SCOPE'))
  assert.ok(result.selection.context_trace.rejected.some(item=>item.sourceId==='organization:unreviewed'&&item.reasonSelected==='MISSING_PRODUCER_SCOPE'))
})

test('dez anos de histórico retornam o conjunto relevante, não o histórico inteiro',()=>{
  const context=baseContext()
  context.memoryHistory=Array.from({length:120},(_,index)=>memory(`memory-${index}`,{key:`historic_note_${index}`,value:`Registro ${index}`,valid_from:`${2016+Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}-01T12:00:00.000Z`,updated_at:`${2016+Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}-01T12:00:00.000Z`}))
  context.memoryHistory[0]=memory('memory-structural',{key:'planted_area_ha',value:620,valid_from:'2016-01-01T12:00:00.000Z',updated_at:'2016-01-01T12:00:00.000Z'})
  context.memoryHistory[119]=memory('memory-soil-relevant',{memory_domain:'AGRONOMIC',key:'soil_history',value:'solo argiloso',valid_from:'2025-12-01T12:00:00.000Z',updated_at:'2025-12-01T12:00:00.000Z'})
  const result=snapshot(context,{objective:'agronomic_question',message:'Considere o histórico de solo e a área estrutural'})
  assert.equal(result.selection.considered_refs.length,120)
  assert.equal(result.selection.selected_refs.length,2)
  assert.ok(result.selection.selected_refs.includes('memory-structural'))
  assert.ok(result.selection.selected_refs.includes('memory-soil-relevant'))
  assert.equal(result.selection.exclusion_reason_codes.filter(item=>item.reason_codes.includes('DOMAIN_MISMATCH')).length,118)
  const compact=contextSnapshotForModel(result,6_000)
  assert.ok(JSON.stringify(compact).length<=6_000)
  assert.equal('selection' in compact,false)
})

test('perfil comportamental é sinal observável, nunca fato absoluto',()=>{
  const context=baseContext()
  context.client.primaryProfile='Analítico'
  context.client.profileEvidence=[scoped({id:'answer-1',source:'producer_360',assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'})]
  context.profile.assessedAt='2026-08-01T12:00:00.000Z'
  context.profile.validUntil='2027-08-01T12:00:00.000Z'
  const result=snapshot(context)
  assert.equal(result.behavioral_signals[0].epistemic_state,'HYPOTHESIS')
  assert.equal(result.facts.some(item=>item.key==='primary_profile'),false)
  assert.ok(result.behavioral_signals[0].evidence_refs.some(item=>item.id==='answer-1'))
})

test('freshness é avaliada por domínio e fonte, sem TTL universal',()=>{
  const context=baseContext()
  context.businessHistory=[scoped({id:'business-old',occurred_at:'2010-01-01T12:00:00.000Z'})]
  context.soilAnalyses=[scoped({id:'soil-old',sampled_at:'2020-01-01T12:00:00.000Z'})]
  const result=snapshot(context,{objective:'agronomic_question'})
  assert.deepEqual(result.commercial_context.business_history,[])
  assert.equal(result.agronomic_context.soil_analyses[0].freshness,'STALE')
  assert.ok(result.freshness.rule_ids.includes('val.context.freshness.agronomic.soil_analysis.v1'))
})

test('ContextSnapshot publicado mantém todas as seções obrigatórias',()=>{
  const schema=JSON.parse(readFileSync(new URL('../contracts/v1/context-snapshot.schema.json',import.meta.url),'utf8'))
  assert.equal(schema.properties.contract_version.const,contextSnapshotVersion)
  for(const field of ['request_id','facts','inferences','hypotheses','missing_information','conflicts','stale_information','behavioral_signals','commercial_context','agronomic_context','relationship_context','evidence_refs','confidence','freshness','selection'])assert.ok(schema.required.includes(field),field)
  for(const field of ['selected_refs','excluded_refs','exclusion_reason_codes'])assert.ok(schema.properties.selection.required.includes(field),field)
  assert.equal(schema.additionalProperties,false)
})
