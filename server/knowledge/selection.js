import {createHash} from 'node:crypto'
import {knowledgeSelectionVersion,assertKnowledgeContract,validateKnowledgeSelection} from './contracts.js'
import {loadKnowledgeLibrary} from './library.js'
import {authorityRank,evaluateGeography,evaluateKnowledgeLifecycle,knowledgePolicyVersion,list,normalizeSearchText,text,uniqueText} from './policy.js'

const stopWords=new Set([
 'a','ao','aos','as','com','como','da','das','de','do','dos','e','ele','ela','em','entre','essa','esse','esta','este','eu','foi','ha','isso','ja','mais','mas','na','nas','no','nos','o','os','ou','para','pela','pelo','por','que','se','sem','ser','sua','suas','seu','seus','tem','um','uma','voce',
 'and','are','for','from','into','of','on','or','that','the','this','to','with',
 // Interrogativas e qualificadores genericos nao carregam dominio. Sem isso
 // "qual a capital da Australia" casava com um item por causa de "qual".
 'qual','quais','quem','quando','onde','quanto','quantos','quantas','porque','porquê','pra','para',
 'melhor','melhores','pior','piores','maior','menor','muito','muita','pouco','pouca','todo','toda','todos','todas',
 'fazer','faco','faz','ser','sou','estar','esta','ter','tem','pode','posso','deve','devo','vai','vou','quero','queria',
 'sobre','tambem','ainda','agora','hoje','assim','entao','depois','antes','mesmo','mesma','cada','outro','outra'
])

const lexicalExpansions=Object.freeze({
 adubacao:['fertilizante','fertilidade'],
 audio:['voz','transcricao'],
 buva:['daninha','planta','invasora'],
 custo:['preco','precificacao','investimento'],
 defensivo:['inseticida','fungicida','herbicida','praga','doenca'],
 fertilizante:['adubacao','fertilidade'],
 fungicida:['defensivo','doenca'],
 herbicida:['defensivo','daninha'],
 inseticida:['defensivo','praga'],
 investimento:['preco','custo','retorno'],
 milho:['cultura','lavoura'],
 preco:['precificacao','custo','investimento','valor'],
 soja:['cultura','lavoura'],
 voz:['audio','transcricao']
})

// Category and crop names are exclusive grounding constraints, not merely
// ranking hints. A fertilizer-specific item must not win an insecticide query
// just because both mention price, and soybean guidance must not be smuggled
// into a corn decision through a generic agronomy token.
const exclusiveConceptGroups=Object.freeze([
 ['FERTILIZER',['fertilizante','fertilidade','adubacao']],
 ['SEED',['semente','sementes']],
 ['INSECTICIDE',['inseticida','inseticidas']],
 ['FUNGICIDE',['fungicida','fungicidas']],
 ['HERBICIDE',['herbicida','herbicidas']],
 ['BIOLOGICAL',['biologico','biologicos']],
 ['CORN',['milho']],
 ['SOYBEAN',['soja']],
 ['WHEAT',['trigo']],
 ['BEANS',['feijao']],
 ['RICE',['arroz']],
 ['CANOLA',['canola']],
 ['SORGHUM',['sorgo']]
])

function tokens(value){
 const result=new Set()
 for(const token of normalizeSearchText(value).split(' ')){
  if(token.length<3||stopWords.has(token))continue
  result.add(token)
  for(const expansion of lexicalExpansions[token]||[])result.add(expansion)
 }
 return result
}

// Termos crus da pergunta, sem expansao lexical: expansao ajuda a recuperar,
// mas inflaria o denominador do piso de relevancia e deixaria passar item que
// so casa com sinonimo generico.
function baseTokens(value){
 const result=new Set()
 for(const token of normalizeSearchText(value).split(' ')){
  if(token.length<3||stopWords.has(token))continue
  result.add(token)
 }
 return result
}

function exclusiveConcepts(value){
 const normalized=` ${normalizeSearchText(value)} `
 const result=new Set()
 for(const [concept,terms] of exclusiveConceptGroups){
  if(terms.some(term=>normalized.includes(` ${term} `)))result.add(concept)
 }
 return result
}

function conceptFamily(value){return /^(?:CORN|SOYBEAN|WHEAT|BEANS|RICE|CANOLA|SORGHUM)$/.test(value)?'CROP':'CATEGORY'}

function conceptConflict(queryConcepts,itemConcepts){
 for(const family of ['CROP','CATEGORY']){
  const requested=[...queryConcepts].filter(value=>conceptFamily(value)===family)
  const described=[...itemConcepts].filter(value=>conceptFamily(value)===family)
  if(requested.length&&described.length&&!requested.some(value=>described.includes(value)))return family
 }
 return null
}

function flattenContext(value,{depth=0,output=[]}={}){
 if(value==null||depth>6||output.length>=300)return output
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'){
  output.push(String(value))
  return output
 }
 if(Array.isArray(value)){
  for(const entry of value.slice(0,100))flattenContext(entry,{depth:depth+1,output})
  return output
 }
 if(typeof value==='object'){
  for(const [key,entry] of Object.entries(value).slice(0,100)){
   output.push(key)
   flattenContext(entry,{depth:depth+1,output})
  }
 }
 return output
}

function intersectionCount(left,right){
 let count=0
 for(const value of left)if(right.has(value))count+=1
 return count
}

function fingerprint(value){
 return createHash('sha256').update(text(value)).digest('hex').slice(0,16)
}

function itemFieldTokens(item){
 return {
  title:tokens(item.title),
  triggers:tokens(item.triggers.join(' ')),
  statement:tokens(item.statement),
  application:tokens(item.application_val),
  actions:tokens(item.recommended_actions.join(' ')),
  avoid:tokens(item.avoid.join(' ')),
  domain:tokens(item.domain.replaceAll('_',' ')),
  get all(){return new Set([...this.title,...this.triggers,...this.statement,...this.application,...this.actions,...this.avoid,...this.domain])}
 }
}

// Vocabulario do corpus: quando a maior parte dos termos de uma pergunta nao
// existe em item nenhum, a pergunta e de outro assunto e um acerto incidental
// nao a torna respondivel. Separa "guerra mundial" (corpus so conhece
// "mundial") de "classificacao FRAC" (corpus conhece os dois termos).
const vocabularyCache=new WeakMap()
function corpusVocabulary(library){
 const cached=vocabularyCache.get(library)
 if(cached)return cached
 const frequency=new Map()
 for(const item of library.items)for(const token of itemFieldTokens(item).all)frequency.set(token,(frequency.get(token)||0)+1)
 vocabularyCache.set(library,frequency)
 return frequency
}

// Maioria estrita: metade conhecida nao basta. "quem ganhou a segunda guerra
// mundial" tem 2 de 4 termos no corpus por coincidencia ("ganhou", "mundial")
// e nao pode ser respondida por um item de oferta e demanda.
function corpusKnowsQuestion(queryBaseTokens,frequency){
 if(!queryBaseTokens.size)return true
 const known=[...queryBaseTokens].filter(token=>frequency.has(token)).length
 return known*2>queryBaseTokens.size
}

// Um termo unico so dispensa a cobertura se for discriminante. "plantas"
// aparece em varios itens e puxaria populacao de milho para uma pergunta de
// daninha; "frac" e "yield" aparecem em um so.
const discriminatingFrequency=2

function scoreItem(item,{searchTokens,queryBaseTokens,corpusFrequency,queryConcepts,requestedModules,requestedGeography,sourceById,now}){
 const reasonCodes=[]
 if(!item.retrieval_eligible)return {eligible:false,reason:item.prompt_safety==='BLOCKED'?'PROMPT_INJECTION_BLOCKED':'STATUS_NOT_ELIGIBLE'}
 if(item.status!=='APPROVED')return {eligible:false,reason:'STATUS_NOT_APPROVED'}
 const lifecycle=evaluateKnowledgeLifecycle(item,now)
 if(!lifecycle.eligible)return {eligible:false,reason:lifecycle.reason}
 const moduleMatches=requestedModules.filter(module=>item.module_targets.includes(module))
 if(requestedModules.length&&!moduleMatches.length)return {eligible:false,reason:'MODULE_NOT_APPLICABLE'}

 const itemConcepts=exclusiveConcepts([item.title,item.statement,item.application_val,item.triggers.join(' '),item.recommended_actions.join(' ')].join(' '))
 const conflictingFamily=conceptConflict(queryConcepts,itemConcepts)
 if(conflictingFamily)return {eligible:false,reason:`${conflictingFamily}_CONFLICT`}

 const fields=itemFieldTokens(item)
 const hits={
  title:intersectionCount(searchTokens,fields.title),
  triggers:intersectionCount(searchTokens,fields.triggers),
  statement:intersectionCount(searchTokens,fields.statement),
  application:intersectionCount(searchTokens,fields.application),
  actions:intersectionCount(searchTokens,fields.actions),
  avoid:intersectionCount(searchTokens,fields.avoid),
  domain:intersectionCount(searchTokens,fields.domain)
 }
 const semanticHits=Object.values(hits).reduce((sum,value)=>sum+value,0)
 if(!semanticHits)return {eligible:false,reason:'NO_DECISION_RELEVANCE'}
 // Piso proporcional. Um unico termo em comum nao torna um item a resposta:
 // "capital da Australia" casava com um item sobre capital de giro. Exige-se
 // dois termos distintos da pergunta, ou que a pergunta inteira seja coberta
 // (caso de consulta de termo unico, como "o que e basis").
 if(queryBaseTokens?.size){
  const itemTokens=new Set(Object.values(fields).flatMap(set=>[...set]))
  const covered=[...queryBaseTokens].filter(token=>itemTokens.has(token)).length
  // triggers sao escritos pelo curador para dizer "este item responde sobre X",
  // entao um unico termo que caia neles basta. Titulo nao serve para isso:
  // "capital" aparece no titulo de um item de custo por acaso, "frac" nao.
  const coveredInTriggers=[...queryBaseTokens].some(token=>fields.triggers.has(token)&&(corpusFrequency?.get(token)??Infinity)<=discriminatingFrequency)
  if(covered<2&&covered<queryBaseTokens.size&&!coveredInTriggers)return {eligible:false,reason:'WEAK_QUERY_COVERAGE'}
 }

 let score=hits.title*7+hits.triggers*8+hits.application*5+hits.statement*4+hits.actions*3+hits.avoid*2+hits.domain*2
 if(hits.title)reasonCodes.push('TITLE_MATCH')
 if(hits.triggers)reasonCodes.push('TRIGGER_MATCH')
 if(hits.application||hits.statement)reasonCodes.push('DECISION_CONTEXT_MATCH')
 if(hits.actions||hits.avoid)reasonCodes.push('ACTION_OR_GUARDRAIL_MATCH')
 if(moduleMatches.length){score+=moduleMatches.length*4;reasonCodes.push('MODULE_MATCH')}
 const authorityScore=3-(authorityRank[item.authority]??3)
 score+=authorityScore
 reasonCodes.push(`AUTHORITY_${item.authority}`)

 const sources=item.source_refs.map(ref=>sourceById.get(ref)).filter(Boolean)
 const geography=evaluateGeography(item.geographic_scope,requestedGeography,sources.map(source=>source.geography))
 if(geography.match==='LOCAL_SCOPE_MATCH')score+=3
 else if(['EXTERNAL_EVIDENCE','EXTERNAL_SOURCE_CAVEAT','LOCAL_VALIDATION_REQUIRED'].includes(geography.match))score-=2
 reasonCodes.push(geography.match)
 if(item.requires_human_review)reasonCodes.push('HUMAN_REVIEW_REQUIRED')
 if(lifecycle.review_due)reasonCodes.push('REVIEW_DUE')
 if(lifecycle.freshness==='UNKNOWN')reasonCodes.push('FRESHNESS_UNKNOWN')
 reasonCodes.push(item.usage_mode)

 return {eligible:true,score,reasonCodes:[...new Set(reasonCodes)],geography,lifecycle,moduleMatches}
}

function compactSelection(item,ranked){
 const highRisk=item.usage_mode==='GUARDRAIL_ONLY'
 return {
  knowledge_item_id:item.knowledge_item_id,
  title:item.title,
  domain:item.domain,
  statement:item.statement,
  application_val:item.application_val,
  triggers:item.triggers,
  recommended_actions:highRisk?[]:item.recommended_actions,
  avoid:item.avoid,
  module_targets:item.module_targets,
  source_refs:item.source_refs,
  authority:item.authority,
  risk:item.risk,
  geographic_scope:item.geographic_scope,
  status:item.status,
  raw_status:item.raw_status,
  version:item.version,
  valid_from:item.valid_from,
  valid_until:item.valid_until,
  review_at:item.review_at,
  owner:item.owner,
  supersedes_id:item.supersedes_id,
  created_at:item.created_at,
  updated_at:item.updated_at,
  library_version:item.version,
  usage_mode:item.usage_mode,
  requires_human_review:item.requires_human_review||ranked.lifecycle.review_due,
  reason_codes:ranked.reasonCodes,
  geography_caveats:ranked.geography.caveats,
  freshness:ranked.lifecycle.freshness,
  freshness_caveats:ranked.lifecycle.caveats,
  review_guidance:highRisk?'Usar somente como guardrail; MIA/MGO ou responsável humano deve revisar antes de qualquer decisão técnica ou prescritiva.':null
 }
}

/**
 * Recuperação determinística, síncrona e limitada de conhecimento governado.
 * O retorno nunca contém o corpus completo nem conteúdo de prompt/sistema.
 */
export function selectKnowledge({query='',contextSnapshot=null,modules=[],geography='General',limit=3,now=new Date(),library=null,libraryOptions=null}={}){
 const source=library||loadKnowledgeLibrary(libraryOptions||{})
 const cappedLimit=Math.min(3,Math.max(1,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):3))
 const requestedModules=uniqueText(Array.isArray(modules)?modules:[modules]).map(value=>value.toUpperCase()).sort()
 const contextText=flattenContext(contextSnapshot).join(' ')
 const queryTokens=tokens(query)
 const queryBaseTokens=baseTokens(query)
 const contextTokens=tokens(contextText)
 const searchTokens=new Set([...queryTokens,...contextTokens])
 const objectiveConcepts=exclusiveConcepts(query)
 const contextConcepts=exclusiveConcepts(contextText)
 const queryConcepts=objectiveConcepts.size?objectiveConcepts:contextConcepts
 const sourceById=new Map(source.sources.map(entry=>[entry.source_id,entry]))
 const excludedReasonCounts={}
 const ranked=[]
 const corpusFrequency=corpusVocabulary(source)
 const offDomainQuestion=!corpusKnowsQuestion(queryBaseTokens,corpusFrequency)

 for(const item of source.items){
  if(offDomainQuestion){excludedReasonCounts.QUESTION_OUTSIDE_CORPUS=(excludedReasonCounts.QUESTION_OUTSIDE_CORPUS||0)+1;continue}
  const result=scoreItem(item,{searchTokens,queryBaseTokens,corpusFrequency,queryConcepts,requestedModules,requestedGeography:geography,sourceById,now})
  if(!result.eligible){
   excludedReasonCounts[result.reason]=(excludedReasonCounts[result.reason]||0)+1
   continue
  }
  ranked.push({item,...result})
 }

 ranked.sort((left,right)=>right.score-left.score||(authorityRank[left.item.authority]??99)-(authorityRank[right.item.authority]??99)||left.item.knowledge_item_id.localeCompare(right.item.knowledge_item_id))
 const selected=ranked.slice(0,cappedLimit).map(entry=>compactSelection(entry.item,entry))
 const status=selected.length?'SELECTED':'NO_APPLICABLE_KNOWLEDGE'
 const reasonCode=selected.length?'MATCHED_GOVERNED_KNOWLEDGE':'NO_APPLICABLE_GOVERNED_KNOWLEDGE'
 const audit={
  library_name:source.library_name,
  library_version:source.library_version,
  query_fingerprint:fingerprint(query),
  query_token_count:queryTokens.size,
  context_token_count:contextTokens.size,
  objective_concepts:[...objectiveConcepts].sort(),
  context_concepts:[...contextConcepts].sort(),
  exclusive_concepts:[...queryConcepts].sort(),
  requested_modules:requestedModules,
  requested_geography:text(geography)||'General',
  requested_limit:Number(limit)||3,
  applied_limit:cappedLimit,
  evaluated_count:source.items.length,
  eligible_count:ranked.length,
  excluded_reason_counts:excludedReasonCounts,
  selected_refs:selected.map(item=>item.knowledge_item_id),
  high_risk_selected:selected.filter(item=>item.risk==='HIGH').length,
  prompt_content_included:false,
  corpus_dumped:false,
  evaluated_at:evaluateKnowledgeLifecycle({},now).evaluated_at
 }
 const selection={contract_version:knowledgeSelectionVersion,policy_version:knowledgePolicyVersion,status,items:selected,selected,reason_code:reasonCode,audit}
 return assertKnowledgeContract(selection,validateKnowledgeSelection,'KnowledgeSelection v1')
}

/**
 * Explica a força do casamento entre a pergunta e um item já selecionado, para que o consumidor
 * saiba se a relevância foi atestada pela curadoria (frase de trigger contida na pergunta, ou
 * termo discriminante/maioria do título) ou se foi apenas lexical. Não altera o ranking.
 */
export function describeSelectionMatch({query='',item=null,library=null,libraryOptions=null}={}){
 const source=library||loadKnowledgeLibrary(libraryOptions||{})
 const frequency=corpusVocabulary(source)
 const normalizedQuery=normalizeSearchText(query)
 const queryBase=baseTokens(query)
 const triggers=list(item?.triggers).map(trigger=>normalizeSearchText(trigger)).filter(trigger=>trigger.length>=4)
 const triggerPhrase=normalizedQuery.length>=4&&triggers.some(trigger=>normalizedQuery.includes(trigger)||trigger.includes(normalizedQuery))
 const titleTokens=[...baseTokens(item?.title||'')]
 const covered=titleTokens.filter(token=>queryBase.has(token))
 const discriminatingTitleToken=covered.some(token=>(frequency.get(token)??Infinity)<=discriminatingFrequency)
 const titleCoverage=titleTokens.length?covered.length/titleTokens.length:0
 // "o que e breakeven": a pergunta inteira (tirando interrogativas) esta no titulo do item.
 const questionInTitle=queryBase.size>0&&[...queryBase].every(token=>titleTokens.includes(token))
 return Object.freeze({
  trigger_phrase:triggerPhrase,
  title_coverage:Number(titleCoverage.toFixed(2)),
  discriminating_title_token:discriminatingTitleToken,
  question_in_title:questionInTitle,
  match:triggerPhrase?'TRIGGER_PHRASE':discriminatingTitleToken||questionInTitle||titleCoverage>=.6?'TITLE_PHRASE':'LEXICAL'
 })
}
