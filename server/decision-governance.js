import {AGRO_GEO_FLAGS,AGRO_GEO_POLICIES} from './agro-geo-policy.js'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {VAL_INSTRUCTIONS_VERSION,buildValInstructions} from './sales-playbook.js'

export const DECISION_VERSION='val.decision-card.v1'
export const SCORING_POLICIES=Object.freeze({
 'val.decision-scoring.v1':Object.freeze({version:'val.decision-scoring.v1',weights:{COMMERCIAL_VALUE:20,URGENCY:35,RELATIONSHIP:10,AGRONOMIC_SIGNAL:15,TIMING:15,RISK:5},freshDays:90,technicalFreshDays:14,staleFactor:.35,commercialSaturation:250000}),
 'val.decision-scoring.conservative.v1':Object.freeze({version:'val.decision-scoring.conservative.v1',weights:{COMMERCIAL_VALUE:10,URGENCY:40,RELATIONSHIP:10,AGRONOMIC_SIGNAL:15,TIMING:20,RISK:5},freshDays:60,technicalFreshDays:7,staleFactor:.2,commercialSaturation:250000})
})
export const DECISION_FLAGS=['nba_v1','portfolio_radar_v2','decision_cards','management_decision_view',...AGRO_GEO_FLAGS]
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
export const hashDecision=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export const stagingDecisionDefaults=environment=>Object.fromEntries(DECISION_FLAGS.map(key=>[key,['staging','test','development'].includes(String(environment).toLowerCase())]))
const baseline='7432421a5c583ae08076b15a06b3e4bb7881eba0'
const registeredAt='2026-10-02T19:12:00Z'
const fileHash=path=>createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')

// Inventory of the actual running sources. No private prompt body, credentials
// or arbitrary environment variables are persisted or exposed here.
export function decisionRegistries(config={}){
 const models=[['daily',config.modelDaily],['strategic',config.modelStrategic],['fast',config.modelFast],['voice_transcription',config.voiceTranscriptionModel],['voice_extraction',config.voiceExtractionModel],['realtime_voice',config.realtimeVoiceModel],['decision_scoring','deterministic']].map(([capability,model])=>({capability,model:model||'UNCONFIGURED',version:hashDecision([capability,model||'UNCONFIGURED']).slice(0,16),policy_version:capability==='decision_scoring'?'val.decision-scoring.v1':'runtime-config',status:model?'CONFIGURED':capability==='decision_scoring'?'ACTIVE':'UNCONFIGURED',rollback_version:baseline,selection:'EXPLICIT_CONFIGURATION'}))
 const prompts=['fast','daily','strategic'].map(tier=>({prompt_id:`val.playbook.${tier}`,version:VAL_INSTRUCTIONS_VERSION,purpose:`Consultoria ${tier}`,model:models.find(x=>x.capability===tier)?.model,status:'ACTIVE',created_at:registeredAt,approved_at:null,approval_status:'RELEASE_PENDING',rollback_version:baseline,policy_version:'val.core.policy.v1',sha256:hashDecision(buildValInstructions(tier)),source:'server/sales-playbook.js'}))
 for(const [id,path,purpose] of [['visit-preparation','./ai-reasoning/visit-preparation-context.js','SPIN, OPC/APC, EPA e preparação'],['decision-interview','./ai-reasoning/decision-interview.js','Perguntas materiais'],['conversion','./conversion-engine.js','Composição determinística'],['reasoning','./ai-reasoning/index.js','Contrato de raciocínio']])prompts.push({prompt_id:`val.${id}`,version:fileHash(path),purpose,model:id==='conversion'?'deterministic':'CAPABILITY_ROUTING',status:'ACTIVE',created_at:registeredAt,approved_at:null,approval_status:'RELEASE_PENDING',rollback_version:baseline,policy_version:'val.core.policy.v1',sha256:fileHash(path),source:`server/${path.slice(2)}`})
 const policies=[['routing','./decision-copilot/capability-router.js'],['grounding','./decision-copilot/response-grounding.js'],['freshness','./memory/freshness-policy.js'],['safety','./technical-safety-audit.js'],['memory','./memory/context-snapshot.js'],['source_requirements','./knowledge/policy.js'],['isolation','./core/policy.js']].map(([policy_id,path])=>({policy_id,version:fileHash(path),source:`server/${path.slice(2)}`,rollback_version:baseline,status:'ACTIVE'}))
 return {version:'val.registry.v1',prompts,models,policies:[...Object.entries(AGRO_GEO_POLICIES).map(([policy_id,policy])=>({policy_id,...policy,status:'AVAILABLE'})),...policies,...Object.values(SCORING_POLICIES).map(policy=>({policy_id:'decision_scoring',...policy,rollback_version:baseline,status:'AVAILABLE'}))],automaticModelChange:false,privatePromptStored:false,rollback:{sourceCommit:baseline,logicalSettingsHistory:true,scope:'NBA flags and scoring; existing prompts/models remain unchanged'}}
}
