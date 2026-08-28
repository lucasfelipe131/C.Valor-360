import {routeSessionCommand} from '../decision-copilot/session-command-router.js'

export const valIntentRouterVersion='val.intent_router.v3'

// Canonical Decision Copilot intents. Legacy v2 names remain accepted through
// aliases so saved shortcuts and stacked branches do not break.
export const valIntents=Object.freeze([
 'ASK_GENERAL','ASK_CLIENT','ASK_AGRONOMIC','ASK_MARKET','ASK_COMMODITY','PREPARE_VISIT',
 'REGISTER_INFORMATION','POST_VISIT','ANALYZE_SOIL','IMAGE_DIAGNOSIS','CALCULATE','CHECK_LABEL',
 'CHECK_WEATHER','CHECK_MARKET','CHECK_OPPORTUNITY','OBJECTION_HELP','FOLLOW_UP_HELP'
])

export const legacyIntentAliases=Object.freeze({
 REGISTER_NOTE:'REGISTER_INFORMATION',
 AGRONOMIC_ANALYSIS:'ASK_AGRONOMIC',
 SOIL_INTERPRETATION:'ANALYZE_SOIL',
 VALUE_ANALYSIS:'CALCULATE',
 OPPORTUNITY_REVIEW:'CHECK_OPPORTUNITY'
})

const allowed=new Set(valIntents)
const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,3000)
const currentDataIntents=new Set(['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET','CHECK_WEATHER','CHECK_LABEL'])
const clientOptionalIntents=new Set(['ASK_GENERAL','ASK_MARKET','ASK_COMMODITY','CHECK_MARKET','CHECK_WEATHER','CHECK_LABEL'])
const persistenceIntents=new Set(['REGISTER_INFORMATION','POST_VISIT'])

export function isCurrentClientIdentityRequest(source=''){
 const normalized=String(source).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim().replace(/[?!.,;:]+$/g,'').trim()
 return /^(?:(?:(?:por favor|(?:me\s+)?(?:confirme|diga|mostre|responda))(?:\s+em\s+uma\s+linha)?)[,:]?\s+)*(?:(?:qual|quem)\s+(?:e\s+)?(?:o\s+)?(?:produtor|cliente)\s+(?:atual|selecionad[oa]|desta conversa)|(?:com\s+)?qual\s+(?:produtor|cliente)\s+(?:estou|estamos|esta selecionad[oa]))$/.test(normalized)
}

function semanticCurrentDataIntent(source=''){
 if(/\b(?:bula|registro agrofit|r[oó]tulo|car[eê]ncia|intervalo de seguran[cç]a)\b/i.test(source))return 'CHECK_LABEL'
 if(/\b(?:clima|tempo|chuva|temperatura|previs[aã]o meteorol[oó]gica)\b/i.test(source))return 'CHECK_WEATHER'
 if(/\b(?:soja|milho|trigo|sorgo|feij[aã]o|arroz|cevada)\b.*\b(?:cota[cç][aã]o|pre[cç]o|mercado|subiu|caiu|commodity|commodities)\b|\b(?:cota[cç][aã]o|pre[cç]o)\b.*\b(?:soja|milho|trigo|sorgo|feij[aã]o|arroz|cevada)\b/i.test(source))return 'ASK_COMMODITY'
 return ''
}

function semanticCommandIntent(source=''){
 if(/\b(?:prepar|roteiro|antes da)\w*\b.*\b(?:visit\w*|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b|\b(?:visit\w*|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))return 'PREPARE_VISIT'
 if(/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))return 'OBJECTION_HELP'
 if(/\b(?:oportunidades?|pipeline|neg[oó]cios?|propostas?)\b/i.test(source))return 'CHECK_OPPORTUNITY'
 if(/\b(?:follow.?up|retomar|cobrar retorno|pr[oó]ximo contato)\b/i.test(source))return 'FOLLOW_UP_HELP'
 return ''
}

function semanticToolHint(source='',hasImage=false){
 const normalized=String(source).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 if(/\b(?:nutriscan|nutri scan)\b/i.test(normalized))return 'NUTRISCAN'
 if(/\b(?:fitoscan|fito scan|fitscan|fit scan)\b/i.test(normalized))return 'FITOSCAN'
 if(/\b(?:mapeamento|mapear|mapa da (?:area|propriedade|fazenda)|desenhar (?:a )?area|geometria do talhao)\b/i.test(normalized))return 'AREA_MAPPING'
 if(/\b(?:calcul\w*|simul\w*|custo\s*\/\s*ha|roi|margem|ponto de equilibrio)\b/i.test(normalized))return 'CALCULATOR'
 if(/\b(?:analise de solo|laudo de solo|interpreta(?:r)? (?:essa|esta|a) analise)\b/i.test(normalized))return 'SOIL_ANALYSIS'
 if(hasImage||/\b(?:analis\w*|diagnostic\w*|interpret\w*)\b.*\b(?:foto|imagem)\b|\b(?:foto|imagem)\b.*\b(?:analis\w*|diagnostic\w*|interpret\w*)\b/i.test(normalized))return 'PHOTO_DIAGNOSIS'
 if(/\b(?:quais|que|liste|listar|mostre|mostrar|resuma)\b.*\b(?:ferramentas?|capacidades?|recursos?)\b.*\b(?:agronom\w*|tecnic\w*|de campo|aqui|na val)\b/i.test(normalized))return 'AGRONOMIC_TOOL_CATALOG'
 return null
}

function semanticToolIntent(toolHint){
 if(toolHint==='CALCULATOR')return 'CALCULATE'
 if(toolHint==='SOIL_ANALYSIS')return 'ANALYZE_SOIL'
 if(['NUTRISCAN','FITOSCAN','PHOTO_DIAGNOSIS'].includes(toolHint))return 'IMAGE_DIAGNOSIS'
 if(toolHint==='AREA_MAPPING')return 'ASK_AGRONOMIC'
 if(toolHint==='AGRONOMIC_TOOL_CATALOG')return 'ASK_AGRONOMIC'
 return ''
}

export function normalizeValIntent(value){
 const normalized=clean(value).toUpperCase()
 const canonical=legacyIntentAliases[normalized]||normalized
 return allowed.has(canonical)?canonical:null
}

export function routeValIntent({message='',intentHint='',sessionCommandHint='',hasClient=false,attachmentTypes=[]}={}){
 const hinted=normalizeValIntent(intentHint)
 const source=clean(message).toLocaleLowerCase('pt-BR')
 const hasImage=attachmentTypes.some(type=>String(type).startsWith('image/'))
 const sessionCommand=routeSessionCommand(source,sessionCommandHint)
 const toolHint=semanticToolHint(source,hasImage)
 const toolIntent=semanticToolIntent(toolHint)
 const semanticCurrent=semanticCurrentDataIntent(source)
 const semanticCommand=semanticCommandIntent(source)
 const semanticClientIdentity=isCurrentClientIdentityRequest(source)?'ASK_CLIENT':''
 // Hints may come from an older client. They cannot downgrade an explicit
 // current-data request or a new explicit task into stale continuation.
 // Persistence remains fail-closed and can only be requested explicitly.
 const genericAgroToolOverride=hinted==='ASK_AGRONOMIC'?toolIntent:''
 const explicitCalculatorAction=/\b(?:calcul\w*|simul\w*|rod\w*|execut\w*|abr\w*)\b/i.test(source)
 const calculatorToolOverride=toolHint==='CALCULATOR'&&explicitCalculatorAction?'CALCULATE':''
 let intent=sessionCommand?.command==='REGISTER_LAST'?'REGISTER_INFORMATION':persistenceIntents.has(hinted)?hinted:semanticCurrent||semanticCommand||semanticClientIdentity||calculatorToolOverride||genericAgroToolOverride||hinted
 if(!intent){
  if(/\b(?:mercado|commodity|commodities|not[ií]cia econ[oô]mica)\b/i.test(source))intent='ASK_MARKET'
  else if(toolHint==='SOIL_ANALYSIS'||/\b(?:an[aá]lise de solo|laudo de solo|solo|ph|v%|satura[cç][aã]o|ctc|f[oó]sforo|pot[aá]ssio)\b/i.test(source))intent='ANALYZE_SOIL'
  else if(['NUTRISCAN','FITOSCAN','PHOTO_DIAGNOSIS'].includes(toolHint)||hasImage)intent='IMAGE_DIAGNOSIS'
  else if(toolHint==='AREA_MAPPING')intent='ASK_AGRONOMIC'
  else if(/\b(?:agron[oô]mic|praga|doen[cç]a|daninha|manejo|talh[aã]o|safra|cultiv)/i.test(source))intent='ASK_AGRONOMIC'
  else if(/\b(?:prepar|roteiro|antes da)\w*\b.*\bvisit\w*\b|\bvisit\w*\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))intent='PREPARE_VISIT'
  else if(/^(?:val[, ]+)?(?:registra|registre|anota|anote)\s+que\b/i.test(source)||/\b(?:registr|salv|grave|anote|memorize)\b.*\b(?:informa[cç][aã]o|nota|hist[oó]rico|mem[oó]ria|fato)\b/i.test(source))intent='REGISTER_INFORMATION'
  else if(/\b(?:p[oó]s[- ]?visita|depois da visita|resultado da visita)\b/i.test(source))intent='POST_VISIT'
  else if(/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))intent='OBJECTION_HELP'
  else if(/\b(?:oportunidades?|pipeline|neg[oó]cios?|propostas?)\b/i.test(source))intent='CHECK_OPPORTUNITY'
  else if(/\b(?:follow.?up|retomar|cobrar retorno|pr[oó]ximo contato)\b/i.test(source))intent='FOLLOW_UP_HELP'
  else if(toolHint==='CALCULATOR'||/\b(?:calcul\w*|simul\w*|retorno|roi|margem|ponto de equil[ií]brio|convers[aã]o de unidade)\b/i.test(source))intent='CALCULATE'
  else intent=hasClient?'ASK_CLIENT':'ASK_GENERAL'
 }
 const persistenceMode=sessionCommand?.persistence_mode||(['REGISTER_INFORMATION','POST_VISIT'].includes(intent)?'CONFIRM_REQUIRED':'NONE')
 return Object.freeze({
  version:valIntentRouterVersion,
  intent,
  persistence_mode:persistenceMode,
  client_context_required:toolHint!=='AGRONOMIC_TOOL_CATALOG'&&!clientOptionalIntents.has(intent),
  requires_current_data:currentDataIntents.has(intent),
  session_command:sessionCommand,
  tool_hint:toolHint,
  reason:sessionCommand?'session_command':semanticCurrent&&semanticCurrent!==hinted?'semantic_current_data_override':semanticClientIdentity&&semanticClientIdentity!==hinted?'semantic_client_identity_override':hinted?'explicit_intent':'message_and_context'
 })
}
