import {createHash} from 'node:crypto'

export const valContextSelectorVersion='val.context_selector.v1'

export const valContextDomains=Object.freeze([
 'PROFILE','COMMERCIAL','AGRONOMY','GRAINS','CREDIT','GEO','VISIT','OPPORTUNITY','GENERAL','MULTI_DOMAIN'
])

const clean=(value,max=4000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const safeJson=value=>{try{return JSON.stringify(value??'')}catch{return String(value??'')}}

const domainPatterns=Object.freeze({
 PROFILE:/\b(?:perfi(?:l|s)|comportament\w*|analitic\w*|relacional|inovador|conservador|digital|como (?:ele|ela|o produtor|a produtora) decide|como (?:devo )?abordar (?:ele|ela))\b/,
 GRAINS:/\b(?:graos?|soja|milho|trigo|sorgo|cevada|commodity|commodities|contrato (?:de|dos?) graos?|trava(?:mento|r)?|fixa(?:cao|r)|saca|basis)\b/,
 CREDIT:/\b(?:credito|financeir\w*|cpf|limite|score|inadimpl\w*|financiamento|prazo de pagamento)\b/,
 GEO:/\b(?:geo|mapa|mapeamento|geometria|poligono|coordenad\w*|talhao|area desenhada)\b/,
 AGRONOMY:/\b(?:agronom\w*|manejo|solo|nutri[cç][aã]o\w*|fertiliz\w*|herbic\w*|insetic\w*|fungic\w*|praga\w*|doen[cç]a\w*|diagn[oó]stic\w*|fitoscan|nutriscan|lavoura\w*|safra\w*|cultur\w*|plantio\w*|semente\w*|semeadur\w*|germina[cç][aã]o|emerg[eê]ncia)\b/,
 VISIT:/\b(?:visita\w*|preparevisit|perguntas? de ouro|p[oó]s[- ]?visita\w*|[uú]ltim[ao] conversa|compromisso\w*)\b/,
 OPPORTUNITY:/\b(?:oportunidade\w*|pipeline|proposta\w*|neg[oó]cio\w*|pr[oó]ximo passo|fechamento\w*)\b/,
 COMMERCIAL:/\b(?:comercial|venda\w*|pre[cç]o\w*|custo\w*|compra\w*|compr(?:ou|ar|aram|ava|avam|e|em|aria)|negocia[cç][aã]o\w*|obje[cç][aã]o\w*|valor(?:es)?|margem|margens)\b/
})

const intentDomains=Object.freeze({
 ASK_AGRONOMIC:'AGRONOMY',ANALYZE_SOIL:'AGRONOMY',IMAGE_DIAGNOSIS:'AGRONOMY',
 PREPARE_VISIT:'VISIT',POST_VISIT:'VISIT',CHECK_OPPORTUNITY:'OPPORTUNITY',
 OBJECTION_HELP:'COMMERCIAL',FOLLOW_UP_HELP:'COMMERCIAL',ASK_MARKET:'GRAINS',ASK_COMMODITY:'GRAINS'
})

export function classifyValContextDomain(message='',intent=''){
 const source=normalize(message)
 const unique=[...new Set(Object.entries(domainPatterns).filter(([,pattern])=>pattern.test(source)).map(([domain])=>domain))]
 // "Margem técnica" em uma regulagem/demanda de sementes é um buffer
 // agronômico, não uma margem comercial. A exceção é deliberadamente
 // estreita: preço, custo, venda ou negociação mantêm MULTI_DOMAIN.
 const technicalSeedMargin=/\bmargem tecnica\b/.test(source)&&/\b(?:semente\w*|semeadur\w*)\b/.test(source)
 const explicitCommercial=/\b(?:comercial|venda\w*|preco\w*|custo\w*|compra\w*|negociacao\w*|objecao\w*|valor(?:es)?)\b/.test(source)
 if(technicalSeedMargin&&!explicitCommercial&&unique.includes('AGRONOMY')&&unique.includes('COMMERCIAL'))return 'AGRONOMY'
 const dominantPairs=Object.freeze({GRAINS:'COMMERCIAL',CREDIT:'COMMERCIAL',GEO:'AGRONOMY',OPPORTUNITY:'COMMERCIAL'})
 for(const [dominant,auxiliary] of Object.entries(dominantPairs))if(unique.length===2&&unique.includes(dominant)&&unique.includes(auxiliary))return dominant
 if(unique.length>1)return 'MULTI_DOMAIN'
 if(unique.length===1)return unique[0]
 return intentDomains[String(intent||'').toUpperCase()]||'GENERAL'
}

export function matchedValContextDomains(value=''){
 const source=normalize(value)
 return Object.freeze([...new Set(Object.entries(domainPatterns).filter(([,pattern])=>pattern.test(source)).map(([domain])=>domain))])
}

export function conversationReferenceKind(message=''){
 const source=normalize(message)
 if(!source)return 'NONE'
 if(/\b(?:novo assunto|mudar de assunto|desconsidere o anterior|ignore a conversa anterior)\b/.test(source))return 'RESET'
 if(/^(?:pode\s+)?(?:seguir|continue|continuar|prossiga|avance|e agora|entao|como sigo|faca isso|monte|aprofunde|resume|resuma|repete|repita|explica|explique|por que|porque|mostra(?:r)?(?:\s+(?:os\s+)?numeros)?|so(?:\s+o)?\s+essencial)\b|^(?:explique|mostre)\b.*\b(?:ultima (?:leitura|resposta|recomendacao)|resposta anterior|contexto atual)\b|\b(?:isso|o que voce falou|a resposta anterior|essas perguntas|a segunda|a primeira)\b/.test(source))return 'TURN_CONTENT'
 if(/\b(?:ele|ela|dele|dela|esse produtor|essa produtora|o filho dele|o irmao dele|volta pro|volte para)\b/.test(source))return 'ENTITY_ONLY'
 return 'NONE'
}

const allowedMemoryDomains=Object.freeze({
 PROFILE:new Set(['BEHAVIORAL','RELATIONSHIP','PRODUCER']),
 COMMERCIAL:new Set(['COMMERCIAL','RELATIONSHIP','PRODUCER','STRATEGIC']),
 AGRONOMY:new Set(['AGRONOMIC','PRODUCER']),
 GRAINS:new Set(['COMMERCIAL','STRATEGIC','PRODUCER']),
 CREDIT:new Set(['COMMERCIAL','STRATEGIC','PRODUCER']),
 GEO:new Set(['AGRONOMIC','PRODUCER']),
 VISIT:new Set(['RELATIONSHIP','COMMERCIAL','BEHAVIORAL','PRODUCER']),
 OPPORTUNITY:new Set(['COMMERCIAL','STRATEGIC','RELATIONSHIP','PRODUCER']),
 GENERAL:new Set(['PRODUCER','COMMERCIAL','AGRONOMIC','BEHAVIORAL','RELATIONSHIP','ORGANIZATIONAL','STRATEGIC']),
 MULTI_DOMAIN:new Set(['PRODUCER','COMMERCIAL','AGRONOMIC','BEHAVIORAL','RELATIONSHIP','ORGANIZATIONAL','STRATEGIC'])
})

const behavioralKey=/\b(?:perfil|profile|behavior|behaviour|comport\w*|decision|decis\w*|prefer\w*|evidence|survey|questionnaire|irt|nps|trust|confidence|compara\w*|roi|retorno|analitic\w*|relacional|inovador|conservador|digital)\b/
const structuralProducerKey=/\b(?:name|nome|municip|city|cidade|area|culture|cultura|property|propriedade|identity|identidade)\b/
const visitKey=/\b(?:visit|visita|interaction|interacao|conversa|commitment|compromisso|relationship|relacionamento|objection|objecao)\b/
const opportunityKey=/\b(?:opportun|pipeline|proposal|proposta|next[._ -]?step|proximo[._ -]?passo|closing|fechamento)\b/
const geoKey=/\b(?:geo|map|mapa|polygon|poligono|coordinate|coordenad|field|talhao|property|propriedade|sigef|car|matricula)\b/
const creditKey=/\b(?:credit\w*|financial\w*|financeir\w*|cpf|limit\w*|score|inadimpl\w*|financ\w*|payment[._ -]?term\w*|prazo[._ -]?pagamento)\b/
const grainKey=/\b(?:grain\w*|grao\w*|commodit\w*|soja|milho|trigo|sorgo|cevada|contract[._ -]?(?:grain\w*|grao\w*)|contrato[._ -]?(?:grain\w*|grao\w*)|trava\w*|fixacao|basis|saca\w*)\b/
const agronomyKey=/\b(?:agronom\w*|soil|solo|manejo|nutri\w*|fertiliz\w*|herbic\w*|insetic\w*|fungic\w*|praga\w*|doenca\w*|diagnostic\w*|fitoscan|nutriscan|lavoura|field[._ -]?report|ndvi)\b/
const commercialKey=/\b(?:commercial\w*|comercial|sale|venda|purchase|compra|price|preco|cost|custo|margin|margem|negoci\w*|business[._ -]?value|valor[._ -]?(?:comercial|negocio|proposta)|objection|objecao)\b/

function recordSearchText(record={}){
 return normalize(`${record.key||''} ${record.source_type||record.sourceType||''} ${record.memory_type||record.memory_domain||record.memoryDomain||''} ${safeJson(record.content??record.value)}`).replace(/[_./:-]+/g,' ')
}

function recordSemanticDomains(record={}){
 const source=recordSearchText(record)
 const domains=[]
 if(behavioralKey.test(source))domains.push('PROFILE')
 if(grainKey.test(source))domains.push('GRAINS')
 if(creditKey.test(source))domains.push('CREDIT')
 if(geoKey.test(source))domains.push('GEO')
 if(agronomyKey.test(source))domains.push('AGRONOMY')
 if(visitKey.test(source))domains.push('VISIT')
 if(opportunityKey.test(source))domains.push('OPPORTUNITY')
 if(commercialKey.test(source))domains.push('COMMERCIAL')
 return [...new Set(domains)]
}

export function memoryMatchesContextDomain(record={},domain='GENERAL',query=''){
 const normalizedDomain=valContextDomains.includes(domain)?domain:'GENERAL'
 const memoryDomain=String(record.memory_type??record.memory_domain??record.memoryDomain??'PRODUCER').toUpperCase()
 if(!allowedMemoryDomains[normalizedDomain].has(memoryDomain))return false
 const source=recordSearchText(record)
 const recordDomains=recordSemanticDomains(record)
 const requested=matchedValContextDomains(query)
 if(normalizedDomain==='PROFILE'){
  // O rótulo BEHAVIORAL não é uma autorização para importar todo o texto do
  // registro. Ele ainda precisa conter um sinal comportamental observável.
  // Assim, um item indevidamente classificado como BEHAVIORAL que só fale de
  // CPF, grãos ou produto não atravessa o selector.
  const content=normalize(safeJson(record.content??record.value)).replace(/[_./:-]+/g,' ')
  const foreignDomains=['GRAINS','CREDIT','AGRONOMY','GEO']
  return recordDomains.includes('PROFILE')&&behavioralKey.test(content)&&!recordDomains.some(item=>foreignDomains.includes(item))
 }
 if(['GRAINS','CREDIT','GEO','OPPORTUNITY'].includes(normalizedDomain))return recordDomains.includes(normalizedDomain)
 if(normalizedDomain==='AGRONOMY'){
  if(recordDomains.includes('AGRONOMY')&&!recordDomains.some(item=>['GRAINS','CREDIT'].includes(item)))return true
  const asksForHistory=/\b(?:histor\w*|registros?|memoria|area estrutural)\b/.test(normalize(query))
  return asksForHistory&&memoryDomain==='PRODUCER'&&structuralProducerKey.test(source)
 }
 if(normalizedDomain==='VISIT')return memoryDomain==='RELATIONSHIP'||recordDomains.includes('VISIT')
 if(normalizedDomain==='COMMERCIAL'){
  if(recordDomains.some(item=>['GRAINS','CREDIT'].includes(item))&&!requested.some(item=>['GRAINS','CREDIT'].includes(item)))return false
  return memoryDomain==='COMMERCIAL'||recordDomains.includes('COMMERCIAL')||recordDomains.includes('OPPORTUNITY')
 }
 if(normalizedDomain==='MULTI_DOMAIN')return recordDomains.some(item=>requested.includes(item))||(memoryDomain==='PRODUCER'&&structuralProducerKey.test(source))
 if(normalizedDomain==='GENERAL'){
  if(!clean(query))return true
  const queryTokens=normalize(query).split(/\s+/).filter(token=>token.length>=4)
  return memoryDomain==='PRODUCER'&&(structuralProducerKey.test(source)||queryTokens.some(token=>source.includes(token)))
 }
 return false
}

export function contextCollectionPolicy(domain='GENERAL',query=''){
 const selected=valContextDomains.includes(domain)?domain:'GENERAL'
 const requested=selected==='MULTI_DOMAIN'?matchedValContextDomains(query):[selected]
 const legacyBootstrap=selected==='GENERAL'&&!clean(query)
 return Object.freeze({
  // Preparar uma visita precisa da oportunidade vinculada, mas PROFILE nunca
  // herda esse acesso. O domínio VISIT continua selecionando item a item abaixo.
  commercial:legacyBootstrap||requested.some(item=>['VISIT','COMMERCIAL','GRAINS','CREDIT','OPPORTUNITY'].includes(item)),
  agronomic:legacyBootstrap||requested.some(item=>['AGRONOMY','GEO'].includes(item)),
  relationship:legacyBootstrap||requested.some(item=>['VISIT','COMMERCIAL','GRAINS','CREDIT','OPPORTUNITY'].includes(item)),
  behavioral:legacyBootstrap||requested.some(item=>['PROFILE','VISIT'].includes(item))
 })
}

const intrinsicCollectionDomains=Object.freeze({
 business_event:['COMMERCIAL'],opportunity:['OPPORTUNITY','COMMERCIAL'],interaction:['VISIT','COMMERCIAL'],visit:['VISIT'],commitment:['VISIT','COMMERCIAL'],
 property:['GEO','AGRONOMY'],field_report:['AGRONOMY'],soil_analysis:['AGRONOMY'],ndvi_observation:['AGRONOMY'],manual_record:[],attachment:[]
})

// Dominios auxiliares que podem aparecer legitimamente no mesmo registro sem
// ampliar a pergunta. Por exemplo, um contrato de graos e comercial por
// natureza; isso nao autoriza o mesmo chunk a carregar credito ou agronomia.
const compatibleDomains=Object.freeze({
 PROFILE:new Set(['PROFILE','COMMERCIAL','VISIT']),
 COMMERCIAL:new Set(['COMMERCIAL','OPPORTUNITY','VISIT']),
 AGRONOMY:new Set(['AGRONOMY','GEO']),
 GRAINS:new Set(['GRAINS','COMMERCIAL','OPPORTUNITY','VISIT']),
 CREDIT:new Set(['CREDIT','COMMERCIAL','OPPORTUNITY','VISIT']),
 GEO:new Set(['GEO','AGRONOMY']),
 VISIT:new Set(['VISIT','COMMERCIAL','OPPORTUNITY']),
 OPPORTUNITY:new Set(['OPPORTUNITY','COMMERCIAL','VISIT'])
})

function domainsFitRequest(itemDomains,selected,requested){
 if(selected==='GENERAL')return true
 const requestedSet=new Set(requested)
 const allowed=new Set(requested)
 for(const requestedDomain of requestedSet)for(const compatible of compatibleDomains[requestedDomain]||[])allowed.add(compatible)
 return itemDomains.every(itemDomain=>allowed.has(itemDomain))
}

export function collectionMatchesContextDomain(item={},sourceType='',domain='GENERAL',query=''){
 const selected=valContextDomains.includes(domain)?domain:'GENERAL'
 if(selected==='PROFILE')return false
 if(selected==='GENERAL')return !clean(query)
 const type=clean(sourceType,100).toLowerCase()
 const intrinsic=intrinsicCollectionDomains[type]||[]
 // "comparativo" em next_action é um atributo comercial da oportunidade,
 // não uma autorização para tratá-la como memória de perfil. PROFILE não
 // aceita coleções, portanto o rótulo semântico pode ser retirado aqui.
 const semantic=recordSemanticDomains({key:type,source_type:type,content:item}).filter(itemDomain=>itemDomain!=='PROFILE')
 const itemDomains=[...new Set([...intrinsic,...semantic])]
 const requested=selected==='MULTI_DOMAIN'?matchedValContextDomains(query):[selected]
 // A consulta de visita seleciona o evento pela sua entidade/tipo. O assunto
 // relatado dentro da visita (agronomia, grãos, crédito etc.) não transforma
 // o próprio evento em contexto órfão nem autoriza outras coleções.
 if(selected==='VISIT'&&intrinsic.includes('VISIT'))return true
 const evidence=Array.isArray(item?.evidence)?item.evidence:[]
 const linkedToConfirmedVisit=Boolean(item?.visit_id??item?.visitId)||evidence.some(ref=>clean(ref?.type??ref?.source_type??ref?.sourceType,100).toLowerCase()==='confirmed_visit_report')
 // Uma oportunidade explicitamente derivada da visita confirmada é contexto
 // legítimo da preparação seguinte, ainda que sua categoria seja agronômica.
 if(selected==='VISIT'&&intrinsic.includes('OPPORTUNITY')&&linkedToConfirmedVisit)return true
 // A pergunta de oportunidade seleciona a oportunidade pela sua entidade/tipo, como a de visita.
 // O dominio intrinseco da oportunidade inclui COMMERCIAL e o titulo pode citar safra ou credito;
 // nada disso pode vetar o proprio registro perguntado ("ele tem oportunidade aberta?" respondia
 // "ainda nao ha oportunidade registrada" com a oportunidade em Proposta no contexto).
 if(selected==='OPPORTUNITY'&&intrinsic.includes('OPPORTUNITY'))return true
 if(!domainsFitRequest(itemDomains,selected,requested))return false
 if(selected==='GRAINS'||selected==='CREDIT')return semantic.includes(selected)
 if(selected==='GEO')return intrinsic.includes('GEO')||semantic.includes('GEO')
 if(selected==='AGRONOMY')return intrinsic.includes('AGRONOMY')||semantic.includes('AGRONOMY')
 if(selected==='VISIT')return semantic.includes('VISIT')
 if(selected==='OPPORTUNITY')return intrinsic.includes('OPPORTUNITY')||semantic.includes('OPPORTUNITY')
 if(selected==='COMMERCIAL'){
  if(semantic.some(itemDomain=>['GRAINS','CREDIT'].includes(itemDomain))&&!matchedValContextDomains(query).some(itemDomain=>['GRAINS','CREDIT'].includes(itemDomain)))return false
  return intrinsic.includes('COMMERCIAL')||semantic.includes('COMMERCIAL')||semantic.includes('OPPORTUNITY')
 }
 if(selected==='MULTI_DOMAIN')return itemDomains.some(itemDomain=>requested.includes(itemDomain))
 return false
}

const producerAliasKeys=Object.freeze(['producerId','producer_id','clientId','client_id','subject_client_id'])
const tenantAliasKeys=Object.freeze(['tenantId','tenant_id','organizationId','organization_id'])
const ownerAliasKeys=Object.freeze(['contextOwnerId','context_owner_id','consultantId','consultant_id','createdBy','created_by','ownerId','owner_id'])

const aliasEntries=(value,keys)=>plainAliasObject(value)?keys.flatMap(key=>{
 const candidate=clean(value[key],180)
 return candidate?[[key,candidate]]:[]
}):[]
const plainAliasObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const producerAliasEntries=value=>{
 const entries=aliasEntries(value,producerAliasKeys)
 const subjectType=clean(value?.subjectType??value?.subject_type,80).toLowerCase()
 const subjectId=clean(value?.subjectId??value?.subject_id,180)
 if(subjectType==='client'&&subjectId)entries.push(['subject_id',subjectId])
 return entries
}
const distinctAliasValues=entries=>[...new Set(entries.map(([,value])=>value))]
const aliasConflict=(kind,entries)=>{
 const values=distinctAliasValues(entries)
 if(values.length<=1)return
 throw Object.assign(new Error(`Aliases de escopo ${kind.toLowerCase()} são conflitantes.`),{
  code:'CONTEXT_SCOPE_VIOLATION',reason:`${kind}_ALIAS_CONFLICT`,aliases:entries.map(([key])=>key)
 })
}

/**
 * A primeira leitura de um alias nunca pode esconder um segundo identificador
 * divergente no mesmo payload. Esta asserção é usada tanto no ingresso das
 * coleções quanto na validação do snapshot já montado.
 */
export function assertContextScopeAliases(value={}){
 if(!plainAliasObject(value))return true
 aliasConflict('PRODUCER',producerAliasEntries(value))
 aliasConflict('TENANT',aliasEntries(value,tenantAliasKeys))
 aliasConflict('OWNER',aliasEntries(value,ownerAliasKeys))
 return true
}

const producerIdOf=value=>{
 assertContextScopeAliases(value)
 return distinctAliasValues(producerAliasEntries(value))[0]||''
}
const tenantIdOf=value=>{
 assertContextScopeAliases(value)
 return distinctAliasValues(aliasEntries(value,tenantAliasKeys))[0]||''
}
const ownerIdOf=value=>{
 assertContextScopeAliases(value)
 return distinctAliasValues(aliasEntries(value,ownerAliasKeys))[0]||''
}
const globalScopeMarker=value=>clean(value?.scope??value?.context_scope??value?.knowledge_scope??value?.knowledgeScope??value?.entityType??value?.entity_type??value?.subject_type,80).toUpperCase()
export const explicitlyGlobalContext=value=>['GLOBAL','MARKET','GENERAL_KNOWLEDGE'].includes(globalScopeMarker(value))

export function assertActiveProducerBoundary(items=[],activeProducerId='',scope={}){
 const requested=typeof activeProducerId==='object'&&activeProducerId!==null?activeProducerId:{...scope,producerId:activeProducerId}
 const expected=clean(requested.producerId??requested.activeProducerId,180)
 const expectedTenant=clean(requested.tenantId,180)
 const expectedOwner=clean(requested.ownerId,180)
 if(!expected)throw Object.assign(new Error('O produtor ativo é obrigatório para validar contexto produtor-específico.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_ACTIVE_PRODUCER'})
 for(const item of Array.isArray(items)?items:[]){
  assertContextScopeAliases(item)
  assertContextScopeAliases(item?.data)
  const outerProducer=producerIdOf(item);const innerProducer=producerIdOf(item?.data)
  const outerTenant=tenantIdOf(item);const innerTenant=tenantIdOf(item?.data)
  const outerOwner=ownerIdOf(item);const innerOwner=ownerIdOf(item?.data)
  const actual=outerProducer||innerProducer
  const tenant=outerTenant||innerTenant
  const owner=outerOwner||innerOwner
  const outerMarker=globalScopeMarker(item);const innerMarker=globalScopeMarker(item?.data)
  const marker=outerMarker||innerMarker
  const sourceType=clean(item?.source_type??item?.sourceType??item?.data?.source_type??item?.data?.sourceType,120).toLowerCase()
  const global=explicitlyGlobalContext(item)||explicitlyGlobalContext(item?.data)
  if(outerProducer&&innerProducer&&outerProducer!==innerProducer)throw Object.assign(new Error('O payload interno pertence a outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_PRODUCER_MISMATCH',expectedProducerId:outerProducer,actualProducerId:innerProducer})
  if(outerTenant&&innerTenant&&outerTenant!==innerTenant)throw Object.assign(new Error('O payload interno pertence a outro tenant.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_TENANT_MISMATCH',expectedTenantId:outerTenant,actualTenantId:innerTenant})
  if(outerOwner&&innerOwner&&outerOwner!==innerOwner)throw Object.assign(new Error('O payload interno pertence a outro owner.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_OWNER_MISMATCH',expectedOwnerId:outerOwner,actualOwnerId:innerOwner})
  if(outerMarker&&innerMarker&&outerMarker!==innerMarker)throw Object.assign(new Error('O payload interno possui marcadores de escopo conflitantes.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'NESTED_GLOBAL_SCOPE_MISMATCH'})
  if(sourceType==='market_snapshot'&&marker!=='MARKET')throw Object.assign(new Error('Referência de mercado sem marcador MARKET de origem.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:marker?'MARKET_SCOPE_MISMATCH':'MISSING_MARKET_SCOPE',actualScope:marker||null})
  if(marker==='MARKET'&&!expectedTenant)throw Object.assign(new Error('Contexto MARKET exige tenant ativo para comparação exata.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_TENANT_SCOPE'})
  if(marker==='MARKET'&&!expectedOwner)throw Object.assign(new Error('Contexto MARKET exige owner ativo para comparação exata.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_OWNER_SCOPE'})
  // GLOBAL dispensa somente o producer_id porque o sujeito é não individual;
  // um produtor presente no registro global é sempre contaminação de escopo.
  if(global&&actual)throw Object.assign(new Error('Contexto global não pode carregar produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'GLOBAL_WITH_PRODUCER_ID',actualProducerId:actual})
  if(!global&&(!actual||actual!==expected)){
   throw Object.assign(new Error('Contexto produtor-específico fora do produtor ativo.'),{
    code:'CONTEXT_SCOPE_VIOLATION',reason:actual?'PRODUCER_MISMATCH':'MISSING_PRODUCER_SCOPE',expectedProducerId:expected,actualProducerId:actual||null
   })
  }
  if(expectedTenant&&(!tenant||tenant!==expectedTenant))throw Object.assign(new Error('Contexto fora do tenant ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:tenant?'TENANT_MISMATCH':'MISSING_TENANT_SCOPE',expectedTenantId:expectedTenant,actualTenantId:tenant||null})
  if(expectedOwner&&(!owner||owner!==expectedOwner))throw Object.assign(new Error('Contexto fora do owner ativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:owner?'OWNER_MISMATCH':'MISSING_OWNER_SCOPE',expectedOwnerId:expectedOwner,actualOwnerId:owner||null})
 }
 return true
}

const traceHash=value=>`sha256:${createHash('sha256').update(clean(value,1000)).digest('hex').slice(0,20)}`
const traceId=value=>{
 const candidate=clean(value,240)
 if(!candidate)return 'unknown'
 if(['GLOBAL','MARKET','GENERAL_KNOWLEDGE'].includes(candidate.toUpperCase()))return candidate.toUpperCase()
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate))return candidate.toLowerCase()
 if(/^(?:producer|client|tenant|owner|consultant|organization)-[a-z0-9][a-z0-9_.-]{0,119}$/i.test(candidate))return candidate
 if(/^[a-z][a-z0-9_.-]{1,60}:[a-z0-9][a-z0-9_.:-]{0,178}$/i.test(candidate))return candidate
 return traceHash(candidate)
}
const traceCode=value=>clean(value,180).toUpperCase().replace(/[^A-Z0-9_,:.-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,180)||null
const traceTimestamp=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?null:parsed.toISOString()}

export function contextTraceEntry({sourceType,sourceId,producerId,tenantId,ownerId,timestamp,relevanceScore=null,reasonSelected='',status='SELECTED'}={}){
 return Object.freeze({
  sourceType:traceCode(sourceType)?.toLowerCase()||'unknown',sourceId:traceId(sourceId),
  producerId:traceId(producerId),tenantId:traceId(tenantId),ownerId:ownerId?traceId(ownerId):null,
  timestamp:traceTimestamp(timestamp),relevanceScore:Number.isFinite(Number(relevanceScore))?Number(Number(relevanceScore).toFixed(4)):null,
  reasonSelected:traceCode(reasonSelected),status:status==='REJECTED'?'REJECTED':'SELECTED'
 })
}
