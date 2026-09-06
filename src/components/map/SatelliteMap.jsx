import React,{useEffect,useRef} from 'react'
import 'leaflet/dist/leaflet.css'
import '../../val-property-map.css'
import {BRAZIL_VIEW,SATELLITE_TILES,validLocation} from '../../lib/property-map'

// Mapa de satélite da VAL. O Leaflet entra sob demanda (import dinâmico) para
// não pesar o bundle de quem nunca abre um mapa. Pinos são divIcon — nada de
// depender dos PNGs padrão do Leaflet, que somem em bundlers.

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))

export default function SatelliteMap({
 center=null,zoom=15,pins=[],polygons=[],route=[],draft=[],fit=true,onClick,
 height=280,className='',label='Mapa de satélite',interactive=true
}){
 const container=useRef(null)
 const mapRef=useRef(null)
 const leafletRef=useRef(null)
 const layersRef=useRef(null)
 const clickRef=useRef(onClick)
 const renderRef=useRef(()=>{})
 clickRef.current=onClick

 renderRef.current=()=>{
  const L=leafletRef.current;const map=mapRef.current;const group=layersRef.current
  if(!L||!map||!group)return
  group.clearLayers()
  const everything=[]
  for(const pin of pins){
   const point=validLocation(pin);if(!point)continue
   everything.push([point.lat,point.lng])
   L.marker([point.lat,point.lng],{
    icon:L.divIcon({className:`val-map-pin${pin.tone?` is-${pin.tone}`:''}`,html:`<b>${escapeHtml(pin.label||'')}</b>`,iconSize:[30,36],iconAnchor:[15,36]}),
    title:pin.title||pin.label||'',keyboard:false
   }).addTo(group)
  }
  for(const polygon of polygons){
   const ring=(polygon.points||[]).map(validLocation).filter(Boolean)
   if(ring.length<3)continue
   const coordinates=ring.map(point=>[point.lat,point.lng])
   everything.push(...coordinates)
   const shape=L.polygon(coordinates,{color:'#c8f25e',weight:2,fillColor:'#c8f25e',fillOpacity:.18}).addTo(group)
   if(polygon.label)shape.bindTooltip(escapeHtml(polygon.label),{permanent:true,direction:'center',className:'val-map-label'})
  }
  if(route.length>1){
   everything.push(...route)
   L.polyline(route,{color:'#00c896',weight:3,dashArray:'7 7'}).addTo(group)
  }
  if(draft.length){
   const coordinates=draft.map(point=>[point.lat,point.lng])
   for(const coordinate of coordinates)L.circleMarker(coordinate,{radius:5,color:'#fff',weight:2,fillColor:'#2d8cff',fillOpacity:1}).addTo(group)
   if(coordinates.length>1)L.polyline(coordinates,{color:'#2d8cff',weight:2}).addTo(group)
   if(coordinates.length>2)L.polygon(coordinates,{color:'#2d8cff',weight:1,fillColor:'#2d8cff',fillOpacity:.12,dashArray:'4 4'}).addTo(group)
  }
  const start=validLocation(center)
  if(fit&&everything.length>1)map.fitBounds(L.latLngBounds(everything),{padding:[28,28],maxZoom:17})
  else if(fit&&everything.length===1)map.setView(everything[0],Math.max(map.getZoom(),zoom))
  else if(!everything.length&&start)map.setView([start.lat,start.lng],zoom)
 }

 useEffect(()=>{
  let disposed=false
  let observer=null
  import('leaflet').then(module=>{
   if(disposed||!container.current)return
   const L=module.default||module
   leafletRef.current=L
   const start=validLocation(center)
   const map=L.map(container.current,{
    attributionControl:true,zoomControl:interactive,dragging:interactive,scrollWheelZoom:interactive,
    doubleClickZoom:false,touchZoom:interactive,boxZoom:false,keyboard:false
   })
   map.setView(start?[start.lat,start.lng]:BRAZIL_VIEW.center,start?zoom:BRAZIL_VIEW.zoom)
   L.tileLayer(SATELLITE_TILES.url,{maxZoom:SATELLITE_TILES.maxZoom,attribution:SATELLITE_TILES.attribution}).addTo(map)
   layersRef.current=L.layerGroup().addTo(map)
   map.on('click',event=>clickRef.current?.({lat:Number(event.latlng.lat.toFixed(6)),lng:Number(event.latlng.lng.toFixed(6))}))
   mapRef.current=map
   // Dentro de um <details> fechado o mapa nasce com 0px; quando abre, o
   // Leaflet precisa ser avisado para buscar os tiles do tamanho real.
   if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(container.current)}
   renderRef.current()
  }).catch(()=>{})
  return()=>{disposed=true;observer?.disconnect();mapRef.current?.remove();mapRef.current=null;layersRef.current=null}
 },[])

 const signature=JSON.stringify({pins,polygons,route,draft,center,fit})
 useEffect(()=>{renderRef.current()},[signature])

 return <div className={`val-map-shell${className?` ${className}`:''}`} style={{'--val-map-height':`${height}px`}}>
  <div ref={container} className="val-map-canvas" role="img" aria-label={label}/>
 </div>
}
