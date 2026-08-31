import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {clearInnovationGrainCache,grainWorkspaceFor} from '../server/innovation-bootstrap.js'
import {GrainRepository} from '../server/grain-repository.js'

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')

test('cache de grãos exige escopo completo e mutações SOG o invalidam',()=>{
 assert.equal(clearInnovationGrainCache({tenantId:'tenant-a',ownerId:'owner-a'}),0)
 assert.throws(()=>clearInnovationGrainCache({tenantId:'tenant-a'}),error=>error.code==='grain_cache_scope_required')
 for(const marker of ['saveProfile','saveIntent','updateIntentStatus','saveMarketSnapshot']){
  const at=server.indexOf(marker)
  assert.notEqual(at,-1)
  assert.match(server.slice(at,at+900),/invalidateDerivedPortfolioCaches\(\{tenantId:[^\n]+ownerId:[^\n]+grains:true\}\)/)
 }
})

test('mutações de entidade e histórico invalidam apenas caches tenant-owner',()=>{
 const integrationAt=server.indexOf('repository.integrateSurvey')
 assert.match(server.slice(integrationAt,integrationAt+800),/invalidateAuthorizedClientReferences\(\{tenantId:[^\n]+ownerId:/)
 const manualAt=server.indexOf("event.type==='manual.producer.updated'")
 assert.match(server.slice(manualAt,manualAt+500),/invalidateAuthorizedClientReferences\(\{tenantId:config\.defaultTenantId,ownerId\}\)/)
 assert.match(server.slice(manualAt,manualAt+700),/startsWith\('business\.'\)[^\n]+objections:true/)
 const importAt=server.indexOf('repository.ingestCommercialImport')
 assert.match(server.slice(importAt,importAt+1200),/invalidateDerivedPortfolioCaches\(\{tenantId:[^\n]+ownerId:[^\n]+objections:true\}\)/)
})

test('workspace de grãos antigo em voo não repopula o cache após invalidação',async()=>{
 clearInnovationGrainCache()
 let releaseStale
 const staleWorkspace=new Promise(resolve=>{releaseStale=resolve})
 const originalGetWorkspace=GrainRepository.prototype.getWorkspace
 let calls=0
 GrainRepository.prototype.getWorkspace=function(){
  calls+=1
  return calls===1?staleWorkspace:Promise.resolve({marker:'fresh-workspace'})
 }
 try{
  const repository={tenantId:'tenant-race',db:{configured:true}}
  const staleLoad=grainWorkspaceFor(repository,'owner-race')
  assert.equal(calls,1)
  clearInnovationGrainCache({tenantId:'tenant-race',ownerId:'owner-race'})
  assert.equal((await grainWorkspaceFor(repository,'owner-race')).marker,'fresh-workspace')
  releaseStale({marker:'stale-workspace'})
  assert.equal((await staleLoad).marker,'stale-workspace')
  assert.equal((await grainWorkspaceFor(repository,'owner-race')).marker,'fresh-workspace')
  assert.equal(calls,2)
 }finally{
  GrainRepository.prototype.getWorkspace=originalGetWorkspace
  clearInnovationGrainCache()
 }
})
