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

const fold=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
// Pergunta conceitual: "o que e X", "explique X", "como funciona X", "qual a diferenca entre".
// Nao muda de destino porque existe um produtor selecionado.
const definitionalShape=/^(?:(?:val[, ]+)?(?:me\s+)?(?:o que (?:e|sao|significa|quer dizer)|explique|explica|explicar|defina|define|resuma|descreva|conceito de|como funciona|como se calcula|qual (?:e )?(?:a|o) (?:diferenca|importancia|funcao|papel|objetivo|finalidade)|quero entender|quero saber o que e|pode me explicar|me explica))\b/
// Referencia a um individuo ou a um dado especifico: espelha isGeneralConceptRequest do executor.
const contextualReference=/\b(?:deste|desse|dessa|desta|daquele|daquela|daquilo|atual|selecionad[oa]|produtor|cliente|conta|oportunidade|visita|talhao|propriedade|laudo|analise|fazenda|dele|dela)\b/
const individualReference=/\b(?:ele|ela|dele|dela|deste|desse|desta|dessa|daquele|daquela|meu cliente|minha conta|es[st]e (?:cliente|produtor)|aquele produtor|(?:cliente|produtor) selecionad[oa]|(?:desta|dessa) conversa|do (?:sr|senhor|seu|sra|senhora|dona)\b)\b/
const greetingOrThanks=/^\s*(?:val[, ]+)?(?:(?:muito\s+)?(?:oi+|ola|opa|e\s*ai|eae|hey|hi|hello|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|como\s*vai|como\s*voce\s*esta|beleza|obrigad[oa]s?|valeu|show|perfeito|entendi|certo|ok|okay|blz|ta\s*bom|combinado|legal)[\s!.,?]*){1,3}(?:(?:val|viu|hein|demais|mesmo)[\s!.,?]*)?$/
const currentMoment=/\b(?:hoje|amanha|agora|atual(?:mente)?|previsao|proxim[oa]s? (?:dias|semana|horas)|esta semana|nesta semana|fim de semana|ontem|semana que vem|nos proximos)\b/

function semanticGeneralConceptIntent(source=''){
 const folded=fold(source)
 if(greetingOrThanks.test(folded))return 'ASK_GENERAL'
 if(definitionalShape.test(folded)&&!contextualReference.test(folded))return 'ASK_GENERAL'
 return ''
}

// Dado vivo exige intencao de dado vivo, nao so o lexema: "quanto tempo leva para a soja
// emergir" e "o que e periodo de carencia" sao perguntas de conhecimento; "como esta o tempo
// hoje" e "qual a bula do produto X" pedem fonte atual.
function semanticCurrentDataIntent(source=''){
 const folded=fold(source)
 const definitional=definitionalShape.test(folded)
 if(/\b(?:bula|registro agrofit|rotulo)\b/.test(folded))return 'CHECK_LABEL'
 if(!definitional&&/\b(?:carencia|intervalo de seguranca)\b/.test(folded)&&/\b(?:produto|defensivo|fungicida|herbicida|inseticida|aplic\w*|colh\w*|dose)\b/.test(folded))return 'CHECK_LABEL'
 if(/\b(?:clima|previsao (?:do tempo|meteorologica)|como (?:esta|ta|vai estar) o tempo|vai chover|vai ter (?:chuva|geada|granizo)|esta chovendo|vai fazer (?:frio|calor))\b/.test(folded))return 'CHECK_WEATHER'
 if(!definitional&&/\b(?:tempo|chuva|temperatura|geada|granizo)\b/.test(folded)&&currentMoment.test(folded))return 'CHECK_WEATHER'
 if(/\b(?:soja|milho|trigo|sorgo|feij[aã]o|arroz|cevada)\b.*\b(?:cota[cç][aã]o|pre[cç]o|mercado|subiu|caiu|commodity|commodities)\b|\b(?:cota[cç][aã]o|pre[cç]o)\b.*\b(?:soja|milho|trigo|sorgo|feij[aã]o|arroz|cevada)\b/i.test(source))return 'ASK_COMMODITY'
 return ''
}

// Objecao e oportunidade sao comandos sobre um produtor concreto (o selecionado, ou "ele",
// "dele", "esse cliente"). Sem essa referencia, "produtor nao quer mudar" e "custo de
// oportunidade da terra" sao perguntas de conhecimento e seguem para a Biblioteca.
function semanticCommandIntent(source='',hasClient=false){
 const folded=fold(source)
 const individual=hasClient||individualReference.test(folded)
 if(/\b(?:prepar|roteiro|antes da)\w*\b.*\b(?:visit\w*|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b|\b(?:visit\w*|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))return 'PREPARE_VISIT'
 if(individual&&/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))return 'OBJECTION_HELP'
 if(individual&&/\b(?:oportunidades?|pipeline|neg[oó]cios?|propostas?)\b/i.test(source))return 'CHECK_OPPORTUNITY'
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
 const semanticCommand=semanticCommandIntent(source,hasClient)
 const semanticClientIdentity=isCurrentClientIdentityRequest(source)?'ASK_CLIENT':''
 const semanticGeneral=semanticGeneralConceptIntent(source)
 const folded=fold(source)
 const individual=hasClient||individualReference.test(folded)
 // Hints may come from an older client. They cannot downgrade an explicit
 // current-data request or a new explicit task into stale continuation.
 // Persistence remains fail-closed and can only be requested explicitly.
 const genericAgroToolOverride=hinted==='ASK_AGRONOMIC'?toolIntent:''
 const explicitCalculatorAction=/\b(?:calcul\w*|simul\w*|rod\w*|execut\w*|abr\w*)\b/i.test(source)
 const calculatorToolOverride=toolHint==='CALCULATOR'&&explicitCalculatorAction?'CALCULATE':''
 let intent=sessionCommand?.command==='REGISTER_LAST'?'REGISTER_INFORMATION':persistenceIntents.has(hinted)?hinted:semanticCurrent||semanticCommand||semanticClientIdentity||semanticGeneral||calculatorToolOverride||genericAgroToolOverride||hinted
 if(!intent){
  if(/\b(?:mercado|commodity|commodities|not[ií]cia econ[oô]mica)\b/i.test(source))intent='ASK_MARKET'
  // Interpretar um laudo e ferramenta; "qual a funcao do potassio na planta" e conhecimento.
  else if(toolHint==='SOIL_ANALYSIS'||/\b(?:an[aá]lise de solo|laudo de solo)\b/i.test(source)||/\b(?:solo|ph|v%|satura[cç][aã]o|ctc|f[oó]sforo|pot[aá]ssio)\b/i.test(source)&&/\b(?:laudo|an[aá]lise|resultado|interpret\w*|anex\w*|amostra\w*)\b/i.test(source))intent='ANALYZE_SOIL'
  else if(/\b(?:solo|ph|v%|satura[cç][aã]o|ctc|f[oó]sforo|pot[aá]ssio|calagem|aduba[cç][aã]o|nutri[cç][aã]o)\b/i.test(source))intent='ASK_AGRONOMIC'
  else if(['NUTRISCAN','FITOSCAN','PHOTO_DIAGNOSIS'].includes(toolHint)||hasImage)intent='IMAGE_DIAGNOSIS'
  else if(toolHint==='AREA_MAPPING')intent='ASK_AGRONOMIC'
  else if(/\b(?:agron[oô]mic|praga|doen[cç]a|daninha|manejo|talh[aã]o|safra|cultiv)/i.test(source))intent='ASK_AGRONOMIC'
  else if(/\b(?:prepar|roteiro|antes da)\w*\b.*\bvisit\w*\b|\bvisit\w*\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))intent='PREPARE_VISIT'
  else if(/^(?:val[, ]+)?(?:registra|registre|anota|anote)\s+que\b/i.test(source)||/\b(?:registr|salv|grave|anote|memorize)\b.*\b(?:informa[cç][aã]o|nota|hist[oó]rico|mem[oó]ria|fato)\b/i.test(source))intent='REGISTER_INFORMATION'
  else if(/\b(?:p[oó]s[- ]?visita|depois da visita|resultado da visita)\b/i.test(source))intent='POST_VISIT'
  else if(individual&&/\b(?:obje[cç][aã]o|resist[eê]ncia|discord|recus|n[aã]o quer)\b/i.test(source))intent='OBJECTION_HELP'
  else if(individual&&/\b(?:oportunidades?|pipeline|neg[oó]cios?|propostas?)\b/i.test(source))intent='CHECK_OPPORTUNITY'
  else if(/\b(?:follow.?up|retomar|cobrar retorno|pr[oó]ximo contato)\b/i.test(source))intent='FOLLOW_UP_HELP'
  // Pergunta aritmetica de plantabilidade ("300 mil plantas por hectare em 45 cm") ou de custo
  // por hectare com os dois numeros ("gastei 750 mil reais em 300 hectares") e calculo, mesmo sem
  // a palavra "calcule". Sem numero e sem verbo de calculo, "o que e margem de contribuicao" e
  // "como explicar ROI" sao conhecimento, nao pedido de ferramenta.
  else if(/\d[\d. ]*\s*(?:mil\s+)?(?:plantas|sementes)\s*(?:por|\/)\s*(?:hectare|ha|metro|m)\b/i.test(source))intent='CALCULATE'
  else if(/\d/.test(source)&&/\b(?:custo|custou|gastei|gasto|gastos|investi|investimento|paguei|reais|r\$)\b|r\$/i.test(folded)&&/\b(?:hectares?|ha|por ha|alqueires?|area)\b|\/ha\b/i.test(folded))intent='CALCULATE'
  else if((toolHint==='CALCULATOR'||/\b(?:calcul\w*|simul\w*|retorno|roi|margem|ponto de equil[ií]brio|convers[aã]o de unidade)\b/i.test(source))&&(explicitCalculatorAction||/\d/.test(source)||/\bquanto (?:e|da|fica|custa|rende|vale)\b|\bquant[ao]s\b/.test(folded)))intent='CALCULATE'
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
  reason:sessionCommand?'session_command':semanticCurrent&&semanticCurrent!==hinted?'semantic_current_data_override':semanticClientIdentity&&semanticClientIdentity!==hinted?'semantic_client_identity_override':semanticGeneral&&!semanticCurrent&&!semanticCommand&&!semanticClientIdentity&&semanticGeneral!==hinted?'semantic_general_override':hinted?'explicit_intent':'message_and_context'
 })
}
