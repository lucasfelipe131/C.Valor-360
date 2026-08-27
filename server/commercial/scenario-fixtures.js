import {commercialScenarioFixtureVersion} from './contracts.js'

const definitions=[
 ['01','Fertilizante: pista boa, carro errado','analytical','BUILD_VALUE','TESTED'],
 ['02','Buva e custo de não agir','analytical','DIAGNOSE','MAPPED'],
 ['03','Semente premium versus concorrente','hybrid','BUILD_VALUE','MAPPED'],
 ['04','Objeção: está caro','hybrid','NEGOTIATE','TESTED'],
 ['05','Produtor analítico digital','analytical','DIAGNOSE','TESTED'],
 ['06','Produtor relacional','relational','DIAGNOSE','TESTED'],
 ['07','Produtor conservador','conservative','DIAGNOSE','TESTED'],
 ['08','Produtor inovador','innovative','BUILD_VALUE','TESTED'],
 ['09','Visita sem histórico suficiente','unknown','EXPLORE','TESTED'],
 ['10','Pós-visita por áudio','hybrid','EXPLORE','MAPPED'],
 ['11','Negócio perdido','hybrid','DIAGNOSE','MAPPED'],
 ['12','Cross-sell identificado','hybrid','EXPLORE','MAPPED'],
 ['13','Área lado a lado','conservative','BUILD_VALUE','MAPPED'],
 ['14','Dados conflitantes','hybrid','DIAGNOSE','MAPPED'],
 ['15','Baixa confiança agronômica','hybrid','DIAGNOSE','MAPPED'],
 ['16','Representante de multinacional','hybrid','PROPOSE','MAPPED'],
 ['17','Gestor regional','management','EXPLORE','MAPPED'],
 ['18','Onboarding de consultor novo','hybrid','EXPLORE','MAPPED'],
 ['19','ROI do treinamento','analytical','BUILD_VALUE','MAPPED'],
 ['20','Conectividade limitada no campo','hybrid','EXPLORE','MAPPED']
]

const baseFixture=([id,title,profile,stage,state])=>Object.freeze({
 contract_version:commercialScenarioFixtureVersion,
 scenario_id:`MASTER-${id}`,
 source:'VAL Projeto Mestre Expandido v1.0',
 title,
 objective:'Produzir uma decisão específica, explicável e um próximo passo proporcional à evidência.',
 producer_profile:profile,
 commercial_stage:stage,
 context:{case_only:true,title},
 good_behaviors:['PREPARATION','OPEN_QUESTIONS','EVIDENCE','ECONOMIC_DIMENSIONING','PROFILE_ADAPTATION','EXPLICIT_NEXT_STEP'],
 bad_behaviors:['GENERIC_APPROACH','PRODUCT_BEFORE_DIAGNOSIS','EARLY_PRICE','PREMATURE_DISCOUNT','NO_EVIDENCE','NO_COMMITMENT'],
 expected_questions:['Pergunta de ouro ligada à lacuna capaz de mudar materialmente a decisão.'],
 expected_decision_pattern:'Contexto → problema confirmado → impacto → alternativas e trade-offs → próximo passo.',
 forbidden_patterns:['AUTOMATIC_DISCOUNT','INVENTED_NUMBER','TECHNICAL_GUARANTEE','PROFILE_STEREOTYPE','PRESSURE'],
 expected_commitment:'Próximo passo explícito e proporcional à base disponível.',
 technical_claims_status:'CASE_ONLY',
 state,
 owner:'MIC/MDI/MVV'
})

export const commercialScenarioFixtures=Object.freeze(definitions.map(baseFixture))

export const raulScenarioFixtures=Object.freeze({
 weak:Object.freeze({
  contract_version:commercialScenarioFixtureVersion,scenario_id:'RAUL-WEAK',source:'Simulada-base Raul — Projeto Mestre',objective:'Detectar abordagem que reduz valor.',producer_profile:'hybrid',commercial_stage:'EXPLORE',
  context:{case_only:true,approach:'Estava passando e já quis mostrar produto e preço; fez perguntas fechadas, falou demais, pediu desconto, chamou o gerente para conseguir preço e terminou sem compromisso e sem próximo passo.'},
  good_behaviors:[],bad_behaviors:['GENERIC_APPROACH','PRODUCT_BEFORE_DIAGNOSIS','EARLY_PRICE','CLOSED_QUESTIONS','TALK_TOO_MUCH','TECHNICAL_UNPREPAREDNESS','PREMATURE_DISCOUNT','MANAGER_FOR_PRICE','NO_EVIDENCE','NO_COMMITMENT'],
  expected_questions:[],expected_decision_pattern:'Retornar à preparação e ao diagnóstico.',forbidden_patterns:['AUTOMATIC_DISCOUNT','PRESSURE'],expected_commitment:'Definir objetivo e dado a coletar antes de propor.',technical_claims_status:'CASE_ONLY',state:'TESTED',owner:'MVV'
 }),
 value:Object.freeze({
  contract_version:commercialScenarioFixtureVersion,scenario_id:'RAUL-VALUE',source:'Simulada-base Raul — Projeto Mestre',objective:'Detectar venda de valor preparada.',producer_profile:'hybrid',commercial_stage:'BUILD_VALUE',
  context:{case_only:true,approach:'Chegou preparado, conhecia a propriedade, recuperou o histórico, fez perguntas abertas, dimensionou impacto, mostrou evidências, adaptou a prova e terminou com compromisso e próximo passo.'},
  good_behaviors:['PREPARATION','PROPERTY_KNOWLEDGE','OPEN_QUESTIONS','HISTORY_RETRIEVAL','ECONOMIC_DIMENSIONING','EVIDENCE','PROFILE_ADAPTATION','COMMITMENT','EXPLICIT_NEXT_STEP'],bad_behaviors:[],
  expected_questions:['O que impediu o atingimento da meta?','Qual prova mudaria esta decisão?'],expected_decision_pattern:'Problema relevante → impacto quantificado → solução coerente → risco-retorno → compromisso.',forbidden_patterns:['AUTOMATIC_DISCOUNT','TECHNICAL_GUARANTEE'],expected_commitment:'Teste, pedido ou nova decisão com data.',technical_claims_status:'CASE_ONLY',state:'TESTED',owner:'MIC/MDI/MVV'
 })
})

const negativePatterns=[
 ['GENERIC_APPROACH',/estava passando|sem objetivo/],['PRODUCT_BEFORE_DIAGNOSIS',/produto antes|mostrar produto|ja quis mostrar produto/],['EARLY_PRICE',/preco cedo|produto e preco/],['CLOSED_QUESTIONS',/perguntas fechadas/],['TALK_TOO_MUCH',/falou demais/],['TECHNICAL_UNPREPAREDNESS',/desconhecimento tecnico|inseguranca tecnica/],['PREMATURE_DISCOUNT',/desconto/],['MANAGER_FOR_PRICE',/gerente.*preco/],['NO_EVIDENCE',/sem evidencia|nao usou evidencia/],['NO_COMMITMENT',/sem compromisso|sem proximo passo/]
]
const positivePatterns=[
 ['PREPARATION',/preparad/],['PROPERTY_KNOWLEDGE',/conhecia a propriedade|passou pelos talhoes/],['OPEN_QUESTIONS',/perguntas abertas/],['HISTORY_RETRIEVAL',/recuperou o historico|historico da propriedade/],['ECONOMIC_DIMENSIONING',/dimensionou|impacto economico|custo de nao agir/],['EVIDENCE',/evidencia/],['PROFILE_ADAPTATION',/adaptou.*perfil|adaptou a prova/],['COMMITMENT',/compromisso/],['EXPLICIT_NEXT_STEP',/proximo passo/]
]
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()

export function evaluateCommercialApproach(value){
 const corpus=normalize(typeof value==='string'?value:value?.context?.approach)
 return {
  negative_patterns:negativePatterns.filter(([,pattern])=>pattern.test(corpus)).map(([code])=>code),
  positive_patterns:positivePatterns.filter(([,pattern])=>pattern.test(corpus)).map(([code])=>code)
 }
}

export function scenarioTraceability(){
 return commercialScenarioFixtures.map(item=>({scenario:item.scenario_id,requirement:'Comportamento comercial específico, seguro e rastreável.',fixture:item.scenario_id,test:item.state==='TESTED'?`test/phase4-commercial-scenarios.test.js#${item.scenario_id}`:null,module:item.owner,owner:item.owner,state:item.state}))
}
