import {createHash} from 'node:crypto'
import {ValEngine,enforceValSafety,summarizeContextCoverage} from './val-engine.js'
import {ValRepository} from './repository.js'
import {buildFallbackAdvice} from './sales-playbook.js'
import {buildDecisionIntelligence} from './decision-intelligence.js'
import {buildValueBridge} from './product-intelligence.js'
import {buildConversionFoundation,buildConversionIntelligence,reconcileAdviceWithConversion,conversionCoreVersion} from './conversion-engine.js'
import {normalizeAdviceForValUi,toValUiPriority} from './conversion-ui-contract.js'
import {buildConversationOrchestration,enrichAdviceWithOrchestration,conversationOrchestratorVersion} from './conversation-orchestrator.js'
import {prepareConversationThread} from './conversation-thread-context.js'

const PATCHED=Symbol.for('valor360.conversion-core.patched')

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
    const usedGenerativeAi=input.modelRun?.status==='completed'&&input.modelRun?.generativeUsed!==false||input.modelRun?.generativeUsed===true||/openai/i.test(String(input.model||''))
    const resolved=finalAdvice(input.advice||{},rawContext,input.question||'',usedGenerativeAi)
    return originalRecordRecommendation.call(this,{
      ...input,
      context:{
        ...resolved.context,
        conversionFoundation:resolved.context.conversionFoundation||buildConversionFoundation(resolved.context),
        conversionIntelligence:resolved.conversion,
        conversationOrchestration:resolved.orchestration,
        conversationThread:resolved.thread
      },
      advice:resolved.advice,
      modelRun:{
        ...(input.modelRun||{}),
        decisionCore:conversionCoreVersion,
        conversationOrchestrator:conversationOrchestratorVersion,
        automaticRoute:resolved.orchestration.route,
        conversationContinued:resolved.thread.continued,
        generativeUsed:usedGenerativeAi,
        generativeRole:'language_and_synthesis_only',
        decisionSignature:resolved.conversion.decisionSignature
      }
    })
  }

  const originalAnswer=ValEngine.prototype.answer
  ValEngine.prototype.answer=async function answerWithAutomaticOrchestration(input){
    const originalMessage=String(input.message||'Prepare a próxima melhor ação.').trim()
    const rawContext=await this.repository.getClientContext({
      tenantId:input.tenantId,
      ownerId:input.ownerId,
      clientId:input.clientId,
      client:input.client
    })
    const thread=prepareConversationThread(rawContext,originalMessage)
    const context=thread.context
    const effectiveMessage=thread.message
    const orchestration=buildConversationOrchestration(context,effectiveMessage,{attachmentCount:input.attachmentIds?.length||0})

    if(!orchestration.route.useGenerativeAi&&!(input.attachmentIds?.length)){
      context.decisionIntelligence=buildDecisionIntelligence(context)
      context.productIntelligence=buildValueBridge(context,effectiveMessage)
      const fallback=buildFallbackAdvice({
        ...context,
        message:effectiveMessage,
        mode:String(input.mode||'daily'),
        requestedStage:input.requestedStage||null
      })
      const safe=enforceValSafety(fallback,context,effectiveMessage,{requestedStage:input.requestedStage||null})
      const resolved=finalAdvice(safe,context,originalMessage,false)
      const model='rules-v5-orchestrated'
      const recommendationId=await this.repository.recordRecommendation({
        tenantId:input.tenantId,
        ownerId:input.ownerId,
        clientId:input.clientId,
        question:originalMessage,
        mode:orchestration.route.intent,
        model,
        context,
        advice:resolved.advice,
        responseMetadata:{automaticRoute:orchestration.route.mode,conversationContinued:thread.continued},
        promptHash:createHash('sha256').update(conversationOrchestratorVersion).digest('hex'),
        modelRun:{
          model,
          promptVersion:'val-orchestrator-v1',
          status:'completed',
          generativeUsed:false,
          automaticRoute:orchestration.route,
          conversationContinued:thread.continued
        }
      })
      return {
        recommendationId,
        engineMode:'rules',
        engineArchitecture:'automatic-hybrid-decision-core',
        route:orchestration.route.mode,
        model,
        warning:'',
        contextCoverage:summarizeContextCoverage(context),
        attachments:[],
        decisionCore:conversionCoreVersion,
        conversationOrchestrator:conversationOrchestratorVersion,
        generativeRole:'not_used_for_this_request',
        automaticRouting:orchestration.route,
        conversationContinuity:orchestration.continuity,
        conversionIntelligence:{
          decisionSignature:resolved.conversion.decisionSignature,
          contextFingerprint:resolved.conversion.contextFingerprint,
          score:resolved.conversion.selectedOpportunity.score,
          priority:toValUiPriority(resolved.conversion.selectedOpportunity.priority),
          workflow:resolved.conversion.workflow.code
        },
        advice:resolved.advice
      }
    }

    const result=await originalAnswer.call(this,input)
    const resolved=finalAdvice(result.advice||{},rawContext,originalMessage,result.engineMode==='openai')
    return {
      ...result,
      engineArchitecture:'automatic-hybrid-decision-core',
      decisionCore:conversionCoreVersion,
      conversationOrchestrator:conversationOrchestratorVersion,
      generativeRole:result.engineMode==='openai'?'language_and_synthesis_only':'fallback_rules',
      automaticRouting:resolved.orchestration.route,
      conversationContinuity:resolved.orchestration.continuity,
      conversionIntelligence:{
        decisionSignature:resolved.conversion.decisionSignature,
        contextFingerprint:resolved.conversion.contextFingerprint,
        score:resolved.conversion.selectedOpportunity.score,
        priority:toValUiPriority(resolved.conversion.selectedOpportunity.priority),
        workflow:resolved.conversion.workflow.code
      },
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
      decisionMode:'automatic_hybrid',
      automaticRouting:true,
      conversationContinuity:true,
      generativeRole:'selected_per_request',
      conversionEngine:true
    }
  }
}
