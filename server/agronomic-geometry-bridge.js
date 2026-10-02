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
  const manualId=text(client.commercial?.manual_identity?.producer_id)
  return {
   id:manualId||text(client.id),valor360ExternalKey:text(client.id),valor360BootstrapKey:text(client.id),name:text(client.name)||'Produtor',crmCode:text(client.id),document:'',phone:text(client.commercial?.phone),email:text(client.commercial?.email),city:text(client.municipality),
   properties:properties.map(property=>text(property.name)).filter(Boolean).join('; ')||text(client.commercial?.property),
   area:Number.isFinite(rawArea)?rawArea:0,cultures,
   notes:[client.primaryProfile&&`Perfil Produtor 360: ${client.primaryProfile}`,client.additionalNeed&&`Necessidade declarada: ${client.additionalNeed}`].filter(Boolean).join('\n'),
   fields,registrations:[],mappingStatus:fields.some(field=>field.geometryStatus==='CANONICAL')?'mapped':'pending',crmSource:'VALOR 360'
  }
 })
 return {producers,geometryIssues:issues}
}

// Territorial projection of the same canonical workspace used by Manual.
// Signals are evidence readings, never diagnoses or agronomic prescriptions.
import {hashDecision} from './decision-governance.js'
import {canonicalGeometryAreaHa} from '../src/lib/agronomic-geometry-adapter.js'
import {assessGeoPlausibility} from '../src/lib/geo-plausibility.js'
import {AGRO_GEO_POLICIES,FIELD_ANOMALIES,agroFreshness,weatherContract,cadastralContract} from './agro-geo-policy.js'
const digest=hashDecision
const list=value=>Array.isArray(value)?value:[]
const geometryOf=(field,tenantId)=>{try{
 if(field.geometry)return field.geometry
 const canonical=decodeCanonicalGeometryRef(field.geometry_ref,{expectedOrganizationId:tenantId})
 if(![field.id,field.external_key].filter(Boolean).includes(canonical.link.fieldId)||field.property_id&&canonical.link.propertyId!==field.property_id)return null
 return canonical.geometry
}catch{return null}}
const actions={VIGOR:'VISTORIAR',ESTANDE:'VISTORIAR',NUTRITION_SIGNAL:'AMOSTRAR',WATER_SIGNAL:'VISTORIAR',DISEASE_RISK:'VALIDAR_DIAGNÓSTICO',WEED_PRESSURE:'COLETAR_IMAGEM',PEST_RISK:'AMOSTRAR',SOIL_VARIABILITY:'REVISAR_ANALISE',UNKNOWN:'REVISAR_HISTORICO'}
export function buildAgronomicTerritory(context={}, {now=Date.now(),tenantId,ownerId,priorityEnabled=true}={}){
 const producer={id:context.client?.id,canonical_id:context.canonicalClientId,name:context.client?.name},properties=[],signals=[],cards=[],conflicts=[]
 const scope={tenant_id:tenantId,owner_id:ownerId,canonical_client_id:producer.canonical_id}
 const addConflict=(property,field,type,refs=[])=>conflicts.push({...scope,property_id:property.id,field_id:field?.id||null,type,source_refs:refs})
 for(const raw of list(context.properties)){
  if(raw.tenant_id!==tenantId||(raw.canonical_client_id||raw.client_id)!==producer.canonical_id)continue
  const property={...raw,property_id:raw.id,area_total_ha:raw.area_ha,area_productive_ha:raw.metadata?.area_productive_ha??null,state:raw.metadata?.state||null,geometry:raw.metadata?.geometry||null,geometry_version:raw.metadata?.geometry_version||null,source:raw.metadata?.source||'canonical',source_ref:raw.metadata?.source_ref||`properties:${raw.id}`,provenance:raw.metadata?.provenance||null,validated_at:raw.metadata?.validated_at||null,status:raw.metadata?.status||'UNVERIFIED',fields:[]}
  const siblings=list(raw.fields).map(f=>({id:f.id,geometry:geometryOf(f,tenantId)}))
  for(const field of list(raw.fields)){
   if(field.tenant_id!==tenantId||field.property_id!==raw.id)continue
   const geometry=geometryOf(field,tenantId),seasons=list(field.seasons),current=seasons[0]||{},missing=[]
   let calculatedAreaHa=null;try{if(geometry)calculatedAreaHa=canonicalGeometryAreaHa(geometry)}catch{}
   const plausibility=assessGeoPlausibility(geometry,{areaHa:field.area_ha,calculatedAreaHa,propertyAreaHa:raw.area_ha,parentGeometry:property.geometry,municipalityCenter:raw.metadata?.municipality_center,otherGeometries:siblings.filter(f=>f.id!==field.id&&f.geometry).map(f=>f.geometry)})
   if(plausibility.reasons.length)addConflict(property,field,'GEOMETRY',plausibility.reasons)
   for(const season of seasons)if(seasons.some(s=>s.id!==season.id&&s.season===season.season&&s.crop!==season.crop))addConflict(property,field,'CROP_SEASON_CONFLICT',seasons.filter(s=>s.season===season.season).map(s=>s.id))
   if(!geometry)missing.push('Geometria do talhão não disponível.')
   if(!current.season)missing.push('Safra não informada.')
   if(!current.crop)missing.push('Cultura não informada.')
   const fieldView={...field,field_id:field.id,geometry,season:current.season||null,crop:current.crop||null,status:plausibility.status,plausibility,source_ref:`fields:${field.id}`,missing_information:missing}
   property.fields.push(fieldView)
   const scoped=rows=>list(rows).filter(r=>r.tenant_id===tenantId&&r.owner_user_id===ownerId&&(r.canonical_client_id||r.client_id)===producer.canonical_id&&r.property_id===raw.id&&r.field_id===field.id)
   const records=[...scoped(context.ndviObservations).map(r=>({...r,kind:'ndvi',hasSignal:r.anomaly?.flag===true,category:'VIGOR'})),...scoped(context.fieldReports).flatMap(r=>(list(r.observations).length?list(r.observations):[{id:`report:${r.id}`,observation_type:'UNKNOWN',value:{summary:r.summary}}]).map(o=>({...r,observation:o,kind:'field_report',hasSignal:true,category:FIELD_ANOMALIES.includes(o.observation_type)?o.observation_type:'UNKNOWN'}))),...scoped(context.soilAnalyses).map(r=>({...r,kind:'soil',hasSignal:true,category:'SOIL_VARIABILITY'}))]
   const reports=scoped(context.fieldReports)
   if(new Set(reports.filter(r=>agroFreshness('crop_stage',r.observed_at,now)==='CURRENT').map(r=>r.crop_stage).filter(Boolean)).size>1)addConflict(property,field,'CROP_STAGE_CONFLICT',reports.map(r=>r.id))
   for(const record of records){
    if(!record.hasSignal)continue
    const observed=record.observed_at||record.sampled_at,sourceRef=record.observation?.evidence_ref||record.source_ref||record.external_id||record.id,sourceRefs=[{type:record.kind,id:record.id,source:record.source||null,source_ref:sourceRef,source_document_id:record.source_document_id||null,source_event_id:record.accepted_event_source_event_id||record.source_event_id||list(context.hubEvidence).find(e=>e.source===record.source&&e.external_id===record.external_id)?.id||null,observed_at:observed||null,ingested_at:record.created_at||null,provenance:record.validation_evidence||null}]
    const signalMissing=[...missing],freshness=agroFreshness(record.category==='DISEASE_RISK'?'disease_observation':record.kind,observed,now)
    if(freshness!=='CURRENT')signalMissing.push(`Evidência ${freshness}: confirmar observação atual.`)
    if(!record.source)signalMissing.push('Fonte da evidência não informada.')
    if(record.kind==='ndvi'){
     if(!record.geometry_version||record.geometry_version!==field.geometry_version)signalMissing.push('Versão da geometria do índice incompatível ou ausente.')
     if(record.cloud_percent==null||Number(record.cloud_percent)>30)signalMissing.push('Qualidade de nuvens requer revisão.')
     if(!record.sensor||!record.processing_version||!record.resolution_m)signalMissing.push('Metadados de processamento/sensor incompletos.')
    }
    if(record.kind==='soil'){
     if(!record.laboratory||!record.method||record.depth_from_cm==null||record.depth_to_cm==null)signalMissing.push('Confirmar laboratório, método e profundidade.')
     if(!list(record.measurements).length||list(record.measurements).some(m=>!m.raw_unit||m.normalized_value!=null&&!m.normalized_unit))signalMissing.push('Unidade ausente: comparação de valores bloqueada.')
    }
    if(record.category==='PEST_RISK'&&!record.observation?.value?.sampling)signalMissing.push('Amostragem ausente: nível de dano econômico não estabelecido.')
    if(record.category==='WEED_PRESSURE'&&!record.observation?.value?.identification)signalMissing.push('Identificação insuficiente: coletar imagem e validar espécie.')
    const signalKey=digest([scope,record.kind,record.id,record.observation?.id||null,field.id]).slice(0,32),evidenceFingerprint=digest(record)
    const human=list(context.signalValidations).find(v=>v.signal_key===signalKey&&v.evidence_fingerprint===evidenceFingerprint&&v.tenant_id===tenantId&&v.owner_id===ownerId)
    const validation=record.validation_evidence||{}
    let validated=Boolean(record.validated_at&&record.validated_by&&Object.keys(validation).length)&&signalMissing.length===0
    if(human?.state==='VALIDATED'&&signalMissing.length===0)validated=true
    const state=human?.state==='REJECTED'?'REJECTED':record.kind==='ndvi'?'OBSERVED':validated?'VALIDATED':record.observation?.value?.validation_state==='PROBABLE'?'PROBABLE':'HYPOTHESIS'
    const signal={...scope,signal_id:signalKey,evidence_fingerprint:evidenceFingerprint,human_validation:human||null,producer,property:{id:raw.id,name:raw.name},field:{id:field.id,name:field.name},season:current.season||null,signal_type:record.category,headline:`${record.kind==='ndvi'?'Anomalia de vigor':record.kind==='soil'?'Análise de solo para revisão':'Observação de campo'} · ${field.name}`,evidence:{...record,causal_diagnosis:false,comparisons_allowed:record.kind!=='soil'||!signalMissing.some(m=>m.startsWith('Unidade'))},observed_at:observed||null,ingested_at:record.created_at||null,confidence:validated?'HIGH':signalMissing.length?'LOW':'MEDIUM',validation_state:state,recommended_next_step:actions[record.category],source_refs:sourceRefs,freshness,missing_information:signalMissing}
    const dimensions={anomaly:record.kind==='ndvi'||record.category!=='UNKNOWN'?1:.3,urgency:validated&&record.observation?.value?.urgency==='HIGH'?1:0,season:current.season?1:0,window:validated&&record.observation?.value?.window_end&&Date.parse(record.observation.value.window_end)>=now&&Date.parse(record.observation.value.window_end)-now<=7*86400000?1:0,visit:list(context.visits).some(v=>Date.parse(v.scheduled_at)>now&&Date.parse(v.scheduled_at)-now<=7*86400000)?1:0,confidence:validated?1:signalMissing.length?.25:.5,freshness:freshness==='CURRENT'?1:0,impact:validated&&record.observation?.value?.impact==='HIGH'?1:0,quality:Math.max(0,1-signalMissing.length*.2)}
    if(state==='REJECTED'){signals.push(signal);continue}
    const weights=AGRO_GEO_POLICIES.field_priority_policy.weights,score=priorityEnabled?Math.round(Object.entries(dimensions).reduce((sum,[key,value])=>sum+weights[key]*value,0)*(freshness==='CURRENT'?1:.25)):null
    signal.priority={score,dimensions,weights,policy_version:AGRO_GEO_POLICIES.field_priority_policy.version,reason:'Prioridade para coleta e validação; não confirma causa.',automatic_scheduling:false}
    signals.push(signal)
    cards.push({...scope,id:`agro:${signal.signal_id}`,producer,property:signal.property,field:signal.field,season:signal.season,headline:signal.headline,signal,why:`Evidência registrada em ${observed||'data desconhecida'}; ${signal.signal_type}. Anomalia não é diagnóstico.`,why_now:freshness==='CURRENT'?'Observação recente disponível para vistoria.':'Atualizar a evidência antes de concluir.',recommended_next_step:signal.recommended_next_step,confidence:signal.confidence,validation_state:signal.validation_state,evidence_refs:sourceRefs,source_refs:sourceRefs,missing_information:signalMissing,map_focus:{property_id:raw.id,field_id:field.id,geometry,geometry_version:field.geometry_version||null},priority:signal.priority,deadline:validated?record.observation?.value?.window_end||null:null,generated_at:new Date(now).toISOString(),version:'val.agronomic-decision-card.v1',automatic_execution:false})
   }
  }
  properties.push(property)
 }
 const known=new Set(properties.flatMap(p=>p.fields.map(f=>f.id)))
 const unlinked=[...list(context.soilAnalyses),...list(context.ndviObservations),...list(context.fieldReports)].filter(r=>r.tenant_id===tenantId&&r.owner_user_id===ownerId&&(r.canonical_client_id||r.client_id)===producer.canonical_id&&(!r.field_id||!known.has(r.field_id))).map(r=>({id:r.id,source_ref:r.source_ref||r.external_id||r.id,status:'REVIEW_REQUIRED',reason:'UNLINKED_OR_INCOMPATIBLE_FIELD'}))
 cards.sort((a,b)=>(b.priority.score||0)-(a.priority.score||0)||a.id.localeCompare(b.id))
 return {version:'val.agro-geo.v1',scope,producer,properties,signals,cards,conflicts,unlinked,weather:weatherContract(),cadastre:{CAR:cadastralContract(),SIGEF:cadastralContract(),MATRICULA:cadastralContract()},policies:AGRO_GEO_POLICIES,generated_at:new Date(now).toISOString()}
}

// Called by both the consultant map and the Manual projection before replacing
// canonical geometry. Conflicting proposals stay in the shared review queue.
export async function governGeometryChange(connection,{tenantId,ownerId,clientId,propertyId,fieldId,canonical,sourceRef}){
 const property=(await connection.query('SELECT area_ha,metadata FROM properties WHERE tenant_id=$1 AND client_id=$2 AND id=$3',[tenantId,clientId,propertyId])).rows[0]
 if(!property)throw Object.assign(new Error('Canonical property scope mismatch'),{statusCode:404})
 const siblings=(await connection.query('SELECT id,geometry_ref FROM fields WHERE tenant_id=$1 AND property_id=$2 AND id<>$3',[tenantId,propertyId,fieldId])).rows
 const assessment=assessGeoPlausibility(canonical.geometry,{areaHa:canonical.measurements.suppliedAreaHa,calculatedAreaHa:canonical.measurements.calculatedAreaHa,propertyAreaHa:property.area_ha,parentGeometry:property.metadata?.geometry,municipalityCenter:property.metadata?.municipality_center,otherGeometries:siblings.map(f=>geometryOf(f,tenantId)).filter(Boolean),crs:canonical.crs})
 if(assessment.status==='VALID')return true
 const payload={type:'GEOMETRY_PROPOSAL',property_id:propertyId,field_id:fieldId,source_ref:sourceRef||canonical.provenance?.sourceRef||null,proposed_geometry:canonical,assessment,canonical_geometry_unchanged:true},fingerprint=digest(payload)
 const inserted=await connection.query('INSERT INTO val_geo_reviews(tenant_id,owner_id,client_id,fingerprint,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[tenantId,ownerId,clientId,fingerprint,JSON.stringify(payload)])
 if(inserted.rows.length)await connection.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'geo_conflict_detected','field',$3,$4)",[tenantId,ownerId,fieldId,JSON.stringify(payload)])
 return false
}
