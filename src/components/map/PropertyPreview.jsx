import React,{useEffect,useState} from 'react'
import {MapPin} from 'lucide-react'
import SatelliteMap from './SatelliteMap'
import {validLocation} from '../../lib/property-map'

// Leitura da propriedade para quem vai visitar: sede e talhões sobre o
// satélite. Sem localização registrada, diz isso e aponta onde registrar.

export default function PropertyPreview({client,height=220}){
 const [profile,setProfile]=useState(null)
 const [state,setState]=useState({loading:true,error:''})

 useEffect(()=>{
  if(!client?.id){setProfile(null);setState({loading:false,error:''});return}
  const controller=new AbortController()
  setState({loading:true,error:''})
  fetch(`/api/clients/${encodeURIComponent(client.id)}/property`,{signal:controller.signal}).then(async response=>{
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}
   const payload=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(payload.error||'A propriedade não pôde ser carregada agora.')
   return payload
  }).then(payload=>{if(payload)setProfile(payload);setState({loading:false,error:''})})
   .catch(error=>{if(error.name!=='AbortError')setState({loading:false,error:error.message})})
  return()=>controller.abort()
 },[client?.id])

 const location=validLocation(profile?.property?.location)||validLocation(client?.location)
 const fields=(profile?.fields||[]).filter(field=>Array.isArray(field.points)&&field.points.length>=3)

 if(state.loading)return <p className="property-preview-note">Carregando propriedade…</p>
 if(state.error)return <p className="property-preview-note is-error" role="status">{state.error}</p>
 if(!location&&!fields.length)return <p className="property-preview-note"><MapPin size={15}/>Propriedade sem localização no mapa. Marque a sede no perfil do produtor para ver o caminho e os talhões aqui.</p>
 const count=fields.length
 return <div className="property-preview">
  <SatelliteMap center={location} pins={location?[{...location,label:'',title:profile?.property?.name||'Sede'}]:[]} polygons={fields.map(field=>({points:field.points,label:field.name}))} height={height} label={`Propriedade de ${client?.name||'produtor'} sobre imagem de satélite`}/>
  <p className="property-preview-caption">{profile?.property?.name||'Propriedade'} • {count===0?'sem talhões com contorno':count===1?'1 talhão com contorno':`${count} talhões com contorno`}</p>
 </div>
}
