import assert from 'node:assert/strict'
import test from 'node:test'
import {runWithRequestContext} from '../server/observability.js'
import {ValRepository} from '../server/repository.js'

test('telemetria do snapshot registra referências por contagem e nunca conteúdo',async()=>{
  const logs=[]
  let store={surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},technicalContextHistory:[]}}
  const repository=new ValRepository({db:{configured:false},tenantId:'tenant-a',readStore:()=>store,saveStore:value=>{store=value}})
  await repository.saveTechnicalContext('client-a',{notes:'CONTEUDO-SENSIVEL-NAO-LOGAR'},'actor-a')
  const context=await runWithRequestContext({requestId:'00000000-0000-4000-8000-000000000399',tenantId:'tenant-a',actorId:'actor-a',method:'POST',path:'/api/v1/val/recommendations'},()=>repository.getClientContext({tenantId:'tenant-a',ownerId:'actor-a',clientId:'client-a',client:{id:'client-a',name:'Produtor'},contextRequest:{requestId:'00000000-0000-4000-8000-000000000399',objective:'next_best_action',actorRole:'consultant'}}),{logger:value=>logs.push(JSON.parse(value))})
  assert.ok(context.contextSnapshot.context_snapshot_id)
  const event=logs.find(item=>item.stage==='context.snapshot.built')
  assert.equal(event.request_id,'00000000-0000-4000-8000-000000000399')
  assert.equal(event.contractVersion,'val.context_snapshot.v1')
  assert.equal(event.memoryRefsConsidered,1)
  assert.equal(event.memoryRefsSelected,1)
  assert.equal(event.memoryRefsExcluded,0)
  assert.equal(event.exclusionReasonCounts,'none')
  assert.equal('selectedRefs' in event,false)
  assert.equal('excludedRefs' in event,false)
  assert.equal(JSON.stringify(logs).includes('CONTEUDO-SENSIVEL-NAO-LOGAR'),false)
})
