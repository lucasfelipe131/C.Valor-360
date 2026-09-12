import test from 'node:test'
import assert from 'node:assert/strict'
import {recordSaveOutcome} from '../manual/app/lib/record-save-result.ts'

test('fechamento salvo com envio pendente continua salvo e permite nova sincronização',()=>{
 const record={id:'saved-report'}
 for(const integration of [{configured:false,skipped:2},{configured:true,failed:1,delivered:1},{configured:true,skipped:1},undefined]){
  const result=recordSaveOutcome({record,integration})
  assert.equal(result.pending,true)
  assert.match(result.message,/salvo no histórico/i)
  assert.doesNotMatch(result.message,/e sincronizado/)
 }
 const retry=recordSaveOutcome({record,integration:{configured:true,delivered:2,failed:0,skipped:0}})
 assert.equal(retry.pending,false)
 assert.match(retry.message,/sincronizado com a VAL/)
})

test('salvamento não confirmado não anuncia sucesso; conta e demonstração são explícitas',()=>{
 assert.throws(()=>recordSaveOutcome({integration:{delivered:2}}),/não confirmou/)
 assert.match(recordSaveOutcome({record:{id:'r'},integration:{blockedCode:'valor360_workspace_owner_not_authenticated',skipped:1}}).message,/Entre novamente/)
 const demo=recordSaveOutcome({record:{id:'r'},integration:{configured:false,demoIsolated:true}})
 assert.equal(demo.pending,false)
 assert.match(demo.message,/demonstrativo/)
 assert.doesNotMatch(demo.message,/sincronizado/)
})
