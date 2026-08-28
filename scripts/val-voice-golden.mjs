import {runVoiceConversationGoldenSet} from './lib/val-voice-golden-v1.mjs'

const result=await runVoiceConversationGoldenSet()
process.stdout.write(`${JSON.stringify(result,null,2)}\n`)
if(result.status!=='PASS_AUTOMATED_CONTRACT')process.exitCode=1
