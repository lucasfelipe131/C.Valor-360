import assert from 'node:assert/strict'
import test from 'node:test'
import {buildFastClientResponse,classifyStructuredClientFact,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {assertActiveProducerBoundary,classifyValContextDomain} from '../server/decision-copilot/context-selector.js'
import {createConversationState,switchConversationClient} from '../server/decision-copilot/conversation-state.js'
import {evaluateReasoningGrounding,evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
import {prepareConversationThread} from '../server/conversation-thread-context.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {scopeValContextForModel} from '../server/val-engine.js'
import {localNaturalCommandTurn,resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const actorId='00000000-0000-4000-8000-000000000010'
const producerA='producer-matheus'
const producerB='producer-joao'
const now=new Date('2026-08-30T12:00:00.000Z')
const profileEvidence=[
 {id:'profile-answer-7',profile_source_ref:'producer_360:profile-a',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decisionDriver',statement:'Compara custo por hectare e retorno',producer_id:producerA,tenant_id:tenantId,context_owner_id:actorId,assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'},
 {id:'profile-answer-8',profile_source_ref:'producer_360:profile-a',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'technicalPresentation',statement:'Prefere dados comparáveis',producer_id:producerA,tenant_id:tenantId,context_owner_id:actorId,assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'},
 {id:'profile-answer-14',profile_source_ref:'producer_360:profile-a',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'trustDriver',statement:'Valoriza referência verificável',producer_id:producerA,tenant_id:tenantId,context_owner_id:actorId,assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z'}
]
const scopedCollection=item=>({...item,producer_id:producerA,tenant_id:tenantId,context_owner_id:actorId})

const memory=(id,overrides={})=>({
 id,tenant_id:tenantId,client_id:producerA,context_owner_id:actorId,subject_type:'client',subject_id:producerA,
 memory_type:'inference',memory_state:'INFERENCE',memory_domain:'BEHAVIORAL',key:'profile.decision_driver',
 value:{statement:'Pede comparativos e custo por hectare antes de decidir.'},status:'verified',source:'producer_360',
 source_ref:`producer_360:${id}`,source_type:'producer_360',confidence:85,valid_from:'2026-08-01T12:00:00.000Z',
 created_at:'2026-08-01T12:00:00.000Z',updated_at:'2026-08-01T12:00:00.000Z',acl:{scope:'own_portfolio'},...overrides
})

const context=()=>({
 client:scopedCollection({id:producerA,name:'Matheus Nascimento Jaeger',primaryProfile:'Analítico',decisionDriver:'Compara custo por hectare e retorno',technicalPresentation:'Prefere dados comparáveis',profileEvidence,profileSource:'producer_360:profile-a'}),
 profile:{sourceId:'producer_360:profile-a',evidence:profileEvidence,assessedAt:'2026-08-01T12:00:00.000Z',validUntil:'2027-08-01T12:00:00.000Z'},
 memoryHistory:[
  memory('behavior-a'),
  memory('grain-a',{memory_type:'fact',memory_state:'FACT',memory_domain:'COMMERCIAL',key:'grain.contract',value:{statement:'Travamento de contrato de grãos.'},source_ref:'visit:grain-a'}),
  memory('credit-a',{memory_type:'fact',memory_state:'FACT',memory_domain:'COMMERCIAL',key:'credit.cpf',value:{statement:'CPF financeira pendente.'},source_ref:'visit:credit-a'}),
  memory('fertilizer-a',{memory_type:'fact',memory_state:'FACT',memory_domain:'AGRONOMIC',key:'fertilizer.resale',value:{statement:'Repassar alguns fertilizantes.'},source_ref:'visit:fertilizer-a'})
 ],
 businessHistory:[scopedCollection({id:'business-grain',clientId:producerA,summary:'Travamento de contrato de grãos.'})],
 visits:[scopedCollection({id:'visit-fertilizer',clientId:producerA,summary:'Repassar alguns fertilizantes.'})],
 interactions:[scopedCollection({id:'interaction-credit',clientId:producerA,summary:'CPF financeira pendente.'})],
 commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[]
})

const snapshot=input=>buildContextSnapshot(context(),{
 organizationId:tenantId,subjectType:'client',subjectId:producerA,actorId,role:'consultant',scope:'own_portfolio',
 objective:'profile_query',message:'qual o perfil dele?',requestId:'00000000-0000-4000-8000-000000000901',now,...input
})

const selectedFor=message=>snapshot({objective:'golden_context_query',message,requestId:`00000000-0000-4000-8000-${String(Math.abs([...message].reduce((sum,char)=>sum+char.charCodeAt(0),0))).padStart(12,'0').slice(-12)}`})

test('CTX-001 Perfil usa contexto mínimo comportamental e rejeita domínios estranhos',()=>{
 const result=snapshot()
 assert.equal(result.context_scope.domain,'PROFILE')
 assert.equal(result.context_scope.minimum_sufficient_context,true)
 assert.deepEqual(result.commercial_context.business_history,[])
 assert.deepEqual(result.agronomic_context.properties,[])
 assert.deepEqual(result.relationship_context.visits,[])
 assert.deepEqual(result.selection.selected_refs,['behavior-a'])
 for(const ref of ['grain-a','credit-a','fertilizer-a'])assert.ok(result.selection.exclusion_reason_codes.find(item=>item.ref===ref)?.reason_codes.includes('DOMAIN_MISMATCH'),ref)
 assert.ok(result.selection.context_trace.selected.every(item=>item.producerId===producerA&&item.tenantId===tenantId))
})

test('CTX-002 Última visita mantém domínio VISIT',()=>{
 assert.equal(classifyValContextDomain('Qual foi a última visita dele?'),'VISIT')
 const result=buildContextSnapshot({...context(),visits:[
  scopedCollection({id:'visit-old',clientId:producerA,status:'Concluída',occurred_at:'2026-08-10T12:00:00.000Z',summary:'Visita antiga.'}),
  scopedCollection({id:'visit-latest',clientId:producerA,status:'Concluída',occurred_at:'2026-08-29T12:00:00.000Z',summary:'Visita mais recente.'})
 ]},{organizationId:tenantId,subjectType:'client',subjectId:producerA,actorId,role:'consultant',scope:'own_portfolio',objective:'golden_context_query',message:'Qual foi a última visita dele?',requestId:'00000000-0000-4000-8000-000000000902',now})
 assert.equal(result.context_scope.domain,'VISIT')
 assert.deepEqual(result.selection.selected_refs,[])
 assert.deepEqual(result.relationship_context.visits.map(item=>item.data.id),['visit-latest'])
 assert.equal(result.relationship_context.visits[0].observed_at,'2026-08-29T12:00:00.000Z')
 assert.ok(result.selection.context_trace.rejected.some(item=>item.sourceId==='visit:visit-old'&&item.reasonSelected==='LOWER_RELEVANCE'))
 assert.deepEqual(result.commercial_context.business_history,[])
})

test('CTX-003 Objeção permanece comercial e não vira perfil',()=>{
 assert.equal(classifyValContextDomain('Qual foi a objeção comercial mais recente?'),'COMMERCIAL')
 const objection=scopedCollection({id:'interaction-objection',clientId:producerA,summary:'Objeção comercial: pediu comprovação do retorno antes de aceitar o preço.',occurred_at:'2026-08-28T12:00:00.000Z'})
 const result=buildContextSnapshot({...context(),interactions:[objection,...context().interactions]},{organizationId:tenantId,subjectType:'client',subjectId:producerA,actorId,role:'consultant',scope:'own_portfolio',objective:'golden_context_query',message:'Qual foi a objeção comercial mais recente?',requestId:'00000000-0000-4000-8000-000000000903',now})
 assert.equal(result.context_scope.domain,'COMMERCIAL')
 assert.deepEqual(result.selection.selected_refs,[])
 assert.deepEqual(result.commercial_context.business_history,[])
 assert.deepEqual(result.relationship_context.interactions.map(item=>item.data.id),['interaction-objection'])
 assert.match(result.relationship_context.interactions[0].data.summary,/comprovação do retorno/i)
 assert.ok(result.selection.context_trace.selected.some(item=>item.sourceId==='interaction:interaction-objection'))
 assert.ok(result.selection.context_trace.rejected.some(item=>item.sourceId==='interaction:interaction-credit'&&item.reasonSelected==='DOMAIN_MISMATCH'))
})

test('CTX-004 Agronomia seleciona somente domínio agronômico',()=>{
 assert.equal(classifyValContextDomain('Qual é o diagnóstico agronômico do solo?'),'AGRONOMY')
 const result=selectedFor('Qual é o diagnóstico agronômico e o fertilizante registrado?')
 assert.deepEqual(result.selection.selected_refs,['fertilizer-a'])
 assert.deepEqual(result.commercial_context.business_history,[])
 assert.deepEqual(result.relationship_context.visits,[])
})

test('CTX-005 Grãos possui escopo explícito',()=>{
 assert.equal(classifyValContextDomain('Como está o contrato de grãos?'),'GRAINS')
 const result=selectedFor('Como está o contrato de grãos?')
 assert.deepEqual(result.selection.selected_refs,['grain-a'])
 assert.deepEqual(result.commercial_context.business_history.map(item=>item.data.id),['business-grain'])
 assert.deepEqual(result.relationship_context.interactions,[])
})

test('CTX-006 Crédito possui escopo explícito',()=>{
 assert.equal(classifyValContextDomain('Qual é o status do crédito?'),'CREDIT')
 const result=selectedFor('Qual é o status do crédito e do CPF financeiro?')
 assert.deepEqual(result.selection.selected_refs,['credit-a'])
 assert.deepEqual(result.relationship_context.interactions.map(item=>item.data.id),['interaction-credit'])
 assert.deepEqual(result.commercial_context.business_history,[])
})

test('CTX-007 Troca de produtor incrementa epoch e elimina estado produtor-específico',()=>{
 const initial=createConversationState({conversationId:'thread-a',clientId:producerA,client:{id:producerA,name:'Matheus'}})
 const contaminated={...initial,current_crop:'Milho',session_facts:[{statement:'Fato de Matheus',epistemic_status:'SESSION_FACT',persistence:'SESSION_ONLY',source_ref:'visit-a'}],conversation_turns:[{role:'assistant',text:'Resposta de Matheus'}]}
 const switched=switchConversationClient(contaminated,{id:producerB,name:'João'},{conversationId:'thread-a'})
 assert.equal(switched.context_epoch,1)
 assert.equal(switched.current_client.id,producerB)
 assert.equal(switched.current_crop,null)
 assert.deepEqual(switched.session_facts,[])
 assert.deepEqual(switched.conversation_turns,[])
})

test('CTX-008 Follow-up reutiliza somente resposta concluída da mesma conversa, produtor e epoch',()=>{
 const payload={responseScope:{contractVersion:'val.response_scope.v1',tenantId,ownerId:actorId,producerId:producerA,conversationId:'thread-a',contextEpoch:4,domain:'PROFILE'},advice:{ai_reasoning:{organization:{id:tenantId},client:{id:producerA},conversation_id:'thread-a',premises:{context_scope:{tenant_id:tenantId,owner_id:actorId,producer_id:producerA,conversation_id:'thread-a',context_epoch:4,domain:'PROFILE',minimum_sufficient_context:true}},recommended_strategy:{reading:'Matheus tem perfil analítico. Evidência suficiente.'}}}}
 const source={role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',responseId:'response-profile-a',conversationId:'thread-a',producerId:producerA,contextEpoch:4,payload}
 const turn=localNaturalCommandTurn(resolveValNaturalCommand('Resume.'),source,{tenantId,ownerId:actorId,conversationId:'thread-a',producerId:producerA,contextEpoch:4,domain:'PROFILE'})
 assert.equal(turn.mode,'FAST')
 assert.equal(turn.status,'completed')
 assert.equal(turn.intent,'FOLLOW_UP_RESUME')
 assert.equal(turn.conversationId,'thread-a')
 assert.equal(turn.producerId,producerA)
 assert.equal(turn.contextEpoch,4)
 assert.equal(turn.sourceResponseId,'response-profile-a')
 assert.equal(turn.role,'assistant_text')
})

test('CTX-009 Ambiguidade não força evidência de domínio anterior',()=>{
 assert.equal(classifyValContextDomain('O que está faltando?'),'GENERAL')
 const prepared=prepareConversationThread({priorRecommendations:[{id:'old',user_question:'Preciso rever um contrato de grãos.'}]},'Qual perfil você consegue comprovar?')
 assert.equal(prepared.carriedPriorTurn,false)
 assert.doesNotMatch(prepared.message,/contrato de grãos/i)
})

test('CTX-010 Sem dado de perfil falha fechado sem inventar classificação',()=>{
 const result=buildFastClientResponse({facts:{client:scopedCollection({id:producerA,name:'Matheus Nascimento Jaeger'})},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.equal(result.responseMetadata.dataPath,'BEHAVIORAL_PROFILE')
 assert.equal(result.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
 assert.deepEqual(result.advice.ai_reasoning.facts_used,[])
 assert.match(result.advice.answer,/não há evidência comportamental|nao ha evidencia comportamental/i)
})

test('CTX-011 Cross-producer poison é bloqueado antes do modelo',()=>{
 assert.throws(()=>assertActiveProducerBoundary([{id:'visit-b',clientId:producerB}],producerA),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.actualProducerId===producerB)
})

test('CTX-012 Cross-domain poison e resposta não fundamentada são rejeitados',()=>{
 assert.equal(classifyStructuredClientFact('qual o perfil dele?'),'BEHAVIORAL_PROFILE')
 const route=routeSystemCapability({message:'qual o perfil dele?',hasClient:true})
 assert.equal(route.path,'FAST')
 assert.equal(route.data_path,'BEHAVIORAL_PROFILE')
 const response=buildFastClientResponse({facts:{client:{...context().client},profileEvidence,profileSourceRef:'producer_360:profile-a',profileAssessedAt:'2026-08-01T12:00:00.000Z'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.match(response.advice.answer,/Perfil principal: Analítico/i)
 assert.doesNotMatch(response.advice.answer,/fertilizante|CPF|crédito|contrato de grãos/i)
 assert.ok(response.advice.ai_reasoning.facts_used.every(item=>item.producer_id===producerA&&item.tenant_id===tenantId))
 assert.equal(response.advice.ai_reasoning.grounding.passed,true)
 const poisoned=evaluateResponseGrounding({question:'qual o perfil dele?',domain:'PROFILE',answer:'Perfil principal: Analítico. Confiança: alta. Como abordar: com dados. O contrato de grãos está travado.',evidence:[]})
 assert.equal(poisoned.passed,false)
 assert.ok(poisoned.unsupported_terms.includes('NO_COMPATIBLE_EVIDENCE'))
 assert.ok(poisoned.claim_ledger.some(item=>item.supported===false))
})

test('stale turn de grãos não contamina pergunta de perfil com pronome',()=>{
 const state=createConversationState({conversationId:'thread-profile',clientId:producerA,client:{id:producerA,name:'Matheus Nascimento Jaeger'}})
 const prepared=prepareConversationThread({conversationState:state,priorRecommendations:[{id:'grain-turn',user_question:'Preciso rever um contrato de grãos e repassar fertilizantes.'}]},'qual o perfil dele?')
 assert.equal(prepared.referenceKind,'ENTITY_ONLY')
 assert.equal(prepared.carriedPriorTurn,false)
 assert.doesNotMatch(prepared.message,/contrato de grãos|fertilizantes/i)
 assert.match(prepared.message,/produtor Matheus Nascimento Jaeger/i)
})

test('MULTI_DOMAIN só combina os domínios explicitamente pedidos',()=>{
 const result=selectedFor('Qual é o perfil dele e como está o contrato de grãos?')
 assert.equal(result.context_scope.domain,'MULTI_DOMAIN')
 assert.deepEqual(new Set(result.selection.selected_refs),new Set(['behavior-a','grain-a']))
 assert.equal(result.selection.selected_refs.includes('credit-a'),false)
 assert.equal(result.selection.selected_refs.includes('fertilizer-a'),false)
})

test('hard boundary falha fechado para proveniência ausente, tenant, owner e produtor divergentes',()=>{
 assert.throws(()=>assertActiveProducerBoundary([{id:'missing-scope'}],{producerId:producerA,tenantId,ownerId:actorId,requireOwner:true}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='MISSING_PRODUCER_SCOPE')
 assert.throws(()=>assertActiveProducerBoundary([{producerId:producerA,tenantId:'tenant-foreign',ownerId:actorId}],{producerId:producerA,tenantId,ownerId:actorId,requireOwner:true}),error=>error.reason==='TENANT_MISMATCH')
 assert.throws(()=>assertActiveProducerBoundary([{producerId:producerA,tenantId,ownerId:'owner-foreign'}],{producerId:producerA,tenantId,ownerId:actorId,requireOwner:true}),error=>error.reason==='OWNER_MISMATCH')
 assert.equal(assertActiveProducerBoundary([{scope:'MARKET',tenantId,ownerId:actorId,sourceId:'market:public'}],{producerId:producerA,tenantId,ownerId:actorId,requireOwner:true}),true)
})

test('históricos trocados entre produtores são descartados nos dois sentidos',()=>{
 const build=(active,poison)=>buildContextSnapshot({client:{id:active,name:`Produtor ${active}`},memoryHistory:[poison],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[]},{organizationId:tenantId,subjectType:'client',subjectId:active,actorId,role:'consultant',scope:'own_portfolio',objective:'profile_query',message:'qual o perfil dele?',requestId:active===producerA?'00000000-0000-4000-8000-000000000911':'00000000-0000-4000-8000-000000000912',now})
 const poisonB=memory('poison-b',{client_id:producerB,subject_id:producerB,value:{statement:'POISON_B contrato de grãos'}})
 const poisonA=memory('poison-a',{client_id:producerA,subject_id:producerA,value:{statement:'POISON_A fertilizante'}})
 const forA=build(producerA,poisonB)
 const forB=build(producerB,poisonA)
 assert.equal(forA.selection.unauthorized_count,1)
 assert.equal(forB.selection.unauthorized_count,1)
 assert.doesNotMatch(JSON.stringify(forA),/POISON_B/)
 assert.doesNotMatch(JSON.stringify(forB),/POISON_A/)
})

test('perfil exige duas evidências comportamentais e rejeita campos derivados envenenados',()=>{
 const base=scopedCollection({id:producerA,name:'Matheus Nascimento Jaeger',primaryProfile:'Analítico',profileEvidence})
 const one=buildFastClientResponse({facts:{client:{...base,decisionDriver:'Compara alternativas com dados'},profileEvidence,profileSourceRef:'producer_360:profile-a'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.equal(one.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 const poisoned=buildFastClientResponse({facts:{client:{...base,decisionDriver:'Travamento de contrato de grãos',technicalPresentation:'CPF financeira',planningStyle:'Repassar fertilizantes'},profileEvidence,profileSourceRef:'producer_360:profile-a'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.equal(poisoned.advice.ai_reasoning.run.capability_results[0].status,'NO_DATA')
 assert.doesNotMatch(poisoned.advice.answer,/contrato|grãos|CPF|fertilizante/i)
 const mixed=buildFastClientResponse({facts:{client:{...base,decisionDriver:'Compara custo por hectare e retorno',technicalPresentation:'Prefere dados comparáveis',planningStyle:'Travamento de contrato de grãos'},profileEvidence,profileSourceRef:'producer_360:profile-a'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.equal(mixed.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.doesNotMatch(mixed.advice.answer,/contrato|grãos|CPF|fertilizante/i)
 const mixedObservations=mixed.advice.ai_reasoning.facts_used.filter(item=>item.epistemic_type==='OBSERVATION')
 assert.deepEqual(mixedObservations.map(item=>item.id),['profile-answer-7','profile-answer-8'])
 assert.ok(mixedObservations.every(item=>item.source_ref==='producer_360:profile-a'))
 assert.ok(mixedObservations.every(item=>!item.statement.includes('Travamento de contrato de grãos')))
 const mixedBehaviorPoison=buildFastClientResponse({facts:{client:{...base,decisionDriver:'Pediu comparativos antes do travamento de contrato de grãos',technicalPresentation:'Prefere dados comparáveis',trustDriver:'Valoriza referência verificável'},profileEvidence,profileSourceRef:'producer_360:profile-a'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.equal(mixedBehaviorPoison.advice.ai_reasoning.run.capability_results[0].status,'EXECUTED')
 assert.doesNotMatch(mixedBehaviorPoison.advice.answer,/contrato|grãos|travamento/i)
 assert.deepEqual(mixedBehaviorPoison.advice.ai_reasoning.facts_used.filter(item=>item.epistemic_type==='OBSERVATION').map(item=>item.id),['profile-answer-8','profile-answer-14'])
})

test('perfil vencido e perfil sem fonte auditável falham fechado',()=>{
 const client=scopedCollection({id:producerA,name:'Matheus',primaryProfile:'Analítico',decisionDriver:'Compara alternativas',technicalPresentation:'Prefere dados',profileEvidence})
 const expired=buildFastClientResponse({facts:{client,profileEvidence,profileSourceRef:'producer_360:profile-a',profileValidUntil:'2026-08-29T23:59:59.000Z'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 const missingSource=buildFastClientResponse({facts:{client:{...client,profileEvidence:[]},profileEvidence:[]},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',now})
 assert.equal(expired.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
 assert.equal(missingSource.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
})

test('grounding bloqueia alegação específica, número inventado e evidência de outro escopo',()=>{
 const visitEvidence={id:'visit-a',source_type:'visit',producer_id:producerA,tenant_id:tenantId,epistemic_type:'FACT',observed_at:'2026-08-20T12:00:00.000Z',statement:'Visita concluída em 20/08/2026.'}
 const unsupported=evaluateResponseGrounding({question:'Qual foi a última visita?',domain:'VISIT',answer:'A visita ocorreu em Passo Fundo e a proposta vence amanhã.',evidence:[],activeProducerId:producerA,tenantId})
 const numeric=evaluateResponseGrounding({question:'Qual foi a última visita?',domain:'VISIT',answer:'A visita fechou R$ 500.000 em 20/08/2026.',evidence:[visitEvidence],activeProducerId:producerA,tenantId})
 const foreign=evaluateResponseGrounding({question:'Qual foi a última visita?',domain:'VISIT',answer:'Visita concluída em 20/08/2026.',evidence:[{...visitEvidence,producer_id:producerB}],activeProducerId:producerA,tenantId})
 assert.equal(unsupported.passed,false)
 assert.ok(numeric.unsupported_terms.includes('UNSUPPORTED_NUMERIC_CLAIM'))
 assert.equal(foreign.passed,false)
 assert.deepEqual(foreign.scope_violations,['visit-a'])
})

test('grounding cobre todos os blocos públicos e bloqueia contaminação na voz',()=>{
 const evidence=[{id:'profile-a',source_type:'behavioral_profile',producer_id:producerA,tenant_id:tenantId,epistemic_type:'INFERENCE',observed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',statement:'Perfil Analítico; compara alternativas com dados.'}]
 const result=evaluateReasoningGrounding({question:'qual o perfil dele?',domain:'PROFILE',evidence,activeProducerId:producerA,tenantId,blocks:{'recommended_strategy.reading':'Perfil principal: Analítico. Confiança: média. Como abordar: use dados. O que ainda não sabemos: se a preferência continua atual.','voice_output.speakable_text':'Perfil principal: Analítico. Confiança: média. O contrato de grãos está travado.'}})
 assert.equal(result.passed,false)
 assert.ok(result.claim_ledger.some(item=>item.field==='voice_output.speakable_text'&&!item.supported))
})

test('contexto enviado ao modelo elimina coleções e turnos não selecionados em PROFILE',()=>{
 const prepared=prepareConversationThread({conversationState:createConversationState({conversationId:'thread-a',clientId:producerA,client:{id:producerA,name:'Matheus'}}),priorRecommendations:[{id:'old-grain',user_question:'Contrato de grãos travado.'}]},'qual o perfil dele?')
 const snap=snapshot()
 const scoped=scopeValContextForModel({...context(),contextSnapshot:snap,priorRecommendations:prepared.priorRecommendations,manualRecords:[{id:'manual-poison',text:'POISON_MANUAL'}],attachments:[{id:'old-file',analysis:{summary:'POISON_ATTACHMENT'}}]})
 assert.deepEqual(scoped.businessHistory,[])
 assert.deepEqual(scoped.visits,[])
 assert.deepEqual(scoped.interactions,[])
 assert.deepEqual(scoped.opportunities,[])
 assert.deepEqual(scoped.manualRecords,[])
 assert.deepEqual(scoped.attachments,[])
 assert.deepEqual(scoped.priorRecommendations,[])
 assert.doesNotMatch(JSON.stringify(scoped),/Travamento|CPF financeira|Repassar|POISON_/i)
})

test('trace interno possui contrato estrito e IDs opacos resolvíveis para staging',()=>{
 const trace=snapshot().selection.context_trace
 for(const item of [...trace.selected,...trace.rejected])assert.deepEqual(Object.keys(item).sort(),['ownerId','producerId','reasonSelected','relevanceScore','sourceId','sourceType','status','tenantId','timestamp'].sort())
 assert.equal(JSON.stringify(trace).includes('producer_360:profile-a'),true)
 assert.equal(JSON.stringify(trace).includes('visit:grain-a'),true)
 assert.equal(JSON.stringify(trace).includes('@'),false)
})

test('PROFILE FAST permanece abaixo da meta local de 2 segundos',()=>{
 const started=performance.now()
 const result=buildFastClientResponse({facts:{client:{...context().client},profileEvidence,profileSourceRef:'producer_360:profile-a'},message:'qual o perfil dele?',organizationId:tenantId,ownerId:actorId,conversationId:'thread-a',contextEpoch:4,now})
 const elapsed=performance.now()-started
 assert.equal(result.advice.ai_reasoning.grounding.passed,true)
 assert.equal(result.advice.ai_reasoning.premises.session_context.context_epoch,4)
 assert.ok(elapsed<2_000,`PROFILE FAST levou ${elapsed.toFixed(1)} ms`)
})
