import React,{useEffect,useRef,useState} from 'react'
import {MousePointer2,Layers,Map as MapIcon,Focus,HelpCircle,X,MapPin,Maximize,Minimize} from 'lucide-react'
import {searchMunicipalities,localityBounds,loadAdministrativeReferences} from '../../lib/map-localities'
import {cadastralDetails} from '../../lib/cadastral-map'
import CadastralLayers from './CadastralLayers'
import {pinPhotoUrls,visiblePinLabels,nearbyPropertyPins} from '../../lib/map-pin-presentation'
import {stateAtPoint} from '../../lib/cadastral-viewport'
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
 viewKey='',center=null,zoom=15,pins=[],polygons=[],route=[],routes=[],draft=[],fit=true,onClick,onPinClick,selectedId=null,
 height=280,className='',label='Mapa de satélite',interactive=true,controls=true,editorTools=null,editorActions=[],footerTools=null,adaptive=false,onNavigateMap,onPanelChange,onDraftPointClick=null,onDraftPointMove=null,onDraftPointInsert=null,clientId=null,onUseReference=null,adoptionDisabled=false
}){
 const shell=useRef(null)
 const container=useRef(null)
 const mapRef=useRef(null)
 const leafletRef=useRef(null)
 const layersRef=useRef(null)
 const baseRenderRef=useRef(null)
 const draftRenderRef=useRef({vertices:[],midpoints:[],line:null,area:null})
 const referenceRenderRef=useRef(new Map())
 const clickRef=useRef(onClick)
 const pinClickRef=useRef(onPinClick)
 const renderRef=useRef(()=>{})
 const fitRef=useRef(()=>{})
 const initialFitRef=useRef(false)
 const previousFitRef=useRef(fit)
 const selectionRef=useRef(null)
 const pinMarkersRef=useRef([])
 const layoutLabelsRef=useRef(()=>{})
 const [pinChoices,setPinChoices]=useState([])
 const choicePanel=useRef(null)
 const choiceTrigger=useRef(null)
 useEffect(()=>{if(pinChoices.length)choicePanel.current?.querySelector?.('button[data-property-choice]')?.focus?.()},[pinChoices])
 useEffect(()=>setPinChoices(current=>current.length?[]:current),[pins,viewKey])
 const closePinChoices=()=>{setPinChoices([]);choiceTrigger.current?.focus?.()}
 const draftPointRef=useRef(onDraftPointClick);draftPointRef.current=onDraftPointClick
 const draftMoveRef=useRef(onDraftPointMove);draftMoveRef.current=onDraftPointMove
 const draftInsertRef=useRef(onDraftPointInsert);draftInsertRef.current=onDraftPointInsert
 const draftCoordinatesRef=useRef([])
 const [referenceLayers,setReferenceLayers]=useState([])
 const [viewport,setViewport]=useState(null)
 const [cadastralNotice,setCadastralNotice]=useState('Cadastros automáticos: aproxime o mapa.')
 const [railPanel,setRailPanel]=useState(null)
 const [municipality,setMunicipality]=useState(null),[municipalData,setMunicipalData]=useState(null),[municipalStatus,setMunicipalStatus]=useState('idle'),[municipalAttempt,setMunicipalAttempt]=useState(0),[showMunicipality,setShowMunicipality]=useState(true)
 const togglePanel=panel=>{onPanelChange?.();setRailPanel(current=>current===panel?null:panel)}
 const [mapStatus,setMapStatus]=useState('loading')
 const [tileStatus,setTileStatus]=useState('loading')
 const [mapAttempt,setMapAttempt]=useState(0)
 const [tileAttempt,setTileAttempt]=useState(0)
 const [basemap,setBasemap]=useState('satellite')
 const [expanded,setExpanded]=useState(false)
 const [places,setPlaces]=useState([]),[stateGeo,setStateGeo]=useState(null)
 const [placeStatus,setPlaceStatus]=useState('loading'),[placeAttempt,setPlaceAttempt]=useState(0)
 const [placeQuery,setPlaceQuery]=useState(''),[placeUf,setPlaceUf]=useState(''),[placeOpen,setPlaceOpen]=useState(false)
 const [showStates,setShowStates]=useState(true),[placeNotice,setPlaceNotice]=useState('')
 const matches=searchMunicipalities(places,placeQuery,placeUf)
 useEffect(()=>{
  let active=true
  setPlaceStatus('loading')
  loadAdministrativeReferences().then(({rows,geo})=>{
   if(active){setPlaces(rows);setStateGeo(geo);setPlaceStatus('ready')}
  }).catch(()=>{if(active)setPlaceStatus('error')})
  return()=>{active=false}
 },[placeAttempt])
 const editing=className.includes('is-editing')
 const showHolderLabels=(viewport?.zoom||0)>=13
 useEffect(()=>{
  const map=mapRef.current,L=leafletRef.current
  if(mapStatus!=='ready'||!map||!L||!stateGeo||!showStates)return
  const layer=L.geoJSON(stateGeo,{interactive:false,style:{color:'#fff3a6',weight:1.5,opacity:.9,fill:false},onEachFeature:(feature,shape)=>shape.bindTooltip(escapeHtml(feature.properties.uf),{permanent:true,direction:'center',className:'val-state-label'})}).addTo(map)
  return()=>{if(map.hasLayer(layer))map.removeLayer(layer)}
 },[mapStatus,stateGeo,showStates])
 useEffect(()=>{
  const map=mapRef.current,L=leafletRef.current
  if(mapStatus!=='ready'||!map||!L)return
  const rendered=referenceRenderRef.current
  for(const [id,entry] of rendered){if(!referenceLayers.some(reference=>reference.id===id&&reference.geojson===entry.geojson&&entry.editing===editing&&entry.labels===showHolderLabels)){map.removeLayer(entry.layer);rendered.delete(id)}}
  for(const reference of referenceLayers){
   if(rendered.has(reference.id))continue
   const layer=L.geoJSON(reference.geojson,{interactive:!editing,bubblingMouseEvents:false,smoothFactor:1,style:{color:reference.color,weight:2,fillOpacity:.04,dashArray:'6 3'},onEachFeature:(feature,shape)=>{
    const details=cadastralDetails(feature),holder=details.holder||'Titular não informado na fonte'
    const title=`${reference.type} · ${details.registry||details.code||details.name||'Limite de referência'}`
    shape.bindTooltip(`${escapeHtml(title)}<br>${escapeHtml(holder)}`,{permanent:reference.type==='Matrícula'&&Boolean(details.holder)&&showHolderLabels,direction:'center',className:'val-registry-label'})
    if(!editing)shape.bindPopup?.(`<strong>${escapeHtml(title)}</strong><br>${escapeHtml(holder)}<br>${escapeHtml(reference.name)}${reference.official?'':reference.registered?' · cadastro do usuário':' · declarado no arquivo'}`)
   }}).addTo(map)
   rendered.set(reference.id,{layer,geojson:reference.geojson,editing,labels:showHolderLabels})
  }
 },[referenceLayers,mapStatus,editing,showHolderLabels])
 useEffect(()=>{
  setMunicipalData(null)
  if(!municipality){setMunicipalStatus('idle');return}
  const controller=new AbortController();let active=true;const timer=setTimeout(()=>controller.abort(),15000)
  setMunicipalStatus('loading')
  fetch(`/api/geo/municipalities/${municipality[0]}/boundary`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('boundary unavailable');const data=await response.json();if(data.code!==municipality[0]||data.geojson?.type!=='FeatureCollection')throw new Error('wrong boundary');return data}).then(data=>{if(active){setMunicipalData(data);setMunicipalStatus('ready')}}).catch(()=>{if(active)setMunicipalStatus('error')}).finally(()=>clearTimeout(timer))
  return()=>{active=false;clearTimeout(timer);controller.abort()}
 },[municipality,municipalAttempt])
 useEffect(()=>{
  const map=mapRef.current,L=leafletRef.current
  if(mapStatus!=='ready'||!map||!L||!municipalData||!showMunicipality)return
  const layer=L.geoJSON(municipalData.geojson,{interactive:false,style:{color:'#67e8f9',weight:3,opacity:1,fillColor:'#67e8f9',fillOpacity:.025},onEachFeature:(_feature,shape)=>shape.bindTooltip(escapeHtml(`${municipality?.[1]} • divisa municipal IBGE`),{sticky:true,className:'val-state-label'})}).addTo(map)
  return()=>{if(map.hasLayer(layer))map.removeLayer(layer)}
 },[mapStatus,municipalData,showMunicipality,municipality])
 useEffect(()=>{
  const map=mapRef.current
  if(mapStatus!=='ready'||!map||!stateGeo)return
  const update=()=>{const point=map.getCenter(),bounds=map.getBounds();setViewport({lat:point.lat,lng:point.lng,zoom:map.getZoom(),uf:stateAtPoint(point,stateGeo),bbox:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]})}
  map.on('moveend zoomend',update);update()
  return()=>map.off('moveend zoomend',update)
 },[mapStatus,stateGeo])
 const choosePlace=row=>{
  setMunicipality(row);setShowMunicipality(true)
  const bounds=localityBounds(row)
  if(!bounds){setPlaceNotice('Limite municipal indisponível nesta base. Escolha o estado para navegar.');return}
  mapRef.current?.fitBounds(bounds,{padding:[25,25],maxZoom:12})
  setPlaceUf(row[2]);setPlaceQuery(`${row[1]} — ${row[2]}`);setPlaceOpen(false);setPlaceNotice(`Visualizando ${row[1]} — ${row[2]}. Marque a sede para definir a propriedade.`)
 }
 const chooseState=uf=>{
  setPlaceUf(uf);setPlaceQuery('');setPlaceOpen(false);setMunicipality(null)
  const feature=stateGeo?.features.find(item=>item.properties.uf===uf)
  if(feature&&leafletRef.current&&mapRef.current){const bounds=leafletRef.current.geoJSON(feature).getBounds();mapRef.current.fitBounds(bounds,{padding:[25,25]});setPlaceNotice(`Visualizando ${feature.properties.name}.`)}
  else if(!uf){mapRef.current?.setView(BRAZIL_VIEW.center,BRAZIL_VIEW.zoom);setPlaceNotice('Visão inicial do Brasil.')}
 }

 layoutLabelsRef.current=()=>{
  const bounds=container.current?.getBoundingClientRect?.();if(!bounds)return
  const entries=[],markers=[]
  for(const item of pinMarkersRef.current){
   const rect=item.marker.getElement()?.getBoundingClientRect?.()
   if(rect)markers.push({id:item.id,rect})
   const element=item.marker.getTooltip?.()?.getElement?.()
   if(element)entries.push({...item,element,rect:element.getBoundingClientRect()})
  }
  const visible=visiblePinLabels(entries,markers,bounds)
  for(const item of entries)item.element.style.visibility=visible.has(item.id)?'visible':'hidden'
 }
 clickRef.current=onClick
 pinClickRef.current=onPinClick
 const baseSignature=JSON.stringify({pins,polygons,route,routes,selectedId,interactive,clickable:Boolean(onPinClick)})

 renderRef.current=()=>{
  const L=leafletRef.current;const map=mapRef.current;const group=layersRef.current
  if(!L||!map||!group)return
  let everything=baseRenderRef.current?.everything||[]
  let selectedPin=baseRenderRef.current?.selectedPin||null
  if(baseRenderRef.current?.signature!==baseSignature){
  group.clearLayers();draftRenderRef.current={vertices:[],midpoints:[],line:null,area:null}
  everything=[];selectedPin=null;pinMarkersRef.current=[]
  for(const pin of pins){
   const point=validLocation(pin);if(!point)continue
   everything.push([point.lat,point.lng])
   const tone=Object.hasOwn(PIN_TONES,pin.tone)?pin.tone:''
   const selected=selectedId!=null?pin.id!=null&&String(pin.id)===String(selectedId):Boolean(pin.selected)
   if(selected&&!selectedPin)selectedPin={...point,key:pin.id!=null?String(pin.id):`${point.lat},${point.lng}`}
   const pinLabel=pin.label??(tone==='suggested'?'+':'')
   const accessibleLabel=[pin.title||pinLabel||'Localização',PIN_TONES[tone]].filter(Boolean).join(' · ')
   const photoUrls=pinPhotoUrls(pin)
   const marker=L.marker([point.lat,point.lng],{
    icon:L.divIcon({className:`val-map-pin${tone?` is-${tone}`:''}${selected?' is-selected':''}${photoUrls.length?' has-photo':''}`,html:`<b><span>${escapeHtml(pinLabel)}</span>${photoUrls.length?`<img src="${escapeHtml(photoUrls[0])}" alt="" loading="lazy" decoding="async"/>`:''}</b>`,iconSize:[34,40],iconAnchor:[17,tone==='position'||tone==='suggested'?17:40]}),
    title:accessibleLabel,keyboard:interactive,bubblingMouseEvents:false,riseOnHover:true,zIndexOffset:selected?1000:tone==='position'?800:0
   }).addTo(group)
   if(pin.caption||pin.displayName)marker.bindTooltip(escapeHtml(pin.caption||pin.displayName),{permanent:true,direction:'right',offset:[9,-23],className:'val-property-pin-label'})
   const item={id:String(pin.id??pinMarkersRef.current.length),marker,selected,active:false}
   pinMarkersRef.current.push(item)
   const element=marker.getElement()
   const activatePin=()=>{
    const choices=nearbyPropertyPins(pin,pins,map.latLngToContainerPoint?item=>{const point=validLocation(item);return point?map.latLngToContainerPoint([point.lat,point.lng]):null}:null)
    if(choices.length>1){choiceTrigger.current=element;setPinChoices(choices)}
    else pinClickRef.current?.(pin)
   }
   if(element){
    const image=element.querySelector?.('img')
    if(image){
     let index=0
     const loaded=()=>element.classList.add('photo-ready')
     image.addEventListener('load',loaded)
     image.addEventListener('error',()=>{
      element.classList.remove('photo-ready')
      if(++index<photoUrls.length)image.src=photoUrls[index]
      else{image.remove();element.classList.remove('has-photo')}
     })
     if(image.complete&&image.naturalWidth)loaded()
    }
    const highlight=active=>{item.active=active;layoutLabelsRef.current()}
    element.addEventListener('focus',()=>highlight(true));element.addEventListener('blur',()=>highlight(false))
    marker.on('mouseover',()=>highlight(true));marker.on('mouseout',()=>highlight(false))
    element.setAttribute('aria-label',accessibleLabel)
    element.setAttribute('role',onPinClick&&interactive?'button':'img')
    if(tone==='current')element.setAttribute('aria-current','step')
    if(onPinClick&&interactive)element.setAttribute('aria-pressed',String(selected))
    // divIcon is not a native button: provide both standard activation keys.
    if(interactive)element.addEventListener('keydown',event=>{
     if((event.key===' '||event.key==='Enter')&&pinClickRef.current){event.preventDefault();event.stopPropagation();activatePin()}
    })
   }
   if(interactive&&onPinClick)marker.on('click',activatePin)
  }
  for(const polygon of polygons){
   const ring=(polygon.points||[]).map(validLocation).filter(Boolean)
   if(ring.length<3)continue
   const coordinates=ring.map(point=>[point.lat,point.lng])
   everything.push(...coordinates)
   const shape=L.polygon(coordinates,{color:polygon.color||'#c8f25e',weight:2,fillColor:polygon.color||'#c8f25e',fillOpacity:.18,interactive:false}).addTo(group)
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
  baseRenderRef.current={signature:baseSignature,everything,selectedPin}
  }
  const drawing=draftRenderRef.current,coordinates=draft.map(validLocation).filter(Boolean).map(point=>[point.lat,point.lng])
  draftCoordinatesRef.current=coordinates
  while(drawing.vertices.length>coordinates.length)group.removeLayer(drawing.vertices.pop())
  coordinates.forEach((coordinate,index)=>{
   let vertex=drawing.vertices[index]
   if(!vertex){
    vertex=L.marker(coordinate,{icon:L.divIcon({className:'val-map-vertex',html:'<span></span>',iconSize:[28,28],iconAnchor:[14,14]}),draggable:Boolean(onDraftPointMove),keyboard:true,autoPan:true,bubblingMouseEvents:false,zIndexOffset:1600,title:`Ponto ${index+1}: arraste para mover; toque para apagar`}).addTo(group)
    vertex.on('click',()=>{if(!vertex._valDragging)draftPointRef.current?.(index)})
    vertex.on('dragstart',()=>{vertex._valDragging=true})
    vertex.on('drag',()=>{
     const point=vertex.getLatLng(),live=draftCoordinatesRef.current.map((p,i)=>i===index?[point.lat,point.lng]:p)
     drawing.line?.setLatLngs(live);drawing.area?.setLatLngs(live)
     for(const midpoint of drawing.midpoints){const i=midpoint._valEdge,a=live[i],b=live[(i+1)%live.length];if(a&&b)midpoint.setLatLng([(a[0]+b[0])/2,(a[1]+b[1])/2])}
    })
    vertex.on('dragend',()=>{
     const point=vertex.getLatLng();draftMoveRef.current?.(index,{lat:Number(point.lat.toFixed(6)),lng:Number(point.lng.toFixed(6))})
     // Leaflet normally suppresses click after a drag; also protect touch events.
     setTimeout(()=>{vertex._valDragging=false},0)
    })
    const element=vertex.getElement();element?.setAttribute('role','button');element?.setAttribute('aria-label',`Ponto ${index+1}. Arraste para mover; toque para apagar.`)
    element?.addEventListener('keydown',event=>{if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();draftPointRef.current?.(index)}})
    drawing.vertices.push(vertex)
   }
   else if(vertex._valCoordinate!==coordinate.join(','))vertex.setLatLng(coordinate)
   if(onDraftPointMove)vertex.dragging?.enable();else vertex.dragging?.disable()
   vertex._valCoordinate=coordinate.join(',');vertex.bindTooltip(`Ponto ${index+1}${onDraftPointClick?' • toque para apagar':''}`)
  })
  for(const [key,min,make,options] of [['line',2,'polyline',{color:'#2d8cff',weight:2}],['area',3,'polygon',{color:'#2d8cff',weight:1,fillColor:'#2d8cff',fillOpacity:.12,dashArray:'4 4'}]]){
   if(coordinates.length<min){if(drawing[key])group.removeLayer(drawing[key]);drawing[key]=null}
   else if(drawing[key])drawing[key].setLatLngs(coordinates)
   else drawing[key]=L[make](coordinates,{...options,interactive:false}).addTo(group)
  }
  // Bounded handles prevent a dense imported boundary from filling the screen
  // with hundreds of + icons. Saved-field editing also offers nearest-edge taps.
  const midpointCount=onDraftPointInsert&&coordinates.length>=3&&coordinates.length<80?coordinates.length:0
  while(drawing.midpoints.length>midpointCount)group.removeLayer(drawing.midpoints.pop())
  for(let index=0;index<midpointCount;index++){
   const a=coordinates[index],b=coordinates[(index+1)%coordinates.length],point=[(a[0]+b[0])/2,(a[1]+b[1])/2]
   let marker=drawing.midpoints[index]
   if(!marker){
    marker=L.marker(point,{icon:L.divIcon({className:'val-map-midpoint',html:'<span>+</span>',iconSize:[26,26],iconAnchor:[13,13]}),keyboard:true,bubblingMouseEvents:false,zIndexOffset:1400,title:'Inserir ponto neste lado'}).addTo(group);marker._valEdge=index
    const insert=()=>{const p=marker.getLatLng();draftInsertRef.current?.(index,{lat:p.lat,lng:p.lng})}
    marker.on('click',insert);marker.getElement()?.setAttribute('aria-label',`Inserir ponto após o ponto ${index+1}`);marker.getElement()?.setAttribute('role','button')
    marker.getElement()?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();insert()}})
    drawing.midpoints.push(marker)
   }else marker.setLatLng(point)
  }
  everything=[...everything,...coordinates]
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
  layoutLabelsRef.current()
 }

 useEffect(()=>{
  let disposed=false
  let observer=null
  let map=null
  setMapStatus('loading')
  initialFitRef.current=false
  baseRenderRef.current=null;referenceRenderRef.current=new Map()
  selectionRef.current=null
  import('leaflet').then(module=>{
   if(disposed||!container.current)return
   const L=module.default||module
   leafletRef.current=L
   const start=validLocation(center)
   map=L.map(container.current,{
    attributionControl:true,zoomControl:interactive,dragging:interactive,scrollWheelZoom:interactive,
    doubleClickZoom:false,touchZoom:interactive,boxZoom:false,keyboard:interactive,preferCanvas:true
   })
   map.setView(start?[start.lat,start.lng]:BRAZIL_VIEW.center,start?zoom:BRAZIL_VIEW.zoom)
   layersRef.current=L.layerGroup().addTo(map)
   map.on('click',event=>clickRef.current?.({lat:Number(event.latlng.lat.toFixed(6)),lng:Number(event.latlng.lng.toFixed(6))}))
   mapRef.current=map
   map.on('moveend zoomend resize',()=>layoutLabelsRef.current())
   map.zoomControl?.setPosition('topright')
   // Dentro de um <details> fechado o mapa nasce com 0px; quando abre, o
   // Leaflet precisa ser avisado para buscar os tiles do tamanho real.
   if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(container.current)}
   if(viewKey){
    try{const saved=JSON.parse(sessionStorage.getItem(`val:map-view:${viewKey}`)||'null');const point=validLocation(saved);if(point&&Number.isFinite(saved.zoom)){map.setView([point.lat,point.lng],saved.zoom);initialFitRef.current=true;selectionRef.current=selectedId==null?null:String(selectedId)}}catch{}
    map.on('moveend',()=>{try{const point=map.getCenter();sessionStorage.setItem(`val:map-view:${viewKey}`,JSON.stringify({lat:point.lat,lng:point.lng,zoom:map.getZoom()}))}catch{}})
   }
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
  const layer=L.tileLayer(tiles.url,{maxZoom:tiles.maxZoom,attribution:tiles.attribution,updateWhenIdle:true,keepBuffer:3})
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

 const signature=JSON.stringify({baseSignature,draft,center,fit,zoom})
 useEffect(()=>{renderRef.current()},[signature,Boolean(onPinClick),Boolean(onDraftPointClick),Boolean(onDraftPointMove),Boolean(onDraftPointInsert)])

 useEffect(()=>{
  mapRef.current?.invalidateSize({pan:false})
  if(!expanded)return
  const previousOverflow=document.body.style.overflow
  const previousFocus=document.activeElement
  document.body.style.overflow='hidden';document.body.classList.add('val-map-expanded')
  const close=event=>{
   if(event.key==='Escape')setExpanded(false)
   if(event.key==='Tab'){
    const elements=[...shell.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')]
    const first=elements[0],last=elements.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  }
  document.addEventListener('keydown',close)
  shell.current?.querySelector('.val-map-expand')?.focus()
  return()=>{document.body.style.overflow=previousOverflow;document.body.classList.remove('val-map-expanded');document.removeEventListener('keydown',close);previousFocus?.focus?.()}
 },[expanded])

 const loading=mapStatus==='loading'||(mapStatus==='ready'&&tileStatus==='loading')
 const tileError=mapStatus==='ready'&&tileStatus==='error'
 return <div ref={shell} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={expanded?label:undefined} className={`val-map-shell${adaptive?' is-adaptive':''}${expanded?' is-expanded':''}${className?` ${className}`:''}`} style={{'--val-map-height':`${height}px`}}>
  {controls&&interactive&&<div className="val-map-placebar">
   <label>Estado<select aria-label="Estado para navegar no mapa" value={placeUf} disabled={placeStatus!=='ready'||mapStatus!=='ready'} onChange={event=>chooseState(event.target.value)}><option value="">Brasil • todos os estados</option>{(stateGeo?.features||[]).slice().sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'pt-BR')).map(item=><option key={item.properties.uf} value={item.properties.uf}>{item.properties.name} — {item.properties.uf}</option>)}</select></label>
   <div className="val-map-place-search"><label>Buscar município<input aria-label="Buscar município no mapa" placeholder="Ex.: São Luiz Gonzaga" value={placeQuery} disabled={placeStatus!=='ready'||mapStatus!=='ready'} onFocus={()=>setPlaceOpen(true)} onChange={event=>{setPlaceQuery(event.target.value);setPlaceOpen(true)}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setPlaceOpen(false)}if(event.key==='Enter'){event.preventDefault();if(matches.length===1)choosePlace(matches[0]);else setPlaceOpen(true)}}}/></label>
    {placeOpen&&placeQuery.trim()&&<div className="val-map-place-results" role="group" aria-label="Municípios encontrados">{matches.map(row=><button type="button" key={row[0]} onClick={()=>choosePlace(row)}>{row[1]} <b>{row[2]}</b></button>)}{!matches.length&&<p>Nenhum município encontrado. Confira o nome ou o estado.</p>}<button type="button" onClick={()=>setPlaceOpen(false)}>Fechar resultados</button></div>}
   </div>

   <div className="val-map-place-notice" role="status">{placeStatus==='loading'?'Carregando municípios e divisas…':placeStatus==='error'?<>Referência indisponível. <button type="button" onClick={()=>setPlaceAttempt(value=>value+1)}>Recarregar municípios</button></>:placeNotice||'Busque um município ou escolha um estado para aproximar.'} <span>Limites de referência • IBGE</span><button type="button" className="val-map-cadastral-notice" onClick={()=>togglePanel('layers')}>{cadastralNotice}</button>{municipality&&<span className="val-municipal-status">{municipalStatus==='loading'?'Carregando divisa municipal…':municipalStatus==='ready'?`${municipality[1]}: divisa ${showMunicipality?'visível':'oculta'}`:municipalStatus==='error'?<>Divisa municipal indisponível. <button type="button" onClick={()=>setMunicipalAttempt(value=>value+1)}>Tentar divisa novamente</button></>:''}</span>}</div>
  </div>}
  <div className="val-map-stage">
  {controls&&interactive&&<>
   <div className="val-map-toolrail" role="toolbar" aria-label="Ferramentas e filtros do mapa">
    <button type="button" title="Navegar pelo mapa" aria-label="Navegar pelo mapa" onClick={()=>{setRailPanel(null);onNavigateMap?.()}}><MousePointer2 size={19}/><span>Navegar</span></button>
    {editorActions.map(({id,label,Icon,onClick,disabled,active})=><button type="button" key={id} title={label} aria-label={label} aria-pressed={Boolean(active)} disabled={disabled} onClick={()=>{setRailPanel(null);onClick()}}><Icon size={19}/><span>{label}</span></button>)}
    <button type="button" title="Camadas CAR, SIGEF e matrículas" aria-label="Camadas CAR, SIGEF e matrículas" aria-expanded={railPanel==='layers'} onClick={()=>togglePanel('layers')}><Layers size={19}/><span>Camadas</span></button>
    <button type="button" title="Filtrar divisas" aria-label="Filtrar divisas" aria-expanded={railPanel==='boundaries'} onClick={()=>togglePanel('boundaries')}><MapIcon size={19}/><span>Divisas</span></button>
    <button type="button" title="Mostrar todos os pontos e trajetos" disabled={mapStatus!=='ready'} onClick={()=>fitRef.current()}><Focus size={19}/><span>Enquadrar</span></button>
    <button type="button" title="Como usar o mapa" aria-label="Como usar o mapa" aria-expanded={railPanel==='help'} onClick={()=>togglePanel('help')}><HelpCircle size={19}/><span>Ajuda</span></button>
   </div>
   <div className="val-map-worktools">
    {editorTools}
    <div hidden={railPanel!=='layers'}><CadastralLayers panelOnly onChange={setReferenceLayers} viewport={viewport} onStatusChange={setCadastralNotice} clientId={clientId} adoptionDisabled={adoptionDisabled} onFocusReference={geojson=>{const L=leafletRef.current;if(L&&mapRef.current)mapRef.current.fitBounds(L.geoJSON(geojson).getBounds(),{padding:[44,44],maxZoom:17})}} onUseReference={onUseReference?(...args)=>{if(onUseReference(...args)!==false)setRailPanel(null)}:null}/></div>
    {railPanel==='boundaries'&&<section className="val-map-filter-panel"><header><strong>Divisas no mapa</strong><button type="button" aria-label="Fechar filtros de divisas" onClick={()=>setRailPanel(null)}><X size={16}/></button></header><label><input type="checkbox" checked={showStates} onChange={e=>setShowStates(e.target.checked)}/>Divisas estaduais</label><label><input type="checkbox" disabled={!municipality} checked={showMunicipality} onChange={e=>setShowMunicipality(e.target.checked)}/>Divisa do município selecionado</label><p>{municipality?`${municipality[1]} — ${municipality[2]}`:'Selecione um município na busca.'}</p><p>Referência administrativa IBGE; não define limites da propriedade.</p></section>}
    {railPanel==='help'&&<section className="val-map-filter-panel"><header><strong>Como mapear</strong><button type="button" aria-label="Fechar ajuda" onClick={()=>setRailPanel(null)}><X size={16}/></button></header><p>1. Busque o município e escolha a safra.</p><p>2. Use Sede para marcar a localização ou Talhão / cultura para tocar nos cantos da área produtiva.</p><p>3. Toque em um ponto azul para apagá-lo. Conclua a área e salve.</p><p>Safras e culturas filtram o mesmo talhão físico. Camadas exibe CAR, SIGEF e arquivos de matrícula.</p></section>}
   </div>
  </>}
  <div ref={container} className="val-map-canvas" role={interactive?'region':'img'} aria-label={label} aria-busy={loading}/>
  {pinChoices.length>1&&<section ref={choicePanel} className="val-map-pin-choices" aria-label="Propriedades próximas neste ponto" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePinChoices()}}}>
   <header><strong>Qual propriedade deseja abrir?</strong><button type="button" aria-label="Fechar escolha de propriedade" onClick={closePinChoices}><X size={16}/></button></header>
   <div>{pinChoices.map(pin=><button type="button" data-property-choice key={pin.id} onClick={()=>{setPinChoices([]);pinClickRef.current?.(pin)}}><MapPin size={18}/><span>{pin.title||pin.displayName||pin.caption||'Propriedade'}</span></button>)}</div>
  </section>}
  {controls&&interactive&&<div className="val-map-controls" role="group" aria-label="Controles do mapa">
   <div className="val-map-basemaps" role="group" aria-label="Imagem de fundo">
    <button type="button" aria-pressed={basemap==='satellite'} onClick={()=>setBasemap('satellite')}>Satélite</button>
    <button type="button" aria-pressed={basemap==='street'} onClick={()=>setBasemap('street')}>Mapa</button>
   </div>
   <button type="button" className="val-map-expand" aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize size={16}/>:<Maximize size={16}/>}<span>{expanded?'Sair da tela cheia':'Tela cheia'}</span></button>
  </div>}
  {loading&&<div className="val-map-loading" role="status">{mapStatus==='loading'?'Abrindo mapa…':basemap==='satellite'?'Carregando satélite…':'Carregando mapa…'}</div>}
  {(mapStatus==='error'||tileError)&&<div className="val-map-error" role="alert">
   <p>{mapStatus==='error'?'Não foi possível abrir o mapa.':basemap==='satellite'?'Não foi possível carregar toda a imagem de satélite.':'Não foi possível carregar todos os trechos do mapa.'}</p>
   <div>
    <button type="button" onClick={()=>mapStatus==='error'?setMapAttempt(value=>value+1):setTileAttempt(value=>value+1)}>Tentar novamente</button>
    {tileError&&basemap==='satellite'&&<button type="button" onClick={()=>setBasemap('street')}>Usar mapa de ruas</button>}
   </div>
  </div>}
  {footerTools&&<div className="val-map-footer">{footerTools}</div>}
 </div></div>
}
