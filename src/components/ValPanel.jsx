import React,{useEffect,useMemo,useRef,useState} from 'react'
import {
 AlertCircle,BrainCircuit,Camera,Check,ChevronLeft,ChevronRight,ClipboardCheck,DatabaseZap,
 FileSearch,FileText,FileUp,Gauge,ImagePlus,Lightbulb,LoaderCircle,MessageSquareText,Paperclip,Plus,Route,Send,
 ShieldCheck,Sparkles,Target,ThumbsDown,ThumbsUp,UserRoundSearch,X,Zap
} from 'lucide-react'
import {compactBRL,commercialMetrics} from '../lib/commercial-metrics'
import {buildValMethodApplication} from '../lib/val-method-application'
import {adjacentConsultativeStage,createSequenceControl,transitionSequenceControl,VAL_CONSULTATIVE_SEQUENCE} from '../lib/val-sequence-control'
import {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'
import ValProgressFeedback from './ValProgressFeedback'
import {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'

const VAL_METHOD_SEQUENCE=VAL_CONSULTATIVE_SEQUENCE
const methodLabels={preparar:'Preparar',alinhar:'Alinhar',descobrir:'Descobrir',dimensionar:'Dimensionar',construir_valor:'Construir valor',propor:'Propor',comprometer:'Comprometer'}
const sequenceDetails={
 preparar:'Cruzar dossiê, potencial, oportunidades, histórico e evidências antes do contato.',
 alinhar:'Confirmar objetivo, tempo, participantes da decisão e pauta útil para a conversa.',
 descobrir:'Identificar a prioridade real, a dificuldade e qual decisão está sendo afetada.',
 dimensionar:'Confirmar base, unidade, área, horizonte e impacto antes de calcular valor.',
 construir_valor:'Comparar agir agora, esperar e manter, definindo resultado e forma de comprovação.',
 propor:'Organizar uma proposta somente após problema, impacto e forma de comprovação estarem validados.',
 comprometer:'Registrar ação bilateral, responsável, prazo, evidência e a próxima decisão.'
}
const spinStatusLabels={waiting:'Aguardando análise',covered:'Etapa percorrida',current:'Foco agora',next:'Depois'}
const METHOD_TABS=[
 {key:'spin',label:'SPIN',title:'Diagnóstico consultivo',description:'Situação, Problema, Implicação e Necessidade.'},
 {key:'opc',label:'OPC',title:'Contrato da conversa',description:'Objetivo, Processo e Compromisso.'},
 {key:'epa',label:'EPA',title:'Condução de valor',description:'Educar, Personalizar e Assumir a condução.'}
]

const MODES={
 daily:{label:'Resposta rápida',short:'Rápido',description:'Orientação curta para o contato de hoje.'},
 strategic:{label:'Planejar a conta',short:'Planejar',description:'Um pensamento estratégico completo da conta, explicado de forma simples.'}
}

const QUICK_PROMPTS=[
 {label:'Iniciar conversa',icon:MessageSquareText,prompt:'Como posso iniciar esta conversa de forma natural e específica para este produtor?'},
 {label:'Preparar visita',icon:Route,prompt:'Ajude-me a preparar a próxima visita com objetivo, sequência e critérios de avanço.'},
 {label:'Próximo passo',icon:Target,prompt:'Qual é o próximo passo mais coerente para este produtor e quais dados sustentam essa escolha?'},
 {label:'Negociar valor',icon:Sparkles,prompt:'Ajude-me a sair da discussão de preço, comparar as opções registradas e conduzir esta negociação por valor, risco e prova.'}
]

const ATTACHMENT_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
const MAX_ATTACHMENT_BYTES=6_000_000
const attachmentStatusLabels={received:'Pronto para leitura',interpreted:'Leitura pronta',confirmed:'Confirmado como evidência',stored:'Somente armazenado',rejected:'Removido'}
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

function neutralAdvice(client){
 const metrics=commercialMetrics(client||{})
 return {
	  answer:'Escolha uma pergunta rápida ou descreva a situação para a VAL analisar o dossiê.',
	  objective:'A orientação será construída com o pedido atual, o perfil, o contexto comercial e as evidências disponíveis.',
	  strategic_synthesis:{moment:'Aguardando análise do dossiê',non_obvious_connection:'A VAL mostrará o que os dados revelam quando são lidos juntos.',decision_at_stake:'Aguardando uma situação atual.',leverage_point:'Envie uma pergunta ou escolha um atalho.',do_not_do:'Não há recomendação antes da análise.',cross_source_connections:[],competing_hypotheses:[],highest_value_unknown:{question:'',why_it_matters:'',how_to_get:'',evidence_ids:[]},learning_loop:{record:'',success_signal:'',failure_signal:'',next_update:''}},
	  value_bridge:{status:'not_applicable',price_zone_reading:'',reframe:'',value_dimensions:[],anchor_product:null,alternatives:[],argument_path:[],negotiation_question:'',do_not_claim:'',technical_review:'',grounding_ids:[]},
  executive_brief:{priority:'acompanhar',headline:'Aguardando sua pergunta',reason:'Nenhuma recomendação foi gerada antes da análise.',action:'Selecione um tema ou escreva a situação atual.',deadline:'Quando você estiver pronto',question:'',decision_basis:[],evidence_ids:[],missing_data:[]},
  methodology_state:{sequence:VAL_METHOD_SEQUENCE,current_stage:'preparar',completed_stages:[],next_stage:'alinhar',advance_gate:'Enviar uma pergunta para cruzar o dossiê.',reason:'Estado inicial, sem recomendação pronta.'},
  approach_plan:{tone:'Será definido pelos dados do produtor.',pace:'A confirmar.',channel:'A confirmar.',proof:'A confirmar.',participants:'A confirmar.',risk_posture:'A confirmar.',prioritize:'A confirmar.',avoid:'Não presumir preferências pela tag comportamental.',grounding_ids:[]},
  commercial_context:{status:metrics.potentialKnown||metrics.currentKnown?'partial':'unknown',current_purchases:metrics.currentPurchases,potential_total:metrics.potentialTotal,open_potential:metrics.openPotential,open_pipeline:metrics.openPipeline,realized_share_percent:Number(metrics.realizedShare)||0,interpretation:metrics.openPotentialKnown?'Potencial em aberto cadastrado: '+compactBRL(metrics.openPotential)+'.':'Potencial em aberto ainda não informado.'},
  decision_profile:{decision_context_summary:'Aguardando análise do perfil para esta decisão.',legacy_tag:client?.primaryProfile||'',tag_origin:'cadastro do produtor',self_reported:false,evidence_ids:[],observed_dimensions:[],adaptation:'A abordagem será definida depois da análise.'},
  next_question:null,questions:[],
  opportunity_review:{total_considered:0,open_count:0,selected_id:'',selected_title:'',selected_stage:'',selected_value:0,why_priority:'Aguardando análise.',alternatives_considered:[]},
  conversation_plan:{opening:'',steps:[],closing_options:[],do_not_say:[]},
  constructive_tension:{status:'not_applicable',consent_status:'unknown',consent_evidence_id:'',permission_prompt:'',evidence_ids:[],reframe:'',autonomy:'A decisão permanece com o consultor e o produtor.',stop_reason:'Nenhuma análise foi solicitada.',uncertainty:'Aguardando contexto atual.'},
  value_hypothesis:{problem:'Aguardando análise.',baseline:'',act_now:'',wait:'',maintain:'',impact_to_quantify:'',value_metric:'',time_horizon:'',proof_plan:'',double_counting_guard:'',uncertainty:''},
  next_best_action:'Envie uma pergunta para receber uma próxima ação ancorada no dossiê.',commitment:null,
  confidence:{level:'not_calibrated',rationale:'Nenhuma recomendação foi gerada.',evidence_quality:'Não avaliada.',relevance:'Não avaliada.',freshness:'Não avaliada.',source_agreement:'Não avaliada.',missing_data:[],calibration_status:'not_calibrated'},
  assumptions:[],evidence_used:[],human_review:{required:false,reason:'Nenhuma análise foi solicitada.',required_role:'none'},blocked_actions:[],guardrails:['Confira a orientação antes de usar com o produtor.']
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

const countLabel=(value,singular,plural)=>`${Number(value)||0} ${Number(value)===1?singular:plural}`

const sourceLabels={client_record:'cadastro do cliente',producer_questionnaire:'Produtor 360',business_history:'histórico de negócios',visit:'visita',interaction:'interação',opportunity:'oportunidade',field_report:'relatório de campo',soil_analysis:'análise de solo',ndvi:'NDVI',manual_record:'núcleo técnico do VALOR 360',producer_statement:'declaração do produtor',approved_playbook:'playbook aprovado',official_product_catalog:'catálogo oficial de produtos',consultant_attachment:'arquivo do consultor',missing:'dado ausente',unknown:'origem não confirmada'}
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
  type:textValue(item.type)||'aberta',
  question:textValue(item.question)||textValue(item),
  when:textValue(item.ask_when),
  purpose:textValue(item.purpose),
  evidence:textValue(item.evidence_needed),
  grounding:asList(item.grounding_ids)
 }:{id:`pergunta-${index}`,stage:'pergunta',type:'aberta',question:textValue(item),when:'',purpose:'',evidence:'',grounding:[]}).filter(item=>item.question)
}

function conversationData(value){
 const source=value&&typeof value==='object'?value:{}
 return {opening:textValue(source.opening),steps:(Array.isArray(source.steps)?source.steps:[]).map((item,index)=>({id:`${item.stage||'passo'}-${index}`,stage:textValue(item.stage)||'passo',type:textValue(item.question_type),goal:textValue(item.goal),line:textValue(item.suggested_line),signal:textValue(item.advance_signal),resistance:textValue(item.if_resistance)})),closing:(Array.isArray(source.closing_options)?source.closing_options:[]).map((item,index)=>({id:`fechamento-${index}`,when:textValue(item.when),line:textValue(item.suggested_line),commitment:textValue(item.commitment)})),avoid:asList(source.do_not_say)}
}

function opportunityData(value){
 const source=value&&typeof value==='object'?value:{}
 return {total:Number(source.total_considered||0),open:Number(source.open_count||0),title:textValue(source.selected_title),stage:textValue(source.selected_stage),value:Number(source.selected_value||0),reason:textValue(source.why_priority),alternatives:asList(source.alternatives_considered)}
}

function methodologyData(value){
 const source=value&&typeof value==='object'?value:{}
 const sequence=Array.isArray(source.sequence)&&source.sequence.length?source.sequence:VAL_METHOD_SEQUENCE
 const current=VAL_METHOD_SEQUENCE.includes(source.current_stage)?source.current_stage:'preparar'
 return {sequence,current,completed:asList(source.completed_stages),next:VAL_METHOD_SEQUENCE.includes(source.next_stage)?source.next_stage:'alinhar',gate:textValue(source.advance_gate),reason:textValue(source.reason)}
}

function approachData(value){
 const source=value&&typeof value==='object'?value:{}
 return {tone:textValue(source.tone)||'A confirmar.',pace:textValue(source.pace)||'A confirmar.',channel:textValue(source.channel)||'A confirmar.',proof:textValue(source.proof)||'A confirmar.',participants:textValue(source.participants)||'A confirmar.',risk:textValue(source.risk_posture)||'A confirmar.',prioritize:textValue(source.prioritize)||'A confirmar.',avoid:textValue(source.avoid)||'Não presumir preferências.',grounding:asList(source.grounding_ids)}
}

function commercialData(value){
 const source=value&&typeof value==='object'?value:{}
 return {status:textValue(source.status)||'unknown',current:Number(source.current_purchases||0),potential:Number(source.potential_total||0),open:Number(source.open_potential||0),pipeline:Number(source.open_pipeline||0),share:Number(source.realized_share_percent||0),interpretation:textValue(source.interpretation)}
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

function strategicData(value){
 const source=value&&typeof value==='object'?value:{}
 return {
  moment:textValue(source.moment)||'Aguardando cruzamento do dossiê',
  connection:textValue(source.non_obvious_connection),
  decision:textValue(source.decision_at_stake),
  leverage:textValue(source.leverage_point),
  avoid:textValue(source.do_not_do),
  connections:(Array.isArray(source.cross_source_connections)?source.cross_source_connections:[]).map((item,index)=>({id:`nexo-${index}`,title:textValue(item.title),insight:textValue(item.insight),why:textValue(item.why_it_matters),evidence:asList(item.evidence_ids)})).filter(item=>item.title||item.insight),
  hypotheses:(Array.isArray(source.competing_hypotheses)?source.competing_hypotheses:[]).map((item,index)=>({id:`hipotese-${index}`,label:textValue(item.label)||`Hipótese ${index+1}`,explanation:textValue(item.explanation),support:asList(item.supporting_evidence_ids),contradict:asList(item.contradicting_evidence_ids),falsifier:textValue(item.falsifier),move:textValue(item.validation_move)})).filter(item=>item.explanation),
  unknown:{question:textValue(source.highest_value_unknown?.question),why:textValue(source.highest_value_unknown?.why_it_matters),how:textValue(source.highest_value_unknown?.how_to_get),evidence:asList(source.highest_value_unknown?.evidence_ids)},
  loop:{record:textValue(source.learning_loop?.record),success:textValue(source.learning_loop?.success_signal),failure:textValue(source.learning_loop?.failure_signal),update:textValue(source.learning_loop?.next_update)}
 }
}

function valueBridgeData(value){
 const source=value&&typeof value==='object'?value:{}
 const product=item=>item&&typeof item==='object'?{name:textValue(item.name),registration:textValue(item.registration),manufacturer:textValue(item.manufacturer),category:textValue(item.category),composition:textValue(item.composition),level:textValue(item.comparison_level),why:textValue(item.why_candidate),advantage:textValue(item.advantage_to_validate),tradeoffs:textValue(item.tradeoffs),crops:asList(item.crops),evidence:textValue(item.evidence_id),seen:item.seen_in_account_history===true,official:item.official_check_required!==false}:null
 return {
  status:textValue(source.status)||'not_applicable',
  reading:textValue(source.price_zone_reading),
  reframe:textValue(source.reframe),
  dimensions:asList(source.value_dimensions),
  anchor:product(source.anchor_product),
  alternatives:(Array.isArray(source.alternatives)?source.alternatives:[]).map(product).filter(Boolean),
  path:(Array.isArray(source.argument_path)?source.argument_path:[]).map((item,index)=>({id:`valor-${index}`,step:textValue(item.step),line:textValue(item.suggested_line),evidence:textValue(item.evidence_needed)})),
  question:textValue(source.negotiation_question),
  avoid:textValue(source.do_not_claim),
  review:textValue(source.technical_review),
  grounding:asList(source.grounding_ids)
 }
}

export default function ValPanel({clients=[],selectedClient,onSelect}){
 const [selected,setSelected]=useState(selectedClient?.id||clients[0]?.id||'')
 const [mode,setMode]=useState('daily')
 const [message,setMessage]=useState('')
 const [response,setResponse]=useState(null)
 const [activeMethod,setActiveMethod]=useState('spin')
 const [sequenceControl,setSequenceControl]=useState(()=>createSequenceControl())
 const {state:status,run:loadStatus}=useAsyncResource({initialData:null,initialLoading:true,timeoutMs:8_000,timeoutMessage:'A VAL está operando com contexto local.',fallbackMessage:'A VAL está operando com contexto local.'})
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [progress,setProgress]=useState(()=>initialValProgress())
 const [feedback,setFeedback]=useState({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})
 const [attachments,setAttachments]=useState([])
 const [savedAttachments,setSavedAttachments]=useState([])
 const [attachmentMenu,setAttachmentMenu]=useState(false)
 const [attachmentState,setAttachmentState]=useState({loading:false,uploading:false,error:''})
 const cameraInput=useRef(null)
 const photoInput=useRef(null)
 const documentInput=useRef(null)
 const requestRef=useRef({sequence:0,controller:null})
 const selectedRef=useRef(selected)

 useEffect(()=>{if(selectedClient?.id)setSelected(selectedClient.id)},[selectedClient])

 useEffect(()=>{
  loadStatus(({signal})=>fetchJsonResource('/api/val/status',{signal,fallbackMessage:'A VAL está operando com contexto local.'}),{keepData:false})
 },[loadStatus])

 useEffect(()=>{
  selectedRef.current=selected
  requestRef.current.controller?.abort()
  requestRef.current={sequence:requestRef.current.sequence+1,controller:null}
  setLoading(false);setResponse(null);setActiveMethod('spin');setSequenceControl(createSequenceControl());setError('');setProgress(initialValProgress());setMessage('');setAttachments([]);setSavedAttachments([]);setAttachmentMenu(false)
  setAttachmentState({loading:false,uploading:false,error:''})
  setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})
 },[selected])

 useEffect(()=>{setResponse(null);setActiveMethod('spin');setSequenceControl(createSequenceControl());setError('');setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})},[mode])

 useEffect(()=>()=>requestRef.current.controller?.abort(),[])

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
 const localAdvice=useMemo(()=>neutralAdvice(client),[client])
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
 const methodology=methodologyData(advice?.methodology_state)
 useEffect(()=>{setSequenceControl(current=>transitionSequenceControl(current,{type:'sync-suggestion',suggestedStage:methodology.current}))},[methodology.current])
 const approachPlan=approachData(advice?.approach_plan)
 const commercialContext=commercialData(advice?.commercial_context)
 const evidence=evidenceData(advice?.evidence_used,response?[]:localAdvice.evidence_used)
 const brief=briefData(advice)
 const strategic=strategicData(advice?.strategic_synthesis)
 const valueBridge=valueBridgeData(advice?.value_bridge)
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
 const clientMetrics=useMemo(()=>commercialMetrics(client||{}),[client])
 const primaryQuestionType=questions.find(item=>item.question===brief.question)?.type||textValue(advice?.next_question?.type)||'aberta'
 const methodApplication=buildValMethodApplication({analyzed:Boolean(response),questions,methodology,brief,conversation,valueHypothesis,profile,approachPlan,commitment,opportunityReview,commercialContext,objective:advice?.objective,nextBestAction:advice?.next_best_action})
 const activeSequenceStage=sequenceControl.openStage
 const workingSequenceStage=sequenceControl.workingStage
 const activeSequenceStatus=methodology.current===activeSequenceStage?'current':methodology.completed.includes(activeSequenceStage)?'complete':'pending'
 const activeSequenceIndex=methodology.sequence.indexOf(activeSequenceStage)

 const uploadFiles=async event=>{
  const files=Array.from(event.target.files||[]);event.target.value='';setAttachmentMenu(false)
  if(!files.length||attachmentState.uploading)return
  const slots=Math.max(0,3-attachments.length);if(!slots){setAttachmentState(current=>({...current,error:'Envie no máximo 3 arquivos por pergunta.'}));return}
  const uploadClientId=client.id
  setAttachmentState(current=>({...current,uploading:true,error:''}))
  try{
   for(const original of files.slice(0,slots)){
    const file=await prepareAttachmentFile(original);const dataUrl=await fileDataUrl(file)
    const result=await fetch('/api/val/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client.id,originalName:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl}),signal:AbortSignal.timeout(60000)})
    const payload=await result.json().catch(()=>({}));if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!result.ok)throw new Error(payload.error||'Não consegui enviar este arquivo.')
    if(String(selectedRef.current)!==String(uploadClientId))continue
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
  const sequence=requestRef.current.sequence+1
  const controller=new AbortController()
  requestRef.current.controller?.abort()
  requestRef.current={sequence,controller}
  const requestClientId=client.id
  const requestId=createValProgressRequestId()
  setLoading(true)
  setError('')
  setProgress(initialValProgress())
  setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})
  const stopProgress=requestedMode==='strategic'?startValProgressPolling({requestId,onProgress:setProgress,signal:controller.signal}):()=>{}
  try{
   const result=await fetch('/api/val/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({clientId:client.id,client,message:prompt,attachmentIds,mode:requestedMode,requestId,...(workingSequenceStage?{requestedStage:workingSequenceStage}:{})}),
    signal:typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]):controller.signal
   })
   const payload=await result.json().catch(()=>({}))
   if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   if(!result.ok)throw new Error(payload?.error||payload?.message||'A VAL não respondeu agora.')
   if(!payload?.advice)throw new Error('A resposta chegou incompleta.')
   if(requestRef.current.sequence!==sequence||String(selectedRef.current)!==String(requestClientId))return
   setResponse(payload)
   setProgress({stage:'complete',label:'Recomendação pronta',order:5,total:5,done:true,failed:false})
   setMessage('')
   setAttachments([])
   ;(payload.attachments||[]).forEach(item=>setSavedAttachments(current=>mergeAttachment(current,item)))
  }catch(requestError){
   if(requestRef.current.sequence!==sequence||requestError.name==='AbortError')return
   setResponse(null)
   setProgress({stage:'failed',label:'Não foi possível concluir',order:6,total:5,done:true,failed:true})
   setError(requestError.message+(attachmentIds.length?' Os arquivos continuam salvos com este produtor; tente novamente.':' Tente novamente em alguns instantes.'))
  }finally{stopProgress();if(requestRef.current.sequence===sequence)setLoading(false)}
 }

 const chooseMode=value=>setMode(value)
 const moveMethodFocus=(event,current)=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
  event.preventDefault()
  const currentIndex=METHOD_TABS.findIndex(item=>item.key===current)
  const nextIndex=event.key==='Home'?0:event.key==='End'?METHOD_TABS.length-1:event.key==='ArrowRight'?(currentIndex+1)%METHOD_TABS.length:(currentIndex-1+METHOD_TABS.length)%METHOD_TABS.length
  const next=METHOD_TABS[nextIndex].key
  setActiveMethod(next)
  requestAnimationFrame(()=>document.getElementById(`val-method-tab-${next}`)?.focus())
 }
 const moveSequenceFocus=(event,current)=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
  event.preventDefault()
  const currentIndex=VAL_METHOD_SEQUENCE.indexOf(current)
  const nextIndex=event.key==='Home'?0:event.key==='End'?VAL_METHOD_SEQUENCE.length-1:event.key==='ArrowRight'?(currentIndex+1)%VAL_METHOD_SEQUENCE.length:(currentIndex-1+VAL_METHOD_SEQUENCE.length)%VAL_METHOD_SEQUENCE.length
  const next=VAL_METHOD_SEQUENCE[nextIndex]
  setSequenceControl(value=>transitionSequenceControl(value,{type:'open',stage:next,suggestedStage:methodology.current}))
  requestAnimationFrame(()=>document.getElementById(`val-sequence-tab-${next}`)?.focus())
 }
 const openSequenceStage=stage=>setSequenceControl(current=>transitionSequenceControl(current,{type:'open',stage,suggestedStage:methodology.current}))
 const workSequenceStage=stage=>setSequenceControl(current=>transitionSequenceControl(current,{type:'work',stage,suggestedStage:methodology.current}))
 const followValSequence=()=>setSequenceControl(current=>transitionSequenceControl(current,{type:'follow-suggestion',suggestedStage:methodology.current}))
 const browseSequence=direction=>openSequenceStage(adjacentConsultativeStage(activeSequenceStage,direction,methodology.sequence))

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
	    <p>Conte a situação com naturalidade. A VAL conecta o dossiê inteiro, mostra as explicações possíveis e orienta o próximo avanço em linguagem simples.</p>
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
     <div><dt>Potencial em aberto</dt><dd>{compactBRL(clientMetrics.openPotential,{known:clientMetrics.openPotentialKnown})}</dd></div>
     <div><dt>Share realizado</dt><dd>{clientMetrics.shareKnown?`${Number(clientMetrics.realizedShare).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:'A medir'}</dd></div>
    </dl>
    <div className="val-context-opportunity"><span>Oportunidade observada</span><b>{client.commercial?.opportunity||'Descoberta inicial'}</b></div>
   </aside>
  </header>

  <div className="val-command-zone">
   <div className="val-toolbar">
    <label className="val-client-select"><span>Produtor</span><select value={selected} onChange={event=>setSelected(event.target.value)} aria-label="Selecionar produtor" disabled={loading}>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="val-mode-picker"><div><span>Tipo de ajuda</span><small>{MODES[mode].description}</small></div><div role="group" aria-label="Escolher modo da VAL">{Object.entries(MODES).map(([value,item])=><button key={value} type="button" disabled={loading} className={mode===value?'active':''} aria-pressed={mode===value} onClick={()=>chooseMode(value)}>{value==='daily'?<Zap/>:<BrainCircuit/>}{item.short}</button>)}</div></div>
   </div>

   {workingSequenceStage&&<div className="val-working-stage-banner" aria-live="polite"><Route/><span><small>ETAPA DE TRABALHO ATIVA</small><b>{methodLabels[workingSequenceStage]}</b><p>A próxima orientação será focada nesta etapa, sem marcar progresso não confirmado.</p></span><button type="button" onClick={followValSequence}>Usar sugestão da VAL</button></div>}

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
    <button type="submit" disabled={(!message.trim()&&!attachments.length)||loading||attachmentState.uploading} aria-label="Enviar para a VAL">{loading?<LoaderCircle className="val-spinner" aria-hidden="true"/>:<Send aria-hidden="true"/>}<span>{loading?(mode==='strategic'?progress.label:'Pensando'):'Enviar'}</span></button>
   </form>
   {loading&&mode==='strategic'&&<ValProgressFeedback progress={progress} compact/>}
   {attachments.length>0&&<div className="val-attachment-tray" aria-label="Arquivos desta pergunta">{attachments.map(item=><article key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<span><b>{item.originalName}</b><small>{formatFileSize(item.sizeBytes)} • {attachmentStatusLabels[item.status]||item.status}</small></span><button type="button" onClick={()=>setAttachments(current=>current.filter(entry=>entry.id!==item.id))} aria-label={'Tirar '+item.originalName+' desta pergunta'}><X/></button></article>)}</div>}
   {attachmentState.uploading&&<div className="val-file-progress" role="status"><LoaderCircle className="val-spinner"/><span>Enviando arquivo…</span></div>}
   {attachmentState.error&&<div className="val-warning val-file-warning" role="alert"><AlertCircle/><span>{attachmentState.error}</span></div>}
   <details className="val-files-panel">
    <summary><Paperclip/><span>Fotos e documentos de {firstNameOf(client)}</span><b>{savedAttachments.length}</b></summary>
    {attachmentState.loading?<p>Buscando arquivos…</p>:savedAttachments.length?<ul>{savedAttachments.map(item=><li key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<span><a href={'/api/val/attachments/'+item.id} target="_blank" rel="noreferrer">{item.originalName}</a><small>{formatFileSize(item.sizeBytes)} • {attachmentStatusLabels[item.status]||item.status}</small></span>{!attachments.some(entry=>entry.id===item.id)&&attachments.length<3&&<button type="button" onClick={()=>setAttachments(current=>[...current,item].slice(0,3))}>Usar</button>}</li>)}</ul>:<p>Nenhum arquivo salvo ainda.</p>}
   </details>
	   {loading&&mode!=='strategic'&&<div className="val-thinking" role="status"><span/><div><b>A VAL está procurando conexões que ainda não aparecem na tela.</b><small>Perfil, negócios, campo, histórico, oportunidades e opções de valor estão sendo cruzados.</small></div></div>}
   {(error||response?.warning)&&<div className="val-warning" role="status"><AlertCircle aria-hidden="true"/><span>{error||response.warning}</span></div>}
  </div>

  <div className="val-response" aria-busy={loading}>
   <span className="sr-only" role="status">{loading?'Análise em andamento.':recommendationRegistered?'Nova recomendação registrada.':response?'Nova orientação não registrada.':'Aguardando pergunta.'}</span>
   <div className="val-response-heading"><div><span className="val-section-icon"><Sparkles/></span><div><span>{recommendationRegistered?'RESPOSTA SALVA':response?'ORIENTAÇÃO GERADA':'AGUARDANDO CONTEXTO ATUAL'}</span><h3>{response?'Minha leitura':'Como começar'}</h3></div></div><div className="val-response-meta"><span>Sobre {firstNameOf(client)}</span></div></div>
   <div className="val-internal-banner"><ShieldCheck/><span><b>Rascunho de trabalho</b><small>Confira antes de usar com o produtor.</small></span></div>

	   <section className="val-chat-answer" aria-label="Resposta principal da VAL">
	    <span className="val-chat-avatar">VAL</span>
	    <div><small>VAL</small><p>{advice.answer}</p>{response&&brief.question&&<div className="val-ready-question"><MessageSquareText/><span><small>PERGUNTA PRINCIPAL • {primaryQuestionType.toUpperCase()}</small><b>{brief.question}</b></span></div>}</div>
	   </section>

	   {response&&<section className="val-nexo" aria-label="VAL NEXO, conexões e hipóteses do dossiê">
	    <header className="val-nexo-head"><div><span className="val-nexo-mark"><DatabaseZap/></span><span><small>VAL NEXO • INTELIGÊNCIA DE DECISÃO</small><h3>O que os dados revelam juntos</h3><p>{strategic.moment}</p></span></div><em>{strategic.connections.length} {strategic.connections.length===1?'conexão':'conexões'} • {strategic.hypotheses.length} hipóteses</em></header>
	    <div className="val-nexo-reading">
	     <article><small>LEITURA PRINCIPAL</small><h4>{strategic.connection||'Ainda não há uma conexão legítima entre fontes suficientes.'}</h4>{strategic.decision&&<p><b>Decisão em jogo:</b> {strategic.decision}</p>}{strategic.leverage&&<div><Target/><span><small>PONTO DE ALAVANCA</small><b>{strategic.leverage}</b></span></div>}</article>
	     <aside><AlertCircle/><span><small>NÃO FAÇA AGORA</small><b>{strategic.avoid||'Não preencha lacunas com uma resposta pronta.'}</b></span></aside>
	    </div>
	    {strategic.connections.length>1&&<div className="val-nexo-connections" aria-label="Conexões entre fontes">{strategic.connections.slice(0,4).map(item=><article key={item.id}><span><DatabaseZap/></span><div><small>{item.title}</small><p>{item.insight}</p>{item.why&&<b>{item.why}</b>}{item.evidence.length>0&&<em>Base: {item.evidence.join(' + ')}</em>}</div></article>)}</div>}
	    <div className="val-nexo-hypotheses"><header><BrainCircuit/><span><small>NÃO CASE COM A PRIMEIRA EXPLICAÇÃO</small><h4>Duas leituras possíveis. Um teste para separar as duas.</h4></span></header><div>{strategic.hypotheses.slice(0,3).map((item,index)=><article key={item.id}><span>{String.fromCharCode(65+index)}</span><div><small>HIPÓTESE {String.fromCharCode(65+index)}</small><h5>{item.label}</h5><p>{item.explanation}</p><dl><div><dt>O que derruba</dt><dd>{item.falsifier}</dd></div><div><dt>Como testar</dt><dd>{item.move}</dd></div></dl>{item.support.length>0&&<em>Sustentada por: {item.support.join(', ')}</em>}</div></article>)}</div></div>
	    <div className="val-nexo-decision">
	     <article><span><MessageSquareText/></span><div><small>O DADO QUE MAIS MUDA A DECISÃO</small><h4>{strategic.unknown.question||brief.question}</h4>{strategic.unknown.why&&<p>{strategic.unknown.why}</p>}{strategic.unknown.how&&<b>{strategic.unknown.how}</b>}</div></article>
	     <details><summary><ClipboardCheck/><span><b>Como esta resposta faz a VAL aprender</b><small>O que registrar e como atualizar a próxima orientação</small></span><ChevronRight/></summary><dl><div><dt>Registre</dt><dd>{strategic.loop.record}</dd></div><div><dt>Funcionou quando</dt><dd>{strategic.loop.success}</dd></div><div><dt>Não funcionou quando</dt><dd>{strategic.loop.failure}</dd></div><div><dt>Próxima atualização</dt><dd>{strategic.loop.update}</dd></div></dl></details>
	    </div>
	   </section>}

	   {response&&valueBridge.status!=='not_applicable'&&<section className={`val-value-bridge is-${valueBridge.status}`} aria-label="Ponte de Valor para negociação além do preço">
	    <header><div><span><Sparkles/></span><div><small>PONTE DE VALOR • NEGOCIAÇÃO</small><h3>Saia do preço sem fugir da comparação</h3><p>{valueBridge.reading}</p></div></div><em>{valueBridge.status==='ready'?'Opções encontradas':valueBridge.status==='needs_product'?'Falta o produto de referência':valueBridge.status==='blocked'?'Aguardando revisão':'Faltam dados para comparar'}</em></header>
	    <div className="val-value-core"><article><small>REENQUADRAMENTO</small><h4>{valueBridge.reframe}</h4><div>{valueBridge.dimensions.map(item=><span key={item}><Check/>{item}</span>)}</div>{valueBridge.question&&<blockquote><small>PERGUNTA PARA TIRAR O PREÇO DO CENTRO</small><b>{valueBridge.question}</b></blockquote>}</article>{valueBridge.anchor&&<aside><small>PRODUTO DE REFERÊNCIA</small><h4>{valueBridge.anchor.name}</h4><p>{valueBridge.anchor.composition}</p><span>{[valueBridge.anchor.category,valueBridge.anchor.manufacturer,valueBridge.anchor.registration&&`Registro ${valueBridge.anchor.registration}`].filter(Boolean).join(' • ')}</span></aside>}</div>
	    {valueBridge.alternatives.length>0&&<div className="val-product-options"><div><small>CANDIDATAS À COMPARAÇÃO</small><h4>Opções reais da base — ainda não são uma prescrição</h4></div><div>{valueBridge.alternatives.map((item,index)=><article key={`${item.name}-${index}`}><header><span>{String(index+1).padStart(2,'0')}</span><div><small>{item.level}</small><h5>{item.name}</h5></div>{item.seen&&<em>Já aparece na conta</em>}</header><p>{item.composition}</p><dl><div><dt>Por que entrou</dt><dd>{item.why}</dd></div><div><dt>Vantagem a validar</dt><dd>{item.advantage}</dd></div><div><dt>Limites da comparação</dt><dd>{item.tradeoffs}</dd></div></dl><footer>{[item.category,item.manufacturer,item.registration&&`Registro ${item.registration}`].filter(Boolean).join(' • ')}</footer></article>)}</div></div>}
	    {valueBridge.path.length>0&&<details className="val-value-script"><summary><Route/><span><b>Ver caminho de argumentação</b><small>Frases simples para conduzir sem pressionar</small></span><ChevronRight/></summary><ol>{valueBridge.path.map((item,index)=><li key={item.id}><span>{index+1}</span><div><small>{item.step}</small><b>{item.line}</b><p>Registre: {item.evidence}</p></div></li>)}</ol></details>}
	    <div className="val-value-safety"><ShieldCheck/><span><b>{valueBridge.avoid}</b><small>{valueBridge.review}</small></span></div>
	   </section>}

	   <section className="val-sales-methods" aria-label="Método da abordagem aplicado ao produtor">
    <header className="val-sales-methods-head">
     <div><span className="val-sales-methods-icon"><BrainCircuit/></span><span><small>MÉTODO DA ABORDAGEM</small><h3>SPIN visível, OPC alinhado e EPA aplicado</h3><p>{response?'Leitura construída para esta conversa e este produtor.':'Envie uma situação para a VAL preencher cada método com os dados do produtor.'}</p></span></div>
    </header>

    <div className="val-method-tabs" role="tablist" aria-label="Escolher método da abordagem">{METHOD_TABS.map(item=><button key={item.key} id={`val-method-tab-${item.key}`} type="button" role="tab" aria-selected={activeMethod===item.key} aria-controls="val-method-panel" tabIndex={activeMethod===item.key?0:-1} className={activeMethod===item.key?'is-active':''} onClick={()=>setActiveMethod(item.key)} onKeyDown={event=>moveMethodFocus(event,item.key)}><span>{item.label}</span><span><b>{item.title}</b><small>{item.description}</small></span><ChevronRight/></button>)}</div>

    <div className={`val-sales-method-panel is-${activeMethod}`} id="val-method-panel" role="tabpanel" aria-labelledby={`val-method-tab-${activeMethod}`} tabIndex="0">
     {activeMethod==='spin'&&<article className="val-spin-method">
      <header><span><small>SPIN DA ABORDAGEM</small><h4>Uma pergunta útil por vez, sem transformar a conversa em interrogatório.</h4></span><em>Foco: {methodApplication.spin.find(item=>item.key===methodApplication.current)?.label}</em></header>
      <ol>{methodApplication.spin.map(item=><li key={item.key} className={`is-${item.status}`}>
       <span className="val-spin-letter">{item.letter}</span>
       <div><div className="val-spin-title"><span><b>{item.label}</b><small>{item.description}</small></span><em>{spinStatusLabels[item.status]}</em></div><p>{item.reading}</p>{item.question.text&&<blockquote><small>PERGUNTA {item.question.type.toUpperCase()}</small><b>{item.question.text}</b></blockquote>}</div>
      </li>)}</ol>
     </article>}

     {activeMethod==='opc'&&<article className="val-opc-method">
       <header><span className="val-method-monogram">OPC</span><span><small>CONTRATO DA CONVERSA</small><h4>Objetivo, Processo e Compromisso</h4></span></header>
       <dl>{methodApplication.opc.map(item=><div key={item.key}><dt><span>{item.letter}</span>{item.label}</dt><dd><b>{item.value}</b><small>{item.note}</small></dd></div>)}</dl>
     </article>}
     {activeMethod==='epa'&&<article className="val-epa-method">
       <header><span className="val-method-monogram">EPA</span><span><small>CONDUÇÃO DE VALOR</small><h4>Educar, Personalizar e Assumir a condução</h4></span></header>
       <dl>{methodApplication.epa.map(item=><div key={item.key}><dt><span>{item.letter}</span>{item.label}</dt><dd><b>{item.value}</b><small>{item.note}</small></dd></div>)}</dl>
     </article>}
    </div>
   </section>

   <section className="val-methodology" aria-label="Sequência lógica da conversa">
    <header><div><Route/><span><small>SEQUÊNCIA CONSULTIVA</small><h3>Etapa aberta: {methodLabels[activeSequenceStage]}</h3><p>Clique em uma etapa para abrir. Depois, escolha se quer trabalhar nela com a VAL.</p></span></div><div className="val-sequence-status" aria-live="polite"><span>Sugestão da VAL: <b>{methodLabels[methodology.current]}</b></span>{workingSequenceStage&&<em>Etapa de trabalho: <b>{methodLabels[workingSequenceStage]}</b></em>}</div></header>
    <div className="val-sequence-tabs" role="tablist" aria-label="Abrir etapas da sequência consultiva">{methodology.sequence.map((stage,index)=>{const status=methodology.current===stage?'current':methodology.completed.includes(stage)?'complete':'pending';return <button key={stage} id={`val-sequence-tab-${stage}`} type="button" role="tab" aria-label={`Abrir etapa ${methodLabels[stage]||stage}`} aria-selected={activeSequenceStage===stage} aria-controls="val-sequence-panel" tabIndex={activeSequenceStage===stage?0:-1} className={`is-${status} ${activeSequenceStage===stage?'is-selected':''} ${workingSequenceStage===stage?'is-working':''}`} onClick={()=>openSequenceStage(stage)} onKeyDown={event=>moveSequenceFocus(event,stage)}><span>{status==='complete'?<Check/>:String(index+1).padStart(2,'0')}</span><b>{methodLabels[stage]||stage}</b>{workingSequenceStage===stage&&<small>EM TRABALHO</small>}</button>})}</div>
    <div className={`val-sequence-detail is-${activeSequenceStatus}`} id="val-sequence-panel" role="tabpanel" aria-labelledby={`val-sequence-tab-${activeSequenceStage}`} tabIndex="0"><span>{String(VAL_METHOD_SEQUENCE.indexOf(activeSequenceStage)+1).padStart(2,'0')}</span><div><small>ETAPA ABERTA</small><h4>{methodLabels[activeSequenceStage]}</h4><p>{sequenceDetails[activeSequenceStage]}</p></div><aside><small>{workingSequenceStage===activeSequenceStage?'ETAPA ESCOLHIDA POR VOCÊ':activeSequenceStatus==='current'?'SUGESTÃO ATUAL DA VAL':activeSequenceStatus==='complete'?'ETAPA JÁ PERCORRIDA':'OUTRA ETAPA DA METODOLOGIA'}</small><b>{workingSequenceStage===activeSequenceStage?'A próxima orientação da VAL será construída para esta etapa, sem marcar as anteriores como concluídas.':activeSequenceStatus==='current'?(methodology.gate||'Registre a evidência necessária antes de avançar.'):activeSequenceStatus==='complete'?'Esta etapa aparece como concluída no histórico metodológico da VAL.':'Você pode trabalhar nesta etapa sem fabricar progresso ou evidência.'}</b>{activeSequenceStatus==='current'&&methodology.reason&&<p>{methodology.reason}</p>}</aside><footer className="val-sequence-actions"><button type="button" onClick={()=>browseSequence(-1)} disabled={activeSequenceIndex<=0}><ChevronLeft/>Anterior</button>{workingSequenceStage===activeSequenceStage?<button type="button" className="is-working" disabled><Check/>Etapa de trabalho</button>:<button type="button" className="is-primary" onClick={()=>workSequenceStage(activeSequenceStage)}><Target/>Trabalhar nesta etapa</button>}<button type="button" onClick={()=>browseSequence(1)} disabled={activeSequenceIndex<0||activeSequenceIndex>=methodology.sequence.length-1}>Próxima<ChevronRight/></button>{workingSequenceStage&&<button type="button" className="is-reset" onClick={followValSequence}>Voltar à sugestão da VAL</button>}</footer></div>
   </section>

   {interpretedAttachments.length>0&&<section className="val-attachment-reading" aria-label="Leitura dos arquivos">
    <header><FileSearch/><span><small>ARQUIVOS DESTA PERGUNTA</small><h3>O que eu consegui ler</h3></span></header>
    <p>Confira se a leitura corresponde ao original. A imagem ajuda a levantar observações e perguntas; isoladamente, não confirma causa ou diagnóstico.</p>
    <ul>{interpretedAttachments.map(item=><li key={item.id}><div>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<span><a href={'/api/val/attachments/'+item.id} target="_blank" rel="noreferrer">{item.originalName}</a><small>{attachmentStatusLabels[item.status]||item.status}</small></span></div>{item.analysis?.summary&&<p><b>Observação visual:</b> {item.analysis.summary}</p>}{item.analysis?.uncertainty&&<p><b>Falta confirmar:</b> {item.analysis.uncertainty}</p>}{item.status==='interpreted'&&<div className="val-file-actions"><button type="button" onClick={()=>updateAttachmentStatus(item.id,'confirmed')}><Check/>Confirmar como evidência</button><button type="button" onClick={()=>updateAttachmentStatus(item.id,'stored')}>Somente guardar</button></div>}</li>)}</ul>
   </section>}

   <details className="val-plan-details">
    <summary><Route/><span><b>Ver roteiro completo e o motivo</b><small>Ação, prazo, perguntas e sinais para avançar</small></span><ChevronRight/></summary>
   <section className={`val-executive-brief priority-${brief.priority}`} aria-label="Recomendação objetiva da VAL">
    <header><span>{priorityLabels[brief.priority]||priorityLabels.acompanhar}</span><h3>{brief.headline}</h3><p>{brief.reason}</p></header>
    <div className="val-brief-actions">
     <article><ClipboardCheck/><span><small>AÇÃO</small><b>{brief.action}</b></span></article>
     <article><Route/><span><small>PRAZO</small><b>{brief.deadline}</b></span></article>
     <article className={!brief.question?'is-empty':''}><MessageSquareText/><span><small>PERGUNTE</small><b>{brief.question||'Nenhuma pergunta necessária agora.'}</b></span></article>
    </div>
    <div className="val-brief-proof"><div><FileSearch/><span><small>BASE DA DECISÃO</small>{brief.decisionBasis.length?<ul>{brief.decisionBasis.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>:briefEvidence.length?<ul>{briefEvidence.map(item=><li key={item.id}>{item.summary}</li>)}</ul>:<b>Não há evidência suficiente para recomendar avanço.</b>}</span></div>{brief.missing.length>0&&<div><AlertCircle/><span><small>DADOS QUE FALTAM</small><ul>{brief.missing.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul></span></div>}</div>
    <div className="val-opportunity-review"><Target/><span><small>OPORTUNIDADES COMPARADAS</small><b>{countLabel(opportunityReview.total,'oportunidade analisada','oportunidades analisadas')} • {countLabel(opportunityReview.open,'aberta','abertas')}</b><em>{opportunityReview.title?`${opportunityReview.title}${opportunityReview.stage?` • ${opportunityReview.stage}`:''}${opportunityReview.value?` • ${opportunityReview.value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`:''}`:'Nenhuma oportunidade priorizada'}</em>{opportunityReview.reason&&<p>{opportunityReview.reason}</p>}{opportunityReview.alternatives.length>0&&<ul>{opportunityReview.alternatives.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>}</span></div>
    {humanReview?.required&&<div className="val-brief-review"><ShieldCheck/><span><b>Revisão técnica antes de executar</b><small>{humanReview.reason}</small></span></div>}
   </section>

   <section className="val-conversation-plan" aria-label="Roteiro sugerido para a conversa">
    <header><div><Route/><span><small>ROTEIRO PARA A CONVERSA</small><h3>Somente os passos úteis neste momento</h3></span></div><em>{conversation.steps.length} {conversation.steps.length===1?'passo':'passos'}</em></header>
    {conversation.opening&&<blockquote>{conversation.opening}</blockquote>}
    <ol>{conversation.steps.map((item,index)=><li key={item.id}><span>{String(index+1).padStart(2,'0')}</span><div><small>{item.stage}{item.type&&item.type!=='não_aplicável'?` • pergunta ${item.type.replace('_',' ')}`:''}</small><b>{item.goal}</b><p>{item.line}</p><dl><div><dt>Avance quando</dt><dd>{item.signal}</dd></div><div><dt>Se houver resistência</dt><dd>{item.resistance}</dd></div></dl></div></li>)}</ol>
    {conversation.closing.length>0&&<div className="val-closing-options"><small>OPÇÕES DE FECHAMENTO</small><div>{conversation.closing.map(item=><article key={item.id}><span>{item.when}</span><b>{item.line}</b><em>{item.commitment}</em></article>)}</div></div>}
    {conversation.avoid.length>0&&<div className="val-conversation-avoid"><small>EVITE NA CONVERSA</small><ul>{conversation.avoid.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
   </section>
   </details>

   <details className="val-analysis-details">
    <summary><DatabaseZap/>Ver dossiê e detalhes técnicos</summary>
    {response&&<div className="val-context-coverage"><div><DatabaseZap/><span><b>Dossiê cruzado pela VAL</b><small>Cadastro canônico{response.contextCoverage?.profile?' + perfil Produtor 360':''}</small></span></div><ul>{contextSources.length?contextSources.map(item=><li key={item.key}><b>{item.value}</b><span>{item.label}</span></li>):<li><b>1</b><span>cadastro do produtor</span></li>}</ul></div>}

   <div className="val-insight-grid">
    <article className="val-insight-card val-answer-card">
     <div className="val-card-label"><Lightbulb/>OBJETIVO DESTA ORIENTAÇÃO</div>
     <div className="val-objective"><Target/><div><small>Objetivo da conversa</small><b>{advice.objective}</b></div></div>
    </article>

    <article className="val-insight-card val-commercial-card">
     <div className="val-card-label"><Target/>CONTEXTO COMERCIAL</div>
     <div className="val-commercial-metrics"><span><small>Compras atuais</small><b>{compactBRL(commercialContext.current,{known:commercialContext.status!=='unknown'})}</b></span><span><small>Potencial total</small><b>{compactBRL(commercialContext.potential,{known:commercialContext.status!=='unknown'})}</b></span><span><small>Potencial em aberto</small><b>{compactBRL(commercialContext.open,{known:commercialContext.status!=='unknown'})}</b></span><span><small>Pipeline</small><b>{compactBRL(commercialContext.pipeline,{known:commercialContext.status!=='unknown'})}</b></span><span><small>Share realizado</small><b>{commercialContext.status==='unknown'?'A medir':`${commercialContext.share.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`}</b></span></div>
     {commercialContext.interpretation&&<p>{commercialContext.interpretation}</p>}
    </article>

    <article className="val-insight-card val-profile-card">
     <div className="val-card-label"><UserRoundSearch/>PERFIL DE DECISÃO</div>
     <p>{profile.hypothesis}</p>
     {profile.referenceIds.length>0&&<small>IDs das evidências do perfil: {profile.referenceIds.join(', ')}</small>}
     {profile.evidence.length>0&&<ul className="val-profile-evidence">{profile.evidence.map(item=><li key={item.id}><b>{item.summary}</b>{item.meta&&<small>{item.meta}</small>}</li>)}</ul>}
     <div className="val-profile-adaptation"><small>Adaptação da abordagem</small><b>{profile.adaptation}</b></div>
     <dl className="val-approach-plan"><div><dt>Tom</dt><dd>{approachPlan.tone}</dd></div><div><dt>Ritmo</dt><dd>{approachPlan.pace}</dd></div><div><dt>Canal</dt><dd>{approachPlan.channel}</dd></div><div><dt>Prova</dt><dd>{approachPlan.proof}</dd></div><div><dt>Quem participa</dt><dd>{approachPlan.participants}</dd></div><div><dt>Postura diante do risco</dt><dd>{approachPlan.risk}</dd></div><div><dt>Priorizar</dt><dd>{approachPlan.prioritize}</dd></div><div><dt>Evitar</dt><dd>{approachPlan.avoid}</dd></div></dl>
     <div className="val-value-hypothesis"><small>Hipótese de valor</small><b>{valueHypothesis.problem}</b>{valueHypothesis.alternatives.map(item=><span key={item}>{item}</span>)}{valueHypothesis.impact&&<span><strong>Quantificar:</strong> {valueHypothesis.impact}</span>}{valueHypothesis.metric&&<span><strong>Métrica:</strong> {valueHypothesis.metric}</span>}{valueHypothesis.proof&&<span><strong>Prova:</strong> {valueHypothesis.proof}</span>}{valueHypothesis.details.map(item=><span key={item}>{item}</span>)}</div>
    </article>

    <article className="val-insight-card val-questions-card">
     <div className="val-card-head"><div className="val-card-label"><MessageSquareText/>PRÓXIMA PERGUNTA E PLANO INTERNO</div><span>{questions.length} {questions.length===1?'opção':'opções'}</span></div>
     {questions.length?<ol>{questions.map((item,index)=><li key={item.id}><span>{String(index+1).padStart(2,'0')}</span><div><em>{item.stage} • {item.type}</em><p>{item.question}</p>{item.when&&<small><b>Quando perguntar:</b> {item.when}</small>}{item.purpose&&<small><b>Por quê:</b> {item.purpose}</small>}{item.evidence&&<small><b>Evidência necessária:</b> {item.evidence}</small>}{item.grounding.length>0&&<small><b>Base:</b> {item.grounding.join(', ')}</small>}</div></li>)}</ol>:<p className="val-empty-plan">A VAL definirá perguntas abertas e fechadas depois da análise.</p>}
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
