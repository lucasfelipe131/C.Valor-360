import assert from 'node:assert/strict'
import test from 'node:test'
import {CoreExecutionError,executeModulePlan} from '../server/core/executor.js'

test('executor síncrono respeita a ordem declarada e registra cada módulo',async()=>{
  const order=[]
  const result=await executeModulePlan({
    plan:[{module_id:'A',required:true},{module_id:'B',required:true}],
    registry:{A:async()=>{order.push('A');return 1},B:async()=>{order.push('B');return 2}},
    input:{},observeFn:()=>{}
  })
  assert.deepEqual(order,['A','B'])
  assert.deepEqual(result.results,{A:1,B:2})
  assert.deepEqual(result.module_runs.map(run=>run.status),['completed','completed'])
  assert.equal(result.degraded,false)
})

test('módulo opcional indisponível degrada com segurança sem bloquear o obrigatório',async()=>{
  const result=await executeModulePlan({plan:[{module_id:'FUTURE',required:false},{module_id:'LEGACY',required:true}],registry:{LEGACY:()=>({ok:true})},input:{},observeFn:()=>{}})
  assert.equal(result.degraded,true)
  assert.equal(result.module_runs[0].status,'unavailable')
  assert.deepEqual(result.results.LEGACY,{ok:true})
})

test('módulo obrigatório ausente falha fechado e erro de domínio da engine é preservado',async()=>{
  await assert.rejects(()=>executeModulePlan({plan:[{module_id:'MISSING',required:true}],registry:{},observeFn:()=>{}}),error=>error instanceof CoreExecutionError&&error.code==='required_module_unavailable')
  const domainError=Object.assign(new Error('Registro não encontrado.'),{statusCode:404,code:'not_found'})
  await assert.rejects(()=>executeModulePlan({plan:[{module_id:'LEGACY',required:true}],registry:{LEGACY:()=>{throw domainError}},observeFn:()=>{}}),error=>error===domainError)
})

test('deadline aborta o signal do módulo antes de devolver erro controlado',async()=>{
  const order=[]
  let effectiveSignal=null
  await assert.rejects(
    ()=>executeModulePlan({
      plan:[{module_id:'LEGACY',required:true,timeout_ms:5}],
      registry:{LEGACY:(_input,{signal})=>{effectiveSignal=signal;signal.addEventListener('abort',()=>order.push('abort'),{once:true});return new Promise(()=>{})}},
      observeFn:()=>{}
    }),
    error=>{
      order.push('reject')
      assert.ok(error instanceof CoreExecutionError)
      assert.equal(error.code,'core_module_timeout')
      assert.equal(error.statusCode,504)
      assert.equal(effectiveSignal.aborted,true)
      assert.equal(effectiveSignal.reason,error)
      assert.deepEqual(order,['abort','reject'])
      return true
    }
  )
})

test('signal pai é encadeado ao AbortController específico do módulo',async()=>{
  const parent=new AbortController()
  const reason=new Error('cliente desconectado')
  let effectiveSignal=null
  let notifyStarted
  const started=new Promise(resolve=>{notifyStarted=resolve})
  const execution=executeModulePlan({
    plan:[{module_id:'LEGACY',required:true,timeout_ms:1_000}],
    registry:{LEGACY:(_input,{signal})=>new Promise(resolve=>{effectiveSignal=signal;notifyStarted();signal.addEventListener('abort',()=>resolve('aborted'),{once:true})})},
    signal:parent.signal,
    observeFn:()=>{}
  })
  await started
  assert.notEqual(effectiveSignal,parent.signal)
  parent.abort(reason)
  await assert.rejects(execution,error=>error===reason)
  assert.equal(effectiveSignal.aborted,true)
  assert.equal(effectiveSignal.reason,reason)
})

test('signal pai já cancelado impede invocar o handler',async()=>{
  const parent=new AbortController()
  const reason=Object.assign(new Error('deadline anterior'),{code:'core_module_timeout',statusCode:504})
  parent.abort(reason)
  let handlerCalls=0
  await assert.rejects(
    ()=>executeModulePlan({
      plan:[{module_id:'LEGACY',required:true,timeout_ms:1_000}],
      registry:{LEGACY:()=>{handlerCalls++;return 'não deveria executar'}},
      signal:parent.signal,
      observeFn:()=>{}
    }),
    error=>error===reason
  )
  assert.equal(handlerCalls,0)
})

test('cancelamento pai rejeita mesmo quando o handler ignora o signal',async()=>{
  const parent=new AbortController()
  const reason=Object.assign(new Error('cliente encerrou'),{code:'val_request_cancelled',statusCode:499})
  let notifyStarted
  const started=new Promise(resolve=>{notifyStarted=resolve})
  const execution=executeModulePlan({
    plan:[{module_id:'LEGACY',required:true,timeout_ms:1_000}],
    registry:{LEGACY:()=>{notifyStarted();return new Promise(()=>{})}},
    signal:parent.signal,
    observeFn:()=>{}
  })
  await started
  parent.abort(reason)
  await assert.rejects(execution,error=>error===reason)
})

test('cancelamento pai no último módulo opcional não pode virar resposta degradada',async()=>{
  const parent=new AbortController()
  const reason=Object.assign(new Error('cliente encerrou durante módulo opcional'),{code:'val_request_cancelled',statusCode:499})
  let notifyStarted
  const started=new Promise(resolve=>{notifyStarted=resolve})
  const execution=executeModulePlan({
    plan:[{module_id:'OPTIONAL',required:false,timeout_ms:1_000}],
    registry:{OPTIONAL:(_input,{signal})=>new Promise(resolve=>{
      notifyStarted()
      signal.addEventListener('abort',()=>resolve('cancelamento indevidamente absorvido'),{once:true})
    })},
    signal:parent.signal,
    observeFn:()=>{}
  })
  await started
  parent.abort(reason)
  await assert.rejects(execution,error=>error===reason)
})
