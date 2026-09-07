// Display-only cadastral references. No producer records or intelligence writes.
export function stateAtPoint(point,states){
 if(!point)return ''
 const inside=ring=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point.lat)!==(b[1]>point.lat)&&point.lng<(b[0]-a[0])*(point.lat-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit}
 return states?.features?.find(feature=>{const g=feature.geometry;return (g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[]).some(rings=>inside(rings[0])&&!rings.slice(1).some(inside))})?.properties?.uf||''
}
export function cadastralViewportKey(view){
 if(!view||view.zoom<10||!view.uf||!Array.isArray(view.bbox)||view.bbox.length!==4||!view.bbox.every(Number.isFinite))return ''
 const [west,south,east,north]=view.bbox
 if(east<=west||north<=south||east-west>2||north-south>2)return ''
 return `${view.uf}:${view.bbox.map(v=>v.toFixed(5)).join(',')}`
}
export function officialReferenceLayers(payload){
 const groups=[]
 for(const [key,type,color] of [['car','CAR','#ffb020'],['sigef','SIGEF','#c084fc']]){
  const result=payload[key]
  const features=(result?.features||[]).flatMap(feature=>{
   if(!feature.points?.length)return []
   const ring=feature.points.map(p=>[p.lng,p.lat]);ring.push(ring[0])
   return [{type:'Feature',geometry:feature.geometry||{type:'Polygon',coordinates:[ring]},properties:{codigo:feature.propertyCode||feature.parcelCode||feature.id,matricula:feature.registry||'',nome:feature.label,fonte:result.source,consultadoEm:payload.queriedAt}}]
  })
  groups.push({id:`official-${key}`,name:result?.source||type,type,color,official:true,visible:true,geojson:{type:'FeatureCollection',features}})
 }
 const sigef=groups[1]
 groups.push({...sigef,id:'official-registry',type:'Matrícula',name:'Referência informada no SIGEF',color:'#38bdf8',geojson:{type:'FeatureCollection',features:sigef.geojson.features.filter(feature=>String(feature.properties.matricula).trim())}})
 return groups
}
// A fresh controller invalidates both delayed and in-flight requests, including
// fetch implementations that complete after abort. Cache stays in this map only.
export function createCadastralLoader({fetcher=fetch,onData,onStatus,delay=700}){
 let timer,controller,epoch=0
 const cache=new Map()
 const cancel=()=>{epoch++;clearTimeout(timer);controller?.abort()}
 return {
  cancel,
  update(view,{refresh=false}={}){
   cancel();const key=cadastralViewportKey(view),run=epoch
   if(!key){onData(null);onStatus('idle');return}
   const cached=cache.get(key)
   if(!refresh&&cached&&Date.now()-cached.at<120000){onData(cached.data);onStatus('ready');return}
   onData(null);onStatus('loading')
   timer=setTimeout(async()=>{
    controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),25000)
    try{
     const params=new URLSearchParams({lat:String(view.lat),lng:String(view.lng),uf:view.uf,bbox:view.bbox.join(',')})
     const response=await fetcher(`/api/geospatial/official-boundaries?${params}`,{signal:controller.signal})
     const data=await response.json()
     if(!response.ok)throw new Error(data.error||'Cadastros indisponíveis.')
     if(epoch!==run)return
     if(data.car?.status!=='unavailable'&&data.sigef?.status!=='unavailable'){cache.set(key,{at:Date.now(),data});if(cache.size>20)cache.delete(cache.keys().next().value)}
     onData(data);onStatus('ready')
    }catch(error){if(epoch===run)onStatus('error',error.message)}finally{clearTimeout(timeout)}
   },refresh?0:delay)
  },
 }
}
