import React,{useEffect,useMemo,useRef,useState} from 'react'
import {AlertTriangle,ArrowLeft,BookOpen,BrainCircuit,Calculator,Camera,CheckCircle2,CloudSun,FileSearch,FileText,FlaskConical,History,Image,Keyboard,LandPlot,Layers3,Library,LoaderCircle,Maximize2,Mic,Minimize2,Newspaper,Paperclip,Search,Send,ShieldCheck,Sprout,Square,UsersRound,X} from 'lucide-react'
import Logo from '../components/Logo'
import {
 AGRO_HERO_FILE_POLICY,
 agroHeroVoiceError,
 buildAgroCopilotLaunchContext,
 createAgroHeroActionPayload,
 createAgroHeroContext,
 createAgroHeroFileCandidate,
 createAgroHeroStates,
 createAgroHeroTelemetry,
 createAgroWorkspaceMessage,
 normalizeAgroToolDescriptor,
 transitionAgroHeroState,
 validateAgroHeroFile
} from '../lib/agro-hero-actions'

const groups=[
 {id:'field',eyebrow:'CAMPO E SOLO',title:'Entenda a área antes de concluir',description:'Laudos, propriedades, talhões, culturas e histórico em um fluxo conectado.',tools:[
  {id:'solo',label:'Análises de solo',description:'Importe, interprete e mantenha o vínculo sob confirmação.',icon:Layers3},
  {id:'produtores',label:'Propriedades e talhões',description:'Cadastros, mapas, safras e contexto produtivo.',icon:LandPlot}
 ]},
 {id:'diagnosis',eyebrow:'DIAGNÓSTICO',title:'Observe, compare e valide',description:'A imagem inicia hipóteses; o responsável técnico mantém a decisão.',tools:[
  {id:'diagnostico',label:'Diagnóstico por foto',description:'Nutrição, doenças, insetos e plantas daninhas.',icon:Camera},
  {id:'observacoes',page:'relatorios',label:'Observações e registros',description:'Histórico técnico, relatórios e evidências de campo.',icon:FileSearch}
 ]},
 {id:'decision',eyebrow:'DECISÃO TÉCNICA',title:'Calcule e confira na fonte',description:'Ferramentas continuam acessíveis diretamente, com rastreabilidade.',tools:[
  {id:'calculadoras',label:'Calculadoras',description:'Semeadura, aplicação, fertilidade, reposição e custos.',icon:Calculator},
  {id:'bulas',label:'Bulas e registros',description:'Consulte rótulos e fontes oficiais antes de orientar.',icon:FlaskConical}
 ]},
 {id:'context',eyebrow:'CONTEXTO',title:'Enxergue o que mudou fora da área',description:'Clima e mercado ganham data, origem e efeito sobre a decisão.',tools:[
  {id:'mercado',label:'Mercado e commodities',description:'Cotações, tendências e notícias com fonte e horário.',icon:Newspaper},
  {id:'clima',page:'inicio',label:'Clima e panorama',description:'Condições, alertas e visão integrada do trabalho técnico.',icon:CloudSun}
 ]},
 {id:'knowledge',eyebrow:'CONHECIMENTO',title:'Aprofunde sem perder governança',description:'Conhecimento apoia o raciocínio; nunca vira prescrição automática.',tools:[
  {id:'manual',page:'inicio',label:'Manual do Agrônomo',description:'Capacidades e fontes técnicas validadas do núcleo agronômico.',icon:BookOpen},
  {id:'biblioteca',page:'relatorios',label:'Biblioteca e histórico',description:'Conteúdos, registros e versões preservados para consulta.',icon:Library}
 ]}
]

const toolsById=new Map(groups.flatMap(group=>group.tools.map(tool=>[tool.id,tool])))
const emptyContext=Object.freeze({})
const emptyFiles=Object.freeze([])

const audioMimeType=()=>{
 const Recorder=globalThis.MediaRecorder
 if(!Recorder?.isTypeSupported)return ''
 return ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>Recorder.isTypeSupported(type))||''
}

const voiceFilename=mimeType=>`pergunta-val-${new Date().toISOString().replace(/[:.]/g,'-')}.${String(mimeType).includes('mp4')?'m4a':'webm'}`

export default function Agro({onAsk,onCapture,onTelemetry,onContextChange,producer=null,client=null,property=null,field=null,talhao=null,analysis=null,context=emptyContext,initialTool=null,initialFiles=emptyFiles}){
 const [integrationStatus,setIntegrationStatus]=useState({loading:true,configured:false})
 const [loaded,setLoaded]=useState(false)
 const [expanded,setExpanded]=useState(false)
 const [tool,setTool]=useState('')
 const [actionStates,setActionStates]=useState(createAgroHeroStates)
 const [lastAction,setLastAction]=useState('')
 const [textOpen,setTextOpen]=useState(false)
 const [textPrompt,setTextPrompt]=useState('')
 const [voiceSeconds,setVoiceSeconds]=useState(0)
 const [dismissedInitialFiles,setDismissedInitialFiles]=useState([])
 const workspaceRef=useRef(null)
 const frameRef=useRef(null)
 const textInputRef=useRef(null)
 const photoInputRef=useRef(null)
 const fileInputRef=useRef(null)
 const voiceRecorderRef=useRef(null)
 const voiceStreamRef=useRef(null)
 const voiceChunksRef=useRef([])
 const voiceTimerRef=useRef(null)
 const voiceStartedAtRef=useRef(0)
 const voiceCancelledRef=useRef(false)
 const mountedRef=useRef(true)
 const initialToolDescriptor=useMemo(()=>normalizeAgroToolDescriptor(initialTool),[initialTool])
 const stagedInitialFiles=useMemo(()=>(Array.isArray(initialFiles)?initialFiles:[]).slice(0,3).map((value,index)=>{const candidate=createAgroHeroFileCandidate(value);return {...candidate,instanceKey:`${candidate.key}:${index}`}}),[initialFiles])
 const initialFilesSignature=stagedInitialFiles.map(item=>item.instanceKey).join('|')
 const visibleInitialFiles=stagedInitialFiles.filter(item=>!dismissedInitialFiles.includes(item.instanceKey))
 const activeTool=useMemo(()=>toolsById.get(tool)||(initialToolDescriptor?.id===tool?initialToolDescriptor:null),[tool,initialToolDescriptor])
 const agroContext=useMemo(()=>createAgroHeroContext({
  producer:producer||client||context.producer||context.client,
  property:property||context.property,
  field:field||talhao||context.field||context.talhao,
  analysis:analysis||context.analysis,
  tool:activeTool
 }),[producer,client,property,field,talhao,analysis,context,activeTool])
 const copilotContext=useMemo(()=>buildAgroCopilotLaunchContext(agroContext),[agroContext])

 const emitTelemetry=(action,status,details={})=>{
  try{onTelemetry?.(createAgroHeroTelemetry({action,status,context:agroContext,...details}))}catch{}
 }
 const updateAction=(action,status,details={})=>{
  setLastAction(action)
  setActionStates(current=>transitionAgroHeroState(current,action,status,details))
  emitTelemetry(action,status,details)
 }
 const finishAction=(action,status,details={})=>{if(mountedRef.current)updateAction(action,status,details)}
 const dispatchAction=(action,payload)=>{
  updateAction(action,'loading',{phase:'dispatching',message:'Entregando o contexto à VAL…'})
  const callback=action==='text'?onAsk:(onCapture||onAsk)
  if(typeof callback!=='function'){
   finishAction(action,'error',{phase:'integration',message:'A integração desta ação ainda não está disponível.',errorCode:'INTEGRATION_UNAVAILABLE'})
   return
  }
  let result
  try{result=callback(payload)}catch(error){finishAction(action,'error',{phase:'integration',message:error?.message||'A ação não pôde ser entregue à VAL.',errorCode:'INTEGRATION_FAILED'});return}
  Promise.resolve(result).then(()=>finishAction(action,'success',{phase:'delivered',message:action==='text'?'Pergunta enviada à VAL.':action==='voice'?'Áudio entregue para transcrição.':action==='photo'?'Foto pronta para análise.':'Arquivo pronto para interpretação.'})).catch(error=>finishAction(action,'error',{phase:'integration',message:error?.message||'A ação não pôde ser entregue à VAL.',errorCode:'INTEGRATION_FAILED'}))
 }
 const stopVoiceTracks=()=>{voiceStreamRef.current?.getTracks?.().forEach(track=>track.stop());voiceStreamRef.current=null}
 const stopVoiceTimer=()=>{if(voiceTimerRef.current){window.clearInterval(voiceTimerRef.current);voiceTimerRef.current=null}}

 useEffect(()=>{
  mountedRef.current=true
  return()=>{mountedRef.current=false;voiceCancelledRef.current=true;stopVoiceTimer();try{if(voiceRecorderRef.current?.state!=='inactive')voiceRecorderRef.current?.stop()}catch{};stopVoiceTracks()}
 },[])

 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/val/status',{signal:controller.signal})
   .then(response=>response.ok?response.json():Promise.reject())
   .then(data=>setIntegrationStatus({loading:false,configured:Boolean(data.manualIntegrationConfigured)}))
   .catch(()=>setIntegrationStatus({loading:false,configured:false}))
  return()=>controller.abort()
 },[])

 useEffect(()=>{
  const syncFullscreen=()=>setExpanded(document.fullscreenElement===workspaceRef.current)
  document.addEventListener('fullscreenchange',syncFullscreen)
  return()=>document.removeEventListener('fullscreenchange',syncFullscreen)
 },[])

 useEffect(()=>{
  if(!expanded)return undefined
  const previous=document.body.style.overflow;document.body.style.overflow='hidden'
  return()=>{document.body.style.overflow=previous}
 },[expanded])

 useEffect(()=>{
  if(!initialToolDescriptor)return
  setLoaded(false)
  setTool(initialToolDescriptor.id)
 },[initialToolDescriptor?.id,initialToolDescriptor?.page,initialToolDescriptor?.mode])

 useEffect(()=>setDismissedInitialFiles([]),[initialFilesSignature])

 useEffect(()=>{
  if(!loaded||!tool||!activeTool||!frameRef.current?.contentWindow)return
  const targetOrigin=window.location.origin
  frameRef.current.contentWindow.postMessage(createAgroWorkspaceMessage({context:agroContext,tool:activeTool}),targetOrigin)
 },[tool,loaded,activeTool,agroContext])

 useEffect(()=>{onContextChange?.(copilotContext);return()=>onContextChange?.(null)},[copilotContext,onContextChange])

 const openTextComposer=()=>{
  setTextOpen(true)
  updateAction('text','success',{phase:'composer_open',message:'Escreva a pergunta e envie quando estiver pronta.'})
  requestAnimationFrame(()=>textInputRef.current?.focus())
 }
 const closeTextComposer=()=>{setTextOpen(false);setTextPrompt('');updateAction('text','idle',{phase:'cancelled'})}
 const submitText=event=>{
  event.preventDefault()
  const prompt=textPrompt.trim()
  if(!prompt){updateAction('text','error',{phase:'validation',message:'Digite uma pergunta antes de enviar.',errorCode:'TEXT_REQUIRED'});textInputRef.current?.focus();return}
  dispatchAction('text',createAgroHeroActionPayload({action:'text',prompt,context:agroContext}))
 }
 const chooseCapture=action=>{
  updateAction(action,'loading',{phase:'selecting',message:action==='photo'?'Abrindo câmera ou biblioteca…':'Abrindo seletor de arquivos…'})
  if(action==='photo')photoInputRef.current?.click()
  else fileInputRef.current?.click()
 }
 const cancelCapture=action=>updateAction(action,'idle',{phase:'cancelled'})
 const handleFileChange=(action,event)=>{
  const selected=event.target.files?.[0]||null
  event.target.value=''
  if(!selected){cancelCapture(action);return}
  const validation=validateAgroHeroFile(selected,action)
  if(!validation.ok){updateAction(action,'error',{phase:'validation',message:validation.message,errorCode:validation.code});return}
  const prompt=action==='photo'?'Analise esta foto de campo, explicite hipóteses, evidências faltantes e o próximo passo seguro.':'Leia este arquivo técnico, identifique o tipo provável e me diga o que muda a decisão.'
  dispatchAction(action,createAgroHeroActionPayload({action,prompt,context:agroContext,file:selected}))
 }
 const confirmInitialFile=candidate=>{
  if(!candidate.validation.ok){updateAction('file','error',{phase:'validation',message:candidate.validation.message,errorCode:candidate.validation.code});return}
  dispatchAction('file',createAgroHeroActionPayload({action:'file',prompt:'Interprete este arquivo mantido nesta conversa e confirme o tipo antes de qualquer vínculo.',context:agroContext,file:candidate.file}))
 }
 const dismissInitialFile=key=>setDismissedInitialFiles(current=>current.includes(key)?current:[...current,key])
 const startVoice=()=>{
  if(['requesting','recording','dispatching'].includes(actionStates.voice.phase))return
  updateAction('voice','loading',{phase:'requesting',message:'Solicitando acesso ao microfone…'})
  const mediaDevices=globalThis.navigator?.mediaDevices
  const Recorder=globalThis.MediaRecorder
  if(!mediaDevices?.getUserMedia||!Recorder){const failure=agroHeroVoiceError({name:'UNSUPPORTED'});finishAction('voice','error',{phase:'permission',message:failure.message,errorCode:failure.code});return}
  let request
  try{request=mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}catch(error){const failure=agroHeroVoiceError(error);finishAction('voice','error',{phase:'permission',message:failure.message,errorCode:failure.code});return}
  Promise.resolve(request).then(stream=>{
   if(!mountedRef.current){stream.getTracks().forEach(track=>track.stop());return}
   voiceCancelledRef.current=false;voiceStreamRef.current=stream;voiceChunksRef.current=[];setVoiceSeconds(0)
   const mimeType=audioMimeType()
   let recorder
   try{recorder=new Recorder(stream,mimeType?{mimeType,audioBitsPerSecond:48_000}:{audioBitsPerSecond:48_000})}catch{recorder=new Recorder(stream)}
   voiceRecorderRef.current=recorder
   recorder.ondataavailable=event=>{if(event.data?.size)voiceChunksRef.current.push(event.data)}
   recorder.onerror=event=>{stopVoiceTimer();stopVoiceTracks();const failure=agroHeroVoiceError(event?.error);finishAction('voice','error',{phase:'recording',message:failure.message,errorCode:failure.code})}
   recorder.onstop=()=>{
    stopVoiceTimer();stopVoiceTracks();voiceRecorderRef.current=null
    if(voiceCancelledRef.current){voiceChunksRef.current=[];return}
    const durationSeconds=Math.max(1,Math.round((Date.now()-voiceStartedAtRef.current)/1000))
    const type=recorder.mimeType||mimeType||voiceChunksRef.current[0]?.type||'audio/webm'
    const blob=new Blob(voiceChunksRef.current,{type});voiceChunksRef.current=[]
    if(!blob.size){finishAction('voice','error',{phase:'recording',message:'A gravação ficou vazia. Tente novamente.',errorCode:'VOICE_EMPTY'});return}
    if(blob.size>AGRO_HERO_FILE_POLICY.maxBytes){finishAction('voice','error',{phase:'validation',message:'O áudio excedeu o limite seguro de 6 MB.',errorCode:'FILE_TOO_LARGE'});return}
    const recordedFile=new File([blob],voiceFilename(type),{type})
    dispatchAction('voice',createAgroHeroActionPayload({action:'voice',prompt:'Transcreva esta pergunta e responda mantendo o contexto agronômico atual.',context:agroContext,file:recordedFile,recording:{durationSeconds,mimeType:type}}))
   }
   voiceStartedAtRef.current=Date.now();recorder.start(1000)
   updateAction('voice','loading',{phase:'recording',message:'Gravando. Fale naturalmente.'})
   voiceTimerRef.current=window.setInterval(()=>setVoiceSeconds(Math.max(0,Math.floor((Date.now()-voiceStartedAtRef.current)/1000))),500)
  }).catch(error=>{stopVoiceTracks();const failure=agroHeroVoiceError(error);finishAction('voice','error',{phase:'permission',message:failure.message,errorCode:failure.code})})
 }
 const stopVoice=()=>{
  const recorder=voiceRecorderRef.current
  if(!recorder||recorder.state==='inactive')return
  updateAction('voice','loading',{phase:'processing',message:'Preparando o áudio para a VAL…'})
  try{recorder.requestData?.()}catch{}
  try{recorder.stop()}catch(error){const failure=agroHeroVoiceError(error);finishAction('voice','error',{phase:'recording',message:failure.message,errorCode:failure.code})}
 }
 const cancelVoice=()=>{
  voiceCancelledRef.current=true;stopVoiceTimer();setVoiceSeconds(0)
  const recorder=voiceRecorderRef.current
  try{if(recorder&&recorder.state!=='inactive')recorder.stop()}catch{}
  voiceRecorderRef.current=null;voiceChunksRef.current=[];stopVoiceTracks();updateAction('voice','idle',{phase:'cancelled'})
 }
 const selectTool=id=>{setLoaded(false);setTool(id);requestAnimationFrame(()=>workspaceRef.current?.scrollIntoView({block:'start',behavior:'smooth'}))}
 const askTool=()=>onAsk?.(createAgroHeroActionPayload({action:'text',prompt:`Quero conversar com a VAL sobre ${activeTool?.label||'esta análise'}.`,context:agroContext}))
 const toggleExpanded=async()=>{
  if(expanded&&!document.fullscreenElement){setExpanded(false);return}
  if(document.fullscreenElement){await document.exitFullscreen();return}
  try{if(workspaceRef.current?.requestFullscreen){await workspaceRef.current.requestFullscreen();return}}catch{}
  setExpanded(true)
 }
 const feedback=lastAction?actionStates[lastAction]:null
 const feedbackTitle=feedback?.phase==='composer_open'?'Composer pronto':feedback?.status==='error'?'Não foi possível concluir':feedback?.status==='success'?'Ação encaminhada':'Processando ação'

 return <div className="agro-decision-page">
  <section className="agro-decision-hero" aria-labelledby="agro-decision-title">
   <div className="agro-decision-copy"><span><Sprout/>INTELIGÊNCIA AGRONÔMICA DA VAL</span><h2 id="agro-decision-title">Use a ferramenta ou fale com a VAL.</h2><p>Comece por voz, texto, foto ou arquivo. O contexto ativo acompanha a análise; nenhuma hipótese vira memória ou prescrição automaticamente.</p>
    {agroContext.context_refs.length>0&&<div className="agro-hero-context" aria-label="Contexto agronômico ativo">{agroContext.context_refs.filter(item=>item.type!=='agronomic_tool').map(item=><span key={`${item.type}-${item.id||item.label}`}><small>{item.type==='producer'?'PRODUTOR':item.type==='property'?'PROPRIEDADE':item.type==='field'?'TALHÃO':'ANÁLISE'}</small><b>{item.label||item.id}</b></span>)}</div>}
   </div>
   <div className="agro-hero-workbench">
    <div className="agro-decision-inputs" aria-label="Formas de iniciar uma análise">
     <button type="button" className="is-primary" data-agro-hero-action="voice" data-state={actionStates.voice.status} aria-busy={actionStates.voice.status==='loading'} onClick={startVoice} disabled={actionStates.voice.phase==='recording'||actionStates.voice.phase==='processing'||actionStates.voice.phase==='dispatching'}>{actionStates.voice.status==='loading'?<LoaderCircle className="agro-hero-spin"/>:<Mic/>}<span><b>Falar com a VAL</b><small>Conversa natural por voz</small></span></button>
     <button type="button" data-agro-hero-action="text" data-state={actionStates.text.status} aria-expanded={textOpen} onClick={openTextComposer}><Keyboard/><span><b>Digitar / perguntar</b><small>Composer no mesmo contexto</small></span></button>
     <button type="button" data-agro-hero-action="photo" data-state={actionStates.photo.status} aria-busy={actionStates.photo.status==='loading'} onClick={()=>chooseCapture('photo')}><Image/><span><b>Foto</b><small>Câmera ou biblioteca</small></span></button>
     <button type="button" data-agro-hero-action="file" data-state={actionStates.file.status} aria-busy={actionStates.file.status==='loading'} onClick={()=>chooseCapture('file')}><Paperclip/><span><b>Arquivo</b><small>PDF, laudo ou documento</small></span></button>
     <input ref={photoInputRef} className="agro-hero-native-input" type="file" accept={AGRO_HERO_FILE_POLICY.photoAccept} capture="environment" onCancel={()=>cancelCapture('photo')} onChange={event=>handleFileChange('photo',event)}/>
     <input ref={fileInputRef} className="agro-hero-native-input" type="file" accept={AGRO_HERO_FILE_POLICY.fileAccept} onCancel={()=>cancelCapture('file')} onChange={event=>handleFileChange('file',event)}/>
    </div>
    {visibleInitialFiles.length>0&&<div className="agro-hero-session-files" aria-label="Arquivos mantidos nesta conversa">{visibleInitialFiles.map(candidate=><div key={candidate.instanceKey} data-valid={candidate.validation.ok?'true':'false'}><FileText/><span><b>{candidate.name}</b><small>{candidate.validation.ok?candidate.intentLabel:candidate.validation.message} {agroContext.clientId?`Contexto: ${agroContext.producer?.label||agroContext.clientId}.`:'Sem vínculo; uso somente nesta conversa.'}</small></span><button type="button" onClick={()=>candidate.validation.ok?confirmInitialFile(candidate):chooseCapture('file')}>{candidate.validation.ok?'Interpretar agora':'Escolher novamente'}</button><button type="button" aria-label={`Remover ${candidate.name} desta conversa`} onClick={()=>dismissInitialFile(candidate.instanceKey)}><X/></button></div>)}</div>}
    <form className="agro-hero-composer" hidden={!textOpen} onSubmit={submitText}><label><span className="sr-only">Pergunte à VAL</span><textarea ref={textInputRef} rows="3" maxLength="3000" value={textPrompt} onChange={event=>setTextPrompt(event.target.value)} placeholder="O que você precisa entender, comparar ou decidir?"/></label><button type="submit" aria-label="Enviar pergunta à VAL"><Send/>Enviar</button><button type="button" aria-label="Fechar campo de pergunta" onClick={closeTextComposer}><X/></button></form>
    {actionStates.voice.phase==='recording'&&<div className="agro-hero-recorder" role="status"><span><i/>Gravando • {String(Math.floor(voiceSeconds/60)).padStart(2,'0')}:{String(voiceSeconds%60).padStart(2,'0')}</span><button type="button" onClick={stopVoice}><Square/>Parar e enviar</button><button type="button" onClick={cancelVoice}>Cancelar</button></div>}
    {feedback&&feedback.status!=='idle'&&<div className={`agro-hero-feedback is-${feedback.status}`} role={feedback.status==='error'?'alert':'status'}>{feedback.status==='error'?<AlertTriangle/>:feedback.status==='success'?<CheckCircle2/>:<LoaderCircle className="agro-hero-spin"/>}<span><b>{feedbackTitle}</b><small>{feedback.message}</small></span></div>}
   </div>
   <div className="agro-decision-governance"><ShieldCheck/><span><b>A IA pensa. A VAL governa. O humano decide.</b><small>Dose, mistura, bula e prescrição continuam sob validação técnica.</small></span></div>
  </section>

  {!tool&&<div className="agro-capability-groups">
   {groups.map((group,index)=><section key={group.id} className="agro-capability-group">
    <header><span>{String(index+1).padStart(2,'0')} • {group.eyebrow}</span><h3>{group.title}</h3><p>{group.description}</p></header>
    <div>{group.tools.map(item=>{const Icon=item.icon;return <button type="button" key={`${group.id}-${item.id}`} onClick={()=>selectTool(item.id)}><i><Icon/></i><span><b>{item.label}</b><small>{item.description}</small></span><ArrowLeft className="agro-tool-arrow"/></button>})}</div>
   </section>)}
  </div>}

  {tool&&<section ref={workspaceRef} className={`agro-native-workspace agro-tool-workspace${expanded?' is-expanded':''}`} aria-label={`Ferramenta: ${activeTool?.label||'Inteligência Agronômica'}`}>
   <header className="agro-minimal-header">
    <div className="agro-tool-title"><button type="button" onClick={()=>setTool('')} aria-label="Voltar às capacidades"><ArrowLeft/></button><Logo compact/><div><small>INTELIGÊNCIA AGRONÔMICA</small><strong>{activeTool?.label||'Ambiente técnico'}</strong></div></div>
    <div className="agro-workspace-actions">
     <button type="button" className="agro-ask-inline" onClick={askTool}><BrainCircuit/><b>Conversar com a VAL</b></button>
     <span className={integrationStatus.configured?'is-ready':'is-unverified'}><CheckCircle2/>{integrationStatus.loading?'Conectando':integrationStatus.configured?'Fontes conectadas':'Fontes não verificadas'}</span>
     <button type="button" onClick={toggleExpanded} aria-pressed={expanded} title={expanded?'Reduzir ambiente técnico':'Abrir ambiente técnico em tela cheia'}>{expanded?<Minimize2/>:<Maximize2/>}<b>{expanded?'Reduzir':'Tela cheia'}</b></button>
    </div>
   </header>
   {!loaded&&<div className="agro-frame-loading" role="status"><LoaderCircle/><b>Carregando a capacidade…</b><small>Mantendo sua sessão e o mesmo contexto de acesso.</small></div>}
   <iframe ref={frameRef} key={`${tool}:${activeTool?.page||''}:${activeTool?.mode||''}`} title={activeTool?.label||'Inteligência Agronômica da VAL'} src={`/tecnico?embedded=1&page=${encodeURIComponent(activeTool?.page||tool)}`} onLoad={()=>setLoaded(true)} allow="camera 'self'; microphone 'self'; geolocation 'self'"/>
  </section>}

  <section className="agro-preserved-functions"><Search/><div><b>Prefere navegar?</b><span>Todas as funções permanecem disponíveis nos grupos acima. A VAL é um atalho inteligente, não uma barreira.</span></div><UsersRound/><History/></section>
 </div>
}
