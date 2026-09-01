import {readFileSync} from 'node:fs'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {knowledgeItemVersion,knowledgeSourceVersion,validateKnowledgeItem,validateKnowledgeSource} from './contracts.js'
import {authorityRank,containsPromptInjection,knowledgePolicyVersion,mapSourceStatus,normalizeRisk,text,uniqueText,usagePolicyForRisk} from './policy.js'

const defaultDirectory=new URL('../../knowledge/library/v1/',import.meta.url)
const defaultExpectedCounts=Object.freeze({knowledge_items:122,sources:40,scenarios:30})
let defaultCache=null

function directoryUrl(value){
 if(value instanceof URL)return value
 if(!value)return defaultDirectory
 return pathToFileURL(`${resolve(String(value))}/`)
}

function readJson(url){return JSON.parse(readFileSync(url,'utf8'))}

function readJsonl(url,label){
 const source=readFileSync(url,'utf8')
 const rows=[]
 for(const [index,line] of source.split(/\r?\n/).entries()){
  if(!line.trim())continue
  try{rows.push(JSON.parse(line))}
  catch{throw Object.assign(new Error(`${label} contém JSON inválido na linha ${index+1}.`),{name:'KnowledgeLibraryError',code:'knowledge_library_jsonl_invalid',file:label,line:index+1})}
 }
 return rows
}

function nullableText(value){
 if(value==null)return null
 const normalized=text(value)
 return normalized||null
}

function deepFreeze(value){
 if(!value||typeof value!=='object'||Object.isFrozen(value))return value
 for(const nested of Object.values(value))deepFreeze(nested)
 return Object.freeze(value)
}

function normalizeSource(source){
 return {
  contract_version:knowledgeSourceVersion,
  source_id:text(source.source_id),
  title:text(source.title),
  publisher:text(source.publisher),
  year:Number.isInteger(source.year)?source.year:null,
  url:nullableText(source.url),
  authority:text(source.authority).toUpperCase(),
  geography:text(source.geography),
  domain:text(source.domain),
  notes:nullableText(source.notes)
 }
}

function normalizeItem(item,{libraryVersion}){
 const lifecycle=mapSourceStatus(item.status)
 const risk=normalizeRisk(item.risk_class)
 const usage=usagePolicyForRisk(risk)
 const sourceRefs=uniqueText(item.source_ids)
 const promptFields=[item.title,item.principle,item.val_application,item.triggers,item.recommended_actions,item.avoid]
 const promptSafe=!containsPromptInjection(promptFields)
 const freshnessMetadataPresent=[item.valid_from,item.valid_until,item.review_at].some(value=>value!=null&&text(value))
 return {
  contract_version:knowledgeItemVersion,
  knowledge_item_id:text(item.item_id),
  title:text(item.title),
  domain:text(item.domain),
  type:nullableText(item.type),
  statement:text(item.principle),
  application_val:text(item.val_application),
  triggers:uniqueText(item.triggers),
  recommended_actions:uniqueText(item.recommended_actions),
  avoid:uniqueText(item.avoid),
  module_targets:uniqueText(item.modules).map(value=>value.toUpperCase()),
  source_refs:sourceRefs,
  authority:text(item.evidence_level).toUpperCase(),
  risk,
  geographic_scope:text(item.geography_scope),
  status:lifecycle.status,
  raw_status:lifecycle.raw_status,
  version:text(libraryVersion),
  valid_from:nullableText(item.valid_from),
  valid_until:nullableText(item.valid_until),
  review_at:nullableText(item.review_at),
  owner:nullableText(item.owner),
  supersedes_id:nullableText(item.supersedes_id),
  created_at:nullableText(item.created_at),
  updated_at:nullableText(item.updated_at),
  review_cycle_days:Number.isInteger(item.review_cycle_days)?item.review_cycle_days:null,
  usage_mode:usage.usage_mode,
  requires_human_review:usage.requires_human_review,
  retrieval_eligible:lifecycle.retrieval_eligible&&usage.retrieval_eligible&&promptSafe,
  governance_reason_codes:[lifecycle.reason_code,usage.reason_code,promptSafe?'PROMPT_SAFE':'PROMPT_INJECTION_BLOCKED',freshnessMetadataPresent?'FRESHNESS_METADATA_DECLARED':'FRESHNESS_METADATA_ABSENT'],
  prompt_safety:promptSafe?'SAFE':'BLOCKED'
 }
}

function normalizeScenario(scenario){
 return {
  scenario_id:text(scenario.scenario_id),
  title:text(scenario.title),
  profile:nullableText(scenario.profile),
  commercial_stage:nullableText(scenario.commercial_stage),
  context:text(scenario.context),
  expected_behavior:uniqueText(scenario.expected_behavior),
  forbidden_patterns:uniqueText(scenario.forbidden_patterns),
  modules:uniqueText(scenario.modules).map(value=>value.toUpperCase()),
  source_refs:uniqueText(scenario.source_ids),
  status:text(scenario.status)
 }
}

function duplicateIds(rows,key){
 const seen=new Set()
 const duplicates=new Set()
 for(const row of rows){
  const id=text(row[key])
  if(seen.has(id))duplicates.add(id)
  seen.add(id)
 }
 return [...duplicates].sort()
}

function validateLibrary({manifest,items,sources,scenarios,rawItems,expectedCounts}){
 const errors=[]
 const warnings=[]
 const sourceIds=new Set(sources.map(source=>source.source_id))
 const sourceById=new Map(sources.map(source=>[source.source_id,source]))
 const actualCounts={knowledge_items:items.length,sources:sources.length,scenarios:scenarios.length}

 for(const key of Object.keys(actualCounts)){
  if(Number(manifest.counts?.[key])!==actualCounts[key])errors.push({code:'MANIFEST_COUNT_MISMATCH',field:key,expected:manifest.counts?.[key]??null,actual:actualCounts[key]})
  if(expectedCounts&&Number(expectedCounts[key])!==actualCounts[key])errors.push({code:'LIBRARY_COUNT_MISMATCH',field:key,expected:Number(expectedCounts[key]),actual:actualCounts[key]})
 }

 for(const id of duplicateIds(items,'knowledge_item_id'))errors.push({code:'DUPLICATE_KNOWLEDGE_ITEM_ID',ref:id})
 for(const id of duplicateIds(sources,'source_id'))errors.push({code:'DUPLICATE_SOURCE_ID',ref:id})
 for(const id of duplicateIds(scenarios,'scenario_id'))errors.push({code:'DUPLICATE_SCENARIO_ID',ref:id})

 for(const source of sources){
  for(const field of validateKnowledgeSource(source))errors.push({code:'INVALID_SOURCE',ref:source.source_id||null,field})
 }

 for(const [index,item] of items.entries()){
  for(const field of validateKnowledgeItem(item))errors.push({code:'INVALID_KNOWLEDGE_ITEM',ref:item.knowledge_item_id||null,field})
  const missing=item.source_refs.filter(ref=>!sourceIds.has(ref))
  for(const ref of missing)errors.push({code:'UNKNOWN_SOURCE_REF',ref:item.knowledge_item_id,source_ref:ref})
  if(!item.source_refs.length)errors.push({code:'SOURCE_REF_REQUIRED',ref:item.knowledge_item_id})
  const rawRefs=Array.isArray(rawItems[index]?.source_ids)?rawItems[index].source_ids.map(text).filter(Boolean):[]
  if(rawRefs.length!==new Set(rawRefs).size)warnings.push({code:'DUPLICATE_SOURCE_REF_REMOVED',ref:item.knowledge_item_id})
  if(item.prompt_safety==='BLOCKED')warnings.push({code:'PROMPT_INJECTION_BLOCKED',ref:item.knowledge_item_id})
  const sourceRanks=item.source_refs.map(ref=>authorityRank[sourceById.get(ref)?.authority]).filter(Number.isInteger)
  const itemRank=authorityRank[item.authority]
  if(sourceRanks.length&&Number.isInteger(itemRank)&&itemRank<Math.min(...sourceRanks))errors.push({code:'AUTHORITY_EXCEEDS_SOURCES',ref:item.knowledge_item_id})
 }

 for(const scenario of scenarios){
  if(!scenario.scenario_id||!scenario.title||!scenario.context)errors.push({code:'INVALID_SCENARIO',ref:scenario.scenario_id||null})
  for(const ref of scenario.source_refs)if(!sourceIds.has(ref))errors.push({code:'UNKNOWN_SCENARIO_SOURCE_REF',ref:scenario.scenario_id,source_ref:ref})
 }

 return {valid:errors.length===0,counts:actualCounts,errors,warnings}
}

export function loadKnowledgeLibrary(options={}){
 const usingDefault=!options.directory
 if(usingDefault&&!options.forceReload&&defaultCache)return defaultCache
 const directory=directoryUrl(options.directory)
 const manifest=readJson(new URL('ingestion_manifest.json',directory))
 const rawItems=readJsonl(new URL('knowledge_items.jsonl',directory),'knowledge_items.jsonl')
 const rawSources=readJson(new URL('source_registry.json',directory))
 const rawScenarios=readJsonl(new URL('scenario_bank.jsonl',directory),'scenario_bank.jsonl')
 const sources=rawSources.map(normalizeSource)
 const items=rawItems.map(item=>normalizeItem(item,{libraryVersion:manifest.version}))
 const scenarios=rawScenarios.map(normalizeScenario)
 const expectedCounts=options.expectedCounts===false?null:(options.expectedCounts||defaultExpectedCounts)
 const validation=validateLibrary({manifest,items,sources,scenarios,rawItems,expectedCounts})
 if(!validation.valid&&options.strict!==false){
  throw Object.assign(new Error('Biblioteca de conhecimento inválida.'),{name:'KnowledgeLibraryError',code:'knowledge_library_invalid',validation})
 }
 const library=deepFreeze({
  policy_version:knowledgePolicyVersion,
  library_name:text(manifest.library_name),
  library_version:text(manifest.version),
  language:text(manifest.language),
  path:fileURLToPath(directory),
  manifest,
  items,
  sources,
  scenarios,
  validation
 })
 if(usingDefault)defaultCache=library
 return library
}

export function clearKnowledgeLibraryCache(){defaultCache=null}

// Backwards-compatible import surface for server modules that treat the
// governed library as the single entry point.
export {selectKnowledge} from './selection.js'
