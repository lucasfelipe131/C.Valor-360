export const decisionInterviewVersion='val.decision_interview.v1'
export const reasoningConfidenceVersion='val.reasoning_confidence.v1'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=1200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalized=value=>clean(value,20_000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const clamp=value=>Number(Math.max(0,Math.min(1,Number(value)||0)).toFixed(2))

function strings(value,depth=0){
 if(depth>5||value===null||value===undefined)return []
 if(typeof value==='string'||typeof value==='number')return [String(value)]
 if(Array.isArray(value))return value.flatMap(item=>strings(item,depth+1))
 if(typeof value==='object')return Object.values(value).flatMap(item=>strings(item,depth+1))
 return []
}

function conversationTurns(context={}){
 return list(context.priorRecommendations).slice(0,8).map(item=>({
  source:'USER_TURN',
  text:clean(item?.user_question||item?.userQuestion||item?.question,1200),
  created_at:item?.created_at||item?.createdAt||null
 })).filter(item=>item.text)
}

function confirmedMemories(context={}){
 return list(context.memories).filter(item=>{
  const status=String(item?.status||'').toUpperCase()
  const state=String(item?.memory_state||item?.memoryState||item?.epistemic_state||'').toUpperCase()
  return status==='VERIFIED'&&['FACT','VERIFIED','CONFIRMED'].includes(state)
 })
}

function activeItems(value=[]){
 return list(value).filter(item=>!/^(?:CLOSED|WON|LOST|CANCELLED|COMPLETED|FECHADO|GANHO|PERDIDO|CANCELADO|CONCLU[IÍ]DO)$/i.test(String(item?.status||item?.stage||''))).slice(0,5)
}

function evidenceCorpus(context={},message='',intent=''){
 const common={client:context.client||{},profile:context.profile||{},memories:confirmedMemories(context)}
 const scoped=intent==='PREPARE_VISIT'
  ?{opportunities:activeItems(context.opportunities),commitments:activeItems(context.commitments)}
  :intent==='ANALYZE_SOIL'
   ?{properties:list(context.properties).slice(0,8),soilAnalyses:list(context.soilAnalyses).slice(0,3),currentAttachments:list(context.currentAttachments).slice(0,3)}
   :intent==='ASK_AGRONOMIC'
    ?{properties:list(context.properties).slice(0,8),soilAnalyses:list(context.soilAnalyses).slice(0,3),fieldReports:list(context.fieldReports).slice(0,3),currentAttachments:list(context.currentAttachments).slice(0,3)}
    :['CALCULATE','CHECK_OPPORTUNITY','OBJECTION_HELP'].includes(intent)
     ?{opportunities:activeItems(context.opportunities)}
     :{}
 return normalized([message,...strings(common),...strings(scoped),...conversationTurns(context).map(item=>item.text)].join(' '))
}

const questionLibrary={
 PREPARE_VISIT:[
  {field:'decision_target',known:/\b(?:decisao|objetivo)\s+(?:e|é|ser[aá])\b|\b(?:precisamos?|quero|devo|vamos)\s+(?:fechar|avancar|avançar|confirmar)\b|\bfechar\s+(?:a\s+)?(?:proposta|oportunidade|compromisso)\b/,question:'Qual decisão precisa ficar fechada ao final dessa conversa?',why:'Isso define o objetivo da visita e evita uma conversa ampla sem compromisso.'},
  {field:'decision_participants',known:/\b(?:pai|mae|filho|filha|esposa|marido|socio|socia|gerente|agronomo|responsavel|participa|decide)\b/,question:'Quem participa ou influencia essa decisão junto com o produtor?',why:'A pessoa envolvida muda a abordagem, a evidência e o próximo compromisso.'},
  {field:'timing',known:/\b(?:hoje|amanha|semana|dia|data|prazo|janela|safra|aplicacao|plantio|colheita)\b/,question:'Qual é a janela real para essa decisão acontecer?',why:'Timing comercial e janela operacional podem mudar a prioridade da conversa.'}
 ],
 ANALYZE_SOIL:[
  {field:'soil_link',known:/\b(?:talhao|fazenda|propriedade|area|hectare|ha\b)\b/,question:'De qual propriedade, área ou talhão é esta análise?',why:'O vínculo define quais histórico, cultura e manejo podem ser cruzados com segurança.'},
  {field:'target_crop',known:/\b(?:soja|milho|trigo|algodao|cafe|arroz|feijao|sorgo|canola|pastagem)\b/,question:'Qual cultura e safra estão planejadas para essa área?',why:'A relevância de cada indicador depende da cultura e do momento produtivo.'},
  {field:'yield_target',known:/\b(?:meta|produtividade|sacas|sc\/ha|kg\/ha|toneladas)\b/,question:'Existe uma meta de produtividade confirmada para esse talhão?',why:'A meta muda a leitura econômica e o nível de exigência da interpretação.'}
 ],
 ASK_AGRONOMIC:[
  {field:'agronomic_scope',known:/\b(?:talhao|fazenda|propriedade|area|lavoura)\b/,question:'Em qual área ou talhão esse sinal foi observado?',why:'Sem localização, não consigo cruzar histórico, clima e outras evidências do campo.'},
  {field:'crop_stage',known:/\b(?:v\d+|r\d+|estadio|fase|emergencia|vegetativo|reprodutivo|florescimento|enchimento)\b/,question:'Qual é a cultura e o estádio atual da lavoura?',why:'O estádio muda risco, urgência e quais hipóteses são plausíveis.'},
  {field:'observed_pattern',known:/\b(?:reboleira|borda|uniforme|foco|incidencia|severidade|sintoma|observado)\b/,question:'O problema aparece em reboleiras, bordas ou de forma uniforme?',why:'O padrão espacial ajuda a separar hipóteses antes de qualquer orientação técnica.'}
 ],
 CALCULATE:[
  {field:'calculation_basis',known:/\b\d+(?:[.,]\d+)?\b/,question:'Quais valores e unidades confirmados devo usar no cálculo?',why:'Sem base e unidade, um resultado numérico pode parecer preciso e estar errado.'},
  {field:'calculation_objective',known:/\b(?:margem|retorno|roi|dose|volume|populacao|custo|preco|conversao)\b/,question:'Qual decisão esse cálculo precisa apoiar?',why:'O objetivo determina a fórmula, o resultado útil e o que precisa ser comparado.'}
 ],
 CHECK_OPPORTUNITY:[
  {field:'opportunity_decision',known:/\b(?:avancar|fechar|proposta|negociacao|preco|volume|prazo|oportunidade)\b/,question:'Qual decisão comercial está aberta nessa oportunidade agora?',why:'Isso separa uma oportunidade ativa de um registro sem próximo movimento.'},
  {field:'acceptance_criterion',known:/\b(?:criterio|prova|compara|fonte|teste|validar|aceita)\b/,question:'Qual critério o produtor vai usar para aceitar ou rejeitar a proposta?',why:'O critério de decisão muda a evidência e a abordagem necessárias.'}
 ],
 OBJECTION_HELP:[
  {field:'objection_words',known:/\b(?:disse|falou|respondeu|alegou|preco|caro|risco|confia|prazo)\b/,question:'Quais foram as palavras exatas do produtor ao apresentar a objeção?',why:'A frase real ajuda a distinguir preço, risco, confiança, timing ou falta de valor percebido.'}
 ]
}

function fallbackCandidates(result={}){
 return list(result.golden_questions).slice(0,3).map((item,index)=>({
  field:`material_unknown_${index+1}`,
  known:null,
  question:clean(item?.question,700),
  why:clean(item?.reason||item?.decision_impact||'A resposta pode mudar materialmente a próxima decisão.',700)
 })).filter(item=>item.question)
}

export function buildReasoningConfidence({context={},result={}}={}){
 const facts=list(result.facts_used).length
 const distinctSources=new Set(list(result.facts_used).map(item=>item?.source_type).filter(Boolean)).size
 const overall=Number(result.confidence?.score)||0
 const hasAgronomy=list(context.soilAnalyses).length+list(context.fieldReports).length+list(context.ndviObservations).length+list(context.manualRecords).length
 const knowledge=list(result.knowledge_refs).length
 const questionCount=list(result.golden_questions).length
 return {
  version:reasoningConfidenceVersion,
  context:clamp(.2+facts*.11+distinctSources*.1),
  thesis:clamp(overall||.25),
  question:clamp(questionCount?.58+Math.min(.3,facts*.06):.25),
  agronomy:result.agronomic_context?.status==='not_applicable'?null:clamp(.25+Math.min(.65,hasAgronomy*.14)),
  knowledge:clamp(knowledge?.55+Math.min(.35,knowledge*.1):.25),
  threshold:{ask_below:.72,answer_at_or_above:.72}
 }
}

export function buildDecisionInterview({intent='ASK_CLIENT',message='',context={},result={}}={}){
 const corpus=evidenceCorpus(context,message,intent)
 const confidence=buildReasoningConfidence({context,result})
 const base=questionLibrary[intent]||[]
 const candidates=(base.length?base:fallbackCandidates(result)).filter(item=>{
  if(!item.question)return false
  if(item.known?.test(corpus))return false
  const normalizedQuestion=normalized(item.question)
  return !conversationTurns(context).some(turn=>{
   const prior=normalized(turn.text)
   const tokens=normalizedQuestion.split(' ').filter(token=>token.length>5)
   return tokens.length>=2&&tokens.filter(token=>prior.includes(token)).length>=Math.min(3,tokens.length)
  })
 })
 const lowConfidence=Math.min(confidence.context,confidence.thesis,confidence.question)<confidence.threshold.ask_below
 const missing=list(result.missing_information).filter(Boolean)
 const questions=(lowConfidence||missing.length||base.length?candidates:[]).slice(0,3).map(item=>({
  field:item.field,
  classification:'MATERIAL',
  question:clean(item.question,700),
  why:clean(item.why,700),
  already_known:false
 }))
 return {
  version:decisionInterviewVersion,
  status:questions.length?'NEEDS_INPUT':'NOT_NEEDED',
  questions,
  material_missing_information:questions.map(item=>item.field),
  non_material_missing_information:missing.slice(questions.length,8),
  session_context:{
   conversation_id:clean(result.conversation_id||context.conversationSession?.id||'stateless',180),
   persistence_mode:'NONE',
   turns:conversationTurns(context),
   confirmed_memory_unchanged:true
  },
  explanation:questions.length
   ?`Faltam ${questions.length} informaç${questions.length===1?'ão':'ões'} materiais que podem mudar a tese. A resposta será usada apenas nesta conversa até uma confirmação de registro.`
   :'O contexto atual é suficiente para responder sem transformar a conversa em questionário.',
  recompute_after_reply:true,
  register_offer:{available:true,automatic:false,confirmation_required:true}
 }
}
