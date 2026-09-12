import {routeLocation} from '../src/lib/visit-route.js'

/** A single portfolio query: no geocoding, invented pins or producer-wide duplicates. */
export async function readRouteProperties(repository,ownerId){
 if(!repository?.tenantId||!ownerId)throw Object.assign(new Error('A carteira é obrigatória.'),{statusCode:403})
 if(!repository.db?.configured)throw Object.assign(new Error('Não foi possível carregar as propriedades. Tente novamente.'),{statusCode:503,exposeMessage:true})
 const {rows}=await repository.db.query(`SELECT p.id,p.name,p.municipality,p.metadata->'location' AS location,
   c.id AS client_id,c.external_key AS client_key,c.name AS producer_name,c.source,c.commercial_profile
  FROM properties p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id
  WHERE p.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active'
  ORDER BY c.name,p.name,p.id LIMIT 10001`,[repository.tenantId,ownerId])
 if(rows.length>10000)throw Object.assign(new Error('A carteira tem mais de 10.000 propriedades. Refine a carteira antes de abrir o mapa.'),{statusCode:422})
 const properties=rows.map(row=>{
  const location=routeLocation(row.location)
  const isDemo=String(row.source||'').startsWith('val-demo-')||row.commercial_profile?.isDemo===true||row.commercial_profile?.synthetic===true
  return {id:row.id,name:row.name,clientId:row.client_key||row.client_id,producerName:row.producer_name,municipality:row.municipality||null,location,isDemo,locationStatus:location?(isDemo?'DEMO':'REAL DATA'):'MISSING'}
 })
 return {properties,located:properties.filter(item=>item.location).length,missing:properties.filter(item=>!item.location).length}
}
