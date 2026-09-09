import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {transformWithEsbuild} from 'vite'

async function component(path,{mapStub=false}={}){
 let source=readFileSync(new URL(path,import.meta.url),'utf8')
 if(mapStub)source=source.replace("import SatelliteMap from './map/SatelliteMap'","const SatelliteMap=props=>React.createElement('map-test',props,props.editorTools,props.footerTools)")
 source=source.replace(/from '([^']+)'/g,(_match,specifier)=>`from '${specifier.startsWith('.')?new URL(specifier+'.js',new URL(path,import.meta.url)).href:import.meta.resolve(specifier)}'`)
 source=source.replace("import('../../lib/cadastral-import')",`import('${new URL('../src/lib/cadastral-import.js',import.meta.url).href}')`)
 const compiled=await transformWithEsbuild(source,path,{loader:'jsx',jsx:'transform'})
 return (await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)).default
}
const CadastralLayers=await component('../src/components/map/CadastralLayers.jsx')
const PropertyFields=await component('../src/components/PropertyFields.jsx',{mapStub:true})
const label=node=>typeof node==='string'?node:(node.children||[]).map(label).join('')
const button=(app,text)=>app.root.findAllByType('button').find(node=>label(node)===text)
const points=[{lat:-28,lng:-54},{lat:-28,lng:-53.99},{lat:-27.99,lng:-53.99},{lat:-27.99,lng:-54}]
const car=`<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>CAR de teste</name><ExtendedData><Data name="matricula"><value>0009</value></Data><Data name="ownerName"><value>Titular de teste</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>${[...points,points[0]].map(p=>`${p.lng},${p.lat}`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`

test('KML upload previews and focuses a parcel without saving; adoption is an explicit separate action',async()=>{
 const oldFetch=globalThis.fetch;const requests=[],focus=[],used=[],changes=[]
 globalThis.fetch=async(...args)=>{requests.push(args);throw new Error('No network needed for local import')}
 let app
 try{
  await act(async()=>{app=TestRenderer.create(React.createElement(CadastralLayers,{panelOnly:true,onChange:value=>changes.push(value),onFocusReference:value=>focus.push(value),onUseReference:(...args)=>used.push(args)}))})
  const input=app.root.findByProps({type:'file'});assert.match(input.props.accept,/\.kml/)
  await act(async()=>input.props.onChange({target:{files:[{name:'car.kml',size:car.length,text:async()=>car}],value:'car.kml'}}))
  assert.equal(focus.length,1);assert.equal(used.length,0);assert.equal(requests.length,0)
  const reference=app.root.findAllByType('button').find(node=>label(node).includes('Titular: Titular de teste'))
  assert.ok(reference);await act(async()=>reference.props.onClick())
  assert.ok(button(app,'Usar contorno no talhão'));assert.equal(used.length,0)
  await act(async()=>button(app,'Usar contorno no talhão').props.onClick())
  assert.equal(used.length,1);assert.equal(used[0][1],'contour');assert.deepEqual(used[0][0].points,points)
  assert.equal(requests.length,0);assert.equal(changes.at(-1)[0].name,'car.kml')
  await act(async()=>app.root.findByProps({'aria-label':'Remover camada car.kml'}).props.onClick())
  assert.equal(changes.at(-1).length,0)
 }finally{if(app)await act(async()=>app.unmount());globalThis.fetch=oldFetch}
})

test('imported field requires culture, remains a draft until save, and producer switch resets the reference scope',async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;const writes=[]
 globalThis.window={confirm:()=>true,dispatchEvent:()=>{}}
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='PUT'){const body=JSON.parse(options.body);writes.push({url,body});return {ok:true,json:async()=>({property:{id:'p1',name:'Teste'},fields:body.fields,properties:[]})}}
  return {ok:true,json:async()=>({property:{id:'p1',name:'Teste'},fields:[],properties:[]})}
 }
 let app
 try{
  await act(async()=>{app=TestRenderer.create(React.createElement(PropertyFields,{client:{id:'a'}}))})
  const map=()=>app.root.findByType('map-test')
  assert.equal(map().props.clientId,'a')
  await act(async()=>map().props.onUseReference({points,source:'car.kml'},'contour'))
  assert.deepEqual(map().props.draft,points);assert.equal(writes.length,0)
  await act(async()=>button(app,'Concluir talhão').props.onClick())
  assert.match(label(app.toJSON()),/Escolha a cultura/);assert.equal(map().props.draft.length,4)
  const culture=app.root.findAllByType('select').find(node=>node.props.value===''&&node.children.some(option=>label(option)==='Selecionar'))
  await act(async()=>culture.props.onChange({target:{value:'Soja'}}))
  await act(async()=>button(app,'Concluir talhão').props.onClick())
  assert.equal(map().props.draft.length,0);assert.equal(writes.length,0)
  await act(async()=>button(app,'Salvar mapeamento').props.onClick())
  assert.equal(writes.length,1);assert.equal(writes[0].body.fields[0].season,'2627V');assert.equal(writes[0].body.fields[0].crop,'Soja')
  assert.equal(writes[0].body.fields[0].productivityTarget,null)
  assert.ok(!JSON.stringify(writes[0].body).includes('Titular'));assert.ok(!JSON.stringify(writes[0].body).includes('car.kml'))
  await act(async()=>app.update(React.createElement(PropertyFields,{client:{id:'b'}})))
  assert.equal(map().props.clientId,'b');assert.equal(map().props.draft.length,0);assert.equal(map().props.polygons.length,0)
 }finally{if(app)await act(async()=>app.unmount());globalThis.fetch=oldFetch;globalThis.window=oldWindow}
})

test('late registry lookup cannot attach a previous producer holder after switching scope',async()=>{
 const oldFetch=globalThis.fetch;const requests=[],changes=[]
 globalThis.fetch=url=>new Promise(resolve=>requests.push({url,resolve}))
 const props={panelOnly:true,onChange:value=>changes.push(value)};let app
 try{
  await act(async()=>{app=TestRenderer.create(React.createElement(CadastralLayers,{...props,clientId:'a'}))})
  await act(async()=>app.update(React.createElement(CadastralLayers,{...props,clientId:'b'})))
  assert.match(requests[0].url,/clientId=a/);assert.match(requests[1].url,/clientId=b/)
  await act(async()=>requests[1].resolve({ok:true,json:async()=>({registrations:[{number:'B',ownerName:'Titular B',points}]})}))
  await act(async()=>requests[0].resolve({ok:true,json:async()=>({registrations:[{number:'A',ownerName:'Titular A',points}]})}))
  assert.match(JSON.stringify(changes.at(-1)),/Titular B/);assert.doesNotMatch(JSON.stringify(changes.at(-1)),/Titular A/)
 }finally{if(app)await act(async()=>app.unmount());globalThis.fetch=oldFetch}
})
