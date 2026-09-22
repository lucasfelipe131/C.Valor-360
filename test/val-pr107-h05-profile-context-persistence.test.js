import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import test,{before,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {validateContextSnapshot} from '../server/memory/context-snapshot.js'
import {calculateProfile} from '../src/lib/profile.js'
import {installConversionComposition} from '../server/conversion-bootstrap.js'
import {ValEngine} from '../server/val-engine.js'
import {buildFastClientResponse,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {createConversationState,prepareConversationTurnState} from '../server/decision-copilot/conversation-state.js'
import {behavioralProfileViewModel} from '../src/lib/full-screen-conversation.js'

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

test('H05 perfil assistido permanece na apresentação após memória comportamental confirmada',async()=>{
 installConversionComposition()
 const {client}=await createProfile('VAL HML20260922 B fictício com memória')
 const message='Qual é o perfil deste produtor?'
 const literal='Homologação fictícia H11-B-20260922: o produtor fictício prefere receber o comparativo de custos por escrito antes da próxima conversa.'
 const engine=new ValEngine({runtimeConfig:{openaiApiKey:'',openaiProject:'',openaiTimeoutMs:1000,openaiMaxRetries:0,modelDaily:'daily',modelStrategic:'strategic',modelFast:'fast',knowledgeVectorStoreId:'',maxContextChars:10_000,maxOutputTokens:10_000,strategicMaxOutputTokens:10_000,openaiStoreResponses:false},repository,logger:()=>{}})
 for(const withMemory of [false,true]){
  if(withMemory){
   const {rows:[row]}=await db.query('SELECT id FROM clients WHERE tenant_id=$1 AND external_key=$2',[tenantId,client.id])
   await db.query(`INSERT INTO val_memories (id,tenant_id,client_id,subject_type,subject_id,memory_type,memory_state,memory_domain,key,value,evidence,confidence,status,source,source_ref,source_type,observed_at,source_updated_at,freshness_policy_version,freshness_metadata,valid_from,created_by,acl) VALUES ($1,$2,$3,'client',$4,'fact','FACT','BEHAVIORAL','visit_report.behavioral_signal',$5,$6,95,'verified','confirmed_voice_interaction',$7,'confirmed_voice_interaction',NOW(),NOW(),'val.context.freshness.v1','{}',NOW(),$8,'{"scope":"own_portfolio"}')`,[randomUUID(),tenantId,row.id,row.id,JSON.stringify({statement:literal,category:'BEHAVIORAL_SIGNAL',profile_certainty:false}),JSON.stringify([{id:randomUUID(),confirmation_status:'CONFIRMED'}]),`voice-interaction:${randomUUID()}`,ownerId])
  }
  // Mirror the server dispatch through intent, state, repository lookup,
  // grounding and the profile card. Before the fix this takes CONTEXT and
  // renders "Não comprovado", retaining only the H11 observation when present.
  const scope={tenantId,ownerId,clientId:client.id,client,conversationId:'synthetic-h05-profile'}
  const intent=routeValIntent({message,hasClient:true})
  const state=prepareConversationTurnState(createConversationState(scope),{message,intent:intent.intent,scope})
  const route=routeSystemCapability({message,intentHint:intent.intent,hasClient:true})
  const contextRequest={requestId:randomUUID(),tenantId,ownerId,producerId:client.id,message,objective:'copilot_context',intent:intent.intent,contextEpoch:state.context_epoch,contextDomain:state.current_domain,actorRole:'admin',scope:'own_portfolio',conversationId:scope.conversationId}
  const context=await contextFor(client)
  const payload=route.direct&&route.path==='FAST'&&route.data_path
   ?buildFastClientResponse({facts:await repository.getFastClientFacts({tenantId,ownerId,clientId:client.id,dataPath:route.data_path}),message,organizationId:tenantId,ownerId,conversationId:scope.conversationId,contextEpoch:state.context_epoch,contextDomain:state.current_domain})
   :await engine.answer({...scope,message,intent:intent.intent,contextRequest})
  const reasoning=payload.advice.ai_reasoning
  const view=behavioralProfileViewModel({reasoning,answer:payload.advice.answer,facts:reasoning.facts_used})
  assert.equal(view.primary,'Analítico',`perfil canônico com memória=${withMemory}`)
  assert.equal(view.confidence,'alta')
  assert.equal(payload.responseMetadata.dataPath,'BEHAVIORAL_PROFILE')
  assert.equal(state.current_domain,'PROFILE')
  assert.equal(reasoning.grounding.passed,true)
  assert.ok(reasoning.facts_used.some(item=>item.evidence_claims?.some(claim=>claim.field==='primaryProfile')))
  assert.ok(reasoning.facts_used.some(item=>item.evidence_claims?.some(claim=>claim.question_id==='7')))
  assert.ok(reasoning.facts_used.every(item=>item.producer_id===client.id&&item.tenant_id===tenantId&&item.owner_id===ownerId))
  assertCanonicalService(context,client,answersFor(client.name)[11])
  if(withMemory){
   assert.ok(context.memories.some(item=>item.value?.statement===literal),'a memória confirmada continua disponível')
   assert.equal((await db.query('SELECT COUNT(*)::integer count FROM val_memories WHERE tenant_id=$1 AND key=$2',[tenantId,'visit_report.behavioral_signal'])).rows[0].count,1)
  }
 }
})

test('H05 referências demonstrativas de perfil usam a mesma rota sem absorver pedidos mistos',()=>{
 for(const question of ['Qual é o perfil deste produtor?','Qual é o perfil desse produtor?','Qual é o perfil desta produtora?','Mostre o perfil dessa produtora.','Perfil deste produtor.']){
  const route=routeSystemCapability({message:question,hasClient:true})
  assert.equal(route.data_path,'BEHAVIORAL_PROFILE',question)
  assert.equal(route.path,'FAST',question)
  assert.equal(routeSystemCapability({message:question,hasClient:false}).data_path,null)
 }
 for(const question of ['Qual é o perfil deste produtor e qual a dívida dele?','Qual é o perfil deste produtor e qual produto aplicar?','Qual é o perfil deste produtor na próxima safra?','Qual é o perfil deste solo?'])assert.notEqual(routeSystemCapability({message:question,hasClient:true}).data_path,'BEHAVIORAL_PROFILE',question)
})
