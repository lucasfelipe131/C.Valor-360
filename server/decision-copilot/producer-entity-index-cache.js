export const producerEntityIndexCacheVersion='val.producer_entity_index_cache.v1'

const clean=value=>String(value??'').trim().slice(0,180)
const clone=value=>structuredClone(value)

export function createProducerEntityIndexCache({ttlMs=30_000,maxEntries=250,clock=()=>Date.now()}={}){
 const entries=new Map();let hits=0;let misses=0;let loads=0;let invalidations=0
 const ttl=Math.max(1_000,Math.min(5*60_000,Number(ttlMs)||30_000))
 const limit=Math.max(10,Math.min(2_000,Number(maxEntries)||250))
 const keyOf=({tenantId,ownerId})=>`${clean(tenantId)}\u001f${clean(ownerId)}`
 const evict=()=>{while(entries.size>limit)entries.delete(entries.keys().next().value)}
 return Object.freeze({
  async getOrLoad(scope,loader){
   const key=keyOf(scope);const cached=entries.get(key)
   if(cached&&cached.expiresAt>clock()){hits++;return clone(cached.value)}
   if(cached)entries.delete(key);misses++
   const value=await loader();loads++;entries.set(key,{value:clone(value),expiresAt:clock()+ttl});evict();return clone(value)
  },
  invalidate(scope={}){
   const tenantId=clean(scope.tenantId),ownerId=clean(scope.ownerId);let removed=0
   for(const [key] of entries){const [entryTenant,entryOwner]=key.split('\u001f');if(tenantId&&entryTenant!==tenantId)continue;if(ownerId&&entryOwner!==ownerId)continue;entries.delete(key);removed++}
   invalidations+=removed;return removed
  },
  stats:()=>Object.freeze({version:producerEntityIndexCacheVersion,entries:entries.size,hits,misses,loads,invalidations,ttl_ms:ttl,content_free:true})
 })
}
