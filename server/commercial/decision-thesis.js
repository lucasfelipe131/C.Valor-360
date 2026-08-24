import {assertContract,decisionThesisVersion,validateDecisionThesis} from './contracts.js'
import {buildPrepareVisitDecisionModel} from '../execution/prepare-visit-quality.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const unique=items=>[...new Set(items.map(item=>typeof item==='string'||typeof item==='number'?text(item):'').filter(Boolean))]
const evidenceId=item=>text(item?.id??item?.source_id??item?.evidence_ref??item,240)

function ensureTenant(snapshot,organizationId,profile){
 if(!snapshot||text(snapshot.organization_id)!==text(organizationId))throw Object.assign(new Error('ContextSnapshot não autorizado para a tese.'),{code:'cross_tenant_decision_thesis_denied'})
 if(profile&&text(profile.organization_id)!==text(organizationId))throw Object.assign(new Error('BehavioralProfile não autorizado para a tese.'),{code:'cross_tenant_behavioral_profile_denied'})
}

function snapshotEvidence(snapshot){
 return unique([
  ...list(snapshot.evidence_refs).map(evidenceId),
  ...list(snapshot.facts).map(item=>item?.memory_ref||item?.source_ref),
  ...list(snapshot.validated_knowledge).map(item=>item?.memory_ref||item?.source_ref)
 ])
}

function baseConfidence(snapshot,evidenceCount){
 const level=text(snapshot?.confidence?.level).toUpperCase()
 let score={VERIFICADO:0.9,'PROVÁVEL':0.72,PROVAVEL:0.72,'HIPÓTESE':0.48,HIPOTESE:0.48,INSUFICIENTE:0.2}[level]??0.2
 score+=Math.min(0.08,evidenceCount*0.01)
 if(list(snapshot?.conflicts).length)score=Math.min(score,0.35)
 if(list(snapshot?.missing_information).some(item=>item?.critical))score=Math.min(score,0.25)
 return Number(Math.max(0.05,Math.min(0.98,score)).toFixed(2))
}

function technicalBlocked(advice,conversion){
 return advice?.human_review?.required===true||list(advice?.blocked_actions).length>0||conversion?.guardrails?.humanReviewForTechnical===true
}

function alternatives(conversion,advice){
 const ranked=list(conversion?.rankedOpportunities).slice(1,4).map(item=>({id:text(item.id),description:text(item.title),tradeoff:`Etapa ${text(item.stage)||'não informada'}; valor e prontidão devem ser comparados nas mesmas premissas.`}))
 const fromAdvice=list(advice?.value_bridge?.alternatives).map(item=>({id:text(item?.id||item?.key),description:text(item?.name||item?.title||item),tradeoff:'Alternativa comercial; equivalência técnica não presumida.'}))
 return [...ranked,...fromAdvice].slice(0,4)
}

export function buildDecisionThesis(input={}){
 const snapshot=input.contextSnapshot||input.context?.contextSnapshot
 const organizationId=text(input.organizationId||snapshot?.organization_id)
 const profile=input.behavioralProfile
 ensureTenant(snapshot,organizationId,profile)
 const advice=input.advice||{}
 const conversion=input.conversion||input.context?.conversionIntelligence||{}
 const prepareQuality=/prepare_visit|preparar\s+visita/i.test(`${snapshot?.objective||''} ${input.message||''}`)
 const decisionModel=buildPrepareVisitDecisionModel({contextSnapshot:snapshot,context:input.context,visitObjective:input.message||'',behavioralProfile:profile})
 const evidence=snapshotEvidence(snapshot)
 const criticalMissing=list(snapshot.missing_information).filter(item=>item?.critical)
 const conflicts=list(snapshot.conflicts)
 const blocked=technicalBlocked(advice,conversion)
 const hasCommercialContext=list(snapshot?.commercial_context?.opportunities).length||list(snapshot?.commercial_context?.business_history).length||list(snapshot?.facts).length||list(snapshot?.validated_knowledge).length
 const mustDiscover=Boolean(criticalMissing.length||conflicts.length||blocked||!hasCommercialContext)
 const missing=unique([
  ...list(snapshot.missing_information).map(item=>item?.description||item?.code),
  ...list(advice?.confidence?.missing_data),
  ...(blocked?['Validação técnica humana antes de qualquer orientação agronômica acionável.']:[]),
  ...(conflicts.length?['Confirmação da fonte mestre para os conflitos materiais do contexto.']:[])
 ])
 const legacyAction=text(advice.next_best_action||advice?.executive_brief?.action||conversion?.narrative?.action)
 const highestUnknown=text((prepareQuality?decisionModel.decision_questions[0]:null)||input?.decisionIntelligence?.highest_value_unknown?.question||input?.decisionIntelligence?.highestValueUnknown?.question||advice?.next_question?.question||missing[0])
 const recommendedAction=criticalMissing.length
  ?`Antes de recomendar, confirme ${text(criticalMissing[0]?.description||highestUnknown||'a informação crítica que muda esta decisão')}`
  :blocked
   ?'Antes de recomendar, confirme o contexto técnico mínimo e encaminhe a orientação acionável para revisão humana.'
   :prepareQuality&&!decisionModel.insufficient
    ?decisionModel.thesis
    :mustDiscover
     ?`Antes de recomendar, precisamos descobrir ${highestUnknown||'a informação crítica que muda esta decisão'}.`
     :legacyAction||'Avançar com a alternativa priorizada, mantendo premissas, evidências e próximo passo verificáveis.'
 const rationale=prepareQuality&&!decisionModel.insufficient
  ?unique([...decisionModel.material_facts,decisionModel.commercial_signal.price_present&&decisionModel.commercial_signal.price_status==='HYPOTHESIS'?'Preço apareceu como sinal comercial ainda não confirmado como objeção.':'']).slice(0,6)
  :mustDiscover
  ?unique([criticalMissing[0]?.description,conflicts.length&&'Há fontes materiais divergentes.',blocked&&'A barreira técnica exige revisão humana.',!hasCommercialContext&&'Não existe histórico autorizado suficiente.'])
  :unique([
    conversion?.narrative?.reason,
    ...list(conversion?.selectedOpportunity?.reasons),
    ...list(input?.decisionIntelligence?.strategic_synthesis?.connections).map(item=>item?.insight||item?.claim),
    evidence.length&&`${evidence.length} referência(s) autorizada(s) sustentam o contexto.`
   ]).slice(0,6)
 const confidence=baseConfidence(snapshot,evidence.length)
 const risks=unique([
  ...list(advice?.confidence?.contradictions),
  ...conflicts.map(item=>`Conflito material em ${item.key}.`),
  blocked&&'Risco técnico: orientação acionável bloqueada até revisão.',
  confidence<0.5&&'Confiança baixa: não transformar plausibilidade em decisão.'
 ])
 const tradeoffs=[
  {dimension:'PRODUCER_VALUE',position:'A recomendação deve resolver um problema confirmado e preservar o interesse legítimo do produtor.'},
  {dimension:'SUSTAINABLE_MARGIN',position:'Condição comercial não deve destruir margem sem racional, autorização e contrapartida verificável.'},
  {dimension:'LONG_TERM_RELATIONSHIP',position:'Conversão imediata não supera confiança, segurança e relação de longo prazo.'}
 ]
 return assertContract({
  contract_version:decisionThesisVersion,
  version:decisionThesisVersion,
  organization_id:organizationId,
  subject_id:text(input.subjectId||snapshot.subject?.id),
  context_snapshot_id:text(snapshot.context_snapshot_id),
  behavioral_profile_version:profile?.version||null,
  decision:mustDiscover?'DISCOVER_BEFORE_RECOMMENDING':'RECOMMEND',
  objective:text(prepareQuality?decisionModel.objective:input.objective||snapshot.objective||advice.objective||'Melhorar a próxima decisão comercial.'),
  recommended_action:recommendedAction,
  rationale:rationale.length?rationale:['A decisão foi limitada ao contexto autorizado disponível.'],
  evidence_refs:evidence.map(id=>({id})),
  risks,
  alternatives:alternatives(conversion,advice),
  tradeoffs,
  confidence,
  assumptions:unique(list(advice.assumptions).map(item=>item?.statement||item)),
  missing_information:missing,
  what_would_change_my_mind:unique([highestUnknown,...missing]).slice(0,5),
  next_action:text(prepareQuality?decisionModel.commitment_target:mustDiscover?(highestUnknown||'Coletar e confirmar o dado crítico antes de propor.'):(legacyAction||'Registrar o próximo passo com responsável e data.')),
  decision_questions:prepareQuality?decisionModel.decision_questions:[],
  decision_context:prepareQuality?{version:decisionModel.version,crop:decisionModel.crop,solution:decisionModel.solution,agronomic_timing:decisionModel.agronomic_timing,commercial_signal:decisionModel.commercial_signal,participant_known:decisionModel.participant_known,problem_statement:decisionModel.problem_statement}:null,
  why_now:prepareQuality?decisionModel.why_now:null,
  material_facts:prepareQuality?decisionModel.material_facts:[],
  avoid_guidance:prepareQuality?decisionModel.avoid_guidance:null,
  commitment_target:prepareQuality?decisionModel.commitment_target:null,
  proof_candidates:prepareQuality?decisionModel.proofs:[],
  profile_strategy:prepareQuality?decisionModel.profile_strategy:null
 },validateDecisionThesis,'DecisionThesis v1')
}
