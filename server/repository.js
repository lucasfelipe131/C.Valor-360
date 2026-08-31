import {createHash,randomUUID} from 'node:crypto'
import {hasTechnicalApproval} from './ingestion.js'
import {assertTenantScope} from './tenant-scope.js'
import {observe} from './observability.js'
import {buildContextSnapshot,contextSnapshotVersion} from './memory/context-snapshot.js'
import {assertExecutionContract,validateActionPlan} from './execution/contracts.js'
import {buildCommitmentCandidate,transitionCommitment} from './execution/commitment.js'
import {legacyVisitLifecycle,transitionVisitLifecycle} from './visit-loop/lifecycle.js'
import {additionalNeedState,hasIndependentOpportunity,isQ27Opportunity,normalizeText,opportunityFromAdditionalNeed,q27OpportunityProvenance} from '../src/lib/profile.js'
import {encodeCanonicalGeometryRef,manualToCanonicalValGeometry} from '../src/lib/agronomic-geometry-adapter.js'
import {buildAgronomicScanProvenance} from './agronomic-scan-provenance.js'
import {resolveAuthorizedClientReference as reconcileAuthorizedClientReference} from './decision-copilot/client-reference-resolver.js'
import {createProducerEntityIndexCache} from './decision-copilot/producer-entity-index-cache.js'
import {selectScopedPriorRecommendations} from './conversation-thread-context.js'

export function jsonbParameter(value){
  if(value===undefined)return null
  const serialized=JSON.stringify(value)
  if(serialized===undefined)throw new TypeError('O valor informado não pode ser serializado como JSON.')
  return serialized
}

const ephemeralConversationKeys=new Set(['conversationState','conversation_state','conversation_turns','session_facts','session_hypotheses'])
const persistenceClone=value=>{
  if(Array.isArray(value))return value.map(persistenceClone)
  if(!value||typeof value!=='object')return value
  const output={}
  for(const [key,item] of Object.entries(value)){
    if(ephemeralConversationKeys.has(key))continue
    if(key==='session_context'){
      const session=jsonObject(item)
      output[key]={
        ...(session.conversation_id?{conversation_id:String(session.conversation_id).slice(0,180)}:{}),
        persistence_mode:'NONE',
        ...(session.confirmed_memory_unchanged===true?{confirmed_memory_unchanged:true}:{})
      }
      continue
    }
    if(key==='conversationThread'){
      const thread=jsonObject(item)
      const anchor=jsonObject(thread.anchor)
      output[key]={
        continued:thread.continued===true,
        ...(anchor.id?{anchor:{id:String(anchor.id).slice(0,180)}}:{})
      }
      continue
    }
    if(key==='conversionIntelligence'){
      const intelligence=persistenceClone(item)
      const request=jsonObject(intelligence.request)
      intelligence.request={
        ...(request.intent?{intent:String(request.intent).slice(0,120)}:{}),
        ...(typeof request.technicalIntent==='boolean'?{technicalIntent:request.technicalIntent}:{})
      }
      output[key]=intelligence
      continue
    }
    if(key==='conversationOrchestration'){
      const orchestration=jsonObject(item)
      const continuity=jsonObject(orchestration.continuity)
      output[key]={
        ...(orchestration.version?{version:String(orchestration.version).slice(0,120)}:{}),
        ...(orchestration.generatedAt?{generatedAt:String(orchestration.generatedAt).slice(0,60)}:{}),
        ...(orchestration.producerId?{producerId:String(orchestration.producerId).slice(0,180)}:{}),
        continuity:{
          carryForward:continuity.carryForward===true,
          turnCount:Number.isFinite(Number(continuity.turnCount))?Math.max(0,Math.trunc(Number(continuity.turnCount))):0,
          ...(continuity.threadFingerprint?{threadFingerprint:String(continuity.threadFingerprint).slice(0,180)}:{})
        },
        route:persistenceClone(orchestration.route||{}),
        authority:persistenceClone(orchestration.authority||{})
      }
      continue
    }
    output[key]=persistenceClone(item)
  }
  return output
}

/**
 * Persistence boundary for recommendations. ConversationState is an in-memory
 * orchestration overlay: it may shape the answer returned to the browser, but
 * its turns, session facts and hypotheses must never enter durable records.
 */
export function recommendationPersistencePayload(record={}){
  return Object.freeze({
    context:persistenceClone(record.context||{}),
    advice:persistenceClone(record.advice||{})
  })
}
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const valorExternalKey=value=>normalize(value).replace(/\s+/g,'-').slice(0,180)
const relatedExternalKey=(clientKey,value)=>{const suffix=valorExternalKey(value);return suffix?`${String(clientKey||'').slice(0,180)}:${suffix}`.slice(0,180):null}
const shortExternalKeyHash=value=>createHash('sha256').update(String(value||'')).digest('hex').slice(0,20)
const propertyScopedFieldExternalKey=(propertyKey,value)=>{const property=String(propertyKey||'').trim();const suffix=valorExternalKey(value);return property&&suffix?`manual-field:${shortExternalKeyHash(property)}:${shortExternalKeyHash(suffix)}:${suffix}`.slice(0,180):null}
const parseMoney=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null
  let raw=String(value||'').replace(/R\$|\s/g,'')
  if(!raw)return null
  if(raw.includes(',')&&raw.includes('.'))raw=raw.lastIndexOf(',')>raw.lastIndexOf('.')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'')
  else if(raw.includes(','))raw=raw.replace(',','.')
  else if(/^-?\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'')
  const normalized=raw.replace(/[^0-9.-]/g,'');if(!normalized||!/\d/.test(normalized))return null
  const number=Number(normalized);return Number.isFinite(number)?number:null
}
export const parseCultivatedArea=value=>{
  const raw=String(value??'').trim()
  if(!raw)return {totalAreaHa:null,areaBand:null}
  if(/\b(?:acima|abaixo|até|ate|entre)\b/i.test(raw)||/\bde\s+\d[\d.,]*\s+a\s+\d/i.test(raw))return {totalAreaHa:null,areaBand:raw.slice(0,120)}
  const numeric=raw.match(/-?\d[\d.,]*/)?.[0]||raw
  return {totalAreaHa:parseMoney(numeric),areaBand:null}
}
const parsedDate=value=>{
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString()
  if(typeof value==='number'&&value>20_000)return new Date(Math.round((value-25_569)*86_400_000)).toISOString()
  const raw=String(value||'').trim();const br=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  const date=br?new Date(Date.UTC(Number(br[3].length===2?`20${br[3]}`:br[3]),Number(br[2])-1,Number(br[1]))):new Date(raw)
  if(!Number.isNaN(date.getTime()))return date.toISOString()
  return null
}
const parseDate=(value,fallback)=>parsedDate(value)||parsedDate(fallback)
const outcome=value=>/perd|cancel|recus|desist/i.test(String(value||''))?'lost':/ganh|fech|conclu|fatur|vend|aprov/i.test(String(value||''))?'won':/abert|andament|negocia|propost|pendente|\bopen\b/i.test(String(value||''))?'open':null
const serviceError=message=>Object.assign(new Error(message),{statusCode:503})
const domainError=(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,...(code?{code}:{})})
const persistenceCancellationError=signal=>signal?.reason instanceof Error
  ?signal.reason
  :Object.assign(new Error('A persistência foi cancelada antes do commit.'),{name:'AbortError',statusCode:499,code:'val_persistence_cancelled',safeToRetry:true})
const throwIfPersistenceCancelled=signal=>{if(signal?.aborted)throw persistenceCancellationError(signal)}
const databaseTimeoutArgs=value=>{const timeoutMs=Number(value);return Number.isFinite(timeoutMs)&&timeoutMs>0?[{timeoutMs}]:[]}
const iso=value=>value instanceof Date?value.toISOString():value
const jsonObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const relationshipFields=['preferredName','birthday','family','spouse','children','favoriteTeam','likesFishing','fishingStyle','hobbies','leisure','favoriteFoods','favoriteDrinks','events','communicationNotes','personalValues','negotiationPreferences','importantDates','personalNotes']
const commercialFields=['phone','email','property','purchaseCurrentSeason','purchasePreviousSeason','potentialTotal','openPotential','walletShare','targetShare','creditLimit','creditUsed','grossMarginPercent','paymentTerms','decisionWindow','commercialRisk','mainCategories','competitors','commercialNotes']
const commercialNumbers=new Set(['purchaseCurrentSeason','purchasePreviousSeason','potentialTotal','openPotential','walletShare','targetShare','creditLimit','creditUsed','grossMarginPercent'])
const commercialPercentages=new Set(['walletShare','targetShare','grossMarginPercent'])
const limitedText=(value,max=2000)=>String(value??'').trim().slice(0,max)
const sanitizeRelationship=value=>Object.fromEntries(relationshipFields.filter(key=>Object.prototype.hasOwnProperty.call(value||{},key)).map(key=>[key,key==='likesFishing'?Boolean(value?.[key]):limitedText(value?.[key],key==='personalNotes'?10_000:2000)]))
const sanitizeSurveyRelationship=value=>Object.fromEntries(Object.entries(sanitizeRelationship(value)).filter(([key,item])=>key==='likesFishing'||item!==''))
const sanitizeCommercial=value=>Object.fromEntries(commercialFields.filter(key=>Object.prototype.hasOwnProperty.call(value||{},key)).map(key=>{
  const parsed=commercialNumbers.has(key)?parseMoney(value?.[key]):limitedText(value?.[key],['commercialNotes','commercialRisk'].includes(key)?10_000:2000)
  return [key,commercialPercentages.has(key)&&parsed!==null?Math.max(0,Math.min(100,parsed)):parsed]
}))
const derivedCommercial=value=>{
  const commercial={...jsonObject(value)}
  const purchases=parseMoney(commercial.purchaseCurrentSeason)
  const potential=parseMoney(commercial.potentialTotal)
  const previous=parseMoney(commercial.purchasePreviousSeason)
  const creditLimit=parseMoney(commercial.creditLimit)
  const creditUsed=parseMoney(commercial.creditUsed)
  if(potential!==null&&purchases!==null){
    commercial.openPotential=Math.max(0,potential-purchases)
    commercial.realizedShare=potential>0?Math.min(100,Math.max(0,purchases/potential*100)):0
  }
  if(previous!==null&&previous>0&&purchases!==null)commercial.purchaseGrowthPercent=(purchases-previous)/previous*100
  if(creditLimit!==null&&creditUsed!==null)commercial.creditAvailable=Math.max(0,creditLimit-creditUsed)
  return commercial
}
const snapshotFor=(result,source)=>({...jsonObject(result),profileVersion:String(result?.profileVersion||'producer-360-v1'),profileSource:source})
const profileSourceKey=(source,externalKey,answers)=>`${source}:${externalKey}:${createHash('sha256').update(JSON.stringify(answers||{})).digest('hex')}`.slice(0,240)
const resolveSurveyExternalKey=async(connection,tenantId,ownerId,candidateKey,name)=>{
  const existing=await connection.query(`SELECT external_key FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND status='active' AND (external_key=$3 OR LOWER(BTRIM(name))=LOWER(BTRIM($4))) ORDER BY CASE WHEN external_key=$3 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`,[tenantId,ownerId,candidateKey,String(name||'').slice(0,180)])
  return String(existing.rows[0]?.external_key||candidateKey).slice(0,180)
}
const sanitizeProfileResult=value=>{
  const result=jsonObject(value);if(!Object.keys(result).length)return value
  const commercial={...jsonObject(result.commercial)}
  if('opportunity' in commercial)commercial.opportunity=opportunityFromAdditionalNeed(commercial.opportunity)
  const hasAdditionalNeed='additionalNeed' in result
  const additionalNeed=result.additionalNeed==null?null:String(result.additionalNeed).trim()||null
  const needState=additionalNeedState(additionalNeed)
  if(hasAdditionalNeed){commercial.opportunity=opportunityFromAdditionalNeed(additionalNeed);commercial.opportunityProvenance=q27OpportunityProvenance(needState)}
  return {...result,...(hasAdditionalNeed?{additionalNeed,additionalNeedStatus:needState}:{}),...(hasAdditionalNeed||'commercial' in result?{commercial}:{})}
}
const canonicalSurveyCommercial=(result,currentValue,previousValue)=>{
  const incoming={...jsonObject(result?.commercial)}
  if(isQ27Opportunity(incoming)){delete incoming.opportunity;delete incoming.opportunityProvenance}
  const current={...jsonObject(currentValue)}
  const previous=jsonObject(sanitizeProfileResult(previousValue))
  const currentRaw=String(current.opportunity??'').trim();const previousNeed=String(previous.additionalNeed??'').trim()
  const legacyQ27=Boolean(currentRaw&&previousNeed&&!hasIndependentOpportunity(current)&&normalizeText(currentRaw)===normalizeText(previousNeed))
  if(isQ27Opportunity(current)||legacyQ27){delete current.opportunity;delete current.opportunityProvenance}
  const merged={...incoming,...current}
  for(const key of ['phone','email'])if(limitedText(incoming[key]))merged[key]=limitedText(incoming[key])
  return derivedCommercial(merged)
}
const surveyCommercialForWrite=async(connection,tenantId,ownerId,externalKey,result)=>{
  await connection.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text||':'||$3::text,0))`,[tenantId,ownerId,externalKey])
  const existing=await connection.query(`SELECT c.commercial_profile,(SELECT p.profile_snapshot FROM client_profiles p WHERE p.tenant_id=c.tenant_id AND p.client_id=c.id ORDER BY p.assessed_at DESC LIMIT 1) profile_snapshot FROM clients c WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.external_key=$3 LIMIT 1 FOR UPDATE`,[tenantId,ownerId,externalKey])
  return canonicalSurveyCommercial(result,existing.rows[0]?.commercial_profile,existing.rows[0]?.profile_snapshot)
}
const clientFromRow=(row,{defaults=false}={})=>{
  const snapshot=jsonObject(sanitizeProfileResult(row.profile_snapshot))
  const rowCommercial=jsonObject(row.commercial_profile)
  const commercial=derivedCommercial({...jsonObject(snapshot.commercial),...rowCommercial})
  if(row.purchase_total!==undefined)commercial.purchaseTotal=Number(row.purchase_total||0)
  if(row.purchase_count!==undefined)commercial.purchaseCount=Number(row.purchase_count||0)
  if(row.last_purchase_at)commercial.lastPurchaseAt=iso(row.last_purchase_at)
  if(row.open_pipeline!==undefined)commercial.openPipeline=Number(row.open_pipeline||0)
  if(rowCommercial.opportunity&&!rowCommercial.opportunityProvenance&&hasIndependentOpportunity(rowCommercial))commercial.opportunityProvenance={origin:'legacy_commercial',field:'opportunity',state:'reported'}
  if('opportunity' in commercial)commercial.opportunity=opportunityFromAdditionalNeed(commercial.opportunity)
  return {...snapshot,
    id:row.external_key||row.id,
    name:row.name||snapshot.name,
    municipality:row.municipality||snapshot.municipality||(defaults?'A definir':null),
    area:row.area_band||(row.total_area_ha==null?(snapshot.area??(defaults?'A definir':null)):Number(row.total_area_ha)),
    cultures:row.cultures||snapshot.cultures||(defaults?'A definir':null),
    primaryProfile:row.primary_profile||snapshot.primaryProfile||(defaults?'A classificar':null),
    secondaryProfile:row.secondary_profile||snapshot.secondaryProfile||(defaults?'Aguardando observação':null),
    irt:row.irt_score==null?(snapshot.irt??0):Number(row.irt_score),
    nps:row.nps_score==null?(snapshot.nps??0):Number(row.nps_score),
    servicePreference:row.preferred_channel||snapshot.servicePreference,
    additionalNeed:snapshot.additionalNeed??null,
    additionalNeedStatus:additionalNeedState(snapshot.additionalNeed),
    commercial,
    relationship:{...jsonObject(snapshot.relationship),...jsonObject(row.relationship_profile)},
    profileVersion:snapshot.profileVersion||null,
    profileSource:snapshot.profileSource||snapshot.source||null,
    profileUpdatedAt:iso(row.profile_assessed_at)||snapshot.profileUpdatedAt||null,
    profileValidUntil:iso(row.profile_valid_until)||null,
    source:'Banco VALOR 360'
  }
}
const surveyRecord=row=>({token:row.token,producerName:row.producer_name,consultantName:row.consultant_name,status:row.status,answers:row.answers||undefined,result:sanitizeProfileResult(row.result)||undefined,createdAt:iso(row.created_at),expiresAt:iso(row.expires_at),submittedAt:iso(row.submitted_at),integratedAt:iso(row.integrated_at)})
const fallbackSurveyRecord=survey=>({token:survey.token,producerName:survey.producerName,consultantName:survey.consultantName,status:survey.status,answers:survey.answers||undefined,result:sanitizeProfileResult(survey.result)||undefined,createdAt:survey.createdAt,expiresAt:survey.expiresAt,submittedAt:survey.submittedAt,integratedAt:survey.integratedAt})
const visitRecord=row=>({id:row.id,clientId:row.client_external_key||row.client_id,scheduledAt:iso(row.scheduled_at),objective:row.objective||'',processAgreement:row.process_agreement||'',summary:row.summary||'',nextCommitment:row.next_commitment||'',nextActionAt:iso(row.next_action_at),status:row.status||'Agendada',lifecycleStatus:row.lifecycle_status||row.lifecycleStatus||null,lifecycleVersion:row.lifecycle_version||row.lifecycleVersion||null,lifecycleRevision:row.lifecycle_revision??row.lifecycleRevision??null,occurredAt:iso(row.occurred_at??row.occurredAt),completedAt:iso(row.completed_at??row.completedAt),cancelledAt:iso(row.cancelled_at??row.cancelledAt),lifecycleUpdatedAt:iso(row.lifecycle_updated_at??row.lifecycleUpdatedAt),lifecycleUpdatedBy:row.lifecycle_updated_by??row.lifecycleUpdatedBy??null,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)})
const scopedTenant=value=>value?.tenantId??value?.tenant_id
const scopedOwner=value=>value?.ownerId??value?.consultantId??value?.consultant_id
const exactScope=(value,tenantId,ownerId,parent={})=>{
  const itemTenant=scopedTenant(value)??scopedTenant(parent)
  const itemOwner=scopedOwner(value)??scopedOwner(parent)
  return itemTenant!==undefined&&itemTenant!==null&&itemOwner!==undefined&&itemOwner!==null&&String(itemTenant)===String(tenantId)&&String(itemOwner)===String(ownerId)
}
const fallbackTechnicalContextKey=(tenantId,ownerId,clientId)=>JSON.stringify([String(tenantId||''),String(ownerId||''),String(clientId||'')])
const fallbackTechnicalContext=(contexts,tenantId,ownerId,clientId)=>{
  const scoped=contexts?.[fallbackTechnicalContextKey(tenantId,ownerId,clientId)]
  if(exactScope(scoped,tenantId,ownerId))return scoped
  const legacy=contexts?.[clientId]
  return exactScope(legacy,tenantId,ownerId)?legacy:null
}
const timestamp=value=>{const parsed=new Date(value||'').getTime();return Number.isFinite(parsed)?parsed:null}
const compareLatestPurchase=(left,right)=>{
  const leftOccurred=timestamp(left?.occurredAt??left?.occurred_at)
  const rightOccurred=timestamp(right?.occurredAt??right?.occurred_at)
  if(leftOccurred!==rightOccurred){
    if(leftOccurred===null)return 1
    if(rightOccurred===null)return -1
    return rightOccurred-leftOccurred
  }
  const leftCreated=timestamp(left?.createdAt??left?.created_at)
  const rightCreated=timestamp(right?.createdAt??right?.created_at)
  if(leftCreated!==rightCreated){
    if(leftCreated===null)return 1
    if(rightCreated===null)return -1
    return rightCreated-leftCreated
  }
  const leftId=String(left?.id??left?.externalId??left?.external_id??'')
  const rightId=String(right?.id??right?.externalId??right?.external_id??'')
  return leftId===rightId?0:leftId<rightId?1:-1
}
const completedVisitTimestamp=visit=>{
  if(legacyVisitLifecycle(visit)!=='COMPLETED')return null
  return timestamp(visit?.occurredAt??visit?.occurred_at)??timestamp(visit?.completedAt??visit?.completed_at)??timestamp(visit?.scheduledAt??visit?.scheduled_at)
}
const scheduledVisitTimestamp=(visit,now)=>{
  if(!['PLANNED','PREPARED'].includes(legacyVisitLifecycle(visit)))return null
  const scheduled=timestamp(visit?.scheduledAt??visit?.scheduled_at)
  return scheduled!==null&&scheduled>=now.getTime()?scheduled:null
}
const attachmentRecord=row=>({id:String(row.id),organizationId:String(row.tenant_id||row.tenantId||''),contextOwnerId:String(row.consultant_id||row.consultantId||row.context_owner_id||row.contextOwnerId||row.ownerId||''),clientId:row.client_external_key||row.clientId||row.client_id||null,association:row.client_external_key||row.clientId||row.client_id?'LINKED_CLIENT':'UNLINKED',originalName:row.original_name,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes||0),sha256:row.sha256,status:row.status,analysis:jsonObject(row.analysis),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),confirmedAt:iso(row.confirmed_at),...(row.content_base64?{dataBase64:row.content_base64}:{})})
const attachmentMetadataRecord=row=>{const {dataBase64,...metadata}=attachmentRecord(row);return metadata}
const attachmentInTenant=(row,tenantId)=>String(row?.tenantId||row?.tenant_id||'')===String(tenantId||'')
const opportunityRecord=row=>({id:`o-${row.client_external_key||row.client_id}`,databaseId:row.id,clientId:row.client_external_key||row.client_id,title:row.title,value:row.estimated_value==null?0:Number(row.estimated_value),probability:row.probability==null?null:Number(row.probability),stage:row.stage||'Diagnóstico',candidateKey:row.evidence?.find?.(item=>item?.candidateKey)?.candidateKey||row.external_key||'',stageEvidence:row.evidence?.find?.(item=>item?.type==='manual_advance'||item?.type==='manual_set'||item?.type==='won'),nextAction:row.next_action||'',nextActionAt:iso(row.next_action_at),updatedAt:iso(row.updated_at)})
const actionPlanRecord=row=>({
  contract_version:row.contract_version,version:row.contract_version,action_plan_id:String(row.id),organization_id:String(row.tenant_id),
  subject_id:String(row.client_external_key||row.client_id),decision_thesis_id:row.decision_thesis_id,value_plan_id:row.value_plan_id,
  context_snapshot_id:String(row.context_snapshot_id),priorities:Array.isArray(row.priorities)?row.priorities:[],created_at:iso(row.created_at),updated_at:iso(row.updated_at),
  status:row.status,visit_id:row.visit_id?String(row.visit_id):null,owner_user_id:row.owner_user_id?String(row.owner_user_id):null,
  decision_thesis_version:row.decision_thesis_version,value_plan_version:row.value_plan_version,
  preparation:row.preparation_payload&&typeof row.preparation_payload==='object'?row.preparation_payload:null
})
const commitmentRecord=row=>({
  contract_version:'val.commitment.v1',version:'val.commitment.v1',commitment_id:String(row.id),organization_id:String(row.tenant_id),
  client_id:String(row.client_external_key||row.client_id),visit_id:row.visit_id?String(row.visit_id):null,opportunity_id:row.opportunity_id?String(row.opportunity_id):null,
  action_plan_id:row.action_plan_id?String(row.action_plan_id):null,action_id:row.action_id||null,description:row.description,owner_type:row.owner_type,owner_id:row.owner_id,
  due_at:iso(row.due_at),status:row.status,success_criteria:row.success_criteria,agreed_with_client:Boolean(row.agreed_with_client),
  evidence_refs:Array.isArray(row.evidence_refs)?row.evidence_refs:[],source_ref:row.source_ref,audit:jsonObject(row.audit),
  created_at:iso(row.created_at),updated_at:iso(row.updated_at),completed_at:iso(row.completed_at),cancelled_at:iso(row.cancelled_at)
})
const transcriptRecord=row=>({contract_version:row.contract_version,version:row.contract_version,transcript_id:String(row.id),organization_id:String(row.tenant_id),visit_id:String(row.visit_id),client_id:String(row.client_external_key||row.client_id),created_by:String(row.created_by),interaction_id:row.interaction_id?String(row.interaction_id):null,source_attachment_id:row.source_attachment_id?String(row.source_attachment_id):null,provider:row.provider,provider_reference:row.provider_reference||null,language:row.language||null,status:row.status,transcript_text:row.transcript_text||null,error_code:row.error_code||null,metadata:jsonObject(row.metadata),created_at:iso(row.created_at),updated_at:iso(row.updated_at),completed_at:iso(row.completed_at)})
const voiceTranscriptRecord=row=>({
  contract_version:'val.voice_transcript.v1',version:'val.voice_transcript.v1',transcript_id:String(row.id),
  organization_id:String(row.tenant_id),voice_interaction_id:String(row.voice_interaction_id),
  client_id:String(row.client_external_key||row.client_id),visit_id:row.visit_id?String(row.visit_id):null,
  created_by:String(row.created_by),provider:row.provider,model:row.model,provider_version:row.provider_version||null,
  provider_reference:row.provider_reference||null,status:row.status,transcript_text:row.transcript_text||null,
  language:row.language||null,duration_seconds:row.duration_seconds==null?null:Number(row.duration_seconds),
  confidence:row.confidence==null?null:Number(row.confidence),attempt_no:Number(row.attempt_no||1),
  error_code:row.error_code||null,metadata:jsonObject(row.metadata),created_at:iso(row.created_at),
  updated_at:iso(row.updated_at),completed_at:iso(row.completed_at)
})
const voiceInteractionRecord=row=>({
  contract_version:row.contract_version||'val.voice_interaction.v1',version:row.contract_version||'val.voice_interaction.v1',
  voice_interaction_id:String(row.id),organization_id:String(row.tenant_id),actor_id:String(row.actor_id),
  client_id:String(row.client_external_key||row.client_id),visit_id:row.visit_id?String(row.visit_id):null,
  interaction_type:row.interaction_type,audio_ref:row.audio_ref||null,transcript_ref:row.transcript_ref||null,
  transcript_status:row.transcript_status,duration_seconds:row.duration_seconds==null?null:Number(row.duration_seconds),
  language:row.language||null,state:row.status,status:row.status,confirmation_status:row.confirmation_status,
  source_context:jsonObject(row.source_context),candidates:Array.isArray(row.initial_candidates)?row.initial_candidates:[],
  reviewed_candidates:Array.isArray(row.reviewed_candidates)?row.reviewed_candidates:[],
  transcription:jsonObject(row.transcription_metadata),extraction:jsonObject(row.extraction_metadata),
  related_artifacts:jsonObject(row.related_artifacts),retry_count:Number(row.retry_count||0),
  revision:Number(row.revision_no||1),revision_no:Number(row.revision_no||1),error_code:row.error_code||null,error_message:row.error_message||null,
  created_at:iso(row.created_at),updated_at:iso(row.updated_at),processed_at:iso(row.processed_at),
  confirmed_at:iso(row.confirmed_at),cancelled_at:iso(row.cancelled_at),
  ...(row.transcript_text!==undefined?{transcript:row.latest_transcript_id?voiceTranscriptRecord({
    id:row.latest_transcript_id,tenant_id:row.tenant_id,voice_interaction_id:row.id,client_id:row.client_id,
    client_external_key:row.client_external_key,visit_id:row.visit_id,created_by:row.transcript_created_by||row.actor_id,
    provider:row.transcript_provider,model:row.transcript_model,provider_version:row.transcript_provider_version,
    provider_reference:row.transcript_provider_reference,status:row.transcript_status_row||row.transcript_status,
    transcript_text:row.transcript_text,language:row.transcript_language,duration_seconds:row.transcript_duration_seconds,
    confidence:row.transcript_confidence,attempt_no:row.transcript_attempt_no,error_code:row.transcript_error_code,
    metadata:row.transcript_metadata,created_at:row.transcript_created_at,updated_at:row.transcript_updated_at,
    completed_at:row.transcript_completed_at
  }):null}:{}),
})
const visitReportRecord=row=>({contract_version:row.contract_version,version:row.contract_version,visit_report_id:String(row.id),visit_id:String(row.visit_id),organization_id:String(row.tenant_id),client_id:String(row.client_external_key||row.client_id),created_by:String(row.created_by),confirmed_by:row.confirmed_by?String(row.confirmed_by):null,source_type:row.source_type,source_ref:row.source_ref,transcript_ref:row.transcript_ref||null,transcript_id:row.transcript_id?String(row.transcript_id):null,visit_objective:row.visit_objective,summary:row.summary,discussed_topics:Array.isArray(row.discussed_topics)?row.discussed_topics:[],expectations_created:Array.isArray(row.expectations_created)?row.expectations_created:[],objections:Array.isArray(row.objections)?row.objections:[],producer_signals:Array.isArray(row.producer_signals)?row.producer_signals:[],opportunities_detected:Array.isArray(row.opportunities_detected)?row.opportunities_detected:[],commitments_proposed:Array.isArray(row.commitments_proposed)?row.commitments_proposed:[],commitments_confirmed:Array.isArray(row.commitments_confirmed)?row.commitments_confirmed:[],closed_business:Array.isArray(row.closed_business)?row.closed_business:[],pending_business:Array.isArray(row.pending_business)?row.pending_business:[],next_steps:Array.isArray(row.next_steps)?row.next_steps:[],technical_observations:Array.isArray(row.technical_observations)?row.technical_observations:[],behavioral_signals:Array.isArray(row.behavioral_signals)?row.behavioral_signals:[],missing_information:Array.isArray(row.missing_information)?row.missing_information:[],consultant_notes:row.consultant_notes||'',confidence:Number(row.confidence||0),confirmation_status:row.confirmation_status,revision_no:Number(row.revision_no||1),idempotency_key:row.idempotency_key,created_at:iso(row.created_at),confirmed_at:iso(row.confirmed_at)})
const outcomeRecord=row=>({contract_version:row.contract_version,version:row.contract_version,outcome_id:String(row.id),organization_id:String(row.tenant_id),visit_id:String(row.visit_id),client_id:String(row.client_external_key||row.client_id),visit_report_id:row.visit_report_id?String(row.visit_report_id):null,recommendation_id:row.recommendation_id?String(row.recommendation_id):null,action_plan_id:row.action_plan_id?String(row.action_plan_id):null,commitment_id:row.commitment_id?String(row.commitment_id):null,outcome_type:row.outcome_type,result:jsonObject(row.result),evidence_refs:Array.isArray(row.evidence_refs)?row.evidence_refs:[],measured_at:iso(row.measured_at),recorded_by:String(row.recorded_by),confidence:Number(row.confidence||0),notes:row.notes||'',created_at:iso(row.created_at)})
const learningCandidateRecord=row=>({contract_version:row.contract_version,version:row.contract_version,candidate_id:String(row.id),organization_id:String(row.tenant_id),source_visit_id:String(row.source_visit_id),source_visit_report_id:row.source_visit_report_id?String(row.source_visit_report_id):null,source_outcome_id:row.source_outcome_id?String(row.source_outcome_id):null,hypothesis:row.hypothesis,scope:jsonObject(row.scope),supporting_evidence:Array.isArray(row.supporting_evidence)?row.supporting_evidence:[],contrary_evidence:Array.isArray(row.contrary_evidence)?row.contrary_evidence:[],confidence:Number(row.confidence||0),status:row.status,created_by:row.created_by?String(row.created_by):null,created_at:iso(row.created_at)})

function repositoryScopedRecord(item,{tenantId,producerId,ownerId,repositoryClientId='',validUntil=null}={}){
  if(!item||typeof item!=='object'||Array.isArray(item))return item
  const {client_id:rawClientId,clientId:rawClientIdCamel,owner_id:rawOwnerId,ownerId:rawOwnerIdCamel,...rest}=item
  const existingProducer=String(item.producer_id??item.producerId??item.client_external_key??item.clientExternalKey??'').trim()
  const clientAliases=[rawClientId,rawClientIdCamel].map(value=>String(value??'').trim()).filter(Boolean)
  const distinctClientAliases=[...new Set(clientAliases)]
  const internalClientId=String(repositoryClientId??'').trim()
  const existingTenant=String(item.tenant_id??item.tenantId??item.organization_id??item.organizationId??'').trim()
  const existingOwner=String(item.context_owner_id??item.contextOwnerId??item.consultant_id??item.consultantId??'').trim()
  if(existingProducer&&existingProducer!==String(producerId))throw Object.assign(new Error('Registro recuperado fora do produtor ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'PRODUCER_MISMATCH'})
  if(distinctClientAliases.some(value=>value!==String(producerId)&&value!==internalClientId))throw Object.assign(new Error('Registro recuperado fora do produtor ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'PRODUCER_MISMATCH'})
  if(existingTenant&&existingTenant!==String(tenantId))throw Object.assign(new Error('Registro recuperado fora do tenant ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'TENANT_MISMATCH'})
  if(existingOwner&&existingOwner!==String(ownerId))throw Object.assign(new Error('Registro recuperado fora do owner ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'OWNER_MISMATCH'})
  const sourceOwnerId=rawOwnerId??rawOwnerIdCamel
  const domainOwner=Object.hasOwn(item,'owner_type')||Object.hasOwn(item,'ownerType')
  return {
    ...rest,
    ...(!domainOwner&&sourceOwnerId!==undefined?{owner_id:sourceOwnerId}:{}),
    ...(domainOwner&&sourceOwnerId!==undefined?{record_owner_id:sourceOwnerId}:{}),
    client_id:String(producerId),tenant_id:String(tenantId),producer_id:String(producerId),context_owner_id:String(ownerId),
    ...(validUntil&&!item.valid_until&&!item.validUntil?{valid_until:validUntil}:{})
  }
}

const profileEvidenceIdentifier=item=>String(item?.id??item?.source_id??item?.sourceId??item?.survey_id??item?.surveyId??'').trim()
const explicitProfileSource=item=>String(item?.profile_source_ref??item?.profileSourceRef??'').trim()
function profileEvidenceRecord(item,scope,profileSourceRef){
  const scoped=repositoryScopedRecord(item,scope)
  // Preserve an explicit divergent link so the downstream relational gate can
  // reject it; never silently rewrite it to the current profile parent.
  return explicitProfileSource(scoped)||!profileSourceRef?scoped:{...scoped,profile_source_ref:profileSourceRef}
}

const profileBehavioralAnswerFields=Object.freeze([
  Object.freeze({field:'decisionDriver',question:'7'}),
  Object.freeze({field:'technicalPresentation',question:'8'}),
  Object.freeze({field:'planningStyle',question:'9'}),
  Object.freeze({field:'innovationBehavior',question:'10'}),
  Object.freeze({field:'servicePreference',question:'11'}),
  Object.freeze({field:'trustDriver',question:'14'}),
  Object.freeze({field:'buyingBehavior',question:'16'}),
])
const profileAnswerText=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,500)
function profileBehavioralAnswers(answers={}){
  if(!answers||typeof answers!=='object'||Array.isArray(answers))return {}
  return Object.fromEntries(profileBehavioralAnswerFields.map(({field,question})=>{
    const value=profileAnswerText(answers[field]??answers[question]??answers[`Q${question}`]??answers[`q${question}`])
    return [field,value]
  }).filter(([,value])=>value))
}
function materializeLegacyProfileEvidence(rawEvidence=[],scope={},profileSourceRef,{answers={},assessedAt=null,validUntil=null}={}){
  const scoped=(Array.isArray(rawEvidence)?rawEvidence:[]).map(item=>profileEvidenceRecord(item,{...scope,validUntil},profileSourceRef))
  const behavioralAnswers=profileBehavioralAnswers(answers)
  if(!Object.keys(behavioralAnswers).length)return scoped
  const anchorIndex=scoped.findIndex(item=>profileEvidenceIdentifier(item))
  const existing=anchorIndex>=0?scoped[anchorIndex]:{}
  const evidenceId=profileEvidenceIdentifier(existing)||String(profileSourceRef||'').trim()
  if(!evidenceId)return scoped
  const sourceType=String(existing.source_type??existing.sourceType??existing.source??'behavioral_profile_evidence').trim()
  const observedAt=existing.assessed_at??existing.assessedAt??existing.observed_at??existing.observedAt??assessedAt
  const epistemicType=String(existing.epistemic_type??existing.epistemicType??existing.evidence_type??existing.evidenceType??(existing.self_reported===true||existing.selfReported===true?'QUOTE':'OBSERVATION')).trim().toUpperCase()
  const materialized=profileEvidenceRecord({
    ...existing,id:evidenceId,source_type:sourceType,epistemic_type:epistemicType,
    answers:{...(existing.answers&&typeof existing.answers==='object'&&!Array.isArray(existing.answers)?existing.answers:{}),...behavioralAnswers},
    assessed_at:observedAt,valid_until:existing.valid_until??existing.validUntil??validUntil,
  },{...scope,validUntil},profileSourceRef)
  if(anchorIndex>=0)return scoped.map((item,index)=>index===anchorIndex?materialized:item)
  return [...scoped,materialized]
}

const canonicalProfileFields=Object.freeze([
  Object.freeze({field:'primaryProfile',question:null,aliases:['primaryProfile','primary_profile'],profileColumn:'primaryProfile',epistemicType:'FACT'}),
  Object.freeze({field:'secondaryProfile',question:null,aliases:['secondaryProfile','secondary_profile'],profileColumn:'secondaryProfile',epistemicType:'FACT'}),
  ...profileBehavioralAnswerFields.map(({field,question})=>Object.freeze({
    field,question,aliases:[field,field.replace(/[A-Z]/g,match=>`_${match.toLowerCase()}`),question,`Q${question}`,`q${question}`],
    epistemicType:'OBSERVATION',
  })),
])
const canonicalProfilePoison=/\b(?:prioridade|priority|oportunidade|opportunity|next\s*action|produto\w*|product\w*|fertiliz\w*|cpf\s+financeir\w*|contrato\s+de\s+graos?|preco\w*|price\w*|margem|margin|negociacao|negotiation)\b/i
const canonicalProfileText=value=>{
  const candidate=profileAnswerText(value)
  return candidate&&!canonicalProfilePoison.test(normalize(candidate))?candidate:''
}
const profileContextClientValue=(field,value)=>{
  const candidate=profileAnswerText(value)
  if(field!=='servicePreference'||!candidate)return candidate||null
  return candidate.replace(/^visitas?\s+presenciais?\s+frequentes?/i,'Prefere atendimento presencial frequente').replace(/^visitas?\s+presenciais?/i,'Prefere atendimento presencial')
}
const objectAt=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const profileAliasState=(source,aliases,normalizeValue=value=>String(value??'').trim())=>{
  const record=objectAt(source)
  const entries=aliases.filter(alias=>Object.hasOwn(record,alias)).map(alias=>{
    const value=record[alias]
    return {alias:String(alias),value,normalized:normalizeValue(value)}
  }).filter(item=>item.normalized)
  const distinct=[...new Set(entries.map(item=>item.normalized))]
  return {entries,value:entries[0]?.value,normalized:distinct[0]||'',conflict:distinct.length>1}
}
const canonicalProfileDate=value=>{
  const parsed=value instanceof Date?value:new Date(String(value??''))
  return Number.isNaN(parsed.getTime())?'':parsed.toISOString()
}
const canonicalProfileFieldName=value=>{
  const marker=normalize(String(value??'').trim())
  if(!marker)return ''
  return canonicalProfileFields.find(spec=>spec.aliases.some(alias=>normalize(String(alias))===marker))?.field||`invalid:${marker}`
}
const profileFieldValue=(source,spec)=>{
  const state=profileAliasState(source,spec.aliases,value=>normalize(profileAnswerText(value)))
  if(!state.entries.length)return null
  if(state.conflict)return {conflict:true,aliases:state.entries.map(item=>item.alias)}
  return {value:profileAnswerText(state.value),alias:state.entries[0].alias,conflict:false}
}
const canonicalEvidenceField=item=>String(item?.source_field??item?.sourceField??item?.profile_field??item?.profileField??item?.field??item?.key??item?.question_id??item?.questionId??'').trim()
const canonicalEvidenceText=item=>profileAnswerText(item?.statement??item?.observation??item?.answer??item?.text??item?.value)
const canonicalEvidenceSourceType=item=>String(item?.source_type??item?.sourceType??item?.source??'').trim().toLowerCase()
const canonicalEvidenceTimestamp=item=>iso(item?.assessed_at??item?.assessedAt??item?.observed_at??item?.observedAt??item?.created_at??item?.createdAt)
const canonicalEvidenceParent=item=>String(item?.profile_source_ref??item?.profileSourceRef??item?.parent_source_ref??item?.parentSourceRef??'').trim()
const canonicalProfileSourceId=value=>{
  const candidate=String(value??'').trim().slice(0,180)
  return /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,179}$/.test(candidate)&&!canonicalProfilePoison.test(normalize(candidate))?candidate:''
}
const allowedCanonicalEvidenceSourceTypes=new Set(['behavioral_profile_evidence','producer_questionnaire','producer_360','survey'])

function assertVerifiedProfileRowScope(row,{tenantId,ownerId,producerId}={}){
  if(!row?.profile_id)return null
  const clientInternalId=String(row.client_internal_id??'').trim()
  const clientTenantId=String(row.client_tenant_id??'').trim()
  const clientOwnerId=String(row.client_consultant_id??'').trim()
  const profileTenantId=String(row.profile_tenant_id??'').trim()
  const profileClientId=String(row.profile_client_id??'').trim()
  const externalKey=String(row.client_external_key??'').trim()
  if(!clientInternalId||!clientTenantId||!clientOwnerId||!profileTenantId||!profileClientId||!externalKey)throw Object.assign(new Error('O perfil recuperado não comprova o escopo PostgreSQL completo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_PROFILE_SOURCE_SCOPE'})
  if(clientTenantId!==String(tenantId)||profileTenantId!==String(tenantId))throw Object.assign(new Error('O perfil recuperado pertence a outro tenant.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'TENANT_MISMATCH'})
  if(clientOwnerId!==String(ownerId))throw Object.assign(new Error('O perfil recuperado pertence a outro owner.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'OWNER_MISMATCH'})
  if(externalKey!==String(producerId)||profileClientId!==clientInternalId)throw Object.assign(new Error('O perfil recuperado pertence a outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'PRODUCER_MISMATCH'})
  return {tenantId:clientTenantId,ownerId:clientOwnerId,producerId:externalKey,repositoryClientId:clientInternalId}
}

/**
 * Converte as formas PostgreSQL (evidence, answers e profile_snapshot) em uma
 * única lista canônica, por campo. O escopo é aceito somente depois de o JOIN
 * comprovar tenant, owner, cliente interno e chave externa.
 */
function materializeCanonicalBehavioralProfileEvidence({
  profileId,primaryProfile=null,secondaryProfile=null,answers={},evidence=[],profileSnapshot={},
  sourceSurveyId=null,assessedAt=null,validUntil=null,scope={},
}={}){
  const parentRef=String(profileId?`client_profile:${profileId}`:'').trim()
  const observedAt=canonicalProfileDate(assessedAt)
  const expiresAt=canonicalProfileDate(validUntil)
  if(!parentRef||!observedAt||!expiresAt||!scope?.tenantId||!scope?.ownerId||!scope?.producerId)return {selected:[],rejected:[]}

  const candidates=[]
  const rejected=[]
  const reject=(item,reason)=>rejected.push({
    source_type:canonicalEvidenceSourceType(item)||'behavioral_profile_evidence',
    source_id:canonicalProfileSourceId(profileEvidenceIdentifier(item))||parentRef,reason,
    producer_id:String(scope.producerId),tenant_id:String(scope.tenantId),context_owner_id:String(scope.ownerId),
    observed_at:canonicalProfileDate(canonicalEvidenceTimestamp(item))||observedAt,
  })
  const add=({spec,value,locator,priority,sourceType,epistemicType,sourceId,evidenceRefs=[],candidateObservedAt=observedAt,candidateValidUntil=expiresAt})=>{
    const safeValue=canonicalProfileText(value)
    if(!safeValue){if(profileAnswerText(value))reject({source_type:sourceType,source_id:sourceId},'PROFILE_FIELD_POISON');return}
    candidates.push({spec,value:safeValue,locator,priority,sourceType,epistemicType,sourceId,evidenceRefs,observedAt:candidateObservedAt,validUntil:candidateValidUntil})
  }

  for(const item of Array.isArray(evidence)?evidence:[]){
    if(!item||typeof item!=='object'||Array.isArray(item))continue
    const idState=profileAliasState(item,['id','source_id','sourceId','survey_id','surveyId'],value=>canonicalProfileSourceId(value))
    const typeState=profileAliasState(item,['source_type','sourceType','source'],value=>String(value??'').trim().toLowerCase())
    const timestampState=profileAliasState(item,['assessed_at','assessedAt','observed_at','observedAt','created_at','createdAt'],canonicalProfileDate)
    const validityState=profileAliasState(item,['valid_until','validUntil'],canonicalProfileDate)
    const parentState=profileAliasState(item,['profile_source_ref','profileSourceRef','parent_source_ref','parentSourceRef'],value=>String(value??'').trim())
    const fieldState=profileAliasState(item,['source_field','sourceField','profile_field','profileField','field','key','question_id','questionId'],canonicalProfileFieldName)
    const producerState=profileAliasState(item,['producer_id','producerId','client_external_key','clientExternalKey'],value=>String(value??'').trim())
    const clientState=profileAliasState(item,['client_id','clientId'],value=>String(value??'').trim())
    const tenantState=profileAliasState(item,['tenant_id','tenantId','organization_id','organizationId'],value=>String(value??'').trim())
    const ownerState=profileAliasState(item,['context_owner_id','contextOwnerId','consultant_id','consultantId','owner_id','ownerId'],value=>String(value??'').trim())
    const epistemicState=profileAliasState(item,['epistemic_type','epistemicType','evidence_type','evidenceType'],value=>String(value??'').trim().toUpperCase())
    const selfReportedState=profileAliasState(item,['self_reported','selfReported'],value=>typeof value==='boolean'?String(value):'')
    const textState=profileAliasState(item,['statement','observation','answer','text','value'],value=>normalize(profileAnswerText(value)))
    if([idState,typeState,timestampState,validityState,parentState,fieldState,producerState,clientState,tenantState,ownerState,epistemicState,selfReportedState,textState].some(state=>state.conflict)){
      reject(item,'PROFILE_EVIDENCE_ALIAS_CONFLICT');continue
    }
    const rawId=canonicalProfileSourceId(idState.value)
    const sourceType=typeState.normalized
    const timestamp=timestampState.normalized
    const evidenceValidUntil=validityState.normalized
    const parent=parentState.normalized
    const explicitProducer=producerState.normalized||(clientState.normalized===String(scope.producerId)?clientState.normalized:'')
    if(!explicitProducer){reject(item,'MISSING_PRODUCER_SCOPE');continue}
    if(!tenantState.normalized){reject(item,'MISSING_TENANT_SCOPE');continue}
    if(!ownerState.normalized){reject(item,'MISSING_OWNER_SCOPE');continue}
    if(explicitProducer!==String(scope.producerId)){reject(item,'PRODUCER_MISMATCH');continue}
    if(clientState.normalized&&clientState.normalized!==String(scope.producerId)&&clientState.normalized!==String(scope.repositoryClientId||'')){reject(item,'PRODUCER_MISMATCH');continue}
    if(tenantState.normalized!==String(scope.tenantId)){reject(item,'TENANT_MISMATCH');continue}
    if(ownerState.normalized!==String(scope.ownerId)){reject(item,'OWNER_MISMATCH');continue}
    if(!parent){reject(item,'MISSING_PROFILE_SOURCE_REF');continue}
    if(parent!==parentRef){reject(item,'PROFILE_SOURCE_REF_MISMATCH');continue}
    if(!rawId){reject(item,'MISSING_PROFILE_EVIDENCE_ID');continue}
    if(!sourceType||!allowedCanonicalEvidenceSourceTypes.has(sourceType)){reject(item,'INVALID_PROFILE_EVIDENCE_SOURCE_TYPE');continue}
    if(!timestamp){reject(item,'MISSING_PROFILE_EVIDENCE_TIMESTAMP');continue}
    if(!evidenceValidUntil){reject(item,'MISSING_PROFILE_EVIDENCE_VALID_UNTIL');continue}
    if(new Date(evidenceValidUntil).getTime()<=new Date(timestamp).getTime()){
      reject(item,'INVALID_PROFILE_EVIDENCE_WINDOW');continue
    }
    const explicitEpistemic=epistemicState.normalized||(selfReportedState.normalized==='true'?'QUOTE':'')
    if(explicitEpistemic&&!['FACT','OBSERVATION','QUOTE'].includes(explicitEpistemic)){
      reject(item,'INVALID_PROFILE_EVIDENCE_EPISTEMIC_TYPE');continue
    }
    const maps=[['answers',objectAt(item.answers)],['fields',objectAt(item.fields)],['values',objectAt(item.values)]]
    for(const spec of canonicalProfileFields){
      const found=[]
      let aliasConflict=false
      for(const [path,map] of maps){
        const entry=profileFieldValue(map,spec)
        if(entry?.conflict){aliasConflict=true;break}
        if(entry)found.push({...entry,path})
      }
      if(aliasConflict){reject(item,'PROFILE_FIELD_ALIAS_CONFLICT');continue}
      const marker=fieldState.normalized
      if(marker===spec.field&&textState.entries.length)found.push({value:profileAnswerText(textState.value),alias:canonicalEvidenceField(item),path:'field'})
      if(!found.length)continue
      if(new Set(found.map(entry=>normalize(entry.value))).size>1){reject(item,'PROFILE_FIELD_ALIAS_CONFLICT');continue}
      const selectedField=found[0]
      add({
        spec,value:selectedField.value,locator:`evidence.${selectedField.path}.${selectedField.alias}`,priority:1,
        sourceType,epistemicType:explicitEpistemic||spec.epistemicType,sourceId:rawId,evidenceRefs:[rawId],
        candidateObservedAt:timestamp,candidateValidUntil:evidenceValidUntil,
      })
    }
  }

  for(const spec of canonicalProfileFields.filter(item=>item.question)){
    const direct=profileFieldValue(answers,spec)
    if(direct?.conflict){reject({source_type:sourceSurveyId?'producer_questionnaire':'behavioral_profile_evidence',source_id:String(sourceSurveyId||profileId)},'PROFILE_FIELD_ALIAS_CONFLICT');continue}
    if(direct)add({spec,value:direct.value,locator:`answers.q${spec.question}`,priority:2,sourceType:sourceSurveyId?'producer_questionnaire':'behavioral_profile_evidence',epistemicType:sourceSurveyId?'QUOTE':'OBSERVATION',sourceId:String(sourceSurveyId||profileId),evidenceRefs:sourceSurveyId?[String(sourceSurveyId)]:[]})
  }
  const snapshot=objectAt(profileSnapshot)
  const snapshotAnswers=objectAt(snapshot.answers)
  for(const spec of canonicalProfileFields.filter(item=>item.question)){
    const options=[profileFieldValue(snapshot,spec),profileFieldValue(snapshotAnswers,spec)].filter(Boolean)
    if(options.some(item=>item.conflict)||new Set(options.map(item=>normalize(item.value)).filter(Boolean)).size>1){
      reject({source_type:'behavioral_profile_evidence',source_id:String(profileId)},'PROFILE_FIELD_ALIAS_CONFLICT');continue
    }
    const direct=options[0]||null
    if(direct)add({spec,value:direct.value,locator:`profile_snapshot.${direct.alias}`,priority:4,sourceType:'behavioral_profile_evidence',epistemicType:'OBSERVATION',sourceId:String(profileId),evidenceRefs:[]})
  }
  for(const spec of canonicalProfileFields.filter(item=>!item.question)){
    const value=spec.field==='primaryProfile'?primaryProfile:secondaryProfile
    if(value)add({spec,value,locator:spec.field==='primaryProfile'?'primary_profile':'secondary_profile',priority:5,sourceType:'behavioral_profile_evidence',epistemicType:'FACT',sourceId:String(profileId),evidenceRefs:[]})
  }

  const selected=[]
  const seenFields=new Set()
  for(const candidate of candidates.sort((left,right)=>left.priority-right.priority)){
    if(seenFields.has(candidate.spec.field))continue
    seenFields.add(candidate.spec.field)
    const fieldCandidates=candidates.filter(item=>item.spec.field===candidate.spec.field)
    const distinctValues=new Set(fieldCandidates.map(item=>normalize(item.value)).filter(Boolean))
    if(distinctValues.size>1){
      rejected.push({
        source_type:candidate.sourceType||'behavioral_profile_evidence',source_id:candidate.sourceId||parentRef,
        reason:'PROFILE_FIELD_CONFLICT',producer_id:String(scope.producerId),tenant_id:String(scope.tenantId),context_owner_id:String(scope.ownerId),observed_at:observedAt,
      })
      continue
    }
    const id=`${parentRef}:${candidate.locator}`
    const statement=candidate.spec.field==='primaryProfile'
      ?`Perfil principal registrado: ${candidate.value}.`
      :candidate.spec.field==='secondaryProfile'
        ?`Perfil secundário registrado: ${candidate.value}.`
        :candidate.value
    selected.push(Object.freeze({
      id,source_id:candidate.sourceId||String(profileId),source_ref:parentRef,profile_source_ref:parentRef,
      source_type:candidate.sourceType,source_field:candidate.spec.field,source_locator:candidate.locator,
      field:candidate.spec.field,...(candidate.spec.question?{question_id:candidate.spec.question}:{}),
      materialized_value:candidate.value,
      producer_id:String(scope.producerId),tenant_id:String(scope.tenantId),context_owner_id:String(scope.ownerId),
      observed_at:candidate.observedAt,assessed_at:candidate.observedAt,valid_until:candidate.validUntil,
      epistemic_type:['FACT','OBSERVATION','QUOTE'].includes(candidate.epistemicType)?candidate.epistemicType:candidate.spec.epistemicType,
      statement,relevance_score:1,reason_selected:'BEHAVIORAL_EVIDENCE',evidence_refs:candidate.evidenceRefs,
    }))
  }
  return {selected,rejected}
}

function scopeRepositoryContext(context,{tenantId,clientId,ownerId,repositoryClientId='',contextRequest={}}={}){
  const producerId=String(context?.client?.id||clientId||'')
  const scope={tenantId:String(tenantId),producerId,ownerId:String(ownerId),repositoryClientId:String(repositoryClientId||'')}
  const profileValidUntil=context?.profile?.validUntil??context?.client?.profileValidUntil??null
  const rawProfileEvidence=[...(Array.isArray(context?.profile?.evidence)?context.profile.evidence:[]),...(Array.isArray(context?.client?.profileEvidence)?context.client.profileEvidence:[])]
  const firstEvidenceId=rawProfileEvidence.map(profileEvidenceIdentifier).find(Boolean)||''
  const profileSourceRef=String(context?.profile?.sourceId??context?.client?.profileSourceRef??context?.client?.profileSource??firstEvidenceId).trim()
  const alreadyCanonical=rawProfileEvidence.length>0&&rawProfileEvidence.every(item=>profileEvidenceIdentifier(item)&&String(item?.source_field??item?.sourceField??'').trim()&&String(item?.source_locator??item?.sourceLocator??'').trim())
  const profileEvidence=alreadyCanonical
    ?rawProfileEvidence.map(item=>profileEvidenceRecord(item,{...scope,validUntil:profileValidUntil},profileSourceRef))
    :materializeLegacyProfileEvidence(rawProfileEvidence,scope,profileSourceRef,{answers:context?.profile?.answers,assessedAt:context?.profile?.assessedAt??context?.client?.profileUpdatedAt,validUntil:profileValidUntil})
  const evidenceById=new Map(profileEvidence.map(item=>[profileEvidenceIdentifier(item),item]).filter(([id])=>id))
  const scopedProfileEvidence=[...evidenceById.values()]
  const map=items=>(Array.isArray(items)?items:[]).map(item=>repositoryScopedRecord(item,scope))
  const priorRecommendations=selectScopedPriorRecommendations(context,contextRequest.message||'',{
    tenantId,ownerId,producerId,
    conversationId:contextRequest.conversationId??contextRequest.conversation_id,
    contextEpoch:contextRequest.contextEpoch??contextRequest.context_epoch,
    contextDomain:contextRequest.contextDomain??contextRequest.context_domain
  })
  return {
    ...context,
    client:{...(context.client||{}),profileEvidence:scopedProfileEvidence},
    profile:{...(context.profile||{}),sourceId:profileSourceRef||null,evidence:scopedProfileEvidence},
    businessHistory:map(context.businessHistory),visits:map(context.visits),interactions:map(context.interactions),commitments:map(context.commitments),opportunities:map(context.opportunities),properties:map(context.properties),fieldReports:map(context.fieldReports),soilAnalyses:map(context.soilAnalyses),ndviObservations:map(context.ndviObservations),
    manualRecords:map(context.manualRecords),attachments:map(context.attachments),
    priorRecommendations
  }
}

function attachContextSnapshot(context,{tenantId,clientId,subjectId,ownerId,repositoryClientId='',contextRequest={}}){
  const scopedContext=scopeRepositoryContext(context,{tenantId,clientId,ownerId,repositoryClientId,contextRequest})
  let snapshot
  try{
    snapshot=buildContextSnapshot(scopedContext,{
      organizationId:tenantId,
      subjectType:'client',
      subjectId:String(subjectId||scopedContext?.client?.id||clientId||''),
      actorId:ownerId,
      role:contextRequest.actorRole||'consultant',
      scope:contextRequest.scope||'own_portfolio',
      objective:contextRequest.objective||'general_assistance',
      requestId:contextRequest.requestId,
      message:contextRequest.message,
      intent:contextRequest.intent,
      contextDomain:contextRequest.contextDomain||contextRequest.context_domain,
      conversationId:contextRequest.conversationId,
      contextEpoch:contextRequest.contextEpoch??contextRequest.context_epoch,
      activeEntity:contextRequest.activeEntity??contextRequest.active_entity,
      now:contextRequest.now
    })
  }catch(error){
    if(error?.code==='CONTEXT_SCOPE_VIOLATION')observe('context.scope.violation',{errorCode:'CONTEXT_SCOPE_VIOLATION',reason:String(error.reason||'UNKNOWN').slice(0,80),outcome:'blocked'})
    throw error
  }
  const exclusionReasonCounts=snapshot.selection.exclusion_reason_codes.reduce((counts,item)=>{
    for(const code of item.reason_codes)counts[code]=(counts[code]||0)+1
    return counts
  },{})
  observe('context.snapshot.built',{
    contextSnapshotId:snapshot.context_snapshot_id,
    contractVersion:contextSnapshotVersion,
    memoryRefsConsidered:snapshot.selection.considered_refs.length,
    memoryRefsSelected:snapshot.selection.selected_refs.length,
    memoryRefsExcluded:snapshot.selection.excluded_refs.length,
    exclusionReasonCounts:Object.entries(exclusionReasonCounts).sort().map(([code,count])=>`${code}:${count}`).join(',')||'none',
    confidence:snapshot.confidence.level,
    selectionPolicy:snapshot.selection.policy_version,
    durationMs:snapshot.selection.latency_ms,
    outcome:'ok'
  })
  return {...scopedContext,memoryHistory:Array.isArray(scopedContext.memoryHistory)?scopedContext.memoryHistory:scopedContext.memories||[],contextSnapshot:snapshot}
}

export class ValRepository{
  constructor({db,readStore,saveStore,tenantId}){this.db=db;this.readStore=readStore;this.saveStore=saveStore;this.tenantId=tenantId;this.producerEntityIndex=createProducerEntityIndexCache()}

  fallback(){
    const store=this.readStore();store.val||={};for(const key of ['recommendations','feedback','integrationEvents','signals','conversations','modelRuns','memories','attachments','contextSnapshots','actionPlans','commitments','visitPreparations','visitTranscripts','visitReports','voiceInteractions','voiceTranscripts','outcomes','learningCandidates','visitLifecycleEvents'])store.val[key]||=[];store.val.technicalContexts||={};store.interactions||=[];store.opportunities||=[];store.visits||=[];return store
  }

  async listSurveys(ownerId){
    if(!this.db.configured){if(!ownerId)throw domainError('O proprietário da carteira é obrigatório para listar questionários.',403,'owner_scope_required');return (this.readStore().surveys||[]).filter(item=>exactScope(item,this.tenantId,ownerId)).map(fallbackSurveyRecord).sort((left,right)=>String(right.createdAt).localeCompare(String(left.createdAt)))}
    try{const result=await this.db.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC LIMIT 5000',[this.tenantId,ownerId]);return result.rows.map(surveyRecord)}catch{throw serviceError('Os questionários não puderam ser lidos no PostgreSQL configurado.')}
  }

  async createSurvey({token,producerName,consultantName,createdAt,expiresAt},ownerId){
    if(!this.db.configured){if(!ownerId)throw domainError('O proprietário da carteira é obrigatório para criar questionários.',403,'owner_scope_required');const store=this.readStore();store.surveys||=[];const survey={token,producerName,consultantName,status:'aguardando',createdAt,expiresAt,tenantId:this.tenantId,ownerId};store.surveys.push(survey);this.saveStore(store);return fallbackSurveyRecord(survey)}
    try{const result=await this.db.query(`INSERT INTO survey_invitations (tenant_id,owner_user_id,token,producer_name,consultant_name,status,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,'aguardando',$6,$7) RETURNING token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at`,[this.tenantId,ownerId,token,producerName||null,consultantName||null,createdAt,expiresAt]);return surveyRecord(result.rows[0])}catch{throw serviceError('O convite não pôde ser persistido no PostgreSQL configurado.')}
  }

  async getSurvey(token){
    if(!this.db.configured){const survey=(this.readStore().surveys||[]).find(item=>item.token===token&&String(scopedTenant(item))===String(this.tenantId));return survey?fallbackSurveyRecord(survey):null}
    try{const result=await this.db.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 LIMIT 1',[this.tenantId,token]);return result.rows[0]?surveyRecord(result.rows[0]):null}catch{throw serviceError('O convite não pôde ser consultado no PostgreSQL configurado.')}
  }

  async submitSurvey({token,answers,result}){
    if(!this.db.configured){const store=this.readStore();const survey=(store.surveys||[]).find(item=>item.token===token&&String(scopedTenant(item))===String(this.tenantId));if(!survey)throw domainError('Este convite não foi encontrado.',404);if(survey.expiresAt&&new Date(survey.expiresAt)<new Date())throw domainError('Este convite expirou.',410);if(survey.status!=='aguardando')throw domainError('Este questionário já foi respondido.',409);survey.answers=answers;survey.result=sanitizeProfileResult(result);survey.status='respondido';survey.submittedAt=new Date().toISOString();this.saveStore(store);return fallbackSurveyRecord(survey)}
    try{return await this.db.transaction(async connection=>{const selected=await connection.query('SELECT status,expires_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 FOR UPDATE',[this.tenantId,token]);if(!selected.rowCount)throw domainError('Este convite não foi encontrado.',404);if(new Date(selected.rows[0].expires_at)<new Date())throw domainError('Este convite expirou.',410);if(selected.rows[0].status!=='aguardando')throw domainError('Este questionário já foi respondido.',409);const updated=await connection.query(`UPDATE survey_invitations SET answers=$3,result=$4,status='respondido',submitted_at=NOW() WHERE tenant_id=$1 AND token=$2 RETURNING token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at`,[this.tenantId,token,jsonbParameter(answers),jsonbParameter(sanitizeProfileResult(result))]);return surveyRecord(updated.rows[0])})}catch(error){if(error.statusCode)throw error;throw serviceError('As respostas não puderam ser persistidas no PostgreSQL configurado.')}
  }

  async integrateSurvey(token,ownerId){
    if(!this.db.configured){const store=this.readStore();const survey=(store.surveys||[]).find(item=>item.token===token&&exactScope(item,this.tenantId,ownerId));if(!survey)throw domainError('Resposta não encontrada.',404);if(!survey.result)throw domainError('O questionário ainda não foi respondido.',409);survey.result=sanitizeProfileResult(survey.result);survey.status='integrado';survey.integratedAt=new Date().toISOString();this.saveStore(store);return fallbackSurveyRecord(survey)}
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query('SELECT id,status,answers,result FROM survey_invitations WHERE tenant_id=$1 AND token=$2 AND owner_user_id=$3 FOR UPDATE',[this.tenantId,token,ownerId]);if(!selected.rowCount)throw domainError('Resposta não encontrada.',404)
      const survey=selected.rows[0];if(!survey.result)throw domainError('O questionário ainda não foi respondido.',409)
      if(survey.status!=='integrado'){
        const result=sanitizeProfileResult(survey.result);let externalKey=String(result.id||normalize(result.name).replace(/\s+/g,'-')||randomUUID()).slice(0,180);externalKey=await resolveSurveyExternalKey(connection,this.tenantId,ownerId,externalKey,result.name);const area=parseCultivatedArea(result.area)
        const commercial=await surveyCommercialForWrite(connection,this.tenantId,ownerId,externalKey,result)
        const relationship=sanitizeSurveyRelationship(result.relationship||{})
        const client=await connection.query(`INSERT INTO clients (tenant_id,consultant_id,external_key,name,municipality,total_area_ha,area_band,cultures,preferred_channel,commercial_profile,relationship_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','producer_360',NOW()) ON CONFLICT (tenant_id,consultant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=EXCLUDED.municipality,total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),cultures=EXCLUDED.cultures,preferred_channel=EXCLUDED.preferred_channel,commercial_profile=EXCLUDED.commercial_profile,relationship_profile=clients.relationship_profile||EXCLUDED.relationship_profile,updated_at=NOW() RETURNING id`,[this.tenantId,ownerId,externalKey,String(result.name||'Produtor').slice(0,180),String(result.municipality||'').slice(0,140)||null,area.totalAreaHa,area.areaBand,String(result.cultures||'').slice(0,1000)||null,String(result.servicePreference||'').slice(0,60)||null,jsonbParameter(commercial),jsonbParameter(relationship)])
        await connection.query(`INSERT INTO client_profiles (tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,evidence,profile_snapshot,valid_until,assessed_at,source_survey_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL '180 days',NOW(),$10) ON CONFLICT (source_survey_id) DO NOTHING`,[this.tenantId,client.rows[0].id,result.primaryProfile||null,result.secondaryProfile||null,Number.isFinite(Number(result.irt))?Number(result.irt):null,Number.isFinite(Number(result.nps))?Number(result.nps):null,jsonbParameter(survey.answers||{}),jsonbParameter([{source:'producer_360',survey_id:survey.id,self_reported:true}]),jsonbParameter(snapshotFor(result,'producer_360')),survey.id])
        await connection.query(`UPDATE survey_invitations SET client_id=$3,status='integrado',integrated_at=NOW() WHERE tenant_id=$1 AND token=$2`,[this.tenantId,token,client.rows[0].id])
      }
      const updated=await connection.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 AND owner_user_id=$3',[this.tenantId,token,ownerId]);return surveyRecord(updated.rows[0])
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A resposta não pôde ser integrada no PostgreSQL configurado.')}
  }

  async saveSurveyProfile({answers,result,source='assisted_survey'},ownerId){
    result=sanitizeProfileResult(result)
    if(!this.db.configured)return result
    try{return await this.db.transaction(async connection=>{
      let externalKey=String(result.id||normalize(result.name).replace(/\s+/g,'-')||randomUUID()).slice(0,180)
      externalKey=await resolveSurveyExternalKey(connection,this.tenantId,ownerId,externalKey,result.name)
      const area=parseCultivatedArea(result.area)
      const commercial=await surveyCommercialForWrite(connection,this.tenantId,ownerId,externalKey,result)
      const relationship=sanitizeSurveyRelationship(result.relationship||{})
      const client=await connection.query(`INSERT INTO clients (tenant_id,consultant_id,external_key,name,municipality,total_area_ha,area_band,cultures,preferred_channel,commercial_profile,relationship_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,NOW()) ON CONFLICT (tenant_id,consultant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=EXCLUDED.municipality,total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),cultures=EXCLUDED.cultures,preferred_channel=EXCLUDED.preferred_channel,commercial_profile=EXCLUDED.commercial_profile,relationship_profile=clients.relationship_profile||EXCLUDED.relationship_profile,updated_at=NOW() RETURNING id`,[this.tenantId,ownerId,externalKey,String(result.name||'Produtor').slice(0,180),String(result.municipality||'').slice(0,140)||null,area.totalAreaHa,area.areaBand,String(result.cultures||'').slice(0,1000)||null,String(result.servicePreference||'').slice(0,60)||null,jsonbParameter(commercial),jsonbParameter(relationship),source])
      const sourceKey=profileSourceKey(source,externalKey,answers)
      await connection.query(`INSERT INTO client_profiles (tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,evidence,profile_snapshot,source_key,valid_until,assessed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+INTERVAL '180 days',NOW()) ON CONFLICT (tenant_id,client_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET primary_profile=EXCLUDED.primary_profile,secondary_profile=EXCLUDED.secondary_profile,irt_score=EXCLUDED.irt_score,nps_score=EXCLUDED.nps_score,answers=EXCLUDED.answers,evidence=EXCLUDED.evidence,profile_snapshot=EXCLUDED.profile_snapshot,valid_until=EXCLUDED.valid_until,assessed_at=NOW()`,[this.tenantId,client.rows[0].id,result.primaryProfile||null,result.secondaryProfile||null,Number.isFinite(Number(result.irt))?Number(result.irt):null,Number.isFinite(Number(result.nps))?Number(result.nps):null,jsonbParameter(answers||{}),jsonbParameter([{source,self_reported:true}]),jsonbParameter(snapshotFor(result,source)),sourceKey])
      return {...result,id:externalKey}
    })}catch{throw serviceError('O perfil assistido não pôde ser salvo no PostgreSQL configurado.')}
  }

  async getIntelligence(ownerId){
    if(!this.db.configured){if(!ownerId)throw domainError('O proprietário da carteira é obrigatório para consultar a inteligência.',403,'owner_scope_required');const store=this.readStore();const scopedImports=(store.imports||[]).filter(record=>exactScope(record,this.tenantId,ownerId));const clients=new Map();scopedImports.forEach(record=>record.clients?.forEach(client=>{if(exactScope(client,this.tenantId,ownerId,record))clients.set(normalize(client.name),client)}));return {imports:scopedImports.map(({clients:ignored,...summary})=>summary),clients:[...clients.values()],visits:(store.visits||[]).filter(item=>exactScope(item,this.tenantId,ownerId)),opportunities:(store.opportunities||[]).filter(item=>exactScope(item,this.tenantId,ownerId))}}
    try{
      const [importResult,clientResult,visitResult,opportunityResult]=await Promise.all([
        this.db.query('SELECT summary FROM import_jobs WHERE tenant_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC LIMIT 20',[this.tenantId,ownerId]),
        this.db.query(`SELECT c.external_key,c.name,c.municipality,c.total_area_ha,c.area_band,c.cultures,c.preferred_channel,c.commercial_profile,c.relationship_profile,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,
            COALESCE((SELECT SUM(value) FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won'),0) purchase_total,
            COALESCE((SELECT COUNT(*) FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won'),0) purchase_count,
            (SELECT MAX(occurred_at) FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won') last_purchase_at,
            COALESCE((SELECT SUM(estimated_value) FROM opportunities opportunity WHERE opportunity.tenant_id=c.tenant_id AND opportunity.client_id=c.id AND opportunity.stage<>'Fechado'),0) open_pipeline,
            COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot
          FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
          LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
          WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active' ORDER BY c.name LIMIT 5000`,[this.tenantId,ownerId]),
        this.db.query(`SELECT visit.*,client.external_key client_external_key FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$1 AND client.consultant_id=$2 ORDER BY COALESCE(visit.updated_at,visit.created_at) DESC LIMIT 2000`,[this.tenantId,ownerId]),
        this.db.query(`SELECT opportunity.*,client.external_key client_external_key FROM opportunities opportunity JOIN clients client ON client.tenant_id=opportunity.tenant_id AND client.id=opportunity.client_id WHERE opportunity.tenant_id=$1 AND client.consultant_id=$2 ORDER BY opportunity.updated_at DESC LIMIT 2000`,[this.tenantId,ownerId])
      ])
      return {imports:importResult.rows.map(row=>row.summary),clients:clientResult.rows.map(row=>clientFromRow(row,{defaults:true})),visits:visitResult.rows.map(visitRecord),opportunities:opportunityResult.rows.map(opportunityRecord)}
    }catch{throw serviceError('A carteira não pôde ser lida no PostgreSQL configurado.')}
  }

  async listAuthorizedClientReferences({tenantId=this.tenantId,ownerId,timeoutMs}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!ownerId)throw domainError('O proprietário da carteira é obrigatório para resolver referências de clientes.',403,'owner_scope_required')
    return this.producerEntityIndex.getOrLoad({tenantId,ownerId},async()=>{
    if(!this.db.configured){
      const clients=new Map()
      for(const record of this.readStore().imports||[]){
        if(!exactScope(record,tenantId,ownerId))continue
        for(const value of record.clients||[]){
          if(!exactScope(value,tenantId,ownerId,record))continue
          const id=String(value?.id??value?.external_key??value?.externalKey??'').trim().slice(0,180)
          const name=String(value?.name??'').replace(/\s+/g,' ').trim().slice(0,180)
          if(!id||!name||clients.has(id))continue
          const aliases=Array.isArray(value?.aliases)?value.aliases:Array.isArray(value?.commercial?.aliases)?value.commercial.aliases:[]
          const properties=Array.isArray(value?.properties)?value.properties:String(value?.properties??value?.property??'').split(/[,;|]+/)
          clients.set(id,{id,name,municipality:String(value?.municipality??'').replace(/\s+/g,' ').trim().slice(0,140)||null,aliases:aliases.slice(0,20),properties:properties.slice(0,50),organizationId:tenantId})
        }
      }
      return [...clients.values()].sort((left,right)=>left.name.localeCompare(right.name,'pt-BR'))
    }
    try{
      const selected=await this.db.query(`SELECT c.external_key,c.name,c.municipality,
        CASE WHEN jsonb_typeof(c.commercial_profile->'aliases')='array' THEN c.commercial_profile->'aliases' ELSE '[]'::jsonb END aliases,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',COALESCE(property.external_key,property.id::text),'name',property.name) ORDER BY property.updated_at DESC) FROM properties property WHERE property.tenant_id=c.tenant_id AND property.client_id=c.id),'[]'::jsonb) properties
        FROM clients c WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active' ORDER BY c.name,c.external_key LIMIT 5000`,[tenantId,ownerId],...databaseTimeoutArgs(timeoutMs))
      return selected.rows.map(row=>({id:String(row.external_key),name:String(row.name),municipality:String(row.municipality||'').trim()||null,aliases:Array.isArray(row.aliases)?row.aliases:[],properties:Array.isArray(row.properties)?row.properties:[],organizationId:tenantId}))
    }catch{throw serviceError('As referências autorizadas de clientes não puderam ser lidas no PostgreSQL configurado.')}
    })
  }

  invalidateAuthorizedClientReferences({tenantId=this.tenantId,ownerId}={}){tenantId=assertTenantScope(this.tenantId,tenantId);return this.producerEntityIndex.invalidate({tenantId,ownerId})}

  async resolveAuthorizedClientReference({tenantId=this.tenantId,ownerId,message='',reference='',currentClientId=null,recentClientIds=[],timeoutMs}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    const authorizedClients=await this.listAuthorizedClientReferences({tenantId,ownerId,timeoutMs})
    return reconcileAuthorizedClientReference({message,reference,authorizedClients,currentClientId,recentClientIds})
  }

  async getTechnicalBootstrap(ownerId){
    if(!this.db.configured){
      const intelligence=await this.getIntelligence(ownerId)
      return (intelligence.clients||[]).map(client=>({...client,properties:[]}))
    }
    try{
      const result=await this.db.query(`SELECT c.external_key,c.name,c.municipality,c.total_area_ha,c.area_band,c.cultures,c.preferred_channel,c.commercial_profile,c.relationship_profile,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot,
        COALESCE((SELECT jsonb_agg(property_record ORDER BY property_record.updated_at DESC) FROM (
          SELECT property.id,property.external_key,property.name,property.municipality,property.area_ha,property.metadata,property.updated_at,
            COALESCE((SELECT jsonb_agg(field_record ORDER BY field_record.updated_at DESC) FROM (
              SELECT field.id,field.external_key,field.name,field.area_ha,field.geometry_ref,field.geometry_version,field.updated_at,
                (SELECT jsonb_build_object('season',season.season,'crop',season.crop,'area_ha',season.area_ha,'unit',season.unit) FROM crop_seasons season WHERE season.tenant_id=$1 AND season.field_id=field.id ORDER BY season.created_at DESC LIMIT 1) latest_season
              FROM fields field WHERE field.tenant_id=$1 AND field.property_id=property.id ORDER BY field.updated_at DESC LIMIT 200
            ) field_record),'[]'::jsonb) fields
          FROM properties property WHERE property.tenant_id=$1 AND property.client_id=c.id ORDER BY property.updated_at DESC LIMIT 100
        ) property_record),'[]'::jsonb) properties
        FROM clients c
        LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
        LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
        WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active' ORDER BY c.name LIMIT 5000`,[this.tenantId,ownerId])
      return result.rows.map(row=>({...clientFromRow(row,{defaults:true}),properties:Array.isArray(row.properties)?row.properties:[]}))
    }catch{throw serviceError('A carteira técnica não pôde ser lida no PostgreSQL configurado.')}
  }

  async getClientOverview(clientId,ownerId){
    if(!this.db.configured)throw serviceError('O PostgreSQL é obrigatório para consolidar a visão global do produtor.')
    try{
      const selected=await this.db.query(`SELECT id,external_key,name,commercial_profile FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1`,[this.tenantId,ownerId,clientId])
      if(!selected.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404)
      const client=selected.rows[0]
      const [businessResult,monthlyResult,categoryResult,pipelineResult,technicalResult,workspaceResult,manualRecordResult]=await Promise.all([
        this.db.query(`SELECT
          COALESCE(SUM(value) FILTER (WHERE outcome='won'),0) purchase_total,
          COUNT(*) FILTER (WHERE outcome='won')::int purchase_count,
          COUNT(*) FILTER (WHERE outcome IN ('won','lost'))::int known_outcomes,
          COUNT(*) FILTER (WHERE outcome='won')::int wins,
          COUNT(*) FILTER (WHERE outcome='lost')::int losses,
          COALESCE(SUM(margin) FILTER (WHERE outcome='won'),0) margin_total,
          MAX(occurred_at) FILTER (WHERE outcome='won') last_purchase_at
          FROM business_events WHERE tenant_id=$1 AND client_id=$2`,[this.tenantId,client.id]),
        this.db.query(`SELECT TO_CHAR(DATE_TRUNC('month',occurred_at),'YYYY-MM') AS month_key,
          COALESCE(SUM(value) FILTER (WHERE outcome='won'),0) won_value,
          COALESCE(SUM(value) FILTER (WHERE outcome='open'),0) open_value,
          COUNT(*) FILTER (WHERE outcome='won')::int won_count
          FROM business_events WHERE tenant_id=$1 AND client_id=$2 AND occurred_at>=DATE_TRUNC('month',NOW())-INTERVAL '11 months'
          GROUP BY DATE_TRUNC('month',occurred_at) ORDER BY DATE_TRUNC('month',occurred_at)`,[this.tenantId,client.id]),
        this.db.query(`SELECT COALESCE(NULLIF(category,''),NULLIF(product,''),'Não categorizado') label,
          COALESCE(SUM(value) FILTER (WHERE outcome='won'),0) value,
          COUNT(*) FILTER (WHERE outcome='won')::int count
          FROM business_events WHERE tenant_id=$1 AND client_id=$2
          GROUP BY COALESCE(NULLIF(category,''),NULLIF(product,''),'Não categorizado')
          ORDER BY COALESCE(SUM(value) FILTER (WHERE outcome='won'),0) DESC LIMIT 8`,[this.tenantId,client.id]),
        this.db.query(`SELECT stage,COUNT(*)::int count,COALESCE(SUM(estimated_value),0) value,
          COALESCE(SUM(estimated_value*COALESCE(probability,0)/100.0),0) weighted_value,
          COUNT(*) FILTER (WHERE next_action_at<NOW() AND stage<>'Fechado')::int overdue
          FROM opportunities WHERE tenant_id=$1 AND client_id=$2 GROUP BY stage ORDER BY stage`,[this.tenantId,client.id]),
        this.db.query(`SELECT
          (SELECT COUNT(*) FROM properties WHERE tenant_id=$1 AND client_id=$2)::int properties,
          (SELECT COUNT(*) FROM fields field JOIN properties property ON property.id=field.property_id AND property.tenant_id=field.tenant_id WHERE field.tenant_id=$1 AND property.client_id=$2)::int fields,
          (SELECT COUNT(*) FROM crop_seasons season JOIN fields field ON field.id=season.field_id AND field.tenant_id=season.tenant_id JOIN properties property ON property.id=field.property_id AND property.tenant_id=field.tenant_id WHERE season.tenant_id=$1 AND property.client_id=$2)::int crop_seasons,
          (SELECT COUNT(*) FROM field_reports WHERE tenant_id=$1 AND client_id=$2)::int field_reports,
          (SELECT COUNT(*) FROM soil_analyses WHERE tenant_id=$1 AND client_id=$2)::int soil_analyses,
          (SELECT COUNT(*) FROM ndvi_observations WHERE tenant_id=$1 AND client_id=$2)::int ndvi,
          (SELECT COUNT(*) FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$3 AND source='manual-do-agronomo' AND client_external_key=$4)::int manual_events,
          (SELECT MAX(occurred_at) FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$3 AND source='manual-do-agronomo' AND client_external_key=$4) last_manual_sync`,[this.tenantId,client.id,ownerId,client.external_key]),
        this.db.query(`SELECT producers,soil_analyses,updated_at FROM app_workspace_data WHERE tenant_id=$1 AND workspace_id=$2 LIMIT 1`,[this.tenantId,ownerId]),
        this.db.query(`SELECT id,record_type,title,producer_name,updated_at FROM app_records WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC LIMIT 300`,[this.tenantId,ownerId])
      ])
      const business=businessResult.rows[0]||{}
      const commercial=derivedCommercial(client.commercial_profile)
      const currentPurchases=parseMoney(commercial.purchaseCurrentSeason)??0
      const previousPurchases=parseMoney(commercial.purchasePreviousSeason)??0
      const potentialTotal=parseMoney(commercial.potentialTotal)??0
      const openPotential=potentialTotal>0?Math.max(0,potentialTotal-currentPurchases):0
      const openStages=pipelineResult.rows.filter(item=>String(item.stage||'').toLowerCase()!=='fechado')
      const openPipeline=openStages.reduce((sum,item)=>sum+Number(item.value||0),0)
      const weightedPipeline=openStages.reduce((sum,item)=>sum+Number(item.weighted_value||0),0)
      const purchaseTotal=Number(business.purchase_total||0)
      const purchaseCount=Number(business.purchase_count||0)
      const knownOutcomes=Number(business.known_outcomes||0)
      const wins=Number(business.wins||0)
      const grossMarginPercent=parseMoney(commercial.grossMarginPercent)
      const workspace=workspaceResult.rows[0]||{}
      const normalizeKey=value=>normalize(value).replace(/\s+/g,'-')
      const clientKey=normalizeKey(client.external_key||client.name)
      const clientName=normalize(client.name)
      const producers=Array.isArray(workspace.producers)?workspace.producers:[]
      const manualProducer=producers.find(item=>{
        const candidate=jsonObject(item)
        return [candidate.id,candidate.valor360ExternalKey,candidate.crmCode].some(value=>normalizeKey(value)===clientKey)||normalize(candidate.name||candidate.producerName)===clientName
      })||null
      const producerId=String(manualProducer?.id||'')
      const workspaceSoil=(Array.isArray(workspace.soil_analyses)?workspace.soil_analyses:[]).filter(item=>{
        const candidate=jsonObject(item)
        return (producerId&&String(candidate.producerId||'')===producerId)||normalize(candidate.producerName||candidate.producer)===clientName
      })
      const directRecords=manualRecordResult.rows.filter(item=>normalize(item.producer_name)===clientName)
      const technical=technicalResult.rows[0]||{}
      const manualFields=Array.isArray(manualProducer?.fields)?manualProducer.fields:[]
      const manualSeasons=new Set(manualFields.map(item=>String(jsonObject(item).season||'').trim()).filter(Boolean))
      const manualNdvi=manualFields.reduce((sum,item)=>sum+(Array.isArray(jsonObject(item).ndviScenes)?jsonObject(item).ndviScenes.length:0),0)
      const manualProperties=String(manualProducer?.properties||'').split(/[,;|]+/).map(item=>item.trim()).filter(Boolean).length
      return {
        generatedAt:new Date().toISOString(),
        cloud:{storage:'postgresql',ownerScoped:true,workspaceUpdatedAt:iso(workspace.updated_at)||null},
        business:{
          purchaseTotal,purchaseCount,currentPurchases,previousPurchases,potentialTotal,openPotential,
          openPipeline,weightedPipeline,forecast:currentPurchases+weightedPipeline,
          averageTicket:purchaseCount?purchaseTotal/purchaseCount:0,
          wins,losses:Number(business.losses||0),knownOutcomes,conversionRate:knownOutcomes?wins/knownOutcomes*100:null,
          purchaseGrowthPercent:previousPurchases>0?(currentPurchases-previousPurchases)/previousPurchases*100:null,
          potentialCoveragePercent:potentialTotal>0?Math.min(100,currentPurchases/potentialTotal*100):null,
          pipelineCoveragePercent:openPotential>0?openPipeline/openPotential*100:null,
          marginTotal:Number(business.margin_total||0),estimatedMargin:grossMarginPercent===null?null:currentPurchases*(grossMarginPercent/100),
          lastPurchaseAt:iso(business.last_purchase_at)||null,
          creditLimit:Number(commercial.creditLimit||0),creditUsed:Number(commercial.creditUsed||0),creditAvailable:Number(commercial.creditAvailable||0),
          walletShare:commercial.walletShare??null,targetShare:commercial.targetShare??null,grossMarginPercent:grossMarginPercent,
          paymentTerms:commercial.paymentTerms||'',decisionWindow:commercial.decisionWindow||'',commercialRisk:commercial.commercialRisk||''
        },
        monthly:monthlyResult.rows.map(row=>({month:row.month_key,wonValue:Number(row.won_value||0),openValue:Number(row.open_value||0),wonCount:Number(row.won_count||0)})),
        categories:categoryResult.rows.map(row=>({label:row.label,value:Number(row.value||0),count:Number(row.count||0)})),
        pipeline:pipelineResult.rows.map(row=>({stage:row.stage||'Sem etapa',count:Number(row.count||0),value:Number(row.value||0),weightedValue:Number(row.weighted_value||0),overdue:Number(row.overdue||0)})),
        technical:{
          properties:Math.max(Number(technical.properties||0),manualProperties,Number(Boolean(manualProducer))),fields:Math.max(Number(technical.fields||0),manualFields.length),cropSeasons:Math.max(Number(technical.crop_seasons||0),manualSeasons.size),fieldReports:Number(technical.field_reports||0),
          soilAnalyses:Math.max(Number(technical.soil_analyses||0),workspaceSoil.length),ndvi:Math.max(Number(technical.ndvi||0),manualNdvi),manualEvents:Number(technical.manual_events||0),
          directRecords:directRecords.length,lastSyncAt:iso(technical.last_manual_sync)||iso(workspace.updated_at)||null,
          producer:manualProducer?{name:String(manualProducer.name||manualProducer.producerName||client.name).slice(0,180),city:String(manualProducer.city||manualProducer.municipality||'').slice(0,140),area:Number(manualProducer.area||0),cultures:Array.isArray(manualProducer.cultures)?manualProducer.cultures.slice(0,20):String(manualProducer.cultures||'').split(/[,;/|]+/).map(item=>item.trim()).filter(Boolean).slice(0,20),propertyLabel:String(manualProducer.properties||manualProducer.property||'').slice(0,500),fieldCount:Array.isArray(manualProducer.fields)?manualProducer.fields.length:0,mappingStatus:String(manualProducer.mappingStatus||'').slice(0,60)}:null,
          recentRecords:directRecords.slice(0,6).map(item=>({id:String(item.id),type:String(item.record_type||''),title:String(item.title||'Registro técnico').slice(0,240),updatedAt:iso(item.updated_at)}))
        }
      }
    }catch(error){if(error.statusCode)throw error;throw serviceError('A visão global não pôde ser consolidada no PostgreSQL configurado.')}
  }

  async updateClient(clientId,input,ownerId){
    if(!this.db.configured)throw serviceError('O PostgreSQL é obrigatório para editar produtores.')
    const name=limitedText(input.name,180);if(!name)throw domainError('Informe o nome do produtor.',400)
    try{
      await this.db.transaction(async connection=>{
        const selected=await connection.query(`SELECT id,commercial_profile,relationship_profile FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1 FOR UPDATE`,[this.tenantId,ownerId,clientId])
        if(!selected.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404)
        const area=parseCultivatedArea(input.area)
        const commercial=derivedCommercial({...jsonObject(selected.rows[0].commercial_profile),...sanitizeCommercial(input.commercial||{})})
        const relationship={...jsonObject(selected.rows[0].relationship_profile),...sanitizeRelationship(input.relationship||{})}
        await connection.query(`UPDATE clients SET name=$1,municipality=$2,total_area_ha=$3,area_band=$4,cultures=$5,preferred_channel=$6,commercial_profile=$7,relationship_profile=$8,updated_at=NOW() WHERE id=$9 AND tenant_id=$10 AND consultant_id=$11`,[name,limitedText(input.municipality,140)||null,area.totalAreaHa,area.areaBand,limitedText(input.cultures,1000)||null,limitedText(input.servicePreference,60)||null,jsonbParameter(commercial),jsonbParameter(relationship),selected.rows[0].id,this.tenantId,ownerId])
        await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,after_data,created_at) VALUES ($1,$2,'client_updated','client',$3,$4,NOW())`,[this.tenantId,ownerId,selected.rows[0].id,jsonbParameter({name,municipality:input.municipality})])
      })
      const intelligence=await this.getIntelligence(ownerId);return intelligence.clients.find(item=>String(item.id)===String(clientId))||null
    }catch(error){if(error.statusCode)throw error;throw serviceError('O perfil do produtor não pôde ser atualizado no PostgreSQL.')}
  }

  async archiveClient(clientId,ownerId){
    if(!this.db.configured)throw serviceError('O PostgreSQL é obrigatório para excluir produtores.')
    try{const result=await this.db.query(`UPDATE clients SET status='archived',updated_at=NOW() WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' RETURNING id,name`,[this.tenantId,ownerId,clientId]);if(!result.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404);await this.db.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,created_at) VALUES ($1,$2,'client_archived','client',$3,$4,NOW())`,[this.tenantId,ownerId,result.rows[0].id,jsonbParameter({name:result.rows[0].name})]);return {id:clientId,name:result.rows[0].name,archived:true}}catch(error){if(error.statusCode)throw error;throw serviceError('O produtor não pôde ser removido da carteira.')}
  }

  async saveVisit(input,ownerId){
    const scheduledAt=parsedDate(input.scheduledAt);if(!scheduledAt)throw domainError('Informe data e horário válidos para a visita.',400)
    if(!this.db.configured){const store=this.fallback();const createdAt=new Date().toISOString();const record={id:randomUUID(),tenantId:this.tenantId,ownerId,clientId:input.clientId,scheduledAt,objective:String(input.objective||'').slice(0,2000),status:'Agendada',lifecycleStatus:'PLANNED',lifecycleVersion:'val.visit_lifecycle.v1',lifecycleRevision:0,lifecycleUpdatedAt:createdAt,lifecycleUpdatedBy:ownerId,createdAt,updatedAt:createdAt};store.visits.push(record);store.val.visitLifecycleEvents.push({id:randomUUID(),tenantId:this.tenantId,visitId:record.id,actorId:ownerId,contractVersion:'val.visit_lifecycle.v1',fromStatus:null,toStatus:'PLANNED',reasonCode:'VISIT_CREATED',revision:0,occurredAt:createdAt});this.saveStore(store);return record}
    const transaction=typeof this.db.transaction==='function'
      ? work=>this.db.transaction(work)
      : work=>work({query:(sql,params)=>this.db.query(sql,params)})
    try{return await transaction(async connection=>{const result=await connection.query(`INSERT INTO visits (tenant_id,client_id,consultant_id,scheduled_at,objective,status,lifecycle_status,lifecycle_version,lifecycle_revision,lifecycle_updated_at,lifecycle_updated_by,created_at,updated_at) SELECT $1,client.id,$3,$4,$5,$6,'PLANNED','val.visit_lifecycle.v1',0,NOW(),$3,NOW(),NOW() FROM clients client WHERE client.tenant_id=$1 AND client.consultant_id=$3 AND (client.id::text=$2 OR client.external_key=$2) RETURNING visits.*,(SELECT external_key FROM clients WHERE id=visits.client_id) client_external_key`,[this.tenantId,String(input.clientId||''),ownerId,scheduledAt,String(input.objective||'').trim().slice(0,2000),String(input.status||'Agendada').slice(0,30)]);if(!result.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404);await connection.query(`INSERT INTO val_visit_lifecycle_events (tenant_id,visit_id,actor_id,contract_version,from_status,to_status,reason_code,revision,metadata,occurred_at) VALUES ($1,$2,$3,'val.visit_lifecycle.v1',NULL,'PLANNED','VISIT_CREATED',0,'{}'::jsonb,NOW())`,[this.tenantId,result.rows[0].id,ownerId]);return visitRecord(result.rows[0])})}catch(error){if(error.statusCode)throw error;throw serviceError('A visita não pôde ser salva no PostgreSQL configurado.')}
  }

  async getVisit({tenantId=this.tenantId,ownerId,id}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){
      const visit=(this.readStore().visits||[]).find(item=>String(item.id)===String(id)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId))
      return visit?structuredClone(visit):null
    }
    try{
      const result=await this.db.query(`SELECT visit.*,client.external_key client_external_key FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$1 AND visit.id=$2 AND visit.consultant_id=$3 AND client.consultant_id=$3 LIMIT 1`,[tenantId,id,ownerId])
      return result.rows[0]?visitRecord(result.rows[0]):null
    }catch{throw serviceError('A visita não pôde ser recuperada no PostgreSQL configurado.')}
  }

  async startVisit({tenantId=this.tenantId,ownerId,actorId=ownerId,visitId,requestId,now=new Date().toISOString()}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(ownerId!=null&&String(actorId)!==String(ownerId))throw domainError('A visita pertence a outro usuário.',403)
    if(!this.db.configured){
      const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(visitId)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit)throw domainError('Visita não encontrada na carteira autorizada.',404)
      if(legacyVisitLifecycle(visit)==='IN_PROGRESS')return {visit:structuredClone(visit),idempotent:true}
      const lifecycle=transitionVisitLifecycle(visit,'IN_PROGRESS',{organizationId:tenantId,actorId,reasonCode:'VISIT_STARTED',requestId,now});Object.assign(visit,{status:'Em andamento',lifecycleStatus:lifecycle.status,lifecycleVersion:lifecycle.version,lifecycleRevision:lifecycle.revision,lifecycleUpdatedAt:lifecycle.updated_at,lifecycleUpdatedBy:lifecycle.updated_by,occurredAt:lifecycle.occurred_at,completedAt:lifecycle.completed_at,cancelledAt:lifecycle.cancelled_at,updatedAt:lifecycle.updated_at});store.val.visitLifecycleEvents.push({id:randomUUID(),tenantId,visitId:visit.id,actorId,contractVersion:lifecycle.version,fromStatus:lifecycle.transition.from_status,toStatus:lifecycle.status,reasonCode:lifecycle.transition.reason_code,requestId:lifecycle.transition.request_id,revision:lifecycle.revision,occurredAt:lifecycle.updated_at});this.saveStore(store);return {visit:structuredClone(visit),idempotent:false}
    }
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query(`SELECT visit.*,client.external_key client_external_key FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$1 AND visit.id=$2 AND visit.consultant_id=$3 AND client.consultant_id=$3 LIMIT 1 FOR UPDATE OF visit`,[tenantId,visitId,ownerId]);if(!selected.rowCount)throw domainError('Visita não encontrada na carteira autorizada.',404)
      const current=visitRecord(selected.rows[0]);if(legacyVisitLifecycle(current)==='IN_PROGRESS')return {visit:current,idempotent:true}
      const lifecycle=transitionVisitLifecycle(current,'IN_PROGRESS',{organizationId:tenantId,actorId,reasonCode:'VISIT_STARTED',requestId,now})
      const updated=await connection.query(`UPDATE visits SET status='Em andamento',lifecycle_status=$3,lifecycle_version=$4,lifecycle_revision=$5,lifecycle_updated_at=$6,lifecycle_updated_by=$7,occurred_at=$8,completed_at=$9,cancelled_at=$10,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND consultant_id=$7 RETURNING *`,[tenantId,visitId,lifecycle.status,lifecycle.version,lifecycle.revision,lifecycle.updated_at,actorId,lifecycle.occurred_at,lifecycle.completed_at,lifecycle.cancelled_at])
      await connection.query(`INSERT INTO val_visit_lifecycle_events (tenant_id,visit_id,actor_id,contract_version,from_status,to_status,reason_code,request_id,revision,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,$10)`,[tenantId,visitId,actorId,lifecycle.version,lifecycle.transition.from_status,lifecycle.status,lifecycle.transition.reason_code,lifecycle.transition.request_id,lifecycle.revision,lifecycle.updated_at])
      return {visit:visitRecord({...updated.rows[0],client_external_key:selected.rows[0].client_external_key}),idempotent:false}
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A visita não pôde ser iniciada no PostgreSQL configurado.')}
  }

  async createVoiceInteraction({tenantId=this.tenantId,ownerId,actorId=ownerId,clientId,visitId=null,interactionType,sourceContext={},id=randomUUID(),now=new Date().toISOString()}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(ownerId!=null&&String(actorId)!==String(ownerId))throw domainError('A captura de voz pertence a outro usuário.',403)
    if(!this.db.configured){
      const store=this.fallback();const visit=visitId?store.visits.find(item=>String(item.id)===String(visitId)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId)&&String(item.clientId)===String(clientId)):null
      if(visitId&&!visit)throw domainError('Visita não encontrada na carteira autorizada.',404)
      const row={id,tenant_id:tenantId,actor_id:actorId,client_id:clientId,client_external_key:clientId,visit_id:visitId,contract_version:'val.voice_interaction.v1',interaction_type:interactionType,status:'CREATED',confirmation_status:'PENDING',audio_ref:null,transcript_ref:null,transcript_status:'PENDING',duration_seconds:null,language:null,source_context:structuredClone(sourceContext),initial_candidates:[],reviewed_candidates:[],transcription_metadata:{},extraction_metadata:{},related_artifacts:{},retry_count:0,revision_no:1,error_code:null,error_message:null,processed_at:null,confirmed_at:null,cancelled_at:null,created_at:now,updated_at:now}
      store.val.voiceInteractions.push(row);store.val.voiceInteractions=store.val.voiceInteractions.slice(-2000);this.saveStore(store);return voiceInteractionRecord(row)
    }
    try{const result=await this.db.query(`INSERT INTO val_voice_interactions (id,tenant_id,actor_id,client_id,visit_id,contract_version,interaction_type,status,confirmation_status,transcript_status,source_context,created_at,updated_at) SELECT $1,$2,$3,client.id,$5,'val.voice_interaction.v1',$6,'CREATED','PENDING','PENDING',$7,$8,$8 FROM clients client WHERE client.tenant_id=$2 AND client.consultant_id=$3 AND client.status='active' AND (client.id::text=$4 OR client.external_key=$4) AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM visits visit WHERE visit.tenant_id=$2 AND visit.id=$5 AND visit.client_id=client.id AND visit.consultant_id=$3)) RETURNING val_voice_interactions.*,(SELECT external_key FROM clients WHERE id=val_voice_interactions.client_id) client_external_key`,[id,tenantId,actorId,String(clientId||''),visitId,interactionType,jsonbParameter(sourceContext),now]);if(!result.rowCount)throw domainError(visitId?'Visita não encontrada na carteira autorizada.':'Produtor não encontrado na carteira autorizada.',404);return voiceInteractionRecord(result.rows[0])}catch(error){if(error.statusCode)throw error;throw serviceError('A interação de voz não pôde ser criada no PostgreSQL configurado.')}
  }

  async getVoiceInteraction({tenantId=this.tenantId,ownerId,actorId=ownerId,id,includeTranscript=true}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(ownerId!=null&&String(actorId)!==String(ownerId))throw domainError('A captura de voz pertence a outro usuário.',403)
    if(!this.db.configured){
      const store=this.fallback();const row=store.val.voiceInteractions.find(item=>String(item.id)===String(id)&&String(item.tenant_id)===String(tenantId)&&String(item.actor_id)===String(actorId));if(!row)return null
      const transcript=includeTranscript&&row.latest_transcript_id?store.val.voiceTranscripts.find(item=>String(item.id)===String(row.latest_transcript_id)&&String(item.tenant_id)===String(tenantId)&&String(item.created_by)===String(actorId)):null
      return {...voiceInteractionRecord(row),transcript:transcript?voiceTranscriptRecord(transcript):null}
    }
    try{const result=await this.db.query(`SELECT voice.*,client.external_key client_external_key,transcript.created_by transcript_created_by,transcript.provider transcript_provider,transcript.model transcript_model,transcript.provider_version transcript_provider_version,transcript.provider_reference transcript_provider_reference,transcript.status transcript_status_row,${includeTranscript?'transcript.transcript_text':'NULL::text'} transcript_text,transcript.language transcript_language,transcript.duration_seconds transcript_duration_seconds,transcript.confidence transcript_confidence,transcript.attempt_no transcript_attempt_no,transcript.error_code transcript_error_code,transcript.metadata transcript_metadata,transcript.created_at transcript_created_at,transcript.updated_at transcript_updated_at,transcript.completed_at transcript_completed_at FROM val_voice_interactions voice JOIN clients client ON client.tenant_id=voice.tenant_id AND client.id=voice.client_id LEFT JOIN val_voice_transcripts transcript ON transcript.tenant_id=voice.tenant_id AND transcript.id=voice.latest_transcript_id WHERE voice.tenant_id=$1 AND voice.id=$2 AND voice.actor_id=$3 AND client.consultant_id=$3 LIMIT 1`,[tenantId,id,actorId]);return result.rows[0]?voiceInteractionRecord(result.rows[0]):null}catch{throw serviceError('A interação de voz não pôde ser recuperada no PostgreSQL configurado.')}
  }

  async updateVoiceInteraction({tenantId=this.tenantId,ownerId,actorId=ownerId,interaction,audioAttachmentId=null,expectedState=null,expectedRevision=null}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if((ownerId!=null&&String(actorId)!==String(ownerId))||String(interaction?.organization_id||tenantId)!==String(tenantId)||String(interaction?.actor_id||actorId)!==String(actorId))throw domainError('A captura de voz pertence a outro escopo.',403)
    const id=interaction?.voice_interaction_id??interaction?.id;const state=interaction?.state??interaction?.status
    if(!this.db.configured){
      const store=this.fallback();const index=store.val.voiceInteractions.findIndex(item=>String(item.id)===String(id)&&String(item.tenant_id)===String(tenantId)&&String(item.actor_id)===String(actorId));if(index<0)throw domainError('Interação de voz não encontrada.',404);if((expectedState&&store.val.voiceInteractions[index].status!==expectedState)||(expectedRevision!=null&&Number(store.val.voiceInteractions[index].revision_no)!==Number(expectedRevision)))throw domainError('A interação mudou durante esta operação. Atualize e tente novamente.',409)
      const previous=store.val.voiceInteractions[index];const row={...previous,audio_attachment_id:audioAttachmentId??previous.audio_attachment_id,audio_ref:interaction.audio_ref??previous.audio_ref,transcript_ref:interaction.transcript_ref??previous.transcript_ref,transcript_status:interaction.transcript_status??previous.transcript_status,duration_seconds:interaction.duration_seconds??previous.duration_seconds,language:interaction.language??previous.language,status:state??previous.status,confirmation_status:interaction.confirmation_status??previous.confirmation_status,source_context:structuredClone(interaction.source_context??previous.source_context),initial_candidates:structuredClone(interaction.candidates??interaction.initial_candidates??previous.initial_candidates),reviewed_candidates:structuredClone(interaction.reviewed_candidates??previous.reviewed_candidates),transcription_metadata:structuredClone(interaction.transcription_metadata??interaction.transcription??previous.transcription_metadata),extraction_metadata:structuredClone(interaction.extraction_metadata??interaction.extraction??previous.extraction_metadata),related_artifacts:structuredClone(interaction.related_artifacts??previous.related_artifacts),retry_count:Number(interaction.retry_count??previous.retry_count),revision_no:Number(interaction.revision??interaction.revision_no??previous.revision_no),error_code:interaction.error_code??null,error_message:interaction.error_message??null,processed_at:interaction.processed_at??previous.processed_at,confirmed_at:interaction.confirmed_at??previous.confirmed_at,cancelled_at:interaction.cancelled_at??previous.cancelled_at,updated_at:interaction.updated_at??new Date().toISOString()};store.val.voiceInteractions[index]=row;this.saveStore(store);return voiceInteractionRecord(row)
    }
    try{const result=await this.db.query(`UPDATE val_voice_interactions SET audio_attachment_id=COALESCE($4,audio_attachment_id),audio_ref=$5,transcript_ref=$6,transcript_status=$7,duration_seconds=$8,language=$9,status=$10,confirmation_status=$11,source_context=$12,initial_candidates=$13,reviewed_candidates=$14,transcription_metadata=$15,extraction_metadata=$16,related_artifacts=$17,retry_count=$18,revision_no=$19,error_code=$20,error_message=$21,processed_at=$22,confirmed_at=$23,cancelled_at=$24,updated_at=$25 WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 AND ($26::varchar IS NULL OR status=$26) AND ($27::integer IS NULL OR revision_no=$27) RETURNING val_voice_interactions.*,(SELECT external_key FROM clients WHERE tenant_id=$1 AND id=val_voice_interactions.client_id AND consultant_id=$3) client_external_key`,[tenantId,id,actorId,audioAttachmentId,interaction.audio_ref||null,interaction.transcript_ref||null,interaction.transcript_status||'PENDING',interaction.duration_seconds??null,interaction.language||null,state,interaction.confirmation_status||'PENDING',jsonbParameter(interaction.source_context||{}),jsonbParameter(interaction.candidates??interaction.initial_candidates??[]),jsonbParameter(interaction.reviewed_candidates||[]),jsonbParameter(interaction.transcription_metadata??interaction.transcription??{}),jsonbParameter(interaction.extraction_metadata??interaction.extraction??{}),jsonbParameter(interaction.related_artifacts||{}),Number(interaction.retry_count||0),Number(interaction.revision??interaction.revision_no??1),interaction.error_code||null,interaction.error_message||null,interaction.processed_at||null,interaction.confirmed_at||null,interaction.cancelled_at||null,interaction.updated_at||new Date().toISOString(),expectedState,expectedRevision]);if(!result.rowCount)throw domainError(expectedState||expectedRevision!=null?'A interação mudou durante esta operação. Atualize e tente novamente.':'Interação de voz não encontrada.',expectedState||expectedRevision!=null?409:404);return voiceInteractionRecord(result.rows[0])}catch(error){if(error.statusCode)throw error;throw serviceError('A interação de voz não pôde ser atualizada no PostgreSQL configurado.')}
  }

  async saveVoiceTranscript({tenantId=this.tenantId,ownerId,actorId=ownerId,processingLeaseId=null,transcript}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if((ownerId!=null&&String(actorId)!==String(ownerId))||String(transcript?.organization_id||tenantId)!==String(tenantId)||String(transcript?.created_by||actorId)!==String(actorId))throw domainError('A transcrição pertence a outro escopo.',403)
    const row={id:transcript.transcript_id||randomUUID(),tenant_id:tenantId,voice_interaction_id:transcript.voice_interaction_id,client_id:transcript.client_id,client_external_key:transcript.client_id,visit_id:transcript.visit_id||null,created_by:actorId,provider:transcript.provider,model:transcript.model,provider_version:transcript.provider_version||null,provider_reference:transcript.provider_reference||null,status:transcript.status,transcript_text:transcript.transcript_text||null,language:transcript.language||null,duration_seconds:transcript.duration_seconds??null,confidence:transcript.confidence??null,attempt_no:Number(transcript.attempt_no||1),error_code:transcript.error_code||null,metadata:structuredClone(transcript.metadata||{}),created_at:transcript.created_at||new Date().toISOString(),updated_at:transcript.updated_at||new Date().toISOString(),completed_at:transcript.completed_at||null}
    if(!this.db.configured){const store=this.fallback();const interaction=store.val.voiceInteractions.find(item=>String(item.id)===String(row.voice_interaction_id)&&String(item.tenant_id)===String(tenantId)&&String(item.actor_id)===String(actorId));if(!interaction)throw domainError('Interação de voz não encontrada.',404);const currentLease=interaction.related_artifacts?.processing_lease?.id;const allowed=row.provider==='manual'?interaction.status==='CREATED':interaction.status==='TRANSCRIBING'&&(!processingLeaseId||String(currentLease)===String(processingLeaseId));if(!allowed)throw domainError('A interação mudou antes da persistência da transcrição.',409,'voice_transcript_state_invalid');row.client_id=interaction.client_id;row.client_external_key=interaction.client_external_key||interaction.client_id;row.visit_id=interaction.visit_id;const index=store.val.voiceTranscripts.findIndex(item=>String(item.voice_interaction_id)===String(row.voice_interaction_id)&&Number(item.attempt_no)===row.attempt_no);if(index>=0)store.val.voiceTranscripts[index]=row;else store.val.voiceTranscripts.push(row);interaction.latest_transcript_id=row.id;interaction.updated_at=row.updated_at;this.saveStore(store);return voiceTranscriptRecord(row)}
    try{return await this.db.transaction(async connection=>{const selected=await connection.query(`SELECT voice.client_id,voice.visit_id,voice.status,voice.related_artifacts,client.external_key client_external_key FROM val_voice_interactions voice JOIN clients client ON client.tenant_id=voice.tenant_id AND client.id=voice.client_id WHERE voice.tenant_id=$1 AND voice.id=$2 AND voice.actor_id=$3 AND client.consultant_id=$3 LIMIT 1 FOR UPDATE OF voice`,[tenantId,row.voice_interaction_id,actorId]);if(!selected.rowCount)throw domainError('Interação de voz não encontrada.',404);const scope=selected.rows[0];const currentLease=jsonObject(scope.related_artifacts)?.processing_lease?.id;const allowed=row.provider==='manual'?scope.status==='CREATED':scope.status==='TRANSCRIBING'&&(!processingLeaseId||String(currentLease)===String(processingLeaseId));if(!allowed)throw domainError('A interação mudou antes da persistência da transcrição.',409,'voice_transcript_state_invalid');const result=await connection.query(`INSERT INTO val_voice_transcripts (id,tenant_id,voice_interaction_id,client_id,visit_id,created_by,provider,model,provider_version,provider_reference,status,transcript_text,language,duration_seconds,confidence,attempt_no,error_code,metadata,created_at,updated_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (tenant_id,voice_interaction_id,attempt_no) DO UPDATE SET provider=EXCLUDED.provider,model=EXCLUDED.model,provider_version=EXCLUDED.provider_version,provider_reference=EXCLUDED.provider_reference,status=EXCLUDED.status,transcript_text=EXCLUDED.transcript_text,language=EXCLUDED.language,duration_seconds=EXCLUDED.duration_seconds,confidence=EXCLUDED.confidence,error_code=EXCLUDED.error_code,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at,completed_at=EXCLUDED.completed_at RETURNING *`,[row.id,tenantId,row.voice_interaction_id,scope.client_id,scope.visit_id,actorId,row.provider,row.model,row.provider_version,row.provider_reference,row.status,row.transcript_text,row.language,row.duration_seconds,row.confidence,row.attempt_no,row.error_code,jsonbParameter(row.metadata),row.created_at,row.updated_at,row.completed_at]);const stored=result.rows[0];await connection.query(`UPDATE val_voice_interactions SET latest_transcript_id=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND actor_id=$3`,[tenantId,row.voice_interaction_id,actorId,stored.id,stored.updated_at]);return voiceTranscriptRecord({...stored,client_external_key:scope.client_external_key})})}catch(error){if(error.statusCode)throw error;throw serviceError('A transcrição não pôde ser persistida no PostgreSQL configurado.')}
  }

  async getVoiceTranscript({tenantId=this.tenantId,ownerId,actorId=ownerId,id}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(ownerId!=null&&String(actorId)!==String(ownerId))throw domainError('A transcrição pertence a outro usuário.',403)
    if(!this.db.configured){const store=this.fallback();const row=store.val.voiceTranscripts.find(item=>String(item.id)===String(id)&&String(item.tenant_id)===String(tenantId)&&String(item.created_by)===String(actorId));return row?voiceTranscriptRecord(row):null}
    try{const result=await this.db.query(`SELECT transcript.*,client.external_key client_external_key FROM val_voice_transcripts transcript JOIN val_voice_interactions voice ON voice.tenant_id=transcript.tenant_id AND voice.id=transcript.voice_interaction_id JOIN clients client ON client.tenant_id=voice.tenant_id AND client.id=voice.client_id WHERE transcript.tenant_id=$1 AND transcript.id=$2 AND transcript.created_by=$3 AND voice.actor_id=$3 AND client.consultant_id=$3 LIMIT 1`,[tenantId,id,actorId]);return result.rows[0]?voiceTranscriptRecord(result.rows[0]):null}catch{throw serviceError('A transcrição não pôde ser recuperada no PostgreSQL configurado.')}
  }

  async confirmVoiceInteraction({tenantId=this.tenantId,ownerId,actorId=ownerId,interactionId,reviewedCandidates=[],summary='',memories=[],commitments=[],opportunities=[],relatedArtifacts={},requestId,now=new Date().toISOString()}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(ownerId!=null&&String(actorId)!==String(ownerId))throw domainError('A confirmação pertence a outro usuário.',403)
    if(!this.db.configured){
      const store=this.fallback();const index=store.val.voiceInteractions.findIndex(item=>String(item.id)===String(interactionId)&&String(item.tenant_id)===String(tenantId)&&String(item.actor_id)===String(actorId));if(index<0)throw domainError('Interação de voz não encontrada.',404);const voice=store.val.voiceInteractions[index]
      if(voice.status==='CONFIRMED')return {voice_interaction:voiceInteractionRecord(voice),idempotent:true}
      if(voice.status!=='PENDING_REVIEW')throw domainError('A interação de voz ainda não está pronta para confirmação.',409)
      const interaction=store.interactions.find(item=>exactScope(item,tenantId,ownerId)&&String(item.source_external_id)===String(interactionId))||{id:randomUUID(),tenantId,ownerId,clientId:voice.client_external_key||voice.client_id,visit_id:voice.visit_id||null,channel:voice.audio_ref?'audio':'text',direction:'inbound',occurred_at:now,summary:String(summary||'').slice(0,10_000),commitments:structuredClone(commitments),source:'val_voice_interaction',source_external_id:interactionId,created_at:now};if(!store.interactions.includes(interaction))store.interactions.push(interaction)
      const memoryIds=[];for(const item of memories){if(!store.val.memories.some(entry=>String(entry.id)===String(item.id))){store.val.memories.push({...structuredClone(item),tenant_id:tenantId,client_id:voice.client_external_key||voice.client_id,tenantId,ownerId});memoryIds.push(item.id)}}
      const storedCommitments=[];for(const item of commitments){if(!store.val.commitments.some(entry=>String(entry.commitment_id)===String(item.commitment_id))){const stored={...structuredClone(item),tenantId,ownerId,updated_at:item.created_at};store.val.commitments.push(stored);storedCommitments.push(stored)}}
      const storedOpportunities=[];for(const item of opportunities){let existing=store.opportunities.find(entry=>exactScope(entry,tenantId,ownerId)&&String(entry.clientId)===String(voice.client_external_key||voice.client_id)&&String(entry.candidateKey)===String(item.candidate_key));if(!existing){existing={id:`o-${randomUUID()}`,tenantId,ownerId,clientId:voice.client_external_key||voice.client_id,title:item.title,category:item.category,hypothesis:item.hypothesis,value:Number(item.estimated_value||0),stage:item.stage||'Diagnóstico',nextAction:item.next_action||'',nextActionAt:item.next_action_at||null,candidateKey:item.candidate_key,evidence:structuredClone(item.evidence||[]),updatedAt:now};store.opportunities.push(existing)}storedOpportunities.push(existing)}
      const artifacts={...structuredClone(relatedArtifacts),interaction_id:interaction.id,memory_ids:memoryIds,commitment_ids:storedCommitments.map(item=>item.commitment_id),opportunity_ids:storedOpportunities.map(item=>item.id)};Object.assign(voice,{status:'CONFIRMED',confirmation_status:'CONFIRMED',reviewed_candidates:structuredClone(reviewedCandidates),related_artifacts:artifacts,confirmed_at:now,processed_at:voice.processed_at||now,revision_no:Number(voice.revision_no||1)+1,error_code:null,error_message:null,updated_at:now});const attachment=store.val.attachments.find(item=>String(item.id)===String(voice.audio_attachment_id)&&String(item.ownerId)===String(ownerId));if(attachment){attachment.status='confirmed';attachment.confirmed_at=now;attachment.updated_at=now}this.saveStore(store);return {voice_interaction:voiceInteractionRecord(voice),interaction:structuredClone(interaction),commitments:structuredClone(storedCommitments),opportunities:structuredClone(storedOpportunities),memories_written:memoryIds,idempotent:false}
    }
    try{return await this.db.transaction(async connection=>{const selected=await connection.query(`SELECT voice.*,client.external_key client_external_key FROM val_voice_interactions voice JOIN clients client ON client.tenant_id=voice.tenant_id AND client.id=voice.client_id WHERE voice.tenant_id=$1 AND voice.id=$2 AND voice.actor_id=$3 AND client.consultant_id=$3 LIMIT 1 FOR UPDATE OF voice`,[tenantId,interactionId,actorId]);if(!selected.rowCount)throw domainError('Interação de voz não encontrada.',404);const voice=selected.rows[0]
      if(voice.status==='CONFIRMED')return {voice_interaction:voiceInteractionRecord(voice),idempotent:true}
      if(voice.status!=='PENDING_REVIEW')throw domainError('A interação de voz ainda não está pronta para confirmação.',409)
      const interaction=await connection.query(`INSERT INTO interactions (id,tenant_id,client_id,visit_id,channel,direction,occurred_at,summary,commitments,source,source_external_id,created_at) VALUES ($1,$2,$3,$4,$5,'inbound',$6,$7,$8,'val_voice_interaction',$9,$6) ON CONFLICT (tenant_id,source,source_external_id) DO UPDATE SET summary=EXCLUDED.summary,commitments=EXCLUDED.commitments RETURNING *`,[randomUUID(),tenantId,voice.client_id,voice.visit_id,voice.audio_ref?'audio':'text',now,String(summary||'').slice(0,10_000),jsonbParameter(commitments),interactionId])
      const memoryIds=[];for(const memory of memories){await connection.query(`INSERT INTO val_memories (id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,confidence,status,source,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,valid_from,valid_until,created_by,acl,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,[memory.id,tenantId,voice.client_id,memory.subject_type,memory.subject_id,memory.memory_type,memory.memory_state,memory.memory_domain,memory.key,jsonbParameter(memory.value),jsonbParameter(memory.evidence),memory.confidence,memory.status,memory.source,memory.source_ref,memory.source_type,memory.observed_at,memory.source_updated_at,memory.freshness_policy_version,jsonbParameter(memory.freshness_metadata),memory.valid_from,memory.valid_until,memory.created_by,jsonbParameter(memory.acl)]);memoryIds.push(memory.id)}
      const storedCommitments=[];for(const commitment of commitments){const inserted=await connection.query(`INSERT INTO val_commitments (id,tenant_id,client_id,visit_id,opportunity_id,action_plan_id,action_id,description,owner_type,owner_id,due_at,status,success_criteria,agreed_with_client,evidence_refs,source_ref,audit,created_at,updated_at,completed_at,cancelled_at) VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,NULL,NULL) ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description,due_at=EXCLUDED.due_at,success_criteria=EXCLUDED.success_criteria,evidence_refs=EXCLUDED.evidence_refs,audit=EXCLUDED.audit,updated_at=EXCLUDED.updated_at RETURNING *`,[commitment.commitment_id,tenantId,voice.client_id,voice.visit_id,commitment.action_id||null,commitment.description,commitment.owner_type,commitment.owner_id,commitment.due_at,commitment.status,commitment.success_criteria,commitment.agreed_with_client,jsonbParameter(commitment.evidence_refs),commitment.source_ref,jsonbParameter(commitment.audit),commitment.created_at]);storedCommitments.push(commitmentRecord({...inserted.rows[0],client_external_key:voice.client_external_key}))}
      const storedOpportunities=[];for(const item of opportunities){const externalKey=`voice:${createHash('sha256').update(String(item.candidate_key)).digest('hex').slice(0,64)}`;const inserted=await connection.query(`INSERT INTO opportunities (tenant_id,client_id,external_key,title,category,hypothesis,estimated_value,stage,next_action,next_action_at,evidence,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) ON CONFLICT (tenant_id,client_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,hypothesis=EXCLUDED.hypothesis,next_action=EXCLUDED.next_action,evidence=EXCLUDED.evidence,updated_at=EXCLUDED.updated_at RETURNING *`,[tenantId,voice.client_id,externalKey,item.title,item.category,item.hypothesis,item.estimated_value??0,item.stage||'Diagnóstico',item.next_action||'',item.next_action_at||null,jsonbParameter(item.evidence||[]),now]);storedOpportunities.push(opportunityRecord({...inserted.rows[0],client_external_key:voice.client_external_key}))}
      const artifacts={...relatedArtifacts,interaction_id:interaction.rows[0].id,memory_ids:memoryIds,commitment_ids:storedCommitments.map(item=>item.commitment_id),opportunity_ids:storedOpportunities.map(item=>item.databaseId)};const updated=await connection.query(`UPDATE val_voice_interactions SET status='CONFIRMED',confirmation_status='CONFIRMED',reviewed_candidates=$4,related_artifacts=$5,confirmed_at=$6,processed_at=COALESCE(processed_at,$6),revision_no=revision_no+1,error_code=NULL,error_message=NULL,updated_at=$6 WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 AND status='PENDING_REVIEW' RETURNING *`,[tenantId,interactionId,actorId,jsonbParameter(reviewedCandidates),jsonbParameter(artifacts),now]);if(!updated.rowCount)throw domainError('A interação deixou de estar pendente antes da confirmação.',409)
      if(voice.audio_attachment_id)await connection.query(`UPDATE val_attachments SET status='confirmed',analysis=analysis||$4::jsonb,confirmed_at=$5,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND consultant_id=$3`,[tenantId,voice.audio_attachment_id,actorId,jsonbParameter({kind:'voice_capture',voiceInteractionId:interactionId,processingStatus:'confirmed',retentionClass:'voice_raw_temporary'}),now])
      await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,after_data,correlation_id,created_at) VALUES ($1,$2,'voice_interaction_confirmed','voice_interaction',$3,$4,$5,$6)`,[tenantId,actorId,interactionId,jsonbParameter({interaction_id:interaction.rows[0].id,memory_ids:memoryIds,commitment_ids:storedCommitments.map(item=>item.commitment_id),opportunity_ids:storedOpportunities.map(item=>item.databaseId)}),requestId||null,now])
      return {voice_interaction:voiceInteractionRecord({...updated.rows[0],client_external_key:voice.client_external_key}),interaction:{...interaction.rows[0],clientId:voice.client_external_key},commitments:storedCommitments,opportunities:storedOpportunities,memories_written:memoryIds,idempotent:false}
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A confirmação de voz não pôde ser persistida no PostgreSQL configurado.')}
  }

  async claimVoicePreparation({tenantId=this.tenantId,ownerId,actorId=ownerId,interactionId,requestId,now=new Date().toISOString(),leaseSeconds=900}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(ownerId!=null&&String(actorId)!==String(ownerId))throw domainError('A preparação pertence a outro usuário.',403)
    const at=new Date(now||Date.now()).toISOString();const claimId=randomUUID();const leaseMs=Math.max(60,Number(leaseSeconds)||900)*1000;const anchorMs=new Date(at).getTime()
    const status=value=>String(value||'').toUpperCase()
    const fresh=artifacts=>{const claimedAt=new Date(artifacts?.preparation_claimed_at||0).getTime();return status(artifacts?.preparation_status)==='PREPARING'&&Number.isFinite(claimedAt)&&anchorMs-claimedAt>=0&&anchorMs-claimedAt<leaseMs}
    if(!this.db.configured){
      const store=this.fallback();const voice=store.val.voiceInteractions.find(item=>String(item.id)===String(interactionId)&&String(item.tenant_id)===String(tenantId)&&String(item.actor_id)===String(actorId));if(!voice)throw domainError('Interação de voz não encontrada.',404)
      if(voice.status!=='CONFIRMED'||voice.interaction_type!=='PRE_VISIT')throw domainError('A interação pré-visita ainda não está confirmada.',409)
      const existing=store.val.visitPreparations.find(item=>String(item.tenantId)===String(tenantId)&&String(item.visitId)===String(voice.visit_id)&&String(item.preparedBy)===String(actorId)&&String(item.requestId)===String(requestId))
      if(existing){voice.related_artifacts={...voice.related_artifacts,preparation_status:'COMPLETED',preparation_id:existing.preparationId,context_snapshot_id:existing.contextSnapshotId,action_plan_id:existing.actionPlanId,preparation_claim_id:null};voice.updated_at=at;voice.revision_no=Number(voice.revision_no||1)+1;this.saveStore(store);return {claimed:false,completed:true,voice_interaction:voiceInteractionRecord(voice)}}
      if(fresh(voice.related_artifacts))return {claimed:false,in_progress:true,voice_interaction:voiceInteractionRecord(voice)}
      voice.related_artifacts={...voice.related_artifacts,preparation_status:'PREPARING',preparation_claim_id:claimId,preparation_claimed_at:at,preparation_request_id:requestId};voice.updated_at=at;voice.revision_no=Number(voice.revision_no||1)+1;this.saveStore(store);return {claimed:true,claim_id:claimId,voice_interaction:voiceInteractionRecord(voice)}
    }
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query(`SELECT voice.*,client.external_key client_external_key FROM val_voice_interactions voice JOIN clients client ON client.tenant_id=voice.tenant_id AND client.id=voice.client_id WHERE voice.tenant_id=$1 AND voice.id=$2 AND voice.actor_id=$3 AND client.consultant_id=$3 LIMIT 1 FOR UPDATE OF voice`,[tenantId,interactionId,actorId]);if(!selected.rowCount)throw domainError('Interação de voz não encontrada.',404);const voice=selected.rows[0]
      if(voice.status!=='CONFIRMED'||voice.interaction_type!=='PRE_VISIT')throw domainError('A interação pré-visita ainda não está confirmada.',409)
      const existing=await connection.query(`SELECT preparation_id,context_snapshot_id,action_plan_id FROM val_visit_preparations WHERE tenant_id=$1 AND visit_id=$2 AND prepared_by=$3 AND request_id=$4 ORDER BY version_no DESC LIMIT 1`,[tenantId,voice.visit_id,actorId,requestId])
      if(existing.rowCount){const artifacts={...jsonObject(voice.related_artifacts),preparation_status:'COMPLETED',preparation_id:existing.rows[0].preparation_id,context_snapshot_id:String(existing.rows[0].context_snapshot_id),action_plan_id:String(existing.rows[0].action_plan_id),preparation_claim_id:null};const updated=await connection.query(`UPDATE val_voice_interactions SET related_artifacts=$4,revision_no=revision_no+1,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 RETURNING *`,[tenantId,interactionId,actorId,jsonbParameter(artifacts),at]);return {claimed:false,completed:true,voice_interaction:voiceInteractionRecord({...updated.rows[0],client_external_key:voice.client_external_key})}}
      const artifacts=jsonObject(voice.related_artifacts)
      if(fresh(artifacts))return {claimed:false,in_progress:true,voice_interaction:voiceInteractionRecord({...voice,client_external_key:voice.client_external_key})}
      const claimedArtifacts={...artifacts,preparation_status:'PREPARING',preparation_claim_id:claimId,preparation_claimed_at:at,preparation_request_id:requestId};const updated=await connection.query(`UPDATE val_voice_interactions SET related_artifacts=$4,revision_no=revision_no+1,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 RETURNING *`,[tenantId,interactionId,actorId,jsonbParameter(claimedArtifacts),at]);return {claimed:true,claim_id:claimId,voice_interaction:voiceInteractionRecord({...updated.rows[0],client_external_key:voice.client_external_key})}
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A preparação por voz não pôde ser coordenada no PostgreSQL configurado.')}
  }

  async saveActionPlan({tenantId=this.tenantId,ownerId,clientId,visitId=null,plan,preparation=null,contextSnapshot=null,decisionThesisVersion,valuePlanVersion}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(String(plan?.organization_id||'')!==String(tenantId))throw domainError('O ActionPlan pertence a outra organização.',403)
    assertExecutionContract(plan,validateActionPlan,'ActionPlan v1')
    if(contextSnapshot&&String(contextSnapshot.organization_id||'')!==String(tenantId))throw domainError('O ContextSnapshot pertence a outra organização.',403)
    const thesisVersion=String(decisionThesisVersion||preparation?.decision_thesis_version||'').trim()
    const planValueVersion=String(valuePlanVersion||preparation?.value_plan_version||'').trim()
    if(!thesisVersion||!planValueVersion)throw domainError('As versões da tese e do plano de valor são obrigatórias.',422)
    if(!this.db.configured){
      const store=this.fallback();const visit=visitId?(store.visits||[]).find(item=>String(item.id)===String(visitId)&&String(item.ownerId??ownerId)===String(ownerId)&&String(item.tenantId||tenantId)===String(tenantId)):null
      if(visitId&&!visit)throw domainError('Visita não encontrada na carteira autorizada.',404)
      const stored={...structuredClone(plan),tenantId,ownerId,clientId,visit_id:visitId,decision_thesis_version:thesisVersion,value_plan_version:planValueVersion,status:'PROPOSED',preparation:preparation?structuredClone(preparation):null}
      store.val.actionPlans=store.val.actionPlans.filter(item=>String(item.action_plan_id)!==String(plan.action_plan_id));store.val.actionPlans.push(stored);store.val.actionPlans=store.val.actionPlans.slice(-1000)
      if(contextSnapshot&&!store.val.contextSnapshots.some(item=>String(item.id)===String(contextSnapshot.context_snapshot_id)))store.val.contextSnapshots.push({id:contextSnapshot.context_snapshot_id,tenantId,ownerId,requestId:contextSnapshot.request_id||null,subject:contextSnapshot.subject,objective:contextSnapshot.objective,contractVersion:contextSnapshot.contract_version,selectionPolicyVersion:contextSnapshot.selection?.policy_version,freshnessPolicyVersion:contextSnapshot.freshness?.policy_version,selectedRefs:[...(contextSnapshot.selection?.selected_refs||[])],excludedRefs:[...(contextSnapshot.selection?.excluded_refs||[])],exclusionReasonCodes:[...new Set((contextSnapshot.selection?.exclusion_reason_codes||[]).flatMap(item=>item?.reason_codes||[]))],snapshot:structuredClone(contextSnapshot),createdAt:new Date().toISOString()})
      if(preparation&&visit){
        const actorId=ownerId??plan.priorities?.find(item=>item?.owner?.id)?.owner?.id??'demo@valor360.local';const versions=store.val.visitPreparations.filter(item=>String(item.tenantId)===String(tenantId)&&String(item.visitId)===String(visitId));const versionNo=versions.length?Math.max(...versions.map(item=>Number(item.versionNo)||0))+1:1
        store.val.visitPreparations.push({id:randomUUID(),tenantId,visitId,clientId,preparedBy:actorId,versionNo,preparationId:preparation.preparation_id,contractVersion:preparation.contract_version,contextSnapshotId:preparation.context_snapshot_id,behavioralProfileVersion:preparation.behavioral_profile_version,decisionThesisId:preparation.decision_thesis_id,decisionThesisVersion:preparation.decision_thesis_version,valuePlanId:preparation.value_plan_id,valuePlanVersion:preparation.value_plan_version,actionPlanId:plan.action_plan_id,preparation:structuredClone(preparation),requestId:contextSnapshot?.request_id||null,preparedAt:preparation.created_at})
        const lifecycle=transitionVisitLifecycle(visit,'PREPARED',{organizationId:tenantId,actorId,reasonCode:versionNo===1?'VISIT_PREPARED':'VISIT_PREPARATION_REGENERATED',requestId:contextSnapshot?.request_id,now:preparation.created_at});Object.assign(visit,{lifecycleStatus:lifecycle.status,lifecycleVersion:lifecycle.version,lifecycleRevision:lifecycle.revision,lifecycleUpdatedAt:lifecycle.updated_at,lifecycleUpdatedBy:lifecycle.updated_by,occurredAt:lifecycle.occurred_at,completedAt:lifecycle.completed_at,cancelledAt:lifecycle.cancelled_at,updatedAt:lifecycle.updated_at});store.val.visitLifecycleEvents.push({id:randomUUID(),tenantId,visitId,actorId,contractVersion:lifecycle.version,fromStatus:lifecycle.transition.from_status,toStatus:lifecycle.status,reasonCode:lifecycle.transition.reason_code,requestId:lifecycle.transition.request_id,revision:lifecycle.revision,occurredAt:lifecycle.updated_at})
      }
      this.saveStore(store);return stored
    }
    try{return await this.db.transaction(async connection=>{
      const client=await connection.query(`SELECT id,external_key FROM clients WHERE tenant_id=$1 AND consultant_id=$3 AND (id::text=$2 OR external_key=$2) AND status='active' LIMIT 1`,[tenantId,clientId,ownerId])
      if(!client.rowCount)throw domainError('Produtor não encontrado na carteira autorizada.',404)
      let linkedVisit=null
      if(visitId){const visit=await connection.query(`SELECT * FROM visits WHERE tenant_id=$1 AND id=$2 AND client_id=$3 AND consultant_id=$4 LIMIT 1 FOR UPDATE`,[tenantId,visitId,client.rows[0].id,ownerId]);if(!visit.rowCount)throw domainError('Visita não encontrada na carteira autorizada.',404);linkedVisit=visit.rows[0]}
      if(!contextSnapshot||String(contextSnapshot.context_snapshot_id)!==String(plan.context_snapshot_id))throw domainError('O ActionPlan exige o ContextSnapshot rastreável correspondente.',422)
      const selectedRefs=[...new Set(contextSnapshot.selection?.selected_refs||[])];const excludedRefs=[...new Set(contextSnapshot.selection?.excluded_refs||[])];const exclusionReasonCodes=[...new Set((contextSnapshot.selection?.exclusion_reason_codes||[]).flatMap(item=>item?.reason_codes||[]))]
      await connection.query(`INSERT INTO val_context_snapshots (id,tenant_id,request_id,actor_id,subject_type,subject_id,objective,contract_version,selection_policy_version,freshness_policy_version,selected_refs,excluded_refs,exclusion_reason_codes,confidence_level,snapshot_payload,generated_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()) ON CONFLICT (id) DO NOTHING`,[contextSnapshot.context_snapshot_id,tenantId,contextSnapshot.request_id||null,ownerId,contextSnapshot.subject?.type,contextSnapshot.subject?.id,contextSnapshot.objective,contextSnapshot.contract_version,contextSnapshot.selection?.policy_version,contextSnapshot.freshness?.policy_version,selectedRefs,excludedRefs,exclusionReasonCodes,contextSnapshot.confidence?.level||null,jsonbParameter(contextSnapshot),contextSnapshot.freshness?.generated_at])
      const inserted=await connection.query(`INSERT INTO val_action_plans (id,tenant_id,client_id,visit_id,owner_user_id,context_snapshot_id,contract_version,decision_thesis_id,decision_thesis_version,value_plan_id,value_plan_version,status,priorities,preparation_payload,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PROPOSED',$12,$13,$14,$15) ON CONFLICT (id) DO UPDATE SET preparation_payload=COALESCE(EXCLUDED.preparation_payload,val_action_plans.preparation_payload),updated_at=EXCLUDED.updated_at WHERE val_action_plans.tenant_id=EXCLUDED.tenant_id AND val_action_plans.owner_user_id=EXCLUDED.owner_user_id RETURNING *`,[plan.action_plan_id,tenantId,client.rows[0].id,visitId,ownerId,plan.context_snapshot_id,plan.contract_version,plan.decision_thesis_id,thesisVersion,plan.value_plan_id,planValueVersion,jsonbParameter(plan.priorities),preparation?jsonbParameter(preparation):null,plan.created_at,plan.updated_at])
      if(!inserted.rowCount)throw domainError('ActionPlan já existe fora do escopo autorizado.',409)
      if(preparation&&linkedVisit){
        await connection.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0))`,[tenantId,visitId])
        const versionResult=await connection.query(`SELECT COALESCE(MAX(version_no),0)::int+1 AS version_no FROM val_visit_preparations WHERE tenant_id=$1 AND visit_id=$2`,[tenantId,visitId]);const versionNo=Number(versionResult.rows[0]?.version_no||1)
        await connection.query(`INSERT INTO val_visit_preparations (tenant_id,visit_id,client_id,prepared_by,version_no,preparation_id,contract_version,context_snapshot_id,behavioral_profile_version,decision_thesis_id,decision_thesis_version,value_plan_id,value_plan_version,action_plan_id,preparation_payload,request_id,prepared_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[tenantId,visitId,client.rows[0].id,ownerId,versionNo,preparation.preparation_id,preparation.contract_version,preparation.context_snapshot_id,preparation.behavioral_profile_version,preparation.decision_thesis_id,preparation.decision_thesis_version,preparation.value_plan_id,preparation.value_plan_version,plan.action_plan_id,jsonbParameter(preparation),contextSnapshot.request_id||null,preparation.created_at])
        const lifecycle=transitionVisitLifecycle(visitRecord(linkedVisit),'PREPARED',{organizationId:tenantId,actorId:ownerId,reasonCode:versionNo===1?'VISIT_PREPARED':'VISIT_PREPARATION_REGENERATED',requestId:contextSnapshot.request_id,now:preparation.created_at})
        await connection.query(`UPDATE visits SET lifecycle_status=$3,lifecycle_version=$4,lifecycle_revision=$5,lifecycle_updated_at=$6,lifecycle_updated_by=$7,occurred_at=$8,completed_at=$9,cancelled_at=$10,updated_at=NOW() WHERE tenant_id=$1 AND id=$2`,[tenantId,visitId,lifecycle.status,lifecycle.version,lifecycle.revision,lifecycle.updated_at,ownerId,lifecycle.occurred_at,lifecycle.completed_at,lifecycle.cancelled_at])
        await connection.query(`INSERT INTO val_visit_lifecycle_events (tenant_id,visit_id,actor_id,contract_version,from_status,to_status,reason_code,request_id,revision,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,$10)`,[tenantId,visitId,ownerId,lifecycle.version,lifecycle.transition.from_status,lifecycle.status,lifecycle.transition.reason_code,lifecycle.transition.request_id,lifecycle.revision,lifecycle.updated_at])
      }
      return actionPlanRecord({...inserted.rows[0],client_external_key:client.rows[0].external_key})
    })}catch(error){if(error.statusCode)throw error;throw serviceError('O ActionPlan não pôde ser salvo no PostgreSQL configurado.')}
  }

  async getVisitPreparation({tenantId=this.tenantId,ownerId,visitId,preparationId=null}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){const plan=this.fallback().val.actionPlans.filter(item=>String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)&&String(item.visit_id)===String(visitId)&&(!preparationId||String(item.preparation?.preparation_id)===String(preparationId))).at(-1);return plan?.preparation?{action_plan:structuredClone(plan),preparation:structuredClone(plan.preparation)}:null}
    try{
      const result=await this.db.query(`SELECT plan.*,client.external_key client_external_key FROM val_action_plans plan JOIN clients client ON client.tenant_id=plan.tenant_id AND client.id=plan.client_id JOIN visits visit ON visit.tenant_id=plan.tenant_id AND visit.id=plan.visit_id AND visit.client_id=plan.client_id WHERE plan.tenant_id=$1 AND plan.visit_id=$2 AND plan.owner_user_id=$3 AND visit.consultant_id=$3 AND client.consultant_id=$3 AND ($4::uuid IS NULL OR (plan.preparation_payload->>'preparation_id')::uuid=$4) ORDER BY plan.created_at DESC LIMIT 1`,[tenantId,visitId,ownerId,preparationId])
      if(!result.rows[0])return null
      const actionPlan=actionPlanRecord(result.rows[0]);return actionPlan.preparation?{action_plan:actionPlan,preparation:actionPlan.preparation}:null
    }catch{throw serviceError('A preparação da visita não pôde ser recuperada no PostgreSQL configurado.')}
  }

  async saveVisitTranscript({tenantId=this.tenantId,ownerId,transcript}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(String(transcript?.organization_id||'')!==String(tenantId))throw domainError('O transcript pertence a outra organização.',403)
    if(!this.db.configured){
      const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(transcript.visit_id)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit)throw domainError('Visita não encontrada na carteira autorizada.',404)
      if(transcript.source_attachment_id){const attachment=store.val.attachments.find(item=>String(item.id)===String(transcript.source_attachment_id)&&String(item.ownerId??ownerId)===String(ownerId)&&String(item.clientId)===String(visit.clientId));if(!attachment)throw domainError('Áudio não encontrado na carteira autorizada.',404)}
      const stored={...structuredClone(transcript),tenantId,ownerId};store.val.visitTranscripts=store.val.visitTranscripts.filter(item=>String(item.transcript_id)!==String(stored.transcript_id));store.val.visitTranscripts.push(stored);this.saveStore(store);return stored
    }
    try{
      const result=await this.db.query(`INSERT INTO val_visit_transcripts (id,tenant_id,visit_id,client_id,created_by,interaction_id,source_attachment_id,contract_version,provider,provider_reference,language,status,transcript_text,error_code,metadata,created_at,updated_at,completed_at)
        SELECT $1,$2,visit.id,visit.client_id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id
        WHERE visit.tenant_id=$2 AND visit.id=$17 AND visit.consultant_id=$3 AND client.consultant_id=$3
          AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM val_attachments attachment WHERE attachment.tenant_id=$2 AND attachment.id=$5 AND attachment.client_id=visit.client_id AND attachment.consultant_id=$3))
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,transcript_text=EXCLUDED.transcript_text,error_code=EXCLUDED.error_code,provider_reference=EXCLUDED.provider_reference,language=EXCLUDED.language,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at,completed_at=EXCLUDED.completed_at
        WHERE val_visit_transcripts.tenant_id=EXCLUDED.tenant_id AND val_visit_transcripts.created_by=EXCLUDED.created_by
        RETURNING *`,[transcript.transcript_id,tenantId,ownerId,transcript.interaction_id||null,transcript.source_attachment_id||null,transcript.contract_version,transcript.provider,transcript.provider_reference||null,transcript.language||null,transcript.status,transcript.transcript_text||null,transcript.error_code||null,jsonbParameter(transcript.metadata||{}),transcript.created_at,transcript.updated_at,transcript.completed_at||null,transcript.visit_id])
      if(!result.rowCount)throw domainError('Visita ou áudio não encontrado na carteira autorizada.',404)
      return transcriptRecord({...result.rows[0],client_external_key:transcript.client_id})
    }catch(error){if(error.statusCode)throw error;throw serviceError('O transcript da visita não pôde ser salvo no PostgreSQL configurado.')}
  }

  async saveVisitReport({tenantId=this.tenantId,ownerId,report,requestId,now}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(String(report?.organization_id||'')!==String(tenantId))throw domainError('O report pertence a outra organização.',403)
    if(String(report?.created_by||'')!==String(ownerId??report?.created_by??''))throw domainError('O report não pertence ao ator autorizado.',403)
    if(!this.db.configured){
      const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(report.visit_id)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit||String(visit.clientId)!==String(report.client_id))throw domainError('Visita não encontrada na carteira autorizada.',404)
      const duplicate=store.val.visitReports.find(item=>String(item.tenantId)===String(tenantId)&&String(item.visit_id)===String(report.visit_id)&&String(item.idempotency_key)===String(report.idempotency_key));if(duplicate)return structuredClone(duplicate)
      const stored={...structuredClone(report),tenantId,ownerId};store.val.visitReports.push(stored)
      const lifecycle=transitionVisitLifecycle(visit,'COMPLETED_PENDING_REVIEW',{organizationId:tenantId,actorId:ownerId??report.created_by,reasonCode:'VISIT_REPORT_CREATED',requestId,now});Object.assign(visit,{lifecycleStatus:lifecycle.status,lifecycleVersion:lifecycle.version,lifecycleRevision:lifecycle.revision,lifecycleUpdatedAt:lifecycle.updated_at,lifecycleUpdatedBy:lifecycle.updated_by,occurredAt:lifecycle.occurred_at,updatedAt:lifecycle.updated_at});store.val.visitLifecycleEvents.push({id:randomUUID(),tenantId,visitId:visit.id,actorId:ownerId??report.created_by,contractVersion:lifecycle.version,fromStatus:lifecycle.transition.from_status,toStatus:lifecycle.status,reasonCode:lifecycle.transition.reason_code,requestId:lifecycle.transition.request_id,revision:lifecycle.revision,occurredAt:lifecycle.updated_at});this.saveStore(store);return stored
    }
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query(`SELECT visit.*,client.external_key client_external_key FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$1 AND visit.id=$2 AND visit.consultant_id=$3 AND client.consultant_id=$3 LIMIT 1 FOR UPDATE OF visit`,[tenantId,report.visit_id,ownerId]);if(!selected.rowCount||String(selected.rows[0].client_external_key)!==String(report.client_id))throw domainError('Visita não encontrada na carteira autorizada.',404)
      const row=selected.rows[0]
      const inserted=await connection.query(`INSERT INTO val_visit_reports (id,tenant_id,visit_id,client_id,created_by,confirmed_by,transcript_id,contract_version,source_type,source_ref,transcript_ref,visit_objective,summary,discussed_topics,expectations_created,objections,producer_signals,opportunities_detected,commitments_proposed,commitments_confirmed,closed_business,pending_business,next_steps,technical_observations,behavioral_signals,missing_information,consultant_notes,confidence,confirmation_status,revision_no,idempotency_key,initial_extraction,confirmed_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'PENDING_REVIEW',$28,$29,$30,NULL,$31,$31)
        ON CONFLICT (tenant_id,visit_id,idempotency_key) DO NOTHING RETURNING *`,[report.visit_report_id,tenantId,row.id,row.client_id,ownerId,report.transcript_id||null,report.contract_version,report.source_type,report.source_ref,report.transcript_ref||null,report.visit_objective,report.summary,jsonbParameter(report.discussed_topics),jsonbParameter(report.expectations_created),jsonbParameter(report.objections),jsonbParameter(report.producer_signals),jsonbParameter(report.opportunities_detected),jsonbParameter(report.commitments_proposed),jsonbParameter(report.commitments_confirmed),jsonbParameter(report.closed_business),jsonbParameter(report.pending_business),jsonbParameter(report.next_steps),jsonbParameter(report.technical_observations),jsonbParameter(report.behavioral_signals),jsonbParameter(report.missing_information),report.consultant_notes||null,report.confidence,report.revision_no,report.idempotency_key,jsonbParameter(report),report.created_at])
      if(!inserted.rowCount){const existing=await connection.query(`SELECT * FROM val_visit_reports WHERE tenant_id=$1 AND visit_id=$2 AND idempotency_key=$3 AND created_by=$4 LIMIT 1`,[tenantId,row.id,report.idempotency_key,ownerId]);return visitReportRecord({...existing.rows[0],client_external_key:row.client_external_key})}
      const lifecycle=transitionVisitLifecycle(visitRecord(row),'COMPLETED_PENDING_REVIEW',{organizationId:tenantId,actorId:ownerId,reasonCode:'VISIT_REPORT_CREATED',requestId,now})
      await connection.query(`UPDATE visits SET lifecycle_status=$3,lifecycle_version=$4,lifecycle_revision=$5,lifecycle_updated_at=$6,lifecycle_updated_by=$7,occurred_at=COALESCE(occurred_at,$8),updated_at=NOW() WHERE tenant_id=$1 AND id=$2`,[tenantId,row.id,lifecycle.status,lifecycle.version,lifecycle.revision,lifecycle.updated_at,ownerId,lifecycle.occurred_at])
      await connection.query(`INSERT INTO val_visit_lifecycle_events (tenant_id,visit_id,actor_id,contract_version,from_status,to_status,reason_code,request_id,revision,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,$10)`,[tenantId,row.id,ownerId,lifecycle.version,lifecycle.transition.from_status,lifecycle.status,lifecycle.transition.reason_code,lifecycle.transition.request_id,lifecycle.revision,lifecycle.updated_at])
      return visitReportRecord({...inserted.rows[0],client_external_key:row.client_external_key})
    })}catch(error){if(error.statusCode)throw error;throw serviceError('O report da visita não pôde ser salvo no PostgreSQL configurado.')}
  }

  async getVisitReport({tenantId=this.tenantId,ownerId,visitId,id=null}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(visitId)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit)return null;const reports=store.val.visitReports.filter(item=>String(item.visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)&&(!id||String(item.visit_report_id)===String(id)));return reports.length?structuredClone(reports.at(-1)):null}
    try{const result=await this.db.query(`SELECT report.*,client.external_key client_external_key FROM val_visit_reports report JOIN visits visit ON visit.tenant_id=report.tenant_id AND visit.id=report.visit_id AND visit.client_id=report.client_id JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE report.tenant_id=$1 AND report.visit_id=$2 AND report.created_by=$3 AND visit.consultant_id=$3 AND client.consultant_id=$3 AND ($4::uuid IS NULL OR report.id=$4) ORDER BY report.created_at DESC LIMIT 1`,[tenantId,visitId,ownerId,id||null]);return result.rows[0]?visitReportRecord(result.rows[0]):null}catch{throw serviceError('O report da visita não pôde ser recuperado no PostgreSQL configurado.')}
  }

  async confirmVisitReport({tenantId=this.tenantId,ownerId,actorId=ownerId,report,commitments=[],memories=[],opportunities=[],outcome,learningCandidate,reflection={},voiceConfirmation=null,requestId,now}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(String(report?.organization_id||'')!==String(tenantId)||String(report?.confirmed_by||'')!==String(actorId))throw domainError('A confirmação pertence a outro escopo.',403)
    const voiceId=voiceConfirmation?.interaction_id?String(voiceConfirmation.interaction_id):null
    if(voiceConfirmation&&!voiceId)throw domainError('A confirmação de voz exige uma interação válida.',422)
    if(!this.db.configured){
      const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(report.visit_id)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit)throw domainError('Visita não encontrada na carteira autorizada.',404)
      const index=store.val.visitReports.findIndex(item=>String(item.visit_report_id)===String(report.visit_report_id)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId));if(index<0)throw domainError('Report não encontrado na carteira autorizada.',404)
      const voice=voiceId?store.val.voiceInteractions.find(item=>String(item.id)===voiceId&&String(item.tenant_id)===String(tenantId)&&String(item.actor_id)===String(actorId)):null
      if(voiceId&&(!voice||String(voice.visit_id)!==String(report.visit_id)||String(voice.client_id)!==String(visit.clientId)))throw domainError('Interação de voz não encontrada na visita autorizada.',404)
      if(store.val.visitReports[index].confirmation_status==='CONFIRMED'){
        if(voice&&voice.status!=='CONFIRMED')throw domainError('O report já foi confirmado fora desta interação de voz. Revise a visita antes de continuar.',409,'voice_visit_report_already_confirmed')
        const context=await this.getVisitLearningContext({tenantId,ownerId,visitId:report.visit_id})
        return {...context,idempotent_visit_report:true,...(voice?{voice_interaction:voiceInteractionRecord(voice)}:{})}
      }
      if(voice&&voice.status!=='PENDING_REVIEW')throw domainError('A interação de voz deixou de estar pendente antes da confirmação.',409)
      store.val.visitReports[index]={...structuredClone(report),tenantId,ownerId}
      const interaction={id:randomUUID(),tenantId,ownerId,clientId:report.client_id,visit_id:report.visit_id,channel:report.source_type==='AUDIO'?'audio':'text',direction:'inbound',occurred_at:report.confirmed_at,summary:report.summary,commitments:structuredClone(commitments),source:'val_visit_report',source_external_id:report.visit_report_id,created_at:report.confirmed_at};store.interactions.push(interaction)
      if(report.transcript_id){const transcript=store.val.visitTranscripts.find(item=>String(item.transcript_id)===String(report.transcript_id)&&String(item.tenantId)===String(tenantId));if(transcript)transcript.interaction_id=interaction.id}
      store.val.memories.push(...memories.map(item=>({...structuredClone(item),tenant_id:tenantId,client_id:report.client_id,tenantId,ownerId})))
      const storedCommitments=commitments.map(item=>({...structuredClone(item),tenantId,ownerId,updated_at:item.created_at}));store.val.commitments.push(...storedCommitments)
      for(const item of opportunities){const existing=store.opportunities.find(entry=>exactScope(entry,tenantId,ownerId)&&entry.clientId===report.client_id&&entry.candidateKey===item.candidate_key);if(!existing)store.opportunities.push({id:`o-${randomUUID()}`,tenantId,ownerId,clientId:report.client_id,title:item.title,category:item.category,hypothesis:item.hypothesis,value:0,stage:item.stage,nextAction:item.next_action,nextActionAt:item.next_action_at,candidateKey:item.candidate_key,evidence:item.evidence,updatedAt:report.confirmed_at})}
      const storedOutcome={...structuredClone(outcome),tenantId,ownerId};store.val.outcomes.push(storedOutcome);const storedLearning={...structuredClone(learningCandidate),tenantId,ownerId};store.val.learningCandidates.push(storedLearning)
      const next=report.next_steps[0];const lifecycle=transitionVisitLifecycle(visit,'COMPLETED',{organizationId:tenantId,actorId,reasonCode:'VISIT_REPORT_CONFIRMED',requestId,now:report.confirmed_at});Object.assign(visit,{summary:report.summary,nextCommitment:storedCommitments[0]?.description||next?.description||next?.statement||'',nextActionAt:storedCommitments[0]?.due_at||next?.due_at||null,status:'Realizada',lifecycleStatus:lifecycle.status,lifecycleVersion:lifecycle.version,lifecycleRevision:lifecycle.revision,lifecycleUpdatedAt:lifecycle.updated_at,lifecycleUpdatedBy:lifecycle.updated_by,occurredAt:lifecycle.occurred_at,completedAt:lifecycle.completed_at,updatedAt:lifecycle.updated_at});store.val.visitLifecycleEvents.push({id:randomUUID(),tenantId,visitId:visit.id,actorId,contractVersion:lifecycle.version,fromStatus:lifecycle.transition.from_status,toStatus:lifecycle.status,reasonCode:lifecycle.transition.reason_code,requestId:lifecycle.transition.request_id,revision:lifecycle.revision,occurredAt:lifecycle.updated_at})
      if(voice){const artifacts={...structuredClone(voiceConfirmation.related_artifacts||{}),visit_report_id:report.visit_report_id,interaction_id:interaction.id,memory_ids:memories.map(item=>item.id),commitment_ids:storedCommitments.map(item=>item.commitment_id),outcome_id:storedOutcome.outcome_id,learning_candidate_id:storedLearning.candidate_id};Object.assign(voice,{status:'CONFIRMED',confirmation_status:'CONFIRMED',reviewed_candidates:structuredClone(voiceConfirmation.reviewed_candidates||[]),related_artifacts:artifacts,confirmed_at:report.confirmed_at,processed_at:voice.processed_at||report.confirmed_at,revision_no:Number(voice.revision_no||1)+1,error_code:null,error_message:null,updated_at:report.confirmed_at});const attachment=store.val.attachments.find(item=>String(item.id)===String(voice.audio_attachment_id)&&String(item.ownerId)===String(actorId));if(attachment){attachment.status='confirmed';attachment.confirmed_at=report.confirmed_at;attachment.updated_at=report.confirmed_at}}
      this.saveStore(store)
      return {visit:structuredClone(visit),visit_report:structuredClone(store.val.visitReports[index]),interaction:structuredClone(interaction),commitments:structuredClone(storedCommitments),outcome:structuredClone(storedOutcome),learning_candidate:structuredClone(storedLearning),reflection:structuredClone(reflection),memories_written:memories.map(item=>item.id),opportunities_written:opportunities.map(item=>item.candidate_key),...(voice?{voice_interaction:voiceInteractionRecord(voice)}:{})}
    }
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query(`SELECT report.*,visit.lifecycle_status,visit.lifecycle_version,visit.lifecycle_revision,visit.occurred_at visit_occurred_at,visit.completed_at visit_completed_at,visit.cancelled_at visit_cancelled_at,visit.status visit_status,visit.scheduled_at,visit.objective,visit.process_agreement,visit.summary visit_summary,visit.next_commitment,visit.next_action_at,visit.created_at visit_created_at,visit.updated_at visit_updated_at,client.external_key client_external_key FROM val_visit_reports report JOIN visits visit ON visit.tenant_id=report.tenant_id AND visit.id=report.visit_id AND visit.client_id=report.client_id JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE report.tenant_id=$1 AND report.id=$2 AND report.visit_id=$3 AND report.created_by=$4 AND visit.consultant_id=$4 AND client.consultant_id=$4 LIMIT 1 FOR UPDATE OF report,visit`,[tenantId,report.visit_report_id,report.visit_id,ownerId]);if(!selected.rowCount)throw domainError('Report não encontrado na carteira autorizada.',404);const row=selected.rows[0]
      let voiceRow=null
      if(voiceId){const selectedVoice=await connection.query(`SELECT voice.* FROM val_voice_interactions voice WHERE voice.tenant_id=$1 AND voice.id=$2 AND voice.actor_id=$3 AND voice.visit_id=$4 AND voice.client_id=$5 LIMIT 1 FOR UPDATE OF voice`,[tenantId,voiceId,actorId,row.visit_id,row.client_id]);if(!selectedVoice.rowCount)throw domainError('Interação de voz não encontrada na visita autorizada.',404);voiceRow=selectedVoice.rows[0]}
      if(row.confirmation_status==='CONFIRMED'){
        if(voiceRow&&voiceRow.status!=='CONFIRMED')throw domainError('O report já foi confirmado fora desta interação de voz. Revise a visita antes de continuar.',409,'voice_visit_report_already_confirmed')
        return {idempotent_visit_report:true,...(voiceRow?{voice_interaction:voiceInteractionRecord({...voiceRow,client_external_key:row.client_external_key})}:{})}
      }
      if(voiceRow&&voiceRow.status!=='PENDING_REVIEW')throw domainError('A interação de voz deixou de estar pendente antes da confirmação.',409)
      const updated=await connection.query(`UPDATE val_visit_reports SET confirmed_by=$4,summary=$5,discussed_topics=$6,expectations_created=$7,objections=$8,producer_signals=$9,opportunities_detected=$10,commitments_proposed=$11,commitments_confirmed=$12,closed_business=$13,pending_business=$14,next_steps=$15,technical_observations=$16,behavioral_signals=$17,missing_information=$18,consultant_notes=$19,confidence=$20,confirmation_status='CONFIRMED',revision_no=$21,confirmed_at=$22,updated_at=$22 WHERE tenant_id=$1 AND id=$2 AND visit_id=$3 AND confirmation_status='PENDING_REVIEW' RETURNING *`,[tenantId,report.visit_report_id,report.visit_id,actorId,report.summary,jsonbParameter(report.discussed_topics),jsonbParameter(report.expectations_created),jsonbParameter(report.objections),jsonbParameter(report.producer_signals),jsonbParameter(report.opportunities_detected),jsonbParameter(report.commitments_proposed),jsonbParameter(report.commitments_confirmed),jsonbParameter(report.closed_business),jsonbParameter(report.pending_business),jsonbParameter(report.next_steps),jsonbParameter(report.technical_observations),jsonbParameter(report.behavioral_signals),jsonbParameter(report.missing_information),report.consultant_notes||null,report.confidence,report.revision_no,report.confirmed_at]);if(!updated.rowCount)throw domainError('O report deixou de estar pendente antes da confirmação.',409)
      const interactionId=randomUUID();const interaction=await connection.query(`INSERT INTO interactions (id,tenant_id,client_id,visit_id,channel,direction,occurred_at,summary,commitments,source,source_external_id,created_at) VALUES ($1,$2,$3,$4,$5,'inbound',$6,$7,$8,'val_visit_report',$9,$6) ON CONFLICT (tenant_id,source,source_external_id) DO UPDATE SET summary=EXCLUDED.summary,commitments=EXCLUDED.commitments RETURNING *`,[interactionId,tenantId,row.client_id,row.visit_id,report.source_type==='AUDIO'?'audio':'text',report.confirmed_at,report.summary,jsonbParameter(commitments),report.visit_report_id])
      if(report.transcript_id)await connection.query(`UPDATE val_visit_transcripts SET interaction_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND visit_id=$3`,[tenantId,report.transcript_id,report.visit_id,interaction.rows[0].id])
      for(const memory of memories)await connection.query(`INSERT INTO val_memories (id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,confidence,status,source,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,valid_from,valid_until,created_by,acl,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),NOW())`,[memory.id,tenantId,row.client_id,memory.subject_type,memory.subject_id,memory.memory_type,memory.memory_state,memory.memory_domain,memory.key,jsonbParameter(memory.value),jsonbParameter(memory.evidence),memory.confidence,memory.status,memory.source,memory.source_ref,memory.source_type,memory.observed_at,memory.source_updated_at,memory.freshness_policy_version,jsonbParameter(memory.freshness_metadata),memory.valid_from,memory.valid_until,memory.created_by,jsonbParameter(memory.acl)])
      const storedCommitments=[]
      for(const commitment of commitments){const inserted=await connection.query(`INSERT INTO val_commitments (id,tenant_id,client_id,visit_id,opportunity_id,action_plan_id,action_id,description,owner_type,owner_id,due_at,status,success_criteria,agreed_with_client,evidence_refs,source_ref,audit,created_at,updated_at,completed_at,cancelled_at) VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,NULL,NULL) RETURNING *`,[commitment.commitment_id,tenantId,row.client_id,row.visit_id,commitment.action_id,commitment.description,commitment.owner_type,commitment.owner_id,commitment.due_at,commitment.status,commitment.success_criteria,commitment.agreed_with_client,jsonbParameter(commitment.evidence_refs),commitment.source_ref,jsonbParameter(commitment.audit),commitment.created_at]);storedCommitments.push(commitmentRecord({...inserted.rows[0],client_external_key:row.client_external_key}))}
      const storedOpportunities=[]
      for(const item of opportunities){const externalKey=`visit-report:${createHash('sha256').update(item.candidate_key).digest('hex').slice(0,64)}`;const inserted=await connection.query(`INSERT INTO opportunities (tenant_id,client_id,external_key,title,category,hypothesis,estimated_value,stage,next_action,next_action_at,evidence,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT (tenant_id,client_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,hypothesis=EXCLUDED.hypothesis,next_action=EXCLUDED.next_action,evidence=EXCLUDED.evidence,updated_at=NOW() RETURNING *`,[tenantId,row.client_id,externalKey,item.title,item.category,item.hypothesis,item.estimated_value,item.stage,item.next_action,item.next_action_at,jsonbParameter(item.evidence)]);storedOpportunities.push(opportunityRecord({...inserted.rows[0],client_external_key:row.client_external_key}))}
      const storedOutcome=await connection.query(`INSERT INTO val_outcomes (id,tenant_id,visit_id,client_id,visit_report_id,recommendation_id,action_plan_id,commitment_id,contract_version,outcome_type,result,evidence_refs,measured_at,recorded_by,confidence,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[outcome.outcome_id,tenantId,row.visit_id,row.client_id,outcome.visit_report_id,outcome.recommendation_id,outcome.action_plan_id,storedCommitments[0]?.commitment_id||outcome.commitment_id,outcome.contract_version,outcome.outcome_type,jsonbParameter(outcome.result),jsonbParameter(outcome.evidence_refs),outcome.measured_at,actorId,outcome.confidence,outcome.notes||null,outcome.created_at])
      const storedLearning=await connection.query(`INSERT INTO val_learning_candidates (id,tenant_id,source_visit_id,source_visit_report_id,source_outcome_id,created_by,contract_version,hypothesis,scope,supporting_evidence,contrary_evidence,confidence,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CANDIDATE',$13,$13) RETURNING *`,[learningCandidate.candidate_id,tenantId,row.visit_id,report.visit_report_id,outcome.outcome_id,actorId,learningCandidate.contract_version,learningCandidate.hypothesis,jsonbParameter(learningCandidate.scope),jsonbParameter(learningCandidate.supporting_evidence),jsonbParameter(learningCandidate.contrary_evidence),learningCandidate.confidence,learningCandidate.created_at])
      const next=report.next_steps[0];const mappedVisit={id:row.visit_id,tenant_id:tenantId,client_id:row.client_id,client_external_key:row.client_external_key,consultant_id:ownerId,scheduled_at:row.scheduled_at,objective:row.objective,process_agreement:row.process_agreement,summary:row.visit_summary,next_commitment:row.next_commitment,next_action_at:row.next_action_at,status:row.visit_status,lifecycle_status:row.lifecycle_status,lifecycle_version:row.lifecycle_version,lifecycle_revision:row.lifecycle_revision,occurred_at:row.visit_occurred_at,completed_at:row.visit_completed_at,cancelled_at:row.visit_cancelled_at,created_at:row.visit_created_at,updated_at:row.visit_updated_at};const lifecycle=transitionVisitLifecycle(visitRecord(mappedVisit),'COMPLETED',{organizationId:tenantId,actorId,reasonCode:'VISIT_REPORT_CONFIRMED',requestId,now:report.confirmed_at})
      const updatedVisit=await connection.query(`UPDATE visits SET summary=$3,next_commitment=$4,next_action_at=$5,status='Realizada',lifecycle_status=$6,lifecycle_version=$7,lifecycle_revision=$8,lifecycle_updated_at=$9,lifecycle_updated_by=$10,occurred_at=COALESCE(occurred_at,$11),completed_at=$12,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,row.visit_id,report.summary,storedCommitments[0]?.description||next?.description||next?.statement||'',storedCommitments[0]?.due_at||next?.due_at||null,lifecycle.status,lifecycle.version,lifecycle.revision,lifecycle.updated_at,actorId,lifecycle.occurred_at,lifecycle.completed_at])
      await connection.query(`INSERT INTO val_visit_lifecycle_events (tenant_id,visit_id,actor_id,contract_version,from_status,to_status,reason_code,request_id,revision,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[tenantId,row.visit_id,actorId,lifecycle.version,lifecycle.transition.from_status,lifecycle.status,lifecycle.transition.reason_code,lifecycle.transition.request_id,lifecycle.revision,jsonbParameter({report_ref:`visit-report:${report.visit_report_id}`,outcome_ref:`outcome:${outcome.outcome_id}`}),lifecycle.updated_at])
      let storedVoice=null
      if(voiceRow){const artifacts={...jsonObject(voiceConfirmation.related_artifacts),visit_report_id:report.visit_report_id,interaction_id:interaction.rows[0].id,memory_ids:memories.map(item=>item.id),commitment_ids:storedCommitments.map(item=>item.commitment_id),outcome_id:outcome.outcome_id,learning_candidate_id:learningCandidate.candidate_id};const voiceUpdate=await connection.query(`UPDATE val_voice_interactions SET status='CONFIRMED',confirmation_status='CONFIRMED',reviewed_candidates=$4,related_artifacts=$5,confirmed_at=$6,processed_at=COALESCE(processed_at,$6),revision_no=revision_no+1,error_code=NULL,error_message=NULL,updated_at=$6 WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 AND status='PENDING_REVIEW' RETURNING *`,[tenantId,voiceId,actorId,jsonbParameter(voiceConfirmation.reviewed_candidates||[]),jsonbParameter(artifacts),report.confirmed_at]);if(!voiceUpdate.rowCount)throw domainError('A interação de voz deixou de estar pendente antes da confirmação.',409);storedVoice=voiceInteractionRecord({...voiceUpdate.rows[0],client_external_key:row.client_external_key});if(voiceRow.audio_attachment_id)await connection.query(`UPDATE val_attachments SET status='confirmed',analysis=analysis||$4::jsonb,confirmed_at=$5,updated_at=$5 WHERE tenant_id=$1 AND id=$2 AND consultant_id=$3`,[tenantId,voiceRow.audio_attachment_id,actorId,jsonbParameter({kind:'voice_capture',voiceInteractionId:voiceId,processingStatus:'confirmed',retentionClass:'voice_raw_temporary'}),report.confirmed_at])}
      await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,after_data,correlation_id,created_at) VALUES ($1,$2,'visit_report_confirmed','visit',$3,$4,$5,NOW())`,[tenantId,actorId,row.visit_id,jsonbParameter({visit_report_id:report.visit_report_id,interaction_id:interaction.rows[0].id,commitment_ids:storedCommitments.map(item=>item.commitment_id),outcome_id:outcome.outcome_id,learning_candidate_id:learningCandidate.candidate_id}),requestId||null])
      return {visit:visitRecord({...updatedVisit.rows[0],client_external_key:row.client_external_key}),visit_report:visitReportRecord({...updated.rows[0],client_external_key:row.client_external_key}),interaction:{...interaction.rows[0],clientId:row.client_external_key},commitments:storedCommitments,outcome:outcomeRecord({...storedOutcome.rows[0],client_external_key:row.client_external_key}),learning_candidate:learningCandidateRecord(storedLearning.rows[0]),reflection,memories_written:memories.map(item=>item.id),opportunities_written:storedOpportunities.map(item=>item.databaseId),...(storedVoice?{voice_interaction:storedVoice}:{})}
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A confirmação da visita não pôde ser persistida no PostgreSQL configurado.')}
  }

  async saveVisitOutcome({tenantId=this.tenantId,ownerId,actorId=ownerId,outcome}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(String(outcome?.organization_id||'')!==String(tenantId)||String(outcome?.recorded_by||'')!==String(actorId))throw domainError('O outcome pertence a outro escopo.',403)
    if(!this.db.configured){const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(outcome.visit_id)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit)throw domainError('Visita não encontrada na carteira autorizada.',404);const stored={...structuredClone(outcome),tenantId,ownerId};store.val.outcomes.push(stored);this.saveStore(store);return stored}
    try{const result=await this.db.query(`INSERT INTO val_outcomes (id,tenant_id,visit_id,client_id,visit_report_id,recommendation_id,action_plan_id,commitment_id,contract_version,outcome_type,result,evidence_refs,measured_at,recorded_by,confidence,notes,created_at) SELECT $1,$2,visit.id,visit.client_id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15 FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$2 AND visit.id=$16 AND visit.consultant_id=$12 AND client.consultant_id=$12 RETURNING val_outcomes.*,(SELECT external_key FROM clients WHERE id=val_outcomes.client_id) client_external_key`,[outcome.outcome_id,tenantId,outcome.visit_report_id,outcome.recommendation_id,outcome.action_plan_id,outcome.commitment_id,outcome.contract_version,outcome.outcome_type,jsonbParameter(outcome.result),jsonbParameter(outcome.evidence_refs),outcome.measured_at,actorId,outcome.confidence,outcome.notes||null,outcome.created_at,outcome.visit_id]);if(!result.rowCount)throw domainError('Visita não encontrada na carteira autorizada.',404);return outcomeRecord(result.rows[0])}catch(error){if(error.statusCode)throw error;throw serviceError('O outcome não pôde ser salvo no PostgreSQL configurado.')}
  }

  async getVisitLearningContext({tenantId=this.tenantId,ownerId,visitId}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){const store=this.fallback();const visit=store.visits.find(item=>String(item.id)===String(visitId)&&String(item.tenantId||tenantId)===String(tenantId)&&String(item.ownerId??ownerId)===String(ownerId));if(!visit)return null;return {visit:structuredClone(visit),preparations:structuredClone(store.val.visitPreparations.filter(item=>String(item.visitId)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.preparedBy)===String(ownerId))),reports:structuredClone(store.val.visitReports.filter(item=>String(item.visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId))),transcripts:structuredClone(store.val.visitTranscripts.filter(item=>String(item.visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)).map(item=>({...item,transcript_text:undefined}))),interactions:structuredClone(store.interactions.filter(item=>String(item.visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId))),commitments:structuredClone(store.val.commitments.filter(item=>String(item.visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId))),outcomes:structuredClone(store.val.outcomes.filter(item=>String(item.visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId))),learning_candidates:structuredClone(store.val.learningCandidates.filter(item=>String(item.source_visit_id)===String(visitId)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)))}}
    try{const visitResult=await this.db.query(`SELECT visit.*,client.external_key client_external_key FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$1 AND visit.id=$2 AND visit.consultant_id=$3 AND client.consultant_id=$3 LIMIT 1`,[tenantId,visitId,ownerId]);if(!visitResult.rowCount)return null;const clientKey=visitResult.rows[0].client_external_key;const [preparations,reports,transcripts,interactions,commitments,outcomes,learning]=await Promise.all([this.db.query(`SELECT * FROM val_visit_preparations WHERE tenant_id=$1 AND visit_id=$2 AND prepared_by=$3 ORDER BY version_no`,[tenantId,visitId,ownerId]),this.db.query(`SELECT * FROM val_visit_reports WHERE tenant_id=$1 AND visit_id=$2 AND created_by=$3 ORDER BY created_at`,[tenantId,visitId,ownerId]),this.db.query(`SELECT transcript.*,NULL::text transcript_text FROM val_visit_transcripts transcript WHERE tenant_id=$1 AND visit_id=$2 AND created_by=$3 ORDER BY created_at`,[tenantId,visitId,ownerId]),this.db.query(`SELECT * FROM interactions WHERE tenant_id=$1 AND visit_id=$2 ORDER BY occurred_at`,[tenantId,visitId]),this.db.query(`SELECT * FROM val_commitments WHERE tenant_id=$1 AND visit_id=$2 ORDER BY created_at`,[tenantId,visitId]),this.db.query(`SELECT * FROM val_outcomes WHERE tenant_id=$1 AND visit_id=$2 ORDER BY measured_at`,[tenantId,visitId]),this.db.query(`SELECT * FROM val_learning_candidates WHERE tenant_id=$1 AND source_visit_id=$2 ORDER BY created_at`,[tenantId,visitId])]);return {visit:visitRecord(visitResult.rows[0]),preparations:preparations.rows.map(row=>({id:String(row.id),version_no:Number(row.version_no),preparation_id:row.preparation_id,contract_version:row.contract_version,context_snapshot_id:String(row.context_snapshot_id),behavioral_profile_version:row.behavioral_profile_version,decision_thesis_id:row.decision_thesis_id,decision_thesis_version:row.decision_thesis_version,value_plan_id:row.value_plan_id,value_plan_version:row.value_plan_version,action_plan_id:String(row.action_plan_id),prepared_at:iso(row.prepared_at),prepared_by:String(row.prepared_by),preparation:row.preparation_payload})),reports:reports.rows.map(row=>visitReportRecord({...row,client_external_key:clientKey})),transcripts:transcripts.rows.map(row=>transcriptRecord({...row,client_external_key:clientKey})),interactions:interactions.rows,commitments:commitments.rows.map(row=>commitmentRecord({...row,client_external_key:clientKey})),outcomes:outcomes.rows.map(row=>outcomeRecord({...row,client_external_key:clientKey})),learning_candidates:learning.rows.map(learningCandidateRecord)}}catch{throw serviceError('O contexto de aprendizado da visita não pôde ser recuperado no PostgreSQL configurado.')}
  }

  async saveCommitment({tenantId=this.tenantId,ownerId,actorId=ownerId,input={}}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(String(input.organization_id??input.organizationId??tenantId)!==String(tenantId))throw domainError('O compromisso pertence a outra organização.',403)
    if(String(input.owner_type??input.ownerType??'USER').toUpperCase()==='USER'&&String(input.owner_id??input.ownerId??actorId)!==String(actorId))throw domainError('Não é permitido atribuir compromisso a outro usuário nesta fase.',403)
    const candidate=buildCommitmentCandidate({...input,organization_id:tenantId,owner_type:input.owner_type??input.ownerType??'USER',owner_id:input.owner_id??input.ownerId??actorId,created_by:input.created_by??input.createdBy??actorId})
    if(!candidate.is_commitment)throw Object.assign(new Error(`A ação continua como sugestão: faltam ${candidate.missing_fields.join(', ')}.`),{statusCode:422,code:'commitment_incomplete',missingFields:candidate.missing_fields})
    const commitment=candidate.commitment
    if(!this.db.configured){
      const store=this.fallback();const visit=commitment.visit_id?(store.visits||[]).find(item=>String(item.id)===String(commitment.visit_id)&&String(item.ownerId??ownerId)===String(ownerId)&&String(item.tenantId||tenantId)===String(tenantId)):null
      if(commitment.visit_id&&!visit)throw domainError('Visita não encontrada na carteira autorizada.',404)
      const plan=commitment.action_plan_id?store.val.actionPlans.find(item=>String(item.action_plan_id)===String(commitment.action_plan_id)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)):null
      if(commitment.action_plan_id&&!plan)throw domainError('ActionPlan não encontrado na carteira autorizada.',404)
      const stored={...commitment,tenantId,ownerId,action_plan_id:commitment.action_plan_id||input.action_plan_id||input.actionPlanId||null,updated_at:commitment.created_at};store.val.commitments.push(stored);store.val.commitments=store.val.commitments.slice(-2000);this.saveStore(store);return stored
    }
    try{return await this.db.transaction(async connection=>{
      const client=await connection.query(`SELECT id,external_key FROM clients WHERE tenant_id=$1 AND consultant_id=$3 AND (id::text=$2 OR external_key=$2) AND status='active' LIMIT 1`,[tenantId,commitment.client_id,ownerId]);if(!client.rowCount)throw domainError('Produtor não encontrado na carteira autorizada.',404)
      if(commitment.visit_id){const linked=await connection.query(`SELECT id FROM visits WHERE tenant_id=$1 AND id=$2 AND client_id=$3 AND consultant_id=$4 LIMIT 1`,[tenantId,commitment.visit_id,client.rows[0].id,ownerId]);if(!linked.rowCount)throw domainError('Visita não encontrada na carteira autorizada.',404)}
      const actionPlanId=input.action_plan_id??input.actionPlanId??null
      if(actionPlanId){const linked=await connection.query(`SELECT id FROM val_action_plans WHERE tenant_id=$1 AND id=$2 AND client_id=$3 AND owner_user_id=$4 LIMIT 1`,[tenantId,actionPlanId,client.rows[0].id,ownerId]);if(!linked.rowCount)throw domainError('ActionPlan não encontrado na carteira autorizada.',404)}
      if(commitment.opportunity_id){const linked=await connection.query(`SELECT id FROM opportunities WHERE tenant_id=$1 AND id=$2 AND client_id=$3 LIMIT 1`,[tenantId,commitment.opportunity_id,client.rows[0].id]);if(!linked.rowCount)throw domainError('Oportunidade não encontrada para este produtor.',404)}
      const result=await connection.query(`INSERT INTO val_commitments (id,tenant_id,client_id,visit_id,opportunity_id,action_plan_id,action_id,description,owner_type,owner_id,due_at,status,success_criteria,agreed_with_client,evidence_refs,source_ref,audit,created_at,updated_at,completed_at,cancelled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19,$20) RETURNING *`,[commitment.commitment_id,tenantId,client.rows[0].id,commitment.visit_id,commitment.opportunity_id,actionPlanId,commitment.action_id,commitment.description,commitment.owner_type,commitment.owner_id,commitment.due_at,commitment.status,commitment.success_criteria,commitment.agreed_with_client,jsonbParameter(commitment.evidence_refs),commitment.source_ref,jsonbParameter(commitment.audit),commitment.created_at,commitment.completed_at,commitment.cancelled_at])
      return commitmentRecord({...result.rows[0],client_external_key:client.rows[0].external_key})
    })}catch(error){if(error.statusCode)throw error;throw serviceError('O compromisso não pôde ser salvo no PostgreSQL configurado.')}
  }

  async listCommitments({tenantId=this.tenantId,ownerId,clientId=null,status=null}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured)return this.fallback().val.commitments.filter(item=>String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId)&&(!clientId||String(item.client_id)===String(clientId))&&(!status||String(item.status)===String(status))).map(item=>structuredClone(item))
    try{
      const result=await this.db.query(`SELECT commitment.*,client.external_key client_external_key FROM val_commitments commitment JOIN clients client ON client.tenant_id=commitment.tenant_id AND client.id=commitment.client_id WHERE commitment.tenant_id=$1 AND client.consultant_id=$2 AND ($3::text IS NULL OR client.id::text=$3 OR client.external_key=$3) AND ($4::text IS NULL OR commitment.status=$4) ORDER BY commitment.due_at,commitment.created_at DESC LIMIT 1000`,[tenantId,ownerId,clientId?String(clientId):null,status?String(status).toUpperCase():null])
      return result.rows.map(commitmentRecord)
    }catch{throw serviceError('Os compromissos não puderam ser recuperados no PostgreSQL configurado.')}
  }

  async updateCommitment({tenantId=this.tenantId,ownerId,id,input={}}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){
      const store=this.fallback();const index=store.val.commitments.findIndex(item=>String(item.commitment_id)===String(id)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId));if(index<0)throw domainError('Compromisso não encontrado na carteira autorizada.',404)
      const updated={...transitionCommitment(store.val.commitments[index],{...input,updated_by:ownerId,request_id:input.request_id??input.requestId}),tenantId,ownerId,action_plan_id:store.val.commitments[index].action_plan_id,updated_at:new Date().toISOString()};store.val.commitments[index]=updated;this.saveStore(store);return updated
    }
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query(`SELECT commitment.*,client.external_key client_external_key FROM val_commitments commitment JOIN clients client ON client.tenant_id=commitment.tenant_id AND client.id=commitment.client_id WHERE commitment.tenant_id=$1 AND commitment.id=$2 AND client.consultant_id=$3 LIMIT 1 FOR UPDATE OF commitment`,[tenantId,id,ownerId]);if(!selected.rowCount)throw domainError('Compromisso não encontrado na carteira autorizada.',404)
      const current=commitmentRecord(selected.rows[0]);const updated=transitionCommitment(current,{...input,updated_by:ownerId,request_id:input.request_id??input.requestId??current.audit.request_id})
      const result=await connection.query(`UPDATE val_commitments SET status=$4,due_at=$5,success_criteria=$6,evidence_refs=$7,audit=$8,completed_at=$9,cancelled_at=$10,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND client_id=$3 RETURNING *`,[tenantId,id,selected.rows[0].client_id,updated.status,updated.due_at,updated.success_criteria,jsonbParameter(updated.evidence_refs),jsonbParameter(updated.audit),updated.completed_at,updated.cancelled_at])
      return commitmentRecord({...result.rows[0],client_external_key:selected.rows[0].client_external_key})
    })}catch(error){if(error.statusCode)throw error;throw serviceError('O compromisso não pôde ser atualizado no PostgreSQL configurado.')}
  }

  async saveOpportunity(input,ownerId){
    const candidateKey=String(input.candidateKey||input.title||'').trim().slice(0,300);if(!candidateKey)throw domainError('A oportunidade precisa de uma origem identificável.',400)
    const externalKey=`pipeline:${createHash('sha256').update(`${input.clientId}:${candidateKey}`).digest('hex').slice(0,64)}`
    const evidence=[...(Array.isArray(input.evidence)?input.evidence:[]),...(input.stageEvidence?[input.stageEvidence]:[])].slice(0,30)
    if(!this.db.configured){const store=this.readStore();store.opportunities||=[];const current=store.opportunities.find(item=>exactScope(item,this.tenantId,ownerId)&&item.clientId===input.clientId&&item.candidateKey===candidateKey);const record={...current,...input,tenantId:this.tenantId,ownerId,id:current?.id||`o-${input.clientId}`,updatedAt:new Date().toISOString()};store.opportunities=store.opportunities.filter(item=>!(exactScope(item,this.tenantId,ownerId)&&item.clientId===input.clientId&&item.candidateKey===candidateKey)).concat(record);this.saveStore(store);return record}
    try{const result=await this.db.query(`INSERT INTO opportunities (tenant_id,client_id,external_key,title,category,hypothesis,estimated_value,stage,next_action,next_action_at,evidence,created_at,updated_at) SELECT $1,client.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW() FROM clients client WHERE client.tenant_id=$1 AND client.consultant_id=$12 AND (client.id::text=$2 OR client.external_key=$2) ON CONFLICT (tenant_id,client_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,hypothesis=EXCLUDED.hypothesis,estimated_value=EXCLUDED.estimated_value,stage=EXCLUDED.stage,next_action=EXCLUDED.next_action,next_action_at=EXCLUDED.next_action_at,evidence=EXCLUDED.evidence,updated_at=NOW() RETURNING opportunities.*,(SELECT external_key FROM clients WHERE id=opportunities.client_id) client_external_key`,[this.tenantId,String(input.clientId||''),externalKey,String(input.title||'Oportunidade').slice(0,220),String(input.category||'').slice(0,120)||null,String(input.hypothesis||'').slice(0,4000)||null,Number.isFinite(Number(input.value))?Math.max(0,Number(input.value)):null,String(input.stage||'Diagnóstico').slice(0,40),String(input.nextAction||'').slice(0,2000)||null,parsedDate(input.nextActionAt),jsonbParameter(evidence),ownerId]);if(!result.rowCount)throw domainError('Produtor não encontrado na sua carteira.',404);return opportunityRecord(result.rows[0])}catch(error){if(error.statusCode)throw error;throw serviceError('A oportunidade não pôde ser salva no PostgreSQL configurado.')}
  }

  async getFastClientFacts({tenantId=this.tenantId,clientId,ownerId,now=new Date(),dataPath=null,timeoutMs}={}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    ownerId=String(ownerId??'').trim()
    if(!ownerId)throw domainError('O proprietário da carteira é obrigatório para consultar fatos rápidos.',403,'owner_scope_required')
    now=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date()
    const allowedPaths=new Set(['LATEST_VISIT','LATEST_COMMITMENT','LATEST_PURCHASE','LATEST_CONFIRMED_OBJECTION','LATEST_VISIT_CONFIRMED_OBJECTION','REGISTERED_CROPS','REGISTERED_AREA','BEHAVIORAL_PROFILE','CLIENT_COMPARISON'])
    const requestedPath=allowedPaths.has(String(dataPath||''))?String(dataPath):'ALL'
    const needs=path=>requestedPath==='ALL'||requestedPath==='CLIENT_COMPARISON'||requestedPath===path
    if(!this.db.configured){
      const store=this.fallback()
      const clients=new Map();store.imports?.forEach(record=>{if(!exactScope(record,tenantId,ownerId))return;record.clients?.forEach(client=>{if(exactScope(client,tenantId,ownerId,record))clients.set(String(client.id),client)})})
      const client=clients.get(String(clientId));if(!client)throw domainError('Produtor não encontrado na carteira autorizada.',404)
      const scopedVisits=needs('LATEST_VISIT')||needs('LATEST_VISIT_CONFIRMED_OBJECTION')?(store.visits||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.clientId??item.client_id)===String(clientId)):[]
      const latestCompletedVisit=scopedVisits.map(item=>({item,at:completedVisitTimestamp(item)})).filter(entry=>entry.at!==null).sort((left,right)=>right.at-left.at)[0]?.item||null
      const nextScheduledVisit=scopedVisits.map(item=>({item,at:scheduledVisitTimestamp(item,now)})).filter(entry=>entry.at!==null).sort((left,right)=>left.at-right.at)[0]?.item||null
      const latestCommitment=needs('LATEST_COMMITMENT')?(store.val.commitments||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.client_id??item.clientId)===String(clientId)).sort((left,right)=>(timestamp(right.updated_at??right.updatedAt??right.created_at??right.createdAt)||0)-(timestamp(left.updated_at??left.updatedAt??left.created_at??left.createdAt)||0))[0]||null:null
      const latestPurchase=needs('LATEST_PURCHASE')?(store.businessEvents||store.business_events||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.clientId??item.client_id)===String(clientId)&&String(item.outcome||'').toLowerCase()==='won').sort(compareLatestPurchase)[0]||null:null
      const latestConfirmedObjection=needs('LATEST_CONFIRMED_OBJECTION')?(store.val.visitReports||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.client_id??item.clientId)===String(clientId)&&String((item.confirmation_status??item.confirmationStatus)||'').toUpperCase()==='CONFIRMED'&&Array.isArray(item.objections)&&item.objections.length).sort((left,right)=>(timestamp(right.confirmed_at??right.confirmedAt??right.created_at??right.createdAt)||0)-(timestamp(left.confirmed_at??left.confirmedAt??left.created_at??left.createdAt)||0))[0]||null:null
      const latestVisitConfirmedObjection=needs('LATEST_VISIT_CONFIRMED_OBJECTION')&&latestCompletedVisit?(store.val.visitReports||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.client_id??item.clientId)===String(clientId)&&String(item.visit_id??item.visitId)===String(latestCompletedVisit.id)&&String((item.confirmation_status??item.confirmationStatus)||'').toUpperCase()==='CONFIRMED'&&Array.isArray(item.objections)&&item.objections.length).sort((left,right)=>(timestamp(right.confirmed_at??right.confirmedAt??right.created_at??right.createdAt)||0)-(timestamp(left.confirmed_at??left.confirmedAt??left.created_at??left.createdAt)||0))[0]||null:null
      const seasons=needs('REGISTERED_CROPS')?(Array.isArray(client.properties)?client.properties:[]).flatMap(property=>(Array.isArray(property?.fields)?property.fields:[]).flatMap(field=>Array.isArray(field?.seasons)?field.seasons:[])):[]
      const latestCropSeason=seasons.sort((left,right)=>(timestamp(right.planted_at??right.plantedAt??right.created_at??right.createdAt)||0)-(timestamp(left.planted_at??left.plantedAt??left.created_at??left.createdAt)||0))[0]||null
      const completed=latestCompletedVisit?structuredClone(latestCompletedVisit):null
      const correlatedVisitReport=latestVisitConfirmedObjection?{
        ...structuredClone(latestVisitConfirmedObjection),
        visit_id:String(latestVisitConfirmedObjection.visit_id??latestVisitConfirmedObjection.visitId??completed?.id),
        visit_occurred_at:latestVisitConfirmedObjection.visit_occurred_at??latestVisitConfirmedObjection.visitOccurredAt??completed?.occurred_at??completed?.occurredAt??null,
        visit_completed_at:latestVisitConfirmedObjection.visit_completed_at??latestVisitConfirmedObjection.visitCompletedAt??completed?.completed_at??completed?.completedAt??null,
        visit_scheduled_at:latestVisitConfirmedObjection.visit_scheduled_at??latestVisitConfirmedObjection.visitScheduledAt??completed?.scheduled_at??completed?.scheduledAt??null,
        visit_status:latestVisitConfirmedObjection.visit_status??latestVisitConfirmedObjection.visitStatus??completed?.status??null,
        visit_lifecycle_status:latestVisitConfirmedObjection.visit_lifecycle_status??latestVisitConfirmedObjection.visitLifecycleStatus??completed?.lifecycle_status??completed?.lifecycleStatus??null,
      }:null
      const totalArea=client.totalAreaHa??client.total_area_ha??client.area
      const hasTotalArea=totalArea!=null&&String(totalArea).trim()!==''&&Number.isFinite(Number(totalArea))
      const fastScope={tenantId,producerId:String(client.id),ownerId}
      const rawProfileEvidence=needs('BEHAVIORAL_PROFILE')?(Array.isArray(client.profileEvidence)?structuredClone(client.profileEvidence):[]):[]
      const profileEvidenceId=rawProfileEvidence.map(profileEvidenceIdentifier).find(Boolean)||''
      const profileSourceRef=needs('BEHAVIORAL_PROFILE')?String(client.profileSourceRef||client.profileSource||profileEvidenceId||'').trim()||null:null
      const profileEvidence=materializeLegacyProfileEvidence(rawProfileEvidence,fastScope,profileSourceRef,{answers:client.profileAnswers,assessedAt:client.profileUpdatedAt,validUntil:client.profileValidUntil??null})
      const scopedFast=item=>item?repositoryScopedRecord(structuredClone(item),fastScope):null
      return {client:repositoryScopedRecord({id:client.id,name:client.name,totalAreaHa:hasTotalArea?Number(totalArea):null,areaBand:client.areaBand??client.area_band??null,cultures:client.cultures??null,...(needs('BEHAVIORAL_PROFILE')?{primaryProfile:client.primaryProfile??client.primary_profile??null,secondaryProfile:client.secondaryProfile??client.secondary_profile??null,decisionDriver:client.decisionDriver??null,technicalPresentation:client.technicalPresentation??null,planningStyle:client.planningStyle??null,buyingBehavior:client.buyingBehavior??null,trustDriver:client.trustDriver??null,servicePreference:client.servicePreference??null,profileEvidence,profileUpdatedAt:client.profileUpdatedAt??null,profileValidUntil:client.profileValidUntil??null}: {})},fastScope),profileEvidence,profileSourceRef,profileAssessedAt:client.profileUpdatedAt??null,profileValidUntil:client.profileValidUntil??null,latestVisit:scopedFast(completed),latestCompletedVisit:scopedFast(completed),nextScheduledVisit:scopedFast(nextScheduledVisit),latestCommitment:scopedFast(latestCommitment),latestPurchase:scopedFast(latestPurchase),latestConfirmedObjection:scopedFast(latestConfirmedObjection),latestVisitConfirmedObjection:scopedFast(correlatedVisitReport),latestCropSeason:scopedFast(latestCropSeason)}
    }
    try{
      const select=['c.external_key client_external_key','c.name','c.total_area_ha','c.area_band','c.cultures']
      if(needs('LATEST_VISIT')||needs('LATEST_VISIT_CONFIRMED_OBJECTION'))select.push(
        `(SELECT row_to_json(v) FROM (SELECT visit.id,visit.scheduled_at,visit.occurred_at,visit.completed_at,visit.objective,visit.summary,visit.next_commitment,visit.next_action_at,visit.status,visit.lifecycle_status,visit.created_at,visit.updated_at FROM visits visit WHERE visit.tenant_id=c.tenant_id AND visit.client_id=c.id AND visit.consultant_id=c.consultant_id AND (visit.lifecycle_status='COMPLETED' OR (visit.lifecycle_status IS NULL AND (LOWER(COALESCE(visit.status,'')) LIKE 'realizad%' OR LOWER(COALESCE(visit.status,'')) LIKE 'conclu%'))) AND COALESCE(visit.occurred_at,visit.completed_at,visit.scheduled_at) IS NOT NULL ORDER BY COALESCE(visit.occurred_at,visit.completed_at,visit.scheduled_at) DESC,visit.id DESC LIMIT 1) v) latest_completed_visit`,
        `(SELECT row_to_json(v) FROM (SELECT visit.id,visit.scheduled_at,visit.occurred_at,visit.completed_at,visit.objective,visit.summary,visit.next_commitment,visit.next_action_at,visit.status,visit.lifecycle_status,visit.created_at,visit.updated_at FROM visits visit WHERE visit.tenant_id=c.tenant_id AND visit.client_id=c.id AND visit.consultant_id=c.consultant_id AND (visit.lifecycle_status IN ('PLANNED','PREPARED') OR (visit.lifecycle_status IS NULL AND LOWER(COALESCE(visit.status,'')) NOT LIKE 'realizad%' AND LOWER(COALESCE(visit.status,'')) NOT LIKE 'conclu%' AND LOWER(COALESCE(visit.status,'')) NOT LIKE 'cancelad%')) AND visit.scheduled_at>=NOW() ORDER BY visit.scheduled_at,visit.id LIMIT 1) v) next_scheduled_visit`)
      if(needs('LATEST_COMMITMENT'))select.push(`(SELECT row_to_json(k) FROM (SELECT commitment.id commitment_id,commitment.description,commitment.due_at,commitment.status,commitment.success_criteria,commitment.created_at,commitment.updated_at FROM val_commitments commitment WHERE commitment.tenant_id=c.tenant_id AND commitment.client_id=c.id ORDER BY COALESCE(commitment.updated_at,commitment.created_at) DESC,commitment.id DESC LIMIT 1) k) latest_commitment`)
      if(needs('LATEST_PURCHASE'))select.push(`(SELECT row_to_json(purchase) FROM (SELECT business.id,business.occurred_at,business.created_at,business.category,business.product,business.quantity,business.value,business.margin,business.currency,business.source,business.external_id FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won' ORDER BY business.occurred_at DESC NULLS LAST,business.created_at DESC NULLS LAST,business.id DESC LIMIT 1) purchase) latest_purchase`)
      if(needs('LATEST_CONFIRMED_OBJECTION'))select.push(`(SELECT row_to_json(report_record) FROM (SELECT report.id visit_report_id,report.visit_id,report.objections,report.confirmed_at,report.created_at FROM val_visit_reports report JOIN visits report_visit ON report_visit.tenant_id=report.tenant_id AND report_visit.id=report.visit_id AND report_visit.client_id=report.client_id WHERE report.tenant_id=c.tenant_id AND report.client_id=c.id AND report.created_by=c.consultant_id AND report_visit.consultant_id=c.consultant_id AND report.confirmation_status='CONFIRMED' AND jsonb_array_length(COALESCE(report.objections,'[]'::jsonb))>0 ORDER BY COALESCE(report.confirmed_at,report.created_at) DESC,report.id DESC LIMIT 1) report_record) latest_confirmed_objection`)
      if(needs('LATEST_VISIT_CONFIRMED_OBJECTION'))select.push(`(SELECT row_to_json(report_record) FROM (SELECT report.id visit_report_id,report.visit_id,report.objections,report.confirmed_at,report.created_at,latest_visit.occurred_at visit_occurred_at,latest_visit.completed_at visit_completed_at,latest_visit.scheduled_at visit_scheduled_at,latest_visit.status visit_status,latest_visit.lifecycle_status visit_lifecycle_status FROM (SELECT visit.id,visit.occurred_at,visit.completed_at,visit.scheduled_at,visit.status,visit.lifecycle_status FROM visits visit WHERE visit.tenant_id=c.tenant_id AND visit.client_id=c.id AND visit.consultant_id=c.consultant_id AND (visit.lifecycle_status='COMPLETED' OR (visit.lifecycle_status IS NULL AND (LOWER(COALESCE(visit.status,'')) LIKE 'realizad%' OR LOWER(COALESCE(visit.status,'')) LIKE 'conclu%'))) AND COALESCE(visit.occurred_at,visit.completed_at,visit.scheduled_at) IS NOT NULL ORDER BY COALESCE(visit.occurred_at,visit.completed_at,visit.scheduled_at) DESC,visit.id DESC LIMIT 1) latest_visit JOIN val_visit_reports report ON report.tenant_id=c.tenant_id AND report.client_id=c.id AND report.visit_id=latest_visit.id WHERE report.created_by=c.consultant_id AND report.confirmation_status='CONFIRMED' AND jsonb_array_length(COALESCE(report.objections,'[]'::jsonb))>0 ORDER BY COALESCE(report.confirmed_at,report.created_at) DESC,report.id DESC LIMIT 1) report_record) latest_visit_confirmed_objection`)
      if(needs('REGISTERED_CROPS'))select.push(`(SELECT row_to_json(latest_crop) FROM (SELECT season.id,season.season,season.crop,season.cultivar,season.area_ha,season.planted_at,season.harvested_at,season.created_at,field.id field_id,property.id property_id FROM crop_seasons season JOIN fields field ON field.tenant_id=season.tenant_id AND field.id=season.field_id JOIN properties property ON property.tenant_id=field.tenant_id AND property.id=field.property_id WHERE season.tenant_id=c.tenant_id AND property.client_id=c.id ORDER BY COALESCE(season.planted_at,season.created_at::date) DESC,season.id DESC LIMIT 1) latest_crop) latest_crop_season`)
      if(needs('BEHAVIORAL_PROFILE'))select.push(
        'c.id client_internal_id','c.tenant_id client_tenant_id','c.consultant_id client_consultant_id',
        'p.id profile_id','p.tenant_id profile_tenant_id','p.client_id profile_client_id',
        'p.primary_profile','p.secondary_profile','p.answers profile_answers','p.evidence profile_evidence',
        'p.profile_snapshot','p.source_survey_id','p.valid_until profile_valid_until','p.assessed_at profile_assessed_at'
      )
      const profileJoin=needs('BEHAVIORAL_PROFILE')?' LEFT JOIN LATERAL (SELECT id,tenant_id,client_id,primary_profile,secondary_profile,answers,evidence,profile_snapshot,source_survey_id,valid_until,assessed_at FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true':''
      const result=await this.db.query(`SELECT ${select.join(',\n')} FROM clients c${profileJoin} WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active' AND (c.id::text=$3 OR c.external_key=$3 OR COALESCE(c.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? $3) ORDER BY CASE WHEN c.id::text=$3 OR c.external_key=$3 THEN 0 ELSE 1 END LIMIT 1`,[tenantId,ownerId,String(clientId)],...databaseTimeoutArgs(timeoutMs))
      if(!result.rowCount)throw domainError('Produtor não encontrado na carteira autorizada.',404)
      const row=result.rows[0]
      const completed=row.latest_completed_visit||null
      const requestedFastScope={tenantId,producerId:String(row.client_external_key),ownerId}
      const fastScope=row.profile_id?assertVerifiedProfileRowScope(row,requestedFastScope):requestedFastScope
      const profileValidUntil=iso(row.profile_valid_until)
      const profileSourceRef=row.profile_id?`client_profile:${row.profile_id}`:null
      const canonicalProfile=needs('BEHAVIORAL_PROFILE')&&row.profile_id?materializeCanonicalBehavioralProfileEvidence({
        profileId:row.profile_id,primaryProfile:row.primary_profile,secondaryProfile:row.secondary_profile,
        answers:row.profile_answers,evidence:row.profile_evidence,profileSnapshot:row.profile_snapshot,
        sourceSurveyId:row.source_survey_id,assessedAt:row.profile_assessed_at,validUntil:row.profile_valid_until,scope:fastScope,
      }):{selected:[],rejected:[]}
      const profileEvidence=canonicalProfile.selected
      const canonicalProfileValues=Object.fromEntries(profileEvidence.map(item=>[item.source_field,item.materialized_value]).filter(([field,value])=>field&&value))
      const fastProfileClient=needs('BEHAVIORAL_PROFILE')?{
        primaryProfile:canonicalProfileValues.primaryProfile??null,secondaryProfile:canonicalProfileValues.secondaryProfile??null,
        ...Object.fromEntries(profileBehavioralAnswerFields.map(({field})=>[field,canonicalProfileValues[field]??null])),
        profileEvidence,profileUpdatedAt:iso(row.profile_assessed_at),profileValidUntil,
      }:{}
      const scopedFast=item=>item?repositoryScopedRecord(item,fastScope):null
      return {client:repositoryScopedRecord({id:String(row.client_external_key),name:String(row.name||'Produtor'),totalAreaHa:row.total_area_ha==null?null:Number(row.total_area_ha),areaBand:row.area_band||null,cultures:row.cultures||null,...fastProfileClient},fastScope),profileEvidence,profileRejectedEvidence:canonicalProfile.rejected,profileSourceRef,profileAssessedAt:iso(row.profile_assessed_at),profileValidUntil,latestVisit:scopedFast(completed),latestCompletedVisit:scopedFast(completed),nextScheduledVisit:scopedFast(row.next_scheduled_visit),latestCommitment:scopedFast(row.latest_commitment),latestPurchase:scopedFast(row.latest_purchase),latestConfirmedObjection:scopedFast(row.latest_confirmed_objection),latestVisitConfirmedObjection:scopedFast(row.latest_visit_confirmed_objection),latestCropSeason:scopedFast(row.latest_crop_season)}
    }catch(error){if(error.statusCode)throw error;throw serviceError('Os fatos rápidos do produtor não puderam ser lidos no PostgreSQL configurado.')}
  }

  async getClientContext({tenantId=this.tenantId,clientId,client={},ownerId,contextRequest={}}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){
      const store=this.fallback()
      const currentTechnical=fallbackTechnicalContext(store.val.technicalContexts,tenantId,ownerId,clientId)
      const technicalHistory=[...(store.val.technicalContextHistory||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.clientId)===String(clientId)),...(currentTechnical?[{...currentTechnical,clientId}]:[])].map(item=>({...item,tenant_id:tenantId,client_id:clientId,memory_type:'fact',memory_state:item.memoryState||'HYPOTHESIS',memory_domain:item.memoryDomain||'AGRONOMIC',key:'consultant_technical_context',value:Object.fromEntries(Object.entries(item).filter(([key])=>!['id','clientId','tenantId','ownerId','status','validFrom','validUntil','updatedAt','sourceRef','sourceType','supersedesId','memoryState','memoryDomain','observedAt','sourceUpdatedAt','freshnessPolicyVersion','freshnessMetadata'].includes(key))),source:'consultant_input',source_ref:item.sourceRef||`fallback_memory:${item.id||clientId}`,source_type:item.sourceType||'consultant_input',observed_at:item.observedAt||null,source_updated_at:item.sourceUpdatedAt||null,freshness_policy_version:item.freshnessPolicyVersion||null,freshness_metadata:item.freshnessMetadata||{},valid_from:item.validFrom||item.updatedAt,valid_until:item.validUntil,updated_at:item.updatedAt,id:item.id||`fallback-${clientId}`,supersedes_id:item.supersedesId||null,acl:{scope:'own_portfolio'}}))
      const visitMemories=store.val.memories.filter(item=>exactScope(item,tenantId,ownerId)&&String(item.client_id??item.clientId)===String(clientId))
      const memoryHistory=[...visitMemories,...technicalHistory]
      const commitments=store.val.commitments.filter(item=>exactScope(item,tenantId,ownerId)&&String(item.client_id??item.clientId)===String(clientId))
      const attachments=(store.val.attachments||[]).filter(item=>attachmentInTenant(item,tenantId)&&String(item.ownerId)===String(ownerId)&&String(item.clientId)===String(clientId)&&item.status!=='rejected').sort((left,right)=>(timestamp(right.updated_at??right.updatedAt??right.created_at??right.createdAt)||0)-(timestamp(left.updated_at??left.updatedAt??left.created_at??left.createdAt)||0)).slice(0,12).map(attachmentMetadataRecord)
      const context={client,profile:{answers:client.profileAnswers||{},evidence:client.profileEvidence||[],assessedAt:client.profileUpdatedAt||null,validUntil:client.profileValidUntil||null},signals:store.val.signals.filter(item=>exactScope(item,tenantId,ownerId)&&(!clientId||item.clientExternalKey===clientId)).slice(-20),learning:{...this.fallbackLearning(clientId,ownerId,tenantId),visitOutcomes:store.val.outcomes.filter(item=>exactScope(item,tenantId,ownerId)&&String(item.client_id??item.clientId)===String(clientId))},memories:memoryHistory.filter(item=>['proposed','verified'].includes(item.status)&&(!item.valid_until||new Date(item.valid_until)>new Date())),memoryHistory,businessHistory:[],visits:(store.visits||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.clientId??item.client_id)===String(clientId)),interactions:store.interactions.filter(item=>exactScope(item,tenantId,ownerId)&&String(item.clientId??item.client_id)===String(clientId)),commitments,opportunities:(store.opportunities||[]).filter(item=>exactScope(item,tenantId,ownerId)&&String(item.clientId??item.client_id)===String(clientId)),properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],attachments,priorRecommendations:[]}
      return attachContextSnapshot(context,{tenantId,clientId,ownerId,repositoryClientId:client.id||clientId,contextRequest})
    }
    try{
      const result=await this.db.query(`SELECT c.*,p.id profile_id,p.tenant_id profile_tenant_id,p.client_id profile_client_id,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.answers,p.evidence profile_evidence,p.source_survey_id,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,
        COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot,
        COALESCE((SELECT SUM(value) FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won'),0) purchase_total,
        COALESCE((SELECT COUNT(*) FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won'),0) purchase_count,
        (SELECT MAX(occurred_at) FROM business_events business WHERE business.tenant_id=c.tenant_id AND business.client_id=c.id AND business.outcome='won') last_purchase_at,
        COALESCE((SELECT SUM(estimated_value) FROM opportunities opportunity WHERE opportunity.tenant_id=c.tenant_id AND opportunity.client_id=c.id AND opportunity.stage<>'Fechado'),0) open_pipeline,
        COALESCE((SELECT jsonb_agg(s ORDER BY s.created_at DESC) FROM (SELECT id,source_event_id,signal_type,severity,title,evidence,commercial_hypothesis,requires_agronomist,status,created_at FROM agronomic_signals WHERE tenant_id=$1 AND client_id=c.id ORDER BY created_at DESC LIMIT 20) s),'[]'::jsonb) signals,
        COALESCE((SELECT jsonb_build_object('wins',count(*) FILTER (WHERE outcome='won'),'losses',count(*) FILTER (WHERE outcome='lost'),'revenue',COALESCE(sum(value) FILTER (WHERE outcome='won'),0)) FROM business_events WHERE tenant_id=$1 AND client_id=c.id),'{}'::jsonb) learning,
        COALESCE((SELECT jsonb_build_object('rated',count(*),'average_rating',round(avg(f.rating)::numeric,2),'accepted',count(*) FILTER (WHERE f.outcome='accepted'),'edited',count(*) FILTER (WHERE f.outcome='edited'),'executed',count(*) FILTER (WHERE f.outcome='executed'),'won',count(*) FILTER (WHERE f.outcome='won'),'lost',count(*) FILTER (WHERE f.outcome='lost')) FROM val_feedback f JOIN val_recommendations r ON r.id=f.recommendation_id AND r.tenant_id=f.tenant_id AND r.consultant_id=$3 WHERE f.tenant_id=$1 AND (r.client_id=c.id OR r.client_external_key=c.external_key)),'{}'::jsonb) feedback_learning,
        COALESCE((SELECT jsonb_agg(outcome_record ORDER BY outcome_record.measured_at) FROM (SELECT outcome.id outcome_id,outcome.visit_id,outcome.visit_report_id,outcome.outcome_type,outcome.result,outcome.evidence_refs,outcome.measured_at,outcome.confidence,outcome.created_at FROM val_outcomes outcome JOIN visits outcome_visit ON outcome_visit.tenant_id=outcome.tenant_id AND outcome_visit.id=outcome.visit_id AND outcome_visit.client_id=outcome.client_id WHERE outcome.tenant_id=$1 AND outcome.client_id=c.id AND outcome_visit.consultant_id=$3 ORDER BY outcome.measured_at DESC LIMIT 50) outcome_record),'[]'::jsonb) visit_outcomes,
        COALESCE((SELECT jsonb_agg(m ORDER BY m.valid_from DESC) FROM (SELECT id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,confidence,status,source,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,valid_from,valid_until,supersedes_id,created_at,updated_at,created_by,acl FROM val_memories WHERE tenant_id=$1 AND client_id=c.id AND status IN ('verified','proposed') AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY valid_from DESC LIMIT 50) m),'[]'::jsonb) memories,
        COALESCE((SELECT jsonb_agg(mh ORDER BY mh.valid_from DESC) FROM (SELECT id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,confidence,status,source,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,valid_from,valid_until,supersedes_id,created_at,updated_at,created_by,acl FROM val_memories WHERE tenant_id=$1 AND (client_id=c.id OR (subject_type='organization' AND subject_id=$1::text)) ORDER BY valid_from DESC,updated_at DESC LIMIT 250) mh),'[]'::jsonb) memory_history,
        COALESCE((SELECT jsonb_agg(b ORDER BY b.occurred_at DESC) FROM (SELECT id,source,external_id,occurred_at,outcome,category,product,quantity,value,margin,currency,loss_reason,payload FROM business_events WHERE tenant_id=$1 AND client_id=c.id ORDER BY occurred_at DESC LIMIT 50) b),'[]'::jsonb) business_history,
        COALESCE((SELECT jsonb_agg(v ORDER BY COALESCE(v.updated_at,v.created_at) DESC) FROM (SELECT id,scheduled_at,objective,process_agreement,summary,next_commitment,next_action_at,status,created_at,updated_at FROM visits WHERE tenant_id=$1 AND client_id=c.id ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 30) v),'[]'::jsonb) visits,
        COALESCE((SELECT jsonb_agg(i ORDER BY i.occurred_at DESC) FROM (SELECT id,visit_id,channel,direction,occurred_at,summary,commitments,source,source_external_id,created_at FROM interactions WHERE tenant_id=$1 AND client_id=c.id ORDER BY occurred_at DESC LIMIT 50) i),'[]'::jsonb) interactions,
        COALESCE((SELECT jsonb_agg(commitment ORDER BY commitment.due_at,commitment.created_at DESC) FROM (SELECT id commitment_id,client_id,visit_id,opportunity_id,action_plan_id,action_id,description,owner_type,owner_id,due_at,status,success_criteria,agreed_with_client,evidence_refs,source_ref,audit,created_at,updated_at,completed_at,cancelled_at FROM val_commitments WHERE tenant_id=$1 AND client_id=c.id ORDER BY due_at,created_at DESC LIMIT 100) commitment),'[]'::jsonb) commitments,
        COALESCE((SELECT jsonb_agg(o ORDER BY o.updated_at DESC) FROM (SELECT opportunity.id,opportunity.external_key,opportunity.title,opportunity.category,opportunity.hypothesis,opportunity.estimated_value,opportunity.estimated_margin,opportunity.probability,opportunity.stage,opportunity.next_action,opportunity.next_action_at,opportunity.evidence,opportunity.created_at,opportunity.updated_at,(SELECT jsonb_build_object('baseline',value_case.baseline,'alternative',value_case.alternative,'assumptions',value_case.assumptions,'expected_value',value_case.expected_value,'low_value',value_case.low_value,'high_value',value_case.high_value,'total_incremental_cost',value_case.total_incremental_cost,'roi_percent',value_case.roi_percent,'proof_plan',value_case.proof_plan,'validated_at',value_case.validated_at) FROM value_cases value_case WHERE value_case.tenant_id=$1 AND value_case.opportunity_id=opportunity.id ORDER BY value_case.created_at DESC LIMIT 1) value_case FROM opportunities opportunity WHERE opportunity.tenant_id=$1 AND opportunity.client_id=c.id ORDER BY opportunity.updated_at DESC LIMIT 200) o),'[]'::jsonb) opportunities,
        COALESCE((SELECT jsonb_agg(prop ORDER BY prop.updated_at DESC) FROM (SELECT property.id,property.external_key,property.name,property.municipality,property.area_ha,property.metadata,property.created_at,property.updated_at,COALESCE((SELECT jsonb_agg(field_record ORDER BY field_record.created_at DESC) FROM (SELECT field.id,field.external_key,field.name,field.area_ha,field.geometry_ref,field.geometry_version,field.created_at,COALESCE((SELECT jsonb_agg(season_record ORDER BY season_record.created_at DESC) FROM (SELECT season,crop,cultivar,area_ha,productivity_target,productivity_actual,unit,planted_at,harvested_at,created_at FROM crop_seasons WHERE tenant_id=$1 AND field_id=field.id ORDER BY created_at DESC LIMIT 12) season_record),'[]'::jsonb) seasons FROM fields field WHERE field.tenant_id=$1 AND field.property_id=property.id ORDER BY field.created_at DESC LIMIT 50) field_record),'[]'::jsonb) fields FROM properties property WHERE property.tenant_id=$1 AND property.client_id=c.id ORDER BY property.updated_at DESC LIMIT 30) prop),'[]'::jsonb) properties,
        COALESCE((SELECT jsonb_agg(report ORDER BY COALESCE(report.observed_at,report.created_at) DESC) FROM (SELECT field_report.id,field_report.source,field_report.external_id,field_report.property_external_key,field_report.field_external_key,field_report.observed_at,field_report.crop_stage,field_report.summary,field_report.validated_actions,field_report.validation_evidence,field_report.validated_at,field_report.created_at,COALESCE((SELECT jsonb_agg(observation ORDER BY observation.created_at DESC) FROM (SELECT id,observation_type,value,unit,confidence,evidence_ref,requires_review,created_at FROM field_observations WHERE tenant_id=$1 AND report_id=field_report.id ORDER BY created_at DESC LIMIT 50) observation),'[]'::jsonb) observations FROM field_reports field_report WHERE field_report.tenant_id=$1 AND field_report.client_id=c.id ORDER BY COALESCE(field_report.observed_at,field_report.created_at) DESC LIMIT 20) report),'[]'::jsonb) field_reports,
        COALESCE((SELECT jsonb_agg(analysis ORDER BY COALESCE(analysis.sampled_at,analysis.created_at::date) DESC) FROM (SELECT soil.id,soil.source,soil.external_id,soil.property_external_key,soil.field_external_key,soil.laboratory,soil.method,soil.depth_from_cm,soil.depth_to_cm,soil.sampled_at,soil.validated_flags,soil.validation_evidence,soil.validated_at,soil.created_at,COALESCE((SELECT jsonb_agg(measurement ORDER BY measurement.created_at DESC) FROM (SELECT id,sample_key,analyte,raw_value,raw_unit,normalized_value,normalized_unit,method,interpretation,confidence,link_version,created_at FROM soil_measurements WHERE tenant_id=$1 AND analysis_id=soil.id AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 100) measurement),'[]'::jsonb) measurements FROM soil_analyses soil WHERE soil.tenant_id=$1 AND soil.client_id=c.id ORDER BY COALESCE(soil.sampled_at,soil.created_at::date) DESC LIMIT 20) analysis),'[]'::jsonb) soil_analyses,
        COALESCE((SELECT jsonb_agg(ndvi ORDER BY ndvi.observed_at DESC) FROM (SELECT id,source,external_id,property_external_key,field_external_key,index_name,observed_at,sensor,resolution_m,cloud_percent,processing_version,geometry_version,statistics,anomaly,validated_at,created_at FROM ndvi_observations WHERE tenant_id=$1 AND client_id=c.id ORDER BY observed_at DESC LIMIT 30) ndvi),'[]'::jsonb) ndvi_observations,
        COALESCE((SELECT jsonb_agg(manual_record ORDER BY manual_record.occurred_at DESC) FROM (SELECT id,external_id,event_type,occurred_at,property_external_key,field_external_key,payload,status,ingested_at FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$3 AND source='manual-do-agronomo' AND (client_external_key=c.external_key OR COALESCE(c.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? client_external_key) AND event_type IN ('manual.record.saved','manual.producer.updated','manual.workspace.updated') ORDER BY occurred_at DESC LIMIT 40) manual_record),'[]'::jsonb) manual_records,
        COALESCE((SELECT jsonb_agg(attachment_record ORDER BY COALESCE(attachment_record.updated_at,attachment_record.created_at) DESC) FROM (SELECT attachment.id,attachment.tenant_id,attachment.client_id,c.external_key client_external_key,attachment.original_name,attachment.mime_type,attachment.size_bytes,attachment.sha256,attachment.status,attachment.analysis,attachment.created_at,attachment.updated_at,attachment.confirmed_at FROM val_attachments attachment WHERE attachment.tenant_id=$1 AND attachment.consultant_id=$3 AND attachment.client_id=c.id AND attachment.status<>'rejected' ORDER BY COALESCE(attachment.updated_at,attachment.created_at) DESC LIMIT 12) attachment_record),'[]'::jsonb) attachments,
        COALESCE((SELECT jsonb_agg(recommendation ORDER BY recommendation.created_at DESC) FROM (SELECT val_recommendation.id,val_recommendation.tenant_id::text tenant_id,val_recommendation.consultant_id::text owner_id,COALESCE(val_recommendation.client_external_key,val_recommendation.client_id::text) producer_id,val_recommendation.user_question,val_recommendation.mode,val_recommendation.model_version,val_recommendation.status,val_recommendation.context_snapshot_id,val_recommendation.context_snapshot_version,val_recommendation.input_context->'contextSnapshot'->'context_scope'->>'conversation_id' conversation_id,val_recommendation.input_context->'contextSnapshot'->'context_scope'->>'context_epoch' context_epoch,val_recommendation.input_context->'contextSnapshot'->'context_scope'->>'domain' domain,val_recommendation.generated_content->>'next_best_action' next_best_action,val_recommendation.generated_content->'methodology_state' methodology_state,val_recommendation.generated_content->'next_question' next_question,val_recommendation.generated_content->'decision_profile' decision_profile,val_recommendation.generated_content->'commercial_context' commercial_context,val_recommendation.created_at,(SELECT jsonb_build_object('rating',feedback.rating,'outcome',feedback.outcome,'notes',feedback.notes,'created_at',feedback.created_at) FROM val_feedback feedback WHERE feedback.tenant_id=$1 AND feedback.recommendation_id=val_recommendation.id LIMIT 1) feedback FROM val_recommendations val_recommendation WHERE val_recommendation.tenant_id=$1 AND val_recommendation.consultant_id=$3 AND (val_recommendation.client_id=c.id OR val_recommendation.client_external_key=c.external_key) ORDER BY val_recommendation.created_at DESC LIMIT 10) recommendation),'[]'::jsonb) prior_recommendations
        FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
        LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
        WHERE c.tenant_id=$1 AND c.consultant_id=$3 AND (c.id::text=$2 OR c.external_key=$2 OR COALESCE(c.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? $2) ORDER BY CASE WHEN c.id::text=$2 OR c.external_key=$2 THEN 0 ELSE 1 END LIMIT 1`,[tenantId,clientId,ownerId],...databaseTimeoutArgs(contextRequest?.databaseTimeoutMs))
      if(!result.rows[0])throw Object.assign(new Error('Cliente não encontrado na base autorizada.'),{statusCode:404})
      const row=result.rows[0]
      const publicClientId=String(row.external_key||clientId)
      const rawProfileEvidence=Array.isArray(row.profile_evidence)?row.profile_evidence:[]
      const canonicalClientMemory=item=>{
        const type=String(item?.subject_type||item?.subjectType||'client').toLowerCase()
        if(type!=='client')return item
        return {...item,client_id:publicClientId,subject_id:publicClientId}
      }
      const memories=(row.memories||[]).map(canonicalClientMemory)
      const memoryHistory=(row.memory_history||row.memories||[]).map(canonicalClientMemory)
      const profileSourceRef=row.profile_id?`client_profile:${row.profile_id}`:row.source_survey_id||rawProfileEvidence.map(profileEvidenceIdentifier).find(Boolean)||null
      const verifiedProfileScope=row.profile_id?assertVerifiedProfileRowScope({
        ...row,client_internal_id:row.id,client_tenant_id:row.tenant_id,client_consultant_id:row.consultant_id,client_external_key:publicClientId,
      },{tenantId,ownerId,producerId:publicClientId}):{tenantId,ownerId,producerId:publicClientId,repositoryClientId:String(row.id||'')}
      const canonicalProfile=row.profile_id?materializeCanonicalBehavioralProfileEvidence({
        profileId:row.profile_id,primaryProfile:row.primary_profile,secondaryProfile:row.secondary_profile,
        answers:row.answers,evidence:rawProfileEvidence,profileSnapshot:row.profile_snapshot,
        sourceSurveyId:row.source_survey_id,assessedAt:row.profile_assessed_at,validUntil:row.profile_valid_until,scope:verifiedProfileScope,
      }):{selected:[],rejected:[]}
      const profileEvidence=row.profile_id
        ?canonicalProfile.selected
        :materializeLegacyProfileEvidence(rawProfileEvidence,verifiedProfileScope,profileSourceRef,{answers:row.answers,assessedAt:iso(row.profile_assessed_at),validUntil:iso(row.profile_valid_until)})
      const canonicalProfileValues=Object.fromEntries(profileEvidence.map(item=>[item.source_field,item.materialized_value]).filter(([field,value])=>field&&value))
      const canonicalAnswers=row.profile_id
        ?Object.fromEntries(profileBehavioralAnswerFields.map(({field,question})=>[question,canonicalProfileValues[field]]).filter(([,value])=>value))
        :jsonObject(row.answers)
      const baseClient=clientFromRow(row)
      const contextClient=row.profile_id?{
        ...baseClient,primaryProfile:canonicalProfileValues.primaryProfile??null,secondaryProfile:canonicalProfileValues.secondaryProfile??null,
        ...Object.fromEntries(profileBehavioralAnswerFields.map(({field})=>[field,profileContextClientValue(field,canonicalProfileValues[field])])),
        profileSelfReported:profileEvidence.some(item=>item.epistemic_type==='QUOTE'),profileEvidence,
      }:{...baseClient,profileSelfReported:profileEvidence.some(item=>item?.self_reported===true),profileEvidence}
      const context={client:contextClient,profile:{answers:canonicalAnswers,evidence:profileEvidence,rejectedEvidence:canonicalProfile.rejected,assessedAt:iso(row.profile_assessed_at)||null,validUntil:iso(row.profile_valid_until)||null,sourceId:profileSourceRef},signals:row.signals||[],learning:{...(row.learning||{}),recommendations:row.feedback_learning||{},visitOutcomes:row.visit_outcomes||[]},memories,memoryHistory,businessHistory:row.business_history||[],visits:row.visits||[],interactions:row.interactions||[],commitments:row.commitments||[],opportunities:row.opportunities||[],properties:row.properties||[],fieldReports:row.field_reports||[],soilAnalyses:row.soil_analyses||[],ndviObservations:row.ndvi_observations||[],manualRecords:row.manual_records||[],attachments:(row.attachments||[]).map(attachmentMetadataRecord),priorRecommendations:row.prior_recommendations||[]}
      // ContextSnapshot usa o identificador canônico exposto pelo contrato
      // (external_key), igual a context.client.id e ao envelope do ValEngine.
      // O UUID interno já foi validado pelo SELECT tenant+owner e não deve
      // atravessar a fronteira de contexto pré-carregado.
      return attachContextSnapshot(context,{tenantId,clientId:publicClientId,ownerId,repositoryClientId:row.id,contextRequest})
    }catch(error){if(error.statusCode===404)throw error;throw serviceError('O contexto do cliente não pôde ser lido no banco configurado.')}
  }

  async getTechnicalContext(clientId,ownerId){
    if(!this.db.configured)return fallbackTechnicalContext(this.fallback().val.technicalContexts,this.tenantId,ownerId,clientId)
    try{const result=await this.db.query(`SELECT m.value,m.status,m.updated_at FROM clients c LEFT JOIN LATERAL (SELECT value,status,updated_at FROM val_memories WHERE tenant_id=c.tenant_id AND client_id=c.id AND key='consultant_technical_context' AND status IN ('proposed','verified') AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY valid_from DESC,updated_at DESC LIMIT 1) m ON true WHERE c.tenant_id=$1 AND c.consultant_id=$3 AND (c.id::text=$2 OR c.external_key=$2 OR COALESCE(c.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? $2) ORDER BY CASE WHEN c.id::text=$2 OR c.external_key=$2 THEN 0 ELSE 1 END LIMIT 1`,[this.tenantId,clientId,ownerId]);if(!result.rowCount)throw domainError('Cliente não encontrado na base autorizada.',404);return result.rows[0].value?{...result.rows[0].value,status:result.rows[0].status,updatedAt:iso(result.rows[0].updated_at)}:null}catch(error){if(error.statusCode)throw error;throw serviceError('O complemento técnico não pôde ser lido no PostgreSQL configurado.')}
  }

  async saveTechnicalContext(clientId,input,ownerId){
    const allowed=['property','crops','area','weeds','diseases','insects','soil','goal','competitors','notes'];const value=Object.fromEntries(allowed.map(key=>[key,String(input?.[key]||'').trim().slice(0,key==='notes'?10_000:2_000)]));const observedAt=new Date().toISOString()
    if(!this.db.configured){if(!ownerId)throw domainError('O proprietário da carteira é obrigatório para salvar contexto técnico.',403,'owner_scope_required');const store=this.fallback();store.val.technicalContextHistory||=[];const contextKey=fallbackTechnicalContextKey(this.tenantId,ownerId,clientId);const previous=fallbackTechnicalContext(store.val.technicalContexts,this.tenantId,ownerId,clientId);const id=randomUUID();if(previous)store.val.technicalContextHistory.push({...previous,clientId,status:'expired',validUntil:observedAt});store.val.technicalContextHistory=store.val.technicalContextHistory.slice(-1000);if(previous===store.val.technicalContexts[clientId])delete store.val.technicalContexts[clientId];store.val.technicalContexts[contextKey]={...value,id,tenantId:this.tenantId,ownerId,status:'proposed',memoryState:'HYPOTHESIS',memoryDomain:'AGRONOMIC',sourceRef:`consultant_input:${id}`,sourceType:'consultant_input',observedAt,sourceUpdatedAt:observedAt,freshnessPolicyVersion:'val.context.freshness.v1',freshnessMetadata:{domain:'AGRONOMIC',source_type:'consultant_input',observation_origin:'consultant_supplied'},supersedesId:previous?.id||null,validFrom:observedAt,updatedAt:observedAt};this.saveStore(store);return {...value,status:'proposed',updatedAt:observedAt}}
    try{return await this.db.transaction(async connection=>{
      const client=await connection.query(`SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$3 AND (id::text=$2 OR external_key=$2 OR COALESCE(commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? $2) ORDER BY CASE WHEN id::text=$2 OR external_key=$2 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`,[this.tenantId,clientId,ownerId])
      if(!client.rowCount)throw domainError('Cliente não encontrado na sua carteira.',404)
      const previous=await connection.query(`SELECT id FROM val_memories WHERE tenant_id=$1 AND client_id=$2 AND key='consultant_technical_context' AND status IN ('proposed','verified') ORDER BY valid_from DESC,updated_at DESC LIMIT 1 FOR UPDATE`,[this.tenantId,client.rows[0].id])
      const superseded=await connection.query(`UPDATE val_memories SET status='expired',valid_until=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND client_id=$2 AND key='consultant_technical_context' AND status IN ('proposed','verified') RETURNING id`,[this.tenantId,client.rows[0].id])
      const id=randomUUID()
      const evidence=jsonbParameter([{source:'consultant_input',source_ref:`consultant_input:${id}`,observed_at:observedAt,verification:'pending',supersedes:(superseded.rows||[]).map(item=>item.id)}])
      const acl=jsonbParameter({scope:'own_portfolio',roles:['admin','manager','consultant','technical_reviewer']})
      const freshnessMetadata=jsonbParameter({domain:'AGRONOMIC',source_type:'consultant_input',observation_origin:'consultant_supplied'})
      await connection.query(`INSERT INTO val_memories (id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,status,source,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,valid_from,supersedes_id,created_by,acl,created_at,updated_at) VALUES ($1,$2,$3,'client',($3::uuid)::text,'fact','HYPOTHESIS','AGRONOMIC','consultant_technical_context',$4,$5,'proposed','consultant_input',$6,'consultant_input',$7,$7,'val.context.freshness.v1',$8,NOW(),$9,$10,$11,NOW(),NOW())`,[id,this.tenantId,client.rows[0].id,jsonbParameter(value),evidence,`consultant_input:${id}`,observedAt,freshnessMetadata,previous.rows[0]?.id||null,ownerId,acl])
      return {...value,status:'proposed',updatedAt:observedAt}
    })}catch(error){if(error.statusCode)throw error;throw serviceError('O complemento técnico não pôde ser salvo no PostgreSQL configurado.')}
  }

  fallbackLearning(clientId,ownerId,tenantId=this.tenantId){
    const events=this.fallback().val.integrationEvents.filter(item=>exactScope(item,tenantId,ownerId)&&(!clientId||item.clientExternalKey===clientId))
    return {wins:events.filter(item=>item.type==='business.closed').length,losses:events.filter(item=>item.type==='business.lost').length,revenue:events.filter(item=>item.type==='business.closed').reduce((sum,item)=>sum+Number(item.payload?.value||0),0)}
  }

  async createAttachment({tenantId=this.tenantId,ownerId,clientId=null,association=clientId?'LINKED_CLIENT':'UNLINKED',originalName,mimeType,sizeBytes,dataBase64,deduplicate=true}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    association=String(association||'').toUpperCase();if(!['LINKED_CLIENT','UNLINKED'].includes(association))throw domainError('Associação de arquivo inválida.',400,'attachment_association_invalid')
    if(association==='LINKED_CLIENT'&&!clientId)throw domainError('Selecione um produtor antes de vincular o arquivo.',400,'attachment_client_required')
    if(association==='UNLINKED'&&clientId)throw domainError('Um arquivo UNLINKED não pode declarar produtor.',400,'attachment_unlinked_client_conflict')
    const id=randomUUID();const sha256=createHash('sha256').update(dataBase64).digest('hex')
    if(!this.db.configured){const store=this.fallback();const normalizedClientId=association==='UNLINKED'?null:clientId;const duplicate=deduplicate?store.val.attachments.find(item=>attachmentInTenant(item,tenantId)&&item.ownerId===ownerId&&(item.clientId||null)===(normalizedClientId||null)&&item.sha256===sha256&&item.status!=='rejected'):null;if(duplicate)return attachmentRecord(duplicate);const item={id,tenantId,tenant_id:tenantId,ownerId,clientId:normalizedClientId,client_id:normalizedClientId,client_external_key:normalizedClientId,original_name:originalName,mime_type:mimeType,size_bytes:sizeBytes,content_base64:dataBase64,sha256,status:'received',analysis:{association:{state:association}},created_at:new Date().toISOString(),updated_at:new Date().toISOString()};store.val.attachments.push(item);store.val.attachments=store.val.attachments.slice(-200);this.saveStore(store);return attachmentRecord(item)}
    try{
      if(association==='UNLINKED'){
        const result=await this.db.query("INSERT INTO val_attachments (id,tenant_id,consultant_id,client_id,original_name,mime_type,size_bytes,content_base64,sha256,status,analysis) SELECT $1,$2,$3,NULL,$4,$5,$6,$7,$8,'received',$9::jsonb WHERE ($10::boolean=FALSE OR NOT EXISTS (SELECT 1 FROM val_attachments a WHERE a.tenant_id=$2 AND a.consultant_id=$3 AND a.client_id IS NULL AND a.sha256=$8 AND a.status<>'rejected')) RETURNING *,NULL::text client_external_key",[id,tenantId,ownerId,originalName,mimeType,sizeBytes,dataBase64,sha256,jsonbParameter({association:{state:'UNLINKED'}}),Boolean(deduplicate)]);if(result.rows[0])return attachmentRecord(result.rows[0]);if(deduplicate){const duplicate=await this.db.query("SELECT a.*,NULL::text client_external_key FROM val_attachments a WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND a.client_id IS NULL AND a.sha256=$3 AND a.status<>'rejected' ORDER BY a.created_at DESC LIMIT 1",[tenantId,ownerId,sha256]);if(duplicate.rows[0])return attachmentRecord(duplicate.rows[0])}throw domainError('O attachment UNLINKED não pôde ser criado.',409,'attachment_unlinked_create_conflict')
      }
      const result=await this.db.query("INSERT INTO val_attachments (id,tenant_id,consultant_id,client_id,original_name,mime_type,size_bytes,content_base64,sha256,status,analysis) SELECT $1,$2,$3,c.id,$5,$6,$7,$8,$9,'received',$11::jsonb FROM clients c WHERE c.tenant_id=$2 AND c.consultant_id=$3 AND (c.id::text=$4 OR c.external_key=$4) AND ($10::boolean=FALSE OR NOT EXISTS (SELECT 1 FROM val_attachments a WHERE a.tenant_id=$2 AND a.consultant_id=$3 AND a.client_id=c.id AND a.sha256=$9 AND a.status<>'rejected')) RETURNING *, (SELECT external_key FROM clients WHERE id=client_id) client_external_key",[id,tenantId,ownerId,clientId,originalName,mimeType,sizeBytes,dataBase64,sha256,Boolean(deduplicate),jsonbParameter({association:{state:'LINKED_CLIENT'}})]);if(result.rows[0])return attachmentRecord(result.rows[0]);if(deduplicate){const duplicate=await this.db.query("SELECT a.*,c.external_key client_external_key FROM val_attachments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND (c.id::text=$3 OR c.external_key=$3) AND a.sha256=$4 AND a.status<>'rejected' ORDER BY a.created_at DESC LIMIT 1",[tenantId,ownerId,clientId,sha256]);if(duplicate.rows[0])return attachmentRecord(duplicate.rows[0])}throw domainError('Produtor não encontrado na sua carteira.',404)
    }catch(error){if(error.statusCode)throw error;throw serviceError('O arquivo não pôde ser salvo na nuvem.')}
  }

  async listAttachments({tenantId=this.tenantId,ownerId,clientId,limit=20,signal,timeoutMs}){
    throwIfPersistenceCancelled(signal)
    tenantId=assertTenantScope(this.tenantId,tenantId)
    const normalizedClientId=clientId?String(clientId):null
    if(!this.db.configured){const result=this.fallback().val.attachments.filter(item=>attachmentInTenant(item,tenantId)&&item.ownerId===ownerId&&(item.clientId||null)===(normalizedClientId||null)&&item.status!=='rejected').slice(-limit).reverse().map(attachmentMetadataRecord);throwIfPersistenceCancelled(signal);return result}
    try{const result=await this.db.query("SELECT a.*,NULL::text content_base64,c.external_key client_external_key FROM val_attachments a LEFT JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND (($3::text='' AND a.client_id IS NULL) OR ($3::text<>'' AND (c.id::text=$3 OR c.external_key=$3))) AND a.status<>'rejected' ORDER BY a.created_at DESC LIMIT $4",[tenantId,ownerId,normalizedClientId||'',Math.max(1,Math.min(100,Number(limit)||20))],{signal,timeoutMs});throwIfPersistenceCancelled(signal);return result.rows.map(attachmentRecord)}catch(error){if(signal?.aborted)throw persistenceCancellationError(signal);throw serviceError('Os arquivos deste escopo não puderam ser lidos.')}
  }

  async getAttachments({tenantId=this.tenantId,ownerId,clientId,ids=[],signal,timeoutMs}){
    throwIfPersistenceCancelled(signal)
    tenantId=assertTenantScope(this.tenantId,tenantId)
    const unique=[...new Set((ids||[]).map(String))].slice(0,3);if(!unique.length)return []
    if(!this.db.configured){const result=this.fallback().val.attachments.filter(item=>attachmentInTenant(item,tenantId)&&item.ownerId===ownerId&&item.clientId===clientId&&item.status!=='rejected'&&unique.includes(String(item.id))).map(attachmentRecord);throwIfPersistenceCancelled(signal);return result}
    try{const result=await this.db.query("SELECT a.*,c.external_key client_external_key FROM val_attachments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND (c.id::text=$3 OR c.external_key=$3) AND a.id=ANY($4::uuid[]) AND a.status<>'rejected' ORDER BY a.created_at",[tenantId,ownerId,clientId,unique],{signal,timeoutMs});throwIfPersistenceCancelled(signal);return result.rows.map(attachmentRecord)}catch(error){if(signal?.aborted)throw persistenceCancellationError(signal);throw serviceError('Os anexos selecionados não puderam ser lidos.')}
  }

  async getAttachment({tenantId=this.tenantId,ownerId,id}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){const item=this.fallback().val.attachments.find(entry=>attachmentInTenant(entry,tenantId)&&entry.ownerId===ownerId&&String(entry.id)===String(id)&&entry.status!=='rejected');return item?attachmentRecord(item):null}
    try{const result=await this.db.query("SELECT a.*,c.external_key client_external_key FROM val_attachments a LEFT JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND a.id=$3 AND a.status<>'rejected' LIMIT 1",[tenantId,ownerId,id]);return result.rows[0]?attachmentRecord(result.rows[0]):null}catch{throw serviceError('O arquivo não pôde ser aberto.')}
  }

  async getAttachmentInScope({tenantId=this.tenantId,ownerId,id,clientId=null,association=clientId?'LINKED_CLIENT':'UNLINKED'}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    const normalizedAssociation=String(association||'').trim().toUpperCase()
    const normalizedClientId=clientId?String(clientId):null
    if(!['LINKED_CLIENT','UNLINKED'].includes(normalizedAssociation))throw domainError('Escopo de arquivo inválido.',400,'attachment_scope_invalid')
    if(normalizedAssociation==='LINKED_CLIENT'&&!normalizedClientId)throw domainError('Informe o produtor deste arquivo.',400,'attachment_client_scope_required')
    if(normalizedAssociation==='UNLINKED'&&normalizedClientId)throw domainError('Um arquivo UNLINKED não pode declarar produtor.',400,'attachment_unlinked_client_scope_conflict')
    if(!this.db.configured){
      const item=this.fallback().val.attachments.find(entry=>attachmentInTenant(entry,tenantId)&&entry.ownerId===ownerId&&String(entry.id)===String(id)&&entry.status!=='rejected'&&(normalizedAssociation==='UNLINKED'?(entry.clientId||null)===null:String(entry.clientId||'')===normalizedClientId))
      return item?attachmentRecord(item):null
    }
    try{
      const result=await this.db.query("SELECT a.*,c.external_key client_external_key FROM val_attachments a LEFT JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND a.id=$3 AND a.status<>'rejected' AND (($4='UNLINKED' AND a.client_id IS NULL) OR ($4='LINKED_CLIENT' AND a.client_id IS NOT NULL AND (c.id::text=$5 OR c.external_key=$5))) LIMIT 1",[tenantId,ownerId,id,normalizedAssociation,normalizedClientId||''])
      return result.rows[0]?attachmentRecord(result.rows[0]):null
    }catch(error){if(error.statusCode)throw error;throw serviceError('O arquivo não pôde ser aberto neste escopo.')}
  }

  async updateAttachment({tenantId=this.tenantId,ownerId,id,status,analysis,clientId=undefined,association=undefined,preserveConfirmedAt=false,signal}){
    throwIfPersistenceCancelled(signal)
    tenantId=assertTenantScope(this.tenantId,tenantId)
    const allowed=new Set(['interpreted','confirmed','stored','rejected']);if(!allowed.has(status))throw domainError('Estado de arquivo inválido.',400)
    const scopeProvided=association!==undefined||clientId!==undefined
    const normalizedAssociation=scopeProvided?String(association||(clientId?'LINKED_CLIENT':'UNLINKED')).trim().toUpperCase():''
    const normalizedClientId=clientId?String(clientId):null
    if(scopeProvided&&!['LINKED_CLIENT','UNLINKED'].includes(normalizedAssociation))throw domainError('Escopo de arquivo inválido.',400,'attachment_scope_invalid')
    if(scopeProvided&&normalizedAssociation==='LINKED_CLIENT'&&!normalizedClientId)throw domainError('Informe o produtor deste arquivo.',400,'attachment_client_scope_required')
    if(scopeProvided&&normalizedAssociation==='UNLINKED'&&normalizedClientId)throw domainError('Um arquivo UNLINKED não pode declarar produtor.',400,'attachment_unlinked_client_scope_conflict')
    const fallbackScopeMatches=entry=>!scopeProvided||(normalizedAssociation==='UNLINKED'?(entry.clientId||null)===null:String(entry.clientId||'')===normalizedClientId)
    if(!this.db.configured){const store=this.fallback();const item=store.val.attachments.find(entry=>attachmentInTenant(entry,tenantId)&&entry.ownerId===ownerId&&String(entry.id)===String(id)&&fallbackScopeMatches(entry));if(!item)throw domainError('Arquivo não encontrado.',404);if(item.status==='rejected'&&status!=='rejected')throw domainError('O arquivo rejeitado está em estado terminal.',409,'attachment_rejected_terminal');throwIfPersistenceCancelled(signal);item.status=status;item.analysis=analysis||item.analysis||{};item.updated_at=new Date().toISOString();if(status==='confirmed'&&!preserveConfirmedAt)item.confirmed_at=item.updated_at;throwIfPersistenceCancelled(signal);this.saveStore(store);return attachmentRecord(item)}
    const sqlScope="($6='' OR ($6='UNLINKED' AND a.client_id IS NULL) OR ($6='LINKED_CLIENT' AND EXISTS (SELECT 1 FROM clients scoped_client WHERE scoped_client.id=a.client_id AND scoped_client.tenant_id=a.tenant_id AND (scoped_client.id::text=$7 OR scoped_client.external_key=$7))))"
    const terminalSqlScope="($4='' OR ($4='UNLINKED' AND a.client_id IS NULL) OR ($4='LINKED_CLIENT' AND EXISTS (SELECT 1 FROM clients scoped_client WHERE scoped_client.id=a.client_id AND scoped_client.tenant_id=a.tenant_id AND (scoped_client.id::text=$5 OR scoped_client.external_key=$5))))"
    try{return await this.db.transaction(async connection=>{
      throwIfPersistenceCancelled(signal)
      const result=await connection.query(`WITH updated AS (UPDATE val_attachments a SET status=$4,analysis=COALESCE($5,analysis),updated_at=NOW(),confirmed_at=CASE WHEN $4='confirmed' AND $8=FALSE THEN NOW() ELSE confirmed_at END WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND a.id=$3 AND (a.status<>'rejected' OR $4='rejected') AND ${sqlScope} RETURNING a.*) SELECT updated.*,c.external_key client_external_key FROM updated LEFT JOIN clients c ON c.id=updated.client_id AND c.tenant_id=updated.tenant_id`,[tenantId,ownerId,id,status,analysis===undefined?null:jsonbParameter(analysis),normalizedAssociation,normalizedClientId||'',Boolean(preserveConfirmedAt)])
      throwIfPersistenceCancelled(signal)
      if(!result.rows[0]){const terminal=await connection.query(`SELECT 1 FROM val_attachments a WHERE a.tenant_id=$1 AND a.consultant_id=$2 AND a.id=$3 AND a.status='rejected' AND ${terminalSqlScope} LIMIT 1`,[tenantId,ownerId,id,normalizedAssociation,normalizedClientId||'']);throwIfPersistenceCancelled(signal);if(terminal.rowCount)throw domainError('O arquivo rejeitado está em estado terminal.',409,'attachment_rejected_terminal');throw domainError('Arquivo não encontrado.',404)}
      return attachmentRecord(result.rows[0])
    },{signal})}catch(error){if(error.statusCode||signal?.aborted)throw signal?.aborted?persistenceCancellationError(signal):error;throw serviceError('O arquivo não pôde ser atualizado.')}
  }

  async recordRecommendation(record){
    throwIfPersistenceCancelled(record?.signal)
    const tenantId=assertTenantScope(this.tenantId,record.tenantId||this.tenantId)
    const id=record.id||randomUUID()
    const persistence=recommendationPersistencePayload(record)
    const persistedContext=persistence.context
    const persistedAdvice=persistence.advice
    const snapshot=persistedContext?.contextSnapshot
    if(snapshot&&String(snapshot.organization_id)!==String(tenantId))throw domainError('O ContextSnapshot pertence a outra organização.',403,'cross_tenant_context_snapshot_denied')
    if(this.db.configured){
      try{
        await this.db.transaction(async connection=>{
          throwIfPersistenceCancelled(record.signal)
          let clientId=null;let clientExternalKey=record.clientId||null
          if(record.clientId){const resolved=await connection.query('SELECT id,external_key FROM clients WHERE tenant_id=$1 AND consultant_id=$3 AND (id::text=$2 OR external_key=$2) LIMIT 1',[tenantId,record.clientId,record.ownerId]);clientId=resolved.rows[0]?.id||null;clientExternalKey=resolved.rows[0]?.external_key||clientExternalKey}
          throwIfPersistenceCancelled(record.signal)
          if(record.clientId&&!clientId)throw domainError('Produtor não encontrado na sua carteira.',404)
          const sourceIds=[...new Set([...(persistedAdvice?.evidence_used||[]).map(item=>item.source_id),...(snapshot?.evidence_refs||[]).map(item=>item.id)].filter(Boolean))].slice(0,200)
          const recommendationStatus=persistedAdvice?.human_review?.required?'pending_review':'generated'
          if(snapshot){
            const selectedRefs=[...new Set(snapshot.selection?.selected_refs||[])]
            const excludedRefs=[...new Set(snapshot.selection?.excluded_refs||[])]
            const exclusionReasonCodes=[...new Set((snapshot.selection?.exclusion_reason_codes||[]).flatMap(item=>item?.reason_codes||[]))]
            await connection.query(`INSERT INTO val_context_snapshots (id,tenant_id,request_id,actor_id,subject_type,subject_id,objective,contract_version,selection_policy_version,freshness_policy_version,selected_refs,excluded_refs,exclusion_reason_codes,confidence_level,snapshot_payload,generated_at,created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
              ON CONFLICT (id) DO NOTHING`,[snapshot.context_snapshot_id,tenantId,snapshot.request_id||null,record.ownerId,snapshot.subject?.type,snapshot.subject?.id,snapshot.objective,snapshot.contract_version,snapshot.selection?.policy_version,snapshot.freshness?.policy_version,selectedRefs,excludedRefs,exclusionReasonCodes,snapshot.confidence?.level||null,jsonbParameter(snapshot),snapshot.freshness?.generated_at])
            throwIfPersistenceCancelled(record.signal)
          }
          await connection.query(`INSERT INTO val_recommendations (id,tenant_id,consultant_id,client_id,client_external_key,user_question,mode,model_version,prompt_version,input_context,source_ids,generated_content,confidence,status,context_snapshot_id,context_snapshot_version,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,[id,tenantId,record.ownerId,clientId,clientExternalKey,record.question,record.mode,record.model,record.promptHash||null,jsonbParameter(persistedContext),jsonbParameter(sourceIds),jsonbParameter(persistedAdvice),persistedAdvice?.confidence?.score??null,recommendationStatus,snapshot?.context_snapshot_id||null,snapshot?.contract_version||null])
          throwIfPersistenceCancelled(record.signal)
          if(record.modelRun){const run=record.modelRun;await connection.query(`INSERT INTO model_runs (id,tenant_id,recommendation_id,model,prompt_version,latency_ms,input_tokens,output_tokens,status,error_code,error_details,provider_response_id,provider_request_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,[randomUUID(),tenantId,id,run.model,run.promptVersion||null,run.latencyMs||null,run.inputTokens||null,run.outputTokens||null,run.status,run.errorCode||null,jsonbParameter(run.errorDetails),run.responseId||null,run.requestId||null])}
          throwIfPersistenceCancelled(record.signal)
        },{signal:record.signal})
        return id
      }catch(error){if(error?.statusCode||record.signal?.aborted)throw record.signal?.aborted?persistenceCancellationError(record.signal):error;throw serviceError('Não foi possível persistir a recomendação no banco configurado.')}
    }
    throwIfPersistenceCancelled(record.signal)
    const store=this.fallback();const {modelRun,...recommendation}=record;recommendation.context=persistedContext;recommendation.advice=persistedAdvice
    throwIfPersistenceCancelled(record.signal)
    if(snapshot&&!store.val.contextSnapshots.some(item=>item.id===snapshot.context_snapshot_id))store.val.contextSnapshots.push({id:snapshot.context_snapshot_id,tenantId,ownerId:record.ownerId,requestId:snapshot.request_id||null,subject:snapshot.subject,objective:snapshot.objective,contractVersion:snapshot.contract_version,selectionPolicyVersion:snapshot.selection?.policy_version,freshnessPolicyVersion:snapshot.freshness?.policy_version,selectedRefs:[...(snapshot.selection?.selected_refs||[])],excludedRefs:[...(snapshot.selection?.excluded_refs||[])],exclusionReasonCodes:[...new Set((snapshot.selection?.exclusion_reason_codes||[]).flatMap(item=>item?.reason_codes||[]))],snapshot:structuredClone(snapshot),createdAt:new Date().toISOString()})
    store.val.contextSnapshots=store.val.contextSnapshots.slice(-1000);store.val.recommendations.push({...recommendation,id,contextSnapshotId:snapshot?.context_snapshot_id||null,contextSnapshotVersion:snapshot?.contract_version||null,createdAt:new Date().toISOString()});store.val.recommendations=store.val.recommendations.slice(-500);if(modelRun){store.val.modelRuns.push({...modelRun,recommendationId:id,id:randomUUID(),createdAt:new Date().toISOString()});store.val.modelRuns=store.val.modelRuns.slice(-1000)}throwIfPersistenceCancelled(record.signal);this.saveStore(store);return id
  }

  async getContextSnapshot({tenantId=this.tenantId,ownerId,id}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured){
      const stored=this.fallback().val.contextSnapshots.find(item=>String(item.id)===String(id)&&String(item.tenantId)===String(tenantId)&&String(item.ownerId)===String(ownerId))
      return stored?structuredClone(stored.snapshot):null
    }
    try{
      const result=await this.db.query(`SELECT snapshot_payload FROM val_context_snapshots WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 LIMIT 1`,[tenantId,ownerId,id])
      return result.rows[0]?.snapshot_payload||null
    }catch{throw serviceError('O ContextSnapshot não pôde ser recuperado no banco configurado.')}
  }

  async recordModelRun(record){
    const tenantId=assertTenantScope(this.tenantId,record.tenantId||this.tenantId)
    const id=randomUUID()
    if(this.db.configured){
      try{await this.db.query(`INSERT INTO model_runs (id,tenant_id,recommendation_id,model,prompt_version,latency_ms,input_tokens,output_tokens,status,error_code,error_details,provider_response_id,provider_request_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,[id,tenantId,record.recommendationId,record.model,record.promptVersion||null,record.latencyMs||null,record.inputTokens||null,record.outputTokens||null,record.status,record.errorCode||null,jsonbParameter(record.errorDetails),record.responseId||null,record.requestId||null]);return id}catch{throw serviceError('Não foi possível registrar a execução do modelo no banco configurado.')}
    }
    const store=this.fallback();store.val.modelRuns.push({...record,id,createdAt:new Date().toISOString()});store.val.modelRuns=store.val.modelRuns.slice(-1000);this.saveStore(store);return id
  }

  async recordFeedback(feedback){
    const tenantId=assertTenantScope(this.tenantId,feedback.tenantId||this.tenantId)
    const id=randomUUID()
    if(this.db.configured){
      try{
        const inserted=await this.db.query(`INSERT INTO val_feedback (id,tenant_id,recommendation_id,rating,outcome,value,reason,notes,created_at)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,NOW() FROM val_recommendations WHERE id=$3 AND tenant_id=$2 AND consultant_id=$9
          ON CONFLICT (tenant_id,recommendation_id) DO UPDATE SET rating=EXCLUDED.rating,outcome=EXCLUDED.outcome,value=EXCLUDED.value,reason=EXCLUDED.reason,notes=EXCLUDED.notes,created_at=NOW() RETURNING id`,[id,tenantId,feedback.recommendationId,feedback.rating,feedback.outcome||null,feedback.value??null,feedback.reason||null,feedback.notes||null,feedback.ownerId])
        if(!inserted.rowCount)throw new Error('recommendation-not-found')
        return inserted.rows[0].id
      }catch{throw serviceError('Não foi possível persistir o feedback no banco configurado.')}
    }
    const store=this.fallback();if(!store.val.recommendations.some(item=>item.id===feedback.recommendationId))throw Object.assign(new Error('A recomendação informada não existe.'),{statusCode:404});store.val.feedback.push({...feedback,id,createdAt:new Date().toISOString()});store.val.feedback=store.val.feedback.slice(-1000);this.saveStore(store);return id
  }

  async ingestEvent({tenantId=this.tenantId,ownerId,event,signals=[]}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(event?.type==='soil_analysis.completed'&&event?.source==='manual-do-agronomo'){
      const scopedOwnerId=String(ownerId||'').slice(0,36)
      const suppliedAnalysisExternalId=String(event?.payload?.analysisExternalId||'').slice(0,180)
      const requiredPrefix=`manual-soil:${scopedOwnerId}:`
      if(!scopedOwnerId||!suppliedAnalysisExternalId.startsWith(requiredPrefix)||suppliedAnalysisExternalId.length<=requiredPrefix.length)throw domainError('A análise de solo não pertence ao responsável autenticado desta integração.',403,'soil_analysis_owner_scope_invalid')
    }
    if(this.db.configured){
      try{
        return await this.db.transaction(async client=>{
          const inserted=await client.query(`INSERT INTO integration_events (tenant_id,owner_user_id,external_id,event_type,schema_version,source,occurred_at,client_external_key,property_external_key,field_external_key,payload,payload_hash,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'processed') ON CONFLICT (tenant_id,owner_user_id,source,external_id) DO NOTHING RETURNING id`,[tenantId,ownerId,event.externalId,event.type,event.schemaVersion,event.source,event.occurredAt,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,jsonbParameter(event.payload),event.payloadHash])
          if(!inserted.rowCount){
            const existing=await client.query('SELECT payload_hash FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND source=$3 AND external_id=$4 LIMIT 1',[tenantId,ownerId,event.source,event.externalId])
            if(String(existing.rows[0]?.payload_hash||'')!==String(event.payloadHash||''))throw domainError('O externalId já foi usado com um conteúdo diferente.',409)
            return {duplicate:true,signals:0}
          }
          let measurementSetStatus=null;let acceptedSignals=signals
          if(event.type==='manual.producer.updated'&&event.clientExternalKey){
            const producer=jsonObject(event.payload.producer||event.payload);const identity=jsonObject(event.payload.identity);const area=parseCultivatedArea(producer.areaHa??producer.area??producer.totalAreaHa);const cultures=Array.isArray(producer.cultures)?producer.cultures.join(', '):producer.cultures
            const producerName=String(producer.name||producer.producerName||'Produtor').trim().slice(0,180)||'Produtor';const producerId=String(identity.producerId||producer.id||'').trim().slice(0,180);const allowLegacyKeyMigration=identity.allowLegacyKeyMigration===true
            const legacyAliases=new Set(allowLegacyKeyMigration?(Array.isArray(identity.legacyExternalKeys)?identity.legacyExternalKeys:[]).map(valorExternalKey).filter(Boolean):[]);const currentNameAlias=valorExternalKey(producerName);if(allowLegacyKeyMigration&&currentNameAlias)legacyAliases.add(currentNameAlias);legacyAliases.delete(event.clientExternalKey)
            let matchedClient=null
            if(allowLegacyKeyMigration){
              await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`manual-client-identity:${tenantId}:${ownerId}:${event.clientExternalKey}`])
              if(producerId){
                const historical=await client.query(`SELECT DISTINCT client_external_key FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND source='manual-do-agronomo' AND event_type='manual.producer.updated' AND COALESCE(payload->'identity'->>'producerId',payload->'producer'->>'id')=$3 AND client_external_key IS NOT NULL LIMIT 50`,[tenantId,ownerId,producerId])
                for(const row of historical.rows||[]){const alias=valorExternalKey(row.client_external_key);if(alias&&alias!==event.clientExternalKey)legacyAliases.add(alias)}
              }
              const aliases=[...legacyAliases].slice(0,50)
              const candidates=await client.query(`SELECT id,external_key,name,commercial_profile FROM clients account WHERE account.tenant_id=$1 AND account.consultant_id=$2 AND account.status='active' AND (account.external_key=$3 OR account.external_key=ANY($4::text[]) OR COALESCE(account.commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ?| $4::text[] OR ($5<>'' AND LOWER(BTRIM(account.name))=LOWER(BTRIM($5))) OR ($6<>'' AND account.commercial_profile->'manual_identity'->>'producer_id'=$6)) ORDER BY CASE WHEN account.external_key=$3 THEN 0 WHEN account.external_key=ANY($4::text[]) THEN 1 ELSE 2 END,account.id LIMIT 3 FOR UPDATE`,[tenantId,ownerId,event.clientExternalKey,aliases,producerName,producerId])
              if(candidates.rowCount>1)throw domainError('A identidade legada do produtor é ambígua nesta carteira; nenhuma chave foi migrada.',409,'manual_client_identity_ambiguous')
              matchedClient=candidates.rows[0]||null
              const existingIdentity=jsonObject(jsonObject(matchedClient?.commercial_profile).manual_identity)
              for(const alias of Array.isArray(existingIdentity.external_key_aliases)?existingIdentity.external_key_aliases:[]){const normalized=valorExternalKey(alias);if(normalized&&normalized!==event.clientExternalKey)legacyAliases.add(normalized)}
              const previousExternalKey=String(matchedClient?.external_key||'')
              if(previousExternalKey&&previousExternalKey!==event.clientExternalKey){
                legacyAliases.add(previousExternalKey)
                const migratedProfile={...jsonObject(matchedClient.commercial_profile),manual_identity:{...existingIdentity,producer_id:producerId||existingIdentity.producer_id||null,external_key_aliases:[...legacyAliases].filter(alias=>alias!==event.clientExternalKey).slice(0,50)}}
                const migrated=await client.query(`UPDATE clients SET external_key=$4,commercial_profile=$5,updated_at=NOW() WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3 RETURNING id,external_key`,[tenantId,ownerId,matchedClient.id,event.clientExternalKey,jsonbParameter(migratedProfile)])
                if(!migrated.rowCount)throw domainError('O produtor legado não pôde ser migrado dentro da carteira autorizada.',409,'manual_client_identity_migration_failed')
                await client.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,correlation_id,created_at) VALUES ($1,$2,'manual_client_external_key_migrated','client',$3,$4,$5,$6,NOW())`,[tenantId,ownerId,String(matchedClient.id),jsonbParameter({externalKey:previousExternalKey}),jsonbParameter({externalKey:event.clientExternalKey,aliases:[...legacyAliases]}),event.externalId])
              }
            }
            const manualIdentity={producer_id:producerId||null,external_key_aliases:[...legacyAliases].filter(alias=>alias!==event.clientExternalKey).slice(0,50)};const manualProfile=allowLegacyKeyMigration?{manual_identity:manualIdentity}:{}
            await client.query(`INSERT INTO clients (tenant_id,consultant_id,external_key,name,municipality,total_area_ha,area_band,cultures,preferred_channel,commercial_profile,status,source,updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','manual-do-agronomo',NOW())
              ON CONFLICT (tenant_id,consultant_id,external_key) DO UPDATE SET name=COALESCE(NULLIF(EXCLUDED.name,''),clients.name),municipality=COALESCE(EXCLUDED.municipality,clients.municipality),total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),cultures=COALESCE(EXCLUDED.cultures,clients.cultures),preferred_channel=COALESCE(EXCLUDED.preferred_channel,clients.preferred_channel),commercial_profile=CASE WHEN $11 THEN clients.commercial_profile||EXCLUDED.commercial_profile ELSE clients.commercial_profile END,status='active',updated_at=NOW()`,[tenantId,ownerId,event.clientExternalKey,producerName,String(producer.city||producer.municipality||'').slice(0,140)||null,area.totalAreaHa,area.areaBand,String(cultures||'').slice(0,1000)||null,String(producer.preferredChannel||producer.servicePreference||'').slice(0,60)||null,jsonbParameter(manualProfile),allowLegacyKeyMigration])
          }
          const resolvedClient=event.clientExternalKey?await client.query(`SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3 OR COALESCE(commercial_profile->'manual_identity'->'external_key_aliases','[]'::jsonb) ? $3) ORDER BY CASE WHEN id::text=$3 OR external_key=$3 THEN 0 ELSE 1 END LIMIT 1`,[tenantId,ownerId,event.clientExternalKey]):{rows:[]}
          const resolvedClientId=resolvedClient.rows[0]?.id||null
          const materializeManualProperty=async({propertyName,fields=[],municipality=null,areaHa=null,metadata={}})=>{
            const safePropertyName=String(propertyName||'').trim().slice(0,180);const propertyExternalKey=relatedExternalKey(event.clientExternalKey,safePropertyName)
            if(!resolvedClientId||!propertyExternalKey)return null
            const property=await client.query(`INSERT INTO properties (tenant_id,client_id,external_key,name,municipality,area_ha,metadata,updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
              ON CONFLICT (tenant_id,client_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name,municipality=COALESCE(EXCLUDED.municipality,properties.municipality),area_ha=COALESCE(EXCLUDED.area_ha,properties.area_ha),metadata=properties.metadata||EXCLUDED.metadata,updated_at=NOW() RETURNING id`,[tenantId,resolvedClientId,propertyExternalKey,safePropertyName,String(municipality||'').slice(0,140)||null,areaHa,jsonbParameter({source:'manual-do-agronomo',producerExternalKey:event.clientExternalKey,...jsonObject(metadata)})])
            const propertyId=property.rows[0]?.id||null;if(!propertyId)return {propertyId:null,propertyExternalKey}
            const fieldKeys=new Set()
            for(const item of fields.slice(0,500)){
              const field=jsonObject(item);const fieldIdentity=field.id||field.name;const fieldExternalKey=propertyScopedFieldExternalKey(propertyExternalKey,fieldIdentity);const legacyFieldExternalKey=relatedExternalKey(event.clientExternalKey,fieldIdentity)
              if(!fieldExternalKey||fieldKeys.has(fieldExternalKey))continue
              fieldKeys.add(fieldExternalKey)
              const fieldName=String(field.name||field.id||'Talhão').trim().slice(0,180)||'Talhão';const fieldArea=parseCultivatedArea(field.areaHa??field.area).totalAreaHa
              const compatibleField=await client.query(`SELECT id,external_key FROM fields WHERE tenant_id=$1 AND property_id=$2 AND external_key IN ($3,$4) ORDER BY CASE WHEN external_key=$3 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`,[tenantId,propertyId,fieldExternalKey,legacyFieldExternalKey]);const compatibleFieldId=compatibleField.rows[0]?.id||null
              const storedField=compatibleFieldId?await client.query(`UPDATE fields SET name=$4,area_ha=COALESCE($5,area_ha),updated_at=NOW() WHERE tenant_id=$1 AND property_id=$2 AND id=$3 RETURNING id`,[tenantId,propertyId,compatibleFieldId,fieldName,fieldArea]):await client.query(`INSERT INTO fields (tenant_id,property_id,external_key,name,area_ha,updated_at)
                VALUES ($1,$2,$3,$4,$5,NOW())
                ON CONFLICT (tenant_id,property_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name,area_ha=COALESCE(EXCLUDED.area_ha,fields.area_ha),updated_at=NOW() RETURNING id`,[tenantId,propertyId,fieldExternalKey,fieldName,fieldArea])
              const fieldId=storedField.rows[0]?.id||null;const season=String(field.season||'').trim().slice(0,30);const crop=String(field.crop||'').trim().slice(0,80)
              const hasLegacyPolygon=Array.isArray(field.points)&&field.points.length>=3
              const hasGeometryUpdate=field.geometryAction==='UPSERT'||hasLegacyPolygon||Boolean(field.geometry)||(Array.isArray(field.polygons)&&field.polygons.length>0)
              if(fieldId&&hasGeometryUpdate){
                try{
                  const canonical=manualToCanonicalValGeometry({
                    organizationId:tenantId,clientId:resolvedClientId,clientExternalKey:event.clientExternalKey,
                    propertyId,propertyExternalKey,propertyName:safePropertyName,fieldId,fieldExternalKey,sourceFieldId:fieldIdentity,fieldName,
                    geometry:field.geometry,points:field.points,polygons:field.polygons,areaHa:field.areaHa??field.area,
                    provenance:{...jsonObject(field.geometryProvenance),source:'manual-do-agronomo',sourceRef:`integration-event:${inserted.rows[0].id}`,sourceEventId:event.externalId,observedAt:event.occurredAt,capturedBy:ownerId}
                  })
                  await client.query(`UPDATE fields SET geometry_ref=$4,geometry_version=$5,area_ha=$6,updated_at=NOW() WHERE tenant_id=$1 AND property_id=$2 AND id=$3`,[tenantId,propertyId,fieldId,encodeCanonicalGeometryRef(canonical),canonical.geometryVersion,canonical.measurements.calculatedAreaHa])
                }catch(error){throw domainError(`A geometria do talhão ${fieldName} foi rejeitada: ${error.message}`,422,error.code||'agronomic_geometry_invalid')}
              }else if(fieldId&&field.geometryAction==='CLEAR'){
                await client.query(`UPDATE fields SET geometry_ref=NULL,geometry_version=NULL,updated_at=NOW() WHERE tenant_id=$1 AND property_id=$2 AND id=$3`,[tenantId,propertyId,fieldId])
              }
              if(fieldId&&season&&crop)await client.query(`INSERT INTO crop_seasons (tenant_id,field_id,season,crop,area_ha)
                SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM crop_seasons WHERE tenant_id=$1 AND field_id=$2 AND season=$3 AND crop=$4)`,[tenantId,fieldId,season,crop,fieldArea])
            }
            return {propertyId,propertyExternalKey}
          }
          if(event.type==='manual.producer.updated'&&event.clientExternalKey&&resolvedClientId){
            const producer=jsonObject(event.payload.producer||event.payload);const fields=(Array.isArray(producer.fields)?producer.fields:[]).filter(item=>item&&typeof item==='object').slice(0,500)
            const mainPropertyName=String(producer.properties||producer.property||(fields.length?'Propriedade principal':'')).trim().slice(0,180)
            const materializedPropertyKeys=new Set();const mainPropertyKey=relatedExternalKey(event.clientExternalKey,mainPropertyName)
            if(mainPropertyKey){materializedPropertyKeys.add(mainPropertyKey);await materializeManualProperty({propertyName:mainPropertyName,fields,municipality:producer.city||producer.municipality,areaHa:parseCultivatedArea(producer.areaHa??producer.area??producer.totalAreaHa).totalAreaHa})}
            for(const candidate of (Array.isArray(event.payload.soilAnalyses)?event.payload.soilAnalyses:[]).slice(0,250)){
              const soil=jsonObject(candidate);const soilState=String(soil.linkState||'').toUpperCase();if(!['LINKED_TO_PROPERTY','LINKED_TO_FIELD'].includes(soilState))continue
              const propertyName=String(soil.property||'').trim().slice(0,180);const propertyExternalKey=relatedExternalKey(event.clientExternalKey,propertyName);if(!propertyExternalKey||materializedPropertyKeys.has(propertyExternalKey))continue
              materializedPropertyKeys.add(propertyExternalKey);const fieldIdentity=soil.fieldId||soil.fieldName;const linkedField=soilState==='LINKED_TO_FIELD'?fields.find(item=>String(jsonObject(item).id||'')===String(fieldIdentity||'')):null
              await materializeManualProperty({propertyName,fields:linkedField?[linkedField]:[],municipality:producer.city||producer.municipality,metadata:{materializedFrom:'soil-link'}})
            }
          }
          if(event.type==='soil_analysis.completed'&&event.source==='manual-do-agronomo'&&event.clientExternalKey&&resolvedClientId){
            const soilState=String(event.payload.linkState||event.payload.validation?.linkage?.state||'').toUpperCase();const propertyName=String(event.payload.propertyName||'').trim().slice(0,180);const expectedPropertyKey=relatedExternalKey(event.clientExternalKey,propertyName)
            if(['LINKED_TO_PROPERTY','LINKED_TO_FIELD'].includes(soilState)&&expectedPropertyKey&&expectedPropertyKey===event.propertyExternalKey){
              const fieldIdentity=event.payload.fieldId||event.payload.fieldName;const expectedFieldKey=propertyScopedFieldExternalKey(expectedPropertyKey,fieldIdentity);const canMaterializeField=soilState!=='LINKED_TO_FIELD'||(expectedFieldKey&&expectedFieldKey===event.fieldExternalKey)
              await materializeManualProperty({propertyName,fields:canMaterializeField&&soilState==='LINKED_TO_FIELD'?[{id:event.payload.fieldId,name:event.payload.fieldName||event.payload.fieldId}]:[],metadata:{materializedFrom:'soil-link'}})
            }
          }
          const resolvedProperty=event.propertyExternalKey?await client.query(`SELECT property.id,property.client_id FROM properties property JOIN clients account ON account.id=property.client_id AND account.tenant_id=property.tenant_id WHERE property.tenant_id=$1 AND account.consultant_id=$2 AND (property.id::text=$3 OR property.external_key=$3) AND property.client_id=COALESCE($4::uuid,property.client_id) LIMIT 1`,[tenantId,ownerId,event.propertyExternalKey,resolvedClientId]):{rows:[]}
          const resolvedPropertyId=resolvedProperty.rows[0]?.id||null
          const resolvedPropertyClientId=resolvedProperty.rows[0]?.client_id||null
          const soilFieldMustBePropertyScoped=event.type==='soil_analysis.completed';const soilFieldIdentity=event.payload.fieldId||event.payload.fieldName;const legacySoilFieldKey=soilFieldMustBePropertyScoped?relatedExternalKey(event.clientExternalKey,soilFieldIdentity):null;const canonicalSoilFieldKey=soilFieldMustBePropertyScoped?propertyScopedFieldExternalKey(event.propertyExternalKey,soilFieldIdentity):null
          const resolvedField=event.fieldExternalKey&&(!soilFieldMustBePropertyScoped||resolvedPropertyId)?await client.query(`SELECT field.id,field.property_id,property.client_id FROM fields field JOIN properties property ON property.id=field.property_id AND property.tenant_id=field.tenant_id JOIN clients account ON account.id=property.client_id AND account.tenant_id=property.tenant_id WHERE field.tenant_id=$1 AND account.consultant_id=$2 AND (field.id::text=$3 OR field.external_key=$3 OR ($5::text IS NOT NULL AND field.external_key=$5) OR ($6::text IS NOT NULL AND field.external_key=$6)) AND field.property_id=COALESCE($4::uuid,field.property_id) LIMIT 1`,[tenantId,ownerId,event.fieldExternalKey,soilFieldMustBePropertyScoped?resolvedPropertyId:null,legacySoilFieldKey,canonicalSoilFieldKey]):{rows:[]}
          const resolvedFieldId=resolvedField.rows[0]?.id||null
          const resolvedFieldPropertyId=resolvedField.rows[0]?.property_id||null
          const resolvedFieldClientId=resolvedField.rows[0]?.client_id||null
          const approved=hasTechnicalApproval(event.payload);const validation=event.payload.validation||{}
          if(event.type==='agronomic.scan.completed'&&event.source==='manual-do-agronomo'){
            const sourceAttachments=Array.isArray(event.payload.sourceAttachments)?event.payload.sourceAttachments.slice(0,3):[]
            const attachmentIds=[...new Set(sourceAttachments.map(item=>String(item?.attachmentId||'')))].filter(Boolean)
            const sourceById=new Map(sourceAttachments.map(item=>[String(item?.attachmentId||''),item]))
            const sourceRows=attachmentIds.length?await client.query(`SELECT attachment.*,account.external_key client_external_key FROM val_attachments attachment LEFT JOIN clients account ON account.id=attachment.client_id AND account.tenant_id=attachment.tenant_id WHERE attachment.tenant_id=$1 AND attachment.consultant_id=$2 AND attachment.id=ANY($3::uuid[]) AND attachment.status<>'rejected' ORDER BY attachment.created_at FOR UPDATE`,[tenantId,ownerId,attachmentIds]):{rows:[]}
            if(sourceRows.rows.length!==attachmentIds.length)throw domainError('Um ou mais attachments de origem não pertencem ao tenant e responsável autenticados.',404,'scan_attachment_scope_invalid')
            const requestedProperty=String(event.payload.context?.propertyId||event.propertyExternalKey||'').trim()
            const requestedField=String(event.payload.context?.fieldId||event.fieldExternalKey||'').trim()
            if(requestedProperty&&!resolvedPropertyId)throw domainError('A propriedade do resultado não existe na carteira autorizada.',422,'scan_property_scope_invalid')
            if(requestedField&&!resolvedFieldId)throw domainError('O talhão do resultado não existe na carteira autorizada.',422,'scan_field_scope_invalid')
            const scanResults=[]
            for(const attachment of sourceRows.rows){
              if(attachment.client_id&&(!resolvedClientId||String(attachment.client_id)!==String(resolvedClientId)))throw domainError('O attachment e o resultado declaram produtores diferentes.',422,'scan_attachment_client_scope_invalid')
              if(!attachment.client_id&&resolvedClientId)throw domainError('Um attachment UNLINKED não pode produzir resultado vinculado implicitamente.',422,'scan_unlinked_target_invalid')
              if(resolvedPropertyId&&String(resolvedPropertyClientId)!==String(attachment.client_id))throw domainError('A propriedade não pertence ao produtor do attachment.',422,'scan_property_scope_invalid')
              if(resolvedFieldId&&(String(resolvedFieldClientId)!==String(attachment.client_id)||String(resolvedFieldPropertyId)!==String(resolvedPropertyId)))throw domainError('O talhão não pertence à propriedade e ao produtor do attachment.',422,'scan_field_scope_invalid')
              const declared=sourceById.get(String(attachment.id))
              if(declared?.propertyId&&![String(resolvedPropertyId||''),String(event.propertyExternalKey||'')].includes(String(declared.propertyId)))throw domainError('A propriedade declarada no handoff diverge do resultado.',422,'scan_property_scope_invalid')
              if(declared?.fieldId&&![String(resolvedFieldId||''),String(event.fieldExternalKey||'')].includes(String(declared.fieldId)))throw domainError('O talhão declarado no handoff diverge do resultado.',422,'scan_field_scope_invalid')
              const provenance=buildAgronomicScanProvenance({sourceAttachment:declared,attachment,tenantId,ownerId,analysisType:event.payload.analysisType,createdAt:event.payload.resultCreatedAt||event.occurredAt,resultReference:event.payload.resultReference,propertyId:resolvedPropertyId,fieldId:resolvedFieldId,integrationEventId:inserted.rows[0].id})
              const scanResult={...provenance,result:{summary:String(event.payload.result?.summary||'').slice(0,2000),image_quality:String(event.payload.result?.imageQuality||'').slice(0,80),analyzed_at:parseDate(event.payload.result?.analyzedAt,event.payload.resultCreatedAt||event.occurredAt)},safety:{classification:String(event.payload.safety?.classification||'ASSISTED_TRIAGE_NOT_PRESCRIPTION').slice(0,120),human_review_required:true}}
              await client.query(`UPDATE val_attachments SET status=CASE WHEN status IN ('confirmed','stored') THEN status ELSE 'interpreted' END,analysis=jsonb_set(jsonb_set(COALESCE(analysis,'{}'::jsonb),'{scanResults}',COALESCE(analysis->'scanResults','[]'::jsonb)||jsonb_build_array($4::jsonb),true),'{latestScanResult}',$4::jsonb,true),updated_at=NOW() WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3`,[tenantId,ownerId,attachment.id,jsonbParameter(scanResult)])
              scanResults.push(scanResult)
            }
            await client.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,correlation_id,created_at) VALUES ($1,$2,'agronomic_scan_provenance_recorded','integration_event',$3,'{}'::jsonb,$4,$5,NOW())`,[tenantId,ownerId,String(inserted.rows[0].id),jsonbParameter({resultReference:event.payload.resultReference,analysisType:event.payload.analysisType,attachments:scanResults.map(item=>item.attachment_id),clientId:resolvedClientId,propertyId:resolvedPropertyId,fieldId:resolvedFieldId}),event.externalId])
          }
          if(event.type==='field_report.completed'){
            const report=await client.query(`INSERT INTO field_reports (tenant_id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,source,external_id,observed_at,crop_stage,summary,validated_actions,validation_evidence,validated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,property_id=EXCLUDED.property_id,field_id=EXCLUDED.field_id,observed_at=EXCLUDED.observed_at,crop_stage=EXCLUDED.crop_stage,summary=EXCLUDED.summary,validated_actions=EXCLUDED.validated_actions,validation_evidence=EXCLUDED.validation_evidence,validated_at=EXCLUDED.validated_at RETURNING id`,[tenantId,resolvedClientId,resolvedPropertyId,resolvedFieldId,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,event.source,event.externalId,parseDate(event.payload.observedAt,event.occurredAt),String(event.payload.cropStage||'').slice(0,100)||null,String(event.payload.summary||'').slice(0,10_000)||null,jsonbParameter(approved&&Array.isArray(event.payload.validatedActions)?event.payload.validatedActions:[]),jsonbParameter(validation),approved?parseDate(validation.reviewedAt,event.occurredAt):null])
            for(const finding of Array.isArray(event.payload.findings)?event.payload.findings.slice(0,100):[]){const item=finding&&typeof finding==='object'?finding:{text:String(finding)};const confidence=Number.isFinite(Number(item.confidence))?Math.max(0,Math.min(100,Math.round(Number(item.confidence)))):null;await client.query(`INSERT INTO field_observations (tenant_id,report_id,observation_type,value,unit,confidence,evidence_ref,requires_review) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[tenantId,report.rows[0].id,String(item.type||'finding').slice(0,80),jsonbParameter(item),String(item.unit||'').slice(0,60)||null,confidence,String(item.evidenceRef||'').slice(0,500)||null,!approved])}
          }
          if(event.type==='soil_analysis.completed'){
            const declaredLinkState=String(event.payload.linkState||event.payload.validation?.linkage?.state||'').toUpperCase()
            const allowedLinkStates=new Set(['UNLINKED','LINKED_TO_CLIENT','LINKED_TO_PROPERTY','LINKED_TO_FIELD'])
            const inferredLinkState=event.fieldExternalKey?'LINKED_TO_FIELD':event.propertyExternalKey?'LINKED_TO_PROPERTY':event.clientExternalKey?'LINKED_TO_CLIENT':'UNLINKED'
            const requestedLinkState=allowedLinkStates.has(declaredLinkState)?declaredLinkState:inferredLinkState
            const linkState=requestedLinkState
            const needsClient=linkState!=='UNLINKED'
            const needsProperty=['LINKED_TO_PROPERTY','LINKED_TO_FIELD'].includes(linkState)
            const needsField=linkState==='LINKED_TO_FIELD'
            const sameId=(left,right)=>left!==null&&right!==null&&String(left)===String(right)
            if(needsClient&&!resolvedClientId)throw domainError('O produtor informado para o vínculo da análise de solo não existe nesta carteira.',422,'soil_link_target_invalid')
            if(needsProperty&&!resolvedPropertyId)throw domainError('A propriedade informada para o vínculo da análise de solo não existe nesta carteira.',422,'soil_link_target_invalid')
            if(needsProperty&&!sameId(resolvedPropertyClientId,resolvedClientId))throw domainError('A propriedade informada não pertence ao produtor selecionado.',422,'soil_link_target_invalid')
            if(needsField&&!resolvedFieldId)throw domainError('O talhão informado para o vínculo da análise de solo não existe nesta carteira.',422,'soil_link_target_invalid')
            if(needsField&&(!sameId(resolvedFieldPropertyId,resolvedPropertyId)||!sameId(resolvedFieldClientId,resolvedClientId)))throw domainError('O talhão informado não pertence à propriedade e ao produtor selecionados.',422,'soil_link_target_invalid')
            const linkVersion=Number.isInteger(Number(event.payload.linkVersion))&&Number(event.payload.linkVersion)>=0?Math.min(Number(event.payload.linkVersion),1_000_000_000):0
            const linkedClientId=linkState==='UNLINKED'?null:resolvedClientId
            const linkedPropertyId=['LINKED_TO_PROPERTY','LINKED_TO_FIELD'].includes(linkState)?resolvedPropertyId:null
            const linkedFieldId=linkState==='LINKED_TO_FIELD'?resolvedFieldId:null
            const linkedClientExternalKey=linkState==='UNLINKED'?null:event.clientExternalKey||null
            const linkedPropertyExternalKey=['LINKED_TO_PROPERTY','LINKED_TO_FIELD'].includes(linkState)?event.propertyExternalKey||null:null
            const linkedFieldExternalKey=linkState==='LINKED_TO_FIELD'?event.fieldExternalKey||null:null
            const analysisExternalId=String(event.payload.analysisExternalId||event.externalId).slice(0,180)
            const linkageEvidence={state:linkState,version:linkVersion,history:Array.isArray(event.payload.linkHistory)?event.payload.linkHistory:[],provenance:jsonObject(event.payload.linkProvenance)}
            const validationEvidence={...jsonObject(validation),linkage:linkageEvidence};const acceptedEventOccurredAt=parseDate(event.occurredAt)
            if(!acceptedEventOccurredAt)throw domainError('A data do evento da análise de solo é inválida.',422,'soil_analysis_occurred_at_invalid')
            const analysis=await client.query(`INSERT INTO soil_analyses (tenant_id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,source,external_id,laboratory,method,depth_from_cm,depth_to_cm,sampled_at,validated_flags,validation_evidence,validated_at,accepted_event_occurred_at,accepted_event_source_event_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,property_id=EXCLUDED.property_id,field_id=EXCLUDED.field_id,client_external_key=EXCLUDED.client_external_key,property_external_key=EXCLUDED.property_external_key,field_external_key=EXCLUDED.field_external_key,laboratory=EXCLUDED.laboratory,method=EXCLUDED.method,depth_from_cm=EXCLUDED.depth_from_cm,depth_to_cm=EXCLUDED.depth_to_cm,sampled_at=EXCLUDED.sampled_at,validated_flags=EXCLUDED.validated_flags,validation_evidence=EXCLUDED.validation_evidence,validated_at=EXCLUDED.validated_at,accepted_event_occurred_at=EXCLUDED.accepted_event_occurred_at,accepted_event_source_event_id=EXCLUDED.accepted_event_source_event_id WHERE (CASE WHEN COALESCE(soil_analyses.validation_evidence->'linkage'->>'version','') ~ '^[0-9]{1,64}$' THEN LEAST((soil_analyses.validation_evidence->'linkage'->>'version')::numeric,1000000000)::bigint WHEN COALESCE(soil_analyses.validation_evidence->'linkage'->>'version','') ~ '^[0-9]+$' THEN 1000000000 ELSE 0 END < $20) OR (CASE WHEN COALESCE(soil_analyses.validation_evidence->'linkage'->>'version','') ~ '^[0-9]{1,64}$' THEN LEAST((soil_analyses.validation_evidence->'linkage'->>'version')::numeric,1000000000)::bigint WHEN COALESCE(soil_analyses.validation_evidence->'linkage'->>'version','') ~ '^[0-9]+$' THEN 1000000000 ELSE 0 END = $20 AND soil_analyses.client_id IS NOT DISTINCT FROM EXCLUDED.client_id AND soil_analyses.property_id IS NOT DISTINCT FROM EXCLUDED.property_id AND soil_analyses.field_id IS NOT DISTINCT FROM EXCLUDED.field_id AND COALESCE(soil_analyses.validation_evidence->'linkage'->>'state','UNLINKED')=COALESCE(EXCLUDED.validation_evidence->'linkage'->>'state','UNLINKED') AND (soil_analyses.accepted_event_occurred_at IS NULL OR soil_analyses.accepted_event_occurred_at<EXCLUDED.accepted_event_occurred_at)) RETURNING id`,[tenantId,linkedClientId,linkedPropertyId,linkedFieldId,linkedClientExternalKey,linkedPropertyExternalKey,linkedFieldExternalKey,event.source,analysisExternalId,String(event.payload.laboratory||'').slice(0,180)||null,String(event.payload.method||'').slice(0,180)||null,parseMoney(event.payload.depthFromCm),parseMoney(event.payload.depthToCm),parseDate(event.payload.sampledAt,event.occurredAt),jsonbParameter(approved&&Array.isArray(event.payload.validatedFlags)?event.payload.validatedFlags:[]),jsonbParameter(validationEvidence),approved?parseDate(validation.reviewedAt,event.occurredAt):null,acceptedEventOccurredAt,inserted.rows[0].id,linkVersion])
            let analysisRow=analysis.rows[0]||null;let analysisEventAccepted=Boolean(analysis.rowCount)
            if(!analysisEventAccepted){
              const currentAnalysis=await client.query(`SELECT id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,laboratory,method,depth_from_cm,depth_to_cm,sampled_at,validated_flags,validation_evidence,validated_at,accepted_event_occurred_at,accepted_event_source_event_id FROM soil_analyses WHERE tenant_id=$1 AND source=$2 AND external_id=$3 LIMIT 1 FOR UPDATE`,[tenantId,event.source,analysisExternalId]);const current=currentAnalysis.rows[0]||null;const currentLinkage=jsonObject(current?.validation_evidence).linkage||{};const currentLinkVersion=Number.isInteger(Number(currentLinkage.version))&&Number(currentLinkage.version)>=0?Number(currentLinkage.version):0;const currentLinkState=String(currentLinkage.state||'UNLINKED').toUpperCase();const sameNullableId=(left,right)=>(left===null||left===undefined)&&(right===null||right===undefined)||String(left)===String(right);const currentAcceptedAt=parseDate(current?.accepted_event_occurred_at)
              const staleSameTarget=Boolean(current&&currentAcceptedAt&&currentLinkVersion===linkVersion&&currentLinkState===linkState&&sameNullableId(current.client_id,linkedClientId)&&sameNullableId(current.property_id,linkedPropertyId)&&sameNullableId(current.field_id,linkedFieldId)&&new Date(currentAcceptedAt).getTime()>=new Date(acceptedEventOccurredAt).getTime())
              if(!staleSameTarget)throw domainError('A versão do vínculo desta análise de solo está desatualizada ou tenta trocar o alvo sem avançar a versão.',409,'soil_link_version_conflict')
              analysisRow=current;measurementSetStatus='stale_ignored';acceptedSignals=[]
              await client.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,correlation_id,created_at) VALUES ($1,$2,'soil_analysis_stale_ignored','soil_analysis',$3,$4,$5,$6,NOW())`,[tenantId,ownerId,String(current.id),jsonbParameter({acceptedOccurredAt:currentAcceptedAt,acceptedSourceEventId:current.accepted_event_source_event_id||null,linkVersion:currentLinkVersion,linkState:currentLinkState,clientId:current.client_id||null,propertyId:current.property_id||null,fieldId:current.field_id||null,laboratory:current.laboratory||null,method:current.method||null,depthFromCm:current.depth_from_cm??null,depthToCm:current.depth_to_cm??null,sampledAt:iso(current.sampled_at)||null,validatedFlags:current.validated_flags||[],validationEvidence:jsonObject(current.validation_evidence)}),jsonbParameter({ignoredOccurredAt:acceptedEventOccurredAt,ignoredSourceEventId:inserted.rows[0].id,linkVersion,linkState,clientId:linkedClientId,propertyId:linkedPropertyId,fieldId:linkedFieldId,laboratory:String(event.payload.laboratory||'').slice(0,180)||null,method:String(event.payload.method||'').slice(0,180)||null,depthFromCm:parseMoney(event.payload.depthFromCm),depthToCm:parseMoney(event.payload.depthToCm),sampledAt:parseDate(event.payload.sampledAt,event.occurredAt),validatedFlags:approved&&Array.isArray(event.payload.validatedFlags)?event.payload.validatedFlags:[],validationEvidence}),event.externalId])
            }
            if(analysisEventAccepted&&Array.isArray(event.payload.measurements)){
              const measurementSet=[];const logicalMeasurements=new Map()
              for(const measurement of event.payload.measurements.slice(0,500)){
                const analyte=String(measurement?.analyte||'').trim().slice(0,120);if(!analyte)continue
                const confidence=Number.isFinite(Number(measurement.confidence))?Math.max(0,Math.min(100,Math.round(Number(measurement.confidence)))):null
                const item={sampleKey:String(measurement.sampleKey||'').slice(0,120)||null,analyte,rawValue:parseMoney(measurement.rawValue??measurement.value),rawUnit:String(measurement.rawUnit||measurement.unit||'').slice(0,80)||null,normalizedValue:parseMoney(measurement.normalizedValue),normalizedUnit:String(measurement.normalizedUnit||'').slice(0,80)||null,method:String(measurement.method||event.payload.method||'').slice(0,180)||null,interpretation:String(measurement.interpretation||'').slice(0,240)||null,confidence}
                const logicalKey=`${item.sampleKey||''}\u0000${item.analyte.trim().toLowerCase()}`;const signature=JSON.stringify([item.rawValue,item.rawUnit,item.normalizedValue,item.normalizedUnit,item.method,item.interpretation,item.confidence]);const previous=logicalMeasurements.get(logicalKey)
                if(previous&&previous!==signature)throw domainError('A versão da análise contém medições contraditórias para a mesma amostra e grandeza.',422,'soil_measurement_set_conflict')
                if(previous)continue
                logicalMeasurements.set(logicalKey,signature);measurementSet.push(item)
              }
              const measurementOccurredAt=acceptedEventOccurredAt;const claimed=await client.query(`UPDATE soil_analyses SET measurement_set_occurred_at=$3,measurement_set_source_event_id=$4,measurement_set_link_version=$5 WHERE tenant_id=$1 AND id=$2 AND (measurement_set_occurred_at IS NULL OR measurement_set_occurred_at<$3 OR (measurement_set_occurred_at=$3 AND measurement_set_link_version<$5)) RETURNING measurement_set_occurred_at,measurement_set_source_event_id,measurement_set_link_version`,[tenantId,analysisRow.id,measurementOccurredAt,inserted.rows[0].id,linkVersion])
              if(!claimed.rowCount){
                const currentSet=await client.query(`SELECT measurement_set_occurred_at,measurement_set_source_event_id,measurement_set_link_version FROM soil_analyses WHERE tenant_id=$1 AND id=$2 LIMIT 1`,[tenantId,analysisRow.id])
                measurementSetStatus='stale_ignored'
                await client.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,correlation_id,created_at) VALUES ($1,$2,'soil_measurement_set_stale_ignored','soil_analysis',$3,$4,$5,$6,NOW())`,[tenantId,ownerId,String(analysisRow.id),jsonbParameter({acceptedOccurredAt:iso(currentSet.rows[0]?.measurement_set_occurred_at),acceptedSourceEventId:currentSet.rows[0]?.measurement_set_source_event_id||null,acceptedLinkVersion:Number(currentSet.rows[0]?.measurement_set_link_version||0)}),jsonbParameter({ignoredOccurredAt:measurementOccurredAt,ignoredSourceEventId:inserted.rows[0].id,linkVersion,activeCount:measurementSet.length}),event.externalId])
              }else{
                const superseded=await client.query(`UPDATE soil_measurements SET superseded_at=NOW() WHERE tenant_id=$1 AND analysis_id=$2 AND superseded_at IS NULL RETURNING id`,[tenantId,analysisRow.id])
                for(const measurement of measurementSet)await client.query(`INSERT INTO soil_measurements (tenant_id,analysis_id,sample_key,analyte,raw_value,raw_unit,normalized_value,normalized_unit,method,interpretation,confidence,link_version,source_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[tenantId,analysisRow.id,measurement.sampleKey,measurement.analyte,measurement.rawValue,measurement.rawUnit,measurement.normalizedValue,measurement.normalizedUnit,measurement.method,measurement.interpretation,measurement.confidence,linkVersion,inserted.rows[0].id])
                measurementSetStatus='replaced'
                await client.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,correlation_id,created_at) VALUES ($1,$2,'soil_measurement_set_replaced','soil_analysis',$3,$4,$5,$6,NOW())`,[tenantId,ownerId,String(analysisRow.id),jsonbParameter({supersededCount:Number(superseded.rowCount||0)}),jsonbParameter({activeCount:measurementSet.length,linkVersion,sourceEventId:inserted.rows[0].id,occurredAt:measurementOccurredAt}),event.externalId])
              }
            }
          }
          if(event.type==='ndvi.observation'){
            await client.query(`INSERT INTO ndvi_observations (tenant_id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,source,external_id,index_name,observed_at,sensor,resolution_m,cloud_percent,processing_version,geometry_version,statistics,anomaly,raster_uri,validated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,property_id=EXCLUDED.property_id,field_id=EXCLUDED.field_id,observed_at=EXCLUDED.observed_at,sensor=EXCLUDED.sensor,resolution_m=EXCLUDED.resolution_m,cloud_percent=EXCLUDED.cloud_percent,processing_version=EXCLUDED.processing_version,geometry_version=EXCLUDED.geometry_version,statistics=EXCLUDED.statistics,anomaly=EXCLUDED.anomaly,raster_uri=EXCLUDED.raster_uri,validated_at=EXCLUDED.validated_at`,[tenantId,resolvedClientId,resolvedPropertyId,resolvedFieldId,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,event.source,event.externalId,String(event.payload.index||'NDVI').slice(0,30),parseDate(event.payload.observedAt,event.occurredAt),String(event.payload.sensor||'').slice(0,100)||null,parseMoney(event.payload.resolutionM),parseMoney(event.payload.cloudPercent),String(event.payload.processingVersion||'').slice(0,80)||null,String(event.payload.geometryVersion||'').slice(0,80)||null,jsonbParameter(event.payload.statistics||{}),jsonbParameter({flag:event.payload.anomaly===true,classification:event.payload.classification||null,changePercent:parseMoney(event.payload.changePercent)}),String(event.payload.rasterUri||'').slice(0,2000)||null,approved?parseDate(validation.reviewedAt,event.occurredAt):null])
          }
          for(const item of acceptedSignals)await client.query(`INSERT INTO agronomic_signals (tenant_id,client_id,client_external_key,property_id,property_external_key,field_id,field_external_key,source_event_id,signal_type,severity,title,evidence,commercial_hypothesis,requires_agronomist,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[tenantId,resolvedClientId,event.clientExternalKey||null,resolvedPropertyId,event.propertyExternalKey||null,resolvedFieldId,event.fieldExternalKey||null,inserted.rows[0].id,item.type,item.severity,item.title,jsonbParameter(item.evidence),item.commercialHypothesis,item.requiresAgronomist,item.status])
          if(event.type.startsWith('business.'))await client.query(`INSERT INTO business_events (tenant_id,client_id,client_external_key,source,external_id,occurred_at,outcome,category,value,currency,loss_reason,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id,source,external_id) DO NOTHING`,[tenantId,resolvedClientId,event.clientExternalKey||null,event.source,event.externalId,event.occurredAt,event.type==='business.closed'?'won':event.type==='business.lost'?'lost':'open',event.payload.category||null,parseMoney(event.payload.value),/^[A-Z]{3}$/.test(String(event.payload.currency||'').toUpperCase())?String(event.payload.currency).toUpperCase():'BRL',event.payload.lossReason||event.payload.reason||null,jsonbParameter(event.payload)])
          return {duplicate:false,signals:acceptedSignals.length,...(measurementSetStatus?{measurementSetStatus}:{})}
        })
      }catch(error){if(error.statusCode)throw error;throw serviceError('Não foi possível persistir o evento de integração no banco configurado.')}
    }
    const store=this.fallback();const duplicate=store.val.integrationEvents.some(item=>exactScope(item,tenantId,ownerId)&&item.externalId===event.externalId&&item.source===event.source)
    if(duplicate)return {duplicate:true,signals:0}
    if(event.type==='agronomic.scan.completed'&&event.source==='manual-do-agronomo'){
      const sources=Array.isArray(event.payload.sourceAttachments)?event.payload.sourceAttachments.slice(0,3):[]
      const attachments=sources.map(source=>store.val.attachments.find(item=>attachmentInTenant(item,tenantId)&&item.ownerId===ownerId&&String(item.id)===String(source?.attachmentId)&&item.status!=='rejected'))
      if(!sources.length||attachments.some(item=>!item))throw domainError('Um ou mais attachments de origem não pertencem ao tenant e responsável autenticados.',404,'scan_attachment_scope_invalid')
      for(let index=0;index<attachments.length;index++){
        const attachment=attachments[index];const source=sources[index]
        if(event.clientExternalKey&&String(attachment.clientId||'')!==String(event.clientExternalKey))throw domainError('O attachment e o resultado declaram produtores diferentes.',422,'scan_attachment_client_scope_invalid')
        if(!attachment.clientId&&event.clientExternalKey)throw domainError('Um attachment UNLINKED não pode produzir resultado vinculado implicitamente.',422,'scan_unlinked_target_invalid')
        const provenance=buildAgronomicScanProvenance({sourceAttachment:source,attachment,tenantId,ownerId,analysisType:event.payload.analysisType,createdAt:event.payload.resultCreatedAt||event.occurredAt,resultReference:event.payload.resultReference,propertyId:event.payload.context?.propertyId||null,fieldId:event.payload.context?.fieldId||null,integrationEventId:event.externalId})
        const scanResult={...provenance,result:{summary:String(event.payload.result?.summary||'').slice(0,2000),image_quality:String(event.payload.result?.imageQuality||'').slice(0,80),analyzed_at:parseDate(event.payload.result?.analyzedAt,event.payload.resultCreatedAt||event.occurredAt)},safety:{classification:String(event.payload.safety?.classification||'ASSISTED_TRIAGE_NOT_PRESCRIPTION').slice(0,120),human_review_required:true}}
        attachment.status=['confirmed','stored'].includes(attachment.status)?attachment.status:'interpreted';attachment.analysis={...jsonObject(attachment.analysis),scanResults:[...(Array.isArray(attachment.analysis?.scanResults)?attachment.analysis.scanResults:[]),scanResult],latestScanResult:scanResult};attachment.updated_at=new Date().toISOString()
      }
    }
    store.val.integrationEvents.push({...event,tenantId,ownerId,ingestedAt:new Date().toISOString()});store.val.signals.push(...signals.map(item=>({...item,id:randomUUID(),tenantId,ownerId,clientExternalKey:event.clientExternalKey,sourceExternalId:event.externalId,createdAt:new Date().toISOString()})));store.val.integrationEvents=store.val.integrationEvents.slice(-1000);store.val.signals=store.val.signals.slice(-1000);this.saveStore(store);return {duplicate:false,signals:signals.length}
  }

  async ingestCommercialImport({tenantId=this.tenantId,ownerId,summary,clients,rows=[],mapping={}}){
    tenantId=assertTenantScope(this.tenantId,tenantId)
    if(!this.db.configured)return {persisted:false}
    try{
      await this.db.transaction(async connection=>{
        await connection.query(`INSERT INTO import_jobs (id,tenant_id,owner_user_id,source_type,file_name,status,row_count,recognized_count,summary,completed_at) VALUES ($1,$2,$3,'commercial_history',$4,'completed',$5,$6,$7,NOW()) ON CONFLICT (id) DO NOTHING`,[summary.id,tenantId,ownerId,summary.fileName,summary.rowCount,clients.length,jsonbParameter(summary)])
        const clientInternalIds=new Map()
        const importedClients=clients.slice(0,2000)
        const lockKeys=[...new Set(importedClients.map(item=>String(item.id||'').slice(0,180)))].sort()
        for(const externalKey of lockKeys)await connection.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text||':'||$3::text,0))`,[tenantId,ownerId,externalKey])
        for(const item of importedClients){const area=parseCultivatedArea(item.area);const externalKey=String(item.id||'').slice(0,180);const upserted=await connection.query(`INSERT INTO clients (tenant_id,consultant_id,external_key,name,municipality,total_area_ha,area_band,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','commercial_import',NOW()) ON CONFLICT (tenant_id,consultant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=COALESCE(EXCLUDED.municipality,clients.municipality),total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),commercial_profile=(clients.commercial_profile||EXCLUDED.commercial_profile)||CASE WHEN clients.commercial_profile?'property' THEN jsonb_build_object('property',clients.commercial_profile->'property') ELSE '{}'::jsonb END,updated_at=NOW() RETURNING id,external_key`,[tenantId,ownerId,externalKey,String(item.name||'').slice(0,180),item.municipality||null,area.totalAreaHa,area.areaBand,jsonbParameter(derivedCommercial(item.commercial||{}))]);clientInternalIds.set(upserted.rows[0].external_key,upserted.rows[0].id)}
        const clientKeys=new Map(clients.map(item=>[normalize(item.name),item.id]))
        for(let index=0;index<rows.slice(0,5000).length;index++){
          const row=rows[index]||{};const name=String(row[mapping.client]||'').trim();if(!name)continue
          const status=mapping.status?row[mapping.status]:null;const eventOutcome=outcome(status);const occurredAt=parsedDate(mapping.date?row[mapping.date]:null)
          if(!eventOutcome||!occurredAt)continue
          const safeRow={client:name.slice(0,180),value:row[mapping.value]??null,date:row[mapping.date]??null,product:String(row[mapping.product]||'').slice(0,180)||null,status:String(status||'').slice(0,240)||null,municipality:String(row[mapping.municipality]||'').slice(0,140)||null,culture:String(row[mapping.culture]||'').slice(0,160)||null,area:row[mapping.area]??null}
          const externalKey=clientKeys.get(normalize(name))||normalize(name).replace(/\s+/g,'-').slice(0,180)
          await connection.query(`INSERT INTO business_events (tenant_id,client_id,client_external_key,source,external_id,occurred_at,outcome,category,product,value,currency,loss_reason,payload)
            VALUES ($1,$2,$3,'commercial_import',$4,$5,$6,$7,$8,$9,'BRL',$10,$11) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,client_external_key=EXCLUDED.client_external_key,occurred_at=EXCLUDED.occurred_at,outcome=EXCLUDED.outcome,category=EXCLUDED.category,product=EXCLUDED.product,value=EXCLUDED.value,loss_reason=EXCLUDED.loss_reason,payload=EXCLUDED.payload`,[tenantId,clientInternalIds.get(externalKey)||null,externalKey,`${summary.id}:${index+1}`,occurredAt,eventOutcome,String(row[mapping.product]||'').trim()||null,String(row[mapping.product]||'').trim()||null,parseMoney(row[mapping.value]),eventOutcome==='lost'?String(status||'').slice(0,240):null,jsonbParameter(safeRow)])
        }
      })
      return {persisted:true,rawRows:Math.min(rows.length,5000),truncated:Boolean(summary.truncated)}
    }catch{throw serviceError('A importação não pôde ser persistida no PostgreSQL configurado.')}
  }
}
