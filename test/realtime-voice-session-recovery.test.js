import test from 'node:test'
import assert from 'node:assert/strict'
import {createRealtimeVoiceService} from '../server/realtime-voice/service.js'
import {createRealtimeSessionAdmission} from '../server/realtime-voice/session-admission.js'
import {createInMemoryRealtimeCostStore} from '../server/realtime-voice/cost-control.js'
import {createConversationSessionStore} from '../server/decision-copilot/conversation-session-store.js'
import {observe,runWithRequestContext} from '../server/observability.js'

const identity={id:'00000000-0000-4000-8000-000000000101',tenantId:'00000000-0000-4000-8000-000000000001',email:'voice@example.test',role:'admin'}
const fixture=({config={},create=async()=>({value:'ek_unit_test',expires_at:60}),costStore=createInMemoryRealtimeCostStore(),now=Date.now}={})=>{
 const runtimeConfig={realtimeVoiceEnabled:true,realtimeVoiceBudgetUsd:25,realtimeVoiceRequestsPerTenMinutes:6,...config}
 const events=[]
 const service=createRealtimeVoiceService({runtimeConfig,client:{realtime:{clientSecrets:{create}}},repository:{},conversationSessions:createConversationSessionStore(),costStore,now,logger:event=>events.push(event)})
 return {service,runtimeConfig,costStore,events}
}

test('repeated configuration failures remain explicit and consume no successful-session quota',async()=>{
 let calls=0
 const {service,runtimeConfig}=fixture({config:{realtimeVoiceEnabled:false},create:async()=>{calls++;return {value:'ek_unit_test',expires_at:60}}})
 for(let index=0;index<10;index++)await assert.rejects(service.createSession({identity}),error=>error.statusCode===503&&error.code==='realtime_voice_disabled')
 assert.equal(calls,0)
 const disabled=await service.availability({identity})
 assert.equal(disabled.available,false)
 assert.equal(disabled.unavailableCode,'realtime_voice_disabled')
 assert.equal(disabled.canRetry,false)
 runtimeConfig.realtimeVoiceEnabled=true
 for(let index=0;index<6;index++)assert.equal((await service.createSession({identity})).transport,'WEBRTC')
 assert.equal(calls,6)
 await assert.rejects(service.createSession({identity}),error=>error.statusCode===429&&error.code==='realtime_voice_rate_limit'&&error.retryAfterSeconds<=600&&error.retryAfterSeconds>=599)
})

test('missing cost storage and tester restrictions stay visible before provider or quota admission',async()=>{
 let calls=0
 const {service}=fixture({costStore:null,create:async()=>{calls++}})
 for(let index=0;index<8;index++)await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_cost_control_unavailable'&&error.statusCode===503)
 await assert.rejects(service.createSession({identity:{...identity,role:'consultant'}}),error=>error.code==='realtime_voice_tester_not_allowed'&&error.statusCode===403)
 await assert.rejects(service.createSession({identity:null}),error=>error.code==='realtime_voice_auth_required'&&error.statusCode===401)
 assert.equal(calls,0)
})

test('provider failures release reservations, back off, and leave session quota for recovery',async()=>{
 let clock=0,calls=0,shouldFail=true,providerOptions
 const {service,costStore,events}=fixture({now:()=>clock,create:async(body,options)=>{calls++;providerOptions=options;if(shouldFail)throw Object.assign(new Error('sk-provider-secret NEVER_EXPOSE'),{status:503});return {value:'ek_recovered',expires_at:60}}})
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_session_failed'&&error.statusCode===502&&error.safeToRetry===true&&error.retryAfterSeconds===2&&!error.message.includes('NEVER_EXPOSE'))
 assert.equal((await costStore.snapshot({budgetUsd:25})).totalUsd,0)
 assert.equal(providerOptions.maxRetries,0)
 assert.equal(providerOptions.timeout,10_000)
 for(let index=0;index<6;index++)await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_retry_cooldown'&&error.retryAfterSeconds===2)
 assert.equal(calls,1)
 clock=2_000
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_session_failed'&&error.retryAfterSeconds===4)
 clock=3_001
 assert.equal((await service.availability({identity})).retryAfterSeconds,3)
 clock=6_000
 shouldFail=false
 for(let index=0;index<6;index++)await service.createSession({identity})
 assert.equal(calls,8)
 assert.equal((await costStore.snapshot({budgetUsd:25})).totalUsd,6)
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_rate_limit')
 assert.doesNotMatch(JSON.stringify(events),/NEVER_EXPOSE|sk-provider-secret|ek_recovered/)
 assert.equal(events.some(event=>event.providerStatus===503&&event.failureCode==='realtime_voice_session_failed'),true)
})

test('one in-flight startup blocks duplicates and releases its lock when it completes',async()=>{
 let finishProvider,providerStarted,calls=0
 const started=new Promise(resolve=>{providerStarted=resolve})
 const {service}=fixture({create:async()=>{calls++;providerStarted();return new Promise(resolve=>{finishProvider=resolve})}})
 const first=service.createSession({identity})
 await started
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_session_pending'&&error.retryAfterSeconds===2)
 assert.equal((await service.availability({identity})).unavailableCode,'realtime_voice_session_pending')
 finishProvider({value:'ek_concurrent',expires_at:60})
 await first
 assert.equal(calls,1)
 assert.equal((await service.availability({identity})).available,true)
})

test('permanent provider rejection never triggers automatic retries or leaks provider details',async()=>{
 const {service,costStore}=fixture({create:async()=>{throw Object.assign(new Error('AUTHORIZATION_PRIVATE_DETAIL'),{status:401})}})
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_provider_rejected'&&error.statusCode===502&&error.safeToRetry===false&&error.retryAfterSeconds===30&&!error.message.includes('AUTHORIZATION_PRIVATE_DETAIL'))
 assert.equal((await costStore.snapshot({budgetUsd:25})).totalUsd,0)
 assert.equal((await service.availability({identity})).canRetry,false)
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_retry_cooldown'&&error.safeToRetry===false)
})

test('effective readiness checks budget and unavailable persistent storage without opening a session',async()=>{
 let calls=0
 const {service,costStore}=fixture({config:{realtimeVoiceBudgetUsd:1000},create:async()=>{calls++}})
 await costStore.reserve({sessionId:'already-reserved',reservationUsd:25,budgetUsd:25})
 const exhausted=await service.availability({identity})
 assert.equal(exhausted.available,false)
 assert.equal(exhausted.budgetUsd,25)
 assert.equal(exhausted.unavailableCode,'realtime_voice_budget_exhausted')
 assert.equal(exhausted.canRetry,false)
 await assert.rejects(service.createSession({identity}),error=>error.code==='realtime_voice_budget_exhausted'&&error.statusCode===402)
 assert.equal(calls,0)
 const {service:offline}=fixture({costStore:{snapshot:async()=>{throw new Error('DATABASE_PASSWORD_PRIVATE')},reserve:async()=>{throw new Error('DATABASE_PASSWORD_PRIVATE')}}})
 const unavailable=await offline.availability({identity})
 assert.equal(unavailable.unavailableCode,'realtime_voice_cost_control_unavailable')
 assert.equal(unavailable.canRetry,true)
 assert.equal(unavailable.retryAfterSeconds,5)
 assert.doesNotMatch(JSON.stringify(unavailable),/DATABASE_PASSWORD_PRIVATE/)
 await assert.rejects(offline.createSession({identity}),error=>error.statusCode===503&&error.safeToRetry===true&&error.retryAfterSeconds===2&&!error.message.includes('DATABASE_PASSWORD_PRIVATE'))
})

test('admission uses elapsed time, preserves tenant separation and bounds raw abuse independently',()=>{
 let clock=0
 const limiter=createRealtimeSessionAdmission({limit:1,now:()=>clock})
 limiter.complete(limiter.begin('tenant-a:user-a'),{success:true})
 clock=1_501
 assert.throws(()=>limiter.begin('tenant-a:user-a'),error=>error.code==='realtime_voice_rate_limit'&&error.retryAfterSeconds===599)
 limiter.complete(limiter.begin('tenant-b:user-a'),{success:true})
 clock=600_000
 assert.equal(limiter.inspect('tenant-a:user-a').allowed,true)
 assert.equal(limiter.inspect('tenant-b:user-a').allowed,false)
 for(let index=0;index<60;index++)limiter.assertRequestAllowed('abuse')
 assert.throws(()=>limiter.assertRequestAllowed('abuse'),error=>error.code==='realtime_voice_request_limit'&&error.retryAfterSeconds===60)
 assert.equal(limiter.inspect('abuse').allowed,true)
 clock+=60_000
 assert.doesNotThrow(()=>limiter.assertRequestAllowed('abuse'))
})

test('voice recovery observability keeps error categories and retry timing without raw provider content',()=>{
 const logs=[]
 runWithRequestContext({path:'/api/v1/realtime-voice/sessions',method:'POST'},()=>observe('val.realtime_voice',{errorCode:'realtime_voice_session_failed',providerStatus:503,retryAfterSeconds:4,providerBody:'PROVIDER_PRIVATE_BODY',clientSecret:'ek_PRIVATE'}),{logger:line=>logs.push(JSON.parse(line))})
 assert.equal(logs[0].providerStatus,503)
 assert.equal(logs[0].retryAfterSeconds,4)
 assert.equal(logs[0].errorCode,'realtime_voice_session_failed')
 assert.doesNotMatch(JSON.stringify(logs),/PROVIDER_PRIVATE_BODY|ek_PRIVATE/)
})
