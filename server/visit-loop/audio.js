import {randomUUID} from 'node:crypto'
import {assertVisitLoopContract,validateVisitTranscript,visitTranscriptVersion} from './contracts.js'
import {probeVoiceAudioDuration} from '../voice-capture/storage.js'

export const supportedVisitAudioMimeTypes=Object.freeze(new Set([
 'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg'
]))

const text=(value,max=4000)=>String(value??'').trim().slice(0,max)
const nowIso=value=>(value instanceof Date?value:new Date(value||Date.now())).toISOString()

export class TranscriptionUnavailableError extends Error{
 constructor(message='A transcrição de áudio não está disponível neste ambiente.'){
  super(message);this.name='TranscriptionUnavailableError';this.code='transcription_provider_unavailable';this.statusCode=503;this.safeToRetry=true
 }
}

export function createUnavailableTranscriptionProvider(){
 return Object.freeze({name:'unavailable',async transcribe(){throw new TranscriptionUnavailableError()}})
}

export function createMockTranscriptionProvider({text:transcriptText,fail=false,name='fixture'}={}){
 return Object.freeze({
  name,
  async transcribe(input={}){
   if(fail)throw Object.assign(new Error('Falha controlada de transcrição.'),{code:'transcription_fixture_failure',statusCode:503})
   const transcript=text(typeof transcriptText==='function'?transcriptText(input):transcriptText,20_000)
   if(!transcript)throw Object.assign(new Error('O mock não retornou transcrição.'),{code:'empty_transcript',statusCode:422})
   return {text:transcript,providerReference:`fixture:${randomUUID()}`,language:'pt-BR'}
  }
 })
}

export function validateAudioAttachment(attachment={}){
 const mimeType=text(attachment.mimeType??attachment.mime_type,100).toLowerCase()
 if(!supportedVisitAudioMimeTypes.has(mimeType))throw Object.assign(new Error('O anexo não é um áudio suportado para registro de visita.'),{code:'unsupported_visit_audio',statusCode:415})
 if(!text(attachment.id,180))throw Object.assign(new Error('O áudio precisa estar persistido e referenciado antes da transcrição.'),{code:'audio_attachment_required',statusCode:422})
 return attachment
}

export function buildVisitTranscript(input={}){
 const createdAt=nowIso(input.createdAt??input.now)
 const status=String(input.status||'PENDING').toUpperCase()
 const completedAt=status==='COMPLETED'?nowIso(input.completedAt??input.now):null
 return assertVisitLoopContract({
  contract_version:visitTranscriptVersion,
  version:visitTranscriptVersion,
  transcript_id:text(input.transcriptId,180)||randomUUID(),
  organization_id:text(input.organizationId,180),
  visit_id:text(input.visitId,180),
  client_id:text(input.clientId,180),
  created_by:text(input.createdBy,180),
  interaction_id:input.interactionId?text(input.interactionId,180):null,
  source_attachment_id:input.attachmentId?text(input.attachmentId,180):null,
  provider:text(input.provider,100)||'unavailable',
  provider_reference:input.providerReference?text(input.providerReference,240):null,
  language:input.language?text(input.language,30):null,
  status,
  transcript_text:status==='COMPLETED'?text(input.transcriptText,20_000):null,
  error_code:status==='FAILED'?text(input.errorCode,100):null,
  metadata:input.metadata&&typeof input.metadata==='object'&&!Array.isArray(input.metadata)?input.metadata:{},
  created_at:createdAt,
  updated_at:nowIso(input.updatedAt??input.now),
  completed_at:completedAt
 },validateVisitTranscript,'VisitTranscript v1')
}

export async function transcribeVisitAudio({provider,attachment,organizationId,visitId,clientId,createdBy,now}={}){
 validateAudioAttachment(attachment)
 const effectiveProvider=provider||createUnavailableTranscriptionProvider()
 let durationSeconds=null
 const base={organizationId,visitId,clientId,createdBy,attachmentId:attachment.id,provider:effectiveProvider.name||'unknown',now,metadata:{mime_type:attachment.mimeType,size_bytes:attachment.sizeBytes,duration_seconds:null}}
 try{
  if(effectiveProvider.requiresVerifiedDuration){const bytes=Buffer.from(String(attachment.dataBase64||''),'base64');durationSeconds=await probeVoiceAudioDuration({bytes,mimeType:attachment.mimeType});base.metadata.duration_seconds=durationSeconds}
  const result=await effectiveProvider.transcribe({attachment,organizationId,visitId,clientId,durationSeconds})
  return buildVisitTranscript({...base,status:'COMPLETED',transcriptText:result.text,providerReference:result.providerReference??result.provider_reference,language:result.language||'pt-BR'})
 }catch(error){
  const transcript=buildVisitTranscript({...base,status:'FAILED',errorCode:String(error?.code||'transcription_failed').slice(0,100)})
  error.transcript=transcript
  throw error
 }
}
