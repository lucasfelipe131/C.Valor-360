import React,{useEffect,useMemo,useRef,useState} from 'react'
import {ArrowDown,ArrowUp,BrainCircuit,CalendarDays,Check,Clock3,ExternalLink,List,LocateFixed,Map,MapPin,Navigation,Pause,Plus,Route,Search,Sparkles} from 'lucide-react'
import SatelliteMap from './SatelliteMap'
import useRouteTracking from './useRouteTracking'
import {buildDayItinerary,getNearbySuggestions,proposeRouteOrder} from '../../lib/visit-route'
import {routeDayPath,routeRequest,routeTimeZone} from '../../lib/visit-route-api'
import '../../val-visit-routes.css'

const today=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`}
const clock=at=>at instanceof Date&&!Number.isNaN(at.getTime())?at.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'Sem horário'
const km=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})
const labels={COMPLETED:'Visitada',COMPLETED_PENDING_REVIEW:'Aguardando relato',IN_PROGRESS:'Em andamento',PREPARED:'Preparada',PLANNED:'Programada'}
const pathDistance=points=>points.slice(1).reduce((sum,point,index)=>{const a=points[index];const radians=Math.PI/180;const dlat=(point.lat-a.lat)*radians;const dlng=(point.lng-a.lng)*radians;const value=Math.sin(dlat/2)**2+Math.cos(a.lat*radians)*Math.cos(point.lat*radians)*Math.sin(dlng/2)**2;return sum+6371*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value))},0)

export default function RouteMap({visits=[],clients=[],storageScope='',onAddClient,onPrepareVisit,onOpenVisit,onOpenClient}){
 const [date,setDate]=useState(today)
 const [view,setView]=useState('map')
 const [search,setSearch]=useState('')
 const [propertyState,setPropertyState]=useState({scope:null,items:[],loading:true,error:''})
 const [showNames,setShowNames]=useState(true)
 const [propertyLimit,setPropertyLimit]=useState(30)
 const [propertyRetry,setPropertyRetry]=useState(0)
 const propertyRevision=JSON.stringify(clients.map(client=>[client.id,client.updatedAt,client.location]))
 const properties=propertyState.scope===storageScope?propertyState.items:[]
 const propertiesLoading=propertyState.scope!==storageScope||propertyState.loading
 const query=search.trim().toLocaleLowerCase('pt-BR')
 const visibleProperties=properties.filter(item=>`${item.producerName} ${item.name} ${item.municipality||''}`.toLocaleLowerCase('pt-BR').includes(query))
 const [orderedIds,setOrderedIds]=useState([])
 const [trace,setTrace]=useState([])
 const [position,setPosition]=useState(null)
 const [selectedId,setSelectedId]=useState('')
 const [road,setRoad]=useState(null)
 const [roadBusy,setRoadBusy]=useState(false)
 const [notice,setNotice]=useState('')
 const [error,setError]=useState('')
 const [saving,setSaving]=useState(false)
 const [proposal,setProposal]=useState(null)
 const [detours,setDetours]=useState({})
 const [detourBusy,setDetourBusy]=useState('')
 const [maxKm,setMaxKm]=useState(20)
 const loadedDay=useRef('')
 const selectedKey=useRef('')
 const generation=useRef(0)
 const tracking=useRouteTracking({date,storageScope,onTrace:setTrace,onPosition:setPosition,onError:setError})
 const stops=useMemo(()=>buildDayItinerary({visits,clients,date,orderedIds,allowManualOrder:true}),[visits,clients,date,orderedIds])
 const suggestions=useMemo(()=>getNearbySuggestions({stops,clients,origin:date===today()?position:null,maxKm,limit:4}),[stops,clients,position,maxKm,date])
 const selected=stops.find(stop=>String(stop.visitId)===selectedId)
 const selectedSuggestion=suggestions.find(item=>`suggestion:${item.clientId}`===selectedId)
 const selectedProperty=properties.find(item=>`property:${item.id}`===selectedId)
 const remainingStops=stops.filter(stop=>stop.tone!=='visited'&&stop.lifecycle!=='COMPLETED_PENDING_REVIEW')
 const missingRemaining=remainingStops.filter(stop=>!stop.location)
 const remaining=remainingStops.filter(stop=>stop.location)
 const drivingEntries=remaining
 const drivingIds=drivingEntries.map(stop=>stop.clientId)
 const drivingOrigin=remaining.some(stop=>stop.lifecycle==='IN_PROGRESS')?null:(date===today()?position:null)
 const drivingInput={clientIds:drivingIds,...(drivingOrigin?{origin:{lat:drivingOrigin.lat,lng:drivingOrigin.lng}}:{})}
 const drivingSignature=JSON.stringify(drivingInput)
 const pins=useMemo(()=>[
  ...visibleProperties.filter(item=>item.location).map(item=>({id:`property:${item.id}`,...item.location,label:'',title:`${item.producerName} · ${item.name}`,caption:showNames?`${item.producerName} · ${item.name}${item.isDemo?' · DEMO':''}`:null})),
  ...stops.filter(stop=>stop.location).map(stop=>({id:String(stop.visitId),...stop.location,label:String(stop.order),title:stop.name,tone:stop.tone,caption:showNames&&!visibleProperties.some(item=>String(item.clientId)===String(stop.clientId)&&item.location?.lat===stop.location.lat&&item.location?.lng===stop.location.lng)?`${stop.order}. ${stop.name}`:null})),
  ...suggestions.map(item=>({id:`suggestion:${item.clientId}`,...item.location,label:'+',title:`${item.name} · Sugestão`,tone:'suggested'})),
  ...(position&&date===today()?[{id:'my-position',...position,label:'',title:'Minha posição',tone:'position'}]:[])
 ],[stops,suggestions,position,date,properties,search,showNames])
 const visibleStops=stops.filter(stop=>`${stop.name} ${stop.place}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
 const recordedRoutes=useMemo(()=>{
  // Uma interrupção longa de GPS não vira um segmento imaginário no mapa.
  const segments=[];let points=[]
  for(const point of trace){if(points.length&&Date.parse(point.timestamp)-Date.parse(points.at(-1).timestamp)>120000){if(points.length>1)segments.push(points);points=[]}points.push(point)}
  if(points.length>1)segments.push(points)
  return segments.map(points=>({points:points.map(point=>[point.lat,point.lng]),kind:'recorded',distanceKm:pathDistance(points)}))
 },[trace])
 const routes=[...recordedRoutes,...(road?.available&&road.geometry?.length>1?[{points:road.geometry,kind:'planned'}]:[])]
 const traveledKm=recordedRoutes.reduce((total,item)=>total+item.distanceKm,0)
 useEffect(()=>{
  const controller=new AbortController();let active=true
  generation.current+=1
  setSaving(false);setDetourBusy('');setPosition(null)
  loadedDay.current='';setOrderedIds([]);setTrace([]);setProposal(null);setNotice('');setError('');setSelectedId('');setDetours({})
  routeRequest(routeDayPath(date),{signal:controller.signal}).then(payload=>{if(active){loadedDay.current=date;setOrderedIds(payload.orderedVisitIds||[]);setTrace(payload.trace||[])}}).catch(exception=>{if(active&&exception.name!=='AbortError')setError(exception.message)})
  return()=>{active=false;generation.current+=1;controller.abort()}
 },[date,storageScope])
 useEffect(()=>{
  const controller=new AbortController();let active=true
  setPropertyState({scope:storageScope,items:[],loading:true,error:''});setPropertyLimit(30)
  routeRequest('properties',{signal:controller.signal}).then(payload=>{
   if(active)setPropertyState({scope:storageScope,items:Array.isArray(payload.properties)?payload.properties:[],loading:false,error:''})
  }).catch(exception=>{if(active&&exception.name!=='AbortError')setPropertyState({scope:storageScope,items:[],loading:false,error:exception.message})})
  return()=>{active=false;controller.abort()}
 },[storageScope,propertyRevision,propertyRetry])
 useEffect(()=>{
  const input=JSON.parse(drivingSignature);const ids=input.clientIds
  let active=true
  setRoad(null);setDetours({})
  if(ids.length+(input.origin?1:0)<2||missingRemaining.length){setRoadBusy(false);return}
  if(ids.length+(input.origin?1:0)>15){setRoadBusy(false);return}
  const controller=new AbortController();setRoadBusy(true)
  routeRequest('driving',{method:'POST',body:input,signal:controller.signal}).then(payload=>{if(active)setRoad(payload)}).catch(exception=>{if(active&&exception.name!=='AbortError')setRoad({available:false,reason:exception.message})}).finally(()=>{if(active&&!controller.signal.aborted)setRoadBusy(false)})
  return()=>{active=false;controller.abort()}
 },[drivingSignature,date,storageScope,missingRemaining.length])
 useEffect(()=>{
  if(selectedKey.current===`${date}:${selectedId}`)return
  selectedKey.current=`${date}:${selectedId}`
  if(selectedId)document.getElementById(`route-stop-${selectedId}`)?.scrollIntoView({block:'nearest',behavior:'smooth'})
 },[selectedId,date])
 const saveOrder=async ids=>{
  if(loadedDay.current!==date){setError('Aguarde o roteiro carregar antes de reorganizar.');return}
  setSaving(true);setError('')
  const requestGeneration=generation.current
  try{const payload=await routeRequest(routeDayPath(date),{method:'PUT',body:{orderedVisitIds:ids,timeZone:routeTimeZone()}});if(requestGeneration!==generation.current)return;setOrderedIds(payload.orderedVisitIds||ids);setProposal(null);setNotice('Ordem do roteiro salva. Os horários dos compromissos foram mantidos.')}catch(exception){if(requestGeneration===generation.current)setError(exception.message)}finally{if(requestGeneration===generation.current)setSaving(false)}
 }
 const suggest=()=>{
  const ids=proposeRouteOrder(stops,{origin:position})
  if(ids.join('|')===stops.map(stop=>stop.visitId).join('|')){setProposal(null);setNotice(suggestions.length?`Encontrei ${suggestions.length} produtor(es) próximo(s). Confira abaixo e escolha quem deseja adicionar. Os horários agendados foram respeitados.`:'Os compromissos já seguem os horários agendados. Cadastre a localização de outros produtores para encontrar novas paradas próximas.');return}
  setProposal(ids);setNotice('Confira a sugestão de ordem antes de aplicar. Visitas realizadas e em andamento foram preservadas.')
 }
 const move=(index,offset)=>{
  const target=index+offset
  if(target<0||target>=stops.length||stops[index].tone!=='planned'||stops[target].tone!=='planned')return
  const ids=stops.map(stop=>stop.visitId);[ids[index],ids[target]]=[ids[target],ids[index]];saveOrder(ids)
 }
 const locate=()=>{
  const requestGeneration=generation.current
  if(!navigator.geolocation){setError('A localização não está disponível neste aparelho.');return}
  navigator.geolocation.getCurrentPosition(value=>{if(requestGeneration!==generation.current)return;setPosition({lat:value.coords.latitude,lng:value.coords.longitude,accuracy:value.coords.accuracy});setSelectedId('my-position')},()=>{if(requestGeneration===generation.current)setError('Permita a localização ou use as propriedades cadastradas como referência.')},{enableHighAccuracy:true,timeout:15000,maximumAge:30000})
 }
 const calculateDetour=async suggestion=>{
  if(!drivingIds.length)return
  setDetourBusy(suggestion.clientId);setError('')
  const currentSignature=drivingSignature
  const requestGeneration=generation.current
  try{
   let baseline=road
   if(!baseline?.available&&drivingIds.length+(drivingOrigin?1:0)>1)baseline=await routeRequest('driving',{method:'POST',body:drivingInput})
   const beforeStop=remaining.find(stop=>stop.visitId===suggestion.beforeVisitId)
   const afterStop=remaining.find(stop=>stop.visitId===suggestion.afterVisitId)
   const before=beforeStop?drivingEntries.findIndex(stop=>stop.visitId===beforeStop.visitId):-1
   const after=afterStop?drivingEntries.findIndex(stop=>stop.visitId===afterStop.visitId):-1
   const insertionIndex=before>=0?before:after>=0?after+1:drivingEntries.length
   const result=await routeRequest('driving',{method:'POST',body:{...drivingInput,candidateClientId:suggestion.clientId,insertionIndex}})
   if(!result.available)throw new Error('O cálculo por estrada está indisponível agora. A distância aproximada continua visível.')
   if(drivingIds.length+(drivingOrigin?1:0)>1&&!baseline?.available)throw new Error('Não foi possível comparar o desvio por estrada. Tente novamente.')
   if(requestGeneration!==generation.current)return
   setDetours(current=>({...current,[suggestion.clientId]:{signature:currentSignature,km:Math.max(0,result.distanceMeters-(baseline?.distanceMeters||0))/1000,minutes:Math.max(0,Math.ceil((result.durationSeconds-(baseline?.durationSeconds||0))/60))}}))
  }catch(exception){if(requestGeneration===generation.current)setError(exception.message)}finally{if(requestGeneration===generation.current)setDetourBusy('')}
 }
 return <section className="visit-roadmap" aria-label="Mapa e roteiro de visitas">
  <div className="vr-toolbar">
   <label className="vr-date"><CalendarDays size={18}/><span className="sr-only">Data do roteiro</span><input aria-label="Data do roteiro" type="date" value={date} disabled={tracking.tracking||tracking.busy||saving} onChange={event=>{if(event.target.value)setDate(event.target.value)}}/></label>
   <button className="soft-btn" onClick={()=>setDate(today())} disabled={tracking.tracking||tracking.busy||saving}>Hoje</button>
   <label className="vr-search"><Search size={17}/><input aria-label="Buscar produtor no roteiro" placeholder="Produtor, propriedade ou município…" value={search} onChange={event=>{setSearch(event.target.value);setPropertyLimit(30)}}/></label>
   <button className="soft-btn" aria-pressed={showNames} onClick={()=>setShowNames(value=>!value)}><MapPin size={16}/>Nomes nos pins</button>
   <div className="vr-toggle" aria-label="Visualização do roteiro"><button aria-pressed={view==='map'} onClick={()=>setView('map')}><Map size={17}/>Mapa</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={17}/>Lista</button></div>
  </div>
  <div className="vr-summary"><span><i className="vr-dot"/>{stops.length} visitas</span><span><i className="vr-dot is-visited"/>{stops.filter(stop=>stop.tone==='visited').length} visitadas</span><span><i className="vr-dot is-current"/>{stops.filter(stop=>stop.tone==='current').length} em andamento / revisão</span><span><i className="vr-dot is-planned"/>{stops.filter(stop=>stop.tone==='planned').length} programadas</span></div>
  {(error||notice)&&<div className={`vr-notice${error?' is-error':''}`} role={error?'alert':'status'}>{error||notice}</div>}
  {propertyState.scope===storageScope&&propertyState.error&&<div className="vr-notice is-error" role="alert">{propertyState.error} <button className="soft-btn" onClick={()=>setPropertyRetry(value=>value+1)}>Tentar novamente</button></div>}
  <div className={`vr-workspace${view==='list'?' is-list':''}`}>
   <aside className="vr-itinerary"><div className="vr-section-head"><h3>Roteiro do dia</h3><Route size={20}/></div><p className="vr-muted">Selecione uma parada para ver no mapa.</p>
    {!visibleStops.length&&<div className="vr-empty"><CalendarDays size={24}/><strong>{search?'Nenhuma visita nesta busca':'Nenhuma visita agendada para este dia'}</strong><p>Escolha outra data ou agende uma visita. Visitas em andamento continuam visíveis até serem encerradas.</p></div>}
    <ol className="vr-stops">{visibleStops.map(stop=>{const index=stops.indexOf(stop);return <li key={stop.visitId} id={`route-stop-${stop.visitId}`} className={`vr-stop is-${stop.tone}${selectedId===String(stop.visitId)?' is-selected':''}`}>
     <button className="vr-stop-main" onClick={()=>setSelectedId(String(stop.visitId))}><span className="vr-stop-number">{stop.tone==='visited'?<Check size={16}/>:stop.order}</span><span className="vr-stop-copy"><span className="vr-status">{labels[stop.lifecycle]||'Programada'}</span><strong>{stop.name}</strong><span><Clock3 size={13}/>{clock(stop.at)}</span>{stop.place&&<small>{stop.place}</small>}{!stop.location&&<small className="vr-missing">sem localização cadastrada</small>}</span></button>
     {stop.tone==='planned'&&<div className="vr-stop-actions"><button onClick={()=>onPrepareVisit?.(stop.visit)}><BrainCircuit size={14}/>Preparar com a VAL</button><button aria-label={`Subir visita de ${stop.name}`} disabled={saving||index===0||stops[index-1]?.tone!=='planned'} onClick={()=>move(index,-1)}><ArrowUp size={14}/></button><button aria-label={`Descer visita de ${stop.name}`} disabled={saving||stops[index+1]?.tone!=='planned'} onClick={()=>move(index,1)}><ArrowDown size={14}/></button></div>}
     {stop.tone!=='planned'&&<button className="vr-open-visit" onClick={()=>onOpenVisit?.(stop.visit)}>{stop.tone==='visited'?'Ver registro':'Registrar visita'}<ExternalLink size={13}/></button>}
    </li>})}</ol>
    <button className="vr-propose" onClick={suggest}><Sparkles size={17}/>Sugerir roteiro</button>
    {proposal&&<div className="vr-proposal"><strong>Ordem sugerida</strong><ol>{proposal.map(id=><li key={id}>{stops.find(stop=>stop.visitId===id)?.name}</li>)}</ol><button className="primary-btn" disabled={saving} onClick={()=>saveOrder(proposal)}>Aplicar ordem</button><button className="soft-btn" onClick={()=>setProposal(null)}>Manter atual</button></div>}
    <section className="vr-properties" aria-label="Propriedades da carteira"><div className="vr-section-head"><h3>Propriedades</h3><span>{propertiesLoading?'—':properties.length}</span></div><p className="vr-muted">Toda a sua carteira, independente da data do roteiro.</p>
     {propertiesLoading?<div className="vr-property-skeleton" role="status" aria-label="Carregando propriedades"><i/><i/><i/></div>:<>
      <p className="vr-muted">{properties.filter(item=>item.location).length} com pin · {properties.filter(item=>!item.location).length} sem localização</p>
      {!visibleProperties.length&&!propertyState.error&&<p className="vr-muted">{search?'Nenhuma propriedade nesta busca.':'Nenhuma propriedade cadastrada.'}</p>}
      <ul>{visibleProperties.slice(0,propertyLimit).map(item=><li key={item.id}><button type="button" aria-pressed={selectedId===`property:${item.id}`} onClick={()=>{setSelectedId(`property:${item.id}`);setView('map')}}><MapPin size={18}/><span><strong>{item.producerName}</strong><small>{item.name}{item.isDemo?' · DEMONSTRATIVO':''}</small><small>{item.municipality||'Município não informado'}{!item.location?' · Sem localização':''}</small></span></button></li>)}</ul>
      {visibleProperties.length>propertyLimit&&<button className="soft-btn" onClick={()=>setPropertyLimit(value=>value+30)}>Mostrar mais propriedades</button>}
     </>}
    </section>
   </aside>
   {view==='map'&&<div className="vr-map-panel">
    <SatelliteMap key={storageScope} pins={pins} routes={routes} height={610} fit={!propertiesLoading} controls selectedId={selectedId} onPinClick={pin=>setSelectedId(String(pin.id))} label="Mapa de satélite com propriedades, produtores e visitas"/>
    {selectedProperty&&<div className="vr-map-card"><button className="vr-close" aria-label="Fechar propriedade selecionada" onClick={()=>setSelectedId('')}>×</button><span className="vr-status">{selectedProperty.isDemo?'DADOS DEMONSTRATIVOS':'Propriedade cadastrada'}</span><h4>{selectedProperty.producerName}</h4><p>{selectedProperty.name} · {selectedProperty.municipality||'Município não informado'}</p>{!selectedProperty.location&&<p>Sem localização cadastrada. Marque a sede no perfil do produtor para exibir o pin.</p>}<button className="primary-btn" onClick={()=>onOpenClient?.(clients.find(client=>String(client.id)===String(selectedProperty.clientId))||{id:selectedProperty.clientId,name:selectedProperty.producerName})}>Ver produtor</button></div>}
    {(selected||selectedSuggestion)&&<div className="vr-map-card"><button className="vr-close" aria-label="Fechar propriedade selecionada" onClick={()=>setSelectedId('')}>×</button><span className={`vr-status is-${selected?.tone||'suggested'}`}>{selected?labels[selected.lifecycle]:'Sugestão próxima'}</span><h4>{selected?.name||selectedSuggestion?.name}</h4><p>{selected?.visit?.objective||selectedSuggestion?.reason}</p>{!selected?.location&&selected&&<p>Marque a sede no cadastro para mostrar o pin.</p>}<div>{selected?<button className="primary-btn" onClick={()=>onOpenVisit?.(selected.visit)}>Ver visita</button>:<button className="primary-btn" onClick={()=>onAddClient?.(selectedSuggestion.clientId,date,selectedSuggestion.reason)}>Adicionar ao roteiro</button>}<button className="soft-btn" onClick={()=>onOpenClient?.(selected?.client||selectedSuggestion?.client)}>Ver produtor</button></div></div>}
    <div className="vr-map-legend"><span><MapPin size={13}/>Propriedade</span><span><i className="vr-dot is-visited"/>Visitada</span><span><i className="vr-dot is-current"/>Em andamento</span><span><i className="vr-dot is-planned"/>Programada</span><span><Plus size={13}/>Sugestão</span><span><b className="vr-line"/>Percurso GPS</span><span><b className="vr-line is-planned"/>Rota planejada</span></div>
   </div>}
  </div>
  <div className="vr-trip-bar"><div><strong>{trace.length?`${km(traveledKm)} km registrados por GPS`:'Percurso GPS ainda não registrado'}</strong><span>{roadBusy?'Calculando percurso por estrada…':road?.available?`${km(road.distanceMeters/1000)} km planejados · ${Math.ceil(road.durationSeconds/60)} min de trajeto estimados`:missingRemaining.length?`${missingRemaining.length} parada(s) sem localização: complete o cadastro para calcular o trajeto inteiro.`:drivingIds.length>15?'Mostre até 15 paradas para calcular a rota por estrada.':drivingIds.length>1?'Rota por estrada indisponível. Os pins mostram as localizações cadastradas.':'Adicione pelo menos duas propriedades localizadas para calcular a rota.'}</span></div><div className="vr-trip-actions"><button className="soft-btn" onClick={locate} disabled={date!==today()}><LocateFixed size={16}/>Minha posição</button><button className={tracking.tracking?'vr-recording':'primary-btn'} disabled={tracking.busy||date!==today()} onClick={tracking.tracking?tracking.stop:tracking.start}>{tracking.tracking?<Pause size={16}/>:<Navigation size={16}/>} {tracking.busy?'Aguarde…':tracking.tracking?'Pausar percurso':'Iniciar percurso'}</button></div></div>
  <p className="vr-footnote">O GPS registra apenas enquanto esta tela está aberta e o percurso está ativo. Visita registrada não significa percurso rastreado. Estimativas de viagem não incluem a duração das visitas.</p>
  <section className="vr-suggestions" aria-label="Sugestões de produtores próximos"><header><div><Sparkles size={25}/><div><h3>Sugestões da VAL</h3><p>Produtores próximos da sua rota</p></div></div><label>Proximidade <select aria-label="Distância máxima dos produtores próximos" value={maxKm} onChange={event=>setMaxKm(Number(event.target.value))}><option value={5}>Até 5 km</option><option value={10}>Até 10 km</option><option value={20}>Até 20 km</option><option value={50}>Até 50 km</option></select></label></header>
   {suggestions.length?<div className="vr-suggestion-grid">{suggestions.map(item=>{const detour=detours[item.clientId];return <article key={item.clientId} className="vr-suggestion-card"><button className="vr-suggestion-pin" aria-label={`Ver sugestão ${item.name} no mapa`} onClick={()=>{setView('map');setSelectedId(`suggestion:${item.clientId}`)}}><MapPin size={27}/><Plus size={13}/></button><div><span className="vr-status">Sugestão</span><h4>{item.name}</h4><p>{detour&&detour.signature===drivingSignature?`Desvio estimado por estrada: +${km(detour.km)} km · +${detour.minutes} min`:`${km(item.distanceKm)} km de proximidade · linha reta`}</p><small>{item.reason}</small><button className="vr-text-button" disabled={Boolean(detourBusy)||!drivingIds.length||Boolean(missingRemaining.length)} onClick={()=>calculateDetour(item)}>{detourBusy===item.clientId?'Calculando…':'Calcular desvio por estrada'}</button></div><button className="soft-btn" onClick={()=>onAddClient?.(item.clientId,date,item.reason)}><Plus size={16}/>Adicionar ao roteiro</button></article>})}</div>:<div className="vr-empty-suggestions">{clients.some(client=>client.location)?'Nenhum produtor disponível nesta distância. Aumente a proximidade ou escolha outro dia.':'Marque a localização das propriedades no cadastro dos produtores para receber sugestões.'}</div>}
  </section>
 </section>
}
