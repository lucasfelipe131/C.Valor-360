import test from 'node:test'
import assert from 'node:assert/strict'
import {createProducerEntityIndexCache,producerEntityIndexCacheVersion} from '../server/decision-copilot/producer-entity-index-cache.js'

test('índice leve é escopado por tenant+owner, expira e nunca expõe conteúdo nas métricas',async()=>{
 let now=0;let loads=0
 const cache=createProducerEntityIndexCache({ttlMs:1_000,clock:()=>now})
 const load=async()=>{loads++;return [{id:`client-${loads}`,name:'Antônio'}]}
 const scope={tenantId:'tenant-a',ownerId:'owner-a'}
 assert.equal((await cache.getOrLoad(scope,load))[0].id,'client-1')
 assert.equal((await cache.getOrLoad(scope,load))[0].id,'client-1')
 assert.equal(loads,1)
 assert.equal((await cache.getOrLoad({...scope,ownerId:'owner-b'},load))[0].id,'client-2')
 now=1_001
 assert.equal((await cache.getOrLoad(scope,load))[0].id,'client-3')
 const stats=cache.stats()
 assert.equal(stats.version,producerEntityIndexCacheVersion)
 assert.equal(stats.content_free,true)
 assert.equal(JSON.stringify(stats).includes('Antônio'),false)
})

test('invalidação aposenta load em voo, bloqueia publicação stale e preserva deduplicação',async()=>{
 const cache=createProducerEntityIndexCache()
 const scope={tenantId:'tenant-a',ownerId:'owner-a'}
 let release;let loads=0
 const blocked=new Promise(resolve=>{release=resolve})
 const loader=async()=>{loads++;await blocked;return [{id:'producer-archived'}]}

 const first=cache.getOrLoad(scope,loader)
 const concurrent=cache.getOrLoad(scope,loader)
 await Promise.resolve()
 assert.equal(loads,1)
 assert.equal(cache.invalidate(scope),1)
 release()
 for(const pending of [first,concurrent])await assert.rejects(pending,error=>error.code==='val_producer_entity_index_invalidated'&&error.safeToRetry===true)

 let freshLoads=0
 const fresh=await cache.getOrLoad(scope,async()=>{freshLoads++;return [{id:'producer-current'}]})
 assert.equal(fresh[0].id,'producer-current')
 assert.equal(freshLoads,1)

 const capturedHit=cache.getOrLoad(scope,async()=>[{id:'must-not-load'}])
 assert.equal(cache.invalidate(scope),1)
 await assert.rejects(capturedHit,error=>error.code==='val_producer_entity_index_invalidated')
 assert.equal(cache.stats().entries,0)
})
