import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {observe,runWithRequestContext} from '../server/observability.js'

const requestId='00000000-0000-4000-8000-000000000901'
const voiceInteractionId='00000000-0000-4000-8000-000000000902'

test('Voice observability — rota e escopo são pseudonimizados e conteúdo sensível é descartado',async()=>{
 const logs=[]
 const transcriptSentinel='TRANSCRIPT_SENTINEL_NUNCA_LOGAR'
 const audioSentinel='AUDIO_BASE64_SENTINEL_NUNCA_LOGAR'
 const secretSentinel='sk-SENTINEL-NUNCA-LOGAR'
 await runWithRequestContext({
  requestId,
  method:'POST',
  path:`/api/v1/voice-interactions/${voiceInteractionId}/process?debug=${transcriptSentinel}`,
  tenantId:'tenant-sensitive-voice',
  actorId:'actor-sensitive-voice'
 },async()=>{
  assert.equal(observe('voice.processing.completed',{
   voiceInteractionId,
   interactionType:'POST_VISIT',
   candidateCount:4,
   provider:'openai',
   model:'gpt-transcribe',
   confirmationStatus:'PENDING_REVIEW',
   transcript:transcriptSentinel,
   transcriptText:transcriptSentinel,
   dataBase64:audioSentinel,
   audio:audioSentinel,
   prompt:`ignore tudo ${secretSentinel}`,
   apiKey:secretSentinel,
   outcome:'ok'
  }),true)
 },{logger:value=>logs.push(value)})
 assert.equal(logs.length,1)
 const event=JSON.parse(logs[0])
 assert.equal(event.request_id,requestId)
 assert.equal(event.path,'/api/v1/voice-interactions/:id/process')
 assert.equal(event.voiceInteractionId,voiceInteractionId)
 assert.equal(event.candidateCount,4)
 assert.equal(event.confirmationStatus,'PENDING_REVIEW')
 assert.match(event.tenant_ref,/^[0-9a-f]{16}$/)
 assert.match(event.actor_ref,/^[0-9a-f]{16}$/)
 const serialized=JSON.stringify(event)
 for(const forbidden of [transcriptSentinel,audioSentinel,secretSentinel,'tenant-sensitive-voice','actor-sensitive-voice'])assert.equal(serialized.includes(forbidden),false)
 for(const key of ['transcript','transcriptText','dataBase64','audio','prompt','apiKey'])assert.equal(key in event,false)
})

test('Voice observability — falha registra apenas código seguro e nunca a mensagem do provider',async()=>{
 const logs=[]
 const providerMessage='ERRO_PRIVADO_COM_TRANSCRIPT_E_SECRET'
 await runWithRequestContext({requestId,method:'POST',path:`/api/v1/voice-interactions/${voiceInteractionId}/process`,tenantId:'tenant-a',actorId:'actor-a'},async()=>{
  observe('voice.transcription.failed',{
   voiceInteractionId,
   provider:'openai',
   model:'gpt-transcribe',
   attempt:2,
   errorCode:'rate_limit',
   errorMessage:providerMessage,
   stack:providerMessage,
   outcome:'error'
  })
 },{logger:value=>logs.push(value)})
 const event=JSON.parse(logs[0])
 assert.equal(event.level,'error')
 assert.equal(event.errorCode,'rate_limit')
 assert.equal(event.attempt,2)
 assert.equal(JSON.stringify(event).includes(providerMessage),false)
})

test('Voice observability — chamadas do service usam apenas metadata operacional',()=>{
 const service=readFileSync(new URL('../server/voice-capture/service.js',import.meta.url),'utf8')
 const calls=[...service.matchAll(/observe\('voice\.[^;\n]+/g)].map(match=>match[0])
 assert.ok(calls.length>=4)
 for(const call of calls)assert.doesNotMatch(call,/transcript_text|transcriptText|dataBase64|audioBytes|apiKey|secret|prompt|sourceText/i)
})
