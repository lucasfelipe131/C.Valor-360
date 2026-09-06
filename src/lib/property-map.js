// Mapa da propriedade e rota das visitas — só geometria e ordenação, sem
// chamada de rede. Quem tem coordenada entra no mapa; quem não tem aparece
// como "sem localização", nunca como um pino inventado.
import {visitLifecycle,visitMoment} from './home-command-center.js'

export const SATELLITE_TILES={
 url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
 attribution:'Imagem © Esri, Maxar, Earthstar Geographics e colaboradores',
 maxZoom:19
}
// Sem pino registrado o mapa abre no país inteiro: é o único enquadramento
// honesto quando não se sabe onde a propriedade fica.
export const BRAZIL_VIEW={center:[-15.6,-52.5],zoom:4}

const METERS_PER_DEGREE_LAT=110_540
const METERS_PER_DEGREE_LNG=111_320
const finite=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null}

export function validLocation(value){
 if(!value||typeof value!=='object')return null
 const lat=finite(value.lat??value.latitude);const lng=finite(value.lng??value.longitude)
 if(lat===null||lng===null||lat<-90||lat>90||lng<-180||lng>180)return null
 return {lat,lng}
}

// Shoelace em metros projetados na latitude média do polígono. Para talhões
// (quilômetros, não continentes) o erro fica bem abaixo da incerteza de quem
// marca os cantos tocando na tela.
export function polygonAreaHa(points){
 const ring=(points||[]).map(validLocation).filter(Boolean)
 if(ring.length<3)return 0
 const meanLat=ring.reduce((sum,point)=>sum+point.lat,0)/ring.length
 const kx=METERS_PER_DEGREE_LNG*Math.cos(meanLat*Math.PI/180)
 let twice=0
 for(let index=0;index<ring.length;index+=1){
  const a=ring[index];const b=ring[(index+1)%ring.length]
  twice+=(a.lng*kx)*(b.lat*METERS_PER_DEGREE_LAT)-(b.lng*kx)*(a.lat*METERS_PER_DEGREE_LAT)
 }
 return Math.abs(twice)/2/10_000
}

export function centroidOf(points){
 const ring=(points||[]).map(validLocation).filter(Boolean)
 if(!ring.length)return null
 return {lat:ring.reduce((sum,point)=>sum+point.lat,0)/ring.length,lng:ring.reduce((sum,point)=>sum+point.lng,0)/ring.length}
}

export function boundsOf(points){
 const ring=(points||[]).map(validLocation).filter(Boolean)
 if(!ring.length)return null
 const lats=ring.map(point=>point.lat);const lngs=ring.map(point=>point.lng)
 return [[Math.min(...lats),Math.min(...lngs)],[Math.max(...lats),Math.max(...lngs)]]
}

export function formatCoordinates(location){
 const point=validLocation(location)
 return point?`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`:''
}

export function formatHectares(value){
 const number=finite(value)
 if(number===null)return '—'
 return `${number.toLocaleString('pt-BR',{maximumFractionDigits:number<10?2:1})} ha`
}

const OPEN_LIFECYCLES=new Set(['PLANNED','PREPARED','IN_PROGRESS'])

// Próximas visitas em ordem de horário, separadas entre as que têm sede
// localizada (viram parada) e as que não têm (viram aviso).
export function buildRouteStops({visits=[],clients=[],now=Date.now(),limit=8}={}){
 const upcoming=(visits||[])
  .map(visit=>({visit,at:visitMoment(visit)}))
  .filter(({visit,at})=>at&&at.getTime()>=now&&OPEN_LIFECYCLES.has(visitLifecycle(visit)))
  .sort((left,right)=>left.at-right.at)
  .slice(0,limit)
 const stops=[];const missing=[]
 for(const {visit,at} of upcoming){
  const client=(clients||[]).find(item=>String(item.id)===String(visit.clientId))||null
  const location=validLocation(client?.location)
  const base={visitId:visit.id,clientId:visit.clientId,name:client?.name||'Produtor não vinculado',place:client?.commercial?.property||client?.municipality||'',at}
  if(location)stops.push({...base,...location,order:stops.length+1})
  else missing.push(base)
 }
 return {stops,missing,route:stops.map(stop=>[stop.lat,stop.lng])}
}
