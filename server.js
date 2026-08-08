import {createReadStream,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {dirname,extname,join,normalize,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {config,getPublicEngineConfig} from './server/config.js'
import {createDatabase} from './server/db.js'
import {createAuth} from './server/auth.js'
import {deriveSignals,normalizeIntegrationEvent,requiresTechnicalSignature,verifyIntegrationToken,verifyWebhookSignature} from './server/ingestion.js'
import {ValRepository} from './server/repository.js'
import {publicStorageScope} from './server/storage-policy.js'
import {ValEngine} from './server/val-engine.js'
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
const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"}

mkdirSync(dataRoot,{recursive:true})
if(!existsSync(storePath))writeFileSync(storePath,JSON.stringify({surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}},null,2))

function readStore(){try{return JSON.parse(readFileSync(storePath,'utf8'))}catch{return {surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}}}
function saveStore(store){const temporary=`${storePath}.tmp`;writeFileSync(temporary,JSON.stringify(store,null,2));renameSync(temporary,storePath)}
function json(response,status,payload){response.writeHead(status,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(payload))}
function rawBody(request){return new Promise((resolve,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>config.maxBodyBytes){reject(new Error('Arquivo ou requisição muito grande.'));request.destroy()}});request.on('end',()=>resolve(raw));request.on('error',reject)})}
async function body(request){const raw=await rawBody(request);try{return raw?JSON.parse(raw):{}}catch{throw new Error('Conteúdo inválido.')}}
async function limitedResponseText(upstream,limit){const reader=upstream.body?.getReader();if(!reader)return upstream.text();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Object.assign(new Error('A planilha excede o limite seguro de importação.'),{statusCode:413})}chunks.push(value)}return new TextDecoder().decode(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))))}
const clean=value=>String(value||'').trim().slice(0,240)
const feedbackOutcomes={used:'executed',adapted:'edited',scheduled:'scheduled',discarded:'rejected',accepted:'accepted',edited:'edited',rejected:'rejected',executed:'executed',won:'won',lost:'lost'}
const validatedSurveyAnswers=input=>validateSurveyAnswers(input,surveyOptions)

const database=createDatabase(config)
const auth=createAuth(config)
const repository=new ValRepository({db:database,readStore,saveStore,tenantId:config.defaultTenantId})
const valEngine=new ValEngine({runtimeConfig:config,repository})
const rateBuckets=new Map()
function consumeRateLimit(scope,key,limit){const now=Date.now();const bucketKey=`${scope}:${key}`;const current=rateBuckets.get(bucketKey);if(!current||current.resetAt<=now){rateBuckets.set(bucketKey,{count:1,resetAt:now+600_000});return true}if(current.count>=limit)return false;current.count+=1;return true}
const requestIdentity=request=>String(request.socket.remoteAddress||'unknown')

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
 if(url.pathname==='/health'&&request.method==='GET'){
  const databaseHealth=await database.health()
  const securityReady=auth.configured||config.demoMode
  const storageReady=databaseHealth.ready||(config.demoMode&&!databaseHealth.configured&&!config.openaiApiKey)
  const healthy=securityReady&&storageReady
  return json(response,healthy?200:503,{status:healthy?'ok':'degraded',service:'valor360',storage:databaseHealth.ready?'postgresql':databaseHealth.configured?'postgresql-unavailable':process.env.DATA_DIR?'persistent-json':'local-json',ai:Boolean(config.openaiApiKey),security:auth.configured?'protected':config.demoMode?'demo':'misconfigured'})
 }
 if(url.pathname==='/api/val/status'&&request.method==='GET'){
  if(!auth.configured&&!config.demoMode)return json(response,503,{error:'A autenticação do servidor ainda não foi configurada.'})
  if(auth.configured&&!auth.session(request))return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
  const databaseHealth=await database.health();const status=await valEngine.status(databaseHealth)
  const engineConfigured=Boolean(config.openaiApiKey&&auth.configured&&databaseHealth.ready)
  return json(response,200,{...getPublicEngineConfig(),...status,mode:engineConfigured?'openai':config.openaiApiKey?'locked':'demonstration',configured:engineConfigured,keyConfigured:Boolean(config.openaiApiKey),securityReady:auth.configured})
 }
 if(url.pathname==='/api/auth/session'&&request.method==='GET'){
  const session=auth.configured?auth.session(request):null
  const demoAllowed=!auth.configured&&config.demoMode
  return json(response,200,{authenticated:auth.configured?Boolean(session):demoAllowed,required:!demoAllowed,demo:demoAllowed,misconfigured:!auth.configured&&!demoAllowed,user:session?{email:session.email,demo:false}:demoAllowed?{email:null,demo:true}:null})
 }
 if(url.pathname==='/api/auth/login'&&request.method==='POST'){
  if(!auth.configured)return config.demoMode?json(response,200,{authenticated:true,required:false,demo:true,user:{email:null,demo:true}}):json(response,503,{error:'Configure o acesso seguro do VALOR 360 antes de entrar.'})
  if(!consumeRateLimit('login',requestIdentity(request),config.loginAttemptsPerTenMinutes))return json(response,429,{error:'Muitas tentativas de acesso. Aguarde alguns minutos.'})
  const payload=await body(request)
  if(!auth.verifyCredentials(payload.email,payload.password))return json(response,401,{error:'E-mail ou senha inválidos.'})
  const email=String(payload.email).trim().toLowerCase();const token=auth.issue(email);response.setHeader('Set-Cookie',auth.cookie(request,token));return json(response,200,{authenticated:true,required:true,demo:false,user:{email,demo:false}})
 }
 if(url.pathname==='/api/auth/logout'&&request.method==='POST'){response.setHeader('Set-Cookie',auth.clearCookie(request));return json(response,200,{authenticated:false})}
 const storageScope=publicStorageScope(url.pathname,request.method)
 const protectedPath=url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations'||url.pathname==='/api/val/feedback'||url.pathname==='/api/intelligence'||url.pathname==='/api/intelligence/imports'||url.pathname==='/api/import/google-sheet'||url.pathname==='/api/surveys'||url.pathname==='/api/surveys/invitations'||url.pathname==='/api/clients/from-survey'||/\/integrate$/.test(url.pathname)||/^\/api\/clients\/[^/]+\/context$/.test(url.pathname)
 if(protectedPath&&!auth.configured&&!config.demoMode)return json(response,503,{error:'A autenticação do servidor ainda não foi configurada.'})
 if(protectedPath&&auth.configured&&!auth.session(request))return json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'})
 if(protectedPath&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para operar dados fora do modo demonstrativo.'})}
 if(storageScope==='public-survey'&&!config.demoMode){const databaseHealth=await database.health();if(!databaseHealth.ready)return json(response,503,{error:'O PostgreSQL precisa estar disponível para acessar questionários fora do modo demonstrativo.'})}
 if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&config.openaiApiKey&&!auth.configured)return json(response,503,{error:'Configure VAL_ADMIN_EMAIL, VAL_ADMIN_PASSWORD e VAL_SESSION_SECRET antes de ativar a IA em produção.'})
 if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&config.openaiApiKey&&!database.configured)return json(response,503,{error:'Configure DATABASE_URL antes de ativar a IA com dados reais.'})
 if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&request.method==='POST'){
  const sessionIdentity=auth.session(request)?.email||requestIdentity(request)
  if(!consumeRateLimit('val',sessionIdentity,config.aiRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de análises atingido. Aguarde alguns minutos.'})
  const payload=await body(request);const message=String(payload.message||payload.question||'Prepare a próxima melhor ação.').trim().slice(0,3000)
  const clientId=clean(payload.clientId||payload.client?.id)
  if(!clientId)return json(response,400,{error:'Selecione um cliente para ativar o contexto da VAL.'})
  const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
  const result=await valEngine.answer({tenantId:config.defaultTenantId,clientId,client:payload.client||{},message,mode:clean(payload.mode)||'daily',signal:controller.signal})
  return json(response,200,result)
 }
 if(url.pathname==='/api/val/feedback'&&request.method==='POST'){
  const payload=await body(request);const recommendationId=clean(payload.recommendationId);const rating=Number(payload.rating)
  if(!/^[0-9a-f-]{36}$/i.test(recommendationId))return json(response,400,{error:'Recomendação inválida.'})
  if(!Number.isInteger(rating)||rating<1||rating>5)return json(response,400,{error:'Avalie de 1 a 5.'})
  const requestedOutcome=clean(payload.outcome);const normalizedOutcome=requestedOutcome?feedbackOutcomes[requestedOutcome]:null
  if(requestedOutcome&&!normalizedOutcome)return json(response,400,{error:'Resultado de feedback inválido.'})
  const id=await repository.recordFeedback({tenantId:config.defaultTenantId,recommendationId,rating,outcome:normalizedOutcome,value:Number.isFinite(Number(payload.value))?Number(payload.value):null,reason:clean(payload.reason)||null,notes:String(payload.notes||'').slice(0,2000)})
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
  const signals=deriveSignals(event);const result=await repository.ingestEvent({tenantId:config.defaultTenantId,event,signals})
  return json(response,result.duplicate?200:202,{accepted:true,...result,eventType:event.type,externalId:event.externalId})
 }
 if(url.pathname==='/api/surveys'&&request.method==='GET')return json(response,200,await repository.listSurveys())
 if(url.pathname==='/api/surveys/invitations'&&request.method==='POST'){
  const payload=await body(request);const token=randomBytes(24).toString('base64url')
  const createdAt=new Date();const invitation={token,producerName:clean(payload.producerName),consultantName:clean(payload.consultantName)||'Equipe VALOR 360',status:'aguardando',createdAt:createdAt.toISOString(),expiresAt:new Date(createdAt.getTime()+30*86_400_000).toISOString()}
  return json(response,201,await repository.createSurvey(invitation))
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
  const survey=await repository.integrateSurvey(integrateMatch[1]);return json(response,200,{saved:true,status:survey.status})
 }
 if(url.pathname==='/api/intelligence'&&request.method==='GET'){
  return json(response,200,await repository.getIntelligence())
 }
 if(url.pathname==='/api/clients/from-survey'&&request.method==='POST'){
  const payload=await body(request);const answers=validatedSurveyAnswers(payload.answers);const result=calculateProfile(answers,profileMatrix,'Aplicação assistida validada no servidor');return json(response,201,{saved:true,client:await repository.saveSurveyProfile({answers,result})})
 }
 const contextMatch=url.pathname.match(/^\/api\/clients\/([^/]+)\/context$/)
 if(contextMatch&&request.method==='GET')return json(response,200,{context:await repository.getTechnicalContext(decodeURIComponent(contextMatch[1]))})
 if(contextMatch&&request.method==='PUT')return json(response,200,{saved:true,context:await repository.saveTechnicalContext(decodeURIComponent(contextMatch[1]),await body(request))})
 if(url.pathname==='/api/intelligence/imports'&&request.method==='POST'){
  const payload=await body(request);const rows=Array.isArray(payload.rows)?payload.rows.slice(0,5000):[];const mapping=payload.mapping||{};if(!rows.length||!mapping.client||!payload.summary)return json(response,400,{error:'Importação inválida ou sem linhas para validação no servidor.'})
  const clients=buildCommercialIntelligence(rows,mapping);const learned=summarizeLearning(clients,rows.length,clean(payload.summary.fileName)||'importação comercial');const summary={...learned,id:randomUUID(),rawRowCount:rows.length,rawRowsSent:rows.length,truncated:Boolean(payload.summary.truncated)}
  const persistence=await repository.ingestCommercialImport({tenantId:config.defaultTenantId,summary,clients,rows,mapping})
  if(!database.configured){const store=readStore();store.imports.push({...summary,clients:clients.slice(0,500)});store.imports=store.imports.slice(-20);saveStore(store)}
  return json(response,201,{saved:true,clientCount:clients.length,database:persistence.persisted,clients,summary})
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

createServer(async(request,response)=>{
 let url
 try{url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`)}catch{return json(response,400,{error:'URL inválida.'})}
 if(url.pathname==='/health'||url.pathname.startsWith('/api/')){
  try{const handled=await handleApi(request,response,url);if(handled!==false)return}catch(exception){return json(response,Number(exception.statusCode)||400,{error:exception.message||'Não foi possível processar a solicitação.'})}
  return json(response,404,{error:'Rota não encontrada.'})
 }
 const relative=normalize(url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''))
 let target=resolve(root,relative)
 if((target!==root&&!target.startsWith(`${root}${sep}`))||!existsSync(target)||statSync(target).isDirectory())target=join(root,'index.html')
 const extension=extname(target).toLowerCase()
 response.writeHead(200,{...securityHeaders,'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':extension==='.html'?'no-cache':'public, max-age=31536000, immutable'})
 createReadStream(target).pipe(response)
}).listen(port,'0.0.0.0',()=>console.log(`VALOR 360 disponível na porta ${port}`))

for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await database.close();process.exit(0)})
