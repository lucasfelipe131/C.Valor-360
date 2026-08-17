import {ValRepository} from './repository.js'
import {GrainRepository} from './grain-repository.js'
import {buildCommitmentLadders} from './commitment-ladder.js'
import {buildObjectionLibrary} from './objection-library.js'
import {buildValueScenarios} from './value-scenarios.js'
import {buildMultiDecisionMap} from './multi-decision-map.js'
import {buildPostConversionExpansion,hasRecentClosedBusiness} from './post-conversion-expansion.js'
import {buildMessageCalibration} from './message-calibration.js'

const PATCHED=Symbol.for('valor360.conversion-innovations.patched')
const GRAIN_CACHE_TTL_MS=5*60_000
const grainCache=new Map()

async function grainWorkspaceFor(repository,ownerId){
 if(ownerId==null)return null
 const key=`${repository.tenantId||'tenant'}:${ownerId}`
 const cached=grainCache.get(key)
 if(cached&&cached.expiresAt>Date.now())return cached.value
 try{
  const grainRepository=new GrainRepository({db:repository.db,readStore:repository.readStore,saveStore:repository.saveStore,tenantId:repository.tenantId})
  const value=await grainRepository.getWorkspace(ownerId)
  grainCache.set(key,{expiresAt:Date.now()+GRAIN_CACHE_TTL_MS,value})
  return value
 }catch{return null}
}

async function calibrationHistoryFor(repository,input,context){
 if(!repository.db?.configured||input?.ownerId==null||!input?.clientId)return context.priorRecommendations||[]
 try{
  const result=await repository.db.query(`
   SELECT recommendation.id,recommendation.user_question,recommendation.mode,recommendation.model_version,recommendation.status,
    recommendation.generated_content->>'next_best_action' next_best_action,
    recommendation.generated_content->'methodology_state' methodology_state,
    recommendation.generated_content->'next_question' next_question,
    recommendation.generated_content->'approach_plan' approach_plan,
    recommendation.generated_content->'conversation_plan' conversation_plan,
    recommendation.generated_content->'executive_brief' executive_brief,
    recommendation.created_at,
    (SELECT jsonb_build_object('id',feedback.id,'rating',feedback.rating,'outcome',feedback.outcome,'created_at',feedback.created_at)
     FROM val_feedback feedback
     WHERE feedback.tenant_id=$1 AND feedback.recommendation_id=recommendation.id
     ORDER BY feedback.created_at DESC LIMIT 1) feedback
   FROM val_recommendations recommendation
   WHERE recommendation.tenant_id=$1 AND recommendation.consultant_id=$2
    AND recommendation.created_at>=NOW()-INTERVAL '365 days'
    AND (
     recommendation.client_external_key=$3 OR
     recommendation.client_id=(SELECT client.id FROM clients client WHERE client.tenant_id=$1 AND client.consultant_id=$2 AND (client.id::text=$3 OR client.external_key=$3) LIMIT 1)
    )
   ORDER BY recommendation.created_at ASC
   LIMIT 120`,[repository.tenantId,input.ownerId,String(input.clientId)])
  return result.rows||[]
 }catch{return context.priorRecommendations||[]}
}

if(!globalThis[PATCHED]){
 globalThis[PATCHED]=true
 const originalGetClientContext=ValRepository.prototype.getClientContext
 ValRepository.prototype.getClientContext=async function contextWithConversionInnovations(input){
  const context=await originalGetClientContext.call(this,input)
  const [grainWorkspace,calibrationRecommendations]=await Promise.all([
   hasRecentClosedBusiness(context)?grainWorkspaceFor(this,input?.ownerId):null,
   calibrationHistoryFor(this,input,context)
  ])
  const calibrationContext={...context,calibrationRecommendations}
  return {
   ...context,
   conversionInnovations:{
    ...(context.conversionInnovations||{}),
    commitmentLadders:buildCommitmentLadders(context),
    objectionLibrary:buildObjectionLibrary(context),
    valueScenarios:buildValueScenarios(context),
    multiDecisionMap:buildMultiDecisionMap(context),
    postConversionExpansion:buildPostConversionExpansion(context,{grainWorkspace}),
    messageCalibration:buildMessageCalibration(calibrationContext)
   }
  }
 }
}
