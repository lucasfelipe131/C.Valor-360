// Geometria local da agenda: nenhuma chamada de rede e nenhuma estimativa de
// trânsito. Toda distância abaixo é aproximada, em linha reta (haversine).
import {visitLifecycle,visitMoment} from './home-command-center.js'
import {opportunityFromAdditionalNeed} from './profile.js'

const text=value=>String(value??'').trim()
const key=value=>text(value)
const list=value=>Array.isArray(value)?value:[]
const visited=new Set(['COMPLETED'])
const active=new Set(['IN_PROGRESS','COMPLETED_PENDING_REVIEW'])
const planned=new Set(['PLANNED','PREPARED'])
const toneOf=lifecycle=>visited.has(lifecycle)?'visited':active.has(lifecycle)?'current':'planned'

// Não converter vazio, booleanos ou coleções em 0: isso inventaria uma sede.
const coordinate=value=>{
 if(!['string','number'].includes(typeof value)||text(value)==='')return null
 const number=Number(value)
 return Number.isFinite(number)?number:null
}
export function routeLocation(value){
 if(!value||typeof value!=='object')return null
 const lat=coordinate(value.lat??value.latitude);const lng=coordinate(value.lng??value.longitude)
 return lat===null||lng===null||Math.abs(lat)>90||Math.abs(lng)>180?null:{lat,lng}
}

const dayKey=at=>`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,'0')}-${String(at.getDate()).padStart(2,'0')}`
const selectedDay=value=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text(value)))return null
 const date=new Date(`${value}T00:00:00`)
 return Number.isNaN(date.getTime())||dayKey(date)!==value?null:date
}
const moment=visit=>visitMoment({...visit,scheduledAt:visit.scheduledAt||visit.scheduled_at})
const isFlexible=stop=>{
 if(!planned.has(stop.lifecycle))return false
 const visit=stop.visit||{}
 if(visit.timeFlexible===true)return true
 // scheduledAt inclui um horário confirmado; a data simples não inclui.
 return !text(visit.time)&&!/[T ]\d{2}:\d{2}/.test(text(visit.scheduledAt||visit.scheduled_at))
}
const renumber=stops=>stops.map((stop,index)=>({...stop,order:index+1}))

/**
 * Retorna Stop[]; location:null mantém a visita na mesma numeração da lista.
 * A data é o dia civil local, nunca a parte UTC de uma string ISO. Visitas em
 * andamento ou aguardando revisão de dias anteriores continuam visíveis.
 * Histórico, atual e planejadas formam grupos; cada grupo começa cronológico.
 * orderedIds só altera blocos flexíveis consecutivos, sem atravessar horários
 * fixos, o histórico ou a visita atual. allowManualOrder:true permite a ordem
 * explícita das planejadas, preservando o prefixo de visitas realizadas/ativas
 * e todos os horários registrados. Não altera a agenda persistida.
 */
export function buildDayItinerary({visits=[],clients=[],date,orderedIds=[],allowManualOrder=false}={}){
 const day=selectedDay(date)
 if(!day)return []
 const nextDay=new Date(day);nextDay.setDate(nextDay.getDate()+1)
 const byClient=new Map(list(clients).filter(Boolean).map(client=>[key(client.id),client]))
 const stops=list(visits).filter(Boolean).map(visit=>({visit,at:moment(visit),lifecycle:visitLifecycle(visit)}))
  .filter(({at,lifecycle})=>at&&lifecycle!=='CANCELLED'&&(dayKey(at)===date||(active.has(lifecycle)&&at<nextDay)))
  .sort((left,right)=>{
   const rank=state=>visited.has(state)?0:active.has(state)?1:2
   return rank(left.lifecycle)-rank(right.lifecycle)||left.at-right.at
  })
  .map(({visit,at,lifecycle})=>{
   const clientId=visit.clientId??visit.client_id
   const client=byClient.get(key(clientId))||null
   return {visitId:visit.id,clientId,name:text(client?.name)||'Produtor não vinculado',place:text(client?.commercial?.property)||text(client?.municipality),at,lifecycle,tone:toneOf(lifecycle),location:routeLocation(client?.location),visit,client}
  })
 const order=new Map(list(orderedIds).map((id,index)=>[key(id),index]))
 const canReorder=stop=>allowManualOrder===true?planned.has(stop.lifecycle):isFlexible(stop)
 for(let start=0;start<stops.length;){
  if(!canReorder(stops[start])){start+=1;continue}
  let end=start+1
  while(end<stops.length&&canReorder(stops[end]))end+=1
  const block=stops.slice(start,end).sort((a,b)=>(order.get(key(a.visitId))??Infinity)-(order.get(key(b.visitId))??Infinity))
  stops.splice(start,end-start,...block);start=end
 }
 return renumber(stops)
}

/** Distância aproximada, em linha reta; null quando falta uma coordenada. */
export function approximateDistanceKm(from,to){
 const a=routeLocation(from);const b=routeLocation(to)
 if(!a||!b)return null
 const radians=degrees=>degrees*Math.PI/180
 const dLat=radians(b.lat-a.lat);const dLng=radians(b.lng-a.lng)
 const hav=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLng/2)**2
 return 6371.0088*2*Math.atan2(Math.sqrt(Math.min(1,hav)),Math.sqrt(Math.max(0,1-hav)))
}

const archived=client=>client.archived===true||client.isArchived===true||Boolean(client.archivedAt||client.archived_at)||/^(archived|arquivado|arquivada)$/i.test(text(client.status))
const recordedReason=client=>{
 const opportunity=typeof client.commercial?.opportunity==='string'?opportunityFromAdditionalNeed(client.commercial.opportunity):''
 if(opportunity)return {reason:`Registro comercial: ${opportunity}`,reasonSource:'commercial.opportunity'}
 const need=typeof client.additionalNeed==='string'?opportunityFromAdditionalNeed(client.additionalNeed):''
 if(need)return {reason:`Necessidade registrada: ${need}`,reasonSource:'additionalNeed'}
 if(/^alta$/i.test(text(client.commercial?.priority)))return {reason:'Prioridade alta registrada na carteira.',reasonSource:'commercial.priority'}
 return {reason:'Produtor cadastrado próximo de uma parada da rota.',reasonSource:'proximity'}
}

const currentAnchor=stops=>[...stops].reverse().find(stop=>stop.lifecycle==='IN_PROGRESS'&&routeLocation(stop.location))||null

/**
 * Sugere inserções na parte restante da rota. Âncora: visita atual localizada,
 * origem informada ou primeira visita planejada localizada. Nunca usa uma visita
 * concluída como posição atual. Sem âncora elegível, retorna [].
 *
 * distanceKm é a proximidade à extremidade conhecida mais próxima da inserção;
 * maxKm limita essa proximidade. detourKm = A→P + P→B − A→B; ao fim da rota,
 * equivale a A→P. Ordenação por desvio, depois proximidade e nome. Coordenadas
 * ausentes quebram os segmentos: não calculamos um trajeto através delas.
 * afterVisitId/beforeVisitId descrevem a sugestão; não criam uma visita.
 */
export function getNearbySuggestions({stops=[],clients=[],origin=null,maxKm=20,limit=4}={}){
 const itinerary=list(stops)
 const radius=coordinate(maxKm);const count=coordinate(limit)
 if(radius===null||radius<0||count===null||count<1)return []
 const current=currentAnchor(itinerary)
 const future=itinerary.filter(stop=>planned.has(stop.lifecycle))
 const originLocation=routeLocation(origin)
 let anchor=current?{visitId:current.visitId,location:routeLocation(current.location)}:originLocation?{visitId:null,location:originLocation}:null
 let remaining=future
 if(!anchor){
  const first=future[0]
  if(!first||!routeLocation(first.location))return []
  anchor={visitId:first.visitId,location:routeLocation(first.location)};remaining=future.slice(1)
 }
 const nodes=[anchor,...remaining.map(stop=>({visitId:stop.visitId,location:routeLocation(stop.location)}))]
 const segments=[]
 for(let index=0;index<nodes.length;index+=1){
  const from=nodes[index];const to=nodes[index+1]||null
  if(from.location&&(!to||to.location))segments.push({from,to})
 }
 if(!segments.length)return []
 const scheduled=new Set(itinerary.map(stop=>key(stop.clientId)).filter(Boolean))
 const seen=new Set()
 const suggestions=[]
 for(const client of list(clients)){
  if(!client||!key(client.id)||seen.has(key(client.id))||scheduled.has(key(client.id))||archived(client))continue
  seen.add(key(client.id))
  const location=routeLocation(client.location)
  if(!location)continue
  let best=null
  for(const {from,to} of segments){
   const fromKm=approximateDistanceKm(from.location,location)
   const toKm=to?approximateDistanceKm(location,to.location):null
   const distanceKm=to?Math.min(fromKm,toKm):fromKm
   if(distanceKm>radius)continue
   const detourKm=Math.max(0,to?fromKm+toKm-approximateDistanceKm(from.location,to.location):fromKm)
   if(!best||detourKm<best.detourKm||(detourKm===best.detourKm&&distanceKm<best.distanceKm))best={distanceKm,detourKm,afterVisitId:from.visitId,beforeVisitId:to?.visitId??null}
  }
  if(best)suggestions.push({clientId:client.id,client,name:text(client.name)||'Produtor cadastrado',place:text(client.commercial?.property)||text(client.municipality),location,...best,...recordedReason(client),approximate:true,distanceLabel:'Distância aproximada em linha reta'})
 }
 return suggestions.sort((a,b)=>a.detourKm-b.detourKm||a.distanceKm-b.distanceKm||a.name.localeCompare(b.name,'pt-BR')).slice(0,Math.floor(count))
}

const pathLength=(block,before,after)=>{
 const points=[before,...block.map(stop=>routeLocation(stop.location)),after].filter(Boolean)
 return points.slice(1).reduce((sum,point,index)=>sum+approximateDistanceKm(points[index],point),0)
}

/**
 * Proposta visitId[] para revisão, sem mutação nem gravação. Horários explícitos
 * são fixos, salvo timeFlexible:true. Somente blocos flexíveis consecutivos e
 * inteiramente localizados podem mudar. A heurística de vizinho mais próximo
 * só é aceita se reduzir a distância geométrica do bloco, incluindo as bordas
 * conhecidas. Não garante tempo de chegada nem viabilidade por estradas.
 */
export function proposeRouteOrder(stops,{origin=null}={}){
 const result=list(stops).slice()
 const active=currentAnchor(result)
 const initial=routeLocation(active?.location)||routeLocation(origin)
 for(let start=0;start<result.length;){
  if(!isFlexible(result[start])){start+=1;continue}
  let end=start+1
  while(end<result.length&&isFlexible(result[end]))end+=1
  const original=result.slice(start,end)
  if(original.length<2||original.some(stop=>!routeLocation(stop.location))){start=end;continue}
  const previous=result[start-1]
  const before=previous&&(planned.has(previous.lifecycle)||previous.lifecycle==='IN_PROGRESS')?routeLocation(previous.location):initial
  const after=routeLocation(result[end]?.location)
  const pool=original.slice();const proposal=[]
  let anchor=before
  if(!anchor){const first=pool.shift();proposal.push(first);anchor=routeLocation(first.location)}
  while(pool.length){
   let nearest=0
   for(let index=1;index<pool.length;index+=1)if(approximateDistanceKm(anchor,pool[index].location)<approximateDistanceKm(anchor,pool[nearest].location))nearest=index
   const next=pool.splice(nearest,1)[0];proposal.push(next);anchor=routeLocation(next.location)
  }
  if(pathLength(proposal,before,after)+0.000001<pathLength(original,before,after))result.splice(start,end-start,...proposal)
  start=end
 }
 return result.map(stop=>stop.visitId)
}
