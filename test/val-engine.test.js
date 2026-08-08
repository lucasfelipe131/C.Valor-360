import test from 'node:test'
import assert from 'node:assert/strict'
import {enforceValSafety,selectValModel,ValEngine} from '../server/val-engine.js'
import {buildFallbackAdvice} from '../server/sales-playbook.js'

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

test('resposta incompleta da OpenAI cai em fallback e preserva metadados de auditoria',async()=>{
  let modelRun
  const repository={
    getClientContext:async()=>({client:{name:'Teste'},signals:[],learning:{}}),
    recordRecommendation:async record=>{modelRun=record.modelRun;return '00000000-0000-4000-8000-000000000099'}
  }
  const runtimeConfig={openaiApiKey:'sk-test',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10000,maxOutputTokens:26000,strategicMaxOutputTokens:32000,openaiStoreResponses:false}
  const engine=new ValEngine({runtimeConfig,repository})
  engine.client={responses:{create:async()=>({id:'resp-incomplete',_request_id:'req-1',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:10,output_tokens:20},output_text:''})}}
  const result=await engine.answer({tenantId:'tenant',clientId:'client',client:{},message:'Prepare a visita'})
  assert.equal(result.engineMode,'fallback')
  assert.equal(modelRun.status,'incomplete')
  assert.equal(modelRun.model,'terra')
  assert.equal(modelRun.responseId,'resp-incomplete')
  assert.equal(modelRun.errorCode,'incomplete_response')
  assert.deepEqual(modelRun.errorDetails,{reason:'max_output_tokens'})
})
