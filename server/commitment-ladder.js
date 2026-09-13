import {rankOpportunityPortfolio} from './sales-playbook.js'
import {workspaceDetails} from './opportunity-workspace.js'

const array=value=>Array.isArray(value)?value:[]
const text=(value,max=320)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>text(value).toLocaleLowerCase('pt-BR')
const closed=value=>/^(?:fechado|ganho|conclu[ií]do|closed|won)$/i.test(text(value))
const lost=value=>/^(?:perdido|cancelado|lost)$/i.test(text(value))
const evidenceId=(item,index)=>text(typeof item==='string'?`evidence:${index}`:item?.id||item?.evidence_id||item?.source_id||`evidence:${index}`,180)
// O aceite era inferido por regex sobre lower(JSON.stringify(item)) do registro INTEIRO — nomes de
// campo, metadados do quadro e o texto livre do consultor no mesmo caldo. Bastava a nota "Produtor
// recusou. Proposta nao aceita." para casar /proposta.*aceit/ e o degrau "Proposta condicionada
// aceita" aparecia como Confirmado, com "1 evidencia registrada", em cima de uma RECUSA.
// A propria guarda da escada ja dizia a regra: "Nao trate interesse, silencio ou recebimento de
// proposta como aceite." Texto livre e hipotese; hipotese nao confirma degrau. So confirma o
// marcador TIPADO — o registro estruturado que diz, sem ambiguidade, qual degrau foi aceito.
// O que era casado por texto continua visivel na escada como 'indicated', com a frase que explica
// que a etapa sugere avanco mas nao comprova aceite.
const STEP_IDS=new Set(['context_confirmed','proof_agreed','pilot_or_comparison_agreed','conditional_proposal_agreed','decision_formalized'])
const typedStep=item=>{
 const value=typeof item==='string'?item:text(item?.type??item?.step_id??item?.stepId??item?.kind)
 const normalized=text(value).toLowerCase()
 return STEP_IDS.has(normalized)?normalized:''
}

const STEP_DEFINITIONS=[
 {id:'context_confirmed',label:'Contexto confirmado',minimumYes:'Confirmar que o problema, o impacto e a janela realmente existem.',question:'Podemos considerar este contexto correto antes de comparar qualquer alternativa?',proof:'Resposta explícita do produtor, com problema, impacto e prazo registrados.'},
 {id:'proof_agreed',label:'Prova combinada',minimumYes:'Concordar sobre qual comparação, métrica ou evidência dará segurança.',question:'Qual forma de comprovação você considera justa para avaliar esta decisão?',proof:'Métrica, fonte, horizonte e responsável pela validação registrados.'},
 {id:'pilot_or_comparison_agreed',label:'Teste ou comparação aceitos',minimumYes:'Aceitar um teste, piloto ou comparação com escopo e critérios definidos.',question:'Faz sentido validar em uma área ou comparação delimitada antes de ampliar a decisão?',proof:'Escopo, consentimento, critério de sucesso e forma de interromper registrados.',consentRequired:true},
 {id:'conditional_proposal_agreed',label:'Proposta condicionada aceita',minimumYes:'Aceitar receber ou avaliar uma proposta ligada aos critérios combinados.',question:'Com essas condições e essa forma de comprovação, podemos estruturar a proposta para decisão?',proof:'Condições, participantes, pendências e data de decisão registrados.'},
 {id:'decision_formalized',label:'Decisão formalizada',minimumYes:'Confirmar fechamento, recusa ou adiamento com motivo e próximo marco.',question:'A decisão pode ser formalizada agora como avanço, recusa ou adiamento com nova data?',proof:'Resultado, responsável, data e evidência de conclusão registrados.'}
]

const MAX_LADDERS=6

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
  if(typedStep(item)===stepId)matched.push(evidenceId(item,index))
 })
 // Fechar como GANHO formaliza a decisao. Fechar como PERDIDO tambem e uma decisao formalizada,
 // mas nao pode contar como avanco: quem decide isso e o resultado gravado, nao o texto da etapa.
 if(stepId==='decision_formalized'&&closed(opportunity?.stage)&&!lostOpportunity(opportunity))matched.push(`stage:${text(opportunity.id||opportunity.external_key||'opportunity')}:closed`)
 return [...new Set(matched)]
}
// O quadro grava perda como etapa 'Fechado' + status 'lost' no proprio registro de evidencia — a
// lista de etapas nem tem "Perdido". Olhar so o texto da etapa deixava um negocio perdido de
// R$ 180.000 na escada como oportunidade viva, com um proximo compromisso a cobrar.
const lostOpportunity=item=>{
 if(lost(item?.stage))return true
 const status=lower(workspaceDetails(item?.evidence)?.status||item?.status||item?.outcome)
 return status==='lost'||status==='archived'
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
   // text(value,max): o segundo parametro e o comprimento maximo, nao um texto de reserva.
   // slice(0,'não informada') vira slice(0,NaN) e devolvia string vazia — a frase chegava a tela
   // como 'A etapa "" sugere avanço', sem nunca dizer de onde veio o degrau.
   stageBasis:status==='indicated'?`A etapa “${text(opportunity?.stage)||'não informada'}” sugere avanço, mas não comprova aceite.`:'',
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
  audit:{administrativeStageUsed:true,stageDoesNotEqualConsent:true,lost:lostOpportunity(opportunity)}
 }
}

export function buildCommitmentLadders(context={},options={}){
 const now=options.now??Date.now()
 const live=array(context.opportunities).filter(item=>item&&!lostOpportunity(item))
 const ranked=rankOpportunityPortfolio(live,now)
 const opportunities=ranked.slice(0,MAX_LADDERS)
 const ladders=opportunities.map(ladderFor)
 return {
  version:'val-commitment-ladder-v1',
  generatedAt:new Date(now).toISOString(),
  selectedId:ladders[0]?.id||'',
  ladders,
  // O corte em 6 existe, mas nao pode ser silencioso: com 8 oportunidades o consultor via 6 e nada
  // dizia que duas tinham ficado de fora.
  totalOpportunities:ranked.length,
  shownCount:ladders.length,
  hiddenCount:Math.max(0,ranked.length-ladders.length),
  closedExcludedCount:array(context.opportunities).filter(item=>item&&lostOpportunity(item)).length,
  guardrails:[
   'O próximo sim deve ser pequeno, reversível e proporcional ao estágio real.',
   'Etapa administrativa, simpatia, silêncio ou pedido de proposta não comprovam compromisso.',
   'Teste técnico exige consentimento explícito e revisão habilitada quando envolver produto, dose, mistura ou aplicação.',
   'Nenhum passo pode usar medo, culpa, vergonha, urgência ou escassez falsas.'
  ],
  emptyReason:ladders.length?'':'Não há oportunidade registrada para construir uma escada de compromissos.'
 }
}
