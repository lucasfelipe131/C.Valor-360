import {assertTenantScope} from '../tenant-scope.js'
import {deriveSignals,hasTechnicalApproval} from '../ingestion.js'
import {describeEvent,HUB_CONTRACT_VERSION,HUB_STATUSES,SOURCE_SYSTEMS} from './registry.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fault=(code,statusCode=422)=>Object.assign(new Error(code),{code,statusCode})
const normalized=value=>String(value??'').trim().toLocaleLowerCase('pt-BR')
const transient=error=>/^(40001|40P01|55P03|57014|08\w{3})$/.test(String(error?.code))||[502,503,504].includes(error?.statusCode)
const safeCode=error=>/^[a-zA-Z0-9_]{1,100}$/.test(String(error?.code))?String(error.code):'hub_projection_failed'
const asEvent=row=>({externalId:row.external_id,type:row.event_type,schemaVersion:row.schema_version,source:row.source,occurredAt:new Date(row.occurred_at).toISOString(),ownerUserId:row.owner_user_id,clientExternalKey:row.client_external_key||'',propertyExternalKey:row.property_external_key||'',fieldExternalKey:row.field_external_key||'',payload:row.payload,payloadHash:row.payload_hash,sourceVersion:row.source_version===null?null:Number(row.source_version)})
const summary=row=>({id:row.id,externalId:row.external_id,eventType:row.event_type,source:row.source,status:String(row.status).toUpperCase(),decision:row.decision,canonicalClientId:row.visible_client_id||null,clientName:row.client_name||null,externalEntityId:row.external_entity_id,sourceVersion:row.source_version,observedAt:row.observed_at||row.occurred_at,receivedAt:row.ingested_at,processedAt:row.processed_at,errorCode:row.error_code,retryEligible:row.retry_eligible,attempts:row.attempt_count,nextRetryAt:row.next_retry_at,latencyMs:row.latency_ms,reviewRequired:row.review_required===true})

export class IntegrationHub {
 constructor({db,repository,tenantId}){this.db=db;this.repository=repository;this.tenantId=tenantId}
 scope({tenantId=this.tenantId,ownerId}){
  tenantId=assertTenantScope(this.tenantId,tenantId)
  if(!uuid.test(String(ownerId||'')))throw fault('hub_authenticated_owner_required',401)
  if(!this.db.configured)throw fault('hub_storage_unavailable',503)
  return [tenantId,ownerId]
 }
 async audit(connection,scope,row,action,descriptor,actorId=null,errorCode=null){
  await connection.query(`INSERT INTO integration_event_audit (tenant_id,owner_user_id,event_id,action,payload_hash,envelope_hash,error_code,attempt,latency_ms,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...scope,row.id,action,descriptor.payloadHash,descriptor.envelopeHash,errorCode,row.attempt_count||0,row.latency_ms||0,actorId])
 }
 async ingest({tenantId=this.tenantId,ownerId,event}){
  const scope=this.scope({tenantId,ownerId})
  if(event.ownerUserId&&event.ownerUserId!==ownerId)throw fault('hub_owner_mismatch',403)
  const connector=SOURCE_SYSTEMS[event.source]
  if(!connector||!connector.events.includes(event.type))throw fault('hub_connector_event_unsupported')
  const descriptor=describeEvent(event)
  return this.db.transaction(async connection=>{
   // Serialize all producer identities within a source/owner, including different aliases.
   // Other portfolios and connectors keep progressing independently.
   await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`hub:${scope.join(':')}:${event.source}`])
   const existing=(await connection.query(`SELECT * FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND source=$3 AND external_id=$4 FOR UPDATE`,[...scope,event.source,event.externalId])).rows[0]
   if(existing){
    const previous=existing.envelope_hash||describeEvent(asEvent(existing)).envelopeHash
    const duplicate=previous===descriptor.envelopeHash
    await this.audit(connection,scope,existing,duplicate?'DUPLICATE':'CONFLICT',descriptor,null,duplicate?null:'hub_external_id_content_conflict')
    return {eventId:existing.id,duplicate,processed:false,status:duplicate?'DUPLICATE':'CONFLICT',originalStatus:String(existing.status).toUpperCase(),signals:0,...(!duplicate?{errorCode:'hub_external_id_content_conflict'}:{})}
   }
   const row=(await connection.query(`INSERT INTO integration_events (tenant_id,owner_user_id,external_id,event_type,schema_version,source,occurred_at,client_external_key,property_external_key,field_external_key,payload,payload_hash,status,hub_contract_version,external_entity_type,external_entity_id,source_version,envelope_hash,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'received',$13,$14,$15,$16,$17,$18) RETURNING *`,[...scope,event.externalId,event.type,event.schemaVersion,event.source,event.occurredAt,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,JSON.stringify(event.payload),descriptor.payloadHash,HUB_CONTRACT_VERSION,descriptor.entityType,descriptor.entityId,descriptor.sourceVersion,descriptor.envelopeHash,descriptor.observedAt])).rows[0]
   await this.audit(connection,scope,row,'RECEIVED',descriptor)
   return this.process(connection,scope,row,event,descriptor)
  })
 }
 async resolveIdentity(connection,scope,event,descriptor){
  const key=event.clientExternalKey||''
  if(!key&&!descriptor.producerId)return {client:null,create:false}
  const aliases=(event.payload.identity?.legacyExternalKeys||[])
  const declaredAliases=Array.isArray(aliases)?aliases.filter(x=>typeof x==='string').slice(0,50):[]
  const candidates=(await connection.query(`SELECT DISTINCT c.* FROM clients c LEFT JOIN integration_entity_links l ON l.tenant_id=c.tenant_id AND l.owner_user_id=c.consultant_id AND l.canonical_client_id=c.id AND l.source=$5 WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND (c.id::text=$3 OR c.external_key=$3 OR COALESCE(c.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? $3 OR ($4<>'' AND (l.external_entity_id=$4 OR c.commercial_profile->'manual_identity'->>'producer_id'=$4)) OR c.external_key=ANY($6::text[]) OR COALESCE(c.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ?| $6::text[]) LIMIT 3`,[...scope,key,descriptor.producerId,event.source,declaredAliases])).rows
  if(candidates.length>1)throw fault('hub_identity_ambiguous',409)
  const client=candidates[0]||null
  if(client){
   if(client.status!=='active')throw fault('hub_producer_archived',409)
   const locked=(await connection.query('SELECT * FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3 FOR UPDATE',[...scope,client.id])).rows[0]
   if(!locked||locked.status!=='active')throw fault('hub_identity_unresolved',409)
   return {client:locked,create:false}
  }
  if(event.type!=='manual.producer.updated'||!key||!descriptor.producerId)throw fault('hub_identity_unresolved',409)
  const producer=event.payload.producer||event.payload
  const name=producer.name||producer.producerName||''
  // A name is a collision warning, never an identity proof.
  const collision=await connection.query(`SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND LOWER(BTRIM(name))=LOWER(BTRIM($3)) LIMIT 1`,[...scope,name])
  if(collision.rows.length)throw fault('hub_identity_name_collision',409)
  return {client:null,create:true}
 }
 async process(connection,scope,row,event,descriptor,actorId=null){
  const start=Date.now()
  row.attempt_count=Number(row.attempt_count||0)+1
  await connection.query('SAVEPOINT hub_projection')
  let status='PROCESSED',decision='NEWER',errorCode=null,result={signals:0},canonicalId=null
  try{
   if(Date.parse(descriptor.observedAt)>Date.now()+300000)throw fault('hub_observed_at_future')
   const identity=await this.resolveIdentity(connection,scope,event,descriptor)
   canonicalId=identity.client?.id||null
   const previous=(await connection.query(`SELECT * FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND source=$3 AND external_entity_type=$4 AND (external_entity_id=$5 OR ($7::uuid IS NOT NULL AND $4='manual.producer.updated' AND canonical_client_id=$7)) AND status='processed' AND hub_contract_version IS NOT NULL AND id<>$6 ORDER BY source_version DESC NULLS LAST,observed_at DESC,ingested_at DESC LIMIT 1`,[...scope,event.source,descriptor.entityType,descriptor.entityId,row.id,canonicalId])).rows[0]
   if(previous){
    const oldVersion=previous.source_version===null?null:Number(previous.source_version)
    if(oldVersion!==null&&descriptor.sourceVersion===null)throw fault('hub_version_missing',409)
    const comparison=descriptor.sourceVersion!==null&&oldVersion!==null?descriptor.sourceVersion-oldVersion:Date.parse(descriptor.observedAt)-new Date(previous.observed_at).getTime()
    if(comparison<0){status='OLDER';decision='OLDER'}
    else if(comparison===0){
     if(previous.envelope_hash===descriptor.envelopeHash){status='DUPLICATE';decision='DUPLICATE'}
     else throw fault('hub_version_conflict',409)
    }
    if(status==='PROCESSED'&&hasTechnicalApproval(previous.payload)&&!hasTechnicalApproval(event.payload))throw fault('hub_approved_data_conflict',409)
   }
   if(status==='PROCESSED'){
    if(identity.client&&event.type==='manual.producer.updated'){
     const c=identity.client,p=event.payload.producer||event.payload
     const pairs=[[c.name,p.name||p.producerName],[c.municipality,p.city||p.municipality],[c.total_area_ha,p.areaHa??p.area??p.totalAreaHa],[c.cultures,Array.isArray(p.cultures)?p.cultures.join(', '):p.cultures],[c.preferred_channel,p.preferredChannel||p.servicePreference]]
     const changed=pairs.some(([a,b])=>a!==null&&a!==''&&b!==undefined&&b!==null&&b!==''&&normalized(a)!==normalized(b)&&!(Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Number(a)===Number(b)))
     const modifiedSinceSync=previous?.processed_at&&new Date(c.updated_at)>new Date(previous.processed_at)
     if(changed&&(c.source!=='manual-do-agronomo'||modifiedSinceSync))throw fault('hub_canonical_data_conflict',409)
    }
    // Keep the canonical key and existing projection logic. External keys remain in
    // the original event and the alias list; the materializer cannot mint a second client.
    const projection={...event,payloadHash:descriptor.payloadHash,payload:{...event.payload}}
    if(identity.client)projection.clientExternalKey=identity.client.external_key||identity.client.id
    if(event.type==='manual.producer.updated')projection.payload.identity={...(event.payload.identity||{}),allowLegacyKeyMigration:false}
    result=await this.repository.ingestEvent({tenantId:scope[0],ownerId:scope[1],event:projection,signals:deriveSignals(event),connection,integrationEventId:row.id})
    canonicalId=result.canonicalClientId||canonicalId
    if(canonicalId&&descriptor.producerId){
     await connection.query(`INSERT INTO integration_entity_links (tenant_id,owner_user_id,source,external_entity_id,canonical_client_id,created_by_event_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,owner_user_id,source,external_entity_id) DO NOTHING`,[...scope,event.source,descriptor.producerId,canonicalId,row.id])
    }
    if(canonicalId&&event.type==='manual.producer.updated'){
     const current=(await connection.query('SELECT commercial_profile FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3',[...scope,canonicalId])).rows[0]
     const profile=current.commercial_profile||{},manual=profile.manual_identity||{}
     const aliases=[...new Set([...(manual.external_key_aliases||[]),event.clientExternalKey,...(Array.isArray(event.payload.identity?.legacyExternalKeys)?event.payload.identity.legacyExternalKeys:[])].filter(x=>typeof x==='string'&&x))].slice(0,50)
     await connection.query('UPDATE clients SET commercial_profile=$4 WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3',[...scope,canonicalId,JSON.stringify({...profile,manual_identity:{...manual,producer_id:manual.producer_id||descriptor.producerId,external_key_aliases:aliases}})])
    }
   }
   await connection.query('RELEASE SAVEPOINT hub_projection')
  }catch(error){
   await connection.query('ROLLBACK TO SAVEPOINT hub_projection')
   await connection.query('RELEASE SAVEPOINT hub_projection')
   canonicalId=null;errorCode=safeCode(error)
   status=error.statusCode===409?'REVIEW_REQUIRED':transient(error)?'FAILED':'REJECTED'
   decision=error.statusCode===409?(errorCode.includes('conflict')?'CONFLICT':'REVIEW_REQUIRED'):status
  }
  row.latency_ms=Math.max(0,Date.now()-start)
  const eligible=status==='FAILED'&&row.attempt_count<5
  const updated=(await connection.query(`UPDATE integration_events SET status=$4::text,decision=$5,canonical_client_id=$6,error_code=$7::text,error=$7::text,retry_eligible=$8,attempt_count=$9,next_retry_at=CASE WHEN $8 THEN NOW()+($10*interval '1 second') ELSE NULL END,processed_at=CASE WHEN $4::text='processed' THEN NOW() ELSE NULL END,latency_ms=$11 WHERE tenant_id=$1 AND owner_user_id=$2 AND id=$3 RETURNING *`,[...scope,row.id,status.toLowerCase(),decision,canonicalId,errorCode,eligible,row.attempt_count,Math.min(3600,30*2**(row.attempt_count-1)),row.latency_ms])).rows[0]
  await this.audit(connection,scope,updated,status,descriptor,actorId,errorCode)
  return {eventId:row.id,duplicate:status==='DUPLICATE',processed:status==='PROCESSED',status,decision,canonicalClientId:canonicalId,signals:status==='PROCESSED'?result.signals:0,retryEligible:eligible,errorCode,...(result.measurementSetStatus?{measurementSetStatus:result.measurementSetStatus}:{})}
 }
 async retry({tenantId,ownerId,eventId}){
  const scope=this.scope({tenantId,ownerId})
  if(!uuid.test(String(eventId)))throw fault('hub_event_not_found',404)
  return this.db.transaction(async connection=>{
   // Same ordering as ingest prevents cross-path deadlocks.
   const source=(await connection.query('SELECT source FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND id=$3',[...scope,eventId])).rows[0]?.source
   if(!source)throw fault('hub_event_not_found',404)
   await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`hub:${scope.join(':')}:${source}`])
   const row=(await connection.query('SELECT * FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND id=$3 FOR UPDATE',[...scope,eventId])).rows[0]
   if(row.status!=='failed'||!row.retry_eligible||!row.hub_contract_version)throw fault('hub_retry_not_eligible',409)
   if(new Date(row.next_retry_at)>new Date())throw fault('hub_retry_backoff',429)
   const event=asEvent(row),descriptor=describeEvent(event)
   await this.audit(connection,scope,row,'RETRY_REQUESTED',descriptor,ownerId)
   return this.process(connection,scope,row,event,descriptor,ownerId)
  })
 }
 async overview({tenantId,ownerId,status='',limit=50,offset=0}){
  const scope=this.scope({tenantId,ownerId})
  status=String(status||'').toUpperCase()
  if(status&&!HUB_STATUSES.includes(status))throw fault('hub_status_invalid',400)
  limit=Math.max(1,Math.min(100,Number.parseInt(limit)||50));offset=Math.max(0,Math.min(100000,Number.parseInt(offset)||0))
  const counts=(await this.db.query(`SELECT source,COUNT(*)::integer total,COUNT(*) FILTER (WHERE status='processed')::integer processed,COUNT(*) FILTER (WHERE status='rejected')::integer rejected,COUNT(*) FILTER (WHERE status='review_required')::integer review,COUNT(*) FILTER (WHERE status='failed')::integer failures,COALESCE(SUM(GREATEST(attempt_count-1,0)),0)::integer retries,ROUND(AVG(latency_ms))::integer latency_ms,MAX(processed_at) last_sync,MAX(ingested_at) last_received FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 GROUP BY source`,scope)).rows
  const conflicts=(await this.db.query(`SELECT e.source,COUNT(DISTINCT a.event_id)::integer conflicts FROM integration_event_audit a JOIN integration_events e ON e.tenant_id=a.tenant_id AND e.owner_user_id=a.owner_user_id AND e.id=a.event_id WHERE a.tenant_id=$1 AND a.owner_user_id=$2 AND a.action='CONFLICT' GROUP BY e.source`,scope)).rows
  const connectors=Object.values(SOURCE_SYSTEMS).map(connector=>{
   const metrics=counts.find(x=>x.source===connector.id)||{total:0,processed:0,rejected:0,review:0,failures:0,retries:0,latency_ms:null,last_sync:null,last_received:null}
   const conflictCount=conflicts.find(x=>x.source===connector.id)?.conflicts||0
   return {...connector,health:metrics.failures?'DEGRADED':metrics.review||metrics.rejected||conflictCount?'ATTENTION':metrics.total?'HEALTHY':'NO_EVENTS',metrics:{...metrics,conflicts:conflictCount}}
  })
  const events=(await this.db.query(`SELECT e.*,c.id visible_client_id,c.name client_name,EXISTS(SELECT 1 FROM integration_event_audit a WHERE a.tenant_id=e.tenant_id AND a.owner_user_id=e.owner_user_id AND a.event_id=e.id AND a.action='CONFLICT') review_required FROM integration_events e LEFT JOIN clients c ON c.tenant_id=e.tenant_id AND c.consultant_id=e.owner_user_id AND c.id=e.canonical_client_id WHERE e.tenant_id=$1 AND e.owner_user_id=$2 AND ($3='' OR UPPER(e.status)=$3 OR ($3 IN ('REVIEW_REQUIRED','CONFLICT') AND EXISTS(SELECT 1 FROM integration_event_audit a WHERE a.tenant_id=e.tenant_id AND a.owner_user_id=e.owner_user_id AND a.event_id=e.id AND a.action='CONFLICT'))) ORDER BY e.ingested_at DESC,e.id LIMIT $4 OFFSET $5`,[...scope,status,limit,offset])).rows.map(summary)
  return {contractVersion:HUB_CONTRACT_VERSION,connectors,events,pagination:{limit,offset,hasMore:events.length===limit},scope:'OWN_PORTFOLIO'}
 }
 async detail({tenantId,ownerId,eventId}){
  const scope=this.scope({tenantId,ownerId})
  if(!uuid.test(String(eventId)))throw fault('hub_event_not_found',404)
  const row=(await this.db.query(`SELECT e.*,c.id visible_client_id,c.name client_name FROM integration_events e LEFT JOIN clients c ON c.tenant_id=e.tenant_id AND c.consultant_id=e.owner_user_id AND c.id=e.canonical_client_id WHERE e.tenant_id=$1 AND e.owner_user_id=$2 AND e.id=$3`,[...scope,eventId])).rows[0]
  if(!row)throw fault('hub_event_not_found',404)
  const audit=(await this.db.query(`SELECT id,sequence,action,payload_hash,envelope_hash,error_code,attempt,latency_ms,actor_user_id,created_at FROM integration_event_audit WHERE tenant_id=$1 AND owner_user_id=$2 AND event_id=$3 ORDER BY sequence`,[...scope,eventId])).rows
  // No raw payloads, credentials or exception messages leave the operational API.
  return {event:summary(row),provenance:{source:row.source,sourceEvent:row.external_id,tenantId:scope[0],ownerId:scope[1],canonicalClientId:row.visible_client_id||null,clientExternalKey:row.client_external_key,observedAt:row.observed_at||row.occurred_at,receivedAt:row.ingested_at,payloadHash:row.payload_hash,envelopeHash:row.envelope_hash,contractVersion:row.hub_contract_version||null},audit}
 }
}
