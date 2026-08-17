import {ValRepository} from './repository.js'
import {GrainRepository} from './grain-repository.js'
import {buildCommitmentLadders} from './commitment-ladder.js'
import {buildObjectionLibrary} from './objection-library.js'
import {buildValueScenarios} from './value-scenarios.js'
import {buildMultiDecisionMap} from './multi-decision-map.js'
import {buildPostConversionExpansion,hasRecentClosedBusiness} from './post-conversion-expansion.js'

const PATCHED=Symbol.for('valor360.conversion-innovations.patched')
const GRAIN_CACHE_TTL_MS=5*60_000
const grainCache=new Map()

async function grainWorkspaceFor(repository,ownerId){
 if(ownerId==null)return null
 const key=`${repository.tenantId||'tenant'}:${ownerId}`
 const cached=grainCache.get(key)
 if(cached&&cached.expiresAt>Date.now())return cached.value
 try{
  const grainRepository=new GrainRepository({db:repository.db,readStore:repository.readStore,saveStore:repository.saveStore,tenantId:repository.tenantId})
  const value=await grainRepository.getWorkspace(ownerId)
  grainCache.set(key,{expiresAt:Date.now()+GRAIN_CACHE_TTL_MS,value})
  return value
 }catch{return null}
}

if(!globalThis[PATCHED]){
 globalThis[PATCHED]=true
 const originalGetClientContext=ValRepository.prototype.getClientContext
 ValRepository.prototype.getClientContext=async function contextWithConversionInnovations(input){
  const context=await originalGetClientContext.call(this,input)
  const grainWorkspace=hasRecentClosedBusiness(context)?await grainWorkspaceFor(this,input?.ownerId):null
  return {
   ...context,
   conversionInnovations:{
    ...(context.conversionInnovations||{}),
    commitmentLadders:buildCommitmentLadders(context),
    objectionLibrary:buildObjectionLibrary(context),
    valueScenarios:buildValueScenarios(context),
    multiDecisionMap:buildMultiDecisionMap(context),
    postConversionExpansion:buildPostConversionExpansion(context,{grainWorkspace})
   }
  }
 }
}
