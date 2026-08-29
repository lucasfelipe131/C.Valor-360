export const REALTIME_VOICE_PRICING_VERSION='openai.pricing.2026-08-29'
export const REALTIME_VOICE_MODEL='gpt-realtime-2.1-mini'

const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0
const round=value=>Number(number(value).toFixed(8))

export function estimateRealtimeVoiceCost(usage={}){
 const input=usage.input_token_details||{}
 const output=usage.output_token_details||{}
 const cached=input.cached_tokens_details||{}
 const cachedAudio=Math.min(number(input.audio_tokens),number(cached.audio_tokens))
 const cachedText=Math.min(number(input.text_tokens),number(cached.text_tokens))
 const uncachedAudio=Math.max(0,number(input.audio_tokens)-cachedAudio)
 const uncachedText=Math.max(0,number(input.text_tokens)-cachedText)
 const cost=(uncachedAudio*10+cachedAudio*.3+number(output.audio_tokens)*20+uncachedText*.6+cachedText*.06+number(output.text_tokens)*2.4)/1_000_000
 return Object.freeze({
  pricingVersion:REALTIME_VOICE_PRICING_VERSION,
  model:REALTIME_VOICE_MODEL,
  estimatedCostUsd:round(cost),
  tokens:{inputAudio:number(input.audio_tokens),cachedInputAudio:cachedAudio,inputText:number(input.text_tokens),cachedInputText:cachedText,outputAudio:number(output.audio_tokens),outputText:number(output.text_tokens),total:number(usage.total_tokens)}
 })
}

export function estimateRealtimeTranscriptionCost(usage={}){
 const seconds=usage?.type==='duration'?number(usage.seconds):0
 const inputTokens=usage?.type==='tokens'?number(usage.input_tokens):0
 const outputTokens=usage?.type==='tokens'?number(usage.output_tokens):0
 const cost=seconds*.0045/60+(inputTokens*2.5+outputTokens*10)/1_000_000
 return Object.freeze({pricingVersion:REALTIME_VOICE_PRICING_VERSION,model:'gpt-transcribe',estimatedCostUsd:round(cost),tokens:{transcriptionSeconds:seconds,transcriptionInputTokens:inputTokens,transcriptionOutputTokens:outputTokens}})
}

const memoryStore=()=>{
 const reservations=new Map(),usageEvents=new Map(),finalized=new Set()
 const total=()=>{
  let value=0
  for(const [sessionId,reservation] of reservations){const actual=[...usageEvents.values()].filter(item=>item.sessionId===sessionId).reduce((sum,item)=>sum+item.cost,0);value+=finalized.has(sessionId)?actual:Math.max(reservation,actual)}
  return round(value)
 }
 return Object.freeze({
  async reserve({sessionId,reservationUsd,budgetUsd}){const before=total();if(before+reservationUsd>budgetUsd)return {reserved:false,totalUsd:before,remainingUsd:round(Math.max(0,budgetUsd-before))};reservations.set(sessionId,reservationUsd);return {reserved:true,totalUsd:total(),remainingUsd:round(Math.max(0,budgetUsd-total()))}},
  async record({sessionId,responseId,costUsd,final=false,budgetUsd}){if(responseId&&!usageEvents.has(responseId))usageEvents.set(responseId,{sessionId,cost:costUsd});if(final)finalized.add(sessionId);const value=total();return {recorded:true,totalUsd:value,remainingUsd:round(Math.max(0,budgetUsd-value)),exhausted:value>=budgetUsd}},
  async snapshot({budgetUsd}){const value=total();return {totalUsd:value,remainingUsd:round(Math.max(0,budgetUsd-value)),exhausted:value>=budgetUsd}}
 })
}

export function createInMemoryRealtimeCostStore(){return memoryStore()}

export function createPostgresRealtimeCostStore({database,tenantId}){
 if(!database?.configured)return null
 const summarySql=`WITH reservations AS (
  SELECT entity_id session_id,MAX(COALESCE((metadata->>'reservationUsd')::numeric,0)) reservation_usd,
   BOOL_OR(COALESCE((metadata->>'reservationExpiresAt')::timestamptz,NOW()+INTERVAL '1 hour')<=NOW()) expired
  FROM usage_events WHERE tenant_id=$1 AND event_type='realtime_voice_session_reserved' AND metadata->>'budgetScope'='val-natural-realtime-voice-v1' GROUP BY entity_id
 ), usage AS (
  SELECT metadata->>'sessionId' session_id,SUM(COALESCE((metadata->>'estimatedCostUsd')::numeric,0)) actual_usd,BOOL_OR(COALESCE((metadata->>'final')::boolean,false)) finalized
  FROM usage_events WHERE tenant_id=$1 AND event_type='realtime_voice_usage' AND metadata->>'budgetScope'='val-natural-realtime-voice-v1' GROUP BY metadata->>'sessionId'
 ) SELECT COALESCE(SUM(CASE WHEN COALESCE(usage.finalized,false) OR reservations.expired THEN COALESCE(usage.actual_usd,0) ELSE GREATEST(reservations.reservation_usd,COALESCE(usage.actual_usd,0)) END),0)::float8 total_usd
 FROM reservations LEFT JOIN usage USING(session_id)`
 const snapshot=async(connection=database)=>{const result=await connection.query(summarySql,[tenantId]);return number(result.rows[0]?.total_usd)}
 return Object.freeze({
  async reserve({sessionId,userId,reservationUsd,budgetUsd,model}){
   return database.transaction(async connection=>{
    await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`val-realtime-budget:${tenantId}`])
    const current=await snapshot(connection)
    if(current+reservationUsd>budgetUsd)return {reserved:false,totalUsd:round(current),remainingUsd:round(Math.max(0,budgetUsd-current))}
    const reservationExpiresAt=new Date(Date.now()+15*60_000).toISOString()
    await connection.query(`INSERT INTO usage_events (tenant_id,user_id,event_type,page,entity_type,entity_id,metadata,occurred_at) VALUES ($1,$2,'realtime_voice_session_reserved','val','realtime_voice_session',$3,$4,NOW())`,[tenantId,userId,sessionId,JSON.stringify({budgetScope:'val-natural-realtime-voice-v1',reservationUsd,reservationExpiresAt,model,contentFree:true})])
    return {reserved:true,totalUsd:round(current+reservationUsd),remainingUsd:round(Math.max(0,budgetUsd-current-reservationUsd))}
   })
  },
  async record({sessionId,userId,responseId,costUsd,final=false,budgetUsd,model,usage}){
   return database.transaction(async connection=>{
    await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`val-realtime-budget:${tenantId}`])
    if(responseId){const existing=await connection.query(`SELECT 1 FROM usage_events WHERE tenant_id=$1 AND event_type='realtime_voice_usage' AND entity_id=$2 LIMIT 1`,[tenantId,responseId]);if(existing.rowCount){const value=await snapshot(connection);return {recorded:false,duplicate:true,totalUsd:round(value),remainingUsd:round(Math.max(0,budgetUsd-value)),exhausted:value>=budgetUsd}}}
    await connection.query(`INSERT INTO usage_events (tenant_id,user_id,event_type,page,entity_type,entity_id,metadata,occurred_at) VALUES ($1,$2,'realtime_voice_usage','val','realtime_voice_response',$3,$4,NOW())`,[tenantId,userId,responseId||`final:${sessionId}`,JSON.stringify({budgetScope:'val-natural-realtime-voice-v1',sessionId,estimatedCostUsd:costUsd,final:Boolean(final),model,usage,contentFree:true})])
    const value=await snapshot(connection)
    return {recorded:true,totalUsd:round(value),remainingUsd:round(Math.max(0,budgetUsd-value)),exhausted:value>=budgetUsd}
   })
  },
  async snapshot({budgetUsd}){const value=await snapshot();return {totalUsd:round(value),remainingUsd:round(Math.max(0,budgetUsd-value)),exhausted:value>=budgetUsd}}
 })
}
