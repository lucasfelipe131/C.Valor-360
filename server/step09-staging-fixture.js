import {createHash} from 'node:crypto'
import {ValRepository} from './repository.js'
import {IntegrationHub} from './integration-hub/service.js'
import {normalizeIntegrationEvent} from './ingestion.js'
import {manualToCanonicalValGeometry,encodeCanonicalGeometryRef,canonicalGeometryAreaHa} from '../src/lib/agronomic-geometry-adapter.js'
import {realBusinessClient,realBusinessRecord} from './business-metrics-scope.js'
export const STEP09_SOURCE='step09_synthetic_fixture'
export const STEP09_ACCOUNT='uat.val.20260919.a@example.test'
export const STEP09_STAGING={RAILWAY_PROJECT_ID:'3689bcaa-603c-42f7-9e36-0b01274207c1',RAILWAY_ENVIRONMENT_ID:'8117b07b-7053-4a5a-a5c8-3f3401fef195',RAILWAY_SERVICE_ID:'28d9c5f8-40bb-412e-8a58-40a11c892f2a'}
export const isStep09Staging=env=>Object.entries(STEP09_STAGING).every(([key,value])=>env[key]===value)
export const STEP09_OBSERVED='2026-10-03T11:00:00.000Z'
export const STEP09_GEOMETRIES={property:{type:'Polygon',coordinates:[[[-54.95,-28.42],[-54.944,-28.42],[-54.944,-28.416],[-54.95,-28.416],[-54.95,-28.42]]]},field:{type:'Polygon',coordinates:[[[-54.949,-28.419],[-54.946,-28.419],[-54.946,-28.417],[-54.949,-28.417],[-54.949,-28.419]]]}}
const idFor=(tenant,key)=>{const h=createHash('sha256').update(`${STEP09_SOURCE}:${tenant}:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export async function prepareStep09StagingFixture({db,tenantId,env=process.env}){
 if(!isStep09Staging(env))return {status:'SKIPPED_NOT_STEP09_STAGING'}
 if(!db.configured)throw new Error('STEP09_DATABASE_UNAVAILABLE')
 return db.transaction(async connection=>{
  await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${STEP09_SOURCE}:${tenantId}`])
  const owner=(await connection.query("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$1 WHERE u.email=$2 AND u.status='active' AND u.must_change_password=false AND m.role='consultant'",[tenantId,STEP09_ACCOUNT])).rows[0]
  if(!owner)throw new Error('STEP09_UAT_A_NOT_READY')
  const client=idFor(tenantId,'client'),property=idFor(tenantId,'property'),field=idFor(tenantId,'field'),externalKey='step09-synthetic-producer-v1',sourceRef='synthetic:step09:field-observation:v1'
  const metric=async()=>JSON.stringify((await connection.query(`SELECT (SELECT count(*) FROM clients c WHERE c.tenant_id=$1 AND ${realBusinessClient('c')}) producers,(SELECT COALESCE(sum(estimated_value),0) FROM opportunities o WHERE o.tenant_id=$1 AND ${realBusinessRecord('o')}) opportunity_value`,[tenantId])).rows)
  const before=await metric(),existing=(await connection.query('SELECT id,consultant_id,source FROM clients WHERE tenant_id=$1 AND (id=$2 OR external_key=$3)',[tenantId,client,externalKey])).rows
  if(existing.some(c=>c.id!==client||c.consultant_id!==owner.id||c.source!==STEP09_SOURCE))throw new Error('STEP09_FIXTURE_COLLISION')
  const geometry=manualToCanonicalValGeometry({organizationId:tenantId,clientId:client,propertyId:property,fieldId:field,geometry:STEP09_GEOMETRIES.field,provenance:{source:STEP09_SOURCE,sourceRef:'synthetic:step09:field-geometry:v1',observedAt:STEP09_OBSERVED,method:'explicit-synthetic-staging-fixture'}})
  const inserted=await connection.query("INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,total_area_ha,cultures,source) VALUES($1,$2,$3,$4,'SINTÉTICO PASSO 09 — homologação','Local sintético de homologação',$5,'Soja',$6) ON CONFLICT(id) DO NOTHING RETURNING id",[client,tenantId,externalKey,owner.id,canonicalGeometryAreaHa(STEP09_GEOMETRIES.property),STEP09_SOURCE])
  if(inserted.rows.length){
   await connection.query("SELECT set_config('val.geo_actor',$1,true),set_config('val.geo_source',$2,true),set_config('val.geo_reason','Fixture sintética autorizada do Passo 09',true)",[owner.id,STEP09_SOURCE])
   await connection.query("INSERT INTO properties(id,tenant_id,client_id,name,area_ha,metadata) VALUES($1,$2,$3,'Propriedade SINTÉTICA Passo 09',$4,$5)",[property,tenantId,client,canonicalGeometryAreaHa(STEP09_GEOMETRIES.property),JSON.stringify({geometry:STEP09_GEOMETRIES.property,geometry_version:'synthetic-property-v1',source:STEP09_SOURCE,source_ref:'synthetic:step09:property-geometry:v1',provenance:{synthetic:true,method:'explicit-staging-fixture',observed_at:STEP09_OBSERVED},validated_at:null,status:'SYNTHETIC'})])
   await connection.query("INSERT INTO fields(id,tenant_id,property_id,name,area_ha,geometry_ref,geometry_version) VALUES($1,$2,$3,'Talhão SINTÉTICO Passo 09',$4,$5,$6)",[field,tenantId,property,geometry.measurements.calculatedAreaHa,encodeCanonicalGeometryRef(geometry),geometry.geometryVersion])
   await connection.query("INSERT INTO crop_seasons(id,tenant_id,field_id,season,crop,area_ha) VALUES($1,$2,$3,'2026/27','Soja',$4)",[idFor(tenantId,'season'),tenantId,field,geometry.measurements.calculatedAreaHa])
   await connection.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'step09_fixture_seeded','client',$3,$4)",[tenantId,owner.id,client,JSON.stringify({source:STEP09_SOURCE,synthetic:true,property_id:property,field_id:field,geometry_version:geometry.geometryVersion})])
  }
  // An internal source injected only into this staging job; external webhook registry remains unchanged.
  const scopedDb={configured:true,query:(...args)=>connection.query(...args),transaction:work=>work(connection)}
  const repository=new ValRepository({db:scopedDb,tenantId}),hub=new IntegrationHub({db:scopedDb,repository,tenantId,sources:{[STEP09_SOURCE]:{events:['field_report.completed']}}})
  const prior=(await connection.query('SELECT id,status FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND source=$3 AND external_id=$4',[tenantId,owner.id,STEP09_SOURCE,sourceRef])).rows[0]
  let result=prior?{eventId:prior.id,status:prior.status.toUpperCase()}:await hub.ingest({ownerId:owner.id,event:normalizeIntegrationEvent({externalId:sourceRef,type:'field_report.completed',schemaVersion:1,source:STEP09_SOURCE,occurredAt:STEP09_OBSERVED,ownerUserId:owner.id,clientExternalKey:externalKey,propertyExternalKey:property,fieldExternalKey:field,payload:{observedAt:STEP09_OBSERVED,cropStage:'V4',summary:'[SINTÉTICO] Desuniformidade de estande para testar vistoria, sem diagnóstico real.',findings:[{type:'ESTANDE',text:'[SINTÉTICO] Faixa de estande desuniforme; confirmar em campo.',evidenceRef:sourceRef,confidence:70,synthetic:true}]}})})
  if(result.status!=='PROCESSED')throw new Error('STEP09_HUB_FIXTURE_NOT_PROCESSED')
  if(before!==await metric())throw new Error('STEP09_REAL_KPI_CHANGED')
  return {status:'READY',source:STEP09_SOURCE,clientId:client,clientExternalKey:externalKey,propertyId:property,fieldId:field,eventId:result.eventId,geometryVersion:geometry.geometryVersion,metricExclusion:true,created:Boolean(inserted.rows.length)}
 },{timeoutMs:60000})
}
