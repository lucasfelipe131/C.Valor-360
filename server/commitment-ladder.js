import {rankOpportunityPortfolio} from './sales-playbook.js'

const array=value=>Array.isArray(value)?value:[]
const text=(value,max=320)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>text(value).toLocaleLowerCase('pt-BR')
const closed=value=>/^(?:fechado|ganho|conclu[ií]do|closed|won)$/i.test(text(value))
const lost=value=>/^(?:perdido|cancelado|lost)$/i.test(text(value))
const evidenceId=(item,index)=>text(typeof item==='string'?`evidence:${index}`:item?.id||item?.evidence_id||item?.source_id||`evidence:${index}`,180)
const evidenceText=item=>lower(typeof item==='string'?item:JSON.stringify(item||{}))

const STEP_DEFINITIONS=[
 {id:'context_confirmed',label:'Contexto confirmado',minimumYes:'Confirmar que o problema, o impacto e a janela realmente existem.',question:'Podemos considerar este contexto correto antes de comparar qualquer alternativa?',proof:'Resposta explícita do produtor, com problema, impacto e prazo registrados.'},
 {id:'proof_agreed',label:'Prova combinada',minimumYes:'Concordar sobre qual comparação, métrica ou evidência dará segurança.',question:'Qual forma de comprovação você considera justa para avaliar esta decisão?',proof:'Métrica, fonte, horizonte e responsável pela validação registrados.'},
 {id:'pilot_or_comparison_agreed',label:'Teste ou comparação aceitos',minimumYes:'Aceitar um teste, piloto ou comparação com escopo e critérios definidos.',question:'Faz sentido validar em uma área ou comparação delimitada antes de ampliar a decisão?',proof:'Escopo, consentimento, critério de sucesso e forma de interromper registrados.',consentRequired:true},
 {id:'conditional_proposal_agreed',label:'Proposta condicionada aceita',minimumYes:'Aceitar receber ou avaliar uma proposta ligada aos critérios combinados.',question:'Com essas condições e essa forma de comprovação, podemos estruturar a proposta para decisão?',proof:'Condições, participantes, pendências e data de decisão registrados.'},
 {id:'decision_formalized',label:'Decisão formalizada',minimumYes:'Confirmar fechamento, recusa ou adiamento com motivo e próximo marco.',question:'A decisão pode ser formalizada agora como avanço, recusa ou adiamento com nova data?',proof:'Resultado, responsável, data e evidência de conclusão registrados.'}
]

const explicitPatterns={
 context_confirmed:/context.*confirm|problema.*confirm|impacto.*confirm|decision.*confirmed|diagn[oó]stico.*valid/i,
 proof_agreed:/proof.*agree|prova.*combin|m[eé]trica.*aceit|comparison.*criteria|crit[eé]rio.*prova/i,
 pilot_or_comparison_agreed:/pilot.*accept|teste.*aceit|compara[cç][aã]o.*aceit|trial.*agree|test_accepted/i,
 conditional_proposal_agreed:/proposal.*accept|proposta.*aceit|conditional.*proposal|proposta.*condicion/i,
 decision_formalized:/\bwon\b|\bclosed\b|fechad|decis[aã]o.*formal|pedido.*confirm/i
}

function stageTarget(stage){
 const normalized=lower(stage)
 if(closed(normalized))return 4
 if(/negocia|decis[aã]o|aprova|fechamento/.test(normalized))return 4
 if(/proposta|solu[cç][aã]o|or[cç]amento/.test(normalized))return 3
 if(/diagn[oó]stico|qualifica|descoberta|necessidade/.test(normalized))return 1
 return 0
}

function evidenceFor(opportunity,stepId){
 const matched=[]
 array(opportunity?.evidence).forEach((item,index)=>{
  if(explicitPatterns[stepId].test(evidenceText(item)))matched.push(evidenceId(item,index))
 })
 if(stepId==='decision_formalized'&&closed(opportunity?.stage))matched.push(`stage:${text(opportunity.id||opportunity.external_key||'opportunity')}:closed`)
 return [...new Set(matched)]
}

function ladderFor(opportunity,index){
 const target=stageTarget(opportunity?.stage)
 const explicit=Object.fromEntries(STEP_DEFINITIONS.map(step=>[step.id,evidenceFor(opportunity,step.id)]))
 let nextIndex=STEP_DEFINITIONS.findIndex((step,stepIndex)=>!explicit[step.id].length&&stepIndex>=Math.max(0,target-1))
 if(nextIndex<0)nextIndex=STEP_DEFINITIONS.length-1
 const steps=STEP_DEFINITIONS.map((definition,stepIndex)=>{
  const evidenceIds=explicit[definition.id]
  let status='later'
  if(evidenceIds.length)status='confirmed'
  else if(stepIndex===nextIndex)status='next'
  else if(stepIndex<nextIndex)status='indicated'
  return {
   ...definition,
   order:stepIndex+1,
   status,
   evidenceIds,
   requiresConfirmation:status==='indicated',
   stageBasis:status==='indicated'?`A etapa “${text(opportunity?.stage,'não informada')}” sugere avanço, mas não comprova aceite.`:'',
   guardrail:definition.consentRequired?'O teste só pode avançar com consentimento explícito, escopo reversível e validação técnica quando aplicável.':'Não trate interesse, silêncio ou recebimento de proposta como aceite.'
  }
 })
 const next=steps[nextIndex]
 return {
  id:`ladder:${text(opportunity?.id||opportunity?.external_key||index,180)}`,
  opportunityId:String(opportunity?.id||opportunity?.external_key||''),
  title:text(opportunity?.title||opportunity?.category||'Oportunidade sem título',180),
  stage:text(opportunity?.stage||'Etapa não informada',80),
  amount:Number.isFinite(Number(opportunity?.estimated_value??opportunity?.value))?Number(opportunity?.estimated_value??opportunity?.value):null,
  steps,
  currentConfirmedCount:steps.filter(step=>step.status==='confirmed').length,
  nextMinimumCommitment:{stepId:next.id,label:next.label,action:next.minimumYes,question:next.question,evidenceNeeded:next.proof,consentRequired:Boolean(next.consentRequired)},
  audit:{administrativeStageUsed:true,stageDoesNotEqualConsent:true,lost:lost(opportunity?.stage)}
 }
}

export function buildCommitmentLadders(context={},options={}){
 const now=options.now??Date.now()
 const opportunities=rankOpportunityPortfolio(array(context.opportunities).filter(item=>item&&!lost(item.stage)),now).slice(0,6)
 const ladders=opportunities.map(ladderFor)
 return {
  version:'val-commitment-ladder-v1',
  generatedAt:new Date(now).toISOString(),
  selectedId:ladders[0]?.id||'',
  ladders,
  guardrails:[
   'O próximo sim deve ser pequeno, reversível e proporcional ao estágio real.',
   'Etapa administrativa, simpatia, silêncio ou pedido de proposta não comprovam compromisso.',
   'Teste técnico exige consentimento explícito e revisão habilitada quando envolver produto, dose, mistura ou aplicação.',
   'Nenhum passo pode usar medo, culpa, vergonha, urgência ou escassez falsas.'
  ],
  emptyReason:ladders.length?'':'Não há oportunidade registrada para construir uma escada de compromissos.'
 }
}
