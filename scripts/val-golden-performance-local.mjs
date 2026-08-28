#!/usr/bin/env node

import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {buildCommercialComposition} from '../server/commercial/composition.js'
import {buildActionPlan} from '../server/execution/action-plan.js'
import {buildPrepareVisit} from '../server/execution/prepare-visit.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {composeAIReasoning} from '../server/ai-reasoning/index.js'
import {buildCapabilityExecutionResponse,executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'
import {buildFastClientResponse,buildFastMarketResponse,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {deterministicVoiceCandidateExtraction} from '../server/voice-capture/extraction.js'
import {buildAgronomicScanProvenance} from '../server/agronomic-scan-provenance.js'
import {canonicalValToManualGeometry,encodeCanonicalGeometryRef,manualToCanonicalValGeometry} from '../src/lib/agronomic-geometry-adapter.js'
import {createAgroHeroContext,createAgroSessionMediaMessage,validateAgroHeroFile} from '../src/lib/agro-hero-actions.js'
import {localNaturalCommandTurn,resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'

export const localGoldenPerformanceRunnerVersion='val.golden_performance.local_integration.v1'

const organizationId='00000000-0000-4000-8000-000000000801'
const actorId='00000000-0000-4000-8000-000000000802'
const clientId='synthetic-gp-client'
const now=new Date('2026-08-27T12:00:00.000Z')
const partialCases=new Map([
 ['GP-005','PARTIAL_BROWSER_FILE_UAT_REQUIRED'],['GP-006','PARTIAL_PHYSICAL_IMAGE_UAT_REQUIRED'],
 ['GP-007','PARTIAL_PHYSICAL_IMAGE_UAT_REQUIRED'],['GP-008','PARTIAL_BROWSER_GEOMETRY_UAT_REQUIRED'],
 ['GP-012','PARTIAL_PHYSICAL_VOICE_UAT_REQUIRED'],['GP-013','PARTIAL_PHYSICAL_VOICE_UAT_REQUIRED'],
 ['GP-015','PARTIAL_PHYSICAL_CAMERA_UAT_REQUIRED'],['GP-016','PARTIAL_BROWSER_FILE_UAT_REQUIRED']
])

const round=value=>Number(Number(value).toFixed(3))
const list=value=>Array.isArray(value)?value:[]
const assert=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code})}
const average=values=>round(values.reduce((sum,value)=>sum+Number(value||0),0)/Math.max(1,values.length))

function memory(index,key,statement,{domain='COMMERCIAL',state='FACT'}={}){
 const at=now.toISOString()
 return {
  id:`00000000-0000-4000-8000-${String(810+index).padStart(12,'0')}`,
  organization_id:organizationId,client_id:clientId,subject_type:'client',subject_id:clientId,
  memory_type:state==='FACT'?'fact':'hypothesis',memory_state:state,memory_domain:domain,key,value:{statement},
  evidence:[{id:`synthetic-evidence-${index}`,source_ref:`synthetic:${index}`,confirmation_status:'CONFIRMED'}],
  confidence:state==='FACT'?90:60,status:state==='FACT'?'verified':'proposed',source_ref:`synthetic:${index}`,
  source_type:'confirmed_voice_interaction',observed_at:at,valid_from:at,created_at:at,updated_at:at,acl:{scope:'own_portfolio'}
 }
}

function geometryFixture(){
 return manualToCanonicalValGeometry({
  organizationId,clientId,propertyId:'synthetic-property',fieldId:'synthetic-field',propertyName:'Propriedade Sintética',fieldName:'Talhão Norte',
  points:[{lat:-25,lng:-53},{lat:-25,lng:-52.99},{lat:-25.01,lng:-52.99},{lat:-25.01,lng:-53}],
  provenance:{source:'golden-performance-synthetic',sourceRef:'synthetic:geometry',observedAt:now.toISOString()}
 })
}

function scanAttachment(analysisType,index){
 const id=`00000000-0000-4000-8000-${String(850+index).padStart(12,'0')}`
 const attachment={id,tenantId:organizationId,ownerId:actorId,clientId,client_id:'00000000-0000-4000-8000-000000000803',createdAt:now.toISOString(),sha256:'a'.repeat(64)}
 const provenance=buildAgronomicScanProvenance({
  sourceAttachment:{attachmentId:id,association:'LINKED_CLIENT',organizationId,clientId,createdAt:now.toISOString(),sha256:'a'.repeat(64)},
  attachment,tenantId:organizationId,ownerId:actorId,analysisType,createdAt:now.toISOString(),resultReference:`synthetic-result:${analysisType.toLowerCase()}`,propertyId:'synthetic-property',fieldId:'synthetic-field'
 })
 return {...attachment,mimeType:'image/jpeg',analysis:{latestScanResult:{...provenance,result:{summary:`Resultado sintético ${analysisType}; triagem, não prescrição.`}}}}
}

function syntheticContext(){
 const context={
  organizationId,
  client:{id:clientId,name:'Produtor Sintético GP',municipality:'Município Sintético',cultures:'Milho',primaryProfile:'Analítico',decisionDriver:'comparativo com números da própria área',commercial:{currentPurchases:150000,potential:260000}},
  profile:{answers:{6:'Produtor e sócio',7:'Resultados técnicos, números e retorno financeiro.',8:'Comparativos e custo por hectare.'},assessedAt:'2026-08-20T10:00:00.000Z',evidence:[{id:'synthetic-survey',source_type:'producer_questionnaire'}]},
  memoryHistory:[
   memory(1,'voice.fact','A visita tratará de inseticida no milho.'),memory(2,'voice.fact','O milho já emergiu.',{domain:'AGRONOMIC'}),
   memory(3,'voice.fact','A primeira aplicação está próxima.',{domain:'AGRONOMIC'}),memory(4,'voice.fact','O preço ainda precisa ser comparado.')
  ],
  memories:[],businessHistory:[{id:'synthetic-business',product:'Inseticida',culture:'Milho',outcome:'won',occurred_at:'2026-06-01T00:00:00.000Z'}],
  visits:[{id:'synthetic-visit-completed',objective:'Revisão sintética de milho',summary:'Comparativo solicitado.',status:'Concluída',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-26T12:00:00.000Z'}],
  interactions:[{id:'synthetic-interaction',summary:'Pediu ROI e custo por hectare.',occurred_at:'2026-08-26T13:00:00.000Z'}],
  commitments:[{commitment_id:'synthetic-commitment',description:'Enviar comparativo de custo por hectare',status:'OPEN',due_at:'2026-08-28T12:00:00.000Z'}],
  opportunities:[{id:'synthetic-opportunity',title:'Inseticida no milho',category:'Proteção',stage:'proposta',estimated_value:80000,next_action:'Revisar comparativo',next_action_at:'2026-08-28T00:00:00.000Z',updated_at:'2026-08-26T00:00:00.000Z'}],
  properties:[],fieldReports:[{id:'synthetic-field-report',summary:'Milho emergido; causa de qualquer sintoma ainda não diagnosticada.',observed_at:'2026-08-26T00:00:00.000Z'}],
  soilAnalyses:[{id:'synthetic-soil-analysis',sampledAt:'2026-08-20T00:00:00.000Z',laboratory:'Laboratório Sintético',measurements:[{metric:'pH',value:5.4,unit:'pH'},{metric:'CTC',value:11.2,unit:'cmolc/dm3'}]}],
  ndviObservations:[],manualRecords:[{id:'synthetic-manual-record',summary:'Registro técnico sintético confirmado.'}],signals:[],
  priorRecommendations:[{id:'synthetic-recommendation',golden_questions:[{question:'Qual evidência define a decisão?',context_refs:['synthetic-interaction']}]}],conversionInnovations:{},
  attachments:[scanAttachment('NUTRISCAN',1),scanAttachment('FITOSCAN',2)]
 }
 const canonical=geometryFixture()
 context.properties=[{id:'synthetic-property',name:'Propriedade Sintética',fields:[{id:'synthetic-field',name:'Talhão Norte',geometry_ref:encodeCanonicalGeometryRef(canonical),geometry_version:canonical.geometryVersion}]}]
 context.contextSnapshot=buildContextSnapshot(context,{organizationId,subjectType:'client',subjectId:clientId,actorId,role:'consultant',scope:'own_portfolio',objective:'golden_performance',requestId:'00000000-0000-4000-8000-000000000804',message:'Preparar decisão sintética',now})
 return context
}

function adviceFixture(context,commercial){
 return {
  answer:'Produtor Sintético GP precisa comparar custo por hectare e evidência do milho antes de avançar.',objective:'Definir a próxima decisão do inseticida no milho.',
  next_best_action:'Revisar o comparativo e combinar validação com data.',executive_brief:{headline:'Comparativo pendente para o milho',reason:'A conta pediu números da própria área.',action:'Revisar custo por hectare e combinar validação.',evidence_ids:['synthetic-interaction','synthetic-opportunity'],missing_data:['critério final']},
  strategic_synthesis:{moment:'Decisão de inseticida no milho depende do comparativo.',non_obvious_connection:'A preferência por números muda a forma de avançar.',decision_at_stake:'Avançar ou redesenhar a prova.',do_not_do:'Não discutir desconto antes da prova.',highest_value_unknown:{question:'Qual resultado por hectare tornaria a prova suficiente?',why_it_matters:'Muda a decisão.',how_to_get:'Perguntar ao produtor.',evidence_ids:['synthetic-interaction']}},
  decision_thesis:commercial.decision_thesis,value_plan:commercial.value_plan,behavioral_profile:commercial.behavioral_profile,
  evidence_used:[{id:'synthetic-interaction',source_type:'interaction',claim_supported:'O produtor pediu custo por hectare.'},{id:'synthetic-opportunity',source_type:'opportunity',claim_supported:'Inseticida no milho está em proposta.'}],
  next_question:{question:'Qual resultado por hectare tornaria a prova suficiente?',purpose:'Definir a prova.',evidence_needed:'Métrica aceita.',grounding_ids:['synthetic-interaction']},questions:[],commercial_context:{status:'known',profile_strategy:'Usar números da própria área.'},human_review:{required:false},blocked_actions:[],guardrails:['Não fabricar evidência.'],knowledge_retrieval:commercial.knowledge_retrieval
 }
}

function scoring({useful,target,path,safety=true,specificity=0,grounding=0,intrinsic=null}={}){
 const contractScore=average([useful?1:0,target?1:0,path?1:0,safety?1:0,specificity,grounding])
 return {qualityScore:intrinsic==null?contractScore:round((contractScore+Number(intrinsic))/2),specificity:round(specificity),grounding:round(grounding)}
}

async function routeAndExecute(measure,{message,intentHint='',context,attachments=[]}={}){
 const route=await measure('INTENT',()=>routeSystemCapability({message,intentHint,hasClient:true,attachmentTypes:attachments.map(item=>item.mimeType||item.mime_type)}))
 const execution=await measure('TOOL',()=>executeCapabilityPlan({route,message,context,attachments,clientId,calculatorOptions:{}}))
 return {route,execution}
}

const runners={
 'GP-001':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext())
  const message='Qual foi a última visita?';const route=await measure('INTENT',()=>routeSystemCapability({message,intentHint:'ASK_CLIENT',hasClient:true}))
  const response=await measure('TOOL',()=>buildFastClientResponse({facts:{client:context.client,latestCompletedVisit:context.visits[0]},message,organizationId,conversationId:'synthetic-gp-001',now}))
  const run=response.advice.ai_reasoning.run;const target=run.capabilities_used.includes('VISIT_HISTORY');const specific=/Produtor Sintético GP|Revisão sintética de milho/.test(response.advice.answer);const grounded=run.capability_results.some(item=>item.source_ref==='synthetic-visit-completed')
  return {...scoring({useful:Boolean(response.advice.answer),target,path:route.path==='FAST',specificity:specific?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-002':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Qual é o compromisso aberto?';const {route,execution}=await routeAndExecute(measure,{message,intentHint:'ASK_CLIENT',context})
  const target=execution.capabilities_used.includes('COMMERCIAL_HISTORY');const specific=/comparativo de custo por hectare/i.test(execution.tool_result?.summary||'');const grounded=execution.capability_results.some(item=>item.source_ref==='synthetic-commitment')
  return {...scoring({useful:Boolean(execution.tool_result),target,path:route.path==='FAST',specificity:specific?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-003':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Só me manda as Perguntas de Ouro.';const route=await measure('INTENT',()=>routeSystemCapability({message,hasClient:true}))
  const payload={advice:{answer:'Leitura sintética.',ai_reasoning:{golden_questions:[{question:'Qual evidência define a decisão?',context_refs:['synthetic-interaction']},{question:'Quem participa da decisão?',context_refs:['synthetic-survey']}]}}}
  const turn=await measure('TOOL',()=>localNaturalCommandTurn(resolveValNaturalCommand(message),payload));const target=turn?.command==='GOLDEN_QUESTIONS_ONLY';const specific=/evidência define|participa da decisão/i.test(turn?.text||'')
  return {...scoring({useful:Boolean(turn?.text),target,path:route.path==='FAST',specificity:specific?1:0,grounding:target?.9:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-004':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Prepare a próxima visita para discutir o inseticida no milho.';const route=await measure('INTENT',()=>routeSystemCapability({message,intentHint:'PREPARE_VISIT',hasClient:true}))
  const commercial=await measure('MCA',()=>buildCommercialComposition({context,contextSnapshot:context.contextSnapshot,organizationId,message,now}))
  const visit={id:'00000000-0000-4000-8000-000000000860',clientId,scheduledAt:'2026-08-28T12:00:00.000Z',objective:'Negociar inseticida no milho com evidência.',status:'Agendada'}
  const actionPlan=await measure('TOOL',()=>buildActionPlan({organizationId,subjectId:clientId,contextSnapshot:context.contextSnapshot,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actor:{type:'USER',id:actorId},defaultDueAt:visit.scheduledAt,now}))
  const preparation=await measure('VALIDATION',()=>buildPrepareVisit({organizationId,contextSnapshot:context.contextSnapshot,context,visit,behavioralProfile:commercial.behavioral_profile,decisionThesis:commercial.decision_thesis,valuePlan:commercial.value_plan,actionPlan,actor:{type:'USER',id:actorId},now}))
  const target=preparation.quality_audit?.passed===true;const specificity=Number(preparation.quality_audit?.dimensions?.CONTEXT_SPECIFICITY||0);const grounding=preparation.context_snapshot_id===context.contextSnapshot.context_snapshot_id?1:0
  return {...scoring({useful:Boolean(preparation.objective&&preparation.golden_questions.length),target,path:route.path==='DEEP',specificity,grounding,intrinsic:preparation.quality_audit?.score}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-005':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Interpreta essa análise de solo.';const {route,execution}=await routeAndExecute(measure,{message,intentHint:'ANALYZE_SOIL',context,attachments:[{id:'synthetic-soil-file',mimeType:'application/pdf'}]})
  const target=execution.capabilities_used.includes('SOIL_ANALYSIS');const specific=execution.tool_result?.measurement_count===2||execution.tool_result?.facts?.measurement_count===2;const grounded=execution.capability_results.some(item=>item.source_ref==='synthetic-soil-analysis')
  return {...scoring({useful:Boolean(execution.tool_result),target,path:route.path==='TOOL',specificity:specific?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-006':async({measure})=>scanCase({measure,analysisType:'NUTRISCAN',message:'Me mostra o último NutriScan.'}),
 'GP-007':async({measure})=>scanCase({measure,analysisType:'FITOSCAN',message:'Me mostra o último FitoScan.'}),
 'GP-008':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Abre o mapeamento da área.';const {route,execution}=await routeAndExecute(measure,{message,intentHint:'ASK_AGRONOMIC',context})
  const roundTrip=await measure('VALIDATION',()=>{const canonical=geometryFixture();return canonicalValToManualGeometry(canonical,{expectedOrganizationId:organizationId})})
  const target=execution.capabilities_used.includes('AREA_MAPPING')&&roundTrip.geometryVersion;const specific=execution.tool_result?.facts?.mapped_fields===1;const grounded=roundTrip.provenance?.sourceRef==='synthetic:geometry'
  return {...scoring({useful:Boolean(execution.tool_result),target:Boolean(target),path:route.path==='TOOL',specificity:specific?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:Boolean(target)}
 },
 'GP-009':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Calcule demanda de sementes: área 100 ha, população 300000 sementes/ha, margem 5%, embalagem 60000 sementes.';const {route,execution}=await routeAndExecute(measure,{message,intentHint:'CALCULATE',context})
  const target=execution.capabilities_used.includes('CALCULATORS')&&execution.tool_result?.calculator==='sementes';const specific=execution.tool_result?.facts?.bagsRequired===525;const grounded=/AgronomicCalculatorAdapter\.v1/.test(execution.tool_result?.calculator_contract_version||'')
  return {...scoring({useful:Boolean(execution.tool_result),target,path:route.path==='TOOL',specificity:specific?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-010':async({measure})=>{
  const message='Qual é a cotação atual da soja?';const route=await measure('INTENT',()=>routeSystemCapability({message,intentHint:'ASK_MARKET',hasClient:false}))
  const workspace=await measure('CONTEXT',()=>({marketSnapshots:[{id:'synthetic-market',commodity:'soja',marketKind:'spot',region:'Município Sintético/BR',price:123.45,priceUnit:'BRL/sc_60kg',sourceName:'Fonte Sintética Autorizada',sourceUrl:'https://example.test/source',observedAt:'2026-08-27T11:30:00.000Z',confidence:90,status:'active'}]}))
  const response=await measure('TOOL',()=>buildFastMarketResponse({workspace,message,intentHint:'ASK_MARKET',organizationId,ownerId:actorId,conversationId:'synthetic-gp-010',now}))
  const run=response.advice.ai_reasoning.run;const target=run.capabilities_used.includes('MARKET_COMMODITY');const specific=/123,45|Município Sintético/.test(response.advice.answer);const grounded=/Fonte Sintética Autorizada/.test(response.advice.answer)&&run.capability_results.some(item=>item.source_ref==='synthetic-market')
  return {...scoring({useful:Boolean(response.advice.answer),target,path:route.path==='LIVE_DATA',specificity:specific?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-011':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const message='Cruze agronomia, histórico, perfil e preço e recomende a próxima decisão.';const route=await measure('INTENT',()=>routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:true}))
  const commercial=await measure('MCA',()=>buildCommercialComposition({context,contextSnapshot:context.contextSnapshot,organizationId,message,now}));const advice=adviceFixture(context,commercial)
  const composition=await measure('MIA',()=>composeAIReasoning({advice,context,message,intentHint:'ASK_AGRONOMIC',conversationId:'synthetic-gp-011'}));const quality=composition.quality;const target=quality.passed===true&&composition.result.run.path==='DEEP'
  return {...scoring({useful:Boolean(composition.result.recommended_strategy?.action),target,path:route.path==='DEEP',specificity:Number(quality.dimensions?.specificity||0),grounding:Number(quality.dimensions?.context_usage||0),intrinsic:quality.overall}),intent:composition.result.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-012':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const transcript='O critério é custo por hectare e a decisão será amanhã.'
  const extraction=await measure('TOOL',()=>deterministicVoiceCandidateExtraction({transcript,voiceInteractionId:'00000000-0000-4000-8000-000000000870',transcriptRef:'synthetic-transcript:gp-012',interactionType:'DECISION_FOLLOW_UP',now}))
  const route=await measure('INTENT',()=>routeSystemCapability({message:'Como ajustar a abordagem com essa resposta?',intentHint:'FOLLOW_UP_HELP',hasClient:true}));const target=extraction.candidates.length>0&&extraction.candidates.every(item=>item.requires_confirmation===true);const grounded=extraction.candidates.every(item=>item.source_ref==='synthetic-transcript:gp-012')
  return {...scoring({useful:extraction.candidates.length>0,target,path:route.path==='CONTEXT',specificity:target?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-013':async({measure})=>{
  const context=await measure('CONTEXT',()=>createAgroHeroContext({producer:{id:clientId,name:'Produtor Sintético GP'},field:{id:'synthetic-field',name:'Talhão Norte'}}));const extraction=await measure('TOOL',()=>deterministicVoiceCandidateExtraction({transcript:'No Talhão Norte há uma observação de lavoura ainda sem diagnóstico.',voiceInteractionId:'00000000-0000-4000-8000-000000000871',transcriptRef:'synthetic-transcript:gp-013',interactionType:'FIELD_NOTE',now}))
  const target=context.clientId===clientId&&extraction.candidates.length>0;const grounded=extraction.candidates.every(item=>item.source_ref==='synthetic-transcript:gp-013')
  return {...scoring({useful:target,target,path:true,specificity:context.field?.label==='Talhão Norte'?1:0,grounding:grounded?1:0}),intent:'ASK_AGRONOMIC',observedPath:'TOOL',targetExecuted:target}
 },
 'GP-014':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const hero=await measure('CONTEXT',()=>createAgroHeroContext({producer:context.client,field:{id:'synthetic-field',name:'Talhão Norte'}}));const message='Qual é o risco agronômico deste talhão?';const route=await measure('INTENT',()=>routeSystemCapability({message,intentHint:'ASK_AGRONOMIC',hasClient:true,activeContext:{type:'field',id:'synthetic-field'}}))
  const commercial=await measure('MCA',()=>buildCommercialComposition({context,contextSnapshot:context.contextSnapshot,organizationId,message,now}));const composition=await measure('MIA',()=>composeAIReasoning({advice:adviceFixture(context,commercial),context,message,intentHint:'ASK_AGRONOMIC'}));const target=hero.clientId===clientId&&route.path==='CONTEXT'&&Boolean(composition.result.recommended_strategy?.reading);const quality=composition.quality
  return {...scoring({useful:target,target,path:route.path==='CONTEXT',specificity:Number(quality.dimensions?.specificity||0),grounding:Number(quality.dimensions?.context_usage||0),intrinsic:quality.overall}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-015':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const file={name:'synthetic-field.jpg',type:'image/jpeg',size:2048};const validation=await measure('VALIDATION',()=>validateAgroHeroFile(file,'photo'));const media=await measure('TOOL',()=>createAgroSessionMediaMessage({files:[file],intent:'IMAGE_DIAGNOSIS',navigationRequestId:'synthetic-nav-gp-015',transferId:'synthetic-transfer-gp-015'}));const message='VAL, analisa essa foto.'
  const {route,execution}=await routeAndExecute(measure,{message,intentHint:'IMAGE_DIAGNOSIS',context,attachments:[{id:'00000000-0000-4000-8000-000000000872',mimeType:'image/jpeg',analysis:{summary:'Sintoma visual registrado sem causa confirmada.',diagnosticStatus:'not_a_diagnosis'}}]});const target=validation.ok&&media.version===2&&execution.capabilities_used.includes('IMAGE_DIAGNOSIS');const grounded=execution.capability_results.some(item=>item.source_ref==='00000000-0000-4000-8000-000000000872')
  return {...scoring({useful:Boolean(execution.tool_result),target,path:route.path==='TOOL',specificity:/sem causa confirmada/.test(execution.tool_result?.summary||'')?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 },
 'GP-016':async({measure})=>{
  const context=await measure('CONTEXT',()=>syntheticContext());const file={name:'synthetic-soil-analysis.pdf',type:'application/pdf',size:4096};const validation=await measure('VALIDATION',()=>validateAgroHeroFile(file,'file'));const media=await measure('TOOL',()=>createAgroSessionMediaMessage({files:[file],intent:'ANALYZE_SOIL',navigationRequestId:'synthetic-nav-gp-016',transferId:'synthetic-transfer-gp-016'}));const message='VAL, interpreta essa análise de solo.';const {route,execution}=await routeAndExecute(measure,{message,intentHint:'ASK_AGRONOMIC',context,attachments:[{id:'synthetic-soil-file',mimeType:'application/pdf'}]});const target=validation.ok&&media.version===2&&execution.capabilities_used.includes('SOIL_ANALYSIS');const grounded=execution.capability_results.some(item=>item.source_ref==='synthetic-soil-analysis')
  return {...scoring({useful:Boolean(execution.tool_result),target,path:route.path==='TOOL',specificity:execution.tool_result?.facts?.measurement_count===2?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
 }
}

async function scanCase({measure,analysisType,message}){
 const context=await measure('CONTEXT',()=>syntheticContext());const {route,execution}=await routeAndExecute(measure,{message,intentHint:'IMAGE_DIAGNOSIS',context});const facts=execution.tool_result?.facts||{};const target=execution.capabilities_used.includes(analysisType)&&facts.analysis_type===analysisType;const grounded=facts.source_attachment_reference===facts.attachment_id&&facts.provenance_contract_version==='AgronomicScanProvenance.v1'
 return {...scoring({useful:Boolean(execution.tool_result),target,path:route.path==='TOOL',specificity:target?1:0,grounding:grounded?1:0}),intent:route.intent,observedPath:route.path,targetExecuted:target}
}

async function executeCase(goldenCase,{record=true}={}){
 const startedAt=performance.now();const stages={}
 const measure=async(stage,work)=>{const started=performance.now();const value=await work();stages[stage]=round((stages[stage]||0)+(performance.now()-started));return value}
 try{
  const outcome=await runners[goldenCase.id]({measure});const totalMs=round(performance.now()-startedAt);const pathMatches=outcome.observedPath===goldenCase.path;assert(pathMatches,'PATH_CONTRACT_MISMATCH');assert(outcome.targetExecuted,'TARGET_NOT_EXECUTED')
  if(goldenCase.path==='FAST')assert(Number(outcome.specificity)>=.8,'FAST_GENERIC_FAIL')
  const result=partialCases.get(goldenCase.id)||'PASS_LOCAL_INTEGRATION';const qualityStatus=result.startsWith('PARTIAL')?'PARTIAL':'PASS'
  return {
   case_id:goldenCase.id,path:goldenCase.path,service_class:goldenCase.service_class||goldenCase.path,intent:outcome.intent||goldenCase.intent,status:'SUCCESS',ttfr_ms:totalMs,total_ms:totalMs,stages_ms:{...stages,TOTAL:totalMs},
   observed_at:new Date().toISOString(),source:'local-canonical-integration',observed_path:outcome.observedPath,path_matches_contract:pathMatches,target:goldenCase.target,target_executed:true,error_code:'',
   quality_score:outcome.qualityScore,specificity_score:outcome.specificity,grounding_score:outcome.grounding,quality_status:qualityStatus,result,evidence_class:'LOCAL_INTEGRATION'
  }
 }catch(error){
  const totalMs=round(performance.now()-startedAt)
  return {case_id:goldenCase.id,path:goldenCase.path,service_class:goldenCase.service_class||goldenCase.path,intent:goldenCase.intent,status:'FAILED',ttfr_ms:null,total_ms:totalMs,stages_ms:{...stages,TOTAL:totalMs},observed_at:new Date().toISOString(),source:'local-canonical-integration',observed_path:'',path_matches_contract:false,target:goldenCase.target,target_executed:false,error_code:String(error?.code||error?.message||'LOCAL_BENCHMARK_FAILURE').slice(0,120),quality_status:'FAIL',result:'FAIL_LOCAL_INTEGRATION',evidence_class:'LOCAL_INTEGRATION'}
 }
}

function parseArgs(argv){
 const args={goldenSet:'evals/val-golden-performance-v1.json',repeat:30,warmup:3}
 for(let index=0;index<argv.length;index+=1){
  const key=argv[index];const value=argv[index+1]
  if(key==='--help'){args.help=true;continue}
  if(value==null||value.startsWith('--'))throw new Error(`Argumento sem valor: ${key}`)
  if(key==='--golden-set')args.goldenSet=value
  else if(key==='--output')args.output=value
  else if(key==='--repeat')args.repeat=Number(value)
  else if(key==='--warmup')args.warmup=Number(value)
  else throw new Error(`Argumento desconhecido: ${key}`)
  index+=1
 }
 return args
}

async function main(){
 const args=parseArgs(process.argv.slice(2))
 if(args.help){process.stdout.write('Uso: node scripts/val-golden-performance-local.mjs [--repeat 30] [--warmup 3] [--output arquivo.json]\n');return}
 const golden=JSON.parse(await readFile(resolve(args.goldenSet),'utf8'));assert(golden.fixture_class==='SYNTHETIC_ONLY','GOLDEN_SET_NOT_SYNTHETIC')
 const repeat=Math.max(20,Math.min(100,Number(args.repeat)||30));const warmup=Math.max(0,Math.min(10,Number(args.warmup)||0))
 for(let index=0;index<warmup;index+=1)for(const goldenCase of golden.cases)await executeCase(goldenCase,{record:false})
 const samples=[]
 for(let index=0;index<repeat;index+=1)for(const goldenCase of golden.cases)samples.push(await executeCase(goldenCase))
 const document={schema_version:'val.performance_benchmark_samples.v1',runner_version:localGoldenPerformanceRunnerVersion,generated_at:new Date().toISOString(),fixture_class:'SYNTHETIC_ONLY',contains_real_data:false,evidence_boundary:'Canonical in-process integration timing; excludes HTTP transport, PostgreSQL/Railway latency, browser rendering and physical microphone/camera/TTS.',repeat,warmup,samples}
 const serialized=`${JSON.stringify(document,null,2)}\n`
 if(args.output)await writeFile(resolve(args.output),serialized,'utf8');else process.stdout.write(serialized)
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href
if(isMain)main().catch(error=>{process.stderr.write(`val-golden-performance-local: ${error.message}\n`);process.exitCode=1})
