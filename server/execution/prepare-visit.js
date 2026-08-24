import {createHash} from 'node:crypto'
import {artifactReference,buildActionPlan} from './action-plan.js'
import {assertExecutionContract,prepareVisitVersion,validatePrepareVisit} from './contracts.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1600)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const iso=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?null:date.toISOString()}
const uuidFrom=value=>{const hash=createHash('sha256').update(JSON.stringify(value)).digest('hex');return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}

function ensureTenant(input){
 const organizationId=text(input.organizationId||input.contextSnapshot?.organization_id,180)
 for(const [artifact,code] of [[input.contextSnapshot,'cross_tenant_prepare_visit_denied'],[input.behavioralProfile,'cross_tenant_behavioral_profile_denied'],[input.decisionThesis,'cross_tenant_decision_thesis_denied'],[input.valuePlan,'cross_tenant_value_plan_denied'],[input.actionPlan,'cross_tenant_action_plan_denied']])if(artifact&&text(artifact.organization_id,180)!==organizationId)throw Object.assign(new Error('Artefato de outro tenant não pode preparar esta visita.'),{code})
 return organizationId
}

export function classifyVisitType(objective){
 const value=normalized(objective)
 if(/assistencia tecnica|visita tecnica|duvida tecnica|avaliacao tecnica|talhao|solo|ndvi|coleta de (?:dado|informacao|analise)/.test(value))return 'TECHNICAL'
 if(/pos.?venda|acompanhamento|relacionamento/.test(value))return 'RELATIONSHIP'
 if(/cobranca|pendencia/.test(value))return 'PENDING_ITEM'
 return 'COMMERCIAL'
}

function profileApproach(profile){
 const weights=profile?.profile_weights||{}
 const ranked=Object.keys(weights).sort((a,b)=>Number(weights[b])-Number(weights[a]))
 const top=ranked[0]
 const known=Boolean(profile?.signals?.length&&Number(profile.confidence)>=.3)
 const labels={analytical:'Analítico',relational:'Relacional',innovative:'Inovador',conservative:'Conservador'}
 return {
  known,
  label:known?(labels[top]||'Perfil híbrido'):'Preferência ainda não confirmada',
  guidance:known?text(profile?.approach_guidance?.communication_style):'Use linguagem neutra e confirme como o produtor prefere avaliar a decisão.',
  proof_preference:known?text(profile?.approach_guidance?.proof_preference):'Pergunte qual evidência seria útil; não presuma.',
  decision_pace:known?text(profile?.approach_guidance?.decision_pace):'Não acelere sem sinais observáveis.'
 }
}

function goldenQuestions(snapshot,profile,valuePlan,type){
 const questions=[]
 const push=value=>{const question=text(value?.question??value?.description??value,500);if(question&&!questions.includes(question))questions.push(question)}
 if(confirmedVisitItems(snapshot,'visit_report.objection').some(item=>/pre[cç]o|investimento|caro/i.test(text(item?.value?.statement))))push('Qual comparação de custo por hectare e retorno tornaria este investimento seguro para avançar?')
 const decisionParticipants=[
  ...confirmedVisitItems(snapshot,'voice.fact'),
  ...confirmedVisitItems(snapshot,'visit_report.producer_signal')
 ]
 if(decisionParticipants.some(item=>item?.value?.signal_code==='MULTI_DECISION_PARTICIPANT'||/s[oó]ci[oa]|decisor|participante.*decis/i.test(text(item?.value?.statement))))push('Quem além de você participa desta decisão e o que essa pessoa precisa validar?')
 if(type==='TECHNICAL'){
  const soil=list(snapshot?.agronomic_context?.soil_analyses)
  const current=soil.some(item=>item?.freshness==='CURRENT')
  if(!current)push('Quando foi feita a última análise de solo válida para esta área e onde está o laudo?')
 }
 for(const item of list(snapshot?.missing_information))push(item)
 for(const item of list(valuePlan?.questions))push(item)
 for(const item of list(profile?.missing_information))push(item)
 return questions.slice(0,3)
}

function opportunities(snapshot,valuePlan){
 const primary=list(snapshot?.commercial_context?.opportunities)[0]?.data||null
 const secondary=list(valuePlan?.cross_sell_candidates).filter(item=>text(item?.description)).map(item=>({
  id:text(item.id,180)||null,
  description:text(item.description,500),
  guidance:'Não desvie o objetivo principal agora; registre a candidata e combine retorno separado.'
 })).slice(0,3)
 return {
  main:{id:text(primary?.id,180)||null,title:text(primary?.title||primary?.category||'Oportunidade principal ainda precisa ser confirmada.',500),stage:text(primary?.stage,80)||null},
  secondary
 }
}

function confirmedVisitItems(snapshot,key){
 return [...list(snapshot?.facts),...list(snapshot?.inferences),...list(snapshot?.hypotheses)].filter(item=>item?.key===key&&/confirmed_(?:visit_report|voice_interaction)/i.test(text(item?.source_type)))
}

function voiceContext(snapshot){
 const groups=[
  {items:list(snapshot?.facts),label:'Fato confirmado pelo consultor'},
  {items:list(snapshot?.inferences),label:'Sinal observável a validar'},
  {items:list(snapshot?.hypotheses),label:'Hipótese a validar'}
 ]
 return groups.flatMap(group=>group.items
  .filter(item=>/confirmed_voice_interaction/i.test(text(item?.source_type)))
  .map(item=>({label:group.label,statement:text(item?.value?.statement,500)})))
  .filter(item=>item.statement).slice(0,4)
}

function whyNow(visit,context){
 const scheduled=iso(visit?.scheduled_at??visit?.scheduledAt)
 const commitments=list(context?.commitments)
 const overdue=commitments.find(item=>{
  const due=iso(item?.due_at??item?.dueAt);return due&&new Date(due)<new Date()&&!['DONE','CANCELLED'].includes(text(item.status).toUpperCase())
 })
 if(overdue)return `Há um compromisso vencido que precisa ser confirmado antes de criar um novo próximo passo.`
 const active=commitments.find(item=>!['DONE','CANCELLED'].includes(text(item?.status).toUpperCase()))
 const outcome=list(context?.learning?.visitOutcomes).at(-1)
 if(outcome&&text(outcome.outcome_type).toUpperCase()==='NO_DECISION')return active
  ?'A visita anterior terminou sem decisão e há um compromisso de retorno ativo; esta conversa deve recuperar o combinado e a evidência solicitada.'
  :'A visita anterior terminou sem decisão; esta conversa deve retomar o que travou e explicitar um próximo passo.'
 if(active)return 'Há um compromisso confirmado da visita anterior que precisa orientar objetivo, prova e próximo passo desta conversa.'
 if(scheduled)return `A visita está agendada para ${new Date(scheduled).toLocaleDateString('pt-BR',{timeZone:'UTC'})}; preparar agora reduz improviso e perguntas sem foco.`
 return 'A visita foi registrada e precisa de objetivo, evidência e próximo passo claros antes da conversa.'
}

function proofList(valuePlan,profile,type,snapshot){
 const values=[...list(valuePlan?.proof_strategy)]
 const proofRequests=['visit_report.expectation','visit_report.next_step','visit_report.behavioral_signal']
  .flatMap(key=>confirmedVisitItems(snapshot,key))
  .some(item=>/comparativ|custo\s*(?:por|\/)\s*(?:hectare|ha)|roi|retorno sobre investimento/i.test(text(item?.value?.statement)))
 if(proofRequests)values.unshift('Levar o comparativo solicitado e explicitar premissas, diferenças, risco e impacto econômico.')
 if(profile?.approach_guidance?.proof_preference)values.unshift(profile.approach_guidance.proof_preference)
 if(type==='TECHNICAL')values.push('Material técnico validado e revisão habilitada quando aplicável.')
 return [...new Set(values.map(item=>text(item,500)).filter(Boolean))].slice(0,5)
}

function objection(valuePlan,snapshot){
 const prior=confirmedVisitItems(snapshot,'visit_report.objection').find(item=>item?.value?.category==='PRICE'||/preço|investimento/i.test(text(item?.value?.statement)))
 const expected=text(list(valuePlan?.expected_objections)[0],300)
 const guidance=list(valuePlan?.objection_guidance)[0]
 return {
  probable:prior?'Objeção de preço/investimento confirmada na visita anterior.':expected||'Nenhuma objeção material está confirmada no contexto atual.',
  guidance:text(guidance?.guidance||'Valide a preocupação, retorne ao problema confirmado e use evidência antes de discutir condição comercial.',700),
  automatic_discount:false
 }
}

export function buildPrepareVisit(input={}){
 const organizationId=ensureTenant(input)
 const snapshot=input.contextSnapshot||{}
 const profile=input.behavioralProfile||{}
 const thesis=input.decisionThesis||{}
 const valuePlan=input.valuePlan||{}
 const visit=input.visit||{}
 const type=classifyVisitType(visit.objective||thesis.objective)
 const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
 const actionPlan=input.actionPlan||buildActionPlan({organizationId,subjectId:snapshot.subject?.id,contextSnapshot:snapshot,decisionThesis:thesis,valuePlan,actor:input.actor,defaultDueAt:visit.scheduled_at??visit.scheduledAt,now})
 const opportunity=opportunities(snapshot,valuePlan)
 const questions=goldenQuestions(snapshot,profile,valuePlan,type)
 const missing=[...list(snapshot.missing_information).map(item=>text(item?.description||item?.code)),...(type==='TECHNICAL'&&!list(snapshot?.agronomic_context?.soil_analyses).some(item=>item?.freshness==='CURRENT')?['Falta análise de solo atualizada ou confirmação de que ela não é necessária para o objetivo desta visita.']:[])].filter(Boolean)
 const commercialApplicable=type==='COMMERCIAL'
 const commitmentTarget=commercialApplicable?text(valuePlan.commitment_target):type==='TECHNICAL'?'Combinar a coleta, validação ou acompanhamento técnico adequado ao objetivo.':'Combinar um próximo passo de relacionamento ou resolução da pendência.'
 const decisionThesisId=text(input.decisionThesisId,180)||artifactReference('decision-thesis',thesis)
 const valuePlanId=text(input.valuePlanId,180)||artifactReference('value-plan',valuePlan)
 const createdAt=now.toISOString()
 const confirmedVoiceContext=voiceContext(snapshot)
 const renderedVoiceContext=confirmedVoiceContext.map(item=>`${item.label}: ${item.statement}`)
 const baseObjective=text(visit.objective||thesis.objective,700)
 const preparedObjective=confirmedVoiceContext.length?text(`${baseObjective} Contexto de voz revisado: ${renderedVoiceContext.join(' ')}`,700):baseObjective
 const baseThesis=text(thesis.recommended_action||'Confirmar os dados críticos antes de recomendar.',1000)
 const preparedThesis=confirmedVoiceContext.length?text(`${baseThesis} Incorporar o contexto de voz sem elevar inferências: ${renderedVoiceContext.join(' ')}`,1000):baseThesis
 return assertExecutionContract({
  contract_version:prepareVisitVersion,
  version:prepareVisitVersion,
  preparation_id:text(input.preparationId,180)||uuidFrom({organizationId,visitId:visit.id,contextSnapshotId:snapshot.context_snapshot_id,actionPlanId:actionPlan.action_plan_id}),
  organization_id:organizationId,
  visit_id:text(visit.id,180),
  subject_id:text(snapshot.subject?.id,180),
  context_snapshot_id:text(snapshot.context_snapshot_id,180),
  behavioral_profile_version:text(profile.version,180),
  decision_thesis_id:decisionThesisId,
  decision_thesis_version:text(thesis.version,180),
  value_plan_id:valuePlanId,
  value_plan_version:text(valuePlan.version,180),
  action_plan_id:actionPlan.action_plan_id,
  visit_type:type,
  objective:preparedObjective,
  main_opportunity:commercialApplicable?opportunity.main:{id:null,title:'O objetivo desta visita não exige oportunidade comercial.',stage:null},
  why_now:whyNow(visit,input.context),
  profile_approach:profileApproach(profile),
  golden_questions:questions,
  val_thesis:preparedThesis,
  proofs_to_take:proofList(valuePlan,profile,type,snapshot),
  probable_objection:commercialApplicable?objection(valuePlan,snapshot).probable:'Não aplicável como objeção comercial para este objetivo.',
  objection_guidance:commercialApplicable?objection(valuePlan,snapshot).guidance:'Conduza o objetivo técnico ou relacional sem forçar proposta ou fechamento.',
  automatic_discount:false,
  commitment_target:commitmentTarget,
  priority_actions:actionPlan.priorities.slice(0,3),
  missing_information:missing,
  secondary_opportunities:commercialApplicable?opportunity.secondary:[],
  safety:{technical_review_required:Boolean(input.technicalReviewRequired),commercial_close_forced:false,profile_changes_facts:false},
  created_at:createdAt
 },validatePrepareVisit,'PrepareVisit v1')
}
