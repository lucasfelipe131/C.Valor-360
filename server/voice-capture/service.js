import {randomUUID} from 'node:crypto'
import {observe} from '../observability.js'
import {buildCommitmentCandidate} from '../execution/commitment.js'
import {resolveVisitDueDate} from '../visit-loop/report.js'
import {buildVoiceCandidate,transitionVoiceInteraction,voiceCandidateCategories,voiceInteractionTypes} from './contracts.js'
import {voiceCandidateTextSecurityReason} from './extraction.js'

const text=(value,max=2_000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const list=value=>Array.isArray(value)?value:[]
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const nowIso=value=>(value instanceof Date?value:new Date(value||Date.now())).toISOString()
const confidence=value=>Math.max(0,Math.min(1,Number(value)||0))
const forbiddenContextKey=/secret|password|token|api.?key|audio|transcript|prompt|instruction/i
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function voiceError(message,code,statusCode=422,safeToRetry=false){return Object.assign(new Error(message),{code,statusCode,safeToRetry})}

function sourceContext(value,depth=0){
 if(depth>2||!object(value))return {}
 const result={}
 for(const [rawKey,rawValue] of Object.entries(value).slice(0,30)){
  const key=text(rawKey,80);if(!key||forbiddenContextKey.test(key))continue
  if(typeof rawValue==='string')result[key]=text(rawValue,500)
  else if(typeof rawValue==='number'&&Number.isFinite(rawValue))result[key]=rawValue
  else if(typeof rawValue==='boolean'||rawValue===null)result[key]=rawValue
  else if(Array.isArray(rawValue))result[key]=rawValue.slice(0,20).map(item=>typeof item==='string'?text(item,200):item).filter(item=>['string','number','boolean'].includes(typeof item)||item===null)
  else if(object(rawValue))result[key]=sourceContext(rawValue,depth+1)
 }
 return result
}

function dueAt(value,{anchor}={}){
 const raw=text(value,200);if(!raw)return null
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return new Date(`${raw}T23:59:59.999-03:00`).toISOString()
 const parsed=new Date(raw);if(!Number.isNaN(parsed.getTime()))return parsed.toISOString()
 return resolveVisitDueDate(raw,{anchor}).due_at
}

function candidateDue(candidate,{anchor}={}){
 return dueAt(candidate?.due_at??candidate?.metadata?.due_at??candidate?.metadata?.date_expression??candidate?.statement,{anchor})
}

function candidateWithDue(candidate,{anchor}={}){
 if(!['COMMITMENT_CANDIDATE','NEXT_STEP'].includes(candidate.category))return candidate
 return {...candidate,due_at:candidateDue(candidate,{anchor})}
}

function safeProviderMetadata(error,fallback={}){
 const metadata=object(error?.transcriptionMetadata)?error.transcriptionMetadata:{}
 return {
  provider:text(metadata.provider||fallback.provider||'unknown',80)||'unknown',
  model:text(metadata.model||fallback.model||'unknown',120)||'unknown',
  version:text(metadata.version||fallback.version||'unknown',120)||'unknown',
  status:'FAILED',provider_reference:null,language:null,duration_seconds:null,confidence:null,
  error:{code:text(metadata.error?.code||error?.code||'transcription_failed',100),status:Number(metadata.error?.status||error?.statusCode||503)||503,retryable:Boolean(metadata.error?.retryable??error?.safeToRetry)}
 }
}

function reviewedCandidates(interaction,input,actorId,now){
 if(input.items!==undefined&&!Array.isArray(input.items))throw voiceError('A revisão de informações deve ser uma lista.','invalid_voice_review')
 if(input.additions!==undefined&&!Array.isArray(input.additions))throw voiceError('As informações adicionadas devem ser uma lista.','invalid_voice_review')
 if(list(input.items).length>50)throw voiceError('A revisão excede o limite de 50 informações.','voice_review_limit_exceeded',413)
 if(list(input.additions).length>20)throw voiceError('A revisão excede o limite de 20 informações adicionadas.','voice_additions_limit_exceeded',413)
 if(list(input.items).length+list(input.additions).length>50)throw voiceError('A confirmação excede o limite total de 50 informações.','voice_review_limit_exceeded',413)
 const at=nowIso(now);const decisions=new Map();const originalIds=new Set(interaction.candidates.map(item=>String(item.candidate_id)))
 for(const item of list(input.items)){
  const id=text(item?.candidate_id,180);if(!id||decisions.has(id))throw voiceError('A revisão contém identificadores ausentes ou duplicados.','invalid_voice_review')
  if(!originalIds.has(id))throw voiceError('A revisão referencia uma informação que não pertence a esta interação.','invalid_voice_review')
  const decision=String(item?.decision||'').toUpperCase();if(!['CONFIRMED','REJECTED'].includes(decision))throw voiceError('Confirme ou rejeite explicitamente cada informação.','voice_review_decision_required')
  decisions.set(id,{...item,decision})
 }
 if(decisions.size!==interaction.candidates.length)throw voiceError('Revise explicitamente todas as informações antes de confirmar.','voice_review_incomplete')
 const reviewed=interaction.candidates.map(candidate=>{const decision=decisions.get(String(candidate.candidate_id));const status=decision.decision;const statement=status==='REJECTED'?candidate.statement:text(decision.statement??candidate.statement,2_000);if(status==='CONFIRMED'&&!statement)throw voiceError('Uma informação confirmada não pode ficar vazia.','voice_review_statement_required');if(status==='CONFIRMED'&&voiceCandidateTextSecurityReason(statement))throw voiceError('A edição contém instrução, atributo sensível ou prescrição incompatível com o Voice Capture.','voice_review_unsafe_text');return {...candidate,statement,due_at:dueAt(decision.due_at??candidate.due_at,{anchor:now}),review_status:status,reviewed_by:actorId,reviewed_at:at}})
 const usedIds=new Set(originalIds)
 for(const item of list(input.additions)){
  const category=String(item?.category||'').toUpperCase();if(!voiceCandidateCategories.includes(category))throw voiceError('Uma informação adicionada possui categoria inválida.','invalid_voice_candidate_category')
  if(voiceCandidateTextSecurityReason(item?.statement))throw voiceError('A informação adicionada contém instrução, atributo sensível ou prescrição incompatível com o Voice Capture.','voice_review_unsafe_text')
  const requestedId=text(item?.candidate_id,180);if(requestedId&&!uuidPattern.test(requestedId))throw voiceError('O identificador da informação adicionada é inválido.','invalid_voice_candidate_id')
  const candidateId=requestedId||randomUUID();if(usedIds.has(candidateId))throw voiceError('A revisão contém identificadores duplicados.','invalid_voice_review');usedIds.add(candidateId)
  const epistemicStatus=category==='HYPOTHESIS'?'HYPOTHESIS':category==='BEHAVIORAL_SIGNAL'?'INFERENCE':item.epistemic_status
  const candidate=buildVoiceCandidate({candidateId,voiceInteractionId:interaction.voice_interaction_id,category,epistemicStatus,statement:item.statement,sourceRef:`consultant-addition:${interaction.voice_interaction_id}`,confidence:1,reviewStatus:'CONFIRMED',reviewedBy:actorId,reviewedAt:at,metadata:{added_by_consultant:true,untrusted_source:false},now:at})
  reviewed.push({...candidate,due_at:dueAt(item.due_at,{anchor:now})})
 }
 return reviewed
}

function memorySpec(category){
 return {
  FACT_CANDIDATE:{key:'voice.fact',domain:'PRODUCER'},
  COMMITMENT_CANDIDATE:{key:'voice.commitment',domain:'RELATIONSHIP'},
  OBJECTION:{key:'visit_report.objection',domain:'COMMERCIAL'},
  OPPORTUNITY_CANDIDATE:{key:'voice.opportunity_candidate',domain:'COMMERCIAL'},
  BEHAVIORAL_SIGNAL:{key:'visit_report.behavioral_signal',domain:'BEHAVIORAL'},
  AGRONOMIC_OBSERVATION:{key:'visit_report.technical_observation',domain:'AGRONOMIC'},
  EXPECTATION:{key:'visit_report.expectation',domain:'COMMERCIAL'},
  NEXT_STEP:{key:'visit_report.next_step',domain:'RELATIONSHIP'},
  MISSING_INFORMATION:{key:'visit_report.missing_information',domain:'COMMERCIAL'},
  HYPOTHESIS:{key:'voice.hypothesis',domain:'PRODUCER'}
 }[category]
}

function memoryEpistemology(candidate){
 const status=String(candidate?.epistemic_status||'FACT_CANDIDATE').toUpperCase()
 if(status==='HYPOTHESIS')return {state:'HYPOTHESIS',type:'inference',status:'proposed'}
 if(status==='INFERENCE')return {state:'INFERENCE',type:'inference',status:'proposed'}
 return {state:'FACT',type:'fact',status:'verified'}
}

function memoryWrites(interaction,candidates,actorId,now){
 const at=nowIso(now);const sourceRef=`voice-interaction:${interaction.voice_interaction_id}`
 return candidates.map(candidate=>{const spec=memorySpec(candidate.category);const epistemology=memoryEpistemology(candidate);return {
  id:randomUUID(),organization_id:interaction.organization_id,client_id:interaction.client_id,subject_type:interaction.visit_id?'visit':'client',subject_id:interaction.visit_id||interaction.client_id,
  memory_type:epistemology.type,memory_state:epistemology.state,memory_domain:spec.domain,key:spec.key,
  value:{statement:candidate.statement,category:candidate.category,claim_status:candidate.category==='AGRONOMIC_OBSERVATION'?'REPORTED_OBSERVATION':undefined,requires_technical_review:candidate.category==='AGRONOMIC_OBSERVATION'||undefined,profile_certainty:candidate.category==='BEHAVIORAL_SIGNAL'?false:undefined,due_at:candidate.due_at||undefined},
  evidence:[{id:candidate.candidate_id,source_ref:sourceRef,confirmation_status:'CONFIRMED'}],confidence:Math.round(confidence(candidate.confidence)*100),status:epistemology.status,source:'confirmed_voice_interaction',source_ref:sourceRef,source_type:'confirmed_voice_interaction',observed_at:at,source_updated_at:at,freshness_policy_version:'val.context.freshness.v1',freshness_metadata:{domain:spec.domain,source_type:'confirmed_voice_interaction',voice_interaction_type:interaction.interaction_type,epistemic_status:candidate.epistemic_status},valid_from:at,valid_until:null,created_by:actorId,acl:{scope:'own_portfolio'}
 }} )
}

function commitmentWrites(interaction,candidates,actorId,requestId,now){
 return candidates.filter(item=>item.category==='COMMITMENT_CANDIDATE').map(item=>{
  const due=candidateDue(item,{anchor:now});if(!due)throw voiceError('Informe o prazo do compromisso antes de confirmar.','voice_commitment_due_required')
  const result=buildCommitmentCandidate({organization_id:interaction.organization_id,client_id:interaction.client_id,visit_id:interaction.visit_id,description:item.statement,owner_type:'USER',owner_id:actorId,due_at:due,status:'ACCEPTED',success_criteria:'Próximo passo realizado e resultado registrado.',agreed_with_client:true,evidence_refs:[{id:`voice-interaction:${interaction.voice_interaction_id}`,type:'confirmed_voice_interaction'},{id:item.candidate_id,type:'voice_candidate'}],source_ref:`voice-interaction:${interaction.voice_interaction_id}`,request_id:requestId||interaction.voice_interaction_id,created_by:actorId,now})
  if(!result.is_commitment)throw voiceError('O compromisso ainda não possui responsável, prazo e critério de sucesso.','voice_commitment_incomplete')
  return result.commitment
 })
}

function opportunityWrites(interaction,candidates){
 return candidates.filter(item=>item.category==='OPPORTUNITY_CANDIDATE').map(item=>({title:text(item.statement,220),category:/buva|talh[aã]o|praga|doen[cç]a|solo/i.test(item.statement)?'AGRONOMIC_NEED':'VOICE_CANDIDATE',hypothesis:text(item.statement,2_000),estimated_value:null,stage:'Diagnóstico',next_action:'Confirmar necessidade e contexto antes de propor qualquer solução.',next_action_at:null,candidate_key:`voice:${interaction.voice_interaction_id}:${item.candidate_id}`,evidence:[{type:'confirmed_voice_interaction',id:interaction.voice_interaction_id},{type:'voice_candidate',id:item.candidate_id},{type:'technical_claims_status',value:'REQUIRES_MIA'}]}))
}

function reportItem(candidate,extra={}){return {item_id:candidate.candidate_id,epistemic_status:candidate.epistemic_status,statement:candidate.statement,source_ref:candidate.source_ref,confidence:confidence(candidate.confidence),requires_confirmation:true,...extra}}

function reportFields(candidates,input,now){
 const by=category=>candidates.filter(item=>item.category===category)
 const next=by('NEXT_STEP').map(item=>reportItem(item,{type:'FOLLOW_UP',description:item.statement,due_at:candidateDue(item,{anchor:now}),explicit:true,date_confirmation_required:false}))
 const confirmedNextStep=text(input.next_step)
 if(confirmedNextStep){if(voiceCandidateTextSecurityReason(confirmedNextStep))throw voiceError('O próximo passo contém instrução, atributo sensível ou prescrição incompatível com o Voice Capture.','voice_review_unsafe_text');next.splice(0,next.length,reportItem({candidate_id:`next-${randomUUID()}`,epistemic_status:'FACT_CANDIDATE',statement:confirmedNextStep,source_ref:'consultant-confirmation',confidence:1},{type:'FOLLOW_UP',description:confirmedNextStep,due_at:dueAt(input.next_step_at,{anchor:now}),explicit:true,date_confirmation_required:false}))}
 if(input.no_action===true)next.splice(0,next.length,reportItem({candidate_id:`no-action-${randomUUID()}`,epistemic_status:'FACT_CANDIDATE',statement:'Nenhuma ação adicional foi considerada necessária pelo consultor.',source_ref:'consultant-confirmation',confidence:1},{type:'NO_ACTION',description:'Nenhuma ação adicional necessária.',due_at:null,explicit:true,date_confirmation_required:false}))
 if(!next.length)throw voiceError('Registre um próximo passo ou marque explicitamente que nenhuma ação é necessária.','explicit_next_step_required')
 const commitments=by('COMMITMENT_CANDIDATE').map(item=>{const due=candidateDue(item,{anchor:now});if(!due)throw voiceError('Informe o prazo do compromisso antes de confirmar.','voice_commitment_due_required');return reportItem(item,{description:item.statement,owner_type:'USER',due_at:due,date_confirmation_required:false,status:'PROPOSED',success_criteria:'Próximo passo realizado e resultado registrado.',agreed_with_client:true})})
 const technical=by('AGRONOMIC_OBSERVATION').map(item=>reportItem(item,{observation_type:'CONSULTANT_OR_PRODUCER_REPORTED',requires_technical_review:true,technical_claims_status:'REQUIRES_MIA'}))
 const opportunities=by('OPPORTUNITY_CANDIDATE').map(item=>reportItem(item,{title:text(item.statement,220),category:/buva|talh[aã]o|praga|doen[cç]a|solo/i.test(item.statement)?'AGRONOMIC_NEED':'VOICE_CANDIDATE',technical_claims_status:'REQUIRES_MIA'}))
 const facts=by('FACT_CANDIDATE')
 return {
  summary:candidates.length?text(candidates.map(item=>item.statement).join(' '),1_200):'Nenhuma informação material foi confirmada.',
  discussed_topics:[...new Set(candidates.map(item=>item.category.replaceAll('_',' ')))].slice(0,12),
  expectations_created:by('EXPECTATION').map(item=>reportItem(item,{category:/comparativ|custo|roi/i.test(item.statement)?'PROOF_REQUEST':'EXPECTATION'})),
  objections:by('OBJECTION').map(item=>reportItem(item,{category:/pre[cç]o|caro|investimento/i.test(item.statement)?'PRICE':'OTHER'})),
  producer_signals:facts.filter(item=>/s[oó]ci[oa]|decisor|participante.*decis/i.test(item.statement)).map(item=>reportItem(item,{signal_code:'MULTI_DECISION_PARTICIPANT'})),
  opportunities_detected:opportunities,commitments_proposed:commitments,commitments_confirmed:commitments,closed_business:[],pending_business:[],next_steps:next,technical_observations:technical,
  behavioral_signals:by('BEHAVIORAL_SIGNAL').map(item=>reportItem(item,{signal_code:'OBSERVABLE_DECISION_BEHAVIOR',dimension:/n[uú]mero|roi|custo|comparativ/i.test(item.statement)?'analytical':null,profile_certainty:false})),
  missing_information:by('MISSING_INFORMATION').map(item=>reportItem(item,{code:'VOICE_REPORTED_MISSING_INFORMATION',critical:false})),consultant_notes:'Origem: VoiceInteraction confirmada pelo consultor.'
 }
}

export function createVoiceCaptureService({repository,storageProvider,transcriptionProvider,extractor,visitLoop,prepareVisit,maxDurationSeconds=900}={}){
 if(!repository||!storageProvider||!transcriptionProvider||!extractor||!visitLoop)throw new TypeError('VoiceCaptureService exige repositório, storage, transcrição, extração e VisitLoop.')
 const processingControllers=new Map()
 const enforcedMaxDuration=Math.max(1,Math.min(900,Number(maxDurationSeconds)||900))
 const persist=(current,next,changes,scope)=>repository.updateVoiceInteraction({...scope,interaction:transitionVoiceInteraction(current,next,{...changes,now:scope.now}),audioAttachmentId:changes.audio_attachment_id||null,expectedState:current.state,expectedRevision:current.revision})
 const get=async scope=>{const interaction=await repository.getVoiceInteraction(scope);if(!interaction)throw voiceError('Interação de voz não encontrada.','voice_interaction_not_found',404);return interaction}

 return Object.freeze({
  async create({tenantId,ownerId,actorId=ownerId,input={},requestId,now}={}){
   const interactionType=String(input.interaction_type||'').toUpperCase();if(!voiceInteractionTypes.includes(interactionType))throw voiceError('Selecione um tipo válido de interação de voz.','voice_interaction_type_invalid')
   const visitId=text(input.visit_id,180)||null;if(['PRE_VISIT','POST_VISIT'].includes(interactionType)&&!visitId)throw voiceError('Esta captura exige uma visita vinculada.','voice_visit_required')
   const manualText=text(input.manual_text,20_000);const context={...sourceContext(input.source_context),...(manualText?{capture_mode:'TEXT_FALLBACK'}:{capture_mode:'AUDIO'})}
   let interaction=await repository.createVoiceInteraction({tenantId,ownerId,actorId,clientId:text(input.client_id,180),visitId,interactionType,sourceContext:context,now})
   if(manualText){const at=nowIso(now);const transcript=await repository.saveVoiceTranscript({tenantId,ownerId,actorId,transcript:{transcript_id:randomUUID(),organization_id:tenantId,voice_interaction_id:interaction.voice_interaction_id,client_id:interaction.client_id,visit_id:interaction.visit_id,created_by:actorId,provider:'manual',model:'manual-text-v1',provider_version:'val.transcription_provider.v1',provider_reference:null,status:'COMPLETED',transcript_text:manualText,language:text(input.language,30)||'pt-BR',duration_seconds:null,confidence:1,attempt_no:1,error_code:null,metadata:{capture_mode:'TEXT_FALLBACK'},created_at:at,updated_at:at,completed_at:at}});interaction=await persist(interaction,'TRANSCRIBED',{transcript_ref:`voice-transcript:${transcript.transcript_id}`,transcript_status:'COMPLETED',language:transcript.language,transcription:{provider:'manual',model:'manual-text-v1',version:'val.transcription_provider.v1',status:'COMPLETED',provider_reference:null,language:transcript.language,duration_seconds:null,confidence:1,error:null}},{tenantId,ownerId,actorId,now})}
   observe('voice.interaction.created',{voiceInteractionId:interaction.voice_interaction_id,visitId:interaction.visit_id,interactionType,confirmationStatus:interaction.confirmation_status,outcome:'ok'})
   return {contract_version:'val.voice_interaction.response.v1',voice_interaction:interaction}
  },

  async uploadAudio({tenantId,ownerId,actorId=ownerId,id,input={},now}={}){
   let interaction=await get({tenantId,ownerId,actorId,id,includeTranscript:false});if(interaction.state!=='CREATED')throw voiceError('O áudio só pode ser enviado para uma interação nova.','voice_audio_state_invalid',409)
   const duration=Number(input.duration_seconds);if(!Number.isFinite(duration)||duration<=0||duration>enforcedMaxDuration)throw voiceError(`A duração do áudio deve estar entre 1 e ${enforcedMaxDuration} segundos.`,'voice_audio_duration_invalid')
   const stored=await storageProvider.store({organizationId:tenantId,actorId,clientId:interaction.client_id,dataBase64:input.data_url,originalName:input.original_name,mimeType:input.mime_type,durationSeconds:duration})
   try{interaction=await persist(interaction,'AUDIO_STORED',{audio_ref:stored.audio_ref,audio_attachment_id:stored.attachment_id,duration_seconds:stored.duration_seconds,transcript_status:'PENDING',source_context:{...interaction.source_context,capture_mode:'AUDIO',storage_provider:stored.storage_provider,storage_version:stored.storage_version,duration_source:'SERVER_PROBE'}},{tenantId,ownerId,actorId,now})}
   catch(error){await storageProvider.mark({organizationId:tenantId,actorId,audioRef:stored.audio_ref,status:'rejected',metadata:{voiceInteractionId:id,processingStatus:'orphaned_upload',retentionClass:'voice_raw_discardable',processedAt:nowIso(now)}}).catch(()=>null);throw error}
   observe('voice.audio.stored',{voiceInteractionId:id,visitId:interaction.visit_id,sizeBytes:stored.size_bytes,durationSeconds:stored.duration_seconds,storageProvider:stored.storage_provider,outcome:'ok'})
   return {contract_version:'val.voice_interaction.response.v1',voice_interaction:interaction}
  },

  async process({tenantId,ownerId,actorId=ownerId,id,requestId,now}={}){
   const started=Date.now();const scope={tenantId,ownerId,actorId,now};let interaction=await get({tenantId,ownerId,actorId,id})
   if(interaction.state==='CANCELLED')throw voiceError('Esta interação foi cancelada.','voice_interaction_cancelled',409)
   if(['PENDING_REVIEW','CONFIRMED','REJECTED'].includes(interaction.state))return {contract_version:'val.voice_interaction.response.v1',voice_interaction:interaction}
   const leaseExpired=current=>{const updated=new Date(current.updated_at||0).getTime();const anchor=new Date(now||Date.now()).getTime();return !Number.isFinite(updated)||anchor-updated>=180_000}
   if(interaction.state==='TRANSCRIBING'){
    if(!leaseExpired(interaction))throw voiceError('A transcrição já está em processamento.','voice_processing_in_progress',409,true)
    processingControllers.get(id)?.abort();processingControllers.delete(id)
    interaction=await persist(interaction,'FAILED_TRANSCRIPTION',{transcript_status:'FAILED',transcription:{...interaction.transcription,status:'FAILED',error:{code:'voice_processing_lease_expired',status:409,retryable:true}},related_artifacts:{...interaction.related_artifacts,processing_lease:null},error_code:'voice_processing_lease_expired',error_message:'O processamento anterior foi interrompido e pode ser repetido.'},scope)
   }
   if(interaction.state==='EXTRACTING'){
    if(!leaseExpired(interaction))throw voiceError('A extração já está em processamento.','voice_processing_in_progress',409,true)
    processingControllers.get(id)?.abort();processingControllers.delete(id)
    interaction=await persist(interaction,'FAILED_EXTRACTION',{related_artifacts:{...interaction.related_artifacts,processing_lease:null},error_code:'voice_processing_lease_expired',error_message:'A extração anterior foi interrompida e pode ser repetida.'},scope)
   }
   if(['AUDIO_STORED','FAILED_TRANSCRIPTION'].includes(interaction.state)){
    const leaseId=randomUUID()
    interaction=await persist(interaction,'TRANSCRIBING',{transcript_status:'PROCESSING',error_code:null,error_message:null,related_artifacts:{...interaction.related_artifacts,processing_lease:{id:leaseId,stage:'TRANSCRIPTION',claimed_at:nowIso(now)}},transcription:{provider:transcriptionProvider.name||'unknown',model:transcriptionProvider.model||'unknown',version:transcriptionProvider.version||'unknown',status:'PROCESSING',provider_reference:null,language:interaction.language,duration_seconds:interaction.duration_seconds,confidence:null,error:null}},scope)
    const claimedInteraction=interaction;const attempt=Number(interaction.retry_count||0)+1;const controller=new AbortController();processingControllers.set(id,controller)
    let providerResult
    try{
     const audio=await storageProvider.load({organizationId:tenantId,actorId,clientId:interaction.client_id,audioRef:interaction.audio_ref})
     providerResult=await transcriptionProvider.transcribe({...audio,language:interaction.language,durationSeconds:interaction.duration_seconds,signal:controller.signal})
    }catch(error){
     const latest=await get({tenantId,ownerId,actorId,id})
     if(latest.state==='CANCELLED')return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
     if(latest.state!=='TRANSCRIBING'||latest.related_artifacts?.processing_lease?.id!==leaseId)return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
     const metadata=safeProviderMetadata(error,{provider:transcriptionProvider.name,model:transcriptionProvider.model,version:transcriptionProvider.version});const at=nowIso(now)
     const transcript=await repository.saveVoiceTranscript({tenantId,ownerId,actorId,processingLeaseId:leaseId,transcript:{transcript_id:randomUUID(),organization_id:tenantId,voice_interaction_id:id,client_id:claimedInteraction.client_id,visit_id:claimedInteraction.visit_id,created_by:actorId,provider:metadata.provider,model:metadata.model,provider_version:metadata.version,provider_reference:null,status:'FAILED',transcript_text:null,language:null,duration_seconds:claimedInteraction.duration_seconds,confidence:null,attempt_no:attempt,error_code:metadata.error.code,metadata:{retryable:metadata.error.retryable},created_at:at,updated_at:at,completed_at:null}})
     await persist(claimedInteraction,'FAILED_TRANSCRIPTION',{transcript_ref:`voice-transcript:${transcript.transcript_id}`,transcript_status:'FAILED',related_artifacts:{...claimedInteraction.related_artifacts,processing_lease:null},transcription:metadata,error_code:metadata.error.code,error_message:'Não foi possível transcrever o áudio nesta tentativa.'},scope)
     observe('voice.transcription.failed',{voiceInteractionId:id,visitId:claimedInteraction.visit_id,provider:metadata.provider,model:metadata.model,attempt,errorCode:metadata.error.code,durationMs:Date.now()-started,outcome:'error'})
     const storageFailure=error?.name==='VoiceStorageError'||/^(?:audio_|voice_storage_|invalid_audio)/.test(String(error?.code||''))
     throw voiceError(storageFailure?text(error.message,500):'Não foi possível transcrever o áudio. Ele foi preservado; tente novamente ou use texto.',storageFailure?metadata.error.code:'voice_transcription_failed',storageFailure?metadata.error.status:503,metadata.error.retryable)
    }finally{if(processingControllers.get(id)===controller)processingControllers.delete(id)}
    const latest=await get({tenantId,ownerId,actorId,id});if(latest.state==='CANCELLED')return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
    if(latest.state!=='TRANSCRIBING'||latest.related_artifacts?.processing_lease?.id!==leaseId)return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
    const at=nowIso(now);const transcript=await repository.saveVoiceTranscript({tenantId,ownerId,actorId,processingLeaseId:leaseId,transcript:{transcript_id:randomUUID(),organization_id:tenantId,voice_interaction_id:id,client_id:claimedInteraction.client_id,visit_id:claimedInteraction.visit_id,created_by:actorId,provider:providerResult.provider||transcriptionProvider.name||'unknown',model:providerResult.model||transcriptionProvider.model||'unknown',provider_version:providerResult.version||transcriptionProvider.version||'unknown',provider_reference:providerResult.provider_reference||null,status:'COMPLETED',transcript_text:providerResult.text,language:providerResult.language||claimedInteraction.language||'pt-BR',duration_seconds:providerResult.duration_seconds||claimedInteraction.duration_seconds,confidence:providerResult.confidence,attempt_no:attempt,error_code:null,metadata:{request_id:requestId||null},created_at:at,updated_at:at,completed_at:at}})
    interaction=await persist(claimedInteraction,'TRANSCRIBED',{transcript_ref:`voice-transcript:${transcript.transcript_id}`,transcript_status:'COMPLETED',language:transcript.language,duration_seconds:transcript.duration_seconds||claimedInteraction.duration_seconds,related_artifacts:{...claimedInteraction.related_artifacts,processing_lease:null},transcription:{provider:transcript.provider,model:transcript.model,version:transcript.provider_version||'unknown',status:'COMPLETED',provider_reference:transcript.provider_reference,language:transcript.language,duration_seconds:transcript.duration_seconds,confidence:transcript.confidence,error:null},error_code:null,error_message:null},scope)
   }
   interaction=await get({tenantId,ownerId,actorId,id})
   if(!['TRANSCRIBED','FAILED_EXTRACTION'].includes(interaction.state))throw voiceError('A interação ainda não possui áudio ou texto pronto para processar.','voice_process_state_invalid',409)
   const extractionLeaseId=randomUUID();interaction=await persist(interaction,'EXTRACTING',{related_artifacts:{...interaction.related_artifacts,processing_lease:{id:extractionLeaseId,stage:'EXTRACTION',claimed_at:nowIso(now)}},error_code:null,error_message:null},scope)
   const extractionClaim=interaction;interaction=await get({tenantId,ownerId,actorId,id});const controller=new AbortController();processingControllers.set(id,controller)
   try{
    const transcript=interaction.transcript;if(!transcript?.transcript_text)throw voiceError('A transcrição não está disponível para extração.','voice_transcript_unavailable',422)
    const extracted=await extractor.extract({transcript:transcript.transcript_text,voiceInteractionId:id,transcriptRef:interaction.transcript_ref,interactionType:interaction.interaction_type,organizationId:tenantId,clientId:interaction.client_id,now,signal:controller.signal});const candidates=extracted.candidates.map(item=>candidateWithDue(item,{anchor:now}));const artifacts={...interaction.related_artifacts}
    const latest=await get({tenantId,ownerId,actorId,id});if(latest.state==='CANCELLED')return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
    if(latest.state!=='EXTRACTING'||latest.related_artifacts?.processing_lease?.id!==extractionLeaseId)return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
    interaction=await persist(extractionClaim,'PENDING_REVIEW',{candidates,extraction:extracted.extraction_metadata||extracted.metadata||{},related_artifacts:{...artifacts,processing_lease:null},processed_at:nowIso(now),transcript_status:'COMPLETED',confirmation_status:'PENDING_REVIEW',error_code:null,error_message:null},scope)
    if(interaction.audio_ref)await storageProvider.mark({organizationId:tenantId,actorId,audioRef:interaction.audio_ref,status:'interpreted',metadata:{voiceInteractionId:id,processingStatus:'pending_review',retentionClass:'voice_raw_temporary',processedAt:interaction.processed_at}}).catch(()=>null)
    observe('voice.processing.completed',{voiceInteractionId:id,visitId:interaction.visit_id,interactionType:interaction.interaction_type,candidateCount:candidates.length,provider:interaction.transcription.provider,model:interaction.transcription.model,confirmationStatus:'PENDING_REVIEW',modulesCalled:'VCE',durationMs:Date.now()-started,outcome:'ok'})
    return {contract_version:'val.voice_interaction.response.v1',voice_interaction:await get({tenantId,ownerId,actorId,id})}
   }catch(error){
    const latest=await get({tenantId,ownerId,actorId,id});if(latest.state==='CANCELLED')return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
    if(latest.state!=='EXTRACTING'||latest.related_artifacts?.processing_lease?.id!==extractionLeaseId)return {contract_version:'val.voice_interaction.response.v1',voice_interaction:latest}
    await persist(extractionClaim,'FAILED_EXTRACTION',{related_artifacts:{...extractionClaim.related_artifacts,processing_lease:null},error_code:text(error?.code||'voice_extraction_failed',100),error_message:'Não foi possível organizar a transcrição nesta tentativa.'},scope)
    observe('voice.extraction.failed',{voiceInteractionId:id,visitId:extractionClaim.visit_id,errorCode:String(error?.code||'voice_extraction_failed'),durationMs:Date.now()-started,outcome:'error'})
    if(error.statusCode)throw error
    throw voiceError('Não foi possível organizar a transcrição. O áudio e a transcrição foram preservados.','voice_extraction_failed',503,true)
   }finally{if(processingControllers.get(id)===controller)processingControllers.delete(id)}
  },

  async get({tenantId,ownerId,actorId=ownerId,id}={}){return {contract_version:'val.voice_interaction.response.v1',voice_interaction:await get({tenantId,ownerId,actorId,id})}},

  async confirm({tenantId,ownerId,actorId=ownerId,id,input={},requestId,now}={}){
   let interaction=await get({tenantId,ownerId,actorId,id});if(interaction.state==='CANCELLED')throw voiceError('Esta interação foi cancelada.','voice_interaction_cancelled',409);if(!['PENDING_REVIEW','CONFIRMED'].includes(interaction.state))throw voiceError('A interação ainda não está pronta para confirmação.','voice_confirmation_state_invalid',409)
   if(interaction.state==='CONFIRMED'&&(interaction.interaction_type!=='PRE_VISIT'||interaction.related_artifacts.preparation_id)){
    let result=null
    if(interaction.interaction_type==='POST_VISIT')result=await repository.getVisitLearningContext({tenantId,ownerId,visitId:interaction.visit_id})
    if(interaction.interaction_type==='PRE_VISIT'&&interaction.related_artifacts.preparation_id&&typeof repository.getVisitPreparation==='function'){const prepared=await repository.getVisitPreparation({tenantId,ownerId,visitId:interaction.visit_id,preparationId:interaction.related_artifacts.preparation_id});result=prepared?{preparation:prepared.preparation,preparation_result:prepared}:null}
    return {contract_version:'val.voice_confirmation.response.v1',voice_interaction:interaction,...(result?{result}:{}),idempotent:true,message:'Esta interação já foi confirmada.'}
   }
   const reviewed=interaction.state==='CONFIRMED'&&interaction.reviewed_candidates.length?interaction.reviewed_candidates:reviewedCandidates(interaction,input,actorId,now);const confirmed=reviewed.filter(item=>item.review_status==='CONFIRMED')
   let result
   if(interaction.interaction_type==='POST_VISIT'){
    // Validate the consultant's complete review before creating even a pending
    // VisitReport/lifecycle event. A later storage failure may leave a candidate
    // report for safe retry, but invalid input must not mutate visit state.
    const fields=reportFields(confirmed,input,now)
    let reportId=interaction.related_artifacts.visit_report_id;let current=reportId?await repository.getVisitReport({tenantId,ownerId,visitId:interaction.visit_id,id:reportId}):null
    if(!current){const transcript=interaction.transcript;if(!transcript?.transcript_text)throw voiceError('A transcrição confirmada não está disponível para criar o Visit Report.','voice_transcript_unavailable',422);const sourceType=interaction.source_context?.capture_mode==='TEXT_FALLBACK'?'TEXT':'AUDIO';const created=await visitLoop.createReportFromTranscript({tenantId,ownerId,actorId,visitId:interaction.visit_id,transcriptText:transcript.transcript_text,transcriptRef:interaction.transcript_ref,voiceInteractionId:id,sourceType,requestId,now});current=created.visit_report;reportId=current.visit_report_id}
    if(current.confirmation_status==='CONFIRMED')throw voiceError('O Visit Report vinculado já foi confirmado por outro fluxo. Esta interação permaneceu pendente para evitar aplicar candidatos sem atomicidade.','voice_visit_report_already_confirmed',409)
    else{const mappedCandidateIds=new Set([fields.objections,fields.producer_signals,fields.expectations_created,fields.opportunities_detected,fields.commitments_confirmed,fields.next_steps,fields.technical_observations,fields.behavioral_signals,fields.missing_information].flat().map(item=>String(item.item_id)));const voiceMemories=memoryWrites(interaction,confirmed.filter(item=>['FACT_CANDIDATE','HYPOTHESIS'].includes(item.category)&&!mappedCandidateIds.has(String(item.candidate_id))),actorId,now);try{result=await visitLoop.confirmReport({tenantId,ownerId,actorId,visitId:interaction.visit_id,input:{visit_report_id:reportId,fields,commitments_confirmed:fields.commitments_confirmed,next_steps:fields.next_steps,outcome_type:String(input.outcome_type||'NO_DECISION').toUpperCase(),result:{summary:fields.summary},evidence_refs:[{id:`voice-interaction:${id}`,type:'confirmed_voice_interaction'}]},voiceConfirmation:{interaction_id:id,reviewed_candidates:reviewed,memory_writes:voiceMemories,related_artifacts:interaction.related_artifacts},requestId,now})}catch(error){const latest=await get({tenantId,ownerId,actorId,id});if(error?.statusCode===409&&latest.state==='CONFIRMED')return {contract_version:'val.voice_confirmation.response.v1',voice_interaction:latest,idempotent:true,message:'Esta interação já foi confirmada.'};throw error}}
    if(result?.voice_interaction)interaction=result.voice_interaction
    else{interaction=await get({tenantId,ownerId,actorId,id});if(interaction.state!=='CONFIRMED')interaction=await persist(interaction,'CONFIRMED',{reviewed_candidates:reviewed,related_artifacts:{...interaction.related_artifacts,visit_report_id:reportId,outcome_id:result.outcome?.outcome_id||result.outcomes?.at?.(-1)?.outcome_id||null,learning_candidate_id:result.learning_candidate?.candidate_id||result.learning_candidates?.at?.(-1)?.candidate_id||null},confirmed_at:nowIso(now),confirmation_status:'CONFIRMED'},{tenantId,ownerId,actorId,now})}
    if(interaction.audio_ref)await storageProvider.mark({organizationId:tenantId,actorId,audioRef:interaction.audio_ref,status:'confirmed',metadata:{voiceInteractionId:id,processingStatus:'confirmed',retentionClass:'voice_raw_temporary',processedAt:interaction.processed_at}}).catch(()=>null)
   }else{
    result=await repository.confirmVoiceInteraction({tenantId,ownerId,actorId,interactionId:id,reviewedCandidates:reviewed,summary:confirmed.map(item=>item.statement).join(' '),memories:memoryWrites(interaction,confirmed,actorId,now),commitments:commitmentWrites(interaction,confirmed,actorId,requestId,now),opportunities:opportunityWrites(interaction,confirmed),relatedArtifacts:interaction.related_artifacts,requestId,now});interaction=result.voice_interaction
    if(interaction.interaction_type==='PRE_VISIT'&&prepareVisit){
     const preparationRequestId=`voice-preparation:${id}`
     const claim=typeof repository.claimVoicePreparation==='function'?await repository.claimVoicePreparation({tenantId,ownerId,actorId,interactionId:id,requestId:preparationRequestId,now}):{claimed:true,voice_interaction:interaction}
     interaction=claim.voice_interaction
     if(!claim.claimed){
      if(!claim.completed)throw voiceError('A preparação por voz já está sendo recalculada. Tente novamente em instantes.','voice_preparation_in_progress',409,true)
      const prepared=typeof repository.getVisitPreparation==='function'?await repository.getVisitPreparation({tenantId,ownerId,visitId:interaction.visit_id,preparationId:interaction.related_artifacts.preparation_id}):null
      result={...result,...(prepared?{preparation:prepared.preparation,preparation_result:prepared}:{}),idempotent:true}
     }else try{
      const prepared=await prepareVisit({repository,tenantId,actor:{id:actorId,ownerId,role:'consultant'},visitId:interaction.visit_id,requestId:preparationRequestId,now})
      interaction=await repository.updateVoiceInteraction({tenantId,ownerId,actorId,interaction:{...interaction,revision:Number(interaction.revision||1)+1,related_artifacts:{...interaction.related_artifacts,preparation_status:'COMPLETED',preparation_claim_id:null,preparation_id:prepared.preparation.preparation_id,context_snapshot_id:prepared.context_snapshot_ref.id,action_plan_id:prepared.action_plan.action_plan_id},updated_at:nowIso(now)},expectedState:'CONFIRMED',expectedRevision:interaction.revision})
      result={...result,preparation:prepared.preparation,preparation_result:prepared}
     }catch(error){
      await repository.updateVoiceInteraction({tenantId,ownerId,actorId,interaction:{...interaction,revision:Number(interaction.revision||1)+1,related_artifacts:{...interaction.related_artifacts,preparation_status:'FAILED',preparation_claim_id:null,preparation_error_code:text(error?.code||'voice_preparation_failed',100)},updated_at:nowIso(now)},expectedState:'CONFIRMED',expectedRevision:interaction.revision}).catch(()=>null)
      throw error
     }
    }
   }
   observe('voice.interaction.confirmed',{voiceInteractionId:id,visitId:interaction.visit_id,interactionType:interaction.interaction_type,confirmedCandidateCount:confirmed.length,rejectedCandidateCount:reviewed.length-confirmed.length,confirmationStatus:'CONFIRMED',modulesCalled:interaction.interaction_type==='POST_VISIT'?'VisitReport,MMI,MCTX,MIC,MEX,Outcome,LearningCandidate':interaction.interaction_type==='PRE_VISIT'?'MMI,MCTX,MIC,MDI,MVV,MEX,VIS':'MMI,MCTX,MIC,MEX',outcome:'ok'})
   return {contract_version:'val.voice_confirmation.response.v1',voice_interaction:await get({tenantId,ownerId,actorId,id}),result,message:interaction.interaction_type==='PRE_VISIT'?'Contexto confirmado e preparação recalculada.':'A VAL incorporou somente o que você confirmou.'}
  },

  async cancel({tenantId,ownerId,actorId=ownerId,id,now}={}){
   let interaction=await get({tenantId,ownerId,actorId,id,includeTranscript:false});if(interaction.state==='CONFIRMED')throw voiceError('Uma interação confirmada não pode ser cancelada.','voice_confirmation_terminal',409);if(interaction.state==='CANCELLED'){if(interaction.audio_ref)await storageProvider.mark({organizationId:tenantId,actorId,audioRef:interaction.audio_ref,status:'rejected',metadata:{voiceInteractionId:id,processingStatus:'cancelled',retentionClass:'voice_raw_temporary',processedAt:nowIso(now)}}).catch(()=>null);return {contract_version:'val.voice_interaction.response.v1',voice_interaction:interaction}}
   processingControllers.get(id)?.abort();processingControllers.delete(id)
   const transcriptStatus=interaction.transcript_status==='PROCESSING'?'FAILED':interaction.transcript_status
   const transcription=Object.keys(interaction.transcription||{}).length?{...interaction.transcription,status:transcriptStatus,...(transcriptStatus==='FAILED'?{error:{code:'voice_interaction_cancelled',status:409,retryable:false}}:{})}:interaction.transcription
   interaction=await persist(interaction,'CANCELLED',{transcript_status:transcriptStatus,transcription,confirmation_status:'CANCELLED',cancelled_at:nowIso(now)},{tenantId,ownerId,actorId,now});if(interaction.audio_ref)await storageProvider.mark({organizationId:tenantId,actorId,audioRef:interaction.audio_ref,status:'rejected',metadata:{voiceInteractionId:id,processingStatus:'cancelled',retentionClass:'voice_raw_temporary',processedAt:nowIso(now)}}).catch(()=>null);return {contract_version:'val.voice_interaction.response.v1',voice_interaction:interaction}
  }
 })
}
