import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {transformWithEsbuild} from 'vite'

// Run the actual component with a small Leaflet boundary double. The browser
// owns tile fetching and DOM layout; these checks cover our lifecycle behavior.
const source=readFileSync(new URL('../src/components/map/SatelliteMap.jsx',import.meta.url),'utf8')
 .replace(/import '[^']+\.css'\n/g,'')
 .replace("from 'react'",`from '${import.meta.resolve('react')}'`)
 .replace("from '../../lib/property-map'",`from '${new URL('../src/lib/property-map.js',import.meta.url).href}'`)
 .replace("import('leaflet')",'globalThis.__valSatelliteTestLeaflet()')
const compiled=await transformWithEsbuild(source,'SatelliteMap.jsx',{loader:'jsx',jsx:'transform'})
const {default:SatelliteMap}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

function fakeLeaflet(){
 const state={maps:[],tiles:[],group:null}
 const evented=object=>Object.assign(object,{events:{},on(name,handler){this.events[name]=handler;return this},off(){this.events={};return this},emit(name,event){this.events[name]?.(event)}})
 const layer=(kind,points,options={})=>evented({kind,points,options,addTo(target){target.layers.add(this);return this},bindTooltip(){return this}})
 const L={
  map(_node,options){
   const map=evented({options,layers:new Set(),views:[],fits:[],pans:[],currentZoom:4,
    setView(point,zoom){this.views.push({point,zoom});this.currentZoom=zoom;return this},
    fitBounds(bounds,options){this.fits.push({bounds,options});this.currentZoom=12;return this},
    panTo(point){this.pans.push(point);return this},getZoom(){return this.currentZoom},invalidateSize(){},
    hasLayer(item){return this.layers.has(item)},removeLayer(item){this.layers.delete(item)},remove(){this.removed=true;this.layers.clear()}
   });state.maps.push(map);return map
  },
  layerGroup(){const group={layers:new Set(),clearLayers(){this.layers.clear()},addTo(map){map.layers.add(this);return this}};state.group=group;return group},
  tileLayer(url,options){const tile=layer('tile',null,options);tile.url=url;state.tiles.push(tile);return tile},
  marker(point,options){
   const marker=layer('marker',point,options)
   marker.element={attributes:{},events:{},setAttribute(key,value){this.attributes[key]=value},addEventListener(key,handler){this.events[key]=handler}}
   marker.getElement=()=>marker.element;return marker
  },
  divIcon:options=>options,latLngBounds:points=>points,
  polygon:(points,options)=>layer('polygon',points,options),
  polyline:(points,options)=>layer('polyline',points,options),
  circleMarker:(point,options)=>layer('circle',point,options)
 }
 return {L,state}
}

async function mountMap(initialProps={},loader=null){
 const {L,state}=fakeLeaflet()
 const saved=globalThis.__valSatelliteTestLeaflet
 globalThis.__valSatelliteTestLeaflet=loader||(()=>Promise.resolve({default:L}))
 let renderer,props=initialProps
 await act(async()=>{renderer=TestRenderer.create(React.createElement(SatelliteMap,props),{createNodeMock:()=>({})})})
 return {
  L,state,renderer,
  layers(kind){return [...(state.group?.layers||[])].filter(layer=>layer.kind===kind)},
  button(text){return renderer.root.findAllByType('button').find(button=>button.children.join('')===text)},
  async update(changes){props={...props,...changes};await act(async()=>{renderer.update(React.createElement(SatelliteMap,props))})},
  async dispose(){await act(async()=>renderer.unmount());if(saved===undefined)delete globalThis.__valSatelliteTestLeaflet;else globalThis.__valSatelliteTestLeaflet=saved}
 }
}

const pins=[{id:'a',lat:-12.5,lng:-55.7,label:'1',title:'Primeiro produtor',tone:'visited'},{id:'b',lat:-12.6,lng:-55.8,label:'2',tone:'current'}]

test('map pins escape HTML and activate with click, Enter and Space',async()=>{
 const selected=[]
 const malicious={id:'suggested',lat:-12.7,lng:-55.9,label:'<img src=x onerror=alert(1)>',title:'Produtor sugerido',tone:'suggested'}
 const app=await mountMap({pins:[...pins,malicious],onPinClick:pin=>selected.push(pin.id),selectedId:'b'})
 try{
  const markers=app.layers('marker')
  assert.equal(markers[2].options.keyboard,true)
  assert.match(markers[2].options.icon.html,/&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.ok(!markers[2].options.icon.html.includes('<img'))
  assert.equal(markers[1].element.attributes['aria-current'],'step')
  assert.equal(markers[1].element.attributes['aria-pressed'],'true')
  assert.equal(markers[2].element.attributes.role,'button')
  let prevented=0
  markers[2].emit('click')
  for(const key of ['Enter',' '])markers[2].element.events.keydown({key,preventDefault(){prevented++},stopPropagation(){}})
  assert.deepEqual(selected,['suggested','suggested','suggested'])
  assert.equal(prevented,2)
  assert.equal(app.state.maps[0].options.keyboard,true)
  assert.equal(app.state.maps[0].options.attributionControl,true)
  assert.match(app.state.tiles[0].url,/World_Imagery/)
  assert.match(app.state.tiles[0].options.attribution,/Esri/)
 }finally{await app.dispose()}
})

test('GPS and route updates preserve manual zoom; selection pans once and fit remains explicit',async()=>{
 const app=await mountMap({pins})
 try{
  const map=app.state.maps[0]
  assert.equal(map.fits.length,1)
  map.currentZoom=18
  await app.update({pins:[...pins,{id:'gps',lat:-12.55,lng:-55.75,tone:'position'}],routes:[{kind:'recorded',points:[[-12.5,-55.7],[-12.55,-55.75]]}]})
  assert.equal(map.fits.length,1)
  assert.equal(map.views.length,1)
  assert.equal(map.currentZoom,18)
  await app.update({selectedId:'b'})
  assert.deepEqual(map.pans,[[-12.6,-55.8]])
  await app.update({pins:[pins[0],{...pins[1],lat:-12.61}]})
  assert.equal(map.pans.length,1)
  assert.equal(map.currentZoom,18)
  await act(async()=>app.button('Enquadrar').props.onClick())
  assert.equal(map.fits.length,2)
  await app.update({fit:false})
  await app.update({fit:true})
  assert.equal(map.fits.length,3)
 }finally{await app.dispose()}
})

test('recorded paths do not bridge invalid points; route kinds and legacy route stay distinct',async()=>{
 const a=[-12.5,-55.7],b=[-12.6,-55.8],c=[-12.7,-55.9],d=[-12.8,-56]
 const app=await mountMap({route:[a,b],routes:[{kind:'recorded',points:[a,b,null,c,d]},{kind:'approximate',points:[b,c]},{kind:'planned',points:[a,d],dashed:false,color:'#fff'}]})
 try{
  const lines=app.layers('polyline')
  assert.equal(lines.length,5)
  assert.deepEqual(lines[1].points,[a,b])
  assert.deepEqual(lines[2].points,[c,d])
  assert.equal(lines[1].options.dashArray,undefined)
  assert.equal(lines[0].options.color,'#00c896')
  assert.ok(lines[0].options.dashArray)
  assert.equal(lines[3].options.dashArray,'3 8')
  assert.equal(lines[4].options.dashArray,undefined)
  assert.equal(lines[4].options.color,'#fff')
 }finally{await app.dispose()}
})

test('tile errors expose retry and street fallback without resetting the viewport',async()=>{
 const app=await mountMap({pins})
 try{
  const map=app.state.maps[0],first=app.state.tiles[0]
  await act(async()=>first.emit('tileerror'))
  assert.equal(app.renderer.root.findAllByProps({role:'alert'}).length,1)
  await act(async()=>app.button('Tentar novamente').props.onClick())
  assert.equal(app.state.tiles.length,2)
  assert.equal(map.hasLayer(first),false)
  await act(async()=>app.state.tiles[1].emit('tileerror'))
  await act(async()=>app.button('Usar mapa de ruas').props.onClick())
  const street=app.state.tiles[2]
  assert.match(street.url,/tile\.openstreetmap\.org/)
  assert.match(street.options.attribution,/openstreetmap\.org\/copyright/)
  await act(async()=>street.emit('load'))
  assert.equal(app.renderer.root.findAllByProps({role:'alert'}).length,0)
  assert.equal(map.fits.length,1)
  assert.equal(map.views.length,1)
 }finally{await app.dispose()}
})

test('Leaflet import failure is visible and retry can initialize the map',async()=>{
 const logged=[],previousError=console.error
 console.error=(...args)=>logged.push(args)
 let app
 try{
  app=await mountMap({pins},()=>Promise.reject(new Error('Chunk unavailable')))
  assert.equal(app.renderer.root.findAllByProps({role:'alert'}).length,1)
  assert.ok(logged.some(args=>args[0].includes('iniciar o mapa')))
  globalThis.__valSatelliteTestLeaflet=()=>Promise.resolve({default:app.L})
  await act(async()=>app.button('Tentar novamente').props.onClick())
  assert.equal(app.state.maps.length,1)
  assert.equal(app.state.tiles.length,1)
  assert.equal(app.renderer.root.findAllByProps({role:'alert'}).length,0)
 }finally{if(app)await app.dispose();console.error=previousError}
})
