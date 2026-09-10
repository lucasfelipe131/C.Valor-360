import test from 'node:test'
import assert from 'node:assert/strict'
import {createOfficialBoundaryCache} from '../manual/app/lib/official-boundary-cache.ts'
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const result={status:'available',features:[{id:'public-reference'}]}

test('public source cache coalesces concurrent requests, serves warm results, expires and refreshes explicitly',async()=>{
 let time=Date.parse('2026-09-09T12:00:00Z'),calls=0
 const cache=createOfficialBoundaryCache({now:()=>time}),pending=deferred()
 const first=cache.query('car:RS:extent',()=>{calls++;return pending.promise})
 const second=cache.query('car:RS:extent',()=>{calls++;return Promise.resolve(result)})
 pending.resolve(result)
 const [cold,shared]=await Promise.all([first,second]);assert.equal(calls,1)
 assert.equal(cold.cache,'MISS');assert.equal(shared.cache,'SHARED');assert.equal(shared.queriedAt,cold.queriedAt)
 const fetch=async()=>{calls++;return result}
 time+=299000;assert.equal((await cache.query('car:RS:extent',fetch)).cache,'HIT');assert.equal(calls,1)
 time+=1001;assert.equal((await cache.query('car:RS:extent',fetch)).cache,'MISS');assert.equal(calls,2)
 assert.equal((await cache.query('car:RS:extent',fetch,{refresh:true})).cache,'MISS');assert.equal(calls,3)
 await cache.query('sigef-particular:RS:extent',fetch);await cache.query('car:SC:extent',fetch);assert.equal(calls,5)
})
test('unavailable and limited results retain their status and have a short retry backoff',async()=>{
 for(const [data,ttl] of [[{status:'unavailable',features:[],failedSources:1},15000],[{...result,limited:true},30000]]){
  let time=0,calls=0;const cache=createOfficialBoundaryCache({now:()=>time}),fetch=async()=>{calls++;return data}
  await cache.query('key',fetch);time=ttl-1
  const warm=await cache.query('key',fetch);assert.equal(warm.result.status,data.status);assert.equal(warm.cache,'HIT');assert.equal(calls,1)
  time=ttl;assert.equal((await cache.query('key',fetch)).cache,'MISS');assert.equal(calls,2)
 }
})
test('entry/byte and in-flight limits bound memory and upstream load; rejected jobs can retry',async()=>{
 const cache=createOfficialBoundaryCache({maxEntries:1}),fetch=async()=>result
 await cache.query('first',fetch);await cache.query('second',fetch)
 assert.equal((await cache.query('first',fetch)).cache,'MISS')
 const tiny=createOfficialBoundaryCache({maxBytes:1});await tiny.query('large',fetch)
 assert.equal((await tiny.query('large',fetch)).cache,'MISS')
 const bounded=createOfficialBoundaryCache({maxPending:1}),pending=deferred()
 const first=bounded.query('first',()=>pending.promise)
 const busy=await bounded.query('second',()=>{throw new Error('Must not fetch while busy')})
 assert.equal(busy.cache,'BUSY');assert.equal(busy.result.status,'unavailable')
 pending.resolve(result);await first
 await assert.rejects(bounded.query('reject',async()=>{throw new Error('Network')}),/Network/)
 assert.equal((await bounded.query('reject',fetch)).cache,'MISS')
})
