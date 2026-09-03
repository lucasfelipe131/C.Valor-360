import {routeSessionCommand} from './session-command-router.js'

export const globalIntentRouterVersion='val.global_intent_router.v1'

export const globalIntents=Object.freeze([
 'ASK','OPEN','SEARCH','PREPARE','REGISTER','UPDATE','CREATE','CALCULATE','ANALYZE','NAVIGATE','FOLLOW_UP','COMPARE','SHOW','EXPLAIN','MARK_COMPLETE'
])

const clean=(value,max=1200)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const fold=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const clientRef=client=>client?.id?Object.freeze({id:clean(client.id,180),name:clean(client.name,180)||null}):null

const modules=Object.freeze([
 {page:'dashboard',label:'Início',pattern:/\b(?:inicio|home|painel|dashboard)\b/},
 {page:'clients',label:'Clientes',pattern:/\b(?:clientes|carteira|produtores)\b/},
 {page:'visits',label:'Visitas',pattern:/\b(?:visitas|agenda|compromissos)\b/},
 {page:'opportunities',label:'Oportunidades',pattern:/\b(?:oportunidades|pipeline|negocios|propostas)\b/},
 {page:'reports',label:'Relatórios',pattern:/\b(?:relatorios|indicadores)\b/},
 {page:'datahub',label:'Base Inteligente',pattern:/\b(?:base inteligente|data hub|datahub|importacao)\b/},
 {page:'agro',tool:'soil',manualPage:'solo',label:'Análise de solo',pattern:/\b(?:analise de solo|fertilidade|laudo de solo)\b/},
 {page:'agro',tool:'mapping',manualPage:'produtores',label:'Mapeamento',pattern:/\b(?:mapeamento|mapa de area|mapa da propriedade|mapa da fazenda)\b/},
 {page:'agro',tool:'mapping',manualPage:'produtores',label:'Propriedade e talhões',pattern:/\b(?:fazenda|propriedade|talhoes|talhao)\b/},
 {page:'agro',tool:'calculators',manualPage:'calculadoras',label:'Calculadoras',pattern:/\b(?:calculadoras?|calculos agronomicos)\b/},
 {page:'agro',tool:'diagnosis',manualPage:'diagnostico',label:'NutriScan',diagnosisMode:'nutrition',pattern:/\b(?:nutriscan|nutri scan)\b/},
 {page:'agro',tool:'diagnosis',manualPage:'diagnostico',label:'FitoScan',diagnosisMode:'disease',pattern:/\b(?:fitoscan|fito scan)\b/},
 {page:'agro',label:'Inteligência Agronômica',pattern:/\b(?:inteligencia agronomica|agronomia|ambiente agronomico)\b/},
])

const action=({type,page='',label='',client=null,tool='',manualPage='',diagnosisMode='',requiresConfirmation=false}={})=>Object.freeze({
 contract_version:'val.workspace_action.v1',type,page,label,client_id:client?.id||null,client_name:client?.name||null,tool:tool||null,manual_page:manualPage||null,diagnosis_mode:diagnosisMode||null,requires_confirmation:Boolean(requiresConfirmation),persistence:'NONE'
})

const result=({intent='ASK',reason='GENERAL_ASK',direct=false,workspaceAction=null,summary='',requiresConfirmation=false}={})=>Object.freeze({
 contract_version:globalIntentRouterVersion,intent,reason,direct:Boolean(direct),requires_confirmation:Boolean(requiresConfirmation),workspace_action:workspaceAction,summary:clean(summary,500)
})

/**
 * Deterministic router for UI/workspace operations. It never performs writes;
 * mutation intents remain confirmation-gated and are handed to canonical modules.
 */
export function routeGlobalIntent({message='',client=null,workspaceContext=null}={}){
 const source=fold(message)
 const authorizedClient=clientRef(client)
 if(!source)return result()
 // "vai" e "va" so sao verbos de abrir como movimento ("vai para oportunidades"); como auxiliar
 // ("vai chover", "vai plantar", "vai ter geada") a frase e uma pergunta, nao navegacao.
 const openVerb=/\b(?:abre|abra|abrir|navega|navegue|mostra|mostre|mostrar|leva|ir para|volta para|volte para)\b|\b(?:vai|va)\s+(?:para|pra|pro|ao|a|na|no|em)\b/.test(source)
 const searchVerb=/^(?:val\s+)?(?:agora\s+)?(?:procura|procure|busca|buscar|localiza|localize|encontra|encontre)\b/.test(source)
 const factualImperative=/^(?:val\s+)?(?:agora\s+)?(?:mostre|mostra|me\s+mostre|me\s+mostra)\s+(?:as?\s+|o\s+)?(?:culturas?|safra|area|perfil)\s+(?:dele|dela|(?:do|da)\s+[a-z][a-z0-9 '-]{0,120})[.!?]?$/.test(source)
 // Pergunta sobre dado (perfil, cotacao, clima, "quantos", "qual") nunca vira navegacao, mesmo
 // com verbo de abrir ou de busca: "mostra o perfil dele" responde o perfil, "busca a cotacao da
 // soja" consulta o mercado. A resposta e do raciocinio ou da fonte, nao de uma troca de tela.
 const dataQuestion=/\?\s*$/.test(source)||/\b(?:perfil|cotacao|preco|clima|chover|geada|granizo|bula|quanto|quantos|quantas|qual|quais|como|quando|onde|por que|porque)\b/.test(source)
 const factualLookup=factualImperative||dataQuestion||/\b(?:ultima|ultimo|mais recente|principal)\b.*\b(?:visita|compra|objecao|compromisso)\b|\b(?:visita|compra|objecao|compromisso)\b(?:\s+confirmad[oa])?\s+(?:ultima|ultimo|mais recente|principal)\b(?:\s+(?:dele|dela))?|\b(?:quanto|qual|quais)\b.*\b(?:comprou|cultura|safra|area)\b/.test(source)
 const followUp=routeSessionCommand(message)||/\b(?:volta no que)\b/.test(source)
 if(followUp)return result({intent:'FOLLOW_UP',reason:'CONVERSATION_FAST_PATH'})
 const prepareVisit=/\b(?:prepara|prepare|preparar|preparacao|monta|monte)\b.*\b(?:visita|conversa)\b|\b(?:visita|conversa)\b.*\b(?:prepara|prepare|preparar|preparacao|roteiro)\b/.test(source)
 // Pedir preparação não é pedir navegação. Só abrir a tela quando o usuário
 // usar um verbo de abrir; caso contrário a preparação pertence ao raciocínio,
 // como em toda outra rota direta deste roteador.
 if(prepareVisit&&openVerb&&authorizedClient){
  const workspaceAction=action({type:'PREPARE_VISIT',page:'visits',label:`Preparar visita de ${authorizedClient.name||'produtor'}`,client:authorizedClient})
  return result({intent:'PREPARE',reason:'PREPARE_AUTHORIZED_CLIENT',direct:true,workspaceAction,summary:`Abrindo a preparação de visita de ${authorizedClient.name||'produtor'}.`})
 }
 if(!factualLookup&&openVerb&&authorizedClient&&/\b(?:cliente|produtor|produtora)\b/.test(source)){
  const workspaceAction=action({type:'OPEN_CLIENT',page:'client360',label:`Abrir ${authorizedClient.name||'produtor'}`,client:authorizedClient})
  return result({intent:'OPEN',reason:'OPEN_AUTHORIZED_CLIENT',direct:true,workspaceAction,summary:`Abrindo ${authorizedClient.name||'o produtor'} no Cliente 360.`})
 }
 if(!factualLookup&&openVerb){
  const module=modules.find(candidate=>candidate.pattern.test(source))
  if(module){
   const workspaceAction=action({type:'NAVIGATE',...module,client:['agro','visits','opportunities','client360'].includes(module.page)?authorizedClient:null})
   return result({intent:'NAVIGATE',reason:'NAVIGATE_CANONICAL_MODULE',direct:true,workspaceAction,summary:`Abrindo ${module.label}.`})
  }
 }
 if(!factualLookup&&openVerb&&authorizedClient&&!modules.some(module=>module.pattern.test(source))&&/^\s*(?:val\s+)?(?:agora\s+)?(?:abre|abra|abrir|mostra|mostre|mostrar)\b/.test(source)){
  const workspaceAction=action({type:'OPEN_CLIENT',page:'client360',label:`Abrir ${authorizedClient.name||'produtor'}`,client:authorizedClient})
  return result({intent:'OPEN',reason:'OPEN_RESOLVED_CLIENT',direct:true,workspaceAction,summary:`Abrindo ${authorizedClient.name||'o produtor'} no Cliente 360.`})
 }
 if(searchVerb&&authorizedClient&&!factualLookup&&!modules.some(module=>module.pattern.test(source))){
  const workspaceAction=action({type:'OPEN_CLIENT',page:'client360',label:`Abrir ${authorizedClient.name||'produtor'}`,client:authorizedClient})
  return result({intent:'SEARCH',reason:'SEARCH_RESOLVED_CLIENT',direct:true,workspaceAction,summary:`Localizei ${authorizedClient.name||'o produtor'} na sua carteira autorizada.`})
 }
 if(/\b(?:marca|marque|conclui|concluir|finaliza|finalize)\b.*\b(?:compromisso|tarefa|visita)\b/.test(source))return result({intent:'MARK_COMPLETE',reason:'WRITE_CONFIRMATION_REQUIRED',requiresConfirmation:true,summary:'A conclusão exige confirmação no módulo canônico antes de persistir.'})
 if(/\b(?:cria|crie|agende|agenda|nova)\b.*\b(?:visita|oportunidade|compromisso)\b/.test(source))return result({intent:'CREATE',reason:'WRITE_CONFIRMATION_REQUIRED',requiresConfirmation:true,summary:'A criação exige revisão e confirmação antes de persistir.'})
 if(/\b(?:registra|registre|anota|anote|atualiza|atualize)\b/.test(source))return result({intent:/\b(?:atualiza|atualize)\b/.test(source)?'UPDATE':'REGISTER',reason:'WRITE_CONFIRMATION_REQUIRED',requiresConfirmation:true,summary:'A alteração exige revisão e confirmação antes de persistir.'})
 if(/\b(?:calcula|calcule|calcular|simula|simule)\b/.test(source))return result({intent:'CALCULATE',reason:'CANONICAL_CALCULATOR'})
 if(/\b(?:quanto|cotacao|preco)\b.*\b(?:soja|milho|trigo|sorgo|feijao|arroz|cevada)\b|\b(?:soja|milho|trigo|sorgo|feijao|arroz|cevada)\b.*\b(?:hoje|cotacao|preco|mercado)\b/.test(source))return result({intent:'SHOW',reason:'LIVE_MARKET_DATA'})
 if(/\b(?:analisa|analise|interpretar|interpreta)\b/.test(source))return result({intent:'ANALYZE',reason:'CANONICAL_ANALYSIS'})
 if(/\b(?:compara|compare)\b/.test(source))return result({intent:'COMPARE',reason:'CONTEXTUAL_REASONING'})
 if(/\b(?:explica|explique|por que)\b/.test(source))return result({intent:'EXPLAIN',reason:'CONVERSATION_FOLLOW_UP'})
 if(workspaceContext?.current_module&&/\b(?:aqui|nesta tela|nesse modulo)\b/.test(source))return result({intent:'SHOW',reason:'CURRENT_WORKSPACE_CONTEXT'})
 return result()
}
