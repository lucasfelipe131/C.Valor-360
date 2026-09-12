import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {useNavigationGuard} from '../src/lib/use-navigation-guard.js'
const Probe=props=>{useNavigationGuard(props.dirty,{busy:props.busy,label:'mapeamento'});return null}
test('unsaved form can cancel navigation; save in flight blocks it; cleanup releases navigation',()=>{
 const previous=globalThis.window,events=new EventTarget();let accept=false,prompts=0,renderer
 globalThis.window={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),confirm:()=>{prompts++;return accept}}
 const navigate=()=>events.dispatchEvent(new Event('val:before-navigation',{cancelable:true}))
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(Probe,{dirty:true,busy:false}))})
  assert.equal(navigate(),false);assert.equal(prompts,1)
  accept=true;assert.equal(navigate(),true)
  act(()=>renderer.update(React.createElement(Probe,{dirty:true,busy:true})))
  assert.equal(navigate(),false);assert.equal(prompts,2)
  act(()=>renderer.update(React.createElement(Probe,{dirty:false,busy:false})))
  assert.equal(navigate(),true)
  act(()=>renderer.unmount());assert.equal(navigate(),true)
 }finally{globalThis.window=previous}
})
