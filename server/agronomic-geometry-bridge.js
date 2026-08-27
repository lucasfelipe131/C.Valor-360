import {AGRONOMIC_GEOMETRY_REF_PREFIX,canonicalValToManualGeometry,decodeCanonicalGeometryRef} from '../src/lib/agronomic-geometry-adapter.js'

const array=value=>Array.isArray(value)?value:[]
const text=value=>String(value??'').trim()
const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0}

function fieldForManual(field,property,organizationId,issues){
 const geometryRef=text(field.geometry_ref||field.geometryRef)
 let geometry=null
 let geometryStatus=geometryRef?'LEGACY_REFERENCE':'NOT_MAPPED'
 if(geometryRef.startsWith(AGRONOMIC_GEOMETRY_REF_PREFIX)){
  try{
   geometry=canonicalValToManualGeometry(decodeCanonicalGeometryRef(geometryRef,{expectedOrganizationId:organizationId}),{expectedOrganizationId:organizationId})
   geometryStatus='CANONICAL'
  }catch(error){
   geometryStatus='REJECTED'
   issues.push({propertyId:text(property.id),fieldId:text(field.id),code:text(error.code)||'geometry_ref_invalid'})
  }
 }
 const latest=field.latest_season&&typeof field.latest_season==='object'?field.latest_season:{}
 return {
  id:text(geometry?.link?.sourceFieldId||field.external_key||field.id),canonicalFieldId:text(field.id),
  propertyId:text(property.id),propertyName:text(property.name),name:text(field.name)||'Talhão',
  crop:text(latest.crop),season:text(latest.season),area:geometry?.calculatedAreaHa??number(field.area_ha),
  points:geometry?.points||[],polygons:geometry?.polygons||[],geometry:geometry?.geometry||null,
  geometryAdapterVersion:geometry?.adapterVersion||null,geometryVersion:geometry?.geometryVersion||text(field.geometry_version)||null,
  geometryProvenance:geometry?.provenance||null,geometryStatus,geometryAction:'UNCHANGED',ndviScenes:[]
 }
}

export function technicalBootstrapFromValClients(clients,{organizationId}={}){
 const issues=[]
 const producers=array(clients).map(client=>{
  const properties=array(client.properties)
  const fields=properties.flatMap(property=>array(property.fields).map(field=>fieldForManual(field,property,organizationId,issues)))
  const rawArea=typeof client.area==='number'?client.area:Number(String(client.area||'').replace(/\./g,'').replace(',','.').match(/\d+(?:\.\d+)?/)?.[0]||0)
  const cultures=Array.isArray(client.cultures)?client.cultures:String(client.cultures||'').split(/[,;/|]+/).map(item=>item.trim()).filter(Boolean)
  return {
   id:text(client.id),name:text(client.name)||'Produtor',crmCode:text(client.id),document:'',phone:text(client.commercial?.phone),email:text(client.commercial?.email),city:text(client.municipality),
   properties:properties.map(property=>text(property.name)).filter(Boolean).join('; ')||text(client.commercial?.property),
   area:Number.isFinite(rawArea)?rawArea:0,cultures,
   notes:[client.primaryProfile&&`Perfil Produtor 360: ${client.primaryProfile}`,client.additionalNeed&&`Necessidade declarada: ${client.additionalNeed}`].filter(Boolean).join('\n'),
   fields,registrations:[],mappingStatus:fields.some(field=>field.geometryStatus==='CANONICAL')?'mapped':'pending',crmSource:'VALOR 360'
  }
 })
 return {producers,geometryIssues:issues}
}
