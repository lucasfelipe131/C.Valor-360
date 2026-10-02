import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,rm} from 'node:fs/promises'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {workspaceModules} from '../src/lib/val-workspaces.js'
import {createValWorkspaceContext} from '../src/lib/val-workspace-context.js'

test('Hub UI is reachable, filters review, displays provenance and retries only eligible events',async()=>{
 const dir=await mkdtemp(new URL('../.hub-ui-test-',import.meta.url).pathname)
 let renderer;const original=globalThis.fetch,calls=[]
 try{
  await build({entryPoints:['src/pages/IntegrationHub.jsx'],outfile:`${dir}/Hub.js`,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'})
  const Hub=(await import(`${dir}/Hub.js`)).default
  const event={id:'00000000-0000-4000-8000-000000000777',externalId:'synthetic-event',eventType:'manual.record.saved',source:'manual-do-agronomo',status:'FAILED',receivedAt:'2026-09-27T12:00:00Z',clientName:'SYNTHETIC producer',attempts:1,retryEligible:true,nextRetryAt:'2026-09-27T12:01:00Z',latencyMs:4}
  const overview={connectors:[{id:'manual-do-agronomo',name:'Manual do Agrônomo',health:'DEGRADED',events:['manual.record.saved'],metrics:{processed:0,review:0,conflicts:0,rejected:0,failures:1,retries:0,latency_ms:4}}],events:[event],pagination:{hasMore:false}}
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/retry')?{status:'PROCESSED'}:url.includes('/events/')?{event,provenance:{source:event.source,sourceEvent:event.externalId,observedAt:event.receivedAt,receivedAt:event.receivedAt},audit:[{id:'audit',action:'FAILED',attempt:1,created_at:event.receivedAt}]}:overview),{status:200,headers:{'content-type':'application/json'}})}
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Hub))})
  assert.ok(workspaceModules('gestao','consultant').some(x=>x.page==='integrations'))
  assert.ok(!workspaceModules('gestao','bi_viewer').some(x=>x.page==='integrations'))
  assert.equal(createValWorkspaceContext({module:'integrations'}).current_module,'integrations')
  const output=()=>JSON.stringify(renderer.toJSON())
  assert.match(output(),/Manual do Agrônomo/);assert.match(output(),/SYNTHETIC producer/)
  await act(async()=>renderer.root.findByType('select').props.onChange({target:{value:'REVIEW_REQUIRED'}}))
  assert.ok(calls.at(-1).url.includes('status=REVIEW_REQUIRED'))
  await act(async()=>renderer.root.findAllByType('button').find(x=>x.props['aria-label']?.includes('Ver histórico')).props.onClick())
  assert.match(output(),/synthetic-event/);assert.match(output(),/Observado em/)
  await act(async()=>renderer.root.findAllByType('button').find(x=>x.children.includes('Tentar novamente')).props.onClick())
  assert.ok(calls.some(x=>x.url.endsWith('/retry')&&x.options.method==='POST'))
  assert.match(output(),/Nova tentativa: Processado/)
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'Sua sessão expirou.'}),{status:401})
  await act(async()=>renderer.root.findAllByType('button').find(x=>x.children.includes('Atualizar')).props.onClick())
  assert.match(output(),/Sua sessão expirou/)
 }finally{if(renderer)act(()=>renderer.unmount());globalThis.fetch=original;await rm(dir,{recursive:true,force:true})}
})
