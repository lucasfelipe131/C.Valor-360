import {spawn} from 'node:child_process'
import {createHash,createHmac} from 'node:crypto'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {observe} from './observability.js'

export const TECHNICAL_BASE_PATH='/tecnico'

const manualApiPrefixes=[
 '/api/access','/api/admin/usage','/api/admin/users','/api/agro','/api/diagnosis','/api/feedback','/api/geospatial',
 '/api/integrations/valor360/sync','/api/municipalities','/api/producer-import',
 '/api/profile','/api/records','/api/soil-analysis','/api/weather','/api/workspace','/api/zarc'
]
const manualAssets=[
 '/favicon.svg','/gate-one-pro-server.png','/hero-fields.png','/campo-aerial-map.png'
]

export function isTechnicalWorkspaceRequest(pathname=''){
 return pathname===TECHNICAL_BASE_PATH||pathname.startsWith(`${TECHNICAL_BASE_PATH}/`)||
  pathname.startsWith('/tessdata/')||pathname.startsWith('/manual-do-agronomo-')||
  manualAssets.includes(pathname)||manualApiPrefixes.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`))
}

function identityUuid(seed){
 const digest=createHash('sha256').update(seed).digest('hex')
 return `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`
}

function displayName(email){
 return String(email||'Consultor').split('@')[0].split(/[._-]+/).filter(Boolean).map(part=>`${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')||'Consultor'
}

export function signedTechnicalIdentity({session,tenantId,secret}){
 if(!session?.email||String(secret||'').length<32)return null
 const subject=String(session.id||session.sub||'')
 const identity={
  id:/^[0-9a-f-]{36}$/i.test(subject)?subject:identityUuid(`valor360:${tenantId}:${String(session.email).toLowerCase()}`),
  email:String(session.email).toLowerCase(),
  displayName:String(session.name||session.displayName||displayName(session.email)).slice(0,160),
  role:session.role==='admin'?'admin':'tester',
  tenantId:String(tenantId),
  exp:Math.floor(Date.now()/1000)+120
 }
 const payload=Buffer.from(JSON.stringify(identity)).toString('base64url')
 return {payload,signature:createHmac('sha256',secret).update(payload).digest('base64url')}
}

export function createTechnicalWorkspace({appRoot,publicPort,runtimeConfig,json}){
 const manualRoot=join(appRoot,'manual')
 const manualEntry=join(manualRoot,'server.js')
 const enabled=existsSync(manualEntry)
 const internalPort=Number(process.env.MANUAL_INTERNAL_PORT||31_001)
 const embedSecret=runtimeConfig.sessionSecret
 // http-proxy avalia util._extend (DEP0060) ao ser carregado: importado de forma estatica ele
 // imprime duas linhas de aviso em stderr a cada boot, e o Railway classifica stderr como erro.
 // Sem o build do nucleo tecnico o proxy nunca e usado, entao so carregamos quando ha o que servir.
 const proxy=enabled?createRequire(import.meta.url)('http-proxy').createProxyServer({xfwd:true,changeOrigin:false,proxyTimeout:120_000,timeout:120_000}):null
 let child=null,closing=false,restartTimer=null,restartAttempts=0,startedAt=0

 proxy?.on('proxyRes',upstream=>{
  delete upstream.headers['x-powered-by']
 })
 proxy?.on('error',(error,_request,response)=>{
  if(response.headersSent){response.destroy(error);return}
  json(response,503,{error:'O núcleo técnico está reiniciando. Tente novamente em instantes.'})
 })

 // O filho do Next morria e nunca voltava: /tecnico ficava em 503 'está reiniciando' até um redeploy.
 // Reinicia com backoff limitado; um filho vivo por mais de 60s zera as tentativas.
 function scheduleRestart(){
  if(closing||restartTimer)return
  if(restartAttempts>=10){console.error('Núcleo técnico não reiniciou após 10 tentativas; /tecnico permanece indisponível até novo deploy.');return}
  const delay=Math.min(1000*2**restartAttempts,30_000);restartAttempts+=1
  restartTimer=setTimeout(()=>{restartTimer=null;start()},delay);restartTimer.unref?.()
 }
 function start(){
  if(!enabled||closing)return false
  startedAt=Date.now()
  console.info(JSON.stringify({event:'manual.integration.configuration',configured:Boolean(runtimeConfig.manualWebhookSecret)}))
  child=spawn(process.execPath,[manualEntry],{
   cwd:manualRoot,
   env:{
    ...process.env,
    PORT:String(internalPort),
    HOSTNAME:'127.0.0.1',
    VALOR360_EMBED_SECRET:embedSecret,
    VALOR360_DEFAULT_TENANT_ID:runtimeConfig.defaultTenantId,
    VALOR360_WEBHOOK_URL:`http://127.0.0.1:${publicPort}/api/v1/integrations/manual/events`,
    VALOR360_WEBHOOK_SECRET:runtimeConfig.manualWebhookSecret
   },
   stdio:['ignore','inherit','inherit']
  })
  child.on('exit',(code,signal)=>{console.error(`Núcleo técnico encerrado (${signal||code||0}).`);child=null;if(Date.now()-startedAt>60_000)restartAttempts=0;scheduleRestart()})
  return true
 }
 const healthy=()=>Boolean(enabled&&child&&child.exitCode===null&&!child.killed)

 // A identidade demo (admin anônimo) segue a mesma regra do server.js: só quando a autenticação
 // não está configurada. VAL_DEMO_MODE=true com login ativo não abre o núcleo técnico sem sessão.
 function handle(request,response,url,session,{demoAllowed=runtimeConfig.demoMode}={}){
  if(!isTechnicalWorkspaceRequest(url.pathname))return false
  if(!enabled){json(response,503,{error:'O núcleo técnico ainda não foi incluído neste build.'});return true}
  const resolvedSession=session||(demoAllowed?{email:'demo@valor360.local',tenantId:runtimeConfig.defaultTenantId,role:'admin'}:null)
  if(!resolvedSession){json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'});return true}
  const tenantId=String(resolvedSession?.tenantId||runtimeConfig.defaultTenantId)
  const signed=signedTechnicalIdentity({session:resolvedSession,tenantId,secret:embedSecret})
  if(!signed){observe('integration.error',{source:'manual-do-agronomo',operation:'proxy',reason:'session_secret_short'});json(response,503,{error:'O núcleo técnico exige VAL_SESSION_SECRET com 32 ou mais caracteres.'});return true}
  request.headers['x-valor360-identity']=signed.payload
  request.headers['x-valor360-signature']=signed.signature
  observe('integration.sent',{source:'manual-do-agronomo',operation:'proxy'})
  if(!url.pathname.startsWith(TECHNICAL_BASE_PATH))request.url=`${TECHNICAL_BASE_PATH}${request.url}`
  proxy.web(request,response,{target:`http://127.0.0.1:${internalPort}`})
  return true
 }

 function close(){
  closing=true
  if(restartTimer){clearTimeout(restartTimer);restartTimer=null}
  proxy?.close()
  if(child&&!child.killed)child.kill('SIGTERM')
 }

 return {enabled,start,handle,close,internalPort,healthy}
}
