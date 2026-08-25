import React,{useEffect,useId,useMemo,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {AlertTriangle,CheckCircle2,ChevronDown,FileAudio,Keyboard,LoaderCircle,Mic,Plus,RotateCcw,Send,ShieldCheck,Square,Trash2,Upload,X} from 'lucide-react'
import useVoiceRecorder from '../../hooks/useVoiceRecorder'
import {cancelVoiceInteraction,confirmVoiceInteraction,createVoiceInteraction,getVoiceInteraction,processVoiceInteraction,uploadVoiceAudio} from '../../lib/voice-interactions-client'
import '../../voice-capture.css'

const categories=[
 ['FACT_CANDIDATE','Fatos candidatos'],
 ['COMMITMENT_CANDIDATE','Compromissos'],
 ['OBJECTION','Objeções'],
 ['OPPORTUNITY_CANDIDATE','Oportunidades'],
 ['BEHAVIORAL_SIGNAL','Sinais observáveis'],
 ['AGRONOMIC_OBSERVATION','Observações agronômicas'],
 ['EXPECTATION','Expectativas'],
 ['NEXT_STEP','Próximos passos'],
 ['MISSING_INFORMATION','Informações faltantes'],
 ['HYPOTHESIS','Hipóteses']
]
const categoryLabels=Object.fromEntries(categories)
const categoryOrder=new Map(categories.map(([value],index)=>[value,index]))
const phaseCopy={uploading:'Enviando áudio com segurança…',processing:'Transcrevendo e organizando…',confirming:'Confirmando somente o que você revisou…'}
const successCopy={
 PRE_VISIT:'Contexto confirmado. Uma nova versão da preparação foi gerada.',
 POST_VISIT:'Visita registrada. A próxima preparação já pode usar estas informações.',
 CLIENT_NOTE:'Informação confirmada e adicionada ao contexto do produtor.',
 FIELD_NOTE:'Observação registrada. Nenhuma recomendação técnica foi gerada automaticamente.',
 GENERAL_CONTEXT:'Informação confirmada e incorporada ao contexto da VAL.'
}
const processPending=new Set(['CREATED','AUDIO_STORED','AUDIO_RECEIVED','PENDING','TRANSCRIBING','TRANSCRIBED','PROCESSING','EXTRACTING'])
const processFailed=new Set(['FAILED_TRANSCRIPTION','FAILED_EXTRACTION','FAILED','TRANSCRIPTION_FAILED','PROCESSING_FAILED'])
const pendingStoragePrefix='valor360:voice-pending:v1'
const pendingMaxAgeMs=7*24*60*60*1000

const interactionOf=payload=>payload?.voice_interaction||payload?.interaction||payload||{}
const interactionIdOf=payload=>String(interactionOf(payload).voice_interaction_id||interactionOf(payload).id||payload?.voice_interaction_id||'')
const transcriptOf=payload=>String(interactionOf(payload).transcript?.transcript_text||interactionOf(payload).transcript?.text||interactionOf(payload).transcript_text||payload?.transcript?.transcript_text||payload?.transcript?.text||payload?.transcript_text||'')
const statusOf=payload=>String(interactionOf(payload).state||interactionOf(payload).status||interactionOf(payload).processing_status||payload?.state||payload?.status||'').toUpperCase()
const rawCandidates=payload=>interactionOf(payload).candidates||interactionOf(payload).extraction?.candidates||payload?.candidates||payload?.structured_candidates||[]
const randomId=()=>globalThis.crypto?.randomUUID?.()||`voice-${Date.now()}-${Math.random().toString(36).slice(2)}`
const normalizeCategory=value=>categoryLabels[String(value||'').toUpperCase()]?String(value).toUpperCase():'FACT_CANDIDATE'
const normalizeCandidate=(item,index)=>({candidate_id:String(item?.candidate_id||item?.item_id||item?.id||`candidate-${index}`),category:normalizeCategory(item?.category||item?.candidate_type||item?.type),statement:String(item?.statement||item?.description||item?.text||'').trim(),epistemic_status:String(item?.epistemic_status||'FACT_CANDIDATE').toUpperCase(),due_at:item?.due_at?String(item.due_at).slice(0,10):'',decision:'CONFIRMED'})
const formatTime=value=>`${String(Math.floor(Number(value||0)/60)).padStart(2,'0')}:${String(Math.floor(Number(value||0)%60)).padStart(2,'0')}`
const formatSize=value=>Number(value||0)>=1_000_000?`${(Number(value)/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(Number(value||0)/1000))} KB`
const isPostVisit=value=>String(value||'').toUpperCase()==='POST_VISIT'
const candidateNeedsDate=value=>['COMMITMENT_CANDIDATE','NEXT_STEP'].includes(value)
const newNextStepCandidate=()=>({candidate_id:randomId(),category:'NEXT_STEP',epistemic_status:'FACT_CANDIDATE',statement:'',due_at:''})
const storagePart=value=>encodeURIComponent(String(value||'none')).slice(0,240)
const pendingStorageKey=({clientId,visitId,interactionType})=>{
 if(typeof window==='undefined')return ''
 let scope='session'
 try{scope=sessionStorage.getItem('valor360-active-storage-scope')||scope}catch{}
 return `${pendingStoragePrefix}:${storagePart(scope)}:${storagePart(clientId)}:${storagePart(visitId||'client')}:${storagePart(String(interactionType||'GENERAL_CONTEXT').toUpperCase())}`
}

function VoiceCandidate({candidate,onChange,onRemove,categoryEditable=false,validationError='',errorId}){
 const categoryLabel=categoryLabels[candidate.category]||candidate.category||'informação'
 const statementInvalid=Boolean(validationError&&!candidate.statement.trim())
 const dueInvalid=candidate.category==='COMMITMENT_CANDIDATE'&&!candidate.due_at&&validationError.includes('prazo')
 const changeCategory=event=>{const category=event.target.value;onChange({...candidate,category,epistemic_status:category==='HYPOTHESIS'?'HYPOTHESIS':candidate.epistemic_status==='HYPOTHESIS'?'FACT_CANDIDATE':candidate.epistemic_status})}
 return <article className="voice-candidate" data-voice-candidate-id={candidate.candidate_id}>
  <div className="voice-candidate-top">{categoryEditable?<select aria-label="Categoria da informação" value={candidate.category} onChange={changeCategory}>{categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:<strong className="voice-category-label">{categoryLabel}</strong>}<span>{candidate.epistemic_status==='HYPOTHESIS'?'Hipótese':candidate.epistemic_status==='INFERENCE'?'Interpretação':'Candidato'}</span><button type="button" onClick={onRemove} aria-label={`Remover ${categoryLabel}: ${candidate.statement.slice(0,80)}`}><Trash2/></button></div>
  <label><span className="voice-sr-only">Texto de {categoryLabel}</span><textarea rows="2" maxLength="2000" value={candidate.statement} aria-invalid={statementInvalid||undefined} aria-describedby={statementInvalid?errorId:undefined} onChange={event=>onChange({...candidate,statement:event.target.value})}/></label>
  {candidateNeedsDate(candidate.category)&&<label className="voice-due-date"><span>Prazo, se confirmado</span><input type="date" value={candidate.due_at} aria-invalid={dueInvalid||undefined} aria-describedby={dueInvalid?errorId:undefined} onChange={event=>onChange({...candidate,due_at:event.target.value})}/></label>}
  {candidate.category==='AGRONOMIC_OBSERVATION'&&<p className="voice-technical-note"><ShieldCheck/>Observação relatada — não é recomendação técnica.</p>}
 </article>
}

function CandidateReview({candidates,setCandidates,transcript,additions,setAdditions,additionDraft,setAdditionDraft,postVisit,outcomeType,setOutcomeType,noAction,setNoAction,onConfirm,busy,error,errorId}){
 const active=candidates.filter(item=>item.decision!=='REJECTED')
 const removed=candidates.filter(item=>item.decision==='REJECTED')
 const visibleActive=postVisit?active.filter(item=>item.category!=='NEXT_STEP'):active
 const visibleAdditions=postVisit?additions.filter(item=>item.category!=='NEXT_STEP'):additions
 const nextItems=postVisit?[...active.filter(item=>item.category==='NEXT_STEP').map(item=>({item,source:'candidate'})),...additions.filter(item=>item.category==='NEXT_STEP').map(item=>({item,source:'addition'}))]:[]
 const grouped=useMemo(()=>{
  const map=new Map()
  visibleActive.forEach(item=>{const list=map.get(item.category)||[];list.push(item);map.set(item.category,list)})
  return [...map.entries()].sort(([a],[b])=>(categoryOrder.get(a)??99)-(categoryOrder.get(b)??99))
 },[candidates,postVisit])
 const update=candidate=>setCandidates(current=>current.map(item=>item.candidate_id===candidate.candidate_id?candidate:item))
 const remove=id=>{const target=candidates.find(item=>item.candidate_id===id);setCandidates(current=>current.map(item=>item.candidate_id===id?{...item,decision:'REJECTED'}:item));if(postVisit&&target?.category==='NEXT_STEP'&&!noAction&&!active.some(item=>item.category==='NEXT_STEP'&&item.candidate_id!==id)&&!additions.some(item=>item.category==='NEXT_STEP'))setAdditions(current=>[...current,newNextStepCandidate()])}
 const removeAddition=id=>{const target=additions.find(item=>item.candidate_id===id);setAdditions(current=>{const remaining=current.filter(item=>item.candidate_id!==id);if(postVisit&&target?.category==='NEXT_STEP'&&!noAction&&!active.some(item=>item.category==='NEXT_STEP')&&!remaining.some(item=>item.category==='NEXT_STEP'))return [...remaining,newNextStepCandidate()];return remaining})}
 const restore=id=>{const target=candidates.find(item=>item.candidate_id===id);setCandidates(current=>current.map(item=>item.candidate_id===id?{...item,decision:'CONFIRMED'}:item));if(postVisit&&target?.category==='NEXT_STEP'){setNoAction(false);setAdditions(current=>current.filter(item=>item.category!=='NEXT_STEP'||item.statement.trim()))}}
 const toggleNoAction=checked=>{setNoAction(checked);if(checked){setCandidates(current=>current.map(item=>item.category==='NEXT_STEP'&&item.decision!=='REJECTED'?{...item,decision:'REJECTED'}:item));setAdditions(current=>current.filter(item=>item.category!=='NEXT_STEP'))}else if(!candidates.some(item=>item.category==='NEXT_STEP'&&item.decision!=='REJECTED'))setAdditions(current=>current.some(item=>item.category==='NEXT_STEP')?current:[...current,newNextStepCandidate()])}
 const add=()=>{const statement=additionDraft.statement.trim();if(!statement)return;setAdditions(current=>[...current,{candidate_id:randomId(),category:additionDraft.category,epistemic_status:additionDraft.category==='HYPOTHESIS'?'HYPOTHESIS':'FACT_CANDIDATE',statement,due_at:additionDraft.due_at||''}]);setAdditionDraft({category:'FACT_CANDIDATE',statement:'',due_at:''})}
 return <div className="voice-review">
  <div className="voice-review-intro"><CheckCircle2/><div><small>A VAL ENTENDEU</small><h3>Revise antes de transformar fala em memória.</h3><p>Edite ou remova qualquer item. Nada material é consolidado antes da sua confirmação.</p></div></div>
  {grouped.length?grouped.map(([category,items])=><section className="voice-candidate-group" key={category}><h4>{categoryLabels[category]||category}</h4>{items.map(candidate=><VoiceCandidate key={candidate.candidate_id} candidate={candidate} validationError={error} errorId={errorId} onChange={update} onRemove={()=>remove(candidate.candidate_id)}/>)}</section>):nextItems.length===0&&<div className="voice-empty-review"><AlertTriangle/><p>Nenhum candidato foi identificado. Adicione abaixo somente o que você deseja confirmar.</p></div>}
  {visibleAdditions.length>0&&<section className="voice-candidate-group"><h4>Informações adicionadas por você</h4>{visibleAdditions.map(item=><VoiceCandidate key={item.candidate_id} categoryEditable candidate={{...item,decision:'CONFIRMED'}} validationError={error} errorId={errorId} onChange={candidate=>setAdditions(current=>current.map(entry=>entry.candidate_id===candidate.candidate_id?candidate:entry))} onRemove={()=>removeAddition(item.candidate_id)}/>)}</section>}
  <section className="voice-addition"><h4><Plus/>Adicionar informação</h4><div><select aria-label="Categoria da nova informação" value={additionDraft.category} onChange={event=>setAdditionDraft(current=>({...current,category:event.target.value}))}>{categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><label className="voice-addition-statement"><span className="voice-sr-only">Texto da nova informação</span><textarea rows="2" maxLength="2000" value={additionDraft.statement} onChange={event=>setAdditionDraft(current=>({...current,statement:event.target.value}))} placeholder="Escreva apenas o que deseja acrescentar…"/></label>{candidateNeedsDate(additionDraft.category)&&<input aria-label="Prazo da nova informação" type="date" value={additionDraft.due_at} onChange={event=>setAdditionDraft(current=>({...current,due_at:event.target.value}))}/>}<button type="button" onClick={add} disabled={!additionDraft.statement.trim()}><Plus/>Adicionar</button></div></section>
  {removed.length>0&&<details className="voice-removed"><summary>Itens removidos ({removed.length})</summary>{removed.map(item=><button type="button" key={item.candidate_id} onClick={()=>restore(item.candidate_id)}>Restaurar: {item.statement}</button>)}</details>}
  {postVisit&&<section className="voice-post-visit"><h4>Fechamento da visita</h4><div className="voice-post-grid"><label>Outcome<select value={outcomeType} onChange={event=>setOutcomeType(event.target.value)}><option value="NO_DECISION">Sem decisão</option><option value="FOLLOW_UP">Follow-up</option><option value="WON">Ganho</option><option value="LOST">Perdido</option><option value="PARTIAL">Parcial</option><option value="TECHNICAL_RESULT">Resultado técnico</option><option value="RELATIONSHIP_PROGRESS">Avanço de relacionamento</option><option value="NO_CHANGE">Sem mudança</option></select></label><div className="voice-post-next"><span>Próximo passo</span>{!noAction&&nextItems.map(({item,source})=><VoiceCandidate key={item.candidate_id} candidate={{...item,decision:'CONFIRMED'}} validationError={error} errorId={errorId} onChange={candidate=>source==='candidate'?update(candidate):setAdditions(current=>current.map(entry=>entry.candidate_id===candidate.candidate_id?candidate:entry))} onRemove={()=>source==='candidate'?remove(item.candidate_id):removeAddition(item.candidate_id)}/>)}</div><label className="voice-check"><input type="checkbox" checked={noAction} aria-describedby={error?errorId:undefined} onChange={event=>toggleNoAction(event.target.checked)}/><span>Nenhuma ação adicional necessária</span></label></div></section>}
  {transcript&&<details className="voice-transcript"><summary>Ver transcrição <ChevronDown/></summary><p>{transcript}</p></details>}
  {error&&<div className="voice-error voice-review-error" id={errorId} role="alert" tabIndex="-1"><AlertTriangle/><span>{error}</span></div>}
  <footer className="voice-review-footer"><p><ShieldCheck/>Somente os itens mantidos acima serão confirmados.</p><button type="button" onClick={onConfirm} aria-describedby={error?errorId:undefined} disabled={busy}>{busy?<LoaderCircle className="voice-spin"/>:<CheckCircle2/>}Confirmar tudo</button></footer>
 </div>
}

export default function VoiceCapture({clientId,visitId,interactionType='GENERAL_CONTEXT',label='Registrar áudio',description='',sourceContext={},onConfirmed,transient=false,onTranscribed}){
 const instanceId=useId().replace(/:/g,'')
 const [open,setOpen]=useState(false)
 const [mode,setMode]=useState('AUDIO')
 const [phase,setPhase]=useState('capture')
 const [manualText,setManualText]=useState('')
 const [interactionId,setInteractionId]=useState('')
 const [audioUploaded,setAudioUploaded]=useState(false)
 const [payload,setPayload]=useState(null)
 const [candidates,setCandidates]=useState([])
 const [additions,setAdditions]=useState([])
 const [additionDraft,setAdditionDraft]=useState({category:'FACT_CANDIDATE',statement:'',due_at:''})
 const [error,setError]=useState('')
 const [retryStage,setRetryStage]=useState('process')
 const [outcomeType,setOutcomeType]=useState('NO_DECISION')
 const [noAction,setNoAction]=useState(false)
 const recorder=useVoiceRecorder()
 const launcherRef=useRef(null)
 const dialogRef=useRef(null)
 const fileInputRef=useRef(null)
 const operationRef=useRef(null)
 const mountedRef=useRef(true)
 const confirmationNotifiedRef=useRef(false)
 const busy=['uploading','processing','confirming'].includes(phase)
 const pendingKey=useMemo(()=>pendingStorageKey({clientId,visitId,interactionType}),[clientId,visitId,interactionType])
 const titleId=`voice-sheet-title-${instanceId}`
 const descriptionId=`voice-sheet-description-${instanceId}`
 const manualTextId=`voice-manual-text-${instanceId}`
 const reviewErrorId=`voice-review-error-${instanceId}`

 const rememberPending=id=>{if(!pendingKey||!id)return;try{localStorage.setItem(pendingKey,JSON.stringify({interaction_id:String(id),saved_at:Date.now()}))}catch{}}
 const forgetPending=()=>{if(!pendingKey)return;try{localStorage.removeItem(pendingKey)}catch{}}
 const readPending=()=>{if(!pendingKey)return '';try{const stored=JSON.parse(localStorage.getItem(pendingKey)||'null');const id=String(stored?.interaction_id||'');const savedAt=Number(stored?.saved_at||0);if(!id||!savedAt||Date.now()-savedAt>pendingMaxAgeMs){localStorage.removeItem(pendingKey);return ''}return id}catch{try{localStorage.removeItem(pendingKey)}catch{};return ''}}
 const resetLocal=()=>{operationRef.current?.abort();operationRef.current=null;recorder.reset();setMode('AUDIO');setPhase('capture');setManualText('');setInteractionId('');setAudioUploaded(false);setPayload(null);setCandidates([]);setAdditions([]);setAdditionDraft({category:'FACT_CANDIDATE',statement:'',due_at:''});setError('');setRetryStage('process');setOutcomeType('NO_DECISION');setNoAction(false)}
 const close=({cancelRemote=true}={})=>{const remoteId=interactionId;operationRef.current?.abort();if(cancelRemote)forgetPending();resetLocal();setOpen(false);requestAnimationFrame(()=>launcherRef.current?.focus());if(cancelRemote&&remoteId)cancelVoiceInteraction(remoteId).catch(()=>{})}

 useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;operationRef.current?.abort()}},[])
 useEffect(()=>{
  if(!open)return
  const previousOverflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  requestAnimationFrame(()=>dialogRef.current?.focus())
  const keydown=event=>{
   if(event.key==='Escape'&&!busy&&recorder.status!=='recording'){event.preventDefault();if(phase==='success')finishSuccess();else close();return}
   if(event.key!=='Tab'||!dialogRef.current)return
   const focusable=[...dialogRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),audio[controls],summary,[tabindex]:not([tabindex="-1"])')]
   if(!focusable.length)return
   const first=focusable[0],last=focusable[focusable.length-1]
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  document.addEventListener('keydown',keydown)
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=previousOverflow}
 },[open,busy,recorder.status,interactionId,phase,payload])

 const hydrateReview=result=>{const normalized=rawCandidates(result).map(normalizeCandidate).filter(item=>item.statement);setPayload(result);setCandidates(normalized);setAdditions(isPostVisit(interactionType)&&!normalized.some(item=>item.category==='NEXT_STEP')?[newNextStepCandidate()]:[]);setNoAction(false);setPhase('review');setError('')}
 const pollUntilReady=async(id,signal)=>{
  for(let attempt=0;attempt<45;attempt+=1){
   const current=await getVoiceInteraction(id,{signal});const status=statusOf(current)
   if(processFailed.has(status))throw Object.assign(new Error(interactionOf(current).error_message||interactionOf(current).error||'A transcrição não foi concluída. Tente novamente.'),{safeToRetry:true})
   if(!processPending.has(status))return current
   await new Promise((resolve,reject)=>{const abort=()=>{window.clearTimeout(timer);reject(signal.reason||Object.assign(new Error('Operação cancelada.'),{name:'AbortError'}))};const timer=window.setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},1000);signal.addEventListener('abort',abort,{once:true})})
  }
  throw Object.assign(new Error('O processamento continua pendente. Tente consultar novamente.'),{safeToRetry:true})
 }

 const processRemote=async(id,controller)=>{
  let processed
  try{processed=await processVoiceInteraction(id,{signal:controller.signal})}
  catch(processError){
   if(processError?.name==='AbortError')throw processError
   let current
   try{current=await getVoiceInteraction(id,{signal:controller.signal})}catch(recoveryError){if(recoveryError?.name==='AbortError')throw recoveryError;throw processError}
   const recoveredStatus=statusOf(current)
   if(processFailed.has(recoveredStatus))throw processError
   if(recoveredStatus==='PENDING_REVIEW'||recoveredStatus==='CONFIRMED')processed=current
   else if(processPending.has(recoveredStatus))processed=await pollUntilReady(id,controller.signal)
   else throw processError
  }
  return processPending.has(statusOf(processed))?pollUntilReady(id,controller.signal):processed
 }

 const resumePending=async id=>{
  const controller=new AbortController();operationRef.current?.abort();operationRef.current=controller
  setInteractionId(id);setAudioUploaded(true);setPhase('processing');setError('');setRetryStage('process')
  try{
   const current=await getVoiceInteraction(id,{signal:controller.signal});const status=statusOf(current);const interaction=interactionOf(current)
   if(status==='CANCELLED'||(status==='CREATED'&&!interaction.audio_ref)){
    forgetPending();cancelVoiceInteraction(id).catch(()=>{});setInteractionId('');setAudioUploaded(false);setPhase('capture');recorder.start();return
   }
   if(status==='CONFIRMED'){forgetPending();setPayload(current);setPhase('success');return}
   if(status==='PENDING_REVIEW'){hydrateReview(current);return}
   if(processFailed.has(status)){setError(interaction.error_message||interaction.error||'A tentativa anterior não foi concluída. O áudio permanece disponível para retry.');setPhase('error');return}
   hydrateReview(await processRemote(id,controller))
  }catch(resumeError){if(resumeError?.name==='AbortError')return;if(resumeError?.status===404){forgetPending();setInteractionId('');setAudioUploaded(false);setPhase('capture');recorder.start();return}if(mountedRef.current){setError(resumeError.message||'Não foi possível retomar esta interação.');setPhase('error')}}finally{if(operationRef.current===controller)operationRef.current=null}
 }

 const processInput=async()=>{
  if(!clientId||busy)return
  if(!interactionId&&mode==='AUDIO'&&!recorder.audio){setError('Grave ou escolha um áudio antes de continuar.');return}
  if(!interactionId&&mode==='TEXT'&&!manualText.trim()){setError('Digite a informação antes de continuar.');return}
  if(interactionId&&mode==='AUDIO'&&!audioUploaded&&!recorder.audio){setError('O áudio local não está mais disponível. Cancele e grave novamente.');return}
  const controller=new AbortController();operationRef.current?.abort();operationRef.current=controller;setError('')
  let id=interactionId
  try{
   if(!id){
    setPhase(mode==='AUDIO'?'uploading':'processing')
    const created=await createVoiceInteraction({clientId,visitId,interactionType,sourceContext,manualText:mode==='TEXT'?manualText:undefined,signal:controller.signal})
    id=interactionIdOf(created);if(!id)throw new Error('A VAL não retornou o identificador da interação de voz.')
    if(mountedRef.current)setInteractionId(id);rememberPending(id)
   }
   if(mode==='AUDIO'&&!audioUploaded){
    setPhase('uploading');setRetryStage('upload')
    try{await uploadVoiceAudio(id,{...recorder.audio,signal:controller.signal})}
    catch(uploadError){
     if(uploadError?.name==='AbortError')throw uploadError
     let stored=false
     try{const current=await getVoiceInteraction(id,{signal:controller.signal});stored=['AUDIO_STORED','TRANSCRIBING','TRANSCRIBED','EXTRACTING','PENDING_REVIEW','FAILED_TRANSCRIPTION','FAILED_EXTRACTION'].includes(statusOf(current))}catch(recoveryError){if(recoveryError?.name==='AbortError')throw recoveryError}
     if(!stored)throw uploadError
    }
    if(mountedRef.current)setAudioUploaded(true)
   }
   setPhase('processing');setRetryStage('process')
   const result=await processRemote(id,controller)
   if(transient){
    const transcript=transcriptOf(result).trim()
    if(!transcript)throw new Error('A VAL não conseguiu transformar este áudio em texto.')
    forgetPending();await cancelVoiceInteraction(id,{signal:controller.signal}).catch(()=>null)
    if(mountedRef.current){setInteractionId('');setPayload(result);setPhase('transcribed');setError('')}
    try{await onTranscribed?.(transcript,result)}catch{}
   }else if(mountedRef.current)hydrateReview(result)
  }catch(processError){if(processError?.name==='AbortError')return;if(mountedRef.current){setError(processError.message||'Não foi possível processar esta informação.');setPhase('error')}}finally{if(operationRef.current===controller)operationRef.current=null}
 }

 const confirm=async()=>{
  if(!interactionId||busy)return
  const active=[...candidates.filter(item=>item.decision!=='REJECTED'),...additions]
  if(active.some(item=>!item.statement.trim())){setError('Preencha ou remova toda informação vazia antes de confirmar.');requestAnimationFrame(()=>dialogRef.current?.querySelector('.voice-candidate textarea[aria-invalid="true"]')?.focus());return}
  if(isPostVisit(interactionType)&&!noAction&&!active.some(item=>item.category==='NEXT_STEP')){setError('Informe o próximo passo ou marque que nenhuma ação é necessária.');requestAnimationFrame(()=>dialogRef.current?.querySelector('.voice-post-next textarea')?.focus());return}
  if(active.some(item=>item.category==='COMMITMENT_CANDIDATE'&&!item.due_at)){setError('Informe o prazo de cada compromisso antes de confirmar.');requestAnimationFrame(()=>dialogRef.current?.querySelector('[aria-invalid="true"]')?.focus());return}
  const controller=new AbortController();operationRef.current?.abort();operationRef.current=controller;setPhase('confirming');setError('')
  try{
   const items=candidates.map(item=>({candidate_id:item.candidate_id,decision:item.decision,statement:item.statement.trim(),...(item.due_at?{due_at:item.due_at}: {})}))
   const added=additions.filter(item=>item.statement.trim()).map(item=>({candidate_id:item.candidate_id,category:item.category,epistemic_status:item.epistemic_status,statement:item.statement.trim(),...(item.due_at?{due_at:item.due_at}: {})}))
   const result=await confirmVoiceInteraction(interactionId,{items,additions:added,outcomeType:isPostVisit(interactionType)?outcomeType:undefined,noAction:isPostVisit(interactionType)?noAction:undefined,signal:controller.signal})
   forgetPending();if(mountedRef.current){setPayload(result);setPhase('success')}
   if(!isPostVisit(interactionType)&&onConfirmed&&!confirmationNotifiedRef.current){confirmationNotifiedRef.current=true;try{await onConfirmed(result)}catch{}}
  }catch(confirmError){if(confirmError?.name==='AbortError')return;if(mountedRef.current){setRetryStage('confirm');setError(confirmError.message||'Não foi possível confirmar esta informação.');setPhase('review');requestAnimationFrame(()=>dialogRef.current?.querySelector('.voice-review-error')?.focus())}}finally{if(operationRef.current===controller)operationRef.current=null}
 }

 const retry=()=>retryStage==='confirm'?confirm():processInput()
 const redo=()=>{const remoteId=interactionId;forgetPending();if(remoteId)cancelVoiceInteraction(remoteId).catch(()=>{});recorder.reset();setInteractionId('');setAudioUploaded(false);setPayload(null);setError('');setPhase('capture')}
 const fallbackToText=()=>{const remoteId=interactionId;operationRef.current?.abort();operationRef.current=null;forgetPending();if(remoteId)cancelVoiceInteraction(remoteId).catch(()=>{});recorder.reset();setInteractionId('');setAudioUploaded(false);setPayload(null);setMode('TEXT');setPhase('capture');setError('');setRetryStage('process')}
 const launch=()=>{confirmationNotifiedRef.current=false;setOpen(true);setMode('AUDIO');setPhase('capture');setError('');const pendingId=readPending();if(pendingId)resumePending(pendingId);else recorder.start()}
 const finishSuccess=()=>{if(confirmationNotifiedRef.current){close({cancelRemote:false});return}confirmationNotifiedRef.current=true;const result=payload;close({cancelRemote:false});if(onConfirmed)Promise.resolve(onConfirmed(result)).catch(()=>{})}
 const chooseFile=async event=>{const file=event.target.files?.[0];event.target.value='';if(file)await recorder.selectFile(file)}
 const title=transient?'Perguntar por voz':isPostVisit(interactionType)?'Me conte como foi':label
 const recorderBusy=recorder.status==='requesting'||recorder.status==='validating'
 const portal=typeof document==='undefined'?null:createPortal(<div className="voice-modal-layer">
  <button className="voice-backdrop" type="button" tabIndex="-1" aria-label="Fechar captura de áudio" onClick={()=>{if(!busy&&recorder.status!=='recording'){if(phase==='success')finishSuccess();else close()}}}/>
  <section ref={dialogRef} className="voice-sheet" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} aria-describedby={description?descriptionId:undefined} tabIndex="-1">
   <header className="voice-sheet-header"><div><span><Mic/></span><div><small>{transient?'VAL • PERGUNTA SEM REGISTRO':'VAL • CAPTURA DE CONHECIMENTO'}</small><h2 id={titleId}>{title}</h2>{description&&<p id={descriptionId}>{description}</p>}</div></div><button type="button" aria-label={['success','transcribed'].includes(phase)?'Fechar':'Cancelar e fechar'} disabled={busy} onClick={()=>phase==='success'?finishSuccess():close({cancelRemote:phase!=='transcribed'})}><X/></button></header>
   <div className="voice-sheet-body">
    {phase==='capture'&&<>
     <div className="voice-mode-tabs" role="group" aria-label="Forma de registrar"><button type="button" aria-pressed={mode==='AUDIO'} className={mode==='AUDIO'?'is-active':''} onClick={()=>{setMode('AUDIO');setError('')}}><Mic/>Áudio</button><button type="button" aria-pressed={mode==='TEXT'} aria-disabled={recorder.status==='recording'} disabled={recorder.status==='recording'} className={mode==='TEXT'?'is-active':''} onClick={()=>{recorder.cancelRecording();setMode('TEXT');setError('')}}><Keyboard/>Digitar</button></div>
     {mode==='AUDIO'?<div className={`voice-recorder is-${recorder.status}`}>
      {recorder.status==='recording'?<><span className="voice-recording-state" role="timer" aria-label={`Gravação em andamento, ${formatTime(recorder.elapsedSeconds)}`}><i/>Gravando • {formatTime(recorder.elapsedSeconds)}</span><button className="voice-stop-button" type="button" onClick={recorder.stop}><Square/>Parar gravação</button><button className="voice-cancel-recording" type="button" onClick={recorder.cancelRecording}>Cancelar</button><span>Gravação iniciada por você. Nada será consolidado sem confirmação.</span></>:recorder.audio?<><FileAudio className="voice-audio-icon"/><b>Áudio pronto para enviar</b><span>{formatTime(recorder.audio.durationSeconds)} • {formatSize(recorder.audio.sizeBytes)}</span><audio controls preload="metadata" src={recorder.audio.objectUrl}>Seu navegador não consegue reproduzir este áudio.</audio><div className="voice-ready-actions"><button type="button" onClick={redo}><RotateCcw/>Gravar novamente</button><button type="button" onClick={processInput}><Send/>Enviar para a VAL</button></div></>:<><button className="voice-record-button" type="button" onClick={recorder.start} disabled={recorderBusy} aria-label="Começar gravação">{recorderBusy?<LoaderCircle className="voice-spin"/>:<Mic/>}</button><b>{recorder.status==='requesting'?'Solicitando microfone…':recorder.status==='validating'?'Validando áudio…':'Toque para começar'}</b><span>Fale naturalmente. Você revisará tudo antes de confirmar.</span><button className="voice-file-button" type="button" disabled={recorderBusy} aria-disabled={recorderBusy} onClick={()=>fileInputRef.current?.click()}><Upload/>Escolher áudio salvo</button><input ref={fileInputRef} className="voice-sr-only" type="file" aria-label="Escolher arquivo de áudio" disabled={recorderBusy} accept="audio/*,.mp3,.m4a,.mp4,.wav,.webm,.ogg" capture="user" onChange={chooseFile}/></>}
     </div>:<div className="voice-text-fallback"><label htmlFor={manualTextId}>Conte livremente</label><textarea id={manualTextId} rows="6" maxLength="20000" value={manualText} onChange={event=>setManualText(event.target.value)} placeholder="Escreva o que aconteceu, o que percebeu e o que precisa acontecer depois…"/><button type="button" onClick={processInput} disabled={!manualText.trim()}><Send/>Organizar com a VAL</button></div>}
     {(error||recorder.error)&&<div className="voice-error" role="alert"><AlertTriangle/><span>{error||recorder.error}</span></div>}
    </>}
    {['uploading','processing','confirming'].includes(phase)&&<div className="voice-processing" role="status" aria-live="polite"><span><LoaderCircle className="voice-spin"/></span><h3>{phaseCopy[phase]}</h3><p>{phase==='uploading'?'O áudio será persistido antes da transcrição para permitir retry seguro.':phase==='processing'?'A transcrição continua sendo conteúdo não confirmado.':'Memória e execução só serão atualizadas depois desta confirmação.'}</p>{phase!=='confirming'&&<button type="button" onClick={()=>close()}>Cancelar operação</button>}</div>}
    {phase==='review'&&<CandidateReview
     candidates={candidates} setCandidates={setCandidates} transcript={transcriptOf(payload)}
     additions={additions} setAdditions={setAdditions} additionDraft={additionDraft} setAdditionDraft={setAdditionDraft}
     postVisit={isPostVisit(interactionType)} outcomeType={outcomeType} setOutcomeType={setOutcomeType}
     noAction={noAction} setNoAction={setNoAction} onConfirm={confirm} busy={busy} error={error} errorId={reviewErrorId}
    />}
    {phase==='error'&&<div className="voice-failure" role="alert"><span><AlertTriangle/></span><h3>Não foi possível concluir agora.</h3><p>{error}</p><div><button type="button" onClick={()=>close()}>Cancelar</button>{retryStage!=='confirm'&&<button type="button" onClick={fallbackToText}><Keyboard/>Digitar em vez disso</button>}<button type="button" onClick={retry}><RotateCcw/>Tentar novamente</button></div>{interactionId&&<small>O retry continuará na mesma interação, sem promover memória parcial.</small>}</div>}
    {phase==='transcribed'&&<div className="voice-success" role="status"><span><CheckCircle2/></span><small>PERGUNTA TRANSCRITA</small><h3>Estou analisando sua pergunta.</h3><p>Esta fala foi usada somente nesta conversa e não atualizou a memória confirmada do produtor.</p><button type="button" onClick={()=>close({cancelRemote:false})}>Voltar à conversa</button></div>}
    {phase==='success'&&<div className="voice-success" role="status"><span><CheckCircle2/></span><small>CONFIRMAÇÃO CONCLUÍDA</small><h3>{successCopy[String(interactionType||'').toUpperCase()]||successCopy.GENERAL_CONTEXT}</h3><p>A VAL incorporou somente o que você confirmou, com origem e rastreabilidade.</p><button type="button" onClick={finishSuccess}>Concluir</button></div>}
   </div>
  </section>
 </div>,document.body)
 return <><button ref={launcherRef} type="button" className="voice-capture-launcher" onClick={launch} aria-haspopup="dialog" aria-expanded={open} disabled={!clientId}><Mic/><span><b>{label}</b>{description&&<small>{description}</small>}</span></button>{open&&portal}</>
}
