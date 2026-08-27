export const memoryContractVersion='val.memory.v1'

export const memoryStates=Object.freeze(['FACT','INFERENCE','HYPOTHESIS','VALIDATED_KNOWLEDGE'])
export const memoryDomains=Object.freeze(['PRODUCER','COMMERCIAL','AGRONOMIC','BEHAVIORAL','RELATIONSHIP','ORGANIZATIONAL','STRATEGIC'])
export const memoryStatuses=Object.freeze(['PROPOSED','ACTIVE','REJECTED','EXPIRED','SUPERSEDED'])

const stateSet=new Set(memoryStates)
const domainSet=new Set(memoryDomains)
const statusSet=new Set(memoryStatuses)
const roles=new Set(['admin','manager','consultant','technical_reviewer'])
const plainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=value=>String(value??'').trim()
const finiteConfidence=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(100,Number(value))):null
const iso=value=>{
  if(value==null||value==='')return null
  const date=value instanceof Date?value:new Date(value)
  return Number.isNaN(date.getTime())?null:date.toISOString()
}

function legacyState(row){
  const explicit=text(row?.memory_state??row?.memoryState).toUpperCase()
  if(stateSet.has(explicit))return explicit
  // Compatibilidade conservadora: ausência do novo campo nunca promove o
  // legado a FACT, INFERENCE ou VALIDATED_KNOWLEDGE por heurística.
  return 'HYPOTHESIS'
}

function legacyDomain(row){
  const explicit=text(row?.memory_domain??row?.memoryDomain).toUpperCase()
  if(domainSet.has(explicit))return explicit
  // PRODUCER é o fallback neutro de compatibilidade. Domínios específicos só
  // entram por escrita/curadoria explícita no campo memory_domain.
  return 'PRODUCER'
}

function canonicalStatus(value){
  const normalized=text(value).toUpperCase()
  if(statusSet.has(normalized))return normalized
  if(normalized==='VERIFIED')return 'ACTIVE'
  if(normalized==='PROPOSED')return 'PROPOSED'
  if(normalized==='REJECTED')return 'REJECTED'
  if(normalized==='EXPIRED')return 'EXPIRED'
  if(normalized==='SUPERSEDED')return 'SUPERSEDED'
  return 'PROPOSED'
}

function evidenceReferences(row){
  const evidence=Array.isArray(row?.evidence_refs??row?.evidenceRefs)
    ?row.evidence_refs??row.evidenceRefs
    :Array.isArray(row?.evidence)?row.evidence:[]
  const seen=new Set()
  return evidence.flatMap(item=>{
    if(typeof item==='string'){
      const id=text(item).slice(0,240)
      if(!id||seen.has(id))return []
      seen.add(id)
      return [{id}]
    }
    if(!plainObject(item))return []
    const id=text(item.id??item.source_ref??item.sourceRef??item.source_id??item.sourceId).slice(0,240)
    if(!id||seen.has(id))return []
    seen.add(id)
    const sourceType=text(item.source_type??item.sourceType??item.source).slice(0,100)
    return [{id,...(sourceType?{source_type:sourceType}:{})}]
  }).slice(0,50)
}

function canonicalAcl(row){
  const acl=plainObject(row?.acl)?structuredClone(row.acl):{scope:'own_portfolio'}
  const scope=text(acl.scope)||'own_portfolio'
  const allowedRoles=Array.isArray(acl.roles)?acl.roles.map(item=>text(item)).filter(item=>roles.has(item)):undefined
  const actorIds=Array.isArray(acl.actor_ids??acl.actorIds)?(acl.actor_ids??acl.actorIds).map(item=>text(item)).filter(Boolean):undefined
  return {scope,...(allowedRoles?.length?{roles:[...new Set(allowedRoles)]}:{}),...(actorIds?.length?{actor_ids:[...new Set(actorIds)]}:{})}
}

export function canonicalMemoryRecord(row,{organizationId,subjectType='client',subjectId}={}){
  if(!plainObject(row))throw new TypeError('MemoryRecord v1 exige um registro de origem.')
  const memoryId=text(row.memory_id??row.memoryId??row.id)
  const organization=text(row.organization_id??row.organizationId??row.tenant_id??row.tenantId??organizationId)
  const resolvedSubjectType=text(row.subject_type??row.subjectType??(row.client_id||subjectId?subjectType:''))
  const resolvedSubjectId=text(row.subject_id??row.subjectId??row.client_id??row.clientId??subjectId)
  const sourceType=text(row.source_type??row.sourceType??row.source)||'legacy_unattributed'
  const sourceRef=text(row.source_ref??row.sourceRef)||`val_memories:${memoryId}`
  const content=row.content!==undefined?row.content:row.value
  const record={
    contract_version:memoryContractVersion,
    memory_id:memoryId,
    organization_id:organization,
    subject_type:resolvedSubjectType,
    subject_id:resolvedSubjectId,
    memory_type:legacyDomain(row),
    memory_state:legacyState(row),
    key:text(row.key).slice(0,180),
    content:content??null,
    source_ref:sourceRef.slice(0,240),
    source_type:sourceType.slice(0,100),
    observed_at:iso(row.observed_at??row.observedAt),
    source_updated_at:iso(row.source_updated_at??row.sourceUpdatedAt),
    freshness_policy_version:text(row.freshness_policy_version??row.freshnessPolicyVersion)||null,
    freshness_metadata:plainObject(row.freshness_metadata??row.freshnessMetadata)?structuredClone(row.freshness_metadata??row.freshnessMetadata):{},
    confidence:finiteConfidence(row.confidence),
    status:canonicalStatus(row.status),
    valid_from:iso(row.valid_from??row.validFrom??row.created_at??row.createdAt),
    valid_until:iso(row.valid_until??row.validUntil),
    supersedes_id:text(row.supersedes_id??row.supersedesId)||null,
    created_at:iso(row.created_at??row.createdAt),
    updated_at:iso(row.updated_at??row.updatedAt??row.created_at??row.createdAt),
    created_by:text(row.created_by??row.createdBy)||null,
    evidence_refs:evidenceReferences(row),
    acl:canonicalAcl(row)
  }
  return assertMemoryRecord(record)
}

export function validateMemoryRecord(record){
  const violations=[]
  if(!plainObject(record))return ['memory_record']
  if(record.contract_version!==memoryContractVersion)violations.push('contract_version')
  if(!text(record.memory_id))violations.push('memory_id')
  if(!text(record.organization_id))violations.push('organization_id')
  if(!text(record.subject_type))violations.push('subject_type')
  if(!text(record.subject_id))violations.push('subject_id')
  if(!domainSet.has(record.memory_type))violations.push('memory_type')
  if(!stateSet.has(record.memory_state))violations.push('memory_state')
  if(!text(record.key))violations.push('key')
  if(!text(record.source_ref))violations.push('source_ref')
  if(!text(record.source_type))violations.push('source_type')
  if(!plainObject(record.freshness_metadata))violations.push('freshness_metadata')
  if(record.confidence!==null&&(!Number.isFinite(record.confidence)||record.confidence<0||record.confidence>100))violations.push('confidence')
  if(!statusSet.has(record.status))violations.push('status')
  if(!Array.isArray(record.evidence_refs))violations.push('evidence_refs')
  if(!plainObject(record.acl))violations.push('acl')
  if(record.supersedes_id&&record.supersedes_id===record.memory_id)violations.push('supersedes_id')
  return violations
}

export function assertMemoryRecord(record){
  const violations=validateMemoryRecord(record)
  if(violations.length)throw Object.assign(new Error('MemoryRecord v1 inválido.'),{name:'MemoryContractError',code:'memory_contract_invalid',violations})
  return record
}

export function isMemoryAuthorized(record,{organizationId,subjectType,subjectId,authorizedSubjects,actorId,role='consultant',scope='own_portfolio'}={}){
  if(!record||text(record.organization_id)!==text(organizationId))return false
  if(Array.isArray(authorizedSubjects)&&authorizedSubjects.length){
    const allowed=authorizedSubjects.some(subject=>text(subject?.type)===text(record.subject_type)&&text(subject?.id)===text(record.subject_id))
    if(!allowed)return false
  }else{
    if(subjectType&&text(record.subject_type)!==text(subjectType))return false
    if(subjectId&&text(record.subject_id)!==text(subjectId))return false
  }
  if(!roles.has(text(role)))return false
  const acl=plainObject(record.acl)?record.acl:{scope:'own_portfolio'}
  if(record.subject_type==='organization'&&acl.scope!=='organization')return false
  if(Array.isArray(acl.roles)&&acl.roles.length&&!acl.roles.includes(role))return false
  if(Array.isArray(acl.actor_ids)&&acl.actor_ids.length&&!acl.actor_ids.map(String).includes(text(actorId)))return false
  if(acl.scope==='own_portfolio'&&scope!=='own_portfolio')return false
  if(acl.scope==='restricted'&&!Array.isArray(acl.actor_ids))return false
  return true
}

export function memoryValidity(record,at=new Date()){
  const now=at instanceof Date?at:new Date(at)
  const validUntil=record?.valid_until?new Date(record.valid_until):null
  const validFrom=record?.valid_from?new Date(record.valid_from):null
  if(record?.status==='REJECTED')return 'REJECTED'
  if(record?.status==='SUPERSEDED')return 'SUPERSEDED'
  if(record?.status==='EXPIRED'||(validUntil&&!Number.isNaN(validUntil.getTime())&&validUntil<=now))return 'EXPIRED'
  if(validFrom&&!Number.isNaN(validFrom.getTime())&&validFrom>now)return 'FUTURE'
  return 'CURRENT'
}
