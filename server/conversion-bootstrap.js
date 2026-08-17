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

const PATCHED=Symbol.for('valor360.conversion-core.patched')

function emitProgress(input,stage){
  try{input?.onProgress?.(stage)}catch{}
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
      conversionEngine:true
    }
  }
}
