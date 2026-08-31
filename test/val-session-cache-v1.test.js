import assert from 'node:assert/strict'
import test from 'node:test'
import {createSessionContextCache,sessionContextCacheKey} from '../server/decision-copilot/session-context-cache.js'

test('cache é estritamente tenant + owner + client + conversation e deduplica loads concorrentes',async()=>{
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c'}),sessionContextCacheKey({tenantId:'b',ownerId:'o',clientId:'c'}))
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c'}),sessionContextCacheKey({tenantId:'a',ownerId:'p',clientId:'c'}))
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-a'}),sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-b'}))
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-a',contextEpoch:1}),sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-a',contextEpoch:2}))
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-a',contextEpoch:1,contextDomain:'PROFILE'}),sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-a',contextEpoch:1,contextDomain:'GRAINS'}))
 let now=1_000;let loads=0
 const cache=createSessionContextCache({ttlMs:2_000,clock:()=>now})
 const scope={tenantId:'tenant-a',ownerId:'owner-a',clientId:'client-a',conversationId:'thread-a'}
 const loader=async()=>{loads++;await Promise.resolve();return {client:{id:'client-a'}}}
 const [first,second]=await Promise.all([cache.getOrLoad(scope,loader),cache.getOrLoad(scope,loader)])
 assert.deepEqual(first,second)
 assert.notEqual(first,second)
 assert.equal(loads,1)
 assert.equal(cache.stats().hits,1)
 now=3_001
 await cache.getOrLoad(scope,loader)
 assert.equal(loads,2)
})

test('REGISTER ou mudança material invalida somente o escopo afetado',async()=>{
 const cache=createSessionContextCache()
 const a={tenantId:'tenant',ownerId:'owner-a',clientId:'client'}
 const b={tenantId:'tenant',ownerId:'owner-b',clientId:'client'}
 await cache.getOrLoad(a,async()=>({version:'a1'}))
 await cache.getOrLoad(b,async()=>({version:'b1'}))
 assert.equal(cache.invalidate(a),1)
 let aLoads=0;let bLoads=0
 assert.equal((await cache.getOrLoad(a,async()=>{aLoads++;return {version:'a2'}})).version,'a2')
 assert.equal((await cache.getOrLoad(b,async()=>{bLoads++;return {version:'b2'}})).version,'b1')
 assert.equal(aLoads,1)
 assert.equal(bLoads,0)
 assert.equal(cache.stats().content_free,true)
})

test('invalidation de uma thread não remove outra e invalidation do cliente remove todas',async()=>{
 const cache=createSessionContextCache()
 const base={tenantId:'tenant',ownerId:'owner',clientId:'client'}
 await cache.getOrLoad({...base,conversationId:'thread-a'},async()=>({version:'a'}))
 await cache.getOrLoad({...base,conversationId:'thread-b'},async()=>({version:'b'}))
 assert.equal(cache.invalidate({...base,conversationId:'thread-a'}),1)
 assert.equal((await cache.getOrLoad({...base,conversationId:'thread-b'},async()=>({version:'b2'}))).version,'b')
 assert.equal(cache.invalidate(base),1)
 assert.equal(cache.stats().entries,0)
})

test('cache rejeita chave incompleta para impedir fallback cross-tenant',async()=>{
 const cache=createSessionContextCache()
 await assert.rejects(cache.getOrLoad({tenantId:'tenant',ownerId:'',clientId:'client'},async()=>({})),error=>error.code==='val_cache_scope_required')
})

test('contextEpoch do cache é inteiro seguro exato e valores inválidos não colidem nem invalidam epoch zero',async()=>{
 const base={tenantId:'tenant',ownerId:'owner',clientId:'client',conversationId:'thread',message:'qual o perfil dele?'}
 assert.equal(sessionContextCacheKey(base),sessionContextCacheKey({...base,contextEpoch:0}))
 assert.doesNotThrow(()=>sessionContextCacheKey({...base,contextEpoch:Number.MAX_SAFE_INTEGER}))

 const invalidEpochs=[undefined,null,'0',false,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,-1,0.5,Number.MAX_SAFE_INTEGER+1]
 for(const value of invalidEpochs)assert.throws(()=>sessionContextCacheKey({...base,contextEpoch:value}),error=>error.code==='val_cache_context_epoch_invalid')

 const cache=createSessionContextCache()
 await cache.getOrLoad({...base,contextEpoch:0},async()=>({epoch:0}))
 await cache.getOrLoad({...base,contextEpoch:1},async()=>({epoch:1}))
 let invalidLoads=0
 for(const value of invalidEpochs){
  await assert.rejects(cache.getOrLoad({...base,contextEpoch:value},async()=>{invalidLoads++;return {poison:true}}),error=>error.code==='val_cache_context_epoch_invalid')
  assert.throws(()=>cache.invalidate({...base,contextEpoch:value}),error=>error.code==='val_cache_context_epoch_invalid')
 }
 assert.equal(invalidLoads,0)
 assert.equal(cache.stats().entries,2)
 assert.equal(cache.invalidate({...base,contextEpoch:0}),1)
 assert.equal(cache.stats().entries,1)
 assert.equal((await cache.getOrLoad({...base,contextEpoch:1},async()=>({epoch:'reloaded'}))).epoch,1)
})

test('retornos são clones profundamente congelados e não vazam mutação entre consumidores',async()=>{
 const cache=createSessionContextCache()
 const scope={tenantId:'tenant',ownerId:'owner',clientId:'client',conversationId:'thread'}
 const source={client:{id:'client',name:'Original'},evidence:[{id:'fact-1',score:90}],metadata:{domains:['PROFILE']}}
 let loads=0
 const loader=async()=>{loads++;return source}
 const [first,second]=await Promise.all([cache.getOrLoad(scope,loader),cache.getOrLoad(scope,loader)])

 assert.deepEqual(first,second)
 assert.notEqual(first,second)
 assert.notEqual(first.client,second.client)
 assert.notEqual(first.evidence,second.evidence)
 for(const returned of [first,second])for(const value of [returned,returned.client,returned.evidence,returned.evidence[0],returned.metadata,returned.metadata.domains])assert.equal(Object.isFrozen(value),true)
 assert.throws(()=>{first.client.name='POISON_CONSUMER'},TypeError)
 assert.throws(()=>{first.evidence[0].score=0},TypeError)
 assert.throws(()=>{first.metadata.domains.push('CREDIT')},TypeError)

 source.client.name='POISON_LOADER'
 source.evidence[0].score=0
 source.metadata.domains.push('CREDIT')
 const third=await cache.getOrLoad(scope,loader)
 assert.equal(loads,1)
 assert.equal(third.client.name,'Original')
 assert.equal(third.evidence[0].score,90)
 assert.deepEqual(third.metadata.domains,['PROFILE'])
 assert.notEqual(third,first)
 assert.equal(Object.isFrozen(third.client),true)
})
