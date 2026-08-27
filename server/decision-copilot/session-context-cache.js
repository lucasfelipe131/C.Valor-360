export const sessionContextCacheVersion='val.session_context_cache.v1'

const clean=value=>String(value??'').trim().slice(0,240)
const required=(value,label)=>{const normalized=clean(value);if(!normalized)throw Object.assign(new Error(`${label} é obrigatório para escopar o cache.`),{code:'val_cache_scope_required'});return normalized}

export function sessionContextCacheKey({tenantId,ownerId,clientId}={}){
 return `${required(tenantId,'tenantId')}\u001f${required(ownerId,'ownerId')}\u001f${required(clientId,'clientId')}`
}

export function createSessionContextCache({ttlMs=30_000,maxEntries=250,clock=()=>Date.now()}={}){
 const entries=new Map()
 const ttl=Math.max(1_000,Math.min(300_000,Number(ttlMs)||30_000))
 const limit=Math.max(10,Math.min(2_000,Number(maxEntries)||250))
 let hits=0;let misses=0;let loads=0;let invalidations=0
 const removeExpired=()=>{const now=clock();for(const [key,item] of entries)if(item.expiresAt<=now)entries.delete(key)}
 const evict=()=>{removeExpired();while(entries.size>limit)entries.delete(entries.keys().next().value)}
 const api={
  async getOrLoad(scope,loader){
   if(typeof loader!=='function')throw new TypeError('O cache exige um loader explícito.')
   const key=sessionContextCacheKey(scope);const now=clock();const current=entries.get(key)
   if(current&&current.expiresAt>now){hits++;return current.promise}
   if(current)entries.delete(key)
   misses++;loads++
   const promise=Promise.resolve().then(loader).catch(error=>{if(entries.get(key)?.promise===promise)entries.delete(key);throw error})
   entries.set(key,{promise,expiresAt:now+ttl,tenantId:clean(scope.tenantId),ownerId:clean(scope.ownerId),clientId:clean(scope.clientId)})
   evict()
   return promise
  },
  invalidate(scope={}){
   const tenantId=clean(scope.tenantId);const ownerId=clean(scope.ownerId);const clientId=clean(scope.clientId)
   let removed=0
   for(const [key,item] of entries){
    if(tenantId&&item.tenantId!==tenantId)continue
    if(ownerId&&item.ownerId!==ownerId)continue
    if(clientId&&item.clientId!==clientId)continue
    entries.delete(key);removed++
   }
   if(removed)invalidations+=removed
   return removed
  },
  clear(){const removed=entries.size;entries.clear();invalidations+=removed;return removed},
  stats(){removeExpired();return Object.freeze({version:sessionContextCacheVersion,entries:entries.size,hits,misses,loads,invalidations,ttl_ms:ttl,content_free:true})}
 }
 return Object.freeze(api)
}
