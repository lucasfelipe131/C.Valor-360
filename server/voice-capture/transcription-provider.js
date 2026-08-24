import {randomUUID} from 'node:crypto'
import {toFile} from 'openai'

export const defaultVoiceTranscriptionModel='gpt-transcribe'
export const voiceTranscriptionProviderVersion='val.transcription_provider.v1'
export const maxVoiceTranscriptionBytes=6_000_000

const text=(value,max=100_000)=>String(value??'').trim().slice(0,max)
const finite=value=>Number.isFinite(Number(value))
const clamp=value=>value==null||!finite(value)?null:Math.max(0,Math.min(1,Number(value)))
const supportedMimeTypes=new Set(['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg'])

function safeCode(error){
  const raw=String(error?.code||error?.name||'transcription_failed').toLowerCase()
  if(Number(error?.status)===401)return 'authentication'
  if(Number(error?.status)===429)return 'rate_limit'
  if(Number(error?.status)===408||raw.includes('timeout'))return 'timeout'
  if(raw.includes('abort'))return 'cancelled'
  if(Number(error?.status)>=500||raw.includes('connection'))return 'provider_unavailable'
  return raw.replace(/[^a-z0-9_-]/g,'_').slice(0,100)||'transcription_failed'
}

function retryable(error,code){
  const status=Number(error?.status||0)
  return ['timeout','rate_limit','provider_unavailable'].includes(code)||[408,409,429].includes(status)||status>=500
}

function providerErrorMetadata(error,{provider,model,version}){
  const code=safeCode(error)
  return {
    provider,
    model,
    version,
    status:'FAILED',
    provider_reference:null,
    language:null,
    duration_seconds:null,
    confidence:null,
    error:{code,status:finite(error?.status)?Number(error.status):null,retryable:retryable(error,code)}
  }
}

function inferredConfidence(response={}){
  if(finite(response.confidence))return clamp(response.confidence)
  const logprobs=Array.isArray(response.logprobs)?response.logprobs.map(item=>Number(item?.logprob)).filter(Number.isFinite):[]
  if(!logprobs.length)return null
  return clamp(logprobs.reduce((sum,value)=>sum+Math.exp(value),0)/logprobs.length)
}

function durationFrom(response={},fallback=null){
  if(finite(response.duration)&&Number(response.duration)>0)return Number(response.duration)
  if(response.usage?.type==='duration'&&finite(response.usage.seconds)&&Number(response.usage.seconds)>0)return Number(response.usage.seconds)
  return finite(fallback)&&Number(fallback)>0?Number(fallback):null
}

function validateDuration(value){
  if(value==null||value==='')return null
  const duration=Number(value)
  if(!Number.isFinite(duration)||duration<=0)throw new TranscriptionProviderError('A duração do áudio é inválida.',{code:'invalid_audio_duration',statusCode:422,retryable:false})
  if(duration>900)throw new TranscriptionProviderError('O áudio excede o limite de 15 minutos.',{code:'audio_too_long',statusCode:422,retryable:false})
  return duration
}

function languageFrom(response={},fallback=null){
  const detected=Array.isArray(response.languages)?response.languages.find(item=>text(item?.code,30))?.code:null
  return text(response.language||detected||fallback,30)||null
}

function audioBytes(input={}){
  const value=input.bytes??input.buffer??input.audio?.bytes??input.attachment?.bytes
  if(Buffer.isBuffer(value))return value
  if(value instanceof Uint8Array)return Buffer.from(value)
  const encoded=input.dataBase64??input.audio?.dataBase64??input.attachment?.dataBase64
  if(!text(encoded,20_000_000))return null
  const normalized=String(encoded).replace(/^data:[^;,]+;base64,/i,'').replace(/\s/g,'')
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized))return null
  return Buffer.from(normalized,'base64')
}

function safeFileName(value,mimeType){
  const extensions={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm','audio/ogg':'ogg'}
  const fallback=`voice-${randomUUID()}.${extensions[mimeType]||'audio'}`
  return (text(value,240).normalize('NFKC').replace(/[\/\\<>:\"|?*\u0000-\u001f]/g,'-')||fallback).slice(0,240)
}

function normalizeLanguageForOpenAI(value){
  const language=text(value,30).toLowerCase()
  if(!language)return undefined
  return language.split(/[-_]/,1)[0]||undefined
}

export class TranscriptionProviderError extends Error{
  constructor(message,{code='transcription_failed',statusCode=503,retryable=false,metadata=null}={}){
    super(message)
    this.name='TranscriptionProviderError'
    this.code=code
    this.statusCode=statusCode
    this.safeToRetry=Boolean(retryable)
    this.transcriptionMetadata=metadata
  }
}

export class TranscriptionProvider{
  constructor({name='unknown',model='unknown',version=voiceTranscriptionProviderVersion}={}){
    this.name=name
    this.model=model
    this.version=version
    this.requiresVerifiedDuration=false
  }

  async transcribe(){
    throw new TranscriptionProviderError('A transcrição de áudio não está disponível neste ambiente.',{
      code:'transcription_provider_unavailable',
      statusCode:503,
      retryable:true,
      metadata:providerErrorMetadata({code:'provider_unavailable',status:503},{provider:this.name,model:this.model,version:this.version})
    })
  }
}

export class OpenAITranscriptionProvider extends TranscriptionProvider{
  constructor({client,model=defaultVoiceTranscriptionModel,version=voiceTranscriptionProviderVersion,timeoutMs=60_000,keywords=[]}={}){
    super({name:'openai',model,version})
    this.requiresVerifiedDuration=true
    this.client=client||null
    this.timeoutMs=Math.max(5_000,Math.min(120_000,Number(timeoutMs)||60_000))
    this.keywords=Array.isArray(keywords)?keywords.map(value=>text(value,80)).filter(Boolean).slice(0,100):[]
  }

  async transcribe(input={}){
    if(!this.client?.audio?.transcriptions?.create){
      const metadata=providerErrorMetadata({code:'provider_unavailable',status:503},{provider:this.name,model:this.model,version:this.version})
      throw new TranscriptionProviderError('A transcrição de áudio não está disponível neste ambiente.',{code:'transcription_provider_unavailable',statusCode:503,retryable:true,metadata})
    }
    const mimeType=text(input.mimeType??input.mime_type??input.audio?.mimeType??input.attachment?.mimeType,100).split(';',1)[0].trim().toLowerCase()
    if(!supportedMimeTypes.has(mimeType))throw new TranscriptionProviderError('O formato do áudio não é suportado.',{code:'unsupported_audio',statusCode:415,retryable:false})
    const bytes=audioBytes(input)
    if(!bytes?.length)throw new TranscriptionProviderError('O áudio está vazio ou não pôde ser lido.',{code:'empty_audio',statusCode:422,retryable:false})
    if(bytes.length>maxVoiceTranscriptionBytes)throw new TranscriptionProviderError('O áudio excede o limite temporário de 6 MB.',{code:'audio_too_large',statusCode:413,retryable:false})
    const inputDuration=validateDuration(input.durationSeconds??input.duration_seconds)
    const fileName=safeFileName(input.fileName??input.originalName??input.audio?.fileName??input.attachment?.originalName,mimeType)
    try{
      const file=await toFile(bytes,fileName,{type:mimeType})
      const language=normalizeLanguageForOpenAI(input.language)
      const response=await this.client.audio.transcriptions.create({
        file,
        model:this.model,
        response_format:'json',
        ...(language?{language}:{}),
        ...(this.keywords.length?{keywords:this.keywords}:{})
      },{
        timeout:this.timeoutMs,
        maxRetries:0,
        ...(input.signal?{signal:input.signal}:{})
      })
      const transcript=text(response?.text)
      if(!transcript)throw Object.assign(new Error('empty_transcript'),{code:'empty_transcript',status:422})
      const metadata={
        provider:this.name,
        model:this.model,
        version:this.version,
        status:'COMPLETED',
        provider_reference:text(response?._request_id,240)||null,
        language:languageFrom(response,input.language),
        duration_seconds:durationFrom(response,inputDuration),
        confidence:inferredConfidence(response),
        error:null
      }
      if(metadata.duration_seconds!==null&&metadata.duration_seconds>900)throw Object.assign(new Error('audio_too_long'),{code:'audio_too_long',status:422})
      return {text:transcript,...metadata,metadata}
    }catch(error){
      if(error instanceof TranscriptionProviderError)throw error
      const metadata=providerErrorMetadata(error,{provider:this.name,model:this.model,version:this.version})
      const statusCode=metadata.error.status||503
      throw new TranscriptionProviderError('Não foi possível transcrever o áudio nesta tentativa.',{
        code:metadata.error.code,
        statusCode,
        retryable:metadata.error.retryable,
        metadata
      })
    }
  }
}

export class MockTranscriptionProvider extends TranscriptionProvider{
  constructor({text:transcriptText='',fail=false,name='fixture',model='fixture-transcriber',version='fixture.v1',language='pt-BR',durationSeconds=null,confidence=0.99}={}){
    super({name,model,version})
    this.transcriptText=transcriptText
    this.fail=fail
    this.language=language
    this.durationSeconds=durationSeconds
    this.confidence=confidence
  }

  async transcribe(input={}){
    if(this.fail){
      const error={code:'transcription_fixture_failure',status:503}
      const metadata=providerErrorMetadata(error,{provider:this.name,model:this.model,version:this.version})
      throw new TranscriptionProviderError('Falha controlada de transcrição.',{code:error.code,statusCode:503,retryable:true,metadata})
    }
    const transcript=text(typeof this.transcriptText==='function'?this.transcriptText(input):this.transcriptText)
    if(!transcript)throw new TranscriptionProviderError('O mock não retornou transcrição.',{code:'empty_transcript',statusCode:422,retryable:false})
    const duration=validateDuration(input.durationSeconds??input.duration_seconds??this.durationSeconds)
    const metadata={
      provider:this.name,
      model:this.model,
      version:this.version,
      status:'COMPLETED',
      provider_reference:`fixture:${randomUUID()}`,
      language:text(input.language||this.language,30)||null,
      duration_seconds:duration,
      confidence:clamp(this.confidence),
      error:null
    }
    return {text:transcript,...metadata,metadata}
  }
}

export class UnavailableTranscriptionProvider extends TranscriptionProvider{
  constructor(){super({name:'unavailable',model:'unavailable',version:voiceTranscriptionProviderVersion})}
}

export function createOpenAITranscriptionProvider(options){return new OpenAITranscriptionProvider(options)}
export function createMockTranscriptionProvider(options){return new MockTranscriptionProvider(options)}
export function createUnavailableTranscriptionProvider(){return new UnavailableTranscriptionProvider()}

export async function transcribeVoiceAudio({provider,...input}={}){
  return (provider||createUnavailableTranscriptionProvider()).transcribe(input)
}

export const supportedVoiceAudioMimeTypes=Object.freeze([...supportedMimeTypes])
