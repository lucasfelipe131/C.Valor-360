const array=value=>Array.isArray(value)?value:[]
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const text=(value,max=320)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const lower=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const unique=items=>[...new Set(items.filter(Boolean))]
const sourceId=(type,source,index=0)=>`${type}:${text(source?.id||source?.external_id||source?.externalId||source?.external_key||index,160)}`

function roleCategory(role){
 const normalized=lower(role)
 if(/agron|t[eé]cnic|produção|producao|campo|consultor/.test(normalized))return 'technical'
 if(/finance|cr[eé]dito|caixa|tesour|contador/.test(normalized))return 'financial'
 if(/compras|comercial|negocia|suprimento/.test(normalized))return 'commercial'
 if(/opera|gerente de fazenda|encarregado|administrador/.test(normalized))return 'operational'
 if(/diretor|presidente|s[oó]cio|propriet[aá]rio|dono|executiv/.test(normalized))return 'executive'
 return role?'other':'unclassified'
}

function participantLists(context){
 const sources=[]
 const client=context.client||{}
 for(const [key,list] of Object.entries({decisionMakers:client.decisionMakers,decision_makers:client.decision_makers,participants:client.decisionParticipants,stakeholders:client.stakeholders,commercial:client.commercial?.decisionMakers}))if(Array.isArray(list))sources.push({type:`client-${key}`,source:client,list})
 array(context.opportunities).forEach((opportunity,index)=>{
  for(const [key,list] of Object.entries({decisionMakers:opportunity.decisionMakers,decision_makers:opportunity.decision_makers,stakeholders:opportunity.stakeholders,participants:opportunity.participants,decision_roles:opportunity.decision_roles}))if(Array.isArray(list))sources.push({type:`opportunity-${key}`,source:opportunity,index,list})
 })
 array(context.interactions).forEach((interaction,index)=>{
  for(const [key,list] of Object.entries({participants:interaction.participants,decisionMakers:interaction.decisionMakers,stakeholders:interaction.stakeholders}))if(Array.isArray(list))sources.push({type:`interaction-${key}`,source:interaction,index,list})
 })
 const answers=object(context.profile?.answers)
 for(const key of ['decisionMakers','decision_makers','decisionParticipants','stakeholders','participants'])if(Array.isArray(answers[key]))sources.push({type:`profile-${key}`,source:context.profile||{},list:answers[key]})
 return sources
}

function normalizeParticipant(value,source,index){
 const item=object(value)
 const raw=typeof value==='string'?text(value,180):''
 const role=text(item.role||item.title||item.function||item.funcao||item.papel,140)
 const name=text(item.name||item.full_name||item.fullName||item.person||item.nome||(raw&&!role?raw:''),160)
 const explicitRole=role||text(raw&&/(?:t[eé]cnic|finance|compras|diretor|s[oó]cio|propriet|gerente|opera)/i.test(raw)?raw:'',140)
 const perspective=text(item.perspective||item.decision_criteria||item.decisionCriteria||item.criteria||item.priority||item.interest,260)
 const riskPosture=text(item.risk_posture||item.riskPosture||item.risk_profile||item.riskProfile||item.risk,180)
 const influence=text(item.influence||item.decision_weight||item.decisionWeight||item.authority,120)
 if(!name&&!explicitRole)return null
 const evidence=sourceId(source.type,source.source,source.index??index)
 return {
  id:`actor:${lower(name||explicitRole).replace(/[^a-z0-9]+/g,'-')}:${roleCategory(explicitRole)}`,
  name,role:explicitRole,roleCategory:roleCategory(explicitRole),perspective,riskPosture,influence,
  evidenceIds:[evidence],confirmed:item.confirmed!==false,
  missing:[!name?'nome do participante':'',!explicitRole?'papel na decisão':'',!perspective?'critério ou perspectiva':'',!riskPosture?'postura de risco':''].filter(Boolean),
  sourceType:source.type
 }
}

function mergeActors(actors){
 const map=new Map()
 for(const actor of actors){
  const key=`${lower(actor.name)}|${lower(actor.role)}`
  if(!map.has(key)){map.set(key,actor);continue}
  const current=map.get(key)
  map.set(key,{...current,name:current.name||actor.name,role:current.role||actor.role,roleCategory:current.roleCategory!=='unclassified'?current.roleCategory:actor.roleCategory,perspective:current.perspective||actor.perspective,riskPosture:current.riskPosture||actor.riskPosture,influence:current.influence||actor.influence,evidenceIds:unique([...current.evidenceIds,...actor.evidenceIds]),missing:unique([...current.missing,...actor.missing]).filter(item=>!(item==='nome do participante'&&(current.name||actor.name))&&!(item==='papel na decisão'&&(current.role||actor.role))&&!(item==='critério ou perspectiva'&&(current.perspective||actor.perspective))&&!(item==='postura de risco'&&(current.riskPosture||actor.riskPosture)))})
 }
 return [...map.values()]
}

function explicitStrategicSignal(context){
 const texts=[context.client?.decisionProcess,context.client?.commercial?.decisionProcess,...array(context.opportunities).map(item=>item?.decision_process||item?.decisionProcess||item?.notes)].map(text).filter(Boolean)
 const matched=texts.find(value=>/comit[eê]|diretoria|mais de um decisor|m[uú]ltiplos decisores|aprova[cç][aã]o conjunta/i.test(value))
 return matched||''
}

export function buildMultiDecisionMap(context={},options={}){
 const sources=participantLists(context)
 const actors=mergeActors(sources.flatMap(source=>source.list.map((item,index)=>normalizeParticipant(item,source,index)).filter(Boolean))).filter(actor=>actor.confirmed)
 const strategicSignal=explicitStrategicSignal(context)
 const strategic=actors.length>=2||Boolean(strategicSignal)
 const gaps=unique(actors.flatMap(actor=>actor.missing.map(item=>`${actor.name||actor.role||'Participante'}: ${item}`)))
 const firstGapActor=actors.find(actor=>actor.missing.length)
 const nextAlignment=actors.length===0
  ?{action:'Registrar pelo menos um participante confirmado e seu papel na decisão.',question:'Quem participa desta decisão e qual é o papel de cada pessoa?',evidenceNeeded:'Nome ou papel informado diretamente e fonte do registro.'}
  :firstGapActor
   ?{action:`Completar o mapa de ${firstGapActor.name||firstGapActor.role}.`,question:firstGapActor.perspective?`Qual risco ${firstGapActor.name||firstGapActor.role} precisa reduzir para avançar?`:`O que ${firstGapActor.name||firstGapActor.role} precisa comprovar para considerar esta decisão segura?`,evidenceNeeded:firstGapActor.missing.join(', ')}
   :{action:'Alinhar os critérios confirmados entre os participantes antes da proposta final.',question:'Há algum critério em conflito entre os participantes que precisa ser resolvido antes da decisão?',evidenceNeeded:'Resposta explícita, responsável e próximo compromisso.'}
 return {
  version:'val-multi-decision-map-v1',generatedAt:new Date(options.now??Date.now()).toISOString(),
  strategic,strategicSignal:text(strategicSignal,240),actors,
  roleSummary:Object.fromEntries(['technical','financial','commercial','operational','executive','other','unclassified'].map(role=>[role,actors.filter(actor=>actor.roleCategory===role).length])),
  dataGaps:gaps,nextAlignment,
  policy:{confirmedDataOnly:true,inferredPeople:false,personalLeverage:false,automaticContact:false},
  emptyReason:actors.length?'':'Nenhum participante da decisão foi registrado de forma estruturada nesta conta.',
  guardrail:'O mapa serve para alinhar critérios e responsabilidades. Não use informação pessoal, familiar ou financeira como alavanca, não invente influência e não associe postura de risco sem confirmação.'
 }
}
