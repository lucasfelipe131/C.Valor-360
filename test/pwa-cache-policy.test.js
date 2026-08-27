import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {
 hashReleaseSources,
 stampServiceWorker,
 verifyServiceWorker
} from '../scripts/pwa-release.mjs'

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8')

test('service worker usa marcador de release e mantém navegações e chunks técnicos network-first',()=>{
 const worker=read('public/sw.js')
 assert.match(worker,/const CACHE='valor360-v__VAL_RELEASE__'/)
 assert.doesNotMatch(worker,/cliente360-v\d+/)
 assert.match(worker,/self\.skipWaiting\(\)/)
 assert.match(worker,/keys\.filter\(key=>key!==CACHE\).*caches\.delete\(key\)/)
 assert.match(worker,/self\.clients\.claim\(\)/)
 assert.match(worker,/event\.request\.mode==='navigate'/)

 const navigation=worker.slice(worker.indexOf("if(event.request.mode==='navigate')"),worker.indexOf("event.respondWith(caches.match(event.request)"))
 assert.ok(navigation.indexOf('fetch(event.request)')<navigation.indexOf('caches.match(event.request)'),'a navegação deve consultar a rede antes do cache')
 assert.match(navigation,/match\|\|caches\.match\('\/index\.html'\)/)

 const technical=worker.slice(worker.indexOf("if(url.pathname.startsWith('/tecnico/_next/static/'))"),worker.lastIndexOf('event.respondWith(caches.match(event.request)'))
 assert.ok(technical.indexOf('fetch(event.request)')<technical.indexOf('caches.match(event.request)'),'os chunks do Manual devem consultar a rede antes do cache')
})

test('build carimba e valida o service worker sem depender de edição manual',()=>{
 const packageJson=JSON.parse(read('package.json'))
 assert.match(packageJson.scripts.build,/vite build && node scripts\/pwa-release\.mjs stamp && node scripts\/pwa-release\.mjs verify/)
 assert.equal(packageJson.scripts['pwa:verify'],'node scripts/pwa-release.mjs verify')

 const root=mkdtempSync(join(tmpdir(),'valor360-pwa-'))
 try{
  mkdirSync(join(root,'public'),{recursive:true})
  writeFileSync(join(root,'public','sw.js'),read('public/sw.js'))
  const stamped=stampServiceWorker({root,releaseId:'release-abc123'})
  assert.equal(stamped.cacheName,'valor360-vrelease-abc123')
  assert.ok(stamped.manifestPath.endsWith('dist/release.json'))
  const compiled=readFileSync(join(root,'dist','sw.js'),'utf8')
  assert.match(compiled,/const CACHE='valor360-vrelease-abc123'/)
  assert.doesNotMatch(compiled,/__VAL_RELEASE__/)
  const manifest=JSON.parse(readFileSync(join(root,'dist','release.json'),'utf8'))
  assert.equal(manifest.schemaVersion,'val.release.v1')
  assert.equal(manifest.release.id,'release-abc123')
  assert.equal(verifyServiceWorker({root,releaseId:'release-abc123'}).cacheName,stamped.cacheName)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('fingerprint de fallback muda quando uma fonte da aplicação muda',()=>{
 const root=mkdtempSync(join(tmpdir(),'valor360-release-hash-'))
 try{
  mkdirSync(join(root,'src'),{recursive:true})
  mkdirSync(join(root,'public'),{recursive:true})
  writeFileSync(join(root,'package.json'),'{}')
  writeFileSync(join(root,'src','app.js'),'export const version=1')
  writeFileSync(join(root,'public','sw.js'),"const CACHE='valor360-v__VAL_RELEASE__'")
  const first=hashReleaseSources(root)
  writeFileSync(join(root,'src','app.js'),'export const version=2')
  const second=hashReleaseSources(root)
  assert.notEqual(first,second)
  assert.match(first,/^[a-f0-9]{16}$/)
  assert.match(second,/^[a-f0-9]{16}$/)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('static server never serves the worker as immutable',()=>{
 const server=read('server.js')
 assert.match(server,/url\.pathname==='\/sw\.js'[\s\S]*?'no-store, no-cache, must-revalidate, max-age=0'/)
 assert.match(server,/extension==='\.html'[\s\S]*?'no-cache'/)
 assert.match(server,/immutableAsset[\s\S]*?'public, max-age=31536000, immutable'/)

 const cachePolicy=server.slice(server.indexOf("const immutableAsset="),server.indexOf('response.writeHead(200',server.indexOf("const immutableAsset=")))
 assert.ok(cachePolicy.indexOf("url.pathname==='/sw.js'")<cachePolicy.indexOf('immutableAsset\n    ?'),'/sw.js deve ser avaliado antes da política immutable')
})

test('checklist de deploy exige build, verificação do cache e teste pós-publicação',()=>{
 const checklist=read('docs/DEPLOY_CHECKLIST.md')
 assert.match(checklist,/npm test/)
 assert.match(checklist,/npm run build/)
 assert.match(checklist,/npm run pwa:verify/)
 assert.match(checklist,/__VAL_RELEASE__/)
 assert.match(checklist,/Ctrl \+ F5/)
})
