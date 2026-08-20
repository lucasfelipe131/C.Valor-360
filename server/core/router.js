import {assertRequestEnvelope} from './contracts.js'

export const coreRouterVersion='val.core.router.v1'

const criticalAgronomy=/\b(?:dose|dosagem|mistura|prescri(?:ção|cao|va)|diagn[oó]stic|receitu[aá]rio|taxa de aplica(?:ção|cao)|intervalo de seguran(?:ça|ca))\b/i
const agronomy=/\b(?:agron[oô]mic|lavoura|praga|doen(?:ça|ca)|solo|ndvi|foliar|fitossanit[aá]ri|talh[aã]o|cultivar|safra)\b/i
const visit=/\b(?:visita|reuni[aã]o|encontro)\b/i
const preparation=/\b(?:prepar|planej|roteiro|agenda|perguntas?)\b/i
const nextAction=/\b(?:pr[oó]xim[ao] (?:melhor )?(?:a(?:ção|cao)|passo)|o que fazer agora|avan(?:çar|car))\b/i

const routeDefinitions=Object.freeze({
  prepare_visit:Object.freeze({route_id:'prepare_visit.v1',modules:['MCTX','MMI','MIC','MDI','MVV'],reason_code:'explicit_visit_preparation',human_review:'policy_dependent'}),
  agronomic_critical:Object.freeze({route_id:'agronomic_critical.v1',modules:['MCTX','MMI','MIA','MGO'],reason_code:'critical_agronomic_language',human_review:'required'}),
  agronomic_question:Object.freeze({route_id:'agronomic_question.v1',modules:['MCTX','MMI','MIA'],reason_code:'agronomic_context',human_review:'policy_dependent'}),
  next_best_action:Object.freeze({route_id:'next_best_action.v1',modules:['MCTX','MMI','MDI','MVV','MEX'],reason_code:'explicit_next_action',human_review:'policy_dependent'}),
  general_assistance:Object.freeze({route_id:'general_assistance.v1',modules:['MCTX','MMI','MDI','MVV'],reason_code:'safe_default',human_review:'policy_dependent'})
})

export function resolveCoreObjective({message='',requestedStage=null}={}){
  const text=String(message||'')
  if(criticalAgronomy.test(text))return 'agronomic_critical'
  if(agronomy.test(text))return 'agronomic_question'
  if(visit.test(text)&&(preparation.test(text)||requestedStage))return 'prepare_visit'
  if(nextAction.test(text))return 'next_best_action'
  return 'general_assistance'
}

export function routeCoreRequest(envelope){
  assertRequestEnvelope(envelope)
  const definition=routeDefinitions[envelope.objective]
  return Object.freeze({
    contract_version:coreRouterVersion,
    route_id:definition.route_id,
    objective:envelope.objective,
    modules:Object.freeze([...definition.modules]),
    execution_plan:Object.freeze([Object.freeze({module_id:'LEGACY_VAL_ENGINE',required:true,timeout_ms:null})]),
    human_review:definition.human_review,
    reason_code:definition.reason_code
  })
}

export const coreRoutes=routeDefinitions
