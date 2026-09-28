import test from 'node:test'
import assert from 'node:assert/strict'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// Offline reproduction, not recovered provider text from the live K5 run.
const question='O vigor das sementes importa mesmo quando o teste de germinação é alto?'
const explanation='O vigor das sementes importa mesmo quando a germinação é alta, pois indica capacidade de emergência sob condições adversas.'
async function respond(answer){
 const requests=[]
 const result=await buildGeneralNoClientResponse({message:question,route:routeSystemCapability({message:question,hasClient:false}),organizationId:'test',ownerId:'test',aiModel:'offline-fixture',aiClient:{responses:{create:async input=>{requests.push(input);return {status:'completed',output_text:answer}}}}})
 return {result,requests}
}
test('self-contained general proposition is delivered without weakening claim validation',async()=>{
 const {result,requests}=await respond(explanation)
 assert.equal(result.advice.answer,explanation)
 assert.equal(requests.length,1)
 assert.equal(result.responseMetadata.decisionTrace.GENERAL_VALIDATION_REASON,'ACCEPTED')
})
test('isolated polar fragments remain fail-closed when the model ignores complete-sentence guidance',async()=>{
 for(const answer of ['Sim. '+explanation,'Não. '+explanation]){
  const {result,requests}=await respond(answer)
  assert.equal(requests.length,2)
  assert.notEqual(result.advice.answer,answer)
  assert.equal(result.responseMetadata.decisionTrace.GROUNDING_BLOCK_REASON,'UNSUPPORTED_CLAIM')
 }
})
test('complete sentences do not admit a private or regulated tail',async()=>{
 for(const tail of [' João possui 500 hectares.',' Aplique 2 L/ha.',' Premier controla pragas no milho.']){
  const {result}=await respond(explanation+tail)
  assert.notEqual(result.advice.answer,explanation+tail)
  assert.notEqual(result.responseMetadata.decisionTrace.FALLBACK_ORIGIN,'NONE')
 }
})
