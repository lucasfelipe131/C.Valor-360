export const producerEntityIndexCacheVersion='val.producer_entity_index_cache.v2'

const clean=value=>String(value??'').trim().slice(0,180)
const required=(value,label)=>{const normalized=clean(value);if(!normalized)throw Object.assign(new Error(`${label} é obrigatório para escopar o índice de produtores.`),{code:'val_producer_index_scope_required'});return normalized}
const clone=value=>structuredClone(value)

export function createProducerEntityIndexCache({ttlMs=30_000,maxEntries=250,clock=()=>Date.now()}={}){
 const entries=new Map();let hits=0;let misses=0;let loads=0;let invalidations=0
 const ttl=Math.max(1_000,Math.min(5*60_000,Number(ttlMs)||30_000))
 const limit=Math.max(10,Math.min(2_000,Number(maxEntries)||250))
 const keyOf=({tenantId,ownerId})=>JSON.stringify([required(tenantId,'tenantId'),required(ownerId,'ownerId')])
 const invalidatedError=()=>Object.assign(new Error('O índice autorizado de produtores mudou durante o carregamento. Repita a solicitação no escopo atual.'),{code:'val_producer_entity_index_invalidated',statusCode:409,safeToRetry:true})
 const retire=(key,item)=>{if(entries.get(key)===item)entries.delete(key);item.invalidated=true}
 const purge=()=>{const now=clock();for(const [key,item] of entries)if(!item.promise&&item.expiresAt<=now)retire(key,item)}
 const evict=()=>{
  purge()
  while(entries.size>limit){
   const resolved=[...entries].find(([,item])=>!item.promise)
   const [key,item]=resolved||entries.entries().next().value
   retire(key,item)
  }
 }
 const consume=item=>Promise.resolve(item.promise??item.value).then(value=>{
  if(item.invalidated||entries.get(item.key)!==item)throw invalidatedError()
  return clone(value)
 })
 return Object.freeze({
  async getOrLoad(scope,loader){
   if(typeof loader!=='function')throw new TypeError('O índice de produtores exige um loader explícito.')
   const key=keyOf(scope);purge();const cached=entries.get(key)
   if(cached){hits++;return consume(cached)}
   misses++;loads++
   const item={key,tenantId:clean(scope.tenantId),ownerId:clean(scope.ownerId),value:null,promise:null,expiresAt:Infinity,invalidated:false}
   const promise=Promise.resolve().then(loader).then(value=>{
    if(item.invalidated||entries.get(key)!==item)throw invalidatedError()
    item.value=clone(value);item.promise=null;item.expiresAt=clock()+ttl;evict()
    return item.value
   }).catch(error=>{if(entries.get(key)===item)entries.delete(key);throw error})
   item.promise=promise;entries.set(key,item);evict()
   return consume(item)
  },
  invalidate(scope={}){
   const tenantId=clean(scope.tenantId),ownerId=clean(scope.ownerId);let removed=0
   for(const [key,item] of entries){if(tenantId&&item.tenantId!==tenantId)continue;if(ownerId&&item.ownerId!==ownerId)continue;retire(key,item);removed++}
   invalidations+=removed;return removed
  },
  stats:()=>{purge();return Object.freeze({version:producerEntityIndexCacheVersion,entries:entries.size,hits,misses,loads,invalidations,ttl_ms:ttl,content_free:true})}
 })
}
