export const profileKeys=['Conservador','Analítico','Inovador','Relacional','Digital']

export const slug=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')
export const normalizeText=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()

const noAdditionalNeedPatterns=[
 /^(?:nao|nenhum|nenhuma|nada)(?: (?:agora|no momento|por enquanto))?$/,
 /^(?:agora|no momento|por enquanto) (?:nao|nenhum|nenhuma|nada)$/,
 /^nao (?:obrigado|obrigada|se aplica)$/,
 /^nao (?:tenho|temos|preciso|precisamos)(?: (?:nenhuma? )?(?:necessidade|necessidades|demanda|demandas)(?: adicional| adicionais)?)?(?: (?:agora|no momento|por enquanto))?$/,
 /^nao (?:tenho|temos|preciso|precisamos) (?:de )?nada(?: (?:agora|no momento|por enquanto))?$/,
 /^nao (?:ha|existe)(?: nenhuma?)? (?:necessidade|necessidades|demanda|demandas)(?: adicional| adicionais)?(?: (?:agora|no momento|por enquanto))?$/,
 /^(?:nenhum|nenhuma|sem)(?: nenhuma?)? (?:necessidade|necessidades|demanda|demandas)(?: adicional| adicionais)?(?: (?:agora|no momento|por enquanto))?$/
]

export const opportunityFromAdditionalNeed=value=>{
 const raw=String(value??'').trim()
 return raw&&!noAdditionalNeedPatterns.some(pattern=>pattern.test(normalizeText(raw)))?raw:''
}

export const additionalNeedState=value=>{
 const raw=String(value??'').trim()
 return raw?(opportunityFromAdditionalNeed(raw)?'reported':'none_declared'):'unknown'
}

export const q27OpportunityProvenance=state=>({origin:'producer_360',field:'q27',state})
export const isQ27Opportunity=commercial=>commercial?.opportunityProvenance?.origin==='producer_360'&&commercial?.opportunityProvenance?.field==='q27'
export const hasIndependentOpportunity=commercial=>{
 const title=opportunityFromAdditionalNeed(commercial?.opportunity)
 if(!title||isQ27Opportunity(commercial))return false
 const provenance=commercial?.opportunityProvenance
 if(provenance?.origin&&provenance.origin!=='producer_360')return true
 const hasScore=commercial?.score!==null&&commercial?.score!==undefined&&Number.isFinite(Number(commercial.score))
 return commercial?.potentialValidated===true||Number(commercial?.potential)>0||hasScore||Number(commercial?.frequency)>0||/^hipotese\b/.test(normalizeText(title))
}

const looksLikeLegacyQ27=(client,commercial)=>{
 const title=opportunityFromAdditionalNeed(commercial?.opportunity)
 const need=String(client?.additionalNeed??'').trim()
 return Boolean(title&&need&&!hasIndependentOpportunity(commercial)&&normalizeText(title)===normalizeText(need))
}

export function reconcileOpportunityProjection(currentClient={},incomingClient={}){
 const current={...(currentClient.commercial||{})}
 const incoming={...(incomingClient.commercial||{})}
 const incomingTitle=opportunityFromAdditionalNeed(incoming.opportunity)
 const incomingQ27=isQ27Opportunity(incoming)
 const currentQ27=isQ27Opportunity(current)||looksLikeLegacyQ27(currentClient,current)
 if(incomingQ27){
  if(currentQ27||!hasIndependentOpportunity(current))return {opportunity:incomingTitle,opportunityProvenance:incoming.opportunityProvenance}
  return {opportunity:opportunityFromAdditionalNeed(current.opportunity),opportunityProvenance:current.opportunityProvenance||null}
 }
 if(hasIndependentOpportunity(incoming))return {opportunity:incomingTitle,opportunityProvenance:incoming.opportunityProvenance||null}
 return {opportunity:opportunityFromAdditionalNeed(current.opportunity),opportunityProvenance:current.opportunityProvenance||null}
}

export function calculateProfile(answers,matrix,source='Produtor 360'){
 const score=Object.fromEntries(profileKeys.map(key=>[key,0]))
 matrix.forEach(item=>{if(answers[item.Pergunta]===item.Alternativa)score[item.Perfil]=(score[item.Perfil]||0)+1})
 const ranking=Object.entries(score).sort((a,b)=>b[1]-a[1])
 const scale=[19,20,21,22,23].map(id=>Number(answers[id]||0))
 const irt=Math.round(scale.reduce((sum,value)=>sum+value,0)*2)
 const nps=Number(answers[24]||0)
 const name=String(answers[1]||'Produtor sem nome').trim()
 const municipality=String(answers[2]||'A definir').trim()
 const additionalNeed=String(answers[27]??'').trim()||null
 const needState=additionalNeedState(additionalNeed)
 return {
  id:slug(name)||`produtor-${slug(municipality)||'sem-localidade'}`,
  name,
  municipality,
  area:String(answers[3]||'A definir'),
  cultures:String(answers[4]||'A definir'),
  relationshipTime:String(answers[5]||'A definir'),
  primaryProfile:ranking[0]?.[1]?ranking[0][0]:'A classificar',
  secondaryProfile:ranking[1]?.[1]?ranking[1][0]:'A aprofundar',
  scores:Object.fromEntries(Object.entries(score).map(([key,value])=>[slug(key),value])),
  irt,
  irtBand:irt>=80?'Relacionamento estratégico':irt>=60?'Relacionamento consolidado':irt>=40?'Relacionamento em desenvolvimento':irt>=20?'Relacionamento vulnerável':'Relacionamento crítico',
  nps,
  npsClass:nps>=9?'Promotor':nps>=7?'Neutro':'Detrator',
  valuedAspect:String(answers[25]||'A registrar'),
  missingFor10:String(answers[26]||''),
  additionalNeed,
  additionalNeedStatus:needState,
  decisionParticipants:String(answers[6]||''),
  decisionDriver:String(answers[7]||''),
  technicalPresentation:String(answers[8]||''),
  planningStyle:String(answers[9]||''),
  innovationBehavior:String(answers[10]||''),
  servicePreference:String(answers[11]||''),
  contactFrequency:String(answers[12]||''),
  firstActionProblem:String(answers[13]||''),
  trustDriver:String(answers[14]||''),
  eventPreference:String(answers[15]||''),
  buyingBehavior:String(answers[16]||''),
  contentPreference:String(answers[17]||''),
  postSalePreference:String(answers[18]||''),
  scoresScale:{trust:answers[19],contact:answers[20],value:answers[21],innovation:answers[22],continuity:answers[23],recommendation:answers[24]},
  commercial:{potential:0,potentialValidated:false,lastContactDays:null,priority:'A avaliar',opportunity:opportunityFromAdditionalNeed(additionalNeed),opportunityProvenance:q27OpportunityProvenance(needState),property:''},
  source,
  profileUpdatedAt:new Date().toISOString()
 }
}
