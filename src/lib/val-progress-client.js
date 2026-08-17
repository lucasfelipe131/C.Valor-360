export const VAL_PROGRESS_STEPS=Object.freeze([
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
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)
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
