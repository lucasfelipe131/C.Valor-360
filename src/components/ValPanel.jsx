import React,{useEffect,useMemo,useRef,useState} from 'react'
import {
 AlertCircle,BrainCircuit,Camera,Check,ChevronRight,ClipboardCheck,DatabaseZap,
 FileSearch,FileText,FileUp,Gauge,ImagePlus,Lightbulb,LoaderCircle,MessageSquareText,Paperclip,Plus,Route,Send,
 ShieldCheck,Sparkles,Target,ThumbsDown,ThumbsUp,UserRoundSearch,X,Zap
} from 'lucide-react'
import {resolveOpportunityCandidate} from '../lib/opportunity-pipeline'

const MODES={
 daily:{label:'Resposta rápida',short:'Rápido',description:'Resposta curta pro contato de hoje.'},
 strategic:{label:'Planejar a conta',short:'Planejar',description:'Um pensamento estratégico completo da conta, explicado de forma simples.'}
}

const QUICK_PROMPTS=[
 {label:'Puxar assunto',icon:MessageSquareText,prompt:'Como eu puxo esse assunto de um jeito natural agora?'},
 {label:'Preparar visita',icon:Route,prompt:'Me ajuda a preparar a próxima visita, sem conversa enrolada.'},
 {label:'Próximo passo',icon:Target,prompt:'O que faz mais sentido eu fazer agora com este produtor?'}
]

const ATTACHMENT_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
const MAX_ATTACHMENT_BYTES=6_000_000
const attachmentStatusLabels={received:'Pronto pra ler',interpreted:'Leitura pronta',confirmed:'Confirmado como evidência',stored:'Só guardado',rejected:'Removido'}
const firstNameOf=client=>String(client?.name||'produtor').trim().split(/\s+/)[0]
const formatFileSize=value=>value>=1_000_000?(value/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' MB':Math.max(1,Math.round(value/1000))+' KB'
const mergeAttachment=(list,item)=>[item,...list.filter(entry=>entry.id!==item.id)].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
function fileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Não consegui abrir este arquivo.'));reader.readAsDataURL(file)})}
function imageFromUrl(url){return new Promise((resolve,reject)=>{const image=new window.Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Não consegui preparar esta foto.'));image.src=url})}
async function prepareAttachmentFile(file){
 if(!ATTACHMENT_TYPES.has(file.type))throw new Error('Use foto, PDF, Word, Excel, CSV ou TXT.')
 if(!file.type.startsWith('image/')||file.type==='image/gif'||file.size<=4_000_000){if(file.size>MAX_ATTACHMENT_BYTES)throw new Error('Cada arquivo pode ter até 6 MB.');return file}
 const url=URL.createObjectURL(file)
 try{const image=await imageFromUrl(url);const scale=Math.min(1,2200/image.naturalWidth,2200/image.naturalHeight);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));if(!blob)throw new Error('Não consegui reduzir esta foto.');if(blob.size>MAX_ATTACHMENT_BYTES)throw new Error('A foto ainda ficou maior que 6 MB.');return new File([blob],(file.name.replace(/\.[^.]+$/,'')||'foto')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified})}finally{URL.revokeObjectURL(url)}
}

function approach(client){
 const legacy=client?.primaryProfile&&!/^a (confirmar|classificar)/i.test(client.primaryProfile)?client.primaryProfile:''
 return legacy?'Use essa tag só como pista. Confirma na conversa o que importa pra ele hoje.':'Vai simples: entende o que pega hoje e combina só o próximo passo.'
}

function fallbackAdvice(client,mode,prompt=''){
 const firstName=client?.name?.split(' ')[0]||'Produtor'
 const candidate=resolveOpportunityCandidate(client)
 const opportunity=candidate?.title||''
 const noNeedDeclared=!opportunity&&client?.additionalNeedStatus==='none_declared'
 const strategic=mode==='strategic'
 const nextQuestion=opportunity?{stage:'problema',question:'Hoje, onde “'+String(opportunity).toLowerCase()+'” mais aperta na operação?',ask_when:'Depois de abrir o assunto.',purpose:'Ver se isso é prioridade de verdade.',evidence_needed:'Um exemplo recente e a decisão afetada.'}:noNeedDeclared?{stage:'situação',question:'Surgiu alguma prioridade desde a última conversa ou prefere manter como está?',ask_when:'No começo da conversa.',purpose:'Checar mudança sem forçar oportunidade.',evidence_needed:'Uma mudança dita pelo produtor ou a decisão de seguir como está.'}:{stage:'situação',question:'Qual decisão tá puxando mais sua atenção nesta safra?',ask_when:'Na abertura.',purpose:'Ouvir a prioridade dele.',evidence_needed:'Uma decisão concreta e o resultado buscado.'}
 const valueProblem=opportunity?opportunity:noNeedDeclared?'Nenhuma necessidade adicional declarada; oportunidade não confirmada.':'Oportunidade ainda não identificada.'
  return {
  answer:opportunity?'Com '+firstName+', eu iria direto: confirma se “'+String(opportunity).toLowerCase()+'” tá pegando mesmo e pede um exemplo recente. Se vier algo concreto, combina o próximo passo. Se não, não força proposta.':noNeedDeclared?firstName+' não declarou necessidade adicional na última vez. Só pergunta se mudou alguma coisa e, se estiver tudo certo, segue acompanhando sem cavar problema.':'Ainda não apareceu uma prioridade clara pra '+firstName+'. Começa leve: pergunta qual decisão tá puxando mais atenção nesta safra. Ouve primeiro; proposta vem depois.'
  executive_brief:{priority:opportunity?'esta_semana':noNeedDeclared?'sem_acao':'acompanhar',headline:opportunity?`Confirmar se ${String(opportunity).toLowerCase()} é prioridade real`:noNeedDeclared?'Nenhuma nova necessidade foi declarada':'Descobrir a prioridade antes de propor',reason:opportunity?`A hipótese “${opportunity}” existe, mas ainda precisa ser confirmada.`:'Não há oportunidade sustentada por evidência suficiente.',action:opportunity?'Agendar uma conversa breve e registrar prioridade, valor e próximo compromisso.':'Fazer uma pergunta aberta no próximo contato.',deadline:opportunity?'Nos próximos 3 dias':'No próximo contato',question:nextQuestion.question,decision_basis:[opportunity?`Oportunidade registrada → validar antes de propor.`:'Oportunidade não confirmada → iniciar pela descoberta.'],evidence_ids:[],missing_data:opportunity?['prioridade real','linha de base','critério de prova']:['prioridade declarada']},
  objective:opportunity?`Validar a necessidade em ${String(opportunity).toLowerCase()} e definir como a hipótese seria comprovada ou descartada.`:noNeedDeclared?'Confirmar se o contexto mudou sem converter a resposta negativa em hipótese comercial.':'Identificar uma prioridade real antes de abrir uma oportunidade.',
  decision_profile:{decision_context_summary:'Preferências decisórias ainda não confirmadas nesta decisão.',legacy_tag:client?.primaryProfile||'',evidence_ids:[],observed_dimensions:[],adaptation:approach(client)},
  next_question:nextQuestion,
  questions:opportunity?[nextQuestion,{stage:'implicação',question:'Como você compara os riscos de agir agora, esperar e manter a prática?',ask_when:'Depois de confirmar o problema.',purpose:'Evitar pressupor que mudar é melhor.',evidence_needed:'Custo, risco, janela e reversibilidade de cada alternativa.'}]:[nextQuestion],
  opportunity_review:{total_considered:Number(Boolean(opportunity)),open_count:Number(Boolean(opportunity)),selected_title:opportunity,selected_stage:opportunity?'Descoberta':'',selected_value:Number(client?.commercial?.openPotential||0),why_priority:opportunity?'É a única hipótese disponível; ainda precisa ser validada.':'Nenhuma oportunidade foi priorizada.',alternatives_considered:[]},
  conversation_plan:{opening:opportunity?`“${firstName}, quero confirmar se ${String(opportunity).toLowerCase()} ainda merece prioridade.”`:`“${firstName}, qual decisão mais merece atenção neste ciclo?”`,steps:[{stage:'abertura',goal:'Alinhar o objetivo.',suggested_line:'“Pode ser direto? Quero só entender o que pega mais e combinar o próximo passo.”',advance_signal:'O produtor confirma tema e tempo.',if_resistance:'Combine outro momento.'},{stage:'diagnóstico',goal:'Confirmar contexto e impacto.',suggested_line:nextQuestion.question,advance_signal:'Surge uma decisão concreta afetada.',if_resistance:'Volte a uma pergunta aberta.'},{stage:'valor',goal:'Definir resultado e prova.',suggested_line:'“Que resultado faria isso valer a pena pra você?”',advance_signal:'Há métrica e critério de comparação.',if_resistance:'Proponha apenas levantar a linha de base.'},{stage:'fechamento',goal:'Definir o menor próximo compromisso.',suggested_line:'“Qual próximo passo faz sentido agora e quem entra junto?”',advance_signal:'Responsável e prazo definidos.',if_resistance:'Mantenha acompanhamento sem proposta.'}],closing_options:[{when:'Quando prioridade e prova estiverem confirmadas.',suggested_line:'“Posso organizar uma proposta com essas premissas?”',commitment:'Definir data de revisão.'},{when:'Quando faltarem dados.',suggested_line:'“Levantamos os dados e decidimos depois, sem compromisso?”',commitment:'Definir dado, responsável e prazo.'}],do_not_say:['Não afirmar que a oportunidade já está confirmada.','Não prometer resultado sem linha de base.']},
  constructive_tension:{status:'not_applicable',consent_status:'unknown',permission_prompt:'Posso testar uma hipótese quando tivermos uma linha de base?',evidence_ids:[],reframe:'',autonomy:'A escolha continua com o produtor.',stop_reason:'Falta evidência comparável e consentimento registrado.',uncertainty:'A oportunidade ainda não foi confirmada.'},
  value_hypothesis:{problem:valueProblem,baseline:'Não confirmada.',act_now:opportunity?'A medir.':'Não aplicável antes da descoberta.',wait:opportunity?'A medir.':'Manter acompanhamento sem presumir perda.',maintain:opportunity?'A medir.':'Respeitar a situação atual.',impact_to_quantify:opportunity?'R$/ha, sc/ha, tempo, janela e risco.':'Nenhum impacto a quantificar sem oportunidade.',value_metric:opportunity?'Valor realizado contra a mesma linha de base.':'A definir após uma prioridade real.',time_horizon:'A definir.',proof_plan:opportunity?'Comparação controlada antes de escalar.':'Não abrir prova comercial antes da descoberta.',double_counting_guard:'Não somar duas vezes o mesmo benefício.',uncertainty:opportunity?'Sem contrafactual não há estimativa defensável.':'Ausência de oportunidade confirmada.'},
  next_best_action:opportunity?`Convide ${firstName} para uma conversa de 20 minutos e defina uma única métrica que será levantada antes da visita.`:noNeedDeclared?'Mantenha o acompanhamento combinado e só reabra a descoberta se houver mudança de contexto ou permissão do produtor.':'Faça uma pergunta aberta de situação antes de registrar qualquer oportunidade.',
  commitment:null,
  confidence:{level:'not_calibrated',rationale:'Pré-análise local sem validação retrospectiva.',evidence_quality:'Hipótese cadastrada ainda não confirmada.',relevance:'A validar com o produtor.',freshness:'Datas completas não disponíveis.',source_agreement:'Não avaliada.',missing_data:['linha de base','alternativas comparáveis','preferência de prova'],calibration_status:'not_calibrated'},
  assumptions:[
   'A oportunidade cadastrada ainda precisa ser validada pelo produtor.',
   prompt?'A recomendação considera o pedido atual, mas não substitui diagnóstico de campo.':'Ainda não há uma pergunta específica do consultor.'
  ],
  evidence_used:[{claim_supported:opportunity?`Hipótese cadastrada: ${opportunity}`:noNeedDeclared?'Nenhuma necessidade adicional foi declarada na última resposta.':'Oportunidade ainda em descoberta',quality:'low',uncertainty:opportunity?'Precisa ser confirmada pelo produtor.':'O contexto pode mudar e deve ser verificado sem pressão.'}],
  human_review:{required:false,reason:'Pré-análise comercial interna.',required_role:'none',status:'not_required'},blocked_actions:[],
  guardrails:[
   'Validar toda premissa financeira com dados reais da propriedade.',
   'Não transformar hipótese em recomendação agronômica.',
   'Manter a decisão final com consultor e produtor.'
  ]
 }
}

function textValue(value){
 if(value===null||value===undefined)return ''
 if(typeof value==='string'||typeof value==='number')return String(value)
 if(typeof value==='object')return [value.title,value.label,value.claim_supported,value.observation,value.rationale,value.action,value.source,value.fact,value.detail,value.value,value.hypothesis,value.adaptation,value.question,value.reframe,value.problem,value.value_metric,value.uncertainty].filter(item=>typeof item==='string'||typeof item==='number').join(' — ')||'Informação estruturada disponível'
 return String(value)
}

function asList(value,fallback=[]){
 const list=Array.isArray(value)?value:(value?[value]:fallback)
 return list.map(textValue).filter(Boolean)
}

const sourceLabels={client_record:'cadastro do cliente',producer_questionnaire:'Produtor 360',business_history:'histórico de negócios',visit:'visita',interaction:'interação',opportunity:'oportunidade',field_report:'relatório de campo',soil_analysis:'análise de solo',ndvi:'NDVI',manual_record:'núcleo técnico do VALOR 360',producer_statement:'declaração do produtor',approved_playbook:'playbook aprovado',consultant_attachment:'arquivo do consultor',missing:'dado ausente',unknown:'origem não confirmada'}
const coverageLabels={questionnaire:'respostas 360',businessEvents:'negócios',visits:'visitas',interactions:'interações',opportunities:'oportunidades',properties:'propriedades',fieldReports:'relatórios de campo',soilAnalyses:'análises de solo',ndvi:'leituras NDVI',manualRecords:'registros técnicos',signals:'sinais',memories:'memórias',priorRecommendations:'análises anteriores',attachments:'arquivos confirmados',currentAttachments:'arquivos desta pergunta'}
const confidenceLabels={not_calibrated:'não calibrada',insufficient:'insuficiente',low:'baixa',moderate:'moderada',high:'alta'}
const reviewerLabels={technical_reviewer:'responsável técnico habilitado',manager:'gestor',consultant:'consultor',none:'não exigido'}
function dateValue(value){if(!value||value==='unknown')return 'data não informada';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('pt-BR')}
function evidenceData(value,fallback=[]){
 const list=Array.isArray(value)?value:(value?[value]:fallback)
 return list.map((item,index)=>item&&typeof item==='object'?{
  id:item.id||item.source_id||`evidencia-${index}`,
  summary:textValue(item),
  meta:[item.id&&`ID: ${item.id}`,item.source_type&&`Fonte: ${sourceLabels[item.source_type]||item.source_type}`,item.source_id&&`Ref. da fonte: ${item.source_id}`,item.observed_at&&`Observado: ${dateValue(item.observed_at)}`,item.quality&&`Qualidade: ${confidenceLabels[item.quality]||item.quality}`,item.relevance&&`Relevância: ${confidenceLabels[item.relevance]||item.relevance}`,item.direct_observation===true?'Observação direta':item.direct_observation===false?'Não é observação direta':''].filter(Boolean).join(' • '),
  uncertainty:textValue(item.uncertainty)
 }:{id:`evidencia-${index}`,summary:textValue(item),meta:'Origem estruturada não disponível',uncertainty:''}).filter(item=>item.summary)
}

function confidenceData(value){
 if(value&&typeof value==='object'){
  const labels={not_calibrated:'Não calibrada',insufficient:'Insuficiente',low:'Baixa',moderate:'Moderada',high:'Alta'}
  const arcs={not_calibrated:45,insufficient:55,low:105,moderate:210,high:305}
  return {label:labels[value.level]||'Não calibrada',arc:arcs[value.level]||45,rationale:textValue(value.rationale),missing:asList(value.missing_data),breakdown:[value.evidence_quality&&`Qualidade da evidência: ${value.evidence_quality}`,value.relevance&&`Relevância: ${value.relevance}`,value.freshness&&`Frescor: ${value.freshness}`,value.source_agreement&&`Concordância entre fontes: ${value.source_agreement}`,value.calibration_status&&`Calibração: ${confidenceLabels[value.calibration_status]||String(value.calibration_status).replace(/_/g,' ')}`].filter(Boolean)}
 }
 const number=Number(value);const normalized=Number.isFinite(number)?Math.max(0,Math.min(100,Math.round(number<=1?number*100:number))):0
 return {label:normalized>=75?'Alta':normalized>=50?'Moderada':normalized?'Baixa':'Insuficiente',arc:normalized*3.6,rationale:'Indicador legado sem calibração.',missing:[],breakdown:['Calibração: não calibrada']}
}

function profileData(value){
 if(value&&typeof value==='object'&&!Array.isArray(value)){const dimensions=(Array.isArray(value.observed_dimensions)?value.observed_dimensions:[]).map((item,index)=>({id:`dimensao-${index}`,summary:`${String(item.dimension||'dimensão').replace(/_/g,' ')}: ${textValue(item.observation)}`,meta:[item.source_id&&`Fonte: ${item.source_id}`,item.observed_at&&`Observado: ${dateValue(item.observed_at)}`,item.expires_at&&`Válido até: ${dateValue(item.expires_at)}`,item.confidence&&`Confiança: ${confidenceLabels[item.confidence]||item.confidence}`].filter(Boolean).join(' • ')}));return {
  hypothesis:textValue(value.decision_context_summary)||textValue(value.hypothesis)||'Perfil em validação',
  evidence:[...(value.legacy_tag?[{id:'legacy-tag',summary:`Tag legada: ${value.legacy_tag}`,meta:`Origem: ${value.tag_origin||'não informada'} • ${value.self_reported?'autodeclarada':'não confirmada como autodeclaração'}`}]:[]),...dimensions],
  adaptation:textValue(value.adaptation)||'Confirmar preferência de decisão antes de adaptar a conversa.',
  referenceIds:asList(value.evidence_ids)
 }}
 return {hypothesis:textValue(value)||'Perfil em validação',evidence:[],adaptation:'Confirmar preferência de decisão antes de adaptar a conversa.',referenceIds:[]}
}

function valueData(value){
 if(value&&typeof value==='object'&&!Array.isArray(value))return {
  problem:textValue(value.problem)||'Impacto ainda a validar',
  impact:textValue(value.impact_to_quantify)||'',
  metric:textValue(value.value_metric)||'',
  proof:textValue(value.proof_plan)||'',
  alternatives:[value.act_now&&`Agir agora: ${value.act_now}`,value.wait&&`Esperar: ${value.wait}`,value.maintain&&`Manter: ${value.maintain}`].filter(Boolean),
  details:[value.baseline&&`Linha de base: ${value.baseline}`,value.time_horizon&&`Horizonte: ${value.time_horizon}`,value.double_counting_guard&&`Proteção contra dupla contagem: ${value.double_counting_guard}`,value.uncertainty&&`Incerteza: ${value.uncertainty}`].filter(Boolean)
 }
 return {problem:textValue(value)||'Impacto ainda a validar',impact:'',metric:'',proof:'',alternatives:[],details:[]}
}

function tensionData(value){
 if(value&&typeof value==='object'&&!Array.isArray(value))return {
  status:textValue(value.status),
  consent:textValue(value.consent_status),
  consentEvidence:textValue(value.consent_evidence_id),
  permission:textValue(value.permission_prompt)||textValue(value.permission),
  evidence:asList(value.evidence_ids).join(', '),
  reframe:textValue(value.reframe),
  autonomy:textValue(value.autonomy),
  stop:textValue(value.stop_reason),
  uncertainty:textValue(value.uncertainty)
 }
 return {status:'',consent:'',consentEvidence:'',permission:'',evidence:'',reframe:textValue(value),autonomy:'',stop:'',uncertainty:''}
}

function commitmentData(value){
 if(value&&typeof value==='object')return {status:textValue(value.status),summary:textValue(value.action)||'Nenhum compromisso recomendado.',detail:[value.responsible&&`Responsável: ${value.responsible}`,value.deadline&&`Prazo: ${value.deadline}`,value.evidence&&`Evidência: ${value.evidence}`,value.next_decision&&`Próxima decisão: ${value.next_decision}`].filter(Boolean).join(' • ')}
 return {status:'',summary:textValue(value)||'Nenhum compromisso recomendado.',detail:''}
}

function questionData(value,fallback=[]){
 const list=Array.isArray(value)&&value.length?value:fallback
 return list.map((item,index)=>item&&typeof item==='object'?{
  id:`${item.stage||'pergunta'}-${index}`,
  stage:textValue(item.stage)||'pergunta',
  question:textValue(item.question)||textValue(item),
  when:textValue(item.ask_when),
  purpose:textValue(item.purpose),
  evidence:textValue(item.evidence_needed)
 }:{id:`pergunta-${index}`,stage:'pergunta',question:textValue(item),when:'',purpose:'',evidence:''}).filter(item=>item.question)
}

function conversationData(value){
 const source=value&&typeof value==='object'?value:{}
 return {opening:textValue(source.opening),steps:(Array.isArray(source.steps)?source.steps:[]).map((item,index)=>({id:`${item.stage||'passo'}-${index}`,stage:textValue(item.stage)||'passo',goal:textValue(item.goal),line:textValue(item.suggested_line),signal:textValue(item.advance_signal),resistance:textValue(item.if_resistance)})),closing:(Array.isArray(source.closing_options)?source.closing_options:[]).map((item,index)=>({id:`fechamento-${index}`,when:textValue(item.when),line:textValue(item.suggested_line),commitment:textValue(item.commitment)})),avoid:asList(source.do_not_say)}
}

function opportunityData(value){
 const source=value&&typeof value==='object'?value:{}
 return {total:Number(source.total_considered||0),open:Number(source.open_count||0),title:textValue(source.selected_title),stage:textValue(source.selected_stage),value:Number(source.selected_value||0),reason:textValue(source.why_priority),alternatives:asList(source.alternatives_considered)}
}

function modeLabel(value){
 if(!value)return 'Pré-análise local'
 const normalized=String(value).toLowerCase()
 if(normalized.includes('strateg'))return 'Estratégico'
 if(normalized==='openai')return 'OpenAI ativa'
 if(normalized.includes('locked'))return 'Aguardando segurança/banco'
 if(normalized.includes('demonstr'))return 'Modo demonstrativo'
 if(normalized.includes('daily')||normalized.includes('diár')||normalized.includes('diar'))return 'Diário'
 if(normalized.includes('fallback')||normalized.includes('local'))return 'Modo resiliente'
 return String(value)
}

const priorityLabels={imediata:'Prioridade imediata',esta_semana:'Fazer nesta semana',acompanhar:'Acompanhar',sem_acao:'Sem ação comercial agora'}
function briefData(advice){
 const source=advice?.executive_brief||{}
  return {
  priority:source.priority||'acompanhar',
  headline:textValue(source.headline)||textValue(advice?.answer).split(/[.!?]/)[0]||'Próxima ação em definição',
  reason:textValue(source.reason)||textValue(advice?.objective),
  action:textValue(source.action)||textValue(advice?.next_best_action),
  deadline:textValue(source.deadline)||'No próximo contato',
  question:textValue(source.question)||textValue(advice?.next_question?.question),
  decisionBasis:asList(source.decision_basis).slice(0,3),
  evidenceIds:asList(source.evidence_ids).slice(0,3),
  missing:asList(source.missing_data,advice?.confidence?.missing_data||[]).slice(0,3)
 }
}

export default function ValPanel({clients=[],selectedClient,onSelect}){
 const [selected,setSelected]=useState(selectedClient?.id||clients[0]?.id||'')
 const [mode,setMode]=useState('daily')
 const [message,setMessage]=useState('')
 const [response,setResponse]=useState(null)
 const [status,setStatus]=useState({loading:true,data:null,error:''})
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [feedback,setFeedback]=useState({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})
 const [attachments,setAttachments]=useState([])
 const [savedAttachments,setSavedAttachments]=useState([])
 const [attachmentMenu,setAttachmentMenu]=useState(false)
 const [attachmentState,setAttachmentState]=useState({loading:false,uploading:false,error:''})
 const cameraInput=useRef(null)
 const photoInput=useRef(null)
 const documentInput=useRef(null)

 useEffect(()=>{if(selectedClient?.id)setSelected(selectedClient.id)},[selectedClient])

 useEffect(()=>{
  const controller=new AbortController()
  const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal
  fetch('/api/val/status',{signal})
   .then(async result=>{
    if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
    if(!result.ok)throw new Error('status indisponível')
    return result.json()
   })
   .then(data=>setStatus({loading:false,data,error:''}))
   .catch(fetchError=>{if(fetchError.name!=='AbortError')setStatus({loading:false,data:null,error:'A VAL está operando com contexto local.'})})
  return()=>controller.abort()
 },[])

 useEffect(()=>{
  setResponse(null)
  setError('')
  setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})
 },[selected,mode])

 useEffect(()=>{
  if(!selected){setSavedAttachments([]);return}
  const controller=new AbortController()
  setAttachmentState(current=>({...current,loading:true,error:''}))
  fetch('/api/val/attachments?clientId='+encodeURIComponent(selected),{signal:controller.signal})
   .then(async result=>{const payload=await result.json().catch(()=>({}));if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!result.ok)throw new Error(payload.error||'Não consegui buscar os arquivos.');return payload})
   .then(payload=>{setSavedAttachments(payload.attachments||[]);setAttachmentState(current=>({...current,loading:false,error:''}))})
   .catch(fetchError=>{if(fetchError.name!=='AbortError')setAttachmentState(current=>({...current,loading:false,error:fetchError.message}))})
  return()=>controller.abort()
 },[selected])

 const client=useMemo(()=>clients.find(item=>item.id===selected)||clients[0]||null,[clients,selected])
 const localAdvice=useMemo(()=>fallbackAdvice(client,mode),[client,mode])
 const advice=response?.advice||localAdvice
 const confidence=confidenceData(advice?.confidence)
 const questionPlan=[...(advice?.next_question?[advice.next_question]:[]),...(Array.isArray(advice?.questions)?advice.questions:[])].filter((item,index,list)=>list.findIndex(candidate=>candidate?.question===item?.question)===index)
 const questions=questionData(questionPlan,response?[]:localAdvice.questions)
 const profile=profileData(advice?.decision_profile)
 const valueHypothesis=valueData(advice?.value_hypothesis)
 const tension=tensionData(advice?.constructive_tension)
 const commitment=commitmentData(advice?.commitment)
 const conversation=conversationData(advice?.conversation_plan)
 const opportunityReview=opportunityData(advice?.opportunity_review)
 const evidence=evidenceData(advice?.evidence_used,response?[]:localAdvice.evidence_used)
 const brief=briefData(advice)
 const briefEvidence=(brief.evidenceIds.length?brief.evidenceIds.map(id=>evidence.find(item=>item.id===id)).filter(Boolean):evidence).slice(0,3)
 const assumptions=asList(advice?.assumptions,localAdvice.assumptions)
 const guardrails=asList(advice?.guardrails,localAdvice.guardrails)
 const blockedActions=asList(advice?.blocked_actions)
 const humanReview=advice?.human_review||localAdvice.human_review
 const configured=Boolean(status.data?.configured)
 const engineReady=configured&&!status.error
 const recommendationRegistered=Boolean(response?.recommendationId)
 const contextSources=Object.entries(response?.contextCoverage||{}).filter(([key,value])=>key!=='profile'&&Number(value)>0).map(([key,value])=>({key,label:coverageLabels[key]||key,value}))
 const interpretedAttachments=Array.isArray(response?.attachments)?response.attachments.filter(item=>item.status!=='received'||item.analysis?.summary):[]

 const uploadFiles=async event=>{
  const files=Array.from(event.target.files||[]);event.target.value='';setAttachmentMenu(false)
  if(!files.length||attachmentState.uploading)return
  const slots=Math.max(0,3-attachments.length);if(!slots){setAttachmentState(current=>({...current,error:'Envie no máximo 3 arquivos por pergunta.'}));return}
  setAttachmentState(current=>({...current,uploading:true,error:''}))
  try{
   for(const original of files.slice(0,slots)){
    const file=await prepareAttachmentFile(original);const dataUrl=await fileDataUrl(file)
    const result=await fetch('/api/val/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client.id,originalName:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl}),signal:AbortSignal.timeout(60000)})
    const payload=await result.json().catch(()=>({}));if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!result.ok)throw new Error(payload.error||'Não consegui enviar este arquivo.')
    setAttachments(current=>current.some(item=>item.id===payload.attachment.id)?current:[...current,payload.attachment].slice(0,3))
    setSavedAttachments(current=>mergeAttachment(current,payload.attachment))
   }
  }catch(uploadError){setAttachmentState(current=>({...current,error:uploadError.message}))}finally{setAttachmentState(current=>({...current,uploading:false}))}
 }

 const updateAttachmentStatus=async(id,statusValue)=>{
  setAttachmentState(current=>({...current,error:''}))
  try{const result=await fetch('/api/val/attachments',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:statusValue}),signal:AbortSignal.timeout(15000)});const payload=await result.json().catch(()=>({}));if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!result.ok)throw new Error(payload.error||'Não consegui atualizar este arquivo.');const item=payload.attachment;if(statusValue==='rejected'){setAttachments(current=>current.filter(entry=>entry.id!==id));setSavedAttachments(current=>current.filter(entry=>entry.id!==id))}else{setAttachments(current=>current.map(entry=>entry.id===id?item:entry));setSavedAttachments(current=>mergeAttachment(current,item));setResponse(current=>current?{...current,attachments:(current.attachments||[]).map(entry=>entry.id===id?item:entry)}:current)}}catch(updateError){setAttachmentState(current=>({...current,error:updateError.message}))}
 }

 const ask=async(rawMessage,requestedMode=mode)=>{
  const attachmentIds=attachments.map(item=>item.id).filter(Boolean).slice(0,3)
  const prompt=String(rawMessage||message||(attachmentIds.length?'Leia esses arquivos e me diga o que importa.':'')).trim()
  if((!prompt&&!attachmentIds.length)||!client||loading)return
  setLoading(true)
  setError('')
  setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})
  try{
   const result=await fetch('/api/val/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({clientId:client.id,client,message:prompt,attachmentIds,mode:requestedMode}),
    signal:AbortSignal.timeout(120000)
   })
   const payload=await result.json().catch(()=>({}))
   if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   if(!result.ok)throw new Error(payload?.error||payload?.message||'A VAL não respondeu agora.')
   if(!payload?.advice)throw new Error('A resposta chegou incompleta.')
   setResponse(payload)
   setMessage('')
   setAttachments(payload.engineMode==='openai'?[]:(payload.attachments||attachments))
   ;(payload.attachments||[]).forEach(item=>setSavedAttachments(current=>mergeAttachment(current,item)))
  }catch(requestError){
   if(attachmentIds.length)setError(requestError.message+' Os arquivos continuam salvos com este produtor; tente de novo.')
   else{setResponse({recommendationId:null,engineMode:'fallback',model:null,warning:'Resposta construída com o contexto disponível neste dispositivo.',advice:fallbackAdvice(client,requestedMode,prompt)});setError(requestError.message+' Mantive uma orientação segura em modo resiliente.')}
  }finally{setLoading(false)}
 }

 const chooseMode=value=>setMode(value)

 const sendFeedback=async event=>{
  event.preventDefault()
  if(!response?.recommendationId||feedback.rating===null||feedback.sending)return
  setFeedback(current=>({...current,sending:true,error:''}))
  try{
   const result=await fetch('/api/val/feedback',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     recommendationId:response.recommendationId,
     rating:feedback.rating,
     outcome:feedback.outcome||null,
     notes:feedback.notes.trim()||null
    }),
    signal:AbortSignal.timeout(10000)
   })
   if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   if(!result.ok)throw new Error('Não foi possível registrar agora.')
   setFeedback(current=>({...current,sending:false,sent:true,error:''}))
  }catch(feedbackError){setFeedback(current=>({...current,sending:false,error:feedbackError.message}))}
 }

 if(!client)return <section className="val-workspace val-empty-state"><BrainCircuit/><h2>A VAL precisa de contexto</h2><p>Cadastre um produtor para iniciar uma recomendação orientada por dados.</p></section>

 return <section className="val-workspace" aria-labelledby="val-workspace-title">
  <header className="val-hero">
   <div className="val-hero-copy">
    <div className="val-brand-line"><span className="val-orbit"><BrainCircuit aria-hidden="true"/></span><div><span className="val-kicker">VAL • SUA PARCEIRA DE CAMPO</span><h2 id="val-workspace-title">Converse com a VAL.</h2></div></div>
    <p>Pergunte como você falaria com alguém do time. A VAL lê o contexto e vai direto no que importa.</p>
    <div className="val-engine-line" aria-live="polite">
     <span className={`val-live-pill ${engineReady?'is-ready':''}`}><i/>{status.loading?'Preparando a VAL':engineReady?'VAL pronta':'VAL disponível'}</span>
     <span>{status.data?.mode?modeLabel(status.data.mode):'Contexto protegido'}</span>
     {status.data?.knowledgeBase&&<span>Base de conhecimento cadastrada</span>}
    </div>
   </div>
   <aside className="val-context-card" aria-label="Contexto do produtor selecionado">
    <div className="val-context-head"><span>CONVERSANDO SOBRE</span><UserRoundSearch aria-hidden="true"/></div>
    <div className="val-client-identity"><span>{client.name.split(' ').slice(0,2).map(part=>part[0]).join('').toUpperCase()}</span><div><small>{client.commercial?.property||'Propriedade'}</small><h3>{client.name}</h3></div></div>
    <dl className="val-context-facts">
     <div><dt>Tag Produtor 360</dt><dd>{client.primaryProfile||'Em leitura'}</dd></div>
     <div><dt>Último contato</dt><dd>{client.commercial?.lastContactDays!==null&&client.commercial?.lastContactDays!==undefined&&Number.isFinite(Number(client.commercial.lastContactDays))?`${client.commercial.lastContactDays} dias`:'Não informado'}</dd></div>
    </dl>
    <div className="val-context-opportunity"><span>Oportunidade observada</span><b>{client.commercial?.opportunity||'Descoberta inicial'}</b></div>
   </aside>
  </header>

  <div className="val-command-zone">
   <div className="val-toolbar">
    <label className="val-client-select"><span>Produtor</span><select value={selected} onChange={event=>setSelected(event.target.value)} aria-label="Selecionar produtor">{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="val-mode-picker"><div><span>Tipo de ajuda</span><small>{MODES[mode].description}</small></div><div role="group" aria-label="Escolher modo da VAL">{Object.entries(MODES).map(([value,item])=><button key={value} type="button" disabled={loading} className={mode===value?'active':''} aria-pressed={mode===value} onClick={()=>chooseMode(value)}>{value==='daily'?<Zap/>:<BrainCircuit/>}{item.short}</button>)}</div></div>
   </div>

   <div className="val-quick-prompts" aria-label="Perguntas rápidas">{QUICK_PROMPTS.map(item=>{const Icon=item.icon;return <button key={item.label} type="button" onClick={()=>ask(item.prompt)} disabled={loading}><Icon aria-hidden="true"/><span>{item.label}</span><ChevronRight aria-hidden="true"/></button>})}</div>

   <form className="val-composer" onSubmit={event=>{event.preventDefault();ask(message)}}>
    <div className="val-attach-control">
     <button className="val-attach-button" type="button" onClick={()=>setAttachmentMenu(value=>!value)} disabled={loading||attachmentState.uploading} aria-label="Adicionar foto ou documento" aria-expanded={attachmentMenu}><Plus aria-hidden="true"/></button>
     {attachmentMenu&&<div className="val-attach-menu" role="menu">
      <button type="button" role="menuitem" onClick={()=>cameraInput.current?.click()}><Camera/><span><b>Tirar foto</b><small>Abrir a câmera</small></span></button>
      <button type="button" role="menuitem" onClick={()=>photoInput.current?.click()}><ImagePlus/><span><b>Escolher foto</b><small>Usar uma imagem salva</small></span></button>
      <button type="button" role="menuitem" onClick={()=>documentInput.current?.click()}><FileUp/><span><b>Enviar documento</b><small>PDF, Word, Excel, CSV ou TXT</small></span></button>
     </div>}
     <input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={uploadFiles}/>
     <input ref={photoInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={uploadFiles}/>
     <input ref={documentInput} className="sr-only" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,text/csv,text/plain" multiple onChange={uploadFiles}/>
    </div>
    <label><span className="sr-only">Pergunte à VAL sobre este produtor</span><textarea rows="2" value={message} maxLength="800" onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask(message)}}} placeholder={'Pergunte ou conte algo sobre '+firstNameOf(client)+'…'}/></label>
    <button type="submit" disabled={(!message.trim()&&!attachments.length)||loading||attachmentState.uploading} aria-label="Enviar para a VAL">{loading?<LoaderCircle className="val-spinner" aria-hidden="true"/>:<Send aria-hidden="true"/>}<span>{loading?'Pensando':'Enviar'}</span></button>
   </form>
   {attachments.length>0&&<div className="val-attachment-tray" aria-label="Arquivos desta pergunta">{attachments.map(item=><article key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<span><b>{item.originalName}</b><small>{formatFileSize(item.sizeBytes)} • {attachmentStatusLabels[item.status]||item.status}</small></span><button type="button" onClick={()=>setAttachments(current=>current.filter(entry=>entry.id!==item.id))} aria-label={'Tirar '+item.originalName+' desta pergunta'}><X/></button></article>)}</div>}
   {attachmentState.uploading&&<div className="val-file-progress" role="status"><LoaderCircle className="val-spinner"/><span>Enviando arquivo…</span></div>}
   {attachmentState.error&&<div className="val-warning val-file-warning" role="alert"><AlertCircle/><span>{attachmentState.error}</span></div>}
   <details className="val-files-panel">
    <summary><Paperclip/><span>Arquivos de {firstNameOf(client)}</span><b>{savedAttachments.length}</b></summary>
    {attachmentState.loading?<p>Buscando arquivos…</p>:savedAttachments.length?<ul>{savedAttachments.map(item=><li key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<span><a href={'/api/val/attachments/'+item.id} target="_blank" rel="noreferrer">{item.originalName}</a><small>{formatFileSize(item.sizeBytes)} • {attachmentStatusLabels[item.status]||item.status}</small></span>{!attachments.some(entry=>entry.id===item.id)&&attachments.length<3&&<button type="button" onClick={()=>setAttachments(current=>[...current,item].slice(0,3))}>Usar</button>}</li>)}</ul>:<p>Nenhum arquivo salvo ainda.</p>}
   </details>
   {loading&&<div className="val-thinking" role="status"><span/><div><b>A VAL tá olhando tudo.</b><small>Já volto com uma resposta curta e o próximo passo.</small></div></div>}
   {(error||response?.warning)&&<div className="val-warning" role="status"><AlertCircle aria-hidden="true"/><span>{error||response.warning}</span></div>}
  </div>

  <div className="val-response" aria-busy={loading}>
   <span className="sr-only" role="status">{loading?'Análise em andamento.':recommendationRegistered?'Nova recomendação registrada.':response?'Nova orientação não registrada.':'Pré-análise local.'}</span>
   <div className="val-response-heading"><div><span className="val-section-icon"><Sparkles/></span><div><span>{recommendationRegistered?'RESPOSTA SALVA':response?'RESPOSTA LOCAL':'PRA COMEÇAR'}</span><h3>Minha leitura</h3></div></div><div className="val-response-meta"><span>Sobre {firstNameOf(client)}</span></div></div>
   <div className="val-internal-banner"><ShieldCheck/><span><b>Rascunho de trabalho</b><small>Confira antes de usar com o produtor.</small></span></div>

   <section className="val-chat-answer" aria-label="Resposta principal da VAL">
    <span className="val-chat-avatar">VAL</span>
    <div><small>VAL</small><p>{advice.answer}</p>{brief.question&&<div className="val-ready-question"><MessageSquareText/><span><small>Se quiser uma frase pronta</small><b>{brief.question}</b></span></div>}</div>
   </section>

   {interpretedAttachments.length>0&&<section className="val-attachment-reading" aria-label="Leitura dos arquivos">
    <header><FileSearch/><span><small>ARQUIVOS DESTA PERGUNTA</small><h3>O que eu consegui ler</h3></span></header>
    <p>Confirme só se a leitura bater com o original. Foto e anotação ajudam a organizar a conversa, mas não viram diagnóstico.</p>
    <ul>{interpretedAttachments.map(item=><li key={item.id}><div>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<span><a href={'/api/val/attachments/'+item.id} target="_blank" rel="noreferrer">{item.originalName}</a><small>{attachmentStatusLabels[item.status]||item.status}</small></span></div>{item.analysis?.summary&&<p><b>Li:</b> {item.analysis.summary}</p>}{item.analysis?.uncertainty&&<p><b>Falta confirmar:</b> {item.analysis.uncertainty}</p>}{item.status==='interpreted'&&<div className="val-file-actions"><button type="button" onClick={()=>updateAttachmentStatus(item.id,'confirmed')}><Check/>Confirmar como evidência</button><button type="button" onClick={()=>updateAttachmentStatus(item.id,'stored')}>Só guardar</button></div>}</li>)}</ul>
   </section>}

   <details className="val-plan-details">
    <summary><Route/><span><b>Ver roteiro completo e o porquê</b><small>Ação, prazo, perguntas e sinais pra avançar</small></span><ChevronRight/></summary>
   <section className={`val-executive-brief priority-${brief.priority}`} aria-label="Recomendação objetiva da VAL">
    <header><span>{priorityLabels[brief.priority]||priorityLabels.acompanhar}</span><h3>{brief.headline}</h3><p>{brief.reason}</p></header>
    <div className="val-brief-actions">
     <article><ClipboardCheck/><span><small>AÇÃO</small><b>{brief.action}</b></span></article>
     <article><Route/><span><small>PRAZO</small><b>{brief.deadline}</b></span></article>
     <article className={!brief.question?'is-empty':''}><MessageSquareText/><span><small>PERGUNTE</small><b>{brief.question||'Nenhuma pergunta necessária agora.'}</b></span></article>
    </div>
    <div className="val-brief-proof"><div><FileSearch/><span><small>BASE DA DECISÃO</small>{brief.decisionBasis.length?<ul>{brief.decisionBasis.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>:briefEvidence.length?<ul>{briefEvidence.map(item=><li key={item.id}>{item.summary}</li>)}</ul>:<b>Não há evidência suficiente para recomendar avanço.</b>}</span></div>{brief.missing.length>0&&<div><AlertCircle/><span><small>DADOS QUE FALTAM</small><ul>{brief.missing.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul></span></div>}</div>
    <div className="val-opportunity-review"><Target/><span><small>OPORTUNIDADES COMPARADAS</small><b>{opportunityReview.total} analisada(s) • {opportunityReview.open} aberta(s)</b><em>{opportunityReview.title?`${opportunityReview.title}${opportunityReview.stage?` • ${opportunityReview.stage}`:''}${opportunityReview.value?` • ${opportunityReview.value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`:''}`:'Nenhuma oportunidade priorizada'}</em>{opportunityReview.reason&&<p>{opportunityReview.reason}</p>}{opportunityReview.alternatives.length>0&&<ul>{opportunityReview.alternatives.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>}</span></div>
    {humanReview?.required&&<div className="val-brief-review"><ShieldCheck/><span><b>Revisão técnica antes de executar</b><small>{humanReview.reason}</small></span></div>}
   </section>

   <section className="val-conversation-plan" aria-label="Roteiro sugerido para a conversa">
    <header><div><Route/><span><small>ROTEIRO PARA A CONVERSA</small><h3>Da abertura ao próximo compromisso</h3></span></div><em>{conversation.steps.length} passos</em></header>
    {conversation.opening&&<blockquote>{conversation.opening}</blockquote>}
    <ol>{conversation.steps.map((item,index)=><li key={item.id}><span>{String(index+1).padStart(2,'0')}</span><div><small>{item.stage}</small><b>{item.goal}</b><p>{item.line}</p><dl><div><dt>Avance quando</dt><dd>{item.signal}</dd></div><div><dt>Se houver resistência</dt><dd>{item.resistance}</dd></div></dl></div></li>)}</ol>
    {conversation.closing.length>0&&<div className="val-closing-options"><small>OPÇÕES DE FECHAMENTO</small><div>{conversation.closing.map(item=><article key={item.id}><span>{item.when}</span><b>{item.line}</b><em>{item.commitment}</em></article>)}</div></div>}
    {conversation.avoid.length>0&&<div className="val-conversation-avoid"><small>EVITE NA CONVERSA</small><ul>{conversation.avoid.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
   </section>
   </details>

   <details className="val-analysis-details">
    <summary><DatabaseZap/>Ver dossiê e detalhes técnicos</summary>
    {response&&<div className="val-context-coverage"><div><DatabaseZap/><span><b>Dossiê cruzado pela VAL</b><small>Cadastro canônico{response.contextCoverage?.profile?' + perfil Produtor 360':''}</small></span></div><ul>{contextSources.length?contextSources.map(item=><li key={item.key}><b>{item.value}</b><span>{item.label}</span></li>):<li><b>1</b><span>cadastro do produtor</span></li>}</ul></div>}

   <div className="val-insight-grid">
    <article className="val-insight-card val-answer-card">
     <div className="val-card-label"><Lightbulb/>LEITURA DA VAL</div>
     <p>{advice.answer}</p>
     <div className="val-objective"><Target/><div><small>Objetivo da conversa</small><b>{advice.objective}</b></div></div>
    </article>

    <article className="val-insight-card val-profile-card">
     <div className="val-card-label"><UserRoundSearch/>PERFIL DE DECISÃO</div>
     <p>{profile.hypothesis}</p>
     {profile.referenceIds.length>0&&<small>IDs das evidências do perfil: {profile.referenceIds.join(', ')}</small>}
     {profile.evidence.length>0&&<ul className="val-profile-evidence">{profile.evidence.map(item=><li key={item.id}><b>{item.summary}</b>{item.meta&&<small>{item.meta}</small>}</li>)}</ul>}
     <div className="val-profile-adaptation"><small>Adaptação da abordagem</small><b>{profile.adaptation}</b></div>
     <div className="val-value-hypothesis"><small>Hipótese de valor</small><b>{valueHypothesis.problem}</b>{valueHypothesis.alternatives.map(item=><span key={item}>{item}</span>)}{valueHypothesis.impact&&<span><strong>Quantificar:</strong> {valueHypothesis.impact}</span>}{valueHypothesis.metric&&<span><strong>Métrica:</strong> {valueHypothesis.metric}</span>}{valueHypothesis.proof&&<span><strong>Prova:</strong> {valueHypothesis.proof}</span>}{valueHypothesis.details.map(item=><span key={item}>{item}</span>)}</div>
    </article>

    <article className="val-insight-card val-questions-card">
     <div className="val-card-head"><div className="val-card-label"><MessageSquareText/>PRÓXIMA PERGUNTA E PLANO INTERNO</div><span>{questions.length} {questions.length===1?'opção':'opções'}</span></div>
     {questions.length?<ol>{questions.map((item,index)=><li key={item.id}><span>{String(index+1).padStart(2,'0')}</span><div><em>{item.stage}</em><p>{item.question}</p>{item.when&&<small><b>Quando perguntar:</b> {item.when}</small>}{item.purpose&&<small><b>Por quê:</b> {item.purpose}</small>}{item.evidence&&<small><b>Evidência necessária:</b> {item.evidence}</small>}</div></li>)}</ol>:<p className="val-empty-plan">Nenhuma pergunta adicional foi recomendada para este momento.</p>}
    </article>

    <article className="val-insight-card val-evidence-card">
     <div className="val-card-label"><FileSearch/>EVIDÊNCIAS UTILIZADAS</div>
     {evidence.length?<ul>{evidence.map(item=><li key={item.id}><Check/><span><b>{item.summary}</b>{item.meta&&<small>{item.meta}</small>}{item.uncertainty&&<small>Incerteza: {item.uncertainty}</small>}</span></li>)}</ul>:<p className="val-empty-plan">Nenhuma evidência auditável foi localizada; a saída deve permanecer em descoberta.</p>}
     <small>Hipóteses são sinalizadas; fatos devem vir da base ou do produtor.</small>
    </article>

    <article className="val-insight-card val-tension-card">
     <div className="val-card-label"><Zap/>TENSÃO CONSTRUTIVA</div>
     <blockquote>“{tension.reframe||'Primeiro obtenha evidência comparável; tensão não é obrigatória.'}”</blockquote>
     <dl>{tension.status&&<div><dt>Status</dt><dd>{tension.status==='applicable'?'Aplicável':tension.status==='blocked'?'Bloqueada':'Não aplicável agora'}</dd></div>}{tension.consent&&<div><dt>Consentimento</dt><dd>{tension.consent==='granted'?'Registrado':tension.consent==='denied'?'Negado':'Não confirmado'}{tension.consentEvidence&&` • evidência ${tension.consentEvidence}`}</dd></div>}{tension.permission&&<div><dt>Permissão sugerida</dt><dd>{tension.permission}</dd></div>}{tension.evidence&&<div><dt>IDs das evidências</dt><dd>{tension.evidence}</dd></div>}{tension.stop&&<div><dt>Por que parar</dt><dd>{tension.stop}</dd></div>}{tension.autonomy&&<div><dt>Autonomia</dt><dd>{tension.autonomy}</dd></div>}</dl>
     <span>{tension.uncertainty||'Desafia o cenário somente quando há consentimento e evidência.'}</span>
    </article>

    <article className="val-insight-card val-action-card">
     <div className="val-card-label"><ClipboardCheck/>PRÓXIMA MELHOR AÇÃO</div>
     <h4>{advice.next_best_action}</h4>
     <div className={!commitment.status?'is-empty':''}>{commitment.status?<Check/>:<AlertCircle/>}<span><small>{commitment.status?`Compromisso • ${commitment.status}`:'Nenhum compromisso registrado'}</small><b>{commitment.summary}</b>{commitment.detail&&<small>{commitment.detail}</small>}</span></div>
    </article>

    <article className="val-insight-card val-confidence-card">
     <div className="val-confidence-score" style={{'--val-confidence':`${confidence.arc}deg`}}><div><Gauge/><b>{confidence.label}</b><small>confiança</small></div></div>
     <div><div className="val-card-label">PREMISSAS E DADOS EM ABERTO</div>{confidence.rationale&&<p className="val-confidence-rationale">{confidence.rationale}</p>}{confidence.breakdown.length>0&&<ul>{confidence.breakdown.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>}<ul>{[...assumptions,...confidence.missing].map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul></div>
    </article>

    <article className="val-insight-card val-guardrail-card">
     <div className="val-card-label"><ShieldCheck/>LIMITES DE SEGURANÇA</div>
     {humanReview?.required&&<div className="val-human-review"><AlertCircle/><span><b>Revisão técnica pendente</b><small>{humanReview.reason}</small><small>Responsável exigido: {reviewerLabels[humanReview.required_role]||humanReview.required_role}</small></span></div>}
     {blockedActions.length>0&&<div className="val-blocked-actions"><b>Ações bloqueadas</b><ul>{blockedActions.map((item,index)=><li key={`${item}-${index}`}><AlertCircle/><span>{item}</span></li>)}</ul></div>}
     <ul>{guardrails.map((item,index)=><li key={`${item}-${index}`}><ShieldCheck/><span>{item}</span></li>)}</ul>
    </article>
   </div>
   </details>

   <div className="val-response-footer">
    <form className={`val-feedback ${feedback.sent?'is-sent':''}`} onSubmit={sendFeedback}>
     {feedback.sent?<div className="val-feedback-success"><Check/><span><b>Retorno registrado.</b><small>Ele entra no conjunto de avaliação controlada da VAL.</small></span></div>:<>
      <div className="val-feedback-question"><div><span>Esta recomendação ajudou?</span><small>{response?.recommendationId?'Seu retorno alimenta a avaliação com evidência real.':'Envie uma análise pela engine para registrar o retorno.'}</small></div><div><button type="button" className={feedback.rating===5?'active':''} onClick={()=>setFeedback(current=>({...current,rating:5}))} disabled={!response?.recommendationId} aria-label="Recomendação útil"><ThumbsUp/></button><button type="button" className={feedback.rating===1?'active negative':''} onClick={()=>setFeedback(current=>({...current,rating:1}))} disabled={!response?.recommendationId} aria-label="Recomendação não útil"><ThumbsDown/></button></div></div>
      {feedback.rating!==null&&<div className="val-feedback-detail"><select value={feedback.outcome} onChange={event=>setFeedback(current=>({...current,outcome:event.target.value}))} aria-label="Resultado da recomendação"><option value="">O que aconteceu depois?</option><option value="executed">Usei como recomendado</option><option value="edited">Usei com ajustes</option><option value="scheduled">Gerou próximo compromisso</option><option value="rejected">Não utilizei</option></select><input value={feedback.notes} maxLength="300" onChange={event=>setFeedback(current=>({...current,notes:event.target.value}))} placeholder="Conte em uma frase o que funcionou ou faltou" aria-label="Observação sobre a recomendação"/><button type="submit" disabled={feedback.sending}>{feedback.sending?<LoaderCircle className="val-spinner"/>:'Registrar'}</button></div>}
      {feedback.error&&<small className="val-feedback-error" role="alert">{feedback.error}</small>}
     </>}
    </form>
    <button className="val-open-client" type="button" onClick={()=>onSelect?.(client)}>Abrir Cliente 360 <ChevronRight/></button>
   </div>
  </div>
 </section>
}
