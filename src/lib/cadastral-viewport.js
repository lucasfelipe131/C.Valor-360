// Display-only cadastral references. No producer records or intelligence writes.
export function stateAtPoint(point,states){
 if(!point)return ''
 const inside=ring=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point.lat)!==(b[1]>point.lat)&&point.lng<(b[0]-a[0])*(point.lat-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit}
 return states?.features?.find(feature=>{const g=feature.geometry;return (g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[]).some(rings=>inside(rings[0])&&!rings.slice(1).some(inside))})?.properties?.uf||''
}
export function cadastralViewportKey(view){
 if(!view||!Number.isFinite(view.zoom)||view.zoom<10||!Number.isFinite(view.lat)||!Number.isFinite(view.lng)||!view.uf||!Array.isArray(view.bbox)||view.bbox.length!==4||!view.bbox.every(Number.isFinite))return ''
 const [west,south,east,north]=view.bbox
 if(east<=west||north<=south||east-west>2||north-south>2||view.lng<west||view.lng>east||view.lat<south||view.lat>north)return ''
 return `${view.uf}:${view.bbox.map(v=>v.toFixed(5)).join(',')}`
}
const referenceCache=new WeakMap()
const registryReferenceCache=new WeakMap()
export function officialReferenceLayers(payload){
 const groups=[]
 for(const [key,type,color] of [['car','CAR','#ffb020'],['sigef','SIGEF','#c084fc']]){
  const result=payload[key],queriedAt=result?.queriedAt||payload.queriedAt
  const previous=result&&referenceCache.get(result)
  if(previous&&previous.queriedAt===queriedAt){groups.push(previous.layer);continue}
  const features=(result?.features||[]).flatMap(feature=>{
   if(!feature.points?.length)return []
   const ring=feature.points.map(p=>[p.lng,p.lat]);ring.push(ring[0])
   return [{type:'Feature',geometry:feature.geometry||{type:'Polygon',coordinates:[ring]},properties:{codigo:feature.propertyCode||feature.parcelCode||feature.id,matricula:feature.registry||'',nome:feature.label,fonte:result.source,consultadoEm:queriedAt}}]
  })
  const layer={id:`official-${key}`,name:result?.source||type,type,color,official:true,visible:true,geojson:{type:'FeatureCollection',features}}
  if(result)referenceCache.set(result,{queriedAt,layer})
  groups.push(layer)
 }
 const sigef=groups[1]
 // Same source object keeps its Leaflet geometry alive when only CAR changes.
 if(!registryReferenceCache.has(sigef))registryReferenceCache.set(sigef,{...sigef,id:'official-registry',type:'Matrícula',name:'Referência informada no SIGEF',color:'#38bdf8',geojson:{type:'FeatureCollection',features:sigef.geojson.features.filter(feature=>String(feature.properties.matricula).trim())}})
 groups.push(registryReferenceCache.get(sigef))
 return groups
}
export const CADASTRAL_SOURCES=['car','sigef-particular','sigef-publico']
const contains=(outer,inner)=>outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]>=inner[2]&&outer[3]>=inner[3]
const buffered=b=>{const [w,s,e,n]=b,x=Math.min((e-w)*.35,(2-e+w)/2),y=Math.min((n-s)*.35,(2-n+s)/2);return [Math.max(-180,w-x),Math.max(-90,s-y),Math.min(180,e+x),Math.min(90,n+y)]}

// Three independent requests: SICAR and the two SIGEF services. A slow source
// cannot hold a ready layer, and a small pan does not abort a useful request.
export function createCadastralLoader({fetcher=fetch,onData,onStatus,delay=250,now=Date.now}){
 let timer,desired=null,version=0,lastSigef=null,lastSigefInputs=[]
 const active=new Map(),cache=new Map(),results=new Map(),states={}
 const stop=source=>{const job=active.get(source);if(job){active.delete(source);job.controller.abort()}}
 const cancel=()=>{version++;clearTimeout(timer);desired=null;for(const source of active.keys())stop(source)}
 const publish=()=>{
  if(!desired)return
  const loading=desired.sources.filter(source=>states[source]==='loading')
  const sigefKeys=['sigef-particular','sigef-publico'].filter(source=>desired.sources.includes(source))
  const sigefInputs=sigefKeys.flatMap(key=>[results.get(key)?.data,states[key]])
  if(sigefInputs.length!==lastSigefInputs.length||sigefInputs.some((value,index)=>value!==lastSigefInputs[index])){
   lastSigefInputs=sigefInputs
   const parts=sigefKeys.map(key=>results.get(key)?.data).filter(Boolean),features=parts.flatMap(part=>part.features||[])
   const pending=sigefKeys.filter(key=>states[key]==='loading'),failed=sigefKeys.filter(key=>states[key]==='error'||results.get(key)?.data.status==='unavailable')
   lastSigef={features,source:'SIGEF/INCRA · Acervo Fundiário',queriedAt:parts.map(part=>part.queriedAt).filter(Boolean).sort()[0],status:features.length?'available':pending.length?'loading':failed.length?'unavailable':'no_match',limited:parts.some(part=>part.limited)||pending.length>0||failed.length>0,failedSources:failed.length,
    note:pending.length?'SIGEF carregando por fonte; os limites já recebidos estão disponíveis.':failed.length?'Parte do SIGEF não respondeu. Os limites disponíveis foram preservados.':features.length?'Limites retornados pelo SIGEF/INCRA.':'Nenhum limite retornado pelo SIGEF nesta área.'}
  }
  const sourceStates=Object.fromEntries(CADASTRAL_SOURCES.map(source=>[source,desired.sources.includes(source)?states[source]||'loading':'disabled']))
  onData({uf:desired.view.uf,point:{lat:desired.view.lat,lng:desired.view.lng},bounds:desired.view.bbox,car:desired.sources.includes('car')?results.get('car')?.data:undefined,sigef:sigefKeys.length?lastSigef:undefined,sourceStates,loadingSources:loading})
  const errors=desired.sources.filter(source=>states[source]==='error')
  onStatus(loading.length?'loading':errors.length===desired.sources.length?'error':'ready',errors.length&&!loading.length?'Uma fonte não respondeu. Você pode continuar no mapa e tentar atualizar.':'')
 }
 const cachedFor=(source,view,key)=>[...cache.values()].reverse().find(entry=>entry.source===source&&entry.uf===view.uf&&entry.expiresAt>now()&&(!entry.data.limited&&!entry.data.failedSources?contains(entry.bounds,view.bbox):entry.viewKey===key))
 const start=()=>{
  if(!desired)return
  const {view,key,sources,refresh}=desired
  for(const source of sources){
   if(active.has(source)||states[source]!=='loading')continue
   const job={source,viewKey:key,view,bounds:buffered(view.bbox),controller:new AbortController(),version};active.set(source,job)
   const timeout=setTimeout(()=>job.controller.abort(),23000)
   const params=new URLSearchParams({lat:String(view.lat),lng:String(view.lng),uf:view.uf,bbox:job.bounds.join(','),source,...(refresh?{refresh:'1'}:{})})
   Promise.resolve().then(()=>fetcher(`/api/geospatial/official-boundaries?${params}`,{signal:job.controller.signal})).then(async response=>{
    const data=await response.json()
    if(!response.ok)throw new Error(data.error||'Fonte indisponível.')
    if(data.sourceKey!==source||data.uf!==view.uf||!Array.isArray(data.result?.features)||!['available','no_match','unavailable'].includes(data.result.status))throw new Error('Resposta cadastral inválida.')
    return data
   }).then(payload=>{
    if(active.get(source)!==job||!desired||job.version!==version)return
    active.delete(source)
    const data={...payload.result,queriedAt:payload.result.queriedAt||payload.queriedAt}
    const entry={source,uf:view.uf,bounds:job.bounds,viewKey:key,data,expiresAt:now()+(data.limited||data.failedSources?30000:120000)}
    if(data.status!=='unavailable'){
     cache.set(`${source}:${key}`,entry);if(cache.size>60)cache.delete(cache.keys().next().value)
    }
    if(data.status==='unavailable'&&results.get(source)?.data.features?.length){
     const previous=results.get(source);results.set(source,{...previous,data:{...previous.data,status:'unavailable',limited:true,note:'Fonte indisponível; exibindo a referência anterior com sua data de consulta.'}})
    }else results.set(source,entry)
    states[source]=data.status==='unavailable'?'error':'ready';publish()
   }).catch(()=>{
    if(active.get(source)!==job||!desired||job.version!==version)return
    active.delete(source)
    const previous=results.get(source)
    if(previous)results.set(source,{...previous,data:{...previous.data,status:'unavailable',limited:true,note:'Fonte indisponível; exibindo a referência anterior com sua data de consulta.'}})
    states[source]='error';publish()
   }).finally(()=>clearTimeout(timeout))
  }
 }
 return {
  cancel,
  update(view,{refresh=false,sources=CADASTRAL_SOURCES}={}){
   clearTimeout(timer)
   const key=cadastralViewportKey(view),wanted=CADASTRAL_SOURCES.filter(source=>sources.includes(source))
   if(!key||!wanted.length){cancel();results.clear();onData(null);onStatus('idle');return}
   if(desired?.view.uf!==view.uf){for(const source of active.keys())stop(source);results.clear();lastSigefInputs=[];lastSigef=null}
   desired={view,key,sources:wanted,refresh}
   for(const [source,job] of active){if(refresh||!wanted.includes(source)||job.view.uf!==view.uf||!contains(job.bounds,view.bbox))stop(source)}
   for(const source of wanted){
    const cached=refresh?null:cachedFor(source,view,key)
    if(cached){stop(source);results.set(source,cached);states[source]='ready'}
    else states[source]='loading'
   }
   publish()
   if(wanted.some(source=>states[source]==='loading'&&!active.has(source)))timer=setTimeout(start,refresh?0:delay)
  },
 }
}
