import {useCallback,useEffect,useRef,useState} from 'react'

export const DEFAULT_RESOURCE_TIMEOUT_MS=12_000
export const DEFAULT_RESOURCE_ERROR='Não foi possível concluir esta operação.'
export const DEFAULT_RESOURCE_TIMEOUT_ERROR='A operação demorou além do limite. Tente novamente.'

const errorWithName=(message,name)=>{const error=new Error(message);error.name=name;return error}
const isAbortError=error=>error?.name==='AbortError'
const isTimeoutError=error=>error?.name==='TimeoutError'

function dispatchUnauthorized(){
 if(typeof window!=='undefined')window.dispatchEvent(new Event('valor360:unauthorized'))
}

function createRequestController({signal,timeoutMs=DEFAULT_RESOURCE_TIMEOUT_MS}={}){
 const controller=new AbortController()
 let timedOut=false
 const abortFromParent=()=>controller.abort()
 if(signal){
  if(signal.aborted)controller.abort()
  else signal.addEventListener('abort',abortFromParent,{once:true})
 }
 const timer=Number(timeoutMs)>0?setTimeout(()=>{timedOut=true;controller.abort()},Number(timeoutMs)):null
 return {
  signal:controller.signal,
  abort:()=>controller.abort(),
  didTimeout:()=>timedOut,
  cleanup:()=>{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abortFromParent)}
 }
}

export function normalizeAsyncError(error,{timedOut=false,timeoutMessage=DEFAULT_RESOURCE_TIMEOUT_ERROR,fallbackMessage=DEFAULT_RESOURCE_ERROR}={}){
 if(timedOut||isTimeoutError(error))return timeoutMessage
 if(isAbortError(error))return ''
 return String(error?.message||fallbackMessage).trim()||fallbackMessage
}

export async function fetchJsonResource(url,{signal,fallbackMessage=DEFAULT_RESOURCE_ERROR,...options}={}){
 const response=await fetch(url,{...options,signal})
 if(response.status===401){dispatchUnauthorized();throw new Error('Sua sessão expirou.')}
 const payload=await response.json().catch(()=>({}))
 if(!response.ok)throw new Error(payload?.error||payload?.message||fallbackMessage)
 return payload
}

export async function requestJsonResource(url,{signal,timeoutMs=DEFAULT_RESOURCE_TIMEOUT_MS,timeoutMessage=DEFAULT_RESOURCE_TIMEOUT_ERROR,fallbackMessage=DEFAULT_RESOURCE_ERROR,...options}={}){
 const request=createRequestController({signal,timeoutMs})
 try{return await fetchJsonResource(url,{...options,signal:request.signal,fallbackMessage})}
 catch(error){
  if(request.didTimeout())throw errorWithName(timeoutMessage,'TimeoutError')
  throw error
 }finally{request.cleanup()}
}

export function useAsyncResource({
 initialData=null,
 initialLoading=false,
 timeoutMs=DEFAULT_RESOURCE_TIMEOUT_MS,
 timeoutMessage=DEFAULT_RESOURCE_TIMEOUT_ERROR,
 fallbackMessage=DEFAULT_RESOURCE_ERROR
}={}){
 const initialDataRef=useRef(initialData)
 const sequenceRef=useRef(0)
 const controllerRef=useRef(null)
 const mountedRef=useRef(true)
 const [state,setState]=useState(()=>({loading:Boolean(initialLoading),data:initialData,error:''}))

 const abortCurrent=useCallback(()=>{controllerRef.current?.abort();controllerRef.current=null},[])

 const run=useCallback(async(loader,{keepData=true,throwOnError=false,timeoutMs:runTimeoutMs,timeoutMessage:runTimeoutMessage,fallbackMessage:runFallbackMessage}={})=>{
  abortCurrent()
  const sequence=sequenceRef.current+1
  sequenceRef.current=sequence
  const request=createRequestController({timeoutMs:runTimeoutMs??timeoutMs})
  controllerRef.current=request
  if(mountedRef.current)setState(current=>({loading:true,data:keepData?current.data:initialDataRef.current,error:''}))
  try{
   const data=await loader({signal:request.signal})
   if(mountedRef.current&&sequenceRef.current===sequence)setState({loading:false,data,error:''})
   return data
  }catch(error){
   if(sequenceRef.current!==sequence)return undefined
   const message=normalizeAsyncError(error,{
    timedOut:request.didTimeout(),
    timeoutMessage:runTimeoutMessage||timeoutMessage,
    fallbackMessage:runFallbackMessage||fallbackMessage
   })
   if(mountedRef.current&&message)setState(current=>({loading:false,data:keepData?current.data:initialDataRef.current,error:message}))
   else if(mountedRef.current)setState(current=>({...current,loading:false}))
   if(throwOnError&&message)throw error
   return undefined
  }finally{
   request.cleanup()
   if(controllerRef.current===request)controllerRef.current=null
  }
 },[abortCurrent,fallbackMessage,timeoutMessage,timeoutMs])

 const cancel=useCallback(()=>{
  sequenceRef.current+=1
  abortCurrent()
  if(mountedRef.current)setState(current=>({...current,loading:false}))
 },[abortCurrent])

 const reset=useCallback((data=initialDataRef.current)=>{
  sequenceRef.current+=1
  abortCurrent()
  if(mountedRef.current)setState({loading:false,data,error:''})
 },[abortCurrent])

 const setData=useCallback(value=>setState(current=>({...current,data:typeof value==='function'?value(current.data):value})),[])
 const setError=useCallback(value=>setState(current=>({...current,error:String(typeof value==='function'?value(current.error):value||'')})),[])
 const clearError=useCallback(()=>setState(current=>({...current,error:''})),[])

 useEffect(()=>()=>{mountedRef.current=false;sequenceRef.current+=1;abortCurrent()},[abortCurrent])

 return {state,loading:state.loading,data:state.data,error:state.error,run,cancel,reset,setData,setError,clearError}
}
