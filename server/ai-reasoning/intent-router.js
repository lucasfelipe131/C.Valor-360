export const valIntentRouterVersion='val.intent_router.v1'
export const valIntents=Object.freeze([
 'ASK_GENERAL','ASK_CLIENT','PREPARE_VISIT','REGISTER_NOTE','POST_VISIT','AGRONOMIC_ANALYSIS','IMAGE_DIAGNOSIS',
 'SOIL_INTERPRETATION','VALUE_ANALYSIS','OBJECTION_HELP','OPPORTUNITY_REVIEW','FOLLOW_UP_HELP'
])

const allowed=new Set(valIntents)
const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,3000)

export function normalizeValIntent(value){
 const normalized=clean(value).toUpperCase()
 return allowed.has(normalized)?normalized:null
}

export function routeValIntent({message='',intentHint='',hasClient=false,attachmentTypes=[]}={}){
 const hinted=normalizeValIntent(intentHint)
 const source=clean(message).toLocaleLowerCase('pt-BR')
 const hasImage=attachmentTypes.some(type=>String(type).startsWith('image/'))
 let intent=hinted
 if(!intent){
  if(hasImage||/\b(?:foto|imagem|folha|planta|lavoura)\b.*\b(?:analis|diagn[oó]st|observe|interpre)/i.test(source))intent='IMAGE_DIAGNOSIS'
  else if(/\b(?:an[aá]lise de solo|solo|ph|v%|satura[cç][aã]o|ctc|f[oó]sforo|pot[aá]ssio)\b/i.test(source))intent='SOIL_INTERPRETATION'
  else if(/\b(?:agron[oô]mic|praga|doen[cç]a|daninha|manejo|talh[aã]o|safra|cultiv)/i.test(source))intent='AGRONOMIC_ANALYSIS'
  else if(/\b(?:prepar|roteiro|antes da)\b.*\bvisita\b|\bvisita\b.*\b(?:prepar|roteiro)/i.test(source))intent='PREPARE_VISIT'
  else if(/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))intent='OBJECTION_HELP'
  else if(/\b(?:oportunidade|pipeline|neg[oó]cio|proposta)\b/i.test(source))intent='OPPORTUNITY_REVIEW'
  else if(/\b(?:follow.?up|retomar|cobrar retorno|pr[oó]ximo contato)\b/i.test(source))intent='FOLLOW_UP_HELP'
  else if(/\b(?:valor|pre[cç]o|custo|retorno|roi|margem|ponto de equil[ií]brio)\b/i.test(source))intent='VALUE_ANALYSIS'
  else intent=hasClient?'ASK_CLIENT':'ASK_GENERAL'
 }
 const persistenceMode=['REGISTER_NOTE','POST_VISIT'].includes(intent)?'CONFIRM_REQUIRED':'NONE'
 return Object.freeze({version:valIntentRouterVersion,intent,persistence_mode:persistenceMode,client_context_required:intent!=='ASK_GENERAL',reason:hinted?'explicit_intent':'message_and_context'})
}
