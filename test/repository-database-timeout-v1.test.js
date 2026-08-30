import assert from 'node:assert/strict'
import test from 'node:test'
import {ValRepository} from '../server/repository.js'

const tenantId='tenant-timeout-a'
const ownerId='owner-timeout-a'
const clientId='client-timeout-a'

const clientReferenceResult={rowCount:1,rows:[{external_key:clientId,name:'Antônio Timeout',municipality:'Maringá',aliases:[],properties:[]}]}
const fastFactsResult={rowCount:1,rows:[{client_external_key:clientId,name:'Antônio Timeout',total_area_ha:120,area_band:null,cultures:'Soja'}]}
const contextResult={rowCount:1,rows:[{
  id:'00000000-0000-4000-8000-000000000701',external_key:clientId,name:'Antônio Timeout',commercial_profile:{},relationship_profile:{},profile_snapshot:{},answers:{},profile_evidence:[],
  signals:[],learning:{},feedback_learning:{},visit_outcomes:[],memories:[],memory_history:[],business_history:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],field_reports:[],soil_analyses:[],ndvi_observations:[],manual_records:[],attachments:[],prior_recommendations:[]
}]}

function repositoryWith(result){
  const calls=[]
  const repository=new ValRepository({
    tenantId,
    db:{configured:true,query:async(...args)=>{calls.push(args);return structuredClone(result)}},
    readStore:()=>({}),
    saveStore:()=>{}
  })
  return {repository,calls}
}

test('listAuthorizedClientReferences encaminha timeout válido ao PostgreSQL e preserva o cache',async()=>{
  const {repository,calls}=repositoryWith(clientReferenceResult)
  const first=await repository.listAuthorizedClientReferences({tenantId,ownerId,timeoutMs:1_250})
  const second=await repository.listAuthorizedClientReferences({tenantId,ownerId,timeoutMs:2_500})

  assert.equal(first[0].id,clientId)
  assert.deepEqual(second,first)
  assert.equal(calls.length,1)
  assert.deepEqual(calls[0][2],{timeoutMs:1_250})
})

test('resolveAuthorizedClientReference propaga timeout para a leitura autorizada',async()=>{
  const {repository,calls}=repositoryWith(clientReferenceResult)
  const resolved=await repository.resolveAuthorizedClientReference({tenantId,ownerId,message:'Vou visitar o Antônio Timeout.',timeoutMs:1_800})

  assert.equal(resolved.status,'RESOLVED')
  assert.equal(resolved.client.id,clientId)
  assert.equal(calls.length,1)
  assert.deepEqual(calls[0][2],{timeoutMs:1_800})
})

test('getFastClientFacts encaminha timeout válido sem alterar escopo ou projeção',async()=>{
  const {repository,calls}=repositoryWith(fastFactsResult)
  const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId,dataPath:'REGISTERED_AREA',timeoutMs:900})

  assert.equal(facts.client.id,clientId)
  assert.equal(facts.client.totalAreaHa,120)
  assert.deepEqual(calls[0][1],[tenantId,ownerId,clientId])
  assert.deepEqual(calls[0][2],{timeoutMs:900})
})

test('getClientContext usa somente contextRequest.databaseTimeoutMs',async()=>{
  const {repository,calls}=repositoryWith(contextResult)
  const context=await repository.getClientContext({tenantId,ownerId,clientId,contextRequest:{databaseTimeoutMs:4_000,objective:'next_best_action',actorRole:'consultant'}})

  assert.equal(context.client.id,clientId)
  assert.deepEqual(calls[0][1],[tenantId,clientId,ownerId])
  assert.deepEqual(calls[0][2],{timeoutMs:4_000})
})

test('leituras de attachments propagam deadline e cancelamento ao PostgreSQL',async()=>{
  const attachmentId='00000000-0000-4000-8000-000000000702'
  const result={rowCount:1,rows:[{id:attachmentId,tenant_id:tenantId,consultant_id:ownerId,client_id:'internal-client',client_external_key:clientId,original_name:'laudo.pdf',mime_type:'application/pdf',size_bytes:12,status:'received',analysis:{},created_at:'2026-08-29T12:00:00.000Z'}]}
  const {repository,calls}=repositoryWith(result)
  const controller=new AbortController()

  assert.equal((await repository.getAttachments({tenantId,ownerId,clientId,ids:[attachmentId],signal:controller.signal,timeoutMs:1_100}))[0].id,attachmentId)
  assert.deepEqual(calls[0][2],{signal:controller.signal,timeoutMs:1_100})
  await repository.listAttachments({tenantId,ownerId,clientId,signal:controller.signal,timeoutMs:1_200})
  assert.deepEqual(calls[1][2],{signal:controller.signal,timeoutMs:1_200})
})

test('timeouts ausentes ou inválidos preservam chamadas db.query com dois argumentos',async()=>{
  const list=repositoryWith(clientReferenceResult)
  await list.repository.listAuthorizedClientReferences({tenantId,ownerId,timeoutMs:0})
  assert.equal(list.calls[0].length,2)

  const resolved=repositoryWith(clientReferenceResult)
  await resolved.repository.resolveAuthorizedClientReference({tenantId,ownerId,message:'Vou visitar o Antônio Timeout.',timeoutMs:Infinity})
  assert.equal(resolved.calls[0].length,2)

  const facts=repositoryWith(fastFactsResult)
  await facts.repository.getFastClientFacts({tenantId,ownerId,clientId,dataPath:'REGISTERED_AREA',timeoutMs:-1})
  assert.equal(facts.calls[0].length,2)

  const context=repositoryWith(contextResult)
  await context.repository.getClientContext({tenantId,ownerId,clientId,contextRequest:{databaseTimeoutMs:'inválido'}})
  assert.equal(context.calls[0].length,2)
})
