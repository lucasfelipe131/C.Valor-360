export const conversationalNaturalnessVersion='val.conversational_naturalness.v1'

export const conversationalNaturalnessDimensions=Object.freeze([
  'continuity',
  'context_retention',
  'clarity',
  'tone',
  'brevity',
  'follow_up_quality',
  'non_robotic_language',
  'interruption_handling',
  'question_quality'
])

export const conversationalNaturalnessLabels=Object.freeze([
  'ROBOTIC',
  'MOSTLY_ROBOTIC',
  'ACCEPTABLE',
  'NATURAL',
  'VERY_NATURAL'
])

const list=value=>Array.isArray(value)?value:[]
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)?value:{}
const text=(value,max=12_000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const boolean=value=>value===true||value==='true'
const clampScore=value=>Math.max(0,Math.min(4,Math.round(Number(value)||0)))

const stopwords=new Set([
  'a','as','ao','aos','com','da','das','de','do','dos','e','ela','ele','em','essa','esse','esta','este','eu','foi','isso',
  'la','mais','mas','me','na','nas','no','nos','o','os','ou','para','por','pra','que','se','sem','sua','seu','um','uma','voce'
])

const tokens=value=>normalize(value)
  .replace(/[^a-z0-9\s]/g,' ')
  .split(/\s+/)
  .filter(token=>token.length>=4&&!stopwords.has(token))

const unique=values=>[...new Set(values.filter(Boolean))]
const overlap=(left,right)=>{
  const a=new Set(tokens(left));const b=new Set(tokens(right))
  if(!a.size||!b.size)return 0
  return [...a].filter(token=>b.has(token)).length/Math.min(a.size,b.size)
}

const roboticPatterns=[
  /\bcomo (?:um|uma) (?:modelo|assistente) de linguagem\b/i,
  /\bde acordo com (?:a|sua) solicita[cç][aã]o\b/i,
  /\bsegue(?:m)? abaixo\b/i,
  /\bcertamente[!,.:]/i,
  /\bposso ajud[aá]-lo com mais alguma coisa\b/i,
  /\bn[aã]o possuo (?:a capacidade|informa[cç][oõ]es)\b/i,
  /\bconforme solicitado\b/i
]

const genericQuestion=/\b(?:pode explicar melhor|qual (?:e|é) a sua necessidade|como posso ajudar|o que voc[eê] acha|deseja mais alguma coisa)\b/i
const naturalBridge=/\b(?:certo|entendi|ent[aã]o|nesse caso|combinado|faz sentido|vamos|pelo que voc[eê] contou|com base nisso|antes de|s[oó] preciso confirmar)\b/i
const hostileTone=/\b(?:isso (?:e|é) [oó]bvio|voc[eê] est[aá] errado|simplesmente fa[cç]a|n[aã]o complique|problema seu)\b/i
const unsupportedCertainty=/\b(?:sem d[uú]vida|com certeza absoluta|garantido|n[aã]o h[aá] risco)\b/i
const openQuestion=/^(?:qual|quais|como|o que|quem|onde|quanto|quando|por que)\b/i

function readInput(value={}){
  const input=object(value)
  const interaction=object(input.interaction)
  const context=object(input.context)
  const safety=object(input.safety)
  const persistence=object(input.persistence)
  const response=text(input.assistant_response??input.response??input.output)
  const message=text(input.user_message??input.message??input.input)
  const priorTurns=list(input.prior_turns??input.turns)
    .map(turn=>({role:text(turn?.role,40),content:text(turn?.content??turn?.text,2000)}))
    .filter(turn=>turn.content)
  const activeContext=object(input.active_context??context.active_context)
  const contextRefs=unique(list(input.context_refs??context.references).map(item=>text(item?.label??item?.name??item?.value??item,280)))
  return {input,interaction,context,safety,persistence,response,message,priorTurns,activeContext,contextRefs}
}

function contextAnchors({activeContext,contextRefs}){
  const values=[...contextRefs]
  for(const [key,value] of Object.entries(activeContext)){
    if(value===null||value===undefined||value==='')continue
    if(typeof value==='object'){
      for(const nested of Object.values(value))if(typeof nested==='string'||typeof nested==='number')values.push(text(nested,280))
      continue
    }
    if(!/^(?:tenant|organization|owner|version|created|updated)/i.test(key))values.push(text(value,280))
  }
  return unique(values.filter(value=>normalize(value).length>=3))
}

function questionsIn(response){
  return response.split(/(?<=[?])\s+/).map(part=>text(part)).filter(part=>part.includes('?'))
}

function continuityScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  if(!data.message&&!data.priorTurns.length)return {score:1,reason:'sem turno de entrada ou histórico para verificar continuidade'}
  if(!data.priorTurns.length){
    const currentOverlap=overlap(data.message,data.response)
    return currentOverlap>=.25
      ?{score:3,reason:'resposta conectada ao turno atual'}
      :{score:2,reason:'primeiro turno presente, mas conexão textual limitada'}
  }
  const recent=data.priorTurns.slice(-4).map(turn=>turn.content).join(' ')
  const recentOverlap=overlap(recent,data.response)
  const currentOverlap=overlap(data.message,data.response)
  if(recentOverlap>=.25&&naturalBridge.test(data.response))return {score:4,reason:'retoma o histórico com transição conversacional'}
  if(recentOverlap>=.16||currentOverlap>=.28)return {score:3,reason:'mantém conexão material com a conversa'}
  if(currentOverlap>=.12)return {score:2,reason:'responde ao turno atual sem retomar claramente o histórico'}
  return {score:1,reason:'histórico disponível sem sinal observável de continuidade'}
}

function contextRetentionScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  if(boolean(data.context.contradiction)||boolean(data.context.context_contradiction))return {score:0,reason:'contradição de contexto declarada'}
  const anchors=contextAnchors(data)
  if(!anchors.length)return {score:2,reason:'sem contexto ativo suficiente para confirmar retenção'}
  const response=normalize(data.response)
  const matched=anchors.filter(anchor=>{
    const normalized=normalize(anchor)
    if(normalized.length<=3)return false
    return response.includes(normalized)||tokens(anchor).some(token=>token.length>=5&&response.includes(token))
  })
  if(matched.length>=Math.min(2,anchors.length))return {score:4,reason:'retém múltiplas âncoras do contexto ativo',matched:matched.slice(0,5)}
  if(matched.length===1)return {score:3,reason:'retém uma âncora do contexto ativo',matched}
  if(data.contextRefs.length&&boolean(data.context.references_resolved))return {score:3,reason:'referências de contexto foram explicitamente resolvidas'}
  return {score:1,reason:'contexto ativo disponível, mas não observável na resposta'}
}

function clarityScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  const sentences=data.response.split(/[.!?]+/).map(text).filter(Boolean)
  const average=sentences.length?data.response.length/sentences.length:data.response.length
  const excessiveStructure=(data.response.match(/(?:^|\s)[-*#]\s/g)||[]).length>=6
  if(data.response.length<=1200&&average<=210&&!excessiveStructure)return {score:4,reason:'frases legíveis e estrutura direta'}
  if(data.response.length<=2200&&average<=300)return {score:3,reason:'compreensível, com alguma densidade'}
  if(data.response.length<=4000)return {score:2,reason:'resposta densa ou excessivamente estruturada'}
  return {score:1,reason:'resposta longa o bastante para prejudicar clareza conversacional'}
}

function toneScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  if(hostileTone.test(data.response))return {score:0,reason:'tom hostil ou desqualificador'}
  if(unsupportedCertainty.test(data.response))return {score:1,reason:'certeza excessiva reduz o tom consultivo'}
  if(naturalBridge.test(data.response))return {score:4,reason:'tom direto, colaborativo e humano'}
  if(/\b(?:posso|vamos|vale|recomendo|sugiro|confirma)\b/i.test(data.response))return {score:3,reason:'tom consultivo'}
  return {score:2,reason:'tom neutro, sem sinais fortes de colaboração'}
}

function brevityScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  const voice=/voice|audio|voz/i.test(text(data.interaction.response_mode??data.input.response_mode,80))
  const excellent=voice?420:900
  const acceptable=voice?750:1600
  const long=voice?1200:2800
  if(data.response.length<=excellent)return {score:4,reason:voice?'extensão adequada para voz':'extensão conversacional enxuta'}
  if(data.response.length<=acceptable)return {score:3,reason:'extensão ainda adequada ao canal'}
  if(data.response.length<=long)return {score:2,reason:'mais longa que o necessário para conversa'}
  return {score:1,reason:'resposta excessivamente longa para o canal'}
}

function followUpScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  const questions=questionsIn(data.response)
  const needed=data.interaction.follow_up_needed??data.context.follow_up_needed
  if(needed===false)return questions.length
    ?{score:2,reason:'faz pergunta mesmo com follow-up marcado como desnecessário'}
    :{score:4,reason:'encerra o turno sem pergunta desnecessária'}
  if(needed===true&&!questions.length)return {score:0,reason:'faltou follow-up necessário'}
  if(questions.length>2)return {score:1,reason:'empilha perguntas no mesmo turno'}
  if(questions.length===1&&!genericQuestion.test(questions[0]))return {score:4,reason:'follow-up único e direcionado'}
  if(questions.length===1)return {score:2,reason:'follow-up genérico'}
  return {score:3,reason:'nenhum follow-up era explicitamente exigido'}
}

function nonRoboticScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  const matches=roboticPatterns.filter(pattern=>pattern.test(data.response))
  const repeatedOpening=/^(?:entendi|certo|certamente)[!.]\s*(?:entendi|certo|certamente)[!.]/i.test(data.response)
  if(matches.length>=2||repeatedOpening)return {score:0,reason:'múltiplos marcadores de linguagem mecânica'}
  if(matches.length===1)return {score:1,reason:'marcador explícito de linguagem mecânica'}
  if(naturalBridge.test(data.response))return {score:4,reason:'linguagem fluida e situada no diálogo'}
  return {score:3,reason:'sem marcadores robóticos conhecidos'}
}

function interruptionScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  const interrupted=data.interaction.interrupted??data.input.interrupted
  if(interrupted!==true)return {score:3,reason:'interrupção não ocorreu neste turno'}
  const handled=data.interaction.interruption_handled??data.input.interruption_handled
  if(handled!==true)return {score:0,reason:'interrupção ocorreu e não foi tratada'}
  if(/\b(?:claro|certo|vamos por a[ií]|retomando|parei|te ouvi)\b/i.test(data.response))return {score:4,reason:'interrupção acolhida e retomada explicitamente'}
  return {score:3,reason:'interrupção tratada sem retomada explícita no texto'}
}

function questionQualityScore(data){
  if(!data.response)return {score:0,reason:'assistant_response ausente'}
  const questions=questionsIn(data.response)
  const needed=data.interaction.follow_up_needed??data.context.follow_up_needed
  if(!questions.length)return needed===true
    ?{score:0,reason:'pergunta material ausente'}
    :{score:3,reason:'pergunta não era necessária neste turno'}
  if(questions.length>2)return {score:1,reason:'perguntas demais para um único turno'}
  const question=questions[0].replace(/^.*?(?=(?:qual|quais|como|o que|quem|onde|quanto|quando|por que|confirma|você|voce)\b)/i,'')
  if(genericQuestion.test(question))return {score:1,reason:'pergunta genérica'}
  const specific=tokens(question).length>=4
  const open=openQuestion.test(normalize(question))
  if(specific&&open)return {score:4,reason:'pergunta aberta, específica e acionável'}
  if(specific)return {score:3,reason:'pergunta específica'}
  return {score:2,reason:'pergunta curta com impacto pouco observável'}
}

function hardFailures(data){
  const failures=[]
  const add=(code,reason)=>failures.push({code,reason})
  if(boolean(data.safety.violation)||boolean(data.safety.unsafe_action)||data.safety.boundary_respected===false){
    add('SAFETY_BOUNDARY_VIOLATION','A resposta violou ou contornou uma barreira de segurança.')
  }
  const expectedTenant=text(data.context.expected_tenant_id??data.context.tenant_id,180)
  const usedTenant=text(data.context.used_tenant_id??data.context.response_tenant_id,180)
  if(boolean(data.context.cross_tenant)||Boolean(expectedTenant&&usedTenant&&expectedTenant!==usedTenant)){
    add('CROSS_TENANT_CONTEXT','A resposta usou contexto de outro tenant.')
  }
  const ambiguity=boolean(data.context.ambiguity_detected)||normalize(data.context.reference_status)==='ambiguous'
  const clarification=data.context.clarification_asked??data.interaction.clarification_asked
  if(boolean(data.context.silent_guess)||(ambiguity&&clarification!==true)){
    add('SILENT_CONTEXT_GUESS','Uma referência ambígua foi assumida sem confirmação.')
  }
  if(boolean(data.context.reused_stale_context)||boolean(data.context.context_contradiction)||boolean(data.context.contradiction)){
    add('INVALID_CONTEXT_REUSE','Contexto contraditório ou obsoleto foi reutilizado.')
  }
  const persisted=data.persistence.performed??data.context.persistence_performed
  const confirmed=data.persistence.confirmed??data.context.persistence_confirmed
  if(persisted===true&&confirmed!==true){
    add('UNCONFIRMED_PERSISTENCE','Informação da sessão foi persistida sem confirmação explícita.')
  }
  return failures
}

function labelFor(score){
  if(score>=3.5)return 'VERY_NATURAL'
  if(score>=3)return 'NATURAL'
  if(score>=2)return 'ACCEPTABLE'
  if(score>=1)return 'MOSTLY_ROBOTIC'
  return 'ROBOTIC'
}

/**
 * Avalia a naturalidade de um turno sem executar I/O e sem confiar em texto para
 * declarar segurança. Sinais de segurança, tenant, ambiguidade e persistência
 * devem ser fornecidos pelo orquestrador que observou esses eventos.
 */
export function evaluateConversationalNaturalness(value={}){
  const data=readInput(value)
  const evaluators={
    continuity:continuityScore,
    context_retention:contextRetentionScore,
    clarity:clarityScore,
    tone:toneScore,
    brevity:brevityScore,
    follow_up_quality:followUpScore,
    non_robotic_language:nonRoboticScore,
    interruption_handling:interruptionScore,
    question_quality:questionQualityScore
  }
  const dimensions=Object.fromEntries(conversationalNaturalnessDimensions.map(name=>{
    const result=evaluators[name](data)
    return [name,{score:clampScore(result.score),reason:text(result.reason,400),...(result.matched?{matched:result.matched}:{})}]
  }))
  const rawScore=Number((Object.values(dimensions).reduce((sum,item)=>sum+item.score,0)/conversationalNaturalnessDimensions.length).toFixed(2))
  const failures=hardFailures(data)
  const score=failures.length?0:rawScore
  const missing=[]
  if(!data.message)missing.push('user_message')
  if(!data.response)missing.push('assistant_response')
  return {
    contract_version:conversationalNaturalnessVersion,
    status:failures.length?'HARD_FAILURE':score>=3?'PASSED':'REVIEW_REQUIRED',
    passed:failures.length===0&&score>=3,
    threshold:3,
    score,
    raw_score:rawScore,
    label:failures.length?'ROBOTIC':labelFor(score),
    dimensions,
    hard_failures:failures,
    missing_fields:missing,
    evaluable:Boolean(data.message&&data.response)
  }
}
