import React,{useMemo} from 'react'
import {MapPin} from 'lucide-react'
import SatelliteMap from './SatelliteMap'
import {buildRouteStops} from '../../lib/property-map'

// Rota das próximas visitas sobre imagem de satélite. Só entra no mapa quem
// tem a sede localizada no perfil; quem não tem aparece na lista como
// "sem localização" — sem pino aproximado, sem geocodificação escondida.

const when=at=>at.toLocaleString('pt-BR',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).replace('.','')

export default function RouteMap({visits=[],clients=[],height=300}){
 const {stops,missing,route}=useMemo(()=>buildRouteStops({visits,clients}),[visits,clients])
 if(!stops.length&&!missing.length)return <p className="route-map-empty">Nenhum compromisso futuro registrado. Agende uma visita para montar a próxima rota.</p>
 return <div className="route-map">
  {stops.length
   ?<SatelliteMap pins={stops.map(stop=>({lat:stop.lat,lng:stop.lng,label:String(stop.order),title:stop.name}))} route={route} height={height} label="Rota das próximas visitas sobre imagem de satélite"/>
   :<p className="route-map-empty"><MapPin size={16}/>Nenhuma das próximas visitas tem a propriedade localizada. Marque a sede no perfil do produtor e a rota aparece aqui sobre a imagem de satélite.</p>}
  <ol className="route-map-stops" aria-label="Paradas da rota">
   {stops.map(stop=><li key={stop.visitId}><b>{stop.order}</b><div><strong>{stop.name}</strong><span>{when(stop.at)}{stop.place?` • ${stop.place}`:''}</span></div></li>)}
   {missing.map(stop=><li key={stop.visitId} className="is-missing"><b>?</b><div><strong>{stop.name}</strong><span>{when(stop.at)} • sem localização cadastrada</span></div></li>)}
  </ol>
 </div>
}
