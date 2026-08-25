import {createHash} from 'node:crypto'
import {goldenQuestionQualityVersion,valResponseQualityVersion} from './contracts.js'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,20_000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const unique=values=>[...new Set(values.map(value=>clean(value,280)).filter(Boolean))]
const generic=/\b(?:entenda as necessidades|fa[cç]a uma abordagem consultiva|apresente os benef[ií]cios|avalie o cen[aá]rio|verifique se existe necessidade em outras categorias|busque mais informa[cç][oõ]es|adapte a abordagem)\b/i
const genericQuestion=/\b(?:o que voce acha|pode explicar melhor|qual sua necessidade|como posso ajudar)\b/i
const openQuestion=/^(?:qual|quais|como|o que|quem|onde|quanto|quando|por que)\b/i

const questionTokens=value=>new Set(normalize(value).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(token=>token.length>=3&&!['que','para','com','uma','das','dos','ela','ele','isso','esta','este','sobre'].includes(token)))

export function questionSimilarity(left,right){
 const a=questionTokens(left);const b=questionTokens(right)
 if(!a.size||!b.size)return 0
 const intersection=[...a].filter(token=>b.has(token)).length
 const union=new Set([...a,...b]).size
 return Number((intersection/Math.max(1,union)).toFixed(2))
}

function materialAnchors(result={},context={}){
 const client=context.client||{}
 const opportunity=list(context.opportunities)[0]||{}
 const evidence=list(result.facts_used)
 return unique([
  client.name,client.municipality,client.cultures,client.primaryProfile,client.decisionDriver,client.technicalPresentation,
  opportunity.title,opportunity.category,opportunity.stage,
  ...evidence.flatMap(item=>[item.statement,item.source_type]),
  ...list(result.knowledge_refs).map(item=>item.title||item.id),
  ...list(result.memory_refs).map(item=>item.key||item.id)
 ]).filter(item=>normalize(item).length>=4)
}

function responseCorpus(result={}){
 return clean([
  result.situation_summary,result.decision_thesis?.CURRENT_SITUATION,result.decision_thesis?.WHAT_MATTERS,
  result.decision_thesis?.KEY_UNCERTAINTY,result.decision_thesis?.THESIS,result.decision_thesis?.WHY,
  result.recommended_strategy?.reading,result.recommended_strategy?.action,result.next_commitment,
  ...list(result.golden_questions).map(item=>item.question)
 ].join(' '),20_000)
}

export function runNameSwapTest(result={},context={}){
 const corpus=normalize(responseCorpus(result))
 const name=clean(context.client?.name)
 const nonNameAnchors=materialAnchors(result,context).filter(item=>normalize(item)!==normalize(name))
 const matched=nonNameAnchors.filter(item=>{
  const tokens=normalize(item).split(' ').filter(token=>token.length>=5)
  return tokens.some(token=>corpus.includes(token))
 })
 const contextualFingerprint=createHash('sha256').update(unique([context.client?.id,...matched]).join('|')).digest('hex').slice(0,20)
 return {name:'NAME_SWAP_TEST',passed:matched.length>=2&&Boolean(name?corpus.includes(normalize(name).split(' ')[0]):true),matched_anchors:matched.slice(0,8),fingerprint:contextualFingerprint}
}

export function runContextRemovalTest(result={},context={}){
 const sourceTypes=new Set(list(result.facts_used).map(item=>clean(item.source_type)).filter(Boolean))
 const refs=unique([...list(result.evidence_to_use).map(item=>item.id),...list(result.memory_refs).map(item=>item.id),...list(result.knowledge_refs).map(item=>item.id)])
 const material=materialAnchors(result,context)
 const dependencyScore=Math.min(1,(sourceTypes.size*.24)+(refs.length*.08)+(material.length*.06))
 return {name:'CONTEXT_REMOVAL_TEST',passed:dependencyScore>=.5&&refs.length>=2,dependency_score:Number(dependencyScore.toFixed(2)),distinct_source_types:sourceTypes.size,reference_count:refs.length}
}

export function evaluateGoldenQuestions(questions=[]){
 const previous=[]
 const items=list(questions).slice(0,3).map(item=>{
  const question=clean(item?.question)
  const contextRefs=unique(item?.context_refs||[])
  const highestSimilarity=previous.length?Math.max(...previous.map(prior=>questionSimilarity(prior,question))):0
  const dimensions={specificity:question.length>=28&&!genericQuestion.test(question)?1:.25,openness:openQuestion.test(normalize(question))?1:.35,novelty:highestSimilarity<.68?1:.15,decision_impact:clean(item?.decision_impact).length>=12?1:.3,context_grounding:contextRefs.length?1:.2}
  previous.push(question)
  const score=Object.values(dimensions).reduce((sum,value)=>sum+value,0)/Object.keys(dimensions).length
  return {...item,question,context_refs:contextRefs,quality_score:Number(score.toFixed(2)),dimensions,highest_similarity:highestSimilarity,passed:score>=.75&&dimensions.novelty===1}
 })
 return {version:goldenQuestionQualityVersion,items,passed:items.length>0&&items.every(item=>item.passed)}
}

export function evaluateValResponseQuality(result={},context={}){
 const nameSwap=runNameSwapTest(result,context)
 const contextRemoval=runContextRemovalTest(result,context)
 const questions=evaluateGoldenQuestions(result.golden_questions)
 const facts=list(result.facts_used);const sourceTypes=new Set(facts.map(item=>normalize(item.source_type)))
 const hasHistory=list(context.priorRecommendations).length+list(context.visits).length+list(context.interactions).length>0
 const historyMatches=[...sourceTypes].filter(type=>/visit|interaction|history|recommendation|opportun|voice|memory/.test(type)).length
 const knowledgeAvailable=list(context.knowledgeSelection?.items||context.knowledgeSelection||context.knowledge).length
 const agronomicSources=Object.values(result.agronomic_context?.sources||{}).reduce((sum,value)=>sum+Number(value||0),0)
 const dimensions={
  specificity:nameSwap.passed?1:.35,
  context_usage:contextRemoval.dependency_score,
  history_usage:hasHistory?Math.min(1,.45+(historyMatches*.25)):.85,
  question_quality:questions.items.length?questions.items.reduce((sum,item)=>sum+item.quality_score,0)/questions.items.length:.2,
  decision_relevance:clean(result.decision_thesis?.THESIS).length>=25&&clean(result.decision_thesis?.WHAT_MATTERS).length>=25?.95:.35,
  agronomic_relevance:result.agronomic_context?.status==='not_applicable'?.9:result.agronomic_context?.human_review_required===true?1:Math.min(1,.55+(agronomicSources*.08)),
  commercial_relevance:(clean(result.commercial_context?.profile_strategy||result.commercial_context?.adaptation).length>=15||list(context.opportunities).length>0)?0.9:0.4,
  knowledge_usage:knowledgeAvailable?Math.min(1,.4+(list(result.knowledge_refs).length*.25)):.85,
  actionability:clean(result.recommended_strategy?.action).length>=25&&clean(result.next_commitment).length>=20?.95:.35,
  clarity:responseCorpus(result).length<=6500&&clean(result.situation_summary).length<=1800?.9:.55,
  non_generic_language:generic.test(responseCorpus(result))?.15:.95,
  confidence_calibration:(Number.isFinite(Number(result.confidence?.score))&&clean(result.confidence?.rationale).length>=20&&(list(result.missing_information).length>0||clean(result.decision_thesis?.KEY_UNCERTAINTY).length>0))?0.95:0.4
 }
 const overall=Object.values(dimensions).reduce((sum,value)=>sum+Number(value||0),0)/Object.keys(dimensions).length
 const passed=nameSwap.passed&&contextRemoval.passed&&questions.passed&&overall>=.72
 return {version:valResponseQualityVersion,status:passed?'PASSED':'RECOMPOSITION_REQUIRED',passed,threshold:.72,overall:Number(overall.toFixed(2)),dimensions:Object.fromEntries(Object.entries(dimensions).map(([key,value])=>[key,Number(value.toFixed(2))])),automatic_tests:{name_swap:nameSwap,context_removal:contextRemoval,golden_questions:questions}}
}
