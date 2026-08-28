import test from 'node:test'
import assert from 'node:assert/strict'
import {clearCopilotSessionStorage,copilotThreadStorageNamespace,copilotWorkspaceStorageNamespace,enumerateCopilotSessionStorageKeys} from '../src/lib/copilot-session-storage.js'
import {conversationWorkspaceStorageKey} from '../src/lib/full-screen-conversation.js'

class MemoryStorage{
 #items=new Map()
 constructor(entries=[]){for(const [key,value] of entries)this.#items.set(key,String(value))}
 get length(){return this.#items.size}
 key(index){return [...this.#items.keys()][index]??null}
 getItem(key){return this.#items.get(key)??null}
 setItem(key,value){this.#items.set(key,String(value))}
 removeItem(key){this.#items.delete(key)}
 keys(){return [...this.#items.keys()]}
}

const threadKey=(scope,thread)=>`${copilotThreadStorageNamespace}${encodeURIComponent(scope)}:${encodeURIComponent(thread)}`

test('enumera somente workspace e ids de thread do Copilot',()=>{
 const legacy='valor360:val-copilot-thread:v3:legacy-scope:global'
 const storage=new MemoryStorage([
  [conversationWorkspaceStorageKey('tenant-a:owner-a'),'workspace-a'],
  [threadKey('tenant-a:owner-a','__global__'),'conversation-global'],
  [threadKey('tenant-b:owner-b','client:2'),'conversation-b'],
  ['valor360-tech-tenant-a:draft','draft'],
  ['valor360-active-storage-scope','tenant-a:owner-a'],
  [legacy,'legacy'],
  ['valor360:val-copilot-thread:not-a-version:scope:thread','lookalike'],
  ['unrelated','keep']
 ])
 assert.deepEqual(enumerateCopilotSessionStorageKeys(storage),[
  threadKey('tenant-a:owner-a','__global__'),
  threadKey('tenant-b:owner-b','client:2'),
  conversationWorkspaceStorageKey('tenant-a:owner-a'),legacy
 ].sort())
})

test('enumeração por escopo não alcança conversa de outro login',()=>{
 const scopeA='tenant/a:owner+a'
 const scopeB='tenant/a:owner+b'
 const expected=[conversationWorkspaceStorageKey(scopeA),threadKey(scopeA,'global'),threadKey(scopeA,'client:1')].sort()
 const storage=new MemoryStorage([
  [expected[0],'a'],[expected[1],'b'],[expected[2],'c'],
  [conversationWorkspaceStorageKey(scopeB),'other'],[threadKey(scopeB,'global'),'other']
 ])
 assert.deepEqual(enumerateCopilotSessionStorageKeys(storage,{storageScope:scopeA}),expected)
})

test('limpeza de logout remove todos os escopos do Copilot e preserva outras chaves',()=>{
 const copilotKeys=[
  conversationWorkspaceStorageKey('scope-a'),threadKey('scope-a','global'),
  conversationWorkspaceStorageKey('scope-b'),threadKey('scope-b','client:2'),
  'valor360:val-full-screen:v0:legacy-scope','valor360:val-copilot-thread:v3:legacy-scope:global'
 ]
 const storage=new MemoryStorage([...copilotKeys.map(key=>[key,'secret-context']),['valor360-active-storage-scope','scope-a'],['valor360-tech-draft','draft'],['unrelated','keep']])
 const result=clearCopilotSessionStorage(storage)
 assert.deepEqual(result.targeted,[...copilotKeys].sort())
 assert.deepEqual(result.removed,[...copilotKeys].sort())
 assert.deepEqual(result.failed,[])
 assert.deepEqual(storage.keys().sort(),['unrelated','valor360-active-storage-scope','valor360-tech-draft'].sort())
})

test('limpeza é tolerante a storage indisponível e falha isolada',()=>{
 assert.deepEqual(clearCopilotSessionStorage(null),{targeted:[],removed:[],failed:[]})
 const first=`${copilotWorkspaceStorageNamespace}scope-a`
 const second=threadKey('scope-a','global')
 const storage=new MemoryStorage([[first,'a'],[second,'b']])
 const original=storage.removeItem.bind(storage)
 storage.removeItem=key=>{if(key===first)throw new Error('blocked');original(key)}
 const result=clearCopilotSessionStorage(storage)
 assert.deepEqual(result.failed,[first])
 assert.deepEqual(result.removed,[second])
 assert.equal(storage.getItem(first),'a')
 assert.equal(storage.getItem(second),null)
})
