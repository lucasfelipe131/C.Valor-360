import {createHash} from 'node:crypto'

export const sessionContextCacheVersion='val.session_context_cache.v4'
export const sessionContextCacheNamespaces=Object.freeze({SELECTED:'SELECTED_CONTEXT',PRELOAD:'PRELOAD_CONTEXT'})

const clean=value=>String(value??'').trim().slice(0,240)
const required=(value,label)=>{const normalized=clean(value);if(!normalized)throw Object.assign(new Error(`${label} é obrigatório para escopar o cache.`),{code:'val_cache_scope_required'});return normalized}
const own=(value,key)=>Boolean(value&&Object.prototype.hasOwnProperty.call(value,key))
const contextEpoch=scope=>{
 if(!own(scope,'contextEpoch'))return {provided:false,value:0}
 const value=scope.contextEpoch
 if(!Number.isSafeInteger(value)||value<0)throw Object.assign(new Error('contextEpoch deve ser um inteiro seguro não negativo quando informado.'),{code:'val_cache_context_epoch_invalid'})
 return {provided:true,value}
}
const signaturePart=value=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,4000)
const clone=value=>structuredClone(value)
const deepFreeze=(value,seen=new WeakSet())=>{
 if(!value||typeof value!=='object'||seen.has(value))return value
 seen.add(value)
 for(const nested of Object.values(value))deepFreeze(nested,seen)
 return Object.freeze(value)
}
const immutableClone=value=>deepFreeze(clone(value))

export function sessionContextSelectorSignature({selectorVersion='',message='',query='',intent='',objective='',actorRole='consultant',accessScope='own_portfolio',activeEntityType='',activeEntityId=''}={}){
 return createHash('sha256').update(JSON.stringify([
  signaturePart(selectorVersion)||'unversioned',
  signaturePart(actorRole).toLowerCase()||'consultant',
  signaturePart(accessScope).toLowerCase()||'own_portfolio',
  signaturePart(activeEntityType).toLowerCase(),
  signaturePart(activeEntityId),
  signaturePart(intent).toUpperCase(),
  signaturePart(objective).toLowerCase(),
  signaturePart(message||query).toLowerCase()
 ])).digest('hex')
}

export function sessionContextCacheKey(input={}){
 const {tenantId,ownerId,clientId,conversationId='',contextDomain='GENERAL',cacheNamespace=sessionContextCacheNamespaces.SELECTED,selectorVersion='',selectorSignature='',message='',query='',intent='',objective='',actorRole='consultant',accessScope='own_portfolio',activeEntityType='',activeEntityId=''}=input
 const conversation=clean(conversationId)||'__stateless__'
 const epoch=contextEpoch(input).value
 const domain=clean(contextDomain).toUpperCase()||'GENERAL'
 const namespace=clean(cacheNamespace).toUpperCase()||sessionContextCacheNamespaces.SELECTED
 const version=clean(selectorVersion)||'unversioned'
 const role=clean(actorRole).toLowerCase()||'consultant'
 const scope=clean(accessScope).toLowerCase()||'own_portfolio'
 const entityType=clean(activeEntityType).toLowerCase()||'__none__'
 const entityId=clean(activeEntityId)||'__none__'
 const computedSignature=sessionContextSelectorSignature({selectorVersion:version,message,query,intent,objective,actorRole:role,accessScope:scope,activeEntityType:entityType,activeEntityId:entityId})
 const suppliedSignature=clean(selectorSignature)
 if(suppliedSignature&&suppliedSignature!==computedSignature)throw Object.assign(new Error('A assinatura do seletor não corresponde à consulta objetiva do cache.'),{code:'val_cache_selector_signature_invalid'})
 const signature=computedSignature
 return `${required(tenantId,'tenantId')}\u001f${required(ownerId,'ownerId')}\u001f${required(clientId,'clientId')}\u001f${conversation}\u001f${epoch}\u001f${namespace}\u001f${domain}\u001f${role}\u001f${scope}\u001f${entityType}\u001f${entityId}\u001f${version}\u001f${signature}`
}

export function createSessionContextCache({ttlMs=30_000,maxEntries=250,clock=()=>Date.now()}={}){
 const entries=new Map()
 const activeLoads=new Set()
 const activeConsumers=new Set()
 const invalidatedLoads=new WeakSet()
 const invalidatedError=()=>Object.assign(new Error('O contexto mudou durante o carregamento. Repita a solicitação no escopo atual.'),{code:'val_context_cache_invalidated',statusCode:409,safeToRetry:true})
 const ttl=Math.max(1_000,Math.min(300_000,Number(ttlMs)||30_000))
 const limit=Math.max(10,Math.min(2_000,Number(maxEntries)||250))
 let hits=0;let misses=0;let loads=0;let invalidations=0
 const removeExpired=()=>{const now=clock();for(const [key,item] of entries)if(item.expiresAt<=now)entries.delete(key)}
 const evict=()=>{removeExpired();while(entries.size>limit)entries.delete(entries.keys().next().value)}
 const invalidationFilter=scope=>{const epoch=contextEpoch(scope);return {tenantId:clean(scope.tenantId),ownerId:clean(scope.ownerId),clientId:clean(scope.clientId),conversationId:clean(scope.conversationId),hasEpoch:epoch.provided,contextEpoch:epoch.value,contextDomain:clean(scope.contextDomain).toUpperCase(),cacheNamespace:clean(scope.cacheNamespace).toUpperCase(),selectorVersion:clean(scope.selectorVersion),selectorSignature:clean(scope.selectorSignature),actorRole:clean(scope.actorRole).toLowerCase(),accessScope:clean(scope.accessScope).toLowerCase(),activeEntityType:clean(scope.activeEntityType).toLowerCase(),activeEntityId:clean(scope.activeEntityId)}}
 const matches=(item,filter)=>{
  if(filter.tenantId&&item.tenantId!==filter.tenantId)return false
  if(filter.ownerId&&item.ownerId!==filter.ownerId)return false
  if(filter.clientId&&item.clientId!==filter.clientId)return false
  if(filter.conversationId&&item.conversationId!==filter.conversationId)return false
  if(filter.hasEpoch&&item.contextEpoch!==filter.contextEpoch)return false
  if(filter.contextDomain&&item.contextDomain!==filter.contextDomain)return false
  if(filter.cacheNamespace&&item.cacheNamespace!==filter.cacheNamespace)return false
  if(filter.selectorVersion&&item.selectorVersion!==filter.selectorVersion)return false
  if(filter.selectorSignature&&item.selectorSignature!==filter.selectorSignature)return false
  if(filter.actorRole&&item.actorRole!==filter.actorRole)return false
  if(filter.accessScope&&item.accessScope!==filter.accessScope)return false
  if(filter.activeEntityType&&item.activeEntityType!==filter.activeEntityType)return false
  if(filter.activeEntityId&&item.activeEntityId!==filter.activeEntityId)return false
  return true
 }
 const createConsumer=item=>{
  let consumer
  const guarded=Promise.resolve(item.promise).then(value=>{if(invalidatedLoads.has(item.promise))throw invalidatedError();return immutableClone(value)})
  consumer={...item,guarded}
  activeConsumers.add(consumer);guarded.then(()=>activeConsumers.delete(consumer),()=>activeConsumers.delete(consumer))
  return guarded
 }
 const api={
  async getOrLoad(scope,loader){
   if(typeof loader!=='function')throw new TypeError('O cache exige um loader explícito.')
   const key=sessionContextCacheKey(scope);const now=clock();const current=entries.get(key)
   if(current&&current.expiresAt>now){
    hits++
    return createConsumer(current)
   }
   if(current)entries.delete(key)
   misses++;loads++
   let item
   const promise=Promise.resolve().then(loader).then(value=>{
    if(invalidatedLoads.has(promise))throw invalidatedError()
    return clone(value)
   }).catch(error=>{if(entries.get(key)?.promise===promise)entries.delete(key);throw error})
   const cacheNamespace=clean(scope.cacheNamespace).toUpperCase()||sessionContextCacheNamespaces.SELECTED
   const selectorVersion=clean(scope.selectorVersion)||'unversioned'
   const actorRole=clean(scope.actorRole).toLowerCase()||'consultant'
   const accessScope=clean(scope.accessScope).toLowerCase()||'own_portfolio'
   const activeEntityType=clean(scope.activeEntityType).toLowerCase()||'__none__'
   const activeEntityId=clean(scope.activeEntityId)||'__none__'
   const selectorSignature=sessionContextSelectorSignature({...scope,selectorVersion,actorRole,accessScope,activeEntityType,activeEntityId})
   item={key,promise,expiresAt:now+ttl,tenantId:clean(scope.tenantId),ownerId:clean(scope.ownerId),clientId:clean(scope.clientId),conversationId:clean(scope.conversationId),contextEpoch:contextEpoch(scope).value,contextDomain:clean(scope.contextDomain).toUpperCase()||'GENERAL',cacheNamespace,selectorVersion,selectorSignature,actorRole,accessScope,activeEntityType,activeEntityId}
   entries.set(key,item);activeLoads.add(item)
   promise.then(()=>activeLoads.delete(item),()=>activeLoads.delete(item))
   evict()
   return createConsumer(item)
  },
  invalidate(scope={}){
   const filter=invalidationFilter(scope)
   const removedPromises=new Set()
   for(const [key,item] of entries){
    if(!matches(item,filter))continue
    entries.delete(key);removedPromises.add(item.promise)
   }
   for(const item of activeLoads)if(matches(item,filter))removedPromises.add(item.promise)
   for(const item of activeConsumers)if(matches(item,filter))removedPromises.add(item.promise)
   for(const promise of removedPromises)invalidatedLoads.add(promise)
   const removed=removedPromises.size
   if(removed)invalidations+=removed
   return removed
  },
  clear(){const removedPromises=new Set([...entries.values(),...activeLoads,...activeConsumers].map(item=>item.promise));for(const promise of removedPromises)invalidatedLoads.add(promise);entries.clear();const removed=removedPromises.size;invalidations+=removed;return removed},
  stats(){removeExpired();return Object.freeze({version:sessionContextCacheVersion,entries:entries.size,hits,misses,loads,invalidations,ttl_ms:ttl,content_free:true})}
 }
 return Object.freeze(api)
}
