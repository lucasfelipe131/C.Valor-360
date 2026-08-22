import {buildContextSnapshot} from '../../server/memory/context-snapshot.js'

export const tenantA='00000000-0000-4000-8000-000000000401'
export const tenantB='00000000-0000-4000-8000-000000000402'
export const actorA='00000000-0000-4000-8000-000000000403'

export function phase4Context(overrides={}){
 const context={
  client:{id:'producer-a',name:'Produtor A',primaryProfile:'Analítico',secondaryProfile:'Relacional',scores:{analitico:3,relacional:1,digital:2},commercial:{}},
  profile:{answers:{6:'Produtor e sócio',7:'Resultados técnicos, números e retorno financeiro.',8:'Comparativos, custos, gráficos e dados de produtividade.',14:'Dados técnicos e retorno sobre o investimento.'},assessedAt:'2026-08-20T10:00:00.000Z',evidence:[{id:'survey-a',source_type:'producer_questionnaire'}]},
  memoryHistory:[{id:'memory-a',tenant_id:tenantA,client_id:'producer-a',subject_type:'client',subject_id:'producer-a',memory_domain:'COMMERCIAL',memory_state:'FACT',key:'commercial_goal',value:'Proteger margem e validar retorno',status:'ACTIVE',source_ref:'survey-a',source_type:'producer_questionnaire',confidence:90,valid_from:'2026-08-01T00:00:00.000Z',created_at:'2026-08-01T00:00:00.000Z',updated_at:'2026-08-20T00:00:00.000Z',evidence_refs:[{id:'survey-a',source_type:'producer_questionnaire'}],acl:{scope:'own_portfolio'}}],
  memories:[],businessHistory:[{id:'business-a',outcome:'won',value:100000,occurred_at:'2026-07-01T00:00:00.000Z'}],visits:[],interactions:[{id:'interaction-a',summary:'Pediu comparativo e ROI.',occurred_at:'2026-08-19T00:00:00.000Z'}],
  opportunities:[{id:'opp-a',title:'Semente premium',stage:'proposta',estimated_value:80000,next_action:'Revisar comparativo',next_action_at:'2026-08-25T00:00:00.000Z',updated_at:'2026-08-20T00:00:00.000Z'},{id:'opp-b',title:'Tratamento complementar',stage:'diagnóstico',estimated_value:30000,next_action:'Confirmar problema',updated_at:'2026-08-18T00:00:00.000Z'}],
  properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],priorRecommendations:[],conversionInnovations:{}
 }
 Object.assign(context,overrides)
 const snapshot=buildContextSnapshot(context,{organizationId:tenantA,subjectType:'client',subjectId:'producer-a',actorId:actorA,role:'consultant',scope:'own_portfolio',objective:'next_best_action',requestId:'00000000-0000-4000-8000-000000000404',message:'Preparar decisão comercial',now:new Date('2026-08-22T12:00:00.000Z')})
 return {...context,contextSnapshot:snapshot}
}

export const baseAdvice={
 objective:'Avançar a decisão com evidência.',
 next_best_action:'Revisar o comparativo e combinar um teste com data.',
 executive_brief:{action:'Revisar o comparativo e combinar um teste com data.'},
 methodology_state:{current_stage:'construir_valor',working_stage:'construir_valor'},
 next_question:{question:'Qual ganho mínimo faria o investimento valer a pena?',purpose:'Define o break-even percebido.',grounding_ids:['survey-a']},
 questions:[],confidence:{missing_data:[],contradictions:[]},assumptions:[],evidence_used:[{id:'survey-a',claim_supported:'Preferência por dados e ROI.'}],blocked_actions:[],human_review:{required:false},value_hypothesis:{problem:'A solução precisa provar retorno sem ampliar risco indevido.',thesis:'Compare investimento incremental, risco e critério de sucesso.',implications:['Perder a janela sem validar pode manter a incerteza.']}
}

export const baseConversion={
 narrative:{action:'Revisar o comparativo e combinar um teste com data.',reason:'Oportunidade ativa, evidência registrada e próxima ação definida.'},
 selectedOpportunity:{reasons:['Etapa de proposta','Próxima ação registrada']},
 rankedOpportunities:[{id:'opp-a',title:'Semente premium',stage:'proposta'},{id:'opp-b',title:'Tratamento complementar',stage:'diagnóstico'}],
 guardrails:{humanReviewForTechnical:false}
}
