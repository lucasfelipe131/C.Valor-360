import test from 'node:test'
import assert from 'node:assert/strict'
import {buildActionPlan} from '../server/execution/action-plan.js'
import {buildCommitmentCandidate,transitionCommitment} from '../server/execution/commitment.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {tenantA,tenantB,actorA,phase4Context} from '../support/phase4-test-context.js'

const now=new Date('2026-08-22T12:00:00.000Z')
const artifacts=()=>{
 const context=phase4Context()
 return {organizationId:tenantA,subjectId:'producer-a',contextSnapshot:context.contextSnapshot,decisionThesis:{version:'val.decision_thesis.v1',organization_id:tenantA,recommended_action:'Avançar com teste.',confidence:.8},valuePlan:{version:'val.value_plan.v1',organization_id:tenantA,commitment_target:'Combinar teste.',follow_up:'Retomar no prazo.'},actor:{type:'USER',id:actorA},now}
}
const commitmentInput=overrides=>({organization_id:tenantA,client_id:'producer-a',description:'Executar área lado a lado.',owner_type:'USER',owner_id:actorA,due_at:'2026-08-30T12:00:00.000Z',status:'ACCEPTED',success_criteria:'Resultado e comparação registrados.',agreed_with_client:true,evidence_refs:[],source_ref:'action-plan:one',request_id:'request-a',created_by:actorA,now,...overrides})

test('MEX 1 — 10 ações são reduzidas para no máximo 3',()=>{
 const candidates=Array.from({length:10},(_,index)=>({title:`Ação ${index+1}`,description:`Executar passo ${index+1}`,reason:'Evidência registrada.',owner:{type:'USER',id:actorA},due_at:`2026-08-${String(23+index).padStart(2,'0')}T12:00:00.000Z`,success_criteria:'Resultado observado.',confidence:.8,impact:(index+1)/10,risk:.2,source_refs:[{id:`source-${index}`}]}))
 const plan=buildActionPlan({...artifacts(),candidateActions:candidates})
 assert.equal(plan.priorities.length,3)
 assert.ok(plan.priorities.every(item=>item.action_id&&item.reason&&item.source_refs.length))
})

test('MEX 2 — ação sem owner não vira Commitment válido',()=>{
 const result=buildCommitmentCandidate(commitmentInput({owner_id:null}))
 assert.equal(result.is_commitment,false)
 assert.ok(result.missing_fields.includes('owner_id'))
})

test('MEX 3 — ação sem prazo permanece proposta',()=>{
 const result=buildCommitmentCandidate(commitmentInput({due_at:null}))
 assert.equal(result.classification,'PROPOSAL')
 assert.equal(result.proposal.status,'PROPOSED')
})

test('MEX 4 — Commitment concluído registra evidência',()=>{
 const current=buildCommitmentCandidate(commitmentInput({})).commitment
 const done=transitionCommitment(current,{status:'DONE',evidence_refs:[{id:'field-result:one',type:'result'}],updated_by:actorA,request_id:'request-b',now})
 assert.equal(done.status,'DONE')
 assert.equal(done.evidence_refs.length,1)
 assert.ok(done.completed_at)
})

test('MEX 5 — Commitment vencido retorna ao ContextSnapshot',()=>{
 const commitment=buildCommitmentCandidate(commitmentInput({
  due_at:'2026-08-20T12:00:00.000Z',
  evidence_refs:[{id:'action-plan:one',type:'action_plan'}]
 })).commitment
 const context=phase4Context({commitments:[{
  ...commitment,
  tenant_id:tenantA,
  producer_id:'producer-a',
  context_owner_id:actorA
 }]})
 const snapshot=buildContextSnapshot(context,{organizationId:tenantA,subjectType:'client',subjectId:'producer-a',actorId:actorA,role:'consultant',scope:'own_portfolio',objective:'prepare_visit',requestId:'00000000-0000-4000-8000-000000000455',now})
 assert.equal(snapshot.relationship_context.overdue_commitments.length,1)
 const overdue=snapshot.relationship_context.overdue_commitments[0]
 assert.match(overdue.commitment_ref,/commitment:/)
 assert.equal(overdue.tenantId,tenantA)
 assert.equal(overdue.producerId,'producer-a')
 assert.equal(overdue.ownerId,actorA)
})

test('MEX 6 — ActionPlan cross-tenant é bloqueado',()=>{
 const input=artifacts();input.contextSnapshot={...input.contextSnapshot,organization_id:tenantB}
 assert.throws(()=>buildActionPlan(input),error=>error.code==='cross_tenant_action_plan_denied')
})

test('MEX 7 — ActionPlan mantém vínculo com DecisionThesis',()=>{
 const plan=buildActionPlan({...artifacts(),decisionThesisId:'decision-thesis:approved',valuePlanId:'value-plan:approved'})
 assert.equal(plan.decision_thesis_id,'decision-thesis:approved')
 assert.equal(plan.value_plan_id,'value-plan:approved')
 assert.equal(plan.context_snapshot_id,artifacts().contextSnapshot.context_snapshot_id)
})
