import {compactKnowledgeRefs,knowledgeQualityState,normalizeKnowledgeRetrieval} from '../commercial/knowledge-support.js'

export const prepareVisitQualityVersion='val.prepare_visit.quality.v1'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const unique=items=>[...new Set(items.map(item=>text(item)).filter(Boolean))]
const itemStatement=item=>text(item?.value?.statement??item?.value?.description??item?.data?.statement??item?.statement??item?.description)

const crops=['milho','soja','trigo','canola','arroz','feijão','feijao','sorgo','aveia']
const solutions=['inseticida','fungicida','herbicida','fertilizante','semente','tratamento de sementes','adjuvante','biológico','biologico']
const forbiddenFinalLanguage=/\b(?:fonte mestre|conflito material|resolver conflito|validar o contexto|contexto de voz revisado|fato confirmado pelo consultor|obter o dado crítico|confirmação da fonte|perfil comportamental não possui evidência)\b/i
const genericOnly=/^(?:use evidências?|entenda a necessidade|construa valor|valide o contexto|obtenha o dado crítico|confirme a informação|registre o próximo passo)[.!]?$/i

function allKnowledge(snapshot){
 return [
  ...list(snapshot?.facts).map(item=>({...item,epistemic_state:'FACT'})),
  ...list(snapshot?.inferences).map(item=>({...item,epistemic_state:'INFERENCE'})),
  ...list(snapshot?.hypotheses).map(item=>({...item,epistemic_state:'HYPOTHESIS'})),
  ...list(snapshot?.validated_knowledge).map(item=>({...item,epistemic_state:'VALIDATED_KNOWLEDGE'}))
 ]
}

function firstMatch(corpus,values){
 const value=values.find(item=>normalized(corpus).includes(normalized(item)))
 return value?value.normalize('NFD').replace(/[\u0300-\u036f]/g,''):null
}

function explicitPriceObjection(value){
 const source=normalized(value)
 return /(?:disse|declarou|afirmou|comentou).{0,35}(?:caro|preco alto)|(?:achou|considerou).{0,25}(?:caro|investimento alto)|(?:recusou|rejeitou).{0,35}(?:preco|proposta)|nao (?:quer|vai) (?:comprar|investir).{0,35}(?:preco|caro)/.test(source)
}

function priceSignal(value){return /pre[cç]o|precifica[cç][aã]o|condi[cç][aã]o comercial|investimento|caro|valor percebido|diferen[cç]a de valor/i.test(value)}
function planted(value){return /plantio (?:foi |j[aá] )?(?:realizado|feito)|j[aá] (?:foi )?plantad|(?:milho|soja|trigo|canola|arroz|feij[aã]o|sorgo|aveia).{0,25}(?:plantad|semead)/i.test(value)}
function emerged(value){return /emergiu|emergid|emerg[eê]ncia/i.test(value)}
function applicationNear(value){return /(?:primeira|1[ªa]) aplica[cç][aã]o.{0,45}(?:pr[oó]xim|agora|curta|chegando)|janela.{0,30}(?:aplica[cç][aã]o|operacional)|aplica[cç][aã]o.{0,30}(?:pr[oó]xim|agora)/i.test(value)}
function decisionParticipant(value){return /s[oó]ci[oa]|filh[oa].{0,30}decis|decisor|participa.{0,30}decis/i.test(value)}

function profileMode(profile){
 const confidence=Number(profile?.confidence)||0
 if(confidence<.3||!list(profile?.signals).length)return {known:false,primary:null,confidence}
 const weights=profile.profile_weights||{}
 const primary=Object.keys(weights).sort((a,b)=>Number(weights[b])-Number(weights[a]))[0]||null
 return {known:Boolean(primary),primary,confidence}
}

function historyProofs(snapshot,{crop,solution}={}){
 const history=list(snapshot?.commercial_context?.business_history)
 const opportunities=list(snapshot?.commercial_context?.opportunities)
 const values=[]
 const relevantHistory=history.filter(item=>{
  const corpus=JSON.stringify(item?.data||{})
  return !crop&&!solution||normalized(corpus).includes(normalized(crop||''))||normalized(corpus).includes(normalized(solution||''))
 })
 if(relevantHistory.length)values.push('Histórico de compras ou resultados já registrado para comparar nas mesmas premissas.')
 const relevantOpportunity=opportunities.find(item=>{
  const corpus=JSON.stringify(item?.data||{})
  return normalized(corpus).includes(normalized(crop||''))||normalized(corpus).includes(normalized(solution||''))
 })
 if(relevantOpportunity)values.push('Proposta ou oportunidade já registrada, com condição e escopo conferidos antes da visita.')
 const summary=snapshot?.commercial_context?.summary||{}
 if([summary.currentPurchases,summary.potential,summary.openPotential,summary.current_purchases,summary.open_potential].some(value=>Number.isFinite(Number(value))))values.push('Números comerciais já registrados para montar um comparativo sem inventar premissas.')
 return unique(values).slice(0,3)
}

function profileStrategy(profile,proofs){
 const mode=profileMode(profile)
 if(!mode.known)return {
  known:false,
  guidance:'Conduza primeiro os critérios da decisão e confirme como o produtor prefere comparar as alternativas.',
  proof_preference:proofs[0]||'Pergunte qual prova seria útil antes de escolher o formato.',
  decision_pace:'Não acelere sem um critério observável e um próximo passo aceito.'
 }
 const map={
  analytical:{guidance:'Organize a conversa por critérios, números e diferenças verificáveis.',proof:'Priorize custo/ha, comparativo, resultado e risco quando esses dados estiverem disponíveis.',pace:'Dê tempo para conferir premissas e comparar lado a lado.'},
  relational:{guidance:'Retome o histórico e os combinados antes de avançar para a proposta.',proof:'Priorize histórico, acordos cumpridos e referências confiáveis.',pace:'Construa alinhamento e confiança antes de acelerar.'},
  innovative:{guidance:'Explore diferenciação e um teste com critério de sucesso claro.',proof:'Priorize diferenciação comprovável e desenho de teste controlado.',pace:'Permita experimentar sem vender novidade pela novidade.'},
  conservative:{guidance:'Reduza percepção de risco e conecte a decisão ao que já funciona.',proof:'Priorize histórico, continuidade, referências e reversibilidade.',pace:'Avance por etapas e evite ruptura desnecessária.'}
 }
 const selected=map[mode.primary]||map.analytical
 return {known:true,primary:mode.primary,guidance:selected.guidance,proof_preference:selected.proof,decision_pace:selected.pace}
}

function questionSet({crop,solution,hasTiming,hasPrice,participantKnown,insufficient}){
 if(insufficient)return [
  'Qual é a principal prioridade deste produtor para esta safra e por quê?',
  'Que resultado faria esta visita valer a pena para ele?',
  'Quem participa da decisão e qual próximo passo seria realista agora?'
 ]
 const target=solution||'solução'
 const culture=crop?` no ${crop}`:''
 const questions=[]
 if(hasTiming&&crop&&solution)questions.push(`Na primeira aplicação do ${crop}, o que mais pesa na escolha do ${solution}: segurança de controle, resultado que já conhece ou investimento por hectare?`)
 else if(solution||crop)questions.push(`Qual problema ou risco${culture} precisa estar resolvido para a escolha do ${target} fazer sentido?`)
 if(hasPrice)questions.push('Quando você compara nossa proposta com a alternativa que está avaliando, onde percebe hoje a principal diferença de valor?')
 if(solution)questions.push(`Para avançar na decisão sobre ${solution} agora, o que precisa ficar mais claro ou comprovado?`)
 if(!participantKnown&&questions.length<3)questions.push('Quem participa desta decisão e quais critérios essa pessoa precisa validar?')
 if(questions.length<2)questions.push('Qual resultado concreto definiria um avanço útil nesta visita?')
 return unique(questions).slice(0,3)
}

export function buildPrepareVisitDecisionModel({contextSnapshot={},visitObjective='',behavioralProfile={},knowledgeRetrieval}={}){
 const selectedKnowledge=normalizeKnowledgeRetrieval(knowledgeRetrieval)
 const knowledge=allKnowledge(contextSnapshot)
 const statements=knowledge.map(item=>itemStatement(item)).filter(Boolean)
 const corpus=[visitObjective,...statements].join(' ')
 const crop=firstMatch(corpus,crops)
 const solution=firstMatch(corpus,solutions)
 const hasPlanted=statements.some(planted)||planted(visitObjective)
 const hasEmerged=statements.some(emerged)||emerged(visitObjective)
 const hasApplicationNear=statements.some(applicationNear)||applicationNear(visitObjective)
 const priceItems=knowledge.filter(item=>priceSignal(itemStatement(item)))
 const confirmedPrice=priceItems.some(item=>['FACT','VALIDATED_KNOWLEDGE'].includes(item.epistemic_state)&&explicitPriceObjection(itemStatement(item)))
 const hasPrice=priceItems.length>0||priceSignal(visitObjective)
 const participantKnown=statements.some(decisionParticipant)
 const proofs=historyProofs(contextSnapshot,{crop,solution})
 const hasHistory=list(contextSnapshot?.commercial_context?.business_history).length>0||list(contextSnapshot?.commercial_context?.opportunities).length>0
 const materialAgronomic=Boolean(crop&&(hasPlanted||hasEmerged||hasApplicationNear))
 const insufficient=!crop&&!solution&&!hasPrice&&!hasHistory&&!statements.length
 const questions=questionSet({crop,solution,hasTiming:hasApplicationNear,hasPrice,participantKnown,insufficient})
 const target=solution?`a decisão sobre ${solution}`:'a decisão comercial desta visita'
 const cropContext=crop?` no ${crop}`:''
 const objective=insufficient
  ?'Descobrir a prioridade real do produtor para esta safra e combinar um próximo passo proporcional ao que for confirmado.'
  :hasPrice
   ?`Entender se preço ou valor percebido está impedindo ${target}${cropContext} e construir valor antes de discutir condição comercial.`
   :`Esclarecer os critérios técnicos e comerciais para ${target}${cropContext} e combinar um próximo passo verificável.`
 const timingFacts=[]
 if(crop&&hasPlanted&&hasEmerged&&hasApplicationNear)timingFacts.push(`${crop[0].toUpperCase()}${crop.slice(1)} já plantado e emergido; primeira aplicação próxima.`)
 else if(crop&&hasPlanted&&hasEmerged)timingFacts.push(`${crop[0].toUpperCase()}${crop.slice(1)} já plantado e emergido.`)
 else if(crop&&hasPlanted)timingFacts.push(`Plantio do ${crop} já realizado.`)
 else if(crop&&hasEmerged)timingFacts.push(`${crop[0].toUpperCase()}${crop.slice(1)} já emergido.`)
 if(hasApplicationNear&&!(crop&&hasPlanted&&hasEmerged))timingFacts.push('Primeira aplicação próxima.')
 const whyNow=hasApplicationNear&&crop
  ?`O ${crop} ${hasEmerged?'já emergiu e ':''}a primeira aplicação está próxima, então a decisão tem janela operacional curta.`
  :materialAgronomic
   ?`O estágio atual do ${crop} muda o momento da conversa e deve ser confirmado antes de qualquer orientação técnica.`
   :hasPrice
    ?'A diferença comercial já apareceu na conversa e precisa ser qualificada antes de virar objeção ou desconto.'
    :'A visita é a oportunidade de transformar informação incompleta em critério e próximo passo claros.'
 const priceAttention=hasPrice
  ?confirmedPrice
   ?'Preço foi confirmado como objeção; reconstrua valor antes de discutir desconto.'
   :'Preço ou condição comercial apareceu como possível ponto de fricção, mas ainda não está confirmado como objeção principal.'
  :null
 const attention=unique([...timingFacts,priceAttention]).slice(0,2)
 const strategy=profileStrategy(behavioralProfile,proofs)
 const avoid=hasPrice
  ?'Não comece defendendo preço. Primeiro descubra o que está sendo comparado e qual resultado justificaria a escolha.'
  :solution
   ?`Não apresente ${solution} como resposta pronta. Primeiro confirme problema, critério e evidência necessária.`
   :'Não preencha a falta de histórico com argumentos genéricos; use a visita para confirmar prioridade e critério.'
 const commitmentTarget=hasApplicationNear
  ?'Sair sabendo qual critério define a escolha e com o próximo passo acordado antes da janela de aplicação.'
  :solution
   ?`Sair com o critério de decisão sobre ${solution} e um próximo passo com responsável e prazo.`
   :'Sair com a prioridade confirmada e um próximo passo específico, com responsável e prazo.'
 const thesis=hasPrice
  ?`A hipótese é que preço não deve ser tratado primeiro: é preciso descobrir se a fricção vem de custo absoluto ou de valor ainda não demonstrado para ${target}${cropContext}.`
  :`A conversa deve começar pelos critérios que definem ${target}${cropContext}, sem transformar contexto agronômico em prescrição.`
 const mainOpportunity=list(contextSnapshot?.commercial_context?.opportunities)[0]?.data||null
 return {
  version:prepareVisitQualityVersion,
  crop,solution,insufficient,has_history:hasHistory,
  agronomic_timing:{planting_completed:hasPlanted,emerged:hasEmerged,application_near:hasApplicationNear,material:materialAgronomic},
  commercial_signal:{price_present:hasPrice,price_status:confirmedPrice?'CONFIRMED_OBJECTION':hasPrice?'HYPOTHESIS':'ABSENT'},
  participant_known:participantKnown,
  objective,why_now:whyNow,attention,
  decision_questions:questions,
  thesis,avoid_guidance:avoid,commitment_target:commitmentTarget,
  proofs,profile_strategy:strategy,
  main_opportunity:mainOpportunity?{id:text(mainOpportunity.id,180)||null,title:text(mainOpportunity.title||mainOpportunity.category,500),stage:text(mainOpportunity.stage,80)||null}:{id:null,title:solution?`${solution[0].toUpperCase()}${solution.slice(1)}${cropContext} — decisão ainda em qualificação.`:'Prioridade da visita ainda em qualificação.',stage:null},
  problem_statement:hasPrice?`A diferença entre preço e valor percebido ainda precisa ser qualificada para ${target}${cropContext}.`:`Os critérios que definem ${target}${cropContext} ainda precisam ser confirmados.`,
  material_facts:attention,
  knowledge_status:selectedKnowledge.status,
  knowledge_refs:compactKnowledgeRefs(selectedKnowledge)
 }
}

function scoreQuestions(questions,tokens){
 if(questions.length<2||questions.length>3)return 0
 if(questions.some(item=>forbiddenFinalLanguage.test(item)||!/[?]$/.test(item)))return 0
 if(!tokens.length)return .85
 const grounded=questions.filter(question=>tokens.some(token=>normalized(question).includes(normalized(token)))).length
 return Math.min(1,.55+grounded/questions.length*.45)
}

function actionable(value){return Boolean(value)&&!genericOnly.test(text(value))&&!forbiddenFinalLanguage.test(text(value))}

export function evaluatePrepareVisitQuality(preparation,{model,profile,knowledgeRetrieval}={}){
 const tokens=[model?.crop,model?.solution].filter(Boolean)
 const display=[preparation?.objective,preparation?.why_now,preparation?.val_thesis,preparation?.objection_guidance,preparation?.commitment_target,...list(preparation?.golden_questions),...list(preparation?.material_attention)].map(text).filter(Boolean)
 const knowledgeState=knowledgeQualityState(knowledgeRetrieval??{status:model?.knowledge_status,items:model?.knowledge_refs},preparation?.knowledge_refs)
 const dimensions={
  CONTEXT_SPECIFICITY:model?.insufficient?1:tokens.length&&tokens.some(token=>display.some(value=>normalized(value).includes(normalized(token))))?1:.35,
  DECISION_RELEVANCE:actionable(preparation?.val_thesis)&&list(preparation?.golden_questions).length>=2?1:.35,
  QUESTION_QUALITY:scoreQuestions(list(preparation?.golden_questions),tokens),
  HISTORY_USAGE:model?.has_history?list(preparation?.proofs_to_take).length?1:.35:1,
  BEHAVIOR_ADAPTATION:Number(profile?.confidence)<.3?!preparation?.profile_approach?.known?1:.2:preparation?.profile_approach?.known?1:.45,
  AGRONOMIC_TIMING_USAGE:model?.agronomic_timing?.material?normalized(preparation?.why_now).includes(normalized(model?.crop||''))&&/janela|est[aá]gio|aplica[cç][aã]o|emerg/i.test(preparation?.why_now||'')?1:.2:1,
  ACTIONABILITY:actionable(preparation?.commitment_target)&&actionable(preparation?.objection_guidance)?1:.35,
  NON_GENERIC_LANGUAGE:display.some(value=>forbiddenFinalLanguage.test(value)||genericOnly.test(value))?0:1,
  KNOWLEDGE_USAGE:knowledgeState.score
 }
 const values=Object.values(dimensions)
 const score=Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(3))
 return {version:prepareVisitQualityVersion,threshold:.78,score,passed:score>=.78,dimensions,knowledge_usage:knowledgeState,forbidden_language_detected:display.filter(value=>forbiddenFinalLanguage.test(value)||genericOnly.test(value)).slice(0,5)}
}

export function isForbiddenPrepareVisitLanguage(value){return forbiddenFinalLanguage.test(text(value))||genericOnly.test(text(value))}
