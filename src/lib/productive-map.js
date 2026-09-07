import {polygonAreaHa} from './property-map.js'
export function validProductiveRing(points){
 if(!Array.isArray(points)||points.length<3||points.length>500)return false
 if(points.some(p=>!p||typeof p.lat!=='number'||typeof p.lng!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180))return false
 if(new Set(points.map(p=>`${p.lat},${p.lng}`)).size!==points.length)return false
 const cross=(a,b,c)=>(b.lng-a.lng)*(c.lat-a.lat)-(b.lat-a.lat)*(c.lng-a.lng)
 const between=(a,b,c)=>Math.min(a.lng,b.lng)<=c.lng&&c.lng<=Math.max(a.lng,b.lng)&&Math.min(a.lat,b.lat)<=c.lat&&c.lat<=Math.max(a.lat,b.lat)
 for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
  if(j===i+1||(i===0&&j===points.length-1))continue
  const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length]
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b)
  if((abC*abD<0&&cdA*cdB<0)||(abC===0&&between(a,b,c))||(abD===0&&between(a,b,d))||(cdA===0&&between(c,d,a))||(cdB===0&&between(c,d,b)))return false
 }
 return polygonAreaHa(points)>0
}
export function fieldProduction(field){
 const area=field.areaHa===''||field.areaHa==null?null:Number(field.areaHa)
 const productivity=field.productivityTarget===''||field.productivityTarget==null?null:Number(field.productivityTarget)
 return area!==null&&productivity!==null&&Number.isFinite(area)&&Number.isFinite(productivity)&&area>=0&&productivity>=0?area*productivity:null
}
