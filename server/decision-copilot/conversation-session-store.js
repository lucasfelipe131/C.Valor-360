import {advanceConversationState,conversationStateVersion,createConversationState,normalizeConversationState,switchConversationClient} from './conversation-state.js'

export const conversationSessionStoreVersion='val.conversation_session_store.v1'

const clean=value=>String(value??'').trim().slice(0,180)
const required=(value,label)=>{const normalized=clean(value);if(!normalized)throw Object.assign(new Error(`${label} é obrigatório para escopar a conversa.`),{code:'conversation_scope_required'});return normalized}
const clone=value=>structuredClone(value)

export function conversationSessionKey({tenantId,ownerId,conversationId}={}){
 return `${required(tenantId,'tenantId')}\u001f${required(ownerId,'ownerId')}\u001f${required(conversationId,'conversationId')}`
}

export function createConversationSessionStore({ttlMs=2*60*60_000,maxEntries=500,clock=()=>Date.now()}={}){
 const entries=new Map()
 const ttl=Math.max(60_000,Math.min(24*60*60_000,Number(ttlMs)||2*60*60_000))
 const limit=Math.max(10,Math.min(5_000,Number(maxEntries)||500))
 let reads=0,writes=0,misses=0,expirations=0,resets=0
 const purge=()=>{const now=clock();for(const [key,item] of entries)if(item.expiresAt<=now){entries.delete(key);expirations++}}
 const evict=()=>{purge();while(entries.size>limit)entries.delete(entries.keys().next().value)}
 const scopeState=(scope,state)=>{
  const normalized=normalizeConversationState(state,{conversationId:scope.conversationId,clientId:scope.clientId,client:scope.client,activeContext:scope.activeContext,now:scope.now})
  const existingClient=normalized.current_client?.id
  const requestedClient=clean(scope.clientId??scope.client?.id)
  if(existingClient&&requestedClient&&existingClient!==requestedClient)throw Object.assign(new Error('A conversa não pode trocar de produtor silenciosamente.'),{code:'conversation_client_scope_mismatch'})
  return normalized
 }
 const api={
  get(scope={}){
   purge();const key=conversationSessionKey(scope);const item=entries.get(key)
   if(!item){misses++;return null}
   const requestedClient=clean(scope.clientId??scope.client?.id)
   const storedClient=clean(item.state.current_client?.id)
   if(requestedClient&&storedClient&&requestedClient!==storedClient)throw Object.assign(new Error('A conversa não pertence ao produtor solicitado.'),{code:'conversation_client_scope_mismatch'})
   reads++;item.expiresAt=clock()+ttl;return clone(item.state)
  },
  ensure(scope={}){
   const current=api.get(scope)
   if(current)return current
   const state=createConversationState({conversationId:scope.conversationId,clientId:scope.clientId,client:scope.client,activeContext:scope.activeContext,now:scope.now})
   return api.set(scope,state)
  },
  set(scope={},state={}){
   const key=conversationSessionKey(scope);const normalized=scopeState(scope,state)
   entries.set(key,{state:clone(normalized),expiresAt:clock()+ttl,tenantId:clean(scope.tenantId),ownerId:clean(scope.ownerId),conversationId:clean(scope.conversationId),clientId:clean(normalized.current_client?.id)})
   writes++;evict();return clone(normalized)
  },
  advance(scope={},event={}){
   const current=api.ensure(scope)
   return api.set(scope,advanceConversationState(current,{...event,scope:{conversationId:scope.conversationId,clientId:scope.clientId,client:scope.client,activeContext:scope.activeContext,now:event.now??scope.now}}))
  },
  switchClient(scope={},client,{now}={}){
   const lookup={tenantId:scope.tenantId,ownerId:scope.ownerId,conversationId:scope.conversationId}
   const current=api.get(lookup)||createConversationState({...lookup,now})
   const next=switchConversationClient(current,client,{conversationId:scope.conversationId,clientId:client?.id,client,now})
   return api.set({...lookup,clientId:client?.id,client},next)
  },
  reset(scope={}){const removed=entries.delete(conversationSessionKey(scope));if(removed)resets++;return removed},
  invalidate(scope={}){
   const tenantId=clean(scope.tenantId),ownerId=clean(scope.ownerId),conversationId=clean(scope.conversationId),clientId=clean(scope.clientId)
   let removed=0
   for(const [key,item] of entries){if(tenantId&&item.tenantId!==tenantId)continue;if(ownerId&&item.ownerId!==ownerId)continue;if(conversationId&&item.conversationId!==conversationId)continue;if(clientId&&item.clientId!==clientId)continue;entries.delete(key);removed++}
   if(removed)resets+=removed;return removed
  },
  stats(){purge();return Object.freeze({version:conversationSessionStoreVersion,state_contract:conversationStateVersion,content_free:true,entries:entries.size,reads,writes,misses,expirations,resets,ttl_ms:ttl})},
  clear(){const removed=entries.size;entries.clear();resets+=removed;return removed}
 }
 return Object.freeze(api)
}
