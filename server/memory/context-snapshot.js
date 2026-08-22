import {createHash,randomUUID} from 'node:crypto'
import {canonicalMemoryRecord,isMemoryAuthorized,memoryContractVersion,memoryValidity} from './contracts.js'
import {contextFreshnessPolicies,contextFreshnessPolicyVersion,evaluateSourceFreshness} from './freshness-policy.js'

export const contextSnapshotVersion='val.context_snapshot.v1'
export const contextFreshnessPolicy=Object.freeze({
  version:contextFreshnessPolicyVersion,
  rules:contextFreshnessPolicies,
  note:'Políticas versionadas por domínio e tipo de fonte; não existe TTL universal.'
})

const plainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const list=value=>Array.isArray(value)?value:[]
const text=value=>String(value??'').trim()
const iso=value=>{
  if(value==null||value==='')return null
  const date=value instanceof Date?value:new Date(value)
  return Number.isNaN(date.getTime())?null:date.toISOString()
}
const stable=value=>{
  if(Array.isArray(value))return value.map(stable)
  if(plainObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
  return value
}
const signature=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const reference=(type,id)=>({type:String(type).slice(0,100),id:String(id).slice(0,240)})
const dateOf=(item,keys)=>keys.map(key=>iso(item?.[key])).find(Boolean)||null
const ageDays=(value,now)=>value==null?null:Math.max(0,(now.getTime()-new Date(value).getTime())/86_400_000)

function snapshotId(input){
  const requestId=text(input.requestId)
  if(!requestId)return randomUUID()
  const hash=signature(input)
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
}

const objectiveTokens=objective=>{
  const value=text(objective).toLowerCase()
  if(/agron/.test(value))return ['agron','soil','crop','disease','insect','weed','field','talhao','solo','cultura','doenca','praga']
  if(/visit/.test(value))return ['visit','relationship','communication','commitment','relacion','comunic','compromisso']
  if(/next|commercial|action/.test(value))return ['commercial','opportunity','purchase','sale','business','oportun','compra','venda','negocio']
  return []
}

function sourceAuthority(record){
  if(record.memory_state==='VALIDATED_KNOWLEDGE')return 45
  if(/(?:official|laboratory|validated|technical_review|erp|crm)/i.test(record.source_type))return 35
  if(/(?:consultant_input|survey|manual)/i.test(record.source_type))return 25
  if(record.source_type==='legacy_unattributed')return 5
  return 15
}

function relevance(record,objective,now){
  const tokens=objectiveTokens(objective)
  const searchable=`${record.memory_type} ${record.key} ${record.source_type}`.toLowerCase()
  const objectiveScore=tokens.reduce((sum,token)=>sum+(searchable.includes(token)?18:0),0)
  const stateScore={VALIDATED_KNOWLEDGE:50,FACT:42,INFERENCE:26,HYPOTHESIS:16}[record.memory_state]||0
  const confidenceScore=(record.confidence??50)/5
  const updated=record.updated_at||record.valid_from
  const days=ageDays(updated,now)
  const recencyScore=days==null?0:days<=30?18:days<=180?12:days<=365?7:2
  const structuralBonus=record.memory_type==='PRODUCER'&&/(?:area|culture|municip|property|name)/i.test(record.key)?18:0
  return objectiveScore+stateScore+confidenceScore+sourceAuthority(record)+recencyScore+structuralBonus
}

function selectionReasons(record,objective){
  const searchable=`${record.memory_type} ${record.key} ${record.source_type}`.toLowerCase()
  const reasons=[`epistemic_state:${record.memory_state.toLowerCase()}`]
  if(objectiveTokens(objective).some(token=>searchable.includes(token)))reasons.push('objective_match')
  if(sourceAuthority(record)>=25)reasons.push('authoritative_source')
  if(record.confidence!=null)reasons.push('recorded_confidence')
  if(record.memory_type==='PRODUCER'&&/(?:area|culture|municip|property|name)/i.test(record.key))reasons.push('structural_information')
  return reasons
}

function contextItem(record,{freshness='UNKNOWN',freshnessMetadata}={}){
  const metadata=plainObject(freshnessMetadata)?freshnessMetadata:plainObject(record.freshness_metadata)?record.freshness_metadata:{}
  return {
    key:record.key,
    value:record.content,
    memory_ref:record.memory_id,
    source_ref:record.source_ref,
    source_type:record.source_type,
    confidence:record.confidence,
    valid_from:record.valid_from,
    valid_until:record.valid_until,
    observed_at:record.observed_at,
    source_updated_at:record.source_updated_at,
    freshness,
    freshness_metadata:metadata
  }
}

function collectionItems(items,type,{domain,dateKeys=['updated_at','updatedAt','created_at','createdAt'],limit=8,validUntilKeys=['valid_until','validUntil'],now}){
  return list(items).slice(0,limit).map(item=>{
    const id=text(item?.id??item?.external_id??item?.externalId)||signature(item).slice(0,24)
    const observedAt=dateOf(item,dateKeys)
    const validUntil=dateOf(item,validUntilKeys)
    const evaluation=evaluateSourceFreshness({domain,sourceType:type,source:item,observedAt,validUntil,now})
    return {evidence_ref:reference(type,`${type}:${id}`),observed_at:evaluation.metadata.observed_at,valid_until:evaluation.metadata.valid_until,freshness:evaluation.status,freshness_metadata:evaluation.metadata,data:item}
  })
}

function profileSignals(context){
  const profile=context?.profile||{}
  const client=context?.client||{}
  const evidence=[...list(profile.evidence),...list(client.profileEvidence)]
  const sourceId=text(profile.sourceId)||text(client.profileSource)||'profile:unattributed'
  const values=[
    ['primary_profile',client.primaryProfile],
    ['secondary_profile',client.secondaryProfile],
    ['service_preference',client.servicePreference]
  ].filter(([,value])=>text(value))
  return values.map(([key,value])=>({
    key,
    value,
    epistemic_state:'HYPOTHESIS',
    source_ref:sourceId,
    confidence:null,
    evidence_refs:evidence.flatMap(item=>{
      const id=text(item?.id??item?.source_id??item?.sourceId)
      return id?[reference(text(item?.source_type??item?.source)||'profile_evidence',id)]:[]
    }).slice(0,20),
    valid_until:iso(profile.validUntil||client.profileValidUntil)
  }))
}

function authorizedSubjects(context,{organizationId,subjectType,subjectId}){
  const subjects=[]
  const seen=new Set()
  const add=(type,id)=>{
    const normalizedType=text(type);const normalizedId=text(id);const key=`${normalizedType}:${normalizedId}`
    if(!normalizedType||!normalizedId||seen.has(key))return
    seen.add(key);subjects.push({type:normalizedType,id:normalizedId})
  }
  add(subjectType,subjectId)
  add('organization',organizationId)
  for(const property of list(context?.properties)){
    add('property',property?.id);add('property',property?.external_key??property?.externalKey)
    for(const field of list(property?.fields)){add('field',field?.id);add('field',field?.external_key??field?.externalKey)}
  }
  for(const visit of list(context?.visits))add('visit',visit?.id)
  for(const opportunity of list(context?.opportunities))add('opportunity',opportunity?.id)
  return subjects
}

function missingInformation(context,{objective,hasSelectedMemories,currentSoil}){
  const missing=[]
  if(!context?.client?.id&&!context?.client?.name)missing.push({code:'subject_record',description:'Falta o cadastro autorizado do produtor.',critical:true})
  if(!hasSelectedMemories&&!list(context?.businessHistory).length&&!list(context?.interactions).length&&!list(context?.visits).length)missing.push({code:'historical_context',description:'Não há histórico material autorizado para esta decisão.',critical:false})
  if(['prepare_visit','next_best_action'].includes(objective)&&!list(context?.interactions).length&&!list(context?.visits).length)missing.push({code:'recent_interaction',description:'Falta uma interação recente confirmada com o produtor.',critical:false})
  if(/^agronomic_/.test(objective)&&!currentSoil)missing.push({code:'current_soil_analysis',description:'Falta análise de solo atualizada para sustentar uma recomendação agronômica.',critical:true})
  if(!list(context?.profile?.evidence).length&&!list(context?.client?.profileEvidence).length)missing.push({code:'behavioral_evidence',description:'O perfil comportamental não possui evidência observável recuperável.',critical:false})
  return missing
}

function confidenceSummary({facts,inferences,hypotheses,validatedKnowledge,conflicts,missing,evidenceCount=0}){
  const criticalMissing=missing.filter(item=>item.critical).length
  let level='INSUFICIENTE'
  if(!criticalMissing&&!conflicts.length&&validatedKnowledge.length)level='VERIFICADO'
  else if(!criticalMissing&&!conflicts.length&&(facts.length||inferences.length||evidenceCount))level='PROVÁVEL'
  else if(hypotheses.length||facts.length||inferences.length)level='HIPÓTESE'
  const factors=[]
  if(criticalMissing)factors.push('critical_missing_information')
  if(conflicts.length)factors.push('material_conflict')
  if(validatedKnowledge.length)factors.push('validated_knowledge_available')
  if(evidenceCount)factors.push('authorized_evidence_available')
  if(!facts.length&&!inferences.length&&!hypotheses.length&&!validatedKnowledge.length)factors.push('no_material_memory')
  return {level,factors}
}

export function buildContextSnapshot(context={},input={}){
  const started=Date.now()
  const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
  const organizationId=text(input.organizationId??input.organization_id)
  const subjectType=text(input.subjectType??input.subject_type)||'client'
  const subjectId=text(input.subjectId??input.subject_id??context?.client?.id)
  const objective=text(input.objective)||'general_assistance'
  const query=text(input.message??input.query)
  const role=text(input.role)||'consultant'
  const scope=text(input.scope)||'own_portfolio'
  const actorId=text(input.actorId??input.actor_id)
  const rawMemories=list(context.memoryHistory).length?context.memoryHistory:list(context.memories)
  const allowedSubjects=authorizedSubjects(context,{organizationId,subjectType,subjectId})
  const considered=[]
  let unauthorizedCount=0
  let invalidCount=0
  for(const row of rawMemories){
    let record
    try{record=canonicalMemoryRecord(row,{organizationId,subjectType,subjectId})}catch{invalidCount+=1;continue}
    if(!isMemoryAuthorized(record,{organizationId,subjectType,subjectId,authorizedSubjects:allowedSubjects,actorId,role,scope})){unauthorizedCount+=1;continue}
    considered.push(record)
  }
  const supersededIds=new Set(considered.filter(item=>memoryValidity(item,now)==='CURRENT').map(item=>item.supersedes_id).filter(Boolean))
  const active=[]
  const stale=[]
  const exclusions=new Map()
  const exclude=(ref,reasonCode)=>{
    const normalizedRef=text(ref)
    const normalizedReason=text(reasonCode).toUpperCase()
    if(!normalizedRef||!normalizedReason)return
    const reasons=exclusions.get(normalizedRef)||new Set()
    reasons.add(normalizedReason)
    exclusions.set(normalizedRef,reasons)
  }
  for(const record of considered){
    let validity=memoryValidity(record,now)
    if(supersededIds.has(record.memory_id))validity='SUPERSEDED'
    if(validity==='CURRENT')active.push(record)
    else if(validity==='REJECTED')exclude(record.memory_id,'REJECTED')
    else if(validity==='FUTURE')exclude(record.memory_id,'NOT_YET_VALID')
    else{
      const freshnessMetadata={
        policy_version:contextFreshnessPolicyVersion,
        rule_id:'val.context.freshness.memory.explicit_validity.v1',
        domain:'MEMORY',
        source_type:'val_memory',
        strategy:'EXPLICIT_VALIDITY_WINDOW',
        evaluated_at:now.toISOString(),
        observed_at:record.observed_at,
        valid_from:record.valid_from,
        valid_until:record.valid_until,
        age_days:null,
        reason_code:validity
      }
      stale.push({...contextItem(record,{freshness:validity,freshnessMetadata}),reason:validity.toLowerCase()})
      exclude(record.memory_id,validity)
    }
  }
  active.sort((left,right)=>relevance(right,`${objective} ${query}`,now)-relevance(left,`${objective} ${query}`,now)||String(right.updated_at||'').localeCompare(String(left.updated_at||'')))
  const selected=active.slice(0,Math.max(1,Math.min(24,Number(input.memoryLimit)||24)))
  for(const item of active.slice(selected.length))exclude(item.memory_id,'LOWER_RELEVANCE')

  const facts=[]
  const inferences=[]
  const hypotheses=[]
  const validatedKnowledge=[]
  for(const record of selected){
    const target=record.status==='PROPOSED'&&['FACT','VALIDATED_KNOWLEDGE'].includes(record.memory_state)
      ?hypotheses
      :record.memory_state==='FACT'?facts
        :record.memory_state==='INFERENCE'?inferences
          :record.memory_state==='VALIDATED_KNOWLEDGE'?validatedKnowledge:hypotheses
    const evaluation=evaluateSourceFreshness({domain:'MEMORY',sourceType:'val_memory',source:record,observedAt:record.observed_at,validFrom:record.valid_from,validUntil:record.valid_until,now})
    target.push(contextItem(record,{freshness:evaluation.status,freshnessMetadata:evaluation.metadata}))
  }

  const grouped=new Map()
  for(const record of selected.filter(item=>item.status==='ACTIVE'&&(item.confidence??50)>=50&&sourceAuthority(item)>=15)){
    const key=`${record.subject_type}:${record.subject_id}:${record.memory_type}:${record.key}`
    const valueSignature=signature(record.content)
    const group=grouped.get(key)||new Map()
    group.set(valueSignature,[...(group.get(valueSignature)||[]),record])
    grouped.set(key,group)
  }
  const conflicts=[]
  for(const [key,values] of grouped)if(values.size>1){
    const records=[...values.values()].flat()
    conflicts.push({
      key,
      memory_refs:records.map(item=>item.memory_id),
      source_refs:[...new Set(records.map(item=>item.source_ref))],
      status:'REQUIRES_CONFIRMATION'
    })
  }

  const soilAll=collectionItems(context.soilAnalyses,'soil_analysis',{domain:'AGRONOMIC',dateKeys:['sampled_at','sampledAt','observed_at','observedAt','created_at','createdAt'],limit:12,now})
  const currentSoil=soilAll.some(item=>item.freshness==='CURRENT')
  const staleSoil=soilAll.filter(item=>item.freshness==='STALE').map(item=>({source_ref:item.evidence_ref.id,source_type:'soil_analysis',observed_at:item.observed_at,valid_until:item.valid_until,freshness:'STALE',freshness_metadata:item.freshness_metadata,reason:'domain_source_policy'}))
  const profileValidUntil=iso(context?.profile?.validUntil??context?.client?.profileValidUntil)
  const profileFreshness=evaluateSourceFreshness({domain:'BEHAVIORAL',sourceType:'behavioral_profile',source:context?.profile||{},validUntil:profileValidUntil,now})
  if(profileFreshness.status==='STALE')stale.push({source_ref:text(context?.profile?.sourceId)||'profile:unattributed',source_type:'behavioral_profile',valid_until:profileValidUntil,freshness:'STALE',freshness_metadata:profileFreshness.metadata,reason:'domain_source_policy'})
  stale.push(...staleSoil)

  const behavioralSignals=profileSignals(context)
  const commercialContext={
    business_history:collectionItems(context.businessHistory,'business_event',{domain:'COMMERCIAL',dateKeys:['occurred_at','occurredAt','created_at','createdAt'],limit:12,now}),
    opportunities:collectionItems(context.opportunities,'opportunity',{domain:'COMMERCIAL',limit:12,now}),
    summary:context?.client?.commercial||{}
  }
  const agronomicContext={
    properties:collectionItems(context.properties,'property',{domain:'AGRONOMIC',limit:8,now}),
    field_reports:collectionItems(context.fieldReports,'field_report',{domain:'AGRONOMIC',dateKeys:['observed_at','observedAt','created_at','createdAt'],limit:8,now}),
    soil_analyses:soilAll,
    ndvi_observations:collectionItems(context.ndviObservations,'ndvi_observation',{domain:'AGRONOMIC',dateKeys:['observed_at','observedAt','created_at','createdAt'],limit:8,now})
  }
  const relationshipContext={
    interactions:collectionItems(context.interactions,'interaction',{domain:'RELATIONSHIP',dateKeys:['occurred_at','occurredAt','created_at','createdAt'],limit:10,now}),
    visits:collectionItems(context.visits,'visit',{domain:'RELATIONSHIP',dateKeys:['updated_at','updatedAt','scheduled_at','scheduledAt','created_at','createdAt'],limit:10,now}),
    reported_profile:context?.client?.relationship||{}
  }
  const missing=missingInformation(context,{objective,hasSelectedMemories:Boolean(selected.length),currentSoil})
  const evidenceRefs=[]
  const seenEvidence=new Set()
  const addEvidence=item=>{
    const id=text(item?.id)
    if(!id||seenEvidence.has(id))return
    seenEvidence.add(id)
    evidenceRefs.push(item)
  }
  for(const memory of selected){
    addEvidence(reference('memory',`val_memories:${memory.memory_id}`))
    addEvidence(reference(memory.source_type,memory.source_ref))
    for(const item of memory.evidence_refs)addEvidence(reference(item.source_type||'evidence',item.id))
  }
  for(const section of [commercialContext.business_history,commercialContext.opportunities,agronomicContext.properties,agronomicContext.field_reports,agronomicContext.soil_analyses,agronomicContext.ndvi_observations,relationshipContext.interactions,relationshipContext.visits])for(const item of section)addEvidence(item.evidence_ref)
  for(const signal of behavioralSignals){
    if(signal.source_ref)addEvidence(reference('behavioral_profile',signal.source_ref))
    for(const item of signal.evidence_refs)addEvidence(item)
  }

  const confidence=confidenceSummary({facts,inferences,hypotheses,validatedKnowledge,conflicts,missing,evidenceCount:evidenceRefs.length})
  const dated=selected.map(item=>item.observed_at||item.source_updated_at||item.updated_at||item.valid_from).filter(Boolean).sort()
  const staleCount=stale.length
  const freshnessEvaluations=[
    ...facts,...inferences,...hypotheses,...validatedKnowledge,
    ...commercialContext.business_history,...commercialContext.opportunities,
    ...agronomicContext.properties,...agronomicContext.field_reports,...agronomicContext.soil_analyses,...agronomicContext.ndvi_observations,
    ...relationshipContext.interactions,...relationshipContext.visits,
    ...stale
  ]
  const freshnessRuleIds=[...new Set(freshnessEvaluations.map(item=>item?.freshness_metadata?.rule_id).filter(Boolean))]
  const freshnessStatuses=new Set(freshnessEvaluations.map(item=>item?.freshness).filter(Boolean))
  const aggregateFreshness=freshnessStatuses.has('STALE')||freshnessStatuses.has('EXPIRED')||freshnessStatuses.has('SUPERSEDED')
    ?freshnessStatuses.size>1?'MIXED':'STALE'
    :freshnessStatuses.has('CURRENT')
      ?freshnessStatuses.has('UNKNOWN')?'MIXED':'CURRENT'
      :'UNKNOWN'
  const freshness={
    status:aggregateFreshness,
    generated_at:now.toISOString(),
    oldest_at:dated[0]||null,
    newest_at:dated.at(-1)||null,
    stale_count:staleCount,
    policy_version:contextFreshnessPolicy.version,
    rule_ids:freshnessRuleIds
  }
  const selectedRefs=selected.map(item=>item.memory_id)
  const excludedRefs=[...exclusions.keys()]
  const exclusionReasonCodes=[...exclusions].map(([ref,reasons])=>({ref,reason_codes:[...reasons].sort()}))
  const id=snapshotId({version:contextSnapshotVersion,requestId:input.requestId,organizationId,subjectType,subjectId,actorId,role,scope,objective,queryHash:query?signature(query):null,selected:selectedRefs,excluded:exclusionReasonCodes,conflicts:conflicts.map(item=>item.memory_refs)})
  const snapshot={
    contract_version:contextSnapshotVersion,
    context_snapshot_id:id,
    request_id:text(input.requestId)||null,
    organization_id:organizationId,
    subject:{type:subjectType,id:subjectId},
    objective,
    facts,
    inferences,
    hypotheses,
    validated_knowledge:validatedKnowledge,
    missing_information:missing,
    conflicts,
    stale_information:stale,
    behavioral_signals:behavioralSignals,
    commercial_context:commercialContext,
    agronomic_context:agronomicContext,
    relationship_context:relationshipContext,
    evidence_refs:evidenceRefs.slice(0,100),
    confidence,
    freshness,
    selection:{
      policy_version:'val.context.selection.v1',
      considered_refs:considered.map(item=>item.memory_id),
      selected_refs:selectedRefs,
      selection_reason_codes:selected.map(item=>({ref:item.memory_id,reason_codes:selectionReasons(item,`${objective} ${query}`)})),
      excluded_refs:excludedRefs,
      exclusion_reason_codes:exclusionReasonCodes,
      unauthorized_count:unauthorizedCount,
      invalid_count:invalidCount,
      latency_ms:Math.max(0,Date.now()-started)
    }
  }
  return assertContextSnapshot(snapshot)
}

export function validateContextSnapshot(snapshot){
  const violations=[]
  if(!plainObject(snapshot))return ['context_snapshot']
  if(snapshot.contract_version!==contextSnapshotVersion)violations.push('contract_version')
  if(!text(snapshot.context_snapshot_id))violations.push('context_snapshot_id')
  if(!text(snapshot.organization_id))violations.push('organization_id')
  if(!plainObject(snapshot.subject)||!text(snapshot.subject.type)||!text(snapshot.subject.id))violations.push('subject')
  for(const key of ['facts','inferences','hypotheses','validated_knowledge','missing_information','conflicts','stale_information','behavioral_signals','evidence_refs'])if(!Array.isArray(snapshot[key]))violations.push(key)
  for(const key of ['commercial_context','agronomic_context','relationship_context','confidence','freshness','selection'])if(!plainObject(snapshot[key]))violations.push(key)
  if(snapshot.selection?.considered_refs?.length<snapshot.selection?.selected_refs?.length)violations.push('selection')
  if(!Array.isArray(snapshot.selection?.excluded_refs)||!Array.isArray(snapshot.selection?.exclusion_reason_codes))violations.push('selection_audit')
  return violations
}

export function assertContextSnapshot(snapshot){
  const violations=validateContextSnapshot(snapshot)
  if(violations.length)throw Object.assign(new Error('ContextSnapshot v1 inválido.'),{name:'ContextSnapshotContractError',code:'context_snapshot_invalid',violations})
  return snapshot
}

function snapshotSize(value){return JSON.stringify(value).length}

export function contextSnapshotForModel(snapshot,maxChars=18_000){
  assertContextSnapshot(snapshot)
  const compact={
    contract_version:snapshot.contract_version,
    context_snapshot_id:snapshot.context_snapshot_id,
    objective:snapshot.objective,
    facts:[...snapshot.facts],
    inferences:[...snapshot.inferences],
    hypotheses:[...snapshot.hypotheses],
    validated_knowledge:[...snapshot.validated_knowledge],
    missing_information:[...snapshot.missing_information],
    conflicts:[...snapshot.conflicts],
    stale_information:[...snapshot.stale_information],
    behavioral_signals:[...snapshot.behavioral_signals],
    commercial_context:structuredClone(snapshot.commercial_context),
    agronomic_context:structuredClone(snapshot.agronomic_context),
    relationship_context:structuredClone(snapshot.relationship_context),
    evidence_refs:[...snapshot.evidence_refs],
    confidence:{...snapshot.confidence},
    freshness:{...snapshot.freshness}
  }
  const trimPaths=[
    ['commercial_context','business_history'],['commercial_context','opportunities'],['relationship_context','interactions'],['relationship_context','visits'],
    ['agronomic_context','ndvi_observations'],['agronomic_context','field_reports'],['agronomic_context','soil_analyses'],['agronomic_context','properties'],
    ['behavioral_signals'],['hypotheses'],['inferences'],['facts'],['validated_knowledge'],['evidence_refs']
  ]
  const limit=Math.max(4_000,Number(maxChars)||18_000)
  let changed=true
  while(snapshotSize(compact)>limit&&changed){
    changed=false
    for(const path of trimPaths){
      const parent=path.length===1?compact:compact[path[0]]
      const key=path.at(-1)
      if(Array.isArray(parent?.[key])&&parent[key].length){parent[key].pop();changed=true;if(snapshotSize(compact)<=limit)break}
    }
  }
  if(snapshotSize(compact)>limit){
    compact.commercial_context.summary={}
    compact.relationship_context.reported_profile={}
  }
  return compact
}

export const memoryContextContracts=Object.freeze({memory:memoryContractVersion,contextSnapshot:contextSnapshotVersion,freshness:contextFreshnessPolicy.version})
