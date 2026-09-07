import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {build} from 'esbuild'
import {ValRepository} from '../server/repository.js'
import {normalizePropertyProfileInput} from '../server/property-profile.js'

const tenantId='tenant-a',ownerId='owner-a'
const makeRecord=(id,scope={})=>({tenantId,ownerId,clientId:'c1',property:{id,name:`Fazenda ${id}`,location:{lat:-12.5,lng:-55.7}},fields:[{id:`field-${id}`,name:`Talhão ${id}`,points:[],crop:'',season:''}],...scope})
function localRepository(){
 let store={imports:[{tenantId,ownerId,clients:[{id:'c1',name:'Produtor 1'},{id:'c2',name:'Produtor 2'}]}],visits:[],opportunities:[],val:{propertyProfiles:[makeRecord('p1'),makeRecord('p2'),makeRecord('foreign-owner',{ownerId:'owner-b'}),makeRecord('foreign-tenant',{tenantId:'tenant-b'}),makeRecord('foreign-client',{clientId:'c2'})]}}
 let writes=0
 const repository=new ValRepository({tenantId,db:{configured:false},readStore:()=>store,saveStore:next=>{writes++;store=structuredClone(next)}})
 return {repository,get store(){return store},get writes(){return writes}}
}

test('property selection normalizes an ID and rejects explicit invalid IDs instead of choosing the primary',()=>{
 assert.equal(normalizePropertyProfileInput({}).propertyId,undefined)
 assert.equal(normalizePropertyProfileInput({propertyId:' p2 '}).propertyId,'p2')
 for(const propertyId of ['',null,42,{},' '.repeat(4),'x'.repeat(181)])assert.throws(()=>normalizePropertyProfileInput({propertyId}),{code:'property_id_invalid'})
})

test('the selected local property is read and saved independently, preserving primary order and unrelated fields',async()=>{
 const app=localRepository(),before=structuredClone(app.store.val.propertyProfiles)
 const profile=await app.repository.getPropertyProfile('c1',ownerId,{propertyId:'p2'})
 assert.equal(profile.property.id,'p2')
 assert.deepEqual(profile.properties.map(item=>item.id),['p1','p2'])
 assert.deepEqual(profile.fields.map(item=>item.id),['field-p2'])
 const result=await app.repository.savePropertyProfile('c1',{propertyId:'p2',propertyName:'Fazenda Sul',location:null,fields:[{id:'field-p2',name:'Talhão Sul',areaHa:12}]},ownerId)
 assert.equal(result.property.id,'p2')
 assert.equal(result.property.name,'Fazenda Sul')
 assert.equal(result.property.location,null)
 assert.equal(result.fields[0].id,'field-p2')
 assert.equal(result.fields[0].name,'Talhão Sul')
 assert.equal((await app.repository.getPropertyProfile('c1',ownerId)).property.id,'p1')
 assert.deepEqual(app.store.val.propertyProfiles.filter(item=>item.property.id!=='p2'),before.filter(item=>item.property.id!=='p2'))
 assert.equal(app.writes,1)
})

test('foreign tenant, owner, client and missing local properties are refused without a write',async()=>{
 const app=localRepository(),before=structuredClone(app.store.val.propertyProfiles)
 for(const propertyId of ['foreign-owner','foreign-tenant','foreign-client','missing']){
  await assert.rejects(app.repository.getPropertyProfile('c1',ownerId,{propertyId}),{statusCode:404,code:'property_not_found'})
  await assert.rejects(app.repository.savePropertyProfile('c1',{propertyId,propertyName:'Must not replace primary',fields:[]},ownerId),{statusCode:404,code:'property_not_found'})
 }
 assert.deepEqual(app.store.val.propertyProfiles,before)
 assert.equal(app.writes,0)
})

function databaseRepository(){
 const properties=[{id:'p1',name:'Norte',metadata:{location:{lat:-12.5,lng:-55.7}}},{id:'p2',name:'Sul',metadata:{}}]
 const queries=[]
 const query=async(sql,params)=>{
  queries.push({sql,params})
  const rows=rows=>({rows,rowCount:rows.length})
  if(sql.includes('FROM clients')){
   assert.deepEqual(params,[tenantId,ownerId,'c1'])
   return rows([{id:'client-row',external_key:'c1',name:'Produtor'}])
  }
  if(sql.includes('FROM properties')){
   assert.deepEqual(params.slice(0,2),[tenantId,'client-row'])
   return rows(params.length===3&&params[2]!==null?properties.filter(item=>item.id===params[2]):properties)
  }
  if(sql.startsWith('UPDATE properties')){
   assert.deepEqual(params.slice(0,2),[tenantId,'client-row'])
   const property=properties.find(item=>item.id===params[2]);assert.ok(property)
   property.name=params[3];property.metadata=JSON.parse(params[4]);return rows([property])
  }
  if(sql.includes('FROM fields field')){
   assert.equal(params[0],tenantId)
   return rows([{id:`field-${params[1]}`,name:`Talhão ${params[1]}`}])
  }
  if(sql.startsWith('INSERT INTO audit_events'))return rows([])
  throw new Error(`Unexpected query: ${sql}`)
 }
 return {repository:new ValRepository({tenantId,db:{configured:true,query,transaction:work=>work({query})}}),properties,queries}
}

test('PostgreSQL reads and updates only the selected property within the owned client',async()=>{
 const app=databaseRepository(),primary=structuredClone(app.properties[0])
 const profile=await app.repository.getPropertyProfile('c1',ownerId,{propertyId:'p2'})
 assert.equal(profile.property.id,'p2')
 assert.deepEqual(profile.fields.map(item=>item.id),['field-p2'])
 const saved=await app.repository.savePropertyProfile('c1',{propertyId:'p2',propertyName:'Sul editada',location:{lat:-13,lng:-56}},ownerId)
 assert.equal(saved.property.id,'p2')
 assert.equal(saved.property.name,'Sul editada')
 assert.deepEqual(app.properties[0],primary)
 assert.ok(app.queries.some(item=>item.sql.includes('FOR UPDATE')&&item.sql.includes('id::text=$3')&&item.params[2]==='p2'))
})

test('PostgreSQL rejects a requested property outside its client before any mutation',async()=>{
 const app=databaseRepository()
 await assert.rejects(app.repository.getPropertyProfile('c1',ownerId,{propertyId:'foreign-property'}),{statusCode:404,code:'property_not_found'})
 await assert.rejects(app.repository.savePropertyProfile('c1',{propertyId:'foreign-property',propertyName:'Overwrite'},ownerId),{statusCode:404,code:'property_not_found'})
 assert.ok(app.queries.every(item=>!/^\s*(UPDATE|INSERT|DELETE)/.test(item.sql)))
})

// Compile the real component with a passive map; React remains shared with
// the renderer so these assertions exercise hooks, fetches and user actions.
let componentPromise
function loadPropertyFields(){
 componentPromise||=(async()=>{
  const require=createRequire(import.meta.url)
  const bundle=await build({entryPoints:['src/components/PropertyFields.jsx'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
   name:'test-map-and-shared-react',setup(builder){
    builder.onResolve({filter:/\/map\/SatelliteMap$/},()=>({path:'map',namespace:'test-map'}))
    builder.onLoad({filter:/.*/,namespace:'test-map'},()=>({contents:'export default function SatelliteMap(){return null}',loader:'js'}))
    builder.onResolve({filter:/^(react|lucide-react)$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}))
   }
  }]})
  return (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)).default
 })()
 return componentPromise
}

test('the selector confirms dirty edits, sends the selected ID when saving and ignores a stale aborted fetch',async()=>{
 const PropertyFields=await loadPropertyFields()
 const savedGlobals={fetch:globalThis.fetch,window:globalThis.window}
 const requests=[],profiles={p1:{property:{id:'p1',name:'Norte'},fields:[]},p2:{property:{id:'p2',name:'Sul'},fields:[]}}
 const payload=id=>({...profiles[id],properties:[{id:'p1',name:'Norte'},{id:'p2',name:'Sul'}]})
 let confirmResult=false,confirmCalls=0,renderer,lateResolve
 globalThis.window={confirm:()=>{confirmCalls++;return confirmResult},dispatchEvent(){}}
 globalThis.fetch=async(url,options={})=>{
  requests.push({url,options})
  if(String(url).includes('/c2/'))return new Response(JSON.stringify({property:{id:'other',name:'Outro produtor'},properties:[{id:'other',name:'Outro produtor'}],fields:[]}))
  if(String(url).includes('propertyId=p1'))return new Promise(resolve=>{lateResolve=resolve})
  const selected=String(url).includes('propertyId=p2')?'p2':'p1'
  return new Response(JSON.stringify(options.method==='PUT'?payload(JSON.parse(options.body).propertyId):payload(selected)))
 }
 try{
  await act(async()=>{renderer=TestRenderer.create(React.createElement(PropertyFields,{client:{id:'c1'}}))})
  const selector=()=>renderer.root.findByType('select')
  const name=()=>renderer.root.findAllByType('input')[0]
  await act(async()=>{name().props.onChange({target:{value:'Edição pendente'}})})
  await act(async()=>{selector().props.onChange({target:{value:'p2'}})})
  assert.equal(confirmCalls,1)
  assert.equal(name().props.value,'Edição pendente')
  assert.equal(requests.length,1)
  confirmResult=true
  await act(async()=>{selector().props.onChange({target:{value:'p2'}})})
  assert.equal(name().props.value,'Sul')
  await act(async()=>{name().props.onChange({target:{value:'Sul editada'}})})
  const save=renderer.root.findAllByType('button').find(button=>button.props.className==='is-primary')
  await act(async()=>{await save.props.onClick()})
  assert.equal(JSON.parse(requests.find(request=>request.options.method==='PUT').options.body).propertyId,'p2')
  await act(async()=>{selector().props.onChange({target:{value:'p1'}})})
  const oldRequest=requests.at(-1)
  await act(async()=>{renderer.update(React.createElement(PropertyFields,{client:{id:'c2'}}))})
  assert.equal(oldRequest.options.signal.aborted,true)
  await act(async()=>{lateResolve(new Response(JSON.stringify(payload('p1'))))})
  assert.equal(name().props.value,'Outro produtor')
 }finally{
  if(renderer)await act(async()=>renderer.unmount())
  globalThis.fetch=savedGlobals.fetch
  if(savedGlobals.window===undefined)delete globalThis.window;else globalThis.window=savedGlobals.window
 }
})

test('a failed selected-property load cannot leave an editable blank form that saves over the primary',async()=>{
 const PropertyFields=await loadPropertyFields()
 const savedFetch=globalThis.fetch
 let renderer,putCalls=0
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='PUT')putCalls++
  return String(url).includes('propertyId=')
   ?new Response(JSON.stringify({error:'Propriedade não encontrada na sua carteira.'}),{status:404})
   :new Response(JSON.stringify({property:{id:'p1',name:'Norte'},properties:[{id:'p1',name:'Norte'},{id:'p2',name:'Sul'}],fields:[]}))
 }
 try{
  await act(async()=>{renderer=TestRenderer.create(React.createElement(PropertyFields,{client:{id:'c1'}}))})
  await act(async()=>{renderer.root.findByType('select').props.onChange({target:{value:'p2'}})})
  const name=renderer.root.findAllByType('input')[0]
  assert.equal(name.props.disabled,true)
  await act(async()=>{name.props.onChange({target:{value:'Must not overwrite primary'}})})
  const save=renderer.root.findAllByType('button').find(button=>button.props.className==='is-primary')
  assert.equal(save.props.disabled,true)
  await act(async()=>{await save.props.onClick()})
  assert.equal(putCalls,0)
  assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/não encontrada/)
 }finally{
  if(renderer)await act(async()=>renderer.unmount())
  globalThis.fetch=savedFetch
 }
})
