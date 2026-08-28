import assert from 'node:assert/strict'
import test from 'node:test'
import {createSessionContextCache,sessionContextCacheKey} from '../server/decision-copilot/session-context-cache.js'

test('cache é estritamente tenant + owner + client + conversation e deduplica loads concorrentes',async()=>{
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c'}),sessionContextCacheKey({tenantId:'b',ownerId:'o',clientId:'c'}))
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c'}),sessionContextCacheKey({tenantId:'a',ownerId:'p',clientId:'c'}))
 assert.notEqual(sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-a'}),sessionContextCacheKey({tenantId:'a',ownerId:'o',clientId:'c',conversationId:'thread-b'}))
 let now=1_000;let loads=0
 const cache=createSessionContextCache({ttlMs:2_000,clock:()=>now})
 const scope={tenantId:'tenant-a',ownerId:'owner-a',clientId:'client-a',conversationId:'thread-a'}
 const loader=async()=>{loads++;await Promise.resolve();return {client:{id:'client-a'}}}
 const [first,second]=await Promise.all([cache.getOrLoad(scope,loader),cache.getOrLoad(scope,loader)])
 assert.equal(first,second)
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
