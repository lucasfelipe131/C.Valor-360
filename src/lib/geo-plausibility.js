// Latitude e longitude trocadas nao sao pegas por checagem de faixa: em qualquer ponto do Brasil a
// latitude (|lat| ate 34) cabe na faixa de longitude e a longitude (|lng| de 34 a 74) cabe na faixa
// de latitude. O arquivo passava na validacao e o talhao ia parar no Atlantico, com a area errada.
// So acusamos a inversao quando ela e demonstravel: o ponto esta fora do Brasil e, trocado, cai
// dentro. Coordenada legitimamente fora do Brasil continua passando.
const BRAZIL={minLat:-34.2,maxLat:5.5,minLng:-74.2,maxLng:-28.6}

export const insideBrazil=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=BRAZIL.minLat&&lat<=BRAZIL.maxLat&&lng>=BRAZIL.minLng&&lng<=BRAZIL.maxLng

// Recebe pares [lng,lat] (ordem GeoJSON). Devolve true quando a troca e a unica leitura plausivel.
export function looksLikeSwappedRing(pairs){
 const points=(Array.isArray(pairs)?pairs:[]).filter(pair=>Array.isArray(pair)&&Number.isFinite(pair[0])&&Number.isFinite(pair[1]))
 if(points.length<3)return false
 const mean=index=>points.reduce((sum,pair)=>sum+pair[index],0)/points.length
 const lng=mean(0);const lat=mean(1)
 return !insideBrazil(lat,lng)&&insideBrazil(lng,lat)
}

export const SWAPPED_COORDINATES_MESSAGE='As coordenadas parecem estar na ordem latitude,longitude. Exporte o arquivo em WGS84 na ordem longitude,latitude (padrão GeoJSON) e importe de novo.'

// Governed review checks. Input stays untouched; this function never swaps,
// closes, simplifies or chooses between conflicting boundaries.
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
const onSegment=(a,b,p)=>Math.abs(orient(a,b,p))<1e-12&&p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12
const intersects=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b)
const ringsOf=g=>g?.type==='Polygon'&&Array.isArray(g.coordinates)?g.coordinates.filter(Array.isArray):g?.type==='MultiPolygon'&&Array.isArray(g.coordinates)?g.coordinates.filter(Array.isArray).flat().filter(Array.isArray):[]
export function pointInGeoRing(point,ring){
 let inside=false
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j]
  if(onSegment(a,b,point))return true
  if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside
 }
 return inside
}
export function pointInGeoGeometry(point,g){return (g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[]).some(p=>pointInGeoRing(point,p[0])&&!p.slice(1).some(r=>pointInGeoRing(point,r)))}
export function spatialGeometryKey(geometry){
 const ringKey=ring=>ring.slice(0,-1).map(p=>p.map(v=>Number(v).toFixed(7)).join(',')).sort().join(';')
 return ringsOf(geometry).map(ringKey).sort().join('|')
}
export function assessGeoPlausibility(geometry,{areaHa,calculatedAreaHa,propertyAreaHa,parentGeometry,municipalityCenter,otherGeometries=[],crs}={}){
 const reasons=[],rings=ringsOf(geometry),points=rings.flat()
 if(crs&&!['EPSG:4326','urn:ogc:def:crs:OGC:1.3:CRS84'].includes(crs))reasons.push('CRS_UNSUPPORTED')
 if(!rings.length||!points.length)reasons.push('EMPTY_GEOMETRY')
 if(points.length>5000)return {status:'REVIEW_REQUIRED',reasons:['GEOMETRY_TOO_COMPLEX'],corrected:false}
 const valid=points.every(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)
 if(!valid)reasons.push('INVALID_COORDINATES')
 else{
  if(points.some(p=>!insideBrazil(p[1],p[0])))reasons.push('OUTSIDE_BRAZIL')
  for(const ring of rings){
   if(ring.length<4||ring[0]?.[0]!==ring.at(-1)?.[0]||ring[0]?.[1]!==ring.at(-1)?.[1]){reasons.push('UNCLOSED_RING');continue}
   let crossed=false
   for(let i=0;i<ring.length-1&&!crossed;i++)for(let j=i+2;j<ring.length-1;j++)if(!(i===0&&j===ring.length-2)&&intersects(ring[i],ring[i+1],ring[j],ring[j+1])){crossed=true;break}
   if(crossed)reasons.push('SELF_INTERSECTION')
  }
  if(parentGeometry&&points.some(p=>!pointInGeoGeometry(p,parentGeometry)))reasons.push('FIELD_OUTSIDE_PROPERTY')
  const key=spatialGeometryKey(geometry)
  for(const other of otherGeometries){
   if(spatialGeometryKey(other)===key){reasons.push('SPATIAL_DUPLICATE');continue}
   const otherPoints=ringsOf(other).flat()
   const strictlyInside=(p,g)=>pointInGeoGeometry(p,g)&&!ringsOf(g).some(r=>r.slice(1).some((q,i)=>onSegment(r[i],q,p)))
   if(points.some(p=>strictlyInside(p,other))||otherPoints.some(p=>strictlyInside(p,geometry))||rings.some(r=>r.slice(1).some((p,i)=>ringsOf(other).some(o=>o.slice(1).some((q,j)=>orient(r[i],p,o[j])*orient(r[i],p,q)<0&&orient(o[j],q,r[i])*orient(o[j],q,p)<0)))))reasons.push('OVERLAP_REQUIRES_REVIEW')
  }
  if(municipalityCenter&&points.length){
   const center=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]),distance=111*Math.hypot((center[0]-municipalityCenter[0])*Math.cos(center[1]*Math.PI/180),center[1]-municipalityCenter[1])
   if(distance>100)reasons.push('DISTANT_MUNICIPALITY')
  }
 }
 if(areaHa!=null&&(!Number.isFinite(Number(areaHa))||Number(areaHa)<=0)||calculatedAreaHa!=null&&(!Number.isFinite(calculatedAreaHa)||calculatedAreaHa<=0))reasons.push('INVALID_AREA')
 if(areaHa>0&&calculatedAreaHa>0&&Math.abs(areaHa-calculatedAreaHa)/calculatedAreaHa>.2)reasons.push('AREA_MISMATCH')
 if(propertyAreaHa>0&&Math.max(Number(areaHa)||0,calculatedAreaHa||0)>propertyAreaHa)reasons.push('FIELD_LARGER_THAN_PROPERTY')
 return {status:reasons.length?'REVIEW_REQUIRED':'VALID',reasons:[...new Set(reasons)],corrected:false}
}
