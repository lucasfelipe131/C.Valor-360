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
