import assert from 'node:assert/strict'
import test from 'node:test'
import {installConversionComposition} from '../server/conversion-bootstrap.js'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {scopeValContextForModel,validatePreloadedValContext,ValEngine} from '../server/val-engine.js'

const tenantA='tenant-a'
const ownerA='owner-a'
const ownerB='owner-b'
const producerA='producer-matheus'
const conversationA='conversation-a'
const contextEpoch=7
const now=new Date('2026-08-30T12:00:00.000Z')
const profileQuestion='qual o perfil dele?'

const emptyContext=()=>({
 client:{id:producerA,name:'Matheus Nascimento Jaeger',producer_id:producerA,tenant_id:tenantA,context_owner_id:ownerA},
 profile:{answers:{},evidence:[]},
 signals:[],
 learning:{},
 memories:[],
 memoryHistory:[],
 businessHistory:[],
 visits:[],
 interactions:[],
 commitments:[],
 opportunities:[],
 properties:[],
 fieldReports:[],
 soilAnalyses:[],
 ndviObservations:[],
 manualRecords:[],
 attachments:[],
 currentAttachments:[],
 priorRecommendations:[]
})

function memory(id,statement,overrides={}){
 return {
  id,
  tenant_id:tenantA,
  client_id:producerA,
  owner_id:ownerA,
  subject_type:'client',
  subject_id:producerA,
  memory_type:'behavioral',
  memory_state:'INFERENCE',
  memory_domain:'BEHAVIORAL',
  key:`profile.behavioral_signal.${id}`,
  value:{statement},
  status:'verified',
  source:'visit_report',
  source_ref:`visit_report:${id}`,
  source_type:'visit_report',
  confidence:85,
  valid_from:'2026-08-01T12:00:00.000Z',
  created_at:'2026-08-01T12:00:00.000Z',
  updated_at:'2026-08-01T12:00:00.000Z',
  acl:{scope:'own_portfolio'},
  ...overrides
 }
}

function snapshot(context,{message=profileQuestion,objective='profile_query',requestId='boundary-snapshot',conversationId=conversationA,epoch=contextEpoch}={}){
 return buildContextSnapshot(context,{
  organizationId:tenantA,
  subjectType:'client',
  subjectId:producerA,
  actorId:ownerA,
  role:'consultant',
  scope:'own_portfolio',
  objective,
  message,
  requestId,
  conversationId,
  contextEpoch:epoch,
  now
 })
}

const profileEvidence=overrides=>({
 id:'profile-evidence-a',
 producer_id:producerA,
 tenant_id:tenantA,
 owner_id:ownerA,
 assessed_at:'2026-08-01T12:00:00.000Z',
 valid_until:'2027-08-01T12:00:00.000Z',
 source_type:'producer_questionnaire',
 ...overrides
})

function currentProfileContext(overrides={}){
 const evidence=profileEvidence()
 return {
  ...emptyContext(),
  client:{
   id:producerA,
   name:'Matheus Nascimento Jaeger',
   producer_id:producerA,
   tenant_id:tenantA,
   context_owner_id:ownerA,
   primaryProfile:'Analítico',
   profileEvidence:[evidence],
   ...overrides
  },
  profile:{
   sourceId:evidence.id,
   evidence:[evidence],
   assessedAt:'2026-08-01T12:00:00.000Z',
   validUntil:'2027-08-01T12:00:00.000Z'
  }
 }
}

function poisonedMissingInformation(){
 const statement='POISON_GRAINS: falta validar o comportamento antes do travamento do contrato de grãos.'
 return memory('missing-information-grains',statement,{
  key:'visit_report.missing_information',
  value:{code:'profile_evidence_gap',statement}
 })
}

function assertFastProfileNoData(profileAssessedAt){
 const evidence=profileEvidence({assessed_at:undefined})
 const facts={
  client:{
   id:producerA,
   name:'Matheus Nascimento Jaeger',
   producer_id:producerA,
   tenant_id:tenantA,
   context_owner_id:ownerA,
   primaryProfile:'Analítico',
   decisionDriver:'Compara alternativas com dados antes de decidir',
   technicalPresentation:'Prefere indicadores objetivos e comparáveis'
  },
  profileEvidence:[evidence],
  profileSourceRef:evidence.id,
  profileValidUntil:'2027-08-01T12:00:00.000Z',
  ...(profileAssessedAt===undefined?{}:{profileAssessedAt})
 }
 const result=buildFastClientResponse({
  facts,
  message:profileQuestion,
  organizationId:tenantA,
  ownerId:ownerA,
  conversationId:conversationA,
  contextEpoch,
  now
 })
 assert.equal(result.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.equal(result.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
 assert.deepEqual(result.advice.ai_reasoning.facts_used,[])
}

function preloadedFixture(){
 const context=emptyContext()
 context.contextSnapshot=snapshot(context,{requestId:'preloaded-boundary'})
 context.conversationState={
  conversation_id:conversationA,
  context_epoch:contextEpoch,
  current_client:{id:producerA,name:'Matheus Nascimento Jaeger'}
 }
 return {
  scope:{
   tenantId:tenantA,
   ownerId:ownerA,
   clientId:producerA,
   conversationId:conversationA,
   contextEpoch,
   contextDomain:'PROFILE'
  },
  context
 }
}

function validatePreloaded(envelope,message=profileQuestion){
 return validatePreloadedValContext(envelope,{
  tenantId:tenantA,
  ownerId:ownerA,
  clientId:producerA,
  conversationId:conversationA,
  contextEpoch,
  contextDomain:'PROFILE',
  message
 })
}

test('raw memory de owner-b não pode ser publicada com owner-a',()=>{
 const foreignOwner=memory('foreign-owner','Pediu comparativos e dados antes de decidir.',{owner_id:ownerB})
 const result=snapshot({...emptyContext(),memoryHistory:[foreignOwner]},{requestId:'owner-boundary'})
 assert.equal(result.selection.selected_refs.includes(foreignOwner.id),false)
 assert.equal(result.selection.unauthorized_count,1)
 assert.ok(result.selection.context_trace.rejected.some(item=>item.reasonSelected==='OWNER_MISMATCH'&&item.ownerId===ownerB))
 assert.doesNotMatch(JSON.stringify(result),/Pediu comparativos e dados antes de decidir/i)
})

test('servicePreference contaminada por CPF não entra no contexto PROFILE',()=>{
 const result=snapshot(currentProfileContext({servicePreference:'POISON_CPF: CPF financeira pendente.'}),{requestId:'service-preference-poison'})
 assert.equal(result.behavioral_signals.some(item=>item.key==='service_preference'),false)
 assert.doesNotMatch(JSON.stringify(result),/POISON_CPF|CPF financeira/i)
})

test('visit_report.missing_information com grãos não entra no contexto PROFILE',()=>{
 const poison=poisonedMissingInformation()
 const result=snapshot({...emptyContext(),memoryHistory:[poison]},{requestId:'missing-information-poison'})
 assert.equal(result.selection.selected_refs.includes(poison.id),false)
 assert.equal(result.missing_information.some(item=>/grãos|graos|POISON_GRAINS/i.test(String(item.description||''))),false)
 assert.doesNotMatch(JSON.stringify(result),/POISON_GRAINS|contrato de grãos/i)
})

for(const [label,assessedAt] of [
 ['ausente',undefined],
 ['de 2010','2010-08-01T12:00:00.000Z'],
 ['futuro','2026-09-01T12:00:00.000Z'],
 ['inválido','data-inválida']
]){
 test(`FAST profile falha fechado quando assessedAt é ${label}`,()=>{
  assertFastProfileNoData(assessedAt)
 })
}

test('PROFILE expõe no máximo quatro memórias comportamentais suficientes',()=>{
 const memories=Array.from({length:7},(_,index)=>memory(`behavior-${index+1}`,`Pediu comparativo de dados ${index+1} antes de decidir.`))
 const result=snapshot({...emptyContext(),memoryHistory:memories},{requestId:'profile-minimum-context'})
 const exposed=[...result.facts,...result.inferences,...result.hypotheses,...result.validated_knowledge]
 assert.ok(result.selection.selected_refs.length>=2)
 assert.ok(result.selection.selected_refs.length<=4,`PROFILE selecionou ${result.selection.selected_refs.length} memórias`)
 assert.ok(exposed.length>=2)
 assert.ok(exposed.length<=4,`PROFILE expôs ${exposed.length} itens de memória`)
 assert.equal(result.selection.exclusion_reason_codes.filter(item=>item.reason_codes.includes('LOWER_RELEVANCE')).length,3)
})

test('VISIT ordena por data antes do limite e preserva a visita mais recente',()=>{
 const visits=Array.from({length:11},(_,index)=>({
  id:`visit-${index+1}`,
  clientId:producerA,
  tenantId:tenantA,
  ownerId:ownerA,
  summary:'Visita concluída.',
  occurredAt:`2026-08-${String(index+1).padStart(2,'0')}T12:00:00.000Z`
 }))
 const result=snapshot({...emptyContext(),visits},{
  message:'qual foi a última visita?',
  objective:'visit_query',
  requestId:'visit-ordering'
 })
 const selected=result.relationship_context.visits.map(item=>item.data.id)
 assert.equal(selected[0],'visit-11')
 assert.equal(selected.includes('visit-11'),true)
 assert.equal(selected.includes('visit-1'),false)
 assert.ok(result.selection.context_trace.rejected.some(item=>item.reasonSelected==='LOWER_RELEVANCE'))
})

test('scopeValContextForModel remove anexos e recomendações anteriores em PROFILE',()=>{
 const context=emptyContext()
 context.contextSnapshot=snapshot(context,{requestId:'scope-profile-history'})
 context.currentAttachments=[{id:'attachment-poison',analysis:{summary:'POISON_ATTACHMENT_FERTILIZER'}}]
 context.priorRecommendations=[{
  id:'prior-poison',
  conversation_id:conversationA,
  context_epoch:contextEpoch,
  producer_id:producerA,
  tenant_id:tenantA,
  owner_id:ownerA,
  answer:'POISON_PRIOR_CPF'
 }]
 context.conversationThread={carriedPriorTurn:true}
 const scoped=scopeValContextForModel(context)
 assert.deepEqual(scoped.currentAttachments,[])
 assert.deepEqual(scoped.priorRecommendations,[])
 assert.doesNotMatch(JSON.stringify(scoped),/POISON_ATTACHMENT_FERTILIZER|POISON_PRIOR_CPF/)
})

test('scopeValContextForModel não propaga snapshot PROFILE internamente contaminado',()=>{
 const poison=poisonedMissingInformation()
 const context={...emptyContext(),memoryHistory:[poison]}
 context.contextSnapshot=snapshot(context,{requestId:'scope-snapshot-poison'})
 let scoped
 try{
  scoped=scopeValContextForModel(context)
 }catch(error){
  assert.match(String(error?.code||error?.message),/(?:context_snapshot|context_scope|domain)/i)
  return
 }
 assert.doesNotMatch(JSON.stringify(scoped),/POISON_GRAINS|contrato de grãos/i)
})

test('snapshot PROFILE pré-existente ou forjado com fato cross-domain falha fechado',()=>{
 const context=emptyContext()
 context.contextSnapshot=snapshot(context,{requestId:'forged-profile-snapshot'})
 context.contextSnapshot.inferences.push({
  key:'profile.behavioral_signal.forged',
  value:{statement:'Pediu comparativos antes do POISON_FORGED_GRAINS: travamento do contrato de grãos.'},
  memory_domain:'BEHAVIORAL',epistemic_type:'INFERENCE',evidence_type:'OBSERVATION',
  tenant_id:tenantA,producer_id:producerA,owner_id:ownerA,
  memory_ref:'forged-memory',source_ref:'visit_report:forged',source_type:'visit_report',confidence:80,
  valid_from:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',
  observed_at:'2026-08-01T12:00:00.000Z',source_updated_at:'2026-08-01T12:00:00.000Z',
  freshness:'CURRENT',freshness_metadata:{}
 })
 assert.throws(
  ()=>scopeValContextForModel(context),
  error=>error?.code==='context_snapshot_invalid'&&error?.violations?.includes('domain_scope')
 )
})

for(const [label,mutate,message] of [
 ['owner',envelope=>{envelope.context.contextSnapshot.context_scope.owner_id=ownerB},profileQuestion],
 ['conversation',envelope=>{envelope.context.contextSnapshot.context_scope.conversation_id='conversation-b'},profileQuestion],
 ['epoch',envelope=>{envelope.context.contextSnapshot.context_scope.context_epoch=contextEpoch+1},profileQuestion],
 ['query',()=>{},'qual foi a última visita?']
]){
 test(`validatePreloadedValContext rejeita divergência de ${label}`,()=>{
  const envelope=preloadedFixture()
  mutate(envelope)
  assert.throws(
   ()=>validatePreloaded(envelope,message),
   error=>error?.statusCode===403&&error?.code==='val_preloaded_context_scope_mismatch'
  )
 })
}

test('conversion-bootstrap envia prompt PROFILE sem os três poisons',async()=>{
 const message='Cruze as evidências comportamentais e explique por que o perfil dele é analítico, quais hipóteses alternativas existem e como adaptar a abordagem.'
 const context=currentProfileContext({servicePreference:'POISON_CPF: CPF financeira pendente.'})
 const poison=poisonedMissingInformation()
 context.memoryHistory=[poison]
 context.memories=[poison]
 context.currentAttachments=[{id:'attachment-poison',analysis:{summary:'POISON_FERTILIZER: repassar alguns fertilizantes.'}}]
 context.priorRecommendations=[{
  id:'prior-poison',conversation_id:conversationA,context_epoch:contextEpoch,
  producer_id:producerA,tenant_id:tenantA,owner_id:ownerA,
  answer:'POISON_CPF: CPF financeira pendente.'
 }]
 context.contextSnapshot=snapshot(context,{message,requestId:'conversion-prompt-probe'})
 assert.match(JSON.stringify(context),/POISON_CPF/)
 assert.match(JSON.stringify(context),/POISON_GRAINS/)
 assert.match(JSON.stringify(context),/POISON_FERTILIZER/)

 installConversionComposition()
 let capturedRequest=null
 const repository={
  getClientContext:async()=>structuredClone(context),
  listAttachments:async()=>[],
  recordRecommendation:async()=> 'recommendation-probe'
 }
 const runtimeConfig={
  openaiApiKey:'test-key',openaiProject:'',openaiTimeoutMs:1_000,conversationalModelTimeoutMs:1_000,
  openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',
  knowledgeVectorStoreId:'',maxContextChars:30_000,maxOutputTokens:1_000,
  strategicMaxOutputTokens:1_000,openaiStoreResponses:false
 }
 const engine=new ValEngine({runtimeConfig,repository,logger:()=>{},clock:()=>now})
 engine.client={responses:{create:async request=>{
  capturedRequest=request
  throw Object.assign(new Error('Fim intencional do probe após capturar o prompt.'),{code:'prompt_probe_complete'})
 }}}
 try{
  await engine.answer({
   tenantId:tenantA,
   ownerId:ownerA,
   clientId:producerA,
   client:context.client,
   message,
   contextRequest:{conversationId:conversationA,contextEpoch}
  })
 }catch{}

 assert.ok(capturedRequest,'o fluxo conversion-bootstrap não chegou à chamada estruturada do modelo')
 const serializedPrompt=JSON.stringify(capturedRequest)
 const leaked=['POISON_CPF','POISON_GRAINS','POISON_FERTILIZER'].filter(marker=>serializedPrompt.includes(marker))
 assert.deepEqual(leaked,[],'o prompt do modelo recebeu conteúdo cross-domain/stale')
})
