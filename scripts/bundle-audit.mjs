import {gzipSync} from 'node:zlib'
import {readdirSync,readFileSync,statSync} from 'node:fs'
import {basename,dirname,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptPath=fileURLToPath(import.meta.url)
const repositoryRoot=resolve(dirname(scriptPath),'..')

const assetRecord=(root,path)=>{
 const content=readFileSync(join(root,path))
 return {file:path,bytes:content.byteLength,gzipBytes:gzipSync(content).byteLength}
}

const staticImports=source=>[...source.matchAll(/\bimport(?:[\w*$\s{},]+from)?["']\.\/([^"']+\.js)["']/g)].map(match=>match[1])

export function buildBundleAudit({root=repositoryRoot,distDirectory='dist'}={}){
 const distRoot=resolve(root,distDirectory)
 const html=readFileSync(join(distRoot,'index.html'),'utf8')
 const entryFiles=[...html.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']\/([^"']+\.js)["']/g)].map(match=>match[1])
 const initialFiles=new Set(entryFiles)
 const queue=[...entryFiles]
 while(queue.length){
  const file=queue.shift()
  const source=readFileSync(join(distRoot,file),'utf8')
  for(const dependency of staticImports(source)){
   const resolved=join(dirname(file),dependency).replaceAll('\\','/')
   if(initialFiles.has(resolved))continue
   initialFiles.add(resolved);queue.push(resolved)
  }
 }
 const assetRoot=join(distRoot,'assets')
 const applicationChunks=readdirSync(assetRoot).filter(file=>file.endsWith('.js')).map(file=>assetRecord(distRoot,`assets/${file}`)).sort((a,b)=>b.bytes-a.bytes)
 const auxiliaryModules=readdirSync(assetRoot).filter(file=>file.endsWith('.mjs')).map(file=>assetRecord(distRoot,`assets/${file}`)).sort((a,b)=>b.bytes-a.bytes)
 const initialJs=[...initialFiles].map(file=>assetRecord(distRoot,file)).sort((a,b)=>b.bytes-a.bytes)
 const initialCss=[...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']\/([^"']+\.css)["']/g)].map(match=>assetRecord(distRoot,match[1]))
 const lazyChunks=applicationChunks.filter(item=>!initialFiles.has(item.file))
 const sum=(items,key)=>items.reduce((total,item)=>total+item[key],0)
 const thresholdBytes=500*1024
 return {
  schemaVersion:'val.bundle-audit.v1',
  distDirectory:relative(root,distRoot)||basename(distRoot),
  thresholdBytes,
  initial:{
   js:initialJs,
   jsBytes:sum(initialJs,'bytes'),
   jsGzipBytes:sum(initialJs,'gzipBytes'),
   css:initialCss,
   cssBytes:sum(initialCss,'bytes'),
   cssGzipBytes:sum(initialCss,'gzipBytes')
  },
  largestApplicationChunk:applicationChunks[0]||null,
  largestAuxiliaryModule:auxiliaryModules[0]||null,
  lazyChunks,
  oversizedApplicationChunks:applicationChunks.filter(item=>item.bytes>thresholdBytes),
  oversizedAuxiliaryModules:auxiliaryModules.filter(item=>item.bytes>thresholdBytes),
  pass:initialJs.every(item=>item.bytes<=thresholdBytes)&&applicationChunks.every(item=>item.bytes<=thresholdBytes)
 }
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath){
 const report=buildBundleAudit()
 process.stdout.write(`${JSON.stringify(report,null,2)}\n`)
 if(!report.pass)process.exitCode=1
}
