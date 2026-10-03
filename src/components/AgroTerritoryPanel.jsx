import {AgronomicDecisionCard} from './AgronomicDecisionCard'
import React,{useEffect,useMemo,useRef,useState} from 'react'
import {fetchJsonResource} from '../hooks/useAsyncResource'
import SatelliteMap from './map/SatelliteMap'
import {territorialLayers,resolveTerritorialFocus,geometryPoints,usableGeometry} from '../lib/agro-territory-map'
import './AgroTerritoryPanel.css'
export default function AgroTerritoryPanel({clientId='',scope='',map=false,initialFocus=null,cardsVisible=true}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[offline,setOffline]=useState(typeof navigator!=='undefined'&&!navigator.onLine),[revision,setRevision]=useState(0),[property,setProperty]=useState(initialFocus?.property_id||''),[field,setField]=useState(initialFocus?.field_id||''),[season,setSeason]=useState(''),[showFields,setShowFields]=useState(true),[showProperties,setShowProperties]=useState(true),[focus,setFocus]=useState(initialFocus),[focusRevision,setFocusRevision]=useState(0)
 const mapSection=useRef(null),key=`${scope}:${clientId}:${revision}`
 useEffect(()=>{const controller=new AbortController();let active=true;setData(null);setError('');setProperty(initialFocus?.property_id||'');setField(initialFocus?.field_id||'');setSeason('');setFocus(initialFocus)
  fetchJsonResource(`/api/agro-geo${clientId?'?clientId='+encodeURIComponent(clientId):''}`,{signal:controller.signal,timeoutMs:30000}).then(value=>{if(active)setData({key,value})}).catch(e=>{if(active&&e.name!=='AbortError')setError('UNAVAILABLE — leitura territorial indisponível.')})
  return()=>{active=false;controller.abort()}
 },[key,clientId])
 useEffect(()=>{const update=()=>setOffline(!navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[])
 const result=data?.key===key?data.value:null,properties=result?.territories.flatMap(t=>t.properties.map(p=>({...p,producer:t.producer})))||[],fields=properties.filter(p=>!property||p.id===property).flatMap(p=>p.fields.map(f=>({...f,property:p}))),filtered=fields.filter(f=>(!field||f.id===field)&&(!season||f.season===season))
 const chooseProperty=id=>{setProperty(id);setField('');setFocus(null);setFocusRevision(n=>n+1)}
 const chooseField=(id,pid=property)=>{setField(id);if(pid)setProperty(pid);setFocus(id?{property_id:pid,field_id:id}:null);setFocusRevision(n=>n+1)}
 const focusCard=target=>{const found=resolveTerritorialFocus(properties,target);if(!found){setError('GEOMETRY_UNAVAILABLE — versão ou vínculo do contorno mudou; atualize as evidências.');return}setProperty(found.property.id);setField(found.field.id);setSeason(found.field.season||'');setShowFields(true);setShowProperties(true);setFocus(target);setFocusRevision(n=>n+1);mapSection.current?.scrollIntoView?.({behavior:'smooth',block:'start'})}
 const polygons=useMemo(()=>territorialLayers(properties,{propertyId:property,fieldId:field,season,showFields,showProperties,onProperty:chooseProperty,onField:chooseField}),[result,property,field,season,showFields,showProperties])
 const focused=resolveTerritorialFocus(properties,focus),focusPoints=focused?.points||geometryPoints(properties.find(p=>p.id===property)?.geometry)
 const pins=properties.filter(p=>!property||p.id===property).flatMap((p,index)=>{
  const points=geometryPoints(usableGeometry(p.geometry)),location=p.metadata?.location||(points.length?{lat:(Math.min(...points.map(point=>point.lat))+Math.max(...points.map(point=>point.lat)))/2,lng:(Math.min(...points.map(point=>point.lng))+Math.max(...points.map(point=>point.lng)))/2}:null)
  return location?[{id:p.id,propertyId:p.id,...location,label:String(index+1),title:p.name,caption:p.name,selected:p.id===property}]:[]
 })
 if(result&&!result.enabled)return null
 const cards=(result?.cards||[]).filter(c=>(!property||c.property.id===property)&&(!field||c.field.id===field)&&(!season||c.season===season)).slice(0,5)
 return <section className="agro-territory" aria-label="Inteligência territorial"><header><h2>Talhões que precisam de atenção</h2><button onClick={()=>setRevision(n=>n+1)}>Atualizar território</button></header>
 {offline&&<p role="status">{result?'STALE_CACHE — última leitura desta sessão.':'OFFLINE — sem leitura disponível.'}</p>}
 {error?<p role="alert">{error}</p>:!result?<p role="status">Consultando evidências territoriais…</p>:<><p>{properties.length} propriedades · {filtered.length} talhões · {result.territories.reduce((n,t)=>n+t.unlinked.length,0)} registros sem vínculo. Clima atual: fonte ainda não conectada.</p>
 {map&&<div ref={mapSection} className="agro-map-section"><div className="agro-territory-filters">
  <label>Propriedade<select value={property} onChange={e=>chooseProperty(e.target.value)}><option value="">Todas</option>{properties.map(p=><option key={p.id} value={p.id}>{p.producer.name} · {p.name}</option>)}</select></label>
  <label>Talhão<select value={field} onChange={e=>{const f=fields.find(f=>f.id===e.target.value);chooseField(e.target.value,f?.property.id)}}><option value="">Todos</option>{fields.map(f=><option key={f.id} value={f.id}>{f.name} · {f.crop||'Cultura desconhecida'}</option>)}</select></label>
  <label>Safra<select value={season} onChange={e=>setSeason(e.target.value)}><option value="">Todas</option>{[...new Set(fields.map(f=>f.season).filter(Boolean))].map(s=><option key={s}>{s}</option>)}</select></label>
  <label className="agro-layer-toggle"><input type="checkbox" checked={showProperties} onChange={e=>setShowProperties(e.target.checked)}/>Contorno da propriedade</label>
  <label className="agro-layer-toggle"><input type="checkbox" checked={showFields} onChange={e=>setShowFields(e.target.checked)}/>Contornos disponíveis</label></div>
  {(polygons.length||pins.length)&&!offline?<SatelliteMap viewKey={`agro:${key}`} polygons={polygons} pins={pins} onPinClick={pin=>chooseProperty(pin.propertyId)} focusPoints={focusPoints} focusKey={`${property}:${field}:${season}:${focusRevision}`} height={360} fit label="Mapa territorial governado" clientId={clientId||null}/>:<p role="status">GEOMETRY_UNAVAILABLE — não há contorno válido visível. Ative as camadas, vincule uma geometria válida ou restabeleça a rede.</p>}
  <p aria-label="Legenda">Azul tracejado: propriedade · Verde: talhão · Âmbar: talhão selecionado. Cadastros adicionais são referências e não comprovam titularidade.</p>
  {focused&&<p role="status">Foco: {focused.property.name} / {focused.field.name} · Geometria {focused.field.geometry_version||'sem versão'} · Área {focused.field.area_ha??'não informada'} ha · Fonte {focused.field.source||'canonical'} · Referência {focused.field.source_ref}</p>}
 </div>}
 {cardsVisible&&(cards.length?<div className="agro-territory-grid">{cards.map(c=><AgronomicDecisionCard key={c.id} card={c} onFocus={map?focusCard:null}/>)}</div>:<p role="status">INSUFFICIENT_EVIDENCE — sem sinal agronômico vinculado. Confirme produtor, propriedade, talhão, safra e uma observação datada com fonte.</p>)}
 </>}
 </section>
}
