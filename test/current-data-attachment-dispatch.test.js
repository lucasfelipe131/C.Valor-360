import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const serverSource=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const dispatchStart=serverSource.indexOf('const clientCapability=routeSystemCapability')
const dispatchEnd=serverSource.indexOf("clientCapability.capabilities.includes('VISIT_HISTORY')",dispatchStart)
const currentDataDispatch=serverSource.slice(dispatchStart,dispatchEnd)

test('dispatch de dado atual — anexo não desativa mercado nem autoriza clima ou bula/rótulo',()=>{
 assert.ok(dispatchStart>=0,'dispatch do Capability Router ausente no endpoint da VAL')
 assert.ok(dispatchEnd>dispatchStart,'limite do dispatch de dado atual ausente')

 const market=routeSystemCapability({
  message:'Como o preço da soja de hoje muda a negociação deste produtor?',
  intentHint:'ASK_COMMODITY',
  hasClient:true,
  attachmentTypes:['application/pdf']
 })
 assert.ok(market.capabilities.includes('MARKET_COMMODITY'))
 assert.equal(market.current_data_required,true)

 for(const [intent,capability] of [['CHECK_WEATHER','WEATHER'],['CHECK_LABEL','LABELS']]){
  const route=routeSystemCapability({message:'Consulte a fonte atual.',intentHint:intent,hasClient:true,attachmentTypes:['application/pdf']})
  assert.ok(route.capabilities.includes(capability),intent)
  assert.equal(route.current_data_required,true,intent)
 }

 assert.match(currentDataDispatch,/if\(clientCapability\.current_data_required&&clientCapability\.capabilities\.some\(capability=>\['WEATHER','LABELS'\]\.includes\(capability\)\)\)/)
 assert.match(currentDataDispatch,/code:'val_current_source_unavailable'/)
 assert.match(currentDataDispatch,/if\(clientCapability\.capabilities\.includes\('MARKET_COMMODITY'\)\)/)
 assert.doesNotMatch(currentDataDispatch,/if\(!attachmentIds\.length&&clientCapability\.(?:current_data_required|capabilities\.includes\('MARKET_COMMODITY'\))/)
})
