import assert from 'node:assert/strict'
import test from 'node:test'
import {assertActiveProducerBoundary,collectionMatchesContextDomain} from '../server/decision-copilot/context-selector.js'
import {assertContextSnapshot,buildContextSnapshot,scopeContextSnapshotForModel,validateContextSnapshot} from '../server/memory/context-snapshot.js'
import {scopeValContextForModel,validatePreloadedValContext} from '../server/val-engine.js'

const tenant='tenant-a'
const owner='owner-a'
const producer='producer-a'
const now=new Date('2026-08-30T12:00:00.000Z')
const empty=()=>({client:{id:producer,name:'Produtor A'},profile:{evidence:[]},memoryHistory:[],businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments:[],priorRecommendations:[]})
const scoped=value=>({...value,tenant_id:tenant,producer_id:producer,context_owner_id:owner})
const build=(context=empty(),input={})=>buildContextSnapshot(context,{organizationId:tenant,subjectType:'client',subjectId:producer,actorId:owner,role:'consultant',scope:'own_portfolio',objective:'profile_query',message:'qual o perfil dele?',conversationId:'conversation-a',contextEpoch:3,requestId:'hardening-probe',now,...input})

test('wrapper correto não mascara producer/tenant/owner divergente em data',()=>{
 const visit=scoped({id:'visit-a',occurred_at:'2026-08-20T12:00:00.000Z',status:'COMPLETED'})
 const snapshot=build({...empty(),visits:[visit]},{objective:'visit_query',message:'qual foi a última visita?'})
 snapshot.relationship_context.visits[0].data.producer_id='producer-b'
 assert.ok(validateContextSnapshot(snapshot).includes('nested_payload_scope'))
 assert.throws(()=>assertContextSnapshot(snapshot),error=>error.code==='context_snapshot_invalid')
})

test('hard boundary recursa em property, field e season sem exigir aliases herdados',()=>{
 const legitimate=scoped({
  id:'property-a',name:'Fazenda A',area_ha:100,updated_at:'2026-08-20T12:00:00.000Z',
  fields:[{id:'field-a',name:'Talhão A',area_ha:40,seasons:[{id:'season-a'}]}]
 })
 const snapshot=build({...empty(),properties:[legitimate]},{objective:'agronomy_query',message:'qual a área da propriedade e do talhão?',contextDomain:'AGRONOMY'})
 assert.equal(snapshot.agronomic_context.properties[0].data.fields[0].name,'Talhão A')

 const crossProducer=scoped({
  id:'property-poison',name:'Fazenda A',updated_at:'2026-08-20T12:00:00.000Z',
  fields:[{id:'field-poison',client_id:'producer-b',tenant_id:'tenant-b',context_owner_id:'owner-b',name:'SEGREDO B'}]
 })
 assert.throws(
  ()=>build({...empty(),properties:[crossProducer]},{objective:'agronomy_query',message:'qual o diagnóstico agronômico?',contextDomain:'AGRONOMY'}),
  error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='NESTED_PRODUCER_MISMATCH'
 )

 snapshot.agronomic_context.properties[0].data.fields[0].seasons[0].producer_id='producer-b'
 assert.ok(validateContextSnapshot(snapshot).includes('nested_payload_scope'))
 assert.throws(()=>assertContextSnapshot(snapshot),error=>error.code==='context_snapshot_invalid')
})

test('GLOBAL só dispensa producer ausente e nunca autoriza escopo divergente',()=>{
 assert.equal(assertActiveProducerBoundary([{scope:'GLOBAL',tenant_id:tenant,context_owner_id:owner}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),true)
 assert.throws(()=>assertActiveProducerBoundary([{scope:'GLOBAL',context_owner_id:owner}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),error=>error.reason==='MISSING_TENANT_SCOPE')
 assert.throws(()=>assertActiveProducerBoundary([{scope:'GLOBAL',tenant_id:tenant}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),error=>error.reason==='MISSING_OWNER_SCOPE')
 assert.throws(()=>assertActiveProducerBoundary([{scope:'GLOBAL',tenant_id:'tenant-b',context_owner_id:owner}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),error=>error.reason==='TENANT_MISMATCH')
 assert.throws(()=>assertActiveProducerBoundary([{scope:'GLOBAL',tenant_id:tenant,context_owner_id:owner,producer_id:'producer-b'}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),error=>error.reason==='GLOBAL_WITH_PRODUCER_ID')
 assert.throws(()=>assertActiveProducerBoundary([{source_type:'market_snapshot',tenant_id:tenant,context_owner_id:owner}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),error=>error.reason==='MISSING_MARKET_SCOPE')
 assert.throws(()=>assertActiveProducerBoundary([{scope:'MARKET',tenant_id:tenant,context_owner_id:owner}],{producerId:producer,tenantId:tenant}),error=>error.reason==='MISSING_OWNER_SCOPE')
})

test('snapshot GENERAL não se autoatesta para pergunta PROFILE',()=>{
 const context=empty()
 context.contextSnapshot=build(context,{objective:'general_assistance',message:'ajude',contextDomain:'GENERAL'})
 context.conversationState={conversation_id:'conversation-a',context_epoch:3,current_client:{id:producer}}
 const envelope={scope:{tenantId:tenant,ownerId:owner,clientId:producer,conversationId:'conversation-a',contextEpoch:3,contextDomain:'GENERAL'},context}
 assert.throws(()=>validatePreloadedValContext(envelope,{tenantId:tenant,ownerId:owner,clientId:producer,conversationId:'conversation-a',contextEpoch:3,message:'qual o perfil dele?'}),error=>error.code==='val_preloaded_context_scope_mismatch')
})

test('runtime contract bloqueia campo obrigatório ausente e trace incompleto',()=>{
 const memory=scoped({id:'behavior-a',client_id:producer,subject_type:'client',subject_id:producer,memory_type:'inference',memory_state:'INFERENCE',memory_domain:'BEHAVIORAL',key:'profile.behavioral_signal',value:{statement:'Pediu dados comparáveis antes de decidir.'},status:'verified',source:'visit_report',source_ref:'visit_report:behavior-a',source_type:'visit_report',confidence:80,valid_from:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',updated_at:'2026-08-01T12:00:00.000Z',acl:{scope:'own_portfolio'}})
 const missingField=build({...empty(),memoryHistory:[memory]})
 delete missingField.inferences[0].source_type
 assert.ok(validateContextSnapshot(missingField).includes('context_item_contract'))
 const missingTrace=build({...empty(),memoryHistory:[memory]})
 missingTrace.selection.context_trace.selected=[]
 assert.ok(validateContextSnapshot(missingTrace).includes('context_trace_membership'))
})

test('PROFILE exclui memória comportamental stale/UNKNOWN e source desconexa',()=>{
 const old=scoped({id:'old',client_id:producer,subject_type:'client',subject_id:producer,memory_type:'inference',memory_state:'INFERENCE',memory_domain:'BEHAVIORAL',key:'profile.behavioral_signal',value:{statement:'Pediu comparativos.'},status:'verified',source:'visit_report',source_ref:'visit_report:old',source_type:'visit_report',confidence:80,valid_from:'2020-01-01T00:00:00.000Z',updated_at:'2020-01-01T00:00:00.000Z',acl:{scope:'own_portfolio'}})
 const evidence=scoped({id:'evidence-a',profile_source_ref:'profile:other',assessed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',source_type:'survey'})
 const context={...empty(),client:{id:producer,name:'A',primaryProfile:'Analítico',profileEvidence:[evidence]},profile:{sourceId:'profile:a',evidence:[evidence],assessedAt:'2026-08-01T12:00:00.000Z',validUntil:'2027-08-01T12:00:00.000Z'},memoryHistory:[old]}
 const snapshot=build(context)
 assert.deepEqual(snapshot.selection.selected_refs,[])
 assert.deepEqual(snapshot.behavioral_signals,[])
 assert.deepEqual(scopeContextSnapshotForModel(snapshot).stale_information,[])
})

test('snapshot id inclui conversa, epoch, domínio e selector',()=>{
 const a=build(empty(),{conversationId:'conversation-a',contextEpoch:1})
 const b=build(empty(),{conversationId:'conversation-b',contextEpoch:1})
 const c=build(empty(),{conversationId:'conversation-a',contextEpoch:2})
 const d=build(empty(),{conversationId:'conversation-a',contextEpoch:1,contextDomain:'VISIT',message:'qual foi a última visita?',objective:'visit_query'})
 assert.equal(new Set([a.context_snapshot_id,b.context_snapshot_id,c.context_snapshot_id,d.context_snapshot_id]).size,4)
})

test('pipeline produtor falha fechado sem snapshot e mixed-domain é rejeitado',()=>{
 assert.throws(()=>scopeValContextForModel({client:{id:producer,name:'A'}}),error=>error.reason==='MISSING_CONTEXT_SNAPSHOT')
 assert.equal(collectionMatchesContextDomain({summary:'Diagnóstico do solo; CPF financeira pendente.'},'field_report','AGRONOMY','diagnóstico do solo'),false)
})

test('manual records e attachments não atravessam PROFILE',()=>{
 const snapshot=build({...empty(),manualRecords:[scoped({id:'manual-a',occurred_at:'2026-08-20T12:00:00.000Z',payload:{summary:'Diagnóstico do solo'}})],attachments:[scoped({id:'attachment-a',updated_at:'2026-08-20T12:00:00.000Z',analysis:{summary:'Diagnóstico do solo'}})]})
 const scopedContext=scopeValContextForModel({...empty(),contextSnapshot:snapshot,manualRecords:[{id:'poison'}],attachments:[{id:'poison'}],currentAttachments:[{id:'poison'}]})
 assert.deepEqual(scopedContext.manualRecords,[])
 assert.deepEqual(scopedContext.attachments,[])
 assert.deepEqual(scopedContext.currentAttachments,[])
})

test('memória BEHAVIORAL organizacional nunca classifica o perfil do produtor ativo',()=>{
 const organizational={
  id:'org-behavior',tenant_id:tenant,client_id:null,subject_type:'organization',subject_id:tenant,scope:'GLOBAL',
  memory_type:'inference',memory_state:'INFERENCE',memory_domain:'BEHAVIORAL',key:'visit_report.behavioral_signal',
  value:{statement:'Pede comparativos antes de decidir.'},status:'verified',source_ref:'organization:behavior',source_type:'organization_policy',
  confidence:90,valid_from:'2026-08-01T12:00:00.000Z',updated_at:'2026-08-01T12:00:00.000Z',acl:{scope:'organization',roles:['consultant']}
 }
 const snapshot=build({...empty(),memoryHistory:[organizational]})
 assert.deepEqual(snapshot.behavioral_signals,[])
 assert.deepEqual(snapshot.selection.selected_refs,[])
 assert.deepEqual(snapshot.selection.considered_refs,['org-behavior'])
 assert.ok(snapshot.selection.exclusion_reason_codes.find(item=>item.ref==='org-behavior')?.reason_codes.includes('GLOBAL_CONTEXT_NOT_PRODUCER_SPECIFIC'))
 assert.equal(snapshot.selection.context_trace.rejected.find(item=>item.sourceId==='organization:behavior')?.producerId,'GLOBAL')
})

test('visita de outro produtor não autoriza memória de subentidade no snapshot ativo',()=>{
 const foreignVisit={id:'visit-b',tenant_id:tenant,producer_id:'producer-b',context_owner_id:owner,occurred_at:'2026-08-20T12:00:00.000Z'}
 const foreignMemory={
  id:'visit-memory-b',tenant_id:tenant,client_id:'producer-b',subject_type:'visit',subject_id:'visit-b',context_owner_id:owner,
  memory_type:'inference',memory_state:'INFERENCE',memory_domain:'BEHAVIORAL',key:'visit_report.behavioral_signal',
  value:{statement:'Pediu dados.'},status:'verified',source_ref:'visit:visit-b',source_type:'visit_report',confidence:80,
  valid_from:'2026-08-20T12:00:00.000Z',updated_at:'2026-08-20T12:00:00.000Z',acl:{scope:'own_portfolio'}
 }
 const snapshot=build({...empty(),visits:[foreignVisit],memoryHistory:[foreignMemory]})
 assert.deepEqual(snapshot.selection.considered_refs,[])
 assert.equal(snapshot.selection.unauthorized_count,1)
 assert.deepEqual(snapshot.behavioral_signals,[])
 assert.ok(snapshot.selection.context_trace.rejected.some(item=>item.sourceId==='visit:visit-b'&&item.reasonSelected==='PRODUCER_MISMATCH'))
})

test('GLOBAL explícito é auditável, permitido e nunca reetiquetado como produtor',()=>{
 const globalKnowledge={
  id:'global-safe',tenant_id:tenant,subject_type:'organization',subject_id:tenant,scope:'GENERAL_KNOWLEDGE',
  memory_type:'fact',memory_state:'FACT',memory_domain:'ORGANIZATIONAL',key:'general_policy',value:'Conhecimento geral seguro.',
  status:'verified',source_ref:'general_knowledge:safe',source_type:'general_knowledge',valid_from:'2026-08-01T12:00:00.000Z',
  updated_at:'2026-08-01T12:00:00.000Z',acl:{scope:'organization',roles:['consultant']}
 }
 const snapshot=build({...empty(),memoryHistory:[globalKnowledge]},{objective:'general_assistance',message:'ajude',contextDomain:'GENERAL'})
 assert.deepEqual(snapshot.selection.considered_refs,['global-safe'])
 assert.deepEqual(snapshot.selection.selected_refs,[])
 assert.equal(snapshot.selection.unauthorized_count,0)
 const trace=snapshot.selection.context_trace.rejected.find(item=>item.sourceId==='general_knowledge:safe')
 assert.equal(trace?.producerId,'GLOBAL')
 assert.equal(trace?.reasonSelected,'GLOBAL_CONTEXT_NOT_PRODUCER_SPECIFIC')
 assert.doesNotMatch(JSON.stringify([...snapshot.facts,...snapshot.inferences,...snapshot.hypotheses,...snapshot.validated_knowledge]),/Conhecimento geral seguro/)
})

test('aliases conflitantes falham fechado em memória, coleção, boundary e snapshot aninhado',()=>{
 const producerConflict=scoped({id:'memory-conflict',client_id:'producer-b',subject_type:'client',subject_id:producer,memory_type:'fact',memory_state:'FACT',memory_domain:'PRODUCER',key:'name',value:'A',status:'verified',source_ref:'source:conflict',source_type:'survey',valid_from:'2026-08-01T12:00:00.000Z',acl:{scope:'own_portfolio'}})
 assert.throws(()=>build({...empty(),memoryHistory:[producerConflict]}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_ALIAS_CONFLICT')
 const tenantConflict=scoped({id:'visit-conflict',organization_id:'tenant-b',occurred_at:'2026-08-20T12:00:00.000Z'})
 assert.throws(()=>build({...empty(),visits:[tenantConflict]},{objective:'visit_query',message:'qual foi a última visita?'}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='TENANT_ALIAS_CONFLICT')
 assert.throws(()=>assertActiveProducerBoundary([{producer_id:producer,client_id:'producer-b',tenant_id:tenant,context_owner_id:owner}],{producerId:producer,tenantId:tenant,ownerId:owner,requireOwner:true}),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='PRODUCER_ALIAS_CONFLICT')
 const validVisit=scoped({id:'visit-a',occurred_at:'2026-08-20T12:00:00.000Z',status:'COMPLETED'})
 const snapshot=build({...empty(),visits:[validVisit]},{objective:'visit_query',message:'qual foi a última visita?'})
 snapshot.relationship_context.visits[0].data.owner_id='owner-b'
 assert.throws(()=>assertContextSnapshot(snapshot),error=>error.code==='CONTEXT_SCOPE_VIOLATION'&&error.reason==='SCOPE_ALIAS_CONFLICT')
})

test('owner ausente não é sintetizado em memória producer-specific',()=>{
 const ownerless={
  id:'ownerless',tenant_id:tenant,client_id:producer,subject_type:'client',subject_id:producer,
  memory_type:'fact',memory_state:'FACT',memory_domain:'PRODUCER',key:'name',value:'Produtor A',status:'verified',
  source_ref:'survey:ownerless',source_type:'survey',valid_from:'2026-08-01T12:00:00.000Z',updated_at:'2026-08-01T12:00:00.000Z',acl:{scope:'own_portfolio'}
 }
 const snapshot=build({...empty(),memoryHistory:[ownerless]},{objective:'general_assistance',message:'',contextDomain:'GENERAL'})
 assert.deepEqual(snapshot.selection.considered_refs,[])
 assert.equal(snapshot.selection.unauthorized_count,1)
 assert.deepEqual(snapshot.facts,[])
 assert.ok(snapshot.selection.context_trace.rejected.some(item=>item.sourceId==='survey:ownerless'&&item.reasonSelected==='MISSING_OWNER_SCOPE'&&item.ownerId===null))
})

test('consulta de última visita mantém identidade e data sem transportar poison cross-domain',()=>{
 const visit=scoped({id:'visit-poison',occurred_at:'2026-08-20T12:00:00.000Z',status:'COMPLETED',summary:'CPF financeiro, contrato de grãos e repassar fertilizantes.',notes:'Preço de fertilizante.'})
 const snapshot=build({...empty(),visits:[visit]},{objective:'visit_query',message:'qual foi a última visita?'})
 assert.deepEqual(snapshot.relationship_context.visits.map(item=>item.data.id),['visit-poison'])
 assert.doesNotMatch(JSON.stringify(snapshot.relationship_context.visits),/CPF|grãos|fertilizante/i)
 assert.equal(snapshot.relationship_context.visits[0].data.summary,undefined)
 assert.equal(snapshot.relationship_context.visits[0].data.notes,undefined)
})
