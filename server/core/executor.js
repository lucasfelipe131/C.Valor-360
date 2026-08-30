import {observe} from '../observability.js'

export const coreExecutorVersion='val.core.executor.v1'

export class CoreExecutionError extends Error{
  constructor(message,code='core_execution_failed',statusCode=503){
    super(message)
    this.name='CoreExecutionError'
    this.code=code
    this.statusCode=statusCode
  }
}

const registryHandler=(registry,moduleId)=>registry instanceof Map?registry.get(moduleId):registry?.[moduleId]

function moduleAbortController(parentSignal){
  const controller=new AbortController()
  if(parentSignal?.aborted){controller.abort(parentSignal.reason);return {controller,cleanup:()=>{}}}
  if(typeof parentSignal?.addEventListener!=='function')return {controller,cleanup:()=>{}}
  const onAbort=()=>controller.abort(parentSignal.reason)
  parentSignal.addEventListener('abort',onAbort,{once:true})
  return {controller,cleanup:()=>parentSignal.removeEventListener('abort',onAbort)}
}

const cancellationError=signal=>signal?.reason instanceof Error?signal.reason:new CoreExecutionError('A execução do módulo foi cancelada.','core_module_cancelled',499)
const throwIfCancelled=signal=>{if(signal?.aborted)throw cancellationError(signal)}

async function executeWithDeadline({handler,input,timeoutMs,moduleId,parentSignal}){
  const {controller,cleanup}=moduleAbortController(parentSignal)
  throwIfCancelled(controller.signal)
  let onAbort
  const cancelled=new Promise((resolve,reject)=>{
    onAbort=()=>reject(cancellationError(controller.signal))
    controller.signal.addEventListener('abort',onAbort,{once:true})
  })
  const work=Promise.resolve().then(async()=>{
    throwIfCancelled(controller.signal)
    const value=await handler(input,{signal:controller.signal})
    throwIfCancelled(controller.signal)
    return value
  })
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0){
    try{return await Promise.race([work,cancelled])}finally{controller.signal.removeEventListener('abort',onAbort);cleanup()}
  }
  let timer
  const timeoutError=new CoreExecutionError(`O módulo obrigatório ${moduleId} excedeu o limite de execução.`,'core_module_timeout',504)
  const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort(timeoutError);reject(timeoutError)},timeoutMs)})
  try{return await Promise.race([work,timeout,cancelled])}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);cleanup()}
}

export async function executeModulePlan({plan,registry,input,signal,observeFn=observe}={}){
  throwIfCancelled(signal)
  const moduleRuns=[]
  const results={}
  let degraded=false
  for(const step of plan||[]){
    throwIfCancelled(signal)
    const moduleId=String(step?.module_id||'')
    const required=step?.required===true
    const handler=registryHandler(registry,moduleId)
    const started=Date.now()
    if(typeof handler!=='function'){
      const run={module_id:moduleId,status:'unavailable',required,duration_ms:0,error_code:'module_not_registered'}
      moduleRuns.push(run)
      observeFn('core.module.unavailable',{moduleId,required,outcome:required?'error':'degraded'})
      if(required)throw new CoreExecutionError(`O módulo obrigatório ${moduleId} não está disponível.`,'required_module_unavailable')
      degraded=true
      continue
    }
    observeFn('core.module.started',{moduleId,required})
    try{
      results[moduleId]=await executeWithDeadline({handler,input,timeoutMs:Number(step.timeout_ms),moduleId,parentSignal:signal})
      const durationMs=Date.now()-started
      moduleRuns.push({module_id:moduleId,status:'completed',required,duration_ms:durationMs})
      observeFn('core.module.completed',{moduleId,required,durationMs,outcome:'ok'})
    }catch(error){
      const durationMs=Date.now()-started
      moduleRuns.push({module_id:moduleId,status:'failed',required,duration_ms:durationMs,error_code:String(error?.code||'module_failed').slice(0,80)})
      observeFn('core.module.failed',{moduleId,required,durationMs,outcome:'error',errorCode:String(error?.code||'module_failed')})
      throwIfCancelled(signal)
      if(required)throw error
      degraded=true
    }
  }
  throwIfCancelled(signal)
  return {results,module_runs:moduleRuns,degraded}
}
