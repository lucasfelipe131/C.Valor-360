import assert from 'node:assert/strict'
import test from 'node:test'
import {
 normalizeAsyncError,
 requestJsonResource
} from '../src/hooks/useAsyncResource.js'

function namedError(name,message){const error=new Error(message);error.name=name;return error}

test('normalização distingue timeout, cancelamento e falha real',()=>{
 assert.equal(normalizeAsyncError(namedError('TimeoutError','original'),{timeoutMessage:'Tempo esgotado.'}),'Tempo esgotado.')
 assert.equal(normalizeAsyncError(namedError('AbortError','cancelado')), '')
 assert.equal(normalizeAsyncError(new Error('Falha da API.'),{fallbackMessage:'Falha padrão.'}),'Falha da API.')
 assert.equal(normalizeAsyncError({}, {fallbackMessage:'Falha padrão.'}),'Falha padrão.')
})

test('requestJsonResource transforma o aborto do relógio em TimeoutError consistente',async()=>{
 const originalFetch=globalThis.fetch
 globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>{
  const abort=()=>reject(namedError('AbortError','cancelado pelo relógio'))
  if(signal.aborted)abort()
  else signal.addEventListener('abort',abort,{once:true})
 })
 try{
  await assert.rejects(
   requestJsonResource('/api/lenta',{timeoutMs:5,timeoutMessage:'A operação demorou além do limite.'}),
   error=>error?.name==='TimeoutError'&&error?.message==='A operação demorou além do limite.'
  )
 }finally{globalThis.fetch=originalFetch}
})

test('requestJsonResource preserva resposta JSON e mensagem do backend',async()=>{
 const originalFetch=globalThis.fetch
 try{
  globalThis.fetch=async()=>({status:200,ok:true,json:async()=>({ok:true,value:42})})
  assert.deepEqual(await requestJsonResource('/api/ok',{timeoutMs:100}),{ok:true,value:42})

  globalThis.fetch=async()=>({status:422,ok:false,json:async()=>({error:'Dado inválido.'})})
  await assert.rejects(requestJsonResource('/api/erro',{timeoutMs:100}),/Dado inválido/)
 }finally{globalThis.fetch=originalFetch}
})
