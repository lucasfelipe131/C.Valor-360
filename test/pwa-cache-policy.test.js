import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8')

test('service worker upgrades its cache and keeps navigations and technical chunks network-first',()=>{
 const worker=read('public/sw.js')
 assert.match(worker,/const CACHE='cliente360-v08'/)
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

test('static server never serves the worker as immutable',()=>{
 const server=read('server.js')
 assert.match(server,/url\.pathname==='\/sw\.js'[\s\S]*?'no-store, no-cache, must-revalidate, max-age=0'/)
 assert.match(server,/extension==='\.html'[\s\S]*?'no-cache'/)
 assert.match(server,/immutableAsset[\s\S]*?'public, max-age=31536000, immutable'/)

 const cachePolicy=server.slice(server.indexOf("const immutableAsset="),server.indexOf('response.writeHead(200',server.indexOf("const immutableAsset=")))
 assert.ok(cachePolicy.indexOf("url.pathname==='/sw.js'")<cachePolicy.indexOf('immutableAsset\n    ?'),'/sw.js deve ser avaliado antes da política immutable')
})
