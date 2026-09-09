import {Parser} from 'saxen'
import {normalizeCadastralGeoJSON} from './cadastral-map.js'
import {polygonAreaHa} from './property-map.js'
import {validProductiveRing} from './productive-map.js'

// Local data only: never fetch a KML NetworkLink, icon, schema or entity.
export function parseCadastralFile(source,filename=''){
 if(typeof source!=='string'||source.length>5*1024*1024)throw new Error('Use um arquivo de até 5 MB.')
 if(/\.kmz$/i.test(filename))throw new Error('Descompacte o KMZ e importe o arquivo KML.')
 if(!/\.kml$/i.test(filename)&&!source.trimStart().startsWith('<'))return normalizeCadastralGeoJSON(JSON.parse(source))
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('KML com entidades externas não é aceito. Exporte somente os limites.')
 const root={children:[]},stack=[root];let count=0
 const parser=new Parser().ns({'http://www.opengis.net/kml/2.2':'kml','http://earth.google.com/kml/2.1':'kml','http://earth.google.com/kml/2.0':'kml'})
 const invalid=()=>{throw new Error('KML inválido. Exporte os polígonos em WGS84.')}
 parser.on('error',invalid);parser.on('warn',invalid)
 parser.on('openTag',(name,attributes,decode)=>{
  if(++count>150000||stack.length>64)throw new Error('KML muito complexo. Exporte uma propriedade por arquivo.')
  const attrs=Object.create(null)
  for(const [key,value] of Object.entries(attributes()))attrs[key]=decode(value)
  const node={tag:name.replace(/^kml:/,''),attrs,text:'',children:[]}
  stack.at(-1).children.push(node);stack.push(node)
 })
 parser.on('closeTag',()=>{stack.pop()})
 parser.on('text',(value,decode)=>{stack.at(-1).text+=decode(value)})
 parser.on('cdata',value=>{stack.at(-1).text+=value})
 parser.parse(source)
 if(stack.length!==1||root.children.length!==1||root.children[0].tag!=='kml')invalid()
 const descendants=(node,tag)=>node.children.flatMap(child=>child.tag==='NetworkLink'?[]:[...(child.tag===tag?[child]:[]),...descendants(child,tag)])
 const child=(node,tag)=>node.children.find(item=>item.tag===tag)
 const text=node=>node?[node.text,...node.children.map(text)].join('').trim():''
 let vertexCount=0
 const boundary=node=>{
  const rings=descendants(node,'LinearRing');if(rings.length!==1)invalid()
  const coordinate=child(rings[0],'coordinates');if(!coordinate)invalid()
  const tuples=text(coordinate).split(/\s+/).filter(Boolean)
  vertexCount+=tuples.length;if(vertexCount>50000)throw new Error('Arquivo muito detalhado: limite de 50 mil vértices.')
  return tuples.map(tuple=>{const values=tuple.split(',');if(values.length<2||values.length>3||values.some(value=>!value.trim()||!Number.isFinite(Number(value))))invalid();return values.slice(0,2).map(Number)})
 }
 const features=descendants(root,'Placemark').flatMap(placemark=>{
  const polygons=descendants(placemark,'Polygon').map(polygon=>{
   const outer=polygon.children.filter(node=>node.tag==='outerBoundaryIs');if(outer.length!==1)invalid()
   return [boundary(outer[0]),...polygon.children.filter(node=>node.tag==='innerBoundaryIs').map(boundary)]
  })
  if(!polygons.length)return [] // Points and paths are not productive areas.
  const properties=Object.create(null);properties.nome=text(child(placemark,'name')).slice(0,300)
  for(const data of descendants(placemark,'ExtendedData').flatMap(node=>[...descendants(node,'Data'),...descendants(node,'SimpleData')])){
   const key=data.attrs.name
   if(key&&!['__proto__','constructor','prototype'].includes(key)&&Object.keys(properties).length<40)properties[key.slice(0,80)]=text(data.tag==='Data'?child(data,'value'):data).slice(0,300)
  }
  return [{type:'Feature',properties,geometry:polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons}}]
 })
 if(!features.length)throw new Error('Nenhum polígono local encontrado. Exporte o limite do CAR como KML, sem depender de links externos.')
 return normalizeCadastralGeoJSON({type:'FeatureCollection',features})
}

// Iterative Douglas–Peucker; no arbitrary truncation of a parcel's vertices.
function simplify(points,tolerance,budget){
 const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1
 const cos=Math.cos(points[0].lat*Math.PI/180),scale=111320
 const xy=points.map(p=>[p.lng*cos*scale,p.lat*scale]),pending=[[0,points.length-1]]
 while(pending.length){
  const [first,last]=pending.pop(),a=xy[first],b=xy[last];let max=tolerance*tolerance,index=0
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy
  for(let i=first+1;i<last;i++){
   if(--budget.remaining<0)throw new Error('Contorno muito complexo para edição direta. Use o limite como guia e desenhe a área produtiva.')
   const p=xy[i],t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0
   const distance=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
   if(distance>max){max=distance;index=i}
  }
  if(index){keep[index]=1;pending.push([first,index],[index,last])}
 }
 return points.filter((_,index)=>keep[index])
}
export function prepareReferenceDraft(feature){
 if(feature.geometry?.type!=='Polygon')throw new Error('Selecione uma parte do imóvel por vez.')
 if(feature.geometry.coordinates.length!==1)throw new Error('Este limite tem recortes internos. Use-o como guia e desenhe a área produtiva sem incluir os recortes.')
 const original=feature.geometry.coordinates[0].slice(0,-1).map(([lng,lat])=>({lat,lng}))
 let points=original,tolerance=0
 const budget={remaining:1000000}
 while(points.length>500&&tolerance<64){tolerance=tolerance? tolerance*2:.25;points=simplify([...original,original[0]],tolerance,budget).slice(0,-1)}
 const originalAreaHa=polygonAreaHa(original),areaHa=polygonAreaHa(points)
 const differencePercent=originalAreaHa?Math.abs(areaHa-originalAreaHa)/originalAreaHa*100:100
 if(!validProductiveRing(points)||differencePercent>.5)throw new Error('O contorno exige revisão para virar talhão. Use o limite como guia e desenhe a área produtiva.')
 return {points,areaHa,originalAreaHa,differencePercent,simplified:points.length!==original.length,originalVertices:original.length,toleranceMeters:tolerance}
}
