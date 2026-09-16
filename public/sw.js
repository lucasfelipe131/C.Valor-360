const CACHE='valor360-v__VAL_RELEASE__'
// O pre-cache pedia /icon.svg, que nao existe em lugar nenhum do build nem e servido por rota
// alguma - o icone real do manifesto e /brand/val-symbol-official.png. E cache.addAll e tudo-ou-
// nada: um unico item que falha rejeita a promessa inteira, o install nunca conclui e o service
// worker NUNCA ativa. O consultor instalava a VAL na tela inicial, no escritorio funcionava tudo,
// e na fazenda sem sinal o icone abria a pagina de erro do navegador.
//
// Item a item, de proposito: um arquivo renomeado num deploy futuro passa a custar aquele arquivo,
// nao o modo offline inteiro. A casca continua sendo requisito - sem ela nao ha o que abrir.
const PRECACHE_SHELL=['/','/index.html']
const PRECACHE_EXTRA=['/manifest.webmanifest','/brand/val-symbol-official.png']
// A casca sozinha nao abre o app. O JS e o CSS de entrada so entravam no cache quando alguem os
// pedia, e o activate apaga o cache do release anterior inteiro - entao, na primeira vez offline
// depois de uma atualizacao, o index.html novo pedia hashes novos que nunca foram guardados e os
// antigos ja tinham sido apagados. Medido com dois builds reais e o dist/sw.js carimbado: o cache
// do release novo ficava com 4 entradas, nenhuma delas JS ou CSS, e o app respondia "Failed to
// fetch" no /assets/index-*.js. Tela em branco, sem mensagem, justamente no campo sem sinal.
// O build carimba aqui os arquivos que o proprio index.html referencia. Os pedacos lazy continuam
// entrando por uso: eles nao sao necessarios para o app abrir, e baixar o bundle inteiro a cada
// release custaria caro na conexao fraca que este cache existe para atender.
const PRECACHE_BUILD=__VAL_BUILD_ASSETS__
self.addEventListener('install',event=>{
 self.skipWaiting()
 event.waitUntil(caches.open(CACHE).then(async cache=>{
  await cache.addAll(PRECACHE_SHELL)
  await Promise.allSettled([...PRECACHE_BUILD,...PRECACHE_EXTRA].map(asset=>cache.add(asset)))
 }))
})
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
