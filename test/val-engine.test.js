import test from 'node:test'
import assert from 'node:assert/strict'
import {compactValContext,enforceValSafety,selectValModel,summarizeContextCoverage,ValEngine} from '../server/val-engine.js'
import {buildFallbackAdvice,valAdviceSchema} from '../server/sales-playbook.js'

const config={modelDaily:'terra',modelStrategic:'sol',modelFast:'luna'}

test('roteia custo e capacidade conforme a tarefa',()=>{
  assert.equal(selectValModel('prepare a visita','daily',config).model,'terra')
  assert.equal(selectValModel('crie o plano estratégico desta grande conta','daily',config).model,'sol')
  assert.equal(selectValModel('classifique esta importação','daily',config).model,'luna')
})

test('modo demonstrativo explicita evidências e limites',()=>{
  const advice=buildFallbackAdvice({client:{name:'Produtor Teste',primaryProfile:'Analítico',irt:70,nps:9,commercial:{frequency:5,opportunity:'revisar variabilidade'}},message:'Prepare a visita',signals:[],learning:{wins:2,losses:1}})
  assert.ok(advice.questions.length>=1&&advice.questions.length<=5)
  assert.equal(advice.next_question.stage,'problema')
  assert.match(advice.constructive_tension.permission_prompt,/Posso/i)
  assert.ok(advice.evidence_used.length>=3)
  assert.ok(advice.guardrails.some(item=>/demonstrativo/i.test(item)))
  assert.match(advice.executive_brief.action,/Agendar|Registrar/i)
  assert.ok(advice.executive_brief.evidence_ids.length<=3)
})

test('VAL compara a carteira de oportunidades e entrega roteiro até o próximo compromisso',()=>{
  const opportunities=[
    {id:'opp-1',title:'Tratamento de sementes',stage:'Proposta',estimated_value:80_000},
    {id:'opp-2',title:'Nutrição foliar',stage:'Diagnóstico',estimated_value:50_000},
    {id:'opp-3',title:'Safra anterior',stage:'Fechado',estimated_value:40_000}
  ]
  const advice=buildFallbackAdvice({client:{name:'Produtor Teste',commercial:{openPotential:150_000}},message:'Prepare o fechamento',opportunities,signals:[],learning:{}})
  assert.equal(advice.opportunity_review.total_considered,3)
  assert.equal(advice.opportunity_review.open_count,2)
  assert.equal(advice.opportunity_review.selected_title,'Tratamento de sementes')
  assert.equal(advice.opportunity_review.alternatives_considered.length,2)
  assert.ok(advice.executive_brief.decision_basis.every(item=>item.includes('→')))
  assert.ok(advice.conversation_plan.steps.length>=3)
  assert.ok(advice.conversation_plan.closing_options.length>=1)
  assert.ok(advice.conversation_plan.do_not_say.length>=1)
  assert.ok(valAdviceSchema.required.includes('opportunity_review'))
  assert.ok(valAdviceSchema.required.includes('conversation_plan'))
})

test('compactação do prompt preserva todas as oportunidades mesmo sob limite de contexto',()=>{
  const opportunities=Array.from({length:200},(_,index)=>({id:`opp-${index}`,external_key:`external-${index}`,title:`Oportunidade ${index} com descrição comercial extensa `.repeat(5),stage:index%4===0?'Fechado':'Diagnóstico',estimated_value:index*1_000,probability:index%101,next_action_at:'2026-09-01T12:00:00.000Z',evidence:[{type:'pipeline',summary:'Evidência extensa '.repeat(30)}]}))
  const compact=compactValContext({client:{id:'cliente',name:'Produtor Teste',commercial:{openPotential:250_000}},opportunities,businessHistory:Array.from({length:80},()=>({detail:'histórico '.repeat(500)}))},30_000)
  const items=compact.opportunities||compact.opportunityIndex?.items||[]
  assert.equal(items.length,200)
  assert.equal(compact.opportunityPortfolio.total,200)
  assert.equal(compact.opportunityPortfolio.open,150)
  assert.ok(JSON.stringify(compact).length<=30_000)
  const last=items.at(-1)
  assert.match(Array.isArray(last)?String(last[0]):String(last.title),/Oportunidade 199/)
})

test('perfil é hipótese adaptativa, não diagnóstico',()=>{
  const advice=buildFallbackAdvice({client:{name:'Teste',primaryProfile:'Conservador'},message:'Como abordar?',signals:[],learning:{}})
  assert.equal(advice.decision_profile.legacy_tag,'Conservador')
  assert.match(advice.decision_profile.adaptation,/não adapte somente/i)
 assert.equal(advice.confidence.level,'not_calibrated')
})

test('negação genérica nunca vira hipótese comercial da VAL',()=>{
  const advice=buildFallbackAdvice({client:{name:'Teste',additionalNeed:'Não.',additionalNeedStatus:'none_declared',commercial:{opportunity:'Não.'}},message:'Como abordar?',signals:[],learning:{}})
  assert.doesNotMatch(JSON.stringify(advice),/Onde [“\"]não[.\”\"]|hipótese cadastrada: não/i)
  assert.match(advice.answer,/não declarou necessidade adicional/i)
  assert.match(advice.next_question.question,/surgiu alguma prioridade|prefere manter/i)
  assert.match(advice.value_hypothesis.problem,/oportunidade não confirmada/i)
})

test('barreira técnica bloqueia conteúdo agronômico até revisão humana',()=>{
  const advice=buildFallbackAdvice({client:{name:'Teste'},message:'Calcule uma dose',signals:[],learning:{}})
  const safe=enforceValSafety(advice,{signals:[]},'Qual dose aplicar após a análise de solo?')
  assert.equal(safe.safe_to_show_customer,false)
  assert.equal(safe.human_review.required,true)
  assert.equal(safe.human_review.required_role,'technical_reviewer')
  assert.ok(safe.blocked_actions.some(item=>/dose/i.test(item)))
  assert.match(safe.executive_brief.headline,/revisão técnica/i)
})

test('barreira remove uma taxa de aplicação mesmo sem a palavra dose',()=>{
  const unsafe={...buildFallbackAdvice({client:{name:'Teste'},message:'',signals:[],learning:{}}),answer:'Use 2 L/ha do Produto X amanhã.',next_best_action:'Aplicar no talhão 4.',human_review:{required:false,reason:'',required_role:'none'}}
  const safe=enforceValSafety(unsafe,{client:{name:'Teste'},signals:[],learning:{}},'O que fazer amanhã?')
  assert.equal(safe.human_review.required,true)
  assert.doesNotMatch(safe.answer,/2\s*L\/ha|Produto X/i)
  assert.match(safe.next_best_action,/responsável técnico/i)
  assert.equal(safe.constructive_tension.status,'blocked')
})

test('barreira também remove taxa escondida em qualquer campo estruturado',()=>{
  const unsafe={...buildFallbackAdvice({client:{name:'Teste'},message:'',signals:[],learning:{}}),value_hypothesis:{...buildFallbackAdvice({client:{name:'Teste'},message:'',signals:[],learning:{}}).value_hypothesis,proof_plan:'Teste com 2 L/ha do Produto X.'}}
  const safe=enforceValSafety(unsafe,{client:{name:'Teste'},signals:[],learning:{}},'Prepare a conversa')
  assert.equal(safe.human_review.required,true)
  assert.doesNotMatch(JSON.stringify(safe),/2\s*L\/ha|Produto X/i)
})

test('barreira não ecoa produto ou taxa recebidos no pedido e no contexto',()=>{
  const unsafe=buildFallbackAdvice({client:{name:'Teste',commercial:{opportunity:'Produto X em 2 L/ha'}},message:'Use Produto X em 2 L/ha',signals:[],learning:{}})
  const safe=enforceValSafety(unsafe,{client:{name:'Teste',commercial:{opportunity:'Produto X em 2 L/ha'}},signals:[],learning:{}},'Use Produto X em 2 L/ha')
  assert.equal(safe.human_review.required,true)
  assert.doesNotMatch(JSON.stringify(safe),/2\s*L\/ha|Produto X/i)
  assert.deepEqual(safe.evidence_used,[])
})

test('conversa comercial comum não recebe falso bloqueio pelo texto dos guardrails',()=>{
  const advice=buildFallbackAdvice({client:{name:'Teste'},message:'Como abordar?',signals:[],learning:{}})
  const safe=enforceValSafety(advice,{client:{name:'Teste'},signals:[],learning:{}},'Como devo abordar este produtor?')
  assert.equal(safe.human_review.required,false)
})

test('sinal técnico pendente enriquece a estratégia sem apagar a recomendação comercial',()=>{
  const context={client:{name:'Teste'},signals:[{id:'soil-1',title:'Ponto de solo para validar',requires_agronomist:true}],learning:{}}
  const advice=buildFallbackAdvice({...context,message:'Como abordar este produtor usando o contexto da análise de solo?'})
  const safe=enforceValSafety(advice,context,'Como abordar este produtor usando o contexto da análise de solo?')
  assert.doesNotMatch(safe.answer,/reteve qualquer orientação|adaptação comercial foi suspensa/i)
  assert.match(safe.next_best_action,/pergunta|conversa|acompanhamento/i)
  assert.equal(safe.human_review.required,true)
  assert.ok(safe.blocked_actions.some(item=>/diagnóstico/i.test(item)))
})

test('linguagem de recomendação comercial não é confundida com prescrição agronômica',()=>{
  const context={client:{name:'Teste'},signals:[{id:'soil-1',title:'Solo recente',requires_agronomist:true}],learning:{}}
  const advice=buildFallbackAdvice({...context,message:'Como devo preparar a próxima visita?'})
  advice.answer='Recomendo usar perguntas sobre a análise de solo para preparar a visita e confirmar a prioridade com o produtor.'
  advice.next_best_action='Use o registro apenas para organizar a descoberta comercial.'
  const safe=enforceValSafety(advice,context,'Como devo preparar a próxima visita?')
  assert.equal(safe.answer,advice.answer)
  assert.doesNotMatch(safe.answer,/reteve qualquer orientação/i)
})

test('cobertura do dossiê contabiliza todas as fontes conectadas',()=>{
  const coverage=summarizeContextCoverage({client:{id:'cliente'},profile:{answers:{1:'Nome',2:'Cidade'}},businessHistory:[{}],visits:[{}],interactions:[{}],opportunities:[{}],properties:[{}],fieldReports:[{}],soilAnalyses:[{}],ndviObservations:[{}],manualRecords:[{}],signals:[{}],memories:[{}],priorRecommendations:[{}]})
  assert.deepEqual(coverage,{profile:true,questionnaire:2,businessEvents:1,visits:1,interactions:1,opportunities:1,properties:1,fieldReports:1,soilAnalyses:1,ndvi:1,manualRecords:1,signals:1,memories:1,priorRecommendations:1})
})

test('resposta incompleta da OpenAI cai em fallback e preserva metadados de auditoria',async()=>{
  let modelRun,providerOptions
  const repository={
    getClientContext:async()=>({client:{name:'Teste'},signals:[],learning:{}}),
    recordRecommendation:async record=>{modelRun=record.modelRun;return '00000000-0000-4000-8000-000000000099'}
  }
  const runtimeConfig={openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10000,maxOutputTokens:26000,strategicMaxOutputTokens:32000,openaiStoreResponses:false}
  const engine=new ValEngine({runtimeConfig,repository})
  engine.client={responses:{create:async(_request,options)=>{providerOptions=options;return {id:'resp-incomplete',_request_id:'req-1',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:10,output_tokens:20},output_text:''}}}}
  const result=await engine.answer({tenantId:'tenant',clientId:'client',client:{},message:'Prepare a visita'})
  assert.equal(result.engineMode,'fallback')
  assert.equal(modelRun.status,'incomplete')
  assert.equal(modelRun.model,'terra')
  assert.equal(modelRun.responseId,'resp-incomplete')
  assert.equal(modelRun.errorCode,'incomplete_response')
  assert.deepEqual(modelRun.errorDetails,{reason:'max_output_tokens'})
  assert.deepEqual(providerOptions,{maxRetries:0,timeout:1000})
})

test('relatório de safra estruturado entra como evidência específica da VAL',()=>{
  const advice=buildFallbackAdvice({
    client:{name:'Produtor Teste'},signals:[],learning:{},
    fieldReports:[{
      id:'report-1',external_id:'manual-report-1',crop_stage:'Soja · 2026/2027',
      summary:'Custo de R$ 4.800/ha, produtividade de 62 sc/ha e margem estimada de R$ 1.200/ha.',
      observed_at:'2026-08-11T15:00:00Z',validated_at:'2026-08-11T15:10:00Z'
    }]
  })
  const item=advice.evidence_used.find(evidence=>evidence.id==='latest-field-report')
  assert.ok(item)
  assert.match(item.claim_supported,/Soja · 2026\/2027/)
  assert.match(item.claim_supported,/margem estimada de R\$ 1\.200\/ha/i)
  assert.equal(item.quality,'high')
})
