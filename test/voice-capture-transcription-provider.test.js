import assert from 'node:assert/strict'
import test from 'node:test'
import OpenAI from 'openai'
import {
 createOpenAITranscriptionProvider,
 defaultVoiceTranscriptionModel,
 TranscriptionProviderError,
 voiceTranscriptionProviderVersion
} from '../server/voice-capture/transcription-provider.js'

const wavBytes=()=>Buffer.from('RIFF\u0024\u0000\u0000\u0000WAVEfmt \u0010\u0000\u0000\u0000\u0001\u0000\u0001\u0000\u0080\u00bb\u0000\u0000\u0000\u0077\u0001\u0000\u0002\u0000\u0010\u0000data\u0000\u0000\u0000\u0000','latin1')

function clientWithFetch(fetch){
 return new OpenAI({apiKey:'sk-test-voice-capture-not-real',baseURL:'https://voice-provider.invalid/v1',fetch,maxRetries:0})
}

test('OpenAI TranscriptionProvider — usa multipart real do SDK com gpt-transcribe e metadata segura',async()=>{
 let request
 const fetch=async(input,init)=>{
  request=input instanceof Request?input:new Request(input,init)
  return new Response(JSON.stringify({
   text:'O produtor pediu comparativo de custo por hectare.',
   language:'pt',
   duration:42.5,
   confidence:0.91
  }),{status:200,headers:{'content-type':'application/json','x-request-id':'req_voice_fixture_001'}})
 }
 const provider=createOpenAITranscriptionProvider({
  client:clientWithFetch(fetch),
  timeoutMs:12_345,
  keywords:['fertilizante','buva']
 })
 const result=await provider.transcribe({
  bytes:wavBytes(),
  mimeType:'audio/wav',
  originalName:'visita-joao.wav',
  language:'pt-BR',
  durationSeconds:42.5
 })
 assert.ok(request)
 assert.equal(request.method,'POST')
 assert.equal(new URL(request.url).pathname,'/v1/audio/transcriptions')
 const form=await request.clone().formData()
 assert.equal(form.get('model'),defaultVoiceTranscriptionModel)
 assert.equal(form.get('response_format'),'json')
 assert.equal(form.get('language'),'pt')
 assert.deepEqual(form.getAll('keywords[]'),['fertilizante','buva'])
 const file=form.get('file')
 assert.equal(file.name,'visita-joao.wav')
 assert.equal(file.type,'audio/wav')
 assert.equal(file.size,wavBytes().length)
 assert.equal(result.text,'O produtor pediu comparativo de custo por hectare.')
 assert.equal(result.provider,'openai')
 assert.equal(result.model,defaultVoiceTranscriptionModel)
 assert.equal(result.version,voiceTranscriptionProviderVersion)
 assert.equal(result.provider_reference,'req_voice_fixture_001')
 assert.equal(result.duration_seconds,42.5)
 assert.equal(result.confidence,0.91)
 assert.equal(result.error,null)
})

test('OpenAI TranscriptionProvider — erro HTTP vira metadata mínima, retryable e sem payload privado',async()=>{
 const privateMessage='provider-private-transcript-must-not-escape'
 const fetch=async()=>new Response(JSON.stringify({error:{message:privateMessage,type:'rate_limit_error',code:'quota'}}),{
  status:429,
  headers:{'content-type':'application/json','x-request-id':'req_voice_fixture_429'}
 })
 const provider=createOpenAITranscriptionProvider({client:clientWithFetch(fetch)})
 await assert.rejects(
  ()=>provider.transcribe({bytes:wavBytes(),mimeType:'audio/wav',durationSeconds:20}),
  error=>{
   assert.ok(error instanceof TranscriptionProviderError)
   assert.equal(error.code,'rate_limit')
   assert.equal(error.statusCode,429)
   assert.equal(error.safeToRetry,true)
   assert.equal(error.transcriptionMetadata.status,'FAILED')
   assert.equal(error.transcriptionMetadata.error.code,'rate_limit')
   assert.equal(error.transcriptionMetadata.error.retryable,true)
   assert.equal(JSON.stringify(error.transcriptionMetadata).includes(privateMessage),false)
   return true
  }
 )
})

test('OpenAI TranscriptionProvider — cliente ausente e arquivo inválido falham antes de rede',async()=>{
 const unavailable=createOpenAITranscriptionProvider()
 await assert.rejects(
  ()=>unavailable.transcribe({bytes:wavBytes(),mimeType:'audio/wav'}),
  error=>error.code==='transcription_provider_unavailable'&&error.statusCode===503&&error.safeToRetry===true
 )
 let calls=0
 const provider=createOpenAITranscriptionProvider({client:clientWithFetch(async()=>{calls+=1;throw new Error('não deveria chamar')})})
 await assert.rejects(
  ()=>provider.transcribe({bytes:wavBytes(),mimeType:'text/plain'}),
  error=>error.code==='unsupported_audio'&&error.statusCode===415&&error.safeToRetry===false
 )
 assert.equal(calls,0)
})
