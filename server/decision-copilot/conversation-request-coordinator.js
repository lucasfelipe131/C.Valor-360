import {conversationSessionKey} from './conversation-session-store.js'

export const conversationRequestCoordinatorVersion='val.conversation_request_coordinator.v1'

const supersededError=()=>Object.assign(new Error('Uma pergunta mais nova substituiu esta execução.'),{
 name:'AbortError',
 statusCode:409,
 code:'val_request_superseded',
 safeToRetry:false
})

const cancelledError=signal=>signal?.reason instanceof Error
 ?signal.reason
 :Object.assign(new Error('A execução desta conversa não é mais a atual.'),{name:'AbortError',statusCode:409,code:'val_request_stale',safeToRetry:false})

export function createConversationRequestCoordinator(){
 const active=new Map()
 let sequence=0
 const api={
  begin(scope={},controller){
   if(!(controller instanceof AbortController))throw new TypeError('AbortController obrigatório para coordenar a conversa.')
   const key=conversationSessionKey(scope)
   const previous=active.get(key)
   if(previous&&!previous.controller.signal.aborted)previous.controller.abort(supersededError())
   const claim=Object.freeze({key,token:++sequence})
   active.set(key,{...claim,controller})
   return claim
  },
  assertCurrent(claim,signal){
   const current=claim&&active.get(claim.key)
   if(!current||current.token!==claim.token||signal?.aborted)throw cancelledError(signal)
   return true
  },
  release(claim){
   const current=claim&&active.get(claim.key)
   if(!current||current.token!==claim.token)return false
   active.delete(claim.key)
   return true
  },
  size(){return active.size},
  clear(){for(const item of active.values())if(!item.controller.signal.aborted)item.controller.abort(supersededError());active.clear()}
 }
 return Object.freeze(api)
}
