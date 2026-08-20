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
