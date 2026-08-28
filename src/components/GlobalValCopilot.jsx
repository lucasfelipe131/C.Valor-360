import React,{useEffect,useMemo,useRef,useState} from 'react'
import {ArrowLeft,BrainCircuit,Camera,CheckCircle2,ChevronDown,Clock3,FileText,History,ImagePlus,LoaderCircle,MessageSquareText,PanelRightOpen,Paperclip,Plus,Search,Send,Settings2,ShieldCheck,Sparkles,UserRound,Volume2,X} from 'lucide-react'
import VoiceCapture from './voice/VoiceCapture'
import Logo from './Logo'
import DecisionInterviewCard from './copilot/DecisionInterviewCard'
import ValAudioResponse from './copilot/ValAudioResponse'
import ValRealtimeConversation from './copilot/ValRealtimeConversation'
import EphemeralSpeechButton from './copilot/EphemeralSpeechButton'
import ValContextualPanel from './copilot/ValContextualPanel'
import {AgronomicInsightCard,CalculationCard,CommitmentCard,DecisionCard,DiagnosisCard,EvidenceCard,GenericToolCard,KnowledgeCard,MarketCard,OpportunityCard,PrepareVisitCard} from './copilot/DecisionCards'
import {canonicalVoiceChange} from '../lib/copilot-view-model'
import {readConsultantExperiencePreference,writeConsultantExperiencePreference} from '../lib/consultant-experience-preference'
import {buildMarketContinuationMessage,buildRegisterPrefill,buildSessionReplyMessage,limitValChatMessage,normalizeValChatPayload,selectMarketContinuation,sessionRepliesForAsk} from '../lib/global-val-conversation'
import {buildConversationHistory,contextStatusLabel,conversationScopeKey,conversationScopeLabel,createConversationThreadKey,createScopedRegistrationDraft,readConversationWorkspace,registrationDraftTextForScope,writeConversationWorkspace} from '../lib/full-screen-conversation'
import {shouldAutoSubmitCopilotSeed} from '../lib/copilot-context'
import {resolveAgroHeroFileMime,validateAgroHeroFile} from '../lib/agro-hero-actions'
import {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'
import {hasValOutputModePreference,localNaturalCommandTurn,naturalCommandRequest,readValOutputMode,resolveValNaturalCommand,writeValOutputMode} from '../lib/val-natural-commands'
import {cancelVoiceInteraction,createVoiceInteraction,processVoiceInteraction,uploadVoiceAudio} from '../lib/voice-interactions-client'
import {attachmentContentUrl,attachmentMatchesBrowserScope} from '../lib/attachment-browser-scope'
import '../global-val-copilot.css'
import '../val-full-screen-copilot.css'

const ATTACHMENT_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
const MAX_ATTACHMENT_BYTES=6_000_000
const clientQuickPrompts=[
 ['PREPARE_VISIT','Preparar visita','Me prepare para a próxima visita com este produtor.'],
 ['CHECK_OPPORTUNITY','Ver oportunidades','Qual oportunidade merece atenção agora e por quê?'],
 ['ASK_CLIENT','Revisar última conversa','O que mudou desde a última conversa confirmada com este produtor?'],
 ['ASK_AGRONOMIC','Perguntar sobre agronomia','Cruze o contexto agronômico disponível com a decisão desta conta.'],
 ['FOLLOW_UP_HELP','Definir próximo passo','Qual é o próximo passo mais coerente e o que preciso confirmar?']
]
const globalQuickPrompts=[
 ['PICK_CLIENT','Preparar uma visita','Escolha o produtor e a VAL carregará o contexto sem pedir de novo.'],
 ['PICK_CLIENT','Perguntar sobre um produtor','Busque a conta e comece com o histórico correto.'],
 ['REGISTER','Registrar uma informação','Selecione o produtor para revisar antes de salvar.'],
 ['PICK_CLIENT','Analisar algo do campo','Abra uma análise com contexto técnico e safety.'],
 ['ASK_MARKET','Consultar mercado','Como está o mercado nas referências atuais autorizadas?'],
 ['ASK_COMMODITY','Consultar soja','Qual é a referência mais recente de soja e qual é a fonte?']
]
const firstName=value=>String(value||'produtor').trim().split(/\s+/)[0]
const formatSize=value=>Number(value||0)>=1_000_000?`${(Number(value)/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(Number(value||0)/1000))} KB`
const fileDataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Não consegui abrir este arquivo.'));reader.readAsDataURL(file)})
const probableAttachmentIntent=file=>{
 const name=String(file?.name||'').toLocaleLowerCase('pt-BR')
 const type=resolveAgroHeroFileMime(file)
 if(/solo|soil|fertilidade|laboratorio|laboratório|laudo/.test(name))return {intent:'ANALYZE_SOIL',tool:'soil',page:'solo',label:'análise de solo'}
 if(type.startsWith('image/'))return {intent:'IMAGE_DIAGNOSIS',tool:'diagnosis',page:'diagnostico',label:'diagnóstico por imagem'}
 if(type==='application/pdf')return {intent:'ANALYZE_SOIL',tool:'soil',page:'solo',label:'documento técnico ou análise de solo'}
 return {intent:'ASK_AGRONOMIC',tool:'',page:'inicio',label:'arquivo técnico'}
}
const voiceTranscriptOf=payload=>String(payload?.voice_interaction?.transcript?.transcript_text||payload?.interaction?.transcript?.transcript_text||payload?.transcript?.transcript_text||payload?.transcript_text||'').trim()
const conversationKey=(threadKey,storageScope)=>`valor360:val-copilot-thread:v4:${encodeURIComponent(String(storageScope||'session'))}:${encodeURIComponent(String(threadKey||'global'))}`
const conversationId=(threadKey,storageScope)=>{const key=conversationKey(threadKey,storageScope);try{const existing=sessionStorage.getItem(key);if(existing)return existing;const created=globalThis.crypto?.randomUUID?.()||`val-${Date.now()}-${Math.random().toString(36).slice(2)}`;sessionStorage.setItem(key,created);return created}catch{return `val-${String(storageScope||'session')}-${String(threadKey||'none')}-${Date.now()}`}}
const resetConversationId=(threadKey,storageScope)=>{try{sessionStorage.removeItem(conversationKey(threadKey,storageScope))}catch{}}
const recordConversationMetrics=sample=>fetch('/api/val/latency-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sample),signal:AbortSignal.timeout(5000)}).catch(()=>null)

async function prepareFile(file){
 const validation=validateAgroHeroFile(file,'file')
 if(!validation.ok)throw new Error(validation.message)
 const mimeType=resolveAgroHeroFileMime(file)
 if(!ATTACHMENT_TYPES.has(mimeType))throw new Error('Use foto, PDF, Word, Excel, CSV ou TXT.')
 if(file.size>MAX_ATTACHMENT_BYTES)throw new Error('Cada arquivo pode ter até 6 MB.')
 if(String(file.type||'').toLowerCase()===mimeType)return file
 return new File([file],file.name,{type:mimeType,lastModified:file.lastModified||Date.now()})
}

function ReasoningResponse({payload,sourceAttachments=[],density,outputMode,onReply,onRegister,onOpenModule,onOpenEvidence}){
 const advice=payload?.advice||{}
 const reasoning=advice.ai_reasoning||{}
 const thesis=reasoning.decision_thesis||{}
 const strategy=reasoning.recommended_strategy||{}
 const questions=Array.isArray(reasoning.golden_questions)?reasoning.golden_questions.slice(0,3):[]
 const facts=Array.isArray(reasoning.facts_used)?reasoning.facts_used:[]
 const knowledge=Array.isArray(reasoning.knowledge_refs)?reasoning.knowledge_refs:[]
 const quality=advice.val_response_quality||reasoning.quality||{}
 const toolResult=reasoning.run?.tool_result||null
 const degraded=quality.status==='REASONING_DEGRADED'||reasoning.run?.status==='REASONING_DEGRADED'
 const answer=strategy.reading||advice.answer||'A orientação chegou sem uma leitura principal.'
 const intent=String(reasoning.intent||'ASK_CLIENT').toUpperCase()
 const qualityTestLabel=test=>test?.evaluated===false?'não executado':test?.passed?'aprovado':'não aprovado'
 const audioNode=outputMode!=='text'?<ValAudioResponse text={reasoning.voice_output?.speakable_text||answer}/>:null
 const openWithSources=target=>onOpenModule?.({...((target&&typeof target==='object')?target:{page:target}),sourceAttachments})
 return <article className={`global-val-answer is-${density}`}>
  {degraded&&<p className="global-val-degraded">Tenho pouca informação para te orientar com precisão.</p>}
  <DecisionCard reasoning={reasoning} answer={answer} action={strategy.action} showText={outputMode!=='audio'} audioNode={audioNode}/>
  {toolResult&&<GenericToolCard title={toolResult.title} summary={toolResult.summary} status={toolResult.status} onOpen={()=>openWithSources({page:toolResult.page||'agro',tool:toolResult.tool,manualPage:toolResult.manual_page,mode:toolResult.mode,context:toolResult.context})}/>}
  {intent==='PREPARE_VISIT'&&<PrepareVisitCard reasoning={reasoning} questions={questions} onOpen={onOpenModule}/>}
  {toolResult?.status!=='CATALOG'&&['ASK_AGRONOMIC','ANALYZE_SOIL'].includes(intent)&&<AgronomicInsightCard reasoning={reasoning} onOpen={onOpenModule}/>}
  {intent==='IMAGE_DIAGNOSIS'&&<DiagnosisCard reasoning={reasoning} onOpen={openWithSources}/>}
  {intent==='CHECK_OPPORTUNITY'&&<OpportunityCard reasoning={reasoning} onOpen={onOpenModule}/>}
  {['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET','CHECK_WEATHER','CHECK_LABEL'].includes(intent)&&<MarketCard reasoning={reasoning} onOpen={onOpenModule}/>}
  {intent==='CALCULATE'&&<CalculationCard reasoning={reasoning} onOpen={onOpenModule}/>}
  {['FOLLOW_UP_HELP','POST_VISIT'].includes(intent)&&<CommitmentCard reasoning={reasoning} onOpen={onOpenModule}/>}
  <DecisionInterviewCard interview={reasoning.decision_interview} onReply={question=>onReply?.({...question,intent:reasoning.intent,objective:reasoning.objective,commodity:reasoning.commercial_context?.commodity||reasoning.premises?.current_data?.source?.commodity||'',season:reasoning.commercial_context?.season||''})} onRegister={onRegister}/>
  {intent!=='PREPARE_VISIT'&&questions.length>0&&<section className="global-val-questions"><small>PERGUNTAS QUE MUDAM A DECISÃO</small>{questions.map((item,index)=><div key={`${item.question}-${index}`}><b>{item.question}</b>{item.reason&&<span>{item.reason}</span>}</div>)}</section>}
  {density==='analytical'&&<div className="val-inline-evidence-grid"><EvidenceCard facts={facts} onOpen={onOpenEvidence}/><KnowledgeCard items={knowledge}/></div>}
  {density!=='simple'&&<details className="global-val-layer"><summary><Sparkles/>Por que a VAL disse isso?<ChevronDown/></summary><div><p><b>Situação:</b> {thesis.CURRENT_SITUATION}</p><p><b>O que importa:</b> {thesis.WHAT_MATTERS}</p><p><b>Incerteza-chave:</b> {thesis.KEY_UNCERTAINTY}</p><p><b>O que mudaria a leitura:</b> {thesis.WHAT_WOULD_CHANGE_MY_VIEW}</p>{facts.length>0&&<ul>{facts.slice(0,density==='analytical'?8:4).map(item=><li key={item.id}><span>{item.source_type}</span>{item.statement}</li>)}</ul>}</div></details>}
  {density==='analytical'&&<details className="global-val-layer"><summary><ShieldCheck/>Fontes, segurança e premissas<ChevronDown/></summary><div><p><b>ContextSnapshot:</b> {reasoning.context_snapshot?.id||'não informado'}</p><p><b>Confiança:</b> {reasoning.confidence?.level||'não calibrada'} • {Math.round(Number(reasoning.confidence?.score||0)*100)}%</p>{reasoning.reasoning_confidence&&<p><b>Confiança dimensional:</b> contexto {Math.round(Number(reasoning.reasoning_confidence.context||0)*100)}% • tese {Math.round(Number(reasoning.reasoning_confidence.thesis||0)*100)}% • pergunta {Math.round(Number(reasoning.reasoning_confidence.question||0)*100)}%{reasoning.reasoning_confidence.agronomy!=null?` • agronomia ${Math.round(Number(reasoning.reasoning_confidence.agronomy)*100)}%`:''}.</p>}<p><b>Caminho:</b> {reasoning.run?.path||'não informado'} • executado: {(reasoning.run?.capabilities_used||[]).join(', ')||'nenhuma capacidade'}{reasoning.run?.capabilities_planned?.length?` • planejado: ${reasoning.run.capabilities_planned.join(', ')}`:''}.</p><p><b>Qualidade da resposta:</b> {quality.status||'não informada'} • teste de troca de nome {qualityTestLabel(quality.automatic_tests?.name_swap)} • teste sem contexto {qualityTestLabel(quality.automatic_tests?.context_removal)}.</p><p><b>Memória:</b> esta conversa não promove fatos automaticamente. As premissas são recalculadas com contexto confirmado + respostas desta sessão em cada solicitação.</p></div></details>}
 </article>
}

export default function GlobalValCopilot({open,onClose,clients=[],contextClient=null,seed,onRefreshPortfolio,onOpenClient,onPrepareVisit,onNavigate,visits=[],opportunities=[],storageScope='session'}){
 const storedWorkspace=useMemo(()=>readConversationWorkspace(typeof sessionStorage==='undefined'?null:sessionStorage,storageScope),[storageScope])
 const [selectedId,setSelectedId]=useState(contextClient?.id||'')
 const [activeContext,setActiveContext]=useState(null)
 const [message,setMessage]=useState('')
 const [density,setDensity]=useState(()=>readConsultantExperiencePreference(storageScope).toLowerCase())
 const [outputMode,setOutputMode]=useState(()=>readValOutputMode(storageScope))
 const [mode,setMode]=useState('ASK')
 const [registrationDraft,setRegistrationDraft]=useState(null)
 const [registrationAutoOpenKey,setRegistrationAutoOpenKey]=useState('')
 const [replyingTo,setReplyingTo]=useState(null)
 const [pendingCapture,setPendingCapture]=useState('')
 const [voiceAutoOpenKey,setVoiceAutoOpenKey]=useState('')
 const [sessionReplyOffer,setSessionReplyOffer]=useState(null)
 const [sessionReplies,setSessionReplies]=useState({})
 const [threads,setThreads]=useState(storedWorkspace.threads)
 const [threadMetadata,setThreadMetadata]=useState(storedWorkspace.metadata)
 const [attachments,setAttachments]=useState([])
 const [pendingFiles,setPendingFiles]=useState([])
 const [seedFiles,setSeedFiles]=useState([])
 const [seedVoice,setSeedVoice]=useState(null)
 const [seedText,setSeedText]=useState(null)
 const [seedAttachmentIntent,setSeedAttachmentIntent]=useState('')
 const [pendingLinkId,setPendingLinkId]=useState('')
 const [busy,setBusy]=useState(false)
 const [uploading,setUploading]=useState(false)
 const [error,setError]=useState('')
 const [progress,setProgress]=useState(null)
 const [contextPanelOpen,setContextPanelOpen]=useState(false)
 const [contextTab,setContextTab]=useState('context')
 const [historyOpen,setHistoryOpen]=useState(false)
 const [historyQuery,setHistoryQuery]=useState('')
 const [threadOverride,setThreadOverride]=useState('')
 const [clarification,setClarification]=useState(null)
 const fileInput=useRef(null)
 const photoInput=useRef(null)
 const messageInput=useRef(null)
 const clientSelectRef=useRef(null)
 const pageRef=useRef(null)
 const uploadRunRef=useRef({generation:0,controller:null,targetClientId:''})
 const voiceActivationSequence=useRef(0)
 const registrationScopeRef=useRef({clientId:'',threadKey:''})
 const realtimeClarificationRef=useRef(null)
 const client=useMemo(()=>clients.find(item=>String(item.id)===String(selectedId))||null,[clients,selectedId])
 const canonicalThreadKey=useMemo(()=>conversationScopeKey({clientId:selectedId,context:activeContext}),[selectedId,activeContext])
 const threadKey=threadOverride||canonicalThreadKey
 registrationScopeRef.current={clientId:String(selectedId||''),threadKey}
 const thread=threads[threadKey]||[]
 const registerInitialText=useMemo(()=>registrationDraftTextForScope(registrationDraft,{clientId:selectedId,threadKey})||buildRegisterPrefill(sessionReplies[threadKey]||[]),[registrationDraft,selectedId,sessionReplies,threadKey])
 const latestPayload=useMemo(()=>[...thread].reverse().find(item=>item.role==='assistant')?.payload||null,[thread])
 const latestReasoning=latestPayload?.advice?.ai_reasoning||{}
 const realtimeResponseText=latestReasoning.voice_output?.speakable_text||latestReasoning.recommended_strategy?.reading||latestPayload?.advice?.answer||''
 const realtimeResponseKey=latestReasoning.reasoning_id||[...thread].reverse().find(item=>item.role==='assistant')?.at||''
 const history=useMemo(()=>buildConversationHistory({threads,metadata:threadMetadata,clients,query:historyQuery}),[threads,threadMetadata,clients,historyQuery])
 const visibleClients=useMemo(()=>{const query=historyQuery.trim().toLocaleLowerCase('pt-BR');return query?clients.filter(item=>String(item.name||'').toLocaleLowerCase('pt-BR').includes(query)).slice(0,8):clients.slice(0,6)},[clients,historyQuery])

 const cancelUploadRun=()=>{uploadRunRef.current.controller?.abort();uploadRunRef.current={generation:uploadRunRef.current.generation+1,controller:null,targetClientId:''};setUploading(false)}
 useEffect(()=>{if(contextClient?.id&&!uploading)setSelectedId(contextClient.id)},[contextClient?.id,uploading])
 useEffect(()=>{
  if(!seed?.nonce)return
  cancelUploadRun()
  const autoSubmit=Boolean(seed.autoSubmit&&seed.prompt)
  const incomingFiles=Array.isArray(seed.files)?seed.files.slice(0,3):[]
  setThreadOverride('');setSelectedId(seed.clientId||'')
  setActiveContext(seed.context||null)
  setMessage(seed.prompt||'')
  setMode(seed.mode||'ASK')
  setPendingCapture(seed.capture||'')
  setVoiceAutoOpenKey(seed.capture==='voice'?String(seed.nonce):'')
  setSeedFiles(incomingFiles)
  setSeedVoice(seed.voiceFile?{file:seed.voiceFile,recording:seed.recording||null,intent:seed.intent||'ASK_AGRONOMIC'}:null)
  setSeedText(autoSubmit?{nonce:seed.nonce,prompt:seed.prompt,intent:seed.intent||undefined,clientId:seed.clientId||'',context:seed.context||null}:null)
  if(autoSubmit||incomingFiles.length){setAttachments([]);setPendingFiles([]);setReplyingTo(null);setSessionReplyOffer(null);setError('')}
  setSeedAttachmentIntent(incomingFiles.length?seed.intent||'ASK_AGRONOMIC':'')
 },[seed?.nonce])
 useEffect(()=>{setDensity(readConsultantExperiencePreference(storageScope).toLowerCase())},[storageScope])
 useEffect(()=>{setOutputMode(readValOutputMode(storageScope))},[storageScope])
 useEffect(()=>()=>uploadRunRef.current.controller?.abort(),[])
 useEffect(()=>{
  const now=new Date().toISOString()
  setThreadMetadata(current=>({...current,[threadKey]:{...(current[threadKey]||{}),clientId:selectedId||'',clientName:client?.name||'',context:activeContext||null,label:conversationScopeLabel({client,context:activeContext}),createdAt:current[threadKey]?.createdAt||now,updatedAt:now}}))
 },[threadKey,selectedId,client?.name,activeContext])
 useEffect(()=>{writeConversationWorkspace(typeof sessionStorage==='undefined'?null:sessionStorage,storageScope,{threads,metadata:threadMetadata})},[threads,threadMetadata,storageScope])
 useEffect(()=>{
  if(!open||!pendingCapture)return
  const capture=pendingCapture
  if(capture==='text'){requestAnimationFrame(()=>messageInput.current?.focus());setPendingCapture('');return}
  if(capture==='voice')return
  const timer=window.setTimeout(()=>{if(capture==='photo')photoInput.current?.click();if(capture==='file')fileInput.current?.click();setPendingCapture('')},180)
  return()=>window.clearTimeout(timer)
 },[open,pendingCapture])
 useEffect(()=>{
  if(!open){cancelUploadRun();setSeedFiles([]);setSeedAttachmentIntent('');return}
  document.body.classList.add('val-fullscreen-open');requestAnimationFrame(()=>pageRef.current?.focus())
  return()=>document.body.classList.remove('val-fullscreen-open')
 },[open])
 useEffect(()=>{setAttachments([]);setError('');setReplyingTo(null);setSessionReplyOffer(null);setRegistrationDraft(null);setRegistrationAutoOpenKey('')},[selectedId,threadKey])

 const append=(item,key=threadKey)=>{
  const at=item.at||new Date().toISOString()
  setThreads(current=>({...current,[key]:[...(current[key]||[]),{...item,at}].slice(-20)}))
  setThreadMetadata(current=>({...current,[key]:{...(current[key]||{}),updatedAt:at}}))
 }
 const cancelRealtimeClarification=()=>{
  const pending=realtimeClarificationRef.current
  realtimeClarificationRef.current=null
  pending?.resolve({responseText:'',suppressSpeech:true,cancelled:true})
 }
 const chooseClient=id=>{if(busy||uploading)return;cancelRealtimeClarification();if(!id){newConversation({general:true});return}setThreadOverride('');setSelectedId(id);setActiveContext(null);setMode('ASK');setRegistrationDraft(null);setRegistrationAutoOpenKey('');setError('');setClarification(null);setHistoryOpen(false)}
 const requestPushToTalk=()=>{
  voiceActivationSequence.current+=1
  setVoiceAutoOpenKey(`push-to-talk-${Date.now()}-${voiceActivationSequence.current}`)
  setPendingCapture('voice')
 }
 const newConversation=({general=false}={})=>{
  if(busy||uploading)return
  cancelRealtimeClarification()
  const nextClientId=general?'':selectedId
  const nextKey=createConversationThreadKey({clientId:nextClientId})
  setThreadOverride(nextKey);if(general){setSelectedId('');setActiveContext(null)}
  setThreads(current=>({...current,[nextKey]:[]}));setSessionReplies(current=>({...current,[nextKey]:[]}));resetConversationId(nextKey,storageScope);setMessage('');setMode('ASK');setRegistrationDraft(null);setRegistrationAutoOpenKey('');setReplyingTo(null);setSessionReplyOffer(null);setAttachments([]);setPendingFiles([]);setSeedFiles([]);setSeedText(null);setSeedAttachmentIntent('');setPendingCapture('');setVoiceAutoOpenKey('');setError('');setClarification(null);setHistoryOpen(false)
  requestAnimationFrame(()=>messageInput.current?.focus())
 }
 const selectHistory=item=>{if(busy||uploading)return;cancelRealtimeClarification();setSelectedId(item.clientId||'');setActiveContext(item.context||null);setThreadOverride(item.key||'');setRegistrationDraft(null);setRegistrationAutoOpenKey('');setHistoryOpen(false);setMode('ASK')}

 const uploadFiles=async(files,targetClient)=>{
  const slots=Math.max(0,3-attachments.length);if(!slots){setError('Envie no máximo 3 arquivos por pergunta.');return false}
  uploadRunRef.current.controller?.abort()
  const generation=uploadRunRef.current.generation+1
  const controller=new AbortController()
  uploadRunRef.current={generation,controller,targetClientId:String(targetClient.id)}
  const isCurrent=()=>uploadRunRef.current.generation===generation&&uploadRunRef.current.controller===controller
  setUploading(true);setError('')
  try{
   for(const original of files.slice(0,slots)){
    const file=await prepareFile(original);const dataUrl=await fileDataUrl(file)
    if(!isCurrent())return false
    const timeout=AbortSignal.timeout(60_000);const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,timeout]):controller.signal
    const response=await fetch('/api/val/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:targetClient.id,originalName:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl}),signal})
    const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não consegui enviar este arquivo.')
    if(!isCurrent())return false
    setAttachments(current=>current.some(item=>item.id===payload.attachment.id)?current:[...current,payload.attachment].slice(0,3))
   }
    return true
  }catch(uploadError){if(isCurrent()&&uploadError?.name!=='AbortError'){setSeedAttachmentIntent('');setError(uploadError.message)}return false}finally{if(isCurrent()){uploadRunRef.current={generation,controller:null,targetClientId:''};setUploading(false)}}
 }
 useEffect(()=>{
  if(!seedFiles.length||uploading)return
  let cancelled=false
  const files=seedFiles.slice(0,3)
  Promise.all(files.map(prepareFile)).then(prepared=>{
   if(cancelled)return
   setSeedFiles([])
   if(!client){setPendingFiles(prepared);setPendingLinkId('');return}
   uploadFiles(prepared,client)
  }).catch(uploadError=>{if(!cancelled){setSeedFiles([]);setSeedAttachmentIntent('');setError(uploadError.message)}})
  return()=>{cancelled=true}
 },[seedFiles,client?.id,uploading])
 const upload=async event=>{
  const files=Array.from(event.target.files||[]);event.target.value=''
  if(!files.length||uploading)return
  let prepared
  try{prepared=await Promise.all(files.slice(0,3).map(prepareFile))}catch(uploadError){setSeedAttachmentIntent('');setError(uploadError.message);return}
  if(!client){setPendingFiles(prepared);setPendingLinkId('');setError('');return}
  await uploadFiles(prepared,client)
 }
 const linkPendingFiles=async()=>{
  if(uploading||uploadRunRef.current.controller)return
  const target=clients.find(item=>String(item.id)===String(pendingLinkId));if(!target){setError('Escolha o produtor para vincular e analisar o arquivo.');return}
  setSelectedId(target.id);setActiveContext(null)
  if(await uploadFiles(pendingFiles,target))setPendingFiles([])
 }
 const openUnlinkedWorkspace=async()=>{
  if(uploading||uploadRunRef.current.controller)return
  const probableFiles=pendingFiles.map(probableAttachmentIntent)
  const imageBatch=pendingFiles.length>=1&&pendingFiles.length<=3&&pendingFiles.every((file,index)=>probableFiles[index].intent==='IMAGE_DIAGNOSIS'&&['image/jpeg','image/png','image/webp'].includes(resolveAgroHeroFileMime(file)))
  const soilFile=pendingFiles.length===1&&probableFiles[0]?.intent==='ANALYZE_SOIL'&&['image/jpeg','image/png','image/webp','application/pdf'].includes(resolveAgroHeroFileMime(pendingFiles[0]))
  if(!imageBatch&&!soilFile){setError('Sem vínculo, envie de uma a três fotos do mesmo diagnóstico ou um único PDF/imagem de análise de solo. Para Word, Excel, CSV ou TXT, escolha um produtor.');return}
  const probable=probableFiles[0]
  const context={type:'unlinked_attachment',id:`session-${Date.now()}`,label:pendingFiles.length===1?pendingFiles[0].name:`${pendingFiles.length} arquivos`,tool:probable.tool,page:probable.page,unlinked:true}
  const selected=pendingFiles.slice(0,3);setUploading(true);setError('')
  try{
   const staged=[]
   for(const file of selected){
    const dataUrl=await fileDataUrl(file)
    const response=await fetch('/api/val/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({association:'UNLINKED',originalName:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl})})
    const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não consegui preservar a origem deste arquivo.')
    staged.push({file,sourceAttachment:payload.attachment})
   }
   setSeedAttachmentIntent('');setSeedFiles([]);setAttachments([]);setPendingFiles([]);setMessage('')
   onNavigate?.({page:'agro',tool:probable.tool||probable.page,manualPage:probable.page,label:probable.label,intent:probable.intent,context,files:staged})
  }catch(uploadError){setError(uploadError.message||'Não foi possível criar o attachment UNLINKED.')}finally{setUploading(false)}
 }

 const ask=async(rawMessage,intent,turnOptions={})=>{
  const prompt=String(rawMessage||message||(attachments.length?'Leia estes arquivos e me diga o que importa.':'')).trim()
  if(!client&&attachments.length){setError('Escolha o produtor antes de anexar uma evidência à conta.');return}
  if((!prompt&&!attachments.length)||busy)return
  const activeThreadKey=threadKey
  const activeThread=threads[activeThreadKey]||[]
  const activeReply=replyingTo
  const naturalCommand=!activeReply&&!attachments.length?resolveValNaturalCommand(prompt):null
  if(naturalCommand?.local){
   const userItem={role:'user',text:prompt,intent:'SESSION_COMMAND',command:naturalCommand.action,persistence:'NONE',at:new Date().toISOString()}
   append(userItem,activeThreadKey)
   if(naturalCommand.outputMode)setOutputMode(writeValOutputMode(storageScope,naturalCommand.outputMode))
   if(naturalCommand.density)setDensity(writeConsultantExperiencePreference(storageScope,naturalCommand.density.toUpperCase()).toLowerCase())
   if(naturalCommand.action==='OPEN_REGISTER'){
    if(client){setRegistrationDraft(createScopedRegistrationDraft({text:naturalCommand.candidate,clientId:client.id,threadKey:activeThreadKey}));setRegistrationAutoOpenKey(`register-${Date.now()}-${activeThreadKey}`);setMode('REGISTER')}
    else{setRegistrationDraft(null);setRegistrationAutoOpenKey('');setError('Escolha o produtor antes de revisar uma informação para registro.')}
   }
   if(naturalCommand.action==='KEEP_SESSION_ONLY'){setSessionReplyOffer(null);setMode('ASK')}
   const localTurn=localNaturalCommandTurn(naturalCommand,latestPayload);if(localTurn)append({...localTurn,at:new Date().toISOString()},activeThreadKey)
   const previousQuestions=[...activeThread].reverse().find(item=>item?.command==='GOLDEN_QUESTIONS_ONLY'&&item?.text)?.text
   const speakable=naturalCommand.action==='OUTPUT_AUDIO'?(previousQuestions||latestReasoning.voice_output?.speakable_text||latestReasoning.recommended_strategy?.reading):localTurn?.text
   const suppressSpeech=['OUTPUT_TEXT','GOLDEN_QUESTIONS_ONLY','KEEP_SESSION_ONLY'].includes(naturalCommand.action)
   setMessage('');setReplyingTo(null);return {responseText:speakable||'',suppressSpeech}
  }
  if(naturalCommand?.density)setDensity(writeConsultantExperiencePreference(storageScope,naturalCommand.density.toUpperCase()).toLowerCase())
  const continuation=!intent&&!activeReply&&!attachments.length?selectMarketContinuation({prompt,localThread:activeThread,globalThread:threads.__global__||[],hasClient:Boolean(client)}):null
  const effectiveIntent=intent||activeReply?.intent||continuation?.intent||undefined
  const priorSessionReplies=sessionRepliesForAsk({replies:sessionReplies[activeThreadKey]||[],activeReply,intent:effectiveIntent})
  const latestUser=[...activeThread].reverse().find(item=>item.role==='user')
  const sessionObjective=activeReply?.objective||priorSessionReplies[0]?.objective||latestUser?.objective||latestUser?.text||continuation?.objective||prompt
  const currentSessionReplies=activeReply?.question?[...priorSessionReplies,{field:activeReply.field||'',question:activeReply.question,answer:prompt,intent:effectiveIntent||'',objective:sessionObjective,commodity:activeReply.commodity||'',season:activeReply.season||''}]:priorSessionReplies
  const contextualRequest=activeReply?.question
   ?buildSessionReplyMessage({objective:sessionObjective,replies:currentSessionReplies})
   :continuation
    ?buildMarketContinuationMessage({objective:continuation.objective,prompt})
    :limitValChatMessage(prompt)
  const requestMessage=naturalCommand?naturalCommandRequest(naturalCommand,contextualRequest):contextualRequest
  const submittedAttachments=attachments.slice(0,3)
  const userItem={role:'user',text:prompt||'Analisar os arquivos enviados.',objective:continuation?requestMessage:prompt,intent:effectiveIntent||'',at:new Date().toISOString()}
  if(!activeReply){setSessionReplies(current=>({...current,[activeThreadKey]:[]}));setSessionReplyOffer(null)}
  if(!turnOptions.retry)append(userItem,activeThreadKey);setBusy(true);setError('');setMessage('');setReplyingTo(null);setProgress(client?initialValProgress():{stage:'current_data',label:'Consultando a fonte autorizada mais recente',done:false})
  const controller=new AbortController();const requestId=createValProgressRequestId();const stopProgress=client?startValProgressPolling({requestId,onProgress:setProgress,signal:controller.signal}):()=>{}
  try{
   const timeout=AbortSignal.timeout(120_000);const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,timeout]):timeout
   const response=await fetch('/api/val/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client?.id||'',client:client||undefined,message:requestMessage,attachmentIds:attachments.map(item=>item.id),mode:'daily',intent:effectiveIntent,sessionCommand:naturalCommand?.action||undefined,conversationId:conversationId(activeThreadKey,storageScope),requestId,context:activeContext||undefined,sessionContext:{objective:sessionObjective,replies:currentSessionReplies.slice(-6),active_object:activeContext||null,persistence_mode:'NONE',input_modality:turnOptions.inputModality==='voice'?'voice':attachments.some(item=>item.mimeType?.startsWith('image/'))?'photo':attachments.length?'file':'text',response_mode:turnOptions.responseMode||outputMode,conversation_mode:turnOptions.conversationMode===true}}),signal})
   const rawPayload=await response.json().catch(()=>null);if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok){const requestFailure=new Error(rawPayload?.error||'A VAL não respondeu agora.');requestFailure.payload=rawPayload;throw requestFailure}
   const payload=normalizeValChatPayload(rawPayload);if(!payload)throw new Error('A resposta chegou fora do contrato esperado. Tente novamente; nenhuma memória foi alterada.')
   const resolvedClient=payload.conversationResolution?.status==='RESOLVED'?payload.conversationResolution.client:null
   if(resolvedClient?.id){setSelectedId(resolvedClient.id);setThreadOverride(activeThreadKey);if(payload.conversationResolution?.changed_client)setActiveContext(null);setClarification(null)}
   const sourceAttachments=(Array.isArray(payload.attachments)&&payload.attachments.length?payload.attachments:submittedAttachments).map(item=>{const association=item.association==='UNLINKED'?'UNLINKED':'LINKED_CLIENT';return {id:item.id,organizationId:item.organizationId||'',clientId:association==='UNLINKED'?'':item.clientId||resolvedClient?.id||client?.id||'',association,propertyId:activeContext?.type==='property'?activeContext.id:'',fieldId:activeContext?.type==='field'?activeContext.id:'',originalName:item.originalName||'',mimeType:item.mimeType||'',createdAt:item.createdAt||'',sha256:item.sha256||''}}).filter(item=>item.id)
   setThreads(current=>({...current,[activeThreadKey]:[...(current[activeThreadKey]||[]),{role:'assistant',payload,sourceAttachments,at:new Date().toISOString()}].slice(-20)}));setAttachments([])
   if(activeReply){setSessionReplies(current=>({...current,[activeThreadKey]:currentSessionReplies.slice(-6)}));setSessionReplyOffer({question:activeReply.question,answer:prompt,intent:activeReply.intent||effectiveIntent||''})}
   const reasoning=payload?.advice?.ai_reasoning||{}
   return {payload,responseText:reasoning.voice_output?.speakable_text||reasoning.recommended_strategy?.reading||payload?.advice?.answer||'',suppressSpeech:turnOptions.conversationMode===true&&turnOptions.responseMode==='text'}
 }catch(requestError){
  const pending=requestError.payload?.clarification
  const clarificationTurn=pending?{...pending,prompt,intent:effectiveIntent||'',turnOptions:{...turnOptions},activeThreadKey}:null
  setClarification(clarificationTurn)
  if(pending&&turnOptions.conversationMode===true&&Array.isArray(pending.options)&&pending.options.length){
   setError('');stopProgress();controller.abort();setProgress(null);setBusy(false)
   return await new Promise((resolve,reject)=>{
    const previous=realtimeClarificationRef.current
    realtimeClarificationRef.current={resolve,reject,activeThreadKey}
    previous?.resolve({responseText:'',suppressSpeech:true,cancelled:true})
   })
  }
  setError(requestError.name==='TimeoutError'?'A análise ultrapassou o tempo. Tente novamente.':requestError.message)
  if(turnOptions.conversationMode===true)throw requestError
  return null
 }finally{stopProgress();controller.abort();setProgress(null);setBusy(false)}
 }

 const selectClarification=option=>{
  if(!option?.id||busy)return
  setSelectedId(option.id);setThreadOverride(threadKey);setError('')
  setClarification(current=>current?{...current,selectedId:option.id}:null)
 }

 useEffect(()=>{
  if(!clarification?.selectedId||String(client?.id)!==String(clarification.selectedId)||busy)return
  const pending=clarification;setClarification(null)
  const continuation=realtimeClarificationRef.current
  ask(pending.prompt,pending.intent,{...(pending.turnOptions||{}),retry:true}).then(result=>{
   if(continuation&&realtimeClarificationRef.current===continuation){realtimeClarificationRef.current=null;continuation.resolve(result)}
  }).catch(retryError=>{
   if(continuation&&realtimeClarificationRef.current===continuation){realtimeClarificationRef.current=null;continuation.reject(retryError)}
  })
 },[clarification?.selectedId,client?.id,busy])

 useEffect(()=>{
  if(!open){if(seedText)setSeedText(null);return}
  if(!shouldAutoSubmitCopilotSeed({open,seedText,busy,uploading,selectedId,activeContext}))return
  const pending=seedText;setSeedText(null)
  ask(pending.prompt,pending.intent)
 },[open,seedText?.nonce,selectedId,activeContext,busy,uploading])

 useEffect(()=>{
  if(!seedVoice?.file||busy||uploading)return
  const controller=new AbortController();let interactionId='';let disposed=false
  const run=async()=>{
   setUploading(true);setError('');setProgress({stage:'voice',label:'Transcrevendo a pergunta por voz…',done:false})
   try{
    let transcript=''
    if(client){
     const created=await createVoiceInteraction({clientId:client.id,interactionType:'GENERAL_CONTEXT',sourceContext:{page:'AGRO_HERO',persistence_mode:'NONE',active_context:activeContext||null},signal:controller.signal})
     interactionId=String(created?.voice_interaction?.voice_interaction_id||created?.interaction?.voice_interaction_id||created?.voice_interaction_id||created?.id||'')
     if(!interactionId)throw new Error('A interação de voz não recebeu identificador.')
     await uploadVoiceAudio(interactionId,{blob:seedVoice.file,originalName:seedVoice.file.name,mimeType:seedVoice.file.type,durationSeconds:seedVoice.recording?.durationSeconds,signal:controller.signal})
     transcript=voiceTranscriptOf(await processVoiceInteraction(interactionId,{signal:controller.signal}))
    }else{
     const dataUrl=await fileDataUrl(seedVoice.file)
     const response=await fetch('/api/val/voice/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({originalName:seedVoice.file.name,mimeType:seedVoice.file.type,sizeBytes:seedVoice.file.size,durationSeconds:seedVoice.recording?.durationSeconds||0,dataUrl,context:activeContext||undefined,persistenceMode:'NONE'}),signal:controller.signal})
     const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não consegui transcrever esta pergunta.')
     transcript=String(payload.transcript||'').trim()
    }
    if(!transcript)throw new Error('A VAL não conseguiu transformar este áudio em texto.')
    if(!disposed)await ask(transcript,seedVoice.intent||undefined)
   }catch(voiceError){if(!disposed&&voiceError?.name!=='AbortError')setError(voiceError.message||'Não foi possível concluir a pergunta por voz.')}
   finally{
    if(interactionId)cancelVoiceInteraction(interactionId).catch(()=>null)
    if(!disposed){setSeedVoice(null);setUploading(false);setProgress(null)}
   }
  }
  run()
  return()=>{disposed=true;controller.abort()}
 },[seedVoice?.file,client?.id])

 useEffect(()=>{
  if(!seedAttachmentIntent||!attachments.length||busy||uploading||!client)return
  const intent=seedAttachmentIntent;setSeedAttachmentIntent('')
  ask(message||'Analise o material enviado, identifique o tipo provável e diga o que muda a decisão.',intent)
 },[seedAttachmentIntent,attachments.length,busy,uploading,client?.id])

 const registered=async(payload,scope)=>{
  const expectedClientId=String(scope?.clientId||'')
  const expectedThreadKey=String(scope?.threadKey||'')
  const payloadClientId=String(payload?.voice_interaction?.client_id||payload?.interaction?.client_id||'')
  if(!expectedClientId||!expectedThreadKey||(payloadClientId&&payloadClientId!==expectedClientId)){setRegistrationDraft(null);setError('A confirmação não corresponde ao produtor e à conversa de origem. Atualize o contexto antes de tentar novamente.');return}
  const stillActive=registrationScopeRef.current.clientId===expectedClientId&&registrationScopeRef.current.threadKey===expectedThreadKey
  const confirmed=canonicalVoiceChange(payload)
  if(!confirmed){append({role:'system',text:'Revisão concluída sem nova informação confirmada.'},expectedThreadKey);return}
  append({role:'system',text:'Informação confirmada. As premissas deste produtor serão recalculadas na próxima pergunta.'},expectedThreadKey)
  setSessionReplies(current=>({...current,[expectedThreadKey]:[]}))
  if(stillActive){setSessionReplyOffer(null);setRegistrationDraft(null);setRegistrationAutoOpenKey('');setMode('ASK')}
  try{await onRefreshPortfolio?.()}catch{}
 }
 const runQuickAction=(intent,prompt)=>{
  if(intent==='PICK_CLIENT'){setError('Escolha um produtor no campo de contexto para começar com os dados corretos.');clientSelectRef.current?.focus();return}
  if(intent==='REGISTER'){setMode('REGISTER');clientSelectRef.current?.focus();return}
  ask(prompt,intent)
 }
 const openEvidence=()=>{setContextTab('evidence');setContextPanelOpen(true)}
 const openModule=async target=>{
  const descriptor=target&&typeof target==='object'?target:{page:target}
  if(descriptor.page==='visits'&&client){onPrepareVisit?.(client);return}
  const sourceAttachments=Array.isArray(descriptor.sourceAttachments)?descriptor.sourceAttachments.slice(0,3):[]
  if(descriptor.page==='agro'&&sourceAttachments.length){
   const requestClientId=String(client?.id||'')
   const allowUnlinked=!requestClientId&&Boolean(activeContext?.unlinked||descriptor.context?.unlinked)
   setUploading(true);setError('')
   try{
    if(sourceAttachments.some(sourceAttachment=>!attachmentMatchesBrowserScope(sourceAttachment,{clientId:requestClientId,allowUnlinked})))throw new Error('Este card pertence a outro produtor. Abra a conversa de origem para usar o attachment com o contexto correto.')
    const files=await Promise.all(sourceAttachments.map(async sourceAttachment=>{
     const response=await fetch(attachmentContentUrl(sourceAttachment,{clientId:requestClientId,allowUnlinked}),{headers:{Accept:'*/*'}})
     if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error('O attachment de origem não está mais disponível neste escopo.')
     const blob=await response.blob();const file=new File([blob],sourceAttachment.originalName||`attachment-${sourceAttachment.id}`,{type:blob.type||sourceAttachment.mimeType||'application/octet-stream',lastModified:Date.parse(sourceAttachment.createdAt)||Date.now()})
     return {file,sourceAttachment}
    }))
    onNavigate?.({...descriptor,files,clientId:requestClientId,context:{...(activeContext||{}),...(descriptor.context||{})}})
   }catch(openError){setError(openError.message||'Não foi possível abrir o attachment no diagnóstico.')}finally{setUploading(false)}
   return
  }
  onNavigate?.({...descriptor,clientId:client?.id||'',context:{...(activeContext||{}),...(descriptor.context||{})}})
 }
 const historyGroups=history.reduce((map,item)=>{const values=map.get(item.group)||[];values.push(item);map.set(item.group,values);return map},new Map())

 if(!open)return null
 return <section ref={pageRef} className={`val-fullscreen-page ${contextPanelOpen?'has-context-panel':''}`} aria-labelledby="global-val-title" tabIndex="-1">
  {historyOpen&&<><button type="button" className="val-history-backdrop" aria-label="Fechar histórico" onClick={()=>setHistoryOpen(false)}/><aside className="val-history-drawer" aria-label="Histórico de conversas"><header><div><small>VAL</small><h2>Conversas</h2></div><button type="button" aria-label="Fechar histórico" onClick={()=>setHistoryOpen(false)}><X/></button></header><button type="button" className="val-new-thread" onClick={()=>newConversation({general:true})}><Plus/>Nova conversa geral</button><label className="val-history-search"><Search/><input value={historyQuery} onChange={event=>setHistoryQuery(event.target.value)} placeholder="Buscar produtor ou conversa"/></label>{[...historyGroups].map(([group,items])=><section key={group}><h3>{group}</h3>{items.map(item=><button type="button" key={item.key} onClick={()=>selectHistory(item)}><Clock3/><span><b>{item.label}</b><small>{item.preview}</small></span></button>)}</section>)}{visibleClients.length>0&&<section><h3>Produtores</h3>{visibleClients.map(item=><button type="button" key={item.id} onClick={()=>chooseClient(item.id)}><UserRound/><span><b>{item.name}</b><small>Abrir conversa por produtor</small></span></button>)}</section>}</aside></>}
  <header className="val-fs-header">
   <button type="button" className="val-fs-back" aria-label="Voltar" onClick={onClose} disabled={uploading}><ArrowLeft/></button>
   <div className="val-fs-brand"><span><Logo variant="icon-only" surface="dark" decorative/></span><div><small>VAL • COPILOTO DE DECISÃO</small><h1 id="global-val-title">VAL</h1>{client&&<b>{client.name}</b>}</div></div>
   <div className="val-fs-status"><span>{activeContext?.label||latestReasoning.intent?.replaceAll('_',' ')||'Conversa de decisão'}</span><em>{contextStatusLabel({client,context:activeContext})}</em>{latestReasoning.run?.path&&<i className={`is-${String(latestReasoning.run.path).toLowerCase()}`}>{latestReasoning.run.path}</i>}</div>
   <div className="val-fs-header-actions"><button type="button" onClick={()=>setHistoryOpen(true)} disabled={uploading}><History/><span>Histórico</span></button><button type="button" onClick={()=>newConversation()} disabled={busy||uploading}><Plus/><span>Nova conversa</span></button><button type="button" className={contextPanelOpen?'active':''} aria-pressed={contextPanelOpen} onClick={()=>setContextPanelOpen(value=>!value)}><PanelRightOpen/><span>Contexto</span></button></div>
  </header>
  <div className="val-fs-workspace">
   <section className="val-fs-conversation" aria-label="Conversa com a VAL">
    <div className="val-fs-toolbar">
     <label className="val-fs-client"><UserRound/><span>Produtor atual</span><select ref={clientSelectRef} value={selectedId} onChange={event=>chooseClient(event.target.value)} disabled={busy||uploading}><option value="">Sem produtor • pergunta geral</option>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
     {activeContext&&<div className="val-fs-active-context"><span><b>{activeContext.type?.replaceAll('_',' ')||'contexto'}</b>{activeContext.label}</span><button type="button" aria-label="Remover objeto ativo" onClick={()=>setActiveContext(null)}><X/></button></div>}
     {client&&<button type="button" className="val-fs-open-client" onClick={()=>onOpenClient?.(client)}>Abrir Produtor 360</button>}
     <div className="global-val-mode" role="tablist" aria-label="Ação da VAL"><button type="button" className={mode==='ASK'?'active':''} onClick={()=>{setRegistrationAutoOpenKey('');setMode('ASK')}}><MessageSquareText/>Perguntar</button><button type="button" className={mode==='REGISTER'?'active':''} onClick={()=>{setRegistrationDraft(null);setRegistrationAutoOpenKey('');setMode('REGISTER')}}><CheckCircle2/>Registrar</button></div>
     <details className="val-fs-preferences"><summary aria-label="Preferências da resposta"><Settings2/></summary><div><div className="global-val-density"><span>Resposta</span>{[['simple','Simples'],['balanced','Equilibrada'],['analytical','Analítica']].map(([id,label])=><button type="button" key={id} className={density===id?'active':''} onClick={()=>setDensity(writeConsultantExperiencePreference(storageScope,id.toUpperCase()).toLowerCase())}>{label}</button>)}</div><div className="global-val-output"><span><Volume2/>Saída</span>{[['text','Texto'],['audio','Áudio'],['both','Texto + áudio']].map(([id,label])=><button type="button" key={id} className={outputMode===id?'active':''} onClick={()=>setOutputMode(writeValOutputMode(storageScope,id))}>{label}</button>)}</div></div></details>
    </div>
    {mode==='ASK'&&<ValRealtimeConversation disabled={busy||uploading} processing={busy} responseText={realtimeResponseText} responseKey={realtimeResponseKey} onStart={()=>{if(!hasValOutputModePreference(storageScope))setOutputMode(writeValOutputMode(storageScope,'audio'))}} onTranscript={(transcript)=>ask(transcript,undefined,{inputModality:'voice',responseMode:outputMode,conversationMode:true})} onError={message=>setError(message)} onMetrics={recordConversationMetrics} onExit={cancelRealtimeClarification} onFallbackPushToTalk={requestPushToTalk} onFallbackText={()=>messageInput.current?.focus()}/>}
    <div className="global-val-thread" aria-live="polite">
     {!thread.length&&mode==='ASK'&&<section className="global-val-empty"><span><BrainCircuit/></span><small>VAL • AMBIENTE DE TRABALHO</small><h2>{client?`Estou com ${firstName(client.name)} aberto.`:'Pode falar comigo.'}</h2><p>{client?'Quer preparar uma conversa, revisar o que ficou pendente ou ver o que merece atenção agora?':'Se for sobre um produtor específico, eu localizo o contexto para você.'}</p><div>{(client?clientQuickPrompts:globalQuickPrompts).map(([intent,label,prompt])=><button type="button" key={`${intent}-${label}`} disabled={busy} onClick={()=>runQuickAction(intent,prompt)}><b>{label}</b>{!client&&prompt&&<small>{prompt}</small>}</button>)}</div></section>}
     {thread.map((item,index)=>item.role==='assistant'?<ReasoningResponse key={`${item.at||index}-${index}`} payload={item.payload} sourceAttachments={item.sourceAttachments} density={density} outputMode={outputMode} onReply={question=>{setReplyingTo(question);setMessage('');setMode('ASK');requestAnimationFrame(()=>messageInput.current?.focus())}} onRegister={()=>setMode('REGISTER')} onOpenModule={openModule} onOpenEvidence={openEvidence}/>:<p key={`${item.at||index}-${index}`} className={`global-val-message is-${item.role}`}>{item.text}</p>)}
     {mode==='REGISTER'&&<section className="global-val-register"><ShieldCheck/><h3>Atualize as premissas com confirmação.</h3><p>{client?'Fale ou digite o que mudou. A VAL separa fatos, hipóteses e compromissos para você revisar antes de incorporar à memória.':'Escolha um produtor acima. Uma informação só pode entrar na memória quando sabemos a qual conta ela pertence.'}</p><VoiceCapture key={`register:${client?.id||'none'}:${threadKey}`} clientId={client?.id||''} interactionType="CLIENT_NOTE" label="Falar ou digitar" description="Revisar antes de salvar" initialText={registerInitialText} autoOpenKey={registrationAutoOpenKey} onOpenChange={isOpen=>{if(isOpen)setRegistrationAutoOpenKey('')}} sourceContext={{page:'GLOBAL_VAL_COPILOT',persistence_mode:'CONFIRM_REQUIRED',conversation_thread:threadKey}} onConfirmed={payload=>registered(payload,{clientId:client?.id||'',threadKey})}/></section>}
     {busy&&<div className="global-val-thinking" role="status"><LoaderCircle/><span><b>{progress?.label||'Analisando a solicitação…'}</b><small>{client?'Etapa real do processamento. Se faltar algo material, a VAL perguntará.':'A VAL não usa memória antiga como dado atual.'}</small></span></div>}
    </div>
    {mode==='ASK'&&<div className="global-val-composer-wrap">
     {sessionReplyOffer&&<div className="global-val-session-offer"><ShieldCheck/><span><b>Usada somente nesta conversa</b><small>Essa resposta já recalculou a leitura, mas ainda não alterou a memória confirmada.</small></span><button type="button" onClick={()=>setMode('REGISTER')}>Revisar e registrar</button><button type="button" className="is-dismiss" aria-label="Manter apenas nesta conversa" onClick={()=>setSessionReplyOffer(null)}><X/></button></div>}
    {replyingTo&&<div className="global-val-replying"><MessageSquareText/><span><b>Respondendo à pergunta material</b><small>{replyingTo.question}</small></span><button type="button" aria-label="Cancelar resposta" onClick={()=>setReplyingTo(null)}><X/></button></div>}
     {clarification?.options?.length>0&&<div className="global-val-clarification" role="group" aria-label="Desambiguar produtor"><UserRound/><span><b>{clarification.question||'Qual produtor você quer usar?'}</b><small>A VAL só mostra opções da sua carteira autorizada.</small></span><div>{clarification.options.map(option=><button type="button" key={option.id} disabled={busy} onClick={()=>selectClarification(option)}><b>{option.name}</b>{option.municipality&&<small>{option.municipality}</small>}</button>)}</div></div>}
     {pendingFiles.length>0&&<div className="val-unlinked-file"><FileText/><span><b>{pendingFiles.length===1?pendingFiles[0].name:`${pendingFiles.length} arquivos selecionados`}</b><small>Quer vincular esta análise a algum produtor?</small></span><select aria-label="Produtor para vincular o arquivo" value={pendingLinkId} disabled={uploading} onChange={event=>setPendingLinkId(event.target.value)}><option value="">Selecione</option>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={linkPendingFiles} disabled={uploading}>Vincular e continuar</button><button type="button" className="is-unlinked" onClick={openUnlinkedWorkspace} disabled={uploading}>Deixar sem vínculo</button><button type="button" className="is-remove" aria-label="Remover arquivo local" disabled={uploading} onClick={()=>{if(uploadRunRef.current.controller)return;setPendingFiles([]);setSeedFiles([]);setSeedAttachmentIntent('')}}><X/></button></div>}
     {attachments.length>0&&<div className="global-val-attachments">{attachments.map(item=><span key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<b>{item.originalName}</b><small>{formatSize(item.sizeBytes)}</small><button type="button" aria-label={`Remover ${item.originalName}`} onClick={()=>setAttachments(current=>current.filter(entry=>entry.id!==item.id))}><X/></button></span>)}</div>}
     <form className="global-val-composer" onSubmit={event=>{event.preventDefault();ask(message)}}>
      <div className="val-fs-voice-action">{client?<VoiceCapture transient clientId={client.id} interactionType="GENERAL_CONTEXT" label="Perguntar por voz" description="A fala não será salva como memória" sourceContext={{page:'GLOBAL_VAL_COPILOT',persistence_mode:'NONE',active_context:activeContext||null}} autoOpenKey={pendingCapture==='voice'?voiceAutoOpenKey:''} onOpenChange={isOpen=>{if(isOpen){setPendingCapture('');setVoiceAutoOpenKey('')}}} onTranscribed={transcript=>{setPendingCapture('');setVoiceAutoOpenKey('');ask(transcript)}}/>:<EphemeralSpeechButton disabled={busy} autoStartKey={pendingCapture==='voice'?voiceAutoOpenKey:''} onListeningChange={isListening=>{if(isListening){setPendingCapture('');setVoiceAutoOpenKey('')}}} onTranscript={transcript=>{setPendingCapture('');setVoiceAutoOpenKey('');ask(transcript)}} onError={message=>{setPendingCapture('');setVoiceAutoOpenKey('');setError(message)}}/>}</div>
      <button type="button" onClick={()=>photoInput.current?.click()} disabled={busy||uploading} aria-label="Tirar ou escolher foto"><Camera/></button><button type="button" onClick={()=>fileInput.current?.click()} disabled={busy||uploading} aria-label="Anexar arquivo"><Paperclip/></button>
      <label><span className="sr-only">Pergunte à VAL</span><textarea ref={messageInput} rows="2" value={message} maxLength="3000" disabled={busy} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask(message)}}} placeholder={replyingTo?'Digite a resposta do consultor…':client?`Pergunte ou peça algo sobre ${firstName(client.name)}…`:'Pergunte ou peça algo à VAL…'}/></label>
      <button type="submit" className="is-send" aria-label="Enviar" disabled={busy||uploading||(!message.trim()&&!attachments.length)}>{busy?<LoaderCircle/>:<Send/>}</button>
      <input ref={fileInput} className="sr-only" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,text/csv,text/plain" onChange={upload}/><input ref={photoInput} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" capture="environment" onChange={upload}/>
     </form>
     <div className="val-fs-composer-policy"><ShieldCheck/>Perguntar não atualiza fatos. REGISTER exige confirmação humana.{uploading&&<span><LoaderCircle/>Enviando arquivo…</span>}</div>{error&&<p className="global-val-error" role="alert">{error}</p>}
    </div>}
   </section>
   <ValContextualPanel open={contextPanelOpen} tab={contextTab} onTab={setContextTab} onClose={()=>setContextPanelOpen(false)} client={client} context={activeContext} visits={visits} opportunities={opportunities} latestPayload={latestPayload} history={history} onOpenModule={openModule} onSelectHistory={selectHistory}/>
  </div>
 </section>
}
