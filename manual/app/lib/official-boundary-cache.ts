// Public, allowlisted cadastral geometries only. Never cache workspace records,
// imported files, authentication responses or owner names in this shared cache.
type Result={features:unknown[];status:string;limited?:boolean;failedSources?:number};
type Entry<T>={data:T;queriedAt:string;expiresAt:number;bytes:number};
export function createOfficialBoundaryCache({now=Date.now,maxEntries=128,maxBytes=16*1024*1024,maxPending=24}={}){
 const cache=new Map<string,Entry<Result>>(),pending=new Map<string,Promise<Entry<Result>>>();let bytes=0;
 return {
  async query<T extends Result>(key:string,fetchSource:()=>Promise<T>,{refresh=false}={}){
   const cached=cache.get(key);
   if(!refresh&&cached&&cached.expiresAt>now())return {result:cached.data as T,queriedAt:cached.queriedAt,cache:'HIT' as const};
   const shared=pending.get(key);
   if(shared){const entry=await shared;return {result:entry.data as T,queriedAt:entry.queriedAt,cache:'SHARED' as const};}
   if(pending.size>=maxPending)return {result:{features:[],status:'unavailable',failedSources:1} as unknown as T,queriedAt:new Date(now()).toISOString(),cache:'BUSY' as const};
   const task=(async()=>{
    const data=await fetchSource(),at=now();
    // Failure is a brief retry backoff, never a factual empty parcel set.
    const ttl=data.status==='unavailable'?15000:data.limited||data.failedSources?30000:300000;
    const entry={data,queriedAt:new Date(at).toISOString(),expiresAt:at+ttl,bytes:JSON.stringify(data).length*2};
    const old=cache.get(key);if(old){bytes-=old.bytes;cache.delete(key);}
    if(entry.bytes<=maxBytes){cache.set(key,entry);bytes+=entry.bytes;}
    while(cache.size>maxEntries||bytes>maxBytes){const oldest=cache.keys().next().value;if(!oldest)break;bytes-=cache.get(oldest)!.bytes;cache.delete(oldest);}
    return entry;
   })();
   pending.set(key,task);
   try{const entry=await task;return {result:entry.data as T,queriedAt:entry.queriedAt,cache:'MISS' as const};}finally{pending.delete(key);}
  },
 };
}
export const officialBoundaryCache=createOfficialBoundaryCache();
