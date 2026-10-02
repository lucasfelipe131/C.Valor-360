import {compactBRL,commercialMetrics} from '../src/lib/commercial-metrics.js'
import {buildDecisionInterview} from './ai-reasoning/decision-interview.js'
import {DECISION_VERSION,SCORING_POLICIES,hashDecision} from './decision-governance.js'

const DAY=86_400_000
const array=value=>Array.isArray(value)?value:[]
const clean=(value,max=280)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>clean(value).toLocaleLowerCase('pt-BR')
const number=value=>Number.isFinite(Number(value))?Number(value):null
const timestamp=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?null:parsed.getTime()}
const observedAt=value=>timestamp(value)===null?'unknown':new Date(value).toISOString()
const dateLabel=value=>{const parsed=timestamp(value);return parsed===null?'sem data registrada':new Date(parsed).toLocaleDateString('pt-BR',{timeZone:'UTC'})}
const words=(value,max=14)=>clean(value,220).split(/\s+/).slice(0,max).join(' ')
const evidence=(id,claim,sourceType,sourceId,{quality='moderate',relevance='high',uncertainty='',observed='unknown',direct=true}={})=>({
  id,
  claim_supported:clean(claim,700),
  source_type:sourceType,
  source_id:clean(sourceId||'unknown',240),
  observed_at:observedAt(observed),
  direct_observation:direct,
  quality,
  relevance,
  uncertainty:clean(uncertainty||'A fonte descreve contexto; não comprova causalidade.',500)
})
const uniqueById=items=>{const seen=new Set();return items.filter(item=>item?.id&&!seen.has(item.id)&&seen.add(item.id))}
const firstText=(...values)=>values.map(value=>clean(value)).find(Boolean)||''
const safeUnit=value=>clean(value,40).replace(/\s*\/\s*ha\b/gi,' por hectare').replace(/^sc$/i,'sacas por hectare')
const quantity=(value,unit='')=>number(value)===null?'':`${Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})}${unit?` ${safeUnit(unit)}`:''}`
const profileAnswer=(client,profile,key,index)=>firstText(client?.[key],profile?.answers?.[index],profile?.answers?.[String(index)])
const latest=(items,fields)=>[...array(items)].sort((a,b)=>Math.max(...fields.map(field=>timestamp(b?.[field])??-1))-Math.max(...fields.map(field=>timestamp(a?.[field])??-1)))[0]||null
const evidenceById=(items,id)=>array(items).find(item=>item.id===id)
const field=(item,...keys)=>{for(const key of keys){const value=item?.[key];if(value!==undefined&&value!==null&&value!=='')return value}return undefined}

function compactObject(value){
  if(value===null||value===undefined)return ''
  if(['string','number','boolean'].includes(typeof value))return clean(value,180)
  if(Array.isArray(value))return value.slice(0,3).map(compactObject).filter(Boolean).join(' • ')
  if(typeof value==='object')return Object.entries(value).slice(0,5).map(([key,item])=>{
    const rendered=compactObject(item)
    return rendered?`${clean(key,45)}: ${rendered}`:''
  }).filter(Boolean).join(' • ').slice(0,420)
  return ''
}

function flattenSeasons(properties=[]){
  const rows=[]
  for(const property of array(properties))for(const field of array(property?.fields))for(const season of array(field?.seasons))rows.push({property,field,season})
  return rows.sort((a,b)=>(timestamp(b.season?.created_at)||timestamp(b.season?.harvested_at)||timestamp(b.season?.planted_at)||0)-(timestamp(a.season?.created_at)||timestamp(a.season?.harvested_at)||timestamp(a.season?.planted_at)||0))
}

function buildEvidence(context){
  const items=[]
  const client=context.client||{}
  const metrics=commercialMetrics(client)
  if(metrics.currentKnown||metrics.potentialKnown||metrics.pipelineKnown)items.push(evidence(
    'commercial-context',
    `Compras atuais ${compactBRL(metrics.currentPurchases,{known:metrics.currentKnown})}; potencial total ${compactBRL(metrics.potentialTotal,{known:metrics.potentialKnown})}; potencial em aberto ${compactBRL(metrics.openPotential,{known:metrics.openPotentialKnown})}; pipeline ${compactBRL(metrics.openPipeline,{known:metrics.pipelineKnown})}${metrics.shareKnown?`; share realizado ${Number(metrics.realizedShare||0).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:''}.`,
    'business_history',`aggregate:commercial:${client.id||'unknown'}`,{observed:client.commercial?.lastBusinessAt,direct:false,uncertainty:'Potencial mede espaço na conta; pipeline mede negócios registrados. Nenhum dos dois comprova intenção de compra.'}
  ))

  const proof=[profileAnswer(client,context.profile,'technicalPresentation',8),profileAnswer(client,context.profile,'trustDriver',14),profileAnswer(client,context.profile,'decisionDriver',7)].filter(Boolean)
  if(proof.length)items.push(evidence('profile-proof-preference',`Para esta conta, as respostas registradas destacam como prova ou critério de decisão: ${proof.join(' • ')}.`,'producer_questionnaire',`profile:${client.id||'unknown'}:proof`,{observed:context.profile?.assessedAt||client.profileUpdatedAt,direct:true,uncertainty:'Preferências declaradas podem variar conforme a decisão; confirme se continuam válidas.'}))

  const opportunity=latest(array(context.opportunities).filter(item=>lower(item?.stage)!=='fechado'),['next_action_at','nextActionAt','updated_at','updatedAt','created_at','createdAt'])||latest(context.opportunities,['updated_at','updatedAt','created_at','createdAt'])
  if(opportunity){
    // O enunciado nomeia a entidade perguntada: 'ele tem oportunidade aberta?' precisa encontrar
    // 'oportunidade' (e 'aberta', quando a etapa não é de fechamento) no próprio fato.
    const openStage=!/fechad|perdid|cancelad/i.test(clean(opportunity.stage))
    // O resumo nomeia o produtor, como as respostas FAST ja fazem: sem o nome, uma pergunta sobre
    // outro produtor respondida com os dados do produtor aberto nao tinha nada na tela que
    // denunciasse a troca.
    const opportunityOwner=clean(client.name,120)
    const parts=[`Oportunidade${openStage?' aberta':''} “${firstText(opportunity.title,'Oportunidade sem título')}”${opportunityOwner?` de ${opportunityOwner}`:''} está em ${firstText(opportunity.stage,'etapa não informada')}`]
    const opportunityValue=field(opportunity,'estimated_value','estimatedValue','value')
    if(number(opportunityValue)!==null&&Number(opportunityValue)>0)parts.push(`valor registrado ${compactBRL(opportunityValue)}`)
    const opportunityNextAction=field(opportunity,'next_action','nextAction'),opportunityNextActionAt=field(opportunity,'next_action_at','nextActionAt')
    if(clean(opportunityNextAction))parts.push(`próxima ação: ${clean(opportunityNextAction,180)}`)
    if(opportunityNextActionAt)parts.push(`prazo ${dateLabel(opportunityNextActionAt)}`)
    if(clean(opportunity.value_case?.proof_plan))parts.push(`forma de comprovação: ${clean(opportunity.value_case.proof_plan,180)}`)
    items.push(evidence('selected-opportunity',`${parts.join('; ')}.`,'opportunity',opportunity.id||opportunity.external_key||'opportunity:unknown',{observed:field(opportunity,'updated_at','updatedAt','created_at','createdAt'),uncertainty:'O registro mostra avanço administrativo; a prioridade e a prontidão ainda precisam ser confirmadas.'}))
  }

  // A visita concluída é a evidência; a agendada (scheduled_at futuro) vencia pela data e a visita
  // realizada nunca entrava.
  const completedVisits=array(context.visits).filter(item=>/COMPLETED|realizad|conclu/i.test(clean(field(item,'lifecycleStatus','lifecycle_status','status')))||field(item,'completed_at','completedAt','occurred_at','occurredAt'))
  const visit=latest(completedVisits,['occurred_at','occurredAt','completed_at','completedAt','updated_at','updatedAt','created_at','createdAt'])||latest(context.visits,['occurred_at','occurredAt','completed_at','completedAt','updated_at','updatedAt','scheduled_at','scheduledAt','created_at','createdAt'])
  if(visit){
    const visitDate=field(visit,'occurred_at','occurredAt','completed_at','completedAt','scheduled_at','scheduledAt')
    const parts=[`Visita ${firstText(visit.status,'sem status')}${timestamp(visitDate)!==null?` em ${dateLabel(visitDate)}`:''}`]
    if(clean(visit.objective))parts.push(`objetivo: ${clean(visit.objective,160)}`)
    if(clean(visit.summary))parts.push(`resumo: ${clean(visit.summary,190)}`)
    const visitCommitment=field(visit,'next_commitment','nextCommitment'),visitNextActionAt=field(visit,'next_action_at','nextActionAt')
    if(clean(visitCommitment))parts.push(`compromisso: ${clean(visitCommitment,180)}`)
    if(visitNextActionAt)parts.push(`prazo ${dateLabel(visitNextActionAt)}`)
    items.push(evidence('latest-visit',`${parts.join('; ')}.`,'visit',visit.id||'visit:unknown',{observed:field(visit,'occurred_at','occurredAt','completed_at','completedAt','updated_at','updatedAt','scheduled_at','scheduledAt','created_at','createdAt'),uncertainty:'O registro da visita não prova que o compromisso continua prioritário para o produtor.'}))
  }

  // O compromisso aberto é a resposta de 'qual o compromisso pendente?'/'o que ficou pendente?':
  // sem ele na evidência, nenhuma frase sobre o compromisso passa no grounding.
  const openCommitment=latest(array(context.commitments).filter(item=>!/COMPLETED|CANCELLED|REJECTED|DONE|CONCLUID|CANCELAD/i.test(clean(item?.status))),['updated_at','updatedAt','created_at','createdAt'])
  if(openCommitment){
    const description=clean(field(openCommitment,'description','action'),300)
    const due=field(openCommitment,'due_at','dueAt')
    const status=clean(openCommitment.status,40)
    if(description)items.push(evidence('open-commitment',`Compromisso aberto: ${description}${timestamp(due)!==null?`; prazo ${dateLabel(due)}`:''}${status?`; status ${status}`:''}.`,'commitment',field(openCommitment,'commitment_id','commitmentId','id')||'commitment:unknown',{observed:field(openCommitment,'updated_at','updatedAt','created_at','createdAt'),uncertainty:'O compromisso registrado precisa de confirmação do status atual com o produtor.'}))
  }

  const interaction=latest(context.interactions,['occurred_at','occurredAt','created_at','createdAt'])
  if(interaction){
    const parts=[`Interação por ${firstText(interaction.channel,'canal não informado')}`]
    if(clean(interaction.summary))parts.push(clean(interaction.summary,230))
    if(compactObject(interaction.commitments))parts.push(`compromissos: ${compactObject(interaction.commitments)}`)
    items.push(evidence('latest-interaction',`${parts.join('; ')}.`,'interaction',interaction.id||interaction.source_external_id||'interaction:unknown',{observed:field(interaction,'occurred_at','occurredAt','created_at','createdAt'),uncertainty:'O resumo registra a conversa, mas não substitui a confirmação do próximo passo.'}))
  }

  const business=latest(context.businessHistory,['occurred_at','occurredAt','created_at','createdAt'])
  if(business){
    // 'Compra registrada' responde 'o que ele comprou?' (faceta PURCHASE exige compr*/adquir*).
    const outcomeLabel=/^won$/i.test(clean(business.outcome))?'Compra registrada (ganha)':/^lost$/i.test(clean(business.outcome))?'Negócio perdido':`Evento comercial ${firstText(business.outcome,'sem resultado classificado')}`
    const parts=[outcomeLabel]
    if(clean(business.category))parts.push(`categoria ${clean(business.category,100)}`)
    if(clean(business.product))parts.push(`item ${clean(business.product,100)}`)
    if(number(business.value)!==null)parts.push(`valor ${compactBRL(business.value)}`)
    if(clean(business.loss_reason))parts.push(`motivo registrado: ${clean(business.loss_reason,180)}`)
    items.push(evidence('latest-business-event',`${parts.join('; ')}.`,'business_history',business.id||business.external_id||'business:unknown',{observed:field(business,'occurred_at','occurredAt','created_at','createdAt'),uncertainty:'Um evento isolado não demonstra padrão nem causa.'}))
  }

  const seasonRow=flattenSeasons(context.properties)[0]
  if(seasonRow){
    const {property,field,season}=seasonRow
    const parts=[`${firstText(property.name,'Propriedade')} • ${firstText(field.name,'talhão sem nome')} • ${firstText(season.crop,'cultura não informada')} ${firstText(season.season,'')}`.trim()]
    if(number(season.area_ha)!==null)parts.push(`área ${quantity(season.area_ha,'hectares')}`)
    if(number(season.productivity_target)!==null)parts.push(`meta ${quantity(season.productivity_target,season.unit)}`)
    if(number(season.productivity_actual)!==null)parts.push(`realizado ${quantity(season.productivity_actual,season.unit)}`)
    items.push(evidence('latest-crop-season',`${parts.join('; ')}.`,'client_record',season.id||`${property.id||property.external_key||'property'}:${field.id||field.external_key||'field'}:${season.season||season.created_at||'season'}`,{observed:season.harvested_at||season.planted_at||season.created_at,uncertainty:'Meta e realizado descrevem desempenho; não identificam sozinhos a causa da diferença.'}))
  }

  const fieldReport=latest(context.fieldReports,['observed_at','created_at'])
  if(fieldReport){
    const observations=array(fieldReport.observations).slice(0,2).map(item=>[clean(item.observation_type,70),quantity(item.value,item.unit)].filter(Boolean).join(' ')).filter(Boolean)
    const parts=[clean(fieldReport.summary,260)||'Relatório de campo sem resumo textual']
    if(clean(fieldReport.crop_stage))parts.push(`estágio ${clean(fieldReport.crop_stage,80)}`)
    if(observations.length)parts.push(`observações: ${observations.join(' • ')}`)
    parts.push(fieldReport.validated_at?'revisão técnica registrada':'revisão técnica ainda não registrada')
    items.push(evidence('latest-field-report',`${parts.join('; ')}.`,'field_report',fieldReport.id||fieldReport.external_id||'field-report:unknown',{observed:fieldReport.observed_at||fieldReport.created_at,quality:fieldReport.validated_at?'high':'moderate',uncertainty:fieldReport.validated_at?'A validação vale apenas para o escopo registrado.':'Observações de campo não confirmam causa nem autorizam execução.'}))
  }

  const soil=latest(context.soilAnalyses,['sampled_at','created_at'])
  if(soil){
    const measurements=array(soil.measurements).slice(0,3).map(item=>`${clean(item.analyte,45)} ${quantity(item.normalized_value??item.raw_value,item.normalized_unit??item.raw_unit)}`).filter(item=>item.trim())
    const parts=[`Análise de solo coletada em ${dateLabel(soil.sampled_at||soil.created_at)}`]
    if(clean(soil.laboratory))parts.push(`laboratório ${clean(soil.laboratory,100)}`)
    if(clean(soil.method))parts.push(`método ${clean(soil.method,100)}`)
    if(number(soil.depth_from_cm)!==null||number(soil.depth_to_cm)!==null)parts.push(`profundidade ${quantity(soil.depth_from_cm,'cm')} a ${quantity(soil.depth_to_cm,'cm')}`)
    if(measurements.length)parts.push(`medições registradas: ${measurements.join(' • ')}`)
    items.push(evidence('latest-soil-analysis',`${parts.join('; ')}.`,'soil_analysis',soil.id||soil.external_id||'soil:unknown',{observed:soil.sampled_at||soil.created_at,quality:soil.validated_at?'high':'moderate',uncertainty:'Interpretação depende de método, unidade, profundidade, contexto do talhão e revisão técnica.'}))
  }

  const ndvi=latest(context.ndviObservations,['observed_at','created_at'])
  if(ndvi){
    const anomaly=compactObject(ndvi.anomaly)
    const statistics=compactObject(ndvi.statistics)
    const parts=[`${firstText(ndvi.index_name,'Índice de vegetação')} observado em ${dateLabel(ndvi.observed_at)}`]
    if(clean(ndvi.field_external_key))parts.push(`talhão ${clean(ndvi.field_external_key,100)}`)
    if(anomaly)parts.push(`anomalia registrada: ${anomaly}`)
    else if(statistics)parts.push(`estatísticas: ${statistics}`)
    if(number(ndvi.cloud_percent)!==null)parts.push(`nuvens ${quantity(ndvi.cloud_percent,'%')}`)
    items.push(evidence('latest-ndvi',`${parts.join('; ')}.`,'ndvi',ndvi.id||ndvi.external_id||'ndvi:unknown',{observed:ndvi.observed_at||ndvi.created_at,uncertainty:'NDVI serve para triagem e priorização de vistoria; não confirma causa.'}))
  }

  const manual=latest(context.manualRecords,['occurred_at','ingested_at'])
  if(manual){
    const payload=manual.payload||{}
    const title=firstText(payload.title,payload.name,payload.recordType,payload.type,manual.event_type,'registro técnico')
    const contextText=[manual.property_external_key&&`propriedade ${clean(manual.property_external_key,90)}`,manual.field_external_key&&`talhão ${clean(manual.field_external_key,90)}`,payload.status&&`status ${clean(payload.status,70)}`].filter(Boolean).join('; ')
    items.push(evidence('latest-manual-record',`Núcleo técnico registra “${title}”${contextText?`; ${contextText}`:''}.`,'manual_record',manual.id||manual.external_id||'manual:unknown',{observed:manual.occurred_at||manual.ingested_at,uncertainty:'O registro técnico informa contexto; qualquer diagnóstico ou execução continua sujeito ao responsável habilitado.'}))
  }

  const memory=latest(array(context.memories).filter(item=>item?.status==='verified'),['valid_from'])||latest(context.memories,['valid_from'])
  if(memory){
    const value=compactObject(memory.value)
    items.push(evidence('latest-memory',`Memória ${memory.status==='verified'?'verificada':'proposta'} “${clean(memory.key||memory.memory_type||'contexto',100)}”${value?`: ${value}`:''}.`,memory.status==='verified'?'client_record':'unknown',memory.id||`memory:${memory.key||'unknown'}`,{observed:memory.valid_from,direct:memory.status==='verified',quality:memory.status==='verified'?'moderate':'low',uncertainty:memory.status==='verified'?'A memória tem fonte registrada, mas pode expirar ou mudar com o contexto.':'Memória proposta deve virar pergunta; não pode sustentar uma conclusão.'}))
  }

  const prior=latest(context.priorRecommendations,['created_at'])
  if(prior){
    const parts=[`A VAL recomendou: ${clean(prior.next_best_action||prior.user_question||'ação não resumida',240)}`]
    if(prior.methodology_state?.current_stage)parts.push(`etapa ${clean(prior.methodology_state.current_stage,50)}`)
    if(prior.feedback?.outcome)parts.push(`resultado ${clean(prior.feedback.outcome,60)}`)
    else parts.push('resultado ainda não registrado')
    items.push(evidence('prior-val-recommendation',`${parts.join('; ')}.`,'interaction',prior.id||'val-recommendation:unknown',{observed:prior.created_at,direct:false,quality:prior.feedback?'moderate':'low',uncertainty:prior.feedback?'O feedback descreve uso, não prova valor realizado.':'Sem retorno, o sistema não sabe se a orientação foi útil, ajustada ou descartada.'}))
  }

  const signal=latest(context.signals,['created_at'])
  if(signal)items.push(evidence('latest-agronomic-signal',`Sinal registrado: ${clean(signal.title||signal.signal_type||'sinal técnico',220)}; severidade ${clean(signal.severity||'não informada',50)}.`,'unknown',signal.id||signal.source_event_id||'signal:unknown',{observed:signal.created_at,direct:false,quality:'low',uncertainty:'O sinal abre investigação; não confirma causa, diagnóstico ou ação.'}))

  const attachment=latest([...array(context.attachments),...array(context.currentAttachments)].filter(item=>clean(item.analysis?.summary)||clean(item.analysis?.fieldPhoto?.notes)),['confirmedAt','createdAt'])
  if(attachment){
    const fieldPhoto=attachment.analysis?.fieldPhoto||{}
    const parts=[`Arquivo “${clean(attachment.originalName||'sem nome',160)}”`]
    if(clean(fieldPhoto.label))parts.push(clean(fieldPhoto.label,140))
    if(clean(attachment.analysis?.summary))parts.push(clean(attachment.analysis.summary,260))
    else if(clean(fieldPhoto.notes))parts.push(clean(fieldPhoto.notes,220))
    items.push(evidence('latest-confirmed-attachment',`${parts.join('; ')}.`,'consultant_attachment',attachment.id||'attachment:unknown',{observed:fieldPhoto.observedAt||attachment.confirmedAt||attachment.createdAt,direct:attachment.status==='confirmed',quality:attachment.status==='confirmed'?'moderate':'low',uncertainty:attachment.status==='confirmed'?'A confirmação valida a leitura registrada, não estabelece diagnóstico ou causalidade.':'A leitura ainda precisa de confirmação humana antes de sustentar uma conclusão.'}))
  }

  return uniqueById(items).slice(0,15)
}

function addSignal(signals,signal){
  if(!signal?.evidence_ids?.length)return
  signals.push({...signal,title:words(signal.title,14),insight:clean(signal.insight,620),decision:clean(signal.decision,300),action:clean(signal.action,340),question:clean(signal.question,320),do_not_do:clean(signal.do_not_do,300),missing_data:array(signal.missing_data).map(item=>clean(item,120)).filter(Boolean).slice(0,3),evidence_ids:[...new Set(signal.evidence_ids)].slice(0,5)})
}

function buildSignals(context,evidenceItems,now){
  const signals=[]
  const client=context.client||{}
  const metrics=commercialMetrics(client)
  const evidenceIds=new Set(evidenceItems.map(item=>item.id))
  const has=id=>evidenceIds.has(id)
  const opportunity=latest(array(context.opportunities).filter(item=>lower(item.stage)!=='fechado'),['next_action_at','nextActionAt','updated_at','updatedAt','created_at','createdAt'])||latest(context.opportunities,['updated_at','updatedAt','created_at','createdAt'])
  const visit=latest(context.visits,['occurred_at','occurredAt','completed_at','completedAt','updated_at','updatedAt','scheduled_at','scheduledAt','created_at','createdAt'])
  const interaction=latest(context.interactions,['occurred_at','occurredAt','created_at','createdAt'])
  const business=latest(context.businessHistory,['occurred_at','occurredAt','created_at','createdAt'])
  const commercialMarkers=[interaction&&{id:'latest-interaction',at:field(interaction,'occurred_at','occurredAt','created_at','createdAt')},visit&&{id:'latest-visit',at:field(visit,'occurred_at','occurredAt','completed_at','completedAt','updated_at','updatedAt','scheduled_at','scheduledAt','created_at','createdAt')},business&&{id:'latest-business-event',at:field(business,'occurred_at','occurredAt','created_at','createdAt')},opportunity&&{id:'selected-opportunity',at:field(opportunity,'updated_at','updatedAt','created_at','createdAt')}].filter(Boolean)
  const latestCommercial=commercialMarkers.sort((a,b)=>(timestamp(b.at)||0)-(timestamp(a.at)||0))[0]
  const technicalMarkers=[
    context.fieldReports?.[0]&&{id:'latest-field-report',at:latest(context.fieldReports,['observed_at','created_at'])?.observed_at||latest(context.fieldReports,['observed_at','created_at'])?.created_at,label:'relatório de campo'},
    context.soilAnalyses?.[0]&&{id:'latest-soil-analysis',at:latest(context.soilAnalyses,['sampled_at','created_at'])?.sampled_at||latest(context.soilAnalyses,['sampled_at','created_at'])?.created_at,label:'análise de solo'},
    context.ndviObservations?.[0]&&{id:'latest-ndvi',at:latest(context.ndviObservations,['observed_at','created_at'])?.observed_at,label:'NDVI'},
    context.manualRecords?.[0]&&{id:'latest-manual-record',at:latest(context.manualRecords,['occurred_at','ingested_at'])?.occurred_at||latest(context.manualRecords,['occurred_at','ingested_at'])?.ingested_at,label:'registro técnico'},
    evidenceItems.some(item=>item.id==='latest-confirmed-attachment')&&{id:'latest-confirmed-attachment',at:evidenceById(evidenceItems,'latest-confirmed-attachment')?.observed_at,label:'arquivo confirmado'}
  ].filter(item=>item&&has(item.id)).sort((a,b)=>(timestamp(b.at)||0)-(timestamp(a.at)||0))
  const latestTechnical=technicalMarkers[0]

  const commitments=[
    field(visit,'next_action_at','nextActionAt')&&{id:'latest-visit',at:field(visit,'next_action_at','nextActionAt'),description:firstText(field(visit,'next_commitment','nextCommitment'),visit.objective,'compromisso da visita'),status:visit.status},
    field(opportunity,'next_action_at','nextActionAt')&&{id:'selected-opportunity',at:field(opportunity,'next_action_at','nextActionAt'),description:firstText(field(opportunity,'next_action','nextAction'),opportunity.title,'próxima ação da oportunidade'),status:opportunity.stage}
  ].filter(item=>item&&timestamp(item.at)!==null&&timestamp(item.at)<now&&!/(conclu|realiz|cancel|fechado)/i.test(clean(item.status)))
  if(commitments.length){
    const overdue=commitments.sort((a,b)=>timestamp(a.at)-timestamp(b.at))[0]
    const days=Math.max(1,Math.floor((now-timestamp(overdue.at))/DAY))
    addSignal(signals,{id:'overdue-commitment',kind:'overdue_commitment',score:98,priority:'immediate',title:'Compromisso vencido virou o principal risco comercial',insight:`“${overdue.description}” está vencido há ${days} dia${days===1?'':'s'} sem conclusão registrada. O risco mais concreto agora não é perder a venda; é continuar planejando sobre um compromisso que talvez já não seja real.`,decision:'Descobrir se existe um bloqueio operacional, uma mudança de prioridade ou um compromisso que nunca foi firme.',action:`Retomar “${overdue.description}” pelo canal mais recente, registrar o bloqueio literal e combinar responsável e novo prazo somente se ainda fizer sentido.`,question:`O que impediu “${overdue.description}” desde ${dateLabel(overdue.at)} — e qual próximo passo ainda é realista?`,do_not_do:'Não apresentar uma nova proposta antes de entender por que o compromisso anterior parou.',missing_data:['causa do atraso','prioridade atual','responsável e prazo realistas'],deadline:'Hoje',evidence_ids:[overdue.id,latestCommercial?.id].filter((id,index,list)=>id&&list.indexOf(id)===index)})
  }

  if(latestTechnical&&(!latestCommercial||((timestamp(latestTechnical.at)||0)>(timestamp(latestCommercial.at)||0)))){
    const evidenceIds=[latestTechnical.id,latestCommercial?.id||'latest-crop-season'].filter(id=>has(id))
    addSignal(signals,{id:'technical-after-contact',kind:'technical_without_followup',score:91,priority:'high',title:'O campo mudou depois da última conversa comercial',insight:`O ${latestTechnical.label} é mais recente que o último contato comercial encontrado. Isso cria uma janela de decisão invisível no CRM: o contexto técnico pode ter mudado, mas ainda não há registro de como essa mudança afetou prioridade, orçamento ou calendário.`,decision:'Separar um fato técnico relevante de um sinal sem consequência comercial.',action:`Abrir o ${latestTechnical.label} junto com o último contato, perguntar qual decisão ele alterou e registrar a resposta antes de falar em produto ou preço.`,question:`Esse ${latestTechnical.label} mudou alguma decisão desta safra? Qual e por quê?`,do_not_do:'Não converter o sinal técnico em diagnóstico, prescrição ou argumento de venda.',missing_data:['decisão afetada','momento da decisão','relevância confirmada pelo produtor'],deadline:'Antes do próximo contato',evidence_ids:evidenceIds})
  }

  const declaredNoAdditionalNeed=client.additionalNeedStatus==='none_declared'
  if(!declaredNoAdditionalNeed&&metrics.openPotentialKnown&&metrics.openPotential>0&&(!metrics.pipelineKnown||metrics.openPipeline/metrics.openPotential<.15)){
    const ratio=metrics.pipelineKnown&&metrics.openPotential?Math.round(metrics.openPipeline/metrics.openPotential*100):null
    addSignal(signals,{id:'potential-pipeline-gap',kind:'potential_pipeline_gap',score:82,priority:'high',title:'O espaço na conta ainda não virou uma decisão concreta',insight:`Há ${compactBRL(metrics.openPotential)} de potencial em aberto, enquanto o pipeline ${metrics.pipelineKnown?`cobre apenas ${ratio}% desse espaço`:'ainda não está mensurado'}. A conexão importante não é “há muito para vender”; é que potencial e decisão estão vivendo em camadas diferentes do sistema.`,decision:'Descobrir qual parte do potencial tem decisão, janela e problema reais — e qual parte é apenas estimativa cadastral.',action:`Escolher uma única categoria do potencial em aberto, confirmar decisão, janela e situação atual, e só então criar ou atualizar a oportunidade correspondente.`,question:`Dos ${compactBRL(metrics.openPotential)} em aberto, qual categoria terá uma decisão nesta safra — e o que dispara essa decisão?`,do_not_do:'Não tratar potencial em aberto como probabilidade de fechamento nem abrir várias oportunidades sem uma decisão nomeada.',missing_data:['categoria com decisão real','janela da decisão','situação que dispara a compra'],deadline:'No próximo contato',evidence_ids:['commercial-context',has('selected-opportunity')?'selected-opportunity':latestCommercial?.id].filter(id=>id&&has(id))})
  }

  const proofPreference=[profileAnswer(client,context.profile,'technicalPresentation',8),profileAnswer(client,context.profile,'trustDriver',14)].filter(Boolean).join(' + ')
  if(proofPreference&&opportunity&&!clean(opportunity.value_case?.proof_plan)&&!array(opportunity.evidence).length){
    const opportunityTitle=firstText(opportunity.title,'a oportunidade')
    addSignal(signals,{id:'proof-gap',kind:'proof_gap',score:88,priority:'high',title:'A oportunidade avançou sem a prova que o produtor exige',insight:`O perfil pede “${proofPreference}”, mas “${opportunityTitle}” não tem forma de comprovação registrada. O provável gargalo não é falta de argumento; é falta de um desenho de prova compatível com a decisão.`,decision:'Confirmar se o formato de prova é o bloqueio real ou se existe outro decisor ou critério ainda ausente.',action:`Antes de revisar preço, desenhar com o produtor uma comparação simples para “${opportunityTitle}”, com métrica, fonte, horizonte e responsável pela validação.`,question:`Para avaliar “${opportunityTitle}”, o que você precisa ver medido e em qual formato?`,do_not_do:'Não empilhar benefícios nem presumir que uma apresentação técnica genérica cria segurança.',missing_data:['métrica que decide','formato da comparação','quem valida o resultado'],deadline:'Antes de apresentar ou revisar a proposta',evidence_ids:['profile-proof-preference','selected-opportunity'].filter(has)})
  }

  const seasonRow=flattenSeasons(context.properties)[0]
  const target=number(seasonRow?.season?.productivity_target)
  const actual=number(seasonRow?.season?.productivity_actual)
  if(target!==null&&actual!==null&&target>0&&actual<target){
    const gap=target-actual
    const label=[clean(seasonRow.field?.name,80),clean(seasonRow.season?.crop,60),clean(seasonRow.season?.season,60)].filter(Boolean).join(' • ')||'safra registrada'
    addSignal(signals,{id:'productivity-gap',kind:'productivity_gap',score:86,priority:'high',title:'A diferença entre meta e realizado ainda não virou aprendizado',insight:`Em ${label}, a meta foi ${quantity(target,seasonRow.season.unit)} e o realizado ${quantity(actual,seasonRow.season.unit)} — diferença de ${quantity(gap,seasonRow.season.unit)}. O dado só ganha valor comercial quando for ligado à decisão que ele mudou, não quando for usado para adivinhar uma causa.`,decision:'Entender qual decisão futura foi afetada pela diferença e qual evidência é necessária para comparar alternativas.',action:`Revisar a diferença de ${quantity(gap,seasonRow.season.unit)} com o produtor, registrar a explicação dele e encaminhar qualquer causa técnica para validação habilitada.`,question:`Essa diferença de ${quantity(gap,seasonRow.season.unit)} mudou qual decisão para a próxima safra?`,do_not_do:'Não atribuir causa agronômica nem sugerir execução apenas pela diferença entre meta e realizado.',missing_data:['decisão afetada','explicação do produtor','causa tecnicamente validada'],deadline:'Na revisão da safra ou antes do próximo planejamento',evidence_ids:['latest-crop-season',has('latest-field-report')?'latest-field-report':latestCommercial?.id].filter(id=>id&&has(id))})
  }

  if(opportunity&&!clean(field(opportunity,'next_action','nextAction'))&&!field(opportunity,'next_action_at','nextActionAt')){
    const opportunityTitle=firstText(opportunity.title,'a oportunidade')
    addSignal(signals,{id:'opportunity-without-next-action',kind:'opportunity_without_next_action',score:76,priority:'medium',title:'A oportunidade existe, mas não há movimento verificável',insight:`“${opportunityTitle}” tem etapa registrada, porém não tem próxima ação nem data. Sem movimento verificável, o estágio pode estar descrevendo expectativa interna, não avanço da decisão do produtor.`,decision:'Confirmar se existe um próximo passo bilateral ou se a oportunidade deve voltar à descoberta.',action:`Reabrir “${opportunityTitle}” pelo último contexto registrado e salvar ação, responsável, prazo e evidência — ou recuar a etapa.`,question:`Qual decisão concreta ainda precisa acontecer em “${opportunityTitle}”, por quem e até quando?`,do_not_do:'Não manter a oportunidade avançada apenas porque já recebeu uma etapa no pipeline.',missing_data:['próxima decisão','responsável','prazo'],deadline:'Antes da próxima revisão do pipeline',evidence_ids:['selected-opportunity',latestCommercial?.id].filter(id=>id&&has(id))})
  }

  const losses=array(context.businessHistory).filter(item=>lower(item.outcome)==='lost'&&clean(item.loss_reason))
  const lossGroups=new Map()
  for(const item of losses){const key=lower(item.loss_reason);const current=lossGroups.get(key)||[];current.push(item);lossGroups.set(key,current)}
  const repeated=[...lossGroups.entries()].sort((a,b)=>b[1].length-a[1].length)[0]
  if(repeated?.[1]?.length>=2){
    const reason=clean(repeated[1][0].loss_reason,160)
    addSignal(signals,{id:'repeated-loss-reason',kind:'business_loss_pattern',score:74,priority:'medium',title:'Perdas diferentes apontam o mesmo freio de decisão',insight:`O motivo “${reason}” aparece em ${repeated[1].length} perdas registradas. Isso não prova a causa, mas é forte o bastante para testar se a abordagem atual chega tarde, com prova inadequada ou com o decisor errado.`,decision:'Descobrir se o motivo registrado ainda é atual e em qual ponto da conversa ele nasce.',action:`Comparar as ${repeated[1].length} perdas, localizar o primeiro momento em que “${reason}” apareceu e testar uma mudança pequena na próxima conversa.`,question:`Em que momento “${reason}” passou a bloquear a decisão — e o que teria permitido continuar?`,do_not_do:'Não transformar o motivo de perda em traço de personalidade do produtor.',missing_data:['momento em que o bloqueio surgiu','critério não atendido','mudança testável'],deadline:'Antes da próxima oportunidade semelhante',evidence_ids:['latest-business-event',has('selected-opportunity')?'selected-opportunity':latestCommercial?.id].filter(id=>id&&has(id))})
  }

  const prior=latest(context.priorRecommendations,['created_at'])
  if(prior&&!prior.feedback){
    addSignal(signals,{id:'unclosed-learning-loop',kind:'unclosed_learning_loop',score:70,priority:'medium',title:'A VAL orientou, mas ainda não aprendeu o resultado',insight:`A última orientação — “${clean(prior.next_best_action||prior.user_question||'ação não resumida',180)}” — não tem retorno registrado. Gerar outra resposta agora pode repetir a mesma lógica sem saber se ela funcionou, foi ajustada ou nem chegou a ser usada.`,decision:'Fechar o ciclo anterior antes de acumular novas recomendações desconectadas da realidade.',action:'Registrar em uma frase se a orientação anterior foi usada, ajustada ou descartada e qual resultado observável apareceu.',question:'A última orientação foi usada, ajustada ou descartada — e o que aconteceu depois?',do_not_do:'Não tratar volume de recomendações como aprendizado da VAL.',missing_data:['uso da recomendação','ajuste feito pelo consultor','resultado observado'],deadline:'Antes de encerrar esta análise',evidence_ids:['prior-val-recommendation',latestCommercial?.id].filter(id=>id&&has(id))})
  }

  if(!signals.length&&evidenceItems.length){
    const ids=evidenceItems.slice(0,2).map(item=>item.id)
    addSignal(signals,{id:'insufficient-decision-link',kind:'insufficient_decision_link',score:35,priority:'low',title:'Há dados, mas falta a ligação com uma decisão',insight:'O dossiê contém fatos, porém nenhum cruzamento atual sustenta uma prioridade sem inventar causalidade. A resposta mais inteligente agora é descobrir qual decisão da safra esses fatos realmente alteram.',decision:'Nomear uma decisão real antes de transformar cadastro em oportunidade.',action:'Escolher o fato mais recente do dossiê e perguntar qual decisão ele mudou, registrando a resposta literal.',question:'Qual decisão desta safra mudou desde o último registro — e o que provocou a mudança?',do_not_do:'Não preencher o vazio com uma recomendação reutilizável para qualquer produtor.',missing_data:['decisão atual','mudança que a provocou','prazo da decisão'],deadline:'No próximo contato',evidence_ids:ids})
  }

  return signals.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'pt-BR')).slice(0,8)
}

export function buildDecisionIntelligence(context={},now=Date.now()){
  const evidenceItems=buildEvidence(context)
  const signals=buildSignals(context,evidenceItems,now)
  const coverage={
    questionnaire:Object.keys(context.profile?.answers||{}).length,
    business:array(context.businessHistory).length,
    visits:array(context.visits).length,
    interactions:array(context.interactions).length,
    opportunities:array(context.opportunities).length,
    properties:array(context.properties).length,
    fieldReports:array(context.fieldReports).length,
    soil:array(context.soilAnalyses).length,
    ndvi:array(context.ndviObservations).length,
    manual:array(context.manualRecords).length,
    memories:array(context.memories).length,
    priorRecommendations:array(context.priorRecommendations).length,
    attachments:array(context.attachments).length+array(context.currentAttachments).length
  }
  return {version:'val-nexo-v1',generated_at:new Date(now).toISOString(),coverage,evidence:evidenceItems,signals,top_signal_id:signals[0]?.id||'',cross_source_ready:signals.some(signal=>new Set(signal.evidence_ids.map(id=>evidenceById(evidenceItems,id)?.source_type).filter(Boolean)).size>=2)}
}

function hypothesesFor(signal){
  const ids=signal.evidence_ids||[]
  const common={supporting_evidence_ids:ids,contradicting_evidence_ids:[]}
  const map={
    overdue_commitment:[
      {label:'Bloqueio operacional',explanation:'O compromisso continua relevante, mas depende de informação, pessoa ou prazo que não foi resolvido.',falsifier:'O produtor informa que a prioridade deixou de existir.',validation_move:'Perguntar o impedimento primeiro; só depois negociar responsável e novo prazo.'},
      {label:'Prioridade deslocada',explanation:'O compromisso foi aceito na conversa, mas outra decisão ganhou prioridade ou o acordo nunca foi firme.',falsifier:'O produtor confirma urgência e apresenta um bloqueio operacional específico.',validation_move:'Pedir que o produtor reordene a prioridade e escolha se quer manter, mudar ou encerrar o compromisso.'}
    ],
    technical_without_followup:[
      {label:'O contexto técnico mudou a decisão',explanation:'O registro mais recente alterou risco, janela ou necessidade de prova, mas isso ainda não chegou ao histórico comercial.',falsifier:'O produtor diz que o registro não muda nenhuma decisão atual.',validation_move:'Perguntar qual decisão mudou, sem sugerir causa ou produto.'},
      {label:'O sinal é tecnicamente relevante, mas comercialmente neutro',explanation:'O novo dado merece acompanhamento técnico, porém não altera prioridade, orçamento ou calendário.',falsifier:'O produtor conecta o sinal a uma decisão e a um prazo concretos.',validation_move:'Confirmar impacto decisório antes de abrir ou avançar oportunidade.'}
    ],
    potential_pipeline_gap:[
      {label:'Demanda real ainda não traduzida',explanation:'Parte do potencial corresponde a uma decisão próxima, mas a conversa não a transformou em oportunidade com janela e próximo passo.',falsifier:'Nenhuma categoria do potencial tem decisão nesta safra.',validation_move:'Escolher uma categoria e confirmar decisão, prazo e situação atual.'},
      {label:'Potencial cadastral superestimado ou desatualizado',explanation:'O valor em aberto pode representar capacidade teórica, categorias fora de escopo ou um mapa de compras antigo.',falsifier:'O produtor reconfirma categoria, volume e janela atuais.',validation_move:'Revalidar a composição do potencial antes de estimar cobertura.'}
    ],
    proof_gap:[
      {label:'A prova é o gargalo',explanation:'A oportunidade não avança porque o produtor ainda não vê a comparação no formato que considera confiável.',falsifier:'Ele aceita o formato de prova e aponta outro bloqueio.',validation_move:'Co-criar métrica, fonte, horizonte e responsável pela validação.'},
      {label:'O bloqueio está em outro decisor ou critério',explanation:'A ausência de prova pode ser apenas um sintoma; preço, participante ou prioridade pode estar travando a decisão.',falsifier:'Todos os participantes e critérios estão alinhados, restando apenas a comprovação.',validation_move:'Perguntar quem ainda precisa validar e o que falta para essa pessoa decidir.'}
    ],
    productivity_gap:[
      {label:'A diferença mudou o plano seguinte',explanation:'Meta e realizado abriram uma decisão concreta sobre prioridade, investimento ou forma de comprovação na próxima safra.',falsifier:'O produtor diz que o resultado não altera nenhuma decisão futura.',validation_move:'Pedir a decisão afetada e a explicação do produtor; encaminhar causa técnica para revisão.'},
      {label:'A diferença é conhecida, mas ainda sem consequência decisória',explanation:'O resultado pode estar dentro da variabilidade esperada ou já ter sido absorvido no planejamento.',falsifier:'Existe mudança de orçamento, calendário ou prática diretamente ligada ao resultado.',validation_move:'Separar o número observado da consequência que ainda precisa ser confirmada.'}
    ],
    opportunity_without_next_action:[
      {label:'Avanço sem operacionalização',explanation:'Há interesse real, mas ninguém converteu a decisão em ação, responsável e prazo.',falsifier:'O produtor não reconhece a oportunidade como prioridade.',validation_move:'Definir o próximo movimento bilateral ou recuar a etapa.'},
      {label:'Estágio administrativo inflado',explanation:'A oportunidade parece avançada no pipeline, mas ainda está em descoberta na cabeça do produtor.',falsifier:'Há compromisso bilateral recente e verificável.',validation_move:'Comparar a etapa registrada com a última evidência de decisão.'}
    ],
    business_loss_pattern:[
      {label:'Padrão real da abordagem',explanation:'O mesmo bloqueio surge repetidamente porque a conversa chega tarde, sem prova adequada ou sem o decisor certo.',falsifier:'As perdas têm contextos e momentos incompatíveis entre si.',validation_move:'Comparar quando o motivo apareceu em cada perda e testar uma única mudança.'},
      {label:'Rótulo de perda genérico',explanation:'O motivo repetido pode ser uma classificação conveniente que esconde causas diferentes.',falsifier:'Os registros mostram a mesma sequência e o mesmo critério não atendido.',validation_move:'Reabrir duas perdas e registrar o primeiro evento observável que travou cada uma.'}
    ],
    unclosed_learning_loop:[
      {label:'A orientação foi útil, mas o resultado não foi registrado',explanation:'O consultor usou ou adaptou a recomendação, porém o feedback ficou fora do sistema.',falsifier:'A orientação não foi usada.',validation_move:'Registrar uso, ajuste e resultado em uma frase.'},
      {label:'A orientação não encaixou na realidade',explanation:'Ela pode ter sido genérica, inoportuna ou inviável e por isso não gerou ação.',falsifier:'Há execução e resultado observável.',validation_move:'Registrar o motivo do descarte para alterar a próxima recomendação.'}
    ],
    insufficient_decision_link:[
      {label:'Existe uma decisão não registrada',explanation:'Os dados estão presentes, mas a conversa mais recente que daria sentido a eles ficou fora do sistema.',falsifier:'O produtor confirma que nenhuma decisão mudou.',validation_move:'Perguntar qual decisão mudou e registrar as palavras exatas.'},
      {label:'Ainda não existe uma decisão ativa',explanation:'O dossiê está correto, mas não há motivo legítimo para transformar contexto em ação comercial agora.',falsifier:'Surge uma mudança com prazo e consequência claros.',validation_move:'Confirmar ausência de mudança e manter acompanhamento sem criar necessidade.'}
    ]
  }
  return (map[signal.kind]||map.insufficient_decision_link).map(item=>({...item,...common}))
}

export function buildStrategicSynthesis(intelligence={},context={}){
  const signals=array(intelligence.signals)
  const top=signals.find(item=>item.id===intelligence.top_signal_id)||signals[0]||{
    id:'no-signal',kind:'insufficient_decision_link',title:'Ainda não há conexão suficiente para orientar avanço',insight:'Os dados disponíveis não sustentam uma conexão específica sem inventar causalidade.',decision:'Descobrir qual decisão atual merece atenção.',action:'Registrar a mudança e a decisão afetada.',question:'Qual decisão desta safra mudou desde o último contato?',do_not_do:'Não preencher lacunas com uma resposta pronta.',missing_data:['decisão atual'],evidence_ids:[]
  }
  const connectionSignals=signals.filter(signal=>signal.evidence_ids?.length>=2).slice(0,4)
  const connections=(connectionSignals.length?connectionSignals:[top]).map(signal=>({title:signal.title,insight:signal.insight,evidence_ids:signal.evidence_ids||[],why_it_matters:signal.decision}))
  const hypotheses=hypothesesFor(top)
  return {
    moment:top.title,
    non_obvious_connection:top.insight,
    decision_at_stake:top.decision,
    leverage_point:top.action,
    do_not_do:top.do_not_do,
    cross_source_connections:connections,
    competing_hypotheses:hypotheses,
    highest_value_unknown:{question:top.question,why_it_matters:`A resposta separa “${hypotheses[0]?.label||'uma explicação'}” de “${hypotheses[1]?.label||'outra explicação'}” e muda o próximo passo.`,how_to_get:'Faça uma pergunta, escute sem oferecer a resposta e registre as palavras do produtor ou o resultado observado.',evidence_ids:top.evidence_ids||[]},
    learning_loop:{record:`Resposta literal à pergunta “${top.question}”, decisão afetada, responsável, prazo e resultado observado.`,success_signal:'A próxima ação passa a ter decisão, responsável, prazo e evidência verificáveis.',failure_signal:'A pergunta não muda entendimento, não produz decisão ou revela que a prioridade não existe.',next_update:`Ao receber o retorno, reordenar os sinais do VAL NEXO e registrar se “${top.title}” foi confirmado, refutado ou substituído.`}
  }
}

const questionStage=stage=>stage==='dimensionar'?'implicação':stage==='construir_valor'||stage==='propor'?'necessidade':stage==='comprometer'?'compromisso':stage==='descobrir'?'problema':'situação'

export function buildNexoFallback(intelligence={},context={},methodologyStage='descobrir'){
  const synthesis=buildStrategicSynthesis(intelligence,context)
  const top=array(intelligence.signals).find(item=>item.id===intelligence.top_signal_id)||array(intelligence.signals)[0]
  if(!top)return {strategic_synthesis:synthesis}
  const clientName=clean(context.client?.name,120).split(/\s+/)[0]||'este produtor'
  const evidenceMap=new Map(array(intelligence.evidence).map(item=>[item.id,item]))
  const basis=(top.evidence_ids||[]).map(id=>evidenceMap.get(id)).filter(Boolean).slice(0,3).map(item=>`${item.claim_supported} → ${top.decision}`)
  const priority=top.priority==='immediate'?'imediata':top.priority==='high'?'esta_semana':top.priority==='low'?'acompanhar':'esta_semana'
  const nextQuestion={stage:questionStage(methodologyStage),type:'aberta',question:top.question,ask_when:'Depois de apresentar somente o fato observado, sem sugerir uma resposta.',purpose:'Distinguir as explicações concorrentes e escolher o próximo passo com menor risco de erro.',evidence_needed:top.missing_data?.join(', ')||'Resposta literal e decisão afetada.',grounding_ids:(top.evidence_ids||[]).slice(0,5)}
  return {
    strategic_synthesis:synthesis,
    answer:`${clientName}: ${top.insight} Não avance sobre uma única explicação. Faça esta pergunta: ${top.question} Use a resposta para confirmar ou derrubar as hipóteses antes do próximo passo.`,
    objective:top.decision,
    executive_brief:{priority,headline:top.title,reason:`${top.insight} Incerteza principal: ${top.missing_data?.[0]||'a decisão atual ainda precisa ser confirmada'}.`,action:top.action,deadline:top.deadline||'No próximo contato',question:top.question,decision_basis:basis,evidence_ids:(top.evidence_ids||[]).slice(0,3),missing_data:(top.missing_data||[]).slice(0,3)},
    next_best_action:top.action,
    next_question:nextQuestion
  }
}

export function isGenericValText(value=''){
  return /(?:conduzir uma conversa breve|explorar oportunidades|fortalecer (?:o )?relacionamento|gerar valor|entender melhor (?:a|o) situa[cç][aã]o|fazer a pergunta principal e registrar|identificar necessidades e apresentar solu[cç][oõ]es)/i.test(String(value))
}

const decisionClosed=value=>/^(fechado|ganho|perdido|cancelado|cancelada|concluido|concluida|closed|won|lost|cancelled|canceled|completed|done|rejected|archived)$/i.test(clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,''))
const recordedNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null
const decisionDate=item=>field(item,'observed_at','occurred_at','updated_at','updatedAt','created_at','createdAt')
const stableRecordSort=(a,b)=>String(a.id||a.external_id||'').localeCompare(String(b.id||b.external_id||''),'en')

/** One governed card from the existing NEXO facts. Scores are prioritization
 * weights, never purchase probabilities, causal estimates or prescriptions. */
export function buildNextBestAction(context={}, {now=Date.now(),policy=SCORING_POLICIES['val.decision-scoring.v1']}={}){
 if(!SCORING_POLICIES[policy?.version])throw new Error('decision_policy_unknown')
 const client=context.client||{},producerId=String(client.id||'')
 if(!producerId)throw new Error('decision_producer_required')
 const opportunities=array(context.opportunities).filter(item=>!decisionClosed(item.stage)&&!decisionClosed(item.status)&&!array(item.evidence).some(e=>e.type==='opportunity_workspace_v1'&&decisionClosed(e.status))).sort(stableRecordSort)
 const commitments=array(context.commitments).filter(item=>!decisionClosed(item.status)).sort(stableRecordSort)
 const visits=array(context.visits).filter(item=>!decisionClosed(item.status)&&!decisionClosed(item.lifecycle_status||item.lifecycleStatus)).sort(stableRecordSort)
 const nexo=buildDecisionIntelligence({...context,memories:[],opportunities,commitments,visits},now)
 const metrics=commercialMetrics(client),facts=[],missing=[],reviews=[],penalties=[]
 const dimensions=Object.fromEntries(Object.keys(policy.weights).map(key=>[key,{state:'NO_DATA',points:0,weight:policy.weights[key],evidence_refs:[]}]))
 const add=(id,claim,type,record={},options={})=>{
  const observed=options.observed??decisionDate(record),time=timestamp(observed)
  const days=time===null?null:(now-time)/DAY
  const stale=days!==null&&days>(options.technical?policy.technicalFreshDays:policy.freshDays)
  const ref={id,claim_supported:clean(claim,700),source_type:type,source_id:String(record.id||record.external_id||id),observed_at:time===null?null:new Date(time).toISOString(),freshness:time===null?'UNKNOWN':time>now+300000?'FUTURE':stale?'STALE':'CURRENT',quality:options.quality||'RECORDED',...options.provenance}
  const existing=nexo.evidence.find(e=>e.source_id===ref.source_id&&e.source_type===type)||(type==='commercial_record'?nexo.evidence.find(e=>e.id==='commercial-context'):null)
  if(existing&&!id.includes('-deadline:')){ref.claim_supported=existing.claim_supported;ref.engine_evidence_ref=existing.id}
  if(ref.freshness==='FUTURE')reviews.push('INCOMPATIBLE_DATE')
  facts.push(ref);return ref
 }
 const contribute=(dimension,strength,ref)=>{
  const d=dimensions[dimension],factor=ref.freshness==='FUTURE'?0:ref.freshness==='STALE'?policy.staleFactor:1
  const points=Math.round(d.weight*Math.min(1,Math.max(0,strength))*factor*100)/100
  if(points>d.points){d.points=points;d.evidence_refs=[ref.id]}
  d.state=d.points?'POSITIVE_SIGNAL':'RECORDED_NEUTRAL'
  if(factor<1)penalties.push({dimension,reason:ref.freshness,points:Math.round(d.weight*strength*(1-factor)*100)/100,evidence_ref:ref.id})
 }
 const unknown=(key,question,reason)=>missing.push({key,classification:'MATERIAL_MISSING_INFORMATION',state:'NO_DATA',question,reason})
 let commercial=null
 if(metrics.openPotentialKnown||metrics.currentKnown||metrics.pipelineKnown){
  commercial=add(`commercial:${producerId}`,`Potencial aberto ${compactBRL(metrics.openPotential,{known:metrics.openPotentialKnown})}; compras ${compactBRL(metrics.currentPurchases,{known:metrics.currentKnown})}; pipeline ${compactBRL(metrics.openPipeline,{known:metrics.pipelineKnown})}${metrics.shareKnown?`; share realizado ${metrics.realizedShare.toFixed(1)}%`:''}.`,'commercial_record',{id:producerId},{observed:client.commercial?.lastBusinessAt||client.updatedAt||client.updated_at})
  if(metrics.openPotentialKnown)contribute('COMMERCIAL_VALUE',Math.min(1,metrics.openPotential/policy.commercialSaturation),commercial)
 }
 const ranked=opportunities.map(item=>({item,due:timestamp(field(item,'next_action_at','nextActionAt')),value:recordedNumber(field(item,'estimated_value','estimatedValue','value'))})).sort((a,b)=>(a.due??Infinity)-(b.due??Infinity)||(b.value??0)-(a.value??0)||stableRecordSort(a.item,b.item))
 const opportunity=ranked[0]?.item||null
 let opportunityRef=null
 if(opportunity){
  const value=ranked[0].value
  opportunityRef=add(`opportunity:${opportunity.id}`,`Oportunidade “${clean(opportunity.title,160)}”, etapa ${clean(opportunity.stage)||'não informada'}${value===null?'':`, valor registrado ${compactBRL(value)}`}${field(opportunity,'next_action','nextAction')?`; próximo passo: ${clean(field(opportunity,'next_action','nextAction'))}`:''}.`,'opportunity',opportunity)
  if(value!==null)contribute('COMMERCIAL_VALUE',Math.min(1,value/policy.commercialSaturation),opportunityRef)
  if(!field(opportunity,'next_action','nextAction')){unknown('next_action','Qual é o próximo passo confirmado dessa oportunidade?','A oportunidade não possui próxima ação.');contribute('RISK',1,opportunityRef)}
 }
 const deadlines=[...commitments.map(item=>({item,type:'commitment',at:field(item,'due_at','dueAt'),label:field(item,'description','action')})),...opportunities.map(item=>({item,type:'opportunity',at:field(item,'next_action_at','nextActionAt'),label:item.title}))].filter(x=>timestamp(x.at)!==null).sort((a,b)=>timestamp(a.at)-timestamp(b.at)||stableRecordSort(a.item,b.item))
 const due=deadlines[0]||null,days=due?(timestamp(due.at)-now)/DAY:null
 let dueRef=null
 if(due){dueRef=add(`${due.type}-deadline:${due.item.id}`,`${clean(due.label,200)||'Ação registrada'}: prazo ${dateLabel(due.at)}${days<0?' vencido':''}.`,due.type,due.item);contribute('URGENCY',days<0?1:days<=2?.9:days<=7?.7:days<=14?.3:0,dueRef)}
 else unknown('deadline','Até quando essa decisão precisa acontecer?','Não há prazo registrado.')
 const nextVisit=visits.filter(v=>timestamp(field(v,'scheduled_at','scheduledAt'))>=now).sort((a,b)=>timestamp(field(a,'scheduled_at','scheduledAt'))-timestamp(field(b,'scheduled_at','scheduledAt'))||stableRecordSort(a,b))[0]
 let visitRef=null
 if(nextVisit){visitRef=add(`visit:${nextVisit.id}`,`Visita agendada em ${dateLabel(field(nextVisit,'scheduled_at','scheduledAt'))}: ${clean(nextVisit.objective)||'objetivo não informado'}.`,'visit',nextVisit);contribute('TIMING',(timestamp(field(nextVisit,'scheduled_at','scheduledAt'))-now)/DAY<=7?1:.2,visitRef)}
 const lastContact=latest(context.interactions,['occurred_at','occurredAt','created_at'])
 if(lastContact){const ref=add(`interaction:${lastContact.id}`,`Última interação registrada em ${dateLabel(decisionDate(lastContact))}.`,'interaction',lastContact);if(timestamp(decisionDate(lastContact))!==null)contribute('RELATIONSHIP',(now-timestamp(decisionDate(lastContact)))/DAY>30?1:.2,ref)}
 const technical=array(context.fieldReports).concat(array(context.soilAnalyses),array(context.ndviObservations)).sort((a,b)=>(timestamp(decisionDate(b)||b.sampled_at)||0)-(timestamp(decisionDate(a)||a.sampled_at)||0)||stableRecordSort(a,b))[0]
 let technicalRef=null
 if(technical){technicalRef=add(`technical:${technical.id}`,`${technical.validated_at?'Registro técnico validado':'Registro técnico ainda não validado'}: ${clean(technical.summary||technical.laboratory||technical.index_name||'Análise registrada')}.`,'agronomic_record',technical,{observed:technical.observed_at||technical.sampled_at||technical.created_at,technical:true,quality:technical.validated_at?'VALIDATED':'UNVALIDATED'});if(technical.validated_at)contribute('AGRONOMIC_SIGNAL',technicalRef.freshness==='CURRENT'?1:.3,technicalRef);else reviews.push('UNVALIDATED_AGRONOMY')}
 const agroCards=array(context.agroTerritory?.cards)
 if(context.agroTerritory){
  // Governed territorial evidence replaces the legacy technical contribution.
  dimensions.AGRONOMIC_SIGNAL.points=0;dimensions.AGRONOMIC_SIGNAL.evidence_refs=[];dimensions.AGRONOMIC_SIGNAL.state='NO_DATA'
  for(const agro of agroCards){
   const ref=add(`field-signal:${agro.signal.signal_id}`,`${agro.headline}: ${agro.validation_state}; ${agro.recommended_next_step}. Anomalia não confirma diagnóstico.`,'agronomic_signal',{id:agro.signal.signal_id},{observed:agro.signal.observed_at,technical:true,quality:agro.validation_state,provenance:{source:'canonical_agronomic_workspace',source_ref:agro.source_refs}})
   if(agro.signal.freshness==='CURRENT'&&agro.validation_state==='VALIDATED'&&agro.priority.score!=null)contribute('AGRONOMIC_SIGNAL',agro.priority.score/100,ref)
   else reviews.push('UNVALIDATED_AGRONOMY')
  }
  if(context.agroTerritory.conflicts.length)reviews.push('EVIDENCE_CONFLICT')
 }
 for(const event of array(context.hubEvidence)){
  if(event.status!=='processed'){reviews.push(event.error_code?.includes('identity')?'IDENTITY_AMBIGUITY':'EVIDENCE_CONFLICT');continue}
  if(!event.canonical_client_id||event.canonical_client_id!==context.canonicalClientId)continue
  add(`hub:${event.id}`,`Evento ${clean(event.event_type)} recebido de ${clean(event.source)}.`,'connector',event,{observed:event.observed_at||event.occurred_at,provenance:{source:event.source,external_id:event.external_id,canonical_entity:event.canonical_client_id,ingested_at:event.ingested_at,version:event.source_version??null,provenance:{event_id:event.id,payload_hash:event.payload_hash,contract_version:event.hub_contract_version}}})
 }
 if(array(context.evidenceConflicts).length)reviews.push('EVIDENCE_CONFLICT')
 for(const memory of [...array(context.contextSnapshot?.facts),...array(context.contextSnapshot?.validated_knowledge)]){
  if(memory.freshness!=='CURRENT')continue
  add(`memory:${memory.memory_ref}`,`${memory.key}: ${compactObject(memory.value)}`,'governed_memory',{id:memory.memory_ref},{observed:memory.observed_at,quality:'GOVERNED',provenance:{source:memory.source_type,source_ref:memory.source_ref}})
 }
 if(array(context.contextSnapshot?.conflicts).length)reviews.push('EVIDENCE_CONFLICT')
 const grain=context.grainDecision
 if(grain){
  const ref=add(`grain:${grain.id}`,`Volume registrado ${recordedNumber(grain.volume)??'não informado'} ${clean(grain.unit)||''}; praça ${clean(grain.place)||'não informada'}.`,'grain_record',grain)
  if(!grain.marketSource?.url||timestamp(grain.marketSource?.observed_at)===null||timestamp(grain.marketSource?.observed_at)>now+300000)unknown('market_source','Qual é a fonte e a data da referência de mercado?','Sem fonte válida não há recomendação de preço.')
  else if(now-timestamp(grain.marketSource.observed_at)>DAY)unknown('market_freshness','Qual é a referência atual de mercado?','A referência de mercado está vencida.')
  if(recordedNumber(grain.targetPrice)===null)unknown('target_price','Qual é o preço-alvo?','Não há preço-alvo confirmado.')
  if(grain.volumeConfirmed!==true)unknown('confirmed_volume','Esse volume está confirmado?','Volume ainda não confirmado.')
  if(timestamp(grain.deadline)!==null)contribute('TIMING',(timestamp(grain.deadline)-now)/DAY<=7?1:.2,ref)
 }
 if(!facts.length)unknown('active_decision','Qual decisão do produtor precisa de atenção?','A carteira não contém evidência suficiente para priorização.')
 const expected=ranked[0]?.value??(metrics.openPotentialKnown?metrics.openPotential:null)
 const expectedValue=expected===null?{status:'UNKNOWN',amount:null,currency:null,basis:null}:{status:'RECORDED',amount:expected,currency:'BRL',basis:ranked[0]?.value!=null?'OPPORTUNITY_ESTIMATED_VALUE':'POTENTIAL_GAP',evidence_ref:ranked[0]?.value!=null?opportunityRef.id:commercial.id,not_expected_profit:true}
 if(expected===null)unknown('expected_value','Qual é o valor ou volume registrado dessa decisão?','Sem base suficiente; não estimar ROI.')
 const temporalRefs=[dueRef,visitRef,technicalRef].filter(Boolean)
 const fresh=facts.filter(f=>f.freshness==='CURRENT').length,stale=facts.filter(f=>['STALE','FUTURE'].includes(f.freshness)).length
 const confidenceLevel=!facts.length||!fresh||missing.length>=2||reviews.length||stale>facts.length/2?'LOW':facts.length>=3&&fresh>=2&&missing.length===0?'HIGH':'MEDIUM'
 if(confidenceLevel==='LOW')reviews.push('LOW_CONFIDENCE')
 let type=days!==null&&days<0?'REAGENDAR':due&&days<=7?'CONFIRMAR':technicalRef?'REVISAR_AGRONOMIA':opportunity?'REVISAR_OPORTUNIDADE':'COLETAR_DADO'
 if(nextVisit&&((timestamp(field(nextVisit,'scheduled_at','scheduledAt'))-now)/DAY<=7)&&(opportunity||due||technicalRef))type='PREPARAR_VISITA'
 if(reviews.some(x=>['EVIDENCE_CONFLICT','IDENTITY_AMBIGUITY','INCOMPATIBLE_DATE'].includes(x)))type='COLETAR_DADO'
 const actions={REAGENDAR:`Confirmar o estado de “${clean(due?.label,160)}” e combinar um novo prazo.`,CONFIRMAR:`Confirmar “${clean(due?.label,160)}” até ${dateLabel(due?.at)}.`,REVISAR_OPORTUNIDADE:`Revisar “${clean(opportunity?.title,160)}” e confirmar o próximo passo com o produtor.`,REVISAR_AGRONOMIA:'Revisar o registro técnico e validar a hipótese com o responsável habilitado.',PREPARAR_VISITA:`Preparar a visita de ${dateLabel(field(nextVisit,'scheduled_at','scheduledAt'))} usando a decisão registrada e as perguntas SPIN/OPC/APC/EPA existentes.`,COLETAR_DADO:missing[0]?.question||'Revisar o conflito de evidência antes de recomendar avanço.'}
 const score=Math.min(100,Math.round(Object.values(dimensions).reduce((s,d)=>s+d.points,0)))
 const why=facts.filter(f=>f.source_type!=='connector').slice(0,3).map(f=>f.claim_supported)
 const whyNow=temporalRefs.map(f=>f.claim_supported).join(' ')||'Não há urgência temporal comprovada; confirmar a janela antes de antecipar contato.'
 const risk=days!==null&&days<0?dueRef.claim_supported:days!==null&&days<=7?`O prazo registrado termina em ${dateLabel(due.at)}.`:nextVisit?visitRef.claim_supported:opportunity&&!field(opportunity,'next_action','nextAction')?'A oportunidade continua sem próximo passo registrado.':'Consequência da espera ainda não comprovada.'
 const interview=buildDecisionInterview({intent:'NBA_MATERIAL',context,result:{facts_used:facts,confidence:{score:confidenceLevel==='HIGH'?.9:confidenceLevel==='MEDIUM'?.6:.2},missing_information:missing.map(m=>m.key),golden_questions:missing.slice(0,1).map(m=>({question:m.question,reason:m.reason}))}})
 const card={id:`decision:${producerId}`,version:DECISION_VERSION,producer_id:producerId,producer:{id:producerId,name:clean(client.name,160)},priority_score:score,priority_band:days!==null&&days<0&&dueRef?.freshness==='CURRENT'?'NOW':score>=50?'TODAY':score>=20?'THIS_WEEK':'MONITOR',decision_type:type,headline:opportunity?.title||technicalRef?.claim_supported||due?.label||'Confirmar decisão do produtor',why_this_producer:why.length?why.join(' '):'Não há dados suficientes para afirmar prioridade.',why_now:whyNow,next_best_action:actions[type],expected_value:expectedValue,risk_of_waiting:{statement:risk,financial_loss:null},confidence:{level:confidenceLevel,version:'val.decision-confidence.v1',evidence_count:facts.length,fresh_count:fresh,stale_count:stale,critical_missing:missing.length,consistency:reviews.length?'REVIEW_REQUIRED':'NO_CONFLICT_OBSERVED'},missing_information:missing,evidence:facts,deadline:due?.at||field(nextVisit,'scheduled_at','scheduledAt')||null,recommended_channel:client.servicePreference||client.commercial?.preferredChannel||'CONFIRMAR_COM_PRODUTOR',recommended_timing:due?.at?`Antes de ${dateLabel(due.at)}`:nextVisit?'Antes da visita registrada':'Confirmar disponibilidade',source_refs:facts.map(f=>f.id),generated_at:new Date(now).toISOString(),score_breakdown:{version:policy.version,total:score,dimensions,penalties,missing_data:missing.map(m=>m.key),missing_data_penalizes_producer:false},policy_version:policy.version,review_reasons:[...new Set(reviews)],status:reviews.length?'REVIEW_REQUIRED':'OPEN',decision_interview:interview,opportunity_id:opportunity?.id||null,visit_id:nextVisit?.id||null,eligible:score>0,context_snapshot_ref:context.contextSnapshot?.context_snapshot_id||context.contextSnapshot?.id||context.contextSnapshot?.snapshot_id||null,human_confirmation_required:true,automatic_execution:false,if_act:'Confirmar a situação e registrar a decisão humana; resultado comercial não garantido.',if_wait:risk}
 card.agronomic_decisions=agroCards
 card.commercial_gap=metrics.openPotentialKnown?metrics.openPotential:null
 card.engine_version=nexo.version
 card.engine_signals=nexo.signals.filter(signal=>signal.evidence_ids.length&&signal.evidence_ids.every(id=>facts.some(f=>f.engine_evidence_ref===id))).map(signal=>({id:signal.id,kind:signal.kind,evidence_refs:signal.evidence_ids.map(id=>facts.find(f=>f.engine_evidence_ref===id).id)}))
 card.producer={...card.producer,canonical_id:context.canonicalClientId||null}
 card.priority={score,band:card.priority_band};card.decision=type;card.why=card.why_this_producer;card.action=card.next_best_action;card.risk=card.risk_of_waiting;card.evidence_refs=card.source_refs
 card.evidence_fingerprint=hashDecision(facts);card.decision_fingerprint=hashDecision({...card,generated_at:undefined,context_snapshot_ref:undefined})
 return card
}
