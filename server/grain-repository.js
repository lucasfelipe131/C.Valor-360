import {randomUUID} from 'node:crypto'
import {buildGrainOpportunities,grainCatalog,summarizeGrainWorkspace} from './grain-intelligence.js'

// Mensagem de servico escrita para o consultor ('O PostgreSQL e obrigatorio para...'): chega ao usuario em vez da mascara generica de 5xx.
const serviceError=message=>Object.assign(new Error(message),{statusCode:503,exposeMessage:true})
const domainError=(message,statusCode)=>Object.assign(new Error(message),{statusCode})
const iso=value=>value instanceof Date?value.toISOString():value||null
const jsonb=value=>JSON.stringify(value??null)
const numberOrNull=value=>value===null||value===undefined||value===''?null:Number(value)
const rawValues=(item,keys)=>[...new Set(keys.map(key=>String(item?.[key]??'').trim()).filter(Boolean))]
const exactRawScope=(item,keys,expected)=>{const values=rawValues(item,keys);return values.length===1&&values[0]===String(expected??'')}
const tenantKeys=['tenant_id','tenantId','organization_id','organizationId']
const ownerKeys=['owner_user_id','context_owner_id','contextOwnerId','owner_id','ownerId']
const producerKeys=['producer_id','producerId','client_id','clientId','subject_client_id']
const fallbackImportMatches=(item,tenantId,ownerId)=>exactRawScope(item,tenantKeys,tenantId)&&exactRawScope(item,ownerKeys,ownerId)
const fallbackProfileMatches=(item,tenantId,ownerId)=>fallbackImportMatches(item,tenantId,ownerId)&&rawValues(item,producerKeys).length===1
const fallbackIntentMatches=(item,tenantId,ownerId)=>exactRawScope(item,tenantKeys,tenantId)&&exactRawScope(item,ownerKeys,ownerId)&&rawValues(item,producerKeys).length===1
const fallbackMarketMatches=(item,tenantId,ownerId)=>exactRawScope(item,tenantKeys,tenantId)&&exactRawScope(item,ownerKeys,ownerId)&&rawValues(item,['scope','context_scope','knowledge_scope','knowledgeScope']).length===1&&rawValues(item,['scope','context_scope','knowledge_scope','knowledgeScope'])[0].toUpperCase()==='MARKET'&&rawValues(item,producerKeys).length===0
const nestedImportClientMatches=(item,tenantId,ownerId)=>{
 const tenants=rawValues(item,tenantKeys),owners=rawValues(item,ownerKeys)
 return tenants.length<=1&&owners.length<=1&&(!tenants.length||tenants[0]===String(tenantId))&&(!owners.length||owners[0]===String(ownerId))
}
const allowedIntentTransitions={draft:new Set(['monitoring','cancelled']),monitoring:new Set(['cancelled']),confirmed:new Set(['negotiating','cancelled']),negotiating:new Set(['closed','cancelled']),closed:new Set(),cancelled:new Set()}

const profileRecord=row=>({
 id:String(row.id),clientId:String(row.client_external_key||row.clientId||row.client_id||''),clientName:row.client_name||row.clientName||'',municipality:row.municipality||'',
 commodities:Array.isArray(row.commodities)?row.commodities:[],storageCapacityT:numberOrNull(row.storage_capacity_t??row.storageCapacityT),storageStructure:row.storage_structure??row.storageStructure??'',
 logisticsMode:row.logistics_mode??row.logisticsMode??'',usualDeliveryLocations:row.usual_delivery_locations??row.usualDeliveryLocations??'',marketingNotes:row.marketing_notes??row.marketingNotes??'',
 source:row.source||'consultant_interview',sourceDetails:row.source_details??row.sourceDetails??'',observedAt:iso(row.observed_at??row.observedAt),confirmedAt:iso(row.confirmed_at??row.confirmedAt),
 createdAt:iso(row.created_at??row.createdAt),updatedAt:iso(row.updated_at??row.updatedAt),
 tenantId:String(row.tenant_id??row.tenantId??''),contextOwnerId:String(row.owner_user_id??row.context_owner_id??row.contextOwnerId??row.ownerId??'')
})
const intentRecord=row=>({
 id:String(row.id),clientId:String(row.client_external_key||row.clientId||row.client_id||''),clientName:row.client_name||row.clientName||'',municipality:row.municipality||'',
 commodity:row.commodity,direction:row.direction,season:row.season||'',volume:Number(row.volume),volumeUnit:row.volume_unit??row.volumeUnit,targetPrice:numberOrNull(row.target_price??row.targetPrice),priceUnit:row.price_unit??row.priceUnit,
 deliveryStart:row.delivery_start??row.deliveryStart??null,deliveryEnd:row.delivery_end??row.deliveryEnd??null,deliveryLocation:row.delivery_location??row.deliveryLocation??'',qualitySpecs:row.quality_specs??row.qualitySpecs??'',
 status:row.status,confidence:Number(row.confidence||0),source:row.source,sourceDetails:row.source_details??row.sourceDetails??'',notes:row.notes||'',observedAt:iso(row.observed_at??row.observedAt),createdAt:iso(row.created_at??row.createdAt),updatedAt:iso(row.updated_at??row.updatedAt),
 tenantId:String(row.tenant_id??row.tenantId??''),contextOwnerId:String(row.owner_user_id??row.context_owner_id??row.contextOwnerId??row.ownerId??'')
})
const marketRecord=row=>({
 id:String(row.id),commodity:row.commodity,marketKind:row.market_kind??row.marketKind,region:row.region,price:Number(row.price),priceUnit:row.price_unit??row.priceUnit,
 deliveryStart:row.delivery_start??row.deliveryStart??null,deliveryEnd:row.delivery_end??row.deliveryEnd??null,sourceName:row.source_name??row.sourceName,sourceType:row.source_type??row.sourceType,
 sourceUrl:row.source_url??row.sourceUrl??'',confidence:Number(row.confidence||0),notes:row.notes||'',observedAt:iso(row.observed_at??row.observedAt),status:row.status||'active',createdAt:iso(row.created_at??row.createdAt),updatedAt:iso(row.updated_at??row.updatedAt),
 tenantId:String(row.tenant_id??row.tenantId??''),contextOwnerId:String(row.owner_user_id??row.context_owner_id??row.contextOwnerId??row.ownerId??''),scope:String(row.scope??'')
})
const producerRecord=row=>({
 id:String(row.external_key||row.id),name:row.name||'Produtor',municipality:row.municipality||'',cultures:row.cultures||'',area:row.area_band||(row.total_area_ha==null?null:Number(row.total_area_ha)),profileId:row.profile_id?String(row.profile_id):null,
 tenantId:String(row.tenant_id??row.tenantId??''),contextOwnerId:String(row.consultant_id??row.context_owner_id??row.contextOwnerId??row.ownerId??'')
})

export class GrainRepository{
 constructor({db,readStore,saveStore,tenantId}){this.db=db;this.readStore=readStore;this.saveStore=saveStore;this.tenantId=tenantId}

 fallback(){
  const store=this.readStore();store.grains||={profiles:[],intentions:[],marketSnapshots:[]};store.grains.profiles||=[];store.grains.intentions||=[];store.grains.marketSnapshots||=[];return store
 }

 fallbackProducers(store,ownerId){
  const producers=new Map()
  for(const record of store.imports||[]){
   if(!fallbackImportMatches(record,this.tenantId,ownerId))continue
   for(const client of record.clients||[])if((client?.id||client?.name)&&nestedImportClientMatches(client,this.tenantId,ownerId))producers.set(String(client.id||client.name),{id:String(client.id||client.name),name:client.name||'Produtor',municipality:client.municipality||'',cultures:client.cultures||'',area:client.area??null,profileId:null,tenantId:this.tenantId,contextOwnerId:String(ownerId)})
  }
  for(const profile of store.grains.profiles||[])if(fallbackProfileMatches(profile,this.tenantId,ownerId)&&profile.clientId&&!producers.has(String(profile.clientId)))producers.set(String(profile.clientId),{id:String(profile.clientId),name:profile.clientName||'Produtor',municipality:profile.municipality||'',cultures:'',area:null,profileId:profile.id,tenantId:this.tenantId,contextOwnerId:String(ownerId)})
  return [...producers.values()]
 }

 assemble({producers,profiles,intentions,marketSnapshots}){
  const opportunities=buildGrainOpportunities({intentions,marketSnapshots})
  return {producers,profiles,intentions,marketSnapshots,opportunities,summary:summarizeGrainWorkspace({producers,profiles,intentions,marketSnapshots,opportunities}),catalog:grainCatalog,governance:{rulesVersion:'sog-rules-v1',automaticTrading:false,humanConfirmationRequired:true,marketSourceRequired:true}}
 }

 async getWorkspace(ownerId){
  if(!this.db.configured){
   const store=this.fallback();const profiles=store.grains.profiles.filter(item=>fallbackProfileMatches(item,this.tenantId,ownerId)).map(profileRecord);const intentions=store.grains.intentions.filter(item=>fallbackIntentMatches(item,this.tenantId,ownerId)).map(intentRecord);const marketSnapshots=store.grains.marketSnapshots.filter(item=>fallbackMarketMatches(item,this.tenantId,ownerId)).map(marketRecord).sort((left,right)=>String(right.observedAt).localeCompare(String(left.observedAt)));return this.assemble({producers:this.fallbackProducers(store,ownerId),profiles,intentions,marketSnapshots})
  }
  try{
   const [producerResult,intentResult,marketResult]=await Promise.all([
    this.db.query(`SELECT c.id,c.external_key,c.name,c.municipality,c.cultures,c.total_area_ha,c.area_band,c.tenant_id,c.consultant_id,p.id profile_id,p.commodities,p.storage_capacity_t,p.storage_structure,p.logistics_mode,p.usual_delivery_locations,p.marketing_notes,p.source,p.source_details,p.observed_at,p.confirmed_at,p.created_at,p.updated_at FROM clients c LEFT JOIN sog_producer_profiles p ON p.tenant_id=c.tenant_id AND p.owner_user_id=$2 AND p.client_id=c.id WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active' ORDER BY c.name LIMIT 5000`,[this.tenantId,ownerId]),
    this.db.query(`SELECT i.*,c.external_key client_external_key,c.name client_name,c.municipality FROM sog_negotiation_intents i JOIN clients c ON c.id=i.client_id AND c.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.owner_user_id=$2 AND c.consultant_id=$2 ORDER BY i.updated_at DESC LIMIT 2000`,[this.tenantId,ownerId]),
    this.db.query(`SELECT *,'MARKET'::text scope FROM sog_market_snapshots WHERE tenant_id=$1 AND owner_user_id=$2 AND status='active' ORDER BY observed_at DESC LIMIT 1000`,[this.tenantId,ownerId])
   ])
   const producers=producerResult.rows.map(producerRecord)
   const profiles=producerResult.rows.filter(row=>row.profile_id).map(row=>profileRecord({...row,id:row.profile_id,client_external_key:row.external_key,client_name:row.name,owner_user_id:row.consultant_id}))
   return this.assemble({producers,profiles,intentions:intentResult.rows.map(intentRecord),marketSnapshots:marketResult.rows.map(marketRecord)})
  }catch{throw serviceError('A SOG não pôde carregar os dados protegidos no PostgreSQL.')}
 }

 async getMarketReferences(ownerId,{limit=80}={}){
  const boundedLimit=Math.max(2,Math.min(200,Number(limit)||80))
  if(!this.db.configured){
   const store=this.fallback()
   return {marketSnapshots:store.grains.marketSnapshots.filter(item=>fallbackMarketMatches(item,this.tenantId,ownerId)&&item.status!=='inactive').map(marketRecord).sort((left,right)=>String(right.observedAt).localeCompare(String(left.observedAt))).slice(0,boundedLimit)}
  }
  try{
   const result=await this.db.query(`SELECT *,'MARKET'::text scope FROM sog_market_snapshots WHERE tenant_id=$1 AND owner_user_id=$2 AND status='active' ORDER BY observed_at DESC LIMIT $3`,[this.tenantId,ownerId,boundedLimit])
   return {marketSnapshots:result.rows.map(marketRecord)}
  }catch{throw serviceError('A referência de mercado não pôde ser consultada no PostgreSQL.')}
 }

 async saveProfile(input,ownerId){
  const now=new Date().toISOString()
  if(!this.db.configured){
   const store=this.fallback();const current=store.grains.profiles.find(item=>fallbackProfileMatches(item,this.tenantId,ownerId)&&item.clientId===input.clientId);const producer=this.fallbackProducers(store,ownerId).find(item=>item.id===input.clientId);if(!producer&&!current)throw domainError('Produtor não encontrado na sua carteira.',404);const record={...current,...input,id:current?.id||randomUUID(),tenantId:this.tenantId,ownerId,contextOwnerId:ownerId,clientName:producer?.name||current?.clientName||'Produtor',municipality:producer?.municipality||current?.municipality||'',confirmedAt:input.confirmed?now:null,createdAt:current?.createdAt||now,updatedAt:now};store.grains.profiles=store.grains.profiles.filter(item=>!(fallbackProfileMatches(item,this.tenantId,ownerId)&&item.clientId===input.clientId)).concat(record).slice(-2000);this.saveStore(store);return profileRecord(record)
  }
  try{return await this.db.transaction(async connection=>{
   const client=await connection.query(`SELECT id,external_key,name,municipality FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1 FOR UPDATE`,[this.tenantId,ownerId,input.clientId])
   if(!client.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404)
   const result=await connection.query(`INSERT INTO sog_producer_profiles (tenant_id,owner_user_id,client_id,commodities,storage_capacity_t,storage_structure,logistics_mode,usual_delivery_locations,marketing_notes,source,source_details,observed_at,confirmed_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) ON CONFLICT (tenant_id,owner_user_id,client_id) DO UPDATE SET commodities=EXCLUDED.commodities,storage_capacity_t=EXCLUDED.storage_capacity_t,storage_structure=EXCLUDED.storage_structure,logistics_mode=EXCLUDED.logistics_mode,usual_delivery_locations=EXCLUDED.usual_delivery_locations,marketing_notes=EXCLUDED.marketing_notes,source=EXCLUDED.source,source_details=EXCLUDED.source_details,observed_at=EXCLUDED.observed_at,confirmed_at=EXCLUDED.confirmed_at,updated_at=NOW() RETURNING *`,[this.tenantId,ownerId,client.rows[0].id,jsonb(input.commodities),input.storageCapacityT,input.storageStructure||null,input.logisticsMode||null,input.usualDeliveryLocations||null,input.marketingNotes||null,input.source,input.sourceDetails||null,input.observedAt,input.confirmed?now:null])
   return profileRecord({...result.rows[0],client_external_key:client.rows[0].external_key,client_name:client.rows[0].name,municipality:client.rows[0].municipality})
  })}catch(error){if(error.statusCode)throw error;throw serviceError('O perfil de grãos não pôde ser salvo no PostgreSQL.')}
 }

 async saveIntent(input,ownerId){
  const id=randomUUID();const now=new Date().toISOString()
  if(!this.db.configured){
   const store=this.fallback();const producer=this.fallbackProducers(store,ownerId).find(item=>item.id===input.clientId);if(!producer)throw domainError('Produtor não encontrado na sua carteira.',404);const record={...input,id,tenantId:this.tenantId,ownerId,contextOwnerId:ownerId,clientName:producer.name,municipality:producer.municipality||'',createdAt:now,updatedAt:now};store.grains.intentions.push(record);store.grains.intentions=store.grains.intentions.slice(-5000);this.saveStore(store);return intentRecord(record)
  }
  try{return await this.db.transaction(async connection=>{
   const client=await connection.query(`SELECT id,external_key,name,municipality FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1`,[this.tenantId,ownerId,input.clientId])
   if(!client.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404)
   const result=await connection.query(`INSERT INTO sog_negotiation_intents (id,tenant_id,owner_user_id,client_id,commodity,direction,season,volume,volume_unit,target_price,price_unit,delivery_start,delivery_end,delivery_location,quality_specs,status,confidence,source,source_details,notes,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,[id,this.tenantId,ownerId,client.rows[0].id,input.commodity,input.direction,input.season||null,input.volume,input.volumeUnit,input.targetPrice,input.priceUnit,input.deliveryStart,input.deliveryEnd,input.deliveryLocation||null,input.qualitySpecs||null,input.status,input.confidence,input.source,input.sourceDetails||null,input.notes||null,input.observedAt])
   return intentRecord({...result.rows[0],client_external_key:client.rows[0].external_key,client_name:client.rows[0].name,municipality:client.rows[0].municipality})
  })}catch(error){if(error.statusCode)throw error;throw serviceError('A intenção de negociação não pôde ser salva no PostgreSQL.')}
 }

 async updateIntentStatus(id,status,ownerId){
  if(!this.db.configured){const store=this.fallback();const record=store.grains.intentions.find(item=>fallbackIntentMatches(item,this.tenantId,ownerId)&&item.id===id);if(!record)throw domainError('Intenção não encontrada.',404);if(record.status!==status&&!allowedIntentTransitions[record.status]?.has(status))throw domainError('Esta mudança de estado exige uma nova validação da intenção.',409);record.status=status;record.updatedAt=new Date().toISOString();this.saveStore(store);return intentRecord(record)}
  try{return await this.db.transaction(async connection=>{const selected=await connection.query(`SELECT * FROM sog_negotiation_intents WHERE id=$3 AND tenant_id=$1 AND owner_user_id=$2 LIMIT 1 FOR UPDATE`,[this.tenantId,ownerId,id]);if(!selected.rowCount)throw domainError('Intenção não encontrada.',404);const current=selected.rows[0];if(current.status!==status&&!allowedIntentTransitions[current.status]?.has(status))throw domainError('Esta mudança de estado exige uma nova validação da intenção.',409);const result=await connection.query(`UPDATE sog_negotiation_intents SET status=$4,updated_at=NOW() WHERE id=$3 AND tenant_id=$1 AND owner_user_id=$2 RETURNING *`,[this.tenantId,ownerId,id,status]);return intentRecord(result.rows[0])})}catch(error){if(error.statusCode)throw error;throw serviceError('O estado da intenção não pôde ser atualizado.')}
 }

 async saveMarketSnapshot(input,ownerId){
  const id=randomUUID();const now=new Date().toISOString()
  if(!this.db.configured){const store=this.fallback();const record={...input,id,tenantId:this.tenantId,ownerId,contextOwnerId:ownerId,scope:'MARKET',createdAt:now,updatedAt:now};store.grains.marketSnapshots.push(record);store.grains.marketSnapshots=store.grains.marketSnapshots.slice(-5000);this.saveStore(store);return marketRecord(record)}
  try{const result=await this.db.query(`INSERT INTO sog_market_snapshots (id,tenant_id,owner_user_id,commodity,market_kind,region,price,price_unit,delivery_start,delivery_end,source_name,source_type,source_url,confidence,notes,observed_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active') RETURNING *,'MARKET'::text scope`,[id,this.tenantId,ownerId,input.commodity,input.marketKind,input.region,input.price,input.priceUnit,input.deliveryStart,input.deliveryEnd,input.sourceName,input.sourceType,input.sourceUrl||null,input.confidence,input.notes||null,input.observedAt]);return marketRecord(result.rows[0])}catch{throw serviceError('A referência de mercado não pôde ser salva no PostgreSQL.')}
 }
}
