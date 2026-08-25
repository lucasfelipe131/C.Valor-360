export const knowledgePolicyVersion='val.knowledge.selection.staging.v1'

export const knowledgeLifecycleStates=Object.freeze([
 'DRAFT',
 'UNDER_REVIEW',
 'APPROVED',
 'REJECTED',
 'SUPERSEDED',
 'EXPIRED'
])

export const sourceStatusPolicy=Object.freeze({
 APPROVED_EXTERNAL:Object.freeze({status:'APPROVED',retrieval_eligible:true,reason_code:'EXTERNAL_SOURCE_APPROVED_FOR_STAGING'})
})

export const authorityRank=Object.freeze({A:0,B:1,C:2,D:3})

const injectionPatterns=Object.freeze([
 /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|prompts?)/iu,
 /(?:reveal|print|return|exfiltrate)\s+(?:the\s+)?(?:system\s+prompt|developer\s+message|secrets?|api\s+keys?)/iu,
 /(?:act|behave)\s+as\s+(?:the\s+)?(?:system|developer|administrator)/iu,
 /(?:ignore|desconsidere|anule|sobreponha)\s+(?:todas?\s+)?(?:as\s+)?(?:instru[cç][oõ]es|regras|mensagens|pol[ií]ticas)\s+(?:anteriores?|pr[eé]vias?|acima|do\s+sistema|do\s+desenvolvedor)/iu,
 /(?:revele|mostre|imprima|retorne|exfiltre)\s+(?:o|a|os|as)?\s*(?:prompt\s+do\s+sistema|mensagem\s+do\s+desenvolvedor|segredos?|chaves?\s+(?:de\s+)?api)/iu,
 /(?:aja|atue|comporte-se)\s+como\s+(?:o|um)?\s*(?:sistema|desenvolvedor|administrador)/iu,
 /<\s*\/?(?:system|assistant|developer|tool)\b[^>]*>/iu,
 /(?:BEGIN|END)\s+(?:SYSTEM|DEVELOPER)\s+(?:MESSAGE|PROMPT)/iu
])

export function text(value){return String(value??'').trim()}
export function list(value){return Array.isArray(value)?value:[]}
export function uniqueText(values){return [...new Set(list(values).map(text).filter(Boolean))]}

export function normalizeSearchText(value){
 return text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g,' ')
  .trim()
}

export function containsPromptInjection(value){
 const values=Array.isArray(value)?value:[value]
 const candidate=values.flat(Infinity).map(text).filter(Boolean).join('\n')
 return injectionPatterns.some(pattern=>pattern.test(candidate))
}

export function mapSourceStatus(rawStatus){
 const raw=text(rawStatus).toUpperCase()
 const policy=sourceStatusPolicy[raw]
 return policy?{raw_status:raw,...policy}:{raw_status:raw||null,status:'UNDER_REVIEW',retrieval_eligible:false,reason_code:'UNMAPPED_SOURCE_STATUS'}
}

export function normalizeRisk(value){
 const risk=text(value).toUpperCase()
 return risk==='LOW'||risk==='HIGH'?risk:'UNKNOWN'
}

export function usagePolicyForRisk(value){
 const risk=normalizeRisk(value)
 if(risk==='LOW')return {usage_mode:'DECISION_SUPPORT',requires_human_review:false,retrieval_eligible:true,reason_code:'LOW_RISK_DECISION_SUPPORT'}
 if(risk==='HIGH')return {usage_mode:'GUARDRAIL_ONLY',requires_human_review:true,retrieval_eligible:true,reason_code:'HIGH_RISK_GUARDRAIL_ONLY'}
 return {usage_mode:'GUARDRAIL_ONLY',requires_human_review:true,retrieval_eligible:false,reason_code:'UNKNOWN_RISK_BLOCKED'}
}

function parsedDate(value){
 if(value==null||value==='')return {present:false,date:null,valid:true}
 const date=value instanceof Date?value:new Date(value)
 return {present:true,date,valid:!Number.isNaN(date.getTime())}
}

export function evaluateKnowledgeLifecycle(item={},now=new Date()){
 const current=now==null?new Date():now
 const evaluatedAt=current instanceof Date?current:new Date(current)
 if(Number.isNaN(evaluatedAt.getTime()))return {eligible:false,review_due:false,freshness:'INVALID',reason:'INVALID_EVALUATION_TIME',caveats:['Relógio de avaliação inválido; item bloqueado por segurança.'],evaluated_at:null}
 const validFrom=parsedDate(item.valid_from)
 const validUntil=parsedDate(item.valid_until)
 const reviewAt=parsedDate(item.review_at)
 if(!validFrom.valid||!validUntil.valid||!reviewAt.valid)return {eligible:false,review_due:false,freshness:'INVALID',reason:'INVALID_LIFECYCLE_DATE',caveats:['Metadado temporal inválido; item bloqueado até revisão.'],evaluated_at:evaluatedAt.toISOString()}
 if(validFrom.present&&validFrom.date>evaluatedAt)return {eligible:false,review_due:false,freshness:'NOT_YET_VALID',reason:'NOT_YET_VALID',caveats:[],evaluated_at:evaluatedAt.toISOString()}
 if(validUntil.present&&validUntil.date<evaluatedAt)return {eligible:false,review_due:false,freshness:'EXPIRED',reason:'EXPIRED',caveats:[],evaluated_at:evaluatedAt.toISOString()}
 const reviewDue=Boolean(reviewAt.present&&reviewAt.date<evaluatedAt)
 const metadataPresent=validFrom.present||validUntil.present||reviewAt.present
 if(reviewDue)return {eligible:true,review_due:true,freshness:'REVIEW_DUE',reason:null,caveats:['Revisão de conhecimento vencida; não tratar como evidência atual sem revisão.'],evaluated_at:evaluatedAt.toISOString()}
 if(!metadataPresent)return {eligible:true,review_due:false,freshness:'UNKNOWN',reason:null,caveats:['Validade temporal não informada; aplicar somente dentro do escopo declarado e manter revisão governada.'],evaluated_at:evaluatedAt.toISOString()}
 return {eligible:true,review_due:false,freshness:'CURRENT',reason:null,caveats:[],evaluated_at:evaluatedAt.toISOString()}
}

function geographyKind(value){
 const normalized=normalizeSearchText(value)
 if(!normalized||normalized==='general'||normalized.includes('global'))return 'GENERAL'
 if(normalized.includes('hypothesis')||normalized.includes('validacao')||normalized.includes('validate locally'))return 'LOCAL_VALIDATION'
 if(normalized.includes('brazil')||normalized.includes('brasil'))return 'BRAZIL'
 if(normalized.includes('us')||normalized.includes('united states')||normalized.includes('eua'))return 'US'
 return normalized.toUpperCase().replaceAll(' ','_')
}

export function evaluateGeography(itemScope,requestedGeography,sourceGeographies=[]){
 const requested=geographyKind(requestedGeography)
 const item=geographyKind(itemScope)
 const sourceKinds=uniqueText(sourceGeographies).map(geographyKind)
 const caveats=[]
 let match='GENERAL_SCOPE'

 if(requested==='GENERAL'){
  if(item==='LOCAL_VALIDATION'){
   match='LOCAL_VALIDATION_REQUIRED'
   caveats.push('Evidência apresentada como hipótese; valide no contexto local antes de aplicar.')
  }
 }else if(item===requested){
  match='LOCAL_SCOPE_MATCH'
 }else if(item==='GENERAL'){
  match='GENERAL_SCOPE'
 }else{
  match='EXTERNAL_EVIDENCE'
  caveats.push(`Evidência com escopo ${text(itemScope)||'não informado'}; não universalizar para ${text(requestedGeography)||'o contexto local'}.`)
 }

 if(requested!=='GENERAL'&&sourceKinds.some(kind=>kind!=='GENERAL'&&kind!==requested)){
  if(!caveats.length)caveats.push('Uma ou mais fontes são externas ao contexto solicitado; use como referência sujeita a validação local.')
  if(match==='GENERAL_SCOPE')match='EXTERNAL_SOURCE_CAVEAT'
 }

 return {match,caveats}
}

export function compareAuthority(left,right){
 return (authorityRank[text(left).toUpperCase()]??99)-(authorityRank[text(right).toUpperCase()]??99)
}
