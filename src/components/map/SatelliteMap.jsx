import React,{useEffect,useRef,useState} from 'react'
import 'leaflet/dist/leaflet.css'
import '../../val-property-map.css'
import {BRAZIL_VIEW,SATELLITE_TILES,validLocation} from '../../lib/property-map'

// Mapa de satélite da VAL. O Leaflet entra sob demanda (import dinâmico) para
// não pesar o bundle de quem nunca abre um mapa. Pinos são divIcon — nada de
// depender dos PNGs padrão do Leaflet, que somem em bundlers.

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const STREET_TILES={url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}
const PIN_TONES={visited:'Visita realizada',current:'Visita atual',planned:'Visita planejada',suggested:'Produtor sugerido',position:'Sua posição',missing:'Sem localização'}
const routePoint=value=>validLocation(Array.isArray(value)?{lat:value[0],lng:value[1]}:value)

export default function SatelliteMap({
 center=null,zoom=15,pins=[],polygons=[],route=[],routes=[],draft=[],fit=true,onClick,onPinClick,selectedId=null,
 height=280,className='',label='Mapa de satélite',interactive=true,controls=true
}){
 const shell=useRef(null)
 const container=useRef(null)
 const mapRef=useRef(null)
 const leafletRef=useRef(null)
 const layersRef=useRef(null)
 const clickRef=useRef(onClick)
 const pinClickRef=useRef(onPinClick)
 const renderRef=useRef(()=>{})
 const fitRef=useRef(()=>{})
 const initialFitRef=useRef(false)
 const previousFitRef=useRef(fit)
 const selectionRef=useRef(null)
 const [mapStatus,setMapStatus]=useState('loading')
 const [tileStatus,setTileStatus]=useState('loading')
 const [mapAttempt,setMapAttempt]=useState(0)
 const [tileAttempt,setTileAttempt]=useState(0)
 const [basemap,setBasemap]=useState('satellite')
 const [expanded,setExpanded]=useState(false)
 clickRef.current=onClick
 pinClickRef.current=onPinClick

 renderRef.current=()=>{
  const L=leafletRef.current;const map=mapRef.current;const group=layersRef.current
  if(!L||!map||!group)return
  group.clearLayers()
  const everything=[]
  let selectedPin=null
  for(const pin of pins){
   const point=validLocation(pin);if(!point)continue
   everything.push([point.lat,point.lng])
   const tone=Object.hasOwn(PIN_TONES,pin.tone)?pin.tone:''
   const selected=selectedId!=null?pin.id!=null&&String(pin.id)===String(selectedId):Boolean(pin.selected)
   if(selected&&!selectedPin)selectedPin={...point,key:pin.id!=null?String(pin.id):`${point.lat},${point.lng}`}
   const pinLabel=pin.label??(tone==='suggested'?'+':'')
   const accessibleLabel=[pin.title||pinLabel||'Localização',PIN_TONES[tone]].filter(Boolean).join(' · ')
   const marker=L.marker([point.lat,point.lng],{
    icon:L.divIcon({className:`val-map-pin${tone?` is-${tone}`:''}${selected?' is-selected':''}`,html:`<b><span>${escapeHtml(pinLabel)}</span></b>`,iconSize:[34,40],iconAnchor:[17,tone==='position'||tone==='suggested'?17:40]}),
    title:accessibleLabel,keyboard:interactive,bubblingMouseEvents:false,riseOnHover:true,zIndexOffset:selected?1000:tone==='position'?800:0
   }).addTo(group)
   const element=marker.getElement()
   if(element){
    element.setAttribute('aria-label',accessibleLabel)
    element.setAttribute('role',onPinClick&&interactive?'button':'img')
    if(tone==='current')element.setAttribute('aria-current','step')
    if(onPinClick&&interactive)element.setAttribute('aria-pressed',String(selected))
    // divIcon is not a native button: provide both standard activation keys.
    if(interactive)element.addEventListener('keydown',event=>{
     if((event.key===' '||event.key==='Enter')&&pinClickRef.current){event.preventDefault();event.stopPropagation();pinClickRef.current(pin)}
    })
   }
   if(interactive)marker.on('click',()=>pinClickRef.current?.(pin))
  }
  for(const polygon of polygons){
   const ring=(polygon.points||[]).map(validLocation).filter(Boolean)
   if(ring.length<3)continue
   const coordinates=ring.map(point=>[point.lat,point.lng])
   everything.push(...coordinates)
   const shape=L.polygon(coordinates,{color:polygon.color||'#c8f25e',weight:2,fillColor:polygon.color||'#c8f25e',fillOpacity:.18}).addTo(group)
   if(polygon.label)shape.bindTooltip(escapeHtml(polygon.label),{permanent:true,direction:'center',className:'val-map-label'})
  }
  const routeLayers=[...(route.length?[{points:route,kind:'planned',color:'#00c896'}]:[]),...routes]
  for(const line of routeLayers){
   // Invalid coordinates split a path: they must never create an invented leg.
   let segment=[]
   const drawSegment=()=>{
    if(segment.length>1){
     everything.push(...segment)
     const recorded=line.kind==='recorded'
     const dashed=line.dashed??!recorded
     L.polyline(segment,{color:line.color||(recorded?'#00c896':line.kind==='approximate'?'#94a3b8':'#d4f47a'),weight:recorded?4:3,opacity:recorded?0.95:0.85,dashArray:dashed?(line.kind==='approximate'?'3 8':'8 7'):undefined,lineCap:'round',interactive:false,className:`val-map-route is-${recorded?'recorded':line.kind==='approximate'?'approximate':'planned'}`}).addTo(group)
    }
    segment=[]
   }
   for(const value of line.points||[]){const point=routePoint(value);if(point)segment.push([point.lat,point.lng]);else drawSegment()}
   drawSegment()
  }
  if(draft.length){
   const coordinates=draft.map(validLocation).filter(Boolean).map(point=>[point.lat,point.lng])
   everything.push(...coordinates)
   for(const coordinate of coordinates)L.circleMarker(coordinate,{radius:5,color:'#fff',weight:2,fillColor:'#2d8cff',fillOpacity:1}).addTo(group)
   if(coordinates.length>1)L.polyline(coordinates,{color:'#2d8cff',weight:2}).addTo(group)
   if(coordinates.length>2)L.polygon(coordinates,{color:'#2d8cff',weight:1,fillColor:'#2d8cff',fillOpacity:.12,dashArray:'4 4'}).addTo(group)
  }
  const start=validLocation(center)
  fitRef.current=()=>{
   if(everything.length>1)map.fitBounds(L.latLngBounds(everything),{padding:[44,44],maxZoom:17})
   else if(everything.length===1)map.setView(everything[0],zoom)
   else if(start)map.setView([start.lat,start.lng],zoom)
   else map.setView(BRAZIL_VIEW.center,BRAZIL_VIEW.zoom)
  }
  // Live GPS, status updates and pin selection must preserve the user's zoom.
  if(fit&&(!initialFitRef.current||!previousFitRef.current)&&(everything.length||start)){
   fitRef.current();initialFitRef.current=true
  }
  previousFitRef.current=fit
  const selection=selectedPin?.key??null
  if(selection!==selectionRef.current){
   if(selectedPin)map.panTo([selectedPin.lat,selectedPin.lng],{animate:false})
   selectionRef.current=selection
  }
 }

 useEffect(()=>{
  let disposed=false
  let observer=null
  let map=null
  setMapStatus('loading')
  initialFitRef.current=false
  selectionRef.current=null
  import('leaflet').then(module=>{
   if(disposed||!container.current)return
   const L=module.default||module
   leafletRef.current=L
   const start=validLocation(center)
   map=L.map(container.current,{
    attributionControl:true,zoomControl:interactive,dragging:interactive,scrollWheelZoom:interactive,
    doubleClickZoom:false,touchZoom:interactive,boxZoom:false,keyboard:interactive
   })
   map.setView(start?[start.lat,start.lng]:BRAZIL_VIEW.center,start?zoom:BRAZIL_VIEW.zoom)
   layersRef.current=L.layerGroup().addTo(map)
   map.on('click',event=>clickRef.current?.({lat:Number(event.latlng.lat.toFixed(6)),lng:Number(event.latlng.lng.toFixed(6))}))
   mapRef.current=map
   // Dentro de um <details> fechado o mapa nasce com 0px; quando abre, o
   // Leaflet precisa ser avisado para buscar os tiles do tamanho real.
   if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(container.current)}
   renderRef.current()
   setMapStatus('ready')
  }).catch(error=>{
   if(disposed)return
   console.error('Não foi possível iniciar o mapa da VAL.',error)
   observer?.disconnect();map?.remove();mapRef.current=null;layersRef.current=null
   setMapStatus('error')
  })
  return()=>{disposed=true;observer?.disconnect();map?.remove();mapRef.current=null;layersRef.current=null;fitRef.current=()=>{}}
 },[mapAttempt])

 useEffect(()=>{
  const map=mapRef.current;const L=leafletRef.current
  if(mapStatus!=='ready'||!map||!L)return
  let disposed=false;let errors=0;let timer=null
  const tiles=basemap==='satellite'?SATELLITE_TILES:STREET_TILES
  const layer=L.tileLayer(tiles.url,{maxZoom:tiles.maxZoom,attribution:tiles.attribution})
  const loading=()=>{
   errors=0;clearTimeout(timer);setTileStatus('loading')
   timer=setTimeout(()=>{if(!disposed)setTileStatus('error')},20000)
  }
  layer.on('loading',loading)
  layer.on('tileerror',()=>{errors++;clearTimeout(timer);if(!disposed)setTileStatus('error')})
  layer.on('load',()=>{clearTimeout(timer);if(!disposed)setTileStatus(errors?'error':'ready')})
  loading();layer.addTo(map)
  return()=>{disposed=true;clearTimeout(timer);layer.off();if(map.hasLayer(layer))map.removeLayer(layer)}
 },[basemap,tileAttempt,mapStatus])

 const signature=JSON.stringify({pins,polygons,route,routes,draft,center,fit,zoom,selectedId})
 useEffect(()=>{renderRef.current()},[signature,Boolean(onPinClick)])

 useEffect(()=>{
  mapRef.current?.invalidateSize({pan:false})
  if(!expanded)return
  const previousOverflow=document.body.style.overflow
  const previousFocus=document.activeElement
  document.body.style.overflow='hidden'
  const close=event=>{
   if(event.key==='Escape')setExpanded(false)
   if(event.key==='Tab'){
    const elements=[...shell.current.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')]
    const first=elements[0],last=elements.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  }
  document.addEventListener('keydown',close)
  shell.current?.querySelector('.val-map-expand')?.focus()
  return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',close);previousFocus?.focus?.()}
 },[expanded])

 const loading=mapStatus==='loading'||(mapStatus==='ready'&&tileStatus==='loading')
 const tileError=mapStatus==='ready'&&tileStatus==='error'
 return <div ref={shell} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={expanded?label:undefined} className={`val-map-shell${expanded?' is-expanded':''}${className?` ${className}`:''}`} style={{'--val-map-height':`${height}px`}}>
  <div ref={container} className="val-map-canvas" role={interactive?'region':'img'} aria-label={label} aria-busy={loading}/>
  {controls&&interactive&&<div className="val-map-controls" role="group" aria-label="Controles do mapa">
   <div className="val-map-basemaps" role="group" aria-label="Imagem de fundo">
    <button type="button" aria-pressed={basemap==='satellite'} onClick={()=>setBasemap('satellite')}>Satélite</button>
    <button type="button" aria-pressed={basemap==='street'} onClick={()=>setBasemap('street')}>Mapa</button>
   </div>
   <button type="button" className="val-map-fit" disabled={mapStatus!=='ready'} onClick={()=>fitRef.current()} title="Mostrar todos os pontos e trajetos">Enquadrar</button>
   <button type="button" className="val-map-expand" aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Sair da tela cheia':'Tela cheia'}</button>
  </div>}
  {loading&&<div className="val-map-loading" role="status">{mapStatus==='loading'?'Abrindo mapa…':basemap==='satellite'?'Carregando satélite…':'Carregando mapa…'}</div>}
  {(mapStatus==='error'||tileError)&&<div className="val-map-error" role="alert">
   <p>{mapStatus==='error'?'Não foi possível abrir o mapa.':basemap==='satellite'?'Não foi possível carregar toda a imagem de satélite.':'Não foi possível carregar todos os trechos do mapa.'}</p>
   <div>
    <button type="button" onClick={()=>mapStatus==='error'?setMapAttempt(value=>value+1):setTileAttempt(value=>value+1)}>Tentar novamente</button>
    {tileError&&basemap==='satellite'&&<button type="button" onClick={()=>setBasemap('street')}>Usar mapa de ruas</button>}
   </div>
  </div>}
 </div>
}
