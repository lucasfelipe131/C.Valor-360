import test from 'node:test'
import assert from 'node:assert/strict'
import {ValRepository} from '../server/repository.js'

test('questionário demonstrativo é individual, expira e só aceita uma resposta',async()=>{
  let store={surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}
  const repository=new ValRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:'tenant'})
  const created=await repository.createSurvey({token:'token-seguro-com-192-bits-simulado',producerName:'Produtor',consultantName:'Consultor',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString()})
  assert.equal((await repository.listSurveys()).length,1)
  assert.equal((await repository.getSurvey(created.token)).producerName,'Produtor')
  await repository.submitSurvey({token:created.token,answers:{1:'a'},result:{name:'Produtor'}})
  await assert.rejects(()=>repository.submitSurvey({token:created.token,answers:{1:'b'},result:{name:'Outro'}}),error=>error.statusCode===409)
  assert.equal((await repository.integrateSurvey(created.token)).status,'integrado')
})
