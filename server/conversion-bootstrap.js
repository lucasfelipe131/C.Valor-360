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
import {enhanceDecisionLanguage,languageEnhancerVersion,preserveEnhancedLanguage} from './language-enhancer.js'
import {buildPortfolioRadar} from './portfolio-radar.js'

const PATCHED=Symbol.for('valor360.conversion-core.patched')
const RADAR_CACHE_TTL_MS=10*60_000
const radarCache=new Map()
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

function finalAdvice(advice,rawContext,message,usedGenerativeAi=false){
  const thread=prepareConversationThread(rawContext||{},message||'')
  const context=thread.context
  const effectiveMessage=thread.message
  const conversion=buildConversionIntelligence(context,effectiveMessage)
  const orchestration=buildConversationOrchestration(context,effectiveMessage,{attachmentCount:context.currentAttachments?.length||0})
  const reconciled=reconcileAdviceWithConversion(advice||{},conversion,{preserveSafety:true})
  const enriched=enrichAdviceWithOrchestration(reconciled,orchestration,{usedGenerativeAi})
  return {
    context,
    thread,
    conversion,
    orchestration,
    advice:normalizeAdviceForValUi(enriched,conversion)
  }
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
  return finalAdvice(safe,context,originalMessage,false)
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

if(!globalThis[PATCHED]){
  globalThis[PATCHED]=true

  const originalGetClientContext=ValRepository.prototype.getClientContext
  ValRepository.prototype.getClientContext=async function conversionAwareContext(input){
    const context=await originalGetClientContext.call(this,input)
    return {...context,conversionFoundation:buildConversionFoundation(context)}
  }

  const originalGetIntelligence=ValRepository.prototype.getIntelligence
  ValRepository.prototype.getIntelligence=async function intelligenceWithPortfolioRadar(ownerId){
    const intelligence=await originalGetIntelligence.call(this,ownerId)
    const now=Date.now()
    const fingerprint=radarFingerprint(intelligence,ownerId,now)
    const cacheKey=`${String(ownerId||'demo')}:${fingerprint}`
    const cached=radarCache.get(cacheKey)
    if(cached&&cached.expiresAt>now)return {...intelligence,radar:cached.radar}

    const allClients=list(intelligence.clients)
    const partialContexts=allClients.map(client=>radarPartialContext(client,intelligence))
    const preliminary=buildPortfolioRadar(partialContexts,{now,maxItems:5})
    const ordered=allClients.map(client=>({client,score:radarCandidateScore(client,intelligence,now)})).sort((a,b)=>b.score-a.score||String(a.client.name||'').localeCompare(String(b.client.name||''),'pt-BR'))
    const selectedIds=new Set([...list(preliminary.items).map(item=>item.clientId),...ordered.slice(0,24).map(item=>String(item.client.id))])
    const selectedClients=allClients.filter(client=>selectedIds.has(String(client.id)))
    const contexts=await Promise.all(selectedClients.map(async client=>{
      try{return await originalGetClientContext.call(this,{clientId:client.id,client,ownerId})}
      catch{return radarPartialContext(client,intelligence)}
    }))
    const radar=buildPortfolioRadar(contexts,{now,maxItems:5})
    radar.considered=allClients.length
    radar.enriched=contexts.length
    radar.policy={...radar.policy,visibility:'consultant_and_manager',portfolioWidePreselection:true}
    const finalRadar=radar.items.length?radar:preliminary
    finalRadar.considered=allClients.length
    finalRadar.enriched=contexts.length
    finalRadar.policy={...finalRadar.policy,visibility:'consultant_and_manager',portfolioWidePreselection:true}
    for(const [key,value] of radarCache)if(value.expiresAt<=now)radarCache.delete(key)
    radarCache.set(cacheKey,{expiresAt:now+RADAR_CACHE_TTL_MS,radar:finalRadar})
    return {...intelligence,radar:finalRadar}
  }

  const originalRecordRecommendation=ValRepository.prototype.recordRecommendation
  ValRepository.prototype.recordRecommendation=async function recordDeterministicRecommendation(input){
    const rawContext=input.context||{}
    const usedGenerativeAi=(input.modelRun?.status==='completed'&&input.modelRun?.generativeUsed!==false)||input.modelRun?.generativeUsed===true||/openai|gpt-/i.test(String(input.model||''))
    const resolved=finalAdvice(input.advice||{},rawContext,input.question||'',usedGenerativeAi)
    const persistedAdvice=preserveEnhancedLanguage(resolved.advice,input.advice||{})
    return originalRecordRecommendation.call(this,{
      ...input,
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
        automaticRoute:resolved.orchestration.route,
        conversationContinued:resolved.thread.continued,
        generativeUsed:usedGenerativeAi,
        generativeRole:'language_only',
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
      client:input.client
    })
    const thread=prepareConversationThread(rawContext,originalMessage)
    const context=thread.context
    const effectiveMessage=thread.message
    const attachmentCount=Array.isArray(input.attachmentIds)?input.attachmentIds.length:0
    const orchestration=buildConversationOrchestration(context,effectiveMessage,{attachmentCount})

    // Conversas de texto sempre nascem do motor determinístico. Quando a rota pede IA,
    // ela recebe apenas um contrato pequeno de linguagem e nunca bloqueia a decisão.
    if(attachmentCount===0){
      const resolved=deterministicDecision(context,effectiveMessage,originalMessage,input)
      emitProgress(input,'language')
      const language=orchestration.route.useGenerativeAi
        ?await enhanceDecisionLanguage({
          client:this.client,
          config:this.config,
          context:resolved.context,
          message:effectiveMessage,
          advice:resolved.advice,
          orchestration:resolved.orchestration,
          signal:input.signal
        })
        :{
          advice:resolved.advice,
          used:false,
          status:'not_requested',
          model:'rules-v6-orchestrated',
          latencyMs:0
        }
      const model=language.used?`${language.model}+rules-v6`:'rules-v6-orchestrated'
      emitProgress(input,'persist')
      const recommendationId=await this.repository.recordRecommendation({
        tenantId:input.tenantId,
        ownerId:input.ownerId,
        clientId:input.clientId,
        question:originalMessage,
        mode:orchestration.route.intent,
        model,
        context:resolved.context,
        advice:language.advice,
        responseMetadata:{
          automaticRoute:orchestration.route.mode,
          conversationContinued:thread.continued,
          languageEnhancement:language.status,
          languageLatencyMs:language.latencyMs,
          languageFailureCode:language.failureCode||null
        },
        promptHash:createHash('sha256').update(`${conversationOrchestratorVersion}:${languageEnhancerVersion}`).digest('hex'),
        modelRun:{
          model,
          promptVersion:'val-orchestrator-v2-language-only',
          status:'completed',
          generativeUsed:language.used,
          languageEnhanced:language.used,
          languageStatus:language.status,
          languageLatencyMs:language.latencyMs,
          languageFailureCode:language.failureCode||null,
          automaticRoute:orchestration.route,
          conversationContinued:thread.continued
        }
      })
      emitProgress(input,'complete')
      return {
        recommendationId,
        engineMode:language.used?'hybrid':'rules',
        engineArchitecture:'deterministic-first-language-optional',
        route:orchestration.route.mode,
        model,
        warning:'',
        contextCoverage:summarizeContextCoverage(resolved.context),
        attachments:[],
        decisionCore:conversionCoreVersion,
        conversationOrchestrator:conversationOrchestratorVersion,
        languageEnhancer:languageEnhancerVersion,
        generativeRole:language.used?'language_only':'not_used_or_fallback',
        automaticRouting:resolved.orchestration.route,
        conversationContinuity:resolved.orchestration.continuity,
        languageEnhancement:{
          status:language.status,
          used:language.used,
          model:language.model,
          latencyMs:language.latencyMs,
          failureCode:language.failureCode||null
        },
        conversionIntelligence:conversionEnvelope(resolved),
        advice:language.advice
      }
    }

    // Arquivos e imagens continuam no fluxo multimodal completo porque precisam ser lidos pelo provedor.
    emitProgress(input,'products')
    emitProgress(input,'language')
    const result=await originalAnswer.call(this,input)
    emitProgress(input,'complete')
    const resolved=finalAdvice(result.advice||{},rawContext,originalMessage,result.engineMode==='openai')
    const providerFallback=result.engineMode!=='openai'
    return {
      ...result,
      warning:providerFallback?'A leitura foi concluída pelo motor seguro da VAL; a camada externa de linguagem não respondeu a tempo.':'',
      engineArchitecture:'deterministic-first-multimodal',
      decisionCore:conversionCoreVersion,
      conversationOrchestrator:conversationOrchestratorVersion,
      languageEnhancer:languageEnhancerVersion,
      generativeRole:result.engineMode==='openai'?'multimodal_language_and_reading':'fallback_rules',
      automaticRouting:resolved.orchestration.route,
      conversationContinuity:resolved.orchestration.continuity,
      languageEnhancement:{status:result.engineMode==='openai'?'full_provider':'fallback',used:result.engineMode==='openai',model:result.model||null,latencyMs:null,failureCode:providerFallback?'provider_fallback':null},
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
      decisionMode:'deterministic_first',
      routingMode:'automatic_hybrid',
      automaticRouting:true,
      conversationContinuity:true,
      textRequestsUseSlimLanguageEnhancer:true,
      providerFailureBlocksDecision:false,
      generativeRole:'language_only',
      generativeSelection:'selected_per_request',
      conversionEngine:true,
      portfolioRadar:true
    }
  }
}
