import {assertContract,behavioralDimensions,behavioralProfileVersion,validateBehavioralProfile} from './contracts.js'
import {unansweredHighValueQuestions} from './questionnaire-definition.js'

const list=value=>Array.isArray(value)?value:[]
const text=value=>String(value??'').replace(/\s+/g,' ').trim()
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0))
const aliases={
 analytical:'analytical',analitico:'analytical',analítico:'analytical',
 relational:'relational',relacional:'relational',
 innovative:'innovative',inovador:'innovative',
 conservative:'conservative',conservador:'conservative'
}
const legacyKeys={analytical:['analitico','analytical'],relational:['relacional','relational'],innovative:['inovador','innovative'],conservative:['conservador','conservative']}
const patterns={
 analytical:[/\broi\b/,/retorno/,/numero/,/comparativ/,/custo\s*(?:por|\/)\s*ha/,/break.?even/,/dado/,/calcul/],
 relational:[/compromisso/,/confianca/,/historico de entrega/,/parceria/,/presenca/,/relacionamento/],
 innovative:[/inov/,/novidade/,/tecnologia nova/,/diferenciacao/,/experiment/,/teste/],
 conservative:[/seguranca/,/continuidade/,/tradicao/,/fornecedor historico/,/risco baixo/,/comprovad/]
}

function sameTenant(snapshot,organizationId){
 if(!snapshot||text(snapshot.organization_id)!==text(organizationId))throw Object.assign(new Error('ContextSnapshot não autorizado para o tenant informado.'),{code:'cross_tenant_behavioral_profile_denied'})
}

function legacyScores(context){
 const scores=context?.client?.scores||context?.profile?.scores||{}
 return Object.fromEntries(behavioralDimensions.map(key=>[key,Math.max(0,...legacyKeys[key].map(alias=>Number(scores[alias])||0))]))
}

function evidenceReference(signal,index){
 const explicit=text(signal?.evidence_ref??signal?.source_ref)
 if(explicit)return explicit
 const nested=list(signal?.evidence_refs).map(item=>text(item?.id??item)).find(Boolean)
 return nested||`behavioral-signal:${index}`
}

function observedSignals(context,snapshot,currentMessage){
 const values=[]
 for(const [index,signal] of list(snapshot?.behavioral_signals).entries())values.push({
  source_type:'context_snapshot',
  evidence_ref:evidenceReference(signal,index),
  observed_at:signal?.observed_at||snapshot?.freshness?.generated_at||null,
  value:text(signal?.value),
  key:text(signal?.key)
 })
 const answers=context?.profile?.answers||context?.client?.profileAnswers||{}
 for(const id of [7,8,9,10,11,12,13,14,15,16,17,18])if(text(answers[id]??answers[String(id)]))values.push({source_type:'producer_questionnaire',evidence_ref:`questionnaire:q${id}`,observed_at:context?.profile?.assessedAt||context?.client?.profileUpdatedAt||null,value:text(answers[id]??answers[String(id)]),key:`q${id}`})
 if(text(currentMessage))values.push({source_type:'current_interaction',evidence_ref:'interaction:current',observed_at:snapshot?.freshness?.generated_at||null,value:text(currentMessage),key:'observable_language'})
 return values
}

function profileWeights(points){
 const total=behavioralDimensions.reduce((sum,key)=>sum+points[key],0)
 if(total<=0)return Object.fromEntries(behavioralDimensions.map(key=>[key,0.25]))
 const result=Object.fromEntries(behavioralDimensions.map(key=>[key,Number((points[key]/total).toFixed(6))]))
 const current=behavioralDimensions.reduce((sum,key)=>sum+result[key],0)
 result.analytical=Number((result.analytical+(1-current)).toFixed(6))
 return result
}

function guidance(weights,digitalPreference){
 const ranked=[...behavioralDimensions].sort((a,b)=>weights[b]-weights[a])
 const primary=ranked[0]
 const mapping={
  analytical:{communication_style:'Direto, preciso e estruturado.',proof_preference:'ROI, comparativos, custo/ha, resultados e risco.',decision_pace:'Dê tempo para conferir premissas.',risk_orientation:'Explicite cenários, sensibilidade e break-even.'},
  relational:{communication_style:'Presente, consistente e respeitoso com o histórico.',proof_preference:'Compromissos cumpridos, histórico e referências confiáveis.',decision_pace:'Construa alinhamento antes de acelerar.',risk_orientation:'Mostre continuidade de suporte e responsabilidade.'},
  innovative:{communication_style:'Exploratório, claro sobre novidade e limites.',proof_preference:'Teste controlado, diferenciação e critério de sucesso.',decision_pace:'Permita experimentar sem vender novidade pela novidade.',risk_orientation:'Separe hipótese, risco e desenho de validação.'},
  conservative:{communication_style:'Previsível, gradual e orientado a segurança.',proof_preference:'Histórico, referências e continuidade.',decision_pace:'Evite ruptura; proponha transição ou teste limitado.',risk_orientation:'Priorize reversibilidade e redução de risco.'}
 }
 const base=mapping[primary]
 return {
  ...base,
  ...(digitalPreference?{interaction_preference:'Preferência digital observada; confirme canal e formato antes de usar.'}:{}),
  suggested_questions:[]
 }
}

export function buildBehavioralProfile(context={},options={}){
 const snapshot=options.contextSnapshot||context.contextSnapshot
 const organizationId=text(options.organizationId||snapshot?.organization_id)
 sameTenant(snapshot,organizationId)
 const subjectId=text(options.subjectId||snapshot?.subject?.id||context?.client?.id)
 const legacy=legacyScores(context)
 const points=Object.fromEntries(behavioralDimensions.map(key=>[key,legacy[key]]))
 const signals=[]
 const evidence=new Set()
 for(const signal of observedSignals(context,snapshot,options.currentMessage)){
  const corpus=normalized(`${signal.key} ${signal.value}`)
  for(const dimension of behavioralDimensions){
   const matches=patterns[dimension].filter(pattern=>pattern.test(corpus)).length
   if(!matches)continue
   const delta=Math.min(3,matches)
   points[dimension]+=delta
   evidence.add(signal.evidence_ref)
   signals.push({dimension,reason_code:`OBSERVED_${dimension.toUpperCase()}_PREFERENCE`,weight_delta:delta,evidence_ref:signal.evidence_ref,source_type:signal.source_type,observed_at:signal.observed_at})
  }
 }
 for(const dimension of behavioralDimensions)if(legacy[dimension]>0){
  const ref=`legacy-profile:${dimension}`
  evidence.add(ref)
  signals.push({dimension,reason_code:'LEGACY_QUESTIONNAIRE_SCORE',weight_delta:legacy[dimension],evidence_ref:ref,source_type:'legacy_profile_score',observed_at:context?.profile?.assessedAt||context?.client?.profileUpdatedAt||null})
 }
 const digitalScore=Math.max(Number(context?.client?.scores?.digital)||0,Number(context?.profile?.scores?.digital)||0)
 const digitalTag=/digital/i.test(text(context?.client?.primaryProfile||context?.client?.secondaryProfile))
 const digitalPreference=digitalScore>0||digitalTag||/whatsapp|video|celular|remot|digital/i.test(list(snapshot?.behavioral_signals).map(item=>item?.value).join(' '))
 if(digitalPreference){evidence.add('legacy-profile:digital');signals.push({dimension:'interaction_preference',reason_code:'DIGITAL_INTERACTION_PREFERENCE',weight_delta:0,evidence_ref:'legacy-profile:digital',source_type:'legacy_profile_score',observed_at:context?.profile?.assessedAt||context?.client?.profileUpdatedAt||null})}
 const weights=profileWeights(points)
 const traceableSignals=signals.filter(item=>item.evidence_ref)
 const confidence=traceableSignals.length?clamp(0.25+Math.min(0.55,traceableSignals.length*0.08)+Math.min(0.15,evidence.size*0.03)):0.1
 const missing=unansweredHighValueQuestions(context?.profile?.answers||context?.client?.profileAnswers||{}, {limit:3}).map(item=>({code:item.reason_code,question_id:item.question_id,question:item.question}))
 const approach=guidance(weights,digitalPreference)
 approach.suggested_questions=missing.slice(0,3).map(item=>item.question)
 return assertContract({
  contract_version:behavioralProfileVersion,
  subject_id:subjectId,
  organization_id:organizationId,
  context_snapshot_id:snapshot.context_snapshot_id,
  profile_weights:weights,
  signals:traceableSignals,
  evidence_refs:[...evidence].map(id=>({id})),
  confidence:Number(confidence.toFixed(2)),
  updated_at:options.now instanceof Date?options.now.toISOString():new Date(options.now||snapshot?.freshness?.generated_at||Date.now()).toISOString(),
  version:behavioralProfileVersion,
  legacy:{primary_tag:text(context?.client?.primaryProfile)||null,secondary_tag:text(context?.client?.secondaryProfile)||null,digital:{preserved:true,classification:'INTERACTION_PREFERENCE',score:digitalScore||null}},
  approach_guidance:approach,
  missing_information:missing
 },validateBehavioralProfile,'BehavioralProfile v1')
}
