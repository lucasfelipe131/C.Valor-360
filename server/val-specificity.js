import {createHash} from 'node:crypto'

const VERSION='val-specificity-v1'
const GENERIC_TEXT=/\b(?:converse com (?:o )?(?:cliente|produtor)|entenda (?:melhor )?(?:as )?necessidades|apresente os benef[ií]cios|fa[cç]a contato|acompanhe de perto|mostre o valor agregado|explore oportunidades|fortale[cç]a (?:o )?relacionamento|gere valor|identifique necessidades)\b/i
const UNSAFE_PROMISE=/\b(?:garante|garantido|controle total|elimina(?:r)? completamente|zera(?:r)? o risco|sem falha|resultado certo|vai render|vai produzir)\b/i
const APPLICATION_RATE=/\b\d+(?:[.,]\d+)?\s*(?:ml|l|g|kg|t)\s*\/\s*(?:ha|hectares?|alqueires?)\b/i
const ACTIONABLE_AGRONOMY=/\b(?:(?:aplique|use|utilize|misture|prescreva|deve aplicar)\b.{0,90}\b(?:produto|dose|mistura|defensivo|fungicida|herbicida|inseticida)|dose de\s*\d|receita agron[oô]mica)\b/i
const STOP_WORDS=new Set(['a','ao','aos','as','com','como','da','das','de','do','dos','e','em','esta','este','essa','esse','foi','há','isso','na','nas','no','nos','o','os','ou','para','por','que','se','sem','ser','sua','suas','um','uma','uns','umas','val','valor','produtor','cliente','conta','oportunidade'])
const SOURCE_LABELS={
  client_record:'cadastro produtivo',producer_questionnaire:'questionário do produtor',business_history:'histórico comercial',visit:'visita',interaction:'interação',opportunity:'oportunidade',field_report:'relatório de campo',soil_analysis:'análise de solo',ndvi:'NDVI',manual_record:'registro técnico',producer_statement:'relato do produtor',approved_playbook:'protocolo aprovado',official_product_catalog:'catálogo oficial',consultant_attachment:'anexo do consultor',missing:'lacuna registrada',unknown:'fonte não classificada'
}
const array=value=>Array.isArray(value)?value:[]
const clean=(value,max=900)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,20_000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/®/g,'').replace(/[^a-z0-9]+/g,' ').trim()
const clone=value=>structuredClone(value&&typeof value==='object'?value:{})
const unique=items=>[...new Set(items.filter(Boolean))]
const numberTokens=value=>[...String(value??'').matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map(match=>match[0].replace('.','').replace(',','.'))
const hash=value=>createHash('sha256').update(String(value??'')).digest('hex').slice(0,20)
const sourceLabel=value=>SOURCE_LABELS[value]||SOURCE_LABELS.unknown
const selectedOpportunity=advice=>advice?.conversion_intelligence?.selected_opportunity||{
  id:advice?.opportunity_review?.selected_id||'',
  title:advice?.opportunity_review?.selected_title||'',
  stage:advice?.opportunity_review?.selected_stage||'',
  amount:advice?.opportunity_review?.selected_value_known===false?null:advice?.opportunity_review?.selected_value??null
}
const safetyBlocked=advice=>advice?.human_review?.required===true&&advice?.human_review?.required_role==='technical_reviewer'||array(advice?.blocked_actions).some(item=>/dose|mistura|aplica[cç][aã]o|diagn[oó]stico|prescri/i.test(String(item)))

function sourceCount(context={}){
  return ['businessHistory','visits','interactions','opportunities','properties','fieldReports','soilAnalyses','ndviObservations','manualRecords','signals','memories','priorRecommendations']
    .reduce((sum,key)=>sum+(array(context[key]).length?1:0),0)
}

export function resolveStructuredReasoningRoute(orchestration={},context={},message='',options={}){
  const base={...(orchestration?.route||{})}
  const providerConfigured=options.providerConfigured!==false
  const distinctCollections=sourceCount(context)
  const intent=String(base.intent||'decision_support')
  const commonIntent=['account_priority','visit_preparation','commitment','value_sale','decision_support'].includes(intent)
  const continued=Boolean(orchestration?.continuity?.carryForward||context?.conversationThread?.continued)
  const request=clean(message,3_000)
  const nuanced=request.length>180||/(?:por[eé]m|ao mesmo tempo|considerando|cruze|estrat[eé]gia|cen[aá]rio|alternativa|compare|por que)/i.test(request)
  const requested=Boolean(base.useGenerativeAi||
    (commonIntent&&distinctCollections>=2)||
    (continued&&distinctCollections>=1)||
    (nuanced&&distinctCollections>=1))
  const useGenerativeAi=Boolean(providerConfigured&&requested)
  const tier=(base.mode==='retrieval_hybrid'||['agronomic_commercial_decision','technical_decision'].includes(intent)||distinctCollections>=6||request.length>700)?'strategic':'daily'
  const reason=useGenerativeAi
    ?'O dossiê contém fontes suficientes para raciocínio estruturado; fatos, números, score e segurança continuam sob reconciliação determinística.'
    :requested
      ?'A rota pede raciocínio estruturado, mas o provedor não está disponível; a VAL usa o fallback específico e auditável.'
      :'Os dados disponíveis ainda não justificam uma chamada generativa; a VAL responde pelo motor determinístico específico.'
  return {
    requested,
    useGenerativeAi,
    tier,
    distinctCollections,
    route:{...base,mode:useGenerativeAi?'structured_hybrid':base.mode||'deterministic',useGenerativeAi,reason,structuredReasoning:requested,specificityVersion:VERSION}
  }
}

function mergeEvidence(advice={},context={}){
  const merged=[]
  const seen=new Set()
  const candidates=[
    ...array(advice.evidence_used),
    ...array(context?.decisionIntelligence?.evidence),
    ...array(context?.conversionIntelligence?.evidence)
  ]
  for(const item of candidates){
    const id=clean(item?.id,180)
    if(!id||seen.has(id))continue
    seen.add(id)
    merged.push({...item,id})
    if(merged.length>=15)break
  }
  return merged
}

function significantTokens(value=''){
  return unique(normalize(value).split(' ').filter(token=>token.length>=4&&!STOP_WORDS.has(token))).slice(0,24)
}

function accountTokens(context={},advice={}){
  const opportunity=selectedOpportunity(advice)
  const client=context.client||{}
  const evidence=mergeEvidence(advice,context)
  return unique([
    ...significantTokens(client.name),
    ...significantTokens(client.municipality||client.city||client.region),
    ...significantTokens(client.cultures||client.crops),
    ...significantTokens(opportunity.title),
    ...significantTokens(opportunity.stage),
    ...evidence.flatMap(item=>significantTokens(item.claim_supported).slice(0,3))
  ]).slice(0,50)
}

function safeNarrative(value,allowedCorpus,tokens,{min=16,max=5_000}={}){
  const text=clean(value,max)
  if(text.length<min||GENERIC_TEXT.test(text)||UNSAFE_PROMISE.test(text)||APPLICATION_RATE.test(text)||ACTIONABLE_AGRONOMY.test(text))return false
  const allowed=new Set(numberTokens(allowedCorpus))
  if(numberTokens(text).some(token=>!allowed.has(token)))return false
  const normalized=normalize(text)
  return tokens.length===0||tokens.some(token=>normalized.includes(token))
}

function stringsOf(value,depth=0){
  if(depth>5||value===null||value===undefined)return []
  if(typeof value==='string')return [value]
  if(Array.isArray(value))return value.flatMap(item=>stringsOf(item,depth+1))
  if(typeof value==='object')return Object.values(value).flatMap(item=>stringsOf(item,depth+1))
  return []
}

function validIds(ids,evidenceIds,max=5){
  return unique(array(ids).map(String).filter(id=>evidenceIds.has(id))).slice(0,max)
}

function normalizeStrategic(source,evidenceIds){
  if(!source||typeof source!=='object')return null
  const connections=array(source.cross_source_connections).map(item=>({
    title:clean(item?.title,220),
    insight:clean(item?.insight,900),
    evidence_ids:validIds(item?.evidence_ids,evidenceIds),
    why_it_matters:clean(item?.why_it_matters,700)
  })).filter(item=>item.title&&item.insight&&item.evidence_ids.length)
  const hypotheses=array(source.competing_hypotheses).map(item=>({
    label:clean(item?.label,180),
    explanation:clean(item?.explanation,900),
    supporting_evidence_ids:validIds(item?.supporting_evidence_ids,evidenceIds),
    contradicting_evidence_ids:validIds(item?.contradicting_evidence_ids,evidenceIds),
    falsifier:clean(item?.falsifier,600),
    validation_move:clean(item?.validation_move,600)
  })).filter(item=>item.label&&item.explanation&&item.falsifier&&item.validation_move&&item.supporting_evidence_ids.length)
  const unknown=source.highest_value_unknown||{}
  const loop=source.learning_loop||{}
  if(connections.length<1||hypotheses.length<2)return null
  return {
    moment:clean(source.moment,320),
    non_obvious_connection:clean(source.non_obvious_connection,1_000),
    decision_at_stake:clean(source.decision_at_stake,700),
    leverage_point:clean(source.leverage_point,700),
    do_not_do:clean(source.do_not_do,600),
    cross_source_connections:connections.slice(0,4),
    competing_hypotheses:hypotheses.slice(0,3),
    highest_value_unknown:{
      question:clean(unknown.question,600),
      why_it_matters:clean(unknown.why_it_matters,700),
      how_to_get:clean(unknown.how_to_get,700),
      evidence_ids:validIds(unknown.evidence_ids,evidenceIds)
    },
    learning_loop:{record:clean(loop.record,700),success_signal:clean(loop.success_signal,700),failure_signal:clean(loop.failure_signal,700),next_update:clean(loop.next_update,700)}
  }
}

function normalizeConversationPlan(source,evidenceIds){
  if(!source||typeof source!=='object')return null
  const steps=array(source.steps).map(item=>({
    stage:clean(item?.stage,40),question_type:clean(item?.question_type,40),goal:clean(item?.goal,500),suggested_line:clean(item?.suggested_line,800),advance_signal:clean(item?.advance_signal,600),if_resistance:clean(item?.if_resistance,600)
  })).filter(item=>item.stage&&item.goal&&item.suggested_line&&item.advance_signal)
  const closing=array(source.closing_options).map(item=>({when:clean(item?.when,500),suggested_line:clean(item?.suggested_line,800),commitment:clean(item?.commitment,500)})).filter(item=>item.when&&item.suggested_line&&item.commitment)
  if(!steps.length||!closing.length)return null
  return {opening:clean(source.opening,800),steps:steps.slice(0,5),closing_options:closing.slice(0,3),do_not_say:array(source.do_not_say).map(item=>clean(item,500)).filter(Boolean).slice(0,5),_evidenceIds:evidenceIds}
}

export function mergeStructuredReasoning(reconciled={},incoming={},context={},message='',options={}){
  const result=clone(reconciled)
  const usedGenerativeAi=options.usedGenerativeAi===true
  const evidence=mergeEvidence(result,context)
  result.evidence_used=evidence
  const evidenceIds=new Set(evidence.map(item=>item.id))
  const allowedCorpus=[message,JSON.stringify(context),JSON.stringify(result),JSON.stringify(incoming)].join(' ')
  const tokens=accountTokens(context,{...result,evidence_used:evidence})
  const accepted=[]

  if(!usedGenerativeAi||safetyBlocked(result)){
    result.specificity_audit={version:VERSION,model_reasoning_requested:usedGenerativeAi,model_reasoning_accepted:false,accepted_fields:[],status:safetyBlocked(result)?'safety_preserved':'deterministic'}
    return result
  }

  if(safeNarrative(incoming.answer,allowedCorpus,tokens,{min:80,max:4_500})){
    result.answer=clean(incoming.answer,4_500);accepted.push('answer')
  }
  if(safeNarrative(incoming.objective,allowedCorpus,tokens,{min:20,max:900})){
    result.objective=clean(incoming.objective,900);accepted.push('objective')
  }

  const incomingBrief=incoming.executive_brief||{}
  const mergedBrief={...(result.executive_brief||{})}
  for(const [key,max] of [['headline',240],['reason',1_000],['action',1_000],['question',700]]){
    if(safeNarrative(incomingBrief[key],allowedCorpus,tokens,{min:key==='headline'?8:18,max})){
      mergedBrief[key]=clean(incomingBrief[key],max);accepted.push(`executive_brief.${key}`)
    }
  }
  const incomingBasis=array(incomingBrief.decision_basis).map(item=>clean(item,800)).filter(item=>safeNarrative(item,allowedCorpus,tokens,{min:18,max:800})).slice(0,3)
  if(incomingBasis.length){mergedBrief.decision_basis=incomingBasis;accepted.push('executive_brief.decision_basis')}
  result.executive_brief=mergedBrief

  const strategic=normalizeStrategic(incoming.strategic_synthesis,evidenceIds)
  if(strategic&&stringsOf(strategic).every(item=>safeNarrative(item,allowedCorpus,tokens,{min:8,max:1_000}))){
    result.strategic_synthesis=strategic;accepted.push('strategic_synthesis')
  }

  const next=incoming.next_question
  if(next&&result.next_question&&safeNarrative(next.question,allowedCorpus,tokens,{min:12,max:700})){
    result.next_question={...result.next_question,question:clean(next.question,700),purpose:clean(next.purpose,700)||result.next_question.purpose,evidence_needed:clean(next.evidence_needed,500)||result.next_question.evidence_needed,grounding_ids:validIds(next.grounding_ids,evidenceIds)}
    accepted.push('next_question')
  }

  const plan=normalizeConversationPlan(incoming.conversation_plan,evidenceIds)
  if(plan&&stringsOf(plan).every(item=>safeNarrative(item,allowedCorpus,tokens,{min:8,max:900}))){
    delete plan._evidenceIds
    result.conversation_plan=plan;accepted.push('conversation_plan')
  }

  result.specificity_audit={version:VERSION,model_reasoning_requested:true,model_reasoning_accepted:accepted.length>0,accepted_fields:accepted,status:accepted.length?'model_reasoning_merged':'model_reasoning_rejected'}
  return result
}

function preferredEvidence(advice={},context={}){
  const evidence=mergeEvidence(advice,context)
  const map=new Map(evidence.map(item=>[item.id,item]))
  const preferredIds=unique([
    ...array(advice?.executive_brief?.evidence_ids),
    ...array(context?.decisionIntelligence?.signals?.find(item=>item.id===context?.decisionIntelligence?.top_signal_id)?.evidence_ids),
    ...array(advice?.strategic_synthesis?.cross_source_connections).flatMap(item=>array(item.evidence_ids)),
    ...array(advice?.strategic_synthesis?.highest_value_unknown?.evidence_ids)
  ])
  const ordered=[...preferredIds.map(id=>map.get(id)).filter(Boolean),...evidence]
  const result=[]
  const seenIds=new Set()
  const seenTypes=new Set()
  for(const item of ordered){
    if(!item?.id||seenIds.has(item.id)||['missing','unknown'].includes(item.source_type))continue
    if(!seenTypes.has(item.source_type)){result.push(item);seenIds.add(item.id);seenTypes.add(item.source_type)}
    if(result.length>=3)break
  }
  if(result.length<2){
    for(const item of ordered){
      if(!item?.id||seenIds.has(item.id)||['missing','unknown'].includes(item.source_type))continue
      result.push(item);seenIds.add(item.id)
      if(result.length>=3)break
    }
  }
  return {evidence,selected:result,map}
}

function topSignal(context={}){
  const intelligence=context.decisionIntelligence||{}
  return array(intelligence.signals).find(item=>item.id===intelligence.top_signal_id)||array(intelligence.signals)[0]||null
}

function factsFor(advice={},context={}){
  const {evidence,selected}=preferredEvidence(advice,context)
  const opportunity=selectedOpportunity(advice)
  const client=context.client||{}
  const signal=topSignal(context)
  const loss=evidence.find(item=>item.source_type==='business_history'&&/perd|lost|motivo|pre[cç]o/i.test(item.claim_supported||''))||null
  const technical=evidence.find(item=>['field_report','soil_analysis','ndvi','manual_record'].includes(item.source_type))||null
  const profile=evidence.find(item=>item.source_type==='producer_questionnaire')||null
  const visit=evidence.find(item=>item.source_type==='visit')||null
  const interaction=evidence.find(item=>item.source_type==='interaction')||null
  const commercial=evidence.find(item=>item.id==='commercial-context'||item.source_type==='business_history')||null
  const stage=clean(opportunity.stage||advice?.opportunity_review?.selected_stage,100)
  const missing=clean(advice?.executive_brief?.missing_data?.[0]||signal?.missing_data?.[0]||advice?.confidence?.missing_data?.[0]||'o dado que realmente muda a decisão',180)
  return {evidence,selected,opportunity,client,signal,loss,technical,profile,visit,interaction,commercial,stage,missing}
}

function scenarioFor(facts){
  if(facts.signal?.kind==='overdue_commitment'||facts.signal?.id==='overdue-commitment')return 'overdue'
  if(facts.loss&&/pre[cç]o/i.test(facts.loss.claim_supported||''))return 'price_loss'
  if(facts.technical)return 'technical_change'
  if(facts.profile&&facts.opportunity?.title)return 'proof_preference'
  if(facts.commercial&&facts.opportunity?.title&&/potencial|pipeline/i.test(facts.commercial.claim_supported||''))return 'pipeline_gap'
  if(/negocia|proposta|decis[aã]o/i.test(facts.stage))return 'negotiation'
  if(/diagn[oó]stico|qualifica|descoberta/i.test(facts.stage))return 'diagnosis'
  return 'insufficient'
}

function claim(item,max=260){return clean(item?.claim_supported||'',max)}
function firstName(value){return clean(value||'Produtor',120).split(/\s+/)[0]||'Produtor'}
function titleOf(facts){return clean(facts.opportunity?.title||'a oportunidade atual',220)}
function stageOf(facts){return clean(facts.stage||'etapa ainda não confirmada',100)}
function questionFor(scenario,facts){
  const title=titleOf(facts)
  if(scenario==='price_loss')return `Na decisão sobre “${title}”, o que precisava estar comprovado para o preço deixar de ser o único critério?`
  if(scenario==='overdue')return `“${title}” continua prioritária para você; se sim, qual bloqueio precisa ser removido primeiro?`
  if(scenario==='technical_change')return `Esse registro técnico mudou qual decisão de “${title}” nesta safra?`
  if(scenario==='proof_preference')return `Para decidir sobre “${title}”, o que precisa ser medido, por quem e em qual formato?`
  if(scenario==='pipeline_gap')return `Qual parte do potencial ligado a “${title}” terá decisão nesta safra e qual fato dispara essa decisão?`
  if(scenario==='negotiation')return `Qual é a única pendência que impede o próximo compromisso em “${title}”?`
  if(scenario==='diagnosis')return `Se o problema ligado a “${title}” continuar, qual decisão e qual impacto precisam ser dimensionados?`
  return 'Qual decisão desta safra mudou a partir desses fatos, e qual registro comprova essa mudança?'
}

function actionFor(scenario,facts){
  const title=titleOf(facts)
  if(scenario==='price_loss')return `Retome o motivo de perda registrado, compare-o com “${title}” e registre o critério que faltou antes de discutir desconto.`
  if(scenario==='overdue')return `Retome “${title}”, confirme se o compromisso ainda é real e registre bloqueio, responsável e nova data somente se a prioridade continuar.`
  if(scenario==='technical_change')return `Leve o registro técnico e “${title}” para a mesma conversa, confirme qual decisão mudou e encaminhe qualquer execução para revisão habilitada.`
  if(scenario==='proof_preference')return `Desenhe com o produtor a prova de “${title}”, registrando métrica, fonte, responsável e momento de validação.`
  if(scenario==='pipeline_gap')return `Escolha a categoria ligada a “${title}”, confirme decisão e janela reais e atualize o pipeline somente com a resposta registrada.`
  if(scenario==='negotiation')return `Isole a pendência de “${title}” e feche um próximo passo com responsável, data e evidência de conclusão.`
  if(scenario==='diagnosis')return `Dimensione o problema de “${title}” com unidade, horizonte e área confirmados antes de apresentar proposta.`
  return 'Cruze os dois fatos citados, pergunte qual decisão foi alterada e registre a resposta literal antes de abrir uma nova oportunidade.'
}

function implicationFor(item,scenario,facts){
  const title=titleOf(facts)
  if(item?.source_type==='business_history')return scenario==='price_loss'?`o histórico de preço precisa ser testado na decisão atual de “${title}”, não presumido`:`o histórico muda a abordagem, mas não prova a causa da decisão atual`
  if(item?.source_type==='opportunity')return `a etapa de “${title}” precisa ser comparada com um compromisso real do produtor`
  if(item?.source_type==='visit'||item?.source_type==='interaction')return 'o próximo avanço depende de confirmar compromisso, responsável e prazo'
  if(item?.source_type==='producer_questionnaire')return 'o formato de prova e os participantes devem seguir o que foi declarado nesta conta'
  if(['field_report','soil_analysis','ndvi','manual_record'].includes(item?.source_type))return 'o sinal técnico deve ser ligado a uma decisão sem virar diagnóstico ou prescrição'
  if(item?.source_type==='client_record')return 'o contexto produtivo dimensiona a conversa, mas não prova intenção de compra'
  return 'este fato precisa ser confirmado contra a decisão atual'
}

function contextualHypotheses(scenario,facts){
  const primary=facts.selected[0]||facts.evidence[0]||null
  const secondary=facts.selected[1]||facts.evidence.find(item=>item?.id!==primary?.id)||primary
  const title=titleOf(facts)
  const missing=facts.missing
  const firstId=primary?.id?[primary.id]:[]
  const secondId=secondary?.id?[secondary.id]:firstId
  const primaryClaim=claim(primary)||`A conta tem “${title}” em ${stageOf(facts)}.`
  const secondaryClaim=claim(secondary)||'Ainda falta uma segunda fonte independente para sustentar a decisão.'
  const common=item=>({...item,contradicting_evidence_ids:[]})

  if(scenario==='price_loss')return [
    common({label:'Preço continua sendo o bloqueio nesta conta',explanation:`${primaryClaim} Na oportunidade “${title}”, a hipótese é que o critério de valor ainda não foi reconstruído para a decisão atual.`,supporting_evidence_ids:firstId,falsifier:'O produtor mostra que a decisão atual está travada por prazo, participante ou prioridade, e não por preço.',validation_move:`Retomar o motivo registrado e confirmar ${missing} antes de revisar condição comercial.`}),
    common({label:'Preço foi o rótulo final de outro bloqueio',explanation:`${secondaryClaim} A perda pode ter sido classificada por preço depois de uma falha anterior de prova, timing ou participação.`,supporting_evidence_ids:secondId,falsifier:'Os registros mostram comparação equivalente e decisão perdida exclusivamente pela condição comercial.',validation_move:`Perguntar em que momento “${title}” deixou de avançar e qual evidência faltou naquele ponto.`})
  ]
  if(scenario==='overdue')return [
    common({label:'O compromisso segue real, mas existe um bloqueio específico',explanation:`${primaryClaim} O atraso pode representar uma dependência concreta ainda não resolvida em “${title}”.`,supporting_evidence_ids:firstId,falsifier:'O produtor informa que a prioridade deixou de existir ou que não reconhece o compromisso.',validation_move:`Confirmar ${missing} antes de combinar responsável e nova data.`}),
    common({label:'A prioridade mudou e o pipeline não acompanhou',explanation:`${secondaryClaim} A etapa atual pode estar descrevendo a expectativa interna, não a ordem de decisão do produtor.`,supporting_evidence_ids:secondId,falsifier:'O produtor reconfirma urgência, responsável e prazo para o mesmo compromisso.',validation_move:`Pedir que o produtor escolha se mantém, altera ou encerra “${title}”.`})
  ]
  if(scenario==='technical_change')return [
    common({label:'O registro técnico mudou a decisão comercial',explanation:`${primaryClaim} A hipótese é que o fato alterou risco, calendário ou necessidade de prova em “${title}”.`,supporting_evidence_ids:firstId,falsifier:'O produtor confirma que o registro não muda nenhuma decisão desta safra.',validation_move:`Perguntar qual decisão mudou e registrar ${missing}, sem sugerir causa ou produto.`}),
    common({label:'O registro é tecnicamente relevante, mas comercialmente neutro',explanation:`${secondaryClaim} O acompanhamento pode ser necessário sem mudar orçamento, prioridade ou compromisso comercial.`,supporting_evidence_ids:secondId,falsifier:'O produtor liga o registro a uma decisão e a uma data concretas.',validation_move:`Separar o acompanhamento técnico do avanço de “${title}” até haver impacto decisório confirmado.`})
  ]
  if(scenario==='proof_preference')return [
    common({label:'A forma de comprovação é o gargalo',explanation:`${primaryClaim} “${title}” pode não avançar porque a prova ainda não está no formato que esta conta considera confiável.`,supporting_evidence_ids:firstId,falsifier:'O produtor aceita a prova proposta e aponta outro bloqueio.',validation_move:`Definir ${missing}, a fonte e quem valida antes de revisar preço.`}),
    common({label:'A prova está certa, mas falta quem decide',explanation:`${secondaryClaim} A ausência de avanço pode estar ligada a participante ou critério ainda não registrado.`,supporting_evidence_ids:secondId,falsifier:'Todos os participantes confirmam o mesmo critério e resta somente a comprovação.',validation_move:`Confirmar quem ainda precisa validar “${title}” e o que essa pessoa precisa ver.`})
  ]
  if(scenario==='pipeline_gap')return [
    common({label:'Existe uma decisão real ainda fora do pipeline',explanation:`${primaryClaim} Parte do espaço comercial pode ter janela e problema concretos, mas ainda não foi transformada em movimento verificável.`,supporting_evidence_ids:firstId,falsifier:`Nenhuma categoria relacionada a “${title}” terá decisão nesta safra.`,validation_move:`Escolher uma categoria e confirmar ${missing}, janela e próximo passo.`}),
    common({label:'O potencial cadastral está acima da decisão atual',explanation:`${secondaryClaim} O valor em aberto pode incluir capacidade teórica, dados antigos ou categorias sem prioridade presente.`,supporting_evidence_ids:secondId,falsifier:'O produtor reconfirma categoria, volume, prazo e decisão atual.',validation_move:`Revalidar a composição do potencial antes de usar “${title}” como cobertura da conta.`})
  ]
  if(scenario==='negotiation')return [
    common({label:'A negociação depende de uma pendência objetiva',explanation:`${primaryClaim} “${title}” pode avançar quando a única pendência real for nomeada e atribuída.`,supporting_evidence_ids:firstId,falsifier:'O produtor não reconhece a oportunidade como decisão atual.',validation_move:`Confirmar ${missing} e transformar a resposta em responsável, data e evidência.`}),
    common({label:'A etapa está mais avançada no CRM do que na decisão',explanation:`${secondaryClaim} O estágio registrado pode estar refletindo proposta enviada, e não compromisso bilateral.`,supporting_evidence_ids:secondId,falsifier:'Há compromisso recente, responsável e prazo aceitos pelo produtor.',validation_move:`Comparar a etapa de “${title}” com o último comportamento observável antes de propor fechamento.`})
  ]
  if(scenario==='diagnosis')return [
    common({label:'O problema existe, mas o impacto ainda não foi dimensionado',explanation:`${primaryClaim} “${title}” pode ser relevante, porém falta ligar o problema à consequência e à decisão afetada.`,supporting_evidence_ids:firstId,falsifier:'O produtor já quantificou impacto, unidade, horizonte e prioridade.',validation_move:`Confirmar ${missing} e dimensionar impacto antes de apresentar solução.`}),
    common({label:'A oportunidade ainda é uma hipótese interna',explanation:`${secondaryClaim} O registro pode representar interesse da equipe sem problema ou janela reconhecidos pelo produtor.`,supporting_evidence_ids:secondId,falsifier:'O produtor nomeia problema, prazo e consequência próprios.',validation_move:`Voltar à descoberta de “${title}” e registrar as palavras do produtor.`})
  ]
  return [
    common({label:'Os fatos mudaram uma decisão que ainda não foi registrada',explanation:`${primaryClaim} A conexão pode existir, mas falta nomear qual decisão foi alterada nesta conta.`,supporting_evidence_ids:firstId,falsifier:'O produtor confirma que nenhuma decisão mudou.',validation_move:`Perguntar qual decisão mudou a partir de ${sourceLabel(primary?.source_type)} e registrar a resposta literal.`}),
    common({label:'Os fatos coexistem sem decisão ativa',explanation:`${secondaryClaim} O dossiê pode estar correto sem justificar uma ação comercial agora.`,supporting_evidence_ids:secondId,falsifier:'Surge decisão com prazo, consequência e responsável claros.',validation_move:'Confirmar ausência de prioridade e manter acompanhamento sem criar necessidade.'})
  ]
}

function anchoredHypotheses(items,evidenceMap){
  if(array(items).length<2)return false
  return array(items).slice(0,2).every(item=>{
    const ids=array(item?.supporting_evidence_ids).filter(id=>evidenceMap.has(id))
    if(!ids.length||!clean(item?.explanation)||!clean(item?.validation_move))return false
    const anchors=ids.flatMap(id=>significantTokens(evidenceMap.get(id)?.claim_supported).slice(0,5))
    const normalizedText=normalize(`${item.explanation} ${item.validation_move}`)
    return anchors.some(token=>normalizedText.includes(token))
  })
}

function specificAnswer(scenario,facts,action,question){
  const name=firstName(facts.client?.name)
  const title=titleOf(facts)
  const primary=claim(facts.selected[0])||`“${title}” está em ${stageOf(facts)}.`
  const secondary=claim(facts.selected[1])
  if(scenario==='price_loss')return `${name}: o histórico desta conta registra ${primary} Em “${title}”, não comece por desconto; primeiro descubra qual critério de valor ficou sem prova. ${action} Pergunta para avançar: ${question}`
  if(scenario==='overdue')return `${name}: “${title}” está em ${stageOf(facts)}, mas ${primary} Primeiro confirme se o compromisso ainda é real; só depois combine responsável e prazo. ${action} Pergunta para avançar: ${question}`
  if(scenario==='technical_change')return `${name}: ${primary}${secondary?` Ao mesmo tempo, ${secondary}`:''} Antes de transformar o sinal técnico em argumento, confirme qual decisão ele mudou. ${action} Pergunta para avançar: ${question}`
  if(scenario==='proof_preference')return `${name}: ${primary}${secondary?` Já ${secondary}`:''} O ponto não é acrescentar benefícios; é construir a prova que esta conta aceita para “${title}”. ${action} Pergunta para avançar: ${question}`
  if(scenario==='pipeline_gap')return `${name}: ${primary}${secondary?` Já ${secondary}`:''} O foco é separar potencial cadastral de uma decisão real nesta safra. ${action} Pergunta para avançar: ${question}`
  if(scenario==='negotiation')return `${name}: “${title}” chegou a ${stageOf(facts)}, enquanto ${primary} Em vez de ampliar a proposta, isole a pendência que impede o próximo compromisso. ${action} Pergunta para avançar: ${question}`
  if(scenario==='diagnosis')return `${name}: “${title}” ainda está em ${stageOf(facts)} e ${primary} Não apresente solução completa antes de dimensionar consequência e decisão afetada. ${action} Pergunta para avançar: ${question}`
  return `${name}: ${primary}${secondary?` Cruzado com ${secondary}`:''} o dossiê ainda não mostra qual decisão mudou. ${action} Pergunta para avançar: ${question}`
}

function contextualHowToGet(scenario,facts){
  const title=titleOf(facts)
  if(scenario==='price_loss')return `Na próxima conversa sobre “${title}”, retome o motivo de perda registrado, peça o critério que faltou e salve a resposta literal ligada ao histórico comercial.`
  if(scenario==='overdue')return `Retome “${title}” pelo canal da interação mais recente e registre se o compromisso foi mantido, alterado ou encerrado, com bloqueio e responsável.`
  if(scenario==='technical_change')return `Mostre somente o fato do ${sourceLabel(facts.technical?.source_type)}, pergunte qual decisão ele mudou e encaminhe qualquer execução ao responsável técnico.`
  if(scenario==='proof_preference')return `Peça ao produtor que defina a métrica, a fonte, o formato e quem valida a prova de “${title}”; registre cada item separadamente.`
  if(scenario==='pipeline_gap')return `Abra a composição do potencial, escolha uma categoria e confirme com o produtor decisão, janela e situação atual antes de alterar o pipeline.`
  if(scenario==='negotiation')return `Pergunte a pendência única de “${title}” e registre a resposta como ação, responsável, data e evidência de conclusão.`
  if(scenario==='diagnosis')return `Confirme problema, unidade, horizonte e área afetada de “${title}” antes de calcular impacto ou apresentar solução.`
  return `Apresente os dois fatos do dossiê sem sugerir causa, pergunte qual decisão mudou e registre a resposta literal com fonte e data.`
}

function learningLoopFor(scenario,facts,question){
  const title=titleOf(facts)
  if(scenario==='price_loss')return {record:`Resposta literal à pergunta “${question}”, critério de valor, comparação usada e próximo compromisso em “${title}”.`,success_signal:`O motivo de preço é confirmado ou refutado e “${title}” passa a ter critério de valor e próximo passo verificáveis.`,failure_signal:'A conversa volta a desconto sem esclarecer critério, prova ou decisão.',next_update:`Recalcular a abordagem de “${title}” com o critério confirmado e o resultado do próximo contato.`}
  if(scenario==='overdue')return {record:`Situação atual de “${title}”, causa do atraso, decisão de manter/alterar/encerrar, responsável e prazo.`,success_signal:`“${title}” fica com compromisso real e datado ou é encerrada com motivo registrado.`,failure_signal:'A oportunidade permanece aberta sem bloqueio, responsável ou nova data.',next_update:`Reordenar a prioridade de “${title}” conforme o compromisso confirmado ou o encerramento.`}
  if(scenario==='technical_change')return {record:`Fato técnico apresentado, decisão afetada, resposta do produtor e responsável pela revisão de qualquer execução ligada a “${title}”.`,success_signal:`O sinal técnico fica ligado a uma decisão comercial específica sem virar diagnóstico ou prescrição.`,failure_signal:'O registro técnico é usado como argumento sem confirmar impacto decisório ou revisão.',next_update:`Atualizar “${title}” somente após a decisão afetada ou a neutralidade comercial estarem registradas.`}
  if(scenario==='proof_preference')return {record:`Métrica, fonte, formato, participante e data de validação da prova de “${title}”.`,success_signal:`A conta aceita um desenho de prova específico e combina quem valida e quando.`,failure_signal:'A conversa acumula benefícios sem definir como a decisão será conferida.',next_update:`Reavaliar “${title}” com o resultado da prova e o participante que validou.`}
  if(scenario==='pipeline_gap')return {record:`Categoria escolhida, decisão da safra, janela, situação atual e resposta literal ligada a “${title}”.`,success_signal:'Uma parte do potencial vira oportunidade verificável ou é retirada da prioridade atual.',failure_signal:'O potencial continua sendo tratado como previsão de fechamento sem decisão nomeada.',next_update:`Recalcular cobertura da conta após confirmar ou retirar a categoria ligada a “${title}”.`}
  if(scenario==='negotiation')return {record:`Pendência única, responsável, data e evidência do próximo movimento de “${title}”.`,success_signal:`A negociação avança por um compromisso bilateral verificável, não apenas por proposta enviada.`,failure_signal:'A etapa permanece avançada sem ação aceita pelo produtor.',next_update:`Atualizar a etapa de “${title}” somente com o compromisso ou a objeção registrada.`}
  if(scenario==='diagnosis')return {record:`Problema, consequência, unidade, horizonte, área confirmada e decisão afetada em “${title}”.`,success_signal:'O diagnóstico comercial deixa de ser hipótese interna e passa a ter impacto e prioridade confirmados pelo produtor.',failure_signal:'A solução é apresentada antes de problema e impacto serem confirmados.',next_update:`Construir valor para “${title}” somente depois do impacto confirmado.`}
  return {record:`Resposta literal à pergunta “${question}”, decisão afetada, fonte, responsável e prazo.`,success_signal:'Os fatos passam a sustentar uma decisão específica ou a ausência legítima de ação.',failure_signal:'A conversa termina sem decisão, fonte ou próximo passo verificáveis.',next_update:'Reordenar os sinais somente quando a decisão ou a ausência de prioridade for registrada.'}
}

function doNotSayFor(scenario,facts){
  const title=titleOf(facts)
  if(scenario==='price_loss')return `Não diga que “${title}” vale mais sem mostrar o critério e a prova que esta conta aceita.`
  if(scenario==='overdue')return `Não trate “${title}” como prioridade ativa antes de reconfirmar o compromisso vencido.`
  if(scenario==='technical_change')return `Não transforme o ${sourceLabel(facts.technical?.source_type)} em diagnóstico, produto ou prescrição para avançar “${title}”.`
  if(scenario==='proof_preference')return `Não empilhe benefícios de “${title}” sem definir métrica, fonte e responsável pela validação.`
  if(scenario==='pipeline_gap')return `Não apresente o potencial da conta como probabilidade de fechar “${title}”.`
  if(scenario==='negotiation')return `Não chame proposta enviada de compromisso aceito em “${title}”.`
  if(scenario==='diagnosis')return `Não apresente solução para “${title}” antes de confirmar problema, impacto e decisão afetada.`
  return 'Não preencha a falta de decisão com uma recomendação que serviria para qualquer produtor.'
}

function doubleCountingGuardFor(scenario,facts,advice){
  const title=titleOf(facts)
  const commercial=advice.commercial_context||{}
  const selectedValue=facts.opportunity?.amount
  if(scenario==='price_loss')return `Não trate uma perda classificada por preço como retorno recuperável de “${title}” sem prova de causa e comparação equivalente.`
  if(scenario==='technical_change')return `Não some risco técnico potencial, valor de “${title}” e potencial da conta como se fossem o mesmo benefício.`
  if(commercial.open_potential>0&&Number(selectedValue)>0)return `Não some o potencial em aberto da conta ao valor de “${title}”; a oportunidade pode já estar contida nesse espaço comercial.`
  if(scenario==='pipeline_gap')return `Não conte o potencial cadastral e o pipeline de “${title}” como valores independentes sem verificar sobreposição.`
  return `Não some impacto estimado, valor da oportunidade e potencial da conta sem confirmar que representam parcelas diferentes da decisão de “${title}”.`
}

export function enforceValSpecificity(advice={},context={},message='',options={}){
  const result=clone(advice)
  result.evidence_used=mergeEvidence(result,context)
  if(safetyBlocked(result)){
    result.specificity_audit={...(result.specificity_audit||{}),version:VERSION,status:'safety_preserved',repaired_fields:[],distinct_source_types:0}
    return result
  }

  const facts=factsFor(result,context)
  const scenario=scenarioFor(facts)
  const action=actionFor(scenario,facts)
  const question=questionFor(scenario,facts)
  const evidenceMap=new Map(result.evidence_used.map(item=>[item.id,item]))
  const selected=facts.selected.slice(0,3)
  const distinctTypes=new Set(selected.map(item=>item?.source_type).filter(Boolean))
  const basis=selected.map(item=>`${claim(item,360)} → ${implicationFor(item,scenario,facts)}.`).filter(Boolean).slice(0,3)
  const evidenceIds=selected.map(item=>item.id).filter(Boolean).slice(0,3)
  if(distinctTypes.size<2&&basis.length<3)basis.push(`Falta uma segunda fonte independente → confirme ${facts.missing} antes de tratar a leitura como decisão.`)
  const repaired=[]
  const acceptedFields=new Set(array(result.specificity_audit?.accepted_fields))

  if(!acceptedFields.has('answer')||GENERIC_TEXT.test(result.answer||'')){
    result.answer=specificAnswer(scenario,facts,action,question);repaired.push('answer')
  }

  result.executive_brief={...(result.executive_brief||{}),action:acceptedFields.has('executive_brief.action')?result.executive_brief?.action:action,question:acceptedFields.has('executive_brief.question')?result.executive_brief?.question:question,decision_basis:basis,evidence_ids:evidenceIds,missing_data:unique([facts.missing,...array(result.executive_brief?.missing_data)]).slice(0,3)}
  if(!acceptedFields.has('executive_brief.action'))repaired.push('executive_brief.action')
  repaired.push('executive_brief.decision_basis')

  const currentStrategic=result.strategic_synthesis||{}
  const modelStrategicAccepted=acceptedFields.has('strategic_synthesis')&&anchoredHypotheses(currentStrategic.competing_hypotheses,evidenceMap)
  if(!modelStrategicAccepted){
    const hypotheses=contextualHypotheses(scenario,facts)
    const primary=selected[0]
    const secondary=selected[1]
    const crossIds=unique([primary?.id,secondary?.id]).filter(Boolean)
    const loop=learningLoopFor(scenario,facts,question)
    result.strategic_synthesis={
      ...currentStrategic,
      moment:clean(result.executive_brief?.headline||facts.signal?.title||`Decisão de ${titleOf(facts)}`,320),
      non_obvious_connection:selected.length>=2?`${claim(primary,420)} Cruzado com ${claim(secondary,420)}, o ponto não é repetir o cadastro; é testar qual decisão esses fatos mudam nesta conta.`:claim(primary,700)||'Ainda falta uma segunda fonte independente para sustentar uma conexão específica.',
      decision_at_stake:facts.signal?.decision||`Definir se “${titleOf(facts)}” tem decisão real, janela e próximo compromisso.`,
      leverage_point:action,
      do_not_do:doNotSayFor(scenario,facts),
      cross_source_connections:[{title:`Cruzamento para “${titleOf(facts)}”`,insight:selected.length>=2?`${claim(primary,360)} + ${claim(secondary,360)}`:claim(primary,500)||'Há somente uma fonte útil disponível.',evidence_ids:crossIds,why_it_matters:distinctTypes.size>=2?'As fontes descrevem dimensões diferentes da mesma decisão e precisam ser confirmadas juntas.':'Sem segunda fonte, a VAL deve declarar a lacuna em vez de criar uma história.'}],
      competing_hypotheses:hypotheses,
      highest_value_unknown:{question,why_it_matters:`A resposta separa as hipóteses sobre “${titleOf(facts)}” e muda o próximo passo.`,how_to_get:contextualHowToGet(scenario,facts),evidence_ids:crossIds},
      learning_loop:loop
    }
    repaired.push('strategic_synthesis')
  }

  result.next_question=result.next_question?{...result.next_question,question:acceptedFields.has('next_question')?result.next_question.question:question,purpose:acceptedFields.has('next_question')?result.next_question.purpose:`Separar as hipóteses específicas de “${titleOf(facts)}” e escolher o próximo passo.`,evidence_needed:acceptedFields.has('next_question')?result.next_question.evidence_needed:facts.missing,grounding_ids:evidenceIds}:result.next_question
  if(result.next_question&&!acceptedFields.has('next_question'))repaired.push('next_question')

  result.conversation_plan={...(result.conversation_plan||{}),do_not_say:unique([doNotSayFor(scenario,facts),...array(result.conversation_plan?.do_not_say)]).slice(0,5)}
  repaired.push('conversation_plan.do_not_say')
  result.value_hypothesis={...(result.value_hypothesis||{}),double_counting_guard:doubleCountingGuardFor(scenario,facts,result)}
  repaired.push('value_hypothesis.double_counting_guard')

  result.specificity_audit={
    ...(result.specificity_audit||{}),
    version:VERSION,
    status:repaired.length?'specificity_enforced':'specificity_passed',
    scenario,
    repaired_fields:unique(repaired),
    distinct_source_types:distinctTypes.size,
    evidence_ids:evidenceIds,
    substitution_fingerprint:hash([scenario,distinctTypes.size,evidenceIds.join(','),titleOf(facts),facts.missing].join('|')),
    generative_used:options.usedGenerativeAi===true,
    route:options.route?.mode||null
  }
  return result
}

export const specificityVersion=VERSION
