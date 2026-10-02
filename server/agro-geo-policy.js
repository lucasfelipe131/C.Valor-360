// Deterministic evidence policies; thresholds govern review, never treatment.
export const AGRO_GEO_FLAGS=['agro_geo_v1','field_priority_v1','agronomic_decision_cards','geo_review_queue']
export const AGRO_GEO_POLICIES=Object.freeze({
 geo_plausibility_policy:{version:'val.geo-plausibility.v1',areaTolerance:.2,municipalityDistanceKm:100,maxVertices:5000},
 geometry_version_policy:{version:'val.geometry-history.v1',appendOnly:true,reasonRequired:true},
 agronomic_signal_policy:{version:'val.agronomic-signal.v1',automaticPrescription:false,anomalyIsDiagnosis:false},
 field_priority_policy:{version:'val.field-priority.v1',weights:{anomaly:25,urgency:15,season:5,window:10,visit:5,confidence:10,freshness:10,impact:10,quality:10},commercialWeightCap:15},
 agro_freshness_policy:{version:'val.agro-freshness.v1',days:{weather:1,ndvi:14,field_report:14,soil:365,geometry:730,crop_stage:7,disease_observation:3}},
 geo_identity_policy:{version:'val.geo-identity.v1',nameMatchAllowed:false,canonicalScopeRequired:true}
})
export const VALIDATION_STATES=['OBSERVED','HYPOTHESIS','PROBABLE','VALIDATED','REJECTED']
export const FIELD_ANOMALIES=['VIGOR','ESTANDE','NUTRITION_SIGNAL','WATER_SIGNAL','DISEASE_RISK','WEED_PRESSURE','PEST_RISK','SOIL_VARIABILITY','UNKNOWN']
export function agroFreshness(type,observedAt,now=Date.now()){
 const time=observedAt?Date.parse(observedAt):NaN,days=(now-time)/86400000
 return !Number.isFinite(days)?'UNKNOWN':days<0?'FUTURE':days>AGRO_GEO_POLICIES.agro_freshness_policy.days[type]?'STALE':'CURRENT'
}
export function weatherContract(){return {contract:'val.weather.v1',status:'UNAVAILABLE',CURRENT_WEATHER:'UNAVAILABLE',source:null,observed_at:null,forecast_generated_at:null,location:null,resolution:null,confidence:null,reason:'Nenhuma fonte meteorológica atual autorizada conectada.'}}
export function cadastralContract(record={},now=Date.now()){
 const official=record.official_source_verified===true&&Boolean(record.source_ref)&&/^https:\/\/[^/]+\.(?:gov|jus)\.br\//.test(record.source_ref)
 const status=record.ambiguous?'AMBIGUOUS':record.not_found&&official?'NOT_FOUND':!official?'UNVERIFIED':agroFreshness('geometry',record.observed_at,now)!=='CURRENT'?'STALE':record.canonical_link_verified===true?'VERIFIED':'AVAILABLE'
 return {contract:'val.cadastral.v1',readiness:'CONTRACT_READY',LIVE_SOURCE_AVAILABLE:official&&record.live===true,status,source_ref:record.source_ref||null,official,automatic_link:false}
}
