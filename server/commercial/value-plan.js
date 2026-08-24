import {assertContract,valuePlanVersion,validateValuePlan} from './contracts.js'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=900)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const unique=items=>[...new Set(items.map(item=>text(item)).filter(Boolean))]
const stageMap={preparar:'EXPLORE',alinhar:'EXPLORE',descobrir:'DIAGNOSE',dimensionar:'DIAGNOSE',construir_valor:'BUILD_VALUE',propor:'PROPOSE',negociar:'NEGOTIATE',comprometer:'COMMIT'}

function ensureTenant(snapshot,organizationId,profile,thesis){
 for(const [artifact,code] of [[snapshot,'cross_tenant_value_plan_denied'],[profile,'cross_tenant_behavioral_profile_denied'],[thesis,'cross_tenant_decision_thesis_denied']])if(artifact&&text(artifact.organization_id)!==text(organizationId))throw Object.assign(new Error('Artefato comercial pertence a outro tenant.'),{code})
}

function priorityQuestions({snapshot,profile,thesis,advice}){
 const candidates=[]
 const push=(question,reason,evidenceRefs=[])=>{
  const value=text(question,420)
  if(!value||candidates.some(item=>item.question===value))return
  candidates.push({question:value,materiality:reason,evidence_refs:list(evidenceRefs).map(item=>({id:text(item?.id??item)})).filter(item=>item.id)})
 }
 for(const item of list(thesis.decision_questions))push(item,'A resposta pode mudar materialmente a tese, a estratégia ou o próximo passo.',thesis.evidence_refs)
 if(candidates.length)return candidates.slice(0,3)
 for(const item of list(snapshot.missing_information))push(item.question||item.description,item.critical?'Pode bloquear a recomendação segura.':'Pode mudar materialmente a próxima ação.',[])
 for(const item of list(profile.missing_information))push(item.question,'Reduz incerteza sobre como o decisor avalia prova e risco.',profile.evidence_refs)
 push(advice?.next_question?.question,advice?.next_question?.purpose||'Pode mudar materialmente a decisão.',advice?.next_question?.grounding_ids)
 for(const item of list(advice?.questions))push(item?.question,item?.purpose||'Pode mudar materialmente a decisão.',item?.grounding_ids)
 if(!candidates.length&&thesis.decision==='DISCOVER_BEFORE_RECOMMENDING')push(thesis.next_action,'É o dado necessário antes de recomendar.',thesis.evidence_refs)
 return candidates.slice(0,3)
}

function profileStrategy(profile){
 const weights=profile.profile_weights||{}
 const known=Number(profile?.confidence)>=.3&&list(profile?.signals).length>0
 const primary=known?Object.keys(weights).sort((a,b)=>Number(weights[b])-Number(weights[a]))[0]:null
 const map={
  analytical:{proof:'Comparativos, ROI, custo/ha, break-even e risco com premissas explícitas.',pace:'Permitir conferência dos números.'},
  relational:{proof:'Histórico, acordos cumpridos, presença e consistência.',pace:'Construir alinhamento e confiança antes de acelerar.'},
  innovative:{proof:'Diferenciação, teste controlado e critério de sucesso.',pace:'Explorar futuro sem vender novidade pela novidade.'},
  conservative:{proof:'Segurança, continuidade, referências e reversibilidade.',pace:'Reduzir ruptura e avançar por etapas.'}
 }
 return known?{known:true,primary,...map[primary]}:{known:false,primary:null,proof:'Pergunte qual evidência seria útil; não presuma preferência.',pace:'Não acelere sem um critério observável e um próximo passo aceito.'}
}

function priceObjection(message,advice){
 const corpus=normalized(`${message} ${list(advice?.expected_objections).join(' ')}`)
 return /esta caro|preco|desconto|condicao comercial/.test(corpus)
}

function priceStatus(message,advice,thesis){
 const thesisStatus=thesis?.decision_context?.commercial_signal?.price_status
 if(thesisStatus&&thesisStatus!=='ABSENT')return thesisStatus
 const corpus=normalized(`${message} ${list(advice?.expected_objections).join(' ')}`)
 if(/(?:disse|declarou|afirmou|comentou).{0,35}(?:caro|preco alto)|(?:achou|considerou).{0,25}(?:caro|investimento alto)|(?:recusou|rejeitou).{0,35}(?:preco|proposta)/.test(corpus))return 'CONFIRMED_OBJECTION'
 return priceObjection(message,advice)?'HYPOTHESIS':'ABSENT'
}

function objectionGuidance(status,thesis){
 if(status==='ABSENT')return []
 return [{
  objection:'PRICE',
  automatic_discount:false,
  sequence:['VALIDATE_OBJECTION','RETURN_TO_CONFIRMED_PROBLEM','QUANTIFY_IMPACT','COMPARE_ACTION_VS_INACTION','EXPLAIN_RISK_RETURN','DISCUSS_COMMERCIAL_CONDITION_IF_APPROPRIATE'],
  guidance:text(thesis?.avoid_guidance||'Confirme o significado de “caro”, reconstrua problema e impacto, compare agir versus não agir e só então discuta condição comercial dentro das regras de margem.')
 }]
}

function optionalAnalogy(input){
 const analogy=input.analogy
 if(!analogy||input.analogyImprovesUnderstanding!==true)return null
 return {text:text(analogy),purpose:'Aumentar compreensão depois do diagnóstico.',evidence:false,required:false,guardrail:'Analogia não substitui evidência técnica ou econômica.'}
}

export function buildValuePlan(input={}){
 const snapshot=input.contextSnapshot||input.context?.contextSnapshot
 const profile=input.behavioralProfile
 const thesis=input.decisionThesis
 const organizationId=text(input.organizationId||snapshot?.organization_id)
 ensureTenant(snapshot,organizationId,profile,thesis)
 const advice=input.advice||{}
 const methodology=advice.methodology_state||{}
 const commercialStage=stageMap[text(methodology.working_stage||methodology.current_stage)]||input.commercialStage||'EXPLORE'
 const strategy=profileStrategy(profile)
 const status=priceStatus(input.currentMessage,advice,thesis)
 const qualityPrepare=list(thesis.decision_questions).length>0
 const questions=priorityQuestions({snapshot,profile,thesis,advice})
 const problem=text(thesis?.decision_context?.problem_statement||advice?.value_hypothesis?.problem||advice?.commercial_context?.problem||thesis.missing_information[0]||'Problema comercial ainda precisa ser confirmado com o produtor.')
 const next=text(thesis.commitment_target||thesis.next_action||advice.next_best_action||'Registrar um próximo passo proporcional à evidência disponível.')
 const proof=unique([...(qualityPrepare?list(thesis.proof_candidates):[strategy.proof]),...list(advice?.value_bridge?.proof_strategy),...list(advice?.evidence_used).map(item=>item?.claim_supported)]).slice(0,5)
 const expected=unique([...(status==='CONFIRMED_OBJECTION'?['Objeção de preço confirmada pelo produtor.']:status==='HYPOTHESIS'?['Preço ou condição comercial pode ser um ponto de fricção a validar.']:[]),...list(input?.context?.conversionInnovations?.objectionLibrary?.items).map(item=>item?.label||item?.objection)]).slice(0,5)
 const crossSell=list(input?.context?.conversionInnovations?.postConversionExpansion?.candidates).map(item=>({id:text(item?.id),description:text(item?.title||item?.label),evidence_refs:list(item?.evidenceIds).map(id=>({id:text(id)}))})).filter(item=>item.description).slice(0,5)
 return assertContract({
  contract_version:valuePlanVersion,
  version:valuePlanVersion,
  organization_id:organizationId,
  subject_id:text(input.subjectId||snapshot?.subject?.id),
  context_snapshot_id:text(snapshot?.context_snapshot_id),
  decision_thesis_version:thesis.version,
  behavioral_profile_version:profile.version,
  commercial_stage:commercialStage,
  methodology:{official:'OPC',legacy_alias:'APC',spin_internal:true,epa:{educate:'Insight verificável antes do argumento.',personalize:'Forma e prova adaptadas sem alterar fatos.',take_control:'Conduzir o processo e o próximo passo sem pressionar a pessoa.'}},
  principles:['SALE_FOLLOWS_TRUST','FIRM_ON_PROBLEM_LIGHT_WITH_PERSON'],
  questions,
  problem_statement:problem,
  implications:unique(list(advice?.value_hypothesis?.implications).concat(thesis.risks)).slice(0,5),
  value_thesis:text(advice?.value_hypothesis?.thesis||thesis.recommended_action),
  economic_case:advice?.value_bridge?.economic_case||advice?.commercial_context?.economic_case||{status:'NOT_QUANTIFIED',guardrail:'Não inventar número; calcular somente com valores e unidades confirmados.'},
  proof_strategy:proof,
  expected_objections:expected,
  objection_guidance:objectionGuidance(status,thesis),
  analogy_optional:optionalAnalogy(input),
  commitment_target:qualityPrepare?next:thesis.decision==='DISCOVER_BEFORE_RECOMMENDING'?'Obter o dado crítico ou agendar sua coleta.':next,
  cross_sell_candidates:crossSell,
  follow_up:next,
  approach:{communication_style:qualityPrepare&&thesis?.decision_context?text(thesis?.profile_strategy?.guidance||profile.approach_guidance.communication_style):profile.approach_guidance.communication_style,proof_preference:strategy.proof,decision_pace:strategy.pace,risk_orientation:profile.approach_guidance.risk_orientation},
  decision_questions:qualityPrepare?questions:[],
  commercial_signal:{price_status:status},
  avoid_guidance:text(thesis.avoid_guidance),
  guardrails:{automatic_discount:false,max_priority_questions:3,no_pressure:true,technical_facts_unchanged:true,margin_and_producer_value:true}
 },validateValuePlan,'ValuePlan v1')
}
