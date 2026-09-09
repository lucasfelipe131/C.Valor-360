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
export function createCadastralLoader({fetcher=fetch,onData,onStatus,delay=250}){
 let timer,controller,epoch=0,lastUf=''
 const cache=new Map()
 const cancel=()=>{epoch++;clearTimeout(timer);controller?.abort()}
 return {
  cancel,
  update(view,{refresh=false}={}){
   cancel();const key=cadastralViewportKey(view),run=epoch
   if(!key){onData(null);onStatus('idle');lastUf='';return}
   const contains=(outer,inner)=>outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]>=inner[2]&&outer[3]>=inner[3]
   const cached=[...cache.values()].reverse().find(item=>item.uf===view.uf&&Date.now()-item.at<120000&&contains(item.bounds,view.bbox))
   if(!refresh&&cached){onData(cached.data);onStatus('ready');lastUf=view.uf;return}
   // Keep the preceding reference visible during a pan, but never across UFs.
   if(lastUf!==view.uf)onData(null)
   lastUf=view.uf;onStatus('loading')
   const [w,s,e,n]=view.bbox,padX=Math.min((e-w)*.25,(2-e+w)/2),padY=Math.min((n-s)*.25,(2-n+s)/2)
   const bounds=[Math.max(-180,w-padX),Math.max(-90,s-padY),Math.min(180,e+padX),Math.min(90,n+padY)]
   timer=setTimeout(async()=>{
    controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),25000)
    try{
     const params=new URLSearchParams({lat:String(view.lat),lng:String(view.lng),uf:view.uf,bbox:bounds.join(',')})
     const response=await fetcher(`/api/geospatial/official-boundaries?${params}`,{signal:controller.signal})
     const data=await response.json()
     if(!response.ok)throw new Error(data.error||'Cadastros indisponíveis.')
     if(epoch!==run)return
     if(['available','no_match'].includes(data.car?.status)&&['available','no_match'].includes(data.sigef?.status)&&!data.car?.limited&&!data.sigef?.limited&&!data.sigef?.failedSources){cache.set(key,{at:Date.now(),data,uf:view.uf,bounds});if(cache.size>20)cache.delete(cache.keys().next().value)}
     onData(data);onStatus('ready')
    }catch(error){if(epoch===run)onStatus('error',error.message)}finally{clearTimeout(timeout)}
   },refresh?0:delay)
  },
 }
}
