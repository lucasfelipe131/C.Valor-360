import {createReadStream,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {dirname,extname,join,normalize,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import OpenAI from 'openai'
import {config,getPublicEngineConfig} from './server/config.js'
import {createDatabase} from './server/db.js'
import {createAuth} from './server/auth.js'
import {AccessRepository} from './server/access-repository.js'
import {deriveSignals,normalizeIntegrationEvent,requiresTechnicalSignature,verifyIntegrationToken,verifyWebhookSignature} from './server/ingestion.js'
import {normalizeGrainIntent,normalizeGrainMarketSnapshot,normalizeGrainProfile,intentStatuses} from './server/grain-intelligence.js'
import {GrainRepository} from './server/grain-repository.js'
import {ValRepository} from './server/repository.js'
import {currentRequestContext,observe,requestIdFrom,runWithRequestContext,updateRequestContext} from './server/observability.js'
import {publicStorageScope} from './server/storage-policy.js'
import {ValEngine} from './server/val-engine.js'
import {assertValRuntimeComposition} from './server/core/composition.js'
import {legacyRecommendationResponse,ValCore} from './server/core/val-core.js'
import {resolveCoreObjective} from './server/core/router.js'
import {createValProgressTracker,normalizeValProgressRequestId} from './server/val-progress.js'
import {createTechnicalWorkspace,isTechnicalWorkspaceRequest} from './server/technical-workspace.js'
import {buildSurveyOptions,validateSurveyAnswers} from './server/survey-validation.js'
import {compileSurveyImportBatch} from './server/survey-import.js'
import {calculateProfile} from './src/lib/profile.js'
import {buildCommercialIntelligence,summarizeLearning} from './src/lib/commercial-intelligence.js'
import {prepareVisitExecution} from './server/execution/service.js'
import {createVisitLoopService} from './server/visit-loop/service.js'
import {createOpenAITranscriptionProvider,createUnavailableTranscriptionProvider} from './server/voice-capture/transcription-provider.js'
import {createRepositoryAttachmentVoiceStorage} from './server/voice-capture/storage.js'
import {createVoiceCandidateExtractor} from './server/voice-capture/extraction.js'
import {createVoiceCaptureService} from './server/voice-capture/service.js'
import {normalizeValIntent,routeValIntent} from './server/ai-reasoning/intent-router.js'
import {buildClientMarketResponse,buildFastClientResponse,buildFastMarketResponse,finalizeAttachmentRecommendation,routeSystemCapability} from './server/decision-copilot/capability-router.js'
import {buildCapabilityExecutionResponse,buildGeneralNoClientResponse,executeCapabilityPlan,validateActiveContext} from './server/decision-copilot/capability-executor.js'
import {attachLatencyPerformance,createLatencyTrace,valLatencyMetrics} from './server/decision-copilot/latency-observability.js'
import {createSessionContextCache} from './server/decision-copilot/session-context-cache.js'
import {normalizeSessionCommand} from './server/decision-copilot/session-command-router.js'
import {probeVoiceAudioDuration,validateVoiceAudio} from './server/voice-capture/storage.js'
import {readReleaseMetadata} from './server/release-metadata.js'
import {createReadinessReport} from './server/readiness.js'
import {technicalBootstrapFromValClients} from './server/agronomic-geometry-bridge.js'

const port=Number(process.env.PORT||3000)
const appRoot=dirname(fileURLToPath(import.meta.url))
const root=resolve(appRoot,'dist')
const releaseMetadata=readReleaseMetadata({root:appRoot})
const dataRoot=process.env.DATA_DIR||join(appRoot,'.data')
const storePath=join(dataRoot,'valor360-store.json')
const profileMatrix=JSON.parse(readFileSync(join(appRoot,'src','data','profile-matrix.json'),'utf8'))
const surveyOptions=buildSurveyOptions(profileMatrix)
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'}
const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(self), microphone=(self), geolocation=(self)','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"}

mkdirSync(dataRoot,{recursive:true})
if(!existsSync(storePath))writeFileSync(storePath,JSON.stringify({surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}},null,2))

function readStore(){try{return JSON.parse(readFileSync(storePath,'utf8'))}catch{return {surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}}}
function saveStore(store){const temporary=`${storePath}.tmp`;writeFileSync(temporary,JSON.stringify(store,null,2));renameSync(temporary,storePath)}
function json(response,status,payload){response.writeHead(status,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(payload))}
function rawBody(request){return new Promise((resolve,reject)=>{let raw='';let size=0;let settled=false;const tooLarge=()=>Object.assign(new Error('Arquivo ou requisição muito grande.'),{statusCode:413,code:'request_too_large'});const fail=error=>{if(settled)return;settled=true;raw='';reject(error)};const drain=()=>{request.off('data',onData);request.resume()};const onData=chunk=>{size+=chunk.length;if(size>config.maxBodyBytes){drain();fail(tooLarge());return}raw+=chunk};const declared=Number(request.headers['content-length']);request.on('end',()=>{if(settled)return;settled=true;resolve(raw)});request.on('error',fail);if(Number.isFinite(declared)&&declared>config.maxBodyBytes){drain();fail(tooLarge());return}request.on('data',onData)})}
async function body(request){const raw=await rawBody(request);try{return raw?JSON.parse(raw):{}}catch{throw new Error('Conteúdo inválido.')}}
async function limitedResponseText(upstream,limit){const reader=upstream.body?.getReader();if(!reader)return upstream.text();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Object.assign(new Error('A planilha excede o limite seguro de importação.'),{statusCode:413})}chunks.push(value)}return new TextDecoder().decode(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))))}
const clean=value=>String(value||'').trim().slice(0,240)
const attachmentMaxBytes=6_000_000
const attachmentMimeTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg'])
const attachmentId=value=>/^[0-9a-f-]{36}$/i.test(String(value||''))?String(value):''
function normalizedAttachment(payload={}){
 const match=String(payload.dataUrl||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/)
 if(!match)throw Object.assign(new Error('O arquivo enviado não está em um formato válido.'),{statusCode:400})
 const mimeType=String(match[1]||payload.mimeType||'').toLowerCase().trim()
 if(!attachmentMimeTypes.has(mimeType))throw Object.assign(new Error('Use foto, áudio, PDF, Word, Excel, CSV ou TXT.'),{statusCode:415})
 let buffer;try{buffer=Buffer.from(match[2].replace(/\s/g,''),'base64')}catch{throw Object.assign(new Error('Não foi possível ler este arquivo.'),{statusCode:400})}
 if(!buffer.length)throw Object.assign(new Error('O arquivo está vazio.'),{statusCode:400})
 if(buffer.length>attachmentMaxBytes)throw Object.assign(new Error('Cada arquivo pode ter até 6 MB.'),{statusCode:413})
 const originalName=(String(payload.originalName||'arquivo').normalize('NFKC').replace(/[\/\\<>:\"|?*\u0000-\u001f]/g,'-').trim()||'arquivo').slice(0,240)
 return {originalName,mimeType,sizeBytes:buffer.length,dataBase64:buffer.toString('base64')}
}
const feedbackOutcomes={used:'executed',adapted:'edited',scheduled:'scheduled',discarded:'rejected',accepted:'accepted',edited:'edited',rejected:'rejected',executed:'executed',won:'won',lost:'lost'}
const pipelineStages=new Set(['Diagnóstico','Proposta','Negociação','Fechado'])
const validatedSurveyAnswers=input=>validateSurveyAnswers(input,surveyOptions)

const runtimeComposition=assertValRuntimeComposition()
const database=createDatabase(config)
const auth=createAuth(config)
const userPayload=session=>session?{id:session.id||session.sub,email:session.email,name:session.name,role:session.role,status:session.status||'active',mustChangePassword:Boolean(session.mustChangePassword),demo:false,storageScope:auth.storageScope(session)}:{id:null,email:null,name:'Demonstração',role:'admin',mustChangePassword:false,demo:true,storageScope:'demo'}
const repository=new ValRepository({db:database,readStore,saveStore,tenantId:config.defaultTenantId})
const grainRepository=new GrainRepository({db:database,readStore,saveStore,tenantId:config.defaultTenantId})
const accessRepository=new AccessRepository({db:database,tenantId:config.defaultTenantId,runtimeConfig:config})
const valEngine=new ValEngine({runtimeConfig:config,repository})
const valCore=new ValCore({engine:valEngine,tenantId:config.defaultTenantId})
const voiceOpenAI=config.openaiApiKey?new OpenAI({apiKey:config.openaiApiKey,project:config.openaiProject||undefined,timeout:config.openaiTimeoutMs,maxRetries:0}):null
const voiceTranscriptionProvider=voiceOpenAI?createOpenAITranscriptionProvider({client:voiceOpenAI,model:config.voiceTranscriptionModel,timeoutMs:Math.min(config.openaiTimeoutMs,120_000)}):createUnavailableTranscriptionProvider()
const visitLoop=createVisitLoopService({repository,transcriptionProvider:voiceTranscriptionProvider})
const voiceStorage=createRepositoryAttachmentVoiceStorage({repository,maxAudioBytes:config.voiceMaxAudioBytes,maxDurationSeconds:config.voiceMaxDurationSeconds})
const voiceExtractor=createVoiceCandidateExtractor({client:voiceOpenAI,model:config.voiceExtractionModel,timeoutMs:Math.min(config.openaiTimeoutMs,60_000)})
const voiceCapture=createVoiceCaptureService({repository,storageProvider:voiceStorage,transcriptionProvider:voiceTranscriptionProvider,extractor:voiceExtractor,visitLoop,prepareVisit:prepareVisitExecution,maxDurationSeconds:config.voiceMaxDurationSeconds})
const valProgress=createValProgressTracker()
const valSessionContextCache=createSessionContextCache()
const technicalWorkspace=createTechnicalWorkspace({appRoot,publicPort:port,runtimeConfig:config,json})
const rateBuckets=new Map()
function consumeRateLimit(scope,key,limit){const now=Date.now();const bucketKey=`${scope}:${key}`;const current=rateBuckets.get(bucketKey);if(!current||current.resetAt<=now){rateBuckets.set(bucketKey,{count:1,resetAt:now+600_000});return true}if(current.count>=limit)return false;current.count+=1;return true}
const requestIdentity=request=>String(request.socket.remoteAddress||'unknown')
const progressOwnerKey=(identity,request)=>String(identity?.id||identity?.email||requestIdentity(request))
const demoIdentity=()=>({id:null,email:'demo@valor360.local',name:'Demonstração',role:'admin',tenantId:config.defaultTenantId,mustChangePassword:false,demo:true})
async function sessionIdentity(request){
 if(!auth.configured){const identity=config.demoMode?demoIdentity():null;if(identity)updateRequestContext({tenantId:identity.tenantId,actorId:identity.id||identity.email});return identity}
 const tokenIdentity=auth.session(request)
 if(!tokenIdentity)return null
 const identity=await accessRepository.resolveSession(tokenIdentity)
 if(identity)updateRequestContext({tenantId:identity.tenantId,actorId:identity.id||identity.email})
 return identity
}

function parseCsv(text){
 const firstLine=String(text).split(/\r?\n/,1)[0]||'';let quotedDelimiter=false;const counts={',':0,';':0,'\t':0};for(let index=0;index<firstLine.length;index++){const char=firstLine[index];if(char==='"')quotedDelimiter=!quotedDelimiter;else if(!quotedDelimiter&&char in counts)counts[char]++}const delimiter=Object.entries(counts).sort((left,right)=>right[1]-left[1])[0]?.[0]||','
 const rows=[];let row=[];let cell='';let quoted=false
 for(let index=0;index<text.length;index++){
  const char=text[index]
  if(char==='"'&&quoted&&text[index+1]==='"'){cell+='"';index++;continue}
  if(char==='"'){quoted=!quoted;continue}
  if(char===delimiter&&!quoted){row.push(cell.trim());cell='';continue}
  if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[index+1]==='\n')index++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue}
  cell+=char
 }
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows
}

async function handleApi(request,response,url){
 if(url.pathname==='/live'&&request.method==='GET')return json(response,200,{status:'ok',service:'valor360'})
 if((url.pathname==='/ready'||url.pathname==='/health')&&request.method==='GET'){
  const databaseHealth=await database.health()
  const readiness=createReadinessReport({databaseHealth,authConfigured:auth.configured,demoMode:config.demoMode,openaiConfigured:Boolean(config.openaiApiKey),releaseMetadata})
  if(url.pathname==='/ready')return json(response,readiness.ready?200:503,readiness)
  return json(response,readiness.ready?200:503,{status:readiness.ready?'ok':'degraded',service:'valor360',storage:readiness.dependencies.storage.mode,ai:Boolean(config.openaiApiKey),security:readiness.dependencies.security.mode,ready:readiness.ready,dependencies:readiness.dependencies,source:readiness.source})
 }
 if(url.pathname==='/api/release'&&request.method==='GET')return json(response,releaseMetadata?.source?.match===false?409:200,releaseMetadata)
 if(url.pathname==='/api/val/status'&&request.method==='GET'){
  if(!auth.configured&&!config.demoMode)return json(response,503,{error:'A autenticação do servidor ainda não foi configurada.'})
  if(auth.configured&&!await sessionIdentity(request))return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
  const databaseHealth=await database.health();const status=await valEngine.status(databaseHealth)
  const engineConfigured=Boolean(config.openaiApiKey&&auth.configured&&databaseHealth.ready)
  return json(response,200,{...getPublicEngineConfig(),...status,mode:engineConfigured?'openai':config.openaiApiKey?'locked':'demonstration',configured:engineConfigured,keyConfigured:Boolean(config.openaiApiKey),securityReady:auth.configured,core:valCore.status(),composition:{version:runtimeComposition.version,order:[...runtimeComposition.order]}})
 }
 if(url.pathname==='/api/auth/session'&&request.method==='GET'){
  const session=await sessionIdentity(request)
  const demoAllowed=!auth.configured&&config.demoMode
  return json(response,200,{authenticated:auth.configured?Boolean(session):demoAllowed,required:!demoAllowed,demo:demoAllowed,misconfigured:!auth.configured&&!demoAllowed,user:session?userPayload(session):demoAllowed?userPayload(null):null})
 }
 if(url.pathname==='/api/auth/login'&&request.method==='POST'){
  if(!auth.configured)return config.demoMode?json(response,200,{authenticated:true,required:false,demo:true,user:userPayload(null)}):json(response,503,{error:'Configure o acesso seguro do VALOR 360 antes de entrar.'})
  if(!consumeRateLimit('login',requestIdentity(request),config.loginAttemptsPerTenMinutes))return json(response,429,{error:'Muitas tentativas de acesso. Aguarde alguns minutos.'})
  const payload=await body(request)
  const identity=await accessRepository.authenticate(payload.email,payload.password)
  if(!identity)return json(response,401,{error:'E-mail ou senha inválidos, acesso bloqueado ou expirado.'})
  const token=auth.issue(identity);response.setHeader('Set-Cookie',auth.cookie(request,token));return json(response,200,{authenticated:true,required:true,demo:false,user:userPayload(identity)})
 }
 if(url.pathname==='/api/auth/logout'&&request.method==='POST'){response.setHeader('Set-Cookie',auth.clearCookie(request));return json(response,200,{authenticated:false})}
 if(url.pathname==='/api/auth/password'&&request.method==='PUT'){
  const identity=await sessionIdentity(request);if(!identity)return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
  const payload=await body(request);const updated=await accessRepository.changePassword(identity,payload.currentPassword,payload.newPassword)
  const token=auth.issue(updated);response.setHeader('Set-Cookie',auth.cookie(request,token));return json(response,200,{saved:true,user:userPayload(updated)})
 }
 const storageScope=publicStorageScope(url.pathname,request.method)
 const protectedPath=url.pathname.startsWith('/api/grains/')||url.pathname.startsWith('/api/val/attachments')||url.pathname.startsWith('/api/v1/voice-interactions')||url.pathname.startsWith('/api/v1/visits/')||url.pathname.startsWith('/api/v1/commitments')||url.pathname==='/api/v1/outcomes'||url.pathname==='/api/v1/action-plans'||url.pathname==='/api/v1/insights'||url.pathname==='/api/val/progress'||url.pathname==='/api/val/voice/transcribe'||url.pathname==='/api/val/latency-metrics'||url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations'||url.pathname==='/api/v1/val/recommendations'||url.pathname==='/api/val/feedback'||url.pathname==='/api/intelligence'||url.pathname==='/api/intelligence/imports'||url.pathname==='/api/import/google-sheet'||url.pathname==='/api/technical/bootstrap'||url.pathname==='/api/visits'||url.pathname==='/api/opportunities'||url.pathname==='/api/surveys'||url.pathname==='/api/surveys/invitations'||url.pathname.startsWith('/api/clients/from-survey')||url.pathname==='/api/usage/events'||url.pathname.startsWith('/api/admin/')||url.pathname.startsWith('/api/portfolio-admin/')||/\/integrate$/.test(url.pathname)||/^\/api\/clients\/[^/]+(?:\/(?:context|overview))?$/.test(url.pathname)
 if(protectedPath&&!auth.configured&&!config.demoMode)return json(response,503,{error:'A autenticação do servidor ainda não foi configurada.'})
 const requestStartedAt=performance.now();const authStartedAt=performance.now()
 const identity=protectedPath?await sessionIdentity(request):null
 const authLatencyMs=performance.now()-authStartedAt
 if(protectedPath&&auth.configured&&!identity)return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
 if(protectedPath&&identity?.mustChangePassword)return json(response,403,{error:'Troque a senha temporária antes de acessar a carteira.'})
 if(protectedPath&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para operar dados fora do modo demonstrativo.'})}
 if(storageScope==='public-survey'&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para acessar questionários fora do modo demonstrativo.'})}
 const valRecommendationPath=url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations'||url.pathname==='/api/v1/val/recommendations'
 if(valRecommendationPath&&config.openaiApiKey&&!auth.configured)return json(response,503,{error:'Configure VAL_ADMIN_EMAIL, VAL_ADMIN_PASSWORD e VAL_SESSION_SECRET antes de ativar a IA em produção.'})
 if(valRecommendationPath&&config.openaiApiKey&&!database.configured)return json(response,503,{error:'Configure DATABASE_URL antes de ativar a IA com dados reais.'})
 if(url.pathname==='/api/admin/metrics'&&request.method==='GET')return json(response,200,await accessRepository.getAdminMetrics(identity,Number(url.searchParams.get('days')||30)))
 if(url.pathname==='/api/val/latency-metrics'&&request.method==='GET')return json(response,200,{...valLatencyMetrics.snapshot(),cache:valSessionContextCache.stats()})
 if(url.pathname==='/api/portfolio-admin/users'&&request.method==='GET')return json(response,200,{users:await accessRepository.listUsers(identity)})
 if(url.pathname==='/api/portfolio-admin/users'&&request.method==='POST')return json(response,201,await accessRepository.createUser(identity,await body(request)))
 if(url.pathname==='/api/portfolio-admin/users'&&request.method==='PATCH')return json(response,200,{saved:true,user:await accessRepository.updateUser(identity,await body(request))})
 if(url.pathname==='/api/portfolio-admin/users/reset-password'&&request.method==='POST'){
  const payload=await body(request);return json(response,200,{saved:true,...await accessRepository.resetPassword(identity,payload.id)})
 }
 if(url.pathname==='/api/usage/events'&&request.method==='POST'){
  const payload=await body(request)
  if(payload.eventType==='agro_hero_interaction'){
   const allowedActions=new Set(['voice','text','photo','file']);const allowedStatuses=new Set(['idle','loading','success','error']);const allowedPhases=new Set(['idle','dispatching','integration','permission','processing','recording','requesting','selecting','validation','composer_open','delivered','cancelled'])
   const action=clean(payload.metadata?.action).toLowerCase();const status=clean(payload.metadata?.status).toLowerCase();const phase=clean(payload.metadata?.phase).toLowerCase()
   if(!allowedActions.has(action)||!allowedStatuses.has(status)||!allowedPhases.has(phase))return json(response,400,{error:'Evento do hero inválido.',code:'agro_hero_event_invalid'})
   const errorCode=clean(payload.metadata?.errorCode).toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,80)||null
   const contextTypes=[...new Set((Array.isArray(payload.metadata?.contextTypes)?payload.metadata.contextTypes:[]).map(value=>clean(value).toLowerCase().replace(/[^a-z0-9_-]/g,'')).filter(Boolean))].slice(0,8)
   const entityType=clean(payload.entityType)==='client'?'client':null;const entityId=entityType?clean(payload.entityId)||null:null
   await accessRepository.recordUsage(identity,{eventType:'agro_hero_interaction',page:'agro',entityType,entityId,metadata:{action,status,phase,...(errorCode?{errorCode}:{}),contextTypes}})
   return json(response,202,{accepted:true})
  }
  await accessRepository.recordUsage(identity,{eventType:'page_view',page:clean(payload.page),entityType:clean(payload.entityType),entityId:clean(payload.entityId)});return json(response,202,{accepted:true})
 }
 if(url.pathname==='/api/val/voice/transcribe'&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local')
  if(!consumeRateLimit('voice-transient',actorId,config.voiceRequestsPerTenMinutes*2))return json(response,429,{error:'Limite temporário de transcrições atingido. Aguarde alguns minutos.',code:'voice_rate_limit'})
  const payload=await body(request);const supplied=payload?.attachment?.file&&typeof payload.attachment.file==='object'?payload.attachment.file:payload
  const audio=validateVoiceAudio({dataBase64:supplied.dataUrl||supplied.dataBase64,mimeType:supplied.mimeType,originalName:supplied.originalName||supplied.name,durationSeconds:supplied.durationSeconds})
  const durationSeconds=await probeVoiceAudioDuration({bytes:audio.bytes,mimeType:audio.mimeType})
  const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
  const startedAt=Date.now();const transcription=await voiceTranscriptionProvider.transcribe({bytes:audio.bytes,mimeType:audio.mimeType,fileName:audio.originalName,durationSeconds,language:'pt-BR',signal:controller.signal})
  observe('voice.transient.transcribed',{provider:transcription.provider,model:transcription.model,sizeBytes:audio.bytes.length,durationSeconds,durationMs:Date.now()-startedAt,outcome:'ok'})
  return json(response,200,{contract_version:'val.voice_transient.v1',transcript:transcription.text,language:transcription.language||'pt-BR',durationSeconds:transcription.duration_seconds||durationSeconds,persistenceMode:'NONE',storage:'NONE'})
 }
 if(url.pathname==='/api/v1/voice-interactions'&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local');if(!consumeRateLimit('voice-create',actorId,config.voiceRequestsPerTenMinutes*2))return json(response,429,{error:'Limite temporário de capturas atingido. Aguarde alguns minutos.',code:'voice_rate_limit'});const payload=await body(request)
  const result=await voiceCapture.create({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,actorId,input:payload,requestId:currentRequestContext()?.requestId})
  await accessRepository.recordUsage(identity,{eventType:'voice_interaction_created',page:'val',entityType:'voice_interaction',entityId:result.voice_interaction.voice_interaction_id,metadata:{interactionType:result.voice_interaction.interaction_type,captureMode:result.voice_interaction.source_context?.capture_mode}}).catch(()=>null)
  return json(response,201,result)
 }
 const voiceInteractionMatch=url.pathname.match(/^\/api\/v1\/voice-interactions\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(audio|process|confirm|cancel))?$/i)
 if(voiceInteractionMatch){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local');const tenantId=identity?.tenantId||config.defaultTenantId;const id=voiceInteractionMatch[1];const action=voiceInteractionMatch[2]||''
  if(!action&&request.method==='GET')return json(response,200,await voiceCapture.get({tenantId,ownerId:identity?.id,actorId,id}))
  if(action==='audio'&&request.method==='POST'){
   if(!consumeRateLimit('voice-upload',actorId,config.voiceRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de uploads de áudio atingido. Aguarde alguns minutos.',code:'voice_rate_limit'})
   const result=await voiceCapture.uploadAudio({tenantId,ownerId:identity?.id,actorId,id,input:await body(request)})
   await accessRepository.recordUsage(identity,{eventType:'voice_audio_uploaded',page:'val',entityType:'voice_interaction',entityId:id,metadata:{interactionType:result.voice_interaction.interaction_type,durationSeconds:result.voice_interaction.duration_seconds}}).catch(()=>null)
   return json(response,200,result)
  }
  if(action==='process'&&request.method==='POST'){
   if(!consumeRateLimit('voice',actorId,config.voiceRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de processamentos de áudio atingido. Aguarde alguns minutos.',code:'voice_rate_limit'})
   await body(request);const result=await voiceCapture.process({tenantId,ownerId:identity?.id,actorId,id,requestId:currentRequestContext()?.requestId})
   await accessRepository.recordUsage(identity,{eventType:'voice_interaction_processed',page:'val',entityType:'voice_interaction',entityId:id,metadata:{interactionType:result.voice_interaction.interaction_type,status:result.voice_interaction.state,candidateCount:result.voice_interaction.candidates?.length||0}}).catch(()=>null)
   return json(response,200,result)
  }
  if(action==='confirm'&&request.method==='POST'){
   if(!consumeRateLimit('voice-confirm',actorId,config.voiceRequestsPerTenMinutes*2))return json(response,429,{error:'Limite temporário de confirmações atingido. Aguarde alguns minutos.',code:'voice_rate_limit'})
   const result=await voiceCapture.confirm({tenantId,ownerId:identity?.id,actorId,id,input:await body(request),requestId:currentRequestContext()?.requestId})
   const confirmedClientId=clean(result.voice_interaction?.client_id||result.voice_interaction?.clientId||result.voice_interaction?.source_context?.client_id)
   if(confirmedClientId)valSessionContextCache.invalidate({tenantId,ownerId:identity?.id||identity?.email,clientId:confirmedClientId})
   await accessRepository.recordUsage(identity,{eventType:'voice_interaction_confirmed',page:'val',entityType:'voice_interaction',entityId:id,metadata:{interactionType:result.voice_interaction.interaction_type,status:result.voice_interaction.state,confirmedCandidates:result.voice_interaction.reviewed_candidates?.filter(item=>item.review_status==='CONFIRMED').length||0}}).catch(()=>null)
   return json(response,200,result)
  }
  if(action==='cancel'&&request.method==='POST'){
   await body(request);const result=await voiceCapture.cancel({tenantId,ownerId:identity?.id,actorId,id})
   await accessRepository.recordUsage(identity,{eventType:'voice_interaction_cancelled',page:'val',entityType:'voice_interaction',entityId:id,metadata:{interactionType:result.voice_interaction.interaction_type,status:result.voice_interaction.state}}).catch(()=>null)
   return json(response,200,result)
  }
 }
 if(url.pathname==='/api/grains/bootstrap'&&request.method==='GET'){
  const workspace=await grainRepository.getWorkspace(identity?.id)
  return json(response,200,workspace)
 }
 if(url.pathname==='/api/grains/profiles'&&request.method==='PUT'){
  const profile=normalizeGrainProfile(await body(request));const saved=await grainRepository.saveProfile(profile,identity?.id)
  await accessRepository.recordUsage(identity,{eventType:'sog_profile_saved',page:'val',entityType:'client',entityId:profile.clientId,metadata:{confirmed:profile.confirmed,source:profile.source}})
  return json(response,200,{saved:true,profile:saved})
 }
 if(url.pathname==='/api/grains/intents'&&request.method==='POST'){
  const intention=normalizeGrainIntent(await body(request));const saved=await grainRepository.saveIntent(intention,identity?.id)
  await accessRepository.recordUsage(identity,{eventType:'sog_intent_saved',page:'val',entityType:'client',entityId:intention.clientId,metadata:{commodity:intention.commodity,status:intention.status,source:intention.source}})
  return json(response,201,{saved:true,intention:saved})
 }
 const grainIntentMatch=url.pathname.match(/^\/api\/grains\/intents\/([0-9a-f-]{36})$/i)
 if(grainIntentMatch&&request.method==='PATCH'){
  const payload=await body(request);const status=clean(payload.status)
  if(!intentStatuses.has(status))return json(response,400,{error:'O estado da intenção é inválido.'})
  const intention=await grainRepository.updateIntentStatus(grainIntentMatch[1],status,identity?.id)
  await accessRepository.recordUsage(identity,{eventType:'sog_intent_status',page:'val',entityType:'grain_intent',entityId:grainIntentMatch[1],metadata:{status}})
  return json(response,200,{saved:true,intention})
 }
 if(url.pathname==='/api/grains/market'&&request.method==='POST'){
  const snapshot=normalizeGrainMarketSnapshot(await body(request));const saved=await grainRepository.saveMarketSnapshot(snapshot,identity?.id)
  await accessRepository.recordUsage(identity,{eventType:'sog_market_saved',page:'val',entityType:'grain_market',entityId:saved.id,metadata:{commodity:snapshot.commodity,source:snapshot.sourceName}})
  return json(response,201,{saved:true,marketSnapshot:saved})
 }
 if(url.pathname==='/api/technical/bootstrap'&&request.method==='GET'){
  const clients=await repository.getTechnicalBootstrap(identity?.id)
  const bootstrap=technicalBootstrapFromValClients(clients,{organizationId:identity?.tenantId||config.defaultTenantId})
  return json(response,200,{...bootstrap,source:'valor360',syncedAt:new Date().toISOString()})
 }
 if(url.pathname==='/api/val/progress'&&request.method==='GET'){
  const requestId=normalizeValProgressRequestId(url.searchParams.get('requestId'))
  if(!requestId)return json(response,400,{error:'Identificador de acompanhamento inválido.'})
  const progress=valProgress.get({requestId,ownerId:progressOwnerKey(identity,request)})
  if(!progress)return json(response,404,{error:'Acompanhamento não encontrado ou já encerrado.'})
  return json(response,200,progress)
 }
 if(url.pathname==='/api/val/attachments'&&request.method==='GET'){
  const clientId=clean(url.searchParams.get('clientId'));const association=clean(url.searchParams.get('association')).toUpperCase();if(!clientId&&association!=='UNLINKED')return json(response,400,{error:'Selecione um produtor ou informe explicitamente association=UNLINKED.'})
  const attachments=await repository.listAttachments({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId,limit:30})
  return json(response,200,{attachments})
 }
 if(url.pathname==='/api/val/attachments'&&request.method==='POST'){
  const payload=await body(request);const clientId=clean(payload.clientId);const association=clean(payload.association).toUpperCase()||'LINKED_CLIENT';if(!['LINKED_CLIENT','UNLINKED'].includes(association))return json(response,400,{error:'Associação de arquivo inválida.'});if(association==='LINKED_CLIENT'&&!clientId)return json(response,400,{error:'Selecione um produtor antes de anexar.'});if(association==='UNLINKED'&&clientId)return json(response,400,{error:'Um attachment UNLINKED não pode declarar produtor.'})
  const normalized=normalizedAttachment(payload)
  const attachment=await repository.createAttachment({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId:clientId||null,association,...normalized})
  if(clientId)valSessionContextCache.invalidate({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id||identity?.email,clientId})
  await accessRepository.recordUsage(identity,{eventType:'val_attachment_uploaded',page:'val',entityType:clientId?'client':'attachment',entityId:clientId||attachment.id,metadata:{attachmentId:attachment.id,association,mimeType:normalized.mimeType,sizeBytes:normalized.sizeBytes}})
  return json(response,201,{attachment})
 }
 if(url.pathname==='/api/val/attachments'&&request.method==='PATCH'){
  const payload=await body(request);const id=attachmentId(payload.id);if(!id)return json(response,400,{error:'Arquivo inválido.'})
  const status=clean(payload.status);const analysis=payload.analysis&&typeof payload.analysis==='object'?payload.analysis:undefined
  const attachment=await repository.updateAttachment({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,id,status,analysis})
  if(attachment.clientId)valSessionContextCache.invalidate({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id||identity?.email,clientId:attachment.clientId})
  await accessRepository.recordUsage(identity,{eventType:'val_attachment_'+status,page:'val',entityType:attachment.clientId?'client':'attachment',entityId:attachment.clientId||attachment.id,metadata:{attachmentId:id,association:attachment.association}})
  return json(response,200,{attachment})
 }
 const attachmentContentMatch=url.pathname.match(/^\/api\/val\/attachments\/([0-9a-f-]{36})$/i)
 if(attachmentContentMatch&&request.method==='GET'){
  const attachment=await repository.getAttachment({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,id:attachmentContentMatch[1]})
  if(!attachment)return json(response,404,{error:'Arquivo não encontrado.'})
  const binary=Buffer.from(attachment.dataBase64||'','base64')
  response.writeHead(200,{...securityHeaders,'Content-Type':attachment.mimeType,'Content-Length':binary.length,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(attachment.originalName),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
  response.end(binary);return true
 }
 if(valRecommendationPath&&request.method==='POST'){
  const intentStartedAt=performance.now()
  const rateIdentity=identity?.id||identity?.email||requestIdentity(request)
  if(!consumeRateLimit('val',rateIdentity,config.aiRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de análises atingido. Aguarde alguns minutos.'})
  const payload=await body(request);const attachmentIds=[...new Set((Array.isArray(payload.attachmentIds)?payload.attachmentIds:[]).map(attachmentId).filter(Boolean))].slice(0,3);const message=String(payload.message||payload.question||(attachmentIds.length?'Leia os arquivos que enviei e me diga o que importa.':'Prepare a próxima melhor ação.')).trim().slice(0,3000)
  const clientId=clean(payload.clientId||payload.client?.id)
  const requestedIntent=payload.intent==null?'':String(payload.intent)
  const requestedSessionCommand=payload.sessionCommand==null?'':String(payload.sessionCommand)
  if(requestedSessionCommand&&!normalizeSessionCommand(requestedSessionCommand))return json(response,400,{error:'O comando de conversa informado não é reconhecido.',code:'val_session_command_invalid'})
  const activeContext=payload.context&&typeof payload.context==='object'&&!Array.isArray(payload.context)?{type:clean(payload.context.type).toLowerCase(),id:clean(payload.context.id),label:clean(payload.context.label)}:null
  if(requestedIntent&&!normalizeValIntent(requestedIntent))return json(response,400,{error:'A intenção informada não é reconhecida pela VAL.',code:'val_intent_invalid'})
  if(attachmentIds.length&&!clientId)return json(response,422,{error:'Escolha o produtor antes de anexar uma evidência à conta.',code:'val_attachment_client_required'})
  const requestedAttachments=attachmentIds.length?await repository.getAttachments({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId,ids:attachmentIds}):[]
  const requestedAttachmentIds=new Set(requestedAttachments.map(item=>String(item.id)))
  if(attachmentIds.some(id=>!requestedAttachmentIds.has(String(id))))return json(response,404,{error:'Um ou mais arquivos não pertencem ao produtor selecionado ou não estão mais disponíveis.',code:'val_attachment_scope_invalid'})
  if(requestedAttachments.some(item=>!item.dataBase64))return json(response,422,{error:'Um ou mais arquivos persistidos não puderam ser carregados para análise.',code:'val_attachment_content_unavailable'})
  const requestedAttachmentTypes=requestedAttachments.map(item=>String(item.mimeType||'').toLowerCase()).filter(Boolean)
  const routedIntent=routeValIntent({message,intentHint:requestedIntent,sessionCommandHint:requestedSessionCommand,hasClient:Boolean(clientId),attachmentTypes:requestedAttachmentTypes})
  if(routedIntent.persistence_mode!=='NONE'){
   if(clientId)valSessionContextCache.invalidate({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id||identity?.email,clientId})
   return json(response,409,{error:'Use Registrar informação para revisar e confirmar qualquer atualização de memória.',code:'val_confirmation_required'})
  }
  const conversationId=clean(payload.conversationId)
  const requestId=normalizeValProgressRequestId(payload.requestId)||randomUUID()
  if(!clientId){
   const capability=routeSystemCapability({message,intentHint:routedIntent.intent,sessionCommandHint:requestedSessionCommand,hasClient:false,activeContext})
   const latency=createLatencyTrace({path:capability.path,intent:routedIntent.intent,startAt:requestStartedAt});latency.set('AUTH',authLatencyMs);latency.set('INTENT',performance.now()-intentStartedAt)
   const complete=(payloadResult,execution=null)=>{latency.firstUseful();const values=latency.finish({record:false});const enriched=attachLatencyPerformance(payloadResult,{latency:values,path:capability.path,intent:routedIntent.intent,toolExecution:execution});const measuredLatency=enriched?.responseMetadata?.performance?.latency||values;valLatencyMetrics.record({path:capability.path,intent:routedIntent.intent,latency:measuredLatency});observe('val.answer.completed',{mode:'direct',engineMode:'rules',intent:routedIntent.intent,reasoningPath:capability.path,capability:execution?.tool_result?.capability||capability.capabilities[0],capabilityStatus:execution?.tool_result?.status,ttfrMs:measuredLatency.TTFR,outcome:'ok'});return enriched}
   if(activeContext)validateActiveContext({activeContext,context:{},clientId:''})
   if(capability.current_data_required&&capability.capabilities.some(item=>['WEATHER','LABELS'].includes(item)))return json(response,422,{error:'A fonte atual autorizada não está conectada neste ambiente. A VAL não usará memória ou conteúdo antigo como dado atual.',code:'val_current_source_unavailable',intent:routedIntent.intent,reasoningPath:capability.path,capabilitiesPlanned:capability.capabilities})
   if(capability.capabilities.includes('MARKET_COMMODITY')){
    const startedAt=Date.now();latency.start('TOOL');const workspace=await grainRepository.getMarketReferences(identity?.id);latency.end('TOOL')
    const fast=buildFastMarketResponse({workspace,message,intentHint:routedIntent.intent,organizationId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id||identity?.email,conversationId,latencyMs:Date.now()-startedAt})
    const final=complete(fast)
    await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'portfolio',entityId:null,metadata:{mode:capability.path.toLowerCase(),engineMode:'rules',intent:routedIntent.intent,reasoningPath:capability.path,currentDataStatus:fast.responseMetadata.currentDataStatus}})
    return json(response,200,final)
   }
   if(capability.session_command){
    latency.start('TOOL');const execution=await executeCapabilityPlan({route:capability,message,context:{priorRecommendations:[]},clientId:'',activeContext});latency.end('TOOL')
    const direct=buildCapabilityExecutionResponse({execution,route:capability,message,organizationId:identity?.tenantId||config.defaultTenantId,conversationId})
    return json(response,200,complete(direct,execution))
   }
   const general=buildGeneralNoClientResponse({message,route:capability,organizationId:identity?.tenantId||config.defaultTenantId,conversationId})
   return json(response,200,complete(general))
  }
  const clientCapability=routeSystemCapability({message,intentHint:routedIntent.intent,sessionCommandHint:requestedSessionCommand,hasClient:true,attachmentTypes:requestedAttachmentTypes,activeContext})
  const latency=createLatencyTrace({path:clientCapability.path,intent:routedIntent.intent,startAt:requestStartedAt});latency.set('AUTH',authLatencyMs);latency.set('INTENT',performance.now()-intentStartedAt)
  const tenantId=identity?.tenantId||config.defaultTenantId;const scopedOwnerId=identity?.id||identity?.email
  let authorizedContext=null;let activeContextRef=null;let toolExecution=null
  const loadAuthorizedContext=async()=>{
   if(authorizedContext)return authorizedContext
   latency.start('CONTEXT')
   authorizedContext=await valSessionContextCache.getOrLoad({tenantId,ownerId:scopedOwnerId,clientId},()=>repository.getClientContext({tenantId,ownerId:identity?.id,clientId,client:payload.client||{},contextRequest:{requestId,objective:`copilot_${clientCapability.path.toLowerCase()}`,actorRole:identity?.role||'consultant',conversationId}}))
   latency.end('CONTEXT');return authorizedContext
  }
  const completeClient=(payloadResult,execution=toolExecution)=>{latency.firstUseful();const values=latency.finish({record:false});const enriched=attachLatencyPerformance(payloadResult,{latency:values,path:clientCapability.path,intent:routedIntent.intent,toolExecution:execution});const measuredLatency=enriched?.responseMetadata?.performance?.latency||values;valLatencyMetrics.record({path:clientCapability.path,intent:routedIntent.intent,latency:measuredLatency});observe('val.answer.completed',{mode:clientCapability.path.toLowerCase(),engineMode:payloadResult?.engineMode||'rules',intent:routedIntent.intent,reasoningPath:clientCapability.path,capability:execution?.tool_result?.capability||clientCapability.capabilities[0],capabilityStatus:execution?.tool_result?.status,materialityScore:clientCapability.materiality.score,engineRequired:clientCapability.materiality.engine_required,ttfrMs:measuredLatency.TTFR,outcome:'ok'});return enriched}
  if(activeContext){const scoped=await loadAuthorizedContext();activeContextRef=validateActiveContext({activeContext,context:scoped,clientId})}
  if(clientCapability.current_data_required&&clientCapability.capabilities.some(capability=>['WEATHER','LABELS'].includes(capability))){
   const missingSource=clientCapability.capabilities.includes('WEATHER')?'clima':'bula/rótulo oficial'
   return json(response,422,{error:`A fonte atual autorizada de ${missingSource} não está conectada neste ambiente. A VAL não usará memória ou conteúdo antigo como dado atual.`,code:'val_current_source_unavailable',intent:routedIntent.intent,reasoningPath:clientCapability.path,capabilitiesPlanned:clientCapability.capabilities})
  }
  if(clientCapability.path==='TOOL'||clientCapability.session_command){
   const scoped=await loadAuthorizedContext();latency.start('TOOL')
   toolExecution=await executeCapabilityPlan({route:clientCapability,message,context:scoped,attachments:requestedAttachments,clientId,activeContext})
   latency.end('TOOL');activeContextRef=toolExecution.active_context||activeContextRef
   if(clientCapability.direct||!toolExecution.reasoning_required){
    const direct=buildCapabilityExecutionResponse({execution:toolExecution,route:clientCapability,message,organizationId:tenantId,clientId,clientName:scoped.client?.name||payload.client?.name,conversationId})
    const final=completeClient(direct,toolExecution)
    await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:clientCapability.path.toLowerCase(),engineMode:'rules',intent:routedIntent.intent,reasoningPath:clientCapability.path,toolStatus:toolExecution.tool_result?.status}})
    return json(response,200,final)
   }
  }
  if(clientCapability.path==='FAST'&&clientCapability.direct&&!clientCapability.capabilities.some(item=>['MARKET_COMMODITY','VISIT_HISTORY'].includes(item))){
   const scoped=await loadAuthorizedContext();latency.start('TOOL');toolExecution=await executeCapabilityPlan({route:clientCapability,message,context:scoped,clientId,activeContext});latency.end('TOOL')
   const direct=buildCapabilityExecutionResponse({execution:toolExecution,route:clientCapability,message,organizationId:tenantId,clientId,clientName:scoped.client?.name||payload.client?.name,conversationId})
   return json(response,200,completeClient(direct,toolExecution))
  }
  let marketAttachmentBase=null
  if(clientCapability.capabilities.includes('MARKET_COMMODITY')){
   const startedAt=Date.now()
   const facts=await repository.getFastClientFacts({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId})
   if(!attachmentIds.length&&['FAST','LIVE_DATA'].includes(clientCapability.path)&&clientCapability.direct){
    latency.start('TOOL');const workspace=await grainRepository.getMarketReferences(identity?.id);latency.end('TOOL')
    const fast=buildFastMarketResponse({workspace,message,intentHint:routedIntent.intent,organizationId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id||identity?.email,conversationId,latencyMs:Date.now()-startedAt})
    await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:clientCapability.path.toLowerCase(),engineMode:'rules',intent:routedIntent.intent,reasoningPath:clientCapability.path,currentDataStatus:fast.responseMetadata.currentDataStatus}})
    return json(response,200,completeClient(fast,null))
   }
   const [context,workspace]=await Promise.all([
    loadAuthorizedContext(),
    grainRepository.getWorkspace(identity?.id)
   ])
   const deep=buildClientMarketResponse({workspace,context,facts,message,intentHint:routedIntent.intent,attachmentTypes:requestedAttachmentTypes,organizationId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id||identity?.email,conversationId,latencyMs:Date.now()-startedAt})
   if(!attachmentIds.length){
    await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:'deep',engineMode:'rules',intent:routedIntent.intent,reasoningPath:'DEEP',currentDataStatus:deep.responseMetadata.currentDataStatus}})
    return json(response,200,completeClient(deep,null))
   }
   marketAttachmentBase=deep
  }
  if(!attachmentIds.length&&clientCapability.direct&&clientCapability.path==='FAST'&&clientCapability.capabilities.includes('VISIT_HISTORY')){
   const startedAt=Date.now();const facts=await repository.getFastClientFacts({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId})
   const fast=buildFastClientResponse({facts,message,organizationId:identity?.tenantId||config.defaultTenantId,conversationId,latencyMs:Date.now()-startedAt})
   await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:'fast',engineMode:'rules',intent:routedIntent.intent,reasoningPath:'FAST'}})
   return json(response,200,completeClient(fast,null))
  }
  const ownerKey=progressOwnerKey(identity,request)
  const requestMode=clean(payload.mode)||'daily'
  valProgress.start({requestId,ownerId:ownerKey,clientId,mode:requestMode})
  const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
  try{
   observe('val.answer.started',{mode:requestMode,attachmentCount:attachmentIds.length})
   const actorId=String(identity?.id||identity?.email||'demo@valor360.local')
   const organizationId=String(identity?.tenantId||config.defaultTenantId)
   const requestedStage=clean(payload.requestedStage)
   const requestEnvelope=valCore.createRequest({
    request_id:currentRequestContext()?.requestId,
    organization_id:organizationId,
    actor:{id:actorId,role:identity?.role||'consultant'},
    subject:{type:'client',id:clientId},
    objective:resolveCoreObjective({message,requestedStage}),
    context_refs:[{type:'client',id:clientId},...(activeContextRef?[{type:activeContextRef.type,id:activeContextRef.id}]:[]),...attachmentIds.map(id=>({type:'attachment',id}))],
    policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:actorId}
   })
   const finalizeRecommendation=attachmentIds.length?draft=>finalizeAttachmentRecommendation({draft,attachmentIds,attachmentTypes:requestedAttachmentTypes,marketResponse:marketAttachmentBase}):undefined
   latency.start('MODEL')
   const coreResponse=await valCore.execute(requestEnvelope,{engineInput:{tenantId:organizationId,ownerId:identity?.id,clientId,client:payload.client||{},message,attachmentIds,mode:requestMode,requestedStage:clean(payload.requestedStage),intent:routedIntent.intent,conversationId,finalizeRecommendation,signal:controller.signal,onProgress:stage=>valProgress.update({requestId,ownerId:ownerKey,stage})}})
   latency.end('MODEL')
   let result=coreResponse.recommendation
   latency.start('VALIDATION')
   if(attachmentIds.length){
    const processed=new Set((Array.isArray(result.attachments)?result.attachments:[]).filter(item=>['interpreted','confirmed'].includes(String(item?.status||'').toLowerCase())).map(item=>String(item.id)))
    if(attachmentIds.some(id=>!processed.has(String(id)))){valProgress.fail({requestId,ownerId:ownerKey});controller.abort();return json(response,422,{error:'A VAL validou os arquivos, mas a leitura multimodal não ficou disponível. Nenhuma cotação, diagnóstico, clima ou bula foi apresentado como se o anexo tivesse sido consumido.',code:'val_attachment_analysis_unavailable',intent:routedIntent.intent,reasoningPath:'DEEP',capabilitiesPlanned:clientCapability.capabilities})}
    if(marketAttachmentBase&&result.responseMetadata?.attachmentCompositionStatus!=='EXECUTED'){valProgress.fail({requestId,ownerId:ownerKey});controller.abort();return json(response,422,{error:'A leitura do anexo não foi composta com a cotação atual antes da persistência.',code:'val_attachment_composition_unavailable',intent:routedIntent.intent,reasoningPath:'DEEP',capabilitiesPlanned:clientCapability.capabilities})}
   }
   latency.end('VALIDATION')
   if(toolExecution&&attachmentIds.length){
    const scoped=authorizedContext||await loadAuthorizedContext();toolExecution=await executeCapabilityPlan({route:clientCapability,message,context:scoped,attachments:result.attachments||requestedAttachments,clientId,activeContext})
   }
   valProgress.complete({requestId,ownerId:ownerKey})
   await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:requestMode,engineMode:result.engineMode,attachments:attachmentIds.length,intent:routedIntent.intent,conversationScoped:Boolean(conversationId)}})
   result=completeClient(result,toolExecution)
   const effectiveCoreResponse={...coreResponse,recommendation:result}
   return json(response,200,url.pathname==='/api/v1/val/recommendations'?effectiveCoreResponse:legacyRecommendationResponse(effectiveCoreResponse,requestId))
  }catch(error){valProgress.fail({requestId,ownerId:ownerKey});throw error}
 }
 if(url.pathname==='/api/val/feedback'&&request.method==='POST'){
  const payload=await body(request);const recommendationId=clean(payload.recommendationId);const rating=Number(payload.rating)
  if(!/^[0-9a-f-]{36}$/i.test(recommendationId))return json(response,400,{error:'Recomendação inválida.'})
  if(!Number.isInteger(rating)||rating<1||rating>5)return json(response,400,{error:'Avalie de 1 a 5.'})
  const requestedOutcome=clean(payload.outcome);const normalizedOutcome=requestedOutcome?feedbackOutcomes[requestedOutcome]:null
  if(requestedOutcome&&!normalizedOutcome)return json(response,400,{error:'Resultado de feedback inválido.'})
  const id=await repository.recordFeedback({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,recommendationId,rating,outcome:normalizedOutcome,value:Number.isFinite(Number(payload.value))?Number(payload.value):null,reason:clean(payload.reason)||null,notes:String(payload.notes||'').slice(0,2000)})
  await accessRepository.recordUsage(identity,{eventType:'val_feedback',page:'val',entityType:'recommendation',entityId:recommendationId})
  return json(response,201,{saved:true,id})
 }
 if(['/api/v1/integrations/manual/events','/api/integrations/manual/events'].includes(url.pathname)&&request.method==='POST'){
  const raw=await rawBody(request);const signature=request.headers['x-valor-signature'];const bearer=String(request.headers.authorization||'').replace(/^Bearer\s+/i,'')
  const signed=verifyWebhookSignature(raw,signature,config.manualWebhookSecret)
  const tokenAuthorized=verifyIntegrationToken(bearer,config.integrationToken)
  if(!signed&&!tokenAuthorized)return json(response,401,{error:'Assinatura da integração inválida.'})
  if(storageScope==='manual-event'&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para receber integrações fora do modo demonstrativo.'})}
  let payload;try{payload=raw?JSON.parse(raw):{}}catch{return json(response,400,{error:'Evento JSON inválido.'})}
  const event=normalizeIntegrationEvent({...payload,source:'manual-do-agronomo'})
  observe('integration.received',{source:'manual-do-agronomo',eventType:event.type})
  if(requiresTechnicalSignature(event.type)&&!signed)return json(response,401,{error:'Eventos técnicos validados exigem assinatura HMAC do corpo.'})
  const ownerId=database.configured?await accessRepository.resolveIntegrationOwner(event.ownerUserId):null
  const signals=deriveSignals(event);const result=await repository.ingestEvent({tenantId:config.defaultTenantId,ownerId,event,signals})
  if(!result.duplicate&&event.clientExternalKey&&ownerId)valSessionContextCache.invalidate({tenantId:config.defaultTenantId,ownerId,clientId:event.clientExternalKey})
  if(!result.duplicate)await accessRepository.recordUsage(ownerId,{eventType:'manual_sync',page:'agro',entityType:'client',entityId:event.clientExternalKey||null,metadata:{eventType:event.type}})
  return json(response,result.duplicate?200:202,{accepted:true,...result,eventType:event.type,externalId:event.externalId})
 }
 if(url.pathname==='/api/surveys'&&request.method==='GET')return json(response,200,await repository.listSurveys(identity?.id))
 if(url.pathname==='/api/surveys/invitations'&&request.method==='POST'){
  const payload=await body(request);const token=randomBytes(24).toString('base64url')
  const createdAt=new Date();const invitation={token,producerName:clean(payload.producerName),consultantName:clean(payload.consultantName)||'Equipe VALOR 360',status:'aguardando',createdAt:createdAt.toISOString(),expiresAt:new Date(createdAt.getTime()+30*86_400_000).toISOString()}
  const survey=await repository.createSurvey(invitation,identity?.id);await accessRepository.recordUsage(identity,{eventType:'survey_created',page:'questionnaire'});return json(response,201,survey)
 }
 const surveyMatch=url.pathname.match(/^\/api\/surveys\/([a-zA-Z0-9_-]+)$/)
 if(surveyMatch&&request.method==='GET'){
  if(!consumeRateLimit('survey',requestIdentity(request),60))return json(response,429,{error:'Muitas tentativas. Aguarde alguns minutos.'})
  const survey=await repository.getSurvey(surveyMatch[1]);if(!survey)return json(response,404,{error:'Este convite não foi encontrado.'});if(survey.expiresAt&&new Date(survey.expiresAt)<new Date())return json(response,410,{error:'Este convite expirou.'});return json(response,200,{token:survey.token,producerName:survey.producerName,consultantName:survey.consultantName,status:survey.status,createdAt:survey.createdAt,expiresAt:survey.expiresAt})
 }
 const submitMatch=url.pathname.match(/^\/api\/surveys\/([a-zA-Z0-9_-]+)\/submit$/)
 if(submitMatch&&request.method==='POST'){
  if(!consumeRateLimit('survey-submit',requestIdentity(request),20))return json(response,429,{error:'Muitas tentativas. Aguarde alguns minutos.'})
  const payload=await body(request)
  const answers=validatedSurveyAnswers(payload.answers)
  const survey=await repository.submitSurvey({token:submitMatch[1],answers,result:calculateProfile(answers,profileMatrix,'Questionário externo validado no servidor')});return json(response,200,{saved:true,status:survey.status})
 }
 const integrateMatch=url.pathname.match(/^\/api\/surveys\/([a-zA-Z0-9_-]+)\/integrate$/)
 if(integrateMatch&&request.method==='POST'){
  const survey=await repository.integrateSurvey(integrateMatch[1],identity?.id);await accessRepository.recordUsage(identity,{eventType:'survey_integrated',page:'questionnaire'});return json(response,200,{saved:true,status:survey.status})
 }
 if(url.pathname==='/api/intelligence'&&request.method==='GET'){
  return json(response,200,await repository.getIntelligence(identity?.id,{role:identity?.role||'consultant'}))
 }
 if(url.pathname==='/api/visits'&&request.method==='POST'){
  const payload=await body(request);const clientId=clean(payload.clientId);const objective=String(payload.objective||'').trim().slice(0,2000)
  if(!clientId||!objective)return json(response,400,{error:'Selecione o produtor e informe o objetivo da visita.'})
  const visit=await repository.saveVisit({clientId,scheduledAt:payload.scheduledAt,objective,status:'Agendada'},identity?.id);await accessRepository.recordUsage(identity,{eventType:'visit_saved',page:'visits',entityType:'client',entityId:clientId});return json(response,201,{saved:true,visit})
 }
 const visitStartMatch=url.pathname.match(/^\/api\/v1\/visits\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/start$/i)
 if(visitStartMatch&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local');const result=await repository.startVisit({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,actorId,visitId:visitStartMatch[1],requestId:currentRequestContext()?.requestId})
  await accessRepository.recordUsage(identity,{eventType:'visit_started',page:'visits',entityType:'visit',entityId:visitStartMatch[1],metadata:{lifecycleStatus:result.visit.lifecycleStatus}}).catch(()=>null)
  return json(response,200,{contract_version:'val.visit_lifecycle.response.v1',...result})
 }
 const visitPreparationMatch=url.pathname.match(/^\/api\/v1\/visits\/([0-9a-f-]{36})\/preparation$/i)
 if(visitPreparationMatch&&request.method==='GET'){
  const result=await repository.getVisitPreparation({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,visitId:visitPreparationMatch[1]})
  if(!result)return json(response,404,{error:'A visita ainda não possui preparação registrada.'})
  return json(response,200,{contract_version:'val.prepare_visit.response.v1',...result})
 }
 if(visitPreparationMatch&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local')
  const result=await prepareVisitExecution({repository,tenantId:identity?.tenantId||config.defaultTenantId,actor:{id:actorId,ownerId:identity?.id,role:identity?.role||'consultant'},visitId:visitPreparationMatch[1],requestId:currentRequestContext()?.requestId})
  await accessRepository.recordUsage(identity,{eventType:'visit_prepared',page:'visits',entityType:'visit',entityId:visitPreparationMatch[1],metadata:{actionPlanId:result.action_plan.action_plan_id}})
  return json(response,201,{contract_version:'val.prepare_visit.response.v1',...result})
 }
 const visitReportMatch=url.pathname.match(/^\/api\/v1\/visits\/([0-9a-f-]{36})\/report$/i)
 if(visitReportMatch&&request.method==='GET')return json(response,200,await visitLoop.getReport({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,visitId:visitReportMatch[1]}))
 if(visitReportMatch&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local');const payload=await body(request)
  const result=await visitLoop.createReport({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,actorId,visitId:visitReportMatch[1],input:payload,requestId:currentRequestContext()?.requestId,now:payload.occurred_at})
  await accessRepository.recordUsage(identity,{eventType:'visit_report_created',page:'visits',entityType:'visit',entityId:visitReportMatch[1],metadata:{sourceType:result.visit_report.source_type,confirmationStatus:result.visit_report.confirmation_status}})
  return json(response,201,result)
 }
 const visitConfirmMatch=url.pathname.match(/^\/api\/v1\/visits\/([0-9a-f-]{36})\/confirm$/i)
 if(visitConfirmMatch&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local');const payload=await body(request)
  const result=await visitLoop.confirmReport({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,actorId,visitId:visitConfirmMatch[1],input:payload,requestId:currentRequestContext()?.requestId})
  await accessRepository.recordUsage(identity,{eventType:'visit_report_confirmed',page:'visits',entityType:'visit',entityId:visitConfirmMatch[1],metadata:{outcomeType:result.outcome?.outcome_type,commitments:result.commitments?.length||0}})
  return json(response,200,result)
 }
 const visitLearningMatch=url.pathname.match(/^\/api\/v1\/visits\/([0-9a-f-]{36})\/learning-context$/i)
 if(visitLearningMatch&&request.method==='GET')return json(response,200,await visitLoop.learningContext({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,visitId:visitLearningMatch[1]}))
 if(url.pathname==='/api/v1/outcomes'&&request.method==='POST'){
  const actorId=String(identity?.id||identity?.email||'demo@valor360.local');const result=await visitLoop.recordOutcome({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,actorId,input:await body(request),requestId:currentRequestContext()?.requestId})
  await accessRepository.recordUsage(identity,{eventType:'visit_outcome_recorded',page:'visits',entityType:'visit',entityId:result.outcome.visit_id,metadata:{outcomeType:result.outcome.outcome_type}})
  return json(response,201,result)
 }
 if(url.pathname==='/api/v1/action-plans'&&request.method==='POST'){
  const payload=await body(request);const plan=payload.action_plan||payload.plan;const clientId=clean(payload.client_id||payload.clientId)
  if(!plan||!clientId)return json(response,400,{error:'Informe ActionPlan e produtor.'})
  const snapshot=await repository.getContextSnapshot({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,id:plan.context_snapshot_id})
  if(!snapshot)return json(response,404,{error:'ContextSnapshot não encontrado no escopo autorizado.'})
  const saved=await repository.saveActionPlan({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId,visitId:payload.visit_id||payload.visitId||null,plan,preparation:payload.preparation||null,contextSnapshot:snapshot,decisionThesisVersion:payload.decision_thesis_version, valuePlanVersion:payload.value_plan_version})
  return json(response,201,{contract_version:'val.action_plan.response.v1',action_plan:saved})
 }
 if(url.pathname==='/api/v1/commitments'&&request.method==='GET'){
  const commitments=await repository.listCommitments({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,clientId:clean(url.searchParams.get('clientId'))||null,status:clean(url.searchParams.get('status'))||null})
  return json(response,200,{contract_version:'val.commitment.collection.v1',commitments})
 }
 if(url.pathname==='/api/v1/commitments'&&request.method==='POST'){
  const payload=await body(request);const actorId=String(identity?.id||identity?.email||'demo@valor360.local')
  const actionPlanId=payload.action_plan_id??payload.actionPlanId??null
  const commitment=await repository.saveCommitment({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,actorId,input:{...payload,organization_id:identity?.tenantId||config.defaultTenantId,owner_type:'USER',owner_id:actorId,created_by:actorId,request_id:currentRequestContext()?.requestId,source_ref:payload.source_ref||payload.sourceRef||(actionPlanId?`action-plan:${actionPlanId}`:'manual:commitment')}})
  await accessRepository.recordUsage(identity,{eventType:'commitment_created',page:'visits',entityType:'client',entityId:commitment.client_id,metadata:{commitmentId:commitment.commitment_id}})
  return json(response,201,{contract_version:'val.commitment.response.v1',commitment})
 }
 const commitmentMatch=url.pathname.match(/^\/api\/v1\/commitments\/([0-9a-f-]{36})$/i)
 if(commitmentMatch&&request.method==='PATCH'){
  const commitment=await repository.updateCommitment({tenantId:identity?.tenantId||config.defaultTenantId,ownerId:identity?.id,id:commitmentMatch[1],input:{...await body(request),request_id:currentRequestContext()?.requestId}})
  await accessRepository.recordUsage(identity,{eventType:'commitment_updated',page:'visits',entityType:'client',entityId:commitment.client_id,metadata:{commitmentId:commitment.commitment_id,status:commitment.status}})
  return json(response,200,{contract_version:'val.commitment.response.v1',commitment})
 }
 if(url.pathname==='/api/v1/insights'&&request.method==='GET'){
  const intelligence=await repository.getIntelligence(identity?.id,{role:identity?.role||'consultant'})
  return json(response,200,intelligence.insights)
 }
 if(url.pathname==='/api/opportunities'&&request.method==='POST'){
  const payload=await body(request);const clientId=clean(payload.clientId);const title=String(payload.title||'').trim().slice(0,220);const stage=String(payload.stage||'Diagnóstico')
  if(!clientId||!title||!pipelineStages.has(stage))return json(response,400,{error:'Oportunidade, produtor ou etapa inválida.'})
  const opportunity=await repository.saveOpportunity({...payload,clientId,title,stage},identity?.id);await accessRepository.recordUsage(identity,{eventType:'opportunity_saved',page:'opportunities',entityType:'client',entityId:clientId,metadata:{stage}});return json(response,201,{saved:true,opportunity})
 }
 if(url.pathname==='/api/clients/from-survey'&&request.method==='POST'){
  const payload=await body(request);const answers=validatedSurveyAnswers(payload.answers);const result=calculateProfile(answers,profileMatrix,'Aplicação assistida validada no servidor');return json(response,201,{saved:true,client:await repository.saveSurveyProfile({answers,result},identity?.id)})
 }
 if(url.pathname==='/api/clients/from-survey/batch'&&request.method==='POST'){
  const payload=await body(request);const batch=compileSurveyImportBatch(payload,{profileMatrix,surveyOptions})
  const clients=[]
  for(const profile of batch.profiles)clients.push(await repository.saveSurveyProfile(profile,identity?.id))
  await accessRepository.recordUsage(identity,{eventType:'survey_integrated',page:'questionnaire',metadata:{clientCount:clients.length,source:'questionnaire_import',duplicateCount:batch.duplicateCount}})
  return json(response,201,{saved:true,clientCount:clients.length,receivedCount:batch.receivedCount,duplicateCount:batch.duplicateCount,clients})
 }
 const clientMatch=url.pathname.match(/^\/api\/clients\/([^/]+)$/)
 if(clientMatch&&request.method==='PUT'){
  const clientId=decodeURIComponent(clientMatch[1]);const client=await repository.updateClient(clientId,await body(request),identity?.id);await accessRepository.recordUsage(identity,{eventType:'client_updated',page:'client360',entityType:'client',entityId:clientId});return json(response,200,{saved:true,client})
 }
 if(clientMatch&&request.method==='DELETE')return json(response,200,{saved:true,archived:await repository.archiveClient(decodeURIComponent(clientMatch[1]),identity?.id)})
 const contextMatch=url.pathname.match(/^\/api\/clients\/([^/]+)\/context$/)
 if(contextMatch&&request.method==='GET')return json(response,200,{context:await repository.getTechnicalContext(decodeURIComponent(contextMatch[1]),identity?.id)})
 if(contextMatch&&request.method==='PUT'){
  const clientId=decodeURIComponent(contextMatch[1]);const context=await repository.saveTechnicalContext(clientId,await body(request),identity?.id);await accessRepository.recordUsage(identity,{eventType:'memory_saved',page:'client360',entityType:'client',entityId:clientId});return json(response,200,{saved:true,context})
 }
 const overviewMatch=url.pathname.match(/^\/api\/clients\/([^/]+)\/overview$/)
 if(overviewMatch&&request.method==='GET')return json(response,200,await repository.getClientOverview(decodeURIComponent(overviewMatch[1]),identity?.id))
 if(url.pathname==='/api/intelligence/imports'&&request.method==='POST'){
  const payload=await body(request);const rows=Array.isArray(payload.rows)?payload.rows.slice(0,5000):[];const mapping=payload.mapping||{};if(!rows.length||!mapping.client||!payload.summary)return json(response,400,{error:'Importação inválida ou sem linhas para validação no servidor.'})
  const clients=buildCommercialIntelligence(rows,mapping);const learned=summarizeLearning(clients,rows.length,clean(payload.summary.fileName)||'importação comercial');const summary={...learned,id:randomUUID(),rawRowCount:rows.length,rawRowsSent:rows.length,truncated:Boolean(payload.summary.truncated)}
  const persistence=await repository.ingestCommercialImport({tenantId:config.defaultTenantId,ownerId:identity?.id,summary,clients,rows,mapping})
  if(!database.configured){const store=readStore();store.imports.push({...summary,tenantId:config.defaultTenantId,ownerId:identity?.id,clients:clients.slice(0,500)});store.imports=store.imports.slice(-20);saveStore(store)}
  await accessRepository.recordUsage(identity,{eventType:'commercial_import',page:'datahub',metadata:{clientCount:clients.length,rowCount:rows.length}});return json(response,201,{saved:true,clientCount:clients.length,database:persistence.persisted,clients,summary})
 }
 if(url.pathname==='/api/import/google-sheet'&&request.method==='POST'){
  const payload=await body(request);const source=clean(payload.url);const match=source.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if(!match)return json(response,400,{error:'Use um link válido do Google Sheets.'})
  const gid=source.match(/[?#&]gid=(\d+)/)?.[1]||'0';const exportUrl=`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`
  const upstream=await fetch(exportUrl,{redirect:'follow',signal:AbortSignal.timeout(10_000)});if(!upstream.ok)return json(response,400,{error:'A planilha precisa estar compartilhada para qualquer pessoa com o link.'})
  const csv=await limitedResponseText(upstream,config.maxBodyBytes);if(/<html/i.test(csv))return json(response,400,{error:'O Google não liberou a exportação desta planilha.'})
  return json(response,200,{rows:parseCsv(csv)})
 }
 return false
}

technicalWorkspace.start()

createServer((request,response)=>{
 const requestId=requestIdFrom(request)
 request.headers['x-request-id']=requestId
 response.setHeader('X-Request-Id',requestId)
 let url=null
 try{url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`)}catch{}
 return runWithRequestContext({requestId,method:request.method,path:url?.pathname||'',tenantId:config.defaultTenantId},async()=>{
 observe('api.received',{method:request.method,path:url?.pathname||''})
 const started=Date.now()
 response.once('finish',()=>observe('api.completed',{status:response.statusCode,durationMs:Date.now()-started,outcome:response.statusCode>=500?'error':'ok'}))
 if(!url)return json(response,400,{error:'URL inválida.'})
 if(isTechnicalWorkspaceRequest(url.pathname)){
  try{if(technicalWorkspace.handle(request,response,url,await sessionIdentity(request)))return}catch(exception){return json(response,Number(exception.statusCode)||503,{error:exception.message||'Não foi possível validar o acesso ao núcleo técnico.'})}
 }
 if(url.pathname==='/live'||url.pathname==='/ready'||url.pathname==='/health'||url.pathname.startsWith('/api/')){
  try{const handled=await handleApi(request,response,url);if(handled!==false)return}catch(exception){const status=Number(exception.statusCode)||400;const safeMessage=status<500||exception.safeToRetry===true?exception.message:'Não foi possível processar a solicitação.';return json(response,status,{error:safeMessage||'Não foi possível processar a solicitação.',...(exception.code?{code:String(exception.code).slice(0,100)}:{}),...(exception.safeToRetry!==undefined?{safe_to_retry:Boolean(exception.safeToRetry)}:{})})}
  return json(response,404,{error:'Rota não encontrada.'})
 }
 const relative=normalize(url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''))
 let target=resolve(root,relative)
 if((target!==root&&!target.startsWith(`${root}${sep}`))||!existsSync(target)||statSync(target).isDirectory())target=join(root,'index.html')
 const extension=extname(target).toLowerCase()
 const immutableAsset=/^\/assets\/.+-[a-z0-9_-]{8,}\.[a-z0-9]+$/i.test(url.pathname)
 const cacheControl=url.pathname==='/sw.js'
  ?'no-store, no-cache, must-revalidate, max-age=0'
  :extension==='.html'
   ?'no-cache'
   :immutableAsset
    ?'public, max-age=31536000, immutable'
    :'no-cache'
 response.writeHead(200,{...securityHeaders,'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':cacheControl})
 createReadStream(target).pipe(response)
 }).catch(exception=>{
  observe('api.unhandled',{outcome:'error',errorCode:String(exception?.code||'unhandled_error')})
  if(response.headersSent){response.destroy(exception);return}
  const status=Number(exception?.statusCode)||500
  const safeMessage=status<500||exception?.safeToRetry===true?exception?.message:'Não foi possível processar a solicitação.'
  json(response,status,{error:safeMessage||'Não foi possível processar a solicitação.',...(exception?.code?{code:String(exception.code).slice(0,100)}:{}),...(exception?.safeToRetry!==undefined?{safe_to_retry:Boolean(exception.safeToRetry)}:{})})
 })
}).listen(port,'0.0.0.0',()=>console.log(`VALOR 360 disponível na porta ${port}`))

for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{technicalWorkspace.close();await database.close();process.exit(0)})
