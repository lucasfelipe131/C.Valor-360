// User-provided reference layers only: never property ownership evidence.
export const CADASTRAL_TYPES=['CAR','SIGEF','Matrícula']
export const CADASTRAL_COLORS={CAR:'#ffb020',SIGEF:'#c084fc','Matrícula':'#38bdf8'}
export function normalizeCadastralGeoJSON(input){
 if(input?.crs&&!/CRS84|4326/.test(JSON.stringify(input.crs)))throw new Error('Exporte o arquivo em WGS84 (longitude/latitude).')
 const features=input?.type==='FeatureCollection'?input.features:input?.type==='Feature'?[input]:[{type:'Feature',geometry:input,properties:{}}]
 if(!Array.isArray(features)||!features.length||features.length>300)throw new Error('Use um arquivo com 1 a 300 imóveis.')
 let count=0
 const normalized=features.map((feature,index)=>{
  const geometry=feature.geometry
  if(!['Polygon','MultiPolygon'].includes(geometry?.type))throw new Error('A camada precisa conter apenas polígonos.')
  const polygon=rings=>{
   if(!Array.isArray(rings)||!rings.length)throw new Error('Polígono vazio.')
   return rings.map(ring=>{
    if(!Array.isArray(ring)||ring.length<4)throw new Error('Contorno incompleto.')
    const points=ring.map(point=>{count++;if(count>50000)throw new Error('Arquivo muito detalhado: limite de 50 mil vértices.');if(!Array.isArray(point)||point.length<2||!point.slice(0,2).every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(point[0])>180||Math.abs(point[1])>90)throw new Error('Coordenadas inválidas. Use WGS84 longitude/latitude.');return point.slice(0,2)})
    if(points[0][0]!==points.at(-1)[0]||points[0][1]!==points.at(-1)[1])throw new Error('O contorno do arquivo precisa estar fechado.')
    return points
   })
  }
  const coordinates=geometry.type==='Polygon'?polygon(geometry.coordinates):geometry.coordinates.map(polygon)
  const properties={}
  for(const [key,value] of Object.entries(feature.properties||{}).slice(0,40))if(['string','number','boolean'].includes(typeof value))properties[key.slice(0,80)]=String(value).slice(0,300)
  return {type:'Feature',geometry:{type:geometry.type,coordinates},properties:{...properties,_referenceIndex:index+1}}
 })
 return {type:'FeatureCollection',features:normalized}
}
export function filterCadastral(layer,query=''){
 const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 const q=normalize(query).trim()
 return {...layer,features:layer.features.filter(feature=>!q||Object.values(feature.properties).some(value=>normalize(value).includes(q)))}
}
