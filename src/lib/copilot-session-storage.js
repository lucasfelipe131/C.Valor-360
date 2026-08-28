import {conversationWorkspaceStorageKey} from './full-screen-conversation.js'

export const copilotThreadStorageNamespace='valor360:val-copilot-thread:v4:'
export const copilotWorkspaceStorageNamespace='valor360:val-full-screen:v1:'

const encodedThreadScope=storageScope=>encodeURIComponent(String(storageScope||'session'))
const threadKeyPattern=/^valor360:val-copilot-thread:v\d+:([^:]+):.+$/
const workspaceKeyPattern=/^valor360:val-full-screen:v\d+:([^:]+)$/

function storageKeys(storage){
 if(!storage)return []
 try{
  const keys=[]
  if(typeof storage.key==='function'&&Number.isFinite(Number(storage.length))){
   for(let index=0;index<Number(storage.length);index++){
    const key=storage.key(index)
    if(typeof key==='string')keys.push(key)
   }
  }
  for(const key of Object.keys(storage))if(typeof key==='string')keys.push(key)
  return [...new Set(keys)]
 }catch{return []}
}

function keyMatcher(storageScope){
 if(storageScope===undefined||storageScope===null)return key=>threadKeyPattern.test(key)||workspaceKeyPattern.test(key)
 const threadScope=encodedThreadScope(storageScope)
 const workspaceScope=conversationWorkspaceStorageKey(storageScope).slice(copilotWorkspaceStorageNamespace.length)
 return key=>key.match(threadKeyPattern)?.[1]===threadScope||key.match(workspaceKeyPattern)?.[1]===workspaceScope
}

/** Returns a stable snapshot of Copilot-only sessionStorage keys. */
export function enumerateCopilotSessionStorageKeys(storage,options={}){
 const matches=keyMatcher(options?.storageScope)
 return storageKeys(storage).filter(matches).sort()
}

/**
 * Removes Copilot conversations and thread identifiers. With no storageScope it
 * clears every Copilot scope in the current tab, which is the safe logout mode.
 */
export function clearCopilotSessionStorage(storage,options={}){
 const targeted=enumerateCopilotSessionStorageKeys(storage,options)
 const removed=[];const failed=[]
 if(typeof storage?.removeItem!=='function')return {targeted,removed,failed:[...targeted]}
 for(const key of targeted){
  try{storage.removeItem(key);removed.push(key)}catch{failed.push(key)}
 }
 return {targeted,removed,failed}
}
