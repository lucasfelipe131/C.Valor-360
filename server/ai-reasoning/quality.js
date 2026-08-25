import {createHash} from 'node:crypto'
import {goldenQuestionQualityVersion,valResponseQualityVersion} from './contracts.js'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,20_000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const unique=values=>[...new Set(values.map(value=>clean(value,280)).filter(Boolean))]
const generic=/\b(?:entenda as necessidades|fa[cç]a uma abordagem consultiva|apresente os benef[ií]cios|avalie o cen[aá]rio|verifique se existe necessidade em outras categorias|busque mais informa[cç][oõ]es|adapte a abordagem)\b/i

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
 const items=list(questions).slice(0,3).map(item=>{
  const question=clean(item?.question)
  const contextRefs=unique(item?.context_refs||[])
  const score=[question.endsWith('?'),clean(item?.unknown),clean(item?.decision_impact),contextRefs.length].filter(Boolean).length/4
  return {...item,question,context_refs:contextRefs,quality_score:Number(score.toFixed(2)),passed:score>=.75}
 })
 return {version:goldenQuestionQualityVersion,items,passed:items.length>0&&items.every(item=>item.passed)}
}

export function evaluateValResponseQuality(result={},context={}){
 const nameSwap=runNameSwapTest(result,context)
 const contextRemoval=runContextRemovalTest(result,context)
 const questions=evaluateGoldenQuestions(result.golden_questions)
 const facts=list(result.facts_used)
 const dimensions={
  specificity:nameSwap.passed?1:.35,
  context_grounding:contextRemoval.dependency_score,
  evidence_traceability:Math.min(1,list(result.evidence_to_use).length/3),
  uncertainty_honesty:list(result.missing_information).length||clean(result.decision_thesis?.KEY_UNCERTAINTY)?.length?1:.4,
  decision_usefulness:clean(result.recommended_strategy?.action).length>=25?.95:.35,
  question_quality:questions.items.length?questions.items.reduce((sum,item)=>sum+item.quality_score,0)/questions.items.length:.2,
  profile_adaptation:clean(result.commercial_context?.profile_strategy||result.commercial_context?.adaptation).length>=15?.9:.4,
  agronomic_safety:(result.agronomic_context?.human_review_required===true||result.agronomic_context?.status==='not_applicable')?0.95:0.8,
  concision:responseCorpus(result).length<=6500?.9:.55,
  non_generic:generic.test(responseCorpus(result))?.15:.95
 }
 const overall=Object.values(dimensions).reduce((sum,value)=>sum+Number(value||0),0)/Object.keys(dimensions).length
 const passed=nameSwap.passed&&contextRemoval.passed&&questions.passed&&overall>=.72
 return {version:valResponseQualityVersion,status:passed?'PASSED':'RECOMPOSITION_REQUIRED',passed,threshold:.72,overall:Number(overall.toFixed(2)),dimensions:Object.fromEntries(Object.entries(dimensions).map(([key,value])=>[key,Number(value.toFixed(2))])),automatic_tests:{name_swap:nameSwap,context_removal:contextRemoval,golden_questions:questions}}
}
