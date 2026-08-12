import {hasIndependentOpportunity,isQ27Opportunity,normalizeText,opportunityFromAdditionalNeed} from './profile.js'
import {commercialMetrics} from './commercial-metrics.js'

export const PIPELINE_STAGES=['Diagnóstico','Proposta','Negociação','Fechado']
export const OPPORTUNITY_CACHE_VERSION='v2'
const stageProgress={Diagnóstico:25,Proposta:50,Negociação:75,Fechado:100}
const stageEvidenceTypes=new Set(['manual_advance','manual_set','won'])

export const opportunityCacheKey=storageScope=>storageScope?`valor360:${OPPORTUNITY_CACHE_VERSION}:${storageScope}:opportunities`:null
export const parseOpportunityCache=raw=>{try{const parsed=JSON.parse(raw||'[]');return Array.isArray(parsed)?parsed:[]}catch{return []}}

export function resolveOpportunityCandidate(client={}){
 const commercial=client.commercial||{}
 const commercialTitle=opportunityFromAdditionalNeed(commercial.opportunity)
 const provenance=commercial.opportunityProvenance
 const explicitIndependent=hasIndependentOpportunity(commercial)
 if(explicitIndependent)return {title:commercialTitle,source:String(provenance?.origin||'legacy_commercial')}
 const additionalNeed=opportunityFromAdditionalNeed(client.additionalNeed)
 if(client.additionalNeedStatus==='reported'&&additionalNeed){
  const title=isQ27Opportunity(commercial)&&commercialTitle?commercialTitle:additionalNeed
  return {title,source:'producer_360_q27'}
 }
 return null
}

const candidateKey=candidate=>`${candidate.source}:${normalizeText(candidate.title)}`
const currentValue=client=>{const metrics=commercialMetrics(client);return metrics.openPotentialKnown?metrics.openPotential:0}
const cleanEvidence=(value,key,stage)=>{
 if(!value||!stageEvidenceTypes.has(value.type)||value.candidateKey!==key||value.to!==stage)return undefined
 return {type:value.type,from:PIPELINE_STAGES.includes(value.from)?value.from:'Diagnóstico',to:stage,at:String(value.at||'').slice(0,40),candidateKey:key}
}

export function reconcilePipeline(clients=[],cachedItems=[]){
 const cacheByClient=new Map((Array.isArray(cachedItems)?cachedItems:[]).filter(item=>item&&item.clientId).map(item=>[String(item.clientId),item]))
 return (Array.isArray(clients)?clients:[]).flatMap(client=>{
  const candidate=resolveOpportunityCandidate(client);if(!candidate)return []
  const key=candidateKey(candidate);const cached=cacheByClient.get(String(client.id))
  const cachedStage=PIPELINE_STAGES.includes(cached?.stage)?cached.stage:'Diagnóstico'
  const evidence=cleanEvidence(cached?.stageEvidence,key,cachedStage)
  const stage=evidence?cachedStage:'Diagnóstico'
  return [{id:`o-${client.id}`,clientId:client.id,title:candidate.title,value:currentValue(client),source:candidate.source,candidateKey:key,stage,stageProgress:stageProgress[stage],...(evidence?{stageEvidence:evidence}:{})}]
 })
}

export function advancePipelineItem(items,itemId,now=new Date().toISOString()){
 return items.map(item=>{
  if(item.id!==itemId)return item
  const currentIndex=PIPELINE_STAGES.indexOf(item.stage);const nextStage=PIPELINE_STAGES[Math.min(Math.max(currentIndex,0)+1,PIPELINE_STAGES.length-1)]
  return {...item,stage:nextStage,stageProgress:stageProgress[nextStage],stageEvidence:{type:'manual_advance',from:item.stage,to:nextStage,at:now,candidateKey:item.candidateKey}}
 })
}
