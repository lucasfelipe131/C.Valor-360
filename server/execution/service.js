import {buildCommercialComposition} from '../commercial/composition.js'
import {buildConversionIntelligence} from '../conversion-engine.js'
import {observe} from '../observability.js'
import {buildActionPlan} from './action-plan.js'
import {classifyVisitType,buildPrepareVisit} from './prepare-visit.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const technicalIntent=value=>/assist[eê]ncia|t[eé]cnic|talh[aã]o|solo|ndvi|dose|mistura|diagn[oó]stico|prescri/i.test(text(value))

function nonCommercialCandidates({type,visit,context,snapshot}){
 const refs=[{id:snapshot.context_snapshot_id,type:'context_snapshot'},{id:`visit:${visit.id}`,type:'visit'}]
 const dueAt=visit.scheduledAt??visit.scheduled_at
 const overdue=list(context.commitments).find(item=>{
  const due=new Date(item?.due_at??item?.dueAt??'')
  return !Number.isNaN(due.getTime())&&due<Date.now()&&!['DONE','CANCELLED'].includes(text(item?.status).toUpperCase())
 })
 if(type==='TECHNICAL')return [
  {title:'Confirmar contexto técnico',description:'Reunir cultura, área ou talhão, fonte, data e dúvida observável antes de qualquer orientação.',reason:'O objetivo técnico exige contexto verificável e revisão humana quando aplicável.',due_at:dueAt,success_criteria:'Contexto técnico mínimo e fontes registrados para revisão.',evidence_required:['Fonte, data e identificação da área'],confidence:.8,impact:.9,risk:1,dependency:1,source_refs:refs},
  {title:'Combinar próximo passo técnico',description:'Definir coleta, validação ou acompanhamento compatível com o objetivo da visita.',reason:'A visita deve terminar com avanço útil sem transformar hipótese em prescrição.',due_at:dueAt,success_criteria:'Responsável, prazo e resultado observável combinados.',evidence_required:['Registro do acordo e evidência esperada'],confidence:.75,impact:.75,source_refs:refs}
 ]
 if(type==='PENDING_ITEM')return [{title:'Resolver a pendência registrada',description:text(visit.objective),reason:'A pendência é o objetivo principal e não deve ser desviada por oportunidade secundária.',due_at:dueAt,success_criteria:'Pendência resolvida ou replanejada com responsável, prazo e motivo.',evidence_required:['Status confirmado da pendência'],confidence:.85,impact:.8,urgency:.9,source_refs:refs}]
 return [
  ...(overdue?[{title:'Revisar compromisso vencido',description:text(overdue.description),reason:'Um compromisso vencido deve entrar no contexto da próxima visita.',due_at:dueAt,success_criteria:'Compromisso confirmado, replanejado com motivo ou encerrado com evidência.',evidence_required:['Status e evidência do compromisso'],confidence:.9,impact:.8,urgency:1,existing_commitment:1,source_refs:[...refs,{id:`commitment:${overdue.commitment_id??overdue.id}`,type:'commitment'}]}]:[]),
  {title:'Fortalecer o relacionamento',description:text(visit.objective||'Confirmar contexto, expectativa e próximo passo do relacionamento.'),reason:'O objetivo relacional deve ser conduzido sem forçar proposta comercial.',due_at:dueAt,success_criteria:'Próximo passo relacional confirmado com responsável e prazo.',evidence_required:['Registro do acordo'],confidence:.7,impact:.65,relationship_signal:.9,source_refs:refs}
 ]
}

export async function prepareVisitExecution({repository,tenantId,actor,visitId,requestId,now}={}){
 const started=Date.now()
 const ownerId=Object.prototype.hasOwnProperty.call(actor||{},'ownerId')?actor.ownerId:actor.id
 const visit=await repository.getVisit({tenantId,ownerId,id:visitId})
 if(!visit)throw Object.assign(new Error('Visita não encontrada na carteira autorizada.'),{statusCode:404,code:'visit_not_found'})
 const context=await repository.getClientContext({tenantId,clientId:visit.clientId,ownerId,contextRequest:{objective:'prepare_visit',contextDomain:'VISIT',requestId,actorRole:actor.role,scope:'own_portfolio',message:visit.objective,now}})
 const snapshot=context.contextSnapshot
 const conversion=buildConversionIntelligence(context,`Preparar visita: ${visit.objective}`,{now})
 const commercial=buildCommercialComposition({context,contextSnapshot:snapshot,organizationId:tenantId,message:`Preparar visita: ${visit.objective}`,conversion,now})
 const type=classifyVisitType(visit.objective)
 const candidateActions=type==='COMMERCIAL'?undefined:nonCommercialCandidates({type,visit,context,snapshot})
 const actionPlan=buildActionPlan({organizationId:tenantId,subjectId:snapshot.subject.id,contextSnapshot:snapshot,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actor:{type:'USER',id:actor.id},defaultDueAt:visit.scheduledAt,candidateActions,now})
 const preparation=buildPrepareVisit({organizationId:tenantId,contextSnapshot:snapshot,context,visit,behavioralProfile:commercial.behavioral_profile,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actionPlan,actor:{type:'USER',id:actor.id},technicalReviewRequired:technicalIntent(visit.objective),knowledgeRetrieval:commercial.knowledge_retrieval,now})
 const stored=await repository.saveActionPlan({tenantId,ownerId,clientId:visit.clientId,visitId:visit.id,plan:actionPlan,preparation,contextSnapshot:snapshot,decisionThesisVersion:commercial.decision_thesis.version,valuePlanVersion:commercial.value_plan.version})
 observe('visit.preparation.completed',{contextSnapshotId:snapshot.context_snapshot_id,behaviorProfileVersion:commercial.behavioral_profile.version,decisionThesisId:preparation.decision_thesis_id,decisionThesisVersion:preparation.decision_thesis_version,valuePlanId:preparation.value_plan_id,valuePlanVersion:preparation.value_plan_version,actionPlanId:actionPlan.action_plan_id,actionPlanVersion:actionPlan.version,modulesCalled:'MCTX,MIC,MDI,MVV,MEX,VIS',durationMs:Math.max(0,Date.now()-started),outcome:'ok'})
 return {visit,context_snapshot_ref:{id:snapshot.context_snapshot_id,version:snapshot.contract_version},behavioral_profile:commercial.behavioral_profile,decision_thesis:commercial.decision_thesis,value_plan:commercial.value_plan,knowledge_retrieval:commercial.knowledge_retrieval,action_plan:stored,preparation}
}
