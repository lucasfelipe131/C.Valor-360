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

function withTimeout(work,timeoutMs,moduleId){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)return work
  let timer
  const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new CoreExecutionError(`O módulo obrigatório ${moduleId} excedeu o limite de execução.`,'core_module_timeout',504)),timeoutMs)})
  return Promise.race([work,timeout]).finally(()=>clearTimeout(timer))
}

export async function executeModulePlan({plan,registry,input,observeFn=observe}={}){
  const moduleRuns=[]
  const results={}
  let degraded=false
  for(const step of plan||[]){
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
      results[moduleId]=await withTimeout(Promise.resolve().then(()=>handler(input)),Number(step.timeout_ms),moduleId)
      const durationMs=Date.now()-started
      moduleRuns.push({module_id:moduleId,status:'completed',required,duration_ms:durationMs})
      observeFn('core.module.completed',{moduleId,required,durationMs,outcome:'ok'})
    }catch(error){
      const durationMs=Date.now()-started
      moduleRuns.push({module_id:moduleId,status:'failed',required,duration_ms:durationMs,error_code:String(error?.code||'module_failed').slice(0,80)})
      observeFn('core.module.failed',{moduleId,required,durationMs,outcome:'error',errorCode:String(error?.code||'module_failed')})
      if(required)throw error
      degraded=true
    }
  }
  return {results,module_runs:moduleRuns,degraded}
}
