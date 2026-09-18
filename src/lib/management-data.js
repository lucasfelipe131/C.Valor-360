import {visitLifecycle} from './home-command-center.js'
import {routeLocation,approximateDistanceKm} from './visit-route.js'

export const managementStatusLabels={PLANNED:'Programada',PREPARED:'Preparada',IN_PROGRESS:'Em andamento',COMPLETED_PENDING_REVIEW:'Aguardando revisão',COMPLETED:'Realizada',CANCELLED:'Cancelada'}
export const managementVisitStatus=visit=>visitLifecycle({status:visit.status,lifecycleStatus:visit.lifecycle_status||visit.lifecycleStatus})

/** Missing or interrupted tracking cannot become zero or an imaginary straight line. */
// Um ponto de GPS espurio - salto de antena, reaquisicao de sinal depois de tunel ou sombra de
// mata - entrava na quilometragem gerencial como deslocamento real. Medido: um unico salto de
// 79,5 km em 105 s virava 80,6 km no painel do gestor, quando o trajeto de verdade era 1,1 km. A
// velocidade implicita era 2.726 km/h. Nenhum deslocamento terrestre chega perto do teto abaixo,
// entao o trecho e descartado - e contado, porque numero que muda sem dizer que mudou e o mesmo
// defeito que o corte silencioso.
export const maxGroundSpeedKmh=200
// A regra vive num lugar so. Ela entrou primeiro no painel do gestor e a tela do consultor ficou com
// a regra antiga: no mesmo trace do mesmo dia, o consultor lia "81 km registrados por GPS" e o gestor
// lia 1,2 km. Dois numeros para o mesmo percurso, e o aviso que explica o descarte existia so num
// dos dois lados.
export const implausibleGroundStep=(distanceKm,seconds)=>Number.isFinite(distanceKm)&&Number.isFinite(seconds)&&seconds>0&&distanceKm/(seconds/3600)>maxGroundSpeedKmh
export function recordedTravel(trace){
 let previous=null,segments=0,distanceKm=0,recordedSeconds=0,discardedSegments=0
 for(const value of Array.isArray(trace)?trace:[]){
  const point=routeLocation(value),at=Date.parse(value?.timestamp)
  if(!point||!Number.isFinite(at)){previous=null;continue}
  if(previous){
   const seconds=(at-previous.at)/1000
   if(seconds>0&&seconds<=120){
    const stepKm=approximateDistanceKm(previous,point)
    if(implausibleGroundStep(stepKm,seconds))discardedSegments++
    else{distanceKm+=stepKm;recordedSeconds+=seconds;segments++}
   }
  }
  previous={...point,at}
 }
 return {distanceKm:segments?distanceKm:null,recordedSeconds:segments?recordedSeconds:null,segments,discardedSegments,dataStatus:segments?'DERIVED DATA':'MISSING'}
}

export function summarizeManagement({producers=[],visits=[],routes=[]}){
 const completed=visits.filter(visit=>visit.lifecycleStatus==='COMPLETED')
 const recorded=routes.filter(route=>route.distanceKm!==null)
 return {producers:producers.length,visits:visits.length,completed:completed.length,
  reached:new Set(completed.map(visit=>visit.clientId)).size,
  pending:visits.filter(visit=>visit.lifecycleStatus==='COMPLETED_PENDING_REVIEW').length,
  reports:visits.filter(visit=>visit.report).length,
  recordedKm:recorded.length?recorded.reduce((sum,route)=>sum+route.distanceKm,0):null,
  recordedDays:recorded.length,
  discardedSegments:routes.reduce((sum,route)=>sum+(Number(route.discardedSegments)||0),0),
  dataStatus:'DERIVED DATA'}
}

// O corte de 5.000 linhas era avisado so na tela. Quem abria o CSV no Power BI depois - ou recebia
// o arquivo por e-mail - lia 5.000 produtores como a carteira inteira, sem nada NO ARQUIVO dizendo
// o contrario. A abrangencia vira coluna repetida em toda linha: sobrevive a filtro, a ordenacao e
// a reexportacao, e nao quebra o parser como um rodape quebraria.
export function csvExportScope({truncated=false,rows=0,total=0}={}){
 return truncated?`PARCIAL: ${rows} de ${total} produtores da carteira`:'COMPLETO no filtro aplicado'
}
export const csvExportIsPartial=scope=>String(scope||'').startsWith('PARCIAL')

// Stable column names and a UTF-8 BOM for Power Query. User strings are never formulas.
export function managementCsv(columns,rows){
 const cell=value=>{
  let text=value==null?'':String(value)
  if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+\-@]/u.test(text))text=`'${text}`
  return `"${text.replaceAll('"','""')}"`
 }
 return '\uFEFF'+[columns.map(column=>cell(column.key)).join(','),...rows.map(row=>columns.map(column=>cell(row[column.key])).join(','))].join('\r\n')+'\r\n'
}
