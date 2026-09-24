import {observe} from '../observability.js'
import {retrieveLatentKnowledge} from './latent-retrieval.js'
import {createHash} from 'node:crypto'
import {knowledgeSelectionVersion,assertKnowledgeContract,validateKnowledgeSelection} from './contracts.js'
import {loadKnowledgeLibrary} from './library.js'
import {authorityRank,evaluateGeography,evaluateKnowledgeLifecycle,knowledgePolicyVersion,list,normalizeSearchText,text,uniqueText} from './policy.js'
import {stripMessagePreamble} from '../message-preamble.js'
import {functionWord,verbForm,verbInfinitive} from './agronomic-vocabulary.js'
// functionWord guarda a forma do dicionario ("varios"); o token ja chegou passado por singular(),
// que corta o -s de palavras com 5+ letras e produz uma forma que a lista nunca tem. Testar as duas
// formas, em vez de mexer na lista, mantem o conserto valendo para a proxima entrada em -s.
const exemptFunctionWord=token=>functionWord.has(token)||functionWord.has(`${token}s`)
// A deteccao de assunto tambem isenta forma conjugada - ela nunca e o assunto da pergunta.
const exemptWordForm=token=>exemptFunctionWord(token)||verbForm.has(token)||verbForm.has(`${token}s`)

const stopWords=new Set([
 'a','ao','aos','as','com','como','da','das','de','do','dos','e','ele','ela','em','entre','essa','esse','esta','este','eu','foi','ha','isso','ja','mais','mas','na','nas','no','nos','o','os','ou','para','pela','pelo','por','que','se','sem','ser','sua','suas','seu','seus','tem','um','uma','voce',
 'and','are','for','from','into','of','on','or','that','the','this','to','with',
 // Interrogativas e qualificadores genericos nao carregam dominio. Sem isso
 // "qual a capital da Australia" casava com um item por causa de "qual".
 'qual','quais','quem','quando','onde','quanto','quantos','quantas','porque','porquê','pra','para',
 // Vocativo e saudacao colados a pergunta ("Oi val, o que e WASDE?") nao sao assunto: "val"
 // contava como termo nao coberto e derrubava a cobertura do item certo.
 'val','oi','oie','ola','opa','eai','hey','hello','hi','ei','obrigado','obrigada','valeu','favor',
 // Cortesia e abertura de pergunta ('bom dia, o que e basis?', 'me tira uma duvida sobre calagem')
 // tambem nao sao assunto: cada uma contava como termo fora do corpus e derrubava a maioria.
 'bom','boa','dia','tarde','noite','duvida','duvidas','tira','tirar','curiosidade','pergunta','perguntar',
 'ajuda','ajudar','ajude','direitinho','rapida','rapido','explicar','entender','saber','sobre','tenho','fiquei','queria','quero',
 'poderia','podia','poderiam','pode','sera','gentileza','licenca','incomodar','atrapalhar','desculpa','desculpe','rapidinho','minutinho','explicame','explique',
 'melhor','melhores','pior','piores','maior','menor','muito','muita','pouco','pouca','todo','toda','todos','todas',
 'ideal','ideais','otimo','otima','bom','boa','certo','certa','correto','correta','adequado','adequada','recomendado','recomendada','possivel','preciso',
 'fazer','faco','faz','ser','sou','estar','esta','ter','tem','pode','posso','deve','devo','vai','vou','quero','queria',
 'sobre','tambem','ainda','agora','hoje','assim','entao','depois','antes','mesmo','mesma','cada','outro','outra',
 // Formas que a normalizacao sem acento deixa com 3 letras ("nao", "ate", "sao"): existiam em
 // dezenas de itens e davam cobertura artificial a qualquer pergunta que as usasse.
 'nao','ate','sao','tao','nem','sim','esta','estao','era','sera','seria','tinha',
 // Verbos e substantivos de pergunta nao carregam dominio: "explique o que e WASDE" e a mesma
 // pergunta que "o que e WASDE". Sem isto, o termo desconhecido ("explique") derrubava a maioria
 // do corpus e a pergunta era declarada fora de assunto.
 'explique','explica','explicar','defina','define','definir','resuma','resumir','descreva','descrever',
 'conceito','significado','significa','fale','fala','falar','ensina','ensine','entender','entendo',
 'funciona','dizer','diz','quer','saber','sei','gostaria'
])

// Plural nao e assunto diferente: "daninhas" deve encontrar "daninha" e "herbicidas" deve
// encontrar "herbicida". Aplicado igualmente a pergunta e ao corpus.
const singular=token=>{
 const word=token.length>=5&&token.endsWith('s')&&!token.endsWith('ss')?token.slice(0,-1):token
 return ({enterrada:'incorporada',enterrado:'incorporada',incorporado:'incorporada',lanco:'superficial'})[word]||word
}

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
 for(const raw of contentText(value).split(' ')){
  if(raw.length<3||stopWords.has(raw))continue
  const token=singular(raw)
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
 for(const raw of contentText(value).split(' ')){
  if(raw.length<3||stopWords.has(raw))continue
  result.add(singular(raw))
 }
 return result
}

// These are grammatical relations, not subjects. A rare connective such as
// "diante da" must not outrank the noun phrase it introduces in strict subject
// coverage. Apply the same tokenization to query and corpus, without adding
// domain terms, answers or item IDs to a query whitelist.
function contentText(value){
 const words=normalizeSearchText(value).split(' ')
 const relations=new Map([
  ['diante',new Set(['de','da','das','do','dos'])],
  ['acerca',new Set(['de','da','das','do','dos'])],
  ['frente',new Set(['a','as','ao','aos'])],
  ['atraves',new Set(['de','da','das','do','dos'])]
 ])
 return words.filter((word,index)=>!relations.get(word)?.has(words[index+1])).join(' ')
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
// daninha; "frac" e "yield" aparecem em um so. Nome de cultura ou categoria
// nunca e discriminante, por mais raro que seja no acervo: "milho" em dois
// itens nao faz "temperatura ideal para germinacao do milho" ser respondida
// pelo item de populacao de plantas.
const discriminatingFrequency=2
const conceptTerms=new Set(exclusiveConceptGroups.flatMap(([,terms])=>terms))
const discriminating=(token,frequency)=>!conceptTerms.has(token)&&(frequency?.get(token)??Infinity)<=discriminatingFrequency
// Um verbo que o acervo nunca escreveu e a FORMA de perguntar, nao o assunto: "como lidar com
// resistencia de plantas daninhas?" pergunta a mesma coisa que "como tratar...", e so "tratar"
// estava no vocabulario. O acervo e escrito em prosa expositiva e nao cobre o leque de verbos com
// que um consultor pergunta, entao qualquer verbo fora dele desligava a Biblioteca inteira. O teste
// e morfologico, nao uma lista de palavras: lista fechada de verbos nunca fecha, do mesmo jeito que
// a lista de palavras de cortesia nao fechava. Substantivo desconhecido continua vetando - ele e o
// assunto, e assunto que o acervo nao conhece nao pode ser respondido por um item qualquer.
//
// A primeira versao desta isencao era so morfologica - terminar em -ar/-er/-ir, menos uma lista de
// sufixos de substantivo - e foi derrubada por medicao: 60 de 60 perguntas fora do acervo voltaram a
// ser respondidas com item curado, fonte SRC- e confianca VERIFICADO 0.9. "qual o risco do souvenir
// para a marca?" e "qual o risco do cesar para a marca?" recebiam o guardrail FRAC de fungicida.
// Substantivo terminado em -ar/-er/-ir e conjunto aberto (souvenir, cancer, avatar, paladar, pomar,
// altar) e antroponimo mais ainda (Cesar, Valter, Gilmar, Wagner): nenhuma lista de sufixo fecha.
//
// O sinal que separa nao e a forma da palavra, e a POSICAO dela. Em portugues, o infinitivo de uma
// pergunta ocupa slot verbal - vem depois de "como", "por que", "para", de um modal: "como LIDAR",
// "por que ROTACIONAR". O substantivo vem depois de determinante: "do SOUVENIR", "do VALTER". A
// lista abaixo e de palavras gramaticais, classe fechada de verdade, nao de temas nem de verbos.
// A rodada 13 trocou "sufixo" por "posicao" e a posicao tambem nao separa: medido, 100 perguntas
// que a VAL respondia pararam de ser respondidas, porque as locucoes mais comuns do portugues
// falado poem outra palavra no slot ("a melhor forma DE manejar", "vale a PENA combater", "ANTES DE
// combater", e o verbo em inicio de frase). E o buraco oposto continuou aberto: nome comercial e
// ingrediente ativo tambem terminam em ar/er/ir e tambem vem depois de "para" e "sem", entao
// "Premier" era lido como verbo e a pergunta atravessava o portao do acervo.
// Nem a forma nem a posicao respondem "esta palavra e um verbo?". So o lexico responde. A lista
// e grande, mas e fechada e verificavel item a item - e nome de produto nao entra nela.
function askingVerbsIn(value=''){
 const found=new Set()
 for(const word of String(value).split(' ').filter(Boolean))if(verbInfinitive.has(word))found.add(singular(word))
 return found
}
const genericTopicTerms=new Set(['aplicacao','aplicacoes','cultura','cultivo','opcao','opcoes','funcao','papel','efeito','efeitos','vantagem','desvantagem','diferenca','corrigido'])

// Lexical overlap with "milho" or "aplicação" is insufficient if the answer
// drops the actual pest/concept. This checks relevance, not factual truth.
export function generalAnswerTopicMatches(question,answer,{curated=false}={}){
 const frequency=corpusVocabulary(loadKnowledgeLibrary())
 const requested=baseTokens(stripMessagePreamble(question)||question)
 const anchors=[...requested].filter(token=>token.length>=5&&!exemptWordForm(token)&&!conceptTerms.has(token)&&!genericTopicTerms.has(token)&&(curated||(frequency.get(token)||0)<=discriminatingFrequency))
 const answerWords=[...baseTokens(answer)]
 return anchors.every(anchor=>answerWords.some(word=>word===anchor||word.length>=5&&word.slice(0,5)===anchor.slice(0,5)))&&!conceptConflict(exclusiveConcepts(question),exclusiveConcepts(answer))
}

// Retrieval relevance does not imply that a statement answers the whole question.
// Exact catalog requests retain their curated delivery; longer questions must
// also cover the requested subject and cannot silently assume a crop.
export function curatedAnswerCoversQuestion(question,item){
 const requested=baseTokens(stripMessagePreamble(question)||question)
 const exactSubject=[item.title,...(item.triggers||[])].some(value=>{
  const words=baseTokens(`${value} ${item.statement}`)
  return requested.size>0&&[...requested].every(word=>words.has(word))
 })
 if(exactSubject)return true
 // A general principle is not a yes/no answer to a universal claim.
 // Let the general-answer path address that qualification explicitly.
 if(/\b(?:sempre|nunca)\b/.test(normalizeSearchText(question))&&!/\b(?:sempre|nunca|necessariamente)\b/.test(normalizeSearchText(item.statement)))return false
 const cropGroups=new Set(['CORN','SOYBEAN','WHEAT','BEANS','RICE','CANOLA','SORGHUM'])
 const questionCrops=[...exclusiveConcepts(question)].filter(group=>cropGroups.has(group))
 const answerCrops=[...exclusiveConcepts(item.statement)].filter(group=>cropGroups.has(group))
 if(!questionCrops.length&&answerCrops.length)return false
 // Curator-authored title/triggers carry terminology aliases (e.g. local
 // quotation versus spot price); they cannot supply a missing subject.
 return generalAnswerTopicMatches(question,[item.statement,item.title,...(item.triggers||[])].join(' '),{curated:true})
}

function scoreItem(item,{searchTokens,queryBaseTokens,derivedTokens=new Set(),normalizedQuery='',corpusFrequency,queryConcepts,requestedModules,requestedGeography,sourceById,now,askingVerbs=new Set(),strictSubject=false}){
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
  if([...queryBaseTokens].every(token=>conceptTerms.has(token)))return {eligible:false,reason:'TOPIC_REQUIRED'}
  // A crop/category is not the subject of a specific question. In particular,
  // "inseticida para cigarrinha no milho" cannot select rotation of canola or a
  // generic insecticide card while silently dropping the pest the user named.
  const subjectTerms=[...queryBaseTokens].filter(token=>!askingVerbs.has(token)&&!conceptTerms.has(token)&&corpusFrequency.has(token)&&discriminating(token,corpusFrequency))
  if(strictSubject&&subjectTerms.length&&!subjectTerms.some(token=>itemTokens.has(token)))return {eligible:false,reason:'SUBJECT_NOT_COVERED'}
  const covered=[...queryBaseTokens].filter(token=>itemTokens.has(token)).length
  // triggers sao escritos pelo curador para dizer "este item responde sobre X",
  // entao um unico termo que caia neles basta. Titulo so vale para termo
  // discriminante (frequencia <= 2): "breakeven" sim, "custo" nao.
  const coveredInTriggers=[...queryBaseTokens].some(token=>(fields.triggers.has(token)||fields.title.has(token)&&queryBaseTokens.size===1)&&discriminating(token,corpusFrequency))
  if(covered<2&&covered<queryBaseTokens.size&&!coveredInTriggers)return {eligible:false,reason:'WEAK_QUERY_COVERAGE'}
 }

 // Cada termo pontua uma vez, pelo campo mais forte em que aparece, com um bonus pequeno
 // quando aparece em mais de um campo. Somar o mesmo termo em quatro campos fazia "milho"
 // (titulo, trigger, statement e application do item de populacao) valer mais do que
 // "gorgulho do milho" inteiro no trigger do item de armazenagem. Sinonimo expandido
 // ("fungicida" -> "defensivo") ajuda a recuperar, mas vale metade do termo escrito.
 const fieldWeights=[['title',8],['triggers',8],['application',5],['statement',4],['actions',3],['avoid',2],['domain',2]]
 let score=0
 for(const token of searchTokens){
  let best=0,breadth=0
  for(const [field,weight] of fieldWeights)if(fields[field].has(token)){breadth+=1;if(weight>best)best=weight}
  if(!best)continue
  const tokenScore=best+(breadth>1?2:0)
  score+=derivedTokens.has(token)?tokenScore/2:tokenScore
 }
 // Trigger inteiro contido na pergunta ("gorgulho do milho", "melhor epoca para vender") e o
 // curador respondendo por este item; vale mais do que um nome de cultura repetido em quatro
 // campos de outro item.
 const triggerPhrase=Boolean(normalizedQuery)&&item.triggers.some(trigger=>{const phrase=normalizeSearchText(trigger);return phrase.length>=4&&normalizedQuery.includes(phrase)})
 if(triggerPhrase){score+=25;reasonCodes.push('TRIGGER_PHRASE_MATCH')}
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
 // A cobertura é medida contando quantos termos da pergunta existem no acervo: "desculpa
 // incomodar" antes da pergunta engorda o denominador e derruba a pergunta legítima abaixo do
 // piso. Enumerar cada palavra de cortesia em stopWords nunca fecha a lista — o preâmbulo sai
 // inteiro antes de tokenizar. Se a frase for só cortesia, mede-se a frase original.
 const question=stripMessagePreamble(normalizeSearchText(query))||query
 const askingVerbs=askingVerbsIn(normalizeSearchText(question))
 const queryTokens=tokens(question)
 const queryBaseTokens=baseTokens(question)
 const normalizedQuery=normalizeSearchText(question)
 // Pergunta sobre a PROPRIA carteira nao e conhecimento curado: "quantos produtores eu tenho?"
 // se reduzia a um unico token depois das stopwords e casava com o titulo de um item qualquer
 // que citasse produtores, devolvendo um trecho aleatorio da Biblioteca como se fosse resposta.
 // O acervo nao sabe quantos produtores o consultor tem; quem sabe e a carteira.
 const portfolioQuestion=/\b(?:quant[oa]s|quais|quem)\b[^?]{0,80}\b(?:produtor\w*|client\w*|carteira|visitas?|oportunidades?)\b[^?]{0,40}\b(?:eu|meu|meus|minha|minhas|nossa|nossos)\b/.test(normalizedQuery)
  ||/\b(?:minha|nossa)\s+carteira\b/.test(normalizedQuery)
 const derivedTokens=new Set([...queryTokens].filter(token=>!queryBaseTokens.has(token)))
 const contextTokens=tokens(contextText)
 const searchTokens=new Set([...queryTokens,...contextTokens])
 const objectiveConcepts=exclusiveConcepts(question)
 const contextConcepts=exclusiveConcepts(contextText)
 const queryConcepts=objectiveConcepts.size?objectiveConcepts:contextConcepts
 // Semantic query uses only the user's public knowledge question, never private context.
 // Injected/custom libraries have no matching release index and remain lexical.
 const semantic=source===loadKnowledgeLibrary()?retrieveLatentKnowledge(question):{method:'UNINDEXED_LIBRARY',results:[]}
 const semanticById=new Map(semantic.results.map(row=>[row.id,row.similarity]))
 const sourceById=new Map(source.sources.map(entry=>[entry.source_id,entry]))
 const excludedReasonCounts={}
 const ranked=[]
 const corpusFrequency=corpusVocabulary(source)
 // Palavra gramatical tambem nao e assunto. O acervo e prosa expositiva de 198 itens e nunca vai
 // conter "deveria", "talvez" ou "sobretudo"; sem esta linha, a pergunta inteira era reprovada por
 // causa de um adverbio.
 const unknownTokens=[...queryBaseTokens].filter(token=>token.length>=5&&!corpusFrequency.has(token)&&!genericTopicTerms.has(token)&&!askingVerbs.has(token)&&!exemptWordForm(token))
 const unknownTopic=unknownTokens.length>0
 const offDomainQuestion=!corpusKnowsQuestion(queryBaseTokens,corpusFrequency)||cappedLimit===1&&unknownTopic

 for(const item of source.items){
  if(offDomainQuestion){excludedReasonCounts.QUESTION_OUTSIDE_CORPUS=(excludedReasonCounts.QUESTION_OUTSIDE_CORPUS||0)+1;continue}
  const result=scoreItem(item,{searchTokens,queryBaseTokens,derivedTokens,normalizedQuery,corpusFrequency,queryConcepts,requestedModules,requestedGeography:geography,sourceById,now,askingVerbs,strictSubject:cappedLimit===1})
  if(!result.eligible){
   excludedReasonCounts[result.reason]=(excludedReasonCounts[result.reason]||0)+1
   continue
  }
  const semanticScore=semanticById.get(item.knowledge_item_id)||0
  ranked.push({item,...result,lexicalScore:result.score,semanticScore,score:result.score+semanticScore*5})
 }

 ranked.sort((left,right)=>right.score-left.score||(authorityRank[left.item.authority]??99)-(authorityRank[right.item.authority]??99)||left.item.knowledge_item_id.localeCompare(right.item.knowledge_item_id))
 const selected=ranked.slice(0,cappedLimit).map(entry=>compactSelection(entry.item,entry))
 const status=selected.length&&!portfolioQuestion?'SELECTED':'NO_APPLICABLE_KNOWLEDGE'
 const reasonCode=portfolioQuestion?'PORTFOLIO_QUESTION_NOT_KNOWLEDGE':selected.length?'MATCHED_GOVERNED_KNOWLEDGE':'NO_APPLICABLE_GOVERNED_KNOWLEDGE'
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
  retrieval:{
   lexical_method:'GOVERNED_WEIGHTED_TERMS_V1',semantic_method:semantic.method,
   semantic_corpus_sha256:semantic.corpus_sha256||null,
   private_context_indexed:false,
   composition:'existing governance and subject filters, lexical score + 5 * latent cosine; authority/id tie break',
   lexical_result:[...ranked].sort((a,b)=>b.lexicalScore-a.lexicalScore||a.item.knowledge_item_id.localeCompare(b.item.knowledge_item_id)).slice(0,3).map(e=>({id:e.item.knowledge_item_id,score:e.lexicalScore})),
   semantic_result:[...ranked].filter(e=>e.semanticScore>0).sort((a,b)=>b.semanticScore-a.semanticScore||a.item.knowledge_item_id.localeCompare(b.item.knowledge_item_id)).slice(0,3).map(e=>({id:e.item.knowledge_item_id,score:e.semanticScore})),
   selected_evidence:ranked.slice(0,cappedLimit).map(e=>({id:e.item.knowledge_item_id,version:e.item.version,source_refs:e.item.source_refs,lexical_score:e.lexicalScore,semantic_score:e.semanticScore,combined_score:e.score}))
  },
  evaluated_at:evaluateKnowledgeLifecycle({},now).evaluated_at
 }
 const items=portfolioQuestion?[]:selected
 observe('knowledge.hybrid.summary',{selectionPolicy:semantic.method,outcome:status,source:audit.query_fingerprint,rowCount:items.length,contractVersion:source.library_version})
 for(const [channel,rows] of [['lexical',audit.retrieval.lexical_result],['semantic',audit.retrieval.semantic_result]])for(const [rank,row] of rows.entries())observe('knowledge.hybrid.candidate',{mode:channel,source:row.id,confidence:row.score,rowCount:rank+1,contractVersion:source.library_version})
 for(const row of audit.retrieval.selected_evidence)observe('knowledge.hybrid.selected',{source:row.id,confidence:row.combined_score,reasonCodes:row.source_refs.join(','),contractVersion:row.version})
 const selection={contract_version:knowledgeSelectionVersion,policy_version:knowledgePolicyVersion,status,items,selected:items,reason_code:reasonCode,audit}
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
 const discriminatingTitleToken=covered.some(token=>discriminating(token,frequency))
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
