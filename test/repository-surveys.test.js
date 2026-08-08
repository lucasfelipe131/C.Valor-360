import test from 'node:test'
import assert from 'node:assert/strict'
import {ValRepository} from '../server/repository.js'

test('questionário demonstrativo é individual, expira e só aceita uma resposta',async()=>{
  let store={surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}
  const repository=new ValRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:'tenant'})
  const created=await repository.createSurvey({token:'token-seguro-com-192-bits-simulado',producerName:'Produtor',consultantName:'Consultor',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString()})
  assert.equal((await repository.listSurveys()).length,1)
  assert.equal((await repository.getSurvey(created.token)).producerName,'Produtor')
  await repository.submitSurvey({token:created.token,answers:{1:'a',27:'Não.'},result:{name:'Produtor',additionalNeed:'Não.',commercial:{opportunity:'Não.'}}})
  const stored=await repository.getSurvey(created.token)
  assert.equal(stored.result.additionalNeed,'Não.')
  assert.equal(stored.result.additionalNeedStatus,'none_declared')
  assert.equal(stored.result.commercial.opportunity,'')
  await assert.rejects(()=>repository.submitSurvey({token:created.token,answers:{1:'b'},result:{name:'Outro'}}),error=>error.statusCode===409)
  assert.equal((await repository.integrateSurvey(created.token)).status,'integrado')
})

test('integração PostgreSQL separa Q27 da oportunidade canônica sob o mesmo lock',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.startsWith('SELECT id,status,answers,result'))return {rowCount:1,rows:[{id:'survey-id',status:'respondido',answers:{27:'Não.'},result:{id:'cliente',name:'Cliente',additionalNeed:'Não.',commercial:{opportunity:'Não.'}}}]}
    if(sql.startsWith('SELECT c.commercial_profile'))return {rowCount:1,rows:[{commercial_profile:{property:'Talhão 1',opportunity:'Ampliar armazenagem'},profile_snapshot:{additionalNeed:'Ampliar armazenagem',commercial:{opportunity:'Ampliar armazenagem'}}}]}
    if(sql.includes('INSERT INTO clients'))return {rowCount:1,rows:[{id:'client-id'}]}
    if(sql.startsWith('SELECT token,producer_name'))return {rowCount:1,rows:[{token:'token',status:'integrado'}]}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},readStore:()=>({}),saveStore:()=>{},tenantId:'tenant'})
  assert.equal((await repository.integrateSurvey('token')).status,'integrado')
  const advisory=calls.findIndex(call=>call.sql.includes('pg_advisory_xact_lock'))
  const canonicalRead=calls.findIndex(call=>call.sql.startsWith('SELECT c.commercial_profile'))
  assert.ok(advisory>=0&&canonicalRead>advisory)
  const clientCall=calls.find(call=>call.sql.includes('INSERT INTO clients'))
  const snapshotCall=calls.find(call=>call.sql.includes('INSERT INTO client_profiles'))
  assert.deepEqual(JSON.parse(clientCall.params[8]),{property:'Talhão 1'})
  assert.equal(JSON.parse(snapshotCall.params[8]).commercial.opportunity,'')
  assert.equal(JSON.parse(snapshotCall.params[8]).commercial.opportunityProvenance.state,'none_declared')
})
