export const VOICE_INTERACTIONS_PATH='/api/v1/voice-interactions'

const cleanObject=value=>Object.fromEntries(Object.entries(value||{}).filter(([,item])=>item!==undefined))

function controlledSignal(signal,timeoutMs){
 const controller=new AbortController()
 const timeout=globalThis.setTimeout(()=>controller.abort(Object.assign(new Error('Tempo limite excedido.'),{name:'TimeoutError'})),timeoutMs)
 const abort=()=>controller.abort(signal?.reason)
 if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})}
 return {signal:controller.signal,cleanup:()=>{globalThis.clearTimeout(timeout);signal?.removeEventListener?.('abort',abort)}}
}

async function requestJson(path,{method='GET',body,signal,timeoutMs=30_000}={}){
 const controlled=controlledSignal(signal,timeoutMs)
 try{
  const response=await fetch(path,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controlled.signal})
  const payload=response.status===204?{}:await response.json().catch(()=>({}))
  if(response.status===401&&globalThis.window?.dispatchEvent)window.dispatchEvent(new Event('valor360:unauthorized'))
  if(!response.ok){const serverError=payload.error;const message=typeof serverError==='string'?serverError:serverError?.message||payload.message||'A operação de voz não pôde ser concluída.';const error=Object.assign(new Error(message),{status:response.status,code:payload.code||payload.error_code||serverError?.code||'',safeToRetry:Boolean(payload.safe_to_retry??serverError?.safe_to_retry??response.status>=500),payload});throw error}
  return payload
 }catch(error){
  if(error?.name==='AbortError'&&controlled.signal.reason?.name==='TimeoutError')throw controlled.signal.reason
  throw error
 }finally{controlled.cleanup()}
}

function dataUrl(blob,{signal}={}){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader()
  const abort=()=>{try{reader.abort()}catch{};reject(signal?.reason||Object.assign(new Error('Envio cancelado.'),{name:'AbortError'}))}
  if(signal?.aborted){abort();return}
  signal?.addEventListener?.('abort',abort,{once:true})
  reader.onload=()=>{signal?.removeEventListener?.('abort',abort);resolve(String(reader.result||''))}
  reader.onerror=()=>{signal?.removeEventListener?.('abort',abort);reject(new Error('Não foi possível ler o áudio.'))}
  reader.onabort=()=>signal?.removeEventListener?.('abort',abort)
  reader.readAsDataURL(blob)
 })
}

const resource=id=>`${VOICE_INTERACTIONS_PATH}/${encodeURIComponent(String(id||''))}`

export function createVoiceInteraction({clientId,visitId,interactionType,sourceContext,manualText,signal}={}){
 return requestJson(VOICE_INTERACTIONS_PATH,{method:'POST',signal,body:cleanObject({client_id:clientId,visit_id:visitId||undefined,interaction_type:interactionType,source_context:sourceContext&&typeof sourceContext==='object'?sourceContext:{},manual_text:manualText?.trim()||undefined})})
}

export async function uploadVoiceAudio(id,{blob,originalName,mimeType,durationSeconds,signal}={}){
 if(!blob)throw new Error('Nenhum áudio foi preparado para envio.')
 const encoded=await dataUrl(blob,{signal})
 const normalizedMimeType=String(mimeType||blob.type||'audio/webm').split(';',1)[0].trim().toLowerCase()
 return requestJson(`${resource(id)}/audio`,{method:'POST',signal,timeoutMs:90_000,body:{original_name:originalName||'audio-val.webm',mime_type:normalizedMimeType,data_url:encoded,duration_seconds:Number(durationSeconds)||0}})
}

export function processVoiceInteraction(id,{signal}={}){
 return requestJson(`${resource(id)}/process`,{method:'POST',signal,timeoutMs:120_000,body:{}})
}

export function getVoiceInteraction(id,{signal}={}){
 return requestJson(resource(id),{signal,timeoutMs:30_000})
}

export function confirmVoiceInteraction(id,{items=[],additions=[],outcomeType,nextStep,nextStepAt,noAction,signal}={}){
 return requestJson(`${resource(id)}/confirm`,{method:'POST',signal,timeoutMs:60_000,body:cleanObject({items,additions,outcome_type:outcomeType||undefined,next_step:nextStep?.trim()||undefined,next_step_at:nextStepAt||undefined,no_action:noAction===undefined?undefined:Boolean(noAction)})})
}

export function cancelVoiceInteraction(id,{signal}={}){
 return requestJson(`${resource(id)}/cancel`,{method:'POST',signal,timeoutMs:15_000,body:{}})
}
