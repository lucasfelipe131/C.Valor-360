const PRIORITY_CODES={
  imediata:'imediata',
  alta:'esta_semana',
  esta_semana:'esta_semana',
  'esta semana':'esta_semana',
  média:'acompanhar',
  media:'acompanhar',
  acompanhar:'acompanhar',
  qualificar:'acompanhar',
  sem_acao:'sem_acao'
}

const CONFIDENCE_CODES={
  alta:'high',
  high:'high',
  moderada:'moderate',
  média:'moderate',
  media:'moderate',
  moderate:'moderate',
  baixa:'low',
  low:'low',
  insuficiente:'insufficient',
  insufficient:'insufficient',
  not_calibrated:'not_calibrated'
}

const text=value=>String(value??'').replace(/\s+/g,' ').trim()
const list=value=>Array.isArray(value)?value:[]
const unique=items=>[...new Set(items.map(text).filter(Boolean))]

export function toValUiPriority(value){
  return PRIORITY_CODES[text(value).toLocaleLowerCase('pt-BR')]||'acompanhar'
}

export function toValUiConfidence(value){
  return CONFIDENCE_CODES[text(value).toLocaleLowerCase('pt-BR')]||'not_calibrated'
}

function priorityLabel(value){
  const code=toValUiPriority(value)
  if(code==='imediata')return 'imediata'
  if(code==='esta_semana')return 'esta semana'
  if(code==='sem_acao')return 'sem ação comercial agora'
  return 'acompanhar'
}

function visibleContradictions(result,conversion){
  return unique([
    ...list(conversion?.confidence?.contradictions),
    ...list(conversion?.dataQuality?.contradictions),
    ...list(result?.confidence?.contradictions),
    ...list(result?.conversion_intelligence?.data_quality?.contradictions)
  ])
}

function normalizeConfidence(result,conversion){
  const current=result?.confidence&&typeof result.confidence==='object'?result.confidence:{}
  const core=conversion?.confidence&&typeof conversion.confidence==='object'?conversion.confidence:{}
  const contradictions=visibleContradictions(result,conversion)
  const missing=unique([
    ...contradictions.map(item=>`Inconsistência: ${item}`),
    ...list(core.missingData),
    ...list(current.missing_data)
  ]).slice(0,8)
  const score=Number.isFinite(Number(core.score))?Number(core.score):Number.isFinite(Number(current.score))?Number(current.score):null
  let rationale=text(core.rationale||current.rationale)
  if(!/probabilidade de compra/i.test(rationale))rationale=`${rationale}${rationale?' ':''}Este indicador mede a sustentação dos dados; não é probabilidade de compra.`
  if(contradictions.length&&!/inconsist/i.test(rationale))rationale+=` Há ${contradictions.length} inconsistência(s) que precisam ser corrigidas antes da decisão.`
  return {
    ...current,
    level:toValUiConfidence(core.level||current.level),
    ...(score===null?{}:{score}),
    calibration_status:'not_calibrated',
    rationale,
    missing_data:missing,
    contradictions,
    conversion_probability:null
  }
}

function validConversationStep(item){
  return item&&typeof item==='object'&&text(item.stage)&&text(item.goal)&&text(item.suggested_line)&&text(item.advance_signal)
}

function normalizeConversationPlan(result,conversion){
  const current=result?.conversation_plan&&typeof result.conversation_plan==='object'?result.conversation_plan:{}
  const currentSteps=list(current.steps)
  if(currentSteps.length&&currentSteps.every(validConversationStep))return current
  const workflow=conversion?.workflow||{}
  const selected=conversion?.selectedOpportunity||{}
  const question=text(workflow.question)||'Qual informação precisamos confirmar para tomar a próxima decisão?'
  const action=text(workflow.action)||'Confirmar contexto, critério e próximo passo.'
  const closed=text(workflow.closedQuestion)||'Qual é o próximo passo útil, quem assume e até quando?'
  const gate=text(workflow.successGate)||'Existe ação bilateral com responsável, data e evidência de conclusão.'
  const avoid=text(workflow.avoid)||'Não pressionar nem preencher lacunas com suposições.'
  return {
    opening:text(current.opening)||`Retome “${text(selected.title)||'a oportunidade'}” e confirme se a decisão continua ativa.`,
    steps:[
      {
        stage:'contexto',
        goal:'Confirmar o cenário e o critério de decisão.',
        suggested_line:question,
        question_type:'aberta',
        advance_signal:'O produtor confirma contexto, prioridade ou dado ausente.',
        if_resistance:'Explique que a pergunta evita uma proposta genérica e não pressione.'
      },
      {
        stage:'decisão',
        goal:text(workflow.label)||'Transformar contexto em decisão verificável.',
        suggested_line:action,
        question_type:'não_aplicável',
        advance_signal:gate,
        if_resistance:avoid
      },
      {
        stage:'compromisso',
        goal:'Definir responsável, prazo e evidência do próximo avanço.',
        suggested_line:closed,
        question_type:'fechada',
        advance_signal:'Existe ação bilateral com responsável e data.',
        if_resistance:'Reduza o passo sem fabricar compromisso.'
      }
    ],
    closing_options:[{
      when:'Depois de confirmar contexto e critério.',
      suggested_line:closed,
      commitment:gate
    }],
    do_not_say:unique([...list(current.do_not_say),avoid])
  }
}

export function normalizeAdviceForValUi(advice={},conversion={}){
  const result=structuredClone(advice&&typeof advice==='object'?advice:{})
  const selected=conversion?.selectedOpportunity||{}
  const intelligence=result.conversion_intelligence&&typeof result.conversion_intelligence==='object'?result.conversion_intelligence:{}
  const rawPriority=selected.priority||intelligence.priority||result.executive_brief?.priority
  const priority=toValUiPriority(rawPriority)
  const label=priorityLabel(rawPriority)
  const score=Number.isFinite(Number(selected.score))?Number(selected.score):Number.isFinite(Number(intelligence.score))?Number(intelligence.score):null

  result.conversion_intelligence={
    ...intelligence,
    priority,
    priority_label:label
  }

  const brief=result.executive_brief&&typeof result.executive_brief==='object'?result.executive_brief:{}
  let reason=text(brief.reason)
  if(score!==null&&!reason.includes(`${score}/100`))reason=`Score operacional ${score}/100. ${reason}`.trim()
  let headline=text(brief.headline)
  headline=headline
    .replace(/prioridade alta/gi,'prioridade esta semana')
    .replace(/prioridade média/gi,'prioridade acompanhar')
    .replace(/prioridade qualificar/gi,'prioridade acompanhar')
  result.executive_brief={
    ...brief,
    priority,
    headline,
    reason
  }

  result.confidence=normalizeConfidence(result,conversion)
  result.conversation_plan=normalizeConversationPlan(result,conversion)
  return result
}
