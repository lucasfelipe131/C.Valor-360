import React,{useEffect,useMemo,useState} from 'react'
import SatelliteMap from './SatelliteMap'
import {validLocation} from '../../lib/property-map'

// Reuses the route/editor map and canonical producer workspace. No parallel
// property store, geocoding guess, GPS capture or automatic route mutation.
export default function HomeVisitMap({entries=[],clients=[],storageScope='',onOpenProperty}){
 const clientIds=[...new Set(entries.map(entry=>String(entry.clientId||entry.client?.id||'')).filter(Boolean))]
 const signature=JSON.stringify(clientIds)
 const [state,setState]=useState({pins:[],loading:true,error:''})
 useEffect(()=>{
  const ids=JSON.parse(signature),controller=new AbortController();let active=true
  setState({pins:[],loading:Boolean(ids.length),error:''})
  if(!ids.length)return()=>controller.abort()
  fetch('/api/visit-routes/properties',{signal:controller.signal}).then(async response=>{
   if(response.status===401)window.dispatchEvent(new Event('valor360:unauthorized'))
   if(!response.ok)throw new Error('Não foi possível carregar as propriedades.')
   return response.json()
  }).then(data=>{
   if(!active)return
   const pins=(data.properties||[]).filter(property=>ids.includes(String(property.clientId))).flatMap(property=>{
    const location=validLocation(property.location)
    return location&&property.id?[{...location,id:`${property.clientId}:${property.id}`,clientId:String(property.clientId),propertyId:String(property.id),propertyName:property.name}]:[]
   })
   setState({pins,loading:false,error:ids.some(id=>!pins.some(pin=>pin.clientId===id))?'Há produtores do roteiro sem propriedade localizada. Abra o cadastro para conferir.':''})
  }).catch(error=>{if(active&&!controller.signal.aborted)setState({pins:[],loading:false,error:error.message})})
  return()=>{active=false;controller.abort()}
 },[signature,storageScope])
 const pins=useMemo(()=>state.pins.flatMap(pin=>{
  const client=clients.find(item=>String(item.id)===pin.clientId)
  return client?[{...pin,title:`${client.name} · ${pin.propertyName||'Propriedade'}`,displayName:client.name,label:'',tone:'planned'}]:[]
 }),[state.pins,clients])
 return <div className="home-visit-map">
  {state.loading?<p role="status">Carregando propriedades das próximas visitas…</p>:<SatelliteMap viewKey={`home:${storageScope}`} pins={pins} height={330} label="Propriedades das próximas visitas" controls={false} onPinClick={pin=>{const client=clients.find(item=>String(item.id)===pin.clientId);if(client)onOpenProperty?.(client,pin.propertyId)}}/>}
  {state.error&&<p role="status">{state.error}</p>}
 </div>
}
