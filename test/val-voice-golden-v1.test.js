import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {runVoiceConversationGoldenSet,voiceConversationGoldenVersion} from '../scripts/lib/val-voice-golden-v1.mjs'

test('VOICE_CONVERSATION_GOLDEN_001 e 002 passam o contrato automatizado determinístico',async()=>{
 const result=await runVoiceConversationGoldenSet()
 assert.equal(result.contract_version,voiceConversationGoldenVersion)
 assert.equal(result.status,'PASS_AUTOMATED_CONTRACT')
 assert.equal(result.physical_uat,'NOT_EXECUTED')
 assert.deepEqual(result.scenarios.map(item=>item.id),['VOICE_CONVERSATION_GOLDEN_001','VOICE_CONVERSATION_GOLDEN_002'])
 for(const scenario of result.scenarios){
  assert.equal(scenario.status,'PASS_AUTOMATED_CONTRACT',`${scenario.id}: ${JSON.stringify(scenario.checks.filter(item=>item.status!=='PASS'))}`)
  assert.equal(scenario.physical_uat,'NOT_EXECUTED')
  assert.ok(scenario.checks.length>=10)
  assert.equal(scenario.checks.every(item=>item.status==='PASS'),true)
 }
})

test('Golden Voice documenta explicitamente o limite entre automação e UAT real',()=>{
 const document=readFileSync(new URL('../VAL_VOICE_GOLDEN_SET_v1.md',import.meta.url),'utf8')
 assert.match(document,/PASS_AUTOMATED_CONTRACT/)
 assert.match(document,/NOT_EXECUTED_PHYSICAL_UAT/)
 assert.match(document,/não substitui UAT físico\/humano/i)
 assert.match(document,/microfone real/i)
 assert.match(document,/câmera real/i)
})
