import {ValEngine} from './val-engine.js'
import {ValRepository} from './repository.js'
import {buildConversionFoundation,buildConversionIntelligence,reconcileAdviceWithConversion,conversionCoreVersion} from './conversion-engine.js'
import {normalizeAdviceForValUi,toValUiPriority} from './conversion-ui-contract.js'

const PATCHED=Symbol.for('valor360.conversion-core.patched')

if(!globalThis[PATCHED]){
  globalThis[PATCHED]=true

  const originalGetClientContext=ValRepository.prototype.getClientContext
  ValRepository.prototype.getClientContext=async function conversionAwareContext(input){
    const context=await originalGetClientContext.call(this,input)
    return {...context,conversionFoundation:buildConversionFoundation(context)}
  }

  const originalRecordRecommendation=ValRepository.prototype.recordRecommendation
  ValRepository.prototype.recordRecommendation=async function recordDeterministicRecommendation(input){
    const conversion=buildConversionIntelligence(input.context||{},input.question||'')
    const advice=normalizeAdviceForValUi(
      reconcileAdviceWithConversion(input.advice||{},conversion,{preserveSafety:true}),
      conversion
    )
    return originalRecordRecommendation.call(this,{
      ...input,
      context:{
        ...(input.context||{}),
        conversionFoundation:input.context?.conversionFoundation||buildConversionFoundation(input.context||{}),
        conversionIntelligence:conversion
      },
      advice,
      modelRun:{
        ...(input.modelRun||{}),
        decisionCore:conversionCoreVersion,
        generativeRole:'language_summary_only',
        decisionSignature:conversion.decisionSignature
      }
    })
  }

  const originalAnswer=ValEngine.prototype.answer
  ValEngine.prototype.answer=async function answerWithDeterministicCore(input){
    const result=await originalAnswer.call(this,input)
    const context=await this.repository.getClientContext({
      tenantId:input.tenantId,
      ownerId:input.ownerId,
      clientId:input.clientId,
      client:input.client
    })
    const conversion=buildConversionIntelligence(context,input.message||'')
    const advice=normalizeAdviceForValUi(
      reconcileAdviceWithConversion(result.advice||{},conversion,{preserveSafety:true}),
      conversion
    )
    return {
      ...result,
      engineArchitecture:'hybrid-decision-core',
      decisionCore:conversionCoreVersion,
      generativeRole:'language_summary_only',
      conversionIntelligence:{
        decisionSignature:conversion.decisionSignature,
        contextFingerprint:conversion.contextFingerprint,
        score:conversion.selectedOpportunity.score,
        priority:toValUiPriority(conversion.selectedOpportunity.priority),
        workflow:conversion.workflow.code
      },
      advice
    }
  }

  const originalStatus=ValEngine.prototype.status
  ValEngine.prototype.status=async function conversionAwareStatus(dbHealth){
    const status=await originalStatus.call(this,dbHealth)
    return {
      ...status,
      decisionCore:conversionCoreVersion,
      decisionMode:'deterministic_first',
      generativeRole:'language_summary_only',
      conversionEngine:true
    }
  }
}
