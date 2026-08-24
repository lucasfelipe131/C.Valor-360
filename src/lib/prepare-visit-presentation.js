import {normalizeConsultantExperiencePreference} from './consultant-experience-preference.js'

const clean=value=>{
 if(value&&typeof value==='object')return String(value.description||value.statement||value.title||value.guidance||value.summary||value.label||'').trim()
 return String(value||'').trim()
}
const compact=(items,limit=3)=>[...new Set((Array.isArray(items)?items:[]).map(clean).filter(Boolean))].slice(0,limit)
const first=(...values)=>values.map(clean).find(Boolean)||''

const commercialNumbers=client=>{
 const current=Number(client?.commercial?.currentPurchases)
 const potential=Number(client?.commercial?.potential)
 const opportunity=Number(client?.commercial?.openPotential)
 const values=[]
 if(Number.isFinite(current))values.push({label:'Compras atuais',value:current})
 if(Number.isFinite(potential))values.push({label:'Potencial',value:potential})
 if(Number.isFinite(opportunity))values.push({label:'Potencial em aberto',value:opportunity})
 return values
}

export function buildPrepareVisitPresentation({prepared={},client={},visit={},preference='SIMPLE'}={}){
 const preparation=prepared.preparation||{}
 const actionPlan=prepared.action_plan||{}
 const decisionThesis=prepared.decision_thesis||{}
 const valuePlan=prepared.value_plan||{}
 const contextSnapshot=prepared.context_snapshot||{}
 const mode=normalizeConsultantExperiencePreference(preference)
 const missing=compact(preparation.missing_information,4)
 const littleHistory=missing.length>0&&!clean(preparation.probable_objection)&&!clean(preparation.main_opportunity)
 const objective=first(preparation.objective,visit.objective,'Entender a prioridade desta visita e combinar um próximo passo claro.')
 const attention=compact([
  littleHistory?'Tenho pouco histórico deste produtor.':'',
  preparation.probable_objection,
  preparation.why_now
 ],2)
 const questions=compact(preparation.golden_questions,3)
 const strategy=first(preparation.profile_approach?.guidance,preparation.val_thesis,'Conduza a conversa com perguntas curtas e confirme o próximo passo.')
 const commitment=first(preparation.commitment_target,actionPlan.commitment_target,'Sair com um próximo passo claro e acordado.')
 const priorities=(Array.isArray(actionPlan.priorities)?actionPlan.priorities:[]).slice(0,3)
 return {
  version:'val.prepare_visit_simple.v1',
  mode,
  producer:clean(client.name)||'Produtor',
  essential:{objective,attention,questions,strategy,commitment},
  quick:{
   situation:first(preparation.why_now,attention[0],objective),
   opportunity:first(preparation.main_opportunity,objective),
   risk:first(preparation.probable_objection,missing[0],'Nenhum risco crítico confirmado.'),
   avoid:first(preparation.objection_guidance,'Evite avançar sem confirmar o que pesa na decisão.'),
   questions,
   commitment
  },
  analysis:{
   opportunity:clean(preparation.main_opportunity),
   objection:clean(preparation.probable_objection),
   objectionGuidance:clean(preparation.objection_guidance),
   proofs:compact(preparation.proofs_to_take,4),
   missing,
   secondary:compact(preparation.secondary_opportunities,4),
   priorities
  },
  analytical:{
   numbers:commercialNumbers(client),
   thesis:first(decisionThesis.thesis,preparation.val_thesis),
   rationale:compact(decisionThesis.rationale||decisionThesis.evidence,6),
   risks:compact(decisionThesis.risks,5),
   economicCase:clean(valuePlan.economic_case?.summary||valuePlan.economic_case),
   valueProofs:compact(valuePlan.proofs||valuePlan.proofs_recommended,6),
   agronomy:compact(contextSnapshot.agronomic_context||client?.technical?.alerts||client?.agronomicAlerts,6)
  },
  engineRefs:{
   contextSnapshot:prepared.context_snapshot_ref||contextSnapshot.context_snapshot_id||'',
   decisionThesis:decisionThesis.decision_thesis_id||'',
   valuePlan:valuePlan.value_plan_id||'',
   actionPlan:actionPlan.action_plan_id||''
  }
 }
}
