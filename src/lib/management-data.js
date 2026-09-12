import {visitLifecycle} from './home-command-center.js'
import {routeLocation,approximateDistanceKm} from './visit-route.js'

export const managementStatusLabels={PLANNED:'Programada',PREPARED:'Preparada',IN_PROGRESS:'Em andamento',COMPLETED_PENDING_REVIEW:'Aguardando revisão',COMPLETED:'Realizada',CANCELLED:'Cancelada'}
export const managementVisitStatus=visit=>visitLifecycle({status:visit.status,lifecycleStatus:visit.lifecycle_status||visit.lifecycleStatus})

/** Missing or interrupted tracking cannot become zero or an imaginary straight line. */
export function recordedTravel(trace){
 let previous=null,segments=0,distanceKm=0,recordedSeconds=0
 for(const value of Array.isArray(trace)?trace:[]){
  const point=routeLocation(value),at=Date.parse(value?.timestamp)
  if(!point||!Number.isFinite(at)){previous=null;continue}
  if(previous){
   const seconds=(at-previous.at)/1000
   if(seconds>0&&seconds<=120){distanceKm+=approximateDistanceKm(previous,point);recordedSeconds+=seconds;segments++}
  }
  previous={...point,at}
 }
 return {distanceKm:segments?distanceKm:null,recordedSeconds:segments?recordedSeconds:null,segments,dataStatus:segments?'DERIVED DATA':'MISSING'}
}

export function summarizeManagement({producers=[],visits=[],routes=[]}){
 const completed=visits.filter(visit=>visit.lifecycleStatus==='COMPLETED')
 const recorded=routes.filter(route=>route.distanceKm!==null)
 return {producers:producers.length,visits:visits.length,completed:completed.length,
  reached:new Set(completed.map(visit=>visit.clientId)).size,
  pending:visits.filter(visit=>visit.lifecycleStatus==='COMPLETED_PENDING_REVIEW').length,
  reports:visits.filter(visit=>visit.report).length,
  recordedKm:recorded.length?recorded.reduce((sum,route)=>sum+route.distanceKm,0):null,
  recordedDays:recorded.length,dataStatus:'DERIVED DATA'}
}

// Stable column names and a UTF-8 BOM for Power Query. User strings are never formulas.
export function managementCsv(columns,rows){
 const cell=value=>{
  let text=value==null?'':String(value)
  if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+\-@]/u.test(text))text=`'${text}`
  return `"${text.replaceAll('"','""')}"`
 }
 return '\uFEFF'+[columns.map(column=>cell(column.key)).join(','),...rows.map(row=>columns.map(column=>cell(row[column.key])).join(','))].join('\r\n')+'\r\n'
}
