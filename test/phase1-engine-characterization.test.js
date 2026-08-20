import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {ValEngine} from '../server/val-engine.js'
import {ValRepository} from '../server/repository.js'

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8')

test('os bootstraps instalam exatamente seis métodos na ordem atual',async()=>{
  const conversion=source('../server/conversion-bootstrap.js')
  const innovation=source('../server/innovation-bootstrap.js')
  const repositoryAssignments=[...conversion.matchAll(/ValRepository\.prototype\.([A-Za-z0-9_]+)\s*=/g)].map(match=>match[1])
  const engineAssignments=[...conversion.matchAll(/ValEngine\.prototype\.([A-Za-z0-9_]+)\s*=/g)].map(match=>match[1])
  const innovationAssignments=[...innovation.matchAll(/ValRepository\.prototype\.([A-Za-z0-9_]+)\s*=/g)].map(match=>match[1])
  assert.deepEqual(repositoryAssignments,['getClientContext','getIntelligence','recordRecommendation'])
  assert.deepEqual(engineAssignments,['answer','status'])
  assert.deepEqual(innovationAssignments,['getClientContext'])

  const beforeContext=ValRepository.prototype.getClientContext
  const beforeAnswer=ValEngine.prototype.answer
  await import('../server/conversion-bootstrap.js')
  const conversionContext=ValRepository.prototype.getClientContext
  assert.notEqual(conversionContext,beforeContext)
  assert.notEqual(ValEngine.prototype.answer,beforeAnswer)
  await import('../server/innovation-bootstrap.js')
  assert.notEqual(ValRepository.prototype.getClientContext,conversionContext)
})

test('a composição implícita preserva fundação, inovações e fallback determinístico',async()=>{
  await import('../server/conversion-bootstrap.js')
  await import('../server/innovation-bootstrap.js')
  let store={surveys:[],imports:[],opportunities:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},attachments:[]}}
  const repository=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:value=>{store=value},tenantId:'tenant-a'})
  const client={id:'cliente-a',name:'Fazenda Horizonte',profileAnswers:{q1:'valor'}}
  const context=await repository.getClientContext({tenantId:'tenant-a',ownerId:'consultor-a',clientId:client.id,client})
  assert.ok(context.conversionFoundation)
  assert.ok(context.conversionInnovations)
  assert.deepEqual(Object.keys(context.conversionInnovations).sort(),['commitmentLadders','messageCalibration','multiDecisionMap','objectionLibrary','postConversionExpansion','valueScenarios'])

  const engine=new ValEngine({runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'terra',modelStrategic:'sol',modelFast:'luna',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:26_000,strategicMaxOutputTokens:32_000,openaiStoreResponses:false},repository})
  const answer=await engine.answer({tenantId:'tenant-a',ownerId:'consultor-a',clientId:client.id,client,message:'Prepare a próxima melhor ação.',attachmentIds:[],mode:'daily'})
  assert.equal(answer.engineMode,'rules')
  assert.equal(answer.engineArchitecture,'deterministic-specific-fallback')
  assert.equal(answer.decisionCore,'val-conversion-core-v1')
  assert.equal(store.val.recommendations.length,1)
  const status=await engine.status({configured:false,ready:false,mode:'json-fallback'})
  assert.equal(status.decisionCore,'val-conversion-core-v1')
  assert.equal(status.automaticRouting,true)
})
