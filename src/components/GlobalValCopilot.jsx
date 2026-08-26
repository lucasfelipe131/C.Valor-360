import React,{useEffect,useMemo,useRef,useState} from 'react'
import {BrainCircuit,Camera,CheckCircle2,ChevronDown,FileText,ImagePlus,LoaderCircle,MessageSquareText,Mic,Paperclip,Send,ShieldCheck,Sparkles,UserRound,Volume2,X} from 'lucide-react'
import VoiceCapture from './voice/VoiceCapture'
import DecisionInterviewCard from './copilot/DecisionInterviewCard'
import ValAudioResponse from './copilot/ValAudioResponse'
import {canonicalVoiceChange} from '../lib/copilot-view-model'
import {readConsultantExperiencePreference,writeConsultantExperiencePreference} from '../lib/consultant-experience-preference'
import {buildMarketContinuationMessage,buildRegisterPrefill,buildSessionReplyMessage,limitValChatMessage,selectMarketContinuation,sessionRepliesForAsk} from '../lib/global-val-conversation'
import {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'
import '../global-val-copilot.css'

const ATTACHMENT_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
const MAX_ATTACHMENT_BYTES=6_000_000
const clientQuickPrompts=[
 ['PREPARE_VISIT','Preparar conversa','Como devo preparar a próxima conversa com este produtor?'],
 ['CHECK_OPPORTUNITY','Rever oportunidade','Qual oportunidade merece atenção agora e por quê?'],
 ['FOLLOW_UP_HELP','Definir próximo passo','Qual é o próximo passo mais coerente e o que preciso confirmar?']
]
const globalQuickPrompts=[['ASK_COMMODITY','Consultar soja','Qual é a referência mais recente de soja e qual é a fonte?'],['ASK_MARKET','Ver mercado','Como está o mercado nas referências autorizadas da carteira?']]
const firstName=value=>String(value||'produtor').trim().split(/\s+/)[0]
const formatSize=value=>Number(value||0)>=1_000_000?`${(Number(value)/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(Number(value||0)/1000))} KB`
const fileDataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Não consegui abrir este arquivo.'));reader.readAsDataURL(file)})
const conversationKey=clientId=>`valor360:val-copilot-thread:v3:${String(clientId||'global')}`
const conversationId=clientId=>{const key=conversationKey(clientId);try{const existing=sessionStorage.getItem(key);if(existing)return existing;const created=globalThis.crypto?.randomUUID?.()||`val-${Date.now()}-${Math.random().toString(36).slice(2)}`;sessionStorage.setItem(key,created);return created}catch{return `val-${String(clientId||'none')}-${Date.now()}`}}

async function prepareFile(file){
 if(!ATTACHMENT_TYPES.has(file.type))throw new Error('Use foto, PDF, Word, Excel, CSV ou TXT.')
 if(file.size>MAX_ATTACHMENT_BYTES)throw new Error('Cada arquivo pode ter até 6 MB.')
 return file
}

function ReasoningResponse({payload,density,outputMode,onReply,onRegister}){
 const advice=payload?.advice||{}
 const reasoning=advice.ai_reasoning||{}
 const thesis=reasoning.decision_thesis||{}
 const strategy=reasoning.recommended_strategy||{}
 const questions=Array.isArray(reasoning.golden_questions)?reasoning.golden_questions.slice(0,3):[]
 const facts=Array.isArray(reasoning.facts_used)?reasoning.facts_used:[]
 const quality=advice.val_response_quality||reasoning.quality||{}
 const degraded=quality.status==='REASONING_DEGRADED'||reasoning.run?.status==='REASONING_DEGRADED'
 const answer=strategy.reading||advice.answer||'A orientação chegou sem uma leitura principal.'
 const qualityTestLabel=test=>test?.evaluated===false?'não executado':test?.passed?'aprovado':'não aprovado'
 return <article className={`global-val-answer is-${density}`}>
  <header><span>VAL</span><div><small>MINHA LEITURA</small><b>{reasoning.client?.name||'Contexto atual'}</b></div>{reasoning.run?.path&&<em className={`global-val-path is-${String(reasoning.run.path).toLowerCase()}`}>{reasoning.run.path}</em>}</header>
  {degraded&&<p className="global-val-degraded">Tenho pouca informação para te orientar com precisão.</p>}
  {outputMode!=='audio'&&<p className="global-val-reading">{answer}</p>}
  {outputMode!=='text'&&<ValAudioResponse text={reasoning.voice_output?.speakable_text||answer}/>}
  {strategy.action&&<section className="global-val-action"><small>O QUE FAZER AGORA</small><b>{strategy.action}</b></section>}
  <DecisionInterviewCard interview={reasoning.decision_interview} onReply={question=>onReply?.({...question,intent:reasoning.intent,objective:reasoning.objective,commodity:reasoning.commercial_context?.commodity||reasoning.premises?.current_data?.source?.commodity||'',season:reasoning.commercial_context?.season||''})} onRegister={onRegister}/>
  {questions.length>0&&<section className="global-val-questions"><small>PERGUNTAS PARA LEVAR AO PRODUTOR</small>{questions.map((item,index)=><div key={`${item.question}-${index}`}><b>{item.question}</b>{item.reason&&<span>{item.reason}</span>}</div>)}</section>}
  {density!=='simple'&&<details className="global-val-layer"><summary><Sparkles/>Por que a VAL disse isso?<ChevronDown/></summary><div><p><b>Situação:</b> {thesis.CURRENT_SITUATION}</p><p><b>O que importa:</b> {thesis.WHAT_MATTERS}</p><p><b>Incerteza-chave:</b> {thesis.KEY_UNCERTAINTY}</p><p><b>O que mudaria a leitura:</b> {thesis.WHAT_WOULD_CHANGE_MY_VIEW}</p>{facts.length>0&&<ul>{facts.slice(0,density==='analytical'?8:4).map(item=><li key={item.id}><span>{item.source_type}</span>{item.statement}</li>)}</ul>}</div></details>}
  {density==='analytical'&&<details className="global-val-layer"><summary><ShieldCheck/>Fontes, segurança e premissas<ChevronDown/></summary><div><p><b>ContextSnapshot:</b> {reasoning.context_snapshot?.id||'não informado'}</p><p><b>Confiança:</b> {reasoning.confidence?.level||'não calibrada'} • {Math.round(Number(reasoning.confidence?.score||0)*100)}%</p>{reasoning.reasoning_confidence&&<p><b>Confiança dimensional:</b> contexto {Math.round(Number(reasoning.reasoning_confidence.context||0)*100)}% • tese {Math.round(Number(reasoning.reasoning_confidence.thesis||0)*100)}% • pergunta {Math.round(Number(reasoning.reasoning_confidence.question||0)*100)}%{reasoning.reasoning_confidence.agronomy!=null?` • agronomia ${Math.round(Number(reasoning.reasoning_confidence.agronomy)*100)}%`:''}.</p>}<p><b>Caminho:</b> {reasoning.run?.path||'não informado'} • executado: {(reasoning.run?.capabilities_used||[]).join(', ')||'nenhuma capacidade'}{reasoning.run?.capabilities_planned?.length?` • planejado: ${reasoning.run.capabilities_planned.join(', ')}`:''}.</p><p><b>Qualidade da resposta:</b> {quality.status||'não informada'} • teste de troca de nome {qualityTestLabel(quality.automatic_tests?.name_swap)} • teste sem contexto {qualityTestLabel(quality.automatic_tests?.context_removal)}.</p><p><b>Memória:</b> esta conversa não promove fatos automaticamente. As premissas são recalculadas com contexto confirmado + respostas desta sessão em cada solicitação.</p></div></details>}
 </article>
}

export default function GlobalValCopilot({open,onClose,clients=[],contextClient=null,seed,onRefreshPortfolio,onOpenClient,storageScope='session'}){
 const [selectedId,setSelectedId]=useState(contextClient?.id||'')
 const [message,setMessage]=useState('')
 const [density,setDensity]=useState(()=>readConsultantExperiencePreference(storageScope).toLowerCase())
 const [outputMode,setOutputMode]=useState('text')
 const [mode,setMode]=useState('ASK')
 const [replyingTo,setReplyingTo]=useState(null)
 const [pendingCapture,setPendingCapture]=useState('')
 const [sessionReplyOffer,setSessionReplyOffer]=useState(null)
 const [sessionReplies,setSessionReplies]=useState({})
 const [threads,setThreads]=useState({})
 const [attachments,setAttachments]=useState([])
 const [busy,setBusy]=useState(false)
 const [uploading,setUploading]=useState(false)
 const [error,setError]=useState('')
 const [progress,setProgress]=useState(null)
 const fileInput=useRef(null)
 const photoInput=useRef(null)
 const messageInput=useRef(null)
 const dialogRef=useRef(null)
 const client=useMemo(()=>clients.find(item=>String(item.id)===String(selectedId))||null,[clients,selectedId])
 const threadKey=selectedId||'__global__'
 const thread=threads[threadKey]||[]
 const registerInitialText=useMemo(()=>buildRegisterPrefill(sessionReplies[threadKey]||[]),[sessionReplies,threadKey])

 useEffect(()=>{if(contextClient?.id)setSelectedId(contextClient.id)},[contextClient?.id])
 useEffect(()=>{
  if(!seed?.nonce)return
  setSelectedId(seed.clientId||'')
  setMessage(seed.prompt||'')
  setMode(seed.mode||'ASK')
  setPendingCapture(seed.capture||'')
 },[seed?.nonce])
 useEffect(()=>{setDensity(readConsultantExperiencePreference(storageScope).toLowerCase())},[storageScope])
 useEffect(()=>{
  if(!open||!pendingCapture||!client)return
  const capture=pendingCapture
  const timer=window.setTimeout(()=>{if(capture==='photo')photoInput.current?.click();if(capture==='file')fileInput.current?.click();setPendingCapture('')},180)
  return()=>window.clearTimeout(timer)
 },[open,pendingCapture,client?.id])
 useEffect(()=>{
  if(!open)return
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';requestAnimationFrame(()=>dialogRef.current?.focus())
  const keydown=event=>{if(event.key==='Escape'&&!busy){event.preventDefault();onClose()} }
  document.addEventListener('keydown',keydown)
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=previous}
 },[open,busy,onClose])
 useEffect(()=>{setAttachments([]);setError('');setReplyingTo(null);setSessionReplyOffer(null)},[selectedId])

 const append=item=>setThreads(current=>({...current,[threadKey]:[...(current[threadKey]||[]),item].slice(-20)}))
 const upload=async event=>{
  const files=Array.from(event.target.files||[]);event.target.value=''
  if(!client||!files.length||uploading)return
  const slots=Math.max(0,3-attachments.length);if(!slots){setError('Envie no máximo 3 arquivos por pergunta.');return}
  setUploading(true);setError('')
  try{
   for(const original of files.slice(0,slots)){
    const file=await prepareFile(original);const dataUrl=await fileDataUrl(file)
    const response=await fetch('/api/val/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client.id,originalName:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl}),signal:AbortSignal.timeout(60_000)})
    const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não consegui enviar este arquivo.')
    setAttachments(current=>current.some(item=>item.id===payload.attachment.id)?current:[...current,payload.attachment].slice(0,3))
   }
  }catch(uploadError){setError(uploadError.message)}finally{setUploading(false)}
 }

 const ask=async(rawMessage,intent)=>{
  const prompt=String(rawMessage||message||(attachments.length?'Leia estes arquivos e me diga o que importa.':'')).trim()
  if(!client&&attachments.length){setError('Escolha o produtor antes de anexar uma evidência à conta.');return}
  if((!prompt&&!attachments.length)||busy)return
  const activeThreadKey=client?.id||'__global__'
  const activeReply=replyingTo
  const continuation=!intent&&!activeReply&&!attachments.length?selectMarketContinuation({prompt,localThread:thread,globalThread:threads.__global__||[],hasClient:Boolean(client)}):null
  const effectiveIntent=intent||activeReply?.intent||continuation?.intent||undefined
  const priorSessionReplies=sessionRepliesForAsk({replies:sessionReplies[activeThreadKey]||[],activeReply,intent:effectiveIntent})
  const latestUser=[...thread].reverse().find(item=>item.role==='user')
  const sessionObjective=activeReply?.objective||priorSessionReplies[0]?.objective||latestUser?.objective||latestUser?.text||continuation?.objective||prompt
  const currentSessionReplies=activeReply?.question?[...priorSessionReplies,{field:activeReply.field||'',question:activeReply.question,answer:prompt,intent:effectiveIntent||'',objective:sessionObjective,commodity:activeReply.commodity||'',season:activeReply.season||''}]:priorSessionReplies
  const requestMessage=activeReply?.question
   ?buildSessionReplyMessage({objective:sessionObjective,replies:currentSessionReplies})
   :continuation
    ?buildMarketContinuationMessage({objective:continuation.objective,prompt})
    :limitValChatMessage(prompt)
  const userItem={role:'user',text:prompt||'Analisar os arquivos enviados.',objective:continuation?requestMessage:prompt,intent:effectiveIntent||'',at:new Date().toISOString()}
  if(!activeReply){setSessionReplies(current=>({...current,[activeThreadKey]:[]}));setSessionReplyOffer(null)}
  append(userItem);setBusy(true);setError('');setMessage('');setReplyingTo(null);setProgress(client?initialValProgress():{stage:'current_data',label:'Consultando a fonte autorizada mais recente',done:false})
  const controller=new AbortController();const requestId=createValProgressRequestId();const stopProgress=client?startValProgressPolling({requestId,onProgress:setProgress,signal:controller.signal}):()=>{}
  try{
   const timeout=AbortSignal.timeout(120_000);const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,timeout]):timeout
   const response=await fetch('/api/val/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client?.id||'',client:client||undefined,message:requestMessage,attachmentIds:attachments.map(item=>item.id),mode:'daily',intent:effectiveIntent,conversationId:conversationId(client?.id||'global'),requestId}),signal})
   const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'A VAL não respondeu agora.')
   setThreads(current=>({...current,[activeThreadKey]:[...(current[activeThreadKey]||[]),{role:'assistant',payload,at:new Date().toISOString()}].slice(-20)}));setAttachments([])
   if(activeReply){setSessionReplies(current=>({...current,[activeThreadKey]:currentSessionReplies.slice(-6)}));setSessionReplyOffer({question:activeReply.question,answer:prompt,intent:activeReply.intent||effectiveIntent||''})}
  }catch(requestError){setError(requestError.name==='TimeoutError'?'A análise ultrapassou o tempo. Tente novamente.':requestError.message)}finally{stopProgress();controller.abort();setProgress(null);setBusy(false)}
 }

 const registered=async payload=>{
  const confirmed=canonicalVoiceChange(payload)
  if(!confirmed){append({role:'system',text:'Revisão concluída sem nova informação confirmada.'});return}
  append({role:'system',text:'Informação confirmada. As premissas deste produtor serão recalculadas na próxima pergunta.'})
  setSessionReplyOffer(null)
  setSessionReplies(current=>({...current,[threadKey]:[]}))
  try{await onRefreshPortfolio?.()}catch{}
 }

 if(!open)return null
 return <div className="global-val-layer-root">
  <button type="button" className="global-val-backdrop" aria-label="Fechar VAL" onClick={()=>!busy&&onClose()}/>
  <aside ref={dialogRef} className="global-val-copilot" role="dialog" aria-modal="true" aria-labelledby="global-val-title" tabIndex="-1">
   <header className="global-val-header"><div><span><BrainCircuit/></span><div><small>VAL • COPILOTO</small><h2 id="global-val-title">Pergunte sem sair do que está fazendo.</h2></div></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X/></button></header>
   <div className="global-val-context"><label><UserRound/>Contexto<select value={selectedId} onChange={event=>setSelectedId(event.target.value)} disabled={busy}><option value="">Pergunta geral • mercado sem produtor</option>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{client&&<button type="button" onClick={()=>{onOpenClient?.(client);onClose()}}>Abrir memória de {firstName(client.name)}</button>}</div>
   {pendingCapture&&!client&&<p className="global-val-capture-pending"><Camera/>Escolha o produtor acima; a captura será aberta em seguida e não será descartada.</p>}
   <div className="global-val-mode" role="tablist" aria-label="Ação da VAL"><button type="button" className={mode==='ASK'?'active':''} onClick={()=>setMode('ASK')}><MessageSquareText/>Perguntar</button><button type="button" className={mode==='REGISTER'?'active':''} onClick={()=>setMode('REGISTER')}><CheckCircle2/>Registrar informação</button></div>
   {mode==='REGISTER'?<section className="global-val-register"><ShieldCheck/><h3>Atualize as premissas com confirmação.</h3><p>{client?'Fale ou digite o que mudou. A VAL separa fatos, hipóteses e compromissos para você revisar antes de incorporar à memória.':'Escolha um produtor acima. Uma informação só pode entrar na memória quando sabemos a qual conta ela pertence.'}</p><VoiceCapture clientId={client?.id||''} interactionType="CLIENT_NOTE" label="Falar ou digitar" description="Revisar antes de salvar" initialText={registerInitialText} sourceContext={{page:'GLOBAL_VAL_COPILOT',persistence_mode:'CONFIRM_REQUIRED'}} onConfirmed={registered}/></section>:<>
    <div className="global-val-preferences"><div className="global-val-density"><span>Resposta</span>{[['simple','Simples'],['balanced','Equilibrada'],['analytical','Analítica']].map(([id,label])=><button type="button" key={id} className={density===id?'active':''} onClick={()=>setDensity(writeConsultantExperiencePreference(storageScope,id.toUpperCase()).toLowerCase())}>{label}</button>)}</div><div className="global-val-output"><span><Volume2/>Saída</span>{[['text','Texto'],['audio','Áudio'],['both','Texto + áudio']].map(([id,label])=><button type="button" key={id} className={outputMode===id?'active':''} onClick={()=>setOutputMode(id)}>{label}</button>)}</div></div>
    <div className="global-val-thread" aria-live="polite">
     {!thread.length&&<section className="global-val-empty"><BrainCircuit/><h3>O que você precisa decidir?</h3><p>{client?`Estou usando o contexto confirmado de ${client.name}.`:'Consulte mercado e commodities sem produtor; para cruzar uma conta, escolha-a acima.'}</p><div>{(client?clientQuickPrompts:globalQuickPrompts).map(([intent,label,prompt])=><button type="button" key={intent} disabled={busy} onClick={()=>ask(prompt,intent)}>{label}</button>)}</div></section>}
     {thread.map((item,index)=>item.role==='assistant'?<ReasoningResponse key={index} payload={item.payload} density={density} outputMode={outputMode} onReply={question=>{setReplyingTo(question);setMessage('');requestAnimationFrame(()=>messageInput.current?.focus())}} onRegister={()=>setMode('REGISTER')}/>:<p key={index} className={`global-val-message is-${item.role}`}>{item.text}</p>)}
     {busy&&<div className="global-val-thinking" role="status"><LoaderCircle/><span><b>{progress?.label||'Analisando a solicitação…'}</b><small>{client?'Etapa real do processamento. Se faltar algo material, a VAL perguntará.':'A VAL não usa memória antiga como dado atual.'}</small></span></div>}
    </div>
    <div className="global-val-composer-wrap">
     {sessionReplyOffer&&<div className="global-val-session-offer"><ShieldCheck/><span><b>Usada somente nesta conversa</b><small>Essa resposta já recalculou a leitura, mas ainda não alterou a memória confirmada.</small></span><button type="button" onClick={()=>setMode('REGISTER')}>Revisar e registrar</button><button type="button" className="is-dismiss" aria-label="Manter apenas nesta conversa" onClick={()=>setSessionReplyOffer(null)}><X/></button></div>}
     {replyingTo&&<div className="global-val-replying"><MessageSquareText/><span><b>Respondendo à pergunta material</b><small>{replyingTo.question}</small></span><button type="button" aria-label="Cancelar resposta" onClick={()=>setReplyingTo(null)}><X/></button></div>}
     {attachments.length>0&&<div className="global-val-attachments">{attachments.map(item=><span key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<b>{item.originalName}</b><small>{formatSize(item.sizeBytes)}</small><button type="button" aria-label={`Remover ${item.originalName}`} onClick={()=>setAttachments(current=>current.filter(entry=>entry.id!==item.id))}><X/></button></span>)}</div>}
     <form className="global-val-composer" onSubmit={event=>{event.preventDefault();ask(message)}}>
      <button type="button" onClick={()=>fileInput.current?.click()} disabled={!client||busy||uploading} aria-label="Anexar arquivo"><Paperclip/></button><button type="button" onClick={()=>photoInput.current?.click()} disabled={!client||busy||uploading} aria-label="Tirar ou escolher foto"><Camera/></button>
      <label><span className="sr-only">Pergunte à VAL</span><textarea ref={messageInput} rows="2" value={message} maxLength="3000" disabled={busy} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask(message)}}} placeholder={replyingTo?'Digite a resposta do consultor…':client?`Pergunte sobre ${firstName(client.name)}…`:'Pergunte sobre mercado ou escolha um produtor'}/></label>
      <button type="submit" className="is-send" disabled={busy||uploading||(!message.trim()&&!attachments.length)}>{busy?<LoaderCircle/>:<Send/>}</button>
      <input ref={fileInput} className="sr-only" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,text/csv,text/plain" onChange={upload}/><input ref={photoInput} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" onChange={upload}/>
     </form>
     <div className="global-val-voice"><VoiceCapture transient clientId={client?.id||''} interactionType="GENERAL_CONTEXT" label="Perguntar por voz" description={client?'A fala não será salva como memória':'Escolha um produtor para usar voz'} sourceContext={{page:'GLOBAL_VAL_COPILOT',persistence_mode:'NONE'}} onTranscribed={transcript=>ask(transcript)}/><span><Mic/>Perguntar não atualiza fatos. Para isso, use “Registrar informação”.</span></div>
     {uploading&&<p className="global-val-status"><LoaderCircle/>Enviando arquivo…</p>}{error&&<p className="global-val-error" role="alert">{error}</p>}
    </div>
   </>}
  </aside>
 </div>
}
