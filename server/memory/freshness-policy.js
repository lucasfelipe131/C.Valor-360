export const contextFreshnessPolicyVersion='val.context.freshness.v1'

const dayMs=86_400_000
const plainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=value=>String(value??'').trim()
const iso=value=>{
  if(value==null||value==='')return null
  const date=value instanceof Date?value:new Date(value)
  return Number.isNaN(date.getTime())?null:date.toISOString()
}

// Cada regra pertence a um domínio e a um tipo de fonte. Não existe TTL
// universal: fontes sem regra temporal explícita permanecem UNKNOWN.
export const contextFreshnessPolicies=Object.freeze([
  Object.freeze({
    id:'val.context.freshness.agronomic.soil_analysis.v1',
    domain:'AGRONOMIC',
    source_type:'soil_analysis',
    strategy:'MAX_AGE_FROM_OBSERVATION',
    max_age_days:730,
    date_fields:Object.freeze(['sampled_at','sampledAt','observed_at','observedAt','created_at','createdAt'])
  }),
  Object.freeze({
    id:'val.context.freshness.behavioral.profile.v1',
    domain:'BEHAVIORAL',
    source_type:'behavioral_profile',
    strategy:'EXPLICIT_VALID_UNTIL',
    require_observed_at:true,
    max_age_days:730,
    date_fields:Object.freeze(['assessed_at','assessedAt','updated_at','updatedAt'])
  }),
  Object.freeze({
    id:'val.context.freshness.memory.explicit_validity.v1',
    domain:'MEMORY',
    source_type:'val_memory',
    strategy:'EXPLICIT_VALIDITY_WINDOW',
    date_fields:Object.freeze(['observed_at','source_updated_at','valid_from','updated_at'])
  })
])

export function freshnessPolicyFor({domain,sourceType}={}){
  const normalizedDomain=text(domain).toUpperCase()
  const normalizedSource=text(sourceType).toLowerCase()
  return contextFreshnessPolicies.find(policy=>policy.domain===normalizedDomain&&policy.source_type===normalizedSource)||null
}

export function sourceObservationDate(source,policy){
  if(!plainObject(source)||!policy)return null
  for(const field of policy.date_fields||[]){
    const value=iso(source[field])
    if(value)return value
  }
  return null
}

export function evaluateSourceFreshness({domain,sourceType,source={},observedAt,validFrom,validUntil,now=new Date()}={}){
  const evaluatedAt=now instanceof Date?now:new Date(now)
  const safeNow=Number.isNaN(evaluatedAt.getTime())?new Date():evaluatedAt
  const policy=freshnessPolicyFor({domain,sourceType})
  const resolvedObservedAt=iso(observedAt)||sourceObservationDate(source,policy)
  const resolvedValidFrom=iso(validFrom)
  const resolvedValidUntil=iso(validUntil)
  const metadata={
    policy_version:contextFreshnessPolicyVersion,
    rule_id:policy?.id||null,
    domain:text(domain).toUpperCase()||null,
    source_type:text(sourceType).toLowerCase()||null,
    strategy:policy?.strategy||'NO_TEMPORAL_RULE',
    evaluated_at:safeNow.toISOString(),
    observed_at:resolvedObservedAt,
    valid_from:resolvedValidFrom,
    valid_until:resolvedValidUntil,
    age_days:null,
    reason_code:null
  }

  if(resolvedValidFrom&&new Date(resolvedValidFrom)>safeNow){
    metadata.reason_code='NOT_YET_VALID'
    return {status:'UNKNOWN',metadata}
  }
  if(resolvedObservedAt&&new Date(resolvedObservedAt)>safeNow){
    metadata.reason_code='OBSERVATION_DATE_IN_FUTURE'
    return {status:'UNKNOWN',metadata}
  }
  if(resolvedValidUntil&&new Date(resolvedValidUntil)<=safeNow){
    metadata.reason_code='VALIDITY_EXPIRED'
    return {status:'STALE',metadata}
  }
  if(!policy){
    metadata.reason_code='NO_DOMAIN_SOURCE_POLICY'
    return {status:'UNKNOWN',metadata}
  }
  if(policy.strategy==='MAX_AGE_FROM_OBSERVATION'){
    if(!resolvedObservedAt){
      metadata.reason_code='OBSERVATION_DATE_MISSING'
      return {status:'UNKNOWN',metadata}
    }
    metadata.age_days=Math.max(0,(safeNow.getTime()-new Date(resolvedObservedAt).getTime())/dayMs)
    if(metadata.age_days>policy.max_age_days){
      metadata.reason_code='DOMAIN_SOURCE_MAX_AGE_EXCEEDED'
      return {status:'STALE',metadata}
    }
    metadata.reason_code='WITHIN_DOMAIN_SOURCE_WINDOW'
    return {status:'CURRENT',metadata}
  }
  if(policy.strategy==='EXPLICIT_VALID_UNTIL'){
    if(policy.require_observed_at&&!resolvedObservedAt){
      metadata.reason_code='OBSERVATION_DATE_MISSING'
      return {status:'UNKNOWN',metadata}
    }
    if(!resolvedValidUntil){
      metadata.reason_code='EXPLICIT_VALID_UNTIL_MISSING'
      return {status:'UNKNOWN',metadata}
    }
    if(Number.isFinite(policy.max_age_days)){
      metadata.age_days=Math.max(0,(safeNow.getTime()-new Date(resolvedObservedAt).getTime())/dayMs)
      if(metadata.age_days>policy.max_age_days){
        metadata.reason_code='DOMAIN_SOURCE_MAX_AGE_EXCEEDED'
        return {status:'STALE',metadata}
      }
    }
    metadata.reason_code='WITHIN_EXPLICIT_VALIDITY'
    return {status:'CURRENT',metadata}
  }
  if(policy.strategy==='EXPLICIT_VALIDITY_WINDOW'){
    metadata.reason_code=resolvedValidUntil?'WITHIN_EXPLICIT_VALIDITY':'NO_EXPIRY_DECLARED'
    return {status:resolvedValidUntil?'CURRENT':'UNKNOWN',metadata}
  }
  metadata.reason_code='NO_DOMAIN_SOURCE_POLICY'
  return {status:'UNKNOWN',metadata}
}
