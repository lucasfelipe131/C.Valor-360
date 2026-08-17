import {existsSync,readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'

const read=path=>readFileSync(path,'utf8')
const write=(path,content)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content)}
const replaceOnce=(source,search,replacement,label)=>{
  const first=source.indexOf(search)
  if(first<0)throw new Error(`B2: não encontrei o trecho ${label}`)
  if(source.indexOf(search,first+search.length)>=0)throw new Error(`B2: trecho ${label} apareceu mais de uma vez`)
  return source.slice(0,first)+replacement+source.slice(first+search.length)
}

write('server/val-progress.js',`const STAGES=Object.freeze({
  received:{order:0,label:'Recebendo a solicitação'},
  context:{order:1,label:'Cruzando histórico e sinais'},
  products:{order:2,label:'Comparando alternativas de produto'},
  language:{order:3,label:'Redigindo a recomendação'},
  persist:{order:4,label:'Salvando a recomendação'},
  complete:{order:5,label:'Recomendação pronta'},
  failed:{order:6,label:'Não foi possível concluir'}
})

const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const text=value=>String(value??'').trim().slice(0,180)

export function normalizeValProgressRequestId(value){
  const requestId=text(value)
  return REQUEST_ID.test(requestId)?requestId:''
}

export function createValProgressTracker({ttlMs=300_000,maxEntries=500,clock=()=>Date.now()}={}){
  const entries=new Map()

  function prune(){
    const cutoff=clock()-ttlMs
    for(const [key,value] of entries)if(value.updatedAtMs<cutoff)entries.delete(key)
    while(entries.size>maxEntries)entries.delete(entries.keys().next().value)
  }

  function snapshot(entry){
    if(!entry)return null
    const definition=STAGES[entry.stage]||STAGES.received
    return {
      requestId:entry.requestId,
      clientId:entry.clientId,
      mode:entry.mode,
      stage:entry.stage,
      label:definition.label,
      order:definition.order,
      total:STAGES.complete.order,
      done:entry.stage==='complete'||entry.stage==='failed',
      failed:entry.stage==='failed',
      updatedAt:new Date(entry.updatedAtMs).toISOString()
    }
  }

  function start({requestId,ownerId,clientId,mode='daily'}){
    prune()
    const normalized=normalizeValProgressRequestId(requestId)
    if(!normalized)return null
    const now=clock()
    const entry={requestId:normalized,ownerId:text(ownerId),clientId:text(clientId),mode:text(mode)||'daily',stage:'received',updatedAtMs:now}
    entries.set(normalized,entry)
    return snapshot(entry)
  }

  function update({requestId,ownerId,stage}){
    prune()
    const normalized=normalizeValProgressRequestId(requestId)
    const entry=entries.get(normalized)
    if(!entry||entry.ownerId!==text(ownerId)||!STAGES[stage])return null
    const current=STAGES[entry.stage]?.order??0
    const next=STAGES[stage].order
    if(stage!=='failed'&&next<current)return snapshot(entry)
    entry.stage=stage
    entry.updatedAtMs=clock()
    return snapshot(entry)
  }

  const complete=input=>update({...input,stage:'complete'})
  const fail=input=>update({...input,stage:'failed'})

  function get({requestId,ownerId}){
    prune()
    const entry=entries.get(normalizeValProgressRequestId(requestId))
    if(!entry||entry.ownerId!==text(ownerId))return null
    return snapshot(entry)
  }

  return {start,update,complete,fail,get,stages:STAGES}
}

export const valProgressStages=STAGES
`)

write('src/lib/val-progress-client.js',`export const VAL_PROGRESS_STEPS=Object.freeze([
  {stage:'context',label:'Cruzando histórico e sinais'},
  {stage:'products',label:'Comparando alternativas de produto'},
  {stage:'language',label:'Redigindo a recomendação'},
  {stage:'persist',label:'Salvando a recomendação'}
])

export function initialValProgress(){return {stage:'received',label:'Recebendo a solicitação',order:0,total:5,done:false,failed:false}}

function fallbackUuid(){
  const bytes=new Uint8Array(16)
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes)
  else for(let index=0;index<bytes.length;index++)bytes[index]=Math.floor(Math.random()*256)
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export function createValProgressRequestId(){return globalThis.crypto?.randomUUID?.()||fallbackUuid()}

export function startValProgressPolling({requestId,onProgress,signal,intervalMs=650}){
  let stopped=false
  let timer=null
  let activeController=null

  const stop=()=>{stopped=true;if(timer)clearTimeout(timer);activeController?.abort()}
  const schedule=()=>{if(!stopped&&!signal?.aborted)timer=setTimeout(poll,intervalMs)}
  const poll=async()=>{
    if(stopped||signal?.aborted)return stop()
    activeController=new AbortController()
    const abort=()=>activeController?.abort()
    signal?.addEventListener('abort',abort,{once:true})
    try{
      const timeout=typeof AbortSignal.timeout==='function'?AbortSignal.timeout(5_000):null
      const requestSignal=timeout&&typeof AbortSignal.any==='function'?AbortSignal.any([activeController.signal,timeout]):activeController.signal
      const response=await fetch('/api/val/progress?requestId='+encodeURIComponent(requestId),{signal:requestSignal,headers:{Accept:'application/json'}})
      if(response.ok){
        const progress=await response.json()
        onProgress?.(progress)
        if(progress.done)return stop()
      }
    }catch(error){if(error?.name!=='AbortError'&&error?.name!=='TimeoutError')console.debug('[VAL_PROGRESS]',error?.message||error)}
    finally{signal?.removeEventListener('abort',abort);activeController=null}
    schedule()
  }
  poll()
  return stop
}
`)

write('src/components/ValProgressFeedback.jsx',`import React from 'react'
import {Check,LoaderCircle} from 'lucide-react'
import {VAL_PROGRESS_STEPS} from '../lib/val-progress-client'
import '../val-progress.css'

export default function ValProgressFeedback({progress,compact=false}){
  const current=progress||{stage:'received',label:'Recebendo a solicitação',order:0}
  return <div className={\`val-progress-feedback \${compact?'is-compact':''}\`} role="status" aria-live="polite">
    <div className="val-progress-current"><LoaderCircle className={current.done?'':'is-spinning'}/><span><small>ETAPA ATUAL</small><b>{current.label}</b></span></div>
    <ol>{VAL_PROGRESS_STEPS.map((item,index)=>{
      const done=current.stage==='complete'||Number(current.order)>index+1
      const active=current.stage===item.stage
      return <li key={item.stage} className={done?'is-done':active?'is-active':''}>{done?<Check/>:<span>{index+1}</span>}<b>{item.label}</b></li>
    })}</ol>
  </div>
}
`)

write('src/val-progress.css',`.val-progress-feedback{display:grid;gap:10px;margin-top:10px;padding:12px 14px;border:1px solid rgba(20,110,79,.18);border-radius:14px;background:linear-gradient(135deg,rgba(240,251,246,.98),rgba(248,252,250,.98));color:#153d31}.val-progress-current{display:flex;align-items:center;gap:10px}.val-progress-current>svg{width:19px;height:19px;color:#177d5a}.val-progress-current span{display:grid;gap:1px}.val-progress-current small{font-size:9px;font-weight:800;letter-spacing:.12em;color:#648278}.val-progress-current b{font-size:13px}.val-progress-feedback ol{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}.val-progress-feedback li{display:flex;align-items:center;gap:6px;min-width:0;padding:7px 8px;border-radius:10px;background:rgba(255,255,255,.7);color:#82958f}.val-progress-feedback li>span,.val-progress-feedback li>svg{display:grid;place-items:center;flex:0 0 18px;width:18px;height:18px;border-radius:50%;background:#e5eeea;font-size:9px;font-weight:800}.val-progress-feedback li b{overflow:hidden;font-size:10px;line-height:1.25;text-overflow:ellipsis}.val-progress-feedback li.is-active{background:#e7f7ef;color:#116d4e;box-shadow:inset 0 0 0 1px rgba(23,125,90,.18)}.val-progress-feedback li.is-done{color:#2f6a58}.val-progress-feedback li.is-done>svg{padding:3px;background:#d8f1e5;color:#147653}.val-progress-feedback.is-compact ol{grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:760px){.val-progress-feedback ol{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:430px){.val-progress-feedback ol{grid-template-columns:1fr}.val-progress-feedback li b{white-space:normal}}
`)

let bootstrap=read('server/conversion-bootstrap.js')
bootstrap=replaceOnce(bootstrap,
"const PATCHED=Symbol.for('valor360.conversion-core.patched')\n",
"const PATCHED=Symbol.for('valor360.conversion-core.patched')\n\nfunction emitProgress(input,stage){\n  try{input?.onProgress?.(stage)}catch{}\n}\n",
'helper de progresso no bootstrap')
bootstrap=replaceOnce(bootstrap,
"function deterministicDecision(context,effectiveMessage,originalMessage,input){\n  context.decisionIntelligence=buildDecisionIntelligence(context)\n  context.productIntelligence=buildValueBridge(context,effectiveMessage)\n",
"function deterministicDecision(context,effectiveMessage,originalMessage,input){\n  emitProgress(input,'context')\n  context.decisionIntelligence=buildDecisionIntelligence(context)\n  emitProgress(input,'products')\n  context.productIntelligence=buildValueBridge(context,effectiveMessage)\n",
'etapas determinísticas')
bootstrap=replaceOnce(bootstrap,
"  ValEngine.prototype.answer=async function answerWithAutomaticOrchestration(input){\n    const originalMessage=String(input.message||'Prepare a próxima melhor ação.').trim()\n    const rawContext=await this.repository.getClientContext({\n",
"  ValEngine.prototype.answer=async function answerWithAutomaticOrchestration(input){\n    emitProgress(input,'received')\n    const originalMessage=String(input.message||'Prepare a próxima melhor ação.').trim()\n    emitProgress(input,'context')\n    const rawContext=await this.repository.getClientContext({\n",
'início do progresso')
bootstrap=replaceOnce(bootstrap,
"      const language=orchestration.route.useGenerativeAi\n        ?await enhanceDecisionLanguage({\n",
"      emitProgress(input,'language')\n      const language=orchestration.route.useGenerativeAi\n        ?await enhanceDecisionLanguage({\n",
'etapa de linguagem')
bootstrap=replaceOnce(bootstrap,
"      const model=language.used?`${language.model}+rules-v6`:'rules-v6-orchestrated'\n      const recommendationId=await this.repository.recordRecommendation({\n",
"      const model=language.used?`${language.model}+rules-v6`:'rules-v6-orchestrated'\n      emitProgress(input,'persist')\n      const recommendationId=await this.repository.recordRecommendation({\n",
'etapa de persistência')
bootstrap=replaceOnce(bootstrap,
"      return {\n        recommendationId,\n        engineMode:language.used?'hybrid':'rules',\n",
"      emitProgress(input,'complete')\n      return {\n        recommendationId,\n        engineMode:language.used?'hybrid':'rules',\n",
'conclusão do texto')
bootstrap=replaceOnce(bootstrap,
"    // Arquivos e imagens continuam no fluxo multimodal completo porque precisam ser lidos pelo provedor.\n    const result=await originalAnswer.call(this,input)\n",
"    // Arquivos e imagens continuam no fluxo multimodal completo porque precisam ser lidos pelo provedor.\n    emitProgress(input,'products')\n    emitProgress(input,'language')\n    const result=await originalAnswer.call(this,input)\n    emitProgress(input,'complete')\n",
'progresso multimodal')
write('server/conversion-bootstrap.js',bootstrap)

let server=read('server.js')
server=replaceOnce(server,
"import {ValEngine} from './server/val-engine.js'\n",
"import {ValEngine} from './server/val-engine.js'\nimport {createValProgressTracker,normalizeValProgressRequestId} from './server/val-progress.js'\n",
'import do progresso')
server=replaceOnce(server,
"const valEngine=new ValEngine({runtimeConfig:config,repository})\n",
"const valEngine=new ValEngine({runtimeConfig:config,repository})\nconst valProgress=createValProgressTracker()\n",
'instância do progresso')
server=replaceOnce(server,
"const requestIdentity=request=>String(request.socket.remoteAddress||'unknown')\n",
"const requestIdentity=request=>String(request.socket.remoteAddress||'unknown')\nconst progressOwnerKey=(identity,request)=>String(identity?.id||identity?.email||requestIdentity(request))\n",
'escopo do progresso')
server=replaceOnce(server,
"const protectedPath=url.pathname.startsWith('/api/grains/')||url.pathname.startsWith('/api/val/attachments')||url.pathname==='/api/val/chat'||",
"const protectedPath=url.pathname.startsWith('/api/grains/')||url.pathname.startsWith('/api/val/attachments')||url.pathname==='/api/val/progress'||url.pathname==='/api/val/chat'||",
'proteção da rota de progresso')
server=replaceOnce(server,
" if(url.pathname==='/api/val/attachments'&&request.method==='GET'){\n",
" if(url.pathname==='/api/val/progress'&&request.method==='GET'){\n  const requestId=normalizeValProgressRequestId(url.searchParams.get('requestId'))\n  if(!requestId)return json(response,400,{error:'Identificador de acompanhamento inválido.'})\n  const progress=valProgress.get({requestId,ownerId:progressOwnerKey(identity,request)})\n  if(!progress)return json(response,404,{error:'Acompanhamento não encontrado ou já encerrado.'})\n  return json(response,200,progress)\n }\n if(url.pathname==='/api/val/attachments'&&request.method==='GET'){\n",
'rota GET de progresso')
const oldChat=` if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&request.method==='POST'){
  const rateIdentity=identity?.id||identity?.email||requestIdentity(request)
  if(!consumeRateLimit('val',rateIdentity,config.aiRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de análises atingido. Aguarde alguns minutos.'})
  const payload=await body(request);const attachmentIds=[...new Set((Array.isArray(payload.attachmentIds)?payload.attachmentIds:[]).map(attachmentId).filter(Boolean))].slice(0,3);const message=String(payload.message||payload.question||(attachmentIds.length?'Leia os arquivos que enviei e me diga o que importa.':'Prepare a próxima melhor ação.')).trim().slice(0,3000)
  const clientId=clean(payload.clientId||payload.client?.id)
  if(!clientId)return json(response,400,{error:'Selecione um cliente para ativar o contexto da VAL.'})
  const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
  const result=await valEngine.answer({tenantId:config.defaultTenantId,ownerId:identity?.id,clientId,client:payload.client||{},message,attachmentIds,mode:clean(payload.mode)||'daily',requestedStage:clean(payload.requestedStage),signal:controller.signal})
  await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:clean(payload.mode)||'daily',engineMode:result.engineMode,attachments:attachmentIds.length}})
  return json(response,200,result)
 }
`
const newChat=` if((url.pathname==='/api/val/chat'||url.pathname==='/api/val/recommendations')&&request.method==='POST'){
  const rateIdentity=identity?.id||identity?.email||requestIdentity(request)
  if(!consumeRateLimit('val',rateIdentity,config.aiRequestsPerTenMinutes))return json(response,429,{error:'Limite temporário de análises atingido. Aguarde alguns minutos.'})
  const payload=await body(request);const attachmentIds=[...new Set((Array.isArray(payload.attachmentIds)?payload.attachmentIds:[]).map(attachmentId).filter(Boolean))].slice(0,3);const message=String(payload.message||payload.question||(attachmentIds.length?'Leia os arquivos que enviei e me diga o que importa.':'Prepare a próxima melhor ação.')).trim().slice(0,3000)
  const clientId=clean(payload.clientId||payload.client?.id)
  if(!clientId)return json(response,400,{error:'Selecione um cliente para ativar o contexto da VAL.'})
  const requestId=normalizeValProgressRequestId(payload.requestId)||randomUUID()
  const ownerKey=progressOwnerKey(identity,request)
  const requestMode=clean(payload.mode)||'daily'
  valProgress.start({requestId,ownerId:ownerKey,clientId,mode:requestMode})
  const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
  try{
   const result=await valEngine.answer({tenantId:config.defaultTenantId,ownerId:identity?.id,clientId,client:payload.client||{},message,attachmentIds,mode:requestMode,requestedStage:clean(payload.requestedStage),signal:controller.signal,onProgress:stage=>valProgress.update({requestId,ownerId:ownerKey,stage})})
   valProgress.complete({requestId,ownerId:ownerKey})
   await accessRepository.recordUsage(identity,{eventType:'val_analysis',page:'val',entityType:'client',entityId:clientId,metadata:{mode:requestMode,engineMode:result.engineMode,attachments:attachmentIds.length}})
   return json(response,200,{...result,requestId})
  }catch(error){valProgress.fail({requestId,ownerId:ownerKey});throw error}
 }
`
server=replaceOnce(server,oldChat,newChat,'rota POST do chat')
write('server.js',server)

let workspace=read('src/components/ValDecisionWorkspace.jsx')
workspace=replaceOnce(workspace,
"import ValPanel from './ValPanel'\nimport '../val-decision-center.css'\n",
"import ValPanel from './ValPanel'\nimport ValProgressFeedback from './ValProgressFeedback'\nimport {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'\nimport '../val-decision-center.css'\n",
'imports do progresso no centro')
workspace=replaceOnce(workspace,
" const [error,setError]=useState('')\n const [expertOpen,setExpertOpen]=useState(false)\n",
" const [error,setError]=useState('')\n const [progress,setProgress]=useState(()=>initialValProgress())\n const [expertOpen,setExpertOpen]=useState(false)\n",
'estado do progresso no centro')
workspace=replaceOnce(workspace,
"  setResponse(null);setError('');setMessage('');setRequestedStage(null);setFeedback({sending:false,sent:false,error:''})\n",
"  setResponse(null);setError('');setMessage('');setRequestedStage(null);setProgress(initialValProgress());setFeedback({sending:false,sent:false,error:''})\n",
'reset do progresso no centro')
workspace=replaceOnce(workspace,
"  const controller=new AbortController();requestRef.current=controller\n  setLoading(true);setError('');setFeedback({sending:false,sent:false,error:''})\n  try{\n",
"  const controller=new AbortController();requestRef.current=controller\n  const requestId=createValProgressRequestId()\n  setLoading(true);setError('');setProgress(initialValProgress());setFeedback({sending:false,sent:false,error:''})\n  const stopProgress=mode==='strategic'?startValProgressPolling({requestId,onProgress:setProgress,signal:controller.signal}):()=>{}\n  try{\n",
'início do polling no centro')
workspace=replaceOnce(workspace,
"    body:JSON.stringify({clientId:client.id,client,message:question,mode,requestedStage}),signal\n",
"    body:JSON.stringify({clientId:client.id,client,message:question,mode,requestedStage,requestId}),signal\n",
'requestId no centro')
workspace=replaceOnce(workspace,
"   setResponse(payload);setMessage('')\n  }catch(requestError){if(requestError.name!=='AbortError')setError(requestError.name==='TimeoutError'?'A análise ultrapassou o limite. Tente novamente.':requestError.message)}finally{if(requestRef.current===controller){requestRef.current=null;setLoading(false)}}\n",
"   setResponse(payload);setMessage('');setProgress({stage:'complete',label:'Recomendação pronta',order:5,total:5,done:true,failed:false})\n  }catch(requestError){if(requestError.name!=='AbortError'){setProgress({stage:'failed',label:'Não foi possível concluir',order:6,total:5,done:true,failed:true});setError(requestError.name==='TimeoutError'?'A análise ultrapassou o limite. Tente novamente.':requestError.message)}}finally{stopProgress();if(requestRef.current===controller){requestRef.current=null;setLoading(false)}}\n",
'fim do polling no centro')
workspace=replaceOnce(workspace,
"    <button type=\"submit\" disabled={!message.trim()||loading}>{loading?<LoaderCircle className=\"is-spinning\"/>:<ArrowRight/>}<span>{loading?'Cruzando dados':'Analisar'}</span></button>\n   </form>\n   {(error||response?.warning)&&",
"    <button type=\"submit\" disabled={!message.trim()||loading}>{loading?<LoaderCircle className=\"is-spinning\"/>:<ArrowRight/>}<span>{loading?(mode==='strategic'?progress.label:'Cruzando dados'):'Analisar'}</span></button>\n   </form>\n   {loading&&mode==='strategic'&&<ValProgressFeedback progress={progress}/>}\n   {(error||response?.warning)&&",
'feedback visual no centro')
write('src/components/ValDecisionWorkspace.jsx',workspace)

let panel=read('src/components/ValPanel.jsx')
panel=replaceOnce(panel,
"import {adjacentConsultativeStage,createSequenceControl,transitionSequenceControl,VAL_CONSULTATIVE_SEQUENCE} from '../lib/val-sequence-control'\n",
"import {adjacentConsultativeStage,createSequenceControl,transitionSequenceControl,VAL_CONSULTATIVE_SEQUENCE} from '../lib/val-sequence-control'\nimport {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'\nimport ValProgressFeedback from './ValProgressFeedback'\n",
'imports do progresso no painel')
panel=replaceOnce(panel,
" const [loading,setLoading]=useState(false)\n const [error,setError]=useState('')\n",
" const [loading,setLoading]=useState(false)\n const [error,setError]=useState('')\n const [progress,setProgress]=useState(()=>initialValProgress())\n",
'estado do progresso no painel')
panel=replaceOnce(panel,
"  setLoading(false);setResponse(null);setActiveMethod('spin');setSequenceControl(createSequenceControl());setError('');setMessage('');setAttachments([]);setSavedAttachments([]);setAttachmentMenu(false)\n",
"  setLoading(false);setResponse(null);setActiveMethod('spin');setSequenceControl(createSequenceControl());setError('');setProgress(initialValProgress());setMessage('');setAttachments([]);setSavedAttachments([]);setAttachmentMenu(false)\n",
'reset do progresso no painel')
panel=replaceOnce(panel,
"  const requestClientId=client.id\n  setLoading(true)\n  setError('')\n  setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})\n  try{\n",
"  const requestClientId=client.id\n  const requestId=createValProgressRequestId()\n  setLoading(true)\n  setError('')\n  setProgress(initialValProgress())\n  setFeedback({rating:null,outcome:'',notes:'',sending:false,sent:false,error:''})\n  const stopProgress=requestedMode==='strategic'?startValProgressPolling({requestId,onProgress:setProgress,signal:controller.signal}):()=>{}\n  try{\n",
'início do polling no painel')
panel=replaceOnce(panel,
"    body:JSON.stringify({clientId:client.id,client,message:prompt,attachmentIds,mode:requestedMode,...(workingSequenceStage?{requestedStage:workingSequenceStage}:{})}),\n",
"    body:JSON.stringify({clientId:client.id,client,message:prompt,attachmentIds,mode:requestedMode,requestId,...(workingSequenceStage?{requestedStage:workingSequenceStage}:{})}),\n",
'requestId no painel')
panel=replaceOnce(panel,
"   setResponse(payload)\n   setMessage('')\n",
"   setResponse(payload)\n   setProgress({stage:'complete',label:'Recomendação pronta',order:5,total:5,done:true,failed:false})\n   setMessage('')\n",
'conclusão no painel')
panel=replaceOnce(panel,
"   setResponse(null)\n   setError(requestError.message+(attachmentIds.length?' Os arquivos continuam salvos com este produtor; tente novamente.':' Tente novamente em alguns instantes.'))\n  }finally{if(requestRef.current.sequence===sequence)setLoading(false)}\n",
"   setResponse(null)\n   setProgress({stage:'failed',label:'Não foi possível concluir',order:6,total:5,done:true,failed:true})\n   setError(requestError.message+(attachmentIds.length?' Os arquivos continuam salvos com este produtor; tente novamente.':' Tente novamente em alguns instantes.'))\n  }finally{stopProgress();if(requestRef.current.sequence===sequence)setLoading(false)}\n",
'fim do polling no painel')
panel=replaceOnce(panel,
"    <button type=\"submit\" disabled={(!message.trim()&&!attachments.length)||loading||attachmentState.uploading} aria-label=\"Enviar para a VAL\">{loading?<LoaderCircle className=\"val-spinner\" aria-hidden=\"true\"/>:<Send aria-hidden=\"true\"/>}<span>{loading?'Pensando':'Enviar'}</span></button>\n   </form>\n",
"    <button type=\"submit\" disabled={(!message.trim()&&!attachments.length)||loading||attachmentState.uploading} aria-label=\"Enviar para a VAL\">{loading?<LoaderCircle className=\"val-spinner\" aria-hidden=\"true\"/>:<Send aria-hidden=\"true\"/>}<span>{loading?(mode==='strategic'?progress.label:'Pensando'):'Enviar'}</span></button>\n   </form>\n   {loading&&mode==='strategic'&&<ValProgressFeedback progress={progress} compact/>}\n",
'feedback visual no painel')
panel=replaceOnce(panel,
"\t   {loading&&<div className=\"val-thinking\" role=\"status\"><span/><div><b>A VAL está procurando conexões que ainda não aparecem na tela.</b><small>Perfil, negócios, campo, histórico, oportunidades e opções de valor estão sendo cruzados.</small></div></div>}\n",
"\t   {loading&&mode!=='strategic'&&<div className=\"val-thinking\" role=\"status\"><span/><div><b>A VAL está procurando conexões que ainda não aparecem na tela.</b><small>Perfil, negócios, campo, histórico, oportunidades e opções de valor estão sendo cruzados.</small></div></div>}\n",
'remoção do spinner genérico estratégico')
write('src/components/ValPanel.jsx',panel)

let docs=read('docs/VAL_ENGINE.md')
docs=replaceOnce(docs,
"### Feedback\n\n`POST /api/val/feedback`\n",
"### Progresso de uma análise\n\n`GET /api/val/progress?requestId=<uuid>`\n\nAs telas geram um UUID por chamada e consultam esta rota somente enquanto a análise está ativa. O registro é temporário, fica em memória, expira em cinco minutos e é isolado pelo usuário autenticado. A rota nunca expõe mensagem, produto, preço, dado do produtor ou conteúdo do modelo; devolve apenas a etapa operacional.\n\nNo modo estratégico, a interface apresenta a sequência real: **Cruzando histórico e sinais** → **Comparando alternativas de produto** → **Redigindo a recomendação** → **Salvando a recomendação**. Saltos são permitidos quando a IA não é necessária; regressões de etapa são bloqueadas.\n\n### Feedback\n\n`POST /api/val/feedback`\n",
'documentação do progresso')
write('docs/VAL_ENGINE.md',docs)

write('test/val-progress.test.js',`import assert from 'node:assert/strict'
import test from 'node:test'
import {createValProgressTracker,normalizeValProgressRequestId} from '../server/val-progress.js'

const requestId='9c5d8e42-05d8-4d29-bc71-8d6767cf1c49'

test('progresso é monotônico, temporário e isolado por usuário',()=>{
  let now=1_000
  const tracker=createValProgressTracker({ttlMs:1_000,clock:()=>now})
  tracker.start({requestId,ownerId:'consultor-a',clientId:'produtor-1',mode:'strategic'})
  assert.equal(tracker.get({requestId,ownerId:'consultor-b'}),null)
  assert.equal(tracker.update({requestId,ownerId:'consultor-a',stage:'context'}).label,'Cruzando histórico e sinais')
  assert.equal(tracker.update({requestId,ownerId:'consultor-a',stage:'products'}).order,2)
  assert.equal(tracker.update({requestId,ownerId:'consultor-a',stage:'context'}).stage,'products')
  assert.equal(tracker.complete({requestId,ownerId:'consultor-a'}).done,true)
  now=2_001
  assert.equal(tracker.get({requestId,ownerId:'consultor-a'}),null)
})

test('identificador de progresso aceita somente UUID válido',()=>{
  assert.equal(normalizeValProgressRequestId(requestId),requestId)
  assert.equal(normalizeValProgressRequestId('../outro-usuario'),'')
})
`)

write('test/val-progress-contract.test.js',`import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const bootstrap=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
const center=readFileSync(new URL('../src/components/ValDecisionWorkspace.jsx',import.meta.url),'utf8')
const panel=readFileSync(new URL('../src/components/ValPanel.jsx',import.meta.url),'utf8')
const feedback=readFileSync(new URL('../src/components/ValProgressFeedback.jsx',import.meta.url),'utf8')

test('backend expõe progresso protegido sem conteúdo sensível',()=>{
  assert.match(server,/url\.pathname==='\/api\/val\/progress'/)
  assert.match(server,/progressOwnerKey\(identity,request\)/)
  assert.match(server,/onProgress:stage=>valProgress\.update/)
  assert.match(server,/valProgress\.fail/)
  assert.doesNotMatch(readFileSync(new URL('../server/val-progress.js',import.meta.url),'utf8'),/message|price|dose|prompt/i)
})

test('motor sinaliza as etapas calculadas antes da resposta final',()=>{
  for(const stage of ['context','products','language','persist','complete'])assert.match(bootstrap,new RegExp(`emitProgress\\(input,'${stage}'\\)`))
})

test('as duas interfaces acompanham a mesma requisição estratégica',()=>{
  for(const source of [center,panel]){
    assert.match(source,/createValProgressRequestId/)
    assert.match(source,/startValProgressPolling/)
    assert.match(source,/requestId/)
    assert.match(source,/ValProgressFeedback/)
  }
  assert.match(feedback,/Cruzando histórico e sinais/)
  assert.match(feedback,/Comparando alternativas de produto/)
  assert.match(feedback,/Redigindo a recomendação/)
})
`)

const temporary=['scripts/apply-b2.mjs','.github/workflows/apply-b2.yml']
for(const path of temporary)if(existsSync(path))unlinkSync(path)
console.log('B2 aplicado com sucesso.')
