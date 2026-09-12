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
 .replace("import CadastralLayers from './CadastralLayers'",'const CadastralLayers=()=>null')
 .replace("from 'lucide-react'",`from '${import.meta.resolve('lucide-react')}'`)
 .replace("from 'react'",`from '${import.meta.resolve('react')}'`)
 .replace("from '../../lib/property-map'",`from '${new URL('../src/lib/property-map.js',import.meta.url).href}'`)
 .replace("from '../../lib/map-localities'",`from '${new URL('../src/lib/map-localities.js',import.meta.url).href}'`)
 .replace("from '../../lib/cadastral-viewport'",`from '${new URL('../src/lib/cadastral-viewport.js',import.meta.url).href}'`)
 .replace("from '../../lib/cadastral-map'",`from '${new URL('../src/lib/cadastral-map.js',import.meta.url).href}'`)
 .replace("import('leaflet')",'globalThis.__valSatelliteTestLeaflet()')
const compiled=await transformWithEsbuild(source,'SatelliteMap.jsx',{loader:'jsx',jsx:'transform'})
const {default:SatelliteMap}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

function fakeLeaflet(){
 const state={maps:[],tiles:[],group:null}
 const evented=object=>Object.assign(object,{events:{},on(name,handler){this.events[name]=handler;return this},off(){this.events={};return this},emit(name,event){this.events[name]?.(event)}})
 const layer=(kind,points,options={})=>evented({kind,points,options,addTo(target){target.layers.add(this);return this},bindTooltip(content,options){this.tooltip={content,options};return this},setLatLng(point){this.points=point;return this},getLatLng(){return {lat:this.points[0],lng:this.points[1]}},setLatLngs(points){this.points=points;return this}})
 const L={
  map(_node,options){
   const map=evented({options,layers:new Set(),views:[],fits:[],pans:[],currentZoom:4,center:{lat:-28,lng:-54},
    getCenter(){return this.center},getBounds(){return {getWest:()=>-54.1,getSouth:()=>-28.1,getEast:()=>-53.9,getNorth:()=>-27.9}},
    setView(point,zoom){this.views.push({point,zoom});this.currentZoom=zoom;return this},
    fitBounds(bounds,options){this.fits.push({bounds,options});this.currentZoom=12;return this},
    panTo(point){this.pans.push(point);return this},getZoom(){return this.currentZoom},invalidateSize(){},
    hasLayer(item){return this.layers.has(item)},removeLayer(item){this.layers.delete(item)},remove(){this.removed=true;this.layers.clear()}
   });state.maps.push(map);return map
  },
  layerGroup(){const group={layers:new Set(),clearLayers(){this.layers.clear()},removeLayer(layer){this.layers.delete(layer)},addTo(map){map.layers.add(this);return this}};state.group=group;return group},
  tileLayer(url,options){const tile=layer('tile',null,options);tile.url=url;state.tiles.push(tile);return tile},
  marker(point,options){
   const marker=layer('marker',point,options)
   marker.element={attributes:{},events:{},setAttribute(key,value){this.attributes[key]=value},addEventListener(key,handler){this.events[key]=handler}}
   marker.getElement=()=>marker.element;return marker
  },
  geoJSON:(features,options)=>({...layer('states',features,options),getBounds:()=>[[-34,-74],[6,-34]]}),
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
  vertices(){return [...(state.group?.layers||[])].filter(layer=>layer.options.icon?.className==='val-map-vertex')},
  midpoints(){return [...(state.group?.layers||[])].filter(layer=>layer.options.icon?.className==='val-map-midpoint')},
  button(text){const label=node=>typeof node==='string'?node:(node.children||[]).map(label).join('');return renderer.root.findAllByType('button').find(button=>label(button)===text)},
  async update(changes){props={...props,...changes};await act(async()=>{renderer.update(React.createElement(SatelliteMap,props))})},
  async dispose(){await act(async()=>renderer.unmount());if(saved===undefined)delete globalThis.__valSatelliteTestLeaflet;else globalThis.__valSatelliteTestLeaflet=saved}
 }
}

const pins=[{id:'a',lat:-12.5,lng:-55.7,label:'1',title:'Primeiro produtor',tone:'visited'},{id:'b',lat:-12.6,lng:-55.8,label:'2',tone:'current'}]

test('permanent property captions escape producer and property names',async()=>{
 const app=await mountMap({pins:[{id:'property:a',lat:-28,lng:-54,caption:'Produtor <img src=x> · Sede & Fazenda'}]})
 try{
  const marker=app.layers('marker')[0]
  assert.equal(marker.tooltip.options.permanent,true)
  assert.equal(marker.tooltip.content,'Produtor &lt;img src=x&gt; · Sede &amp; Fazenda')
 }finally{await app.dispose()}
})

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


test('municipality navigation loads state boundaries by default and never assigns a producer location',async()=>{
 const originalFetch=globalThis.fetch
 const cities=JSON.parse(readFileSync(new URL('../public/geo/municipalities.json',import.meta.url),'utf8'))
 const geo=JSON.parse(readFileSync(new URL('../public/geo/states.geojson',import.meta.url),'utf8'))
 globalThis.fetch=async url=>({ok:true,json:async()=>url.includes('/boundary')?{code:'4318903',geojson:{type:'FeatureCollection',features:[geo.features[0]]}}:url.endsWith('states.geojson')?geo:cities})
 let app;const assigned=[]
 try{
  app=await mountMap({onClick:point=>assigned.push(point)})
  const map=app.state.maps[0]
  assert.equal([...map.layers].filter(l=>l.kind==='states').length,1)
  const search=()=>app.renderer.root.findByProps({'aria-label':'Buscar município no mapa'})
  assert.equal(search().props.disabled,false)
  await act(async()=>search().props.onChange({target:{value:'sao luiz gonzaga'}}))
  await act(async()=>search().props.onKeyDown({key:'Enter',preventDefault(){}}))
  const city=cities.find(row=>row[1]==='São Luiz Gonzaga'&&row[2]==='RS')
  assert.deepEqual(map.fits.at(-1).bounds,[[city[3][0],city[3][1]],[city[3][2],city[3][3]]])
  assert.deepEqual(assigned,[])
  assert.equal(app.layers('marker').length,0)
  assert.equal([...map.layers].filter(l=>l.kind==='states').length,2)
  await act(async()=>app.button('Divisas').props.onClick())
  const toggles=app.renderer.root.findAllByProps({type:'checkbox'})
  await act(async()=>toggles[0].props.onChange({target:{checked:false}}))
  assert.equal([...map.layers].filter(l=>l.kind==='states').length,1)
  await act(async()=>toggles[1].props.onChange({target:{checked:false}}))
  assert.equal([...map.layers].filter(l=>l.kind==='states').length,0)
 }finally{if(app)await app.dispose();globalThis.fetch=originalFetch}
})


test('touching a draft vertex removes that point without adding a new map point',async()=>{
 const removed=[],added=[]
 const app=await mountMap({draft:[{lat:-12,lng:-55},{lat:-12.01,lng:-55},{lat:-12,lng:-55.01}],onDraftPointClick:index=>removed.push(index),onClick:point=>added.push(point)})
 try{const vertices=app.vertices();assert.equal(vertices.length,3);assert.equal(vertices[1].options.bubblingMouseEvents,false);vertices[1].emit('click');assert.deepEqual(removed,[1]);assert.deepEqual(added,[])}finally{await app.dispose()}
})

test('drawing keeps existing parcels, pins and vertices alive and updates shapes in place',async()=>{
 const initial=[{lat:-12,lng:-55},{lat:-12.01,lng:-55},{lat:-12.01,lng:-55.01}]
 const app=await mountMap({pins,draft:initial,polygons:[{points:initial}],fit:false})
 try{
  const marker=app.layers('marker')[0],parcel=app.layers('polygon')[0],vertices=app.vertices(),line=app.layers('polyline')[0]
  for(let i=1;i<=20;i++)await app.update({draft:[...initial,...Array.from({length:i},(_,n)=>({lat:-12.005+n*.00001,lng:-55.01}))]})
  assert.equal(app.layers('marker')[0],marker);assert.equal(app.layers('polygon')[0],parcel)
  assert.equal(app.vertices()[0],vertices[0]);assert.equal(app.vertices()[2],vertices[2]);assert.equal(app.layers('polyline')[0],line)
  assert.equal(app.vertices().length,23)
  await app.update({draft:[initial[0],initial[2]]})
  assert.equal(app.vertices().length,2);assert.deepEqual(app.vertices()[1].points,[-12.01,-55.01])
  assert.equal(app.layers('polygon').length,1);assert.equal(app.layers('polygon')[0],parcel)
  assert.equal(app.state.maps[0].options.preferCanvas,true)
  assert.equal(app.state.tiles[0].options.updateWhenIdle,true)
 }finally{await app.dispose()}
})

test('drag updates the contour in place, commits once on release, and midpoint inserts on its own edge',async()=>{
 const initial=[{lat:-12,lng:-55},{lat:-12.01,lng:-55},{lat:-12.01,lng:-55.01}],moves=[],removed=[],inserted=[]
 const app=await mountMap({draft:initial,onDraftPointMove:(...args)=>moves.push(args),onDraftPointClick:i=>removed.push(i),onDraftPointInsert:(...args)=>inserted.push(args)})
 try{
  const vertex=app.vertices()[1],line=app.layers('polyline')[0],area=app.layers('polygon')[0],middle=app.midpoints()[0]
  assert.equal(vertex.options.draggable,true);assert.equal(app.midpoints().length,3)
  vertex.emit('dragstart');vertex.setLatLng([-12.0051234,-54.9991234]);vertex.emit('drag')
  assert.deepEqual(moves,[]);assert.equal(app.layers('polyline')[0],line);assert.equal(app.layers('polygon')[0],area)
  assert.deepEqual(line.points[1],[-12.0051234,-54.9991234]);assert.deepEqual(area.points[1],line.points[1])
  assert.deepEqual(middle.points,[(-12-12.0051234)/2,(-55-54.9991234)/2])
  vertex.emit('dragend');vertex.emit('click');assert.deepEqual(removed,[])
  assert.deepEqual(moves,[[1,{lat:-12.005123,lng:-54.999123}]])
  await app.update({draft:initial.map((p,i)=>i===1?moves[0][1]:p)})
  assert.equal(app.vertices()[1],vertex);assert.equal(app.midpoints()[0],middle)
  middle.emit('click');assert.deepEqual(inserted,[[0,{lat:middle.points[0],lng:middle.points[1]}]])
  vertex.element.events.keydown({key:'Delete',preventDefault(){},stopPropagation(){}});assert.deepEqual(removed,[1])
  assert.deepEqual(initial[1],{lat:-12.01,lng:-55})
 }finally{await app.dispose()}
})
