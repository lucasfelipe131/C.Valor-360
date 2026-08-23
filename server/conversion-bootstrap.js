import {AsyncLocalStorage} from 'node:async_hooks'
import {createHash} from 'node:crypto'
import {ValEngine,enforceValSafety,summarizeContextCoverage} from './val-engine.js'
import {ValRepository} from './repository.js'
import {buildFallbackAdvice} from './sales-playbook.js'
import {buildDecisionIntelligence} from './decision-intelligence.js'
import {buildValueBridge} from './product-intelligence.js'
import {buildConversionFoundation,buildConversionIntelligence,reconcileAdviceWithConversion,conversionCoreVersion} from './conversion-engine.js'
import {normalizeAdviceForValUi,toValUiPriority} from './conversion-ui-contract.js'
import {buildConversationOrchestration,enrichAdviceWithOrchestration,conversationOrchestratorVersion} from './conversation-orchestrator-runtime.js'
import {prepareConversationThread} from './conversation-thread-context.js'
import {languageEnhancerVersion,preserveEnhancedLanguage} from './language-enhancer.js'
import {buildPortfolioRadar} from './portfolio-radar.js'
import {buildInsightFeed} from './execution/insight-card.js'
import {enforceValSpecificity,mergeStructuredReasoning,resolveStructuredReasoningRoute,specificityVersion} from './val-specificity.js'
import {attachCommercialComposition} from './commercial/composition.js'
import {attachExecutionComposition} from './execution/composition.js'
import {observe} from './observability.js'

const PATCHED=Symbol.for('valor360.conversion-core.patched')
export const conversionCompositionVersion='conversion-bootstrap-v1'
const RADAR_CACHE_TTL_MS=10*60_000
const radarCache=new Map()
const originalQuestionContext=new AsyncLocalStorage()
const list=value=>Array.isArray(value)?value:[]
const radarClientKey=item=>String(item?.clientId??item?.client_id??item?.clientExternalKey??item?.client_external_key??'')
const radarTime=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?0:date.getTime()}
const radarActive=item=>item&&!/^(?:fechado|ganho|conclu[ií]do|perdido|cancelado|closed|won|lost)$/i.test(String(item.stage||'').trim())

function emitProgress(input,stage){
  try{input?.onProgress?.(stage)}catch{}
}

function radarPartialContext(client,intelligence){
  const id=String(client?.id||'')
  return {
    client,
    profile:{answers:client?.profileAnswers||{},assessedAt:client?.profileUpdatedAt||null},
    opportunities:list(intelligence?.opportunities).filter(item=>radarClientKey(item)===id),
    visits:list(intelligence?.visits).filter(item=>radarClientKey(item)===id),
    interactions:[],businessHistory:[],signals:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],memories:[],priorRecommendations:[]
  }
}

function radarCandidateScore(client,intelligence,now){
  const id=String(client?.id||'')
  const opportunities=list(intelligence?.opportunities).filter(item=>radarClientKey(item)===id&&radarActive(item))
  const visits=list(intelligence?.visits).filter(item=>radarClientKey(item)===id)
  const nextDeadline=Math.min(...opportunities.map(item=>radarTime(item.nextActionAt||item.next_action_at)).filter(Boolean),Number.POSITIVE_INFINITY)
  const upcoming=Math.min(...visits.map(item=>radarTime(item.scheduledAt||item.scheduled_at)).filter(value=>value>=now),Number.POSITIVE_INFINITY)
  const openPotential=Number(client?.commercial?.openPotential)||0
  const latest=Math.max(0,...opportunities.map(item=>radarTime(item.updatedAt||item.updated_at||item.createdAt||item.created_at)),...visits.map(item=>radarTime(item.updatedAt||item.updated_at||item.scheduledAt||item.scheduled_at)),radarTime(client?.profileUpdatedAt))
  const deadlineDays=Number.isFinite(nextDeadline)?(nextDeadline-now)/86_400_000:null
  const visitDays=Number.isFinite(upcoming)?(upcoming-now)/86_400_000:null
  return (opportunities.length?45:0)+(deadlineDays!==null&&deadlineDays<=7?deadlineDays<0?35:27:0)+(visitDays!==null&&visitDays<=14?18:0)+Math.min(17,Math.log10(openPotential+1)*3)+(latest?Math.max(0,12-(now-latest)/86_400_000/10):0)
}

function radarFingerprint(intelligence,ownerId,now){
  return createHash('sha256').update(JSON.stringify({
    day:new Date(now).toISOString().slice(0,10),ownerId:String(ownerId||'demo'),
    clients:list(intelligence?.clients).map(item=>[item.id,item.profileUpdatedAt,item.commercial?.openPotential]),
    opportunities:list(intelligence?.opportunities).map(item=>[item.id,radarClientKey(item),item.stage,item.nextActionAt||item.next_action_at,item.updatedAt||item.updated_at]),
    visits:list(intelligence?.visits).map(item=>[item.id,radarClientKey(item),item.scheduledAt||item.scheduled_at,item.status,item.updatedAt||item.updated_at])
  })).digest('hex').slice(0,20)
}

function finalAdvice(advice,rawContext,message,usedGenerativeAi=false,executionInput={}){
  const thread=prepareConversationThread(rawContext||{},message||'')
  const context=thread.context
  const effectiveMessage=thread.message
  const conversion=buildConversionIntelligence(context,effectiveMessage)
  let orchestration=buildConversationOrchestration(context,effectiveMessage,{attachmentCount:context.currentAttachments?.length||0})
  if(usedGenerativeAi){
    const reasoning=resolveStructuredReasoningRoute(orchestration,context,effectiveMessage,{providerConfigured:true})
    orchestration={...orchestration,route:{...reasoning.route,useGenerativeAi:true,mode:'structured_hybrid'}}
  }
  const reconciled=reconcileAdviceWithConversion(advice||{},conversion,{preserveSafety:true})
  const enriched=enrichAdviceWithOrchestration(reconciled,orchestration,{usedGenerativeAi})
  const merged=mergeStructuredReasoning(enriched,advice||{},context,effectiveMessage,{usedGenerativeAi})
  const normalized=normalizeAdviceForValUi(merged,conversion)
  const specific=enforceValSpecificity(normalized,context,effectiveMessage,{usedGenerativeAi,route:orchestration.route})
  const commercial=attachCommercialComposition(specific,{context,message:effectiveMessage,conversion,orchestration})
  const selectedDueAt=conversion?.selectedOpportunity?.nextActionAt||conversion?.selectedOpportunity?.next_action_at||null
  const execution=attachExecutionComposition(commercial,{context,contextSnapshot:context.contextSnapshot,organizationId:context.contextSnapshot?.organization_id,actor:executionInput.actorId?{type:'USER',id:executionInput.actorId}:null,defaultDueAt:selectedDueAt})
  return {context,thread,conversion,orchestration,advice:execution}
}

function deterministicDecision(context,effectiveMessage,originalMessage,input){
  emitProgress(input,'context')
  context.decisionIntelligence=buildDecisionIntelligence(context)
  emitProgress(input,'products')
  context.productIntelligence=buildValueBridge(context,effectiveMessage)
  const fallback=buildFallbackAdvice({
    ...context,
    message:effectiveMessage,
    mode:String(input.mode||'daily'),
    requestedStage:input.requestedStage||null
  })
  const safe=enforceValSafety(fallback,context,effectiveMessage,{requestedStage:input.requestedStage||null})
  return finalAdvice(safe,context,originalMessage,false,{actorId:input.ownerId})
}

function conversionEnvelope(resolved){
  return {
    decisionSignature:resolved.conversion.decisionSignature,
    contextFingerprint:resolved.conversion.contextFingerprint,
    score:resolved.conversion.selectedOpportunity.score,
    priority:toValUiPriority(resolved.conversion.selectedOpportunity.priority),
    workflow:resolved.conversion.workflow.code
  }
}

export function installConversionComposition(){
  if(globalThis[PATCHED])return Object.freeze({id:'conversion',version:conversionCompositionVersion,installed:false,methods:['ValRepository.getClientContext','ValRepository.getIntelligence','ValRepository.recordRecommendation','ValEngine.answer','ValEngine.status']})
  globalThis[PATCHED]=true

  const originalGetClientContext=ValRepository.prototype.getClientContext
  ValRepository.prototype.getClientContext=async function conversionAwareContext(input){
    const context=await originalGetClientContext.call(this,input)
    return {...context,conversionFoundation:buildConversionFoundation(context)}
  }

  const originalGetIntelligence=ValRepository.prototype.getIntelligence
  ValRepository.prototype.getIntelligence=async function intelligenceWithPortfolioRadar(ownerId,options={}){
    const intelligence=await originalGetIntelligence.call(this,ownerId)
    const now=Date.now()
    const fingerprint=radarFingerprint(intelligence,ownerId,now)
    const cacheKey=`${String(this.tenantId||'tenant')}:${String(ownerId||'demo')}:${fingerprint}`
    const cached=radarCache.get(cacheKey)

    const allClients=list(intelligence.clients)
    const partialContexts=allClients.map(client=>radarPartialContext(client,intelligence))
    const preliminary=buildPortfolioRadar(partialContexts,{now,maxItems:5})
    const ordered=allClients.map(client=>({client,score:radarCandidateScore(client,intelligence,now)})).sort((a,b)=>b.score-a.score||String(a.client.name||'').localeCompare(String(b.client.name||''),'pt-BR'))
    const selectedIds=new Set([...list(cached?.radar?.items||preliminary.items).map(item=>item.clientId),...ordered.slice(0,24).map(item=>String(item.client.id))])
    const selectedClients=allClients.filter(client=>selectedIds.has(String(client.id)))
    const contexts=await Promise.all(selectedClients.map(async client=>{
      try{return await originalGetClientContext.call(this,{clientId:client.id,client,ownerId,contextRequest:{objective:'portfolio_attention',actorRole:options.role||'consultant',scope:'own_portfolio'}})}
      catch{return radarPartialContext(client,intelligence)}
    }))
    const radar=cached&&cached.expiresAt>now?cached.radar:buildPortfolioRadar(contexts,{now,maxItems:5})
    radar.considered=allClients.length;radar.enriched=contexts.length;radar.policy={...radar.policy,visibility:'consultant_and_manager',portfolioWidePreselection:true}
    const finalRadar=radar.items.length?radar:preliminary
    finalRadar.considered=allClients.length
    finalRadar.enriched=contexts.length
    finalRadar.policy={...finalRadar.policy,visibility:'consultant_and_manager',portfolioWidePreselection:true}
    for(const [key,value] of radarCache)if(value.expiresAt<=now)radarCache.delete(key)
    radarCache.set(cacheKey,{expiresAt:now+RADAR_CACHE_TTL_MS,radar:finalRadar})
    const insights=buildInsightFeed({organizationId:this.tenantId,actor:{id:ownerId||'demo',role:options.role||'consultant'},contexts,radar:finalRadar,now,maxItems:5})
    observe('insights.feed.completed',{insightIds:insights.items.map(item=>item.insight_id).join(','),modulesCalled:'VIS',durationMs:0,outcome:'ok'})
    return {...intelligence,radar:finalRadar,insights}
  }

  const originalRecordRecommendation=ValRepository.prototype.recordRecommendation
  ValRepository.prototype.recordRecommendation=async function recordContextualRecommendation(input){
    const rawContext=input.context||{}
    const canonicalQuestion=String(originalQuestionContext.getStore()||input.question||'')
    const usedGenerativeAi=(input.modelRun?.status==='completed'&&input.modelRun?.generativeUsed!==false)||input.modelRun?.generativeUsed===true||/openai|gpt-/i.test(String(input.model||''))
    const resolved=finalAdvice(input.advice||{},rawContext,canonicalQuestion,usedGenerativeAi,{actorId:input.ownerId})
    const persistedAdvice=preserveEnhancedLanguage(resolved.advice,input.advice||{})
    return originalRecordRecommendation.call(this,{
      ...input,
      question:canonicalQuestion,
      context:{
        ...resolved.context,
        conversionFoundation:resolved.context.conversionFoundation||buildConversionFoundation(resolved.context),
        conversionIntelligence:resolved.conversion,
        conversationOrchestration:resolved.orchestration,
        conversationThread:resolved.thread
      },
      advice:persistedAdvice,
      modelRun:{
        ...(input.modelRun||{}),
        decisionCore:conversionCoreVersion,
        conversationOrchestrator:conversationOrchestratorVersion,
        languageEnhancer:languageEnhancerVersion,
        specificityEngine:specificityVersion,
        automaticRoute:resolved.orchestration.route,
        conversationContinued:resolved.thread.continued,
        generativeUsed:usedGenerativeAi,
        generativeRole:usedGenerativeAi?'structured_reasoning':'deterministic_fallback',
        decisionSignature:resolved.conversion.decisionSignature
      }
    })
  }

  const originalAnswer=ValEngine.prototype.answer
  ValEngine.prototype.answer=async function answerWithAutomaticOrchestration(input){
    emitProgress(input,'received')
    const originalMessage=String(input.message||'Prepare a próxima melhor ação.').trim()
    emitProgress(input,'context')
    const rawContext=await this.repository.getClientContext({
      tenantId:input.tenantId,
      ownerId:input.ownerId,
      clientId:input.clientId,
      client:input.client,
      contextRequest:{...(input.contextRequest||{}),message:originalMessage}
    })
    const thread=prepareConversationThread(rawContext,originalMessage)
    const context=thread.context
    const effectiveMessage=thread.message
    const attachmentCount=Array.isArray(input.attachmentIds)?input.attachmentIds.length:0
    let orchestration=buildConversationOrchestration(context,effectiveMessage,{attachmentCount})
    const reasoning=resolveStructuredReasoningRoute(orchestration,context,effectiveMessage,{providerConfigured:Boolean(this.client)})
    orchestration={...orchestration,route:reasoning.route}

    if(attachmentCount===0&&reasoning.useGenerativeAi){
      emitProgress(input,'products')
      emitProgress(input,'language')
      const result=await originalQuestionContext.run(originalMessage,()=>originalAnswer.call(this,{
        ...input,
        message:effectiveMessage,
        attachmentIds:[],
        mode:reasoning.tier
      }))
      emitProgress(input,'complete')
      const providerUsed=result.engineMode==='openai'
      const resolved=finalAdvice(result.advice||{},rawContext,originalMessage,providerUsed,{actorId:input.ownerId})
      return {
        ...result,
        engineMode:providerUsed?'structured_hybrid':'rules_fallback',
        engineArchitecture:providerUsed?'deterministic-facts-structured-reasoning':'deterministic-specific-fallback',
        route:resolved.orchestration.route.mode,
        warning:'',
        decisionCore:conversionCoreVersion,
        conversationOrchestrator:conversationOrchestratorVersion,
        languageEnhancer:languageEnhancerVersion,
        specificityEngine:specificityVersion,
        generativeRole:providerUsed?'structured_reasoning':'deterministic_fallback',
        automaticRouting:resolved.orchestration.route,
        conversationContinuity:resolved.orchestration.continuity,
        structuredReasoning:{requested:true,used:providerUsed,tier:reasoning.tier,status:providerUsed?'completed':'provider_fallback'},
        languageEnhancement:{status:'superseded_by_structured_reasoning',used:false,model:null,latencyMs:null,failureCode:null},
        conversionIntelligence:conversionEnvelope(resolved),
        advice:resolved.advice
      }
    }

    if(attachmentCount===0){
      const resolved=deterministicDecision(context,effectiveMessage,originalMessage,input)
      emitProgress(input,'persist')
      const model='rules-v7-specific'
      const recommendationId=await this.repository.recordRecommendation({
        tenantId:input.tenantId,
        ownerId:input.ownerId,
        clientId:input.clientId,
        question:originalMessage,
        mode:orchestration.route.intent,
        model,
        context:resolved.context,
        advice:resolved.advice,
        responseMetadata:{automaticRoute:orchestration.route.mode,conversationContinued:thread.continued,structuredReasoning:'not_requested'},
        promptHash:createHash('sha256').update(`${conversationOrchestratorVersion}:${specificityVersion}`).digest('hex'),
        modelRun:{
          model,
          promptVersion:'val-orchestrator-v3-specificity',
          status:'completed',
          generativeUsed:false,
          structuredReasoning:false,
          automaticRoute:orchestration.route,
          conversationContinued:thread.continued
        }
      })
      emitProgress(input,'complete')
      return {
        recommendationId,
        contextSnapshotId:resolved.context.contextSnapshot?.context_snapshot_id||null,
        contextSnapshotVersion:resolved.context.contextSnapshot?.contract_version||null,
        engineMode:'rules',
        engineArchitecture:'deterministic-specific-fallback',
        route:orchestration.route.mode,
        model,
        warning:'',
        contextCoverage:summarizeContextCoverage(resolved.context),
        attachments:[],
        decisionCore:conversionCoreVersion,
        conversationOrchestrator:conversationOrchestratorVersion,
        languageEnhancer:languageEnhancerVersion,
        specificityEngine:specificityVersion,
        generativeRole:'not_used_or_fallback',
        automaticRouting:resolved.orchestration.route,
        conversationContinuity:resolved.orchestration.continuity,
        structuredReasoning:{requested:reasoning.requested,used:false,tier:reasoning.tier,status:reasoning.requested?'provider_unavailable':'not_needed'},
        languageEnhancement:{status:'not_requested',used:false,model:null,latencyMs:0,failureCode:null},
        conversionIntelligence:conversionEnvelope(resolved),
        advice:resolved.advice
      }
    }

    // Arquivos e imagens continuam no fluxo multimodal completo porque precisam ser lidos pelo provedor.
    emitProgress(input,'products')
    emitProgress(input,'language')
    const result=await originalQuestionContext.run(originalMessage,()=>originalAnswer.call(this,{...input,message:effectiveMessage,mode:reasoning.tier}))
    emitProgress(input,'complete')
    const providerUsed=result.engineMode==='openai'
    const resolved=finalAdvice(result.advice||{},rawContext,originalMessage,providerUsed,{actorId:input.ownerId})
    const providerFallback=!providerUsed
    return {
      ...result,
      warning:providerFallback?'A leitura foi concluída pelo motor seguro da VAL; a camada externa não respondeu a tempo.':'',
      engineArchitecture:'deterministic-first-multimodal',
      decisionCore:conversionCoreVersion,
      conversationOrchestrator:conversationOrchestratorVersion,
      languageEnhancer:languageEnhancerVersion,
      specificityEngine:specificityVersion,
      generativeRole:providerUsed?'multimodal_structured_reasoning':'fallback_rules',
      automaticRouting:resolved.orchestration.route,
      conversationContinuity:resolved.orchestration.continuity,
      structuredReasoning:{requested:true,used:providerUsed,tier:reasoning.tier,status:providerUsed?'completed':'provider_fallback'},
      languageEnhancement:{status:providerUsed?'full_provider':'fallback',used:providerUsed,model:result.model||null,latencyMs:null,failureCode:providerFallback?'provider_fallback':null},
      conversionIntelligence:conversionEnvelope(resolved),
      advice:resolved.advice
    }
  }

  const originalStatus=ValEngine.prototype.status
  ValEngine.prototype.status=async function conversionAwareStatus(dbHealth){
    const status=await originalStatus.call(this,dbHealth)
    return {
      ...status,
      decisionCore:conversionCoreVersion,
      conversationOrchestrator:conversationOrchestratorVersion,
      languageEnhancer:languageEnhancerVersion,
      specificityEngine:specificityVersion,
      decisionMode:'deterministic_facts_structured_reasoning',
      routingMode:'automatic_hybrid',
      automaticRouting:true,
      conversationContinuity:true,
      textRequestsUseSlimLanguageEnhancer:false,
      textRequestsUseStructuredReasoning:true,
      providerFailureBlocksDecision:false,
      generativeRole:'structured_reasoning_with_deterministic_reconciliation',
      generativeSelection:'selected_per_request',
      conversionEngine:true,
      portfolioRadar:true
    }
  }

  return Object.freeze({id:'conversion',version:conversionCompositionVersion,installed:true,methods:['ValRepository.getClientContext','ValRepository.getIntelligence','ValRepository.recordRecommendation','ValEngine.answer','ValEngine.status']})
}
