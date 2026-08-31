import {buildContextSnapshot} from '../../server/memory/context-snapshot.js'
import {buildCommercialComposition} from '../../server/commercial/composition.js'
import {buildActionPlan} from '../../server/execution/action-plan.js'
import {buildPrepareVisit} from '../../server/execution/prepare-visit.js'

export const qualityTenant='00000000-0000-4000-8000-000000000901'
export const qualityActor='00000000-0000-4000-8000-000000000902'
const now=new Date('2026-08-24T12:00:00.000Z')

function memory({index,clientId,visitId,key,statement,state='FACT',domain='COMMERCIAL',sourceType='confirmed_voice_interaction'}){
 const at=now.toISOString()
 return {
  id:`00000000-0000-4000-8000-${String(910+index).padStart(12,'0')}`,
  organization_id:qualityTenant,client_id:clientId,context_owner_id:qualityActor,subject_type:'visit',subject_id:visitId,
  memory_type:state==='FACT'?'fact':'inference',memory_state:state,memory_domain:domain,key,
  value:{statement,category:state==='HYPOTHESIS'?'HYPOTHESIS':'FACT_CANDIDATE'},
  evidence:[{id:`candidate-${index}`,source_ref:`voice-interaction:${visitId}`,confirmation_status:'CONFIRMED'}],
  confidence:state==='FACT'?90:62,status:state==='FACT'?'verified':'proposed',
  source_ref:`voice-interaction:${visitId}`,source_type:sourceType,observed_at:at,valid_from:at,created_at:at,updated_at:at,acl:{scope:'own_portfolio'}
 }
}

export function runPrepareQualityFixture({id,client,profile,memoryHistory=[],businessHistory=[],opportunities=[],fieldReports=[],objective}){
 const visitId=`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`
 const scope=item=>({...item,tenant_id:qualityTenant,producer_id:client.id,context_owner_id:qualityActor})
 const visit=scope({id:visitId,clientId:client.id,scheduledAt:'2026-08-25T12:00:00.000Z',objective,status:'Agendada'})
 const profileSourceId=profile?.sourceId||profile?.evidence?.[0]?.id||null
 const scopedEvidence=(profile?.evidence||[]).map(item=>scope({...item,profile_source_ref:item.profile_source_ref||profileSourceId,source_type:item.source_type||'producer_questionnaire',assessed_at:item.assessed_at||now.toISOString(),valid_until:item.valid_until||'2027-08-24T12:00:00.000Z'}))
 const scopedProfile={...profile,sourceId:profileSourceId,assessedAt:profile?.assessedAt||now.toISOString(),validUntil:profile?.validUntil||'2027-08-24T12:00:00.000Z',evidence:scopedEvidence}
 const normalizedMemories=memoryHistory.map((item,index)=>memory({index,clientId:client.id,visitId,...item}))
 const context={client:{...client,profileEvidence:scopedEvidence,profileSource:profileSourceId},profile:scopedProfile,memoryHistory:normalizedMemories,businessHistory:businessHistory.map(scope),opportunities:opportunities.map(scope),fieldReports:fieldReports.map(scope),visits:[visit],interactions:[],commitments:[],properties:[],soilAnalyses:[],ndviObservations:[],conversionInnovations:{}}
 const snapshot=buildContextSnapshot(context,{organizationId:qualityTenant,subjectType:'client',subjectId:client.id,actorId:qualityActor,role:'consultant',scope:'own_portfolio',objective:'prepare_visit',requestId:`00000000-0000-4000-8000-${String(Number(id)+100).padStart(12,'0')}`,message:objective,now})
 context.contextSnapshot=snapshot
 const commercial=buildCommercialComposition({context,contextSnapshot:snapshot,organizationId:qualityTenant,message:`Preparar visita: ${objective}`,now})
 const actionPlan=buildActionPlan({organizationId:qualityTenant,subjectId:client.id,contextSnapshot:snapshot,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actor:{type:'USER',id:qualityActor},defaultDueAt:visit.scheduledAt,now})
 const preparation=buildPrepareVisit({organizationId:qualityTenant,contextSnapshot:snapshot,context,visit,behavioralProfile:commercial.behavioral_profile,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actionPlan,actor:{type:'USER',id:qualityActor},technicalReviewRequired:/t[eé]cnic|talh[aã]o|solo/i.test(objective),now})
 return {visit,context,snapshot,commercial,actionPlan,preparation,voiceInteraction:{interaction_type:'PRE_VISIT',confirmation_status:'CONFIRMED',candidates:normalizedMemories.map(item=>({category:item.value.category,epistemic_status:item.memory_state,statement:item.value.statement}))},confirmedFacts:normalizedMemories}
}

export function costaBeberFixture(profileKind='ANALYTICAL'){
 const profiles={
  ANALYTICAL:{client:{primaryProfile:'Analítico',scores:{analitico:3}},profile:{answers:{7:'Resultados técnicos, números e retorno financeiro.',8:'Comparativos e custo por hectare.'},evidence:[{id:'survey-costa'}]}},
  RELATIONAL:{client:{primaryProfile:'Relacional',scores:{relacional:3}},profile:{answers:{7:'Confiança, histórico e compromisso cumprido.'},evidence:[{id:'survey-costa-rel'}]}},
  UNKNOWN:{client:{scores:{}},profile:{answers:{},evidence:[]}}
 }
 const selected=profiles[profileKind]
 return runPrepareQualityFixture({
  id:1001,
  client:{id:'costa-beber',name:'Antonio Carlos Costa Beber',commercial:{currentPurchases:450000,potential:800000},...selected.client},
  profile:selected.profile,
  objective:'Visitar o produtor para falar sobre inseticida no milho, entender a diferença de preço e avançar a negociação.',
  // Legacy data deliberately keeps the broad voice.fact key to prove backward compatibility.
  memoryHistory:[
   {key:'voice.fact',statement:'Vou visitar o Antonio para falar sobre inseticida no milho'},
   {key:'voice.fact',statement:'O milho já foi plantado e já emergiu',domain:'AGRONOMIC'},
   {key:'voice.fact',statement:'A primeira aplicação está próxima agora',domain:'AGRONOMIC'},
   {key:'voice.fact',statement:'A precificação está um pouco diferente'},
   {key:'voice.fact',statement:'Quero entender como avançar a negociação sem começar pelo preço'}
  ],
  businessHistory:[{id:'costa-sale-1',product:'Inseticida',culture:'Milho',outcome:'won',occurred_at:'2026-05-01T00:00:00.000Z'}]
 })
}

export function soyFungicideFixture(){
 return runPrepareQualityFixture({
  id:1002,
  client:{id:'producer-soy',name:'Produtora Soja',primaryProfile:'Conservador',scores:{conservador:3},commercial:{}},
  profile:{answers:{7:'Segurança, histórico e continuidade.'},evidence:[{id:'survey-soy'}]},
  objective:'Visita técnica no talhão de soja para entender a decisão sobre fungicida e o risco observado.',
  memoryHistory:[
   {key:'voice.agronomic_stage',statement:'A soja está em fechamento de linhas.',domain:'AGRONOMIC'},
   {key:'voice.agronomic_timing',statement:'A primeira aplicação de fungicida está próxima.',domain:'AGRONOMIC'},
   {key:'visit_report.technical_observation',statement:'Foi relatada pressão de doença no talhão, ainda sem diagnóstico validado.',state:'HYPOTHESIS',domain:'AGRONOMIC'}
  ],
  fieldReports:[{id:'field-soy-1',observation:'Pressão de doença relatada, sem prescrição.',observed_at:'2026-08-23T00:00:00.000Z'}]
 })
}

export function newProducerFixture(){
 return runPrepareQualityFixture({
  id:1003,
  client:{id:'producer-new',name:'Produtor Novo',scores:{},commercial:{}},
  profile:{answers:{},evidence:[]},
  objective:'Primeira visita para conhecer as prioridades do produtor.',
  memoryHistory:[]
 })
}
