import {execFile} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'

export const voiceAudioStorageVersion='val.voice_audio_storage.v1'
export const repositoryAttachmentRefPrefix='attachment:'
export const maxVoiceAudioBytes=6_000_000
export const maxVoiceAudioDurationSeconds=900

const execFileAsync=promisify(execFile)

const audioMimeTypes=new Set(['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg'])
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const text=(value,max=240)=>String(value??'').trim().slice(0,max)

export class VoiceStorageError extends Error{
  constructor(message,{code='voice_storage_error',statusCode=422,retryable=false}={}){
    super(message)
    this.name='VoiceStorageError'
    this.code=code
    this.statusCode=statusCode
    this.safeToRetry=Boolean(retryable)
  }
}

function audioBuffer(input={}){
  const bytes=input.bytes??input.buffer
  if(Buffer.isBuffer(bytes))return bytes
  if(bytes instanceof Uint8Array)return Buffer.from(bytes)
  const raw=String(input.dataBase64||input.data_base64||'')
  const match=raw.match(/^data:([^;,]+)[^,]*;base64,([A-Za-z0-9+/=\s]+)$/i)
  const encoded=(match?match[2]:raw).replace(/\s/g,'')
  if(!encoded||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4===1)return null
  const buffer=Buffer.from(encoded,'base64')
  if(!buffer.length)return null
  const expected=encoded.replace(/=+$/,'')
  if(buffer.toString('base64').replace(/=+$/,'')!==expected)return null
  return buffer
}

function dataUrlMime(input={}){
  return String(input.dataBase64||input.data_base64||'').match(/^data:([^;,]+)[^,]*;base64,/i)?.[1]?.toLowerCase()||null
}

function safeFileName(value,mimeType){
  const extensions={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm','audio/ogg':'ogg'}
  const fallback=`voice.${extensions[mimeType]||'audio'}`
  return (text(value,240).normalize('NFKC').replace(/[\/\\<>:\"|?*\u0000-\u001f]/g,'-')||fallback).slice(0,240)
}

function extensionForMime(mimeType){
  return {'audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm','audio/ogg':'ogg'}[mimeType]||'audio'
}

function finiteDuration(value){
  const duration=Number(value)
  return Number.isFinite(duration)&&duration>0?duration:null
}

function timeBaseSeconds(value){
  const [numerator,denominator]=String(value||'').split('/').map(Number)
  if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||numerator<=0||denominator<=0)return null
  return numerator/denominator
}

export function durationFromFfprobeMetadata(output){
  let metadata
  try{metadata=JSON.parse(String(output||''))}catch{return null}
  const candidates=[]
  const formatDuration=finiteDuration(metadata?.format?.duration)
  if(formatDuration)candidates.push(formatDuration)
  for(const stream of Array.isArray(metadata?.streams)?metadata.streams:[]){
    const streamDuration=finiteDuration(stream?.duration)
    if(streamDuration)candidates.push(streamDuration)
    const durationTimestamp=Number(stream?.duration_ts)
    const timeBase=timeBaseSeconds(stream?.time_base)
    if(Number.isFinite(durationTimestamp)&&durationTimestamp>0&&timeBase)candidates.push(durationTimestamp*timeBase)
  }
  return candidates.length?Math.max(...candidates):null
}

export function durationFromFfprobePackets(output){
  let firstTimestamp=Infinity
  let lastTimestamp=-Infinity
  let lastEnd=-Infinity
  for(const line of String(output||'').split(/\r?\n/)){
    if(!line.trim())continue
    const [rawPts,rawDts,rawDuration]=line.split(',')
    const pts=Number(rawPts)
    const dts=Number(rawDts)
    const packetDuration=finiteDuration(rawDuration)||0
    const timestamp=Number.isFinite(pts)?pts:Number.isFinite(dts)?dts:null
    if(timestamp===null)continue
    firstTimestamp=Math.min(firstTimestamp,timestamp)
    lastTimestamp=Math.max(lastTimestamp,timestamp)
    lastEnd=Math.max(lastEnd,timestamp+packetDuration)
  }
  if(!Number.isFinite(firstTimestamp)||!Number.isFinite(lastTimestamp))return null
  const end=Number.isFinite(lastEnd)&&lastEnd>lastTimestamp?lastEnd:lastTimestamp
  return finiteDuration(end-firstTimestamp)
}

export async function probeVoiceAudioDuration({bytes,mimeType,command='ffprobe',timeoutMs=8_000,probeRunner=execFileAsync}={}){
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw new VoiceStorageError('O áudio está vazio ou não pôde ser lido.',{code:'invalid_audio',statusCode:422})
  const directory=await mkdtemp(join(tmpdir(),'val-voice-probe-'))
  const filePath=join(directory,`audio.${extensionForMime(mimeType)}`)
  try{
    await writeFile(filePath,bytes,{mode:0o600})
    const metadataResult=await probeRunner(command,['-v','error','-select_streams','a:0','-show_entries','format=duration:stream=duration,duration_ts,time_base','-of','json',filePath],{timeout:timeoutMs,maxBuffer:65_536,windowsHide:true})
    let duration=durationFromFfprobeMetadata(metadataResult?.stdout)
    if(!duration){
      const packetResult=await probeRunner(command,['-v','error','-select_streams','a:0','-show_entries','packet=pts_time,dts_time,duration_time','-of','csv=p=0',filePath],{timeout:timeoutMs,maxBuffer:2_000_000,windowsHide:true})
      duration=durationFromFfprobePackets(packetResult?.stdout)
    }
    if(!Number.isFinite(duration)||duration<=0)throw new VoiceStorageError('Não foi possível verificar a duração real do áudio.',{code:'audio_duration_unverified',statusCode:422})
    if(duration>maxVoiceAudioDurationSeconds)throw new VoiceStorageError('O áudio excede o limite de 15 minutos.',{code:'audio_too_long',statusCode:422})
    return duration
  }catch(error){
    if(error instanceof VoiceStorageError)throw error
    const unavailable=error?.code==='ENOENT'
    throw new VoiceStorageError(unavailable?'A validação segura de duração não está disponível neste ambiente.':'O arquivo não pôde ser validado como áudio reproduzível.',{code:unavailable?'audio_probe_unavailable':'invalid_audio_container',statusCode:unavailable?503:415,retryable:unavailable})
  }finally{
    await rm(directory,{recursive:true,force:true})
  }
}

function assertScope({organizationId,actorId,clientId}){
  if(!text(organizationId,180)||!text(actorId,180)||!text(clientId,180))throw new VoiceStorageError('Organização, usuário e produtor são obrigatórios para armazenar áudio.',{code:'voice_storage_scope_required',statusCode:422})
}

function validSignature(bytes,mimeType){
  if(mimeType==='audio/wav'||mimeType==='audio/x-wav')return bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WAVE'
  if(mimeType==='audio/ogg')return bytes.length>=4&&bytes.subarray(0,4).toString('ascii')==='OggS'
  if(mimeType==='audio/webm')return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3
  if(mimeType==='audio/mp4'||mimeType==='audio/x-m4a')return bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp'
  if(mimeType==='audio/mpeg'||mimeType==='audio/mp3')return bytes.length>=3&&(bytes.subarray(0,3).toString('ascii')==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))
  return false
}

export function validateVoiceAudio(input={}){
  const declaredMime=text(input.mimeType??input.mime_type,100).split(';',1)[0].trim().toLowerCase()
  const embeddedMime=dataUrlMime(input)
  if(declaredMime&&embeddedMime&&declaredMime!==embeddedMime)throw new VoiceStorageError('O tipo declarado não corresponde ao conteúdo enviado.',{code:'audio_mime_mismatch',statusCode:415})
  const mimeType=declaredMime||embeddedMime||''
  if(!audioMimeTypes.has(mimeType))throw new VoiceStorageError('O formato do áudio não é suportado.',{code:'unsupported_audio',statusCode:415})
  const bytes=audioBuffer(input)
  if(!bytes?.length)throw new VoiceStorageError('O áudio está vazio ou não pôde ser lido.',{code:'invalid_audio',statusCode:422})
  if(bytes.length>maxVoiceAudioBytes)throw new VoiceStorageError('O áudio excede o limite temporário de 6 MB.',{code:'audio_too_large',statusCode:413})
  if(!validSignature(bytes,mimeType))throw new VoiceStorageError('O conteúdo do arquivo não corresponde a um áudio válido.',{code:'invalid_audio_signature',statusCode:415})
  const rawDuration=input.durationSeconds??input.duration_seconds
  const durationSeconds=rawDuration==null||rawDuration===''?null:Number(rawDuration)
  if(durationSeconds!==null&&(!Number.isFinite(durationSeconds)||durationSeconds<=0))throw new VoiceStorageError('A duração do áudio é inválida.',{code:'invalid_audio_duration',statusCode:422})
  if(durationSeconds!==null&&durationSeconds>maxVoiceAudioDurationSeconds)throw new VoiceStorageError('O áudio excede o limite de 15 minutos.',{code:'audio_too_long',statusCode:422})
  return {bytes,mimeType,durationSeconds,originalName:safeFileName(input.originalName??input.fileName,mimeType)}
}

export function buildRepositoryAttachmentRef(attachmentId){
  const id=text(attachmentId,180)
  if(!uuidPattern.test(id))throw new VoiceStorageError('Referência de áudio inválida.',{code:'invalid_audio_ref',statusCode:422})
  return `${repositoryAttachmentRefPrefix}${id}`
}

export function parseRepositoryAttachmentRef(audioRef){
  const value=text(audioRef,240)
  const id=value.startsWith(repositoryAttachmentRefPrefix)?value.slice(repositoryAttachmentRefPrefix.length):value
  if(!uuidPattern.test(id))throw new VoiceStorageError('Referência de áudio inválida.',{code:'invalid_audio_ref',statusCode:422})
  return id
}

export class VoiceAudioStorage{
  constructor({name='unavailable',version=voiceAudioStorageVersion}={}){
    this.name=name
    this.version=version
  }

  async store(){throw new VoiceStorageError('O armazenamento de áudio não está disponível.',{code:'voice_storage_unavailable',statusCode:503,retryable:true})}
  async load(){throw new VoiceStorageError('O armazenamento de áudio não está disponível.',{code:'voice_storage_unavailable',statusCode:503,retryable:true})}
}

export class RepositoryAttachmentVoiceStorage extends VoiceAudioStorage{
  constructor({repository,durationProbe=probeVoiceAudioDuration,maxAudioBytes=maxVoiceAudioBytes,maxDurationSeconds=maxVoiceAudioDurationSeconds}={}){
    super({name:'repository_attachment',version:voiceAudioStorageVersion})
    if(!repository?.createAttachment||!repository?.getAttachment)throw new TypeError('RepositoryAttachmentVoiceStorage requer createAttachment e getAttachment.')
    this.repository=repository
    this.durationProbe=durationProbe
    this.maxAudioBytes=Math.max(1_024,Math.min(maxVoiceAudioBytes,Number(maxAudioBytes)||maxVoiceAudioBytes))
    this.maxDurationSeconds=Math.max(1,Math.min(maxVoiceAudioDurationSeconds,Number(maxDurationSeconds)||maxVoiceAudioDurationSeconds))
  }

  async store(input={}){
    const organizationId=text(input.organizationId??input.organization_id,180)
    const actorId=text(input.actorId??input.actor_id,180)
    const clientId=text(input.clientId??input.client_id,180)
    assertScope({organizationId,actorId,clientId})
    const audio=validateVoiceAudio(input)
    if(audio.bytes.length>this.maxAudioBytes)throw new VoiceStorageError(`O áudio excede o limite configurado de ${this.maxAudioBytes} bytes.`,{code:'audio_too_large',statusCode:413})
    const measuredDuration=Number(await this.durationProbe({bytes:audio.bytes,mimeType:audio.mimeType}))
    if(!Number.isFinite(measuredDuration)||measuredDuration<=0)throw new VoiceStorageError('Não foi possível verificar a duração real do áudio.',{code:'audio_duration_unverified',statusCode:422})
    if(measuredDuration>this.maxDurationSeconds)throw new VoiceStorageError(`O áudio excede o limite configurado de ${this.maxDurationSeconds} segundos.`,{code:'audio_too_long',statusCode:422})
    const attachment=await this.repository.createAttachment({
      tenantId:organizationId,
      ownerId:actorId,
      clientId,
      originalName:audio.originalName,
      mimeType:audio.mimeType,
      sizeBytes:audio.bytes.length,
      dataBase64:audio.bytes.toString('base64'),
      deduplicate:false
    })
    const audioRef=buildRepositoryAttachmentRef(attachment.id)
    return {
      audio_ref:audioRef,
      audioRef,
      attachment_id:String(attachment.id),
      storage_provider:this.name,
      storage_version:this.version,
      mime_type:attachment.mimeType||audio.mimeType,
      size_bytes:Number(attachment.sizeBytes||audio.bytes.length),
      original_name:attachment.originalName||audio.originalName,
      duration_seconds:measuredDuration,
      status:attachment.status||'received'
    }
  }

  async load(input={}){
    const organizationId=text(input.organizationId??input.organization_id,180)
    const actorId=text(input.actorId??input.actor_id,180)
    if(!organizationId||!actorId)throw new VoiceStorageError('Organização e usuário são obrigatórios para ler áudio.',{code:'voice_storage_scope_required',statusCode:422})
    const attachmentId=parseRepositoryAttachmentRef(input.audioRef??input.audio_ref)
    const attachment=await this.repository.getAttachment({tenantId:organizationId,ownerId:actorId,id:attachmentId})
    if(!attachment)throw new VoiceStorageError('Áudio não encontrado ou não autorizado.',{code:'audio_not_found',statusCode:404})
    const expectedClient=text(input.clientId??input.client_id,180)
    if(expectedClient&&String(attachment.clientId)!==expectedClient)throw new VoiceStorageError('Áudio não encontrado ou não autorizado.',{code:'audio_not_found',statusCode:404})
    const bytes=audioBuffer({dataBase64:attachment.dataBase64})
    if(!bytes)throw new VoiceStorageError('O áudio persistido não pôde ser lido.',{code:'audio_content_unavailable',statusCode:422,retryable:true})
    if(bytes.length>maxVoiceAudioBytes)throw new VoiceStorageError('O áudio persistido excede o limite temporário de 6 MB.',{code:'audio_too_large',statusCode:413})
    const mimeType=text(attachment.mimeType,100).toLowerCase()
    if(!audioMimeTypes.has(mimeType))throw new VoiceStorageError('O anexo referenciado não é um áudio suportado.',{code:'unsupported_audio',statusCode:415})
    return {
      audio_ref:buildRepositoryAttachmentRef(attachment.id),
      audioRef:buildRepositoryAttachmentRef(attachment.id),
      attachmentId:String(attachment.id),
      bytes,
      buffer:bytes,
      mimeType,
      sizeBytes:bytes.length,
      originalName:attachment.originalName,
      status:attachment.status
    }
  }

  async mark(input={}){
    if(!this.repository.updateAttachment)throw new VoiceStorageError('Atualização de metadados de áudio indisponível.',{code:'voice_storage_update_unavailable',statusCode:503,retryable:true})
    const organizationId=text(input.organizationId??input.organization_id,180)
    const actorId=text(input.actorId??input.actor_id,180)
    const attachmentId=parseRepositoryAttachmentRef(input.audioRef??input.audio_ref)
    const allowedStatus=new Set(['interpreted','confirmed','stored','rejected'])
    const status=text(input.status,40).toLowerCase()
    if(!allowedStatus.has(status))throw new VoiceStorageError('Estado de áudio inválido.',{code:'invalid_audio_status',statusCode:422})
    // Deliberately whitelist metadata. Transcript and audio content never belong in
    // the attachment analysis/log surface.
    const source=input.metadata&&typeof input.metadata==='object'?input.metadata:{}
    const metadata={
      kind:'voice_capture',
      voiceInteractionId:text(source.voiceInteractionId??source.voice_interaction_id,180)||null,
      processingStatus:text(source.processingStatus??source.processing_status,60)||null,
      retentionClass:text(source.retentionClass??source.retention_class,80)||null,
      processedAt:text(source.processedAt??source.processed_at,40)||null,
      storageVersion:this.version
    }
    return this.repository.updateAttachment({tenantId:organizationId,ownerId:actorId,id:attachmentId,status,analysis:metadata})
  }
}

export function createRepositoryAttachmentVoiceStorage(options){return new RepositoryAttachmentVoiceStorage(options)}
export function createUnavailableVoiceStorage(){return new VoiceAudioStorage()}

export const supportedVoiceStorageMimeTypes=Object.freeze([...audioMimeTypes])
