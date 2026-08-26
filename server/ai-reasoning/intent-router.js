export const valIntentRouterVersion='val.intent_router.v2'

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
const clientOptionalIntents=new Set(['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET'])
const persistenceIntents=new Set(['REGISTER_INFORMATION','POST_VISIT'])

function semanticCurrentDataIntent(source=''){
 if(/\b(?:bula|registro agrofit|r[oó]tulo|car[eê]ncia|intervalo de seguran[cç]a)\b/i.test(source))return 'CHECK_LABEL'
 if(/\b(?:clima|tempo|chuva|temperatura|previs[aã]o meteorol[oó]gica)\b/i.test(source))return 'CHECK_WEATHER'
 if(/\b(?:soja|milho|trigo|sorgo|feij[aã]o|arroz|cevada)\b.*\b(?:cota[cç][aã]o|pre[cç]o|mercado|subiu|caiu|commodity|commodities)\b|\b(?:cota[cç][aã]o|pre[cç]o)\b.*\b(?:soja|milho|trigo|sorgo|feij[aã]o|arroz|cevada)\b/i.test(source))return 'ASK_COMMODITY'
 return ''
}

function semanticCommandIntent(source=''){
 if(/\b(?:prepar|roteiro|antes da)\w*\b.*\b(?:visit\w*|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b|\b(?:visit\w*|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))return 'PREPARE_VISIT'
 if(/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))return 'OBJECTION_HELP'
 if(/\b(?:oportunidade|pipeline|neg[oó]cio|proposta)\b/i.test(source))return 'CHECK_OPPORTUNITY'
 if(/\b(?:follow.?up|retomar|cobrar retorno|pr[oó]ximo contato)\b/i.test(source))return 'FOLLOW_UP_HELP'
 return ''
}

export function normalizeValIntent(value){
 const normalized=clean(value).toUpperCase()
 const canonical=legacyIntentAliases[normalized]||normalized
 return allowed.has(canonical)?canonical:null
}

export function routeValIntent({message='',intentHint='',hasClient=false,attachmentTypes=[]}={}){
 const hinted=normalizeValIntent(intentHint)
 const source=clean(message).toLocaleLowerCase('pt-BR')
 const hasImage=attachmentTypes.some(type=>String(type).startsWith('image/'))
 const semanticCurrent=semanticCurrentDataIntent(source)
 const semanticCommand=semanticCommandIntent(source)
 // Hints may come from an older client. They cannot downgrade an explicit
 // current-data request or a new explicit task into stale continuation.
 // Persistence remains fail-closed and can only be requested explicitly.
 let intent=persistenceIntents.has(hinted)?hinted:semanticCurrent||semanticCommand||hinted
 if(!intent){
  if(/\b(?:mercado|commodity|commodities|not[ií]cia econ[oô]mica)\b/i.test(source))intent='ASK_MARKET'
  else if(/\b(?:an[aá]lise de solo|laudo de solo|solo|ph|v%|satura[cç][aã]o|ctc|f[oó]sforo|pot[aá]ssio)\b/i.test(source))intent='ANALYZE_SOIL'
  else if(hasImage||/\b(?:foto|imagem|folha|planta|lavoura)\b.*\b(?:analis|diagn[oó]st|observe|interpre)/i.test(source))intent='IMAGE_DIAGNOSIS'
  else if(/\b(?:agron[oô]mic|praga|doen[cç]a|daninha|manejo|talh[aã]o|safra|cultiv)/i.test(source))intent='ASK_AGRONOMIC'
  else if(/\b(?:prepar|roteiro|antes da)\w*\b.*\bvisit\w*\b|\bvisit\w*\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))intent='PREPARE_VISIT'
  else if(/\b(?:registr|salv|grave|anote|memorize)\b.*\b(?:informa[cç][aã]o|nota|hist[oó]rico|mem[oó]ria|fato)\b/i.test(source))intent='REGISTER_INFORMATION'
  else if(/\b(?:p[oó]s[- ]?visita|depois da visita|resultado da visita)\b/i.test(source))intent='POST_VISIT'
  else if(/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))intent='OBJECTION_HELP'
  else if(/\b(?:oportunidade|pipeline|neg[oó]cio|proposta)\b/i.test(source))intent='CHECK_OPPORTUNITY'
  else if(/\b(?:follow.?up|retomar|cobrar retorno|pr[oó]ximo contato)\b/i.test(source))intent='FOLLOW_UP_HELP'
  else if(/\b(?:calcul|simul|retorno|roi|margem|ponto de equil[ií]brio|convers[aã]o de unidade)\b/i.test(source))intent='CALCULATE'
  else intent=hasClient?'ASK_CLIENT':'ASK_GENERAL'
 }
 const persistenceMode=['REGISTER_INFORMATION','POST_VISIT'].includes(intent)?'CONFIRM_REQUIRED':'NONE'
 return Object.freeze({
  version:valIntentRouterVersion,
  intent,
  persistence_mode:persistenceMode,
  client_context_required:!clientOptionalIntents.has(intent),
  requires_current_data:currentDataIntents.has(intent),
  reason:semanticCurrent&&semanticCurrent!==hinted?'semantic_current_data_override':hinted?'explicit_intent':'message_and_context'
 })
}
