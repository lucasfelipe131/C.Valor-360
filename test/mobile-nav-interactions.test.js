import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'

test('real mobile nav opens the portfolio, closes sheets before chat, marks the active view and releases scrolling',async()=>{
 const directory=await mkdtemp(new URL('../.mobile-nav-test-',import.meta.url).pathname)
 const originals=new Map()
 const replace=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
 let renderer
 try{
  await build({entryPoints:['src/components/MobileNav.jsx'],outfile:directory+'/nav.js',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'})
  const MobileNav=(await import(pathToFileURL(directory+'/nav.js'))).default
  const selected=[],calls=[],listeners=new Map(),properties=new Map(),classes=new Set()
  const doc={activeElement:{focus:()=>calls.push('restore-focus')},documentElement:{style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}},body:{style:{position:'',top:'',left:'',width:'',overflow:''},classList:{add:key=>classes.add(key),remove:key=>classes.delete(key)}},addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)}
  replace('document',doc)
  replace('window',{scrollX:0,scrollY:210,scrollTo:position=>calls.push(position),matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})})
  replace('ResizeObserver',class{constructor(fn){this.fn=fn}observe(){this.fn()}disconnect(){calls.push('disconnect')}})
  const props={page:'client360',workspace:'comercial',currentUser:{role:'consultant'},onSelect:entry=>selected.push(entry),onOpenVal:()=>calls.push('open-val'),copilotActive:true}
  await act(async()=>{renderer=TestRenderer.create(React.createElement(MobileNav,props),{createNodeMock:node=>node.type==='nav'?{getBoundingClientRect:()=>({height:98})}:node.type==='section'?{querySelector:()=>({focus:()=>calls.push('focus-sheet')})}:null})})
  const button=label=>renderer.root.findAll(node=>node.type==='button'&&node.props['aria-label']===label)[0]
  const nav=()=>renderer.root.findByType('nav')
  const click=async label=>act(async()=>button(label).props.onClick())
  assert.equal(properties.get('--val-mobile-nav-height'),'98px')
  assert.equal(button('Abrir o Copiloto VAL').props['aria-current'],'page')
  await act(async()=>nav().findAllByType('button')[1].props.onClick())
  assert.deepEqual(selected,[{id:'clients',page:'clients'}])
  await click('Abrir workspaces e módulos')
  assert.equal(renderer.root.findAll(node=>node.props.role==='dialog').length,1)
  assert.equal(doc.body.style.position,'fixed');assert.ok(calls.includes('focus-sheet'))
  await click('Abrir o Copiloto VAL')
  assert.equal(renderer.root.findAll(node=>node.props.role==='dialog').length,0)
  assert.ok(calls.includes('open-val'));assert.equal(doc.body.style.position,'')
  await click('Registrar ou criar')
  assert.equal(renderer.root.findAll(node=>node.props.role==='dialog').length,1)
  await act(async()=>listeners.get('keydown')({key:'Escape'}))
  assert.equal(renderer.root.findAll(node=>node.props.role==='dialog').length,0)
  await click('Abrir workspaces e módulos')
  await act(async()=>renderer.update(React.createElement(MobileNav,{...props,page:'clients',copilotActive:false})))
  assert.equal(renderer.root.findAll(node=>node.props.role==='dialog').length,0)
  assert.equal(nav().findAllByType('button')[1].props['aria-current'],'page')
  assert.equal(button('Abrir o Copiloto VAL').props['aria-current'],undefined)
  await act(async()=>renderer.unmount());renderer=null
  assert.equal(properties.size,0);assert.equal(classes.size,0);assert.equal(listeners.size,0)
 }finally{
  if(renderer)await act(async()=>renderer.unmount())
  for(const [name,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]
  await rm(directory,{recursive:true,force:true})
 }
})
