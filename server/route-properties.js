import {routeLocation} from '../src/lib/visit-route.js'

/** A single portfolio query: no geocoding, invented pins or producer-wide duplicates. */
export async function readRouteProperties(repository,ownerId){
 if(!repository?.tenantId||!ownerId)throw Object.assign(new Error('A carteira é obrigatória.'),{statusCode:403})
 if(!repository.db?.configured)throw Object.assign(new Error('Não foi possível carregar as propriedades. Tente novamente.'),{statusCode:503,exposeMessage:true})
 const {rows}=await repository.db.query(`SELECT p.id,p.name,p.municipality,p.metadata->'location' AS location,
   c.id AS client_id,c.external_key AS client_key,c.name AS producer_name,c.source,c.commercial_profile,
   producer_photo.updated_at AS producer_photo_version,property_photo.updated_at AS property_photo_version
  FROM properties p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id
  LEFT JOIN val_profile_photos producer_photo ON producer_photo.tenant_id=c.tenant_id AND producer_photo.entity_kind='producer' AND producer_photo.entity_id=c.id AND producer_photo.photo IS NOT NULL
  LEFT JOIN val_profile_photos property_photo ON property_photo.tenant_id=p.tenant_id AND property_photo.entity_kind='property' AND property_photo.entity_id=p.id AND property_photo.photo IS NOT NULL
  WHERE p.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active'
  ORDER BY c.name,p.name,p.id LIMIT 10001`,[repository.tenantId,ownerId])
 if(rows.length>10000)throw Object.assign(new Error('A carteira tem mais de 10.000 propriedades. Refine a carteira antes de abrir o mapa.'),{statusCode:422})
 const properties=rows.map(row=>{
  const location=routeLocation(row.location)
  const isDemo=String(row.source||'').startsWith('val-demo-')||row.commercial_profile?.isDemo===true||row.commercial_profile?.synthetic===true
  const clientId=row.client_key||row.client_id,base=`/api/clients/${encodeURIComponent(clientId)}`
  // URLs keep the portfolio response small and recheck access when read.
  const photoUrl=(path,version)=>version?`${base}${path}/profile-photo?content=1&v=${encodeURIComponent(new Date(version).toISOString())}`:null
  return {id:row.id,name:row.name,clientId,producerName:row.producer_name,municipality:row.municipality||null,location,isDemo,locationStatus:location?(isDemo?'DEMO':'REAL DATA'):'MISSING',propertyPhotoUrl:photoUrl(`/properties/${row.id}`,row.property_photo_version),producerPhotoUrl:photoUrl('',row.producer_photo_version)}
 })
 return {properties,located:properties.filter(item=>item.location).length,missing:properties.filter(item=>!item.location).length}
}
