import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {executeCapabilityPlan,validateActiveContext} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const context={
 client:{id:'client-a',name:'Produtor A'},
 opportunities:[{id:'opp-a',title:'Oportunidade A'}],
 visits:[{id:'visit-a',objective:'Revisar proposta'}],
 properties:[{id:'property-a',name:'Fazenda A',fields:[{id:'field-a',name:'Talhão Norte',geometry_ref:'map-1'}]}],
 soilAnalyses:[{id:'soil-a',laboratory:'Laboratório A',measurements:[{id:'m-1'}]}],
 contextSnapshot:{context_snapshot_id:'snapshot-a'}
}

test('contexto ativo é vinculado ao objeto autorizado, não apenas à label da UI',async()=>{
 for(const activeContext of [
  {type:'opportunity',id:'opp-a',label:'label manipulável'},
  {type:'visit',id:'visit-a'},
  {type:'property',id:'property-a'},
  {type:'field',id:'field-a'},
  {type:'soil_analysis',id:'soil-a'},
  {type:'agronomic_tool',id:'produtores'}
 ])assert.equal(validateActiveContext({activeContext,context,clientId:'client-a'}).id,activeContext.id)

 const route=routeSystemCapability({message:'Abra o mapeamento desta área.',hasClient:true,activeContext:{type:'field',id:'field-a'}})
 const execution=await executeCapabilityPlan({route,message:'Abra o mapeamento desta área.',clientId:'client-a',context,activeContext:{type:'field',id:'field-a'}})
 assert.equal(execution.active_context.source_ref,'field:field-a')
 assert.equal(execution.tool_result.context.active_context.id,'field-a')
 assert.equal(execution.tool_result.facts.mapped_fields,1)
})

test('objeto ausente, tipo desconhecido e ferramenta inventada falham fechados',async()=>{
 for(const activeContext of [
  {type:'opportunity',id:'opp-other'},
  {type:'field',id:'field-other'},
  {type:'agronomic_tool',id:'paid-tool-that-does-not-exist'},
  {type:'unknown',id:'x'}
 ])assert.throws(()=>validateActiveContext({activeContext,context,clientId:'client-a'}),error=>error.code?.startsWith('val_active_context_'))

 const route=routeSystemCapability({message:'Abra o mapeamento.',hasClient:true})
 await assert.rejects(executeCapabilityPlan({route,message:'Abra o mapeamento.',clientId:'client-a',context,activeContext:{type:'opportunity',id:'opp-other'}}),error=>error.statusCode===404)
})

test('endpoint lê payload.context, valida no servidor e inclui context ref autorizado',()=>{
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 assert.match(source,/payload\.context/)
 assert.match(source,/validateActiveContext/)
 assert.match(source,/activeContextRef/)
})
