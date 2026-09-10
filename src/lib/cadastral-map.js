// User-provided reference layers only: never property ownership evidence.
import {looksLikeSwappedRing,SWAPPED_COORDINATES_MESSAGE} from './geo-plausibility.js'
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
  if(geometry.type==='MultiPolygon'&&(!Array.isArray(geometry.coordinates)||!geometry.coordinates.length))throw new Error('Polígono vazio.')
  const coordinates=geometry.type==='Polygon'?polygon(geometry.coordinates):geometry.coordinates.map(polygon)
  for(const rings of geometry.type==='Polygon'?[coordinates]:coordinates)if(looksLikeSwappedRing(rings[0]))throw new Error(SWAPPED_COORDINATES_MESSAGE)
  const properties={}
  for(const [key,value] of Object.entries(feature.properties||{}).slice(0,40))if(!['__proto__','prototype','constructor'].includes(key)&&['string','number','boolean'].includes(typeof value))properties[key.slice(0,80)]=String(value).slice(0,300)
  return {type:'Feature',geometry:{type:geometry.type,coordinates},properties:{...properties,_referenceIndex:index+1}}
 })
 return {type:'FeatureCollection',features:normalized}
}
const folded=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')
export function cadastralDetails(feature){
 const entries=Object.entries(feature.properties||{})
 const pick=keys=>String(entries.find(([key,value])=>keys.includes(folded(key))&&String(value).trim())?.[1]||'').trim()
 return {
  registry:pick(['matricula','registromatricula','numeromatricula','nummatricula','registry','number']),
  holder:pick(['titular','nometitular','proprietario','nomeproprietario','nomeproprietarios','ownername','owner','proprietarionome']),
  name:pick(['nome','name','label','propertyname','nomeimovel','nomearea']),
  code:pick(['codigo','codimovel','propertycode','parcelcode']),
 }
}
// Identificador do conteudo, nao da posicao na lista. As camadas oficiais sao reconsultadas a cada
// movimento do mapa e a busca reindexa o array: com id posicional a previa aberta continuava aberta
// e passava a mostrar o imovel do vizinho, e "Usar contorno no talhao" adotava o limite errado.
const contentDigest=value=>{
 let hash=2166136261
 const source=String(value)
 for(let index=0;index<source.length;index++){hash^=source.charCodeAt(index);hash=Math.imul(hash,16777619)}
 return (hash>>>0).toString(36)
}
export function referencePartId(layer,feature,rings,index){
 const details=cadastralDetails(feature)
 const anchor=rings?.[0]?.[0]||[]
 return `${layer.id}:${contentDigest([details.registry,details.code,details.name,details.holder,anchor[0],anchor[1],rings?.[0]?.length].join('|'))}:${index}`
}
export function referenceParts(layer){
 return layer.geojson.features.flatMap(feature=>(feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates).map((rings,index,all)=>({
  id:referencePartId(layer,feature,rings,index),
  layer,feature:{...feature,geometry:{type:'Polygon',coordinates:rings}},
  label:`${cadastralDetails(feature).name||cadastralDetails(feature).registry||cadastralDetails(feature).code||`Contorno ${feature.properties._referenceIndex||1}`}${all.length>1?` · parte ${index+1}/${all.length}`:''}`,
  hasHoles:rings.length>1,
 })))
}
export function filterCadastral(layer,query=''){
 const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 const q=normalize(query).trim()
 return {...layer,features:layer.features.filter(feature=>!q||Object.values(feature.properties).some(value=>normalize(value).includes(q)))}
}
