import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VoiceStorageError,
  buildRepositoryAttachmentRef,
  createRepositoryAttachmentVoiceStorage,
  durationFromFfprobeMetadata,
  durationFromFfprobePackets,
  maxVoiceAudioBytes,
  parseRepositoryAttachmentRef,
  probeVoiceAudioDuration,
  validateVoiceAudio
} from '../server/voice-capture/storage.js'

const organizationId='00000000-0000-4000-8000-000000000201'
const otherOrganizationId='00000000-0000-4000-8000-000000000202'
const actorId='00000000-0000-4000-8000-000000000203'
const otherActorId='00000000-0000-4000-8000-000000000204'
const clientId='00000000-0000-4000-8000-000000000205'
const otherClientId='00000000-0000-4000-8000-000000000206'
const attachmentId='00000000-0000-4000-8000-000000000207'

function wavBytes(size=44){
  const bytes=Buffer.alloc(Math.max(12,size))
  bytes.write('RIFF',0,'ascii')
  bytes.writeUInt32LE(Math.max(0,bytes.length-8),4)
  bytes.write('WAVE',8,'ascii')
  return bytes
}

function playableWavBytes({seconds=0.25,sampleRate=8_000}={}){
  const samples=Math.round(seconds*sampleRate);const dataBytes=samples*2;const bytes=Buffer.alloc(44+dataBytes)
  bytes.write('RIFF',0,'ascii');bytes.writeUInt32LE(36+dataBytes,4);bytes.write('WAVE',8,'ascii')
  bytes.write('fmt ',12,'ascii');bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22)
  bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34)
  bytes.write('data',36,'ascii');bytes.writeUInt32LE(dataBytes,40)
  return bytes
}

class FixtureAttachmentRepository{
  constructor(){
    this.attachments=new Map()
    this.lastCreate=null
    this.lastGet=null
    this.lastUpdate=null
  }

  async createAttachment(input){
    this.lastCreate=structuredClone(input)
    const attachment={
      id:attachmentId,
      tenantId:input.tenantId,
      ownerId:input.ownerId,
      clientId:input.clientId,
      originalName:input.originalName,
      mimeType:input.mimeType,
      sizeBytes:input.sizeBytes,
      dataBase64:input.dataBase64,
      status:'received'
    }
    this.attachments.set(attachment.id,attachment)
    return structuredClone(attachment)
  }

  async getAttachment(input){
    this.lastGet=structuredClone(input)
    const attachment=this.attachments.get(input.id)
    if(!attachment)return null
    if(attachment.tenantId!==input.tenantId||attachment.ownerId!==input.ownerId)return null
    return structuredClone(attachment)
  }

  async updateAttachment(input){
    this.lastUpdate=structuredClone(input)
    const attachment=this.attachments.get(input.id)
    if(!attachment||attachment.tenantId!==input.tenantId||attachment.ownerId!==input.ownerId)return null
    Object.assign(attachment,{status:input.status,analysis:structuredClone(input.analysis)})
    return structuredClone(attachment)
  }
}

function storageFixture(){
  const repository=new FixtureAttachmentRepository()
  return {repository,storage:createRepositoryAttachmentVoiceStorage({repository,durationProbe:async()=>30})}
}

function assertStorageError(error,{code,statusCode}){
  assert.equal(error instanceof VoiceStorageError,true)
  if(code instanceof RegExp)assert.match(error.code,code)
  else assert.equal(error.code,code)
  assert.equal(error.statusCode,statusCode)
  return true
}

test('Voice storage — valida áudio real por MIME e assinatura, não somente declaração do cliente',()=>{
  const valid=validateVoiceAudio({
    bytes:wavBytes(),
    mimeType:'audio/wav',
    originalName:'nota-de-campo.wav',
    durationSeconds:45
  })
  assert.equal(valid.mimeType,'audio/wav')
  assert.equal(valid.bytes.length,44)
  assert.equal(valid.originalName,'nota-de-campo.wav')

  assert.throws(
    ()=>validateVoiceAudio({bytes:Buffer.from('isto nao e wav'),mimeType:'audio/wav',originalName:'falso.wav',durationSeconds:10}),
    error=>assertStorageError(error,{code:/invalid_audio|signature|unsupported/,statusCode:415})
  )
  assert.throws(
    ()=>validateVoiceAudio({bytes:wavBytes(),mimeType:'text/plain',originalName:'nota.txt',durationSeconds:10}),
    error=>assertStorageError(error,{code:'unsupported_audio',statusCode:415})
  )
  assert.throws(
    ()=>validateVoiceAudio({bytes:Buffer.alloc(0),mimeType:'audio/wav',originalName:'vazio.wav',durationSeconds:10}),
    error=>error instanceof VoiceStorageError&&/^invalid_audio(?:_signature)?$/.test(error.code)&&[415,422].includes(error.statusCode)
  )
})

test('Voice storage — data URL inconsistente e base64 inválido falham antes da persistência',()=>{
  const wav=wavBytes().toString('base64')
  assert.throws(
    ()=>validateVoiceAudio({dataBase64:`data:audio/webm;base64,${wav}`,mimeType:'audio/wav',originalName:'mismatch.wav',durationSeconds:5}),
    error=>assertStorageError(error,{code:'audio_mime_mismatch',statusCode:415})
  )
  assert.throws(
    ()=>validateVoiceAudio({dataBase64:'%%%nao-base64%%%',mimeType:'audio/wav',durationSeconds:5}),
    error=>assertStorageError(error,{code:'invalid_audio',statusCode:422})
  )
})

test('Voice storage — limite de 6 MB aceita a fronteira e rejeita um byte acima',()=>{
  const atLimit=validateVoiceAudio({
    bytes:wavBytes(maxVoiceAudioBytes),
    mimeType:'audio/wav',
    originalName:'limite.wav',
    durationSeconds:900
  })
  assert.equal(atLimit.bytes.length,maxVoiceAudioBytes)

  assert.throws(
    ()=>validateVoiceAudio({bytes:wavBytes(maxVoiceAudioBytes+1),mimeType:'audio/wav',originalName:'acima.wav',durationSeconds:900}),
    error=>assertStorageError(error,{code:'audio_too_large',statusCode:413})
  )
})

test('Voice storage — duração deve ser positiva e não pode exceder 15 minutos',()=>{
  assert.doesNotThrow(()=>validateVoiceAudio({bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:900}))
  assert.throws(
    ()=>validateVoiceAudio({bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:900.001}),
    error=>assertStorageError(error,{code:/duration|audio_too_long/,statusCode:422})
  )
  assert.throws(
    ()=>validateVoiceAudio({bytes:wavBytes(),mimeType:'audio/wav',duration_seconds:0}),
    error=>assertStorageError(error,{code:/duration/,statusCode:422})
  )
})

test('Voice storage — probe do servidor impede fraude na duração declarada',async()=>{
  const repository=new FixtureAttachmentRepository()
  const storage=createRepositoryAttachmentVoiceStorage({repository,durationProbe:async()=>901})
  await assert.rejects(
    ()=>storage.store({organizationId,actorId,clientId,bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:5}),
    error=>error instanceof VoiceStorageError&&error.code==='audio_too_long'&&error.statusCode===422
  )
  assert.equal(repository.lastCreate,null,'O arquivo não pode ser persistido antes da duração real ser aprovada.')
})

test('Voice storage — ffprobe real valida o container e mede a duração no servidor',async()=>{
  const duration=await probeVoiceAudioDuration({bytes:playableWavBytes(),mimeType:'audio/wav'})
  assert.ok(duration>=0.24&&duration<=0.26,`Duração inesperada do WAV sintético: ${duration}`)
})

test('Voice storage — duração usa metadado do stream quando o container MP4 do Safari não informa duração',()=>{
  const duration=durationFromFfprobeMetadata(JSON.stringify({
    format:{duration:'N/A'},
    streams:[{duration:'N/A',duration_ts:480_000,time_base:'1/48000'}]
  }))
  assert.equal(duration,10)
})

test('Voice storage — duração de MP4 fragmentado pode ser comprovada pelos timestamps dos pacotes',()=>{
  const duration=durationFromFfprobePackets([
    '-0.021333,-0.021333,0.021333',
    '0.000000,0.000000,0.021333',
    '9.962667,9.962667,0.021333',
    '9.984000,9.984000,0.021333'
  ].join('\n'))
  assert.ok(duration>=10.026&&duration<=10.027,`Duração inesperada do timeline fragmentado: ${duration}`)
})

test('Voice storage — probe recorre aos pacotes sem confiar na duração enviada pelo Safari',async()=>{
  const calls=[]
  const duration=await probeVoiceAudioDuration({
    bytes:Buffer.from('fixture-mp4-fragmentado-sintetico'),
    mimeType:'audio/mp4',
    probeRunner:async(_command,args)=>{
      calls.push(args)
      if(args.includes('format=duration:stream=duration,duration_ts,time_base'))return {stdout:JSON.stringify({format:{duration:'N/A'},streams:[{duration:'N/A',duration_ts:'N/A',time_base:'1/48000'}]})}
      return {stdout:'0.000000,0.000000,0.021333\n11.968000,11.968000,0.021333\n'}
    }
  })
  assert.equal(calls.length,2)
  assert.ok(duration>=11.989&&duration<=11.990)
})

test('Voice storage — adapter grava referência opaca e sanitiza filename',async()=>{
  const {repository,storage}=storageFixture()
  const stored=await storage.store({
    organizationId,
    actorId,
    clientId,
    bytes:wavBytes(),
    mimeType:'audio/wav',
    originalName:'../../visita?.wav',
    durationSeconds:30
  })

  assert.equal(stored.audio_ref,`attachment:${attachmentId}`)
  assert.equal(stored.attachment_id,attachmentId)
  assert.equal(stored.storage_provider,'repository_attachment')
  assert.equal(repository.lastCreate.tenantId,organizationId)
  assert.equal(repository.lastCreate.ownerId,actorId)
  assert.equal(repository.lastCreate.clientId,clientId)
  assert.equal(repository.lastCreate.deduplicate,false)
  assert.equal(repository.lastCreate.sizeBytes,44)
  assert.doesNotMatch(repository.lastCreate.originalName,/[\\/?*]/)
  assert.equal(Buffer.from(repository.lastCreate.dataBase64,'base64').equals(wavBytes()),true)
})

test('Voice storage — load revalida tenant, ator e produtor e falha sem revelar o anexo',async()=>{
  const {repository,storage}=storageFixture()
  const stored=await storage.store({organizationId,actorId,clientId,bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:30})
  const loaded=await storage.load({organizationId,actorId,clientId,audioRef:stored.audio_ref})
  assert.equal(loaded.bytes.equals(wavBytes()),true)
  assert.equal(loaded.mimeType,'audio/wav')

  await assert.rejects(
    ()=>storage.load({organizationId:otherOrganizationId,actorId,clientId,audioRef:stored.audio_ref}),
    error=>assertStorageError(error,{code:'audio_not_found',statusCode:404})
  )
  await assert.rejects(
    ()=>storage.load({organizationId,actorId:otherActorId,clientId,audioRef:stored.audio_ref}),
    error=>assertStorageError(error,{code:'audio_not_found',statusCode:404})
  )
  await assert.rejects(
    ()=>storage.load({organizationId,actorId,clientId:otherClientId,audioRef:stored.audio_ref}),
    error=>assertStorageError(error,{code:'audio_not_found',statusCode:404})
  )
  assert.equal(repository.lastGet.id,attachmentId)
})

test('Voice storage — mark usa allowlist e não persiste transcript ou áudio em metadata',async()=>{
  const {repository,storage}=storageFixture()
  const stored=await storage.store({organizationId,actorId,clientId,bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:30})
  await storage.mark({
    organizationId,
    actorId,
    audioRef:stored.audio_ref,
    status:'interpreted',
    metadata:{
      voiceInteractionId:'voice-storage-1',
      processingStatus:'PENDING_REVIEW',
      retentionClass:'VOICE_RAW_TEMPORARY',
      processedAt:'2026-08-23T15:00:00.000Z',
      transcript:'conteudo que nao pode ser copiado',
      audioBase64:'segredo'
    }
  })

  assert.deepEqual(Object.keys(repository.lastUpdate.analysis).sort(),['kind','processedAt','processingStatus','retentionClass','storageVersion','voiceInteractionId'].sort())
  assert.equal(JSON.stringify(repository.lastUpdate.analysis).includes('conteudo que nao pode ser copiado'),false)
  assert.equal(JSON.stringify(repository.lastUpdate.analysis).includes('segredo'),false)
})

test('Voice storage — referência exige UUID e escopo obrigatório',async()=>{
  assert.equal(buildRepositoryAttachmentRef(attachmentId),`attachment:${attachmentId}`)
  assert.equal(parseRepositoryAttachmentRef(`attachment:${attachmentId}`),attachmentId)
  assert.throws(
    ()=>parseRepositoryAttachmentRef('attachment:../../outro-tenant'),
    error=>assertStorageError(error,{code:'invalid_audio_ref',statusCode:422})
  )

  const {storage}=storageFixture()
  await assert.rejects(
    ()=>storage.store({organizationId:'',actorId,clientId,bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:10}),
    error=>assertStorageError(error,{code:'voice_storage_scope_required',statusCode:422})
  )
})
