import {createReadStream,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {dirname,extname,join,normalize} from 'node:path'
import {fileURLToPath} from 'node:url'

const port=Number(process.env.PORT||3000)
const appRoot=dirname(fileURLToPath(import.meta.url))
const root=join(appRoot,'dist')
const dataRoot=process.env.DATA_DIR||join(appRoot,'.data')
const storePath=join(dataRoot,'valor360-store.json')
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'}
const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'}

mkdirSync(dataRoot,{recursive:true})
if(!existsSync(storePath))writeFileSync(storePath,JSON.stringify({surveys:[],imports:[]},null,2))

function readStore(){try{return JSON.parse(readFileSync(storePath,'utf8'))}catch{return {surveys:[],imports:[]}}}
function saveStore(store){const temporary=`${storePath}.tmp`;writeFileSync(temporary,JSON.stringify(store,null,2));renameSync(temporary,storePath)}
function json(response,status,payload){response.writeHead(status,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(payload))}
function body(request){return new Promise((resolve,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>1_500_000){reject(new Error('Arquivo ou requisição muito grande.'));request.destroy()}});request.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(new Error('Conteúdo inválido.'))}});request.on('error',reject)})}
const clean=value=>String(value||'').trim().slice(0,240)

function parseCsv(text){
 const rows=[];let row=[];let cell='';let quoted=false
 for(let index=0;index<text.length;index++){
  const char=text[index]
  if(char==='"'&&quoted&&text[index+1]==='"'){cell+='"';index++;continue}
  if(char==='"'){quoted=!quoted;continue}
  if((char===','||char===';')&&!quoted){row.push(cell.trim());cell='';continue}
  if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[index+1]==='\n')index++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue}
  cell+=char
 }
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows
}

async function handleApi(request,response,url){
 if(url.pathname==='/health'&&request.method==='GET')return json(response,200,{status:'ok',service:'valor360',storage:process.env.DATA_DIR?'persistent':'local'})
 if(url.pathname==='/api/surveys'&&request.method==='GET')return json(response,200,readStore().surveys.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))))
 if(url.pathname==='/api/surveys/invitations'&&request.method==='POST'){
  const payload=await body(request);const token=clean(payload.token).replace(/[^a-zA-Z0-9_-]/g,'')
  if(token.length<8)return json(response,400,{error:'Token de convite inválido.'})
  const store=readStore();const existing=store.surveys.find(item=>item.token===token);if(existing)return json(response,200,existing)
  const invitation={token,producerName:clean(payload.producerName),consultantName:clean(payload.consultantName)||'Equipe C.Vale',status:'aguardando',createdAt:new Date().toISOString()}
  store.surveys.push(invitation);saveStore(store);return json(response,201,invitation)
 }
 const surveyMatch=url.pathname.match(/^\/api\/surveys\/([a-zA-Z0-9_-]+)$/)
 if(surveyMatch&&request.method==='GET'){
  const survey=readStore().surveys.find(item=>item.token===surveyMatch[1]);return survey?json(response,200,survey):json(response,404,{error:'Este convite não foi encontrado.'})
 }
 const submitMatch=url.pathname.match(/^\/api\/surveys\/([a-zA-Z0-9_-]+)\/submit$/)
 if(submitMatch&&request.method==='POST'){
  const payload=await body(request);const store=readStore();const survey=store.surveys.find(item=>item.token===submitMatch[1]);if(!survey)return json(response,404,{error:'Este convite não foi encontrado.'})
  survey.answers=payload.answers||{};survey.result=payload.result||null;survey.status='respondido';survey.submittedAt=new Date().toISOString();saveStore(store);return json(response,200,{saved:true,status:survey.status})
 }
 const integrateMatch=url.pathname.match(/^\/api\/surveys\/([a-zA-Z0-9_-]+)\/integrate$/)
 if(integrateMatch&&request.method==='POST'){
  const store=readStore();const survey=store.surveys.find(item=>item.token===integrateMatch[1]);if(!survey)return json(response,404,{error:'Resposta não encontrada.'})
  survey.status='integrado';survey.integratedAt=new Date().toISOString();saveStore(store);return json(response,200,{saved:true,status:survey.status})
 }
 if(url.pathname==='/api/intelligence'&&request.method==='GET'){
  const store=readStore();const clients=new Map();store.imports.forEach(record=>record.clients?.forEach(client=>clients.set(String(client.name).toLowerCase(),client)))
  return json(response,200,{imports:store.imports.map(({clients,...summary})=>summary),clients:[...clients.values()]})
 }
 if(url.pathname==='/api/intelligence/imports'&&request.method==='POST'){
  const payload=await body(request);if(!Array.isArray(payload.clients)||!payload.summary)return json(response,400,{error:'Importação inválida.'})
  const store=readStore();store.imports.push({...payload.summary,clients:payload.clients.slice(0,500)});store.imports=store.imports.slice(-20);saveStore(store);return json(response,201,{saved:true,clientCount:payload.clients.length})
 }
 if(url.pathname==='/api/import/google-sheet'&&request.method==='POST'){
  const payload=await body(request);const source=clean(payload.url);const match=source.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if(!match)return json(response,400,{error:'Use um link válido do Google Sheets.'})
  const gid=source.match(/[?#&]gid=(\d+)/)?.[1]||'0';const exportUrl=`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`
  const upstream=await fetch(exportUrl,{redirect:'follow'});if(!upstream.ok)return json(response,400,{error:'A planilha precisa estar compartilhada para qualquer pessoa com o link.'})
  const csv=await upstream.text();if(/<html/i.test(csv))return json(response,400,{error:'O Google não liberou a exportação desta planilha.'})
  return json(response,200,{rows:parseCsv(csv)})
 }
 return false
}

createServer(async(request,response)=>{
 let url
 try{url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`)}catch{return json(response,400,{error:'URL inválida.'})}
 if(url.pathname==='/health'||url.pathname.startsWith('/api/')){
  try{const handled=await handleApi(request,response,url);if(handled!==false)return}catch(exception){return json(response,400,{error:exception.message||'Não foi possível processar a solicitação.'})}
  return json(response,404,{error:'Rota não encontrada.'})
 }
 const relative=normalize(url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''))
 let target=join(root,relative)
 if(!target.startsWith(root)||!existsSync(target)||statSync(target).isDirectory())target=join(root,'index.html')
 const extension=extname(target).toLowerCase()
 response.writeHead(200,{...securityHeaders,'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':extension==='.html'?'no-cache':'public, max-age=31536000, immutable'})
 createReadStream(target).pipe(response)
}).listen(port,'0.0.0.0',()=>console.log(`Cliente 360 Cvale disponível na porta ${port}`))
