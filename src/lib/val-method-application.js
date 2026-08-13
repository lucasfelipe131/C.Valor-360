const SPIN_KEYS=['situacao','problema','implicacao','necessidade']

const clean=value=>String(value??'').trim()
const first=(...values)=>values.map(clean).find(Boolean)||''
const normalized=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z_]/g,'')

function spinKey(value){
 const key=normalized(value)
 if(key.startsWith('situacao'))return 'situacao'
 if(key.startsWith('problema'))return 'problema'
 if(key.startsWith('implicacao'))return 'implicacao'
 if(key.startsWith('necessidade'))return 'necessidade'
 return ''
}

function questionFor(questions,key,brief,current){
 const match=(Array.isArray(questions)?questions:[]).find(item=>spinKey(item?.stage)===key)
 if(match)return {text:first(match.question),type:first(match.type,'aberta')}
 if(key===current&&brief?.question)return {text:first(brief.question),type:'aberta'}
 return {text:'',type:''}
}

const methodologyToSpin={
 preparar:'situacao',
 alinhar:'situacao',
 descobrir:'problema',
 dimensionar:'implicacao',
 construir_valor:'necessidade',
 propor:'necessidade',
 comprometer:'necessidade'
}

const spinMeta={
 situacao:{letter:'S',label:'Situação',description:'Contexto e decisão atual'},
 problema:{letter:'P',label:'Problema',description:'Dificuldade nas palavras do produtor'},
 implicacao:{letter:'I',label:'Implicação',description:'Efeito em valor, risco, tempo ou produção'},
 necessidade:{letter:'N',label:'Necessidade de solução',description:'Resultado e prova que justificam avançar'}
}

export function buildValMethodApplication({
 analyzed=false,questions=[],methodology={},brief={},conversation={},valueHypothesis={},profile={},approachPlan={},commitment={},opportunityReview={},commercialContext={},objective='',nextBestAction=''
}={}){
 const questionStage=(Array.isArray(questions)?questions:[]).map(item=>spinKey(item?.stage)).find(Boolean)
 const current=questionStage||methodologyToSpin[methodology.current]||'situacao'
 const currentIndex=Math.max(0,SPIN_KEYS.indexOf(current))
 const neutral='A VAL preencherá esta etapa depois de analisar o produtor e a situação atual.'
 const opportunity=opportunityReview.title?`Oportunidade em foco: ${opportunityReview.title}${opportunityReview.stage?` • ${opportunityReview.stage}`:''}.`:''
 const situation=analyzed?first([opportunity,clean(commercialContext.interpretation)].filter(Boolean).join(' '),brief.reason,objective):neutral
 const problem=analyzed?first(valueHypothesis.problem,brief.headline,'O problema ainda precisa ser confirmado com o produtor.'):neutral
 const implication=analyzed?first(valueHypothesis.impact,valueHypothesis.metric,'O impacto ainda precisa ser dimensionado com unidade, área e horizonte.'):neutral
 const need=analyzed?first(valueHypothesis.proof,valueHypothesis.metric,objective,'O resultado esperado e a forma de comprovação ainda precisam ser definidos.'):neutral
 const readings={situacao:situation,problema:problem,implicacao:implication,necessidade:need}

 const spin=SPIN_KEYS.map((key,index)=>({
  key,
  ...spinMeta[key],
  status:!analyzed?'waiting':index<currentIndex?'covered':index===currentIndex?'current':'next',
  reading:readings[key],
  question:questionFor(questions,key,brief,current)
 }))

 const commitmentObserved=Boolean(commitment.status)
 const opc=[
  {key:'objective',letter:'O',label:'Objetivo',value:analyzed?first(objective,brief.headline):neutral,note:'O que precisa ser compreendido ou decidido.'},
  {key:'process',letter:'P',label:'Processo',value:analyzed?first(brief.action,conversation.opening,methodology.reason):neutral,note:methodology.gate?`Avance quando: ${methodology.gate}`:'Tempo, pauta, dados e participantes necessários.'},
  {key:'commitment',letter:'C',label:'Compromisso',value:analyzed?(commitmentObserved?first(commitment.summary):`Ainda não registrado. ${first(nextBestAction,'Defina somente o próximo passo proporcional.')}`):neutral,note:commitmentObserved?first(commitment.detail,'Compromisso observado e registrado.'):'Não inventar avanço: registrar ação, responsável, prazo e evidência.'}
 ]

 const epa=[
  {key:'educate',letter:'E',label:'Educar',value:analyzed?first(brief.decisionBasis?.[0],brief.reason,'Apresente somente uma leitura sustentada pelos dados disponíveis.'):neutral,note:'Insight verificável, sem dar aula nem antecipar solução.'},
  {key:'personalize',letter:'P',label:'Personalizar',value:analyzed?first(profile.adaptation,approachPlan.prioritize,'Conecte a leitura à decisão e à preferência de prova deste produtor.'):neutral,note:approachPlan.proof?`Forma de prova: ${approachPlan.proof}`:'Conectar ao contexto, à decisão e à forma de prova.'},
  {key:'conduct',letter:'A',label:'Assumir a condução',value:analyzed?first(nextBestAction,brief.action,'Defina um próximo passo claro e proporcional.'):neutral,note:'Conduzir o processo, preservando a decisão do produtor.'}
 ]

 return {current,spin,opc,epa,analyzed}
}
