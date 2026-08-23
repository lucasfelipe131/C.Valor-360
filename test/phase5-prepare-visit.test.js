import test from 'node:test'
import assert from 'node:assert/strict'
import {buildCommercialComposition} from '../server/commercial/composition.js'
import {buildActionPlan} from '../server/execution/action-plan.js'
import {buildPrepareVisit,classifyVisitType} from '../server/execution/prepare-visit.js'
import {tenantA,tenantB,actorA,phase4Context,baseAdvice,baseConversion} from '../support/phase4-test-context.js'

const now=new Date('2026-08-22T12:00:00.000Z')
const neutralContext=()=>phase4Context({client:{id:'producer-a',name:'Produtor A',scores:{},commercial:{}},profile:{answers:{},evidence:[]}})

function prepared(message='Prepare a visita.',options={}){
 const context=options.context||phase4Context()
 const commercial=buildCommercialComposition({context,contextSnapshot:context.contextSnapshot,organizationId:tenantA,message,advice:baseAdvice,conversion:baseConversion,now})
 if(options.valuePlan)Object.assign(commercial.value_plan,options.valuePlan)
 const visit={id:options.visitId||'00000000-0000-4000-8000-000000000551',clientId:'producer-a',scheduledAt:'2026-08-25T12:00:00.000Z',objective:options.objective||'Negociar solução para a próxima safra.',status:'Agendada'}
 const actionPlan=buildActionPlan({organizationId:tenantA,subjectId:'producer-a',contextSnapshot:context.contextSnapshot,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actor:{type:'USER',id:actorA},defaultDueAt:visit.scheduledAt,candidateActions:options.candidateActions,now})
 const result=buildPrepareVisit({organizationId:tenantA,contextSnapshot:context.contextSnapshot,context,visit,behavioralProfile:commercial.behavioral_profile,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actionPlan,actor:{type:'USER',id:actorA},technicalReviewRequired:options.technicalReviewRequired,now})
 return {result,context,commercial,actionPlan}
}

test('Preparar Visita 16 — Analítico recebe números e provas',()=>{
 const {result}=prepared('O produtor pediu ROI, custo/ha e comparativos.')
 assert.match(`${result.profile_approach.proof_preference} ${result.proofs_to_take.join(' ')}`,/ROI|comparativos|custo\/ha/i)
})

test('Preparar Visita 17 — Relacional recebe histórico e confiança',()=>{
 const {result}=prepared('Valoriza compromisso, confiança e histórico de entrega.',{context:neutralContext()})
 assert.match(`${result.profile_approach.guidance} ${result.profile_approach.proof_preference}`,/histórico|confiança|compromissos/i)
})

test('Preparar Visita 18 — Inovador recebe teste e diferenciação',()=>{
 const {result}=prepared('Busca inovação, diferenciação e teste controlado.',{context:neutralContext()})
 assert.match(`${result.profile_approach.guidance} ${result.profile_approach.proof_preference}`,/teste|diferenciação|novidade/i)
})

test('Preparar Visita 19 — Conservador recebe segurança',()=>{
 const {result}=prepared('Prioriza segurança, tradição e continuidade.',{context:neutralContext()})
 assert.match(`${result.profile_approach.guidance} ${result.profile_approach.proof_preference}`,/segurança|continuidade|histórico/i)
})

test('Preparar Visita 20 — sem perfil não inventa preferência',()=>{
 const context=neutralContext();context.contextSnapshot.behavioral_signals=[]
 const {result}=prepared('Preparar visita.',{context})
 assert.equal(result.profile_approach.known,false)
 assert.match(result.profile_approach.label,/não confirmada/i)
})

test('Preparar Visita 21 — sem análise atual explicita pergunta e lacuna',()=>{
 const {result}=prepared('Revisar assistência técnica da área.',{objective:'Assistência técnica e acompanhamento de solo.',technicalReviewRequired:true})
 assert.equal(result.visit_type,'TECHNICAL')
 assert.ok(result.golden_questions.some(item=>/análise de solo/i.test(item)))
 assert.ok(result.missing_information.some(item=>/análise de solo/i.test(item)))
})

test('Preparar Visita 22 — objeção de preço trabalha valor antes de desconto',()=>{
 const {result}=prepared('O produtor disse que está caro e pediu desconto.')
 assert.equal(result.automatic_discount,false)
 assert.match(result.objection_guidance,/problema|impacto|evidência|valor/i)
})

test('Preparar Visita 23 — saída contém no máximo 3 perguntas',()=>{
 const context=phase4Context();context.contextSnapshot.missing_information.push(...Array.from({length:8},(_,index)=>({code:`gap-${index}`,description:`Pergunta material ${index}?`,critical:false})))
 assert.ok(prepared('Prepare.',{context}).result.golden_questions.length<=3)
})

test('Preparar Visita 24 — saída contém no máximo 3 ações',()=>{
 const candidateActions=Array.from({length:9},(_,index)=>({title:`Ação ${index}`,description:`Descrição ${index}`,reason:'Sinal registrado.',owner:{type:'USER',id:actorA},due_at:'2026-08-25T12:00:00.000Z',success_criteria:'Resultado registrado.',confidence:.8,impact:index/9,source_refs:[{id:`source-${index}`}]}))
 assert.ok(prepared('Prepare.',{candidateActions}).result.priority_actions.length<=3)
})

test('Preparar Visita 25 — compromisso-alvo existe quando aplicável',()=>{
 assert.ok(prepared('Negociar com evidência.').result.commitment_target)
})

test('Preparar Visita 26 — visita técnica não força venda',()=>{
 const {result}=prepared('Acompanhar talhão.',{objective:'Assistência técnica e acompanhamento de área.',technicalReviewRequired:true})
 assert.equal(result.visit_type,'TECHNICAL')
 assert.equal(classifyVisitType('Quantificar a perda e combinar área teste.'),'COMMERCIAL')
 assert.equal(result.safety.commercial_close_forced,false)
 assert.match(result.main_opportunity.title,/não exige oportunidade comercial/i)
})

test('Preparar Visita 27 — oportunidade secundária não desvia foco',()=>{
 const {result}=prepared('Negociar sementes.',{valuePlan:{cross_sell_candidates:[{id:'weed-a',description:'Possível oportunidade em plantas daninhas.'}]}})
 assert.equal(result.main_opportunity.id,'opp-a')
 assert.match(result.secondary_opportunities[0].guidance,/Não desvie/i)
})

test('Preparar Visita 28 — dados de outro tenant nunca aparecem',()=>{
 const {context,commercial,actionPlan}=prepared()
 const visit={id:'00000000-0000-4000-8000-000000000552',objective:'Negociar solução.'}
 assert.throws(()=>buildPrepareVisit({organizationId:tenantA,contextSnapshot:{...context.contextSnapshot,organization_id:tenantB},context,visit,behavioralProfile:commercial.behavioral_profile,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actionPlan,actor:{type:'USER',id:actorA},now}),error=>error.code==='cross_tenant_prepare_visit_denied')
})
