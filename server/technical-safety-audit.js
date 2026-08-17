const TECHNICAL_REASON=/\b(?:agron[oô]mic|t[eé]cnic|diagn[oó]stic|produto|dose|dosagem|mistura|aplica[cç][aã]o|receita|defensivo|fungicida|herbicida|inseticida|aduba[cç][aã]o|calagem|talh[aã]o|cultura|ndvi|solo)\b/i
const ROLES=new Set(['none','consultant','manager','technical_reviewer'])
const text=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)

export function normalizeProviderHumanReview(value){
  if(!value||typeof value!=='object')return {observed:false,required:false,reason:'',requiredRole:'none',technicalSignal:false,contractMismatch:false}
  const required=value.required===true
  const requiredRole=ROLES.has(value.required_role)?value.required_role:'none'
  const reason=text(value.reason)
  const technicalSignal=requiredRole==='technical_reviewer'||TECHNICAL_REASON.test(reason)
  const contractMismatch=(required&&requiredRole==='none')||(!required&&requiredRole!=='none')
  return {observed:true,required,reason,requiredRole,technicalSignal,technicalReview:required&&technicalSignal,contractMismatch}
}

export function buildTechnicalSafetyAudit({
  requestRequiresReview=false,
  outputRequiresReview=false,
  signalRequiresReview=false,
  productRequiresReview=false,
  providerHumanReview=null,
  at=new Date()
}={}){
  const provider=normalizeProviderHumanReview(providerHumanReview)
  const deterministic={
    request:Boolean(requestRequiresReview),
    output:Boolean(outputRequiresReview),
    contextSignal:Boolean(signalRequiresReview),
    productComparison:Boolean(productRequiresReview)
  }
  const deterministicReview=Object.values(deterministic).some(Boolean)
  const providerTechnicalReview=provider.technicalReview
  const providerTechnicalMismatch=provider.contractMismatch&&provider.technicalSignal
  const technicalReviewRequired=deterministicReview||providerTechnicalReview||providerTechnicalMismatch
  const manualReviewRequired=technicalReviewRequired||provider.required||provider.contractMismatch
  let status='aligned_clear'
  let divergence=false
  if(!provider.observed)status=deterministicReview?'deterministic_without_provider':'clear_without_provider'
  else if(provider.contractMismatch){status='provider_contract_mismatch';divergence=true}
  else if(deterministicReview&&!providerTechnicalReview){status='deterministic_override';divergence=true}
  else if(!deterministicReview&&providerTechnicalReview){status='provider_only_review';divergence=true}
  else if(deterministicReview&&providerTechnicalReview)status='aligned_review'
  const hardBlockRequired=deterministic.request||deterministic.output||status==='provider_only_review'||providerTechnicalMismatch
  const reviewRole=technicalReviewRequired?'technical_reviewer':provider.required&&provider.requiredRole!=='none'?provider.requiredRole:manualReviewRequired?'manager':'none'
  const date=at instanceof Date?at:new Date(at||Date.now())
  return {
    version:'val-technical-safety-v1',
    at:Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString(),
    status,
    divergence,
    hardBlockRequired,
    manualReviewRequired,
    technicalReviewRequired,
    reviewRole,
    deterministic,
    provider:{
      observed:provider.observed,
      required:provider.required,
      requiredRole:provider.requiredRole,
      technicalSignal:provider.technicalSignal,
      contractMismatch:provider.contractMismatch
    }
  }
}

export function technicalSafetyReason(audit,{signalRequiresReview=false,productRequiresReview=false,providerReason=''}={}){
  if(audit?.status==='deterministic_override')return 'A barreira determinística identificou necessidade de revisão técnica, embora o modelo não a tenha solicitado. A divergência foi encaminhada para revisão manual antes de qualquer uso técnico.'
  if(audit?.status==='provider_only_review')return 'O modelo solicitou revisão técnica que a barreira determinística não confirmou. Por segurança, a orientação foi retida e a divergência deve ser revisada manualmente.'
  if(audit?.status==='provider_contract_mismatch')return 'O modelo devolveu campos de revisão humana inconsistentes. A saída foi encaminhada para revisão manual antes de qualquer uso.'
  if(productRequiresReview)return 'A VAL encontrou candidatas para comparação comercial. Similaridade cadastral não prova equivalência, adequação ou superioridade; valide fonte vigente e decisão técnica antes de recomendar ou executar.'
  if(signalRequiresReview)return 'Há sinais técnicos no contexto que podem orientar a prioridade comercial, mas qualquer interpretação agronômica ou recomendação de execução continua sujeita ao responsável técnico.'
  if(audit?.technicalReviewRequired)return text(providerReason)||'A revisão por responsável técnico é obrigatória antes de usar esta orientação.'
  if(audit?.manualReviewRequired)return text(providerReason)||'A recomendação precisa de revisão humana antes de ser utilizada.'
  return 'Nenhuma revisão humana adicional foi sinalizada.'
}
