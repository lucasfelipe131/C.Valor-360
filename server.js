import {createReadStream,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {dirname,extname,join,normalize,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {config,getPublicEngineConfig} from './server/config.js'
import {createDatabase} from './server/db.js'
import {createAuth} from './server/auth.js'
import {AccessRepository} from './server/access-repository.js'
import {deriveSignals,normalizeIntegrationEvent,requiresTechnicalSignature,verifyIntegrationToken,verifyWebhookSignature} from './server/ingestion.js'
import {normalizeGrainIntent,normalizeGrainMarketSnapshot,normalizeGrainProfile,intentStatuses} from './server/grain-intelligence.js'
import {GrainRepository} from './server/grain-repository.js'
import {ValRepository} from './server/repository.js'
import {publicStorageScope} from './server/storage-policy.js'
import {ValEngine} from './server/val-engine.js'
import {createValProgressTracker,normalizeValProgressRequestId} from './server/val-progress.js'
import {createTechnicalWorkspace,isTechnicalWorkspaceRequest} from './server/technical-workspace.js'
import {buildSurveyOptions,validateSurveyAnswers} from './server/survey-validation.js'
import {calculateProfile} from './src/lib/profile.js'
import {buildCommercialIntelligence,summarizeLearning} from './src/lib/commercial-intelligence.js'

const port=Number(process.env.PORT||3000)
const appRoot=dirname(fileURLToPath(import.meta.url))
const root=resolve(appRoot,'dist')
const dataRoot=process.env.DATA_DIR||join(appRoot,'.data')
const storePath=join(dataRoot,'valor360-store.json')
const profileMatrix=JSON.parse(readFileSync(join(appRoot,'src','data','profile-matrix.json'),'utf8'))
const surveyOptions=buildSurveyOptions(profileMatrix)
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'}
const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(self), microphone=(), geolocation=(self)','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"}

mkdirSync(dataRoot,{recursive:true})
if(!existsSync(storePath))writeFileSync(storePath,JSON.stringify({surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}},null,2))

function readStore(){try{return JSON.parse(readFileSync(storePath,'utf8'))}catch{return {surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}}}
function saveStore(store){const temporary=`${storePath}.tmp`;writeFileSync(temporary,JSON.stringify(store,null,2));renameSync(temporary,storePath)}
function json(response,status,payload){response.writeHead(status,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(payload))}
function rawBody(request){return new Promise((resolve,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>config.maxBodyBytes){reject(new Error('Arquivo ou requisição muito grande.'));request.destroy()}});request.on('end',()=>resolve(raw));request.on('error',reject)})}
async function body(request){const raw=await rawBody(request);try{return raw?JSON.parse(raw):{}}catch{throw new Error('Conteúdo inválido.')}}
async function limitedResponseText(upstream,limit){const reader=upstream.body?.getReader();if(!reader)return upstream.text();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Object.assign(new Error('A planilha excede o limite seguro de importação.'),{statusCode:413})}chunks.push(value)}return new TextDecoder().decode(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))))}
const clean=value=>String(value||'').trim().slice(0,240)
const attachmentMaxBytes=6_000_000
const attachmentMimeTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
const attachmentId=value=>/^[0-9a-f-]{36}$/i.test(String(value||''))?String(value):''
function normalizedAttachment(payload={}){
 const match=String(payload.dataUrl||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/)
 if(!match)throw Object.assign(new Error('O arquivo enviado não está em um formato válido.'),{statusCode:400})
 const mimeType=String(match[1]||payload.mimeType||'').toLowerCase().trim()
 if(!attachmentMimeTypes.has(mimeType))throw Object.assign(new Error('Use foto, PDF, Word, Excel, CSV ou TXT.'),{statusCode:415})
 let buffer;try{buffer=Buffer.from(match[2].replace(/\s/g,''),'base64')}catch{throw Object.assign(new Error('Não foi possível ler este arquivo.'),{statusCode:400})}
 if(!buffer.length)throw Object.assign(new Error('O arquivo está vazio.'),{statusCode:400})
 if(buffer.length>attachmentMaxBytes)throw Object.assign(new Error('Cada arquivo pode ter até 6 MB.'),{statusCode:413})
 const originalName=(String(payload.originalName||'arquivo').normalize('NFKC').replace(/[\/\\<>:\"|?*\u0000-\u001f]/g,'-').trim()||'arquivo').slice(0,240)
 return {originalName,mimeType,sizeBytes:buffer.length,dataBase64:buffer.toString('base64')}
}
const feedbackOutcomes={used:'executed',adapted:'edited',scheduled:'scheduled',discarded:'rejected',accepted:'accepted',edited:'edited',rejected:'rejected',executed:'executed',won:'won',lost:'lost'}
const pipelineStages=new Set(['Diagnóstico','Proposta','Negociação','Fechado'])
const validatedSurveyAnswers=input=>validateSurveyAnswers(input,surveyOptions)

const database=createDatabase(config)
const auth=createAuth(config)
const userPayload=session=>session?{id:session.id||session.sub,email:session.email,name:session.name,role:session.role,status:session.status||'active',mustChangePassword:Boolean(session.mustChangePassword),demo:false,storageScope:auth.storageScope(session)}:{id:null,email:null,name:'Demonstração',role:'admin',mustChangePassword:false,demo:true,storageScope:'demo'}
const repository=new ValRepository({db:database,readStore,saveStore,tenantId:config.defaultTenantId})
const grainRepository=new GrainRepository({db:database,readStore,saveStore,tenantId:config.defaultTenantId})
const accessRepository=new AccessRepository({db:database,tenantId:config.defaultTenantId,runtimeConfig:config})
const valEngine=new ValEngine({runtimeConfig:config,repository})
const valProgress=createValProgressTracker()
const technicalWorkspace=createTechnicalWorkspace({appRoot,publicPort:port,runtimeConfig:config,json})
const rateBuckets=new Map()
function consumeRateLimit(scope,key,limit){const now=Date.now();const bucketKey=`${scope}:${key}`;const current=rateBuckets.get(bucketKey);if(!current||current.resetAt<=now){rateBuckets.set(bucketKey,{count:1,resetAt:now+600_000});return true}if(current.count>=limit)return false;current.count+=1;return true}
const requestIdentity=request=>String(request.socket.remoteAddress||'unknown')
const progressOwnerKey=(identity,request)=>String(identity?.id||identity?.email||requestIdentity(request))
const demoIdentity=()=>({id:null,email:'demo@valor360.local',name:'Demonstração',role:'admin',tenantId:config.defaultTenantId,mustChangePassword:false,demo:true})
async function sessionIdentity(request){
 if(!auth.configured)return config.demoMode?demoIdentity():null
 const tokenIdentity=auth.session(request)
 if(!tokenIdentity)return null
 return accessRepository.resolveSession(tokenIdentity)
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
 if(url.pathname==='/health'&&request.method==='GET'){
  const databaseHealth=await database.health()
  const securityReady=auth.configured||config.demoMode
  const storageReady=databaseHealth.ready||(config.demoMode&&!databaseHealth.configured&&!config.openaiApiKey)
  const healthy=securityReady&&storageReady
  return json(response,healthy?200:503,{status:healthy?'ok':'degraded',service:'valor360',storage:databaseHealth.ready?'postgresql':databaseHealth.configured?'postgresql-unavailable':process.env.DATA_DIR?'persistent-json':'local-json',ai:Boolean(config.openaiApiKey),security:auth.configured?'protected':config.demoMode?'demo':'misconfigured'})
 }
 if(url.pathname==='/api/val/status'&&request.method==='GET'){
  if(!auth.configured&&!config.demoMode)return json(response,503,{error:'A autenticação do servidor ainda não foi configurada.'})
  if(auth.configured&&!await sessionIdentity(request))return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
  const databaseHealth=await database.health();const status=await valEngine.status(databaseHealth)
  const engineConfigured=Boolean(config.openaiApiKey&&auth.configured&&databaseHealth.ready)
  return json(response,200,{...getPublicEngineConfig(),...status,mode:engineConfigured?'openai':config.openaiApiKey?'locked':'demonstration',configured:engineConfigured,keyConfigured:Boolean(config.openaiApiKey),securityReady:auth.configured})
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
 const protectedPath=url.pathname.startsWith('/api/grains/')||url.pathname.startsWith('/api/val/attachments')||url.pathname==='/api/val/progress'||url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations'||url.pathname==='/api/val/feedback'||url.pathname==='/api/intelligence'||url.pathname==='/api/intelligence/imports'||url.pathname==='/api/import/google-sheet'||url.pathname==='/api/technical/bootstrap'||url.pathname==='/api/visits'||url.pathname==='/api/opportunities'||url.pathname==='/api/surveys'||url.pathname==='/api/surveys/invitations'||url.pathname==='/api/clients/from-survey'||url.pathname==='/api/usage/events'||url.pathname.startsWith('/api/admin/')||url.pathname.startsWith('/api/portfolio-admin/')||/\/integrate$/.test(url.pathname)||/^\/api\/clients\/[^/]+(?:\/(?:context|overview))?$/.test(url.pathname)
 if(protectedPath&&!auth.configured&&!config.demoMode)return json(response,503,{error:'A autenticação do servidor ainda não foi configurada.'})
 const identity=protectedPath?await sessionIdentity(request):null
 if(protectedPath&&auth.configured&&!identity)return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
 if(protectedPath&&identity?.mustChangePassword)return json(response,403,{error:'Troque a senha temporária antes de acessar a carteira.'})
 if(protectedPath&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para operar dados fora do modo demonstrativo.'})}
 if(storageScope==='public-survey'&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para acessar questionários fora do modo demonstrativo.'})}
 if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&config.openaiApiKey&&!auth.configured)return json(response,503,{error:'Configure VAL_ADMIN_EMAIL, VAL_ADMIN_PASSWORD e VAL_SESSION_SECRET antes de ativar a IA em produção.'})
 if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&config.openaiApiKey&&!database.configured)return json(response,503,{error:'Configure DATABASE_URL antes de ativar a IA com dados reais.'})
 if(url.pathname==='/api/admin/metrics'&&request.method==='GET')return json(response,200,await accessRepository.getAdminMetrics(identity,Number(url.searchParams.get('days')||30)))
 if(url.pathname==='/api/portfolio-admin/users'&&request.method==='GET')return json(response,200,{users:await accessRepository.listUsers(identity)})
 if(url.pathname==='/api/portfolio-admin/users'&&request.method==='POST')return json(response,201,await accessRepository.createUser(identity,await body(request)))
 if(url.pathname==='/api/portfolio-admin/users'&&request.method==='PATCH')return json(response,200,{saved:true,user:await accessRepository.updateUser(identity,await body(request))})
 if(url.pathname==='/api/portfolio-admin/users/reset-password'&&request.method==='POST'){
  const payload=await body(request);return json(response,200,{saved:true,...await accessRepository.resetPassword(identity,payload.id)})
 }
 if(url.pathname==='/api/usage/events'&&request.method==='POST'){
  const payload=await body(request);await accessRepository.recordUsage(identity,{eventType:'page_view',page:clean(payload.page),entityType:clean(payload.entityType),entityId:clean(payload.entityId)});return json(response,202,{accepted:true})
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
  const intelligence=await repository.getIntelligence(identity?.id)
  const producers=(intelligence.clients||[]).map(client=>{
   const rawArea=typeof client.area==='number'?client.area:Number(String(client.area||'').replace(/\./g,'').replace(',','.').match(/\d+(?:\.\d+)?/)?.[0]||0)
   const cultures=Array.isArray(client.cultures)?client.cultures:String(client.cultures||'').split(/[,;/|]+/).map(item=>item.trim()).filter(Boolean)
   return {
    id:String(client.id),name:String(client.name||'Produtor'),crmCode:String(client.id),document:'',phone:String(client.commercial?.phone||''),email:String(client.commercial?.email||''),city:String(client.municipality||''),properties:String(client.commercial?.property||''),area:Number.isFinite(rawArea)?rawArea:0,cultures,notes:[client.primaryProfile&&`Perfil Produtor 360: ${client.primaryProfile}`,client.additionalNeed&&`Necessidade declarada: ${client.additionalNeed}`].filter(Boolean).join('\n'),fields:[],registrations:[],mappingStatus:'pending',crmSource:'VALOR 360'
   }
  })
  return json(response,200,{producers,source:'valor360',syncedAt:new Date().toISOString()})
 }
 if(url.pathname==='/api/val/progress'&&request.method==='GET'){
  const requestId=normalizeValProgressRequestId(url.searchParams.get('requestId'))
  if(!requestId)return json(response,400,{error:'Identificador de acompanhamento inválido.'})
  const progress=valProgress.get({requestId,ownerId:progressOwnerKey(identity,request)})
  if(!progress)return json(response,404,{error:'Acompanhamento não encontrado ou já encerrado.'})
  return json(response,200,progress)
 }
 if(url.pathname==='/api/val/attachments'&&request.method==='GET'){
  const clientId=clean(url.searchParams.get('clientId'));if(!clientId)return json(response,400,{error:'Selecione um produtor para ver os arquivos.'})
  const attachments=await repository.listAttachments({tenantId:config.defaultTenantId,ownerId:identity?.id,clientId,limit:30})
  return json(response,200,{attachments})
 }
 if(url.pathname==='/api/val/attachments'&&request.method==='POST'){
  const payload=await body(request);const clientId=clean(payload.clientId);if(!clientId)return json(response,400,{error:'Selecione um produtor antes de anexar.'})
  const normalized=normalizedAttachment(payload)
  const attachment=await repository.createAttachment({tenantId:config.defaultTenantId,ownerId:identity?.id,clientId,...normalized})
  await accessRepository.recordUsage(identity,{eventType:'val_attachment_uploaded',page:'val',entityType:'client',entityId:clientId,metadata:{mimeType:normalized.mimeType,sizeBytes:normalized.sizeBytes}})
  return json(response,201,{attachment})
 }
 if(url.pathname==='/api/val/attachments'&&request.method==='PATCH'){
  const payload=await body(request);const id=attachmentId(payload.id);if(!id)return json(response,400,{error:'Arquivo inválido.'})
  const status=clean(payload.status);const analysis=payload.analysis&&typeof payload.analysis==='object'?payload.analysis:undefined
  const attachment=await repository.updateAttachment({tenantId:config.defaultTenantId,ownerId:identity?.id,id,status,analysis})
  await accessRepository.recordUsage(identity,{eventType:'val_attachment_'+status,page:'val',entityType:'client',entityId:attachment.clientId,metadata:{attachmentId:id}})
  return json(response,200,{attachment})
 }
 const attachmentContentMatch=url.pathname.match(/^\/api\/val\/attachments\/([0-9a-f-]{36})$/i)
 if(attachmentContentMatch&&request.method==='GET'){
  const attachment=await repository.getAttachment({tenantId:config.defaultTenantId,ownerId:identity?.id,id:attachmentContentMatch[1]})
  if(!attachment)return json(response,404,{error:'Arquivo não encontrado.'})
  const binary=Buffer.from(attachment.dataBase64||'','base64')
  response.writeHead(200,{...securityHeaders,'Content-Type':attachment.mimeType,'Content-Length':binary.length,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(attachment.originalName),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
  response.end(binary);return true
 }
 if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&request.method==='POST'){
  const rateIdentity=identity?.id||identity?.email||requestIdentity(request)
  if(!consumeRateLimit('val',rateIdentity,config.aiRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de análises atingido. Aguarde alguns minutos.'})
  const payload=await body(request);const attachmentIds=[...new Set((Array.isArray(payload.attachmentIds)?payload.attachmentIds:[]).map(attachmentId).filter(Boolean))].slice(0,3);const message=String(payload.message||payload.question||(attachmentIds.length?'Leia os arquivos que enviei e me diga o que importa.':'Prepare a próxima melhor ação.')).trim().slice(0,3000)
  const clientId=clean(payload.clientId||payload.client?.id)
  if(!clientId)return json(response,400,{error:'Selecione um cliente para ativar o contexto da VAL.'})
  const requestId=normalizeValProgressRequestId(payload.requestId)||randomUUID()
  const ownerKey=progressOwnerKey(identity,request)
  const requestMode=clean(payload.mode)||'daily'
  valProgress.start({requestId,ownerId:ownerKey,clientId,mode:requestMode})
  const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
  try{
   const result=await valEngine.answer({tenantId:config.defaultTenantId,ownerId:identity?.id,clientId,client:payload.client||{},message,attachmentIds,mode:requestMode,requestedStage:clean(payload.requestedStage),signal:controller.signal,onProgress:stage=>valProgress.update({requestId,ownerId:ownerKey,stage})})
   valProgress.complete({requestId,ownerId:ownerKey})
   await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:requestMode,engineMode:result.engineMode,attachments:attachmentIds.length}})
   return json(response,200,{...result,requestId})
  }catch(error){valProgress.fail({requestId,ownerId:ownerKey});throw error}
 }
 if(url.pathname==='/api/val/feedback'&&request.method==='POST'){
  const payload=await body(request);const recommendationId=clean(payload.recommendationId);const rating=Number(payload.rating)
  if(!/^[0-9a-f-]{36}$/i.test(recommendationId))return json(response,400,{error:'Recomendação inválida.'})
  if(!Number.isInteger(rating)||rating<1||rating>5)return json(response,400,{error:'Avalie de 1 a 5.'})
  const requestedOutcome=clean(payload.outcome);const normalizedOutcome=requestedOutcome?feedbackOutcomes[requestedOutcome]:null
  if(requestedOutcome&&!normalizedOutcome)return json(response,400,{error:'Resultado de feedback inválido.'})
  const id=await repository.recordFeedback({tenantId:config.defaultTenantId,ownerId:identity?.id,recommendationId,rating,outcome:normalizedOutcome,value:Number.isFinite(Number(payload.value))?Number(payload.value):null,reason:clean(payload.reason)||null,notes:String(payload.notes||'').slice(0,2000)})
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
  if(requiresTechnicalSignature(event.type)&&!signed)return json(response,401,{error:'Eventos técnicos validados exigem assinatura HMAC do corpo.'})
  const ownerId=database.configured?await accessRepository.resolveIntegrationOwner(event.ownerUserId):null
  const signals=deriveSignals(event);const result=await repository.ingestEvent({tenantId:config.defaultTenantId,ownerId,event,signals})
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
  return json(response,200,await repository.getIntelligence(identity?.id))
 }
 if(url.pathname==='/api/visits'&&request.method==='POST'){
  const payload=await body(request);const clientId=clean(payload.clientId);const objective=String(payload.objective||'').trim().slice(0,2000)
  if(!clientId||!objective)return json(response,400,{error:'Selecione o produtor e informe o objetivo da visita.'})
  const visit=await repository.saveVisit({clientId,scheduledAt:payload.scheduledAt,objective,status:'Agendada'},identity?.id);await accessRepository.recordUsage(identity,{eventType:'visit_saved',page:'visits',entityType:'client',entityId:clientId});return json(response,201,{saved:true,visit})
 }
 if(url.pathname==='/api/opportunities'&&request.method==='POST'){
  const payload=await body(request);const clientId=clean(payload.clientId);const title=String(payload.title||'').trim().slice(0,220);const stage=String(payload.stage||'Diagnóstico')
  if(!clientId||!title||!pipelineStages.has(stage))return json(response,400,{error:'Oportunidade, produtor ou etapa inválida.'})
  const opportunity=await repository.saveOpportunity({...payload,clientId,title,stage},identity?.id);await accessRepository.recordUsage(identity,{eventType:'opportunity_saved',page:'opportunities',entityType:'client',entityId:clientId,metadata:{stage}});return json(response,201,{saved:true,opportunity})
 }
 if(url.pathname==='/api/clients/from-survey'&&request.method==='POST'){
  const payload=await body(request);const answers=validatedSurveyAnswers(payload.answers);const result=calculateProfile(answers,profileMatrix,'Aplicação assistida validada no servidor');return json(response,201,{saved:true,client:await repository.saveSurveyProfile({answers,result},identity?.id)})
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
  if(!database.configured){const store=readStore();store.imports.push({...summary,clients:clients.slice(0,500)});store.imports=store.imports.slice(-20);saveStore(store)}
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

createServer(async(request,response)=>{
 let url
 try{url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`)}catch{return json(response,400,{error:'URL inválida.'})}
 if(isTechnicalWorkspaceRequest(url.pathname)){
  try{if(technicalWorkspace.handle(request,response,url,await sessionIdentity(request)))return}catch(exception){return json(response,Number(exception.statusCode)||503,{error:exception.message||'Não foi possível validar o acesso ao núcleo técnico.'})}
 }
 if(url.pathname==='/live'||url.pathname==='/health'||url.pathname.startsWith('/api/')){
  try{const handled=await handleApi(request,response,url);if(handled!==false)return}catch(exception){return json(response,Number(exception.statusCode)||400,{error:exception.message||'Não foi possível processar a solicitação.'})}
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
}).listen(port,'0.0.0.0',()=>console.log(`VALOR 360 disponível na porta ${port}`))

for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{technicalWorkspace.close();await database.close();process.exit(0)})
