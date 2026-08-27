import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs'
import {dirname,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {RELEASE_SCHEMA_VERSION,resolveSourceCommit} from '../server/release-metadata.js'

export const PWA_RELEASE_PLACEHOLDER='__VAL_RELEASE__'
export const PWA_CACHE_PREFIX='valor360-v'

const RELEASE_ENV_KEYS=[
 'VAL_RELEASE_ID',
 'RAILWAY_GIT_COMMIT_SHA',
 'GITHUB_SHA',
 'SOURCE_VERSION',
 'VERCEL_GIT_COMMIT_SHA'
]

const SOURCE_TARGETS=[
 'package.json','package-lock.json','server.js','Dockerfile','railway.json',
 'src','server','public','scripts','manual/app','manual/public'
]
const IGNORED_NAMES=new Set(['node_modules','.git','dist','.next','.data','coverage'])

export function sanitizeReleaseId(value){
 return String(value??'')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g,'-')
  .replace(/^[._-]+|[._-]+$/g,'')
  .slice(0,48)
}

function collectFiles(root,target,files){
 if(!existsSync(target))return
 const stat=statSync(target)
 if(stat.isFile()){files.push(target);return}
 if(!stat.isDirectory()||IGNORED_NAMES.has(target.split(/[\\/]/).pop()))return
 for(const name of readdirSync(target).sort()){
  if(IGNORED_NAMES.has(name))continue
  collectFiles(root,join(target,name),files)
 }
}

export function hashReleaseSources(root=process.cwd()){
 const absoluteRoot=resolve(root)
 const files=[]
 for(const target of SOURCE_TARGETS)collectFiles(absoluteRoot,join(absoluteRoot,target),files)
 if(!files.length)throw new Error('Não encontrei fontes para gerar a versão do PWA.')
 const hash=createHash('sha256')
 for(const file of files.sort()){
  hash.update(relative(absoluteRoot,file).replaceAll('\\','/'))
  hash.update('\0')
  hash.update(readFileSync(file))
  hash.update('\0')
 }
 return hash.digest('hex').slice(0,16)
}

export function resolvePwaReleaseId({root=process.cwd(),env=process.env}={}){
 for(const key of RELEASE_ENV_KEYS){
  const value=sanitizeReleaseId(env[key])
  if(value)return value.slice(0,16)
 }
 try{
  const commit=execFileSync('git',['rev-parse','--short=16','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']})
  const value=sanitizeReleaseId(commit)
  if(value)return value
 }catch{}
 return `src-${hashReleaseSources(root)}`
}

function replacePlaceholder(source,releaseId){
 const occurrences=source.split(PWA_RELEASE_PLACEHOLDER).length-1
 if(occurrences!==1)throw new Error(`O service worker precisa conter exatamente um marcador ${PWA_RELEASE_PLACEHOLDER}; encontrei ${occurrences}.`)
 return source.replace(PWA_RELEASE_PLACEHOLDER,releaseId)
}

export function stampServiceWorker({
 root=process.cwd(),
 templatePath='public/sw.js',
 outputPath='dist/sw.js',
 releaseId=resolvePwaReleaseId({root})
}={}){
 const normalized=sanitizeReleaseId(releaseId)
 if(!normalized)throw new Error('A versão do PWA ficou vazia.')
 const template=readFileSync(resolve(root,templatePath),'utf8')
 const output=replacePlaceholder(template,normalized)
 const destination=resolve(root,outputPath)
 mkdirSync(dirname(destination),{recursive:true})
 writeFileSync(destination,output)
 const source=resolveSourceCommit({root})
 const manifest={
  schemaVersion:RELEASE_SCHEMA_VERSION,
  release:{id:normalized,sourceHash:hashReleaseSources(root)},
  source:{commitSha:source.commitSha,origin:source.origin}
 }
 const manifestPath=resolve(root,'dist/release.json')
 writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`)
 return {releaseId:normalized,cacheName:`${PWA_CACHE_PREFIX}${normalized}`,outputPath:destination,manifestPath,sourceCommitSha:source.commitSha}
}

export function verifyServiceWorker({root=process.cwd(),outputPath='dist/sw.js',releaseId}={}){
 const destination=resolve(root,outputPath)
 if(!existsSync(destination))throw new Error(`Service worker compilado não encontrado em ${outputPath}.`)
 const worker=readFileSync(destination,'utf8')
 if(worker.includes(PWA_RELEASE_PLACEHOLDER))throw new Error('O service worker compilado ainda contém o marcador de release.')
 const match=worker.match(/const CACHE='valor360-v([a-z0-9._-]+)'/)
 if(!match)throw new Error('O service worker compilado não possui um CACHE de release válido.')
 const actual=sanitizeReleaseId(match[1])
 const expected=releaseId?sanitizeReleaseId(releaseId):''
 if(expected&&actual!==expected)throw new Error(`CACHE ${actual} não corresponde à release ${expected}.`)
 const manifestPath=resolve(root,'dist/release.json')
 if(!existsSync(manifestPath))throw new Error('Manifesto dist/release.json não encontrado.')
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
 if(manifest?.schemaVersion!==RELEASE_SCHEMA_VERSION)throw new Error('Manifesto de release possui versão inválida.')
 if(sanitizeReleaseId(manifest?.release?.id)!==actual)throw new Error('Manifesto de release não corresponde ao service worker compilado.')
 if(manifest?.source?.commitSha&&!/^[0-9a-f]{7,64}$/i.test(manifest.source.commitSha))throw new Error('Manifesto de release possui commit inválido.')
 return {releaseId:actual,cacheName:`${PWA_CACHE_PREFIX}${actual}`,outputPath:destination,manifestPath,sourceCommitSha:manifest?.source?.commitSha||null}
}

const invokedDirectly=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)
if(invokedDirectly){
 const mode=process.argv[2]||'stamp'
 try{
  if(mode==='stamp'){
   const result=stampServiceWorker()
   console.log(`[PWA] cache preparado: ${result.cacheName}`)
  }else if(mode==='verify'){
   const result=verifyServiceWorker()
   console.log(`[PWA] cache validado: ${result.cacheName}`)
  }else throw new Error(`Modo desconhecido: ${mode}. Use stamp ou verify.`)
 }catch(error){
  console.error(`[PWA] ${error.message}`)
  process.exitCode=1
 }
}
