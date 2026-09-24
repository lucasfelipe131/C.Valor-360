import {createHash} from 'node:crypto'

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,40)
const text=value=>String(value??'').trim().normalize('NFC')
const identity=record=>record?.payload?.import_identity
const signature=row=>hash([row.occurredIso,row.productIdentity,row.value,row.eventOutcome,row.safeRow.status||'',row.safeRow.municipality||'',row.safeRow.culture||'',row.safeRow.area??null])
const group=row=>hash([row.clientId,row.occurredIso,row.productIdentity])
const fromRecord=record=>({clientId:record.client_id,occurredIso:new Date(record.occurred_at).toISOString(),productIdentity:identity(record)?.product_identity??record.payload?.product??record.product??'',value:record.value===null?null:Number(record.value),eventOutcome:record.outcome,safeRow:record.payload||{}})

// Verify old identities against their own persisted payload. Matching a coarse
// producer/date/product bucket alone never authorizes legacy adoption/correction.
function verifiedHistorical(record,{tenantId,ownerId}){
 if(identity(record))return false
 const p=record.payload||{},date=new Date(record.occurred_at).toISOString()
 const base=[tenantId,ownerId,record.client_external_key,date,p.product||'']
 const hashes=[hash(base),hash([...base,String(p.value??''),record.outcome,p.status||''])]
 return hashes.some(h=>new RegExp(`^commercial_import:${h}:[1-9][0-9]*$`).test(record.external_id))
}

export function commercialSourceScope({row,mapping,fileName}){
 const declared=mapping.source?text(row[mapping.source]):''
 const sourceKey=mapping.eventId?text(row[mapping.eventId]):''
 return {sourceScope:declared?`source:${declared}`:`file:${text(fileName)||'commercial-import'}`,explicitSource:Boolean(declared),sourceKey,previousId:mapping.previousExternalId?text(row[mapping.previousExternalId]):'',missingSource:Boolean(mapping.source&&!declared),missingSourceKey:Boolean(mapping.eventId&&!sourceKey)}
}

// Pure resolution inside the repository's scoped PostgreSQL transaction/locks.
// Existing external_id is always retained. JSONB metadata records source/lineage;
// there is no in-memory ledger, second business table or historical rekey.
export function resolveCommercialRows(rows,records,{tenantId,ownerId}){
 const claimed=new Set(),newOrdinals=new Map()
 const prepared=rows.map(row=>({...row,groupKey:group(row),signature:signature(row)}))
 const recorded=new Map(records.map(record=>{const row=fromRecord(record);return [record,{row,groupKey:group(row),signature:signature(row),historical:verifiedHistorical(record,{tenantId,ownerId})}]}))
 const sameScope=(record,row)=>record.tenant_id===tenantId&&record.owner_user_id===ownerId&&record.client_id===row.clientId&&record.source==='commercial_import'
 const sameSource=(record,row)=>identity(record)?.source_scope===row.sourceScope
 return prepared.map(row=>{
  if(row.missingSource||row.missingSourceKey)return {...row,status:'REVIEW_REQUIRED',reason:row.missingSource?'MISSING_SOURCE':'MISSING_SOURCE_ROW_ID',externalId:null}
  const bucket=records.filter(record=>{
   if(!sameScope(record,row))return false
   const old=recorded.get(record).row
   // Historical columns truncated long descriptions. Their missing suffix is
   // not evidence of a different product: keep them in the ambiguity boundary.
   return recorded.get(record).groupKey===row.groupKey||(!identity(record)&&old.occurredIso===row.occurredIso&&old.productIdentity.length===180&&row.productIdentity.startsWith(old.productIdentity))
  })
  const scoped=records.filter(record=>sameScope(record,row))
  const peers=prepared.filter(r=>r.clientId===row.clientId&&r.sourceScope===row.sourceScope&&r.groupKey===row.groupKey)
  const eligible=bucket.filter(record=>sameSource(record,row)||(!row.explicitSource&&recorded.get(record).historical))
  let target=null,reason='',kind=row.sourceKey?'EXPLICIT':peers.length===1?'SINGLETON':'MULTISET'
  if(row.previousId){
   const candidates=scoped.filter(record=>record.external_id===row.previousId&&(sameSource(record,row)||(!row.explicitSource&&recorded.get(record).historical)))
   if(prepared.filter(r=>r.clientId===row.clientId&&r.sourceScope===row.sourceScope&&r.previousId===row.previousId).length>1)reason='DUPLICATE_PREVIOUS_ID'
   else if(candidates.length===1)target=candidates[0]
   else reason='PREVIOUS_ID_NOT_IN_AUTHORIZED_SOURCE_SCOPE'
  }else if(row.sourceKey){
   if(prepared.filter(r=>r.clientId===row.clientId&&r.sourceScope===row.sourceScope&&r.sourceKey===row.sourceKey).length!==1)reason='DUPLICATE_SOURCE_ROW_ID'
   else{
    const candidates=scoped.filter(record=>sameSource(record,row)&&identity(record)?.source_key===row.sourceKey)
    if(candidates.length===1)target=candidates[0]
    else if(candidates.length>1)reason='MULTIPLE_SOURCE_ROW_IDS'
    // An explicit new source ID is distinct from other known explicit IDs, but
    // cannot silently duplicate an unlabelled historical business in this bucket.
    else if(bucket.some(record=>!identity(record)||(sameSource(record,row)&&!identity(record)?.source_key)))reason='HISTORICAL_ID_REQUIRES_REFERENCE'
   }
  }else{
   const exact=eligible.filter(record=>recorded.get(record).signature===row.signature)
   const equalPeers=peers.filter(r=>r.signature===row.signature)
   if(exact.length>equalPeers.length)reason='INDISTINGUISHABLE_EXISTING_EVENTS'
   else target=exact.find(record=>!claimed.has(record.id))||null
   if(!target&&!reason){
    // File name + producer/date/product is not proof that a changed amount is
    // a correction. Require a stable source business ID or explicit prior ID.
    if(eligible.length||bucket.some(record=>!identity(record)))reason='AMBIGUOUS_IDENTITY'
   }
  }
  if(target&&row.sourceKey&&identity(target)?.source_key&&identity(target).source_key!==row.sourceKey)reason='SOURCE_ID_MISMATCH'
  if(target&&row.sourceKey&&scoped.some(record=>record.id!==target.id&&sameSource(record,row)&&identity(record)?.source_key===row.sourceKey))reason='SOURCE_ID_MISMATCH'
  if(target&&claimed.has(target.id))reason='EVENT_ALREADY_CLAIMED_IN_BATCH'
  if(reason)return {...row,status:'REVIEW_REQUIRED',reason,externalId:null}
  if(target){
   claimed.add(target.id)
   kind=identity(target)?.kind||kind
  }
  const key=hash([tenantId,ownerId,row.clientId,'commercial_import',row.sourceScope,row.sourceKey||row.signature])
  const ordinal=(newOrdinals.get(key)||0)+1;newOrdinals.set(key,ordinal)
  const externalId=target?.external_id||`commercial_import:v2:${key}:${ordinal}`
  const metadata={version:2,source_scope:row.sourceScope,source_key:row.sourceKey||identity(target)?.source_key||null,kind,group_key:row.groupKey,product_identity:row.productIdentity,canonical_external_id:externalId}
  const unchanged=target&&recorded.get(target).signature===row.signature
  return {...row,target,externalId,status:target?(unchanged?'IGNORED_IDEMPOTENT':'UPDATED'):'CREATED',reason:target?(unchanged?'EXACT_REPLAY':'PROVEN_SOURCE_LINEAGE'):'NEW_SOURCE_EVENT',payload:{...(target?.payload||{}),...row.safeRow,import_identity:metadata}}
 })
}
