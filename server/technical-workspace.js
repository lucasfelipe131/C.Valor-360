import {spawn} from 'node:child_process'
import {createHash,createHmac} from 'node:crypto'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import httpProxy from 'http-proxy'

export const TECHNICAL_BASE_PATH='/tecnico'

const manualApiPrefixes=[
 '/api/access','/api/admin','/api/agro','/api/diagnosis','/api/feedback',
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
 const proxy=httpProxy.createProxyServer({xfwd:true,changeOrigin:false,proxyTimeout:120_000,timeout:120_000})
 let child=null

 proxy.on('proxyRes',upstream=>{
  delete upstream.headers['x-powered-by']
 })
 proxy.on('error',(error,_request,response)=>{
  if(response.headersSent){response.destroy(error);return}
  json(response,503,{error:'O núcleo técnico está reiniciando. Tente novamente em instantes.'})
 })

 function start(){
  if(!enabled)return false
  child=spawn(process.execPath,[manualEntry],{
   cwd:manualRoot,
   env:{
    ...process.env,
    PORT:String(internalPort),
    HOSTNAME:'127.0.0.1',
    VALOR360_EMBED_SECRET:embedSecret,
    VALOR360_WEBHOOK_URL:`http://127.0.0.1:${publicPort}/api/v1/integrations/manual/events`,
    VALOR360_WEBHOOK_SECRET:runtimeConfig.manualWebhookSecret
   },
   stdio:['ignore','inherit','inherit']
  })
  child.on('exit',(code,signal)=>console.error(`Núcleo técnico encerrado (${signal||code||0}).`))
  return true
 }

 function handle(request,response,url,session){
  if(!isTechnicalWorkspaceRequest(url.pathname))return false
  if(!enabled){json(response,503,{error:'O núcleo técnico ainda não foi incluído neste build.'});return true}
  const resolvedSession=(session||runtimeConfig.demoMode)?session||{email:'demo@valor360.local',tenantId:runtimeConfig.defaultTenantId,role:'admin'}:null
  const signed=signedTechnicalIdentity({session:resolvedSession,tenantId:runtimeConfig.defaultTenantId,secret:embedSecret})
  if(!signed){json(response,401,{error:'Sua sessão expirou. Entre novamente no VALOR 360.'});return true}
  request.headers['x-valor360-identity']=signed.payload
  request.headers['x-valor360-signature']=signed.signature
  if(!url.pathname.startsWith(TECHNICAL_BASE_PATH))request.url=`${TECHNICAL_BASE_PATH}${request.url}`
  proxy.web(request,response,{target:`http://127.0.0.1:${internalPort}`})
  return true
 }

 function close(){
  proxy.close()
  if(child&&!child.killed)child.kill('SIGTERM')
 }

 return {enabled,start,handle,close,internalPort}
}
