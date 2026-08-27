import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
  VoiceCaptureContractError,
  VoiceStateTransitionError,
  assertVoiceCandidate,
  buildVoiceCandidate,
  buildVoiceInteraction,
  canTransitionVoiceInteraction,
  transitionVoiceInteraction,
  validateVoiceCandidate,
  validateVoiceInteraction,
  voiceCandidateCategories,
  voiceCandidateReviewStatuses,
  voiceCandidateVersion,
  voiceConfirmationStatuses,
  voiceEpistemicStatuses,
  voiceInteractionStates,
  voiceInteractionTypes,
  voiceInteractionVersion,
  voiceTranscriptStatuses
} from '../server/voice-capture/contracts.js'

const organizationId='00000000-0000-4000-8000-000000000101'
const actorId='00000000-0000-4000-8000-000000000102'
const clientId='00000000-0000-4000-8000-000000000103'
const visitId='00000000-0000-4000-8000-000000000104'
const attachmentId='00000000-0000-4000-8000-000000000105'
const now='2026-08-23T15:00:00.000Z'

const sorted=value=>[...value].sort()

function createdInteraction(overrides={}){
  return buildVoiceInteraction({
    organizationId,
    actorId,
    clientId,
    visitId,
    interactionType:'POST_VISIT',
    sourceContext:{surface:'POST_VISIT',purpose:'VISIT_REPORT'},
    now,
    ...overrides
  })
}

test('Voice Capture contracts — enums públicos permanecem alinhados à migration 005',()=>{
  assert.equal(voiceInteractionVersion,'val.voice_interaction.v1')
  assert.equal(voiceCandidateVersion,'val.voice_candidate.v1')
  assert.deepEqual(sorted(voiceInteractionTypes),sorted(['PRE_VISIT','FIELD_NOTE','POST_VISIT','CLIENT_NOTE','GENERAL_CONTEXT']))
  assert.deepEqual(sorted(voiceInteractionStates),sorted(['CREATED','AUDIO_STORED','TRANSCRIBING','TRANSCRIBED','EXTRACTING','PENDING_REVIEW','CONFIRMED','REJECTED','CANCELLED','FAILED_TRANSCRIPTION','FAILED_EXTRACTION']))
  assert.deepEqual(sorted(voiceTranscriptStatuses),sorted(['PENDING','PROCESSING','COMPLETED','FAILED']))
  assert.deepEqual(sorted(voiceConfirmationStatuses),sorted(['PENDING','PENDING_REVIEW','CONFIRMED','REJECTED','CANCELLED']))
  assert.deepEqual(sorted(voiceCandidateReviewStatuses),sorted(['PENDING','CONFIRMED','REJECTED']))
  assert.deepEqual(sorted(voiceEpistemicStatuses),sorted(['FACT_CANDIDATE','INFERENCE','HYPOTHESIS']))

  const migration=readFileSync(new URL('../database/migrations/20260823_005_voice_capture_expand.sql',import.meta.url),'utf8')
  for(const value of voiceInteractionTypes)assert.match(migration,new RegExp(`interaction_type IN \\([^)]*\\'${value}\\'`,`i`))
  for(const value of voiceInteractionStates)assert.match(migration,new RegExp(`status IN \\([^)]*\\'${value}\\'`,`i`))
  for(const value of voiceTranscriptStatuses)assert.match(migration,new RegExp(`val_voice_transcripts_status_check[\\s\\S]*?status IN \\([^)]*\\'${value}\\'`,`i`))
  assert.match(migration,/contract_version VARCHAR\(80\) NOT NULL DEFAULT 'val\.voice_interaction\.v1'/i)
  assert.match(migration,/duration_seconds>0 AND duration_seconds<=900/i)
})

test('Voice Capture contracts — candidato mantém categoria, epistemologia e revisão humana separadas',()=>{
  const pending=buildVoiceCandidate({
    voiceInteractionId:'voice-1',
    category:'OBJECTION',
    epistemicStatus:'FACT_CANDIDATE',
    statement:'O produtor declarou considerar o investimento alto.',
    sourceRef:'voice-transcript:1',
    confidence:0.82,
    now
  })

  assert.deepEqual(validateVoiceCandidate(pending),[])
  assert.equal(pending.contract_version,voiceCandidateVersion)
  assert.equal(pending.category,'OBJECTION')
  assert.equal(pending.epistemic_status,'FACT_CANDIDATE')
  assert.equal(pending.requires_confirmation,true)
  assert.equal(pending.review_status,'PENDING')
  assert.equal(pending.reviewed_by,null)

  const reviewed=buildVoiceCandidate({
    ...pending,
    review_status:'CONFIRMED',
    reviewed_by:actorId,
    reviewed_at:'2026-08-23T15:05:00.000Z',
    due_at:'2026-08-29T02:59:59.999Z'
  })
  assert.equal(assertVoiceCandidate(reviewed),reviewed)
  assert.equal(reviewed.review_status,'CONFIRMED')
  assert.equal(reviewed.reviewed_by,actorId)
  assert.equal(reviewed.due_at,'2026-08-29T02:59:59.999Z')
  assert.deepEqual(validateVoiceCandidate({...reviewed,due_at:'sem-data'}),['due_at'])

  assert.throws(
    ()=>buildVoiceCandidate({...pending,reviewStatus:'CONFIRMED',reviewedBy:null,reviewedAt:null}),
    error=>error instanceof VoiceCaptureContractError&&error.violations.includes('review')
  )
  assert.equal(voiceCandidateCategories.includes('BEHAVIORAL_SIGNAL'),true)
  assert.equal(voiceCandidateCategories.includes('AGRONOMIC_OBSERVATION'),true)
})

test('Voice Capture contracts — interação nasce pendente e não consolida candidato',()=>{
  const candidate=buildVoiceCandidate({
    voiceInteractionId:'voice-created',
    category:'FACT_CANDIDATE',
    statement:'Informação ainda não confirmada.',
    sourceRef:'voice-transcript:created',
    now
  })
  const interaction=createdInteraction({voiceInteractionId:'voice-created',candidates:[candidate]})

  assert.deepEqual(validateVoiceInteraction(interaction),[])
  assert.equal(interaction.contract_version,voiceInteractionVersion)
  assert.equal(interaction.state,'CREATED')
  assert.equal(interaction.status,'CREATED')
  assert.equal(interaction.transcript_status,'PENDING')
  assert.equal(interaction.confirmation_status,'PENDING')
  assert.equal(interaction.revision,1)
  assert.equal(interaction.candidates[0].requires_confirmation,true)
  assert.equal(interaction.candidates[0].review_status,'PENDING')
  assert.deepEqual(interaction.related_artifacts,{})
})

test('Voice Capture contracts — fluxo feliz respeita todos os estados até confirmação',()=>{
  let interaction=createdInteraction({voiceInteractionId:'voice-happy'})
  interaction=transitionVoiceInteraction(interaction,'AUDIO_STORED',{audioRef:`attachment:${attachmentId}`,durationSeconds:65,now:'2026-08-23T15:01:00.000Z'})
  assert.equal(interaction.transcript_status,'PENDING')
  interaction=transitionVoiceInteraction(interaction,'TRANSCRIBING',{now:'2026-08-23T15:02:00.000Z'})
  assert.equal(interaction.transcript_status,'PROCESSING')
  interaction=transitionVoiceInteraction(interaction,'TRANSCRIBED',{
    transcriptRef:'voice-transcript:happy',
    transcription:{provider:'fixture',model:'fixture-transcriber',version:'fixture.v1',status:'COMPLETED',durationSeconds:65,confidence:0.99},
    now:'2026-08-23T15:03:00.000Z'
  })
  assert.equal(interaction.transcript_status,'COMPLETED')
  interaction=transitionVoiceInteraction(interaction,'EXTRACTING',{now:'2026-08-23T15:04:00.000Z'})
  interaction=transitionVoiceInteraction(interaction,'PENDING_REVIEW',{now:'2026-08-23T15:05:00.000Z'})
  assert.equal(interaction.confirmation_status,'PENDING_REVIEW')
  assert.equal(interaction.processed_at,'2026-08-23T15:05:00.000Z')
  interaction=transitionVoiceInteraction(interaction,'CONFIRMED',{now:'2026-08-23T15:06:00.000Z'})
  assert.equal(interaction.state,'CONFIRMED')
  assert.equal(interaction.confirmation_status,'CONFIRMED')
  assert.equal(interaction.confirmed_at,'2026-08-23T15:06:00.000Z')
  assert.equal(interaction.revision,7)
  assert.deepEqual(validateVoiceInteraction(interaction),[])
})

test('Voice Capture contracts — falhas são recuperáveis na mesma interação e incrementam retry',()=>{
  let interaction=createdInteraction({voiceInteractionId:'voice-retry'})
  interaction=transitionVoiceInteraction(interaction,'AUDIO_STORED',{audioRef:`attachment:${attachmentId}`})
  interaction=transitionVoiceInteraction(interaction,'TRANSCRIBING')
  interaction=transitionVoiceInteraction(interaction,'FAILED_TRANSCRIPTION',{errorCode:'transcription_timeout'})
  assert.equal(interaction.transcript_status,'FAILED')
  assert.equal(interaction.retry_count,0)
  interaction=transitionVoiceInteraction(interaction,'TRANSCRIBING')
  assert.equal(interaction.voice_interaction_id,'voice-retry')
  assert.equal(interaction.retry_count,1)
  assert.equal(interaction.transcript_status,'PROCESSING')

  interaction=transitionVoiceInteraction(interaction,'TRANSCRIBED',{
    transcriptRef:'voice-transcript:retry',
    transcription:{provider:'fixture',model:'fixture-transcriber',version:'fixture.v1',status:'COMPLETED'}
  })
  interaction=transitionVoiceInteraction(interaction,'EXTRACTING')
  interaction=transitionVoiceInteraction(interaction,'FAILED_EXTRACTION',{errorCode:'extraction_timeout'})
  assert.equal(interaction.transcript_status,'COMPLETED')
  interaction=transitionVoiceInteraction(interaction,'EXTRACTING')
  assert.equal(interaction.retry_count,2)
})

test('Voice Capture contracts — transições terminais, estado inconsistente e duração inválida falham fechados',()=>{
  assert.equal(canTransitionVoiceInteraction('CREATED','AUDIO_STORED'),true)
  assert.equal(canTransitionVoiceInteraction('CREATED','CONFIRMED'),false)
  assert.throws(
    ()=>transitionVoiceInteraction(createdInteraction(),'CONFIRMED'),
    error=>error instanceof VoiceStateTransitionError&&error.statusCode===409
  )

  assert.throws(
    ()=>createdInteraction({state:'AUDIO_STORED',audioRef:`attachment:${attachmentId}`,durationSeconds:901}),
    error=>error instanceof VoiceCaptureContractError&&error.violations.includes('duration_seconds')
  )

  assert.throws(
    ()=>createdInteraction({state:'TRANSCRIBING',audioRef:`attachment:${attachmentId}`,transcriptStatus:'COMPLETED'}),
    error=>error instanceof VoiceCaptureContractError&&error.violations.includes('processing_status')
  )

  let cancelled=transitionVoiceInteraction(createdInteraction(),'CANCELLED',{now:'2026-08-23T15:07:00.000Z'})
  assert.equal(cancelled.confirmation_status,'CANCELLED')
  assert.equal(cancelled.cancelled_at,'2026-08-23T15:07:00.000Z')
  assert.equal(canTransitionVoiceInteraction(cancelled,'AUDIO_STORED'),false)
})
