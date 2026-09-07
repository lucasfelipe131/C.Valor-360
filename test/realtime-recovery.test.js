import test from 'node:test'
import assert from 'node:assert/strict'
import {realtimeRetrySeconds,realtimeRetryDelay,realtimeFailureMessage,realtimeEventSuppressedWhilePaused} from '../src/lib/realtime-recovery.js'

test('voice cooldown counts down from a fixed deadline and enables retry exactly at expiry',()=>{
 const deadline=12_500
 assert.equal(realtimeRetrySeconds(deadline,10_000),3)
 assert.equal(realtimeRetrySeconds(deadline,10_600),2)
 assert.equal(realtimeRetrySeconds(deadline,12_499),1)
 assert.equal(realtimeRetrySeconds(deadline,12_500),0)
 assert.equal(realtimeRetrySeconds(deadline,20_000),0)
 assert.equal(realtimeRetrySeconds(undefined,10_000),0)
 assert.equal(realtimeRetrySeconds('invalid',10_000),0)
})

test('voice retry accepts the API delay and Retry-After seconds with upward rounding',()=>{
 assert.equal(realtimeRetryDelay({retryAfterSeconds:2.2}),3)
 assert.equal(realtimeRetryDelay({retryAfterSeconds:'4'}),4)
 assert.equal(realtimeRetryDelay({retryAfterSeconds:3},new Headers({'Retry-After':'9'})),3)
 assert.equal(realtimeRetryDelay({},new Headers({'Retry-After':'8'})),8)
 assert.equal(realtimeRetryDelay({retryAfterSeconds:0},new Headers({'Retry-After':'2.1'})),3)
 assert.equal(realtimeRetryDelay({retryAfterSeconds:-5},new Headers({'Retry-After':'4'})),4)
 assert.equal(realtimeRetryDelay({},new Headers({'Retry-After':'-9'})),0)
})

test('voice retry understands an HTTP date without extending an expired delay',()=>{
 const time=Date.parse('2026-09-06T12:00:00Z')
 const headers=new Headers({'Retry-After':'Sun, 06 Sep 2026 12:00:10 GMT'})
 assert.equal(realtimeRetryDelay({},headers,time),10)
 assert.equal(realtimeRetryDelay({},headers,time+9_001),1)
 assert.equal(realtimeRetryDelay({},headers,time+10_000),0)
 assert.equal(realtimeRetryDelay({},headers,time+15_000),0)
 assert.equal(realtimeRetryDelay({},new Headers({'Retry-After':'not-a-date'}),time),0)
 assert.equal(realtimeRetryDelay({},null,time),0)
})

test('a non-JSON startup error can still supply a retry deadline in its HTTP header',()=>{
 // Both startup requests use response.json().catch(() => null), including
 // network-edge HTML 429/503 responses. Parsing their delay must never throw.
 assert.equal(realtimeRetryDelay(null,new Headers({'Retry-After':'7'})),7)
 assert.equal(realtimeRetryDelay(null,null),0)
})

test('device and transport failures produce actionable messages instead of browser internals',()=>{
 const denied=realtimeFailureMessage({name:'NotAllowedError',message:'Permission denied by system'})
 assert.match(denied,/Permita o acesso ao microfone/)
 assert.doesNotMatch(denied,/Permission denied/)
 assert.match(realtimeFailureMessage({name:'NotFoundError'}),/Conecte um microfone/)
 assert.match(realtimeFailureMessage({name:'NotReadableError'}),/outro aplicativo/)
 for(const code of ['AbortError','TimeoutError','REALTIME_CONNECT_TIMEOUT'])assert.match(realtimeFailureMessage({code}),/demorou demais/)
 assert.match(realtimeFailureMessage(new TypeError('Failed to fetch')),/Verifique sua internet/)
 assert.equal(realtimeFailureMessage({code:'realtime_voice_disabled',message:'A voz está desabilitada neste ambiente.'}),'A voz está desabilitada neste ambiente.')
 assert.match(realtimeFailureMessage({}),/continuar digitando/)
})

test('pause suppresses incoming state activations while allowing final usage and cleanup events',()=>{
 for(const type of ['input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','response.created','output_audio_buffer.started'])assert.equal(realtimeEventSuppressedWhilePaused(type),true,type)
 for(const type of ['response.done','output_audio_buffer.stopped','output_audio_buffer.cleared','conversation.item.input_audio_transcription.completed','error'])assert.equal(realtimeEventSuppressedWhilePaused(type),false,type)
})

test('native DOMException numeric codes do not hide microphone names',()=>{
 assert.match(realtimeFailureMessage(new DOMException('Requested device not found','NotFoundError')),/Conecte um microfone/)
 assert.match(realtimeFailureMessage(new DOMException('Permission denied','NotAllowedError')),/Permita o acesso ao microfone/)
 assert.match(realtimeFailureMessage(new DOMException('Aborted','AbortError')),/demorou demais/)
})
