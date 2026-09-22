import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {validateContextSnapshot} from '../server/memory/context-snapshot.js'
import {calculateProfile} from '../src/lib/profile.js'

// Real persisted assisted profiles, not canned PostgreSQL rows or a mock of the
// context selector. No provider or external database is used by these cases.
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId=randomUUID(),otherOwner=randomUUID(),otherTenant=randomUUID()
let pg,db,repository,matrix
const sqlErrors=[]
const normalizeResult=result=>({...result,rowCount:result.rows.length||result.affectedRows||0})
before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
 const query=async(...args)=>{try{return normalizeResult(await pg.query(...args))}catch(error){sqlErrors.push(error.code);throw error}}
 db={configured:true,query,transaction:work=>pg.transaction(tx=>work({query:async(...args)=>normalizeResult(await tx.query(...args))}))}
 for(const id of [ownerId,otherOwner])await query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[id,'SYNTHETIC H05 operator',`${id}@example.test`])
 await query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)',[otherTenant,'SYNTHETIC H05 other tenant',otherTenant])
 for(const [tenant,owner] of [[tenantId,ownerId],[tenantId,otherOwner],[otherTenant,ownerId]])await query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,owner,'admin'])
 matrix=JSON.parse(await readFile(new URL('../src/data/profile-matrix.json',import.meta.url),'utf8'))
 repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{}})
})
after(async()=>{await pg?.close()})

const answersFor=(name,service)=>{
 const answers={1:name,2:'São Luiz Gonzaga - RS',3:'120',4:'soja 80 milho 40'}
 for(let question=7;question<=18;question++)answers[question]=matrix.filter(item=>Number(item.Pergunta)===question)[1].Alternativa
 for(let question=19;question<=24;question++)answers[question]=8
 if(service)answers[11]=service
 return answers
}
const createProfile=async(name,service)=>{
 const answers=answersFor(name,service)
 return {answers,client:await repository.saveSurveyProfile({answers,result:calculateProfile(answers,matrix,'Aplicação assistida validada no servidor')},ownerId)}
}
const contextFor=(client,overrides={})=>repository.getClientContext({tenantId,ownerId,clientId:client.id,client:{id:client.id,name:client.name},contextRequest:{requestId:randomUUID(),tenantId,ownerId,producerId:client.id,message:'Qual é o perfil deste produtor?',objective:'general_assistance',intent:'ASK_CLIENT',contextEpoch:0,contextDomain:'PROFILE',actorRole:'admin',scope:'own_portfolio',conversationId:'synthetic-h05-profile'},...overrides})
const assertCanonicalService=(context,client,literal)=>{
 assert.deepEqual(validateContextSnapshot(context.contextSnapshot),[])
 assert.equal(context.contextSnapshot.context_scope.domain,'PROFILE')
 const signal=context.contextSnapshot.behavioral_signals.find(item=>item.key==='service_preference')
 assert.ok(signal,'preferência canônica válida deve continuar disponível no snapshot')
 assert.ok(signal.value.includes(literal),'o sinal preserva a resposta literal da preferência')
 assert.equal(signal.tenant_id,tenantId)
 assert.equal(signal.producer_id,client.id)
 assert.equal(signal.owner_id,ownerId)
 assert.ok(signal.evidence_refs.length)
 assert.equal(context.profile.answers['11'],literal,'a resposta canônica não deve ser reescrita')
 assert.ok(context.profile.evidence.some(item=>item.source_field==='servicePreference'&&item.materialized_value===literal&&item.source_locator==='answers.q11'))
}

test('H05 perfil assistido recém-criado mantém perfil e preferência canônica sem 503',async()=>{
 const {client,answers}=await createProfile('VAL HML20260922 B fictício')
 const context=await contextFor(client)
 assertCanonicalService(context,client,answers[11])
 assert.equal(context.client.primaryProfile,'Analítico')
 assert.equal(context.client.secondaryProfile,null,'A aprofundar não é uma classificação')
 assert.ok(context.contextSnapshot.behavioral_signals.some(item=>item.key==='primary_profile'&&item.value==='Analítico'))
 assert.equal(context.contextSnapshot.behavioral_signals.some(item=>item.key==='secondary_profile'),false)
 assert.equal(context.profile.evidence.some(item=>item.source_field==='secondaryProfile'),false)
 assert.deepEqual(sqlErrors,[])
})

test('H05 todas as alternativas canônicas de atendimento conservam o valor e sua proveniência',async()=>{
 for(const [index,item] of matrix.filter(item=>Number(item.Pergunta)===11).entries()){
  const {client,answers}=await createProfile(`SYNTHETIC H05 atendimento ${index}`,item.Alternativa)
  assertCanonicalService(await contextFor(client),client,answers[11])
 }
})

test('H05 rótulo da preferência não autoriza dado de crédito ou agronomia em PROFILE',async()=>{
 for(const [index,service] of ['POISON_CPF: CPF financeira pendente.','POISON_AGRO: aplicar herbicida na lavoura.'].entries()){
  const {client}=await createProfile(`SYNTHETIC H05 poisoned preference ${index}`,service)
  const context=await contextFor(client)
  assert.deepEqual(validateContextSnapshot(context.contextSnapshot),[])
  assert.equal(context.contextSnapshot.behavioral_signals.some(item=>item.key==='service_preference'),false)
  assert.doesNotMatch(JSON.stringify(context.contextSnapshot),/POISON_CPF|POISON_AGRO|CPF financeira|aplicar herbicida/i)
  assert.equal(context.client.primaryProfile,'Analítico')
 }
})

test('H05 perfil persistido continua restrito ao produtor, owner e tenant autorizados',async()=>{
 const {client}=await createProfile('SYNTHETIC H05 scoped profile')
 await assert.rejects(()=>contextFor(client,{ownerId:otherOwner}),error=>error.statusCode===404)
 const foreign=new ValRepository({db,tenantId:otherTenant,readStore:()=>({}),saveStore:()=>{}})
 await assert.rejects(()=>foreign.getClientContext({tenantId:otherTenant,ownerId,clientId:client.id}),error=>error.statusCode===404)
 await assert.rejects(()=>contextFor({...client,id:'synthetic-missing-producer'}),error=>error.statusCode===404)
 assertCanonicalService(await contextFor(client),client,answersFor(client.name)[11])
})
