const CACHE='valor360-v__VAL_RELEASE__'
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/index.html','/manifest.webmanifest','/icon.svg'])))})
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())))
// Um deploy renomeia os pedacos por hash. Se o servidor devolvesse index.html com 200 para um .js que
// sumiu, guardar essa resposta envenenava o cache do release: a tela lazy nunca mais abriria naquela
// aba. So guardamos resposta cujo tipo bate com o que foi pedido.
const cacheableResponse=(request,response)=>{
 if(!response.ok||response.type==='opaque')return false
 const type=String(response.headers.get('Content-Type')||'').toLowerCase()
 if(!type)return true
 if(request.destination==='script'||request.destination==='worker')return /javascript|ecmascript/.test(type)
 if(request.destination==='style')return type.includes('css')
 if(request.destination==='document')return type.includes('html')
 return true
}
const store=(request,response)=>{if(cacheableResponse(request,response)){const copy=response.clone();return caches.open(CACHE).then(cache=>cache.put(request,copy))}return Promise.resolve()}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url)
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/health')return
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(response=>{event.waitUntil(store(event.request,response));return response}).catch(()=>caches.match(event.request).then(match=>match||caches.match('/index.html'))))
  return
 }
 if(url.pathname.startsWith('/tecnico/_next/static/')){
  event.respondWith(fetch(event.request).then(response=>{event.waitUntil(store(event.request,response));return response}).catch(()=>caches.match(event.request)))
  return
 }
 event.respondWith(caches.match(event.request).then(match=>match||fetch(event.request).then(response=>{event.waitUntil(store(event.request,response));return response})))
})
