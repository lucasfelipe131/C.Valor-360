import {randomUUID} from 'node:crypto'

export const voiceInteractionVersion='val.voice_interaction.v1'
export const voiceCandidateVersion='val.voice_candidate.v1'

export const voiceInteractionTypes=Object.freeze([
  'PRE_VISIT',
  'FIELD_NOTE',
  'POST_VISIT',
  'CLIENT_NOTE',
  'GENERAL_CONTEXT'
])

export const voiceInteractionStates=Object.freeze([
  'CREATED',
  'AUDIO_STORED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'EXTRACTING',
  'PENDING_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'FAILED_TRANSCRIPTION',
  'FAILED_EXTRACTION',
  'CANCELLED'
])

export const voiceTranscriptStatuses=Object.freeze([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
])

export const voiceConfirmationStatuses=Object.freeze([
  'PENDING',
  'PENDING_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED'
])

export const voiceCandidateCategories=Object.freeze([
  'FACT_CANDIDATE',
  'COMMITMENT_CANDIDATE',
  'OBJECTION',
  'OPPORTUNITY_CANDIDATE',
  'BEHAVIORAL_SIGNAL',
  'AGRONOMIC_OBSERVATION',
  'EXPECTATION',
  'NEXT_STEP',
  'MISSING_INFORMATION',
  'HYPOTHESIS'
])

// A category describes what the candidate is about. Epistemic status describes
// how strongly the transcript supports it; these concepts intentionally remain
// independent.
export const voiceEpistemicStatuses=Object.freeze([
  'FACT_CANDIDATE',
  'INFERENCE',
  'HYPOTHESIS'
])

export const voiceCandidateReviewStatuses=Object.freeze(['PENDING','CONFIRMED','REJECTED'])

export const voiceStateTransitions=Object.freeze({
  CREATED:Object.freeze(['AUDIO_STORED','TRANSCRIBED','CANCELLED']),
  AUDIO_STORED:Object.freeze(['TRANSCRIBING','CANCELLED']),
  TRANSCRIBING:Object.freeze(['TRANSCRIBED','FAILED_TRANSCRIPTION','CANCELLED']),
  FAILED_TRANSCRIPTION:Object.freeze(['TRANSCRIBING','CANCELLED']),
  TRANSCRIBED:Object.freeze(['EXTRACTING','CANCELLED']),
  EXTRACTING:Object.freeze(['PENDING_REVIEW','FAILED_EXTRACTION','CANCELLED']),
  FAILED_EXTRACTION:Object.freeze(['EXTRACTING','CANCELLED']),
  PENDING_REVIEW:Object.freeze(['CONFIRMED','REJECTED','CANCELLED']),
  CONFIRMED:Object.freeze([]),
  REJECTED:Object.freeze([]),
  CANCELLED:Object.freeze([])
})

const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=(value,max=2_000)=>String(value??'').trim().slice(0,max)
const optionalText=(value,max)=>value==null||value===''?null:text(value,max)
const timestamp=value=>value==null||value===''||!Number.isNaN(new Date(value).getTime())
const finite=value=>Number.isFinite(Number(value))
const unique=values=>[...new Set(values)]
const iso=value=>(value instanceof Date?value:new Date(value||Date.now())).toISOString()
const enumValue=(value,allowed,fallback)=>allowed.includes(String(value||'').toUpperCase())?String(value).toUpperCase():fallback
const confidence=value=>value==null?null:Math.max(0,Math.min(1,Number(value)))

function manualTextCapture(value={}){
  const context=object(value.source_context)?value.source_context:{}
  const mode=String(context.capture_mode??context.input_mode??context.source_type??'').toUpperCase()
  return ['TEXT','MANUAL_TEXT','TEXT_FALLBACK'].includes(mode)
}

function defaultEpistemicStatus(category){
  if(category==='HYPOTHESIS')return 'HYPOTHESIS'
  if(category==='OPPORTUNITY_CANDIDATE')return 'INFERENCE'
  return 'FACT_CANDIDATE'
}

function defaultTranscriptStatus(state){
  if(state==='TRANSCRIBING')return 'PROCESSING'
  if(['TRANSCRIBED','EXTRACTING','PENDING_REVIEW','CONFIRMED','REJECTED','FAILED_EXTRACTION'].includes(state))return 'COMPLETED'
  if(state==='FAILED_TRANSCRIPTION')return 'FAILED'
  return 'PENDING'
}

function defaultConfirmationStatus(state){
  if(state==='PENDING_REVIEW')return 'PENDING_REVIEW'
  if(state==='CONFIRMED')return 'CONFIRMED'
  if(state==='REJECTED')return 'REJECTED'
  if(state==='CANCELLED')return 'CANCELLED'
  return 'PENDING'
}

function normalizeProviderError(value){
  if(!object(value))return null
  return {
    code:text(value.code||'transcription_failed',100),
    status:finite(value.status)?Number(value.status):null,
    retryable:Boolean(value.retryable)
  }
}

export function normalizeTranscriptionMetadata(value={}){
  if(!object(value))return null
  if(!Object.keys(value).length)return {}
  return {
    provider:text(value.provider||'unknown',100),
    model:text(value.model||'unknown',120),
    version:text(value.version||'unknown',120),
    status:enumValue(value.status,voiceTranscriptStatuses,'FAILED'),
    provider_reference:optionalText(value.provider_reference??value.providerReference,240),
    language:optionalText(value.language,30),
    duration_seconds:value.duration_seconds==null&&value.durationSeconds==null?null:Math.max(0,Number(value.duration_seconds??value.durationSeconds)),
    confidence:confidence(value.confidence),
    error:normalizeProviderError(value.error)
  }
}

export class VoiceCaptureContractError extends Error{
  constructor(contract,violations){
    super(`${contract} inválido.`)
    this.name='VoiceCaptureContractError'
    this.code='voice_capture_contract_invalid'
    this.contract=contract
    this.violations=violations
    this.statusCode=422
  }
}

export class VoiceStateTransitionError extends Error{
  constructor(from,to){
    super(`Transição de voz inválida: ${from} -> ${to}.`)
    this.name='VoiceStateTransitionError'
    this.code='voice_state_transition_invalid'
    this.from=from
    this.to=to
    this.statusCode=409
  }
}

export function validateVoiceCandidate(value){
  const violations=[]
  if(!object(value))return ['voice_candidate']
  if(value.contract_version!==voiceCandidateVersion||value.version!==voiceCandidateVersion)violations.push('contract_version')
  for(const key of ['candidate_id','voice_interaction_id','category','epistemic_status','statement','source_ref','review_status','created_at'])if(!text(value[key]))violations.push(key)
  if(!voiceCandidateCategories.includes(value.category))violations.push('category')
  if(!voiceEpistemicStatuses.includes(value.epistemic_status))violations.push('epistemic_status')
  if(value.requires_confirmation!==true)violations.push('requires_confirmation')
  if(!voiceCandidateReviewStatuses.includes(value.review_status))violations.push('review_status')
  if(!finite(value.confidence)||Number(value.confidence)<0||Number(value.confidence)>1)violations.push('confidence')
  if(value.due_at!==undefined&&value.due_at!==null&&!timestamp(value.due_at))violations.push('due_at')
  if(!timestamp(value.created_at)||!timestamp(value.reviewed_at))violations.push('timestamps')
  if(value.review_status!=='PENDING'&&(!text(value.reviewed_by)||!text(value.reviewed_at)))violations.push('review')
  if(!object(value.metadata))violations.push('metadata')
  return unique(violations)
}

export function assertVoiceCandidate(value){
  const violations=validateVoiceCandidate(value)
  if(violations.length)throw new VoiceCaptureContractError('VoiceCandidate v1',violations)
  return value
}

export function buildVoiceCandidate(input={}){
  const category=enumValue(input.category,voiceCandidateCategories,'FACT_CANDIDATE')
  const reviewStatus=enumValue(input.reviewStatus??input.review_status,voiceCandidateReviewStatuses,'PENDING')
  const dueAt=input.dueAt??input.due_at
  return assertVoiceCandidate({
    contract_version:voiceCandidateVersion,
    version:voiceCandidateVersion,
    candidate_id:text(input.candidateId??input.candidate_id,180)||randomUUID(),
    voice_interaction_id:text(input.voiceInteractionId??input.voice_interaction_id,180),
    category,
    epistemic_status:enumValue(input.epistemicStatus??input.epistemic_status,voiceEpistemicStatuses,defaultEpistemicStatus(category)),
    statement:text(input.statement,2_000),
    evidence_excerpt:optionalText(input.evidenceExcerpt??input.evidence_excerpt,800),
    source_ref:text(input.sourceRef??input.source_ref,240),
    confidence:confidence(input.confidence)??0.5,
    requires_confirmation:true,
    review_status:reviewStatus,
    reviewed_by:reviewStatus==='PENDING'?null:optionalText(input.reviewedBy??input.reviewed_by,180),
    reviewed_at:reviewStatus==='PENDING'?null:optionalText(input.reviewedAt??input.reviewed_at,40),
    ...(dueAt===undefined?{}:{due_at:dueAt===null||dueAt===''?null:iso(dueAt)}),
    metadata:object(input.metadata)?structuredClone(input.metadata):{},
    created_at:iso(input.createdAt??input.created_at??input.now)
  })
}

export function validateVoiceInteraction(value){
  const violations=[]
  if(!object(value))return ['voice_interaction']
  if(value.contract_version!==voiceInteractionVersion||value.version!==voiceInteractionVersion)violations.push('contract_version')
  for(const key of ['voice_interaction_id','organization_id','actor_id','client_id','interaction_type','state','transcript_status','confirmation_status','created_at','updated_at'])if(!text(value[key]))violations.push(key)
  if(!voiceInteractionTypes.includes(value.interaction_type))violations.push('interaction_type')
  if(!voiceInteractionStates.includes(value.state))violations.push('state')
  if(!voiceTranscriptStatuses.includes(value.transcript_status))violations.push('transcript_status')
  if(!voiceConfirmationStatuses.includes(value.confirmation_status))violations.push('confirmation_status')
  if(!object(value.source_context))violations.push('source_context')
  if(!Array.isArray(value.candidates))violations.push('candidates')
  else value.candidates.forEach((candidate,index)=>{
    for(const violation of validateVoiceCandidate(candidate))violations.push(`candidates[${index}].${violation}`)
    if(String(candidate?.voice_interaction_id)!==String(value.voice_interaction_id))violations.push(`candidates[${index}].voice_interaction_id`)
  })
  if(!Number.isInteger(Number(value.revision))||Number(value.revision)<1)violations.push('revision')
  if(value.duration_seconds!==null&&value.duration_seconds!==undefined&&(!finite(value.duration_seconds)||Number(value.duration_seconds)<=0||Number(value.duration_seconds)>900))violations.push('duration_seconds')
  if(!timestamp(value.created_at)||!timestamp(value.updated_at)||!timestamp(value.processed_at)||!timestamp(value.confirmed_at))violations.push('timestamps')
  if(value.status!==undefined&&value.status!==value.state)violations.push('status_consistency')
  if(!['CREATED','CANCELLED'].includes(value.state)&&!text(value.audio_ref)&&!manualTextCapture(value))violations.push('audio_ref')
  if(['AUDIO_STORED','TRANSCRIBING','FAILED_TRANSCRIPTION'].includes(value.state)&&!text(value.audio_ref))violations.push('audio_ref')
  if(['TRANSCRIBED','EXTRACTING','PENDING_REVIEW','CONFIRMED','REJECTED','FAILED_EXTRACTION'].includes(value.state)&&!text(value.transcript_ref))violations.push('transcript_ref')
  if(value.state==='TRANSCRIBING'&&value.transcript_status!=='PROCESSING')violations.push('processing_status')
  if(value.state==='FAILED_TRANSCRIPTION'&&value.transcript_status!=='FAILED')violations.push('failed_status')
  if(['TRANSCRIBED','EXTRACTING','PENDING_REVIEW','CONFIRMED','REJECTED','FAILED_EXTRACTION'].includes(value.state)&&value.transcript_status!=='COMPLETED')violations.push('completed_status')
  if(value.state==='PENDING_REVIEW'&&value.confirmation_status!=='PENDING_REVIEW')violations.push('pending_review_status')
  if(value.state==='CONFIRMED'&&(value.confirmation_status!=='CONFIRMED'||!text(value.confirmed_at)))violations.push('confirmation')
  if(value.state==='REJECTED'&&value.confirmation_status!=='REJECTED')violations.push('rejection')
  if(value.state==='CANCELLED'&&value.confirmation_status!=='CANCELLED')violations.push('cancellation')
  if(!Array.isArray(value.reviewed_candidates))violations.push('reviewed_candidates')
  if(!object(value.extraction))violations.push('extraction')
  if(!object(value.related_artifacts))violations.push('related_artifacts')
  if(!Number.isInteger(Number(value.retry_count))||Number(value.retry_count)<0)violations.push('retry_count')
  if(value.transcription!==null&&value.transcription!==undefined){
    if(!object(value.transcription))violations.push('transcription')
    else if(Object.keys(value.transcription).length){
      for(const key of ['provider','model','version','status'])if(!text(value.transcription[key]))violations.push(`transcription.${key}`)
      if(!voiceTranscriptStatuses.includes(value.transcription.status))violations.push('transcription.status')
      if(value.transcription.duration_seconds!==null&&value.transcription.duration_seconds!==undefined&&(!finite(value.transcription.duration_seconds)||Number(value.transcription.duration_seconds)<=0||Number(value.transcription.duration_seconds)>900))violations.push('transcription.duration_seconds')
      if(value.transcription.confidence!==null&&value.transcription.confidence!==undefined&&(!finite(value.transcription.confidence)||Number(value.transcription.confidence)<0||Number(value.transcription.confidence)>1))violations.push('transcription.confidence')
      if(value.transcription.status!==value.transcript_status)violations.push('transcription.status_consistency')
    }
  }
  return unique(violations)
}

export function assertVoiceInteraction(value){
  const violations=validateVoiceInteraction(value)
  if(violations.length)throw new VoiceCaptureContractError('VoiceInteraction v1',violations)
  return value
}

export function buildVoiceInteraction(input={}){
  const state=enumValue(input.state,voiceInteractionStates,'CREATED')
  const id=text(input.voiceInteractionId??input.voice_interaction_id,180)||randomUUID()
  const transcriptStatus=enumValue(input.transcriptStatus??input.transcript_status,voiceTranscriptStatuses,defaultTranscriptStatus(state))
  const candidates=(Array.isArray(input.candidates)?input.candidates:[]).map(candidate=>buildVoiceCandidate({...candidate,voiceInteractionId:id}))
  return assertVoiceInteraction({
    contract_version:voiceInteractionVersion,
    version:voiceInteractionVersion,
    voice_interaction_id:id,
    organization_id:text(input.organizationId??input.organization_id,180),
    actor_id:text(input.actorId??input.actor_id,180),
    client_id:text(input.clientId??input.client_id,180),
    visit_id:optionalText(input.visitId??input.visit_id,180),
    interaction_type:enumValue(input.interactionType??input.interaction_type,voiceInteractionTypes,'GENERAL_CONTEXT'),
    state,
    status:state,
    audio_ref:optionalText(input.audioRef??input.audio_ref,240),
    transcript_ref:optionalText(input.transcriptRef??input.transcript_ref,240),
    transcript_status:transcriptStatus,
    duration_seconds:input.durationSeconds==null&&input.duration_seconds==null?null:Math.max(0,Number(input.durationSeconds??input.duration_seconds)),
    language:optionalText(input.language,30),
    confirmation_status:enumValue(input.confirmationStatus??input.confirmation_status,voiceConfirmationStatuses,defaultConfirmationStatus(state)),
    source_context:object(input.sourceContext??input.source_context)?structuredClone(input.sourceContext??input.source_context):{},
    transcription:normalizeTranscriptionMetadata(input.transcription??input.transcription_metadata??input.transcriptionMetadata)||{},
    extraction:object(input.extraction??input.extraction_metadata)?structuredClone(input.extraction??input.extraction_metadata):{},
    candidates,
    reviewed_candidates:Array.isArray(input.reviewedCandidates??input.reviewed_candidates)?structuredClone(input.reviewedCandidates??input.reviewed_candidates):[],
    related_artifacts:object(input.relatedArtifacts??input.related_artifacts)?structuredClone(input.relatedArtifacts??input.related_artifacts):{},
    retry_count:Math.max(0,Math.floor(Number(input.retryCount??input.retry_count)||0)),
    revision:Math.max(1,Math.floor(Number(input.revision)||1)),
    created_at:iso(input.createdAt??input.created_at??input.now),
    updated_at:iso(input.updatedAt??input.updated_at??input.now),
    processed_at:optionalText(input.processedAt??input.processed_at,40),
    confirmed_at:optionalText(input.confirmedAt??input.confirmed_at,40),
    cancelled_at:optionalText(input.cancelledAt??input.cancelled_at,40),
    error_code:optionalText(input.errorCode??input.error_code,100),
    error_message:optionalText(input.errorMessage??input.error_message,500)
  })
}

export function canTransitionVoiceInteraction(from,to){
  const source=String(typeof from==='object'?from?.state:from||'').toUpperCase()
  const target=String(to||'').toUpperCase()
  return Boolean(voiceStateTransitions[source]?.includes(target))
}

export function assertVoiceStateTransition(from,to){
  const source=String(typeof from==='object'?from?.state:from||'').toUpperCase()
  const target=String(to||'').toUpperCase()
  if(!canTransitionVoiceInteraction(source,target))throw new VoiceStateTransitionError(source,target)
  return true
}

export function transitionVoiceInteraction(current,nextState,changes={}){
  assertVoiceInteraction(current)
  const target=String(nextState||'').toUpperCase()
  assertVoiceStateTransition(current.state,target)
  const at=iso(changes.now)
  const patch={...changes}
  delete patch.now
  const input={...current,...patch,state:target,revision:Number(current.revision)+1,updated_at:at}
  input.status=target
  if(patch.transcript_status===undefined&&patch.transcriptStatus===undefined)input.transcript_status=defaultTranscriptStatus(target)
  if(patch.confirmation_status===undefined&&patch.confirmationStatus===undefined)input.confirmation_status=defaultConfirmationStatus(target)
  if(target==='PENDING_REVIEW'&&!input.processed_at)input.processed_at=at
  if(target==='TRANSCRIBING'&&current.state==='FAILED_TRANSCRIPTION')input.retry_count=Number(current.retry_count||0)+1
  if(target==='EXTRACTING'&&current.state==='FAILED_EXTRACTION')input.retry_count=Number(current.retry_count||0)+1
  if(target==='CONFIRMED'){
    input.confirmed_at=patch.confirmed_at??patch.confirmedAt??at
  }
  if(target==='CANCELLED')input.cancelled_at=patch.cancelled_at??patch.cancelledAt??at
  return buildVoiceInteraction(input)
}

export const voiceCaptureContracts=Object.freeze({
  interaction:voiceInteractionVersion,
  candidate:voiceCandidateVersion
})
