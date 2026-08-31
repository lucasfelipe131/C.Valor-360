import {createHash,randomUUID} from 'node:crypto'
import {isCurrentClientIdentityRequest,routeValIntent} from '../ai-reasoning/intent-router.js'
import {legacyVisitLifecycle} from '../visit-loop/lifecycle.js'
import {evaluateSourceFreshness} from '../memory/freshness-policy.js'
import {assertResponseGrounding,assertResponseQuestionRelevance} from './response-grounding.js'
import {assertActiveProducerBoundary,classifyValContextDomain,matchedValContextDomains} from './context-selector.js'

export const systemCapabilityRouterVersion='val.system_capability_router.v1'
export const reasoningPathVersion='val.fast_deep_reasoning.v1'
export const reasoningPathsArchitectureVersion='val.reasoning_paths.v2'
export const reasoningPaths=Object.freeze(['FAST','CONTEXT','DEEP','TOOL','LIVE_DATA'])

export const systemCapabilities=Object.freeze([
 'CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','VISIT_HISTORY','OPPORTUNITY_PIPELINE',
 'AGRONOMIC_WORKSPACE','SOIL_ANALYSIS','IMAGE_DIAGNOSIS','CALCULATORS','LABELS','WEATHER',
 'MARKET_COMMODITY','KNOWLEDGE_LIBRARY','AGRONOMIST_MANUAL','VOICE_INPUT','VOICE_OUTPUT',
 'AREA_MAPPING','NUTRISCAN','FITOSCAN','SESSION_COMMAND'
])

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=2000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,4000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const commodityLabels={soja:'Soja',milho:'Milho',trigo:'Trigo',sorgo:'Sorgo',feijao:'Feijão',arroz:'Arroz',cevada:'Cevada'}
const marketKindLabels={spot:'disponível (spot)',forward:'a termo (forward)',futures:'futuro (futures)'}
const clientIndependent=new Set(['ASK_GENERAL','ASK_MARKET','ASK_COMMODITY','CHECK_MARKET','CHECK_WEATHER','CHECK_LABEL'])
const responseDomains=new Set(['PROFILE','COMMERCIAL','AGRONOMY','GRAINS','CREDIT','GEO','VISIT','OPPORTUNITY','GENERAL','MULTI_DOMAIN'])
const producerScopeKeys=Object.freeze(['producer_id','producerId','client_id','clientId','subject_client_id'])
const tenantScopeKeys=Object.freeze(['tenant_id','tenantId','organization_id','organizationId'])
const ownerScopeKeys=Object.freeze(['context_owner_id','contextOwnerId','consultant_id','consultantId','owner_id','ownerId','created_by','createdBy'])
const marketScopeKeys=Object.freeze(['scope','context_scope','knowledge_scope','knowledgeScope'])
const exactContextEpoch=value=>{
 const epoch=Number.isSafeInteger(value)&&value>=0?value:null
 if(epoch===null)throw Object.assign(new Error('contextEpoch deve ser um inteiro seguro não negativo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'INVALID_CONTEXT_EPOCH'})
 return epoch
}

const scopeValues=(value,keys)=>[...new Set(keys.map(key=>clean(value?.[key],180)).filter(Boolean))]
function rawScopeValue(value,keys,kind){
 const values=scopeValues(value,keys)
 if(values.length>1)throw Object.assign(new Error(`Aliases de escopo ${kind.toLowerCase()} são conflitantes.`),{code:'CONTEXT_SCOPE_VIOLATION',reason:`${kind}_ALIAS_CONFLICT`})
 return values[0]||''
}
function rawMarketScope(value={}){
 const values=scopeValues(value,marketScopeKeys).map(item=>item.toUpperCase())
 if(values.length>1)throw Object.assign(new Error('Aliases do marcador de mercado são conflitantes.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MARKET_SCOPE_ALIAS_CONFLICT'})
 return values[0]||''
}

/**
 * Dados de mercado podem chegar sem os aliases removidos pelo mapper do
 * repositório autenticado. Quando um alias está presente, porém, ele nunca
 * pode ser ignorado ou relabelado como pertencente ao request atual.
 */
function assertRawRecordScope(record={},scope={},options={}){
 const expectedTenant=clean(scope.tenantId,180)
 const expectedOwner=clean(scope.ownerId,180)
 const expectedProducer=clean(scope.producerId,180)
 const actualTenant=rawScopeValue(record,tenantScopeKeys,'TENANT')
 const actualOwner=rawScopeValue(record,ownerScopeKeys,'OWNER')
 const actualProducer=rawScopeValue(record,producerScopeKeys,'PRODUCER')
 const marketScope=options.global===true?rawMarketScope(record):''
 if(actualTenant&&actualTenant!==expectedTenant)throw Object.assign(new Error('O registro pertence a outro tenant.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'TENANT_MISMATCH',expectedTenantId:expectedTenant,actualTenantId:actualTenant})
 if(actualOwner&&actualOwner!==expectedOwner)throw Object.assign(new Error('O registro pertence a outro owner.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'OWNER_MISMATCH',expectedOwnerId:expectedOwner,actualOwnerId:actualOwner})
 if(options.global===true&&actualProducer)throw Object.assign(new Error('Uma referência global de mercado não pode carregar produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'GLOBAL_WITH_PRODUCER_ID',actualProducerId:actualProducer})
 if(options.global===true&&marketScope!=='MARKET')throw Object.assign(new Error('Uma referência global de mercado exige marcador MARKET de origem.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:marketScope?'MARKET_SCOPE_MISMATCH':'MISSING_MARKET_SCOPE',actualScope:marketScope||null})
 if(expectedProducer&&actualProducer&&actualProducer!==expectedProducer)throw Object.assign(new Error('O registro pertence a outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'PRODUCER_MISMATCH',expectedProducerId:expectedProducer,actualProducerId:actualProducer})
 if(options.requireTenant===true&&!actualTenant)throw Object.assign(new Error('O registro não possui tenant comprovável.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_TENANT_SCOPE',expectedTenantId:expectedTenant})
 if(options.requireOwner===true&&!actualOwner)throw Object.assign(new Error('O registro não possui owner comprovável.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_OWNER_SCOPE',expectedOwnerId:expectedOwner})
 if(options.requireProducer===true&&!actualProducer)throw Object.assign(new Error('O registro produtor-específico não possui produtor comprovável.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_PRODUCER_SCOPE',expectedProducerId:expectedProducer})
 return Object.freeze({tenantId:actualTenant,ownerId:actualOwner,producerId:actualProducer||null,scope:marketScope||null})
}

function assertMarketWorkspaceScope(workspace={},scope={}){
 for(const snapshot of list(workspace?.marketSnapshots))assertRawRecordScope(snapshot,scope,{global:true,requireTenant:true,requireOwner:true})
 return workspace
}

function canonicalEvidence({id,sourceType,statement,observedAt=null,validUntil=null,epistemicType='FACT',scope={},global=false,confidence=null,relevanceScore=1,reasonSelected='DIRECTLY_RELEVANT'}={}){
 const sourceId=clean(id,180)
 const producerId=rawScopeValue(scope,producerScopeKeys,'PRODUCER')
 const tenantId=rawScopeValue(scope,tenantScopeKeys,'TENANT')
 const ownerId=rawScopeValue(scope,ownerScopeKeys,'OWNER')
 const marketScope=global?rawMarketScope(scope):''
 if(global&&marketScope!=='MARKET')throw Object.assign(new Error('A evidência global não possui marcador MARKET de origem.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:marketScope?'MARKET_SCOPE_MISMATCH':'MISSING_MARKET_SCOPE'})
 if(global&&producerId)throw Object.assign(new Error('A evidência global não pode carregar produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'GLOBAL_WITH_PRODUCER_ID',actualProducerId:producerId})
 if(!tenantId)throw Object.assign(new Error('A evidência não possui tenant original.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_TENANT_SCOPE'})
 if(!ownerId)throw Object.assign(new Error('A evidência não possui owner original.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_OWNER_SCOPE'})
 const result={
  id:sourceId,source_id:sourceId,source_type:clean(sourceType,120).toLowerCase(),epistemic_type:clean(epistemicType,40).toUpperCase(),statement:clean(statement,1800),
  observed_at:observedAt||null,valid_until:validUntil||null,confidence,
  producer_id:global?null:producerId,tenant_id:tenantId,context_owner_id:ownerId,
  relevance_score:Number.isFinite(Number(relevanceScore))?Number(relevanceScore):null,reason_selected:clean(reasonSelected,180)
 }
 if(global)result.scope=marketScope
 if(!result.valid_until)delete result.valid_until
 return result
}

function scopedMarketEvidence(market={}){
 if(!market.source?.id)return []
 return [canonicalEvidence({
  id:market.source.id,sourceType:'market_snapshot',statement:market.answer,observedAt:market.source.observed_at,epistemicType:'FACT',scope:market.source,global:true,
  confidence:market.confidence?.score,relevanceScore:1,reasonSelected:'CURRENT_MARKET_REFERENCE'
 })]
}

function assertEvidenceProvenance(items=[],scope={},question='',now=new Date()){
 for(const item of list(items))assertResponseGrounding({
  question,answer:item.statement,domain:classifyValContextDomain(item.statement),evidence:[item],
  activeProducerId:item.scope==='MARKET'?'':scope.producerId||'',tenantId:scope.tenantId||'',ownerId:scope.ownerId||'',now,checkQuestionRelevance:false
 })
 return items
}

function scopedResponseDomain(message='',intent='',declared=''){
 const inferred=classifyValContextDomain(message,intent)
 const explicit=clean(declared,40).toUpperCase()
 if(explicit&&(!responseDomains.has(explicit)||explicit!==inferred))throw Object.assign(new Error('O domínio declarado da resposta não corresponde à pergunta atual.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'DOMAIN_MISMATCH',expectedDomain:inferred,actualDomain:explicit})
 return inferred
}

function commodityFrom(message=''){
 const source=normalize(message)
 let selected='';let selectedAt=-1
 for(const commodity of Object.keys(commodityLabels)){
  const matcher=new RegExp(`\\b${commodity}\\b`,'g');let match
  while((match=matcher.exec(source))){if(match.index>=selectedAt){selected=commodity;selectedAt=match.index}}
 }
 return selected
}

function marketKindFrom(message=''){
 const source=normalize(message)
 const explicit=[
  ['forward',/\b(?:a\s+termo|forward|contrato\s+a\s+termo|entrega\s+futura)\b/g],
  ['futures',/\b(?:futures|mercado\s+futuro|contrato\s+futuro|bolsa|vencimento)\b/g],
  ['spot',/\b(?:spot|disponivel|fisico|balcao)\b/g]
 ]
 let selected='';let selectedAt=-1
 for(const [kind,pattern] of explicit){for(const match of source.matchAll(pattern)){if(match.index>=selectedAt){selected=kind;selectedAt=match.index}}}
 if(selected)return selected
 if(/\b(?:hoje|agora|neste\s+momento)\b/.test(source))return 'spot'
 return /\b(?:cotacao|preco|mercado)\b/.test(source)&&canonicalSeason(source)?'forward':''
}

function priceUnitFrom(message=''){
 const source=normalize(message)
 if(/\b(?:por\s+tonelada|toneladas?|brl\s*\/\s*t|r\$\s*\/\s*t|reais?\s+por\s+tonelada)\b/.test(source))return 'BRL/t'
 if(/\b(?:por\s+saca|sacas?|sc(?:\s+de\s+60\s*kg)?|brl\s*\/\s*sc|r\$\s*\/\s*sc|reais?\s+por\s+saca)\b/.test(source))return 'BRL/sc_60kg'
 return ''
}

function regionFrom(message='',snapshots=[]){
 const source=normalize(message)
 const known=list(snapshots).map(item=>clean(item?.region,120)).filter(Boolean).flatMap(region=>{
  const full=normalize(region);const primary=full.split(/[\/,;|-]/)[0].trim()
  return [{requested:full,match:full},...(primary.length>=3&&primary!==full?[{requested:primary,match:primary}]:[])]
 }).filter(item=>new RegExp(`(?:^|[^a-z0-9])${item.match.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^a-z0-9])`).test(source)).sort((left,right)=>right.match.length-left.match.length)
 if(known[0])return known[0].requested
 const explicit=source.match(/\b(?:praca|regiao)(?:\s+de)?\s+([a-z][a-z0-9 '\/-]{1,80}?)(?=\s+(?:hoje|agora|neste momento|safra|para entrega|com entrega|por saca|por tonelada)\b|[?,.;]|$)/)
 if(explicit)return explicit[1].trim()
 const located=source.match(/\bem\s+([a-z][a-z '\/-]{1,60}?)(?=\s+(?:hoje|agora|neste momento|safra|para entrega|com entrega|por saca|por tonelada)\b|[?,.;]|$)/)
 const candidate=located?.[1]?.trim()||''
 return /\/[a-z]{2}$/.test(candidate)?candidate:''
}

function sameRegion(itemRegion='',requestedRegion=''){
 if(!requestedRegion)return true
 const item=normalize(itemRegion);const requested=normalize(requestedRegion)
 return item===requested||item.startsWith(`${requested}/`)||requested.startsWith(`${item}/`)
}

function dateOnly(value){
 const raw=clean(value,40).slice(0,10)
 return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:''
}

function dateRangeFrom(message='',season=''){
 const source=normalize(message)
 const dates=[]
 for(const match of source.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g)){
  const day=String(Number(match[1])).padStart(2,'0');const month=String(Number(match[2])).padStart(2,'0')
  dates.push(`${match[3]}-${month}-${day}`)
 }
 for(const match of source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))dates.push(`${match[1]}-${match[2]}-${match[3]}`)
 if(dates.length){const ordered=[...new Set(dates)].sort();return {start:ordered[0],end:ordered.at(-1),source:'explicit_date'}}
 const months={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12}
 for(const [label,month] of Object.entries(months)){
  const match=source.match(new RegExp(`\\b${label}\\s+(?:de\\s+)?(20\\d{2})\\b`))
  if(!match)continue
  const start=`${match[1]}-${String(month).padStart(2,'0')}-01`
  const endDate=new Date(Date.UTC(Number(match[1]),month,0)).getUTCDate()
  return {start,end:`${match[1]}-${String(month).padStart(2,'0')}-${endDate}`,source:'month'}
 }
 if(season){const [startYear,endSuffix]=season.split('/');const endYear=`${startYear.slice(0,2)}${endSuffix}`;return {start:`${startYear}-07-01`,end:`${endYear}-06-30`,source:'season'}}
 return null
}

function overlapsRange(item={},range=null){
 if(!range)return true
 const start=dateOnly(item.deliveryStart??item.delivery_start);const end=dateOnly(item.deliveryEnd??item.delivery_end)||start
 if(!start&&!end)return false
 const first=start||end;const last=end||start
 return first<=range.end&&last>=range.start
}

function materialityFor({path,intent,source,capabilities,attachmentTypes=[]}={}){
 const crossDomain=/\b(?:cruz|compare|estrateg|alternativ|historico.*(?:agronom|preco)|agronom.*(?:historico|preco)|perfil.*mercado)\w*\b/.test(source)
 const explanatory=/\b(?:por que|explique|o que voce faria|recomenda|estrategia|muda a decisao)\b/.test(source)
 const toolNeedsInterpretation=['ANALYZE_SOIL','IMAGE_DIAGNOSIS'].includes(intent)||attachmentTypes.length>0
 if(path==='FAST')return {engine_required:false,score:0,reason:'A resposta é uma leitura literal e determinística de um fato autorizado.'}
 if(path==='LIVE_DATA')return {engine_required:false,score:.15,reason:'A fonte atual deve responder primeiro; raciocínio só ocorre se o usuário pedir impacto ou comparação.'}
 if(path==='TOOL')return {engine_required:toolNeedsInterpretation||explanatory,score:toolNeedsInterpretation?.72:.25,reason:toolNeedsInterpretation?'A saída da ferramenta precisa de interpretação governada.':'A ferramenta ou o deep-link resolvem o pedido sem inventar análise.'}
 if(path==='CONTEXT')return {engine_required:true,score:.55,reason:'A resposta muda com um subconjunto material do contexto da conta.'}
 return {engine_required:true,score:crossDomain?1:.82,reason:'A decisão exige cruzamento de múltiplos domínios, hipóteses ou evidências.'}
}

export function assessEngineMateriality(input={}){
 const materiality=materialityFor(input)
 return Object.freeze({...materiality,question:'Isso pode mudar materialmente a resposta?'})
}

export function classifyStructuredClientFact(message=''){
 const source=normalize(message).replace(/[?!.,;:]+$/g,'').trim()
 if(!source)return null
 // Fact First is a positive allowlist of complete literal questions. A mixed,
 // advisory, aggregate or prospective request must remain contextual/deep even
 // when it contains one of the same nouns.
 if(/^(?:agora\s+)?(?:compara|compare)\s+(?:os dois|ambos|essas duas contas|esses dois produtores)$/.test(source))return 'CLIENT_COMPARISON'
 if(/\s+e\s+(?:o\s+que|como|por\s+que|qual|quais|quando|onde|se|devo|deveria|posso|poderia|abra|mostre|prepare|calcule|analise|registre)\b/.test(source))return null
 const owner='(?:\\s+(?:dele|dela)|\\s+(?:do|da)\\s+[a-z][a-z0-9 \'-]{0,120})?'
 if(new RegExp(`^(?:e\\s+)?(?:(?:qual|como)\\s+(?:e\\s+)?(?:o\\s+)?perfil${owner}|(?:mostre|mostra|me\\s+mostre)\\s+(?:o\\s+)?perfil${owner})$`).test(source))return 'BEHAVIORAL_PROFILE'
 if(new RegExp(`^(?:e\\s+)?(?:qual\\s+(?:(?:foi|e)\\s+)?(?:a\\s+)?)?objecao\\s+(?:da|na)\\s+(?:ultima|mais recente)\\s+visita${owner}$`).test(source))return 'LATEST_VISIT_CONFIRMED_OBJECTION'
 if(new RegExp(`^(?:e\\s+)?(?:qual\\s+(?:(?:foi|e)\\s+)?(?:a\\s+)?)?(?:(?:ultima|mais recente)\\s+objecao\\s+confirmada|objecao\\s+confirmada\\s+(?:mais recente|ultima))${owner}$`).test(source))return 'LATEST_CONFIRMED_OBJECTION'
 const patterns=[
  ['LATEST_CONFIRMED_OBJECTION',new RegExp(`^(?:e\\s+)?(?:(?:qual\\s+(?:(?:foi|e)\\s+)?(?:a\\s+)?(?:(?:principal|ultima|mais recente)\\s+)?objecao)|(?:(?:mostre|mostra|me\\s+mostre)\\s+(?:a\\s+)?(?:(?:principal|ultima|mais recente)\\s+)?objecao)|(?:(?:a\\s+)?(?:principal|ultima|mais recente)\\s+objecao))${owner}$`)],
  ['LATEST_VISIT',new RegExp(`^(?:e\\s+)?(?:(?:(?:qual|quando)\\s+(?:(?:foi|e)\\s+)?(?:a\\s+)?(?:(?:ultima|mais recente)\\s+visita|visita\\s+mais recente))|(?:(?:mostre|mostra|me\\s+mostre)\\s+(?:a\\s+)?(?:(?:ultima|mais recente)\\s+visita|visita\\s+mais recente))|(?:(?:a\\s+)?(?:ultima|mais recente)\\s+visita))${owner}$`)],
  ['LATEST_COMMITMENT',new RegExp(`^(?:e\\s+)?(?:(?:qual\\s+(?:(?:foi|e)\\s+)?(?:o\\s+)?(?:(?:ultimo|mais recente)\\s+)?compromisso)|(?:(?:mostre|mostra|me\\s+mostre)\\s+(?:o\\s+)?(?:ultimo|mais recente)\\s+compromisso)|(?:(?:o\\s+)?(?:ultimo|mais recente)\\s+compromisso))${owner}$`)],
  ['LATEST_PURCHASE',new RegExp(`^(?:e\\s+)?(?:(?:(?:qual|quanto)\\s+(?:(?:foi|e)\\s+)?(?:a\\s+)?(?:ultima|mais recente)\\s+compra)|(?:(?:mostre|mostra|me\\s+mostre)\\s+(?:a\\s+)?(?:ultima|mais recente)\\s+compra)|(?:(?:a\\s+)?(?:ultima|mais recente)\\s+compra)|(?:quanto\\s+(?:ele|ela|o produtor|a produtora)\\s+comprou))${owner}$`)],
  ['REGISTERED_CROPS',/^(?:e\s+)?(?:(?:qual|quais)\s+culturas?\s+(?:(?:ele|ela)\s+(?:esta\s+plantando|planta)|(?:estao?|ficam?)\s+cadastradas?|(?:do|da)\s+[a-z][a-z0-9 '-]{0,120}\s+(?:esta\s+plantando|planta|(?:tem|estao?)\s+cadastradas?))|(?:mostre|mostra|me\s+mostre)\s+(?:as?\s+)?(?:culturas?|safra)\s+(?:dele|dela|(?:do|da)\s+[a-z][a-z0-9 '-]{0,120}))$/],
  ['REGISTERED_AREA',/^(?:e\s+)?(?:(?:qual|quanto)\s+(?:e\s+)?(?:a\s+)?area(?:\s+(?:dele|dela)|\s+(?:do|da)\s+[a-z][a-z0-9 '-]{0,120})?\s+(?:esta\s+)?cadastrada|qual\s+(?:e\s+)?(?:a\s+)?area\s+(?:cadastrada|registrada)(?:\s+(?:dele|dela)|\s+(?:do|da)\s+[a-z][a-z0-9 '-]{0,120})?|(?:mostre|mostra|me\s+mostre)\s+(?:a\s+)?area\s+(?:dele|dela|(?:do|da)\s+[a-z][a-z0-9 '-]{0,120}))$/],
 ]
 for(const [dataPath,pattern] of patterns)if(pattern.test(source))return dataPath
 return null
}

export function routeSystemCapability({message='',intentHint='',sessionCommandHint='',hasClient=false,attachmentTypes=[],activeContext=null}={}){
 const intentRoute=routeValIntent({message,intentHint,sessionCommandHint,hasClient,attachmentTypes})
 const source=normalize(message)
 const structuredFactCandidate=attachmentTypes.length===0?classifyStructuredClientFact(message):null
 const structuredFactEligible=['ASK_CLIENT','OBJECTION_HELP'].includes(intentRoute.intent)||structuredFactCandidate==='REGISTERED_CROPS'
 const structuredFact=intentRoute.session_command||!hasClient||!structuredFactEligible?null:structuredFactCandidate
 const capabilities=[]
 let path='DEEP'
 let direct=false
 let dataPath=null

 if(intentRoute.session_command){
  capabilities.push('SESSION_COMMAND')
  if(intentRoute.session_command.command==='DEEPEN'){
   capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','AGRONOMIC_WORKSPACE','KNOWLEDGE_LIBRARY');path='DEEP';direct=false
  }else if(intentRoute.session_command.deterministic_follow_up){
   path='FAST';direct=true
  }else path='FAST',direct=true
 }else if(structuredFact){
  const selected=structuredFact==='CLIENT_COMPARISON'
   ?['CLIENT_CONTEXT','VISIT_HISTORY','COMMERCIAL_HISTORY']
   :[structuredFact==='BEHAVIORAL_PROFILE'
    ?'CLIENT_CONTEXT'
    :structuredFact==='LATEST_VISIT'||structuredFact==='LATEST_CONFIRMED_OBJECTION'||structuredFact==='LATEST_VISIT_CONFIRMED_OBJECTION'
    ?'VISIT_HISTORY'
    :structuredFact==='LATEST_PURCHASE'||structuredFact==='LATEST_COMMITMENT'
     ?'COMMERCIAL_HISTORY'
     :'CLIENT_CONTEXT']
  capabilities.push(...selected);path='FAST';direct=true;dataPath=structuredFact
 }else if(intentRoute.intent==='ASK_CLIENT'&&isCurrentClientIdentityRequest(source)){
  capabilities.push('CLIENT_CONTEXT');path='FAST';direct=true
 }else if(intentRoute.intent==='ASK_CLIENT'&&/\b(?:quem decide|decisor|compromisso (?:esta )?aberto|qual compromisso|resume (?:a )?conta)\b/.test(source)){
  capabilities.push('CLIENT_CONTEXT',/compromisso/.test(source)?'COMMERCIAL_HISTORY':'CONFIRMED_MEMORY');path='FAST';direct=true
 }else if(['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET'].includes(intentRoute.intent)){
  capabilities.push('MARKET_COMMODITY')
  const crossAccount=hasClient&&/\b(?:muda|impacta|conversa|abordagem|oportunidades?|negociacao|produtor|conta)\b/.test(source)
  if(crossAccount)capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','OPPORTUNITY_PIPELINE')
  if(attachmentTypes.length)capabilities.push(attachmentTypes.some(type=>String(type).startsWith('image/'))?'IMAGE_DIAGNOSIS':'KNOWLEDGE_LIBRARY')
  path=crossAccount||attachmentTypes.length?'DEEP':'LIVE_DATA'
  dataPath='LIVE_DATA';direct=!crossAccount&&!attachmentTypes.length
 }else if(intentRoute.intent==='CHECK_WEATHER'){
  capabilities.push('WEATHER');path='LIVE_DATA';direct=true
 }else if(intentRoute.intent==='CHECK_LABEL'){
  capabilities.push('LABELS','AGRONOMIST_MANUAL');path='LIVE_DATA';direct=true
 }else if(intentRoute.intent==='CHECK_OPPORTUNITY'){
  capabilities.push('OPPORTUNITY_PIPELINE','COMMERCIAL_HISTORY');path='DEEP';direct=false
 }else if(intentRoute.intent==='CALCULATE'){
  capabilities.push('CALCULATORS');path='TOOL';direct=true
 }else if(intentRoute.intent==='ANALYZE_SOIL'){
  capabilities.push('SOIL_ANALYSIS','AGRONOMIC_WORKSPACE','AGRONOMIST_MANUAL');path='TOOL';direct=false
 }else if(intentRoute.intent==='IMAGE_DIAGNOSIS'){
  capabilities.push(intentRoute.tool_hint==='NUTRISCAN'?'NUTRISCAN':intentRoute.tool_hint==='FITOSCAN'?'FITOSCAN':'IMAGE_DIAGNOSIS','AGRONOMIST_MANUAL');path='TOOL';direct=false
 }else if(intentRoute.tool_hint==='AGRONOMIC_TOOL_CATALOG'){
  capabilities.push('AGRONOMIC_WORKSPACE');path='FAST';direct=true
 }else if(intentRoute.tool_hint==='AREA_MAPPING'){
  capabilities.push('AREA_MAPPING','AGRONOMIC_WORKSPACE');path='TOOL';direct=true
 }else if(intentRoute.intent==='ASK_AGRONOMIC'){
  capabilities.push('AGRONOMIC_WORKSPACE','AGRONOMIST_MANUAL','KNOWLEDGE_LIBRARY')
  path=/\b(?:cruz|compare|historico|perfil|preco|mercado)\w*\b/.test(source)?'DEEP':'CONTEXT';direct=false
 }else if(intentRoute.intent==='PREPARE_VISIT'){
  capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY','VISIT_HISTORY','OPPORTUNITY_PIPELINE','KNOWLEDGE_LIBRARY');path='DEEP';direct=false
 }else if(intentRoute.intent==='ASK_CLIENT'){
  capabilities.push('CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY')
  const multiDomain=/\b(?:cruz|estrateg)\w*\b/.test(source)&&[/\b(?:agronomia|agronomico|talhao|safra)\b/,/\b(?:historico|perfil|memoria|visita)\b/,/\b(?:preco|mercado|commodity)\b/].filter(pattern=>pattern.test(source)).length>=2
  path=multiDomain?'DEEP':'CONTEXT';direct=false
 }else{
  capabilities.push('KNOWLEDGE_LIBRARY');path='CONTEXT';direct=false
 }

 // Uma rota direta responde ao pedido atual sem herdar ferramentas de um
 // objeto ativo antigo. Contexto ativo so amplia rotas que realmente vao
 // compor raciocinio contextual ou profundo.
 if(!direct&&activeContext?.type==='opportunity'&&!capabilities.includes('OPPORTUNITY_PIPELINE'))capabilities.push('OPPORTUNITY_PIPELINE')
 if(!direct&&['visit','visit_draft'].includes(activeContext?.type)&&!capabilities.includes('VISIT_HISTORY'))capabilities.push('VISIT_HISTORY')
 if(!direct&&activeContext?.type==='agronomic_tool'&&!capabilities.includes('AGRONOMIC_WORKSPACE'))capabilities.push('AGRONOMIC_WORKSPACE')
 const planned=[...new Set(capabilities)]
 const materiality=assessEngineMateriality({path,intent:intentRoute.intent,source,capabilities:planned,attachmentTypes})
 return Object.freeze({
  version:systemCapabilityRouterVersion,
  reasoning_path_version:reasoningPathVersion,
  path_architecture_version:reasoningPathsArchitectureVersion,
  intent:intentRoute.intent,
  path,
  data_path:dataPath,
  direct,
  capabilities:planned,
  current_data_required:intentRoute.requires_current_data,
  client_context_required:intentRoute.tool_hint!=='AGRONOMIC_TOOL_CATALOG'&&!clientIndependent.has(intentRoute.intent)&&!intentRoute.session_command?.local_only,
  persistence_mode:intentRoute.persistence_mode,
  session_command:intentRoute.session_command,
  tool_hint:intentRoute.tool_hint,
  materiality,
  reasoning_after_tool:path==='TOOL'?'IF_MATERIAL':'NOT_APPLICABLE',
  reason:materiality.reason
 })
}

function freshness(observedAt,now){
 const parsed=new Date(observedAt||'')
 if(Number.isNaN(parsed.getTime()))return {state:'INVALID',hours:null,label:'data inválida'}
 const deltaMs=now.getTime()-parsed.getTime()
 // Cinco minutos cobrem apenas pequena deriva de relógio; além disso o
 // registro futuro não pode ser apresentado como dado atual.
 if(deltaMs < -300_000)return {state:'INVALID',hours:null,label:'data futura inválida'}
 const hours=Math.max(0,deltaMs/3_600_000)
 if(hours<=24)return {state:'CURRENT',hours:Number(hours.toFixed(1)),label:'atual nas últimas 24 h'}
 if(hours<=168)return {state:'DATED',hours:Number(hours.toFixed(1)),label:'registrada nesta semana'}
 return {state:'STALE',hours:Number(hours.toFixed(1)),label:'histórica; precisa ser atualizada'}
}

function money(value){
 return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0))
}

function normalizedConfidence(value,fallback=.5){
 const numeric=Number(value)
 if(!Number.isFinite(numeric))return fallback
 return Math.max(0,Math.min(1,numeric>1?numeric/100:numeric))
}

function marketSelection(workspace,message,now){
 const commodity=commodityFrom(message)
 const requestedMarketKind=marketKindFrom(message)
 const requestedSeason=canonicalSeason(message)
 const requestedPriceUnit=priceUnitFrom(message)
 const requestedRegion=regionFrom(message,workspace?.marketSnapshots)
 const requestedRange=dateRangeFrom(message,requestedSeason)
 const temporalSelectionRequired=Boolean(requestedRange&&(requestedMarketKind==='forward'||requestedMarketKind==='futures'||/\b(?:entrega|janela|vencimento)\b/.test(normalize(message))))
 const snapshots=list(workspace?.marketSnapshots)
  .filter(item=>item?.status!=='inactive'&&(!commodity||item?.commodity===commodity))
  .filter(item=>!requestedMarketKind||normalize(item?.marketKind??item?.market_kind)===requestedMarketKind)
  .filter(item=>!requestedPriceUnit||clean(item?.priceUnit??item?.price_unit,40)===requestedPriceUnit)
  .filter(item=>sameRegion(item?.region,requestedRegion))
  .filter(item=>{
   const itemSeason=recordSeason(item)
   if(requestedSeason&&itemSeason!==requestedSeason)return false
   if(!temporalSelectionRequired)return true
   if(requestedRange?.source!=='season')return overlapsRange(item,requestedRange)
   return requestedSeason?true:overlapsRange(item,requestedRange)
  })
  .filter(item=>item?.sourceName&&item?.observedAt&&Number.isFinite(Number(item?.price))&&freshness(item.observedAt,now).state!=='INVALID')
  .sort((left,right)=>new Date(right.observedAt)-new Date(left.observedAt))
 const latest=snapshots[0]||null
 const previous=latest?snapshots.find(item=>item.id!==latest.id&&item.commodity===latest.commodity&&item.priceUnit===latest.priceUnit&&item.region===latest.region&&item.marketKind===latest.marketKind&&dateOnly(item.deliveryStart??item.delivery_start)===dateOnly(latest.deliveryStart??latest.delivery_start)&&dateOnly(item.deliveryEnd??item.delivery_end)===dateOnly(latest.deliveryEnd??latest.delivery_end))||null:null
 return {commodity,requestedMarketKind,requestedSeason,requestedPriceUnit,requestedRegion,requestedRange,latest,previous,freshness:latest?freshness(latest.observedAt,now):null}
}

export function answerCurrentMarket({workspace={},message='',intentHint='',now=new Date()}={}){
 const route=routeSystemCapability({message,intentHint,hasClient:false})
 const selected=marketSelection(workspace,message,now)
 const requestedLabel=commodityLabels[selected.commodity]||'a commodity solicitada'
 if(!selected.latest){
  const requestedDetails=[selected.requestedMarketKind&&`tipo ${marketKindLabels[selected.requestedMarketKind]||selected.requestedMarketKind}`,selected.requestedSeason&&`safra ${selected.requestedSeason}`,selected.requestedRegion&&`praça ${selected.requestedRegion}`,selected.requestedPriceUnit&&`unidade ${selected.requestedPriceUnit}`,selected.requestedRange&&selected.requestedRange.source!=='season'&&`entrega entre ${selected.requestedRange.start} e ${selected.requestedRange.end}`].filter(Boolean).join(', ')
  return {
   route,
   status:'UNAVAILABLE',
   answer:`Não encontrei uma cotação autorizada e identificada para ${requestedLabel}${requestedDetails?` com ${requestedDetails}`:''}. Não vou tratar memória antiga como preço atual nem substituir o tipo ou a janela pedidos por outra referência.`,
   action:'Abra Mercado e registre ou atualize uma referência com praça, horário e fonte antes de usar o valor em uma decisão.',
   facts:[],
   source:null,
   confidence:{level:'INSUFICIENTE',score:.12,rationale:'Nenhuma referência autorizada com fonte e data foi encontrada.'}
  }
 }
 const quote=selected.latest
 const quoteScope=assertRawRecordScope(quote,{
  tenantId:rawScopeValue(quote,tenantScopeKeys,'TENANT'),ownerId:rawScopeValue(quote,ownerScopeKeys,'OWNER')
 },{global:true,requireTenant:true,requireOwner:true})
 const label=commodityLabels[quote.commodity]||quote.commodity
 const kind=clean(quote.marketKind??quote.market_kind,80)
 const kindLabel=marketKindLabels[kind]||kind||'não informado'
 const dateText=new Date(quote.observedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
 const deliveryStart=dateOnly(quote.deliveryStart??quote.delivery_start)
 const deliveryEnd=dateOnly(quote.deliveryEnd??quote.delivery_end)
 const deliveryText=deliveryStart||deliveryEnd?` Janela de entrega: ${deliveryStart||deliveryEnd}${deliveryEnd&&deliveryEnd!==deliveryStart?` a ${deliveryEnd}`:''}.`:''
 const declaredConfidence=normalizedConfidence(quote.confidence,.5)
 const sourceConfidence=quote.sourceName&&quote.observedAt?(quote.sourceUrl?.startsWith('https://') ? 0.88 : 0.72):0.35
 const freshnessConfidence=selected.freshness.state==='CURRENT'?0.92:selected.freshness.state==='DATED'?0.7:0.42
 const calibratedScore=Number(Math.min(declaredConfidence,sourceConfidence,freshnessConfidence).toFixed(2))
 const confidenceLevel=calibratedScore>=.65?'PROVÁVEL':'INSUFICIENTE'
 let movement=''
 if(selected.previous){
  const delta=Number(quote.price)-Number(selected.previous.price)
  const percent=Number(selected.previous.price)?delta/Number(selected.previous.price)*100:0
  movement=` Em relação à referência anterior da mesma carteira, ${delta>0?'subiu':delta<0?'caiu':'ficou estável'} ${Math.abs(percent).toLocaleString('pt-BR',{maximumFractionDigits:2})}%.`
 }
 const currentPrefix=selected.commodity
  ?selected.freshness.state==='CURRENT'?'A referência mais recente':'A última referência disponível'
  :selected.freshness.state==='CURRENT'?'Entre as referências autorizadas registradas, a mais recente':'Entre as referências autorizadas registradas, a última disponível'
 const warning=selected.freshness.state==='CURRENT'?'':` Ela é ${selected.freshness.label}; confirme uma atualização antes de tratá-la como preço de hoje.`
 return {
  route,
  status:selected.freshness.state,
  answer:`${currentPrefix} é de ${label}: ${money(quote.price)} ${clean(quote.priceUnit,40)} em ${clean(quote.region,120)}. Tipo de mercado: ${kindLabel}.${deliveryText} Fonte ${clean(quote.sourceName,180)}, observada em ${dateText}.${movement}${warning}`,
  action:selected.freshness.state==='CURRENT'?'Cruze esta referência com praça, frete, janela e preço-alvo do produtor antes de avançar.':'Atualize a cotação na área Mercado antes de orientar uma negociação.',
  facts:[{id:clean(quote.id,180),source_type:'market_snapshot',scope:quoteScope.scope,producer_id:null,tenant_id:quoteScope.tenantId,context_owner_id:quoteScope.ownerId,statement:`${label}: ${money(quote.price)} ${clean(quote.priceUnit,40)} em ${clean(quote.region,120)}; tipo ${kindLabel}${deliveryStart||deliveryEnd?`; entrega ${deliveryStart||deliveryEnd}${deliveryEnd&&deliveryEnd!==deliveryStart?` a ${deliveryEnd}`:''}`:''}; fonte ${clean(quote.sourceName,180)}, observada em ${dateText}.`,observed_at:quote.observedAt,confidence:calibratedScore}],
  source:{id:clean(quote.id,180),name:clean(quote.sourceName,180),url:clean(quote.sourceUrl,1000)||null,observed_at:quote.observedAt,commodity:clean(quote.commodity,80),price_unit:clean(quote.priceUnit,40),market_kind:kind,market_kind_label:kindLabel,region:clean(quote.region,120),delivery_start:deliveryStart||null,delivery_end:deliveryEnd||null,requested_season:selected.requestedSeason||null,requested_region:selected.requestedRegion||null,requested_price_unit:selected.requestedPriceUnit||null,freshness:selected.freshness,scope:quoteScope.scope,producer_id:null,tenant_id:quoteScope.tenantId,context_owner_id:quoteScope.ownerId},
  confidence:{level:confidenceLevel,score:calibratedScore,rationale:`Confiança calibrada pela declaração da fonte, proveniência disponível e atualidade classificada como ${selected.freshness.label}; recência isolada não equivale a verificação.`}
 }
}

export function buildFastMarketResponse({workspace={},message='',intentHint='',organizationId='unknown',ownerId='unknown',clientId='',clientName='',conversationId='',contextEpoch=0,contextDomain='',now=new Date(),latencyMs=0,executionCounts={}}={}){
 const evidenceScope={tenantId:String(organizationId),ownerId:clean(ownerId,180),producerId:''}
 const responseProducerId=clean(clientId,180)
 assertMarketWorkspaceScope(workspace,evidenceScope)
 const market=answerCurrentMarket({workspace,message,intentHint,now})
 const responseDomain=scopedResponseDomain(message,market.route.intent,contextDomain)
 const normalizedEpoch=exactContextEpoch(contextEpoch)
 const marketFacts=scopedMarketEvidence(market)
 assertEvidenceProvenance(marketFacts,evidenceScope,message,now)
 const currentDataSource=market.source?{...market.source,source_type:'market_snapshot'}:null
 const createdAt=now.toISOString()
 const contextHash=createHash('sha256').update(JSON.stringify({message,source:market.source?.id||null,producerId:responseProducerId||null,createdAt:createdAt.slice(0,13)})).digest('hex')
 const entityResolutions=Math.max(0,Number(executionCounts.entityResolutions)||0)
 const dataLookups=Math.max(0,Number(executionCounts.dataLookups??1)||0)
 const toolCalls=Math.max(0,Number(executionCounts.toolCalls??1)||0)
 const hops=Math.max(0,Number(executionCounts.hops??(entityResolutions+dataLookups))||0)
 const executionBudget=Object.freeze({entityResolutions,dataLookups,modelCalls:0,toolCalls,hops,estimatedInputTokens:0,estimatedOutputTokens:0,estimatedCostUsd:0})
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:responseProducerId||'portfolio',name:responseProducerId?clean(clientName,180)||'Produtor':'Carteira'},
  context_snapshot:{id:`market-${contextHash.slice(0,16)}`,version:'val.current_data_snapshot.v1',confidence:market.confidence,hash:contextHash},conversation_id:clean(conversationId,180)||'global',
  intent:market.route.intent,persistence_mode:'NONE',objective:clean(message,1200)||'Consultar mercado.',situation_summary:market.answer,key_signals:[],facts_used:marketFacts,hypotheses:[],missing_information:market.status==='UNAVAILABLE'?['Cotação autorizada com fonte, praça e horário']:[],
  decision_thesis:{CURRENT_SITUATION:market.answer,WHAT_MATTERS:'Atualidade, praça, unidade e fonte precisam acompanhar qualquer número de mercado.',KEY_UNCERTAINTY:market.status==='CURRENT'?'O efeito específico sobre a conta ainda depende da janela e do preço-alvo do produtor.':'A referência ainda representa o mercado atual?',THESIS:market.action,WHY:market.confidence.rationale,WHAT_TO_VALIDATE:'Praça, frete, janela, preço-alvo e horário da referência.',WHAT_WOULD_CHANGE_MY_VIEW:'Uma referência autorizada mais recente ou de praça mais aderente.'},
  golden_questions:[],recommended_strategy:{reading:market.answer,action:market.action,do_not_do:'Não apresentar cotação sem fonte e data como preço atual.'},evidence_to_use:marketFacts,agronomic_context:{status:'not_applicable',human_review_required:false,sources:{},safety_note:'Nenhuma recomendação agronômica foi produzida.'},commercial_context:{status:'current_market_reference'},next_commitment:market.action,risks:market.status==='CURRENT'?[]:['Referência não classificada como atual.'],confidence:market.confidence,reasoning_confidence:{context:market.confidence.score,thesis:market.confidence.score,question:.8,agronomy:null,knowledge:.9},knowledge_refs:market.source?[{id:market.source.id,title:market.source.name,source_refs:[market.source.url||market.source.id],status:market.status,requires_human_review:false}]:[],memory_refs:[],created_at:createdAt,model:'rules-market-v1',prompt_version:'val-decision-copilot-v3',
  run:{provider:'system-capability-router',model:'rules-market-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'LIVE_DATA',model_call_count:0,tool_call_count:toolCalls,hop_count:hops,estimated_input_tokens:0,estimated_output_tokens:0,estimated_cost_usd:0,capabilities_planned:market.route.capabilities,capabilities_used:market.status==='UNAVAILABLE'?[]:['MARKET_COMMODITY'],capability_results:[{capability:'MARKET_COMMODITY',status:market.status==='UNAVAILABLE'?'NO_DATA':'EXECUTED',source_ref:market.source?.id||null}],latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},
  premises:{recomputed_for_request:true,source:'authorized_current_data',profile_specific:false,conversation_is_not_confirmed_memory:true,context_scope:{tenant_id:String(organizationId),owner_id:clean(ownerId,180)||null,producer_id:responseProducerId||null,conversation_id:clean(conversationId,180)||'global',context_epoch:normalizedEpoch,domain:responseDomain,minimum_sufficient_context:true},current_data:{required:true,status:market.status,source:currentDataSource}},
  voice_output:{version:'val.voice_output.v1',speakable_text:market.answer,persistence:'NONE',automatic_memory_effect:false},
  decision_interview:{version:'val.decision_interview.v1',status:'NOT_NEEDED',questions:[],material_missing_information:[],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'global',persistence_mode:'NONE'},explanation:'A capacidade de mercado respondeu com fonte e data; o cruzamento com um produtor pode exigir novas perguntas.'},
  quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{name_swap:{passed:null,evaluated:false,reason:'Não aplicável a uma cotação de carteira sem produtor.'},context_removal:{passed:null,evaluated:false,reason:'Não executado no FAST PATH determinístico.'}}}
 }
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'live-data-system-capability',route:'LIVE_DATA',model:'rules-market-v1',warning:'',globalCopilot:true,responseMetadata:{intent:market.route.intent,reasoningPath:'LIVE_DATA',capabilities:market.route.capabilities,currentDataStatus:market.status,executionBudget},advice:{answer:market.answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}

function canonicalSeason(value=''){
 const match=clean(value,400).match(/\b(20\d{2})\s*[\/_-]\s*((?:20)?\d{2})\b/)
 if(!match)return ''
 const end=match[2].length===2?`${match[1].slice(0,2)}${match[2]}`:match[2]
 return `${match[1]}/${end.slice(-2)}`
}

function recordCorpus(item={}){
 return normalize([
  item?.key,item?.title,item?.category,item?.product,item?.commodity,item?.crop,item?.season,item?.safra,
  typeof item?.value==='string'?item.value:JSON.stringify(item?.value??{}),
  typeof item?.evidence==='string'?item.evidence:JSON.stringify(item?.evidence??{}),
  item?.hypothesis,item?.notes,item?.nextAction,item?.next_action
 ].filter(Boolean).join(' '))
}

function recordCommodities(item={}){
 const corpus=recordCorpus(item)
 return Object.keys(commodityLabels).filter(commodity=>new RegExp(`\\b${commodity}\\b`).test(corpus))
}

function recordSeason(item={}){
 const value=item?.value&&typeof item.value==='object'?item.value:{}
 return [item?.season,item?.safra,item?.cropSeason,item?.crop_season,value.season,value.safra,value.cropSeason,value.crop_season,recordCorpus(item)].map(canonicalSeason).find(Boolean)||''
}

function validThrough(item={},now=new Date()){
 const value=item?.valid_until??item?.validUntil??null
 if(value==null||value==='')return true
 const expiresAt=new Date(value)
 return !Number.isNaN(expiresAt.getTime())&&expiresAt.getTime()>now.getTime()
}

function confirmedMemories(context={},{commodity='',season='',now=new Date()}={}){
 return list(context.memories).filter(item=>{
  const status=String(item?.status||'').toUpperCase()
  const state=String(item?.memory_state||item?.memoryState||item?.epistemic_state||'').toUpperCase()
  const domain=normalize(item?.memory_domain||item?.memoryDomain||item?.domain)
  if(status!=='VERIFIED'||!['FACT','VERIFIED','CONFIRMED'].includes(state)||!validThrough(item,now))return false
  if(!/^(?:commercial|comercial|market|mercado|grain|graos|commodity|negotiation|negociacao)$/.test(domain))return false
  const commodities=recordCommodities(item)
  if(commodity&& !commodities.includes(commodity))return false
  const itemSeason=recordSeason(item)
  if(season)return itemSeason===season
  return !itemSeason
 })
}

function marketProfileGuidance(context={},now=new Date()){
 const client=context.client||{}
 const profile=context.profile||{}
 const label=clean(client.primaryProfile||client.primary_profile||profile.primaryProfile||profile.primary_profile,120)
 const validUntil=profile.validUntil??profile.valid_until??client.profileValidUntil??client.profile_valid_until??null
 const explicitStatus=normalize(profile.status||client.profileStatus||client.profile_status)
 const expired=/expired|expirado|vencido/.test(explicitStatus)||!validThrough({validUntil},now)
 if(expired)return {label:'',status:'EXPIRED',confirmed:false,validUntil:validUntil||null,guidance:'O perfil de decisão está vencido; não o trate como premissa confirmada. Valide novamente como este produtor compara alternativas.'}
 const rejected=/^(?:pending|pendente|draft|rascunho|proposed|proposto|hypothesis|hipotese|unconfirmed|nao confirmado)$/.test(explicitStatus)
 const evidence=[...list(profile.evidence),...list(client.profileEvidence)]
 const evidenceConfirmed=evidence.some(item=>item?.self_reported===true||/^(?:confirmed|verified|completed|integrated|confirmado|verificado|concluido|integrado)$/.test(normalize(item?.status||item?.verification)))
 const positivelyConfirmed=/^(?:confirmed|verified|completed|integrated|confirmado|verificado|concluido|integrado)$/.test(explicitStatus)||profile.confirmed===true||client.profileConfirmed===true||client.profileSelfReported===true||Boolean(profile.assessedAt&&evidenceConfirmed)
 if(rejected||!positivelyConfirmed)return {label:'',status:explicitStatus?explicitStatus.toUpperCase():'UNKNOWN',confirmed:false,validUntil:validUntil||null,guidance:'O perfil de decisão ainda não está confirmado; valide como este produtor compara alternativas antes de personalizar a abordagem.'}
 const normalizedLabel=normalize(label)
 const base={label,status:label?'CONFIRMED':'UNKNOWN',confirmed:Boolean(label),validUntil:validUntil||null}
 if(/analitic/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado é analítico, abra com a referência comparável, explicite praça e unidade e só depois teste a decisão econômica.'}
 if(/relacional/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado é relacional, conecte a referência ao histórico combinado e valide a leitura antes de propor qualquer avanço.'}
 if(/conservador|seguranca/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado privilegia segurança, trate a cotação como referência, mostre o risco de base e proponha um próximo passo reversível.'}
 if(/inovador/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado é inovador, transforme a referência em um cenário curto de teste, com critério de sucesso explícito, limite de exposição e revisão combinada.'}
 if(/digital|agil/.test(normalizedLabel))return {...base,guidance:'Como o perfil confirmado aceita interação digital, envie a referência com fonte e data e use a conversa para confirmar o critério de decisão.'}
 if(label)return {...base,guidance:`Como o perfil confirmado é ${label}, use a referência como ponto de partida e valide explicitamente como este produtor compara alternativas.`}
 return {...base,label:'',status:'UNKNOWN',confirmed:false,guidance:'O perfil de decisão ainda não está confirmado; use a referência como ponto de partida e valide como este produtor compara alternativas.'}
}

function activeItem(items=[]){
 return list(items).find(item=>!/^(?:CLOSED|WON|LOST|CANCELLED|COMPLETED|FECHADO|GANHO|PERDIDO|CANCELADO|CONCLU[IÍ]DO)$/i.test(String(item?.status||item?.stage||'')))||null
}

function relevantOpportunity(items=[],{commodity='',season=''}={}){
 return activeItem(list(items).filter(item=>{
  const commodities=recordCommodities(item)
  if(commodity&&!commodities.includes(commodity))return false
  const itemSeason=recordSeason(item)
  return !season||itemSeason===season
 }))
}

function materialField(value=''){
 const source=normalize(value)
 if(/preco\s*[- ]?alvo|target[_ ]?price/.test(source))return 'target_price'
 if(/janela|entrega|decision[_ ]?window/.test(source))return 'decision_window'
 return 'material_response'
}

function sessionAnswers(message=''){
 const raw=String(message||'')
 const records=[]
 for(const match of raw.matchAll(/Resposta\s+\d+\s*\[([^\]]+)\]\s*:\s*([\s\S]*?)(?=\s+Resposta\s+\d+\s*\[|$)/gi))records.push({field:materialField(match[1]),answer:clean(match[2].replace(/\.\s*$/,''),1200)})
 if(records.length)return records
 for(const match of raw.matchAll(/Resposta\s+\d+\s+à\s+pergunta\s+[“"]([^”"]+)[”"]\s*:\s*([\s\S]*?)(?=\s+Resposta\s+\d+\s+à\s+pergunta|$)/gi))records.push({field:materialField(match[1]),answer:clean(match[2].replace(/\.\s*$/,''),1200)})
 if(records.length)return records
 for(const match of raw.matchAll(/Resposta\s+\d+\s*:\s*([\s\S]*?)\.\s*Pergunta\s+material\s*:\s*[“"]([^”"]+)[”"]/gi))records.push({field:materialField(match[2]),answer:clean(match[1],1200)})
 return records
}

function usefulAnswer(value=''){
 const source=normalize(value)
 return Boolean(source)&&!/^(?:nao\s+sei|nao\s+informad[oa]|a\s+confirmar|desconhecid[oa]|sem\s+informacao|n\/a)[.!]?$/.test(source)
}

function explicitTarget(value='',structured=false){
 const source=normalize(value)
 if(!usefulAnswer(source))return false
 const numeric=/(?:r\$\s*)?\d+(?:[.,]\d+)?/.test(source)
 const unit=/\b(?:por\s+saca|saca(?:\s+de\s+60\s*kg)?|sc(?:\s*60\s*kg)?|por\s+tonelada|tonelada|brl\s*\/\s*(?:sc|t)|r\$\s*\/\s*(?:sc|t)|\/\s*(?:saca|sc|t))\b/.test(source)
 return numeric&&unit&&(structured||/\b(?:preco\s*[- ]?alvo|alvo)\b/.test(source))
}

function explicitWindow(value='',structured=false){
 const source=normalize(value)
 if(!usefulAnswer(source))return false
 const temporal=/\b(?:hoje|amanha|esta\s+semana|proxima\s+semana|em\s+\d+\s+dias?|ate\s+\d+\s+dias?|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}[-\/]\d{1,2}(?:[-\/]\d{1,2})?|\d{1,2}[\/-]\d{1,2}(?:[\/-]20\d{2})?)\b/
 if(!temporal.test(source))return false
 if(structured)return true
 return /\b(?:janela|entrega|vender|venda|comprar|compra|decidir|decisao)\b.{0,70}\b(?:hoje|amanha|semana|dias?|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{1,2}[\/-]\d{1,2})\b|\b(?:hoje|amanha|semana|dias?|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{1,2}[\/-]\d{1,2})\b.{0,70}\b(?:janela|entrega|vender|venda|comprar|compra|decidir|decisao)\b/.test(source)
}

function memoryDecisionKnowledge(memories=[]){
 let targetKnown=false;let windowKnown=false
 for(const item of memories){
  const value=item?.value&&typeof item.value==='object'?item.value:{}
  const target=Number(value.targetPrice??value.target_price)
  const priceUnit=clean(value.priceUnit??value.price_unit,80)
  if(Number.isFinite(target)&&target>0&&priceUnit)targetKnown=true
  const window=clean(value.decisionWindow??value.decision_window,300)
  if((window&&usefulAnswer(window))||value.deliveryStart||value.delivery_start||value.deliveryEnd||value.delivery_end)windowKnown=true
  const key=normalize(item?.key)
  if(!targetKnown&&/target[_ .-]?price|preco[_ .-]?alvo/.test(key)&&explicitTarget(value.statement,true))targetKnown=true
  if(!windowKnown&&/decision[_ .-]?window|janela|entrega/.test(key)&&explicitWindow(value.statement,true))windowKnown=true
 }
 return {targetKnown,windowKnown}
}

function sessionKnowledge(message='',intention=null,memories=[]){
 const replies=sessionAnswers(message)
 const decision=memoryDecisionKnowledge(memories)
 const direct=replies.length?[]:[{field:'direct',answer:message}]
 const answerRecords=replies.length?replies:direct
 const targetKnown=intention?.targetPrice!=null&&intention.targetPrice!==''&&Number.isFinite(Number(intention.targetPrice))||decision.targetKnown||answerRecords.some(item=>(item.field==='target_price'||item.field==='direct')&&explicitTarget(item.answer,item.field==='target_price'))
 const windowKnown=Boolean(intention?.deliveryStart||intention?.deliveryEnd)||decision.windowKnown||answerRecords.some(item=>(item.field==='decision_window'||item.field==='direct')&&explicitWindow(item.answer,item.field==='decision_window'))
 return {targetKnown,windowKnown}
}

export function buildClientMarketResponse({workspace={},context={},facts={},message='',intentHint='',attachmentTypes=[],organizationId='unknown',ownerId='unknown',conversationId='',contextEpoch=context?.contextSnapshot?.context_scope?.context_epoch??0,contextDomain=context?.contextSnapshot?.context_scope?.domain??'',now=new Date(),latencyMs=0}={}){
 const client={...(facts.client||{}),...(context.client||{})}
 const clientId=String(client.id||'unknown')
 const evidenceScope={tenantId:String(organizationId),ownerId:clean(ownerId,180),producerId:clientId}
 if(facts.client?.id&&context.client?.id&&String(facts.client.id)!==String(context.client.id))throw Object.assign(new Error('As fontes de identidade apontam para produtores diferentes.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'PRODUCER_ALIAS_CONFLICT'})
 assertRawRecordScope(facts.client||{},evidenceScope)
 assertRawRecordScope(context.client||{},evidenceScope)
 assertMarketWorkspaceScope(workspace,evidenceScope)
 for(const candidate of list(workspace.intentions))assertRawRecordScope(candidate,{...evidenceScope,producerId:''},{requireTenant:true,requireOwner:true,requireProducer:true})
 const market=answerCurrentMarket({workspace,message,intentHint,now})
 const route=routeSystemCapability({message,intentHint:intentHint||market.route.intent,hasClient:true,attachmentTypes})
 const responseDomain=scopedResponseDomain(message,route.intent,contextDomain)
 const normalizedEpoch=exactContextEpoch(contextEpoch)
 const marketFacts=scopedMarketEvidence(market)
 const currentDataSource=market.source?{...market.source,source_type:'market_snapshot'}:null
 const commodity=market.source?.commodity||commodityFrom(message)
 const requestedSeason=canonicalSeason(message)
 const intention=activeItem(list(workspace.intentions).filter(item=>{
  if(String(item?.clientId||item?.client_id)!==clientId||!['confirmed','negotiating'].includes(String(item?.status||'').toLowerCase()))return false
  if(commodity&&normalize(item?.commodity)!==commodity)return false
  const itemSeason=recordSeason(item)
  return !requestedSeason||itemSeason===requestedSeason
 }))
 const decisionSeason=requestedSeason||recordSeason(intention)
 const memories=confirmedMemories(context,{commodity,season:decisionSeason,now})
 for(const memory of memories)assertRawRecordScope(memory,evidenceScope,{requireProducer:true})
 const opportunity=relevantOpportunity(context.opportunities,{commodity,season:decisionSeason})
 if(opportunity)assertRawRecordScope(opportunity,evidenceScope,{requireProducer:true})
 const profile=marketProfileGuidance(context,now)
 const knowledge=sessionKnowledge(message,intention,memories)
 const missing=market.status==='UNAVAILABLE'?[]:[
  !knowledge.targetKnown&&{field:'target_price',question:`Qual é o preço-alvo de ${clean(client.name,120)||'este produtor'} e em qual unidade ele compara?`,why:'Sem preço-alvo e unidade, a cotação não mostra se existe distância econômica relevante.'},
  !knowledge.windowKnown&&{field:'decision_window',question:'Qual é a janela real para essa decisão ou entrega?',why:'A janela muda a validade da referência, o risco de base e a urgência da conversa.'}
 ].filter(Boolean).slice(0,2)
 const accountSignals=[]
 if(intention){
  const direction=intention.direction==='buy'?'compra':intention.direction==='sell'?'venda':'negociação'
  const target=intention.targetPrice!=null&&intention.targetPrice!==''&&Number.isFinite(Number(intention.targetPrice))?` com alvo de ${money(intention.targetPrice)} ${clean(intention.priceUnit,40)}`:''
  const volume=intention.volume!=null&&intention.volume!==''&&Number.isFinite(Number(intention.volume))?` para ${Number(intention.volume).toLocaleString('pt-BR')} ${clean(intention.volumeUnit,40)}`:''
  accountSignals.push(`há uma intenção de ${direction}${volume}${target}`)
 }
 if(opportunity)accountSignals.push(`a oportunidade ativa “${clean(opportunity.title||opportunity.category,180)}” está em ${clean(opportunity.stage||opportunity.status||'acompanhamento',100)}`)
 const accountReading=market.status==='UNAVAILABLE'
  ?`Para ${clean(client.name,180)||'este produtor'}, não é seguro inferir impacto comercial sem uma referência atual autorizada.`
  :accountSignals.length
   ?`Para ${clean(client.name,180)}, ${accountSignals.join(' e ')}. ${profile.guidance}`
   :`Para ${clean(client.name,180)}, não encontrei intenção ou oportunidade ativa suficiente para concluir o impacto desta referência. ${profile.guidance}`
 const answer=`${market.answer} ${accountReading}`
 const action=market.status==='UNAVAILABLE'
  ?market.action
  :missing.length
   ?`Responda ${missing.length===1?'à pergunta material':'às perguntas materiais'} abaixo antes de transformar a referência em abordagem para ${clean(client.name,120)}.`
   :`Na conversa com ${clean(client.name,120)}, compare a referência com o alvo e a janela confirmados, explicite praça, unidade e fonte e feche um próximo passo datado.`
 const contextFacts=[canonicalEvidence({id:`client:${clientId}`,sourceType:'client_registration',statement:`Produtor selecionado: ${clean(client.name,180)||'Produtor'}.`,epistemicType:'FACT',scope:evidenceScope,relevanceScore:.6,reasonSelected:'ACTIVE_PRODUCER_IDENTITY'})]
 if(intention){
  const direction=intention.direction==='buy'?'compra':intention.direction==='sell'?'venda':clean(intention.direction,60)||'negociação'
  contextFacts.push(canonicalEvidence({id:intention.id,sourceType:'negotiation_intent',statement:`Intenção registrada de ${direction} de ${clean(intention.commodity,80)}${intention.targetPrice!=null&&intention.targetPrice!==''&&Number.isFinite(Number(intention.targetPrice))?` com alvo de ${money(intention.targetPrice)} ${clean(intention.priceUnit,40)}`:''}.`,observedAt:intention.observedAt||intention.updatedAt||null,epistemicType:'INTENTION',scope:intention,confidence:normalizedConfidence(intention.confidence,.5),relevanceScore:.95,reasonSelected:'MATCHED_ACTIVE_NEGOTIATION_INTENT'}))
 }
 if(opportunity)contextFacts.push(canonicalEvidence({id:opportunity.id,sourceType:'opportunity',statement:`Oportunidade ativa registrada: ${clean(opportunity.title||opportunity.category,220)}, etapa ${clean(opportunity.stage||opportunity.status||'não informada',100)}.`,observedAt:opportunity.updated_at||opportunity.updatedAt||null,epistemicType:'FACT',scope:opportunity,relevanceScore:.85,reasonSelected:'MATCHED_ACTIVE_OPPORTUNITY'}))
 const profileObservedAt=context.profile?.assessedAt||context.profile?.assessed_at||context.profile?.updatedAt||context.profile?.updated_at||client.profileUpdatedAt||client.profile_updated_at||null
 const profileSourceId=clean(context.profile?.id||client.profileId||client.profile_id,180)
 if(profile.confirmed&&profileSourceId&&profileObservedAt&&profile.validUntil)contextFacts.push(canonicalEvidence({id:profileSourceId,sourceType:'producer_profile',statement:`Perfil confirmado: ${profile.label}.`,observedAt:profileObservedAt,validUntil:profile.validUntil,epistemicType:'FACT',scope:evidenceScope,relevanceScore:.6,reasonSelected:'CONFIRMED_PROFILE_APPROACH_ADAPTATION'}))
 assertEvidenceProvenance([...marketFacts,...contextFacts],evidenceScope,message,now)
 const memoryRefs=memories.map(item=>({id:clean(item.id,180),key:clean(item.key,180),state:clean(item.memory_state||item.memoryState,80),source_ref:clean(item.source_ref||item.sourceRef,240)})).filter(item=>item.id).slice(0,12)
 const available=new Set(['CLIENT_CONTEXT'])
 if(market.status!=='UNAVAILABLE')available.add('MARKET_COMMODITY')
 if(memories.length)available.add('CONFIRMED_MEMORY')
 if(intention)available.add('COMMERCIAL_HISTORY')
 if(opportunity)available.add('OPPORTUNITY_PIPELINE')
 const planned=route.capabilities
 const capabilityResults=planned.map(capability=>({
  capability,
  status:available.has(capability)?'EXECUTED':'NO_DATA',
  source_ref:capability==='MARKET_COMMODITY'?market.source?.id||null:capability==='CLIENT_CONTEXT'?clientId:capability==='CONFIRMED_MEMORY'?memoryRefs[0]?.id||null:capability==='COMMERCIAL_HISTORY'?intention?.id||null:capability==='OPPORTUNITY_PIPELINE'?opportunity?.id||null:null
 }))
 const used=capabilityResults.filter(item=>item.status==='EXECUTED').map(item=>item.capability)
 const confidenceScore=market.status==='UNAVAILABLE'?0.12:Number(Math.min(market.confidence.score,missing.length?0.58:0.78).toFixed(2))
 const confidenceLevel=confidenceScore>=.65?'PROVÁVEL':'INSUFICIENTE'
 const createdAt=now.toISOString()
 const contextHash=createHash('sha256').update(JSON.stringify({client:clientId,message,source:market.source?.id||null,intention:intention?.id||null,opportunity:opportunity?.id||null,memories:memoryRefs.map(item=>item.id)})).digest('hex')
 const interview={
  version:'val.decision_interview.v1',status:missing.length?'NEEDS_INPUT':'NOT_NEEDED',
  questions:missing.map(item=>({...item,classification:'MATERIAL',already_known:false})),
  material_missing_information:missing.map(item=>item.field),non_material_missing_information:[],
  session_context:{conversation_id:clean(conversationId,180)||'stateless',persistence_mode:'NONE',confirmed_memory_unchanged:true},
  explanation:missing.length?`Faltam ${missing.length} informaç${missing.length===1?'ão':'ões'} materiais para ligar a referência de mercado à decisão de ${clean(client.name,120)}. A resposta vale apenas nesta conversa até confirmação de registro.`:'A fonte atual e o contexto confirmado disponíveis são suficientes para esta leitura.',
  recompute_after_reply:true,register_offer:{available:true,automatic:false,confirmation_required:true}
 }
 const spokenQuestions=missing.map((item,index)=>`Pergunta ${index+1}: ${item.question}`)
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:clientId,name:clean(client.name,180)||'Produtor'},
  context_snapshot:{id:`client-market-${contextHash.slice(0,16)}`,version:'val.current_data_context_snapshot.v1',confidence:{level:confidenceLevel,score:confidenceScore},hash:contextHash},conversation_id:clean(conversationId,180)||'stateless',
  intent:route.intent,persistence_mode:'NONE',objective:clean(message,1200)||'Cruzar mercado e contexto do produtor.',situation_summary:answer,key_signals:[],facts_used:[...marketFacts,...contextFacts],hypotheses:[],missing_information:missing.map(item=>item.field),
  decision_thesis:{CURRENT_SITUATION:answer,WHAT_MATTERS:'A cotação só muda a abordagem quando é comparável à praça, unidade, alvo e janela do produtor.',KEY_UNCERTAINTY:missing[0]?.question||'A referência e o contexto representam a decisão atual?',THESIS:action,WHY:`${market.confidence.rationale} ${profile.guidance}`,WHAT_TO_VALIDATE:missing.map(item=>item.question).join(' ')||'Preço-alvo, janela, praça, frete e critério de decisão.',WHAT_WOULD_CHANGE_MY_VIEW:'Uma referência autorizada mais recente ou uma mudança confirmada no alvo, janela ou intenção do produtor.'},
  golden_questions:[],recommended_strategy:{reading:answer,action,do_not_do:'Não apresentar movimento de mercado como recomendação de compra ou venda nem presumir intenção do produtor.'},evidence_to_use:[...marketFacts,...contextFacts],
  agronomic_context:{status:'not_applicable',human_review_required:false,sources:{},safety_note:'Nenhuma prescrição ou recomendação agronômica foi produzida.'},commercial_context:{status:'market_account_cross',commodity:commodity||null,season:decisionSeason||null,market_kind:market.source?.market_kind||null,profile_strategy:profile.guidance,profile_status:profile.status,profile_valid_until:profile.validUntil,intention_id:intention?.id||null,opportunity_id:opportunity?.id||null},next_commitment:action,risks:market.status==='CURRENT'?[]:['A referência de mercado não está classificada como atual.'],
  confidence:{level:confidenceLevel,score:confidenceScore,rationale:`Confiança limitada pela fonte de mercado e pela cobertura do contexto da conta; ${missing.length?'ainda há lacunas materiais.':'não há lacuna material detectada nesta solicitação.'}`},
  reasoning_confidence:{version:'val.reasoning_confidence.v1',context:intention||opportunity||profile.label?0.76:0.48,thesis:confidenceScore,question:missing.length?0.86:0.76,agronomy:null,knowledge:market.source?0.8:0.2,threshold:{ask_below:.72,answer_at_or_above:.72}},
  knowledge_refs:market.source?[{id:market.source.id,title:market.source.name,source_refs:[market.source.url||market.source.id],status:market.status,requires_human_review:false}]:[],memory_refs:memoryRefs,created_at:createdAt,model:'rules-client-market-v1',prompt_version:'val-decision-copilot-v3',
  run:{provider:'system-capability-router',model:'rules-client-market-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'DEEP',capabilities_planned:planned,capabilities_used:used,capability_results:capabilityResults,latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},
  premises:{recomputed_for_request:true,source:'confirmed_context_snapshot_plus_authorized_current_data_plus_session',profile_specific:true,confirmed_profile:profile.confirmed?{status:'CONFIRMED',label:profile.label,valid_until:profile.validUntil}:profile.status==='EXPIRED'?{status:'EXPIRED',valid_until:profile.validUntil}:null,profile_evaluation:{status:profile.status,valid_until:profile.validUntil},conversation_is_not_confirmed_memory:true,confirmed_memory_refs:memoryRefs,context_scope:{tenant_id:String(organizationId),owner_id:clean(ownerId,180)||null,producer_id:clientId,conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,domain:responseDomain,minimum_sufficient_context:true},session_context:{conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,current_domain:responseDomain,persistence_mode:'NONE',current_request:clean(message,1200)},current_data:{required:true,status:market.status,source:currentDataSource}},
  voice_output:{version:'val.voice_output.v1',speakable_text:clean([answer,action,...spokenQuestions].join(' '),3800),persistence:'NONE',automatic_memory_effect:false},decision_interview:interview,
  quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{name_swap:{passed:null,evaluated:false,reason:'Disponível na regressão; não executado inline.'},context_removal:{passed:null,evaluated:false,reason:'Disponível na regressão; não executado inline.'}}}
 }
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'deep-system-capability',route:'DEEP',model:'rules-client-market-v1',warning:'',globalCopilot:true,responseMetadata:{intent:route.intent,reasoningPath:'DEEP',capabilitiesPlanned:planned,capabilitiesUsed:used,capabilityResults,currentDataStatus:market.status},advice:{answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}

const attachmentSourceTypes=new Set(['consultant_attachment','attachment','attachment_analysis'])
const attachmentEvidenceTypes=new Set(['FACT','OBSERVATION','INFERENCE'])
const attachmentRequest=/\b(?:anexo\w*|arquivo\w*|documento\w*|pdf|foto\w*|imagem|imagens|laudo\w*|analise (?:este|esta|o|a)|analisar (?:este|esta|o|a)|leia (?:este|esta|o|a)|interprete (?:este|esta|o|a))\b/i
const semanticWords=value=>new Set(normalize(value).split(/[^a-z0-9]+/).filter(token=>token.length>=4&&!['como','deste','desta','este','esta','isso','hoje','muda','qual','quais','para','preco'].includes(token)))
const attachmentRelationAliasKeys=new Set(['sourceref','sourcerefs','attachmentid','attachmentids','attachmentref','attachmentrefs','attachmentsourceid','sourceattachmentid','originalattachmentid','authorizedattachmentid'])
const attachmentRelationContainers=new Set(['attachment','attachments','payload','provenance','evidence','evidenceref','evidencerefs'])
const attachmentIdentityAliasKeys=new Set(['id','sourceid'])

function attachmentScopeForComposition(marketReasoning={},attachmentReasoning={},hasAttachmentReasoning=false){
 const base=marketReasoning?.premises?.context_scope||{}
 const attached=attachmentReasoning?.premises?.context_scope||{}
 const required=['tenant_id','owner_id','producer_id']
 for(const key of required)if(!clean(base[key],180))throw Object.assign(new Error('A composição de anexo exige escopo completo do produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ATTACHMENT_BASE_SCOPE_MISSING',field:key})
 if(hasAttachmentReasoning){
  for(const key of required)if(!clean(attached[key],180))throw Object.assign(new Error('A resposta do anexo não comprova seu escopo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ATTACHMENT_RESPONSE_SCOPE_MISSING',field:key})
  for(const key of required)if(clean(attached[key],180)!==clean(base[key],180))throw Object.assign(new Error('A resposta do anexo pertence a outro escopo.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:`ATTACHMENT_${key.replace('_id','').toUpperCase()}_MISMATCH`,expected:clean(base[key],180),actual:clean(attached[key],180)})
  for(const key of ['conversation_id','domain'])if(clean(attached[key],180)!==clean(base[key],180))throw Object.assign(new Error('A resposta do anexo pertence a outra conversa ou domínio.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:`ATTACHMENT_${key.toUpperCase()}_MISMATCH`})
  if(!Number.isSafeInteger(base.context_epoch)||base.context_epoch<0||!Number.isSafeInteger(attached.context_epoch)||attached.context_epoch<0||attached.context_epoch!==base.context_epoch)throw Object.assign(new Error('A resposta do anexo pertence a outro context epoch.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ATTACHMENT_CONTEXT_EPOCH_MISMATCH'})
  if(clean(attachmentReasoning?.organization?.id,180)!==clean(base.tenant_id,180)||clean(attachmentReasoning?.client?.id,180)!==clean(base.producer_id,180))throw Object.assign(new Error('A identidade da resposta do anexo não coincide com o escopo comprovado.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ATTACHMENT_REASONING_IDENTITY_MISMATCH'})
 }
 return Object.freeze({tenantId:clean(base.tenant_id,180),ownerId:clean(base.owner_id,180),producerId:clean(base.producer_id,180),conversationId:clean(base.conversation_id,180),contextEpoch:base.context_epoch,domain:clean(base.domain,40).toUpperCase()})
}

function attachmentBindingViolation(reason,message,details={}){
 return Object.assign(new Error(message),{code:'RESPONSE_GROUNDING_VIOLATION',reason,...details})
}

function normalizedAttachmentAliasKey(value=''){
 return String(value).replace(/[^a-z0-9]/gi,'').toLowerCase()
}

function attachmentRelationAliases(fact={}){
 const aliases=[]
 const seen=new WeakSet()
 const walk=(node,path,insideRelationContainer=false,depth=0)=>{
  if(depth>24)throw attachmentBindingViolation('ATTACHMENT_SOURCE_BINDING_DEPTH_EXCEEDED','A origem da evidência do anexo excede o limite seguro de aninhamento.',{path})
  if(Array.isArray(node)){
   for(let index=0;index<node.length;index+=1){
    const child=node[index]
    if(child&&typeof child==='object')walk(child,`${path}[${index}]`,insideRelationContainer,depth+1)
    else if(insideRelationContainer){const value=clean(child,180);if(value)aliases.push({value,path:`${path}[${index}]`})}
   }
   return
  }
  if(!node||typeof node!=='object'||seen.has(node))return
  seen.add(node)
  for(const [key,child] of Object.entries(node)){
   const aliasKey=normalizedAttachmentAliasKey(key)
   const explicitRelation=attachmentRelationAliasKeys.has(aliasKey)
   const relationContainer=attachmentRelationContainers.has(aliasKey)
   const childPath=`${path}.${key}`
   if(child&&typeof child==='object')walk(child,childPath,insideRelationContainer||relationContainer||explicitRelation,depth+1)
   else if(explicitRelation||relationContainer||insideRelationContainer&&attachmentIdentityAliasKeys.has(aliasKey)){
    const value=clean(child,180);if(value)aliases.push({value,path:childPath})
   }
  }
 }
 walk(fact,'fact')
 return aliases
}

function authorizedAttachmentId(reference='',attachmentIds=new Set()){
 const value=clean(reference,180)
 if(attachmentIds.has(value))return value
 const typed=value.match(/^(?:attachment|consultant_attachment|attachment_analysis):(.+)$/i)
 return typed&&attachmentIds.has(typed[1])?typed[1]:''
}

function attachmentSourceBinding(fact={},attachmentIds=new Set()){
 const identities=[...new Set([fact.id,fact.source_id,fact.sourceId].map(value=>clean(value,180)).filter(Boolean))]
 if(!identities.length)throw attachmentBindingViolation('ATTACHMENT_EVIDENCE_ID_REQUIRED','A evidência do anexo não possui identidade canônica auditável.')
 if(identities.length!==1)throw attachmentBindingViolation('ATTACHMENT_EVIDENCE_ID_ALIAS_CONFLICT','Os aliases de identidade da evidência do anexo são conflitantes.',{aliases:identities})
 const evidenceId=identities[0]
 const declared=attachmentRelationAliases(fact)
 const identityAttachmentId=authorizedAttachmentId(evidenceId,attachmentIds)
 if(identityAttachmentId)declared.push({value:evidenceId,path:'fact.id'})
 const attachmentBindings=new Set()
 for(const alias of declared){
  // Um payload pode repetir a identidade do próprio fato; isso não prova uma
  // segunda origem, mas também não pode substituir a referência do anexo.
  if(alias.value===evidenceId&&!authorizedAttachmentId(alias.value,attachmentIds))continue
  const attachmentId=authorizedAttachmentId(alias.value,attachmentIds)
  if(!attachmentId)throw attachmentBindingViolation('ATTACHMENT_SOURCE_NOT_AUTHORIZED','A evidência cita uma origem de anexo que não pertence ao conjunto autorizado.',{sourceReference:alias.value,path:alias.path})
  attachmentBindings.add(attachmentId)
 }
 if(attachmentBindings.size>1)throw attachmentBindingViolation('ATTACHMENT_SOURCE_BINDING_CONFLICT','A evidência possui aliases que apontam para anexos diferentes.',{attachmentIds:[...attachmentBindings]})
 if(!attachmentBindings.size)throw attachmentBindingViolation('ATTACHMENT_SOURCE_BINDING_REQUIRED','A evidência não comprova relação com um único anexo autorizado.')
 return Object.freeze({evidenceId,attachmentId:[...attachmentBindings][0]})
}

function upstreamGroundingSupportsFact(grounding={},evidenceId=''){
 if(grounding?.passed!==true)return false
 const canonicalId=clean(evidenceId,180)
 return Boolean(canonicalId)&&list(grounding.claim_ledger).some(claim=>claim?.supported===true&&list(claim.evidence_refs).some(ref=>clean(ref,180)===canonicalId))
}

function attachmentFactRelevant({question='',domain='',fact={},attachment={}}={}){
 const explicit=attachmentRequest.test(question)
 const requested=domain==='MULTI_DOMAIN'?matchedValContextDomains(question):[domain]
 const factDomains=new Set(matchedValContextDomains(fact.statement))
 const image=String(attachment?.mimeType||attachment?.mime_type||'').startsWith('image/')
 if(image)factDomains.add('AGRONOMY')
 if(explicit&&!factDomains.size){
  for(const item of matchedValContextDomains(question))if(!['GRAINS','COMMERCIAL'].includes(item))factDomains.add(item)
 }
 if(![...factDomains].some(item=>requested.includes(item)))return false
 if(explicit)return true
 const commodity=commodityFrom(question)
 if(domain==='GRAINS'&&commodity)return new RegExp(`\\b${commodity}\\b`,'i').test(normalize(fact.statement))
 const questionWords=semanticWords(question);const factWords=semanticWords(fact.statement)
 return [...questionWords].some(word=>factWords.has(word))
}

function publicAttachmentMetadata(item={}){
 return {id:clean(item.id,180),clientId:clean(item.clientId??item.client_id,180),mimeType:clean(item.mimeType??item.mime_type,180),status:clean(item.status,80),createdAt:item.createdAt??item.created_at??null,updatedAt:item.updatedAt??item.updated_at??null}
}

function factRelevantToDomain(fact={},domain='',question=''){
 if(fact.scope==='MARKET')return domain==='GRAINS'||domain==='MULTI_DOMAIN'
 if(fact.source_type==='client_registration')return false
 const factDomains=matchedValContextDomains(fact.statement)
 if(domain==='MULTI_DOMAIN')return factDomains.some(item=>matchedValContextDomains(question).includes(item))
 return !factDomains.length||factDomains.includes(domain)||domain==='GRAINS'&&factDomains.includes('COMMERCIAL')
}

function assertMarketAttachmentRelevance({question='',answer='',domain='',attachmentFacts=[]}={}){
 const rawRequested=domain==='MULTI_DOMAIN'?[...matchedValContextDomains(question)]:[domain]
 // COMMERCIAL é auxiliar quando a própria pergunta classifica GRAINS,
 // CREDIT ou OPPORTUNITY como domínio dominante; não exija um terceiro
 // bloco redundante apenas porque "preço/negociação" ativou esse marcador.
 const requested=rawRequested.filter(item=>!(item==='COMMERCIAL'&&rawRequested.some(dominant=>['GRAINS','CREDIT','OPPORTUNITY'].includes(dominant))))
 const answered=matchedValContextDomains(answer)
 if(!requested.every(item=>answered.includes(item)))throw Object.assign(new Error('A composição não responde a todos os domínios pedidos.'),{code:'RESPONSE_GROUNDING_VIOLATION',reason:'ATTACHMENT_COMPOSITION_DOMAIN_RELEVANCE',requestedDomains:requested,answeredDomains:answered})
 const commodity=commodityFrom(question)
 if(commodity&&!new RegExp(`\\b${commodity}\\b`,'i').test(normalize(answer)))throw Object.assign(new Error('A composição perdeu a commodity solicitada.'),{code:'RESPONSE_GROUNDING_VIOLATION',reason:'ATTACHMENT_COMPOSITION_ENTITY_RELEVANCE'})
 if(attachmentRequest.test(question)&&!attachmentFacts.length)throw Object.assign(new Error('A pergunta pediu o anexo, mas nenhuma evidência relevante foi selecionada.'),{code:'RESPONSE_GROUNDING_VIOLATION',reason:'ATTACHMENT_COMPOSITION_MISSING_REQUESTED_EVIDENCE'})
 return true
}

export function composeMarketAttachmentResponse({marketResponse={},attachmentResponse={},attachmentTypes=[]}={}){
 const rawAttachments=list(attachmentResponse.attachments)
 const hasAttachmentReasoning=Object.prototype.hasOwnProperty.call(attachmentResponse?.advice||{},'ai_reasoning')
 const attachmentReasoning=attachmentResponse?.advice?.ai_reasoning||{}
 const marketReasoning=marketResponse?.advice?.ai_reasoning||{}
 const scope=attachmentScopeForComposition(marketReasoning,attachmentReasoning,hasAttachmentReasoning)
 const createdAt=new Date(marketReasoning.created_at||'')
 const groundingNow=Number.isNaN(createdAt.getTime())?new Date():createdAt
 const rawAttachmentIds=rawAttachments.map(item=>clean(item?.id,180)).filter(Boolean)
 const attachmentIds=new Set(rawAttachmentIds)
 if(attachmentIds.size!==rawAttachmentIds.length)throw attachmentBindingViolation('ATTACHMENT_AUTHORIZED_ID_DUPLICATE','O conjunto autorizado contém identificadores de anexo duplicados.')
 const attachmentsById=new Map(rawAttachments.map(item=>[clean(item?.id,180),item]).filter(([id])=>id))
 for(const attachment of rawAttachments){
  if(!clean(attachment?.id,180)||!['interpreted','confirmed'].includes(String(attachment?.status||'').toLowerCase()))throw Object.assign(new Error('A composição recebeu anexo sem leitura processada.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'ATTACHMENT_NOT_PROCESSED'})
  assertRawRecordScope(attachment,scope,{requireTenant:true,requireOwner:true,requireProducer:true})
 }
 const question=clean(marketReasoning.objective,1200)
 const attachmentFacts=[]
 const candidateFacts=hasAttachmentReasoning?list(attachmentReasoning.facts_used):list(attachmentResponse?.advice?.evidence_used).map(item=>{
  const sourceId=clean(item?.source_id??item?.sourceId,180)
  const attachment=attachmentsById.get(sourceId)
  if(item?.direct_observation!==true||!attachment)return null
  return {id:clean(item?.id,180)||sourceId,source_id:clean(item?.id,180)||sourceId,source_ref:sourceId,source_type:item?.source_type,epistemic_type:'OBSERVATION',statement:item?.claim_supported,observed_at:attachment.updatedAt??attachment.updated_at??attachment.createdAt??attachment.created_at,producer_id:scope.producerId,tenant_id:scope.tenantId,context_owner_id:scope.ownerId,confidence:item?.quality==='high'?.9:item?.quality==='moderate'?.7:.5}
 }).filter(Boolean)
 const selectedEvidenceIds=new Set()
 for(const fact of candidateFacts){
  const sourceType=clean(fact?.source_type??fact?.sourceType,120).toLowerCase()
  if(!attachmentSourceTypes.has(sourceType))continue
  const {attachmentId,evidenceId}=attachmentSourceBinding(fact,attachmentIds)
  if(selectedEvidenceIds.has(evidenceId))throw attachmentBindingViolation('ATTACHMENT_EVIDENCE_ID_DUPLICATE','A mesma identidade de evidência foi reutilizada na composição de anexos.',{evidenceId})
  selectedEvidenceIds.add(evidenceId)
  assertRawRecordScope(fact,scope,{requireTenant:true,requireOwner:true,requireProducer:true})
  const epistemicType=clean(fact?.epistemic_type??fact?.epistemicType??fact?.evidence_type??fact?.evidenceType,40).toUpperCase()
  if(!attachmentEvidenceTypes.has(epistemicType))continue
  const attachment=attachmentsById.get(attachmentId)
  if(!attachmentFactRelevant({question,domain:scope.domain,fact,attachment}))continue
  if(hasAttachmentReasoning&&!upstreamGroundingSupportsFact(attachmentReasoning?.grounding,evidenceId))throw Object.assign(new Error('A evidência do anexo não possui grounding anterior comprovado.'),{code:'RESPONSE_GROUNDING_VIOLATION',reason:'ATTACHMENT_UPSTREAM_GROUNDING_REQUIRED'})
  const purposeDomains=new Set(matchedValContextDomains(fact.statement))
  if(String(attachment?.mimeType||attachment?.mime_type||'').startsWith('image/'))purposeDomains.add('AGRONOMY')
  if(!purposeDomains.size)for(const item of matchedValContextDomains(question))if(!['GRAINS','COMMERCIAL'].includes(item))purposeDomains.add(item)
  const prefix=purposeDomains.has('AGRONOMY')?'Observação agronômica do anexo':purposeDomains.has('GRAINS')?'Observação de grãos do anexo':'Observação do anexo'
  const sourceStatement=clean(fact.statement,900).replace(/["'‘’“”]/g,'').replace(/[;.!?]+\s*/g,', ').replace(/,\s*$/,'')
  // FACT qualifica apenas o que o arquivo registra; não promove o conteúdo
  // do anexo a verdade sobre o produtor, diagnóstico ou causalidade.
  const selected=canonicalEvidence({id:evidenceId,sourceType,statement:`${prefix} ${attachmentId}: ${sourceStatement}.`,observedAt:fact.observed_at??fact.observedAt,epistemicType:'FACT',scope:fact,confidence:fact.confidence??null,relevanceScore:1,reasonSelected:'ATTACHMENT_REQUEST_DOMAIN_MATCH'})
  selected.source_ref=attachmentId
  attachmentFacts.push(selected)
 }
 const safeAttachments=rawAttachments.map(publicAttachmentMetadata)
 if(!attachmentFacts.length){
  return {
   ...marketResponse,recommendationId:attachmentResponse.recommendationId||marketResponse.recommendationId||null,attachments:safeAttachments,
   responseMetadata:{...(marketResponse.responseMetadata||{}),attachmentCompositionStatus:'SKIPPED_IRRELEVANT',attachmentEvidenceSelected:0}
  }
 }
 const selectedAttachmentIds=new Set(attachmentFacts.map(item=>item.source_ref))
 const attachmentCapabilities=[...new Set([...selectedAttachmentIds].map(id=>String(attachmentsById.get(id)?.mimeType||attachmentsById.get(id)?.mime_type||'').startsWith('image/')?'IMAGE_DIAGNOSIS':'KNOWLEDGE_LIBRARY'))]
 const planned=[...new Set([...list(marketReasoning.run?.capabilities_planned),...attachmentCapabilities])]
 const used=[...new Set([...list(marketReasoning.run?.capabilities_used),...attachmentCapabilities])]
 const baseFacts=list(marketReasoning.facts_used).filter(item=>factRelevantToDomain(item,scope.domain,question))
 assertEvidenceProvenance([...baseFacts,...attachmentFacts],scope,question,groundingNow)
 const finalFacts=[...baseFacts,...attachmentFacts]
 const answer=clean(finalFacts.map(item=>item.statement).filter(Boolean).join(' '),3800)
 assertMarketAttachmentRelevance({question,answer,domain:scope.domain,attachmentFacts})
 const grounding=assertResponseGrounding({question,answer,domain:scope.domain,evidence:finalFacts,activeProducerId:scope.producerId,tenantId:scope.tenantId,ownerId:scope.ownerId,now:groundingNow,checkQuestionRelevance:false})
 const capabilityResults=[...list(marketReasoning.run?.capability_results).filter(item=>!attachmentCapabilities.includes(item?.capability)),...attachmentCapabilities.map(capability=>({capability,status:'EXECUTED',source_ref:[...selectedAttachmentIds].find(id=>capability==='IMAGE_DIAGNOSIS'?String(attachmentsById.get(id)?.mimeType||'').startsWith('image/'):!String(attachmentsById.get(id)?.mimeType||'').startsWith('image/'))||null}))]
 const quality={...(marketReasoning.quality||{}),automatic_tests:{...(marketReasoning.quality?.automatic_tests||{}),source_grounding:{passed:true,evaluated:true},question_relevance:{passed:grounding.question_relevance==='PASS',evaluated:true}}}
 const reasoning={
  ...marketReasoning,situation_summary:answer,facts_used:finalFacts,evidence_to_use:finalFacts,recommended_strategy:{...(marketReasoning.recommended_strategy||{}),reading:answer},
  agronomic_context:{status:attachmentCapabilities.includes('IMAGE_DIAGNOSIS')?'requires_human_review':'available',human_review_required:attachmentReasoning?.agronomic_context?.human_review_required===true,sources:{attachments:selectedAttachmentIds.size},safety_note:'O anexo sustenta somente a observação registrada; diagnóstico e causalidade exigem validação apropriada.'},
  run:{...(marketReasoning.run||{}),path:'DEEP',capabilities_planned:planned,capabilities_used:used,capability_results:capabilityResults},
  premises:{...(marketReasoning.premises||{}),attachment_context:{status:'PROCESSED_RELEVANT',ids:[...selectedAttachmentIds],rejected_count:rawAttachments.length-selectedAttachmentIds.size,confirmed_memory_unchanged:true}},
  voice_output:{version:'val.voice_output.v1',speakable_text:answer,persistence:'NONE',automatic_memory_effect:false},grounding,quality
 }
 return {
  ...marketResponse,recommendationId:attachmentResponse.recommendationId||marketResponse.recommendationId||null,engineMode:attachmentResponse.engineMode||marketResponse.engineMode,
  engineArchitecture:'current-data-plus-multimodal-composition',route:'DEEP',model:attachmentResponse.model||marketResponse.model,warning:marketResponse.warning||'',attachments:safeAttachments,
  responseMetadata:{...(marketResponse.responseMetadata||{}),reasoningPath:'DEEP',capabilitiesPlanned:planned,capabilitiesUsed:used,capabilityResults,attachmentCompositionStatus:'EXECUTED',attachmentEvidenceSelected:attachmentFacts.length},
  advice:{...(marketResponse.advice||{}),answer,ai_reasoning:reasoning,val_response_quality:quality}
 }
}

export function finalizeAttachmentRecommendation({draft={},attachmentIds=[],attachmentTypes=[],marketResponse=null}={}){
 const expected=[...new Set(list(attachmentIds).map(String).filter(Boolean))]
 const processed=new Set(list(draft.attachments).filter(item=>['interpreted','confirmed'].includes(String(item?.status||'').toLowerCase())).map(item=>String(item.id)))
 if(expected.some(id=>!processed.has(id)))throw Object.assign(new Error('A VAL validou os arquivos, mas a leitura multimodal não ficou disponível. Nenhuma recomendação foi persistida como se o anexo tivesse sido consumido.'),{statusCode:422,code:'val_attachment_analysis_unavailable'})
 return marketResponse?composeMarketAttachmentResponse({marketResponse,attachmentResponse:draft,attachmentTypes}):undefined
}

function fastDate(value){
 const civil=clean(value,40).match(/^(\d{4})-(\d{2})-(\d{2})$/)
 if(civil)return `${civil[3]}/${civil[2]}/${civil[1]}`
 const parsed=new Date(value||'')
 return Number.isNaN(parsed.getTime())?'data não informada':parsed.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
}

function fastCurrency(value,currency='BRL'){
 if(value==null||String(value).trim()==='')return null
 const number=Number(value)
 if(!Number.isFinite(number))return null
 const code=/^[A-Z]{3}$/.test(String(currency||'').toUpperCase())?String(currency).toUpperCase():'BRL'
 try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency:code,minimumFractionDigits:2,maximumFractionDigits:2}).format(number)}catch{return `${number.toLocaleString('pt-BR',{maximumFractionDigits:2})} ${code}`}
}

function confirmedObjectionSelection(report,maxLength=700){
 const objections=list(report?.objections).map(item=>({
  statement:typeof item==='string'?clean(item,maxLength):clean(item?.statement||item?.reported_text||item?.text,maxLength),
  primary:typeof item==='object'&&[item?.primary,item?.is_primary,item?.isPrimary].some(value=>value===true||String(value).toLowerCase()==='true'),
 })).filter(item=>item.statement)
 const marked=objections.find(item=>item.primary)||null
 const principal=marked?.statement||(objections.length===1?objections[0].statement:'')
 const ambiguous=objections.length>1&&!marked
 return {objections,principal,ambiguous}
}

const fastProducerRecordKeys=Object.freeze([
 'latestVisit','latestCompletedVisit','nextScheduledVisit','latestCommitment','latestPurchase',
 'latestConfirmedObjection','latestVisitConfirmedObjection','latestCropSeason'
])

/**
 * FAST is deterministic, but it is still an evidence consumer. Validate the
 * repository provenance before any statement is assembled; never repair or
 * relabel an unscoped/mismatched raw record after reading its contents.
 */
function assertFastFactsBoundary(facts={},scope={}){
 const producerId=clean(facts?.client?.id,180)
 const tenantId=clean(scope.tenantId,180)
 const ownerId=clean(scope.ownerId,180)
 if(!producerId)throw Object.assign(new Error('O produtor ativo é obrigatório para consultar fatos rápidos.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_ACTIVE_PRODUCER'})
 if(!tenantId)throw Object.assign(new Error('O tenant ativo é obrigatório para consultar fatos rápidos.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_TENANT_SCOPE'})
 if(!ownerId)throw Object.assign(new Error('O owner ativo é obrigatório para consultar fatos rápidos.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_OWNER_SCOPE'})
 const records=[facts.client,...fastProducerRecordKeys.map(key=>facts?.[key]),...list(facts?.profileEvidence)].filter(Boolean)
 const boundaryRecords=records.map(record=>{
  // Some domain records (notably commitments) use owner_id for the business
  // assignee selected by owner_type. It is not the consultant/ACL owner. The
  // repository-authenticated context_owner_id remains mandatory and is the
  // only ownership dimension used for isolation in that case.
  if(!clean(record?.owner_type??record?.ownerType,80))return record
  const {owner_id:_domainOwnerId,ownerId:_domainOwnerIdCamel,...boundaryRecord}=record
  return boundaryRecord
 })
 assertActiveProducerBoundary(boundaryRecords,{producerId,tenantId,ownerId,requireOwner:true})
 return Object.freeze({producerId,tenantId,ownerId})
}

export function buildFastClientComparisonResponse({entries=[],authorizedProducerIds=[],message='',organizationId='unknown',ownerId='',conversationId='',contextEpoch=0,contextDomain='',now=new Date(),latencyMs=0,executionCounts={}}={}){
 now=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date()
 const scoped=list(entries).filter(item=>item?.client?.id&&item?.client?.name).slice(0,2)
 if(scoped.length!==2)throw Object.assign(new Error('A comparação exige exatamente dois produtores autorizados na conversa.'),{statusCode:422,code:'val_comparison_pair_required'})
 const authorized=list(authorizedProducerIds).map(value=>clean(value,180)).filter(Boolean)
 if(authorized.length!==2||new Set(authorized).size!==2)throw Object.assign(new Error('O par autorizado da comparação é obrigatório.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'MISSING_COMPARISON_SCOPE'})
 for(let index=0;index<2;index+=1)if(clean(scoped[index]?.client?.id,180)!==authorized[index])throw Object.assign(new Error('O lookup da comparação retornou outro produtor.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'COMPARISON_PRODUCER_MISMATCH',expectedProducerId:authorized[index],actualProducerId:clean(scoped[index]?.client?.id,180)||null})
 const verifiedScopes=scoped.map(facts=>assertFastFactsBoundary(facts,{tenantId:organizationId,ownerId}))
 const comparisonDomain=scopedResponseDomain(message,'ASK_CLIENT',contextDomain)
 const normalizedEpoch=exactContextEpoch(contextEpoch)
 const comparisonNoData='Não há evidência selecionada suficiente para afirmar uma resposta específica com segurança.'
 const statementFor=facts=>{
  const client=facts.client
  const visitCandidate=facts.latestCompletedVisit&&legacyVisitLifecycle(facts.latestCompletedVisit)==='COMPLETED'?facts.latestCompletedVisit:null
  const visit=clean(visitCandidate?.id,180)?visitCandidate:null
  const purchaseCandidate=facts.latestPurchase||null
  const purchaseRef=clean(purchaseCandidate?.id||purchaseCandidate?.external_id||purchaseCandidate?.externalId,180)
  const purchase=purchaseRef?purchaseCandidate:null
  const reportCandidate=facts.latestConfirmedObjection||null
  const reportRef=clean(reportCandidate?.visit_report_id||reportCandidate?.id,180)
  const report=reportRef?reportCandidate:null
  const objectionSelection=confirmedObjectionSelection(report,500)
  const objectionStatements=objectionSelection.objections.map(item=>clean(item.statement,500).replace(/[.!?]+$/,''))
  const commitmentRef=clean(facts.latestCommitment?.commitment_id||facts.latestCommitment?.id,180)
  const commitment=commitmentRef?clean(facts.latestCommitment?.description,500):''
  const rawArea=client.totalAreaHa??client.total_area_ha??client.area
  const numericArea=Number(rawArea)
  const hasNumericArea=rawArea!=null&&String(rawArea).trim()!==''&&Number.isFinite(numericArea)
  const area=hasNumericArea?`${numericArea.toLocaleString('pt-BR',{maximumFractionDigits:2})} ha`:clean(client.areaBand??client.area_band,120)
  const cultures=clean(client.cultures,500)
  const visitAt=visit?.occurred_at||visit?.occurredAt||visit?.completed_at||visit?.completedAt||visit?.scheduled_at||visit?.scheduledAt||null
  const purchaseValue=fastCurrency(purchase?.value,purchase?.currency)
  const name=clean(client.name,180)
  const registrationParts=[area?`área ${area}`:'',cultures?`culturas ${cultures}`:''].filter(Boolean)
  const segments=[registrationParts.length?`${name}: ${registrationParts.join('; ')}.`:`Cadastro autorizado do produtor ${name}.`]
  if(visit)segments.push(`Última visita concluída de ${name} em ${fastDate(visitAt)}.`)
  if(purchase)segments.push(`Última compra concluída de ${name}: ${purchaseValue||'valor não informado'} em ${fastDate(purchase.occurred_at||purchase.occurredAt||purchase.created_at||purchase.createdAt)}.`)
  if(commitment)segments.push(`Compromisso de ${name}: ${commitment}.`)
  const hasMaterial=Boolean(registrationParts.length||visit||purchase||commitment||objectionStatements.length)
  if(!objectionStatements.length)return hasMaterial?segments.join(' '):`${segments.join(' ')} ${comparisonNoData}`
  segments.push(`Objeções confirmadas de ${name}: ${objectionStatements.join('; ')}.`)
  if(objectionSelection.ambiguous)segments.push('O que ainda não sabemos: qual delas é a principal.')
  return segments.join(' ')
 }
 const statements=scoped.map(statementFor)
 const answer=`Comparação factual dos dois produtores autorizados nesta conversa. ${statements.join(' ')} Diga qual dimensão quer aprofundar; esta leitura não escolhe uma estratégia automaticamente.`
 const evidenceFor=(facts,index)=>{
  const client=facts.client
  const verifiedScope=verifiedScopes[index]
  const visit=facts.latestCompletedVisit&&legacyVisitLifecycle(facts.latestCompletedVisit)==='COMPLETED'?facts.latestCompletedVisit:null
  const visitAt=visit?.occurred_at||visit?.occurredAt||visit?.completed_at||visit?.completedAt||visit?.scheduled_at||visit?.scheduledAt||null
  const purchase=facts.latestPurchase||null
  const purchaseRef=clean(purchase?.id||purchase?.external_id||purchase?.externalId,180)
  const purchaseAt=purchase?.occurred_at||purchase?.occurredAt||purchase?.created_at||purchase?.createdAt||null
  const report=facts.latestConfirmedObjection||null
  const reportAt=report?.confirmed_at||report?.confirmedAt||report?.created_at||report?.createdAt||null
  const objections=confirmedObjectionSelection(report,500).objections.map(item=>clean(item.statement,500).replace(/[.!?]+$/,''))
  const commitment=facts.latestCommitment||null
  const commitmentText=clean(commitment?.description||commitment?.action,500)
  const rawArea=client.totalAreaHa??client.total_area_ha??client.area
  const numericArea=Number(rawArea)
  const hasArea=rawArea!=null&&String(rawArea).trim()!==''&&Number.isFinite(numericArea)
  const areaRegistration=hasArea?`${numericArea.toLocaleString('pt-BR',{maximumFractionDigits:2})} ha`:clean(client.areaBand??client.area_band,120)
  const registration=[areaRegistration?`área ${areaRegistration}`:'',clean(client.cultures,500)?`culturas ${clean(client.cultures,500)}`:''].filter(Boolean).join('; ')
  return [
   {id:`client:${clean(client.id,180)}`,source_type:'client_registration',statement:registration?`${clean(client.name,180)}: ${registration}.`:`Cadastro autorizado do produtor ${clean(client.name,180)}.`,observed_at:null,confidence:1,comparison_dimension:registration?'registration':'identity'},
   visit?.id?{id:clean(visit.id,180),source_type:'visit',statement:`Última visita concluída de ${clean(client.name,180)} em ${fastDate(visitAt)}.`,observed_at:visitAt,confidence:1,comparison_dimension:'visit'}:null,
   purchaseRef?{id:purchaseRef,source_type:'business_event',statement:`Última compra concluída de ${clean(client.name,180)}: ${fastCurrency(purchase.value,purchase.currency)||'valor não informado'} em ${fastDate(purchaseAt)}.`,observed_at:purchaseAt,confidence:1,comparison_dimension:'purchase'}:null,
   objections.length&&(report?.visit_report_id||report?.id)?{id:clean(report.visit_report_id||report.id,180),source_type:'confirmed_visit_report',statement:`Objeções confirmadas de ${clean(client.name,180)}: ${objections.join('; ')}`,observed_at:reportAt,confidence:1,comparison_dimension:'objection'}:null,
   commitmentText&&(commitment?.commitment_id||commitment?.id)?{id:clean(commitment.commitment_id||commitment.id,180),source_type:'commitment',statement:`Compromisso de ${clean(client.name,180)}: ${commitmentText}.`,observed_at:commitment?.updated_at||commitment?.updatedAt||commitment?.created_at||commitment?.createdAt||null,confidence:1,comparison_dimension:'commitment'}:null,
  ].filter(Boolean).map(item=>({...item,producer_id:verifiedScope.producerId,tenant_id:verifiedScope.tenantId,owner_id:verifiedScope.ownerId,epistemic_type:'FACT'}))
 }
 const factsUsed=scoped.flatMap(evidenceFor).filter(item=>clean(item?.id,180))
 const groundingByProducer=scoped.map((facts,index)=>{
  const evidence=factsUsed.filter(item=>clean(item?.producer_id??item?.producerId,180)===verifiedScopes[index].producerId)
  // Keep the auditable identity claim and the canonical no-data declaration
  // as separate grounding units. Joining a supported fact to an insufficiency
  // sentence must not let either half qualify the other.
  const segments=statements[index].includes(comparisonNoData)
   ?[statements[index].replace(comparisonNoData,'').trim(),comparisonNoData]
   :[statements[index]]
  const results=segments.filter(Boolean).map(segment=>assertResponseGrounding({
   question:message,answer:segment,domain:comparisonDomain,evidence,
   activeProducerId:verifiedScopes[index].producerId,tenantId:verifiedScopes[index].tenantId,ownerId:verifiedScopes[index].ownerId,now,
   // Relevance belongs to the explicitly authorized pair and is asserted
   // once over the combined answer below.
   checkQuestionRelevance:false
  }))
  return Object.freeze({passed:results.every(result=>result.passed),question_relevance:'NOT_EVALUATED',segments:results})
 })
 const pairGrounding=assertResponseQuestionRelevance({question:message,answer,domain:comparisonDomain})
 const ambiguousObjectionClients=scoped.filter(facts=>(facts.latestConfirmedObjection?.visit_report_id||facts.latestConfirmedObjection?.id)&&confirmedObjectionSelection(facts.latestConfirmedObjection).ambiguous).map(facts=>clean(facts.client.name,180))
 const hasEvidence=factsUsed.some(item=>item.comparison_dimension!=='identity')
 const route=routeSystemCapability({message,intentHint:'ASK_CLIENT',hasClient:true})
 const createdAt=now.toISOString()
 const contextHash=createHash('sha256').update(JSON.stringify({clients:scoped.map(item=>item.client.id),message})).digest('hex')
 const entityResolutions=Math.max(0,Number(executionCounts.entityResolutions??1)||0)
 const dataLookups=Math.max(0,Number(executionCounts.dataLookups??2)||0)
 const hops=Math.max(0,Number(executionCounts.hops??2)||0)
 const executionBudget=Object.freeze({entityResolutions,dataLookups,modelCalls:0,toolCalls:2,hops,estimatedInputTokens:0,estimatedOutputTokens:0,estimatedCostUsd:0})
 const sourceFor=capability=>factsUsed.find(item=>capability==='VISIT_HISTORY'?['visit','confirmed_visit_report'].includes(item.source_type):capability==='COMMERCIAL_HISTORY'?['business_event','commitment'].includes(item.source_type):item.source_type==='client_registration')?.id||null
 const capabilityResults=route.capabilities.map(capability=>({capability,status:sourceFor(capability)?'EXECUTED':'NO_DATA',source_ref:sourceFor(capability)}))
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:String(scoped[0].client.id),name:clean(scoped[0].client.name,180)},context_snapshot:{id:`compare-${contextHash.slice(0,16)}`,version:'val.fast_data_snapshot.v1',confidence:{level:'VERIFICADO'},hash:contextHash},conversation_id:clean(conversationId,180)||'stateless',intent:'ASK_CLIENT',persistence_mode:'NONE',objective:clean(message,1200),situation_summary:answer,key_signals:[],facts_used:factsUsed,hypotheses:[],missing_information:['Dimensão da comparação a aprofundar'],decision_thesis:{CURRENT_SITUATION:answer,WHAT_MATTERS:'Os dois produtores foram resolvidos pela thread e consultados separadamente no mesmo tenant e owner.',KEY_UNCERTAINTY:'O usuário ainda não escolheu a dimensão decisória da comparação.',THESIS:answer,WHY:'A resposta apresenta somente campos estruturados equivalentes.',WHAT_TO_VALIDATE:'Qual dimensão deve orientar a próxima comparação.',WHAT_WOULD_CHANGE_MY_VIEW:'Registros mais recentes ou outro critério explicitamente solicitado.'},golden_questions:[],recommended_strategy:{reading:answer,action:'Escolha a dimensão material que deseja aprofundar.',do_not_do:'Não inferir superioridade comercial ou agronômica a partir de campos ausentes.'},evidence_to_use:factsUsed,agronomic_context:{status:'registered_fact',human_review_required:false,sources:{},safety_note:'Nenhuma prescrição agronômica foi produzida.'},commercial_context:{status:'structured_comparison',client_ids:scoped.map(item=>String(item.client.id))},next_commitment:'Escolher a dimensão material da comparação.',risks:[],confidence:{level:'VERIFICADO',score:.96,rationale:'Os dois clientes e seus fatos foram lidos em lookups autorizados independentes.'},reasoning_confidence:{version:'val.reasoning_confidence.v1',context:.96,thesis:.82,question:.9,agronomy:null,knowledge:1,threshold:{ask_below:.72,answer_at_or_above:.72}},knowledge_refs:[],memory_refs:[],created_at:createdAt,model:'rules-fast-client-comparison-v1',prompt_version:'val-decision-copilot-v3',run:{provider:'system-capability-router',model:'rules-fast-client-comparison-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'FAST',model_call_count:0,tool_call_count:2,hop_count:hops,estimated_input_tokens:0,estimated_output_tokens:0,estimated_cost_usd:0,capabilities_planned:route.capabilities,capabilities_used:capabilityResults.filter(item=>item.status==='EXECUTED').map(item=>item.capability),capability_results:capabilityResults,latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},premises:{recomputed_for_request:true,source:'authorized_fast_data_pair',profile_specific:true,conversation_is_not_confirmed_memory:true,data_path:'CLIENT_COMPARISON',context_scope:{tenant_id:String(organizationId),owner_id:clean(ownerId,180)||null,producer_id:String(scoped[0].client.id),conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,domain:comparisonDomain,minimum_sufficient_context:true},session_context:{conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,current_domain:comparisonDomain,persistence_mode:'NONE'}},voice_output:{version:'val.voice_output.v1',speakable_text:answer,persistence:'NONE',automatic_memory_effect:false},decision_interview:{version:'val.decision_interview.v1',status:'NEEDS_INPUT',questions:[{question:'Qual dimensão você quer comparar: histórico, compra, área/culturas ou compromissos?',why_it_matters:'O critério muda a leitura e evita uma comparação genérica.',priority:1}],material_missing_information:['Dimensão da comparação'],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,persistence_mode:'NONE'},explanation:'As duas entidades estão claras; falta somente o critério material.'},quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{}}
 }
 reasoning.grounding={passed:groundingByProducer.every(item=>item.passed)&&pairGrounding.passed,scope:'EXPLICIT_COMPARISON_PAIR',producers:groundingByProducer,pair:pairGrounding}
 if(!hasEvidence){
  reasoning.context_snapshot.confidence={level:'INSUFICIENTE',score:.2}
  reasoning.confidence={level:'INSUFICIENTE',score:.2,rationale:'Os dois clientes foram resolvidos, mas nenhum campo factual com proveniência foi encontrado para sustentar a comparação.'}
 reasoning.reasoning_confidence={...reasoning.reasoning_confidence,context:.2,thesis:.2}
 reasoning.decision_thesis={...reasoning.decision_thesis,KEY_UNCERTAINTY:'Não há registros factuais com proveniência para comparar.',WHY:'Os lookups autorizados não retornaram evidência factual para nenhum dos dois produtores.',WHAT_TO_VALIDATE:'Cadastre ou confirme ao menos uma dimensão factual equivalente antes de comparar.'}
 reasoning.missing_information=[...reasoning.missing_information,'Registros factuais comparáveis com proveniência']
  reasoning.agronomic_context={...reasoning.agronomic_context,status:'not_applicable'}
  reasoning.commercial_context={...reasoning.commercial_context,status:'no_data'}
 reasoning.run.capabilities_used=[]
 }
 if(ambiguousObjectionClients.length){
  const missing=`Marcação da objeção principal para ${ambiguousObjectionClients.join(' e ')}`
  reasoning.missing_information=[...new Set([...reasoning.missing_information,missing])]
  reasoning.decision_thesis={...reasoning.decision_thesis,KEY_UNCERTAINTY:`${reasoning.decision_thesis.KEY_UNCERTAINTY} ${missing}.`}
  reasoning.decision_interview={...reasoning.decision_interview,questions:[...reasoning.decision_interview.questions,{question:`Qual objeção confirmada deve ser tratada como principal para ${ambiguousObjectionClients.join(' e ')}?`,why_it_matters:'A VAL não escolhe silenciosamente entre múltiplas objeções confirmadas.',priority:2}],material_missing_information:[...reasoning.decision_interview.material_missing_information,missing],explanation:'As entidades estão claras; faltam a dimensão da comparação e a marcação explícita de qualquer objeção principal ambígua.'}
 }
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'fast-system-capability',route:'FAST',model:'rules-fast-client-comparison-v1',warning:'',globalCopilot:true,responseMetadata:{intent:'COMPARE',reasoningPath:'FAST',dataPath:'CLIENT_COMPARISON',capabilities:route.capabilities,executionBudget,comparedClients:scoped.map(item=>({id:String(item.client.id),name:clean(item.client.name,180)}))},advice:{answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}

function profileApproach(label=''){
 const normalized=normalize(label)
 if(/analitic/.test(normalized))return 'abra com dados comparáveis e confirme o critério de decisão'
 if(/relacional/.test(normalized))return 'comece pelo histórico de confiança e valide a leitura antes de propor avanço'
 if(/conservador|seguranca/.test(normalized))return 'reduza risco, mostre prova comparável e proponha um próximo passo reversível'
 if(/inovador/.test(normalized))return 'proponha um teste pequeno, com critério de sucesso e revisão combinados'
 if(/digital|agil/.test(normalized))return 'envie a referência objetiva e confirme rapidamente o critério de decisão'
 return 'confirme como ele compara alternativas antes de adaptar a abordagem'
}

const profilePoisonDomains=new Set(['GRAINS','CREDIT','AGRONOMY','GEO'])
const profileContextualDomains=new Set(['COMMERCIAL','OPPORTUNITY','VISIT'])
const profileBehaviorCue=/\b(?:pediu|solicitou|compara\w*|prefere|valoriza|decide|criterio|dados?|roi|retorno|confianca|relacion\w*|analitic\w*|inova\w*|digital|conservador|seguranca|referencia|planeja|consulta)\b/i
const profileContextLeak=/\b(?:proposta|negociacao|margem|oportunidade|pipeline|visita|compromisso|fechamento|venda|compra|contrato)\b/i
function behavioralEvidenceValue(value=''){
 const candidate=clean(value,300)
 if(!candidate)return ''
 const foreign=matchedValContextDomains(candidate).filter(domain=>profilePoisonDomains.has(domain))
 if(foreign.length)return ''
 const contextual=matchedValContextDomains(candidate).filter(domain=>profileContextualDomains.has(domain))
 if(contextual.length&&(!profileBehaviorCue.test(candidate)||profileContextLeak.test(candidate)))return ''
 return candidate
}

const profileEvidenceId=item=>clean(item?.id??item?.source_id??item?.sourceId??item?.survey_id??item?.surveyId,180)
const profileEvidenceSource=item=>clean(item?.source_type??item?.sourceType??item?.source,120)
const profileEvidenceTimestamp=item=>item?.assessed_at??item?.assessedAt??item?.observed_at??item?.observedAt??item?.created_at??item?.createdAt??null
const profileEvidenceLinks=item=>[
 profileEvidenceId(item),item?.profile_source_ref,item?.profileSourceRef,item?.parent_source_ref,item?.parentSourceRef,item?.source_ref,item?.sourceRef
].map(value=>clean(value,180)).filter(Boolean)

const profileFieldSpecs=Object.freeze([
 Object.freeze({key:'decisionDriver',label:'critério de decisão',question:'7',aliases:['decisiondriver','decision_driver','criterio_de_decisao','decision_criteria']}),
 Object.freeze({key:'technicalPresentation',label:'forma preferida de apresentação',question:'8',aliases:['technicalpresentation','technical_presentation','proof_preference','presentation_preference']}),
 Object.freeze({key:'planningStyle',label:'forma de planejamento',question:'9',aliases:['planningstyle','planning_style','time_horizon']}),
 Object.freeze({key:'servicePreference',label:'preferência de atendimento',question:'11',aliases:['servicepreference','service_preference','preferred_channel']}),
 Object.freeze({key:'trustDriver',label:'construção de confiança',question:'14',aliases:['trustdriver','trust_driver','trust_state']}),
 Object.freeze({key:'buyingBehavior',label:'comportamento de compra',question:'16',aliases:['buyingbehavior','buying_behavior','readiness']})
])
const profileAllowedEpistemicTypes=new Set(['FACT','OBSERVATION','INFERENCE','INTENTION','QUOTE','STRATEGY','HYPOTHESIS'])
const profileConcreteEvidenceTypes=new Set(['FACT','OBSERVATION','QUOTE'])
const profileTokenStopWords=new Set(['antes','ainda','assim','como','com','dele','dela','entre','forma','para','pela','pelo','quando','sobre'])
const profileToken=value=>{
 const token=normalize(value)
 if(/^compar/.test(token))return 'comparar'
 if(/^(?:dado|indicador|evidenc|prova)/.test(token))return 'evidencia'
 if(/^(?:roi|retorn)/.test(token))return 'retorno'
 if(/^(?:custo|invest)/.test(token))return 'custo'
 if(/^(?:confi|referenc)/.test(token))return 'confianca'
 if(/^(?:hectare|ha)$/.test(token))return 'hectare'
 if(/^prefer/.test(token))return 'preferir'
 if(/^planej/.test(token))return 'planejar'
 if(/^decid/.test(token))return 'decidir'
 return token
}
const profileTokens=value=>[...new Set(normalize(value).split(/[^a-z0-9]+/).filter(token=>token.length>=3&&!profileTokenStopWords.has(token)).map(profileToken))]
const profileFieldMarkers=spec=>new Set([spec.key,...spec.aliases,spec.question,`q${spec.question}`,`question_${spec.question}`,`pergunta_${spec.question}`].map(normalize))
const profileFieldMarker=node=>clean(node?.profile_field??node?.profileField??node?.field??node?.key??node?.dimension??node?.question_id??node?.questionId??node?.question,120)
function profileObservedText(value){
 if(typeof value==='string'||typeof value==='number')return behavioralEvidenceValue(value)
 if(!value||typeof value!=='object'||Array.isArray(value))return ''
 return [value.statement,value.observation,value.text,value.answer,value.signal,value.summary,value.description,
  typeof value.value==='string'||typeof value.value==='number'?value.value:null,
  value.value?.statement,value.value?.observation,value.value?.text,value.content?.statement,value.content?.observation,value.content?.text
 ].map(behavioralEvidenceValue).find(Boolean)||''
}
function profileStructuredMaps(item={}){
 return [
  ['answers',item.answers],['fields',item.fields],['field_values',item.field_values],['fieldValues',item.fieldValues],['values',item.values],
  ['data.answers',item.data?.answers],['data.fields',item.data?.fields],['data.field_values',item.data?.field_values],['data.fieldValues',item.data?.fieldValues],
  ['value.answers',item.value?.answers],['value.fields',item.value?.fields],['content.answers',item.content?.answers],['content.fields',item.content?.fields]
 ].filter(([,value])=>value&&typeof value==='object'&&!Array.isArray(value))
}
function profileEvidenceCandidates(item={}){
 const candidates=[]
 const add=(value,marker='',explicit=false,locator='')=>{
  const observed=profileObservedText(value)
  if(!observed)return
  const key=`${normalize(marker)}|${normalize(observed)}`
  if(candidates.some(candidate=>candidate.key===key))return
  candidates.push({key,observed,marker:clean(marker,120),explicit,locator:clean(locator,180)||null})
 }
 for(const [path,map] of profileStructuredMaps(item))for(const [marker,value] of Object.entries(map))add(value,marker,true,`${path}.${marker}`)
 const directMarker=profileFieldMarker(item)
 add(item,directMarker,Boolean(directMarker),directMarker?`field.${directMarker}`:'statement')
 for(const [path,collection] of [['signals',item.signals],['observations',item.observations],['behavioral_signals',item.behavioral_signals],['behavioralSignals',item.behavioralSignals]]){
  list(collection).forEach((entry,index)=>add(entry,profileFieldMarker(entry),Boolean(profileFieldMarker(entry)),`${path}.${index}`))
 }
 return candidates
}
function profileCandidateCorresponds(candidate,configured,spec){
 const observed=behavioralEvidenceValue(candidate?.observed)
 const expected=behavioralEvidenceValue(configured)
 if(!observed||!expected)return false
 const marker=normalize(candidate?.marker)
 if(candidate?.explicit&&!profileFieldMarkers(spec).has(marker))return false
 const normalizedObserved=normalize(observed);const normalizedExpected=normalize(expected)
 if(normalizedObserved===normalizedExpected||normalizedObserved.length>=8&&normalizedExpected.includes(normalizedObserved)||normalizedExpected.length>=8&&normalizedObserved.includes(normalizedExpected))return true
 const observedTokens=new Set(profileTokens(observed));const expectedTokens=profileTokens(expected)
 const overlap=expectedTokens.filter(token=>observedTokens.has(token))
 if(candidate?.explicit)return overlap.length>=1&&overlap.length/Math.max(1,expectedTokens.length)>=.25
 return profileBehaviorCue.test(observed)&&overlap.length>=2&&overlap.length/Math.max(1,expectedTokens.length)>=.5
}
function profileEpistemicType(item={}){
 const explicit=clean(item.epistemic_type??item.epistemicType??item.evidence_type??item.evidenceType??item.type,40).toUpperCase()
 if(profileAllowedEpistemicTypes.has(explicit))return explicit
 if(item.self_reported===true||item.selfReported===true)return 'QUOTE'
 return 'OBSERVATION'
}
function profileSupportedFields(client,linkedEvidence,validUntil,now){
 const configured=profileFieldSpecs.map(spec=>({spec,value:behavioralEvidenceValue(client[spec.key]??client[spec.aliases.find(alias=>client[alias]!=null)])})).filter(item=>item.value)
 const support=[]
 const genericEvidenceUsed=new Set()
 for(const field of configured){
  let selected=null
  for(const evidence of linkedEvidence){
   const evidenceId=profileEvidenceId(evidence)
   if(!profileConcreteEvidenceTypes.has(profileEpistemicType(evidence)))continue
   const validUntilCandidates=[evidence?.valid_until??evidence?.validUntil,validUntil].map(value=>new Date(value||'')).filter(value=>!Number.isNaN(value.getTime()))
   const effectiveValidUntil=validUntilCandidates.length?new Date(Math.min(...validUntilCandidates.map(value=>value.getTime()))).toISOString():null
   const sourceFreshness=evaluateSourceFreshness({domain:'BEHAVIORAL',sourceType:'behavioral_profile',source:evidence,observedAt:profileEvidenceTimestamp(evidence),validUntil:effectiveValidUntil,now})
   if(sourceFreshness.status!=='CURRENT')continue
   const candidates=profileEvidenceCandidates(evidence).filter(candidate=>profileCandidateCorresponds(candidate,field.value,field.spec))
   const candidate=candidates.find(item=>item.explicit)||candidates.find(item=>!genericEvidenceUsed.has(evidenceId))
   if(!candidate)continue
   selected={...field,evidence,evidenceId,observed:candidate.observed,explicit:candidate.explicit,locator:candidate.locator,validUntil:effectiveValidUntil}
   if(!candidate.explicit)genericEvidenceUsed.add(evidenceId)
   break
  }
  if(selected)support.push(selected)
 }
 return support.slice(0,4)
}

function fastProfilePresentation(facts={},now=new Date(),scope={}){
 const client=facts.client||{id:'unknown',name:'Produtor'}
 const name=clean(client.name,180)||'Produtor'
 const primary=clean(client.primaryProfile||client.primary_profile,120)
 const secondary=clean(client.secondaryProfile||client.secondary_profile,120)
 const expectedProducer=clean(scope.producerId||client.id,180)
 const expectedTenant=clean(scope.tenantId,180)
 const expectedOwner=clean(scope.ownerId,180)
 const rawProfileEvidence=list(facts.profileEvidence||client.profileEvidence)
 const validEvidence=rawProfileEvidence.filter(item=>{
  const producer=clean(item?.producer_id??item?.producerId??item?.client_id??item?.clientId,180)
  const tenant=clean(item?.tenant_id??item?.tenantId??item?.organization_id??item?.organizationId,180)
  const owner=clean(item?.context_owner_id??item?.contextOwnerId??item?.consultant_id??item?.consultantId??item?.owner_id??item?.ownerId,180)
  const evidenceId=profileEvidenceId(item)
  const sourceType=profileEvidenceSource(item)
  const observedAt=new Date(profileEvidenceTimestamp(item)||'')
  if(!producer||!tenant||expectedOwner&&!owner||!evidenceId||!sourceType||Number.isNaN(observedAt.getTime())||observedAt>now)return false
  if(producer!==expectedProducer||tenant!==expectedTenant||expectedOwner&&owner!==expectedOwner)return false
  const expiry=new Date(item?.valid_until??item?.validUntil??'')
  return Number.isNaN(expiry.getTime())||expiry>now
 })
 const sourceRef=clean(facts.profileSourceRef||client.profileSourceRef||client.profileSource||'',180)||null
 const linkedEvidence=sourceRef?validEvidence.filter(item=>profileEvidenceLinks(item).includes(sourceRef)):[]
 const validityCandidates=[...linkedEvidence.map(item=>item?.valid_until??item?.validUntil),facts.profileValidUntil,client.profileValidUntil].map(value=>new Date(value||'')).filter(value=>!Number.isNaN(value.getTime()))
 const validUntil=validityCandidates.length?new Date(Math.min(...validityCandidates.map(value=>value.getTime()))).toISOString():null
 const supportedFields=profileSupportedFields(client,linkedEvidence,validUntil,now)
 const supportingEvidence=[...new Map(supportedFields.map(item=>[item.evidenceId,item.evidence])).values()]
 const profileEvidenceRefs=supportingEvidence.map(profileEvidenceId).filter(Boolean)
 const assessedAt=supportingEvidence.map(profileEvidenceTimestamp).find(Boolean)||null
 const primaryFound=Boolean(primary&&sourceRef&&supportedFields.length>=2&&profileEvidenceRefs.length)
 if(!primaryFound){
  return {dataPath:'BEHAVIORAL_PROFILE',answer:'Não há evidência comportamental atual e auditável suficiente para determinar o perfil. Confiança: baixa. O que ainda não sabemos: como compara alternativas e qual evidência considera suficiente.',primaryFound:false,capabilityStatus:'NO_DATA',sourceRef:null,factsUsed:[],action:'Valide duas ou três evidências comportamentais antes de personalizar a abordagem.',missing:'Perfil comportamental atual com fonte auditável',doNotDo:'Não inferir perfil por cultura, cidade, área ou conteúdo de outro domínio.'}
 }
 const confidence=supportedFields.length>=3?'alta':'média'
 const reasons=supportedFields.map((item,index)=>{
  const type=profileEpistemicType(item.evidence)
  const prefix=index===0?'Por quê: ':''
  if(type==='QUOTE')return `${prefix}declaração em ${item.spec.label}: “${clean(item.observed,300)}”`
  if(type==='FACT')return `${prefix}registro factual em ${item.spec.label}: ${clean(item.observed,300)}`
  return `${prefix}observou-se em ${item.spec.label}: ${clean(item.observed,300)}`
 })
 const evidenceText=reasons.slice(0,4).join('. ')
 const unknown='validar se essas preferências continuam atuais'
 const answer=`Perfil principal: ${primary}${secondary?` (secundário: ${secondary})`:''}. Confiança: ${confidence}. ${evidenceText}. Como abordar: ${profileApproach(primary)}. O que ainda não sabemos: ${unknown}.`
 const primaryEvidenceRef=profileEvidenceRefs[0]
 const inferenceId=`profile-inference:${createHash('sha256').update(JSON.stringify({sourceRef,primary,secondary,evidence:profileEvidenceRefs})).digest('hex').slice(0,20)}`
 const observationFacts=supportingEvidence.map(evidence=>{
  const evidenceId=profileEvidenceId(evidence)
  const fields=supportedFields.filter(item=>item.evidenceId===evidenceId)
  const explicitSourceRef=clean(evidence?.source_ref??evidence?.sourceRef??evidence?.profile_source_ref??evidence?.profileSourceRef,180)
  const epistemicType=profileEpistemicType(evidence)
  const statement=fields.map(item=>epistemicType==='QUOTE'
   ?`Declaração em ${item.spec.label}: “${clean(item.observed,300)}”.`
   :epistemicType==='FACT'
    ?`Registro factual em ${item.spec.label}: ${clean(item.observed,300)}.`
    :`Observou-se em ${item.spec.label}: ${clean(item.observed,300)}.`).join(' ')
  return {
   id:evidenceId,source_type:profileEvidenceSource(evidence),...(explicitSourceRef&&explicitSourceRef!==evidenceId?{source_ref:explicitSourceRef}:{}),epistemic_type:epistemicType,producer_id:expectedProducer,tenant_id:expectedTenant,owner_id:expectedOwner||null,
   statement,evidence_claims:fields.map(item=>({field:item.spec.key,question_id:item.spec.question,source_locator:item.locator,statement:clean(item.observed,300)})),observed_at:profileEvidenceTimestamp(evidence),valid_until:evidence?.valid_until??evidence?.validUntil??validUntil,confidence:Number.isFinite(Number(evidence?.confidence))?Number(evidence.confidence):1
  }
 })
 const inferenceFact={
  id:inferenceId,source_type:'behavioral_profile',source_ref:primaryEvidenceRef,evidence_refs:profileEvidenceRefs,profile_record_ref:sourceRef,epistemic_type:'INFERENCE',producer_id:expectedProducer,tenant_id:expectedTenant,owner_id:expectedOwner||null,
  statement:`Perfil comportamental inferido de ${name}: ${primary}${secondary?` / ${secondary}`:''}.`,observed_at:assessedAt,valid_until:validUntil,confidence:confidence==='alta'?.9:.75
 }
 return {dataPath:'BEHAVIORAL_PROFILE',answer,primaryFound:true,sourceRef:primaryEvidenceRef,factsUsed:[...observationFacts,inferenceFact],action:`Para ${name}, ${profileApproach(primary)}.`,missing:unknown,doNotDo:'Não misturar contrato, crédito, grãos, produtos ou compromissos sem relação explícita com a pergunta de perfil.'}
}

function fastFactPresentation({facts,route,now,scope={}}){
 const client=facts.client||{id:'unknown',name:'Produtor'}
 const clientName=clean(client.name,180)||'Produtor'
 const dataPath=route.data_path||'LATEST_VISIT'
 if(dataPath==='BEHAVIORAL_PROFILE')return fastProfilePresentation(facts,now,scope)
 if(dataPath==='LATEST_VISIT'){
  const candidate=facts.latestCompletedVisit||facts.latestVisit||null
  const visit=candidate&&legacyVisitLifecycle(candidate)==='COMPLETED'?candidate:null
  const occurredAt=visit?.occurred_at||visit?.occurredAt||visit?.completed_at||visit?.completedAt||visit?.scheduled_at||visit?.scheduledAt||null
  const sourceRef=clean(visit?.id,180)||null
  const observedTime=new Date(occurredAt||'').getTime()
  const primaryFound=Boolean(visit&&sourceRef&&Number.isFinite(observedTime)&&observedTime<=now.getTime())
  const status=[clean(visit?.status,80),clean(visit?.lifecycle_status||visit?.lifecycleStatus,40)].filter(Boolean).join(' / ')||'concluída'
  const summary=clean(visit?.summary||visit?.objective||'',1200)
  const completedAnswer=primaryFound?`A última visita concluída de ${clientName} foi em ${fastDate(occurredAt)}, com status ${status}. ${summary||'O registro não traz resumo ou objetivo.'}`:'Ainda não há visita concluída registrada com referência auditável.'
  const factsUsed=[]
  if(primaryFound)factsUsed.push({id:sourceRef,source_type:'visit',statement:completedAnswer,observed_at:occurredAt,status:clean(visit.status,80)||null,lifecycle_status:clean(visit.lifecycle_status||visit.lifecycleStatus,40)||null,confidence:1})
  // A pergunta factual sobre a última visita usa somente a visita concluída.
  // A agenda futura pertence a outra faceta e não pode entrar na resposta,
  // nas evidências ou nos metadados selecionados para esta intenção.
  return {dataPath,answer:completedAnswer,primaryFound,sourceRef:primaryFound?sourceRef:null,factsUsed,action:clean(primaryFound&&(visit?.next_commitment||visit?.nextCommitment||visit?.next_action||visit?.nextAction)||'Confirme se houve uma visita ainda não registrada.',1200),missing:'Visita concluída com referência auditável',doNotDo:'Não apresentar visita planejada como contato realizado.',latestCompletedVisit:primaryFound?{id:sourceRef,status:visit.status||null,lifecycleStatus:visit.lifecycle_status||visit.lifecycleStatus||null,occurredAt}:null,nextScheduledVisit:null}
 }
 if(['LATEST_CONFIRMED_OBJECTION','LATEST_VISIT_CONFIRMED_OBJECTION'].includes(dataPath)){
  const latestVisitSpecific=dataPath==='LATEST_VISIT_CONFIRMED_OBJECTION'
  const report=latestVisitSpecific?facts.latestVisitConfirmedObjection||null:facts.latestConfirmedObjection||null
  const {objections,principal,ambiguous}=confirmedObjectionSelection(report)
  const observedAt=report?.confirmed_at||report?.confirmedAt||report?.created_at||report?.createdAt||null
  const scopeLabel=latestVisitSpecific?'na última visita concluída':'mais recente'
  const sourceRef=clean(report?.visit_report_id||report?.id,180)||null
  const hasAuditableEvidence=Boolean(sourceRef)
  const hasUnverifiableLegacyContent=objections.length>0&&!hasAuditableEvidence
  const answer=hasUnverifiableLegacyContent
   ?`Ainda não há objeção confirmada ${latestVisitSpecific?'na última visita concluída ':''}registrada com referência auditável.`
   :ambiguous?`Há ${objections.length} objeções confirmadas ${scopeLabel} de ${clientName}, mas nenhuma está marcada como principal: ${objections.map(item=>item.statement).join('; ')}.`:principal?`A objeção confirmada ${scopeLabel} de ${clientName} foi: ${principal}.`:`Ainda não há objeção confirmada ${latestVisitSpecific?'na última visita concluída ':''}registrada.`
  const completedVisit=facts.latestCompletedVisit&&legacyVisitLifecycle(facts.latestCompletedVisit)==='COMPLETED'?facts.latestCompletedVisit:null
  const reportVisitId=clean(report?.visit_id||report?.visitId,180)
  const completedVisitId=clean(completedVisit?.id,180)
  const correlatedVisit=latestVisitSpecific&&completedVisit&&(!reportVisitId||reportVisitId===completedVisitId)?completedVisit:null
  const visitId=latestVisitSpecific?(reportVisitId||completedVisitId):''
  const visitAt=latestVisitSpecific?(report?.visit_occurred_at||report?.visitOccurredAt||report?.visit_completed_at||report?.visitCompletedAt||report?.visit_scheduled_at||report?.visitScheduledAt||correlatedVisit?.occurred_at||correlatedVisit?.occurredAt||correlatedVisit?.completed_at||correlatedVisit?.completedAt||correlatedVisit?.scheduled_at||correlatedVisit?.scheduledAt||null):null
  const factsUsed=[]
  if(objections.length&&sourceRef)factsUsed.push({id:clean(sourceRef,180),source_type:'confirmed_visit_report',statement:answer,observed_at:observedAt,visit_id:visitId||null,visit_observed_at:visitAt,confidence:1})
  if(objections.length&&sourceRef&&latestVisitSpecific&&visitId)factsUsed.push({id:visitId,source_type:'visit',statement:`Visita concluída correlacionada ao relatório ${sourceRef}${visitAt?` em ${fastDate(visitAt)}`:''}.`,observed_at:visitAt,status:clean(report?.visit_status||report?.visitStatus||correlatedVisit?.status,80)||null,lifecycle_status:clean(report?.visit_lifecycle_status||report?.visitLifecycleStatus||correlatedVisit?.lifecycle_status||correlatedVisit?.lifecycleStatus,40)||'COMPLETED',confidence:1})
  const latestCompletedVisit=latestVisitSpecific&&sourceRef&&visitId?{id:visitId,status:report?.visit_status||report?.visitStatus||correlatedVisit?.status||null,lifecycleStatus:report?.visit_lifecycle_status||report?.visitLifecycleStatus||correlatedVisit?.lifecycle_status||correlatedVisit?.lifecycleStatus||'COMPLETED',occurredAt:visitAt}:null
  const primaryFound=Boolean(principal&&hasAuditableEvidence)
  const capabilityStatus=ambiguous&&hasAuditableEvidence?'INPUT_REQUIRED':primaryFound?undefined:'NO_DATA'
  return {dataPath,answer,primaryFound,capabilityStatus,sourceRef,factsUsed,action:ambiguous&&hasAuditableEvidence?'Defina qual objeção é principal antes de usá-la como eixo da abordagem.':primaryFound?'Use a objeção confirmada como contexto; valide se ela continua atual antes de decidir.':'Confirme a objeção em um registro canônico com identificador auditável.',missing:ambiguous&&hasAuditableEvidence?'Marcação da objeção principal':'Objeção confirmada com referência auditável',doNotDo:'Não promover relatório pendente, hipótese, texto legado sem identificador ou motivo de perda a objeção confirmada.',latestCompletedVisit}
 }
 if(dataPath==='LATEST_COMMITMENT'){
  const commitment=facts.latestCommitment||null
  const description=clean(commitment?.description||commitment?.action,700)
  const due=commitment?.due_at||commitment?.dueAt||null
  const status=clean(commitment?.status,80)
  const sourceRef=clean(commitment?.commitment_id||commitment?.id,180)||null
  const primaryFound=Boolean(description&&sourceRef)
  const answer=primaryFound?`O último compromisso registrado de ${clientName} é: ${description}${status?` — status ${status}`:''}${due?` — prazo ${fastDate(due)}`:''}.`:'Ainda não há compromisso registrado com referência auditável.'
  const factsUsed=primaryFound?[{id:sourceRef,source_type:'commitment',statement:answer,observed_at:commitment?.updated_at||commitment?.updatedAt||commitment?.created_at||commitment?.createdAt||null,status:status||null,confidence:1}]:[]
  return {dataPath,answer,primaryFound,capabilityStatus:primaryFound?undefined:'NO_DATA',sourceRef,factsUsed,action:primaryFound?'Valide o status do compromisso antes de criar outro.':'Confirme o compromisso em um registro canônico com identificador auditável.',missing:'Compromisso com referência auditável',doNotDo:'Não confundir compromisso proposto ou texto legado sem identificador com o registro canônico.'}
 }
 if(dataPath==='LATEST_PURCHASE'){
  const purchase=facts.latestPurchase||null
  const value=fastCurrency(purchase?.value,purchase?.currency)
  const product=clean(purchase?.product||purchase?.category,240)
  const rawQuantity=purchase?.quantity
  const quantity=rawQuantity!=null&&String(rawQuantity).trim()!==''&&Number.isFinite(Number(rawQuantity))?Number(rawQuantity).toLocaleString('pt-BR',{maximumFractionDigits:3}):''
  const occurredAt=purchase?.occurred_at||purchase?.occurredAt||purchase?.created_at||purchase?.createdAt||null
  const hasPurchaseContent=Boolean(purchase&&(value||product||quantity||occurredAt))
  const quantityUnit=clean(purchase?.unit||purchase?.quantity_unit||purchase?.quantityUnit,60)
  const details=[value,product?`produto/categoria ${product}`:'',quantity?`quantidade ${quantity}${quantityUnit?` ${quantityUnit}`:' (unidade não informada)'}`:''].filter(Boolean).join(', ')
  const sourceRef=clean(purchase?.id||purchase?.external_id||purchase?.externalId,180)||null
  const primaryFound=Boolean(hasPurchaseContent&&sourceRef)
  const answer=primaryFound?`A última compra registrada de ${clientName} foi em ${fastDate(occurredAt)}${details?`: ${details}`:''}.`:'Ainda não há compra concluída registrada com referência auditável.'
  const factsUsed=primaryFound?[{id:sourceRef,source_type:'business_event',statement:answer,observed_at:occurredAt,confidence:1}]:[]
  return {dataPath,answer,primaryFound,capabilityStatus:primaryFound?undefined:'NO_DATA',sourceRef,factsUsed,action:primaryFound?'Use o evento ganho mais recente como referência e informe um período se quiser o total comprado.':'Confirme a compra em um evento canônico com identificador auditável.',missing:'Compra concluída com referência auditável',doNotDo:'Não tratar oportunidade aberta, evento perdido, texto legado sem identificador ou total agregado como a última compra.'}
 }
 if(dataPath==='REGISTERED_CROPS'){
  const season=facts.latestCropSeason||null
  const crop=clean(season?.crop,120)
  const seasonLabel=clean(season?.season,60)
  const registered=clean(client.cultures,700)
 const rawSeasonArea=season?.area_ha??season?.areaHa
 const area=rawSeasonArea!=null&&String(rawSeasonArea).trim()!==''&&Number.isFinite(Number(rawSeasonArea))?`${Number(rawSeasonArea).toLocaleString('pt-BR',{maximumFractionDigits:2})} ha`:''
 const plantedAt=season?.planted_at||season?.plantedAt||null
  const seasonSourceRef=clean(season?.id,180)||null
  const seasonObservedAt=season?.updated_at||season?.updatedAt||season?.created_at||season?.createdAt||plantedAt
  const auditedSeason=Boolean(crop&&seasonSourceRef&&seasonObservedAt)
  const answer=auditedSeason?`A última safra registrada de ${clientName} é ${crop}${seasonLabel?` — safra ${seasonLabel}`:''}${area?` — área ${area}`:''}${plantedAt?` — plantio em ${fastDate(plantedAt)}`:''}. Isso não confirma que a cultura ainda está em campo.`:registered?`Culturas cadastradas para ${clientName}: ${registered}. O cadastro resumido não confirma plantio atual.`:'Ainda não há cultura ou safra registrada.'
  const sourceRef=auditedSeason?seasonSourceRef:registered?`client:${client.id}`:null
  const found=Boolean(auditedSeason||registered)
  const factsUsed=found?[{id:clean(sourceRef,180),source_type:auditedSeason?'crop_season':'client_registration',statement:answer,observed_at:auditedSeason?seasonObservedAt:null,confidence:1}]:[]
  return {dataPath,answer,primaryFound:found,sourceRef,factsUsed,action:'Confirme a situação atual da lavoura se a decisão depender de cultura em campo.',missing:'Cultura ou safra registrada',doNotDo:'Não afirmar plantio atual sem evidência temporal suficiente.'}
 }
 const totalArea=client.totalAreaHa??client.total_area_ha??client.area
 const numericArea=Number(totalArea)
 const areaBand=clean(client.areaBand??client.area_band,120)
 const hasNumericArea=totalArea!=null&&String(totalArea).trim()!==''&&Number.isFinite(numericArea)
 const found=hasNumericArea||Boolean(areaBand)
 const value=hasNumericArea?`${numericArea.toLocaleString('pt-BR',{maximumFractionDigits:2})} ha`:areaBand
 const answer=found?`A área total cadastrada de ${clientName} é ${value}.`:'Ainda não há área total cadastrada.'
 const sourceRef=found?`client:${client.id}`:null
 const factsUsed=found?[{id:sourceRef,source_type:'client_registration',statement:answer,observed_at:null,confidence:1}]:[]
 return {dataPath:'REGISTERED_AREA',answer,primaryFound:found,sourceRef,factsUsed,action:'Use o nível de área cadastrado e confirme divergências antes de calcular.',missing:'Área total cadastrada',doNotDo:'Não somar níveis de área potencialmente sobrepostos.'}
}

export function buildFastClientResponse({facts={},message='',organizationId='unknown',ownerId='',conversationId='',contextEpoch=0,contextDomain='',now=new Date(),latencyMs=0,executionCounts={}}={}){
 now=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date()
 const route=routeSystemCapability({message,intentHint:'ASK_CLIENT',hasClient:true})
 const client=facts.client||{id:'unknown',name:'Produtor'}
 const verifiedScope=assertFastFactsBoundary(facts,{tenantId:organizationId,ownerId})
 const presentation=fastFactPresentation({facts,route,now,scope:verifiedScope})
 const capability=route.capabilities[0]||'CLIENT_CONTEXT'
 const auditedSourceRef=clean(presentation.sourceRef,180)||null
 const normalizedEpoch=exactContextEpoch(contextEpoch)
 const auditedFactsUsed=list(presentation.factsUsed).filter(item=>clean(item?.id,180)).map(item=>({...item,producer_id:verifiedScope.producerId,tenant_id:verifiedScope.tenantId,owner_id:verifiedScope.ownerId,epistemic_type:item.epistemic_type||'FACT'}))
 const hasAuditableEvidence=Boolean(auditedSourceRef&&auditedFactsUsed.some(item=>clean(item.id,180)===auditedSourceRef))
 const evidenceVerified=Boolean(presentation.primaryFound&&hasAuditableEvidence)
 const capabilityStatus=presentation.capabilityStatus==='INPUT_REQUIRED'?'INPUT_REQUIRED':presentation.capabilityStatus==='NO_DATA'?'NO_DATA':evidenceVerified?'EXECUTED':'NO_DATA'
 const createdAt=now.toISOString()
 const contextHash=createHash('sha256').update(JSON.stringify({client:client.id,dataPath:presentation.dataPath,sourceRef:auditedSourceRef,message})).digest('hex')
 const entityResolutions=Math.max(0,Number(executionCounts.entityResolutions??1)||0)
 const dataLookups=Math.max(0,Number(executionCounts.dataLookups??1)||0)
 const hops=Math.max(0,Number(executionCounts.hops??(entityResolutions+dataLookups))||0)
 const executionBudget=Object.freeze({entityResolutions,dataLookups,modelCalls:0,toolCalls:1,hops,estimatedInputTokens:0,estimatedOutputTokens:0,estimatedCostUsd:0})
 const groundingDomain={BEHAVIORAL_PROFILE:'PROFILE',LATEST_VISIT:'VISIT',LATEST_COMMITMENT:'VISIT',LATEST_CONFIRMED_OBJECTION:'COMMERCIAL',LATEST_VISIT_CONFIRMED_OBJECTION:'MULTI_DOMAIN',LATEST_PURCHASE:'COMMERCIAL',REGISTERED_CROPS:'AGRONOMY',REGISTERED_AREA:'GENERAL'}[presentation.dataPath]||'GENERAL'
 const responseDomain=scopedResponseDomain(message,route.intent,contextDomain)
 if(responseDomain!==groundingDomain)throw Object.assign(new Error('O domínio factual não corresponde ao grounding selecionado.'),{code:'CONTEXT_SCOPE_VIOLATION',reason:'DOMAIN_MISMATCH',expectedDomain:groundingDomain,actualDomain:responseDomain})
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client:{id:String(client.id),name:clean(client.name,180)},context_snapshot:{id:`fast-${contextHash.slice(0,16)}`,version:'val.fast_data_snapshot.v1',confidence:{level:evidenceVerified?'VERIFICADO':'INSUFICIENTE'},hash:contextHash},conversation_id:clean(conversationId,180)||'stateless',intent:route.intent,persistence_mode:'NONE',objective:clean(message,1200),situation_summary:presentation.answer,key_signals:[],facts_used:auditedFactsUsed,hypotheses:[],missing_information:evidenceVerified?[]:[presentation.missing],decision_thesis:{CURRENT_SITUATION:presentation.answer,WHAT_MATTERS:'A resposta usa primeiro o registro estruturado mínimo e autorizado.',KEY_UNCERTAINTY:evidenceVerified?'O registro pode não refletir um fato ainda não salvo.':presentation.missing,THESIS:presentation.answer,WHY:evidenceVerified?'O lookup retornou um fato estruturado no escopo do produtor.':'O lookup não retornou evidência auditável suficiente.',WHAT_TO_VALIDATE:evidenceVerified?'Confirme se houve atualização posterior ainda não registrada.':presentation.missing,WHAT_WOULD_CHANGE_MY_VIEW:'Um registro estruturado mais recente e autorizado.'},golden_questions:[],recommended_strategy:{reading:presentation.answer,action:clean(presentation.action,1200),do_not_do:presentation.doNotDo},evidence_to_use:auditedFactsUsed,agronomic_context:{status:evidenceVerified&&presentation.dataPath==='REGISTERED_CROPS'?'registered_fact':'not_applicable',human_review_required:false,sources:{},safety_note:'Nenhuma prescrição ou recomendação agronômica foi produzida.'},commercial_context:{status:evidenceVerified?'structured_fact_lookup':'no_data',data_path:presentation.dataPath},next_commitment:clean(presentation.action,1200),risks:[],confidence:{level:evidenceVerified?'VERIFICADO':'INSUFICIENTE',score:evidenceVerified?0.98:0.2,rationale:evidenceVerified?'Leitura direta de registro estruturado autorizado com referência auditável.':'Não há registro com referência auditável suficiente para afirmar o fato.'},reasoning_confidence:{version:'val.reasoning_confidence.v1',context:evidenceVerified?0.98:0.2,thesis:evidenceVerified?0.98:0.2,question:.9,agronomy:null,knowledge:1,threshold:{ask_below:.72,answer_at_or_above:.72}},knowledge_refs:[],memory_refs:[],created_at:createdAt,model:'rules-fast-client-v1',prompt_version:'val-decision-copilot-v3',run:{provider:'system-capability-router',model:'rules-fast-client-v1',prompt_version:'val-decision-copilot-v3',context_hash:contextHash,latency_ms:Number(latencyMs)||0,status:'completed',fallback:false,path:'FAST',model_call_count:0,tool_call_count:1,hop_count:hops,estimated_input_tokens:0,estimated_output_tokens:0,estimated_cost_usd:0,capabilities_planned:route.capabilities,capabilities_used:capabilityStatus==='EXECUTED'?[capability]:[],capability_results:[{capability,status:capabilityStatus,source_ref:auditedSourceRef}],latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},premises:{recomputed_for_request:true,source:'authorized_fast_data',profile_specific:true,conversation_is_not_confirmed_memory:true,data_path:presentation.dataPath,context_scope:{tenant_id:String(organizationId),owner_id:clean(ownerId,180)||null,producer_id:String(client.id),conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,domain:responseDomain,minimum_sufficient_context:true},session_context:{conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,current_domain:responseDomain,persistence_mode:'NONE'}},voice_output:{version:'val.voice_output.v1',speakable_text:presentation.answer,persistence:'NONE',automatic_memory_effect:false},decision_interview:{version:'val.decision_interview.v1',status:'NOT_NEEDED',questions:[],material_missing_information:[],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'stateless',context_epoch:normalizedEpoch,persistence_mode:'NONE'},explanation:'A pergunta foi respondida diretamente por um lookup factual mínimo; nenhum modelo foi chamado.'},quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{name_swap:{passed:null,evaluated:false,reason:'Não aplicável a uma consulta literal de fato.'},context_removal:{passed:null,evaluated:false,reason:'Não executado no FAST PATH determinístico.'}}}
 }
 const grounding=assertResponseGrounding({question:message,answer:presentation.answer,domain:groundingDomain,evidence:auditedFactsUsed,activeProducerId:String(client.id),tenantId:String(organizationId),ownerId:clean(ownerId,180),now})
 reasoning.grounding=grounding
 reasoning.quality.automatic_tests.source_grounding={passed:grounding.passed,evaluated:true,unsupported_terms:grounding.unsupported_terms}
 reasoning.quality.automatic_tests.question_relevance={passed:grounding.question_relevance==='PASS',evaluated:true}
 if(capabilityStatus!=='EXECUTED')reasoning.run.capabilities_used=[]
 if(capabilityStatus==='INPUT_REQUIRED')reasoning.decision_interview={...reasoning.decision_interview,status:'NEEDS_INPUT',questions:[{question:'Qual das objeções confirmadas deve ser tratada como principal?',why_it_matters:'A escolha muda o eixo da abordagem e evita selecionar um item arbitrariamente.',priority:1}],material_missing_information:[presentation.missing],explanation:'Há mais de uma objeção confirmada e nenhuma está marcada como principal; a VAL não escolhe silenciosamente.'}
 return {recommendationId:null,engineMode:'rules',engineArchitecture:'fast-system-capability',route:'FAST',model:'rules-fast-client-v1',warning:'',globalCopilot:true,responseMetadata:{intent:route.intent,reasoningPath:'FAST',dataPath:presentation.dataPath,capabilities:route.capabilities,executionBudget,latestCompletedVisit:presentation.latestCompletedVisit??null,nextScheduledVisit:presentation.nextScheduledVisit??null},advice:{answer:presentation.answer,ai_reasoning:reasoning,val_response_quality:reasoning.quality}}
}
