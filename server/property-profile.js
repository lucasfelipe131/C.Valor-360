// Propriedade e talhões do produtor — contrato compartilhado entre a rota
// HTTP, o repositório (PostgreSQL ou arquivo local) e a interface.
//
// A sede da propriedade vive em properties.metadata.location; o contorno de
// cada talhão vive em fields.geometry_ref, no mesmo envelope canônico que o
// Manual do Agrônomo já lê. Nada aqui inventa coordenada: sem pino registrado
// a resposta diz "sem localização", e a interface mostra isso.
import {canonicalValToManualGeometry,decodeCanonicalGeometryRef} from '../src/lib/agronomic-geometry-adapter.js'

const text=(value,max=180)=>String(value??'').trim().slice(0,max)
const finite=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null}
const round=(value,digits)=>Number(Number(value).toFixed(digits))
const fail=(message,code='property_profile_invalid')=>{throw Object.assign(new Error(message),{statusCode:400,code})}

export const MAX_FIELDS=200
export const MAX_FIELD_POINTS=500

export function normalizeLocation(value){
 if(value===null||value===undefined||value==='')return null
 const lat=finite(value.lat??value.latitude);const lng=finite(value.lng??value.lon??value.longitude)
 if(lat===null||lng===null)fail('A localização precisa de latitude e longitude numéricas.','property_location_invalid')
 if(lat<-90||lat>90||lng<-180||lng>180)fail('A localização está fora do intervalo de latitude/longitude.','property_location_out_of_range')
 return {lat:round(lat,6),lng:round(lng,6)}
}

export function normalizeFieldPoints(value,label){
 if(!Array.isArray(value)||!value.length)return []
 if(value.length>MAX_FIELD_POINTS)fail(`O talhão "${label}" tem pontos demais (máximo ${MAX_FIELD_POINTS}).`,'field_points_too_many')
 const points=value.map(point=>normalizeLocation(point)).filter(Boolean)
 if(points.length<3)fail(`O talhão "${label}" precisa de pelo menos três pontos para fechar o contorno.`,'field_points_incomplete')
 return points
}

// `location` ausente = manter; null = remover; objeto = marcar.
export function normalizePropertyProfileInput(input={}){
 const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{}
 if(source.propertyId!==undefined&&(typeof source.propertyId!=='string'||!source.propertyId.trim()||source.propertyId.length>180))fail('Selecione uma propriedade válida.','property_id_invalid')
 const propertyId=source.propertyId===undefined?undefined:source.propertyId.trim()
 const propertyName=text(source.propertyName)
 const location=source.location===undefined?undefined:normalizeLocation(source.location)
 const fields=(Array.isArray(source.fields)?source.fields:[]).slice(0,MAX_FIELDS).map((item,index)=>{
  const field=item&&typeof item==='object'?item:{}
  const name=text(field.name)||`Talhão ${index+1}`
  const area=finite(field.areaHa??field.area)
  const crop=text(field.crop,80);const season=text(field.season,30)
  if(crop&&!season)fail(`Informe a safra da cultura do talhão "${name}" (ex.: 2025/26).`,'field_season_required')
  return {id:text(field.id)||null,name,areaHa:area===null||area<0?null:round(area,4),crop,season,points:normalizeFieldPoints(field.points,name),clearGeometry:field.clearGeometry===true}
 })
 const removedFieldIds=[...new Set((Array.isArray(source.removedFieldIds)?source.removedFieldIds:[]).map(id=>text(id)).filter(Boolean))].slice(0,MAX_FIELDS)
 return {propertyId,propertyName,location,fields,removedFieldIds}
}

export function locationRecord(value,{source='consultant_pin',updatedAt=null}={}){
 const location=normalizeLocation(value)
 return location?{...location,source,updatedAt}:null
}

export function locationFromMetadata(metadata){
 const stored=metadata&&typeof metadata==='object'?metadata.location:null
 if(!stored||typeof stored!=='object')return null
 try{
  const location=normalizeLocation(stored)
  return location?{...location,source:text(stored.source,60)||'consultant_pin',updatedAt:text(stored.updatedAt,80)||null}:null
 }catch{return null}
}

export function fieldPointsFromGeometryRef(geometryRef,{organizationId}={}){
 const ref=String(geometryRef||'')
 if(!ref)return {points:[],geometryStatus:'NOT_MAPPED',calculatedAreaHa:null}
 try{
  const manual=canonicalValToManualGeometry(decodeCanonicalGeometryRef(ref,{expectedOrganizationId:organizationId}),{expectedOrganizationId:organizationId})
  return {points:manual.points||[],geometryStatus:'CANONICAL',calculatedAreaHa:manual.calculatedAreaHa??null}
 }catch{return {points:[],geometryStatus:'REJECTED',calculatedAreaHa:null}}
}

export function emptyPropertyProfile(clientId,source){
 return {clientId:String(clientId||''),property:null,properties:[],fields:[],source}
}
