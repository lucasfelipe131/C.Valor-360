import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const server=read('../server.js')
const openapi=read('../openapi/val-core-v1.yaml')

function section(source,start,end){
 const from=source.indexOf(start)
 assert.notEqual(from,-1,`Seção ausente: ${start}`)
 const to=end?source.indexOf(end,from+start.length):-1
 return source.slice(from,to<0?source.length:to)
}

test('Voice API — as seis operações aditivas estão ligadas ao VoiceCaptureService',()=>{
 const route=section(server,"if(url.pathname==='/api/v1/voice-interactions'", "if(url.pathname==='/api/grains/bootstrap'")
 assert.match(route,/request\.method==='POST'[\s\S]*voiceCapture\.create\(/)
 assert.match(route,/voiceInteractionMatch=url\.pathname\.match\(\/\^\\\/api\\\/v1\\\/voice-interactions/)
 assert.match(route,/!action&&request\.method==='GET'[\s\S]*voiceCapture\.get\(/)
 for(const [action,method] of [['audio','uploadAudio'],['process','process'],['confirm','confirm'],['cancel','cancel']]){
  assert.match(route,new RegExp(`action==='${action}'[\\s\\S]*voiceCapture\\.${method}\\(`))
 }
 assert.match(route,/consumeRateLimit\('voice',actorId,config\.voiceRequestsPerTenMinutes\)/)
 assert.doesNotMatch(route,/payload\.(?:organization_id|organizationId|tenant_id|tenantId|actor_id|actorId)/)
})

test('Voice API — autenticação, tenant e ator são derivados da sessão antes das rotas',()=>{
 const protectedIndex=server.indexOf("url.pathname.startsWith('/api/v1/voice-interactions')")
 const unauthorizedIndex=server.indexOf('if(protectedPath&&auth.configured&&!identity)')
 const routeIndex=server.indexOf("if(url.pathname==='/api/v1/voice-interactions'")
 assert.ok(protectedIndex>0&&protectedIndex<unauthorizedIndex&&unauthorizedIndex<routeIndex)
 const route=section(server,"if(url.pathname==='/api/v1/voice-interactions'", "if(url.pathname==='/api/grains/bootstrap'")
 assert.match(route,/actorId=String\(identity\?\.id\|\|identity\?\.email\|\|'demo@valor360\.local'\)/)
 assert.match(route,/tenantId:identity\?\.tenantId\|\|config\.defaultTenantId/)
 assert.match(route,/ownerId:identity\?\.id,actorId/)
 assert.match(server,/if\(protectedPath&&identity\?\.mustChangePassword\)return json\(response,403/)
})

test('Voice OpenAPI — documenta cada rota, verbo, segurança e resposta versionada',()=>{
 const routes=[
  ['/api/v1/voice-interactions:','post:','createVoiceInteraction'],
  ['/api/v1/voice-interactions/{voiceInteractionId}/audio:','post:','uploadVoiceInteractionAudio'],
  ['/api/v1/voice-interactions/{voiceInteractionId}/process:','post:','processVoiceInteraction'],
  ['/api/v1/voice-interactions/{voiceInteractionId}:','get:','getVoiceInteraction'],
  ['/api/v1/voice-interactions/{voiceInteractionId}/confirm:','post:','confirmVoiceInteraction'],
  ['/api/v1/voice-interactions/{voiceInteractionId}/cancel:','post:','cancelVoiceInteraction']
 ]
 for(let index=0;index<routes.length;index+=1){
  const [path,verb,operationId]=routes[index]
  const next=routes[index+1]?.[0]||'  /api/v1/visits/{visitId}/preparation:'
  const block=section(openapi,`  ${path}`,`  ${next}`)
  assert.match(block,new RegExp(`\\n    ${verb.replace(':','')}:`))
  assert.match(block,new RegExp(`operationId: ${operationId}`))
  assert.match(block,/security: \[\{sessionCookie: \[\]\}\]/)
  assert.match(block,/'401': \{\$ref: '#\/components\/responses\/Error'\}/)
  assert.match(block,/'403': \{\$ref: '#\/components\/responses\/Error'\}/)
 }
 assert.match(openapi,/voice_interaction: \{\$ref: '\.\.\/contracts\/v1\/voice-interaction\.schema\.json'\}/)
})

test('Voice OpenAPI — entrada não aceita tenant/ator e confirmação humana permanece explícita',()=>{
 const createSchema=section(openapi,'    VoiceInteractionCreateInput:','    VoiceAudioUploadInput:')
 assert.doesNotMatch(createSchema,/organization_id|tenant_id|actor_id/)
 assert.match(createSchema,/required: \[client_id, interaction_type\]/)
 assert.match(createSchema,/interaction_type: \{enum: \[PRE_VISIT, FIELD_NOTE, POST_VISIT, CLIENT_NOTE, GENERAL_CONTEXT\]\}/)
 assert.match(createSchema,/manual_text:/)
 const confirmation=section(openapi,'    VoiceConfirmationInput:','    VoiceInteractionResponse:')
 assert.match(confirmation,/decision: \{enum: \[CONFIRMED, REJECTED\]\}/)
 assert.match(confirmation,/additions:/)
 assert.doesNotMatch(confirmation,/KnowledgeItem|VALIDATED_KNOWLEDGE/)
})

test('Voice API — contratos novos não removem as rotas legadas das Fases 2–6',()=>{
 for(const legacy of [
  "/api/val/chat",
  "/api/val/recommendations",
  "/api/v1/val/recommendations",
  "/api/v1/visits/",
  "/api/v1/commitments",
  "/api/v1/outcomes"
 ])assert.match(server,new RegExp(legacy.replaceAll('/','\\/')))
})
