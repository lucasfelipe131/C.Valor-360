import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {buildNextBestAction} from '../server/decision-intelligence.js'

const fixture=id=>({...buildNextBestAction({client:{id,name:`SYNTHETIC ${id}`},opportunities:[{id:`op-${id}`,title:'Confirmar condição',stage:'Negociação',estimated_value:1000,next_action:'Confirmar prazo',next_action_at:'2026-10-04T12:00:00Z',updated_at:'2026-10-01T12:00:00Z'}]},{now:Date.parse('2026-10-02T12:00:00Z')}),id:`card-${id}`,revision:1})
const json=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}})
async function component(path,run){
 const dir=await mkdtemp(new URL('../.decision-ui-',import.meta.url).pathname),fetch=globalThis.fetch
 try{await build({entryPoints:[path],outfile:`${dir}/module.js`,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'});await run(await import(`${dir}/module.js`))}
 finally{globalThis.fetch=fetch;await rm(dir,{recursive:true,force:true})}
}
const button=(renderer,label)=>renderer.root.findAllByType('button').find(x=>x.children.join('')===label)

test('NBA Home contract renders at most five priorities with action, deadline, value and confidence',async()=>{
 await component('src/components/DecisionPanel.jsx',async({default:Panel})=>{
  const cards=Array.from({length:7},(_,i)=>fixture(String(i)));globalThis.fetch=async()=>json({enabled:true,flags:{decision_cards:true},cards,items:cards})
  let renderer;try{await act(async()=>{renderer=TestRenderer.create(React.createElement(Panel,{scope:'owner-a'}))})
   assert.equal(renderer.root.findAllByType('article').length,5)
   const output=JSON.stringify(renderer.toJSON());assert.match(output,/Confirmar/);assert.match(output,/Confiança/);assert.match(output,/1.000/)
   assert.equal(renderer.root.findAllByType('details').length,5)
  }finally{act(()=>renderer?.unmount())}
 })
})
test('NBA switching producer clears previous content immediately and aborts stale requests',async()=>{
 await component('src/components/DecisionPanel.jsx',async({default:Panel})=>{
  const requests=[];globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))
  let renderer;try{
   await act(async()=>{renderer=TestRenderer.create(React.createElement(Panel,{scope:'owner-a',clientId:'a'}))})
   await act(async()=>requests[0].resolve(json({enabled:true,flags:{decision_cards:true},cards:[fixture('a')]})))
   assert.match(JSON.stringify(renderer.toJSON()),/SYNTHETIC a/)
   await act(async()=>renderer.update(React.createElement(Panel,{scope:'owner-b',clientId:'b'})))
   assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/SYNTHETIC a/)
   assert.equal(requests[0].options.signal.aborted,true)
   assert.equal(requests[1].url,'/api/decisions?clientId=b')
   await act(async()=>requests[1].resolve(json({enabled:true,flags:{decision_cards:true},cards:[fixture('b')]})))
   assert.match(JSON.stringify(renderer.toJSON()),/SYNTHETIC b/)
  }finally{act(()=>renderer?.unmount())}
 })
})
test('NBA feedback requires a separate confirmation and only posts the decision feedback endpoint',async()=>{
 await component('src/components/DecisionPanel.jsx',async({DecisionCard})=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return json({saved:true})}
  let renderer;try{
   await act(async()=>{renderer=TestRenderer.create(React.createElement(DecisionCard,{card:fixture('a')}))})
   await act(async()=>button(renderer,'Ação executada').props.onClick())
   assert.equal(calls.length,0);assert.match(JSON.stringify(renderer.toJSON()),/Confirmar registro/)
   await act(async()=>button(renderer,'Confirmar registro').props.onClick())
   assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/decisions/cards/card-a/feedback')
   assert.equal(JSON.parse(calls[0].options.body).feedback,'ACTION_EXECUTED')
   assert.ok(JSON.parse(calls[0].options.body).requestId)
   assert.match(JSON.stringify(renderer.toJSON()),/Feedback registrado/)
  }finally{act(()=>renderer?.unmount())}
 })
})
test('NBA review UI requires a reason and preserves evidence; nonadmin flags are read-only',async()=>{
 await component('src/components/DecisionGovernance.jsx',async({default:Governance})=>{
  const calls=[];const item={id:'review',card_id:'card-a',producer:{name:'SYNTHETIC a'},status:'PENDING',reasons:['LOW_CONFIDENCE']}
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return json(url.endsWith('/registry')?{revision:0,flags:{nba_v1:true},policy_version:'v1',mutable:false,history:[],registry:{prompts:[],models:[],policies:[]}}:url.endsWith('/reviews')?{items:[item]}:url.endsWith('/review')?{saved:true}:{card:fixture('a')})}
  let renderer;try{
   await act(async()=>{renderer=TestRenderer.create(React.createElement(Governance))})
   assert.equal(renderer.root.findByType('input').props.disabled,true)
   await act(async()=>renderer.root.findAllByType('button').find(x=>x.children.join('').includes('PENDING')).props.onClick())
   assert.equal(button(renderer,'Confirmar revisão').props.disabled,true)
   await act(async()=>renderer.root.findByType('textarea').props.onChange({target:{value:'SYNTHETIC review'}}))
   await act(async()=>button(renderer,'Confirmar revisão').props.onClick())
   const mutation=calls.find(c=>c.options.method==='POST');assert.equal(mutation.url,'/api/decisions/cards/card-a/review')
   assert.equal(JSON.parse(mutation.options.body).reason,'SYNTHETIC review')
  }finally{act(()=>renderer?.unmount())}
 })
})
test('NBA disabled cards are hidden and visits route through the existing preparation callback',async()=>{
 await component('src/components/DecisionPanel.jsx',async({default:Panel,DecisionCard})=>{
  globalThis.fetch=async()=>json({enabled:false,flags:{decision_cards:false},cards:[],items:[]})
  let renderer;try{
   await act(async()=>{renderer=TestRenderer.create(React.createElement(Panel))})
   assert.equal(renderer.toJSON(),null)
   let selection=null;const card={...fixture('a'),decision_type:'PREPARAR_VISITA',visit_id:'existing-visit'}
   await act(async()=>renderer.update(React.createElement(DecisionCard,{card,onPrepare:(id,card)=>{selection=[id,card.visit_id]}})))
   await act(async()=>button(renderer,'Preparar visita').props.onClick())
   assert.deepEqual(selection,['a','existing-visit'])
  }finally{act(()=>renderer?.unmount())}
 })
})
test('NBA UI integration uses one component in Home, Client360, opportunities and visits with mobile expansion',async()=>{
 for(const path of ['Dashboard','Client360','Opportunities','Visits'])assert.match(await readFile(new URL(`../src/pages/${path}.jsx`,import.meta.url),'utf8'),/<DecisionPanel/)
 assert.match(await readFile(new URL('../src/pages/Management.jsx',import.meta.url),'utf8'),/<ManagementDecisions/)
 assert.match(await readFile(new URL('../src/pages/IntegrationHub.jsx',import.meta.url),'utf8'),/<DecisionGovernance/)
 const css=await readFile(new URL('../src/components/DecisionPanel.css',import.meta.url),'utf8')
 assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/min-height:42px/);assert.match(css,/overflow-wrap:anywhere/)
})
