import {createHash,randomUUID} from 'node:crypto'
import {canonicalMemoryRecord,isMemoryAuthorized,memoryContractVersion,memoryValidity} from './contracts.js'
import {contextFreshnessPolicies,contextFreshnessPolicyVersion,evaluateSourceFreshness} from './freshness-policy.js'
import {assertActiveProducerBoundary,assertContextScopeAliases,classifyValContextDomain,collectionMatchesContextDomain,contextCollectionPolicy,contextTraceEntry,explicitlyGlobalContext,matchedValContextDomains,memoryMatchesContextDomain,valContextDomains,valContextSelectorVersion} from '../decision-copilot/context-selector.js'

export const contextSnapshotVersion='val.context_snapshot.v1'
export const contextFreshnessPolicy=Object.freeze({
  version:contextFreshnessPolicyVersion,
  rules:contextFreshnessPolicies,
  note:'Políticas versionadas por domínio e tipo de fonte; não existe TTL universal.'
})

const plainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const list=value=>Array.isArray(value)?value:[]
const text=value=>String(value??'').trim()
const own=(value,key)=>Boolean(value&&typeof value==='object')&&Object.prototype.hasOwnProperty.call(value,key)
const exactEpoch=value=>Number.isSafeInteger(value)&&value>=0
const contextEpochInput=input=>{
  // `undefined` is the JavaScript representation of an omitted optional
  // constructor field (and cannot arrive as an explicit JSON value). Keep that
  // backward-compatible creation path at epoch 0 while rejecting every
  // concrete invalid value, including null, strings and booleans.
  const hasCamel=own(input,'contextEpoch')&&input.contextEpoch!==undefined
  const hasSnake=own(input,'context_epoch')&&input.context_epoch!==undefined
  if(!hasCamel&&!hasSnake)return 0
  const camel=input?.contextEpoch,snake=input?.context_epoch
  if(hasCamel&&!exactEpoch(camel)||hasSnake&&!exactEpoch(snake)||hasCamel&&hasSnake&&camel!==snake)throw Object.assign(new Error('contextEpoch deve ser um inteiro seguro não negativo quando informado.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'INVALID_CONTEXT_EPOCH'})
  return hasCamel?camel:snake
}
const safeJson=value=>{try{return JSON.stringify(value??'')}catch{return String(value??'')}}
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
const domainQuery=domains=>list(domains).map(domain=>({PROFILE:'perfil',COMMERCIAL:'comercial',AGRONOMY:'agronomia',GRAINS:'grãos',CREDIT:'crédito',GEO:'geo',VISIT:'visita',OPPORTUNITY:'oportunidade',GENERAL:'geral'}[domain]||'')).filter(Boolean).join(' ')
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
  if(/profile|perfil|behavior|comport/.test(value))return ['profile','perfil','behavior','comport','decision','decis','prefer','survey','questionnaire','irt','nps']
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

function conflictComparable(record){
  const key=text(record?.key).toLowerCase()
  // Voice/visit-report memories are append-only observations. Different
  // statements in those streams complement each other; they are not competing
  // values for one master attribute. Provenance remains available for audit.
  if(/^(?:voice\.|visit_report\.)/.test(key))return false
  return Boolean(key)
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

function evidenceType(record={}){
  const key=`${record.key||''} ${record.source_type||''}`.toLowerCase()
  if(/(?:quote|citacao|fala_literal|direct_speech)/.test(key))return 'QUOTE'
  if(/(?:intention|intencao|intent\.)/.test(key))return 'INTENTION'
  if(/(?:strategy|estrategia|playbook|recommended_action)/.test(key))return 'STRATEGY'
  if(/(?:observation|observacao|behavioral_signal|visit_report|field_report)/.test(key))return 'OBSERVATION'
  return {FACT:'FACT',INFERENCE:'INFERENCE',HYPOTHESIS:'HYPOTHESIS',VALIDATED_KNOWLEDGE:'FACT'}[record.memory_state]||'HYPOTHESIS'
}

function contextItem(record,{freshness='UNKNOWN',freshnessMetadata,producerId,tenantId,ownerId}={}){
  const metadata=plainObject(freshnessMetadata)?freshnessMetadata:plainObject(record.freshness_metadata)?record.freshness_metadata:{}
  return {
    key:record.key,
    value:record.content,
    memory_domain:record.memory_type,
    epistemic_type:record.memory_state,
    evidence_type:evidenceType(record),
    tenant_id:text(record.organization_id||tenantId),
    producer_id:text(producerId),
    owner_id:text(ownerId)||null,
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

function profileMemoryFreshness(record,evaluation,now){
  if(evaluation.status!=='UNKNOWN')return evaluation
  const observedAt=iso(record?.observed_at??record?.source_updated_at??record?.valid_from??record?.updated_at)
  if(!observedAt)return evaluation
  const age=Math.max(0,(now.getTime()-new Date(observedAt).getTime())/86_400_000)
  if(new Date(observedAt)>now)return {...evaluation,metadata:{...evaluation.metadata,observed_at:observedAt,age_days:age,reason_code:'OBSERVATION_DATE_IN_FUTURE'}}
  const status=age<=730?'CURRENT':'STALE'
  return {status,metadata:{...evaluation.metadata,strategy:'PROFILE_BEHAVIORAL_MAX_AGE',observed_at:observedAt,age_days:age,reason_code:status==='CURRENT'?'WITHIN_PROFILE_BEHAVIORAL_WINDOW':'PROFILE_BEHAVIORAL_MAX_AGE_EXCEEDED'}}
}

const producerIdOf=value=>{
  assertContextScopeAliases(value)
  const direct=text(value?.producerId??value?.producer_id??value?.clientId??value?.client_id??value?.subject_client_id)
  const subjectType=text(value?.subjectType??value?.subject_type).toLowerCase()
  if(direct)return direct
  return subjectType==='client'?text(value?.subjectId??value?.subject_id):''
}
const tenantIdOf=value=>{assertContextScopeAliases(value);return text(value?.tenantId??value?.tenant_id??value?.organizationId??value?.organization_id)}
const ownerIdOf=value=>{assertContextScopeAliases(value);return text(value?.contextOwnerId??value?.context_owner_id??value?.consultantId??value?.consultant_id??value?.createdBy??value?.created_by??value?.ownerId??value?.owner_id)}
const entityIds=value=>[value?.id,value?.external_id,value?.externalId,value?.external_key,value?.externalKey].map(text).filter(Boolean)
const relationIds=(value,keys)=>keys.map(key=>text(value?.[key])).filter(Boolean)

function boundaryScopeView(value={}){
 if(!text(value?.owner_type??value?.ownerType))return value
 // owner_id in a domain object is the business assignee selected by
 // owner_type, not the consultant/ACL owner. context_owner_id remains the
 // canonical isolation field and must not conflict with the domain relation.
 const {owner_id:_domainOwnerId,ownerId:_domainOwnerIdCamel,...scopeView}=value
 return scopeView
}

function assertNestedContextBoundary(value,{producerId,tenantId,ownerId}={},path='context'){
 const seen=new WeakSet()
 const walk=(node,nodePath,depth)=>{
  if(depth>32)throw Object.assign(new Error('O contexto possui aninhamento além do limite seguro.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_SCOPE_DEPTH_EXCEEDED',path:nodePath})
  if(Array.isArray(node)){for(let index=0;index<node.length;index+=1)walk(node[index],`${nodePath}[${index}]`,depth+1);return}
  if(!plainObject(node)||seen.has(node))return
  seen.add(node)
  const scopedNode=boundaryScopeView(node)
  assertContextScopeAliases(scopedNode)
  const nestedProducer=producerIdOf(scopedNode)
  const nestedTenant=tenantIdOf(scopedNode)
  const nestedOwner=ownerIdOf(scopedNode)
  if(producerId&&nestedProducer&&nestedProducer!==producerId)throw Object.assign(new Error('O payload aninhado pertence a outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_PRODUCER_MISMATCH',expectedProducerId:producerId,actualProducerId:nestedProducer,path:nodePath})
  if(tenantId&&nestedTenant&&nestedTenant!==tenantId)throw Object.assign(new Error('O payload aninhado pertence a outro tenant.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_TENANT_MISMATCH',expectedTenantId:tenantId,actualTenantId:nestedTenant,path:nodePath})
  if(ownerId&&nestedOwner&&nestedOwner!==ownerId)throw Object.assign(new Error('O payload aninhado pertence a outro owner.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_OWNER_MISMATCH',expectedOwnerId:ownerId,actualOwnerId:nestedOwner,path:nodePath})
  for(const [key,child] of Object.entries(node))walk(child,`${nodePath}.${key}`,depth+1)
 }
 walk(value,path,0)
 return true
}

function assertInheritedEntityScope(record,{subjectId,organizationId,actorId}={}){
 assertContextScopeAliases(record)
 const producer=producerIdOf(record);const tenant=tenantIdOf(record);const owner=ownerIdOf(record)
 if(producer&&producer!==subjectId||tenant&&tenant!==organizationId||actorId&&owner&&owner!==actorId)throw Object.assign(new Error('A entidade ativa contém um vínculo filho fora do escopo autorizado.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_SCOPE_MISMATCH'})
}

function resolveActiveEntity(context,input,{subjectId,organizationId,actorId}={}){
  const raw=input.activeEntity??input.active_entity??input.activeObject??input.active_object
  if(raw==null)return null
  if(!plainObject(raw))throw Object.assign(new Error('A entidade ativa do contexto não é válida.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_INVALID'})
  const aliases={analysis:'soil_analysis'}
  const type=aliases[text(raw.type).toLowerCase()]||text(raw.type).toLowerCase()
  const id=text(raw.id)
  // Rascunho de visita ainda não existe no banco: o id é rótulo de tela, não chave de autorização, e não restringe o contexto do produtor.
  if(type==='visit_draft')return {type,id:id||'rascunho',ids:new Set([id||'rascunho']),record:null}
  if(!type||!id)throw Object.assign(new Error('A entidade ativa precisa de tipo e identificador.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_INVALID'})
  if(type==='client'){
    const allowed=new Set([subjectId,...entityIds(context?.client)].filter(Boolean))
    if(!allowed.has(id))throw Object.assign(new Error('A entidade ativa não pertence ao produtor solicitado.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_NOT_FOUND'})
    return {type,id,ids:allowed,record:context.client}
  }
  if(type==='agronomic_tool')return {type,id,ids:new Set([id]),record:null}
  let record=null;let parentProperty=null
  if(type==='property')record=list(context?.properties).find(item=>entityIds(item).includes(id))||null
  else if(type==='field')for(const property of list(context?.properties)){
    const field=list(property?.fields).find(item=>entityIds(item).includes(id))
    if(field){record=field;parentProperty=property;break}
  }
  else if(type==='soil_analysis')record=list(context?.soilAnalyses).find(item=>entityIds(item).includes(id))||null
  else if(type==='visit')record=list(context?.visits).find(item=>entityIds(item).includes(id))||null
  else if(type==='opportunity')record=list(context?.opportunities).find(item=>entityIds(item).includes(id))||null
  else throw Object.assign(new Error('O tipo da entidade ativa não é suportado pelo seletor de contexto.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_TYPE_UNSUPPORTED'})
  if(!record)throw Object.assign(new Error('A entidade ativa não pertence ao contexto autorizado do produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_NOT_FOUND'})
  const scopeRecord=parentProperty||record
  assertContextScopeAliases(scopeRecord)
  assertContextScopeAliases(record)
  const recordProducer=producerIdOf(scopeRecord);const recordTenant=tenantIdOf(scopeRecord);const recordOwner=ownerIdOf(scopeRecord)
  if(!recordProducer||!recordTenant||actorId&&!recordOwner)throw Object.assign(new Error('A entidade ativa não possui proveniência de escopo completa.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_SCOPE_UNVERIFIED'})
  if(recordProducer!==subjectId||recordTenant!==organizationId||actorId&&recordOwner!==actorId)throw Object.assign(new Error('A entidade ativa pertence a outro escopo autorizado.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_ENTITY_SCOPE_MISMATCH'})
  if(parentProperty)assertInheritedEntityScope(record,{subjectId,organizationId,actorId})
  if(type==='property')for(const field of list(record?.fields))assertInheritedEntityScope(field,{subjectId,organizationId,actorId})
  const ownIds=entityIds(record)
  const propertyIds=new Set(type==='property'?ownIds:[...(parentProperty?entityIds(parentProperty):[]),...relationIds(record,['property_id','propertyId','farm_id','farmId'])])
  const fieldIds=new Set(type==='field'?ownIds:type==='property'?list(record?.fields).flatMap(entityIds):relationIds(record,['field_id','fieldId','plot_id','plotId']))
  return {
    type,id,record,parentProperty,
    ids:new Set([id,...ownIds]),propertyIds,fieldIds
  }
}

function memoryMatchesActiveEntity(record,activeEntity){
 if(!activeEntity||['client','agronomic_tool','visit_draft'].includes(activeEntity.type))return true
 const subjectType=text(record?.subject_type).toLowerCase();const subjectId=text(record?.subject_id)
 if(activeEntity.type==='property')return subjectType==='property'&&activeEntity.ids.has(subjectId)||subjectType==='field'&&activeEntity.fieldIds.has(subjectId)
 if(activeEntity.type==='field')return subjectType==='field'&&activeEntity.ids.has(subjectId)||subjectType==='property'&&activeEntity.propertyIds.has(subjectId)
 if(activeEntity.type==='soil_analysis')return subjectType==='field'&&activeEntity.fieldIds.has(subjectId)||subjectType==='property'&&activeEntity.propertyIds.has(subjectId)
 if(activeEntity.type==='visit')return subjectType==='visit'&&activeEntity.ids.has(subjectId)
 if(activeEntity.type==='opportunity')return subjectType==='opportunity'&&activeEntity.ids.has(subjectId)
 return false
}

function scopeCollectionToActiveEntity(items,sourceType,activeEntity,onRejected=()=>{}){
  if(!activeEntity||['client','agronomic_tool','visit_draft'].includes(activeEntity.type))return items
  const matchesAny=(values,expected)=>values.some(value=>expected.has(value))
  const keep=[]
  for(const item of items){
    const data=item?.data||{}
    const ownIds=entityIds(data)
    const propertyIds=relationIds(data,['property_id','propertyId','farm_id','farmId'])
    const fieldIds=relationIds(data,['field_id','fieldId','plot_id','plotId'])
    const visitIds=relationIds(data,['visit_id','visitId'])
    const opportunityIds=relationIds(data,['opportunity_id','opportunityId'])
    let selected=false;let scopedItem=item
    if(activeEntity.type==='property'){
      const activePropertyIds=activeEntity.ids
      const propertyFieldIds=new Set(list(activeEntity.record?.fields).flatMap(entityIds))
      if(sourceType==='property')selected=matchesAny(ownIds,activePropertyIds)
      else if(['field_report','soil_analysis','ndvi_observation'].includes(sourceType))selected=matchesAny(propertyIds,activePropertyIds)||matchesAny(fieldIds,propertyFieldIds)
    }else if(activeEntity.type==='field'){
      if(sourceType==='property'){
        const fields=list(data.fields).filter(field=>matchesAny(entityIds(field),activeEntity.ids))
        selected=fields.length>0
        if(selected)scopedItem={...item,data:{...data,fields}}
      }else if(['field_report','soil_analysis','ndvi_observation'].includes(sourceType))selected=matchesAny(fieldIds,activeEntity.ids)
    }else if(activeEntity.type==='soil_analysis')selected=sourceType==='soil_analysis'&&matchesAny(ownIds,activeEntity.ids)
    else if(activeEntity.type==='visit')selected=sourceType==='visit'?matchesAny(ownIds,activeEntity.ids):['interaction','commitment'].includes(sourceType)&&matchesAny(visitIds,activeEntity.ids)
    else if(activeEntity.type==='opportunity')selected=sourceType==='opportunity'?matchesAny(ownIds,activeEntity.ids):['business_event','commitment'].includes(sourceType)&&matchesAny(opportunityIds,activeEntity.ids)
    if(selected)keep.push(scopedItem)
    else onRejected(item,'ACTIVE_ENTITY_MISMATCH')
  }
  return keep
}

function collectionItems(items,type,{domain,dateKeys=['updated_at','updatedAt','created_at','createdAt'],limit=8,validUntilKeys=['valid_until','validUntil'],now,contextDomain='GENERAL',query='',producerId='',tenantId='',ownerId='',onRejected=()=>{}}){
  const candidates=[]
  for(const item of list(items)){
    const scopeItem=boundaryScopeView(item)
    assertContextScopeAliases(scopeItem)
    const id=text(item?.id??item?.external_id??item?.externalId)||signature(item).slice(0,24)
    const itemProducer=producerIdOf(scopeItem);const itemTenant=tenantIdOf(scopeItem);const itemOwner=ownerIdOf(scopeItem)
    const rejectionBase={evidence_ref:reference(type,`${type}:${id}`),producerId:itemProducer||'missing-producer',tenantId:itemTenant||'missing-tenant',ownerId:itemOwner||null,observed_at:dateOf(item,dateKeys),data:{}}
    if(!itemProducer){onRejected(rejectionBase,'MISSING_PRODUCER_SCOPE');continue}
    if(!itemTenant){onRejected(rejectionBase,'MISSING_TENANT_SCOPE');continue}
    if(ownerId&&!itemOwner){onRejected(rejectionBase,'MISSING_OWNER_SCOPE');continue}
    if(itemProducer&&itemProducer!==producerId)throw Object.assign(new Error('Coleção recuperada para produtor diferente do ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'PRODUCER_MISMATCH',expectedProducerId:producerId,actualProducerId:itemProducer})
    if(itemTenant&&itemTenant!==tenantId)throw Object.assign(new Error('Coleção recuperada para tenant diferente do ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'TENANT_MISMATCH',expectedTenantId:tenantId,actualTenantId:itemTenant})
    if(ownerId&&itemOwner&&itemOwner!==ownerId)throw Object.assign(new Error('Coleção recuperada para owner diferente do ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'OWNER_MISMATCH',expectedOwnerId:ownerId,actualOwnerId:itemOwner})
    assertNestedContextBoundary(item,{producerId,tenantId,ownerId},`context.${type}`)
    const observedAt=dateOf(item,dateKeys)
    const validUntil=dateOf(item,validUntilKeys)
    const evaluated=evaluateSourceFreshness({domain,sourceType:type,source:item,observedAt,validUntil,now})
    // Eventos e snapshots datados sem uma politica de expiracao continuam
    // sendo fatos "as of" aquela data. Itens sem qualquer data permanecem
    // UNKNOWN e serao retirados do contexto elegivel ao modelo.
    const evaluation=evaluated.status==='UNKNOWN'&&evaluated.metadata?.reason_code==='NO_DOMAIN_SOURCE_POLICY'&&observedAt
      ?{status:'CURRENT',metadata:{...evaluated.metadata,strategy:'OBSERVED_AS_OF',reason_code:'OBSERVED_AT_VERIFIED'}}
      :evaluated
    let selectedData=item
    const visitContentRequested=/\b(?:o que|resum\w*|detalh\w*|assunto\w*|falad\w*|discut\w*|relat\w*|observ\w*|aconteceu|resultado\w*)\b/i.test(text(query).normalize('NFD').replace(/[\u0300-\u036f]/g,''))
    if(type==='visit'&&contextDomain==='VISIT'&&!visitContentRequested){
      // A identidade/data da visita responde "qual foi a ultima visita" sem
      // carregar automaticamente todos os assuntos discutidos nela. O tipo
      // VISIT autoriza selecionar o evento, não transforma CPF, grãos ou
      // fertilizantes narrados no payload em fatos necessários à pergunta.
      const allowed=['id','external_id','externalId','scheduled_at','scheduledAt','occurred_at','occurredAt','completed_at','completedAt','created_at','createdAt','updated_at','updatedAt','status','lifecycle_status','lifecycleStatus','tenant_id','tenantId','organization_id','organizationId','producer_id','producerId','client_id','clientId','context_owner_id','contextOwnerId','owner_id','ownerId','consultant_id','consultantId']
      selectedData=Object.fromEntries(allowed.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]))
    }
    const scoped={evidence_ref:reference(type,`${type}:${id}`),producerId:itemProducer,tenantId:itemTenant,ownerId:itemOwner||null,observed_at:evaluation.metadata.observed_at,valid_until:evaluation.metadata.valid_until,freshness:evaluation.status,freshness_metadata:evaluation.metadata,data:selectedData}
    if(!collectionMatchesContextDomain(selectedData,type,contextDomain,query)){onRejected(scoped,'DOMAIN_MISMATCH');continue}
    candidates.push(scoped)
  }
  candidates.sort((left,right)=>{
    const leftTime=new Date(left.observed_at||0).getTime()||0
    const rightTime=new Date(right.observed_at||0).getTime()||0
    return rightTime-leftTime||String(left.evidence_ref.id).localeCompare(String(right.evidence_ref.id))
  })
  for(const item of candidates.slice(limit))onRejected(item,'LOWER_RELEVANCE')
  return candidates.slice(0,limit)
}

const profileForeignDomains=new Set(['GRAINS','CREDIT','AGRONOMY','GEO'])
const profileSignalValue=value=>{
  const candidate=text(value).slice(0,500)
  if(!candidate)return ''
  const foreign=matchedValContextDomains(candidate).filter(domain=>profileForeignDomains.has(domain))
  return foreign.length?'':candidate
}

const profileEvidenceId=item=>text(item?.id??item?.source_id??item?.sourceId??item?.survey_id??item?.surveyId)
const profileEvidenceSource=item=>text(item?.profile_source_ref??item?.profileSourceRef)

function profileSignals(context,{producerId='',tenantId='',ownerId='',now=new Date(),freshnessStatus='UNKNOWN',freshnessMetadata={},assessedAt=null,validUntil=null}={}){
  const profile=context?.profile||{}
  const client=context?.client||{}
  if(freshnessStatus!=='CURRENT')return []
  const evidence=[...list(profile.evidence),...list(client.profileEvidence)].filter(item=>{
    const evidenceProducer=producerIdOf(item);const evidenceTenant=tenantIdOf(item);const evidenceOwner=ownerIdOf(item)
    if(!evidenceProducer||!evidenceTenant||ownerId&&!evidenceOwner)return false
    if(evidenceProducer!==producerId||evidenceTenant!==tenantId||ownerId&&evidenceOwner!==ownerId)return false
    const evidenceObservedAt=iso(item?.assessed_at??item?.assessedAt??item?.observed_at??item?.observedAt??item?.created_at??item?.createdAt??assessedAt)
    const evidenceValidUntil=iso(item?.valid_until??item?.validUntil??validUntil)
    const evaluation=evaluateSourceFreshness({domain:'BEHAVIORAL',sourceType:'behavioral_profile',source:item,observedAt:evidenceObservedAt,validUntil:evidenceValidUntil,now})
    return evaluation.status==='CURRENT'
  })
  const firstEvidenceId=evidence.map(profileEvidenceId).find(Boolean)
  const sourceId=text(profile.sourceId)||text(client.profileSource)||firstEvidenceId
  const linkedSource=evidence.some(item=>[profileEvidenceId(item),text(item?.source_ref??item?.sourceRef),profileEvidenceSource(item)].filter(Boolean).includes(sourceId))
  if(!sourceId||!evidence.length||!linkedSource)return []
  const values=[
    ['primary_profile',client.primaryProfile],
    ['secondary_profile',client.secondaryProfile],
    ['service_preference',client.servicePreference]
  ].map(([key,value])=>[key,profileSignalValue(value)]).filter(([,value])=>value)
  return values.map(([key,value])=>({
    key,
    value,
    epistemic_state:'HYPOTHESIS',
    evidence_type:'INFERENCE',
    tenant_id:tenantId,
    producer_id:producerId,
    owner_id:ownerId||null,
    source_ref:sourceId,
    confidence:null,
    freshness:'CURRENT',
    freshness_metadata:plainObject(freshnessMetadata)?freshnessMetadata:{},
    evidence_refs:evidence.flatMap(item=>{
      const id=text(item?.id??item?.source_id??item?.sourceId)
      return id?[reference(text(item?.source_type??item?.source)||'profile_evidence',id)]:[]
    }).slice(0,20),
    observed_at:iso(assessedAt)||evidence.map(item=>iso(item?.assessed_at??item?.assessedAt??item?.observed_at??item?.observedAt??item?.created_at??item?.createdAt)).find(Boolean)||null,
    valid_until:iso(validUntil??profile.validUntil??client.profileValidUntil)
  }))
}

function memoryBehavioralSignals(records,{producerId='',tenantId='',ownerId='',freshnessById=new Map()}={}){
 return list(records).filter(record=>record.memory_type==='BEHAVIORAL'&&record.key==='visit_report.behavioral_signal').map(record=>({
  key:record.content?.signal_code||record.key,
  value:record.content?.statement||'',
  epistemic_state:record.memory_state,
  evidence_type:evidenceType(record),
  tenant_id:tenantId,
  producer_id:producerId,
  owner_id:ownerId||null,
  source_ref:record.source_ref,
  confidence:record.confidence,
  freshness:freshnessById.get(record.memory_id)?.status||'UNKNOWN',
  freshness_metadata:freshnessById.get(record.memory_id)?.metadata||{},
  evidence_refs:record.evidence_refs.map(item=>reference(item.source_type||'evidence',item.id)),
  observed_at:record.observed_at||record.source_updated_at||record.valid_from||record.updated_at,
  valid_until:record.valid_until
 }))
}

function authorizedSubjects(context,{organizationId,subjectType,subjectId,actorId}){
  const subjects=[]
  const seen=new Set()
  const add=(type,id)=>{
    const normalizedType=text(type);const normalizedId=text(id);const key=`${normalizedType}:${normalizedId}`
    if(!normalizedType||!normalizedId||seen.has(key))return
    seen.add(key);subjects.push({type:normalizedType,id:normalizedId})
  }
  add(subjectType,subjectId)
  const verified=(record,{inheritFrom=null}={})=>{
    assertContextScopeAliases(record)
    if(inheritFrom)assertContextScopeAliases(inheritFrom)
    const producer=producerIdOf(record)||producerIdOf(inheritFrom)
    const tenant=tenantIdOf(record)||tenantIdOf(inheritFrom)
    const owner=ownerIdOf(record)||ownerIdOf(inheritFrom)
    if(producer!==subjectId||tenant!==organizationId||actorId&&owner!==actorId)return false
    const ownProducer=producerIdOf(record);const ownTenant=tenantIdOf(record);const ownOwner=ownerIdOf(record)
    if(ownProducer&&ownProducer!==subjectId||ownTenant&&ownTenant!==organizationId||actorId&&ownOwner&&ownOwner!==actorId)return false
    return true
  }
  for(const property of list(context?.properties)){
    if(!verified(property))continue
    add('property',property?.id);add('property',property?.external_key??property?.externalKey)
    for(const field of list(property?.fields))if(verified(field,{inheritFrom:property})){add('field',field?.id);add('field',field?.external_key??field?.externalKey)}
  }
  for(const visit of list(context?.visits))if(verified(visit))add('visit',visit?.id)
  for(const opportunity of list(context?.opportunities))if(verified(opportunity))add('opportunity',opportunity?.id)
  // Um commitment só prova o próprio vínculo; ele não comprova ownership de
  // uma visita/oportunidade arbitrária citada por id. Esses subjects entram
  // apenas quando a entidade correspondente acima foi verificada.
  return subjects
}

function missingInformation(context,{objective,domain='GENERAL',hasSelectedMemories,currentSoil,selectedMemories=[]}){
  const missing=[]
  if(!context?.client?.id&&!context?.client?.name)missing.push({code:'subject_record',description:'Falta o cadastro autorizado do produtor.',critical:true})
  if(domain!=='PROFILE'&&!hasSelectedMemories&&!list(context?.businessHistory).length&&!list(context?.interactions).length&&!list(context?.visits).length)missing.push({code:'historical_context',description:'Não há histórico material autorizado para esta decisão.',critical:false})
  if(['prepare_visit','next_best_action'].includes(objective)&&!list(context?.interactions).length&&!list(context?.visits).length)missing.push({code:'recent_interaction',description:'Falta uma interação recente confirmada com o produtor.',critical:false})
  if(/^agronomic_/.test(objective)&&!currentSoil)missing.push({code:'current_soil_analysis',description:'Falta análise de solo atualizada para sustentar uma recomendação agronômica.',critical:true})
  if(!list(context?.profile?.evidence).length&&!list(context?.client?.profileEvidence).length)missing.push({code:'behavioral_evidence',description:'O perfil comportamental não possui evidência observável recuperável.',critical:false})
  for(const record of list(selectedMemories).filter(item=>domain!=='PROFILE'&&item.key==='visit_report.missing_information')){
    const code=text(record.content?.code)||'visit_missing_information'
    const description=text(record.content?.statement)
    if(description&&!missing.some(item=>item.code===code&&item.description===description))missing.push({code,description,critical:Boolean(record.content?.critical),source_ref:record.source_ref})
  }
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

function assertContextInputAliases(context={}){
  const collections=['businessHistory','visits','interactions','commitments','opportunities','properties','fieldReports','soilAnalyses','ndviObservations','manualRecords','attachments']
  for(const key of collections)for(const item of list(context?.[key])){
    assertNestedContextBoundary(item,{},`context.${key}`)
  }
  for(const item of [...list(context?.profile?.evidence),...list(context?.client?.profileEvidence)])assertNestedContextBoundary(item,{},'context.profile.evidence')
}

export function buildContextSnapshot(context={},input={}){
  const started=Date.now()
  const now=input.now instanceof Date?input.now:new Date(input.now||Date.now())
  const organizationId=text(input.organizationId??input.organization_id)
  const subjectType=text(input.subjectType??input.subject_type)||'client'
  const subjectId=text(input.subjectId??input.subject_id??context?.client?.id)
  const objective=text(input.objective)||'general_assistance'
  const query=text(input.message??input.query)
  const requestedDomain=text(input.contextDomain??input.context_domain).toUpperCase()
  const domain=valContextDomains.includes(requestedDomain)?requestedDomain:classifyValContextDomain(query||objective,input.intent||objective)
  const requestedDomains=domain==='MULTI_DOMAIN'?matchedValContextDomains(query):[domain]
  const contextEpoch=contextEpochInput(input)
  const collectionPolicy=contextCollectionPolicy(domain,query)
  const semanticQuery=query||(domain==='GENERAL'?'':objective)
  const role=text(input.role)||'consultant'
  const scope=text(input.scope)||'own_portfolio'
  const actorId=text(input.actorId??input.actor_id)
  assertContextScopeAliases(input)
  assertContextScopeAliases(context?.client)
  assertContextInputAliases(context)
  const contextClientId=text(context?.client?.id)
  const contextClientProducer=producerIdOf(context?.client)
  const contextClientTenant=tenantIdOf(context?.client)
  const contextClientOwner=ownerIdOf(context?.client)
  if(contextClientId&&contextClientId!==subjectId)throw Object.assign(new Error('O cadastro ativo pertence a outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_CLIENT_MISMATCH',expectedProducerId:subjectId,actualProducerId:contextClientId})
  if(contextClientProducer&&contextClientProducer!==subjectId)throw Object.assign(new Error('O cadastro ativo declara outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_CLIENT_SCOPE_MISMATCH',expectedProducerId:subjectId,actualProducerId:contextClientProducer})
  if(contextClientTenant&&contextClientTenant!==organizationId)throw Object.assign(new Error('O cadastro ativo declara outro tenant.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_CLIENT_SCOPE_MISMATCH',expectedTenantId:organizationId,actualTenantId:contextClientTenant})
  if(actorId&&contextClientOwner&&contextClientOwner!==actorId)throw Object.assign(new Error('O cadastro ativo declara outro owner.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ACTIVE_CLIENT_SCOPE_MISMATCH',expectedOwnerId:actorId,actualOwnerId:contextClientOwner})
  const activeEntity=resolveActiveEntity(context,input,{subjectId,organizationId,actorId})
  const rawMemories=list(context.memoryHistory).length?context.memoryHistory:list(context.memories)
  const allowedSubjects=authorizedSubjects(context,{organizationId,subjectType,subjectId,actorId})
  const considered=[]
  const memoryScopeById=new Map()
  const globalMemoryIds=new Set()
  const rejectedScopeTrace=[]
  let unauthorizedCount=0
  let invalidCount=0
  for(const row of rawMemories){
    assertContextScopeAliases(row)
    const rawOrganization=tenantIdOf(row)
    const rawSubject=text(row?.subject_id??row?.subjectId??row?.client_id??row?.clientId)
    const rawOwner=ownerIdOf(row)
    const rawProducer=producerIdOf(row)
    const rawSubjectType=text(row?.subject_type??row?.subjectType??(rawProducer?'client':''))
    const global=explicitlyGlobalContext(row)
    if(!rawOrganization||!rawSubject){
      invalidCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:row?.source_type??row?.sourceType??row?.source,sourceId:row?.source_ref??row?.sourceRef??row?.id,producerId:rawSubject||subjectId,tenantId:rawOrganization||organizationId,ownerId:actorId,timestamp:row?.observed_at??row?.updated_at,reasonSelected:'MISSING_SOURCE_PROVENANCE',status:'REJECTED'}))
      continue
    }
    const validGlobalSubject=global&&['organization','global','market','general_knowledge'].includes(rawSubjectType.toLowerCase())&&!rawProducer
    if(global&&!validGlobalSubject){
      unauthorizedCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:row?.source_type??row?.sourceType??row?.source,sourceId:row?.source_ref??row?.sourceRef??row?.id,producerId:rawProducer||'GLOBAL',tenantId:rawOrganization,ownerId:rawOwner||null,timestamp:row?.observed_at??row?.updated_at,reasonSelected:'INVALID_GLOBAL_SCOPE',status:'REJECTED'}))
      continue
    }
    if(!global&&!rawProducer){
      unauthorizedCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:row?.source_type??row?.sourceType??row?.source,sourceId:row?.source_ref??row?.sourceRef??row?.id,producerId:'missing-producer',tenantId:rawOrganization,ownerId:rawOwner||null,timestamp:row?.observed_at??row?.updated_at,reasonSelected:'MISSING_PRODUCER_SCOPE',status:'REJECTED'}))
      continue
    }
    if(!global&&rawProducer!==subjectId){
      unauthorizedCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:row?.source_type??row?.sourceType??row?.source,sourceId:row?.source_ref??row?.sourceRef??row?.id,producerId:rawProducer,tenantId:rawOrganization,ownerId:rawOwner||null,timestamp:row?.observed_at??row?.updated_at,reasonSelected:'PRODUCER_MISMATCH',status:'REJECTED'}))
      continue
    }
    if(!global&&actorId&&!rawOwner){
      unauthorizedCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:row?.source_type??row?.sourceType??row?.source,sourceId:row?.source_ref??row?.sourceRef??row?.id,producerId:rawProducer,tenantId:rawOrganization,ownerId:null,timestamp:row?.observed_at??row?.updated_at,reasonSelected:'MISSING_OWNER_SCOPE',status:'REJECTED'}))
      continue
    }
    if(actorId&&rawOwner&&rawOwner!==actorId){
      unauthorizedCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:row?.source_type??row?.sourceType??row?.source,sourceId:row?.source_ref??row?.sourceRef??row?.id,producerId:rawSubject,tenantId:rawOrganization,ownerId:rawOwner,timestamp:row?.observed_at??row?.updated_at,reasonSelected:'OWNER_MISMATCH',status:'REJECTED'}))
      continue
    }
    let record
    try{record=canonicalMemoryRecord(row,{organizationId,subjectType,subjectId})}catch{invalidCount+=1;continue}
    const subjectsForRecord=global?[...allowedSubjects,{type:record.subject_type,id:record.subject_id}]:allowedSubjects
    if(!isMemoryAuthorized(record,{organizationId,subjectType,subjectId,authorizedSubjects:subjectsForRecord,actorId,role,scope})){
      unauthorizedCount+=1
      rejectedScopeTrace.push(contextTraceEntry({sourceType:record.source_type,sourceId:record.source_ref,producerId:global?'GLOBAL':rawProducer,tenantId:record.organization_id,ownerId:rawOwner||null,timestamp:record.observed_at||record.updated_at,reasonSelected:'UNAUTHORIZED_SCOPE',status:'REJECTED'}))
      continue
    }
    considered.push(record)
    memoryScopeById.set(record.memory_id,{producerId:global?null:rawProducer,tenantId:rawOrganization,ownerId:rawOwner||null,global})
    if(global)globalMemoryIds.add(record.memory_id)
  }
  const supersededIds=new Set(considered.filter(item=>memoryValidity(item,now)==='CURRENT').map(item=>item.supersedes_id).filter(Boolean))
  const active=[]
  const stale=[]
  const evaluatedMemoryFreshness=new Map()
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
    if(globalMemoryIds.has(record.memory_id)){exclude(record.memory_id,'GLOBAL_CONTEXT_NOT_PRODUCER_SPECIFIC');continue}
    if(!memoryMatchesActiveEntity(record,activeEntity)){exclude(record.memory_id,'ACTIVE_ENTITY_MISMATCH');continue}
    if(!memoryMatchesContextDomain(record,domain,semanticQuery)){exclude(record.memory_id,'DOMAIN_MISMATCH');continue}
    let validity=memoryValidity(record,now)
    if(supersededIds.has(record.memory_id))validity='SUPERSEDED'
    let temporalEvaluation=evaluateSourceFreshness({domain:'MEMORY',sourceType:'val_memory',source:record,observedAt:record.observed_at,validFrom:record.valid_from,validUntil:record.valid_until,now})
    if(domain==='PROFILE'&&record.memory_type==='BEHAVIORAL')temporalEvaluation=profileMemoryFreshness(record,temporalEvaluation,now)
    evaluatedMemoryFreshness.set(record.memory_id,temporalEvaluation)
    if(validity==='CURRENT'&&domain==='PROFILE'&&temporalEvaluation.status!=='CURRENT'){
      stale.push({...contextItem(record,{freshness:temporalEvaluation.status,freshnessMetadata:temporalEvaluation.metadata,...memoryScopeById.get(record.memory_id)}),reason:String(temporalEvaluation.metadata?.reason_code||temporalEvaluation.status).toLowerCase()})
      exclude(record.memory_id,temporalEvaluation.status==='STALE'?'STALE':'FRESHNESS_UNKNOWN')
    }
    else if(validity==='CURRENT')active.push(record)
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
      stale.push({...contextItem(record,{freshness:validity,freshnessMetadata,...memoryScopeById.get(record.memory_id)}),reason:validity.toLowerCase()})
      exclude(record.memory_id,validity)
    }
  }
  active.sort((left,right)=>relevance(right,`${objective} ${query}`,now)-relevance(left,`${objective} ${query}`,now)||String(right.updated_at||'').localeCompare(String(left.updated_at||'')))
  const domainMemoryLimit={PROFILE:4,VISIT:8,COMMERCIAL:10,AGRONOMY:10,GRAINS:8,CREDIT:8,GEO:8,OPPORTUNITY:8,GENERAL:6,MULTI_DOMAIN:12}[domain]||6
  const selected=active.slice(0,Math.max(1,Math.min(domainMemoryLimit,Number(input.memoryLimit)||domainMemoryLimit)))
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
    const evaluation=evaluatedMemoryFreshness.get(record.memory_id)||evaluateSourceFreshness({domain:'MEMORY',sourceType:'val_memory',source:record,observedAt:record.observed_at,validFrom:record.valid_from,validUntil:record.valid_until,now})
    target.push(contextItem(record,{freshness:evaluation.status,freshnessMetadata:evaluation.metadata,...memoryScopeById.get(record.memory_id)}))
  }

  const grouped=new Map()
  for(const record of selected.filter(item=>item.status==='ACTIVE'&&(item.confidence??50)>=50&&sourceAuthority(item)>=15&&conflictComparable(item))){
    const key=`${record.subject_type}:${record.subject_id}:${record.memory_type}:${record.key}`
    const valueSignature=signature(record.content)
    const group=grouped.get(key)||new Map()
    group.set(valueSignature,[...(group.get(valueSignature)||[]),record])
    grouped.set(key,group)
  }
  const conflicts=[]
  for(const [key,values] of grouped)if(values.size>1){
    const records=[...values.values()].flat()
    const provenance=memoryScopeById.get(records[0]?.memory_id)||{}
    conflicts.push({
      key,
      tenant_id:provenance.tenantId,
      producer_id:provenance.producerId,
      owner_id:provenance.ownerId||null,
      memory_refs:records.map(item=>item.memory_id),
      source_refs:[...new Set(records.map(item=>item.source_ref))],
      status:'REQUIRES_CONFIRMATION'
    })
  }

  const collectionRejectedTrace=[]
  const rejectCollection=(item,reason)=>collectionRejectedTrace.push(contextTraceEntry({sourceType:item.evidence_ref?.type,sourceId:item.evidence_ref?.id,producerId:item.producerId,tenantId:item.tenantId,ownerId:item.ownerId,timestamp:item.observed_at,relevanceScore:0,reasonSelected:reason,status:'REJECTED'}))
  const collectionScope={contextDomain:domain,query,producerId:subjectId,tenantId:organizationId,ownerId:actorId,onRejected:rejectCollection}
  const normalizedCollectionQuery=text(query).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const latestVisitOnly=domain==='VISIT'&&/\bultim[ao]\s+(?:visita|conversa)\b/.test(normalizedCollectionQuery)
  const businessItems=collectionPolicy.commercial?scopeCollectionToActiveEntity(collectionItems(context.businessHistory,'business_event',{...collectionScope,domain:'COMMERCIAL',dateKeys:['occurred_at','occurredAt','created_at','createdAt'],limit:12,now}),'business_event',activeEntity,rejectCollection):[]
  const opportunityItems=collectionPolicy.commercial?scopeCollectionToActiveEntity(collectionItems(context.opportunities,'opportunity',{...collectionScope,domain:'COMMERCIAL',limit:12,now}),'opportunity',activeEntity,rejectCollection):[]
  const propertyItems=collectionPolicy.agronomic?scopeCollectionToActiveEntity(collectionItems(context.properties,'property',{...collectionScope,domain:'AGRONOMIC',limit:8,now}),'property',activeEntity,rejectCollection):[]
  const fieldReportItems=collectionPolicy.agronomic?scopeCollectionToActiveEntity(collectionItems(context.fieldReports,'field_report',{...collectionScope,domain:'AGRONOMIC',dateKeys:['observed_at','observedAt','created_at','createdAt'],limit:8,now}),'field_report',activeEntity,rejectCollection):[]
  const soilAll=collectionPolicy.agronomic?scopeCollectionToActiveEntity(collectionItems(context.soilAnalyses,'soil_analysis',{...collectionScope,domain:'AGRONOMIC',dateKeys:['sampled_at','sampledAt','observed_at','observedAt','created_at','createdAt'],limit:12,now}),'soil_analysis',activeEntity,rejectCollection):[]
  const ndviItems=collectionPolicy.agronomic?scopeCollectionToActiveEntity(collectionItems(context.ndviObservations,'ndvi_observation',{...collectionScope,domain:'AGRONOMIC',dateKeys:['observed_at','observedAt','created_at','createdAt'],limit:8,now}),'ndvi_observation',activeEntity,rejectCollection):[]
  const interactionItems=collectionPolicy.relationship?scopeCollectionToActiveEntity(collectionItems(context.interactions,'interaction',{...collectionScope,domain:'RELATIONSHIP',dateKeys:['occurred_at','occurredAt','created_at','createdAt'],limit:10,now}),'interaction',activeEntity,rejectCollection):[]
  const visitItems=collectionPolicy.relationship?scopeCollectionToActiveEntity(collectionItems(context.visits,'visit',{...collectionScope,domain:'RELATIONSHIP',dateKeys:['updated_at','updatedAt','occurred_at','occurredAt','completed_at','completedAt','scheduled_at','scheduledAt','created_at','createdAt'],limit:latestVisitOnly?1:10,now}),'visit',activeEntity,rejectCollection):[]
  const commitmentItems=collectionPolicy.relationship?scopeCollectionToActiveEntity(collectionItems(context.commitments,'commitment',{...collectionScope,domain:'RELATIONSHIP',dateKeys:['updated_at','updatedAt','created_at','createdAt'],validUntilKeys:['due_at','dueAt'],limit:12,now}),'commitment',activeEntity,rejectCollection):[]
  const manualRecordItems=collectionPolicy.agronomic?collectionItems(context.manualRecords,'manual_record',{...collectionScope,domain:'AGRONOMIC',dateKeys:['occurred_at','occurredAt','ingested_at','ingestedAt','updated_at','updatedAt','created_at','createdAt'],limit:8,now}):[]
  const attachmentItems=collectionPolicy.agronomic?collectionItems(context.attachments,'attachment',{...collectionScope,domain:'AGRONOMIC',dateKeys:['updated_at','updatedAt','confirmed_at','confirmedAt','created_at','createdAt'],limit:8,now}):[]
  const currentSoil=soilAll.some(item=>item.freshness==='CURRENT')
  const staleSoil=collectionPolicy.agronomic?soilAll.filter(item=>item.freshness==='STALE').map(item=>({epistemic_type:'FACT',evidence_type:'OBSERVATION',tenant_id:item.tenantId,producer_id:item.producerId,owner_id:item.ownerId,source_ref:item.evidence_ref.id,source_type:'soil_analysis',observed_at:item.observed_at,valid_until:item.valid_until,freshness:'STALE',freshness_metadata:item.freshness_metadata,reason:'domain_source_policy'})):[]
  const profileValidUntil=iso(context?.profile?.validUntil??context?.client?.profileValidUntil)
  const profileAssessedAt=iso(context?.profile?.assessedAt??context?.profile?.updatedAt??context?.client?.profileUpdatedAt)
  const profileFreshness=evaluateSourceFreshness({domain:'BEHAVIORAL',sourceType:'behavioral_profile',source:context?.profile||{},observedAt:profileAssessedAt,validUntil:profileValidUntil,now})
  if(collectionPolicy.behavioral&&profileFreshness.status!=='CURRENT')stale.push({epistemic_type:'HYPOTHESIS',evidence_type:'INFERENCE',tenant_id:organizationId,producer_id:subjectId,owner_id:actorId||null,source_ref:text(context?.profile?.sourceId)||'profile:unattributed',source_type:'behavioral_profile',observed_at:profileAssessedAt,valid_until:profileValidUntil,freshness:profileFreshness.status,freshness_metadata:profileFreshness.metadata,reason:'domain_source_policy'})
  stale.push(...staleSoil)

  const provenanceScope={producerId:subjectId,tenantId:organizationId,ownerId:actorId}
  const behavioralSignals=collectionPolicy.behavioral?[...profileSignals(context,{...provenanceScope,now,freshnessStatus:profileFreshness.status,freshnessMetadata:profileFreshness.metadata,assessedAt:profileAssessedAt,validUntil:profileValidUntil}),...memoryBehavioralSignals(selected,{...provenanceScope,freshnessById:evaluatedMemoryFreshness})].filter(item=>item.freshness==='CURRENT'):[]
  const commercialContext={
    business_history:collectionPolicy.commercial?businessItems:[],
    opportunities:collectionPolicy.commercial?opportunityItems:[],
    summary:{}
  }
  const agronomicContext={
    properties:collectionPolicy.agronomic?propertyItems:[],
    field_reports:collectionPolicy.agronomic?fieldReportItems:[],
    soil_analyses:collectionPolicy.agronomic?soilAll:[],
    ndvi_observations:collectionPolicy.agronomic?ndviItems:[],
    manual_records:collectionPolicy.agronomic?manualRecordItems:[],
    attachments:collectionPolicy.agronomic?attachmentItems:[]
  }
  const relationshipContext={
    interactions:collectionPolicy.relationship?interactionItems:[],
    visits:collectionPolicy.relationship?visitItems:[],
    commitments:collectionPolicy.relationship?commitmentItems:[],
    overdue_commitments:collectionPolicy.relationship?commitmentItems.filter(item=>{
      const source=item.data
      const due=iso(source?.due_at??source?.dueAt)
      return Boolean(due&&new Date(due).getTime()<now.getTime()&&!['DONE','CANCELLED'].includes(text(source?.status).toUpperCase()))
    }).map(item=>{
      const source=item.data
      const commitment_ref=`commitment:${text(source?.commitment_id??source?.id)}`
      return {evidence_ref:item.evidence_ref,producerId:item.producerId,tenantId:item.tenantId,ownerId:item.ownerId,observed_at:item.observed_at,valid_until:item.valid_until,freshness:item.freshness,freshness_metadata:item.freshness_metadata,commitment_ref,data:{commitment_ref,due_at:iso(source?.due_at??source?.dueAt),status:text(source?.status).toUpperCase(),description:text(source?.description).slice(0,500)}}
    }).slice(0,12):[],
    reported_profile:{}
  }
  const missing=missingInformation(context,{objective,domain,hasSelectedMemories:Boolean(selected.length),currentSoil,selectedMemories:selected})
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
  for(const section of [commercialContext.business_history,commercialContext.opportunities,agronomicContext.properties,agronomicContext.field_reports,agronomicContext.soil_analyses,agronomicContext.ndvi_observations,agronomicContext.manual_records,agronomicContext.attachments,relationshipContext.interactions,relationshipContext.visits,relationshipContext.commitments])for(const item of section)addEvidence(item.evidence_ref)
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
    ...agronomicContext.properties,...agronomicContext.field_reports,...agronomicContext.soil_analyses,...agronomicContext.ndvi_observations,...agronomicContext.manual_records,...agronomicContext.attachments,
    ...relationshipContext.interactions,...relationshipContext.visits,...relationshipContext.commitments,
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
  const selectedCollections=[
    ...commercialContext.business_history,...commercialContext.opportunities,
    ...agronomicContext.properties,...agronomicContext.field_reports,...agronomicContext.soil_analyses,...agronomicContext.ndvi_observations,...agronomicContext.manual_records,...agronomicContext.attachments,
    ...relationshipContext.interactions,...relationshipContext.visits,...relationshipContext.commitments,...relationshipContext.overdue_commitments
  ]
  const boundaryCollections=selectedCollections.map(item=>({...item,data:boundaryScopeView(item?.data)}))
  assertActiveProducerBoundary([...facts,...inferences,...hypotheses,...validatedKnowledge,...boundaryCollections,...behavioralSignals,...stale,...conflicts],{producerId:subjectId,tenantId:organizationId,ownerId:actorId,requireOwner:Boolean(actorId)})
  const selectedTrace=[
    ...selected.map(item=>{
      const provenance=memoryScopeById.get(item.memory_id)||{}
      return contextTraceEntry({sourceType:item.source_type,sourceId:item.source_ref,producerId:provenance.producerId,tenantId:provenance.tenantId,ownerId:provenance.ownerId,timestamp:item.observed_at||item.updated_at,relevanceScore:relevance(item,`${objective} ${query}`,now),reasonSelected:`DOMAIN_${domain}_SEMANTIC_MATCH`})
    }),
    ...selectedCollections.map(item=>contextTraceEntry({sourceType:item.evidence_ref?.type,sourceId:item.evidence_ref?.id,producerId:item.producerId,tenantId:item.tenantId,ownerId:item.ownerId,timestamp:item.observed_at,relevanceScore:1,reasonSelected:`COLLECTION_${domain}_SEMANTIC_MATCH`})),
    ...behavioralSignals.map(item=>contextTraceEntry({sourceType:'behavioral_profile',sourceId:item.source_ref,producerId:item.producer_id,tenantId:item.tenant_id,ownerId:item.owner_id,timestamp:item.observed_at,relevanceScore:1,reasonSelected:'BEHAVIORAL_EVIDENCE'}))
  ].slice(0,100)
  const rejectedTrace=[
    ...rejectedScopeTrace,
    ...considered.filter(item=>exclusions.has(item.memory_id)).map(item=>{
      const provenance=memoryScopeById.get(item.memory_id)||{}
      return contextTraceEntry({sourceType:item.source_type,sourceId:item.source_ref,producerId:provenance.global?'GLOBAL':provenance.producerId,tenantId:provenance.tenantId,ownerId:provenance.ownerId,timestamp:item.observed_at||item.updated_at,relevanceScore:relevance(item,`${objective} ${query}`,now),reasonSelected:[...(exclusions.get(item.memory_id)||[])].join(','),status:'REJECTED'})
    }),
    ...collectionRejectedTrace
  ].slice(0,100)
  const conversationId=text(input.conversationId??input.conversation_id)||null
  const id=snapshotId({version:contextSnapshotVersion,selectorVersion:valContextSelectorVersion,requestId:input.requestId,organizationId,subjectType,subjectId,actorId,role,scope,objective,domain,requestedDomains,conversationId,contextEpoch,queryHash:query?signature(query):null,activeEntity:activeEntity?{type:activeEntity.type,id:activeEntity.id}:null,selected:selectedRefs,excluded:exclusionReasonCodes,conflicts:conflicts.map(item=>item.memory_refs)})
  const snapshot={
    contract_version:contextSnapshotVersion,
    context_snapshot_id:id,
    request_id:text(input.requestId)||null,
    organization_id:organizationId,
    subject:{type:subjectType,id:subjectId},
    context_scope:{tenant_id:organizationId,owner_id:actorId||null,producer_id:subjectId,active_entity:activeEntity?{type:activeEntity.type,id:activeEntity.id}:null,conversation_id:conversationId,context_epoch:contextEpoch,domain,requested_domains:requestedDomains,query_fingerprint:query?signature(query):null,selector_version:valContextSelectorVersion,minimum_sufficient_context:true},
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
      domain,
      selector_version:valContextSelectorVersion,
      context_trace:{selected:selectedTrace,rejected:rejectedTrace,content_free:true},
      unauthorized_count:unauthorizedCount,
      invalid_count:invalidCount,
      latency_ms:Math.max(0,Date.now()-started)
    }
  }
  return assertContextSnapshot(snapshot)
}

const memoryDomains=new Set(['PRODUCER','COMMERCIAL','AGRONOMIC','BEHAVIORAL','RELATIONSHIP','ORGANIZATIONAL','STRATEGIC'])
const epistemicTypes=new Set(['FACT','INFERENCE','HYPOTHESIS','VALIDATED_KNOWLEDGE'])
const evidenceTypes=new Set(['FACT','OBSERVATION','INFERENCE','INTENTION','QUOTE','STRATEGY','HYPOTHESIS'])
const freshnessTypes=new Set(['CURRENT','STALE','EXPIRED','SUPERSEDED','UNKNOWN'])
const activeEntityTypes=new Set(['client','property','field','soil_analysis','visit','visit_draft','opportunity','agronomic_tool'])
const isoValue=value=>typeof value==='string'&&iso(value)===value
const nullableIso=value=>value===null||isoValue(value)
const nullableText=value=>value===null||typeof value==='string'
const validReference=value=>plainObject(value)&&text(value.type)&&text(value.id)
const validConfidence=value=>value===null||Number.isFinite(value)&&value>=0&&value<=100
const sameSet=(left,right)=>left.size===right.size&&[...left].every(item=>right.has(item))
const traceIdentity=(sourceType,sourceId)=>{
  const normalized=contextTraceEntry({sourceType,sourceId,producerId:'producer-validation',tenantId:'tenant-validation',reasonSelected:'VALIDATION',relevanceScore:1})
  return `${normalized.sourceType}|${normalized.sourceId}`
}

function validMemoryContextItem(item){
  return plainObject(item)&&text(item.key)&&Object.hasOwn(item,'value')&&memoryDomains.has(text(item.memory_domain).toUpperCase())&&epistemicTypes.has(text(item.epistemic_type).toUpperCase())&&evidenceTypes.has(text(item.evidence_type).toUpperCase())&&text(item.tenant_id)&&text(item.producer_id)&&Object.hasOwn(item,'owner_id')&&nullableText(item.owner_id)&&text(item.memory_ref)&&text(item.source_ref)&&text(item.source_type)&&Object.hasOwn(item,'confidence')&&validConfidence(item.confidence)&&['valid_from','valid_until','observed_at','source_updated_at'].every(key=>Object.hasOwn(item,key)&&nullableIso(item[key]))&&freshnessTypes.has(text(item.freshness).toUpperCase())&&plainObject(item.freshness_metadata)
}

function validBehavioralSignal(item){
  return plainObject(item)&&text(item.key)&&Object.hasOwn(item,'value')&&text(item.value)&&epistemicTypes.has(text(item.epistemic_state).toUpperCase())&&evidenceTypes.has(text(item.evidence_type).toUpperCase())&&text(item.tenant_id)&&text(item.producer_id)&&Object.hasOwn(item,'owner_id')&&nullableText(item.owner_id)&&text(item.source_ref)&&Object.hasOwn(item,'confidence')&&validConfidence(item.confidence)&&Array.isArray(item.evidence_refs)&&item.evidence_refs.every(validReference)&&isoValue(item.observed_at)&&Object.hasOwn(item,'valid_until')&&nullableIso(item.valid_until)&&item.freshness==='CURRENT'&&plainObject(item.freshness_metadata)
}

function validCollectionItem(item){
  return plainObject(item)&&validReference(item.evidence_ref)&&text(item.producerId)&&text(item.tenantId)&&Object.hasOwn(item,'ownerId')&&nullableText(item.ownerId)&&Object.hasOwn(item,'observed_at')&&nullableIso(item.observed_at)&&Object.hasOwn(item,'valid_until')&&nullableIso(item.valid_until)&&freshnessTypes.has(text(item.freshness).toUpperCase())&&plainObject(item.freshness_metadata)&&plainObject(item.data)
}

function validStaleItem(item){
  return plainObject(item)&&text(item.tenant_id)&&text(item.producer_id)&&Object.hasOwn(item,'owner_id')&&nullableText(item.owner_id)&&text(item.source_ref)&&text(item.source_type)&&freshnessTypes.has(text(item.freshness).toUpperCase())&&item.freshness!=='CURRENT'&&plainObject(item.freshness_metadata)&&Object.hasOwn(item,'observed_at')&&nullableIso(item.observed_at)&&Object.hasOwn(item,'valid_until')&&nullableIso(item.valid_until)
}

export function validateContextSnapshot(snapshot){
  const violations=[]
  const violate=code=>{if(!violations.includes(code))violations.push(code)}
  if(!plainObject(snapshot))return ['context_snapshot']
  const aliasCandidates=[snapshot,snapshot?.context_scope]
  try{for(const candidate of aliasCandidates)assertContextScopeAliases(candidate)}catch(error){if(error?.code==='CONTEXT_SCOPE_VIOLATION')violate('scope_alias_conflict');else throw error}
  if(snapshot.contract_version!==contextSnapshotVersion)violate('contract_version')
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(snapshot.context_snapshot_id)))violate('context_snapshot_id')
  if(!text(snapshot.organization_id))violate('organization_id')
  if(!plainObject(snapshot.subject)||!text(snapshot.subject.type)||!text(snapshot.subject.id))violate('subject')
  const scope=snapshot.context_scope
  const activeEntityScope=scope?.active_entity
  if(!plainObject(scope)||text(scope.producer_id)!==text(snapshot.subject?.id)||text(scope.tenant_id)!==text(snapshot.organization_id)||!Object.hasOwn(scope,'owner_id')||!nullableText(scope.owner_id)||!Object.hasOwn(scope,'active_entity')||activeEntityScope!==null&&(!plainObject(activeEntityScope)||!activeEntityTypes.has(text(activeEntityScope.type))||!text(activeEntityScope.id))||!Object.hasOwn(scope,'conversation_id')||!nullableText(scope.conversation_id)||!exactEpoch(scope.context_epoch)||!valContextDomains.includes(text(scope.domain).toUpperCase())||!Array.isArray(scope.requested_domains)||!scope.requested_domains.length||scope.requested_domains.some(item=>!valContextDomains.includes(text(item).toUpperCase())||item==='MULTI_DOMAIN')||scope.query_fingerprint!==null&&!/^[0-9a-f]{64}$/.test(text(scope.query_fingerprint))||scope.selector_version!==valContextSelectorVersion||scope.minimum_sufficient_context!==true)violate('context_scope')
  for(const key of ['facts','inferences','hypotheses','validated_knowledge','missing_information','conflicts','stale_information','behavioral_signals','evidence_refs'])if(!Array.isArray(snapshot[key]))violate(key)
  for(const key of ['commercial_context','agronomic_context','relationship_context','confidence','freshness','selection'])if(!plainObject(snapshot[key]))violate(key)

  const collectionGroups=[
    ['business_event',snapshot.commercial_context?.business_history],['opportunity',snapshot.commercial_context?.opportunities],
    ['property',snapshot.agronomic_context?.properties],['field_report',snapshot.agronomic_context?.field_reports],['soil_analysis',snapshot.agronomic_context?.soil_analyses],['ndvi_observation',snapshot.agronomic_context?.ndvi_observations],['manual_record',snapshot.agronomic_context?.manual_records],['attachment',snapshot.agronomic_context?.attachments],
    ['interaction',snapshot.relationship_context?.interactions],['visit',snapshot.relationship_context?.visits],['commitment',snapshot.relationship_context?.commitments],['commitment',snapshot.relationship_context?.overdue_commitments]
  ]
  if(collectionGroups.some(([,items])=>!Array.isArray(items)))violate('context_collections')
  const collectionItemsWithType=collectionGroups.flatMap(([sourceType,items])=>list(items).map(item=>({sourceType,item})))
  const memoryItems=[...list(snapshot.facts),...list(snapshot.inferences),...list(snapshot.hypotheses),...list(snapshot.validated_knowledge)]
  try{
    for(const item of [...memoryItems,...list(snapshot.behavioral_signals),...list(snapshot.stale_information),...list(snapshot.conflicts),...collectionItemsWithType.flatMap(entry=>[entry.item,entry.item?.data])])assertContextScopeAliases(boundaryScopeView(item))
  }catch(error){if(error?.code==='CONTEXT_SCOPE_VIOLATION')violate('scope_alias_conflict');else throw error}
  if(violations.includes('scope_alias_conflict'))return violations
  if(memoryItems.some(item=>!validMemoryContextItem(item)))violate('context_item_contract')
  if(list(snapshot.behavioral_signals).some(item=>!validBehavioralSignal(item)))violate('behavioral_signal_contract')
  if(collectionItemsWithType.some(({item})=>!validCollectionItem(item)))violate('collection_item_contract')
  if(list(snapshot.stale_information).some(item=>!validStaleItem(item)))violate('stale_item_contract')
  if(list(snapshot.evidence_refs).some(item=>!validReference(item)))violate('evidence_ref_contract')
  if(list(snapshot.missing_information).some(item=>!plainObject(item)||!text(item.code)||!text(item.description)||typeof item.critical!=='boolean'))violate('missing_information_contract')
  if(list(snapshot.conflicts).some(item=>!plainObject(item)||!text(item.tenant_id)||!text(item.producer_id)||!Object.hasOwn(item,'owner_id')||!Array.isArray(item.memory_refs)||!item.memory_refs.length||!Array.isArray(item.source_refs)||!text(item.status)))violate('conflict_contract')

  const expectedProducer=text(snapshot.subject?.id);const expectedTenant=text(snapshot.organization_id);const expectedOwner=text(scope?.owner_id)
  const scopedItems=[...memoryItems,...list(snapshot.behavioral_signals),...list(snapshot.stale_information),...list(snapshot.conflicts),...collectionItemsWithType.map(entry=>entry.item)]
  if(scopedItems.some(item=>producerIdOf(item)!==expectedProducer||tenantIdOf(item)!==expectedTenant||expectedOwner&&ownerIdOf(item)!==expectedOwner))violate('producer_scope')
  for(const {item} of collectionItemsWithType){
    try{assertNestedContextBoundary(item.data,{producerId:producerIdOf(item),tenantId:tenantIdOf(item),ownerId:ownerIdOf(item)},'snapshot.collection.data')}
    catch(error){
      if(error?.code!=='CONTEXT_SCOPE_VIOLATION')throw error
      if(String(error?.reason||'').endsWith('_ALIAS_CONFLICT'))violate('scope_alias_conflict')
      else violate('nested_payload_scope')
      break
    }
  }

  const validationQuery=scope?.query_fingerprint?domainQuery(scope?.requested_domains):''
  if(collectionItemsWithType.some(({sourceType,item})=>!collectionMatchesContextDomain(item?.data||{},sourceType,scope?.domain,validationQuery)))violate('domain_scope')
  const memoryDomainCompatible=item=>{
    const selectedDomain=text(scope?.domain).toUpperCase()
    if(!text(item.memory_domain))return false
    const record={memory_type:item.memory_domain,key:item.key,source_type:item.source_type,content:item.value}
    if(memoryMatchesContextDomain(record,selectedDomain,validationQuery))return true
    if(selectedDomain!=='AGRONOMY')return false
    const semantic=matchedValContextDomains(`${item.key||''} ${item.source_type||''} ${safeJson(item.value)}`)
    const structural=/\b(?:area|culture|cultura|property|propriedade|field|talhao)\b/i.test(String(item.key||'').replace(/[_./:-]+/g,' '))
    return !semantic.some(domain=>['CREDIT','COMMERCIAL','OPPORTUNITY'].includes(domain))&&(semantic.includes('AGRONOMY')||structural)
  }
  if(memoryItems.some(item=>!memoryDomainCompatible(item)))violate('domain_scope')
  if(scope?.domain==='PROFILE'&&list(snapshot.behavioral_signals).some(item=>!memoryMatchesContextDomain({memory_type:'BEHAVIORAL',key:item.key,source_type:'behavioral_profile',content:item.value},'PROFILE',validationQuery)))violate('domain_scope')

  const selection=snapshot.selection
  if(!plainObject(selection)||selection.policy_version!=='val.context.selection.v1'||selection.selector_version!==valContextSelectorVersion||selection.domain!==scope?.domain||!Array.isArray(selection.considered_refs)||!Array.isArray(selection.selected_refs)||!Array.isArray(selection.selection_reason_codes)||!Array.isArray(selection.excluded_refs)||!Array.isArray(selection.exclusion_reason_codes)||!Number.isInteger(selection.unauthorized_count)||selection.unauthorized_count<0||!Number.isInteger(selection.invalid_count)||selection.invalid_count<0||!Number.isInteger(selection.latency_ms)||selection.latency_ms<0)violate('selection_audit')
  const consideredSet=new Set(list(selection?.considered_refs).map(text).filter(Boolean));const selectedSet=new Set(list(selection?.selected_refs).map(text).filter(Boolean));const excludedSet=new Set(list(selection?.excluded_refs).map(text).filter(Boolean));const memoryRefSet=new Set(memoryItems.map(item=>text(item.memory_ref)).filter(Boolean))
  if(!sameSet(selectedSet,memoryRefSet)||[...selectedSet,...excludedSet].some(ref=>!consideredSet.has(ref))||[...selectedSet].some(ref=>excludedSet.has(ref)))violate('selection_membership')
  const reasonSelectedSet=new Set(list(selection?.selection_reason_codes).map(item=>text(item?.ref)).filter(Boolean));const reasonExcludedSet=new Set(list(selection?.exclusion_reason_codes).map(item=>text(item?.ref)).filter(Boolean))
  if(!sameSet(reasonSelectedSet,selectedSet)||!sameSet(reasonExcludedSet,excludedSet)||list(selection?.selection_reason_codes).some(item=>!plainObject(item)||!Array.isArray(item.reason_codes)||!item.reason_codes.length)||list(selection?.exclusion_reason_codes).some(item=>!plainObject(item)||!Array.isArray(item.reason_codes)||!item.reason_codes.length))violate('selection_reason_integrity')

  const trace=selection?.context_trace
  if(!plainObject(trace)||!Array.isArray(trace.selected)||!Array.isArray(trace.rejected)||trace.content_free!==true)violate('context_trace')
  const traceItems=[...list(trace?.selected),...list(trace?.rejected)]
  if(traceItems.some(item=>!plainObject(item)||!text(item.sourceType)||!text(item.sourceId)||!text(item.producerId)||!text(item.tenantId)||!Object.hasOwn(item,'ownerId')||!Object.hasOwn(item,'timestamp')||!nullableIso(item.timestamp)||!Object.hasOwn(item,'relevanceScore')||item.relevanceScore!==null&&!Number.isFinite(item.relevanceScore)||!Object.hasOwn(item,'reasonSelected')||!text(item.reasonSelected)||!['SELECTED','REJECTED'].includes(item.status)))violate('context_trace_item')
  if(list(trace?.selected).some(item=>item.status!=='SELECTED'||!Number.isFinite(item.relevanceScore)||item.sourceType==='unknown'||item.sourceId==='unknown')||list(trace?.rejected).some(item=>item.status!=='REJECTED'))violate('context_trace_status')
  if(traceItems.some(item=>/@/.test(text(item.sourceId))||/\b\d{3}[.-]?\d{3}[.-]?\d{3}-?\d{2}\b/.test(text(item.sourceId))))violate('context_trace_sensitive_identifier')
  const selectedTraceSet=new Set(list(trace?.selected).map(item=>`${text(item.sourceType).toLowerCase()}|${text(item.sourceId)}`))
  const requiredTraceSet=new Set([
    ...memoryItems.map(item=>traceIdentity(item.source_type,item.source_ref)),
    ...collectionItemsWithType.map(({item})=>traceIdentity(item.evidence_ref?.type,item.evidence_ref?.id)),
    ...list(snapshot.behavioral_signals).map(item=>traceIdentity('behavioral_profile',item.source_ref))
  ])
  if([...requiredTraceSet].some(key=>!selectedTraceSet.has(key))||[...selectedTraceSet].some(key=>!requiredTraceSet.has(key)))violate('context_trace_membership')
  if(list(snapshot.behavioral_signals).some(signal=>{
    const expected=traceIdentity('behavioral_profile',signal.source_ref)
    return !list(trace?.selected).some(item=>`${text(item.sourceType).toLowerCase()}|${text(item.sourceId)}`===expected&&isoValue(item.timestamp)&&item.timestamp===signal.observed_at)
  }))violate('behavioral_trace_timestamp')

  const evidenceIds=list(snapshot.evidence_refs).map(item=>text(item.id));const evidenceSet=new Set(evidenceIds)
  if(evidenceSet.size!==evidenceIds.length)violate('evidence_ref_unique')
  const requiredEvidence=new Set([
    ...memoryItems.flatMap(item=>[`val_memories:${item.memory_ref}`,item.source_ref]),
    ...collectionItemsWithType.map(({item})=>item.evidence_ref?.id),
    ...list(snapshot.behavioral_signals).flatMap(item=>[item.source_ref,...list(item.evidence_refs).map(ref=>ref?.id)])
  ].map(text).filter(Boolean))
  if([...requiredEvidence].some(id=>!evidenceSet.has(id)))violate('evidence_ref_membership')
  return violations
}

export function assertContextSnapshot(snapshot){
  const violations=validateContextSnapshot(snapshot)
  if(violations.includes('scope_alias_conflict'))throw Object.assign(new Error('ContextSnapshot contém aliases de escopo conflitantes.'),{name:'ContextScopeViolationError',code:'CONTEXT_SCOPE_VIOLATION',reason:'SCOPE_ALIAS_CONFLICT',violations})
  if(violations.length)throw Object.assign(new Error('ContextSnapshot v1 inválido.'),{name:'ContextSnapshotContractError',code:'context_snapshot_invalid',violations})
  return snapshot
}

function snapshotSize(value){return JSON.stringify(value).length}

export function scopeContextSnapshotForModel(snapshot){
  assertContextSnapshot(snapshot)
  const scoped=structuredClone(snapshot)
  const domain=scoped.context_scope.domain
  const query=scoped.context_scope.query_fingerprint?domainQuery(scoped.context_scope.requested_domains):''
  const policy=contextCollectionPolicy(domain,query)
  if(!policy.commercial)scoped.commercial_context={business_history:[],opportunities:[],summary:{}}
  if(!policy.agronomic)scoped.agronomic_context={properties:[],field_reports:[],soil_analyses:[],ndvi_observations:[],manual_records:[],attachments:[]}
  if(!policy.relationship)scoped.relationship_context={interactions:[],visits:[],commitments:[],overdue_commitments:[],reported_profile:{}}
  if(!policy.behavioral)scoped.behavioral_signals=[]
  if(domain==='PROFILE'){
    let evidenceBudget=4
    const takeBudget=items=>{const taken=list(items).slice(0,evidenceBudget);evidenceBudget-=taken.length;return taken}
    scoped.behavioral_signals=takeBudget(scoped.behavioral_signals)
    scoped.validated_knowledge=takeBudget(scoped.validated_knowledge)
    scoped.facts=takeBudget(scoped.facts)
    scoped.inferences=takeBudget(scoped.inferences)
    scoped.hypotheses=takeBudget(scoped.hypotheses)
  }
  const memoryGroups=['facts','inferences','hypotheses','validated_knowledge']
  const droppedMemories=[]
  for(const key of memoryGroups){
    const original=list(scoped[key])
    scoped[key]=original.filter(item=>item?.freshness==='CURRENT')
    droppedMemories.push(...original.filter(item=>item?.freshness!=='CURRENT'))
  }
  const collectionPaths=[
    ['commercial_context','business_history'],['commercial_context','opportunities'],
    ['agronomic_context','properties'],['agronomic_context','field_reports'],['agronomic_context','soil_analyses'],['agronomic_context','ndvi_observations'],['agronomic_context','manual_records'],['agronomic_context','attachments'],
    ['relationship_context','interactions'],['relationship_context','visits'],['relationship_context','commitments'],['relationship_context','overdue_commitments']
  ]
  for(const [group,key] of collectionPaths)if(Array.isArray(scoped[group]?.[key]))scoped[group][key]=scoped[group][key].filter(item=>item?.freshness==='CURRENT')
  // Stale/UNKNOWN permanece no snapshot auditavel persistido, mas nunca no
  // envelope elegivel ao modelo.
  scoped.stale_information=[]
  const retainedMemoryRefs=new Set(memoryGroups.flatMap(key=>list(scoped[key]).map(item=>text(item.memory_ref))).filter(Boolean))
  const droppedMemoryRefs=new Set(droppedMemories.map(item=>text(item.memory_ref)).filter(Boolean))
  scoped.selection.selected_refs=scoped.selection.selected_refs.filter(ref=>retainedMemoryRefs.has(text(ref)))
  scoped.selection.selection_reason_codes=scoped.selection.selection_reason_codes.filter(item=>retainedMemoryRefs.has(text(item?.ref)))
  scoped.selection.excluded_refs=[...new Set([...scoped.selection.excluded_refs,...droppedMemoryRefs])]
  const exclusionByRef=new Map(scoped.selection.exclusion_reason_codes.map(item=>[text(item?.ref),new Set(list(item?.reason_codes).map(text).filter(Boolean))]))
  for(const ref of droppedMemoryRefs){const reasons=exclusionByRef.get(ref)||new Set();reasons.add('MODEL_FRESHNESS_INELIGIBLE');exclusionByRef.set(ref,reasons)}
  scoped.selection.exclusion_reason_codes=[...exclusionByRef].map(([ref,reasons])=>({ref,reason_codes:[...reasons].sort()}))
  const retainedCollections=collectionPaths.flatMap(([group,key])=>list(scoped[group]?.[key]))
  const retainedTraceKeys=new Set([
    ...memoryGroups.flatMap(key=>list(scoped[key]).map(item=>traceIdentity(item.source_type,item.source_ref))),
    ...retainedCollections.map(item=>traceIdentity(item.evidence_ref?.type,item.evidence_ref?.id)),
    ...list(scoped.behavioral_signals).map(item=>traceIdentity('behavioral_profile',item.source_ref))
  ])
  scoped.selection.context_trace.selected=scoped.selection.context_trace.selected.filter(item=>retainedTraceKeys.has(`${text(item.sourceType).toLowerCase()}|${text(item.sourceId)}`))
  scoped.conflicts=scoped.conflicts.filter(item=>list(item.memory_refs).every(ref=>retainedMemoryRefs.has(text(ref))))
  const retained=[...scoped.facts,...scoped.inferences,...scoped.hypotheses,...scoped.validated_knowledge,...scoped.behavioral_signals]
  const retainedRefs=new Set(retained.flatMap(item=>[item?.source_ref,item?.memory_ref,item?.memory_ref?`val_memories:${item.memory_ref}`:null,...list(item?.evidence_refs).map(ref=>ref?.id)]).map(text).filter(Boolean))
  for(const [,items] of [
    ['business_event',scoped.commercial_context.business_history],['opportunity',scoped.commercial_context.opportunities],['property',scoped.agronomic_context.properties],['field_report',scoped.agronomic_context.field_reports],['soil_analysis',scoped.agronomic_context.soil_analyses],['ndvi_observation',scoped.agronomic_context.ndvi_observations],['manual_record',scoped.agronomic_context.manual_records],['attachment',scoped.agronomic_context.attachments],['interaction',scoped.relationship_context.interactions],['visit',scoped.relationship_context.visits],['commitment',scoped.relationship_context.commitments]
  ])for(const item of list(items))retainedRefs.add(text(item?.evidence_ref?.id))
  scoped.evidence_refs=scoped.evidence_refs.filter(item=>retainedRefs.has(text(item?.id))).slice(0,40)
  if(!retained.length&&!retainedCollections.length)scoped.confidence={level:'INSUFICIENTE',factors:[...new Set([...list(scoped.confidence?.factors),'model_freshness_gate'])]}
  return assertContextSnapshot(scoped)
}

export function contextSnapshotForModel(snapshot,maxChars=18_000){
  snapshot=scopeContextSnapshotForModel(snapshot)
  const compact={
    contract_version:snapshot.contract_version,
    context_snapshot_id:snapshot.context_snapshot_id,
    objective:snapshot.objective,
    context_scope:{...snapshot.context_scope},
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
    ['commercial_context','business_history'],['commercial_context','opportunities'],['relationship_context','interactions'],['relationship_context','visits'],['relationship_context','commitments'],['relationship_context','overdue_commitments'],
    ['agronomic_context','attachments'],['agronomic_context','manual_records'],['agronomic_context','ndvi_observations'],['agronomic_context','field_reports'],['agronomic_context','soil_analyses'],['agronomic_context','properties'],
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
