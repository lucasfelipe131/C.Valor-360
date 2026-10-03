import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'

test('territorial panel 100 properties/500 fields: filter, field selection, layers, offline and scope reset',async()=>{
 const dir=await mkdtemp(new URL('../.agro-ui-',import.meta.url).pathname),oldFetch=globalThis.fetch,oldWindow=globalThis.window,nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),events={}
 const geometry={type:'Polygon',coordinates:[[[-50,-20],[-49.999,-20],[-49.999,-19.999],[-50,-20]]]}
 const properties=Array.from({length:100},(_,i)=>({id:`p${i}`,name:`Synthetic ${i}`,fields:Array.from({length:5},(_,j)=>({id:`f${i}-${j}`,name:`Field ${j}`,season:'2026/27',crop:'soja',geometry,status:'VALID'}))}))
 const result={enabled:true,territories:[{producer:{id:'c',name:'Synthetic'},properties,unlinked:[]}],cards:[]}
 let renderer
 try{
  globalThis.window={addEventListener:(key,fn)=>{events[key]=fn},removeEventListener:key=>delete events[key]}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}})
  globalThis.fetch=async()=>new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}})
  await build({entryPoints:['src/components/AgroTerritoryPanel.jsx'],outfile:`${dir}/panel.js`,bundle:true,platform:'node',format:'esm',packages:'external',external:['react'],loader:{'.css':'empty'},plugins:[{name:'map-boundary',setup(b){b.onResolve({filter:/\/SatelliteMap$/},()=>({path:'map',namespace:'map-test'}));b.onLoad({filter:/.*/,namespace:'map-test'},()=>({contents:"import React from 'react';export default p=>React.createElement('map-test',p);",loader:'js'}))}}],logLevel:'silent'})
  const Panel=(await import(`${dir}/panel.js`)).default,start=performance.now()
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Panel,{scope:'owner-a',map:true}))})
  assert.equal(renderer.root.findByType('map-test').props.polygons.length,500)
  assert.ok(performance.now()-start<3000)
  await act(async()=>renderer.root.findAllByType('select')[0].props.onChange({target:{value:'p10'}}))
  assert.equal(renderer.root.findByType('map-test').props.polygons.length,5)
  await act(async()=>renderer.root.findByType('map-test').props.polygons[0].onClick())
  assert.equal(renderer.root.findByType('map-test').props.polygons.length,1)
  await act(async()=>renderer.root.findAllByType('input')[1].props.onChange({target:{checked:false}}))
  assert.equal(renderer.root.findAllByType('map-test').length,0)
  navigator.onLine=false;await act(async()=>events.offline())
  assert.match(JSON.stringify(renderer.toJSON()),/STALE_CACHE/)
  globalThis.fetch=()=>new Promise(()=>{})
  await act(async()=>renderer.update(React.createElement(Panel,{scope:'owner-b',map:true})))
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/Synthetic 10/)
  assert.match(JSON.stringify(renderer.toJSON()),/OFFLINE/)
  const css=await readFile(new URL('../src/components/AgroTerritoryPanel.css',import.meta.url),'utf8')
  assert.match(css,/safe-area-inset-bottom/);assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:600px\)/)
 }finally{act(()=>renderer?.unmount());globalThis.fetch=oldFetch;globalThis.window=oldWindow;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;await rm(dir,{recursive:true,force:true})}
})
