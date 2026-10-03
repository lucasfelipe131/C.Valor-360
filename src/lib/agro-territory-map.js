import {assessGeoPlausibility} from './geo-plausibility.js'
export const usableGeometry=geometry=>assessGeoPlausibility(geometry).status==='VALID'?geometry:null
export function geometryPoints(geometry){return (geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[]).flatMap(rings=>rings[0].map(([lng,lat])=>({lng,lat})))}
export function territorialLayers(properties,{propertyId='',fieldId='',season='',showProperties=true,showFields=true,onProperty,onField}={}){
 const layers=[]
 const append=(geometry,options)=>{if(!usableGeometry(geometry))return;for(const [i,rings] of (geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).entries())layers.push({...options,id:`${options.id}:${i}`,points:rings[0].map(([lng,lat])=>({lng,lat})),holes:rings.slice(1).map(r=>r.map(([lng,lat])=>({lng,lat})))})}
 for(const property of properties.filter(p=>!propertyId||p.id===propertyId)){
  if(showProperties)append(property.geometry,{id:`property:${property.id}`,kind:'property',label:`Propriedade: ${property.name}`,color:'#2563eb',weight:3,fillOpacity:.035,dashArray:'8 5',onClick:()=>onProperty?.(property.id)})
  for(const field of property.fields.filter(f=>(!fieldId||f.id===fieldId)&&(!season||f.season===season))){if(showFields)append(field.geometry,{id:`field:${field.id}`,kind:'field',label:`Talhão: ${field.name}`,color:field.id===fieldId?'#b45309':'#047857',weight:field.id===fieldId?5:3,fillOpacity:field.id===fieldId?.28:.13,selected:field.id===fieldId,onClick:()=>onField?.(field.id,property.id)})}
 }
 return layers
}
export function resolveTerritorialFocus(properties,focus){
 const property=properties.find(p=>p.id===focus?.property_id),field=property?.fields.find(f=>f.id===focus?.field_id)
 if(!property||!field||!usableGeometry(field.geometry))return null
 if(focus.geometry_version&&field.geometry_version!==focus.geometry_version)return null
 return {property,field,points:[...geometryPoints(usableGeometry(property.geometry)),...geometryPoints(field.geometry)]}
}
