// Read-only adapter over canonical producer tables. No persistence, AI or seed path.
import {fieldPointsFromGeometryRef,locationFromMetadata} from './property-profile.js'
const missing=(message,statusCode=404)=>Object.assign(new Error(message),{statusCode})
const number=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value)
const object=value=>value&&typeof value==='object'?value:{}
const matches=(item,tenantId,ownerId,clientId)=>String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)&&String(item.clientId)===String(clientId)
export async function readProducerWorkspace(repository,clientId,ownerId){
 if(!ownerId)throw missing('Sua sessão expirou.',401)
 const tenantId=repository.tenantId
 if(!repository.db.configured){
  const client=(await repository.getIntelligence(ownerId)).clients.find(item=>String(item.id)===String(clientId))
  if(!client)throw missing('Produtor não encontrado na sua carteira.')
  const store=repository.readStore()
  const profiles=(store.val?.propertyProfiles||[]).filter(item=>matches(item,tenantId,ownerId,clientId))
  const properties=profiles.flatMap(item=>item.property?[{...item.property}]:[])
  const fields=profiles.flatMap(item=>(item.fields||[]).map(field=>({...field,propertyId:item.property?.id})))
  const plans=(store.val?.actionPlans||[]).filter(item=>matches(item,tenantId,ownerId,clientId)&&['PROPOSED','ACCEPTED','IN_PROGRESS'].includes(item.status)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))
  return {clientId,properties,property:properties[0]||null,fields,seasons:fields.flatMap(field=>(field.seasons||[]).map(season=>({...season,fieldId:field.id}))),plan:plans[0]||null,complete:true,source:'arquivo-local',isDemo:client.isDemo===true||client.demo?.synthetic===true||client.profileSource==='val-demo-synthetic-v1'}
 }
 const db=repository.db
 const scoped=await db.query(`SELECT id,source FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1`,[tenantId,ownerId,clientId])
 if(!scoped.rows[0])throw missing('Produtor não encontrado na sua carteira.')
 const id=scoped.rows[0].id
 const args=[tenantId,ownerId,id]
 const [p,f,s,a]=await Promise.all([
  db.query(`SELECT p.* FROM properties p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.id=$3 ORDER BY p.updated_at DESC LIMIT 201`,args),
  db.query(`SELECT f.* FROM fields f JOIN properties p ON p.tenant_id=f.tenant_id AND p.id=f.property_id JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.id=$3 ORDER BY f.name LIMIT 2001`,args),
  db.query(`SELECT s.* FROM crop_seasons s JOIN fields f ON f.tenant_id=s.tenant_id AND f.id=s.field_id JOIN properties p ON p.tenant_id=f.tenant_id AND p.id=f.property_id JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.id=$3 ORDER BY s.season DESC,s.created_at DESC LIMIT 5001`,args),
  db.query(`SELECT a.id,a.status,a.priorities,a.updated_at FROM val_action_plans a JOIN clients c ON c.tenant_id=a.tenant_id AND c.id=a.client_id WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.id=$3 AND a.owner_user_id=$2 AND a.status IN ('PROPOSED','ACCEPTED','IN_PROGRESS') ORDER BY a.updated_at DESC LIMIT 1`,args)
 ])
 const complete=p.rows.length<=200&&f.rows.length<=2000&&s.rows.length<=5000
 const properties=p.rows.slice(0,200).map(row=>({id:String(row.id),name:row.name,areaHa:number(row.area_ha),location:locationFromMetadata(object(row.metadata)),updatedAt:row.updated_at}))
 const fields=f.rows.slice(0,2000).map(row=>({id:String(row.id),propertyId:String(row.property_id),name:row.name,areaHa:number(row.area_ha),...(({points,polygons,multipart})=>({points,polygons,multipart}))(fieldPointsFromGeometryRef(row.geometry_ref,{organizationId:tenantId}))}))
 const seasons=s.rows.slice(0,5000).map(row=>({id:String(row.id),fieldId:String(row.field_id),season:row.season,crop:row.crop,areaHa:number(row.area_ha),productivityTarget:number(row.productivity_target),productivityActual:number(row.productivity_actual),unit:row.unit,cultivar:row.cultivar,createdAt:row.created_at}))
 return {clientId,properties,property:properties[0]||null,fields,seasons,plan:a.rows[0]||null,complete,source:'postgresql',isDemo:scoped.rows[0].source==='val-demo-synthetic-v1'}
}
