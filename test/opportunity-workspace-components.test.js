import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {previewClients,previewOpportunities,previewNow} from './visual/opportunities-fixture.js'

// Component renderer only: no browser, network, storage or production fixture route.
const dir=await mkdtemp(new URL('../.opp-components-',import.meta.url).pathname)
after(()=>rm(dir,{recursive:true,force:true}))
await build({entryPoints:['src/pages/Opportunities.jsx','src/components/opportunities/OpportunityEditor.jsx'],outdir:dir,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'})
const Opportunities=(await import(pathToFileURL(dir+'/pages/Opportunities.js'))).default
const Editor=(await import(pathToFileURL(dir+'/components/opportunities/OpportunityEditor.js'))).default
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join(' ')
const props={clients:previewClients,persistedItems:previewOpportunities,nowOverride:previewNow,currentUser:{id:'preview-owner'},storageScope:'preview'}
const cardButtons=root=>root.findAll(x=>x.type==='button'&&String(x.props['aria-label']).startsWith('Selecionar '))
const byLabel=(root,label)=>root.find(x=>x.type==='button'&&text(x)===label)

test('seleção e filtro trocam contexto canônico e limpam produtor invisível',async()=>{
 const contexts=[];let renderer
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Opportunities,{...props,onContextChange:value=>contexts.push(value)}))})
 try{
  assert.equal(cardButtons(renderer.root).length,6)
  assert.equal(contexts.at(-1),null)
  await act(async()=>cardButtons(renderer.root)[0].props.onClick())
  const first=contexts.at(-1);assert.ok(first.clientId)
  await act(async()=>cardButtons(renderer.root)[4].props.onClick())
  assert.notEqual(contexts.at(-1).clientId,first.clientId)
  await act(async()=>renderer.root.findByProps({'aria-label':'Buscar produtor ou oportunidade'}).props.onChange({target:{value:'não existe'}}))
  assert.equal(cardButtons(renderer.root).length,0);assert.equal(contexts.at(-1),null)
 }finally{await act(async()=>renderer.unmount())}
})
test('Quadro e Lista usam filtros iguais e abrir simulador não grava registros',async()=>{
 let renderer,writes=0
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Opportunities,{...props,onPersist:()=>{writes++}}))})
 try{
  await act(async()=>byLabel(renderer.root,'Grãos').props.onClick())
  assert.equal(cardButtons(renderer.root).length,1)
  const title=cardButtons(renderer.root)[0].props['aria-label']
  await act(async()=>byLabel(renderer.root,'Lista').props.onClick())
  assert.equal(cardButtons(renderer.root).length,1);assert.equal(cardButtons(renderer.root)[0].props['aria-label'],title)
  const fields=renderer.root.findAll(x=>x.type==='input'&&x.props.type==='number')
  assert.deepEqual(fields.map(x=>x.props.value),['','',''])
  await act(async()=>fields[0].props.onChange({target:{value:'100'}}))
  assert.equal(writes,0)
 }finally{await act(async()=>renderer.unmount())}
})
test('falha e retry mantêm campos e mutationId; duplo submit só faz uma gravação',async()=>{
 const previousDocument=globalThis.document
 globalThis.document={activeElement:{focus(){}}}
 let renderer,closed=0,resolveSave,calls=[]
 const onSave=input=>{calls.push(input);return new Promise((resolve,reject)=>{resolveSave={resolve,reject}})}
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Editor,{clients:previewClients,onSave,onClose:()=>closed++}),{createNodeMock:element=>element.type==='dialog'?{showModal(){}}:null})})
 try{
  const title=renderer.root.findAll(x=>x.type==='input'&&x.props.maxLength===220)[0]
  await act(async()=>title.props.onChange({target:{value:'Conservar após erro'}}))
  let first,duplicate
  await act(async()=>{const submit=renderer.root.findByType('form').props.onSubmit;first=submit({preventDefault(){}});duplicate=submit({preventDefault(){}})})
  assert.equal(calls.length,1)
  await act(async()=>{resolveSave.reject(new Error('Sem conexão'));await first;await duplicate})
  assert.equal(closed,0);assert.equal(title.props.value,'Conservar após erro')
  assert.match(text(renderer.root.findByProps({role:'alert'})),/Sem conexão/)
  let retry
  await act(async()=>{retry=renderer.root.findByType('form').props.onSubmit({preventDefault(){}})})
  assert.equal(calls.length,2);assert.equal(calls[0].mutationId,calls[1].mutationId);assert.equal(calls[1].value,null)
  await act(async()=>{resolveSave.resolve({clientId:'preview-A'});await retry})
  assert.equal(closed,1)
 }finally{await act(async()=>renderer.unmount());globalThis.document=previousDocument}
})

test('preparing an opportunity uses the persistent host without mounting a second conversation',async()=>{
 let renderer;const asks=[]
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Opportunities,{...props,onAsk:value=>asks.push(value)}))})
 try{
  await act(async()=>cardButtons(renderer.root)[0].props.onClick())
  await act(async()=>byLabel(renderer.root,'Preparar conversa').props.onClick())
  assert.equal(asks.length,1);assert.equal(asks[0].clientId,asks[0].client.id)
  assert.equal(asks[0].context.type,'opportunity');assert.equal(asks[0].persistenceMode,'NONE')
  assert.equal(renderer.root.findAll(node=>typeof node.type==='function'&&node.type.name==='GlobalValCopilot').length,0)
 }finally{await act(async()=>renderer.unmount())}
})
