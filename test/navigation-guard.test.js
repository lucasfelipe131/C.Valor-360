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

// NAV-04: cada formulário aberto perguntava por conta própria. Sair da aba do mapa com dois
// formulários sujos custava duas caixas — e recusar a segunda jogava fora o "sim" da primeira.
test('dois formulários sujos custam uma única caixa de confirmação',()=>{
 const previous=globalThis.window,events=new EventTarget();let accept=true,prompts=0,renderer
 globalThis.window={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),confirm:()=>{prompts++;return accept}}
 const navigate=()=>events.dispatchEvent(new Event('val:before-navigation',{cancelable:true}))
 const Dois=()=>React.createElement(React.Fragment,null,
  React.createElement(Probe,{dirty:true,busy:false}),
  React.createElement(Probe,{dirty:true,busy:false}))
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(Dois))})
  assert.equal(navigate(),true)
  assert.equal(prompts,1)
  // Recusar barra a saída na primeira caixa e ninguém mais pergunta.
  accept=false;prompts=0
  assert.equal(navigate(),false)
  assert.equal(prompts,1)
  act(()=>renderer.unmount())
 }finally{globalThis.window=previous}
})

// NAV-05: a saída barrada por gravação em andamento não pode ser silenciosa.
test('saída barrada por gravação em andamento avisa quem tocou',()=>{
 const previous=globalThis.window,events=new EventTarget();let avisos=0,renderer
 globalThis.window={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),confirm:()=>true}
 const Gravando=()=>{useNavigationGuard(false,{busy:true,onBlocked:()=>{avisos++}});return null}
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(Gravando))})
  assert.equal(events.dispatchEvent(new Event('val:before-navigation',{cancelable:true})),false)
  assert.equal(avisos,1)
  act(()=>renderer.unmount())
 }finally{globalThis.window=previous}
})

test('pergunta própria substitui o texto padrão do guarda',()=>{
 const previous=globalThis.window,events=new EventTarget();let perguntada='',renderer
 globalThis.window={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),confirm:text=>{perguntada=text;return true}}
 const Gravacao=()=>{useNavigationGuard(true,{question:'A gravação do percurso será encerrada. Sair?'});return null}
 try{
  act(()=>{renderer=TestRenderer.create(React.createElement(Gravacao))})
  events.dispatchEvent(new Event('val:before-navigation',{cancelable:true}))
  assert.equal(perguntada,'A gravação do percurso será encerrada. Sair?')
  act(()=>renderer.unmount())
 }finally{globalThis.window=previous}
})
