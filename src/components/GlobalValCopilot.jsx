import React,{useEffect,useMemo,useRef,useState} from 'react'
import {BrainCircuit,Camera,CheckCircle2,ChevronDown,FileText,ImagePlus,LoaderCircle,MessageSquareText,Mic,Paperclip,Send,ShieldCheck,Sparkles,UserRound,X} from 'lucide-react'
import VoiceCapture from './voice/VoiceCapture'
import {canonicalVoiceChange} from '../lib/copilot-view-model'
import '../global-val-copilot.css'

const ATTACHMENT_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
const MAX_ATTACHMENT_BYTES=6_000_000
const quickPrompts=[
 ['PREPARE_VISIT','Preparar conversa','Como devo preparar a próxima conversa com este produtor?'],
 ['OPPORTUNITY_REVIEW','Rever oportunidade','Qual oportunidade merece atenção agora e por quê?'],
 ['FOLLOW_UP_HELP','Definir próximo passo','Qual é o próximo passo mais coerente e o que preciso confirmar?']
]
const firstName=value=>String(value||'produtor').trim().split(/\s+/)[0]
const formatSize=value=>Number(value||0)>=1_000_000?`${(Number(value)/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(Number(value||0)/1000))} KB`
const fileDataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Não consegui abrir este arquivo.'));reader.readAsDataURL(file)})
const conversationKey=clientId=>`valor360:val-copilot-thread:v2:${String(clientId||'none')}`
const conversationId=clientId=>{const key=conversationKey(clientId);try{const existing=sessionStorage.getItem(key);if(existing)return existing;const created=globalThis.crypto?.randomUUID?.()||`val-${Date.now()}-${Math.random().toString(36).slice(2)}`;sessionStorage.setItem(key,created);return created}catch{return `val-${String(clientId||'none')}-${Date.now()}`}}

async function prepareFile(file){
 if(!ATTACHMENT_TYPES.has(file.type))throw new Error('Use foto, PDF, Word, Excel, CSV ou TXT.')
 if(file.size>MAX_ATTACHMENT_BYTES)throw new Error('Cada arquivo pode ter até 6 MB.')
 return file
}

function ReasoningResponse({payload,density,onAsk}){
 const advice=payload?.advice||{}
 const reasoning=advice.ai_reasoning||{}
 const thesis=reasoning.decision_thesis||{}
 const strategy=reasoning.recommended_strategy||{}
 const questions=Array.isArray(reasoning.golden_questions)?reasoning.golden_questions.slice(0,3):[]
 const facts=Array.isArray(reasoning.facts_used)?reasoning.facts_used:[]
 const quality=advice.val_response_quality||reasoning.quality||{}
 const degraded=quality.status==='REASONING_DEGRADED'||reasoning.run?.status==='REASONING_DEGRADED'
 const answer=strategy.reading||advice.answer||'A orientação chegou sem uma leitura principal.'
 return <article className={`global-val-answer is-${density}`}>
  <header><span>VAL</span><div><small>MINHA LEITURA</small><b>{reasoning.client?.name||'Contexto atual'}</b></div></header>
  {degraded&&<p className="global-val-degraded">Tenho pouca informação para te orientar com precisão.</p>}
  <p className="global-val-reading">{answer}</p>
  {strategy.action&&<section className="global-val-action"><small>O QUE FAZER AGORA</small><b>{strategy.action}</b></section>}
  {questions.length>0&&<section className="global-val-questions"><small>PERGUNTAS QUE MAIS MUDAM A DECISÃO</small>{questions.map((item,index)=><button type="button" key={`${item.question}-${index}`} onClick={()=>onAsk(item.question)}>{item.question}</button>)}</section>}
  {density!=='simple'&&<details className="global-val-layer"><summary><Sparkles/>Por que a VAL disse isso?<ChevronDown/></summary><div><p><b>Situação:</b> {thesis.CURRENT_SITUATION}</p><p><b>O que importa:</b> {thesis.WHAT_MATTERS}</p><p><b>Incerteza-chave:</b> {thesis.KEY_UNCERTAINTY}</p><p><b>O que mudaria a leitura:</b> {thesis.WHAT_WOULD_CHANGE_MY_VIEW}</p>{facts.length>0&&<ul>{facts.slice(0,density==='analytical'?8:4).map(item=><li key={item.id}><span>{item.source_type}</span>{item.statement}</li>)}</ul>}</div></details>}
  {density==='analytical'&&<details className="global-val-layer"><summary><ShieldCheck/>Fontes, segurança e premissas<ChevronDown/></summary><div><p><b>ContextSnapshot:</b> {reasoning.context_snapshot?.id||'não informado'}</p><p><b>Confiança:</b> {reasoning.confidence?.level||'não calibrada'} • {Math.round(Number(reasoning.confidence?.score||0)*100)}%</p><p><b>Qualidade da resposta:</b> {quality.status||'não informada'} • teste de troca de nome {quality.automatic_tests?.name_swap?.passed?'aprovado':'não aprovado'} • teste sem contexto {quality.automatic_tests?.context_removal?.passed?'aprovado':'não aprovado'}.</p><p><b>Memória:</b> esta conversa não promove fatos automaticamente. As premissas são recalculadas com o contexto confirmado em cada nova solicitação.</p></div></details>}
 </article>
}

export default function GlobalValCopilot({open,onClose,clients=[],contextClient=null,seed,onRefreshPortfolio,onOpenClient}){
 const [selectedId,setSelectedId]=useState(contextClient?.id||'')
 const [message,setMessage]=useState('')
 const [density,setDensity]=useState('balanced')
 const [mode,setMode]=useState('ASK')
 const [threads,setThreads]=useState({})
 const [attachments,setAttachments]=useState([])
 const [busy,setBusy]=useState(false)
 const [uploading,setUploading]=useState(false)
 const [error,setError]=useState('')
 const fileInput=useRef(null)
 const photoInput=useRef(null)
 const dialogRef=useRef(null)
 const client=useMemo(()=>clients.find(item=>String(item.id)===String(selectedId))||null,[clients,selectedId])
 const thread=threads[selectedId]||[]

 useEffect(()=>{if(contextClient?.id)setSelectedId(contextClient.id)},[contextClient?.id])
 useEffect(()=>{
  if(!seed?.nonce)return
  if(seed.clientId)setSelectedId(seed.clientId)
  if(seed.prompt)setMessage(seed.prompt)
  setMode(seed.mode||'ASK')
 },[seed?.nonce])
 useEffect(()=>{
  if(!open)return
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';requestAnimationFrame(()=>dialogRef.current?.focus())
  const keydown=event=>{if(event.key==='Escape'&&!busy){event.preventDefault();onClose()} }
  document.addEventListener('keydown',keydown)
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=previous}
 },[open,busy,onClose])
 useEffect(()=>{setAttachments([]);setError('')},[selectedId])

 const append=item=>setThreads(current=>({...current,[selectedId]:[...(current[selectedId]||[]),item].slice(-16)}))
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
  if(!client){setError('Escolha o produtor para ativar o contexto certo.');return}
  if((!prompt&&!attachments.length)||busy)return
  const activeClientId=client.id
  const userItem={role:'user',text:prompt||'Analisar os arquivos enviados.',at:new Date().toISOString()}
  append(userItem);setBusy(true);setError('');setMessage('')
  try{
   const effectiveIntent=intent||(attachments.some(item=>String(item.mimeType||'').startsWith('image/'))?'IMAGE_DIAGNOSIS':undefined)
   const response=await fetch('/api/val/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:client.id,client,message:prompt,attachmentIds:attachments.map(item=>item.id),mode:'daily',intent:effectiveIntent,conversationId:conversationId(client.id)}),signal:AbortSignal.timeout(120_000)})
   const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'A VAL não respondeu agora.')
   setThreads(current=>({...current,[activeClientId]:[...(current[activeClientId]||[]),{role:'assistant',payload,at:new Date().toISOString()}].slice(-16)}));setAttachments([])
  }catch(requestError){setError(requestError.name==='TimeoutError'?'A análise ultrapassou o tempo. Tente novamente.':requestError.message)}finally{setBusy(false)}
 }

 const registered=async payload=>{
  const confirmed=canonicalVoiceChange(payload)
  if(!confirmed){append({role:'system',text:'Revisão concluída sem nova informação confirmada.'});return}
  append({role:'system',text:'Informação confirmada. As premissas deste produtor serão recalculadas na próxima pergunta.'})
  try{await onRefreshPortfolio?.()}catch{}
 }

 if(!open)return null
 return <div className="global-val-layer-root">
  <button type="button" className="global-val-backdrop" aria-label="Fechar VAL" onClick={()=>!busy&&onClose()}/>
  <aside ref={dialogRef} className="global-val-copilot" role="dialog" aria-modal="true" aria-labelledby="global-val-title" tabIndex="-1">
   <header className="global-val-header"><div><span><BrainCircuit/></span><div><small>VAL • COPILOTO</small><h2 id="global-val-title">Pergunte sem sair do que está fazendo.</h2></div></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X/></button></header>
   <div className="global-val-context"><label><UserRound/>Produtor<select value={selectedId} onChange={event=>setSelectedId(event.target.value)} disabled={busy}><option value="">Escolha o produtor</option>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{client&&<button type="button" onClick={()=>{onOpenClient?.(client);onClose()}}>Abrir memória de {firstName(client.name)}</button>}</div>
   <div className="global-val-mode" role="tablist" aria-label="Ação da VAL"><button type="button" className={mode==='ASK'?'active':''} onClick={()=>setMode('ASK')}><MessageSquareText/>Perguntar</button><button type="button" className={mode==='REGISTER'?'active':''} onClick={()=>setMode('REGISTER')}><CheckCircle2/>Registrar informação</button></div>
   {mode==='REGISTER'?<section className="global-val-register"><ShieldCheck/><h3>Atualize as premissas com confirmação.</h3><p>Fale ou digite o que mudou. A VAL separa fatos, hipóteses e compromissos para você revisar antes de incorporar à memória.</p><VoiceCapture clientId={client?.id||''} interactionType="CLIENT_NOTE" label="Falar ou digitar" description="Revisar antes de salvar" sourceContext={{page:'GLOBAL_VAL_COPILOT',persistence_mode:'CONFIRM_REQUIRED'}} onConfirmed={registered}/></section>:<>
    <div className="global-val-density"><span>Resposta</span>{[['simple','Simples'],['balanced','Equilibrada'],['analytical','Analítica']].map(([id,label])=><button type="button" key={id} className={density===id?'active':''} onClick={()=>setDensity(id)}>{label}</button>)}</div>
    <div className="global-val-thread" aria-live="polite">
     {!thread.length&&<section className="global-val-empty"><BrainCircuit/><h3>O que você precisa decidir?</h3><p>{client?`Estou usando o contexto confirmado de ${client.name}.`:'Escolha um produtor para ativar o contexto correto.'}</p><div>{quickPrompts.map(([intent,label,prompt])=><button type="button" key={intent} disabled={!client||busy} onClick={()=>ask(prompt,intent)}>{label}</button>)}</div></section>}
     {thread.map((item,index)=>item.role==='assistant'?<ReasoningResponse key={index} payload={item.payload} density={density} onAsk={question=>ask(question,'ASK_CLIENT')}/>:<p key={index} className={`global-val-message is-${item.role}`}>{item.text}</p>)}
     {busy&&<div className="global-val-thinking" role="status"><LoaderCircle/><span><b>Conectando contexto, histórico e evidências…</b><small>A VAL vai mostrar lacunas em vez de completar com suposições.</small></span></div>}
    </div>
    <div className="global-val-composer-wrap">
     {attachments.length>0&&<div className="global-val-attachments">{attachments.map(item=><span key={item.id}>{item.mimeType?.startsWith('image/')?<ImagePlus/>:<FileText/>}<b>{item.originalName}</b><small>{formatSize(item.sizeBytes)}</small><button type="button" aria-label={`Remover ${item.originalName}`} onClick={()=>setAttachments(current=>current.filter(entry=>entry.id!==item.id))}><X/></button></span>)}</div>}
     <form className="global-val-composer" onSubmit={event=>{event.preventDefault();ask(message)}}>
      <button type="button" onClick={()=>fileInput.current?.click()} disabled={!client||busy||uploading} aria-label="Anexar arquivo"><Paperclip/></button><button type="button" onClick={()=>photoInput.current?.click()} disabled={!client||busy||uploading} aria-label="Tirar ou escolher foto"><Camera/></button>
      <label><span className="sr-only">Pergunte à VAL</span><textarea rows="2" value={message} maxLength="3000" disabled={!client||busy} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask(message)}}} placeholder={client?`Pergunte sobre ${firstName(client.name)}…`:'Escolha um produtor acima'}/></label>
      <button type="submit" className="is-send" disabled={!client||busy||uploading||(!message.trim()&&!attachments.length)}>{busy?<LoaderCircle/>:<Send/>}</button>
      <input ref={fileInput} className="sr-only" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,text/csv,text/plain" onChange={upload}/><input ref={photoInput} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" onChange={upload}/>
     </form>
     <div className="global-val-voice"><VoiceCapture transient clientId={client?.id||''} interactionType="GENERAL_CONTEXT" label="Perguntar por voz" description="A fala não será salva como memória" sourceContext={{page:'GLOBAL_VAL_COPILOT',persistence_mode:'NONE'}} onTranscribed={transcript=>ask(transcript)}/><span><Mic/>Perguntar não atualiza fatos. Para isso, use “Registrar informação”.</span></div>
     {uploading&&<p className="global-val-status"><LoaderCircle/>Enviando arquivo…</p>}{error&&<p className="global-val-error" role="alert">{error}</p>}
    </div>
   </>}
  </aside>
 </div>
}
