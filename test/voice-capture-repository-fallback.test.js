import assert from 'node:assert/strict'
import test from 'node:test'
import {ValRepository} from '../server/repository.js'

const tenantA='00000000-0000-4000-8000-000000000a01'
const tenantB='00000000-0000-4000-8000-000000000b01'
const actorA='00000000-0000-4000-8000-000000000a02'
const actorB='00000000-0000-4000-8000-000000000a03'
const clientA='producer-voice-a'
const interactionId='00000000-0000-4000-8000-000000000a04'
const transcriptId='00000000-0000-4000-8000-000000000a05'
const now='2026-08-23T15:00:00.000Z'

function repositories(){
 let store={}
 const readStore=()=>structuredClone(store)
 const saveStore=value=>{store=structuredClone(value)}
 const create=tenantId=>new ValRepository({db:{configured:false},readStore,saveStore,tenantId})
 return {repoA:create(tenantA),repoB:create(tenantB),read:()=>structuredClone(store)}
}

async function created(repository){
 return repository.createVoiceInteraction({
  tenantId:tenantA,
  ownerId:actorA,
  actorId:actorA,
  clientId:clientA,
  interactionType:'CLIENT_NOTE',
  sourceContext:{surface:'CLIENT_360'},
  id:interactionId,
  now
 })
}

async function transcript(repository){
 return repository.saveVoiceTranscript({
  tenantId:tenantA,
  ownerId:actorA,
  actorId:actorA,
  transcript:{
   transcript_id:transcriptId,
   organization_id:tenantA,
   voice_interaction_id:interactionId,
   client_id:clientA,
   created_by:actorA,
   provider:'manual',
   model:'fixture-v1',
   provider_version:'fixture.1',
   status:'COMPLETED',
   transcript_text:'O produtor pediu comparativo.',
   language:'pt-BR',
   duration_seconds:30,
   confidence:0.95,
   attempt_no:1,
   metadata:{capture_mode:'AUDIO'},
   created_at:now,
   updated_at:now,
   completed_at:now
  }
 })
}

test('Voice repository fallback — interação e transcript respeitam tenant e ator sem enumeração',async()=>{
 const {repoA,repoB}=repositories()
 const interaction=await created(repoA)
 const savedTranscript=await transcript(repoA)
 const own=await repoA.getVoiceInteraction({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:interactionId})
 assert.equal(own.voice_interaction_id,interaction.voice_interaction_id)
 assert.equal(own.transcript.transcript_id,savedTranscript.transcript_id)
 assert.equal(own.transcript.transcript_text,'O produtor pediu comparativo.')
 assert.equal(await repoA.getVoiceInteraction({tenantId:tenantA,ownerId:actorB,actorId:actorB,id:interactionId}),null)
 assert.equal(await repoA.getVoiceTranscript({tenantId:tenantA,ownerId:actorB,actorId:actorB,id:transcriptId}),null)
 assert.equal(await repoB.getVoiceInteraction({tenantId:tenantB,ownerId:actorA,actorId:actorA,id:interactionId}),null)
 assert.equal(await repoB.getVoiceTranscript({tenantId:tenantB,ownerId:actorA,actorId:actorA,id:transcriptId}),null)
 await assert.rejects(
  ()=>repoA.getVoiceInteraction({tenantId:tenantB,ownerId:actorA,actorId:actorA,id:interactionId}),
  error=>error.code==='cross_tenant_scope_denied'&&error.statusCode===403
 )
})

test('Voice repository fallback — transcript não pode ser anexado por outro tenant ou ator',async()=>{
 const {repoA,repoB}=repositories()
 await created(repoA)
 await assert.rejects(
  ()=>repoB.saveVoiceTranscript({tenantId:tenantB,ownerId:actorA,actorId:actorA,transcript:{organization_id:tenantB,voice_interaction_id:interactionId,created_by:actorA,provider:'fixture',model:'fixture',status:'COMPLETED',transcript_text:'tentativa',attempt_no:1}}),
  error=>error.statusCode===404
 )
 await assert.rejects(
  ()=>repoA.saveVoiceTranscript({tenantId:tenantA,ownerId:actorA,actorId:actorB,transcript:{organization_id:tenantA,voice_interaction_id:interactionId,created_by:actorB,provider:'fixture',model:'fixture',status:'COMPLETED',transcript_text:'tentativa',attempt_no:1}}),
  error=>error.statusCode===403
 )
})

test('Voice repository fallback — CAS rejeita estado ou revisão obsoletos',async()=>{
 const {repoA}=repositories()
 const interaction=await created(repoA)
 const updated=await repoA.updateVoiceInteraction({
  tenantId:tenantA,
  ownerId:actorA,
  actorId:actorA,
  interaction:{...interaction,state:'AUDIO_STORED',status:'AUDIO_STORED',audio_ref:'attachment:00000000-0000-4000-8000-000000000a06',duration_seconds:30,revision:2,updated_at:'2026-08-23T15:01:00.000Z'},
  expectedState:'CREATED',
  expectedRevision:1
 })
 assert.equal(updated.state,'AUDIO_STORED')
 assert.equal(updated.revision,2)
 await assert.rejects(
  ()=>repoA.updateVoiceInteraction({
   tenantId:tenantA,
   ownerId:actorA,
   actorId:actorA,
   interaction:{...interaction,state:'CANCELLED',status:'CANCELLED',revision:2},
   expectedState:'CREATED',
   expectedRevision:1
  }),
  error=>error.statusCode===409
 )
})

test('Voice repository fallback — tentativa repetida atualiza transcript sem duplicar',async()=>{
 const {repoA,read}=repositories()
 await created(repoA)
 await transcript(repoA)
 await repoA.saveVoiceTranscript({
  tenantId:tenantA,
  ownerId:actorA,
  actorId:actorA,
  transcript:{
   transcript_id:'00000000-0000-4000-8000-000000000a09',
   organization_id:tenantA,
   voice_interaction_id:interactionId,
   created_by:actorA,
   provider:'manual',
   model:'fixture-v2',
   status:'COMPLETED',
   transcript_text:'Transcrição corrigida na mesma tentativa.',
   attempt_no:1,
   created_at:now,
   updated_at:'2026-08-23T15:02:00.000Z',
   completed_at:'2026-08-23T15:02:00.000Z'
  }
 })
 assert.equal(read().val.voiceTranscripts.length,1)
 const current=await repoA.getVoiceInteraction({tenantId:tenantA,ownerId:actorA,actorId:actorA,id:interactionId})
 assert.equal(current.transcript.transcript_text,'Transcrição corrigida na mesma tentativa.')
})

test('Voice repository fallback — anexos de voz idênticos permanecem exclusivos',async()=>{
 const {repoA,read}=repositories()
 const input={tenantId:tenantA,ownerId:actorA,clientId:clientA,originalName:'voz.wav',mimeType:'audio/wav',sizeBytes:44,dataBase64:'UklGRiQAAABXQVZF',deduplicate:false}
 const first=await repoA.createAttachment(input)
 const second=await repoA.createAttachment(input)
 assert.notEqual(first.id,second.id)
 assert.equal(read().val.attachments.length,2)
 await repoA.updateAttachment({tenantId:tenantA,ownerId:actorA,id:first.id,status:'rejected',analysis:{kind:'voice_capture'}})
 const unaffected=await repoA.getAttachment({tenantId:tenantA,ownerId:actorA,id:second.id})
 assert.equal(unaffected.status,'received')
})
